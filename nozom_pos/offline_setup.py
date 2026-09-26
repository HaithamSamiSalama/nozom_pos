import frappe


IDEMPOTENCY_FIELD = "nozom_idempotency_key"
ORDER_NUMBER_FIELD = "nozom_order_number"
DELIVERY_LOCATION_FIELD = "nozom_delivery_location_link"
LOCATION_SNAPSHOT_FIELD = "nozom_delivery_location_link_snapshot"
ADDRESS_TITLE_SNAPSHOT_FIELD = "nozom_address_title_snapshot"
PHONE_SNAPSHOT_FIELD = "nozom_customer_phone_snapshot"


def ensure_custom_field(dt, fieldname, values):
	existing = frappe.db.get_value("Custom Field", {"dt": dt, "fieldname": fieldname}, "name")
	if existing:
		return existing

	doc = frappe.get_doc(
		{
			"doctype": "Custom Field",
			"dt": dt,
			"fieldname": fieldname,
			**values,
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.clear_cache(doctype=dt)
	return doc.name


def ensure_idempotency_field(dt):
	"""Ensure unique idempotency custom field exists on invoice doctype."""
	return ensure_custom_field(
		dt,
		IDEMPOTENCY_FIELD,
		{
			"label": "NOZOM Idempotency Key",
			"fieldtype": "Data",
			"insert_after": "pos_profile",
			"unique": 1,
			"read_only": 1,
			"no_copy": 1,
			"translatable": 0,
		},
	)


def ensure_order_number_field(dt):
	"""Cashier-entered Order Number (table/order reference)."""
	return ensure_custom_field(
		dt,
		ORDER_NUMBER_FIELD,
		{
			"label": "Order Number",
			"fieldtype": "Data",
			"insert_after": "order_notes",
			"unique": 0,
			"read_only": 0,
			"no_copy": 0,
			"translatable": 0,
		},
	)


def ensure_invoice_snapshot_fields(dt):
	"""Historical delivery snapshots — never overwritten by later Customer/Address edits."""
	created = []
	created.append(
		ensure_custom_field(
			dt,
			ADDRESS_TITLE_SNAPSHOT_FIELD,
			{
				"label": "Address Title Snapshot",
				"fieldtype": "Data",
				"insert_after": ORDER_NUMBER_FIELD,
				"read_only": 1,
				"no_copy": 1,
				"translatable": 0,
			},
		)
	)
	created.append(
		ensure_custom_field(
			dt,
			PHONE_SNAPSHOT_FIELD,
			{
				"label": "Customer Phone Snapshot",
				"fieldtype": "Data",
				"insert_after": ADDRESS_TITLE_SNAPSHOT_FIELD,
				"read_only": 1,
				"no_copy": 1,
				"translatable": 0,
			},
		)
	)
	created.append(
		ensure_custom_field(
			dt,
			LOCATION_SNAPSHOT_FIELD,
			{
				"label": "Delivery Location Link Snapshot",
				"fieldtype": "Data",
				"insert_after": PHONE_SNAPSHOT_FIELD,
				"read_only": 1,
				"no_copy": 1,
				"translatable": 0,
				"options": "URL",
			},
		)
	)
	return created


def ensure_idempotency_fields():
	created = []
	for dt in ("POS Invoice", "Sales Invoice"):
		created.append({"dt": dt, "name": ensure_idempotency_field(dt)})
	return created


def ensure_order_number_fields():
	created = []
	for dt in ("POS Invoice", "Sales Invoice"):
		created.append({"dt": dt, "name": ensure_order_number_field(dt)})
	return created


def ensure_invoice_delivery_snapshot_fields():
	created = []
	for dt in ("POS Invoice", "Sales Invoice"):
		for name in ensure_invoice_snapshot_fields(dt):
			created.append({"dt": dt, "name": name})
	return created


def ensure_customer_offline_fields():
	"""Idempotency + local-id mapping + Address delivery location."""
	created = []
	created.append(
		{
			"dt": "Customer",
			"name": ensure_custom_field(
				"Customer",
				"nozom_customer_idempotency_key",
				{
					"label": "NOZOM Customer Idempotency Key",
					"fieldtype": "Data",
					"insert_after": "tax_id",
					"unique": 1,
					"read_only": 1,
					"no_copy": 1,
					"translatable": 0,
					"hidden": 1,
				},
			),
		}
	)
	created.append(
		{
			"dt": "Customer",
			"name": ensure_custom_field(
				"Customer",
				"nozom_local_customer_id",
				{
					"label": "NOZOM Local Customer ID",
					"fieldtype": "Data",
					"insert_after": "nozom_customer_idempotency_key",
					"unique": 1,
					"read_only": 1,
					"no_copy": 1,
					"translatable": 0,
					"hidden": 1,
				},
			),
		}
	)
	created.append(
		{
			"dt": "Address",
			"name": ensure_custom_field(
				"Address",
				"nozom_address_idempotency_key",
				{
					"label": "NOZOM Address Idempotency Key",
					"fieldtype": "Data",
					"insert_after": "address_title",
					"unique": 1,
					"read_only": 1,
					"no_copy": 1,
					"translatable": 0,
					"hidden": 1,
				},
			),
		}
	)
	created.append(
		{
			"dt": "Address",
			"name": ensure_custom_field(
				"Address",
				"nozom_local_address_id",
				{
					"label": "NOZOM Local Address ID",
					"fieldtype": "Data",
					"insert_after": "nozom_address_idempotency_key",
					"unique": 1,
					"read_only": 1,
					"no_copy": 1,
					"translatable": 0,
					"hidden": 1,
				},
			),
		}
	)
	created.append(
		{
			"dt": "Address",
			"name": ensure_custom_field(
				"Address",
				DELIVERY_LOCATION_FIELD,
				{
					"label": "Delivery Location Link",
					"fieldtype": "Data",
					"insert_after": "phone",
					"unique": 0,
					"read_only": 0,
					"no_copy": 0,
					"translatable": 0,
					"options": "URL",
					"description": "Optional map/location URL (http/https only).",
				},
			),
		}
	)
	return created


def apply_offline_setup():
	"""Called from after_migrate."""
	ensure_idempotency_fields()
	ensure_order_number_fields()
	ensure_invoice_delivery_snapshot_fields()
	ensure_customer_offline_fields()
