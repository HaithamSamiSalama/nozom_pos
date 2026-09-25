frappe.provide("nozom_pos.offline");

/**
 * Named Local Drafts (Save Draft while offline).
 * Distinct from active_cart crash-recovery and from completed tx_queue sales.
 */
nozom_pos.offline.draft_store = (() => {
	const db = () => nozom_pos.offline.db;
	const PREFIX = "DRAFT-";

	function uuid() {
		if (window.crypto?.randomUUID) return window.crypto.randomUUID();
		return `${Date.now()}-${frappe.utils.get_random(12)}`;
	}

	function is_local_draft_id(name) {
		return Boolean(name && String(name).startsWith(PREFIX));
	}

	async function next_local_ref() {
		const id = "local_draft_seq";
		let meta = null;
		try {
			meta = await db().get("meta", id);
		} catch (e) {
			meta = null;
		}
		const seq = cint(meta?.seq) + 1;
		await db().put("meta", { id, seq, updated_at: new Date().toISOString() });
		const day = (frappe.datetime.now_date() || "").replace(/-/g, "");
		return `${PREFIX}${day}-${String(seq).padStart(4, "0")}`;
	}

	function serialize_from_frm(frm, ctx = {}) {
		const doc = frm.doc;
		const items = (doc.items || [])
			.filter((row) => row.item_code && flt(row.qty) > 0)
			.map((row) => ({
				item_code: row.item_code,
				item_name: row.item_name,
				qty: flt(row.qty),
				rate: flt(row.rate),
				price_list_rate: flt(row.price_list_rate),
				uom: row.uom,
				stock_uom: row.stock_uom,
				conversion_factor: flt(row.conversion_factor) || 1,
				discount_percentage: flt(row.discount_percentage),
				discount_amount: flt(row.discount_amount),
				notes: row.notes || "",
				warehouse: row.warehouse || doc.set_warehouse || "",
			}));

		if (!items.length) return null;

		return {
			pos_profile: ctx.pos_profile || doc.pos_profile,
			company: ctx.company || doc.company,
			pos_opening: ctx.pos_opening || null,
			user: ctx.user || frappe.session.user,
			invoice_doctype: doc.doctype,
			customer: doc.customer || "",
			customer_name: doc.customer_name || "",
			local_customer_id: nozom_pos.offline.customer_store?.is_local_id?.(doc.customer)
				? doc.customer
				: null,
			selling_price_list: doc.selling_price_list || "",
			currency: doc.currency,
			conversion_rate: flt(doc.conversion_rate) || 1,
			order_notes: doc.order_notes || "",
			nozom_order_number: doc.nozom_order_number || "",
			additional_discount_percentage: flt(doc.additional_discount_percentage),
			discount_amount: flt(doc.discount_amount),
			net_total: flt(doc.net_total),
			grand_total: flt(doc.grand_total),
			rounded_total: flt(doc.rounded_total),
			disable_rounded_total: cint(doc.disable_rounded_total),
			set_warehouse: doc.set_warehouse || "",
			taxes: (doc.taxes || []).map((t) => ({
				description: t.description,
				charge_type: t.charge_type,
				account_head: t.account_head,
				rate: flt(t.rate),
				tax_amount_after_discount_amount: flt(t.tax_amount_after_discount_amount),
			})),
			items,
		};
	}

	async function save_or_update(frm, ctx = {}) {
		const payload = serialize_from_frm(frm, ctx);
		if (!payload) {
			throw new Error(__("Cart is empty."));
		}

		const existing_id = frm.doc._nozom_local_draft_id || ctx.local_draft_id || null;
		let record = existing_id ? await db().get("local_drafts", existing_id) : null;

		const now = new Date().toISOString();
		if (record) {
			record = {
				...record,
				...payload,
				status: "LOCAL_DRAFT",
				sync_status: record.server_draft_name ? "QUEUED_UPDATE" : "QUEUED",
				updated_at: now,
				last_error: null,
			};
		} else {
			const local_uuid = uuid();
			const local_receipt_no = await next_local_ref();
			record = {
				id: local_uuid,
				local_uuid,
				local_receipt_no,
				idempotency_key: `draft:${payload.pos_profile}:${local_uuid}`,
				...payload,
				status: "LOCAL_DRAFT",
				sync_status: "QUEUED",
				server_draft_name: null,
				server_doctype: null,
				created_at: now,
				updated_at: now,
				created_by: frappe.session.user,
				last_error: null,
			};
		}

		await db().put("local_drafts", record);
		return record;
	}

	async function get(id) {
		if (!id) return null;
		return (
			(await db().get("local_drafts", id)) ||
			(await db().get_all("local_drafts")).find(
				(r) => r.local_receipt_no === id || r.local_uuid === id
			) ||
			null
		);
	}

	async function list({ pos_profile = "", search_term = "" } = {}) {
		const all = await db().get_all("local_drafts");
		const term = (search_term || "").toLowerCase().trim();
		return all
			.filter((r) => {
				if (["RESOLVED", "DISCARDED"].includes(r.status)) return false;
				if (pos_profile && r.pos_profile && r.pos_profile !== pos_profile) return false;
				if (!term) return true;
				const hay = `${r.local_receipt_no} ${r.customer} ${r.customer_name} ${r.nozom_order_number}`.toLowerCase();
				return hay.includes(term);
			})
			.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
	}

	async function list_ready(limit = 20) {
		const all = await db().get_all("local_drafts");
		return all
			.filter((r) => ["QUEUED", "QUEUED_UPDATE", "FAILED"].includes(r.sync_status))
			.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
			.slice(0, limit);
	}

	async function update(id, patch) {
		const current = await get(id);
		if (!current) return null;
		const next = { ...current, ...patch, updated_at: new Date().toISOString() };
		await db().put("local_drafts", next);
		return next;
	}

	async function mark_synced(id, server_doctype, server_draft_name) {
		return update(id, {
			sync_status: "SYNCED",
			server_doctype,
			server_draft_name,
			last_error: null,
			synced_at: new Date().toISOString(),
		});
	}

	async function mark_failed(id, message, conflict = false) {
		return update(id, {
			sync_status: conflict ? "CONFLICT" : "FAILED",
			last_error: message,
			status: conflict ? "CONFLICT" : "LOCAL_DRAFT",
		});
	}

	async function resolve(id) {
		return update(id, {
			status: "RESOLVED",
			sync_status: "RESOLVED",
			resolved_at: new Date().toISOString(),
		});
	}

	async function remove(id) {
		const row = await get(id);
		if (!row) return;
		await db().remove("local_drafts", row.id);
	}

	function to_summary_doc(draft) {
		return {
			doctype: draft.invoice_doctype || "POS Invoice",
			name: draft.local_receipt_no,
			customer: draft.customer,
			customer_name: draft.customer_name || draft.customer,
			owner: draft.created_by || draft.user || frappe.session.user,
			currency: draft.currency,
			paid_amount: 0,
			outstanding_amount: flt(draft.rounded_total) || flt(draft.grand_total),
			net_total: draft.net_total,
			grand_total: draft.grand_total,
			rounded_total: draft.rounded_total,
			discount_amount: draft.discount_amount,
			additional_discount_percentage: draft.additional_discount_percentage,
			order_notes: draft.order_notes,
			nozom_order_number: draft.nozom_order_number || "",
			status: "Draft",
			docstatus: 0,
			is_return: 0,
			posting_date: (draft.updated_at || draft.created_at || "").slice(0, 10),
			posting_time: (draft.updated_at || draft.created_at || "").slice(11, 19),
			items: (draft.items || []).map((row, idx) => ({
				...row,
				name: `local-draft-item-${idx + 1}`,
			})),
			payments: [],
			taxes: draft.taxes || [],
			_nozom_local_draft: true,
			_nozom_local_draft_id: draft.id,
			_nozom_draft: draft,
		};
	}

	function to_cart_snapshot(draft) {
		return {
			id: draft.id,
			status: "LOCAL_DRAFT",
			pos_profile: draft.pos_profile,
			company: draft.company,
			pos_opening: draft.pos_opening,
			user: draft.user,
			doctype: draft.invoice_doctype,
			customer: draft.customer,
			customer_name: draft.customer_name,
			selling_price_list: draft.selling_price_list,
			order_notes: draft.order_notes,
			nozom_order_number: draft.nozom_order_number,
			additional_discount_percentage: draft.additional_discount_percentage,
			discount_amount: draft.discount_amount,
			items: draft.items || [],
			_nozom_local_draft_id: draft.id,
			updated_at: draft.updated_at,
		};
	}

	return {
		PREFIX,
		is_local_draft_id,
		save_or_update,
		get,
		list,
		list_ready,
		update,
		mark_synced,
		mark_failed,
		resolve,
		remove,
		to_summary_doc,
		to_cart_snapshot,
		serialize_from_frm,
	};
})();
