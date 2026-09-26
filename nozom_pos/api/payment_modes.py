"""POS Profile payment modes with company Mode of Payment accounts."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, cstr


def _resolve_mop_account(mode_of_payment: str, company: str) -> dict:
	"""Resolve Cash/Bank account for a Mode of Payment + company.

	Uses Mode of Payment Account.default_account — same source as ERPNext
	get_bank_cash_account / get_mode_of_payments_info.
	"""
	if not mode_of_payment or not company:
		return {"account": "", "type": "", "missing_account": True}

	row = frappe.db.sql(
		"""
		select
			mpa.default_account as account,
			mp.type as type,
			mp.enabled
		from `tabMode of Payment Account` mpa
		inner join `tabMode of Payment` mp on mp.name = mpa.parent
		where mpa.parent = %s and mpa.company = %s
		limit 1
		""",
		(mode_of_payment, company),
		as_dict=True,
	)
	if not row:
		mop_type = frappe.db.get_value("Mode of Payment", mode_of_payment, "type") or ""
		return {"account": "", "type": mop_type, "missing_account": True}

	info = row[0]
	account = cstr(info.get("account") or "").strip()
	return {
		"account": account,
		"type": cstr(info.get("type") or ""),
		"missing_account": not account,
		"enabled": cint(info.get("enabled")),
	}


@frappe.whitelist()
def get_profile_payment_modes(pos_profile: str, company: str | None = None):
	"""Return POS Profile payment methods enriched with company accounts.

	ERPNext get_pos_profile_data returns POS Payment Method rows without account.
	Cashiers need the Mode of Payment Account for the current company so Sales Invoice
	Payment.account is populated before client-side save / offline queue.
	"""
	if not pos_profile:
		frappe.throw(_("POS Profile is required."), frappe.ValidationError)

	profile = frappe.get_doc("POS Profile", pos_profile)
	company = company or profile.company
	if not company:
		frappe.throw(_("Company is required to resolve payment accounts."), frappe.ValidationError)

	payments = []
	missing = []
	for row in profile.get("payments") or []:
		mop = cstr(row.mode_of_payment or "").strip()
		if not mop:
			continue
		resolved = _resolve_mop_account(mop, company)
		entry = {
			"mode_of_payment": mop,
			"default": cint(row.default),
			"allow_in_returns": cint(getattr(row, "allow_in_returns", 0)),
			"account": resolved.get("account") or "",
			"type": resolved.get("type") or "",
			"missing_account": bool(resolved.get("missing_account")),
		}
		payments.append(entry)
		if entry["missing_account"]:
			missing.append(mop)

	return {
		"pos_profile": profile.name,
		"company": company,
		"modified": str(profile.modified),
		"payments": payments,
		"missing_accounts": missing,
	}


@frappe.whitelist()
def resolve_payment_account(mode_of_payment: str, company: str):
	"""Resolve a single Mode of Payment account for the company."""
	resolved = _resolve_mop_account(mode_of_payment, company)
	if resolved.get("missing_account"):
		frappe.throw(
			_("Please set default Cash or Bank account in Mode of Payment {0} for company {1}.").format(
				frappe.bold(mode_of_payment), frappe.bold(company)
			),
			title=_("Missing Account"),
			exc=frappe.ValidationError,
		)
	return resolved
