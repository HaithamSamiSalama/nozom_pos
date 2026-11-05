"""Unified NOZOM POS ↔ NOZOM Print job contract."""

from __future__ import annotations

import uuid
from typing import Any

import frappe
from frappe import _
from frappe.utils import cint, cstr, now_datetime

from nozom_pos.printing.methods import METHOD_NOZOM_PRINT

JOB_TYPE_RECEIPT = "RECEIPT"
JOB_TYPE_RETURN = "RETURN"
JOB_TYPE_KITCHEN = "KITCHEN"
ALLOWED_JOB_TYPES = frozenset({JOB_TYPE_RECEIPT, JOB_TYPE_RETURN, JOB_TYPE_KITCHEN})

STATUS_QUEUED = "QUEUED"
STATUS_SENT = "SENT"
STATUS_FAILED = "FAILED"
ALLOWED_STATUSES = frozenset({STATUS_QUEUED, STATUS_SENT, STATUS_FAILED})

CACHE_PREFIX = "nozom_print_job::"


def new_job_id() -> str:
	return str(uuid.uuid4())


def resolve_job_type(*, is_return: bool = False, kitchen: bool = False) -> str:
	if kitchen:
		return JOB_TYPE_KITCHEN
	if is_return:
		return JOB_TYPE_RETURN
	return JOB_TYPE_RECEIPT


def assert_document_printable(doctype: str, name: str) -> dict[str, Any]:
	"""Ensure the document exists and is submitted. Never re-submit."""
	if not doctype or not name:
		frappe.throw(_("Document is required for printing."), frappe.ValidationError)
	if not frappe.db.exists(doctype, name):
		frappe.throw(_("Document {0} {1} was not found.").format(doctype, name))

	doc = frappe.get_doc(doctype, name)
	if cint(doc.get("docstatus")) != 1:
		frappe.throw(
			_(
				"Printing with NOZOM Print is allowed only after the invoice is submitted successfully."
			),
			frappe.ValidationError,
		)
	# Permission: user must be able to read/print the document.
	if not frappe.has_permission(doctype, "print", doc=doc) and not frappe.has_permission(
		doctype, "read", doc=doc
	):
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	return doc.as_dict()


def build_print_job(
	*,
	doctype: str,
	docname: str,
	job_type: str,
	device_id: str,
	pos_profile: str = "",
	station: str | None = None,
	printer: str | None = None,
	print_format: str | None = None,
	letter_head: str | None = None,
	language: str | None = None,
	payload: dict[str, Any] | None = None,
	permit: dict[str, Any] | None = None,
	status: str = STATUS_QUEUED,
) -> dict[str, Any]:
	job_type = cstr(job_type).upper()
	if job_type not in ALLOWED_JOB_TYPES:
		frappe.throw(_("Invalid print job type: {0}").format(job_type))

	status = cstr(status).upper() or STATUS_QUEUED
	if status not in ALLOWED_STATUSES:
		status = STATUS_QUEUED

	job_id = new_job_id()
	site_id = cstr(frappe.local.site)
	job = {
		"contract_version": 1,
		"printing_method": METHOD_NOZOM_PRINT,
		"site_id": site_id,
		"device_id": cstr(device_id or "unknown-device"),
		"job_id": job_id,
		"job_type": job_type,
		"doctype": cstr(doctype),
		"docname": cstr(docname),
		"pos_profile": cstr(pos_profile or ""),
		"station": cstr(station or "") or None,
		"printer": cstr(printer or "") or None,
		"print_format": cstr(print_format or "") or None,
		"letter_head": cstr(letter_head or "") or None,
		"language": cstr(language or "") or None,
		"payload": payload or {},
		"permit": permit,
		"status": status,
		# SENT means handed to the local agent — not proof that paper exited.
		"paper_confirmed": False,
		"created_at": str(now_datetime()),
		"updated_at": str(now_datetime()),
		"error": None,
	}
	return job


def store_job(job: dict[str, Any], *, ttl: int = 86400) -> None:
	frappe.cache().set_value(f"{CACHE_PREFIX}{job['job_id']}", job, expires_in_sec=ttl)


def load_job(job_id: str) -> dict[str, Any] | None:
	return frappe.cache().get_value(f"{CACHE_PREFIX}{cstr(job_id)}")


def update_job_status(job_id: str, status: str, *, error: str | None = None) -> dict[str, Any]:
	job = load_job(job_id)
	if not job:
		frappe.throw(_("Print job {0} was not found.").format(job_id))
	status = cstr(status).upper()
	if status not in ALLOWED_STATUSES:
		frappe.throw(_("Invalid print job status: {0}").format(status))
	job["status"] = status
	job["updated_at"] = str(now_datetime())
	job["error"] = cstr(error) if error else None
	# Never treat SENT as paper confirmation.
	if status == STATUS_SENT:
		job["paper_confirmed"] = False
	store_job(job)
	return job
