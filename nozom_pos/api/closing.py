# Copyright (c) 2026, NOZOM and contributors
# License: MIT

"""NOZOM POS Close Period helpers.

Wraps ERPNext POS Closing Entry / Opening Entry logic.

Critical lifecycle (matches Desk form):
  1. insert Closing Entry (draft) and commit
  2. submit (triggers consolidate_pos_invoices)
  3. on consolidate failure, Closing Entry still exists so Failed status/comment works

Doing insert+submit in one uncommitted transaction caused:
  consolidate failure → frappe.db.rollback() → Closing Entry gone →
  set_status("Failed") → Comment.reference_name link fails with
  "Could not find Reference Name: POS-CLO-…"
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import cint, flt, get_datetime, now_datetime

from erpnext.accounts.doctype.pos_closing_entry.pos_closing_entry import (
	get_invoices,
	get_payments,
	get_taxes,
)

DENOMS = [1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.5]


def _mop_types(modes: list[str]) -> dict[str, str]:
	if not modes:
		return {}
	rows = frappe.get_all(
		"Mode of Payment",
		filters={"name": ["in", modes]},
		fields=["name", "type"],
	)
	return {r.name: r.type or "General" for r in rows}


def cint_is_return(row) -> bool:
	return bool(cint(row.get("is_return") or 0))


def _invoice_payment_stats(invoice_names: list[str]) -> dict:
	stats = {"invoice_count": 0, "paid": 0, "partially_paid": 0, "unpaid": 0, "returns": 0}
	if not invoice_names:
		return stats

	for doctype in ("POS Invoice", "Sales Invoice"):
		rows = frappe.get_all(
			doctype,
			filters={"name": ["in", invoice_names]},
			fields=[
				"name",
				"grand_total",
				"rounded_total",
				"paid_amount",
				"outstanding_amount",
				"is_return",
			],
		)
		for r in rows:
			stats["invoice_count"] += 1
			if cint_is_return(r):
				stats["returns"] += 1
			outstanding = flt(r.outstanding_amount)
			paid = flt(r.paid_amount)
			total = flt(r.rounded_total) or flt(r.grand_total)
			if outstanding <= 0.0001 and paid + 0.0001 >= abs(total):
				stats["paid"] += 1
			elif paid <= 0.0001:
				stats["unpaid"] += 1
			else:
				stats["partially_paid"] += 1
	return stats


def _build_payment_rows(opening, invoice_payments: list) -> list[dict]:
	pay_map: dict[str, dict] = {}

	for d in opening.balance_details or []:
		mode = d.mode_of_payment
		if not mode:
			continue
		opening_amt = flt(d.opening_amount)
		pay_map[mode] = {
			"mode_of_payment": mode,
			"opening_amount": opening_amt,
			"expected_amount": opening_amt,
			"closing_amount": opening_amt,
			"difference": 0.0,
			"sales_amount": 0.0,
		}

	for p in invoice_payments or []:
		mode = p.get("mode_of_payment")
		if not mode:
			continue
		amt = flt(p.get("amount"))
		if mode in pay_map:
			pay_map[mode]["expected_amount"] = flt(pay_map[mode]["expected_amount"]) + amt
			pay_map[mode]["sales_amount"] = flt(pay_map[mode].get("sales_amount")) + amt
			pay_map[mode]["closing_amount"] = flt(pay_map[mode]["expected_amount"])
		else:
			pay_map[mode] = {
				"mode_of_payment": mode,
				"opening_amount": 0.0,
				"expected_amount": amt,
				"closing_amount": amt,
				"difference": 0.0,
				"sales_amount": amt,
			}

	types = _mop_types(list(pay_map.keys()))
	rows = []
	for mode, row in pay_map.items():
		row["type"] = types.get(mode, "General")
		row["difference"] = flt(row["closing_amount"]) - flt(row["expected_amount"])
		rows.append(row)
	return rows


def _sales_summary(invoices: list) -> dict:
	gross = 0.0
	returns = 0.0
	net_total = 0.0
	grand_total = 0.0
	taxes = 0.0
	qty = 0.0
	discount = 0.0

	names = [d.get("name") for d in invoices if d.get("name")]
	extra = {}
	if names:
		for doctype in ("POS Invoice", "Sales Invoice"):
			for r in frappe.get_all(
				doctype,
				filters={"name": ["in", names]},
				fields=["name", "discount_amount"],
			):
				extra[r.name] = r

	for d in invoices:
		gt = flt(d.get("grand_total"))
		nt = flt(d.get("net_total"))
		tq = flt(d.get("total_qty"))
		tt = flt(d.get("total_taxes_and_charges"))
		is_ret = bool(cint(d.get("is_return") or 0))
		grand_total += gt
		net_total += nt
		qty += tq
		taxes += tt
		if is_ret:
			returns += abs(gt)
		else:
			gross += gt
		ex = extra.get(d.get("name"))
		if ex:
			discount += flt(ex.discount_amount)

	paid_amount = 0.0
	outstanding = 0.0
	if names:
		for doctype in ("POS Invoice", "Sales Invoice"):
			for r in frappe.get_all(
				doctype,
				filters={"name": ["in", names]},
				fields=["paid_amount", "outstanding_amount"],
			):
				paid_amount += flt(r.paid_amount)
				outstanding += flt(r.outstanding_amount)

	return {
		"gross_sales": gross,
		"returns": returns,
		"discount": discount,
		"net_sales": net_total,
		"taxes": taxes,
		"grand_total": grand_total,
		"total_quantity": qty,
		"paid": paid_amount,
		"outstanding": outstanding,
	}


def _fetch_pos_invoice_row(name: str) -> dict | None:
	row = frappe.db.get_value(
		"POS Invoice",
		name,
		[
			"name",
			"customer",
			"posting_date",
			"posting_time",
			"grand_total",
			"net_total",
			"total_qty",
			"total_taxes_and_charges",
			"change_amount",
			"account_for_change_amount",
			"is_return",
			"return_against",
			"status",
			"docstatus",
			"consolidated_invoice",
		],
		as_dict=True,
	)
	if not row or cint(row.docstatus) != 1:
		return None
	if row.get("consolidated_invoice") or row.get("status") == "Consolidated":
		return None
	row["doctype"] = "POS Invoice"
	return row


def _expand_return_against(invoices: list) -> list:
	"""ERPNext requires original invoice of a return to be consolidated with/before it."""
	by_name = {d.name: d for d in invoices}
	changed = True
	while changed:
		changed = False
		for inv in list(by_name.values()):
			if not cint(inv.get("is_return")) or not inv.get("return_against"):
				continue
			ra = inv.return_against
			if ra in by_name:
				continue
			fetched = _fetch_pos_invoice_row(ra)
			if not fetched:
				# Already consolidated (or missing) — merge log allows that case
				continue
			by_name[ra] = fetched
			changed = True
	return list(by_name.values())


def _denom_key(value) -> float:
	"""Map a raw denomination to a canonical DENOMS value (supports 0.50)."""
	n = flt(value)
	for d in DENOMS:
		if abs(n - flt(d)) < 0.0001:
			return d
	return n


def _normalize_denoms(raw) -> list[dict]:
	if isinstance(raw, str):
		raw = json.loads(raw or "[]")
	raw = raw or []
	by_denom = {}
	for r in raw:
		if not r:
			continue
		key = _denom_key(r.get("denomination"))
		by_denom[key] = cint(r.get("qty"))
	rows = []
	total = 0.0
	for d in DENOMS:
		qty = cint(by_denom.get(d) or 0)
		if qty < 0:
			frappe.throw(_("Cash count quantity cannot be negative."))
		amount = flt(flt(d) * qty, 2)
		total = flt(total + amount, 2)
		rows.append({"denomination": d, "qty": qty, "amount": amount})
	return rows, total


def _prepare_closing_doc(
	opening_name: str,
	closing_amounts: dict | None = None,
	period_end=None,
	cash_denominations=None,
):
	opening = frappe.get_doc("POS Opening Entry", opening_name)
	if opening.docstatus != 1 or opening.status != "Open":
		frappe.throw(_("Selected POS Opening Entry should be open."), title=_("Invalid Opening Entry"))

	period_end = get_datetime(period_end) if period_end else now_datetime()
	data = get_invoices(
		opening.period_start_date,
		period_end,
		opening.pos_profile,
		opening.user,
	)

	invoices = _expand_return_against(list(data.get("invoices") or []))
	# Recompute payments/taxes after expanding return originals
	payments = get_payments(invoices)
	taxes_data = get_taxes(invoices)

	closing = frappe.new_doc("POS Closing Entry")
	closing.pos_opening_entry = opening.name
	closing.period_start_date = opening.period_start_date
	closing.period_end_date = period_end
	closing.pos_profile = opening.pos_profile
	closing.user = opening.user
	closing.company = opening.company
	closing.posting_date = frappe.utils.nowdate()
	closing.posting_time = frappe.utils.nowtime()
	closing.grand_total = 0
	closing.net_total = 0
	closing.total_quantity = 0
	closing.total_taxes_and_charges = 0

	pos_invoices = []
	sales_invoices = []
	for d in invoices:
		invoice_data = {
			"posting_date": d.posting_date,
			"grand_total": d.grand_total,
			"customer": d.customer,
			"is_return": d.is_return,
			"return_against": d.return_against,
		}
		if d.doctype == "POS Invoice":
			invoice_data["pos_invoice"] = d.name
			pos_invoices.append(invoice_data)
		else:
			invoice_data["sales_invoice"] = d.name
			sales_invoices.append(invoice_data)

		closing.grand_total += flt(d.grand_total)
		closing.net_total += flt(d.net_total)
		closing.total_quantity += flt(d.total_qty)
		closing.total_taxes_and_charges += flt(d.total_taxes_and_charges)

	payment_rows = _build_payment_rows(opening, payments)
	closing_amounts = closing_amounts or {}

	# Apply cash actual from denomination total across Cash MOPs if provided
	denom_rows, denom_total = _normalize_denoms(cash_denominations)
	cash_modes = [r["mode_of_payment"] for r in payment_rows if r.get("type") == "Cash"]
	if denom_rows and cash_modes and "Cash" not in closing_amounts:
		# Put full counted cash on primary cash mop (first cash mode)
		primary = cash_modes[0]
		closing_amounts[primary] = denom_total
		for extra in cash_modes[1:]:
			closing_amounts.setdefault(extra, flt(next(r for r in payment_rows if r["mode_of_payment"] == extra)["expected_amount"]))

	for row in payment_rows:
		mode = row["mode_of_payment"]
		if mode in closing_amounts:
			row["closing_amount"] = flt(closing_amounts[mode])
		else:
			row["closing_amount"] = flt(row["expected_amount"])
		row["difference"] = flt(row["closing_amount"]) - flt(row["expected_amount"])

	taxes = [{"account_head": tx.account_head, "amount": tx.tax_amount} for tx in (taxes_data or [])]

	closing.set("pos_invoices", pos_invoices)
	closing.set("sales_invoices", sales_invoices)
	closing.set(
		"payment_reconciliation",
		[
			{
				"mode_of_payment": r["mode_of_payment"],
				"opening_amount": r["opening_amount"],
				"expected_amount": r["expected_amount"],
				"closing_amount": r["closing_amount"],
				"difference": r["difference"],
			}
			for r in payment_rows
		],
	)
	closing.set("taxes", taxes)

	# Persist denomination breakdown for reprint (custom field)
	if hasattr(closing, "nozom_cash_denomination_json") or frappe.get_meta("POS Closing Entry").has_field(
		"nozom_cash_denomination_json"
	):
		closing.nozom_cash_denomination_json = json.dumps(
			{"denominations": denom_rows, "total": denom_total},
			ensure_ascii=False,
		)

	data = {"invoices": invoices, "payments": payments, "taxes": taxes_data}
	return closing, opening, data, payment_rows, denom_rows, denom_total


@frappe.whitelist()
def get_closing_preview(pos_opening_entry: str):
	frappe.has_permission("POS Closing Entry", "create", throw=True)

	closing, opening, data, payment_rows, _denoms, _denom_total = _prepare_closing_doc(pos_opening_entry)
	invoices = data.get("invoices") or []
	names = [d.name for d in invoices]
	stats = _invoice_payment_stats(names)
	sales = _sales_summary(invoices)
	currency = frappe.get_cached_value("Company", opening.company, "default_currency")

	cash_rows = [r for r in payment_rows if r.get("type") == "Cash"]
	cash_opening = sum(flt(r["opening_amount"]) for r in cash_rows)
	cash_sales = sum(flt(r.get("sales_amount") or 0) for r in cash_rows)
	cash_expected = sum(flt(r["expected_amount"]) for r in cash_rows)

	return {
		"opening": {
			"name": opening.name,
			"company": opening.company,
			"pos_profile": opening.pos_profile,
			"user": opening.user,
			"period_start_date": opening.period_start_date,
			"posting_date": opening.posting_date,
			"status": opening.status,
		},
		"period_end_date": closing.period_end_date,
		"currency": currency,
		"sales": sales,
		"payments": payment_rows,
		"cash": {
			"opening_cash": cash_opening,
			"cash_sales": cash_sales,
			"expected_cash": cash_expected,
			"modes": [r["mode_of_payment"] for r in cash_rows],
		},
		"denominations": DENOMS,
		"stats": stats,
		"invoice_count": len(invoices),
		"grand_total": flt(closing.grand_total),
		"net_total": flt(closing.net_total),
		"total_quantity": flt(closing.total_quantity),
		"total_taxes_and_charges": flt(closing.total_taxes_and_charges),
	}


@frappe.whitelist()
def submit_closing_entry(
	pos_opening_entry: str,
	payment_reconciliation=None,
	period_end_date=None,
	cash_denominations=None,
):
	"""Create + submit POS Closing Entry using Desk-equivalent lifecycle."""
	frappe.has_permission("POS Closing Entry", "create", throw=True)
	frappe.has_permission("POS Closing Entry", "submit", throw=True)

	if isinstance(payment_reconciliation, str):
		payment_reconciliation = json.loads(payment_reconciliation or "[]")
	if isinstance(cash_denominations, str):
		cash_denominations = json.loads(cash_denominations or "[]")

	closing_amounts = {}
	for row in payment_reconciliation or []:
		mode = row.get("mode_of_payment")
		if mode:
			closing_amounts[mode] = flt(row.get("closing_amount"))

	closing, opening, _data, payment_rows, denom_rows, denom_total = _prepare_closing_doc(
		pos_opening_entry,
		closing_amounts=closing_amounts,
		period_end=period_end_date,
		cash_denominations=cash_denominations,
	)

	# Step 1 — save draft and COMMIT (required so Failed-status comments can link)
	closing.insert()
	frappe.db.commit()

	try:
		closing.reload()
		closing.submit()
	except Exception as e:
		# consolidate_pos_invoices already rolls back the failed merge, sets
		# Closing Entry status=Failed, commits, then re-raises. Surface that error.
		frappe.db.rollback()
		err_msg = str(e)
		try:
			closing.reload()
			err_msg = (closing.error_message or "").strip() or err_msg
			if closing.docstatus == 0 and closing.status != "Failed":
				closing.db_set("status", "Failed", update_modified=False)
			if not closing.error_message:
				closing.db_set("error_message", str(err_msg)[:1400], update_modified=False)
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
		frappe.throw(
			err_msg or _("Could not close POS period."),
			title=_("POS Closing Failed"),
		)

	closing.reload()

	cash_diff = sum(flt(r["difference"]) for r in payment_rows if r.get("type") == "Cash")

	return {
		"name": closing.name,
		"status": closing.status,
		"docstatus": closing.docstatus,
		"pos_opening_entry": opening.name,
		"pos_profile": closing.pos_profile,
		"company": closing.company,
		"user": closing.user,
		"period_start_date": closing.period_start_date,
		"period_end_date": closing.period_end_date,
		"grand_total": flt(closing.grand_total),
		"net_total": flt(closing.net_total),
		"total_quantity": flt(closing.total_quantity),
		"payments": payment_rows,
		"cash_difference": cash_diff,
		"cash_denominations": denom_rows,
		"actual_cash": denom_total,
		"error_message": closing.error_message,
	}


@frappe.whitelist()
def get_closing_report_data(closing_entry: str):
	"""Load saved closing + denomination breakdown for reprint."""
	frappe.has_permission("POS Closing Entry", "read", throw=True)
	doc = frappe.get_doc("POS Closing Entry", closing_entry)
	denoms = []
	actual = 0.0
	raw = getattr(doc, "nozom_cash_denomination_json", None) or ""
	if raw:
		try:
			parsed = json.loads(raw)
			denoms = parsed.get("denominations") or []
			actual = flt(parsed.get("total"))
		except Exception:
			denoms = []

	currency = frappe.get_cached_value("Company", doc.company, "default_currency")
	payments = []
	for r in doc.payment_reconciliation or []:
		payments.append(
			{
				"mode_of_payment": r.mode_of_payment,
				"opening_amount": flt(r.opening_amount),
				"expected_amount": flt(r.expected_amount),
				"closing_amount": flt(r.closing_amount),
				"difference": flt(r.difference),
			}
		)

	cash_expected = sum(
		flt(r.expected_amount)
		for r in (doc.payment_reconciliation or [])
		if frappe.db.get_value("Mode of Payment", r.mode_of_payment, "type") == "Cash"
	)
	cash_opening = sum(
		flt(r.opening_amount)
		for r in (doc.payment_reconciliation or [])
		if frappe.db.get_value("Mode of Payment", r.mode_of_payment, "type") == "Cash"
	)
	if not actual:
		actual = sum(
			flt(r.closing_amount)
			for r in (doc.payment_reconciliation or [])
			if frappe.db.get_value("Mode of Payment", r.mode_of_payment, "type") == "Cash"
		)

	return {
		"name": doc.name,
		"company": doc.company,
		"pos_profile": doc.pos_profile,
		"user": doc.user,
		"pos_opening_entry": doc.pos_opening_entry,
		"period_start_date": doc.period_start_date,
		"period_end_date": doc.period_end_date,
		"grand_total": flt(doc.grand_total),
		"net_total": flt(doc.net_total),
		"total_quantity": flt(doc.total_quantity),
		"invoice_count": len(doc.pos_invoices or []) + len(doc.sales_invoices or []),
		"payments": payments,
		"denominations": denoms,
		"cash": {
			"opening_cash": cash_opening,
			"expected_cash": cash_expected,
			"actual_cash": actual,
			"difference": flt(actual) - flt(cash_expected),
		},
		"currency": currency,
		"status": doc.status,
	}


@frappe.whitelist()
def get_opening_defaults(pos_profile: str | None = None, company: str | None = None):
	frappe.has_permission("POS Opening Entry", "create", throw=True)

	company = company or frappe.defaults.get_user_default("company") or frappe.db.get_single_value(
		"Global Defaults", "default_company"
	)
	pos_profile = pos_profile or frappe.db.get_value(
		"POS Profile", {"company": company, "disabled": 0}, "name"
	)

	payments = []
	currency = None
	if pos_profile:
		profile = frappe.get_cached_doc("POS Profile", pos_profile)
		company = profile.company or company
		currency = frappe.get_cached_value("Company", company, "default_currency") if company else None
		for pay in profile.payments or []:
			payments.append(
				{
					"mode_of_payment": pay.mode_of_payment,
					"opening_amount": 0,
					"type": frappe.db.get_value("Mode of Payment", pay.mode_of_payment, "type")
					or "General",
				}
			)

	existing = frappe.get_all(
		"POS Opening Entry",
		filters={
			"user": frappe.session.user,
			"pos_closing_entry": ["in", ["", None]],
			"docstatus": 1,
			"status": "Open",
		},
		fields=["name", "pos_profile", "company"],
		limit=1,
	)

	return {
		"company": company,
		"pos_profile": pos_profile,
		"user": frappe.session.user,
		"posting_date": frappe.utils.nowdate(),
		"posting_time": frappe.utils.nowtime(),
		"period_start_date": frappe.utils.now_datetime(),
		"currency": currency,
		"payments": payments,
		"denominations": DENOMS,
		"existing_open": existing[0] if existing else None,
	}


@frappe.whitelist()
def submit_opening_entry(
	pos_profile: str,
	company: str,
	balance_details=None,
	cash_denominations=None,
	idempotency_key: str | None = None,
):
	"""Create + submit POS Opening Entry (Desk-equivalent) with NOZOM cash count."""
	frappe.has_permission("POS Opening Entry", "create", throw=True)
	frappe.has_permission("POS Opening Entry", "submit", throw=True)

	if not pos_profile or not company:
		frappe.throw(_("Company and POS Profile are required."))

	if isinstance(balance_details, str):
		balance_details = json.loads(balance_details or "[]")
	if isinstance(cash_denominations, str):
		cash_denominations = json.loads(cash_denominations or "[]")

	idempotency_key = (idempotency_key or "").strip()
	if idempotency_key and frappe.get_meta("POS Opening Entry").has_field("nozom_opening_idempotency_key"):
		existing = frappe.db.exists(
			"POS Opening Entry",
			{"nozom_opening_idempotency_key": idempotency_key, "docstatus": ["<", 2]},
		)
		if existing:
			return frappe.get_doc("POS Opening Entry", existing).as_dict()

	# Block duplicate active openings for this user
	open_rows = frappe.get_all(
		"POS Opening Entry",
		filters={
			"user": frappe.session.user,
			"pos_closing_entry": ["in", ["", None]],
			"docstatus": 1,
			"status": "Open",
		},
		pluck="name",
		limit=1,
	)
	if open_rows:
		frappe.throw(
			_("POS Opening Entry {0} is already open. Close it before opening a new period.").format(
				open_rows[0]
			)
		)

	denom_rows, denom_total = _normalize_denoms(cash_denominations)

	# Build payment balances — Cash MOP opening = denomination total
	payments = list(balance_details or [])
	if not payments:
		profile = frappe.get_cached_doc("POS Profile", pos_profile)
		for pay in profile.payments or []:
			payments.append({"mode_of_payment": pay.mode_of_payment, "opening_amount": 0})

	mop_types = _mop_types([p.get("mode_of_payment") for p in payments if p.get("mode_of_payment")])
	cash_modes = [m for m, t in mop_types.items() if t == "Cash"]
	primary_cash = cash_modes[0] if cash_modes else None

	normalized = []
	seen = set()
	for row in payments:
		mode = row.get("mode_of_payment")
		if not mode or mode in seen:
			continue
		seen.add(mode)
		opening_amt = flt(row.get("opening_amount"))
		if primary_cash and mode == primary_cash:
			opening_amt = denom_total
		elif mop_types.get(mode) == "Cash" and mode != primary_cash:
			opening_amt = flt(row.get("opening_amount") or 0)
		normalized.append({"mode_of_payment": mode, "opening_amount": opening_amt})

	if not normalized:
		frappe.throw(_("Please add Mode of payments and opening balance details."))

	doc = frappe.get_doc(
		{
			"doctype": "POS Opening Entry",
			"period_start_date": frappe.utils.now_datetime(),
			"posting_date": frappe.utils.getdate(),
			"user": frappe.session.user,
			"pos_profile": pos_profile,
			"company": company,
		}
	)
	doc.set("balance_details", normalized)

	if frappe.get_meta("POS Opening Entry").has_field("nozom_cash_denomination_json"):
		doc.nozom_cash_denomination_json = json.dumps(
			{"denominations": denom_rows, "total": denom_total},
			ensure_ascii=False,
		)
	if idempotency_key and frappe.get_meta("POS Opening Entry").has_field("nozom_opening_idempotency_key"):
		doc.nozom_opening_idempotency_key = idempotency_key

	doc.insert()
	doc.submit()

	return doc.as_dict()
