"""Whitelisted API for NOZOM Print jobs and permits."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, cstr

from nozom_pos.printing.contract import (
	JOB_TYPE_KITCHEN,
	assert_document_printable,
	build_print_job,
	load_job,
	resolve_job_type,
	store_job,
	update_job_status,
)
from nozom_pos.printing.entitlement import (
	check_nozom_print_entitlement,
	customer_dashboard_billing_url,
)
from nozom_pos.printing.methods import (
	METHOD_BROWSER,
	METHOD_NOZOM_PRINT,
	resolve_printing_method,
)
from nozom_pos.printing.permit import issue_print_permit


def _pos_profile_method(pos_profile: str) -> str:
	if not pos_profile:
		return METHOD_BROWSER
	if not frappe.db.exists("POS Profile", pos_profile):
		return METHOD_BROWSER
	raw = frappe.db.get_value("POS Profile", pos_profile, "nozom_printing_method")
	return resolve_printing_method(raw_value=raw)


@frappe.whitelist()
def get_printing_method(pos_profile: str | None = None):
	"""Return the effective Printing Method for a POS Profile (Browser default)."""
	method = _pos_profile_method(cstr(pos_profile or ""))
	return {
		"printing_method": method,
		"billing_url": customer_dashboard_billing_url(),
	}


@frappe.whitelist()
def request_print_job(
	doctype: str,
	name: str,
	job_type: str | None = None,
	device_id: str | None = None,
	pos_profile: str | None = None,
	station: str | None = None,
	printer: str | None = None,
	print_format: str | None = None,
	letter_head: str | None = None,
	language: str | None = None,
	kitchen: int | None = None,
):
	"""Create a NOZOM Print job with a short-lived signed permit.

	Fails closed when entitlements are missing or the Cloud entitlement
	service is not configured. Does not submit or alter the invoice.
	"""
	doctype = cstr(doctype)
	name = cstr(name)
	pos_profile = cstr(pos_profile or "")
	device_id = cstr(device_id or "") or "web-client"

	method = _pos_profile_method(pos_profile)
	if method != METHOD_NOZOM_PRINT:
		frappe.throw(
			_(
				"This POS Profile is not set to NOZOM Print. "
				"Current method: {0}."
			).format(method),
			frappe.ValidationError,
		)

	doc = assert_document_printable(doctype, name)

	# Prefer explicit job_type; otherwise derive from document / kitchen flag.
	resolved_type = cstr(job_type or "").upper()
	if not resolved_type:
		resolved_type = resolve_job_type(
			is_return=bool(cint(doc.get("is_return"))),
			kitchen=bool(cint(kitchen)),
		)
	if resolved_type == JOB_TYPE_KITCHEN and kitchen is None:
		kitchen = 1

	entitlement = check_nozom_print_entitlement(
		site_id=frappe.local.site,
		pos_profile=pos_profile or cstr(doc.get("pos_profile") or ""),
		device_id=device_id,
	)
	if not entitlement.ok:
		return {
			"ok": False,
			"code": entitlement.get("code"),
			"message": entitlement.get("message"),
			"billing_url": entitlement.get("billing_url") or customer_dashboard_billing_url(),
			"renew_required": True,
			"job": None,
		}

	job = build_print_job(
		doctype=doctype,
		docname=name,
		job_type=resolved_type,
		device_id=device_id,
		pos_profile=pos_profile or cstr(doc.get("pos_profile") or ""),
		station=station,
		printer=printer,
		print_format=print_format or None,
		letter_head=letter_head or None,
		language=language or None,
		payload={
			"grand_total": doc.get("grand_total"),
			"rounded_total": doc.get("rounded_total"),
			"currency": doc.get("currency"),
			"customer": doc.get("customer"),
			"customer_name": doc.get("customer_name"),
			"is_return": cint(doc.get("is_return")),
			"nozom_order_number": doc.get("nozom_order_number"),
		},
	)
	permit = issue_print_permit(
		site_id=job["site_id"],
		device_id=job["device_id"],
		job_id=job["job_id"],
		job_type=job["job_type"],
		doctype=job["doctype"],
		docname=job["docname"],
	)
	job["permit"] = permit
	store_job(job)

	return {
		"ok": True,
		"code": "OK",
		"message": _("Print job queued."),
		"billing_url": customer_dashboard_billing_url(),
		"renew_required": False,
		"job": job,
		# Local bridge URL convention for NOZOM Print Windows agent.
		"agent_endpoint": cstr(
			frappe.conf.get("nozom_print_agent_endpoint") or "http://127.0.0.1:17355/print"
		),
	}


@frappe.whitelist()
def mark_print_job_status(job_id: str, status: str, error: str | None = None):
	"""Update QUEUED → SENT / FAILED. SENT is not paper confirmation."""
	job = update_job_status(cstr(job_id), cstr(status), error=error)
	return {"ok": True, "job": job}


@frappe.whitelist()
def get_print_job(job_id: str):
	job = load_job(cstr(job_id))
	if not job:
		frappe.throw(_("Print job {0} was not found.").format(job_id))
	return {"ok": True, "job": job}
