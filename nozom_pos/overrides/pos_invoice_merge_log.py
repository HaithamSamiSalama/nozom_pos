# Copyright (c) 2026, NOZOM and contributors
# License: MIT

"""NOZOM override for POS Invoice Merge Log.

ERPNext consolidates POS returns into Sales Invoice credit notes via map_doc,
which copies `update_stock` from the return POS Invoice.

If a return was created after POS Profile.update_stock changed (or after
NOZOM forced update_stock=1 on returns) while the original POS Invoice had
update_stock=0, credit-note submit fails with:

  'Update Stock' can not be checked because items are not delivered via {SI}

POS Invoices themselves do not post stock; stock is posted only on the
consolidated Sales Invoice. Aligning the credit note's update_stock to the
return_against Sales Invoice (or original POS Invoice) is the accounting-safe
fix and matches ERPNext's return validation.
"""

from __future__ import annotations

import frappe
from frappe.utils import cint, get_time, getdate

from erpnext.accounts.doctype.pos_invoice_merge_log.pos_invoice_merge_log import (
	POSInvoiceMergeLog as ERPNextPOSInvoiceMergeLog,
)


class POSInvoiceMergeLog(ERPNextPOSInvoiceMergeLog):
	def process_merging_into_credit_notes(self, data):
		credit_notes = {}
		for key, value in data.items():
			if not value:
				continue

			credit_note = self.get_new_sales_invoice()
			credit_note.is_return = 1

			credit_note = self.merge_pos_invoice_into(credit_note, value)
			credit_note.return_against = key

			credit_note.is_consolidated = 1
			credit_note.set_posting_time = 1
			credit_note.posting_date = getdate(self.posting_date)
			credit_note.posting_time = get_time(self.posting_time)

			credit_note.update_stock = self._credit_note_update_stock(key, value)

			credit_note.save()
			credit_note.submit()

			self.consolidated_credit_note = credit_note.name
			credit_notes[credit_note.name] = [d.name for d in value]

		return credit_notes

	def _credit_note_update_stock(self, return_against_si: str | None, return_pos_invoices: list) -> int:
		"""Match credit-note stock flag to the document being returned against."""
		if return_against_si:
			us = frappe.db.get_value("Sales Invoice", return_against_si, "update_stock")
			if us is not None:
				return cint(us)

		for pos in return_pos_invoices or []:
			ra = pos.get("return_against")
			if not ra:
				continue
			us = frappe.db.get_value("POS Invoice", ra, "update_stock")
			if us is not None:
				return cint(us)
		return 0
