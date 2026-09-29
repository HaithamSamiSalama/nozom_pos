import json

import frappe

from nozom_pos.setup import APP_NAME, delete_nozom_pos_custom_fields, ensure_custom_fields

BRAND_NAME = "NOZOM POS"
ICON_LINK = "/desk/nozom-pos"
ICON_LOGO = "/assets/nozom_pos/images/nozom-pos.svg"
WORKSPACE_NAME = "NOZOM POS"
CHART_NAME = "Daily POS Sales"
MODULE_NAME = "NOZOM POS"


def after_install():
	"""Runs on bench install-app nozom_pos."""
	setup_nozom_pos()


def after_migrate():
	"""Restore a missing icon or fields after migrate without duplicating them."""
	setup_nozom_pos()


def before_uninstall():
	"""Remove the NOZOM POS desktop icon, workspace, chart, and owned Custom Fields."""
	delete_nozom_pos_custom_fields()
	delete_pos_workspace()
	delete_pos_sidebar()
	delete_daily_sales_chart()
	delete_desktop_icons()
	frappe.clear_cache()


def setup_nozom_pos():
	ensure_custom_fields()
	ensure_daily_sales_chart()
	ensure_pos_workspace()
	ensure_pos_sidebar()
	ensure_desktop_icon()

	from nozom_pos.offline_setup import apply_offline_setup
	from nozom_pos.printing_setup import apply_existing_pos_profiles

	apply_existing_pos_profiles()
	apply_offline_setup()
	frappe.clear_cache()


CASHIER_URL = "/desk/point-of-sale"

WORKSPACE_SHORTCUTS = (
	{
		"label": "Open NOZOM POS",
		"type": "URL",
		"url": CASHIER_URL,
		"link_to": "",
		"doc_view": "",
		"color": "Green",
	},
	{
		"label": "Sales Invoices",
		"type": "DocType",
		"link_to": "Sales Invoice",
		"doc_view": "List",
		"color": "Blue",
	},
	{
		"label": "POS Opening Entries",
		"type": "DocType",
		"link_to": "POS Opening Entry",
		"doc_view": "List",
		"color": "Blue",
	},
	{
		"label": "POS Closing Entries",
		"type": "DocType",
		"link_to": "POS Closing Entry",
		"doc_view": "List",
		"color": "Orange",
	},
	{"label": "POS Invoices", "type": "DocType", "link_to": "POS Invoice", "doc_view": "List", "color": "Green"},
	{
		"label": "Merged POS Invoices",
		"type": "DocType",
		"link_to": "POS Invoice Merge Log",
		"doc_view": "List",
		"color": "Purple",
	},
	{"label": "POS Settings", "type": "DocType", "link_to": "POS Profile", "doc_view": "List", "color": "Grey"},
)

WORKSPACE_CONTENT = [
	{"id": "nozom_pos_header", "type": "header", "data": {"text": "<span class=\"h4\"><b>NOZOM POS</b></span>", "col": 12}},
	{"id": "nozom_pos_open", "type": "shortcut", "data": {"shortcut_name": "Open NOZOM POS", "col": 12}},
	{"id": "nozom_pos_sales_invoices", "type": "shortcut", "data": {"shortcut_name": "Sales Invoices", "col": 6}},
	{"id": "nozom_pos_opening", "type": "shortcut", "data": {"shortcut_name": "POS Opening Entries", "col": 6}},
	{"id": "nozom_pos_closing", "type": "shortcut", "data": {"shortcut_name": "POS Closing Entries", "col": 6}},
	{"id": "nozom_pos_invoices", "type": "shortcut", "data": {"shortcut_name": "POS Invoices", "col": 6}},
	{"id": "nozom_pos_merged", "type": "shortcut", "data": {"shortcut_name": "Merged POS Invoices", "col": 6}},
	{"id": "nozom_pos_settings", "type": "shortcut", "data": {"shortcut_name": "POS Settings", "col": 6}},
	{
		"id": "nozom_pos_chart_header",
		"type": "header",
		"data": {"text": "<span class=\"h4\"><b>Daily POS Sales</b></span>", "col": 12},
	},
	{"id": "nozom_pos_chart", "type": "chart", "data": {"chart_name": CHART_NAME, "col": 12}},
]

SIDEBAR_ITEMS = (
	{
		"label": "Open NOZOM POS",
		"type": "Link",
		"link_type": "URL",
		"url": CASHIER_URL,
		"link_to": "",
		"icon": "shopping-cart",
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
	},
	{
		"label": "POS Closing Entry",
		"type": "Link",
		"link_type": "DocType",
		"link_to": "POS Closing Entry",
		"icon": "list",
	},
	{
		"label": "POS Invoice",
		"type": "Link",
		"link_type": "DocType",
		"link_to": "POS Invoice",
		"icon": "receipt",
	},
	{
		"label": "POS Invoice Merge Log",
		"type": "Link",
		"link_type": "DocType",
		"link_to": "POS Invoice Merge Log",
		"icon": "files",
	},
	{
		"label": "POS Profile",
		"type": "Link",
		"link_type": "DocType",
		"link_to": "POS Profile",
		"icon": "settings",
	},
)

CHART_FILTERS = [["POS Invoice", "docstatus", "=", 1]]


def _save_app_doc(doc, insert):
	"""Save an app-owned desk record without rewriting its shipped JSON."""
	previous_dev = frappe.conf.developer_mode
	previous_import = bool(frappe.flags.in_import)
	frappe.conf.developer_mode = 0
	frappe.flags.in_import = True
	try:
		doc.flags.ignore_permissions = True
		doc.flags.ignore_validate = True
		doc.flags.ignore_links = True
		doc.flags.ignore_mandatory = True
		if insert:
			doc.insert(ignore_permissions=True)
		else:
			doc.save(ignore_permissions=True)
	finally:
		frappe.conf.developer_mode = previous_dev
		frappe.flags.in_import = previous_import


def _delete_app_doc(doctype, name):
	"""Delete the site row and leave the shipped JSON in place."""
	if not frappe.db.exists(doctype, name):
		return
	previous_dev = frappe.conf.developer_mode
	frappe.conf.developer_mode = 0
	try:
		frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)
	finally:
		frappe.conf.developer_mode = previous_dev


def _shortcut_identity(row):
	return {
		"label": row.get("label"),
		"type": row.get("type"),
		"link_to": row.get("link_to") or "",
		"url": row.get("url") or "",
		"doc_view": row.get("doc_view") or "",
	}


def _sidebar_identity(row):
	return {
		"label": row.get("label"),
		"type": row.get("type") or "Link",
		"link_type": row.get("link_type") or "",
		"link_to": row.get("link_to") or "",
		"url": row.get("url") or "",
	}


def ensure_daily_sales_chart():
	"""Restore the app-owned daily sales chart. Do not touch another module's chart."""
	if not frappe.db.exists("DocType", "Dashboard Chart"):
		return None

	if frappe.db.exists("Dashboard Chart", CHART_NAME):
		chart = frappe.get_doc("Dashboard Chart", CHART_NAME)
		if (chart.module or "") != MODULE_NAME:
			return None
		if _chart_is_canonical(chart):
			return chart.name
		_apply_daily_sales_chart(chart)
		_save_app_doc(chart, insert=False)
		return chart.name

	chart = frappe.new_doc("Dashboard Chart")
	_apply_daily_sales_chart(chart)
	_save_app_doc(chart, insert=True)
	return chart.name


def _chart_is_canonical(chart):
	try:
		filters = json.loads(chart.filters_json or "[]")
	except (TypeError, ValueError):
		return False
	return (
		chart.chart_name == CHART_NAME
		and chart.chart_type == "Sum"
		and chart.document_type == "POS Invoice"
		and chart.value_based_on == "grand_total"
		and chart.based_on == "posting_date"
		and chart.timeseries == 1
		and chart.time_interval == "Daily"
		and chart.timespan == "Last Month"
		and chart.type == "Line"
		and chart.module == MODULE_NAME
		and chart.is_public == 1
		and chart.is_standard == 1
		and filters == CHART_FILTERS
	)


def _apply_daily_sales_chart(chart):
	chart.chart_name = CHART_NAME
	chart.chart_type = "Sum"
	chart.document_type = "POS Invoice"
	chart.value_based_on = "grand_total"
	chart.based_on = "posting_date"
	chart.timeseries = 1
	chart.time_interval = "Daily"
	chart.timespan = "Last Month"
	chart.type = "Line"
	chart.is_public = 1
	chart.is_standard = 1
	chart.module = MODULE_NAME
	chart.filters_json = json.dumps(CHART_FILTERS)
	chart.color = "#2490ef"
	chart.use_report_chart = 0


def delete_daily_sales_chart():
	"""Remove only the NOZOM POS chart. Other Dashboard Charts stay."""
	if not frappe.db.exists("Dashboard Chart", CHART_NAME):
		return
	module = frappe.db.get_value("Dashboard Chart", CHART_NAME, "module")
	document_type = frappe.db.get_value("Dashboard Chart", CHART_NAME, "document_type")
	if module != MODULE_NAME or document_type != "POS Invoice":
		return
	_delete_app_doc("Dashboard Chart", CHART_NAME)


def ensure_pos_workspace():
	"""Restore the public NOZOM POS workspace. A second run does not insert another."""
	if not frappe.db.exists("DocType", "Workspace"):
		return None
	ensure_daily_sales_chart()

	if frappe.db.exists("Workspace", WORKSPACE_NAME):
		workspace = frappe.get_doc("Workspace", WORKSPACE_NAME)
		if (workspace.module or "") != MODULE_NAME or (workspace.app or "") not in (APP_NAME, ""):
			return None
		if _workspace_is_canonical(workspace):
			return workspace.name
		_apply_pos_workspace(workspace)
		_save_app_doc(workspace, insert=False)
		return workspace.name

	workspace = frappe.new_doc("Workspace")
	_apply_pos_workspace(workspace)
	_save_app_doc(workspace, insert=True)
	return workspace.name


def _workspace_is_canonical(workspace):
	if workspace.name != WORKSPACE_NAME or workspace.label != WORKSPACE_NAME:
		return False
	if (workspace.title or "") != WORKSPACE_NAME:
		return False
	if workspace.module != MODULE_NAME or workspace.app != APP_NAME:
		return False
	if not workspace.public or workspace.is_hidden:
		return False
	shortcuts = [_shortcut_identity(row) for row in (workspace.shortcuts or [])]
	expected = [_shortcut_identity(row) for row in WORKSPACE_SHORTCUTS]
	if shortcuts != expected:
		return False
	chart_names = [row.chart_name for row in (workspace.charts or [])]
	if chart_names != [CHART_NAME]:
		return False
	try:
		content = json.loads(workspace.content or "[]")
	except (TypeError, ValueError):
		return False
	return content == WORKSPACE_CONTENT


def _apply_pos_workspace(workspace):
	workspace.label = WORKSPACE_NAME
	workspace.title = WORKSPACE_NAME
	workspace.module = MODULE_NAME
	workspace.app = APP_NAME
	workspace.public = 1
	workspace.is_hidden = 0
	workspace.hide_custom = 0
	workspace.icon = "shopping-cart"
	if not workspace.sequence_id:
		workspace.sequence_id = 50
	workspace.content = json.dumps(WORKSPACE_CONTENT, ensure_ascii=False)
	workspace.set("shortcuts", [])
	for row in WORKSPACE_SHORTCUTS:
		workspace.append("shortcuts", dict(row))
	workspace.set("charts", [])
	workspace.append("charts", {"chart_name": CHART_NAME, "label": CHART_NAME})
	workspace.set("links", [])


def delete_pos_workspace():
	"""Remove only the NOZOM POS workspace. User workspaces and business data stay."""
	if not frappe.db.exists("Workspace", WORKSPACE_NAME):
		return
	module = frappe.db.get_value("Workspace", WORKSPACE_NAME, "module")
	app = frappe.db.get_value("Workspace", WORKSPACE_NAME, "app")
	if module != MODULE_NAME or app != APP_NAME:
		return
	_delete_app_doc("Workspace", WORKSPACE_NAME)


def ensure_pos_sidebar():
	"""Restore the NOZOM POS sidebar. A second run does not insert another."""
	if not frappe.db.exists("DocType", "Workspace Sidebar"):
		return None

	if frappe.db.exists("Workspace Sidebar", WORKSPACE_NAME):
		sidebar = frappe.get_doc("Workspace Sidebar", WORKSPACE_NAME)
		if (sidebar.app or "") not in (APP_NAME, ""):
			return None
		if _sidebar_is_canonical(sidebar):
			return sidebar.name
		_apply_pos_sidebar(sidebar)
		_save_app_doc(sidebar, insert=False)
		return sidebar.name

	sidebar = frappe.new_doc("Workspace Sidebar")
	_apply_pos_sidebar(sidebar)
	_save_app_doc(sidebar, insert=True)
	return sidebar.name


def _sidebar_is_canonical(sidebar):
	if sidebar.title != WORKSPACE_NAME or sidebar.name != WORKSPACE_NAME:
		return False
	if sidebar.app != APP_NAME or sidebar.module != MODULE_NAME:
		return False
	if not sidebar.standard:
		return False
	items = [_sidebar_identity(row) for row in (sidebar.items or [])]
	expected = [_sidebar_identity(row) for row in SIDEBAR_ITEMS]
	return items == expected


def _apply_pos_sidebar(sidebar):
	sidebar.title = WORKSPACE_NAME
	sidebar.app = APP_NAME
	sidebar.module = MODULE_NAME
	sidebar.standard = 1
	sidebar.header_icon = "shopping-cart"
	sidebar.for_user = None
	sidebar.set("items", [])
	for row in SIDEBAR_ITEMS:
		sidebar.append("items", dict(row))


def delete_pos_sidebar():
	"""Remove only the sidebar this app owns. Shared sidebars stay."""
	if not frappe.db.exists("Workspace Sidebar", WORKSPACE_NAME):
		return
	app = frappe.db.get_value("Workspace Sidebar", WORKSPACE_NAME, "app")
	if app != APP_NAME:
		return
	_delete_app_doc("Workspace Sidebar", WORKSPACE_NAME)


def ensure_desktop_icon():
	"""Create the app icon once. A second run updates the same row."""
	if not frappe.db.exists("DocType", "Desktop Icon"):
		return None

	names = frappe.get_all(
		"Desktop Icon",
		filters={"app": APP_NAME, "icon_type": "App"},
		pluck="name",
	)
	canonical = BRAND_NAME if BRAND_NAME in names else None
	if not canonical:
		canonical = frappe.db.get_value("Desktop Icon", {"label": BRAND_NAME}, "name")
	if not canonical and names:
		canonical = names[0]

	for name in names:
		if canonical and name != canonical:
			frappe.delete_doc("Desktop Icon", name, force=True, ignore_permissions=True)

	if not canonical:
		doc = frappe.get_doc(
			{
				"doctype": "Desktop Icon",
				"label": BRAND_NAME,
				"standard": 1,
				"icon_type": "App",
				"app": APP_NAME,
				"link_type": "External",
				"link": ICON_LINK,
				"logo_url": ICON_LOGO,
				"hidden": 0,
				"restrict_removal": 0,
				"bg_color": "blue",
			}
		)
		_save_icon(doc, insert=True)
		_clear_icon_cache()
		return doc.name

	doc = frappe.get_doc("Desktop Icon", canonical)
	changed = False
	for fieldname, value in (
		("label", BRAND_NAME),
		("app", APP_NAME),
		("icon_type", "App"),
		("link_type", "External"),
		("link", ICON_LINK),
		("logo_url", ICON_LOGO),
	):
		if doc.get(fieldname) != value:
			doc.set(fieldname, value)
			changed = True
	if changed:
		_save_icon(doc, insert=False)
		_clear_icon_cache()
	return doc.name


def delete_desktop_icons():
	names = set(
		frappe.get_all("Desktop Icon", filters={"app": APP_NAME}, pluck="name")
	)
	brand = frappe.db.get_value(
		"Desktop Icon",
		{"label": BRAND_NAME, "link": ICON_LINK},
		"name",
	)
	if brand:
		names.add(brand)

	for name in names:
		# Developer mode deletes the shipped icon file when a standard icon is trashed.
		# Clear that flag in the database first so uninstall removes only the site row.
		frappe.db.set_value("Desktop Icon", name, "standard", 0, update_modified=False)
		frappe.delete_doc("Desktop Icon", name, force=True, ignore_permissions=True)

	_clear_icon_cache()


def _save_icon(doc, insert):
	"""Save without letting developer mode rewrite desktop_icon/nozom_pos.json."""
	previous = bool(frappe.flags.in_import)
	frappe.flags.in_import = True
	try:
		doc.flags.ignore_permissions = True
		if insert:
			doc.insert(ignore_permissions=True)
		else:
			doc.save()
	finally:
		frappe.flags.in_import = previous


def _clear_icon_cache():
	try:
		from frappe.desk.doctype.desktop_icon.desktop_icon import clear_desktop_icons_cache

		clear_desktop_icons_cache()
	except Exception:
		frappe.log_error(frappe.get_traceback(), "NOZOM POS Desktop Icon Setup")
