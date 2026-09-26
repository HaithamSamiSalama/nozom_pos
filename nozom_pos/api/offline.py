import frappe
from frappe import _
from frappe.utils import cint, flt, get_datetime, nowdate, nowtime


ALLOWED_DOCTYPES = ("POS Invoice", "Sales Invoice")
MAX_BATCH_SIZE = 25
LOCAL_CUSTOMER_PREFIX = "LOC-CUST-"


def _parse_payload(payload):
	if isinstance(payload, str):
		payload = frappe.parse_json(payload)
	if not isinstance(payload, dict):
		frappe.throw(_("Invalid offline transaction payload."))
	return payload


def _parse_payload_list(payloads):
	if isinstance(payloads, str):
		payloads = frappe.parse_json(payloads)
	if not isinstance(payloads, list):
		frappe.throw(_("Invalid offline batch payload."))
	return payloads


def _find_by_idempotency_key(key):
	if not key:
		return None
	for doctype in ALLOWED_DOCTYPES:
		name = frappe.db.get_value(doctype, {"nozom_idempotency_key": key}, "name")
		if name:
			return {"doctype": doctype, "name": name}
	return None


def _find_customer_by_idempotency(key):
	if not key:
		return None
	# Prefer custom field if present; fall back to naming series match via remarks/meta store
	if frappe.db.has_column("Customer", "nozom_customer_idempotency_key"):
		name = frappe.db.get_value("Customer", {"nozom_customer_idempotency_key": key}, "name")
		if name:
			return name
	return None


def _validate_offline_payload(payload):
	key = (payload.get("idempotency_key") or "").strip()
	if not key:
		frappe.throw(_("Idempotency key is required."))

	if not payload.get("pos_profile"):
		frappe.throw(_("POS Profile is required."))
	if not payload.get("company"):
		frappe.throw(_("Company is required."))
	if not payload.get("customer"):
		frappe.throw(_("Customer is required."))

	customer = cstr_safe(payload.get("customer"))
	if customer.startswith(LOCAL_CUSTOMER_PREFIX):
		frappe.throw(
			_("Local customer {0} must be synced before the invoice.").format(customer),
			title=_("Offline Sync Conflict"),
		)

	items = payload.get("items") or []
	if not items:
		frappe.throw(_("At least one item is required."))

	for row in items:
		serial_no = cstr_safe(row.get("serial_no"))
		batch_no = cstr_safe(row.get("batch_no"))
		if serial_no in ("null", "undefined", "None"):
			serial_no = ""
		if batch_no in ("null", "undefined", "None"):
			batch_no = ""
		if serial_no or batch_no:
			frappe.throw(
				_("Serial/Batch items cannot be synced from offline queue in this phase."),
				title=_("Offline Sync Conflict"),
			)
		if flt(row.get("qty")) <= 0:
			frappe.throw(_("Item quantity must be greater than zero."))
		if not row.get("item_code"):
			frappe.throw(_("Item code is required."))

	# Positive payment rows only. Empty list = unpaid/credit sale (allowed when profile permits).
	payments = [p for p in (payload.get("payments") or []) if flt(p.get("amount")) > 0]

	paid = flt(payload.get("paid_amount"))
	if payments:
		paid = sum(flt(p.get("amount")) for p in payments)

	total = flt(payload.get("rounded_total")) or flt(payload.get("grand_total"))
	allow_partial = cint(
		frappe.db.get_value("POS Profile", payload.get("pos_profile"), "allow_partial_payment")
	)

	if total > 0 and paid + 0.0001 < total and not allow_partial:
		frappe.throw(
			_("Partial Payment in POS Transactions are not allowed."),
			title=_("Offline Sync Conflict"),
		)

	return key, items, payments


def cstr_safe(value):
	if value is None:
		return ""
	return str(value).strip()


def _resolve_doctype(payload):
	doctype = payload.get("invoice_doctype")
	if doctype in ALLOWED_DOCTYPES:
		return doctype
	return frappe.db.get_single_value("POS Settings", "invoice_type") or "POS Invoice"


def _apply_item_row(doc, row):
	return doc.append(
		"items",
		{
			"item_code": row.get("item_code"),
			"qty": flt(row.get("qty")),
			"uom": row.get("uom"),
			"rate": flt(row.get("rate")),
			"price_list_rate": flt(row.get("price_list_rate") or row.get("rate")),
			"discount_percentage": flt(row.get("discount_percentage")),
			"discount_amount": flt(row.get("discount_amount")),
			"warehouse": row.get("warehouse") or doc.set_warehouse,
			"notes": row.get("notes") or "",
			"use_serial_batch_fields": 1,
		},
	)


def _conflict_or_failed(key, error_text, local_id=None):
	lower = (error_text or "").lower()
	validation_tokens = (
		"validationerror",
		"validation error",
		"at least one mode of payment",
		"mandatory",
		"permissionerror",
		"not permitted",
		"insufficient permission",
		"cannot be",
		"is required",
	)
	conflict_tokens = (
		"stock",
		"insufficient",
		"not available",
		"serial",
		"batch",
		"opening entry",
		"disabled",
		"credit limit",
		"offline sync conflict",
		"partial payment",
		"tax id",
		"already exists",
		"duplicate",
	)
	if any(token in lower for token in validation_tokens):
		return {
			"status": "CONFLICT",
			"idempotency_key": key,
			"local_uuid": local_id,
			"error_code": "VALIDATION_FAILED",
			"message": error_text,
		}
	status = "CONFLICT" if any(token in lower for token in conflict_tokens) else "FAILED"
	return {
		"status": status,
		"idempotency_key": key,
		"local_uuid": local_id,
		"error_code": "BUSINESS_CONFLICT" if status == "CONFLICT" else "SYNC_FAILED",
		"message": error_text,
	}


def _seed_zero_payment_modes(doc):
	"""Deprecated: unpaid/credit sales must not invent Cash=0 rows.

	Kept as a no-op so older call sites remain safe. validate_mode_of_payment /
	validate_pos_paid_amount now allow empty payments when paid_amount is 0.
	"""
	return


def _create_and_submit(payload, key, items, payments):
	doctype = _resolve_doctype(payload)
	if doctype not in ALLOWED_DOCTYPES:
		frappe.throw(_("Unsupported invoice type: {0}").format(doctype))

	frappe.has_permission(doctype, "create", throw=True)
	frappe.has_permission(doctype, "submit", throw=True)

	doc = frappe.new_doc(doctype)
	doc.is_pos = 1
	if doctype == "Sales Invoice":
		doc.is_created_using_pos = 1

	doc.company = payload.get("company")
	doc.pos_profile = payload.get("pos_profile")
	doc.customer = payload.get("customer")
	doc.selling_price_list = payload.get("selling_price_list")
	doc.currency = payload.get("currency")
	doc.conversion_rate = flt(payload.get("conversion_rate") or 1)
	doc.order_notes = payload.get("order_notes") or ""
	doc.remarks = payload.get("remarks") or _("Synced from NOZOM POS offline queue ({0})").format(
		payload.get("local_receipt_no") or key
	)
	if payload.get("nozom_order_number"):
		doc.nozom_order_number = payload.get("nozom_order_number")
	doc.nozom_idempotency_key = key
	doc.ignore_pricing_rule = 1

	# Historical delivery snapshots (do not live-link updates later)
	from nozom_pos.print_utils import sanitize_location_url

	phone_snap = cstr_safe(
		payload.get("nozom_customer_phone_snapshot") or payload.get("contact_mobile")
	)
	addr_display = cstr_safe(payload.get("address_display") or payload.get("shipping_address"))
	title_snap = cstr_safe(payload.get("nozom_address_title_snapshot"))
	location_snap = sanitize_location_url(payload.get("nozom_delivery_location_link_snapshot"))
	address_name = cstr_safe(payload.get("shipping_address_name") or payload.get("customer_address"))
	if address_name.startswith("LOC-ADDR-"):
		address_name = ""

	if phone_snap:
		doc.contact_mobile = phone_snap
		if hasattr(doc, "nozom_customer_phone_snapshot"):
			doc.nozom_customer_phone_snapshot = phone_snap
	if addr_display:
		doc.address_display = addr_display
		doc.shipping_address = addr_display
	if title_snap and hasattr(doc, "nozom_address_title_snapshot"):
		doc.nozom_address_title_snapshot = title_snap
	if location_snap and hasattr(doc, "nozom_delivery_location_link_snapshot"):
		doc.nozom_delivery_location_link_snapshot = location_snap
	if address_name:
		doc.customer_address = address_name
		doc.shipping_address_name = address_name

	if payload.get("created_at"):
		try:
			created = get_datetime(payload.get("created_at"))
			doc.set_posting_time = 1
			doc.posting_date = created.date()
			doc.posting_time = created.strftime("%H:%M:%S")
		except Exception:
			doc.posting_date = nowdate()
			doc.posting_time = nowtime()

	doc.set("payments", [])
	for pay in payments:
		doc.append(
			"payments",
			{
				"mode_of_payment": pay.get("mode_of_payment"),
				"amount": flt(pay.get("amount")),
			},
		)
	# Unpaid/credit: leave payments empty — do not invent Cash=0 rows.

	doc.set("items", [])
	for row in items:
		_apply_item_row(doc, row)

	if flt(payload.get("additional_discount_percentage")):
		doc.additional_discount_percentage = flt(payload.get("additional_discount_percentage"))
	elif flt(payload.get("discount_amount")):
		doc.discount_amount = flt(payload.get("discount_amount"))

	doc.set_missing_values(for_validate=True)

	for idx, row in enumerate(items):
		if idx >= len(doc.items):
			break
		target = doc.items[idx]
		target.rate = flt(row.get("rate"))
		if row.get("notes"):
			target.notes = row.get("notes")
		if flt(row.get("discount_percentage")):
			target.discount_percentage = flt(row.get("discount_percentage"))
		elif flt(row.get("discount_amount")):
			target.discount_amount = flt(row.get("discount_amount"))

	# Re-apply payment amounts after set_missing_values (which may touch payment table).
	if payments:
		doc.set("payments", [])
		for pay in payments:
			doc.append(
				"payments",
				{
					"mode_of_payment": pay.get("mode_of_payment"),
					"amount": flt(pay.get("amount")),
				},
			)
	else:
		# Ensure unpaid stays unpaid — strip any profile-seeded zero mop rows.
		doc.set("payments", [])
		doc.paid_amount = 0
		doc.base_paid_amount = 0
		doc.change_amount = 0

	doc.flags.ignore_permissions = False
	doc.insert()
	doc.submit()
	return doc


def _sync_one_payload(payload):
	"""Sync one offline sale. Safe for batch use via savepoints."""
	local_id = payload.get("local_uuid") or payload.get("id")
	try:
		key, items, payments = _validate_offline_payload(payload)
	except Exception as e:
		return {
			"status": "FAILED",
			"idempotency_key": (payload.get("idempotency_key") or "").strip() or None,
			"local_uuid": local_id,
			"error_code": "VALIDATION_FAILED",
			"message": str(e),
		}

	existing = _find_by_idempotency_key(key)
	if existing:
		return {
			"status": "SYNCED",
			"already_existed": True,
			"doctype": existing["doctype"],
			"name": existing["name"],
			"idempotency_key": key,
			"local_uuid": local_id,
			"local_receipt_no": payload.get("local_receipt_no"),
		}

	savepoint = f"nozom_offline_{frappe.generate_hash(length=10)}"
	frappe.db.savepoint(savepoint)

	try:
		doc = _create_and_submit(payload, key, items, payments)
	except frappe.DuplicateEntryError:
		frappe.db.rollback(save_point=savepoint)
		existing = _find_by_idempotency_key(key)
		if existing:
			return {
				"status": "SYNCED",
				"already_existed": True,
				"doctype": existing["doctype"],
				"name": existing["name"],
				"idempotency_key": key,
				"local_uuid": local_id,
				"local_receipt_no": payload.get("local_receipt_no"),
			}
		return _conflict_or_failed(key, _("Duplicate entry while syncing."), local_id)
	except Exception as e:
		frappe.db.rollback(save_point=savepoint)
		# Validation / permission prove the backend is online — never present as "waiting for internet".
		if isinstance(e, frappe.ValidationError) or getattr(e, "__class__", type).__name__ in (
			"ValidationError",
			"MandatoryError",
			"PermissionError",
			"LinkValidationError",
		):
			return {
				"status": "CONFLICT",
				"idempotency_key": key,
				"local_uuid": local_id,
				"error_code": "VALIDATION_FAILED",
				"message": str(e),
			}
		result = _conflict_or_failed(key, str(e), local_id)
		if result["status"] == "FAILED":
			frappe.log_error(frappe.get_traceback(), "NOZOM POS Offline Sync")
		return result

	return {
		"status": "SYNCED",
		"already_existed": False,
		"doctype": doc.doctype,
		"name": doc.name,
		"idempotency_key": key,
		"local_uuid": local_id,
		"local_receipt_no": payload.get("local_receipt_no"),
		"paid_amount": flt(doc.paid_amount),
		"outstanding_amount": flt(doc.outstanding_amount),
		"grand_total": flt(doc.rounded_total) or flt(doc.grand_total),
	}


def _find_existing_customer_conflict(payload):
	"""Detect TRN / mobile collisions without overwriting server data."""
	tax_id = cstr_safe(payload.get("tax_id"))
	mobile = cstr_safe(payload.get("mobile_no"))
	conflicts = []

	if tax_id and frappe.db.has_column("Customer", "tax_id"):
		existing = frappe.db.get_value("Customer", {"tax_id": tax_id}, ["name", "customer_name"], as_dict=True)
		if existing:
			conflicts.append(
				_("Tax ID / TRN {0} already belongs to customer {1} ({2}).").format(
					tax_id, existing.name, existing.customer_name
				)
			)

	if mobile and frappe.db.has_column("Customer", "mobile_no"):
		# Soft signal only when tax_id did not already conflict on a different customer
		pass

	return conflicts


def _cstr(value):
	return (value or "").strip() if isinstance(value, str) else str(value or "").strip()


def _default_address_country(payload=None):
	country = _cstr((payload or {}).get("country"))
	if country:
		return country
	company = _cstr((payload or {}).get("company"))
	if company and frappe.db.exists("Company", company):
		return frappe.db.get_value("Company", company, "country") or "United Arab Emirates"
	return frappe.db.get_single_value("System Settings", "country") or "United Arab Emirates"


def _find_address_by_local_id(local_address_id):
	if not local_address_id or not frappe.db.has_column("Address", "nozom_local_address_id"):
		return None
	return frappe.db.get_value("Address", {"nozom_local_address_id": local_address_id}, "name")


def _find_address_by_idempotency(key):
	if not key or not frappe.db.has_column("Address", "nozom_address_idempotency_key"):
		return None
	return frappe.db.get_value("Address", {"nozom_address_idempotency_key": key}, "name")


def _find_primary_address_for_customer(customer_name):
	if not customer_name:
		return None
	# Prefer Customer.customer_primary_address
	if frappe.db.has_column("Customer", "customer_primary_address"):
		primary = frappe.db.get_value("Customer", customer_name, "customer_primary_address")
		if primary:
			return primary
	# Fallback: first Address linked to Customer
	links = frappe.get_all(
		"Dynamic Link",
		filters={"link_doctype": "Customer", "link_name": customer_name, "parenttype": "Address"},
		fields=["parent"],
		limit=1,
	)
	return links[0].parent if links else None


def _sync_customer_address(customer_name, payload):
	"""
	Create or update Address linked to Customer after customer sync.
	Never creates Address against a local UUID — always requires server customer name.
	Idempotent via nozom_local_address_id / nozom_address_idempotency_key.
	"""
	line1 = _cstr(payload.get("address_line1") or payload.get("primary_address"))
	if not customer_name or not line1:
		return None

	local_address_id = _cstr(payload.get("local_address_id"))
	server_address_name = _cstr(payload.get("server_address_name"))
	addr_key = None
	if local_address_id:
		addr_key = f"addr:{local_address_id}"
	elif payload.get("idempotency_key"):
		addr_key = f"addr-for:{payload.get('idempotency_key')}"

	existing = None
	if server_address_name and frappe.db.exists("Address", server_address_name):
		existing = server_address_name
	if not existing and local_address_id:
		existing = _find_address_by_local_id(local_address_id)
	if not existing and addr_key:
		existing = _find_address_by_idempotency(addr_key)
	if not existing:
		existing = _find_primary_address_for_customer(customer_name)

	city = _cstr(payload.get("city")) or line1 or "N/A"
	country = _default_address_country(payload)
	values = {
		"address_line1": line1,
		"address_line2": _cstr(payload.get("address_line2")),
		"city": city,
		"state": _cstr(payload.get("state")),
		"pincode": _cstr(payload.get("pincode")),
		"country": country,
		"is_primary_address": 1,
		"is_shipping_address": 1,
	}

	if existing:
		doc = frappe.get_doc("Address", existing)
		for field, value in values.items():
			doc.set(field, value)
		doc.save()
		return doc.name

	doc = frappe.get_doc(
		{
			"doctype": "Address",
			"address_title": _cstr(payload.get("customer_name")) or customer_name,
			"address_type": "Billing",
			**values,
			"links": [{"link_doctype": "Customer", "link_name": customer_name}],
		}
	)
	if addr_key and frappe.db.has_column("Address", "nozom_address_idempotency_key"):
		doc.nozom_address_idempotency_key = addr_key
	if local_address_id and frappe.db.has_column("Address", "nozom_local_address_id"):
		doc.nozom_local_address_id = local_address_id
	doc.insert()

	# Point Customer.customer_primary_address at the new Address when empty
	if frappe.db.has_column("Customer", "customer_primary_address"):
		current_primary = frappe.db.get_value("Customer", customer_name, "customer_primary_address")
		if not current_primary:
			frappe.db.set_value("Customer", customer_name, "customer_primary_address", doc.name, update_modified=False)

	return doc.name


def _customer_sync_result(status, local_id, key, server_name, already=False, address_name=None, **extra):
	out = {
		"status": status,
		"already_existed": already,
		"server_customer_name": server_name,
		"local_customer_id": local_id,
		"idempotency_key": key,
		"server_address_name": address_name,
	}
	out.update(extra)
	return out


def _sync_one_customer(payload):
	local_id = payload.get("local_customer_id") or payload.get("id")
	key = cstr_safe(payload.get("idempotency_key"))
	action = (payload.get("action") or "CREATE").upper()

	if not key:
		return {
			"status": "FAILED",
			"local_customer_id": local_id,
			"error_code": "VALIDATION_FAILED",
			"message": _("Idempotency key is required."),
		}

	existing = _find_customer_by_idempotency(key)
	if existing:
		try:
			address_name = _sync_customer_address(existing, payload)
			return _customer_sync_result(
				"SYNCED", local_id, key, existing, already=True, address_name=address_name
			)
		except Exception as e:
			result = _conflict_or_failed(key, str(e), local_id)
			result["local_customer_id"] = local_id
			result["server_customer_name"] = existing
			return result

	# Mapped local → server from a previous successful create
	if action == "CREATE" and local_id and frappe.db.has_column("Customer", "nozom_local_customer_id"):
		mapped = frappe.db.get_value("Customer", {"nozom_local_customer_id": local_id}, "name")
		if mapped:
			try:
				address_name = _sync_customer_address(mapped, payload)
				return _customer_sync_result(
					"SYNCED", local_id, key, mapped, already=True, address_name=address_name
				)
			except Exception as e:
				result = _conflict_or_failed(key, str(e), local_id)
				result["local_customer_id"] = local_id
				result["server_customer_name"] = mapped
				return result

	savepoint = f"nozom_cust_{frappe.generate_hash(length=10)}"
	frappe.db.savepoint(savepoint)

	try:
		frappe.has_permission("Customer", "create" if action == "CREATE" else "write", throw=True)

		if action == "UPDATE":
			server_name = cstr_safe(payload.get("server_customer_name"))
			if not server_name or server_name.startswith(LOCAL_CUSTOMER_PREFIX):
				frappe.throw(_("Server customer name is required for update."))

			if cint(frappe.db.get_value("Customer", server_name, "disabled")):
				frappe.throw(_("Customer {0} is disabled on the server.").format(server_name))

			# Conflict: do not silently overwrite if tax_id belongs to another customer
			tax_id = cstr_safe(payload.get("tax_id"))
			if tax_id and frappe.db.has_column("Customer", "tax_id"):
				owner = frappe.db.get_value("Customer", {"tax_id": tax_id}, "name")
				if owner and owner != server_name:
					frappe.throw(
						_("Tax ID / TRN {0} already belongs to customer {1}.").format(tax_id, owner),
						title=_("Offline Sync Conflict"),
					)

			doc = frappe.get_doc("Customer", server_name)
			for field in ("customer_name", "mobile_no", "email_id", "tax_id"):
				if payload.get(field) is not None:
					doc.set(field, payload.get(field) or "")
			doc.save()
			address_name = _sync_customer_address(doc.name, payload)
			return _customer_sync_result(
				"SYNCED", local_id, key, doc.name, already=False, address_name=address_name
			)

		# CREATE
		conflicts = _find_existing_customer_conflict(payload)
		if conflicts:
			frappe.throw(conflicts[0], title=_("Offline Sync Conflict"))

		doc = frappe.new_doc("Customer")
		doc.customer_name = payload.get("customer_name")
		doc.customer_type = payload.get("customer_type") or "Individual"
		if payload.get("customer_group"):
			doc.customer_group = payload.get("customer_group")
		if payload.get("territory"):
			doc.territory = payload.get("territory")
		doc.mobile_no = payload.get("mobile_no") or ""
		doc.email_id = payload.get("email_id") or ""
		if payload.get("tax_id") is not None:
			doc.tax_id = payload.get("tax_id") or ""
		if frappe.db.has_column("Customer", "nozom_customer_idempotency_key"):
			doc.nozom_customer_idempotency_key = key
		if frappe.db.has_column("Customer", "nozom_local_customer_id"):
			doc.nozom_local_customer_id = local_id
		doc.insert()

		# Address AFTER customer — never link Address to local UUID
		address_name = _sync_customer_address(doc.name, payload)
		return _customer_sync_result(
			"SYNCED", local_id, key, doc.name, already=False, address_name=address_name
		)
	except Exception as e:
		frappe.db.rollback(save_point=savepoint)
		result = _conflict_or_failed(key, str(e), local_id)
		result["local_customer_id"] = local_id
		if result["status"] == "FAILED":
			frappe.log_error(frappe.get_traceback(), "NOZOM POS Customer Sync")
		return result


@frappe.whitelist()
def sync_transaction(payload):
	"""
	Idempotent sync for one offline-completed POS sale.

	Creates at most one POS Invoice / Sales Invoice per idempotency_key.
	"""
	from nozom_pos.offline_setup import ensure_idempotency_fields

	ensure_idempotency_fields()
	payload = _parse_payload(payload)
	return _sync_one_payload(payload)


@frappe.whitelist()
def sync_transactions(payloads):
	"""
	Batch sync for offline queue (Phase D).

	- Not one giant atomic DB transaction
	- Per-sale savepoint so partial success is kept
	- Returns one result object per input payload
	"""
	from nozom_pos.offline_setup import ensure_idempotency_fields

	ensure_idempotency_fields()
	payloads = _parse_payload_list(payloads)

	if not payloads:
		return {"results": [], "batch_size": 0}

	if len(payloads) > MAX_BATCH_SIZE:
		payloads = payloads[:MAX_BATCH_SIZE]

	results = []
	for raw in payloads:
		try:
			payload = _parse_payload(raw)
		except Exception as e:
			results.append(
				{
					"status": "FAILED",
					"idempotency_key": None,
					"local_uuid": None,
					"error_code": "INVALID_PAYLOAD",
					"message": str(e),
				}
			)
			continue

		results.append(_sync_one_payload(payload))

	return {
		"results": results,
		"batch_size": len(results),
		"synced": len([r for r in results if r.get("status") == "SYNCED"]),
		"failed": len([r for r in results if r.get("status") == "FAILED"]),
		"conflicts": len([r for r in results if r.get("status") == "CONFLICT"]),
	}


@frappe.whitelist()
def sync_customers(payloads):
	"""Idempotent offline customer create/update sync."""
	from nozom_pos.offline_setup import ensure_customer_offline_fields

	ensure_customer_offline_fields()
	payloads = _parse_payload_list(payloads)
	results = []
	for raw in payloads:
		try:
			payload = _parse_payload(raw)
		except Exception as e:
			results.append(
				{
					"status": "FAILED",
					"error_code": "INVALID_PAYLOAD",
					"message": str(e),
				}
			)
			continue
		# Flatten nested payload from client queue rows
		if payload.get("payload") and isinstance(payload.get("payload"), dict):
			merged = {**payload.get("payload"), **payload}
			payload = merged
		results.append(_sync_one_customer(payload))

	return {
		"results": results,
		"synced": len([r for r in results if r.get("status") == "SYNCED"]),
		"failed": len([r for r in results if r.get("status") == "FAILED"]),
		"conflicts": len([r for r in results if r.get("status") == "CONFLICT"]),
	}


def _find_draft_by_idempotency(key):
	if not key:
		return None
	for doctype in ALLOWED_DOCTYPES:
		name = frappe.db.get_value(
			doctype, {"nozom_idempotency_key": key, "docstatus": 0}, "name"
		)
		if name:
			return {"doctype": doctype, "name": name}
	return None


def _sync_one_draft(payload):
	"""Create or update a server Draft (docstatus 0). Never auto-submit."""
	local_id = payload.get("local_uuid") or payload.get("id")
	key = cstr_safe(payload.get("idempotency_key"))
	if not key:
		return {
			"status": "FAILED",
			"local_uuid": local_id,
			"error_code": "VALIDATION_FAILED",
			"message": _("Idempotency key is required."),
		}

	existing = _find_draft_by_idempotency(key)
	server_name = cstr_safe(payload.get("server_draft_name"))
	doctype = payload.get("invoice_doctype") or _resolve_doctype(payload)

	savepoint = f"nozom_draft_{frappe.generate_hash(length=10)}"
	frappe.db.savepoint(savepoint)

	try:
		# Prefer updating an already-mapped draft
		if server_name and frappe.db.exists(doctype, server_name):
			docstatus = frappe.db.get_value(doctype, server_name, "docstatus")
			if cint(docstatus) != 0:
				frappe.throw(
					_("Server draft {0} is no longer a Draft (docstatus={1}).").format(
						server_name, docstatus
					),
					title=_("Offline Sync Conflict"),
				)
			doc = frappe.get_doc(doctype, server_name)
		elif existing:
			doc = frappe.get_doc(existing["doctype"], existing["name"])
		else:
			frappe.has_permission(doctype, "create", throw=True)
			doc = frappe.new_doc(doctype)
			doc.is_pos = 1
			if doctype == "Sales Invoice":
				doc.is_created_using_pos = 1
			doc.nozom_idempotency_key = key

		customer = cstr_safe(payload.get("customer"))
		if customer.startswith(LOCAL_CUSTOMER_PREFIX):
			frappe.throw(
				_("Local customer must sync before the draft."),
				title=_("Offline Sync Conflict"),
			)

		doc.company = payload.get("company")
		doc.pos_profile = payload.get("pos_profile")
		doc.customer = customer
		doc.selling_price_list = payload.get("selling_price_list")
		doc.currency = payload.get("currency")
		doc.conversion_rate = flt(payload.get("conversion_rate") or 1)
		doc.order_notes = payload.get("order_notes") or ""
		if payload.get("nozom_order_number"):
			doc.nozom_order_number = payload.get("nozom_order_number")
		doc.ignore_pricing_rule = 1

		doc.set("items", [])
		for row in payload.get("items") or []:
			_apply_item_row(doc, row)

		if flt(payload.get("additional_discount_percentage")):
			doc.additional_discount_percentage = flt(payload.get("additional_discount_percentage"))
		elif flt(payload.get("discount_amount")):
			doc.discount_amount = flt(payload.get("discount_amount"))

		doc.set_missing_values(for_validate=True)

		if doc.name and not doc.is_new():
			doc.save()
		else:
			doc.insert()

		# Remain Draft — never submit
		return {
			"status": "SYNCED",
			"doctype": doc.doctype,
			"name": doc.name,
			"local_uuid": local_id,
			"idempotency_key": key,
			"docstatus": 0,
		}
	except Exception as e:
		frappe.db.rollback(save_point=savepoint)
		result = _conflict_or_failed(key, str(e), local_id)
		if result["status"] == "FAILED":
			frappe.log_error(frappe.get_traceback(), "NOZOM POS Draft Sync")
		return result


@frappe.whitelist()
def sync_drafts(payloads):
	"""Idempotent sync of Local Drafts → ERPNext Draft invoices (not submitted)."""
	from nozom_pos.offline_setup import ensure_idempotency_fields

	ensure_idempotency_fields()
	payloads = _parse_payload_list(payloads)
	results = []
	for raw in payloads:
		try:
			payload = _parse_payload(raw)
		except Exception as e:
			results.append(
				{
					"status": "FAILED",
					"error_code": "INVALID_PAYLOAD",
					"message": str(e),
				}
			)
			continue
		results.append(_sync_one_draft(payload))

	return {
		"results": results,
		"synced": len([r for r in results if r.get("status") == "SYNCED"]),
		"failed": len([r for r in results if r.get("status") == "FAILED"]),
		"conflicts": len([r for r in results if r.get("status") == "CONFLICT"]),
	}


@frappe.whitelist()
def ensure_offline_fields():
	"""Callable from client/migrate to ensure offline custom fields exist."""
	from nozom_pos.offline_setup import (
		ensure_customer_offline_fields,
		ensure_idempotency_fields,
		ensure_order_number_fields,
	)

	return {
		"idempotency": ensure_idempotency_fields(),
		"order_number": ensure_order_number_fields(),
		"customer": ensure_customer_offline_fields(),
	}
