import frappe
from frappe import _
from frappe.utils import flt, getdate, nowdate

from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry
from erpnext.accounts.doctype.sales_invoice.sales_invoice import get_bank_cash_account


ALLOWED_DOCTYPES = ("POS Invoice", "Sales Invoice")


def _parse_payments(payments):
	if isinstance(payments, str):
		payments = frappe.parse_json(payments)

	if not isinstance(payments, list):
		frappe.throw(_("Invalid payments payload."))

	normalized = []
	for row in payments:
		mode = (row.get("mode_of_payment") or "").strip()
		amount = flt(row.get("amount"))
		if not mode or amount <= 0:
			continue
		normalized.append({"mode_of_payment": mode, "amount": amount})

	return normalized


def _invoice_total(doc):
	return flt(doc.rounded_total) or flt(doc.grand_total)


def _serialize_invoice(doc):
	return {
		"doctype": doc.doctype,
		"name": doc.name,
		"status": doc.status,
		"currency": doc.currency,
		"grand_total": flt(doc.grand_total),
		"rounded_total": flt(doc.rounded_total),
		"paid_amount": flt(doc.paid_amount),
		"outstanding_amount": flt(doc.outstanding_amount),
		"payments": [
			{
				"mode_of_payment": p.mode_of_payment,
				"amount": flt(p.amount),
			}
			for p in doc.get("payments") or []
			if flt(p.amount)
		],
	}


def _validate_invoice_for_collection(doc):
	if doc.docstatus != 1:
		frappe.throw(_("Only submitted invoices can receive payment."))

	if cint_is_return(doc):
		frappe.throw(_("Cannot collect payment against a return invoice."))

	if doc.get("status") == "Consolidated":
		frappe.throw(_("Create Payment Entry for Consolidated POS Invoices."))

	outstanding = flt(doc.outstanding_amount, doc.precision("outstanding_amount"))
	if outstanding <= 0:
		frappe.throw(_("This invoice has no outstanding amount."))

	return outstanding


def cint_is_return(doc):
	return int(doc.get("is_return") or 0)


def _validate_payment_total(payments, outstanding, precision):
	total = flt(sum(flt(p["amount"]) for p in payments), precision)
	if total <= 0:
		frappe.throw(_("Enter a payment amount greater than zero."))

	if total > outstanding:
		frappe.throw(
			_("Payment total ({0}) cannot exceed outstanding amount ({1}).").format(total, outstanding)
		)

	return total


@frappe.whitelist()
def get_invoice_payment_context(doctype, name, pos_profile=None):
	"""Fresh invoice payment snapshot for Past Orders collection UI."""
	if doctype not in ALLOWED_DOCTYPES:
		frappe.throw(_("Unsupported document type: {0}").format(doctype))

	frappe.has_permission(doctype, "read", throw=True)
	doc = frappe.get_doc(doctype, name)
	outstanding = flt(doc.outstanding_amount, doc.precision("outstanding_amount"))

	profile_name = doc.get("pos_profile") or pos_profile
	modes = []
	if profile_name and frappe.db.exists("POS Profile", profile_name):
		# Fresh profile — avoid stale get_cached_doc after admin adds new modes.
		profile = frappe.get_doc("POS Profile", profile_name)
		for row in profile.get("payments") or []:
			if row.mode_of_payment:
				modes.append({"mode_of_payment": row.mode_of_payment, "amount": 0})

	return {
		"invoice": _serialize_invoice(doc),
		"invoice_total": _invoice_total(doc),
		"outstanding_amount": outstanding,
		"can_collect": bool(
			doc.docstatus == 1
			and not cint_is_return(doc)
			and doc.get("status") != "Consolidated"
			and outstanding > 0
		),
		"modes_of_payment": modes,
	}


@frappe.whitelist()
def receive_invoice_payment(doctype, name, payments):
	"""
	Collect additional payment against a submitted POS/Sales Invoice.

	- POS Invoice: standard update_payments
	- Sales Invoice: standard Payment Entry allocation
	"""
	if doctype not in ALLOWED_DOCTYPES:
		frappe.throw(_("Unsupported document type: {0}").format(doctype))

	payments = _parse_payments(payments)
	if not payments:
		frappe.throw(_("Enter at least one payment amount."))

	# Always re-read from DB to avoid stale browser outstanding.
	doc = frappe.get_doc(doctype, name)
	outstanding = _validate_invoice_for_collection(doc)
	_validate_payment_total(payments, outstanding, doc.precision("outstanding_amount"))

	if doctype == "POS Invoice":
		_receive_pos_invoice_payment(doc, payments)
	else:
		_receive_sales_invoice_payment(doc, payments)

	doc = frappe.get_doc(doctype, name)
	return {
		"invoice": _serialize_invoice(doc),
		"message": _("Payment Successful"),
	}


def _receive_pos_invoice_payment(doc, payments):
	if not frappe.has_permission("POS Invoice", "write", doc=doc):
		frappe.throw(_("Not permitted to update payments on this POS Invoice."), frappe.PermissionError)

	# update_payments is the standard ERPNext mechanism for POS Invoice.
	doc.update_payments(payments=payments)


def _receive_sales_invoice_payment(doc, payments):
	if not frappe.has_permission("Payment Entry", "create"):
		frappe.throw(_("Not permitted to create Payment Entry."), frappe.PermissionError)

	if not frappe.has_permission("Payment Entry", "submit"):
		frappe.throw(_("Not permitted to submit Payment Entry."), frappe.PermissionError)

	remaining = flt(doc.outstanding_amount, doc.precision("outstanding_amount"))

	for row in payments:
		amount = flt(row["amount"])
		if amount <= 0 or remaining <= 0:
			continue

		amount = min(amount, remaining)
		account = get_bank_cash_account(row["mode_of_payment"], doc.company).get("account")

		pe = get_payment_entry(
			"Sales Invoice",
			doc.name,
			party_amount=amount,
			bank_account=account,
		)
		pe.mode_of_payment = row["mode_of_payment"]
		pe.paid_amount = amount
		pe.received_amount = amount
		pe.reference_no = pe.reference_no or doc.name
		pe.reference_date = pe.reference_date or getdate(nowdate())

		for ref in pe.get("references") or []:
			if ref.reference_doctype == "Sales Invoice" and ref.reference_name == doc.name:
				ref.allocated_amount = amount
				ref.outstanding_amount = remaining

		pe.setup_party_account_field()
		pe.set_missing_values()
		pe.set_exchange_rate(ref_doc=doc)
		pe.set_amounts()
		pe.insert()
		pe.submit()

		doc.reload()
		remaining = flt(doc.outstanding_amount, doc.precision("outstanding_amount"))
