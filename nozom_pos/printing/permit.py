"""Short-lived signed print permits (server-side secrets only)."""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
from typing import Any

import frappe
from frappe import _
from frappe.utils import cstr


PERMIT_TTL_SECONDS = 120  # short-lived


def _signing_secret() -> bytes:
	"""Resolve HMAC secret from site config — never shipped to the browser."""
	secret = cstr(
		frappe.conf.get("nozom_print_signing_secret")
		or frappe.conf.get("encryption_key")
		or ""
	).strip()
	if not secret:
		frappe.throw(
			_("NOZOM Print signing secret is not configured on this site."),
			frappe.ValidationError,
		)
	return secret.encode("utf-8")


def _canonical_payload(data: dict[str, Any]) -> bytes:
	return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode(
		"utf-8"
	)


def issue_print_permit(
	*,
	site_id: str,
	device_id: str,
	job_id: str,
	job_type: str,
	doctype: str,
	docname: str,
	ttl_seconds: int = PERMIT_TTL_SECONDS,
) -> dict[str, Any]:
	"""Create a signed permit bound to site, device, and job."""
	now = int(time.time())
	expires_at = now + max(30, int(ttl_seconds or PERMIT_TTL_SECONDS))
	nonce = secrets.token_hex(8)
	claims = {
		"site_id": cstr(site_id),
		"device_id": cstr(device_id),
		"job_id": cstr(job_id),
		"job_type": cstr(job_type),
		"doctype": cstr(doctype),
		"docname": cstr(docname),
		"iat": now,
		"exp": expires_at,
		"nonce": nonce,
	}
	signature = hmac.new(
		_signing_secret(),
		_canonical_payload(claims),
		hashlib.sha256,
	).hexdigest()
	token = secrets.token_urlsafe(24)
	return {
		"token": token,
		"expires_at": expires_at,
		"issued_at": now,
		"claims": claims,
		"signature": signature,
		"alg": "HS256",
	}


def verify_print_permit(permit: dict[str, Any] | None, *, job: dict[str, Any]) -> tuple[bool, str]:
	"""Verify permit signature and binding. Used by local agent / future bridge."""
	if not isinstance(permit, dict):
		return False, "missing_permit"
	claims = permit.get("claims")
	signature = cstr(permit.get("signature") or "")
	if not isinstance(claims, dict) or not signature:
		return False, "invalid_permit"
	expected = hmac.new(
		_signing_secret(),
		_canonical_payload(claims),
		hashlib.sha256,
	).hexdigest()
	if not hmac.compare_digest(expected, signature):
		return False, "bad_signature"
	now = int(time.time())
	if int(claims.get("exp") or 0) < now:
		return False, "expired"
	for key in ("site_id", "device_id", "job_id", "job_type", "doctype", "docname"):
		if cstr(claims.get(key)) != cstr(job.get(key)):
			return False, f"claim_mismatch:{key}"
	return True, "ok"
