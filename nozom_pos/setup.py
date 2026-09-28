"""NOZOM POS structural setup.

Owned Custom Fields use the nozom_ prefix and are created and removed with the app.
Unprefixed fields that this app also needs are created if missing and left in place
on uninstall, because ownership is not exclusive.
"""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


APP_NAME = "nozom_pos"

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
	]


NOZOM_POS_CUSTOM_FIELDS = {
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
		names = frappe.get_all(
			"Custom Field",
			filters={"dt": dt, "fieldname": ("in", list(fieldnames))},
			pluck="name",
		)
		for name in names:
			frappe.delete_doc("Custom Field", name, force=True, ignore_permissions=True)
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
