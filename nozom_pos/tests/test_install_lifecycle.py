# Copyright (c) 2026, NOZOM and contributors
# License: MIT

"""Install, migrate, and uninstall structure for NOZOM POS.

This exercises the real site schema, then restores the app structure.
It does not delete invoices, customers, or accounting records.
"""

from __future__ import annotations

import unittest

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

from nozom_pos.install import ensure_desktop_icon, setup_nozom_pos
from nozom_pos.setup import (
	APP_NAME,
	LEGACY_FIELDS_NOT_REMOVED,
	delete_nozom_pos_custom_fields,
	owned_fieldnames,
)

PROBE_DT = "Customer"
PROBE_FIELD = "lifecycle_probe_shared"


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
			check("A open shortcut", open_shortcut and open_shortcut.type == "URL" and open_shortcut.url == "/desk/point-of-sale")
			missing = [
				f"{dt}.{fieldname}"
				for dt, fieldnames in owned_fieldnames().items()
				if any(not _field_exists(dt, fieldname) for fieldname in fieldnames)
			]
			check("A owned fields", not missing)

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

			delete_nozom_pos_custom_fields()
			from nozom_pos.install import (
				delete_daily_sales_chart,
				delete_desktop_icons,
				delete_pos_sidebar,
				delete_pos_workspace,
			)

			selling_before = frappe.db.exists("Workspace Sidebar", "Selling")
			delete_pos_workspace()
			delete_pos_sidebar()
			delete_daily_sales_chart()
			delete_desktop_icons()

			owned_left = [
				f"{dt}.{fieldname}"
				for dt, fieldnames in owned_fieldnames().items()
				for fieldname in fieldnames
				if _field_exists(dt, fieldname)
			]
			check("C owned fields removed", not owned_left)
			check("C icon removed", not _icon_names())
			check("C workspace removed", not frappe.db.exists("Workspace", "NOZOM POS"))
			check("C sidebar removed", not frappe.db.exists("Workspace Sidebar", "NOZOM POS"))
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

			setup_nozom_pos()
			restored = [
				f"{dt}.{fieldname}"
				for dt, fieldnames in owned_fieldnames().items()
				for fieldname in fieldnames
				if not _field_exists(dt, fieldname)
			]
			check("D fields restored", not restored)
			check("D one icon", _icon_names() == ["NOZOM POS"])
			check("D one workspace", frappe.db.count("Workspace", {"name": "NOZOM POS"}) == 1)
			check("D one sidebar", frappe.db.count("Workspace Sidebar", {"name": "NOZOM POS", "app": APP_NAME}) == 1)
			check("D one chart", frappe.db.count("Dashboard Chart", {"name": "Daily POS Sales", "module": "NOZOM POS"}) == 1)
			for dt, fieldnames in owned_fieldnames().items():
				for fieldname in fieldnames:
					count = frappe.db.count("Custom Field", {"dt": dt, "fieldname": fieldname})
					if count != 1:
						restored.append(f"{dt}.{fieldname}={count}")
			check("D restored once", not restored)
			check("E probe still kept", _field_exists(PROBE_DT, PROBE_FIELD))
			check("D invoices preserved", frappe.db.count("Sales Invoice") == invoice_count)
		finally:
			_remove_probe()
			setup_nozom_pos()
			frappe.db.commit()

		failed = [name for name, ok in failures if not ok]
		if failed:
			self.fail(", ".join(failed))
