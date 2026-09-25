frappe.provide("nozom_pos.offline");

/**
 * Multi-address cache + offline create/update queue for NOZOM POS.
 * Local IDs: LOC-ADDR-<uuid>
 * Never invents ERPNext Address names.
 */
nozom_pos.offline.address_store = (() => {
	const db = () => nozom_pos.offline.db;
	const LOCAL_PREFIX = "LOC-ADDR-";
	const FIELD = "nozom_delivery_location_link";

	function uuid() {
		if (window.crypto?.randomUUID) return window.crypto.randomUUID();
		return `${Date.now()}-${frappe.utils.get_random(12)}`;
	}

	function is_local_id(name) {
		return Boolean(name && String(name).startsWith(LOCAL_PREFIX));
	}

	function new_local_id() {
		return `${LOCAL_PREFIX}${uuid()}`;
	}

	function sanitize_location(url) {
		return nozom_pos.offline.qr?.sanitize?.(url) || "";
	}

	function format_display(a = {}) {
		const parts = [a.address_line1, a.address_line2, a.city, a.state, a.pincode, a.country]
			.map((v) => cstr(v || "").trim())
			.filter(Boolean);
		return parts.join(", ");
	}

	function normalize(addr, pos_profile) {
		const name = addr.name || addr.server_address_name || addr.local_address_id;
		const customer = addr.customer || addr.link_name || addr.local_customer_id || "";
		const location = sanitize_location(
			addr[FIELD] || addr.nozom_delivery_location_link || addr.delivery_location_link || ""
		);
		const display = cstr(addr.display || addr.address_display || "").trim() || format_display(addr);

		return {
			id: `${pos_profile}::${name}`,
			pos_profile,
			name,
			customer,
			local_customer_id: nozom_pos.offline.customer_store?.is_local_id?.(customer)
				? customer
				: addr.local_customer_id || null,
			server_customer_name:
				addr.server_customer_name ||
				(nozom_pos.offline.customer_store?.is_local_id?.(customer) ? null : customer),
			address_title: cstr(addr.address_title || "").trim() || __("Address"),
			address_line1: cstr(addr.address_line1 || "").trim(),
			address_line2: cstr(addr.address_line2 || "").trim(),
			city: cstr(addr.city || "").trim(),
			state: cstr(addr.state || "").trim(),
			pincode: cstr(addr.pincode || "").trim(),
			country: cstr(addr.country || "").trim(),
			phone: cstr(addr.phone || "").trim(),
			nozom_delivery_location_link: location,
			display,
			is_primary_address: cint(addr.is_primary_address),
			is_shipping_address: cint(addr.is_shipping_address),
			is_local: is_local_id(name) || cint(addr.is_local) === 1,
			server_address_name: addr.server_address_name || (is_local_id(name) ? null : name),
			local_address_id: is_local_id(name) ? name : addr.local_address_id || null,
			sync_status: addr.sync_status || (is_local_id(name) ? "QUEUED" : "SYNCED"),
			modified: addr.modified || addr.updated_at || new Date().toISOString(),
			cached_at: addr.cached_at || new Date().toISOString(),
			updated_at: addr.updated_at || new Date().toISOString(),
			created_at: addr.created_at || new Date().toISOString(),
			created_by: addr.created_by || frappe.session.user,
			last_error: addr.last_error || null,
			server_modified: addr.server_modified || null,
		};
	}

	function to_payload(record) {
		return {
			local_address_id: record.local_address_id || (is_local_id(record.name) ? record.name : null),
			server_address_name: record.server_address_name || (!is_local_id(record.name) ? record.name : null),
			local_customer_id: record.local_customer_id || null,
			server_customer_name: record.server_customer_name || null,
			customer: record.customer,
			address_title: record.address_title,
			address_line1: record.address_line1,
			address_line2: record.address_line2,
			city: record.city,
			state: record.state,
			pincode: record.pincode,
			country: record.country,
			phone: record.phone,
			nozom_delivery_location_link: record.nozom_delivery_location_link,
			is_primary_address: record.is_primary_address,
			is_shipping_address: record.is_shipping_address,
			server_modified: record.server_modified || null,
		};
	}

	async function upsert(pos_profile, addr) {
		const record = normalize(addr, pos_profile);
		await db().put("addresses", record);
		return record;
	}

	async function get(pos_profile, name) {
		if (!name) return null;
		return (
			(await db().get("addresses", `${pos_profile}::${name}`)) ||
			(await db().get_all("addresses")).find((r) => r.name === name) ||
			null
		);
	}

	async function list_for_customer(pos_profile, customer, { search = "" } = {}) {
		if (!customer) return [];
		const all = await db().get_all("addresses");
		const term = (search || "").toLowerCase().trim();
		let rows = all.filter((r) => r.pos_profile === pos_profile && r.customer === customer);
		if (term) {
			rows = rows.filter((r) => {
				const hay =
					`${r.address_title} ${r.display} ${r.city} ${r.phone} ${r.address_line1}`.toLowerCase();
				return hay.includes(term);
			});
		}
		rows.sort((a, b) => {
			if (cint(a.is_shipping_address) !== cint(b.is_shipping_address)) {
				return cint(b.is_shipping_address) - cint(a.is_shipping_address);
			}
			if (cint(a.is_primary_address) !== cint(b.is_primary_address)) {
				return cint(b.is_primary_address) - cint(a.is_primary_address);
			}
			return String(a.address_title || "").localeCompare(String(b.address_title || ""));
		});
		return rows;
	}

	async function pick_default(pos_profile, customer, preferred_name = null) {
		const rows = await list_for_customer(pos_profile, customer);
		if (!rows.length) return null;
		if (preferred_name) {
			const preferred = rows.find((r) => r.name === preferred_name);
			if (preferred) return preferred;
		}
		return (
			rows.find((r) => cint(r.is_shipping_address)) ||
			rows.find((r) => cint(r.is_primary_address)) ||
			rows[0]
		);
	}

	async function cache_many(pos_profile, customer, addresses) {
		const cached_at = new Date().toISOString();
		const existing = await list_for_customer(pos_profile, customer);
		const local_pending = existing.filter(
			(r) => r.is_local || ["QUEUED", "FAILED", "CONFLICT"].includes(r.sync_status)
		);

		const records = (addresses || [])
			.filter((a) => a && (a.name || a.address_line1))
			.map((a) =>
				normalize(
					{
						...a,
						customer,
						server_customer_name: customer,
						cached_at,
					},
					pos_profile
				)
			);

		const merged = [...records];
		local_pending.forEach((local) => {
			if (!merged.find((r) => r.name === local.name)) {
				merged.push({ ...local, cached_at });
			}
		});

		await db().put_many("addresses", merged);
		return merged.length;
	}

	async function create_local(pos_profile, customer, data = {}) {
		const line1 = cstr(data.address_line1 || "").trim();
		if (!customer) throw new Error(__("Customer is required."));
		if (!line1) throw new Error(__("Address Line 1 is required."));

		const location = sanitize_location(data.nozom_delivery_location_link || data.delivery_location_link);
		if (cstr(data.nozom_delivery_location_link || data.delivery_location_link || "").trim() && !location) {
			throw new Error(__("Delivery Location Link must be an http:// or https:// URL."));
		}

		const local_id = new_local_id();
		const now = new Date().toISOString();
		const is_local_customer = nozom_pos.offline.customer_store?.is_local_id?.(customer);

		const record = await upsert(pos_profile, {
			name: local_id,
			customer,
			local_customer_id: is_local_customer ? customer : null,
			server_customer_name: is_local_customer ? null : customer,
			address_title: cstr(data.address_title || "").trim() || __("Address"),
			address_line1: line1,
			address_line2: cstr(data.address_line2 || "").trim(),
			city: cstr(data.city || "").trim() || line1,
			state: cstr(data.state || "").trim(),
			pincode: cstr(data.pincode || "").trim(),
			country: cstr(data.country || "").trim(),
			phone: cstr(data.phone || "").trim(),
			nozom_delivery_location_link: location,
			is_primary_address: cint(data.is_primary_address),
			is_shipping_address: cint(data.is_shipping_address) || 1,
			is_local: 1,
			sync_status: "QUEUED",
			created_at: now,
			updated_at: now,
		});

		await db().put("address_queue", {
			id: local_id,
			local_address_id: local_id,
			pos_profile,
			action: "CREATE",
			payload: to_payload(record),
			idempotency_key: `addr:${pos_profile}:${local_id}`,
			status: "QUEUED",
			retry_count: 0,
			last_error: null,
			server_address_name: null,
			created_at: now,
			updated_at: now,
			created_by: frappe.session.user,
		});

		return record;
	}

	async function update_local(pos_profile, name, patch = {}) {
		const current = await get(pos_profile, name);
		if (!current) throw new Error(__("Address not found in local cache."));

		if (patch.nozom_delivery_location_link != null || patch.delivery_location_link != null) {
			const raw = patch.nozom_delivery_location_link ?? patch.delivery_location_link;
			const sanitized = sanitize_location(raw);
			if (cstr(raw || "").trim() && !sanitized) {
				throw new Error(__("Delivery Location Link must be an http:// or https:// URL."));
			}
			patch.nozom_delivery_location_link = sanitized;
		}

		const next = {
			...current,
			...patch,
			name: current.name,
			customer: current.customer,
			display: undefined,
			updated_at: new Date().toISOString(),
			sync_status: "QUEUED",
		};
		next.display = format_display(next);
		const saved = await upsert(pos_profile, next);

		const queue_id = `addr-upd:${current.name}:${Date.now()}`;
		await db().put("address_queue", {
			id: queue_id,
			local_address_id: current.local_address_id || current.name,
			pos_profile,
			action: "UPDATE",
			payload: {
				...to_payload(saved),
				server_modified: current.server_modified || current.modified || null,
			},
			idempotency_key: `addr-upd:${pos_profile}:${current.name}:${queue_id}`,
			status: "QUEUED",
			retry_count: 0,
			last_error: null,
			server_address_name: current.server_address_name || null,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			created_by: frappe.session.user,
		});

		return saved;
	}

	async function list_ready(limit = 20) {
		const all = await db().get_all("address_queue");
		return all
			.filter((r) => ["QUEUED", "FAILED"].includes(r.status))
			.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
			.slice(0, limit);
	}

	async function mark_synced(queue_row, server_address_name, extra = {}) {
		await db().put("address_queue", {
			...queue_row,
			status: "SYNCED",
			server_address_name,
			last_error: null,
			updated_at: new Date().toISOString(),
			synced_at: new Date().toISOString(),
		});

		const cached = await get(queue_row.pos_profile, queue_row.local_address_id);
		if (cached) {
			await upsert(queue_row.pos_profile, {
				...cached,
				server_address_name,
				server_customer_name: extra.server_customer_name || cached.server_customer_name,
				customer: extra.server_customer_name || cached.server_customer_name || cached.customer,
				sync_status: "SYNCED",
				server_modified: extra.modified || null,
				last_error: null,
			});
		}

		if (server_address_name && server_address_name !== queue_row.local_address_id) {
			await upsert(queue_row.pos_profile, {
				...(cached || {}),
				name: server_address_name,
				server_address_name,
				customer: extra.server_customer_name || cached?.server_customer_name || cached?.customer,
				is_local: 0,
				sync_status: "SYNCED",
				server_modified: extra.modified || null,
			});
		}
	}

	async function mark_failed(queue_row, message, conflict = false) {
		await db().put("address_queue", {
			...queue_row,
			status: conflict ? "CONFLICT" : "FAILED",
			last_error: message,
			retry_count: cint(queue_row.retry_count) + 1,
			updated_at: new Date().toISOString(),
		});
		const cached = await get(queue_row.pos_profile, queue_row.local_address_id);
		if (cached) {
			await upsert(queue_row.pos_profile, {
				...cached,
				sync_status: conflict ? "CONFLICT" : "FAILED",
				last_error: message,
			});
		}
	}

	async function resolve_server_name(pos_profile, name) {
		if (!name) return null;
		if (!is_local_id(name)) return name;
		const row = await get(pos_profile, name);
		return row?.server_address_name || null;
	}

	function snapshot_from_address(addr, customer_info = {}) {
		if (!addr) {
			return {
				customer_address: "",
				address_display: "",
				shipping_address_name: "",
				shipping_address: "",
				contact_mobile: cstr(customer_info.mobile_no || "").trim(),
				nozom_address_title_snapshot: "",
				nozom_customer_phone_snapshot: cstr(customer_info.mobile_no || "").trim(),
				nozom_delivery_location_link_snapshot: "",
				_selected_address: null,
			};
		}
		const phone =
			cstr(addr.phone || "").trim() || cstr(customer_info.mobile_no || "").trim();
		const display = addr.display || format_display(addr);
		const title = cstr(addr.address_title || "").trim();
		const location = sanitize_location(addr.nozom_delivery_location_link);
		const ref = addr.server_address_name || (!is_local_id(addr.name) ? addr.name : "");

		return {
			customer_address: ref || "",
			address_display: display,
			shipping_address_name: ref || "",
			shipping_address: display,
			contact_mobile: phone,
			nozom_address_title_snapshot: title,
			nozom_customer_phone_snapshot: phone,
			nozom_delivery_location_link_snapshot: location,
			_selected_address: addr.name,
			_local_address_id: is_local_id(addr.name) ? addr.name : addr.local_address_id || null,
		};
	}

	return {
		LOCAL_PREFIX,
		FIELD,
		is_local_id,
		new_local_id,
		normalize,
		format_display,
		sanitize_location,
		upsert,
		get,
		list_for_customer,
		pick_default,
		cache_many,
		create_local,
		update_local,
		list_ready,
		mark_synced,
		mark_failed,
		resolve_server_name,
		snapshot_from_address,
	};
})();
