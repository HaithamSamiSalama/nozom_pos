"""NOZOM Print entitlement checks via NOZOM Cloud (fail closed).

Does not invent or default-grant NOZOM Print. Browser / Windows printing do
not require this entitlement.
"""

from __future__ import annotations

import json
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest

import frappe
from frappe import _
from frappe.utils import cstr


class EntitlementResult(dict):
	@property
	def ok(self) -> bool:
		return bool(self.get("ok"))


def customer_dashboard_billing_url() -> str:
	"""Official customer billing path on NOZOM Cloud (do not invent renew pages)."""
	base = cstr(
		frappe.conf.get("nozom_cloud_public_url")
		or frappe.conf.get("nozom_cloud_url")
		or "https://nozom.cloud"
	).rstrip("/")
	return f"{base}/dashboard/billing"


def entitlement_service_configured() -> bool:
	url = cstr(frappe.conf.get("nozom_cloud_entitlement_url") or "").strip()
	token = cstr(frappe.conf.get("nozom_cloud_entitlement_token") or "").strip()
	return bool(url and token)


def _unavailable(reason: str) -> EntitlementResult:
	return EntitlementResult(
		ok=False,
		code="ENTITLEMENT_SERVICE_UNAVAILABLE",
		reason=reason,
		message=_(
			"NOZOM Print is not available: the central entitlement service is not configured or unreachable. "
			"Use Browser Printing or renew/configure entitlements from NOZOM Cloud."
		),
		billing_url=customer_dashboard_billing_url(),
		renew_required=True,
	)


def _denied(code: str, message: str) -> EntitlementResult:
	return EntitlementResult(
		ok=False,
		code=code,
		reason=code,
		message=message,
		billing_url=customer_dashboard_billing_url(),
		renew_required=True,
	)


def check_nozom_print_entitlement(
	*,
	site_id: str | None = None,
	pos_profile: str | None = None,
	device_id: str | None = None,
) -> EntitlementResult:
	"""Verify site subscription + NOZOM POS + NOZOM Print entitlements.

	Fail closed when the central API is missing or errors. Never returns a
	synthetic grant.
	"""
	if not entitlement_service_configured():
		return _unavailable("missing_nozom_cloud_entitlement_url_or_token")

	url = cstr(frappe.conf.get("nozom_cloud_entitlement_url")).strip()
	token = cstr(frappe.conf.get("nozom_cloud_entitlement_token")).strip()
	payload = {
		"service": "NOZOM_PRINT",
		"requires": ["SITE_SUBSCRIPTION", "NOZOM_POS", "NOZOM_PRINT"],
		"site_id": cstr(site_id or frappe.local.site),
		"pos_profile": cstr(pos_profile or ""),
		"device_id": cstr(device_id or ""),
	}

	try:
		body = json.dumps(payload).encode("utf-8")
		req = urlrequest.Request(
			url,
			data=body,
			method="POST",
			headers={
				"Content-Type": "application/json",
				"Accept": "application/json",
				"Authorization": f"Bearer {token}",
				"User-Agent": "NOZOM-POS-PrintEntitlement/1.0",
			},
		)
		timeout = float(frappe.conf.get("nozom_cloud_entitlement_timeout") or 8)
		with urlrequest.urlopen(req, timeout=max(2.0, timeout)) as resp:
			raw = resp.read().decode("utf-8", errors="replace")
			data = json.loads(raw) if raw else {}
	except urlerror.HTTPError as exc:
		frappe.log_error(
			title="NOZOM Print entitlement HTTP error",
			message=f"{exc.code}: {exc.reason}",
		)
		return _unavailable(f"http_{exc.code}")
	except Exception as exc:
		frappe.log_error(
			title="NOZOM Print entitlement failure",
			message=frappe.get_traceback() or cstr(exc),
		)
		return _unavailable(type(exc).__name__)

	if not isinstance(data, dict):
		return _unavailable("invalid_entitlement_response")

	if data.get("ok") is True or data.get("entitled") is True:
		return EntitlementResult(
			ok=True,
			code="OK",
			message=_("NOZOM Print entitlement verified."),
			billing_url=customer_dashboard_billing_url(),
			renew_required=False,
			details=data.get("details") or {},
		)

	code = cstr(data.get("code") or data.get("error") or "NOT_ENTITLED")
	message = cstr(
		data.get("message")
		or _(
			"NOZOM Print subscription or entitlement is not active. "
			"Renew from the NOZOM Cloud customer dashboard."
		)
	)
	return _denied(code, message)


def assert_nozom_print_entitled(**kwargs) -> EntitlementResult:
	result = check_nozom_print_entitlement(**kwargs)
	if not result.ok:
		# Soft return for API consumers — callers decide whether to throw.
		return result
	return result
