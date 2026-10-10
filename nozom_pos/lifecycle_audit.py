"""Read-only helpers for NOZOM POS install/uninstall lifecycle checks."""

from __future__ import annotations

from nozom_pos.setup import audit_owned_custom_field_inventory, expected_owned_custom_field_keys


def summarize_owned_custom_field_inventory():
	"""Human-readable summary for tests and support scripts."""
	report = audit_owned_custom_field_inventory()
	return {
		"expected_count": len(report["expected"]),
		"present_count": len(report["present"]),
		"missing": report["missing"],
		"present": report["present"],
		"expected": report["expected"],
	}


def assert_owned_fields_fully_installed():
	missing = audit_owned_custom_field_inventory()["missing"]
	if missing:
		raise AssertionError(f"Missing NOZOM POS owned custom fields: {', '.join(missing)}")


def assert_owned_fields_fully_removed():
	present = audit_owned_custom_field_inventory()["present"]
	if present:
		raise AssertionError(f"Unexpected NOZOM POS owned custom fields: {', '.join(present)}")


__all__ = [
	"assert_owned_fields_fully_installed",
	"assert_owned_fields_fully_removed",
	"expected_owned_custom_field_keys",
	"summarize_owned_custom_field_inventory",
]
