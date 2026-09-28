# Copyright (c) 2026, NOZOM and contributors
# License: MIT

"""Closing recovery behavior. These tests do not post invoices or touch a site."""

from __future__ import annotations

import unittest
from contextlib import contextmanager
from unittest.mock import patch

import frappe

from nozom_pos.api import closing


@contextmanager
def _noop_lock(*args, **kwargs):
	yield


class FakeRow(dict):
	def get(self, key, default=None):
		return super().get(key, default)


class FakeChild:
	def __init__(self, **data):
		self._data = data

	def as_dict(self):
		return dict(self._data)

	def get(self, key, default=None):
		return self._data.get(key, default)


class FakeClosing:
	store = {}
	inserts = []
	submits = []
	retries = []
	fail_next_submit = None

	def __init__(self, name=None, **data):
		self.name = name
		self.status = data.get("status", "Draft")
		self.docstatus = data.get("docstatus", 0)
		self.error_message = data.get("error_message")
		self.pos_opening_entry = data.get("pos_opening_entry", "POS-OPE-1")
		self.pos_profile = data.get("pos_profile", "Main")
		self.company = data.get("company", "Fantaz")
		self.user = data.get("user", "cashier@example.com")
		self.period_start_date = data.get("period_start_date", "2026-09-01")
		self.period_end_date = data.get("period_end_date", "2026-09-01 18:00:00")
		self.grand_total = data.get("grand_total", 10)
		self.net_total = data.get("net_total", 10)
		self.total_quantity = data.get("total_quantity", 1)
		self.total_taxes_and_charges = data.get("total_taxes_and_charges", 0)
		self.posting_date = data.get("posting_date", "2026-09-01")
		self.posting_time = data.get("posting_time", "18:00:00")
		self.nozom_cash_denomination_json = data.get("nozom_cash_denomination_json")
		self.pos_invoices = data.get("pos_invoices") or []
		self.sales_invoices = data.get("sales_invoices") or []
		self.payment_reconciliation = data.get("payment_reconciliation") or []
		self.taxes = data.get("taxes") or []

	def get(self, key, default=None):
		return getattr(self, key, default)

	def set(self, key, value):
		setattr(self, key, value)

	def insert(self):
		self.name = self.name or f"POS-CLO-{len(FakeClosing.inserts) + 1:05d}"
		FakeClosing.inserts.append(self.name)
		FakeClosing.store[self.name] = self
		return self

	def reload(self):
		return self

	def save(self):
		FakeClosing.store[self.name] = self
		return self

	def submit(self):
		FakeClosing.submits.append(self.name)
		mode = FakeClosing.fail_next_submit
		FakeClosing.fail_next_submit = None
		if mode == "timeout":
			raise frappe.QueryTimeoutError("Lock wait timeout exceeded; try restarting transaction")
		if mode == "queued":
			self.docstatus = 1
			self.status = "Queued"
			return self
		self.docstatus = 1
		self.status = "Submitted"
		return self

	def retry(self):
		FakeClosing.retries.append(self.name)
		self.docstatus = 1
		self.status = "Submitted"
		return self

	def db_set(self, key, value, update_modified=True):
		setattr(self, key, value)


class FakeOpening:
	def __init__(self, name="POS-OPE-1"):
		self.name = name


def _prepared(name=None, status="Draft"):
	closing_doc = FakeClosing(
		name=name,
		pos_invoices=[FakeChild(pos_invoice="ACC-PSINV-1", grand_total=10)],
		payment_reconciliation=[FakeChild(mode_of_payment="Cash", closing_amount=10)],
		taxes=[FakeChild(account_head="VAT", amount=0)],
		status=status,
	)
	opening = FakeOpening()
	payments = [
		{
			"mode_of_payment": "Cash",
			"type": "Cash",
			"difference": 0,
		}
	]
	return closing_doc, opening, {}, payments, [], 10, True


class TestClosingRecovery(unittest.TestCase):
	def setUp(self):
		FakeClosing.store = {}
		FakeClosing.inserts = []
		FakeClosing.submits = []
		FakeClosing.retries = []
		FakeClosing.fail_next_submit = None
		self.patches = [
			patch.object(closing, "filelock", _noop_lock),
			patch.object(closing.frappe, "has_permission", return_value=True),
			patch.object(closing.frappe.db, "commit", lambda: None),
			patch.object(closing.frappe, "log_error", lambda *args, **kwargs: None),
			patch.object(closing.frappe, "get_doc", side_effect=self._get_doc),
		]
		for item in self.patches:
			item.start()
		self.rows = []
		patch.object(closing, "_closings_for_opening", side_effect=lambda name: list(self.rows)).start()
		patch.object(closing, "_prepare_closing_doc", side_effect=lambda *args, **kwargs: _prepared()).start()

	def tearDown(self):
		patch.stopall()

	def _get_doc(self, doctype, name):
		return FakeClosing.store[name]

	def _remember(self, doc):
		self.rows.insert(
			0,
			FakeRow(
				name=doc.name,
				status=doc.status,
				docstatus=doc.docstatus,
				error_message=doc.error_message,
				modified="2026-09-29 00:00:00",
				period_end_date=doc.period_end_date,
			),
		)

	def test_a_normal_closing_creates_one_entry(self):
		result = closing.submit_closing_entry("POS-OPE-1")
		self.assertEqual(result["status"], "Submitted")
		self.assertTrue(result["completed"])
		self.assertEqual(FakeClosing.inserts, ["POS-CLO-00001"])
		self.assertEqual(FakeClosing.submits, ["POS-CLO-00001"])

	def test_b_lock_timeout_keeps_one_draft_and_retry_reuses_it(self):
		FakeClosing.fail_next_submit = "timeout"
		first = closing.submit_closing_entry("POS-OPE-1")
		self.assertEqual(first["status"], "Retryable")
		self.assertEqual(first["reason"], "DB_LOCK_TIMEOUT")
		self.assertTrue(first["retryable"])
		self.assertEqual(first["docstatus"], 0)
		self.assertEqual(len(FakeClosing.inserts), 1)
		saved = FakeClosing.store[first["closing_entry"]]
		self.assertEqual(saved.docstatus, 0)
		self._remember(saved)

		second = closing.submit_closing_entry("POS-OPE-1")
		self.assertEqual(second["status"], "Submitted")
		self.assertEqual(second["closing_entry"], first["closing_entry"])
		self.assertEqual(len(FakeClosing.inserts), 1)
		self.assertEqual(FakeClosing.submits, [first["closing_entry"], first["closing_entry"]])

	def test_c_second_click_does_not_create_another_closing(self):
		first = closing.submit_closing_entry("POS-OPE-1")
		self._remember(FakeClosing.store[first["closing_entry"]])
		second = closing.submit_closing_entry("POS-OPE-1")
		self.assertEqual(len(FakeClosing.inserts), 1)
		self.assertEqual(second["closing_entry"], first["closing_entry"])
		self.assertTrue(second["completed"])

	def test_d_reconcile_by_opening_finds_existing_draft(self):
		draft = FakeClosing(name="POS-CLO-00009", docstatus=0, status="Draft")
		FakeClosing.store[draft.name] = draft
		self._remember(draft)
		state = closing.get_closing_state_for_opening("POS-OPE-1")
		self.assertEqual(state["closing_entry"], "POS-CLO-00009")
		self.assertEqual(state["docstatus"], 0)
		self.assertTrue(state["retryable"])
		self.assertFalse(state["completed"])
		self.assertEqual(FakeClosing.inserts, [])

	def test_e_queued_merge_returns_without_waiting(self):
		FakeClosing.fail_next_submit = "queued"
		with patch("time.sleep", side_effect=AssertionError("request waited")):
			result = closing.submit_closing_entry("POS-OPE-1")
		self.assertEqual(result["status"], "Queued")
		self.assertTrue(result["processing"])
		self.assertFalse(result["completed"])
		self.assertEqual(len(FakeClosing.inserts), 1)

	def test_f_completed_closing_is_recognized(self):
		self.rows.append(
			FakeRow(
				name="POS-CLO-00002",
				status="Submitted",
				docstatus=1,
				error_message="",
				modified="2026-09-29 01:00:00",
				period_end_date="2026-09-29 18:00:00",
			)
		)
		result = closing.submit_closing_entry("POS-OPE-1")
		self.assertEqual(result["status"], "Submitted")
		self.assertTrue(result["completed"])
		self.assertEqual(result["closing_entry"], "POS-CLO-00002")
		self.assertEqual(FakeClosing.inserts, [])
		self.assertEqual(FakeClosing.submits, [])

	def test_multiple_submitted_closings_are_not_all_submitted(self):
		self.rows.extend(
			[
				FakeRow(name="POS-CLO-A", status="Submitted", docstatus=1, modified="2026-09-29 02:00:00"),
				FakeRow(name="POS-CLO-B", status="Submitted", docstatus=1, modified="2026-09-29 01:00:00"),
			]
		)
		result = closing.submit_closing_entry("POS-OPE-1")
		self.assertEqual(result["status"], "Ambiguous")
		self.assertTrue(result["ambiguous"])
		self.assertEqual(FakeClosing.inserts, [])
		self.assertEqual(FakeClosing.submits, [])


if __name__ == "__main__":
	unittest.main()
