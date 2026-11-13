"""
NOZOM POS desk navigation aligned with the working NOZOM Chqs pattern.

Chqs keeps the ERPNext App Rail visible by setting ``Sidebar.app = erpnext`` and
pinning the shell on the ERPNext site Dock (``added=1``). An empty/null Sidebar.app
falls back to ``get_module_placement(module)`` → ``nozom_pos``, which has no dock
rows, so ``dock_enabled`` becomes false and the App Rail disappears.

Dock landing must be the Workspace home (``/desk/nozom-pos``). The cashier Page is a
sidebar/workspace action, not the shell home. Claim ``point-of-sale`` with
``is_default_module`` so the POS shell (and App Rail) stay active on that page.
"""

from __future__ import annotations

import frappe

APP = "nozom_pos"
MODULE = "NOZOM POS"
SIDEBAR_NAME = "NOZOM POS"
WORKSPACE_NAME = "NOZOM POS"
SIDEBAR_APP = "erpnext"
HOST_APP = "erpnext"
# Same Desk / Apps Screen asset — Dock renders paths via brand.js bridge.
DOCK_ICON = "/assets/nozom_pos/images/nozom-pos.svg"
CASHIER_URL = "/desk/nozom-pos/point-of-sale"
CASHIER_PAGE = "point-of-sale"

SIDEBAR_ITEMS = [
	{
		"label": "Home",
		"type": "Link",
		"link_type": "Workspace",
		"link_to": WORKSPACE_NAME,
		"url": "",
		"icon": "home",
	},
	{
		"label": "Open NOZOM POS",
		"type": "Link",
		"link_type": "Page",
		"link_to": CASHIER_PAGE,
		"url": "",
		"icon": DOCK_ICON,
		"is_default_module": 1,
	},
	{
		"label": "Sales Invoices",
		"type": "Link",
		"link_type": "DocType",
		"link_to": "Sales Invoice",
		"icon": "receipt",
	},
	{
		"label": "POS Opening Entry",
		"type": "Link",
		"link_type": "DocType",
		"link_to": "POS Opening Entry",
		"icon": "list",
		"is_default_module": 1,
	},
	{
		"label": "POS Closing Entry",
		"type": "Link",
		"link_type": "DocType",
		"link_to": "POS Closing Entry",
		"icon": "list",
		"is_default_module": 1,
	},
	{
		"label": "POS Invoice",
		"type": "Link",
		"link_type": "DocType",
		"link_to": "POS Invoice",
		"icon": "receipt",
		"is_default_module": 1,
	},
	{
		"label": "POS Invoice Merge Log",
		"type": "Link",
		"link_type": "DocType",
		"link_to": "POS Invoice Merge Log",
		"icon": "files",
		"is_default_module": 1,
	},
	{
		"label": "POS Profile",
		"type": "Link",
		"link_type": "DocType",
		"link_to": "POS Profile",
		"icon": "settings",
		"is_default_module": 1,
	},
]


def _system_write(enabled: bool = True) -> None:
	for flag in ("in_migrate", "in_patch"):
		frappe.flags[flag] = enabled


def _sidebar_item_row(item: dict) -> dict:
	link_type = item.get("link_type") or ""
	default = item.get("is_default_module")
	if default is None:
		default = 1 if link_type in ("Page", "DocType") and item.get("link_to") != "Sales Invoice" else 0
	return {
		"label": item["label"],
		"type": item.get("type") or "Link",
		"icon": item.get("icon") or "",
		"child": 0,
		"hidden": 0,
		"collapsible": 1,
		"indent": 0,
		"keep_closed": 0,
		"show_arrow": 0,
		"open_in_new_tab": 0,
		"added": 0,
		"is_default_module": 1 if default else 0,
		"link_type": link_type,
		"link_to": item.get("link_to") or "",
		"url": item.get("url") or "",
	}


def ensure_sidebar() -> str:
	"""Create/refresh the Frappe Sidebar shell with ERPNext as the App Rail host."""
	if not frappe.db.exists("DocType", "Sidebar"):
		return SIDEBAR_NAME

	items = [_sidebar_item_row(item) for item in SIDEBAR_ITEMS]
	_system_write(True)
	try:
		if frappe.db.exists("Sidebar", SIDEBAR_NAME):
			doc = frappe.get_doc("Sidebar", SIDEBAR_NAME)
			doc.title = SIDEBAR_NAME
			doc.module = MODULE
			doc.app = SIDEBAR_APP
			doc.standard = 0
			doc.header_icon = DOCK_ICON
			doc.set("items", [])
			for row in items:
				doc.append("items", row)
			doc.save(ignore_permissions=True)
		else:
			doc = frappe.get_doc(
				{
					"doctype": "Sidebar",
					"title": SIDEBAR_NAME,
					"module": MODULE,
					"app": SIDEBAR_APP,
					"standard": 0,
					"header_icon": DOCK_ICON,
					"items": items,
				}
			)
			doc.insert(ignore_permissions=True)
	finally:
		_system_write(False)

	frappe.db.sql(
		"UPDATE `tabSidebar` SET `module`=%s, `app`=%s, `title`=%s WHERE `name`=%s",
		(MODULE, SIDEBAR_APP, SIDEBAR_NAME, SIDEBAR_NAME),
	)
	return SIDEBAR_NAME


def ensure_host_site_dock_pin() -> str | None:
	"""Pin NOZOM POS on the ERPNext site Dock (same path as NOZOM Chqs)."""
	if not frappe.db.exists("DocType", "Dock"):
		return None
	if HOST_APP not in frappe.get_installed_apps():
		return None

	site_dock_name = frappe.db.get_value(
		"Dock",
		{"app": HOST_APP, "standard": 0, "user": ["in", ["", None]]},
		"name",
	)
	if not site_dock_name:
		return None

	doc = frappe.get_doc("Dock", site_dock_name)
	for row in doc.items:
		if row.link_type == "Sidebar" and row.link_to == SIDEBAR_NAME:
			row.added = 1
			row.hidden = 0
			row.icon = DOCK_ICON
			row.title = SIDEBAR_NAME
			doc.save(ignore_permissions=True)
			return doc.name

	doc.append(
		"items",
		{
			"link_type": "Sidebar",
			"link_to": SIDEBAR_NAME,
			"icon": DOCK_ICON,
			"title": SIDEBAR_NAME,
			"added": 1,
			"hidden": 0,
		},
	)
	doc.save(ignore_permissions=True)
	return doc.name


def ensure_workspace_title() -> None:
	"""Keep the commercial display title without renaming the workspace route."""
	if not frappe.db.exists("Workspace", WORKSPACE_NAME):
		return
	frappe.db.set_value(
		"Workspace",
		WORKSPACE_NAME,
		{"title": SIDEBAR_NAME, "label": SIDEBAR_NAME},
		update_modified=False,
	)


def ensure_nozom_pos_navigation() -> dict:
	"""Idempotent navigation repair. Does not call ``frappe.db.commit()``."""
	ensure_workspace_title()
	sidebar = ensure_sidebar()
	dock_pin = ensure_host_site_dock_pin()

	try:
		from frappe.desk.doctype.dock.dock import drop_dock_caches

		drop_dock_caches("")
	except Exception:
		pass

	frappe.clear_cache()
	return {
		"module": MODULE,
		"workspace": WORKSPACE_NAME,
		"sidebar": sidebar,
		"sidebar_app": SIDEBAR_APP,
		"dock_icon": DOCK_ICON,
		"cashier_url": CASHIER_URL,
		"dock_pin": dock_pin,
	}
