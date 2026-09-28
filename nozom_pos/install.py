import frappe

from nozom_pos.setup import APP_NAME, delete_nozom_pos_custom_fields, ensure_custom_fields

BRAND_NAME = "NOZOM POS"
ICON_LINK = "/desk/point-of-sale"
ICON_LOGO = "/assets/nozom_pos/images/nozom-pos.svg"


def after_install():
	"""Runs on bench install-app nozom_pos."""
	setup_nozom_pos()


def after_migrate():
	"""Restore a missing icon or fields after migrate without duplicating them."""
	setup_nozom_pos()


def before_uninstall():
	"""Remove the NOZOM POS desktop icon and Custom Fields this app owns."""
	delete_nozom_pos_custom_fields()
	delete_desktop_icons()
	frappe.clear_cache()


def setup_nozom_pos():
	ensure_custom_fields()
	ensure_desktop_icon()

	from nozom_pos.offline_setup import apply_offline_setup
	from nozom_pos.printing_setup import apply_existing_pos_profiles

	apply_existing_pos_profiles()
	apply_offline_setup()
	frappe.clear_cache()


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
