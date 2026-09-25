frappe.provide("nozom_pos.offline");

/**
 * Local customer cache + offline create/update queue.
 * Local IDs look like LOC-CUST-<uuid> — never invent ERPNext Customer names.
 * Address is stored on the customer cache row and synced after Customer (dependency-aware).
 */
nozom_pos.offline.customer_store = (() => {
	const db = () => nozom_pos.offline.db;
	const LOCAL_PREFIX = "LOC-CUST-";
	const LOCAL_ADDR_PREFIX = "LOC-ADDR-";

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

	function new_local_address_id() {
		return `${LOCAL_ADDR_PREFIX}${uuid()}`;
	}

	function format_primary_address(c = {}) {
		if (c.primary_address) return cstr(c.primary_address).trim();
		return [c.address_line1, c.address_line2, c.city, c.state, c.pincode, c.country]
			.map((v) => cstr(v || "").trim())
			.filter(Boolean)
			.join(", ");
	}

	function normalize_customer(c, pos_profile) {
		const name = c.name || c.customer || c.local_customer_id;
		const address_line1 = cstr(c.address_line1 || "").trim();
		const primary_address = format_primary_address(c) || address_line1;
		const local_address_id =
			c.local_address_id ||
			(address_line1 || primary_address ? c.local_address_id || null : null);

		return {
			id: `${pos_profile}::${name}`,
			pos_profile,
			name,
			customer: name,
			customer_name: c.customer_name || name,
			customer_group: c.customer_group || "",
			territory: c.territory || "",
			image: c.image || "",
			mobile_no: c.mobile_no || "",
			email_id: c.email_id || "",
			tax_id: c.tax_id || "",
			address_line1,
			address_line2: cstr(c.address_line2 || "").trim(),
			city: cstr(c.city || "").trim(),
			state: cstr(c.state || "").trim(),
			pincode: cstr(c.pincode || "").trim(),
			country: cstr(c.country || "").trim(),
			primary_address,
			local_address_id: local_address_id || null,
			server_address_name: c.server_address_name || null,
			disabled: cint(c.disabled),
			is_local: is_local_id(name) || cint(c.is_local) === 1,
			server_customer_name: c.server_customer_name || (is_local_id(name) ? null : name),
			sync_status: c.sync_status || (is_local_id(name) ? "QUEUED" : "SYNCED"),
			cached_at: c.cached_at || new Date().toISOString(),
			updated_at: c.updated_at || new Date().toISOString(),
			created_at: c.created_at || new Date().toISOString(),
			created_by: c.created_by || frappe.session.user,
			last_error: c.last_error || null,
		};
	}

	function address_payload_from_record(record) {
		return {
			local_address_id: record.local_address_id || null,
			server_address_name: record.server_address_name || null,
			address_line1: record.address_line1 || "",
			address_line2: record.address_line2 || "",
			city: record.city || "",
			state: record.state || "",
			pincode: record.pincode || "",
			country: record.country || "",
			primary_address: record.primary_address || "",
		};
	}

	async function upsert_cached(pos_profile, customer) {
		const record = normalize_customer(customer, pos_profile);
		await db().put("customers", record);
		return record;
	}

	async function get(pos_profile, name) {
		if (!name) return null;
		return (
			(await db().get("customers", `${pos_profile}::${name}`)) ||
			(await db().get_all("customers")).find((r) => r.name === name) ||
			null
		);
	}

	async function resolve_server_name(pos_profile, name) {
		if (!name) return null;
		if (!is_local_id(name)) return name;
		const row = await get(pos_profile, name);
		return row?.server_customer_name || null;
	}

	async function search({ pos_profile, search_term = "", limit = 40 } = {}) {
		const all = await db().get_all("customers");
		const term = (search_term || "").toLowerCase().trim();
		let rows = all.filter((r) => r.pos_profile === pos_profile && !cint(r.disabled));
		if (term) {
			rows = rows.filter((r) => {
				const hay =
					`${r.name} ${r.customer_name} ${r.mobile_no} ${r.email_id} ${r.tax_id} ${r.primary_address} ${r.address_line1}`.toLowerCase();
				return hay.includes(term);
			});
		}
		rows.sort((a, b) => String(a.customer_name || "").localeCompare(String(b.customer_name || "")));
		return rows.slice(0, limit);
	}

	async function create_local(pos_profile, data = {}) {
		const customer_name = cstr(data.customer_name || "").trim();
		if (!customer_name) {
			throw new Error(__("Customer Name is required."));
		}
		const local_id = new_local_id();
		const now = new Date().toISOString();
		const has_address = Boolean(cstr(data.address_line1 || "").trim());
		const local_address_id = has_address ? new_local_address_id() : null;

		const record = await upsert_cached(pos_profile, {
			name: local_id,
			customer_name,
			mobile_no: cstr(data.mobile_no || "").trim(),
			email_id: cstr(data.email_id || "").trim(),
			tax_id: cstr(data.tax_id || "").trim(),
			customer_group: data.customer_group || "",
			territory: data.territory || "",
			address_line1: cstr(data.address_line1 || "").trim(),
			address_line2: cstr(data.address_line2 || "").trim(),
			city: cstr(data.city || "").trim(),
			state: cstr(data.state || "").trim(),
			pincode: cstr(data.pincode || "").trim(),
			country: cstr(data.country || "").trim(),
			local_address_id,
			is_local: 1,
			sync_status: "QUEUED",
			created_at: now,
			updated_at: now,
			created_by: frappe.session.user,
		});

		await db().put("customer_queue", {
			id: local_id,
			local_customer_id: local_id,
			pos_profile,
			action: "CREATE",
			payload: {
				local_customer_id: local_id,
				customer_name: record.customer_name,
				mobile_no: record.mobile_no,
				email_id: record.email_id,
				tax_id: record.tax_id,
				customer_group: record.customer_group,
				territory: record.territory,
				...address_payload_from_record(record),
			},
			idempotency_key: `cust:${pos_profile}:${local_id}`,
			status: "QUEUED",
			retry_count: 0,
			last_error: null,
			server_customer_name: null,
			created_at: now,
			updated_at: now,
			created_by: frappe.session.user,
		});

		return record;
	}

	async function update_local(pos_profile, name, patch = {}) {
		const current = await get(pos_profile, name);
		if (!current) {
			throw new Error(__("Customer not found in local cache."));
		}

		const merged = { ...current, ...patch };
		if (
			cstr(merged.address_line1 || "").trim() &&
			!merged.local_address_id &&
			!merged.server_address_name
		) {
			merged.local_address_id = new_local_address_id();
		}

		const next = {
			...merged,
			name: current.name,
			customer: current.name,
			primary_address: format_primary_address(merged),
			updated_at: new Date().toISOString(),
			sync_status: "QUEUED",
		};
		await upsert_cached(pos_profile, next);

		const queue_id = `upd:${current.name}:${Date.now()}`;
		await db().put("customer_queue", {
			id: queue_id,
			local_customer_id: current.name,
			pos_profile,
			action: "UPDATE",
			payload: {
				local_customer_id: current.name,
				server_customer_name:
					current.server_customer_name || (!is_local_id(current.name) ? current.name : null),
				customer_name: next.customer_name,
				mobile_no: next.mobile_no,
				email_id: next.email_id,
				tax_id: next.tax_id,
				customer_group: next.customer_group,
				territory: next.territory,
				...address_payload_from_record(next),
			},
			idempotency_key: `cust-upd:${pos_profile}:${current.name}:${queue_id}`,
			status: "QUEUED",
			retry_count: 0,
			last_error: null,
			server_customer_name: current.server_customer_name || null,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			created_by: frappe.session.user,
		});

		return next;
	}

	async function list_ready(limit = 20) {
		const all = await db().get_all("customer_queue");
		return all
			.filter((r) => ["QUEUED", "FAILED"].includes(r.status))
			.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
			.slice(0, limit);
	}

	async function mark_synced(queue_row, server_customer_name, extra = {}) {
		await db().put("customer_queue", {
			...queue_row,
			status: "SYNCED",
			server_customer_name,
			last_error: null,
			updated_at: new Date().toISOString(),
			synced_at: new Date().toISOString(),
			server_address_name: extra.server_address_name || queue_row.server_address_name || null,
		});

		const cached = await get(queue_row.pos_profile, queue_row.local_customer_id);
		if (cached) {
			await upsert_cached(queue_row.pos_profile, {
				...cached,
				server_customer_name,
				server_address_name: extra.server_address_name || cached.server_address_name || null,
				sync_status: "SYNCED",
				last_error: null,
			});
		}

		// Also index under server name for future searches while keeping local id
		if (server_customer_name && server_customer_name !== queue_row.local_customer_id) {
			await upsert_cached(queue_row.pos_profile, {
				...(cached || {}),
				name: server_customer_name,
				customer: server_customer_name,
				customer_name: cached?.customer_name || server_customer_name,
				mobile_no: cached?.mobile_no || "",
				email_id: cached?.email_id || "",
				tax_id: cached?.tax_id || "",
				address_line1: cached?.address_line1 || "",
				address_line2: cached?.address_line2 || "",
				city: cached?.city || "",
				state: cached?.state || "",
				pincode: cached?.pincode || "",
				country: cached?.country || "",
				primary_address: cached?.primary_address || "",
				local_address_id: cached?.local_address_id || null,
				server_address_name: extra.server_address_name || cached?.server_address_name || null,
				server_customer_name,
				is_local: 0,
				sync_status: "SYNCED",
			});
		}
	}

	async function mark_failed(queue_row, message, conflict = false) {
		await db().put("customer_queue", {
			...queue_row,
			status: conflict ? "CONFLICT" : "FAILED",
			last_error: message,
			retry_count: cint(queue_row.retry_count) + 1,
			updated_at: new Date().toISOString(),
		});
		const cached = await get(queue_row.pos_profile, queue_row.local_customer_id);
		if (cached) {
			await upsert_cached(queue_row.pos_profile, {
				...cached,
				sync_status: conflict ? "CONFLICT" : "FAILED",
				last_error: message,
			});
		}
	}

	async function ensure_invoice_customer(payload) {
		/** Resolve local customer → server name before invoice sync. */
		if (!payload?.customer) return payload;
		if (!is_local_id(payload.customer)) return payload;

		const server = await resolve_server_name(payload.pos_profile, payload.customer);
		if (!server) {
			const err = new Error(
				__("Customer {0} must sync before the invoice.", [payload.customer_name || payload.customer])
			);
			err.nozom_customer_pending = true;
			throw err;
		}
		return {
			...payload,
			customer: server,
			local_customer_id: payload.customer,
			customer_name: payload.customer_name,
		};
	}

	return {
		LOCAL_PREFIX,
		LOCAL_ADDR_PREFIX,
		is_local_id,
		new_local_id,
		normalize_customer,
		upsert_cached,
		get,
		search,
		create_local,
		update_local,
		list_ready,
		mark_synced,
		mark_failed,
		resolve_server_name,
		ensure_invoice_customer,
	};
})();
