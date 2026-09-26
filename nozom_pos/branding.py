"""Ensure NOZOM POS Desktop Icon / brand label stays English."""

from __future__ import annotations

import frappe

BRAND_NAME = "NOZOM POS"


def ensure_desktop_icon_brand():
	"""Force Desktop Icon label to the brand literal (never localized).

	Does not modify Frappe core. Safe to call from after_migrate.
	"""
	if not frappe.db.exists("DocType", "Desktop Icon"):
		return

	# Standard app icon from desktop_icon/nozom_pos.json
	name = frappe.db.get_value("Desktop Icon", {"label": BRAND_NAME, "icon_type": "App"}, "name")
	if not name:
		name = frappe.db.get_value("Desktop Icon", {"app": "nozom_pos", "icon_type": "App"}, "name")
	if not name:
		# Legacy / renamed icons that still point at POS
		name = frappe.db.get_value(
			"Desktop Icon",
			{"link": "/desk/point-of-sale", "icon_type": "App"},
			"name",
		)

	if not name:
		return

	doc = frappe.get_doc("Desktop Icon", name)
	changed = False
	if doc.label != BRAND_NAME:
		doc.label = BRAND_NAME
		changed = True
	if getattr(doc, "app", None) and doc.app != "nozom_pos":
		# keep app link; do not force rename of unrelated icons
		pass
	if changed:
		doc.flags.ignore_permissions = True
		doc.save()
		frappe.clear_cache()
