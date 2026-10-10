"""NOZOM POS structural setup.

Owned Custom Fields use the nozom_ prefix and are created and removed with the app.
Unprefixed fields that this app also needs are created if missing and left in place
on uninstall, because ownership is not exclusive.
"""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


APP_NAME = "nozom_pos"
MODULE_NAME = "NOZOM POS"


def custom_field_docname(dt: str, fieldname: str) -> str:
	"""Canonical Custom Field name used by Frappe exports and fixtures."""
	return f"{dt}-{fieldname}"


def expected_owned_custom_field_keys():
	"""Authoritative flat list of app-owned fields as ``DocType.fieldname``."""
	keys = []
	for dt, rows in NOZOM_POS_CUSTOM_FIELDS.items():
		for row in rows:
			keys.append(f"{dt}.{row['fieldname']}")
	return tuple(keys)

# Created if missing. Not deleted on uninstall.
LEGACY_FIELDS_NOT_REMOVED = {
	"Sales Invoice Item": [
		{
			"fieldname": "notes",
			"label": "Notes",
			"fieldtype": "Small Text",
			"insert_after": "description",
		}
	],
	"POS Invoice Item": [
		{
			"fieldname": "notes",
			"label": "Notes",
			"fieldtype": "Small Text",
			"insert_after": "description",
		}
	],
	"Sales Invoice": [
		{
			"fieldname": "order_notes",
			"label": "Order Note",
			"fieldtype": "Small Text",
			"insert_after": "remarks",
		}
	],
	"POS Invoice": [
		{
			"fieldname": "order_notes",
			"label": "Order Note",
			"fieldtype": "Small Text",
			"insert_after": "remarks",
		}
	],
	"POS Profile": [
		{
			"fieldname": "print_format_2",
			"label": "Print Format 2",
			"fieldtype": "Link",
			"options": "Print Format",
			"insert_after": "print_format",
			"default": "POS Kitchen Print",
		}
	],
}


def _invoice_owned_fields():
	return [
		{
			"fieldname": "nozom_idempotency_key",
			"label": "NOZOM Idempotency Key",
			"fieldtype": "Data",
			"insert_after": "pos_profile",
			"unique": 1,
			"read_only": 1,
			"no_copy": 1,
			"translatable": 0,
		},
		{
			"fieldname": "nozom_order_number",
			"label": "Order Number",
			"fieldtype": "Data",
			"insert_after": "order_notes",
			"read_only": 0,
			"no_copy": 0,
			"translatable": 0,
		},
		{
			"fieldname": "nozom_address_title_snapshot",
			"label": "Address Title Snapshot",
			"fieldtype": "Data",
			"insert_after": "nozom_order_number",
			"read_only": 1,
			"no_copy": 1,
			"translatable": 0,
		},
		{
			"fieldname": "nozom_customer_phone_snapshot",
			"label": "Customer Phone Snapshot",
			"fieldtype": "Data",
			"insert_after": "nozom_address_title_snapshot",
			"read_only": 1,
			"no_copy": 1,
			"translatable": 0,
		},
		{
			"fieldname": "nozom_delivery_location_link_snapshot",
			"label": "Delivery Location Link Snapshot",
			"fieldtype": "Data",
			"options": "URL",
			"insert_after": "nozom_customer_phone_snapshot",
			"read_only": 1,
			"no_copy": 1,
			"translatable": 0,
		},
		{
			"fieldname": "nozom_fulfillment_method",
			"label": "Fulfillment Method",
			"fieldtype": "Select",
			"options": "Delivery\nPickup from Store",
			"default": "Delivery",
			"insert_after": "nozom_delivery_location_link_snapshot",
			"read_only": 1,
			"no_copy": 1,
			"translatable": 0,
		},
	]


NOZOM_POS_CUSTOM_FIELDS = {
	"POS Profile": [
		{
			"fieldname": "nozom_offline_admin_password",
			"label": "Offline Transaction Admin Password",
			"fieldtype": "Password",
			"description": "Administrative password required to discard failed offline POS transactions.",
		},
	],

	"Sales Invoice": _invoice_owned_fields(),
	"POS Invoice": _invoice_owned_fields(),
	"Address": [
		{
			"fieldname": "nozom_address_idempotency_key",
			"label": "NOZOM Address Idempotency Key",
			"fieldtype": "Data",
			"insert_after": "address_title",
			"unique": 1,
			"read_only": 1,
			"no_copy": 1,
			"translatable": 0,
			"hidden": 1,
		},
		{
			"fieldname": "nozom_local_address_id",
			"label": "NOZOM Local Address ID",
			"fieldtype": "Data",
			"insert_after": "nozom_address_idempotency_key",
			"unique": 1,
			"read_only": 1,
			"no_copy": 1,
			"translatable": 0,
			"hidden": 1,
		},
		{
			"fieldname": "nozom_delivery_location_link",
			"label": "Delivery Location Link",
			"fieldtype": "Data",
			"options": "URL",
			"insert_after": "phone",
			"read_only": 0,
			"no_copy": 0,
			"translatable": 0,
			"description": "Optional map/location URL (http/https only).",
		},
		{
			"fieldname": "nozom_mobile_no",
			"label": "Mobile",
			"fieldtype": "Data",
			"insert_after": "nozom_delivery_location_link",
			"read_only": 0,
			"no_copy": 0,
			"translatable": 0,
		},
	],
	"Customer": [
		{
			"fieldname": "nozom_customer_idempotency_key",
			"label": "NOZOM Customer Idempotency Key",
			"fieldtype": "Data",
			"insert_after": "tax_id",
			"unique": 1,
			"read_only": 1,
			"no_copy": 1,
			"translatable": 0,
			"hidden": 1,
		},
		{
			"fieldname": "nozom_local_customer_id",
			"label": "NOZOM Local Customer ID",
			"fieldtype": "Data",
			"insert_after": "nozom_customer_idempotency_key",
			"unique": 1,
			"read_only": 1,
			"no_copy": 1,
			"translatable": 0,
			"hidden": 1,
		},
	],
	"POS Opening Entry": [
		{
			"fieldname": "nozom_cash_denomination_json",
			"label": "NOZOM Cash Denomination JSON",
			"fieldtype": "Long Text",
			"insert_after": "amended_from",
			"read_only": 1,
			"no_copy": 1,
			"translatable": 0,
			"hidden": 1,
		},
		{
			"fieldname": "nozom_opening_idempotency_key",
			"label": "NOZOM Opening Idempotency Key",
			"fieldtype": "Data",
			"insert_after": "nozom_cash_denomination_json",
			"unique": 1,
			"read_only": 1,
			"no_copy": 1,
			"translatable": 0,
			"hidden": 1,
		},
	],
	"POS Closing Entry": [
		{
			"fieldname": "nozom_cash_denomination_json",
			"label": "NOZOM Cash Denomination JSON",
			"fieldtype": "Long Text",
			"insert_after": "error_message",
			"read_only": 1,
			"no_copy": 1,
			"translatable": 0,
			"hidden": 1,
		}
	],
}


def owned_fieldnames():
	return {
		dt: tuple(row["fieldname"] for row in rows)
		for dt, rows in NOZOM_POS_CUSTOM_FIELDS.items()
	}


def audit_owned_custom_field_inventory():
	"""Non-destructive report: expected owned fields vs site Custom Field rows.

	Only considers fields declared in ``NOZOM_POS_CUSTOM_FIELDS``.
	Does not scan or delete arbitrary Custom Fields from other apps.
	"""
	report = {
		"expected": list(expected_owned_custom_field_keys()),
		"present": [],
		"missing": [],
		"by_docname": {},
	}

	for dt, fieldnames in owned_fieldnames().items():
		for fieldname in fieldnames:
			key = f"{dt}.{fieldname}"
			docname = custom_field_docname(dt, fieldname)
			name = docname if frappe.db.exists("Custom Field", docname) else None
			if not name:
				name = frappe.db.get_value(
					"Custom Field",
					{"dt": dt, "fieldname": fieldname},
					"name",
				)
			if name:
				report["present"].append(key)
				report["by_docname"][key] = name
			else:
				report["missing"].append(key)

	return report


def _delete_one_owned_custom_field(dt: str, fieldname: str) -> bool:
	"""Delete a single owned Custom Field if present. Idempotent."""
	docname = custom_field_docname(dt, fieldname)
	if frappe.db.exists("Custom Field", docname):
		frappe.delete_doc("Custom Field", docname, force=True, ignore_permissions=True)
		return True

	name = frappe.db.get_value(
		"Custom Field",
		{"dt": dt, "fieldname": fieldname},
		"name",
	)
	if name:
		frappe.delete_doc("Custom Field", name, force=True, ignore_permissions=True)
		return True

	return False


def ensure_custom_fields():
	"""Create app-owned fields and any legacy fields that are still missing."""
	create_custom_fields(LEGACY_FIELDS_NOT_REMOVED, update=False)
	create_custom_fields(NOZOM_POS_CUSTOM_FIELDS, update=True)
	frappe.clear_cache()


def delete_nozom_pos_custom_fields():
	"""Remove only Custom Fields owned by NOZOM POS.

	Custom Field.on_trash does not drop the database column, so the column is
	dropped after the Custom Field document is gone. Standard DocFields and
	fields from other apps are left in place.
	"""
	if frappe.session.user != "Administrator":
		frappe.set_user("Administrator")

	touched = set()
	owned = owned_fieldnames()

	for dt, fieldnames in owned.items():
		for fieldname in fieldnames:
			if _delete_one_owned_custom_field(dt, fieldname):
				touched.add(dt)

	for dt, fieldnames in owned.items():
		if not frappe.db.table_exists(dt):
			continue

		columns = set(frappe.db.get_table_columns(dt))
		dropped = False
		for fieldname in fieldnames:
			if fieldname not in columns:
				continue
			if frappe.db.exists("DocField", {"parent": dt, "fieldname": fieldname}):
				continue
			if frappe.db.exists("Custom Field", {"dt": dt, "fieldname": fieldname}):
				continue
			frappe.db.sql_ddl(f"ALTER TABLE `tab{dt}` DROP COLUMN `{fieldname}`")
			dropped = True

		if dropped or dt in touched:
			frappe.clear_cache(doctype=dt)
			frappe.client_cache.delete_value(f"table_columns::tab{dt}")
			frappe.db.updatedb(dt)
