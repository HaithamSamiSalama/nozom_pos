frappe.provide("nozom_pos.offline");

/**
 * Local catalog / POS config / recent-orders cache.
 */
nozom_pos.offline.catalog = (() => {
	const db = () => nozom_pos.offline.db;

	function item_id(pos_profile, price_list, item_code, uom) {
		return `${pos_profile}::${price_list || ""}::${item_code}::${uom || ""}`;
	}

	function recent_id(doctype, name) {
		return `${doctype}::${name}`;
	}

	async function save_pos_config({
		pos_profile,
		company,
		pos_opening,
		settings,
		price_list,
		user,
	}) {
		const id = `pos_config::${pos_profile}`;
		const record = {
			id,
			type: "pos_config",
			pos_profile,
			company,
			pos_opening,
			price_list: price_list || settings?.selling_price_list || null,
			warehouse: settings?.warehouse || null,
			user: user || frappe.session.user,
			settings: sanitize_settings(settings),
			cached_at: new Date().toISOString(),
		};

		await db().put("config", record);
		await db().put("meta", {
			id: "last_config_sync",
			pos_profile,
			cached_at: record.cached_at,
		});
		return record;
	}

	function sanitize_settings(settings) {
		if (!settings) return {};
		try {
			return JSON.parse(JSON.stringify(settings));
		} catch (e) {
			return {
				name: settings.name,
				warehouse: settings.warehouse,
				currency: settings.currency,
				selling_price_list: settings.selling_price_list,
				payments: settings.payments,
				customer_groups: settings.customer_groups,
				disable_rounded_total: settings.disable_rounded_total,
				frm_doctype: settings.frm_doctype,
				allow_partial_payment: settings.allow_partial_payment,
				print_format: settings.print_format,
				print_format_2: settings.print_format_2,
			};
		}
	}

	async function get_pos_config(pos_profile) {
		return db().get("config", `pos_config::${pos_profile}`);
	}

	async function enrich_serial_batch_flags(items) {
		const codes = [...new Set((items || []).map((i) => i.item_code).filter(Boolean))];
		if (!codes.length) return items;
		if (!nozom_pos.offline.network?.is_online?.()) return items;

		try {
			const r = await frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Item",
					filters: [["name", "in", codes]],
					fields: ["name", "has_serial_no", "has_batch_no"],
					limit_page_length: codes.length,
				},
			});
			const map = {};
			(r.message || []).forEach((row) => {
				map[row.name] = row;
			});
			(items || []).forEach((item) => {
				const meta = map[item.item_code];
				if (!meta) return;
				item.has_serial_no = cint(meta.has_serial_no);
				item.has_batch_no = cint(meta.has_batch_no);
			});
		} catch (e) {
			console.warn("NOZOM POS serial/batch enrich failed:", e);
		}
		return items;
	}

	async function cache_items({ pos_profile, price_list, items, warehouse }) {
		if (!pos_profile || !items?.length) return 0;

		await enrich_serial_batch_flags(items);

		const cached_at = new Date().toISOString();
		const config = await get_pos_config(pos_profile);
		const wh = warehouse || config?.warehouse || config?.settings?.warehouse || "";

		const records = items
			.filter((item) => item && item.item_code)
			.map((item) => ({
				id: item_id(pos_profile, price_list, item.item_code, item.uom),
				pos_profile,
				price_list: price_list || "",
				warehouse: wh,
				item_code: item.item_code,
				item_name: item.item_name || item.item_code,
				item_group: item.item_group || "",
				description: item.description || "",
				uom: item.uom || item.stock_uom || "",
				stock_uom: item.stock_uom || item.uom || "",
				conversion_factor: flt(item.conversion_factor) || 1,
				price_list_rate: item.price_list_rate,
				currency: item.currency,
				actual_qty: item.actual_qty,
				is_stock_item: item.is_stock_item,
				has_serial_no: cint(item.has_serial_no),
				has_batch_no: cint(item.has_batch_no),
				item_image: item.item_image || item.image || null,
				barcode: item.barcode || "",
				batch_no: item.batch_no || "",
				serial_no: item.serial_no || "",
				cached_at,
			}));

		await db().put_many("items", records);
		await db().put("meta", {
			id: `items_sync::${pos_profile}::${price_list || ""}`,
			pos_profile,
			price_list: price_list || "",
			count: records.length,
			cached_at,
		});

		return records.length;
	}

	async function get_cached_item({ pos_profile, price_list, item_code, uom }) {
		if (!item_code) return null;
		const id = item_id(pos_profile, price_list, item_code, uom);
		let row = await db().get("items", id);
		if (row) return row;

		const all = await db().get_all("items");
		return (
			all.find(
				(r) =>
					r.pos_profile === pos_profile &&
					r.item_code === item_code &&
					(!price_list || !r.price_list || r.price_list === price_list) &&
					(!uom || !r.uom || r.uom === uom)
			) ||
			all.find((r) => r.pos_profile === pos_profile && r.item_code === item_code) ||
			null
		);
	}

	async function search_items({
		pos_profile,
		price_list,
		search_term = "",
		item_group = "",
		start = 0,
		page_length = 40,
	}) {
		const all = await db().get_all("items");
		const term = (search_term || "").toLowerCase().trim();
		const group = (item_group || "").trim();

		let rows = all.filter((row) => {
			if (row.pos_profile !== pos_profile) return false;
			if (price_list && row.price_list && row.price_list !== price_list) return false;
			if (!term) return true;

			const hay = `${row.item_code || ""} ${row.item_name || ""} ${row.barcode || ""} ${
				row.description || ""
			}`.toLowerCase();
			return hay.includes(term);
		});

		if (group) {
			const has_groups = rows.some((row) => row.item_group);
			if (has_groups) {
				rows = rows.filter((row) => row.item_group === group);
			}
		}

		rows.sort((a, b) => {
			const ta = a.cached_at || "";
			const tb = b.cached_at || "";
			if (ta !== tb) return tb.localeCompare(ta);
			return String(a.item_name || "").localeCompare(String(b.item_name || ""));
		});

		const start_idx = cint(start) || 0;
		const limit = cint(page_length) || 40;
		return rows.slice(start_idx, start_idx + limit).map((row) => ({
			item_code: row.item_code,
			item_name: row.item_name,
			description: row.description,
			stock_uom: row.stock_uom,
			item_image: row.item_image,
			is_stock_item: row.is_stock_item,
			has_serial_no: row.has_serial_no,
			has_batch_no: row.has_batch_no,
			price_list_rate: row.price_list_rate,
			currency: row.currency,
			uom: row.uom,
			conversion_factor: row.conversion_factor || 1,
			batch_no: row.batch_no,
			serial_no: row.serial_no,
			barcode: row.barcode,
			actual_qty: row.actual_qty,
			item_group: row.item_group,
			warehouse: row.warehouse,
			_from_cache: true,
		}));
	}

	async function cache_recent_orders(invoices, pos_profile) {
		if (!invoices?.length) return 0;
		const cached_at = new Date().toISOString();
		const records = invoices.map((inv) => ({
			id: recent_id(inv.doctype || "POS Invoice", inv.name),
			pos_profile: pos_profile || "",
			doctype: inv.doctype || "POS Invoice",
			name: inv.name,
			customer: inv.customer,
			customer_name: inv.customer_name || inv.customer,
			nozom_order_number: inv.nozom_order_number || "",
			posting_date: inv.posting_date,
			posting_time: inv.posting_time,
			grand_total: inv.grand_total,
			rounded_total: inv.rounded_total,
			paid_amount: inv.paid_amount,
			outstanding_amount: inv.outstanding_amount,
			currency: inv.currency,
			status: inv.status,
			is_return: cint(inv.is_return),
			docstatus: cint(inv.docstatus),
			cached_at,
			_from_cache: true,
		}));
		await db().put_many("recent_orders", records);
		await db().put("meta", {
			id: `recent_orders::${pos_profile || "global"}`,
			pos_profile: pos_profile || "",
			count: records.length,
			cached_at,
		});
		return records.length;
	}

	async function cache_recent_order_doc(doc) {
		if (!doc?.name) return;
		const cached_at = new Date().toISOString();
		await db().put("recent_orders", {
			id: recent_id(doc.doctype, doc.name),
			doctype: doc.doctype,
			name: doc.name,
			customer: doc.customer,
			customer_name: doc.customer_name || doc.customer,
			nozom_order_number: doc.nozom_order_number || "",
			posting_date: doc.posting_date,
			posting_time: doc.posting_time,
			grand_total: doc.grand_total,
			rounded_total: doc.rounded_total,
			paid_amount: doc.paid_amount,
			outstanding_amount: doc.outstanding_amount,
			currency: doc.currency,
			status: doc.status,
			is_return: cint(doc.is_return),
			docstatus: cint(doc.docstatus),
			owner: doc.owner,
			order_notes: doc.order_notes || "",
			items: (doc.items || []).map((row) => ({
				item_code: row.item_code,
				item_name: row.item_name,
				qty: row.qty,
				uom: row.uom,
				rate: row.rate,
				amount: row.amount,
				notes: row.notes || "",
			})),
			payments: (doc.payments || [])
				.filter((p) => flt(p.amount))
				.map((p) => ({
					mode_of_payment: p.mode_of_payment,
					amount: p.amount,
				})),
			taxes: (doc.taxes || []).map((t) => ({
				description: t.description,
				tax_amount_after_discount_amount: t.tax_amount_after_discount_amount,
			})),
			full_doc: true,
			cached_at,
			_from_cache: true,
		});
	}

	async function search_recent_orders({ search_term = "", status = "All", pos_profile = "" } = {}) {
		const all = await db().get_all("recent_orders");
		const term = (search_term || "").toLowerCase().trim();
		let rows = all.filter((row) => !row._pending_only);

		if (pos_profile) {
			rows = rows.filter((r) => !r.pos_profile || r.pos_profile === pos_profile);
		}

		if (status && status !== "All") {
			if (status === "Return") {
				rows = rows.filter((r) => cint(r.is_return));
			} else {
				rows = rows.filter((r) => String(r.status || "") === status);
			}
		}

		if (term) {
			rows = rows.filter((r) => {
				const hay = `${r.name || ""} ${r.customer || ""} ${r.customer_name || ""} ${
					r.nozom_order_number || ""
				}`.toLowerCase();
				return hay.includes(term);
			});
		}

		rows.sort((a, b) => {
			const da = `${a.posting_date || ""} ${a.posting_time || ""}`;
			const dbv = `${b.posting_date || ""} ${b.posting_time || ""}`;
			return dbv.localeCompare(da);
		});

		return rows;
	}

	async function get_recent_order_doc(doctype, name) {
		const row = await db().get("recent_orders", recent_id(doctype, name));
		if (!row) return null;
		if (row.full_doc || row.items) {
			return {
				doctype: row.doctype,
				name: row.name,
				customer: row.customer,
				customer_name: row.customer_name,
				nozom_order_number: row.nozom_order_number || "",
				posting_date: row.posting_date,
				posting_time: row.posting_time,
				grand_total: row.grand_total,
				rounded_total: row.rounded_total,
				paid_amount: row.paid_amount,
				outstanding_amount: row.outstanding_amount,
				currency: row.currency,
				status: row.status,
				is_return: row.is_return,
				docstatus: row.docstatus,
				owner: row.owner || "",
				order_notes: row.order_notes || "",
				items: row.items || [],
				payments: row.payments || [],
				taxes: row.taxes || [],
				_from_cache: true,
			};
		}
		return {
			...row,
			items: [],
			payments: [],
			taxes: [],
			_from_cache: true,
			_summary_only: true,
		};
	}

	async function get_cache_stats(pos_profile) {
		const all = await db().get_all("items");
		const for_profile = all.filter((row) => row.pos_profile === pos_profile);
		const config = await get_pos_config(pos_profile);
		const queued = await db().count("tx_queue");
		return {
			item_count: for_profile.length,
			config_cached_at: config?.cached_at || null,
			queued_count: queued,
			warehouse: config?.warehouse || config?.settings?.warehouse || null,
		};
	}

	async function put_meta(id, data) {
		await db().put("meta", { id, ...data });
	}

	async function cache_invoice_bootstrap(frm, ctx = {}) {
		if (!frm?.doc) return;
		const pos_profile = ctx.pos_profile || frm.doc.pos_profile;
		const settings = ctx.settings || {};
		const doc = frm.doc;
		const record = {
			id: `invoice_bootstrap::${pos_profile}`,
			type: "invoice_bootstrap",
			pos_profile,
			company: doc.company,
			currency: doc.currency,
			selling_price_list: doc.selling_price_list,
			set_warehouse: doc.set_warehouse || settings.warehouse,
			customer: doc.customer,
			customer_name: doc.customer_name,
			taxes_and_charges: doc.taxes_and_charges,
			taxes: (doc.taxes || []).map((t) => ({
				charge_type: t.charge_type,
				account_head: t.account_head,
				description: t.description,
				rate: flt(t.rate),
				tax_amount: flt(t.tax_amount),
				tax_amount_after_discount_amount: flt(t.tax_amount_after_discount_amount),
				cost_center: t.cost_center,
				included_in_print_rate: cint(t.included_in_print_rate),
			})),
			payments: (doc.payments || [])
				.filter((p) => p.mode_of_payment)
				.map((p) => ({
					mode_of_payment: p.mode_of_payment,
					account: p.account,
					type: p.type,
					default: cint(p.default),
					amount: 0,
				})),
			print_format: frm.pos_print_format || settings.print_format || "",
			set_default_payment: cint(frm.set_default_payment),
			allow_print_before_pay: cint(frm.allow_print_before_pay),
			disable_rounded_total: cint(doc.disable_rounded_total),
			conversion_rate: flt(doc.conversion_rate) || 1,
			cached_at: new Date().toISOString(),
		};
		await db().put("config", record);
		return record;
	}

	async function get_invoice_bootstrap(pos_profile) {
		return db().get("config", `invoice_bootstrap::${pos_profile}`);
	}

	async function cache_item_groups(pos_profile, groups) {
		const cached_at = new Date().toISOString();
		const records = (groups || []).map((g) => ({
			id: `${pos_profile}::${g.name}`,
			pos_profile,
			name: g.name,
			parent_item_group: g.parent_item_group || "",
			is_group: cint(g.is_group),
			cached_at,
		}));
		await db().put_many("item_groups", records);
		await put_meta(`item_groups::${pos_profile}`, {
			pos_profile,
			count: records.length,
			cached_at,
		});
		return records.length;
	}

	async function get_item_groups(pos_profile) {
		const all = await db().get_all("item_groups");
		return all
			.filter((r) => r.pos_profile === pos_profile)
			.sort((a, b) => String(a.name).localeCompare(String(b.name)));
	}

	async function cache_customers(pos_profile, customers) {
		const cached_at = new Date().toISOString();
		// Preserve locally-created / pending customers when refreshing the server snapshot.
		const existing = (await db().get_all("customers")).filter((r) => r.pos_profile === pos_profile);
		const local_pending = existing.filter(
			(r) => r.is_local || ["QUEUED", "FAILED", "CONFLICT"].includes(r.sync_status)
		);

		const records = (customers || [])
			.filter((c) => c && c.name)
			.map((c) => ({
				id: `${pos_profile}::${c.name}`,
				pos_profile,
				name: c.name,
				customer: c.name,
				customer_name: c.customer_name || c.name,
				customer_group: c.customer_group || "",
				territory: c.territory || "",
				image: c.image || "",
				mobile_no: c.mobile_no || "",
				email_id: c.email_id || "",
				tax_id: c.tax_id || "",
				address_line1: c.address_line1 || "",
				address_line2: c.address_line2 || "",
				city: c.city || "",
				state: c.state || "",
				pincode: c.pincode || "",
				country: c.country || "",
				primary_address: c.primary_address || c.address_line1 || "",
				server_address_name: c.server_address_name || c.customer_primary_address || null,
				local_address_id: c.local_address_id || null,
				disabled: cint(c.disabled),
				is_local: 0,
				server_customer_name: c.name,
				sync_status: "SYNCED",
				cached_at,
				updated_at: cached_at,
			}));

		const merged = [...records];
		local_pending.forEach((local) => {
			if (!merged.find((r) => r.name === local.name)) {
				merged.push({ ...local, cached_at });
			}
		});

		await db().put_many("customers", merged);
		await put_meta(`customers::${pos_profile}`, {
			pos_profile,
			count: merged.length,
			cached_at,
		});
		return merged.length;
	}

	async function search_customers({ pos_profile, search_term = "", limit = 40 } = {}) {
		if (nozom_pos.offline.customer_store?.search) {
			return nozom_pos.offline.customer_store.search({ pos_profile, search_term, limit });
		}
		const all = await db().get_all("customers");
		const term = (search_term || "").toLowerCase().trim();
		let rows = all.filter((r) => r.pos_profile === pos_profile && !cint(r.disabled));
		if (term) {
			rows = rows.filter((r) => {
				const hay = `${r.name} ${r.customer_name} ${r.mobile_no} ${r.email_id} ${r.tax_id}`.toLowerCase();
				return hay.includes(term);
			});
		}
		return rows.slice(0, limit);
	}

	async function get_customer(pos_profile, name) {
		if (!name) return null;
		return (
			(await db().get("customers", `${pos_profile}::${name}`)) ||
			(await db().get_all("customers")).find((r) => r.name === name) ||
			null
		);
	}

	return {
		save_pos_config,
		get_pos_config,
		cache_items,
		get_cached_item,
		search_items,
		cache_recent_orders,
		cache_recent_order_doc,
		search_recent_orders,
		get_recent_order_doc,
		get_cache_stats,
		put_meta,
		cache_invoice_bootstrap,
		get_invoice_bootstrap,
		cache_item_groups,
		get_item_groups,
		cache_customers,
		search_customers,
		get_customer,
	};
})();
