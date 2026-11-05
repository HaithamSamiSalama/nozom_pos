# Copyright (c) 2026, NOZOM and contributors
# License: MIT

"""Focused tests for Past Orders Cancelled filter + cancel-button visibility rules.

Does not create or cancel customer invoices. Filter helpers are pure;
cancel-button rules are mirrored from pos_past_order_summary.js.
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

from nozom_pos.api.orders import build_invoice_filters


def _visible_action_buttons(doc, *, can_cancel_perm=True, offline=False):
	"""Mirror get_condition_btn_map cancel injection for submitted invoices."""
	if offline or doc.get("_nozom_local_queue") or doc.get("_nozom_local_draft") or doc.get("_from_cache"):
		return ["New Order"]

	docstatus = int(doc.get("docstatus") or 0)
	is_return = int(doc.get("is_return") or 0)
	status = doc.get("status") or ""
	outstanding = float(doc.get("outstanding_amount") or 0)
	collectable = (
		docstatus == 1 and not is_return and status != "Consolidated" and outstanding > 0
	)
	can_cancel = docstatus == 1 and can_cancel_perm and not offline

	def with_cancel(btns):
		if not can_cancel or "Cancel Invoice" in btns:
			return btns
		out = list(btns)
		if "Return" in out:
			idx = out.index("Return")
			out.insert(idx + 1, "Cancel Invoice")
		else:
			out.append("Cancel Invoice")
		return out

	if docstatus == 0:
		return ["Edit Order", "Delete Order"]
	if collectable:
		return with_cancel(["Add Payment", "Print Receipt", "Send To Kitchen"])
	if not collectable and status in ("Partly Paid", "Overdue", "Unpaid"):
		return with_cancel(["Print Receipt", "Send To Kitchen"])
	if not is_return and docstatus == 1 and not collectable and status not in (
		"Partly Paid",
		"Overdue",
		"Unpaid",
	):
		return with_cancel(["Print Receipt", "Send To Kitchen", "Return"])
	if is_return and docstatus == 1:
		return with_cancel([])
	if docstatus == 2:
		return []
	return []


class TestBuildInvoiceFilters(unittest.TestCase):
	def test_cancelled_uses_docstatus_2_for_pos_invoice(self):
		self.assertEqual(build_invoice_filters("POS Invoice", "Cancelled"), {"docstatus": 2})

	def test_cancelled_uses_docstatus_2_for_sales_invoice(self):
		self.assertEqual(
			build_invoice_filters("Sales Invoice", "Cancelled"),
			{"is_created_using_pos": 1, "docstatus": 2},
		)

	def test_all_includes_cancelled_for_pos_invoice(self):
		self.assertEqual(build_invoice_filters("POS Invoice", "All"), {})

	def test_all_includes_cancelled_for_sales_invoice(self):
		self.assertEqual(
			build_invoice_filters("Sales Invoice", "All"),
			{"is_created_using_pos": 1},
		)

	def test_paid_still_delegates_to_erpnext_filters(self):
		fake = {"status": "Paid"}
		with patch(
			"nozom_pos.api.orders.get_invoice_filters",
			return_value=fake,
		) as mocked:
			result = build_invoice_filters("POS Invoice", "Paid")
			mocked.assert_called_once_with("POS Invoice", "Paid")
			self.assertEqual(result, fake)


class TestCancelInvoiceButtonRules(unittest.TestCase):
	def test_cancel_appears_directly_below_return_on_paid_invoice(self):
		btns = _visible_action_buttons(
			{"docstatus": 1, "is_return": 0, "status": "Paid", "outstanding_amount": 0}
		)
		self.assertIn("Return", btns)
		self.assertIn("Cancel Invoice", btns)
		self.assertEqual(btns.index("Cancel Invoice"), btns.index("Return") + 1)

	def test_cancel_hidden_for_draft(self):
		btns = _visible_action_buttons({"docstatus": 0, "status": "Draft"})
		self.assertNotIn("Cancel Invoice", btns)
		self.assertNotIn("Return", btns)

	def test_cancel_and_return_hidden_after_cancelled(self):
		btns = _visible_action_buttons(
			{"docstatus": 2, "is_return": 0, "status": "Cancelled", "outstanding_amount": 0}
		)
		self.assertNotIn("Cancel Invoice", btns)
		self.assertNotIn("Return", btns)
		self.assertNotIn("Print Receipt", btns)
		self.assertNotIn("New Order", btns)
		self.assertEqual(btns, [])

	def test_cancel_hidden_without_permission(self):
		btns = _visible_action_buttons(
			{"docstatus": 1, "is_return": 0, "status": "Paid", "outstanding_amount": 0},
			can_cancel_perm=False,
		)
		self.assertIn("Return", btns)
		self.assertNotIn("Cancel Invoice", btns)

	def test_cancel_available_on_submitted_return(self):
		btns = _visible_action_buttons(
			{"docstatus": 1, "is_return": 1, "status": "Return", "outstanding_amount": 0}
		)
		self.assertIn("Cancel Invoice", btns)
		self.assertNotIn("Return", btns)
		self.assertNotIn("Print Receipt", btns)
		self.assertNotIn("New Order", btns)


if __name__ == "__main__":
	unittest.main()
