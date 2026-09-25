import frappe
from frappe import _
from frappe.utils import cint, cstr, get_datetime

from nozom_pos.print_utils import sanitize_location_url


def _cstr(value):
	return cstr(value).strip()


@frappe.whitelist()
def get_addresses_for_customers(customers):
	"""Batch-load addresses for POS preload (customers list JSON)."""
	if isinstance(customers, str):
		customers = frappe.parse_json(customers)
	if not isinstance(customers, list):
		return {}

	out = {}
	for customer in customers[:120]:
		name = _cstr(customer)
		if not name:
			continue
		out[name] = get_customer_addresses(name)
	return out


@frappe.whitelist()
def get_customer_addresses(customer):
	"""Return Address docs linked to Customer for POS cache/selection."""
	customer = _cstr(customer)
	if not customer:
		return []

	frappe.has_permission("Customer", "read", throw=True)

	links = frappe.get_all(
		"Dynamic Link",
		filters={"link_doctype": "Customer", "link_name": customer, "parenttype": "Address"},
		fields=["parent"],
	)
	names = [row.parent for row in links]
	if not names:
		return []

	fields = [
		"name",
		"address_title",
		"address_line1",
		"address_line2",
		"city",
		"state",
		"country",
		"pincode",
		"phone",
		"is_primary_address",
		"is_shipping_address",
		"modified",
		"disabled",
	]
	if frappe.db.has_column("Address", "nozom_delivery_location_link"):
		fields.append("nozom_delivery_location_link")

	rows = frappe.get_all(
		"Address",
		filters={"name": ["in", names], "disabled": 0},
		fields=fields,
		order_by="is_shipping_address desc, is_primary_address desc, modified desc",
	)

	out = []
	for row in rows:
		display_parts = [
			row.address_line1,
			row.address_line2,
			row.city,
			row.state,
			row.pincode,
			row.country,
		]
		out.append(
			{
				**row,
				"customer": customer,
				"server_address_name": row.name,
				"server_customer_name": customer,
				"server_modified": str(row.modified) if row.modified else None,
				"display": ", ".join([_cstr(p) for p in display_parts if _cstr(p)]),
				"nozom_delivery_location_link": sanitize_location_url(
					row.get("nozom_delivery_location_link")
				),
			}
		)
	return out


def _find_address_by_local_id(local_address_id):
	if not local_address_id or not frappe.db.has_column("Address", "nozom_local_address_id"):
		return None
	return frappe.db.get_value("Address", {"nozom_local_address_id": local_address_id}, "name")


def _find_address_by_idempotency(key):
	if not key or not frappe.db.has_column("Address", "nozom_address_idempotency_key"):
		return None
	return frappe.db.get_value("Address", {"nozom_address_idempotency_key": key}, "name")


def _resolve_customer_name(payload):
	server = _cstr(payload.get("server_customer_name"))
	if server:
		return server
	customer = _cstr(payload.get("customer"))
	if customer and not customer.startswith("LOC-CUST-"):
		return customer
	local_customer_id = _cstr(payload.get("local_customer_id"))
	if local_customer_id and frappe.db.has_column("Customer", "nozom_local_customer_id"):
		mapped = frappe.db.get_value("Customer", {"nozom_local_customer_id": local_customer_id}, "name")
		if mapped:
			return mapped
	return None


def _default_country(payload=None):
	country = _cstr((payload or {}).get("country"))
	if country:
		return country
	return frappe.db.get_single_value("System Settings", "country") or "United Arab Emirates"


def _sync_one_address(payload):
	from nozom_pos.offline_setup import ensure_customer_offline_fields

	ensure_customer_offline_fields()

	local_id = payload.get("local_address_id") or payload.get("id")
	key = _cstr(payload.get("idempotency_key"))
	action = (_cstr(payload.get("action")) or "CREATE").upper()

	if not key:
		return {
			"status": "FAILED",
			"local_address_id": local_id,
			"error_code": "VALIDATION_FAILED",
			"message": _("Idempotency key is required."),
		}

	existing = _find_address_by_idempotency(key) or _find_address_by_local_id(local_id)
	if existing and action == "CREATE":
		return {
			"status": "SYNCED",
			"already_existed": True,
			"server_address_name": existing,
			"local_address_id": local_id,
			"idempotency_key": key,
			"server_customer_name": _resolve_customer_name(payload),
			"modified": str(frappe.db.get_value("Address", existing, "modified") or ""),
		}

	customer_name = _resolve_customer_name(payload)
	if not customer_name:
		return {
			"status": "FAILED",
			"local_address_id": local_id,
			"error_code": "CUSTOMER_PENDING",
			"message": _("Customer must sync before Address."),
		}

	line1 = _cstr(payload.get("address_line1"))
	if not line1:
		return {
			"status": "FAILED",
			"local_address_id": local_id,
			"error_code": "VALIDATION_FAILED",
			"message": _("Address Line 1 is required."),
		}

	location = sanitize_location_url(payload.get("nozom_delivery_location_link"))
	savepoint = f"nozom_addr_{frappe.generate_hash(length=10)}"
	frappe.db.savepoint(savepoint)

	try:
		frappe.has_permission("Address", "create" if action == "CREATE" else "write", throw=True)

		values = {
			"address_title": _cstr(payload.get("address_title")) or customer_name,
			"address_type": "Shipping",
			"address_line1": line1,
			"address_line2": _cstr(payload.get("address_line2")),
			"city": _cstr(payload.get("city")) or line1 or "N/A",
			"state": _cstr(payload.get("state")),
			"pincode": _cstr(payload.get("pincode")),
			"country": _default_country(payload),
			"phone": _cstr(payload.get("phone")),
			"is_primary_address": cint(payload.get("is_primary_address")),
			"is_shipping_address": cint(payload.get("is_shipping_address") if payload.get("is_shipping_address") is not None else 1),
		}
		if frappe.db.has_column("Address", "nozom_delivery_location_link"):
			values["nozom_delivery_location_link"] = location

		if action == "UPDATE":
			server_name = _cstr(payload.get("server_address_name")) or existing
			if not server_name or server_name.startswith("LOC-ADDR-"):
				frappe.throw(_("Server address name is required for update."))

			# Conflict: server changed after local cache
			cached_modified = _cstr(payload.get("server_modified"))
			if cached_modified:
				current_modified = frappe.db.get_value("Address", server_name, "modified")
				if current_modified and str(current_modified) != cached_modified:
					try:
						if get_datetime(current_modified) > get_datetime(cached_modified):
							return {
								"status": "CONFLICT",
								"local_address_id": local_id,
								"server_address_name": server_name,
								"idempotency_key": key,
								"error_code": "ADDRESS_CHANGED",
								"message": _(
									"Address {0} changed on server after local edit. Local version preserved."
								).format(server_name),
							}
					except Exception:
						pass

			doc = frappe.get_doc("Address", server_name)
			for field, value in values.items():
				doc.set(field, value)
			doc.save()
			return {
				"status": "SYNCED",
				"already_existed": False,
				"server_address_name": doc.name,
				"local_address_id": local_id,
				"idempotency_key": key,
				"server_customer_name": customer_name,
				"modified": str(doc.modified),
			}

		doc = frappe.get_doc(
			{
				"doctype": "Address",
				**values,
				"links": [{"link_doctype": "Customer", "link_name": customer_name}],
			}
		)
		if key and frappe.db.has_column("Address", "nozom_address_idempotency_key"):
			doc.nozom_address_idempotency_key = key
		if local_id and frappe.db.has_column("Address", "nozom_local_address_id"):
			doc.nozom_local_address_id = local_id
		doc.insert()

		if frappe.db.has_column("Customer", "customer_primary_address"):
			if not frappe.db.get_value("Customer", customer_name, "customer_primary_address"):
				frappe.db.set_value(
					"Customer",
					customer_name,
					"customer_primary_address",
					doc.name,
					update_modified=False,
				)

		return {
			"status": "SYNCED",
			"already_existed": False,
			"server_address_name": doc.name,
			"local_address_id": local_id,
			"idempotency_key": key,
			"server_customer_name": customer_name,
			"modified": str(doc.modified),
		}
	except Exception as e:
		frappe.db.rollback(save_point=savepoint)
		frappe.log_error(frappe.get_traceback(), "NOZOM POS Address Sync")
		return {
			"status": "FAILED",
			"local_address_id": local_id,
			"idempotency_key": key,
			"error_code": "SYNC_FAILED",
			"message": str(e),
		}


@frappe.whitelist()
def sync_addresses(payloads):
	"""Idempotent offline Address create/update sync (after Customer)."""
	if isinstance(payloads, str):
		payloads = frappe.parse_json(payloads)
	if not isinstance(payloads, list):
		frappe.throw(_("Invalid address sync payload."))

	results = []
	for raw in payloads:
		payload = raw
		if isinstance(raw, str):
			payload = frappe.parse_json(raw)
		if payload.get("payload") and isinstance(payload.get("payload"), dict):
			payload = {**payload.get("payload"), **payload}
		results.append(_sync_one_address(payload))

	return {
		"results": results,
		"synced": len([r for r in results if r.get("status") == "SYNCED"]),
		"failed": len([r for r in results if r.get("status") == "FAILED"]),
		"conflicts": len([r for r in results if r.get("status") == "CONFLICT"]),
	}
