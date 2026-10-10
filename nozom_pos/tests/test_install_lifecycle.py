# Copyright (c) 2026, NOZOM and contributors
# License: MIT

"""Install, migrate, and uninstall structure for NOZOM POS.

Exercises the real site schema, then restores the app structure.
Does not delete invoices, customers, or accounting records.
"""

from __future__ import annotations

import unittest

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

from nozom_pos.install import before_uninstall, ensure_desktop_icon, setup_nozom_pos
from nozom_pos.lifecycle_audit import (
	assert_owned_fields_fully_installed,
	assert_owned_fields_fully_removed,
	summarize_owned_custom_field_inventory,
)
from nozom_pos.setup import (
	APP_NAME,
	LEGACY_FIELDS_NOT_REMOVED,
	custom_field_docname,
	delete_nozom_pos_custom_fields,
	expected_owned_custom_field_keys,
	owned_fieldnames,
)

PROBE_DT = "Customer"
PROBE_FIELD = "lifecycle_probe_shared"
NEW_FIELDS = (
	("POS Invoice", "nozom_fulfillment_method"),
	("Sales Invoice", "nozom_fulfillment_method"),
	("Address", "nozom_mobile_no"),
)


def _field_exists(dt, fieldname):
	return bool(frappe.db.exists("Custom Field", {"dt": dt, "fieldname": fieldname}))


def _icon_names():
	return frappe.get_all(
		"Desktop Icon",
		filters={"app": APP_NAME, "icon_type": "App"},
		pluck="name",
	)


def _remove_probe():
	name = frappe.db.get_value("Custom Field", {"dt": PROBE_DT, "fieldname": PROBE_FIELD}, "name")
	if name:
		frappe.delete_doc("Custom Field", name, force=True, ignore_permissions=True)


def _meta_loads(*doctypes):
	for dt in doctypes:
		frappe.get_meta(dt, cached=False)


class TestOwnedCustomFieldCatalog(unittest.TestCase):
	def test_catalog_matches_docnames(self):
		for key in expected_owned_custom_field_keys():
			dt, fieldname = key.split(".", 1)
			self.assertEqual(custom_field_docname(dt, fieldname), f"{dt}-{fieldname}")


class TestInstallLifecycle(unittest.TestCase):
	def test_install_uninstall_reinstall(self):
		frappe.set_user("Administrator")
		invoice_count = frappe.db.count("Sales Invoice")
		customer_count = frappe.db.count("Customer")
		failures = []

		def check(name, ok):
			failures.append((name, ok))
			self.assertTrue(ok, name)

		try:
			setup_nozom_pos()
			icons = _icon_names()
			check("A icon exists", len(icons) == 1 and icons[0] == "NOZOM POS")
			icon = frappe.get_doc("Desktop Icon", icons[0])
			check("A icon route", icon.link == "/desk/nozom-pos" and icon.app == APP_NAME)
			from nozom_pos.install import CHART_NAME, WORKSPACE_NAME

			check("A workspace", frappe.db.exists("Workspace", WORKSPACE_NAME) == WORKSPACE_NAME)
			check("A chart", frappe.db.exists("Dashboard Chart", CHART_NAME) == CHART_NAME)
			check("A sidebar", frappe.db.exists("Workspace Sidebar", WORKSPACE_NAME) == WORKSPACE_NAME)
			sidebar = frappe.get_doc("Workspace Sidebar", WORKSPACE_NAME)
			check(
				"A sidebar items",
				[row.label for row in sidebar.items]
				== [
					"Open NOZOM POS",
					"Sales Invoices",
					"POS Opening Entry",
					"POS Closing Entry",
					"POS Invoice",
					"POS Invoice Merge Log",
					"POS Profile",
				]
				and sidebar.app == APP_NAME,
			)
			open_shortcut = frappe.db.get_value(
				"Workspace Shortcut",
				{"parent": WORKSPACE_NAME, "label": "Open NOZOM POS"},
				["type", "url"],
				as_dict=True,
			)
			check(
				"A open shortcut",
				open_shortcut
				and open_shortcut.type == "URL"
				and open_shortcut.url == "/desk/point-of-sale",
			)

			summary = summarize_owned_custom_field_inventory()
			check("A owned fields", not summary["missing"])
			for dt, fieldname in NEW_FIELDS:
				check(f"A new field {dt}.{fieldname}", _field_exists(dt, fieldname))

			setup_nozom_pos()
			check("B one icon", len(_icon_names()) == 1)
			check("B one workspace", frappe.db.count("Workspace", {"name": "NOZOM POS", "module": "NOZOM POS"}) == 1)
			check("B one sidebar", frappe.db.count("Workspace Sidebar", {"name": "NOZOM POS", "app": APP_NAME}) == 1)
			check(
				"B one chart",
				frappe.db.count("Dashboard Chart", {"name": "Daily POS Sales", "module": "NOZOM POS"}) == 1,
			)
			duplicates = []
			for dt, fieldnames in owned_fieldnames().items():
				for fieldname in fieldnames:
					count = frappe.db.count("Custom Field", {"dt": dt, "fieldname": fieldname})
					if count != 1:
						duplicates.append(f"{dt}.{fieldname}={count}")
			check("B no duplicate fields", not duplicates)

			frappe.db.set_value("Desktop Icon", "NOZOM POS", "standard", 0, update_modified=False)
			frappe.delete_doc("Desktop Icon", "NOZOM POS", force=True, ignore_permissions=True)
			check("F icon missing before heal", not _icon_names())
			ensure_desktop_icon()
			check("F icon restored", _icon_names() == ["NOZOM POS"])

			create_custom_fields(
				{
					PROBE_DT: [
						{
							"fieldname": PROBE_FIELD,
							"label": "Lifecycle Probe",
							"fieldtype": "Data",
							"insert_after": "customer_name",
						}
					]
				},
				update=False,
			)
			check("E probe created", _field_exists(PROBE_DT, PROBE_FIELD))

			before_uninstall()
			summary_after = summarize_owned_custom_field_inventory()
			check("C owned fields removed", not summary_after["present"])
			for dt, fieldname in NEW_FIELDS:
				check(f"C new field removed {dt}.{fieldname}", not _field_exists(dt, fieldname))
			check("C icon removed", not _icon_names())
			check("C workspace removed", not frappe.db.exists("Workspace", "NOZOM POS"))
			check("C sidebar removed", not frappe.db.exists("Workspace Sidebar", "NOZOM POS"))
			selling_before = frappe.db.exists("Workspace Sidebar", "Selling")
			check("C selling sidebar kept", frappe.db.exists("Workspace Sidebar", "Selling") == selling_before)
			check("C chart removed", not frappe.db.exists("Dashboard Chart", "Daily POS Sales"))
			legacy_left = all(
				_field_exists(dt, row["fieldname"])
				for dt, rows in LEGACY_FIELDS_NOT_REMOVED.items()
				for row in rows
			)
			check("E legacy fields kept", legacy_left)
			check("E probe kept", _field_exists(PROBE_DT, PROBE_FIELD))
			check("C invoices preserved", frappe.db.count("Sales Invoice") == invoice_count)
			check("C customers preserved", frappe.db.count("Customer") == customer_count)

			try:
				_meta_loads("Sales Invoice", "POS Invoice", "Address")
				check("C meta loads after uninstall", True)
			except Exception as exc:
				check(f"C meta loads after uninstall ({exc})", False)

			before_uninstall()
			check("D before_uninstall twice", not summarize_owned_custom_field_inventory()["present"])

			setup_nozom_pos()
			assert_owned_fields_fully_installed()
			for dt, fieldname in NEW_FIELDS:
				check(f"H reinstalled {dt}.{fieldname}", _field_exists(dt, fieldname))
			check("D one icon", _icon_names() == ["NOZOM POS"])
			check("D one workspace", frappe.db.count("Workspace", {"name": "NOZOM POS"}) == 1)
			check("D one sidebar", frappe.db.count("Workspace Sidebar", {"name": "NOZOM POS", "app": APP_NAME}) == 1)
			check("D one chart", frappe.db.count("Dashboard Chart", {"name": "Daily POS Sales", "module": "NOZOM POS"}) == 1)
			restored_dupes = []
			for dt, fieldnames in owned_fieldnames().items():
				for fieldname in fieldnames:
					count = frappe.db.count("Custom Field", {"dt": dt, "fieldname": fieldname})
					if count != 1:
						restored_dupes.append(f"{dt}.{fieldname}={count}")
			check("D restored once", not restored_dupes)
			check("E probe still kept", _field_exists(PROBE_DT, PROBE_FIELD))
			check("D invoices preserved", frappe.db.count("Sales Invoice") == invoice_count)

			delete_nozom_pos_custom_fields()
			assert_owned_fields_fully_removed()
			check("G delete helper idempotent", True)
			delete_nozom_pos_custom_fields()
			assert_owned_fields_fully_removed()
			check("G delete helper twice", True)
		finally:
			_remove_probe()
			setup_nozom_pos()
			frappe.db.commit()

		failed = [name for name, ok in failures if not ok]
		if failed:
			self.fail(", ".join(failed))
