# Copyright (c) 2026, NOZOM and contributors
# License: MIT

"""POS rounded-total vs grand_total when POS Profile.disable_rounded_total is set.

These tests do not post invoices or require site business data.
"""

from __future__ import annotations

import unittest
from types import SimpleNamespace

import frappe

from nozom_pos.overrides.sales_invoice import POSInvoice, PartialPaymentValidationError


class _FakeDB:
	def __init__(self):
		self.get_value_calls = []
		self.get_single_value_calls = []
		self.disable_rounded_total = 0
		self.global_disable_rounded_total = 0
		self.allow_partial_payment = 0

	def get_value(self, doctype, name, fieldname=None, *args, **kwargs):
		self.get_value_calls.append((doctype, name, fieldname))
		if fieldname == "disable_rounded_total":
			return self.disable_rounded_total
		if fieldname == "allow_partial_payment":
			return self.allow_partial_payment
		return None

	def get_single_value(self, doctype, fieldname, *args, **kwargs):
		self.get_single_value_calls.append((doctype, fieldname))
		if doctype == "Global Defaults" and fieldname == "disable_rounded_total":
			return self.global_disable_rounded_total
		return None


def _make_invoice(**kwargs):
	"""Bare POSInvoice instance with only the fields needed by rounding helpers."""
	inv = object.__new__(POSInvoice)
	inv.grand_total = kwargs.get("grand_total", 97.50)
	inv.base_grand_total = kwargs.get("base_grand_total", inv.grand_total)
	inv.rounded_total = kwargs.get("rounded_total", 98.00)
	inv.base_rounded_total = kwargs.get("base_rounded_total", inv.rounded_total)
	inv.rounding_adjustment = kwargs.get("rounding_adjustment", 0.50)
	inv.base_rounding_adjustment = kwargs.get("base_rounding_adjustment", inv.rounding_adjustment)
	inv.paid_amount = kwargs.get("paid_amount", 0)
	inv.base_paid_amount = kwargs.get("base_paid_amount", inv.paid_amount)
	inv.change_amount = kwargs.get("change_amount", 0)
	inv.base_change_amount = kwargs.get("base_change_amount", 0)
	inv.write_off_amount = kwargs.get("write_off_amount", 0)
	inv.base_write_off_amount = kwargs.get("base_write_off_amount", 0)
	inv.outstanding_amount = kwargs.get("outstanding_amount", 0)
	inv.account_for_change_amount = kwargs.get("account_for_change_amount", "Cash - T")
	inv.pos_profile = kwargs.get("pos_profile", "Shop")
	inv.is_return = kwargs.get("is_return", 0)
	inv.docstatus = kwargs.get("docstatus", 0)
	inv.payments = kwargs.get("payments", [])
	# Avoid flt(amount, precision) site rounding (needs currency context).
	inv.precision = lambda field: None  # noqa: ARG005
	if "disable_rounded_total" in kwargs:
		inv.disable_rounded_total = kwargs["disable_rounded_total"]
	return inv


def _apply_set_rounded_total_disable_branch(inv):
	"""Mirror ERPNext TaxesAndTotals.set_rounded_total when rounding is disabled.

	Full TaxesAndTotals needs currency/meta/site context; the disable branch is
	exactly: zero rounded_total and rounding_adjustment.
	"""
	if inv.is_rounded_total_disabled():
		inv.rounded_total = 0
		inv.rounding_adjustment = 0
		return "disabled"
	return "enabled"


class TestPOSRounding(unittest.TestCase):
	def setUp(self):
		# Bind lightweight locals so LocalProxy / frappe.throw work without a site.
		self.db = _FakeDB()
		frappe.local.db = self.db
		frappe.local.flags = frappe._dict()
		frappe.local.message_log = []

	def tearDown(self):
		for key in ("db", "flags", "message_log"):
			if hasattr(frappe.local, key):
				delattr(frappe.local, key)

	def test_a_outstanding_zero_when_rounding_disabled(self):
		inv = _make_invoice(
			grand_total=97.50,
			rounded_total=98.00,
			paid_amount=97.50,
			disable_rounded_total=1,
		)
		inv.set_outstanding_amount()
		self.assertEqual(inv.outstanding_amount, 0)

	def test_b_outstanding_uses_rounded_total_when_enabled(self):
		inv = _make_invoice(
			grand_total=97.50,
			rounded_total=98.00,
			paid_amount=97.50,
			disable_rounded_total=0,
		)
		inv.set_outstanding_amount()
		self.assertEqual(inv.outstanding_amount, 0.50)

	def test_c_change_uses_grand_total_when_rounding_disabled(self):
		inv = _make_invoice(
			grand_total=97.50,
			base_grand_total=97.50,
			rounded_total=98.00,
			base_rounded_total=98.00,
			paid_amount=100.00,
			base_paid_amount=100.00,
			change_amount=0,
			disable_rounded_total=1,
		)
		inv.validate_change_amount()
		self.assertEqual(inv.change_amount, 2.50)
		self.assertEqual(inv.base_change_amount, 2.50)

	def test_d_change_uses_rounded_total_when_enabled(self):
		inv = _make_invoice(
			grand_total=97.50,
			base_grand_total=97.50,
			rounded_total=98.00,
			base_rounded_total=98.00,
			paid_amount=100.00,
			base_paid_amount=100.00,
			change_amount=0,
			disable_rounded_total=0,
		)
		inv.validate_change_amount()
		self.assertEqual(inv.change_amount, 2.00)
		self.assertEqual(inv.base_change_amount, 2.00)

	def test_e_validate_full_payment_respects_disabled_rounding(self):
		inv = _make_invoice(
			grand_total=97.50,
			rounded_total=98.00,
			paid_amount=97.50,
			disable_rounded_total=1,
		)
		# Must not treat 97.50 vs rounded 98 as a partial payment.
		inv.validate_full_payment()

	def test_e_validate_full_payment_still_flags_true_partial_when_enabled(self):
		inv = _make_invoice(
			grand_total=97.50,
			rounded_total=98.00,
			paid_amount=97.50,
			disable_rounded_total=0,
		)
		self.db.allow_partial_payment = 0
		with self.assertRaises(PartialPaymentValidationError):
			inv.validate_full_payment()

	def test_f_return_refund_uses_signed_effective_total_when_disabled(self):
		"""Refund equal to grand_total must be accepted even if rounded_total differs."""
		inv = _make_invoice(
			grand_total=-97.50,
			base_grand_total=-97.50,
			rounded_total=-98.00,
			base_rounded_total=-98.00,
			is_return=1,
			docstatus=1,
			disable_rounded_total=1,
			payments=[SimpleNamespace(idx=1, amount=-97.50)],
		)
		# Must not throw: -97.50 is not greater (more negative) than effective -97.50
		inv.validate_payment_amount()

	def test_f_return_refund_rejects_over_refund_against_effective_total(self):
		inv = _make_invoice(
			grand_total=-97.50,
			base_grand_total=-97.50,
			rounded_total=-98.00,
			base_rounded_total=-98.00,
			is_return=1,
			docstatus=1,
			disable_rounded_total=1,
			payments=[SimpleNamespace(idx=1, amount=-98.00)],
		)
		with self.assertRaises(frappe.ValidationError):
			inv.validate_payment_amount()

	def test_f_return_enabled_rounding_uses_rounded_total(self):
		inv = _make_invoice(
			grand_total=-97.50,
			rounded_total=-98.00,
			is_return=1,
			docstatus=1,
			disable_rounded_total=0,
			payments=[SimpleNamespace(idx=1, amount=-98.00)],
		)
		# Exact rounded total refund is allowed
		inv.validate_payment_amount()

	def test_resolve_disable_rounded_total_from_profile_when_unset(self):
		inv = _make_invoice()  # no in-memory disable_rounded_total
		self.assertFalse(hasattr(inv, "disable_rounded_total"))
		self.db.disable_rounded_total = 1
		total = inv.get_effective_invoice_total()
		self.assertEqual(total, 97.50)
		self.assertEqual(inv.disable_rounded_total, 1)
		self.assertIn(
			("POS Profile", "Shop", "disable_rounded_total"),
			self.db.get_value_calls,
		)

	def test_resolve_prefers_in_memory_value(self):
		inv = _make_invoice(disable_rounded_total=1)
		self.db.disable_rounded_total = 0
		total = inv.get_effective_invoice_total()
		self.assertEqual(total, 97.50)
		self.assertEqual(self.db.get_value_calls, [])

	def test_is_rounded_total_disabled_reads_pos_profile(self):
		inv = _make_invoice(pos_profile="Shop")
		self.db.disable_rounded_total = 1
		self.db.global_disable_rounded_total = 0
		self.assertEqual(inv.is_rounded_total_disabled(), 1)
		self.assertEqual(inv.disable_rounded_total, 1)
		self.assertIn(
			("POS Profile", "Shop", "disable_rounded_total"),
			self.db.get_value_calls,
		)
		self.assertEqual(self.db.get_single_value_calls, [])

	def test_is_rounded_total_disabled_falls_back_without_pos_profile(self):
		inv = _make_invoice(pos_profile=None)
		# POS Invoice has no DocField — ERPNext falls through to Global Defaults.
		inv.meta = SimpleNamespace(get_field=lambda name: None)  # noqa: ARG005
		self.db.global_disable_rounded_total = 1
		self.assertEqual(inv.is_rounded_total_disabled(), 1)
		self.assertIn(
			("Global Defaults", "disable_rounded_total"),
			self.db.get_single_value_calls,
		)

	def test_set_rounded_total_zeros_when_profile_disables_rounding(self):
		inv = _make_invoice(
			grand_total=97.50,
			rounded_total=98.00,
			rounding_adjustment=0.50,
			pos_profile="Shop",
		)
		self.db.disable_rounded_total = 1
		branch = _apply_set_rounded_total_disable_branch(inv)
		self.assertEqual(branch, "disabled")
		self.assertEqual(inv.rounded_total, 0)
		self.assertEqual(inv.rounding_adjustment, 0)

		inv.paid_amount = 97.50
		inv.set_outstanding_amount()
		self.assertEqual(inv.outstanding_amount, 0)

	def test_set_rounded_total_keeps_rounding_when_profile_enables_it(self):
		inv = _make_invoice(
			grand_total=97.50,
			rounded_total=98.00,
			rounding_adjustment=0.50,
			pos_profile="Shop",
		)
		self.db.disable_rounded_total = 0
		branch = _apply_set_rounded_total_disable_branch(inv)
		self.assertEqual(branch, "enabled")
		self.assertEqual(inv.rounded_total, 98.00)
		self.assertEqual(inv.rounding_adjustment, 0.50)


if __name__ == "__main__":
	unittest.main()
