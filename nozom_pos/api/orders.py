import frappe
from frappe.utils import cint

from erpnext.selling.page.point_of_sale.point_of_sale import (
	add_doctype_to_results,
	get_invoice_filters,
	order_results_by_posting_date,
)


@frappe.whitelist()
def get_past_order_list(search_term=None, status=None, limit=20):
	"""
	Same behavior as ERPNext POS past-order list, with status=All support
	and Order Number (nozom_order_number) search.
	"""
	fields = [
		"name",
		"grand_total",
		"currency",
		"customer",
		"customer_name",
		"posting_time",
		"posting_date",
		"nozom_order_number",
		"paid_amount",
		"outstanding_amount",
		"status",
		"is_return",
		"docstatus",
	]
	limit = cint(limit) or 20
	search_term = search_term or ""
	status = status or "Draft"

	def _fetch(doctype, status_value=None, name=None, customer_like=None, order_number_like=None):
		filters = get_invoice_filters(doctype, status_value) if status_value and status_value != "All" else {}
		if status_value == "All":
			if doctype == "Sales Invoice":
				filters = {"is_created_using_pos": 1}
			else:
				filters = {}
		if name:
			filters["name"] = ["like", f"%{name}%"]
		if order_number_like:
			filters["nozom_order_number"] = ["like", f"%{order_number_like}%"]
		kwargs = {
			"filters": filters,
			"fields": fields,
			"page_length": limit,
		}
		if customer_like:
			kwargs["or_filters"] = {
				"customer_name": ["like", f"%{customer_like}%"],
				"customer": ["like", f"%{customer_like}%"],
			}
		try:
			return frappe.db.get_list(doctype, **kwargs)
		except Exception:
			# Field may not exist yet on older DBs — fall back without it
			safe_fields = [f for f in fields if f != "nozom_order_number"]
			kwargs["fields"] = safe_fields
			if order_number_like:
				kwargs["filters"].pop("nozom_order_number", None)
			return frappe.db.get_list(doctype, **kwargs)

	pos_invoice_list = []
	sales_invoice_list = []

	if search_term and status:
		pos_invoice_list = add_doctype_to_results(
			"POS Invoice",
			_fetch("POS Invoice", status, customer_like=search_term)
			+ _fetch("POS Invoice", status, name=search_term)
			+ _fetch("POS Invoice", status, order_number_like=search_term),
		)
		sales_invoice_list = add_doctype_to_results(
			"Sales Invoice",
			_fetch("Sales Invoice", status, customer_like=search_term)
			+ _fetch("Sales Invoice", status, name=search_term)
			+ _fetch("Sales Invoice", status, order_number_like=search_term),
		)
	elif status:
		pos_invoice_list = add_doctype_to_results("POS Invoice", _fetch("POS Invoice", status))
		sales_invoice_list = add_doctype_to_results("Sales Invoice", _fetch("Sales Invoice", status))

	# Deduplicate by doctype+name
	seen = set()
	merged = []
	for row in [*pos_invoice_list, *sales_invoice_list]:
		key = (row.get("doctype"), row.get("name"))
		if key in seen:
			continue
		seen.add(key)
		merged.append(row)

	invoice_list = order_results_by_posting_date(merged)
	return invoice_list[:limit]
