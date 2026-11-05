# Copyright (c) 2026, NOZOM and contributors
# License: MIT

"""NOZOM Print method resolution, fail-closed entitlements, and permit binding."""

from __future__ import annotations

import time
import unittest
from unittest.mock import patch

import frappe

from nozom_pos.printing.contract import (
	JOB_TYPE_KITCHEN,
	JOB_TYPE_RECEIPT,
	JOB_TYPE_RETURN,
	STATUS_QUEUED,
	STATUS_SENT,
	build_print_job,
	resolve_job_type,
	store_job,
	update_job_status,
)
from nozom_pos.printing.entitlement import (
	check_nozom_print_entitlement,
	customer_dashboard_billing_url,
	entitlement_service_configured,
)
from nozom_pos.printing.methods import (
	METHOD_BROWSER,
	METHOD_NOZOM_PRINT,
	METHOD_WINDOWS,
	normalize_printing_method,
	resolve_printing_method,
)
from nozom_pos.printing.permit import issue_print_permit, verify_print_permit


class PrintingMethodTests(unittest.TestCase):
	def test_blank_defaults_to_browser(self):
		self.assertEqual(normalize_printing_method(""), METHOD_BROWSER)
		self.assertEqual(normalize_printing_method(None), METHOD_BROWSER)
		self.assertEqual(resolve_printing_method({}), METHOD_BROWSER)

	def test_aliases(self):
		self.assertEqual(normalize_printing_method("windows"), METHOD_WINDOWS)
		self.assertEqual(normalize_printing_method("NOZOM Print"), METHOD_NOZOM_PRINT)

	def test_unknown_falls_back_to_browser(self):
		self.assertEqual(normalize_printing_method("laserjet-magic"), METHOD_BROWSER)

	def test_never_auto_nozom_from_blank_profile(self):
		self.assertNotEqual(resolve_printing_method({"nozom_printing_method": ""}), METHOD_NOZOM_PRINT)


class EntitlementFailClosedTests(unittest.TestCase):
	def test_unconfigured_service_denies(self):
		with patch(
			"nozom_pos.printing.entitlement.entitlement_service_configured",
			return_value=False,
		):
			result = check_nozom_print_entitlement(site_id="x", pos_profile="POS")
			self.assertFalse(result.ok)
			self.assertEqual(result["code"], "ENTITLEMENT_SERVICE_UNAVAILABLE")
			self.assertTrue(result["renew_required"])
			self.assertIn("/dashboard/billing", result["billing_url"])

	def test_billing_url_uses_official_path(self):
		url = customer_dashboard_billing_url()
		self.assertTrue(url.endswith("/dashboard/billing"))
		self.assertNotIn("renew-print", url)

	def test_no_synthetic_grant_when_unconfigured(self):
		# Real site config typically has no Cloud entitlement URL yet.
		if entitlement_service_configured():
			self.skipTest("entitlement service configured on this site")
		result = check_nozom_print_entitlement()
		self.assertFalse(result.ok)


class PermitAndContractTests(unittest.TestCase):
	def test_job_types(self):
		self.assertEqual(resolve_job_type(is_return=False, kitchen=False), JOB_TYPE_RECEIPT)
		self.assertEqual(resolve_job_type(is_return=True, kitchen=False), JOB_TYPE_RETURN)
		self.assertEqual(resolve_job_type(is_return=False, kitchen=True), JOB_TYPE_KITCHEN)

	def test_permit_roundtrip(self):
		frappe.conf.nozom_print_signing_secret = "test-secret-for-nozom-print-unit"
		job = build_print_job(
			doctype="POS Invoice",
			docname="POS-TEST-1",
			job_type=JOB_TYPE_RECEIPT,
			device_id="device-1",
			pos_profile="POS",
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
		ok, reason = verify_print_permit(permit, job=job)
		self.assertTrue(ok, reason)
		self.assertEqual(job["status"], STATUS_QUEUED)
		self.assertFalse(job["paper_confirmed"])

		store_job(job)
		updated = update_job_status(job["job_id"], STATUS_SENT)
		self.assertEqual(updated["status"], STATUS_SENT)
		self.assertFalse(updated["paper_confirmed"])

	def test_expired_permit_rejected(self):
		frappe.conf.nozom_print_signing_secret = "test-secret-for-nozom-print-unit"
		job = build_print_job(
			doctype="POS Invoice",
			docname="POS-TEST-2",
			job_type=JOB_TYPE_RECEIPT,
			device_id="device-2",
		)
		permit = issue_print_permit(
			site_id=job["site_id"],
			device_id=job["device_id"],
			job_id=job["job_id"],
			job_type=job["job_type"],
			doctype=job["doctype"],
			docname=job["docname"],
			ttl_seconds=1,
		)
		permit["claims"]["exp"] = int(time.time()) - 5
		# Re-sign with expired claim so signature matches claims but exp is past.
		from nozom_pos.printing import permit as permit_mod

		permit["signature"] = __import__("hmac").new(
			permit_mod._signing_secret(),
			permit_mod._canonical_payload(permit["claims"]),
			__import__("hashlib").sha256,
		).hexdigest()
		ok, reason = verify_print_permit(permit, job=job)
		self.assertFalse(ok)
		self.assertEqual(reason, "expired")


class AssertPrintableTests(unittest.TestCase):
	def test_missing_document_blocked(self):
		from nozom_pos.printing.contract import assert_document_printable

		with self.assertRaises(Exception):
			assert_document_printable("POS Invoice", "NOZOM-PRINT-DOES-NOT-EXIST")


if __name__ == "__main__":
	unittest.main()
