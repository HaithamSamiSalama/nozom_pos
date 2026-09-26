frappe.provide("nozom_pos.offline");

/**
 * Offline completed-sale queue (Phase C/D).
 * Statuses: QUEUED | SYNCING | SYNCED | FAILED | CONFLICT | DISCARDED
 */
nozom_pos.offline.tx_queue = (() => {
	const db = () => nozom_pos.offline.db;
	const MAX_RETRIES = 8;

	function terminal_id() {
		const key = "nozom_pos_terminal_id";
		let id = localStorage.getItem(key);
		if (!id) {
			id = frappe.utils.get_random(10) + "-" + Date.now().toString(36);
			localStorage.setItem(key, id);
		}
		return id;
	}

	function uuid() {
		if (window.crypto?.randomUUID) return window.crypto.randomUUID();
		return `${Date.now()}-${frappe.utils.get_random(12)}`;
	}

	async function next_local_receipt_no() {
		const id = "local_receipt_seq";
		let meta = null;
		try {
			meta = await db().get("meta", id);
		} catch (e) {
			meta = null;
		}
		const seq = cint(meta?.seq) + 1;
		const record = { id, seq, updated_at: new Date().toISOString() };
		await db().put("meta", record);
		const day = (frappe.datetime.now_date() || "").replace(/-/g, "");
		return `LOC-${day}-${String(seq).padStart(5, "0")}`;
	}

	function scrub_token(v) {
		if (v == null) return "";
		const s = String(v).trim();
		if (!s || s === "undefined" || s === "null" || s === "None") return "";
		return s;
	}

	function payment_label(doc_or_tx) {
		const total =
			flt(doc_or_tx.rounded_total) ||
			flt(doc_or_tx.grand_total) ||
			(erpnext.PointOfSale?.get_invoice_total
				? erpnext.PointOfSale.get_invoice_total(doc_or_tx)
				: 0);
		const paid = flt(doc_or_tx.paid_amount);
		const outstanding = flt(doc_or_tx.outstanding_amount);
		if (outstanding <= 0.0001 && paid + 0.0001 >= total) return "Paid";
		if (paid <= 0.0001) return "Unpaid";
		return "Partially Paid";
	}

	function can_queue_sale(doc, settings = {}) {
		if (!doc) return { ok: false, reason: __("No invoice document.") };
		if (cint(doc.docstatus) === 1) return { ok: false, reason: __("Invoice already submitted.") };
		if (cint(doc.is_return)) {
			return { ok: false, reason: __("Returns cannot be queued offline.") };
		}
		if (!doc.customer) {
			return { ok: false, reason: __("Customer is required for offline queue.") };
		}
		if (!doc.items?.length) {
			return { ok: false, reason: __("Cart is empty.") };
		}
		if (cint(doc.redeem_loyalty_points) || flt(doc.loyalty_amount) > 0) {
			return { ok: false, reason: __("Loyalty redemption requires an online connection.") };
		}
		if (doc.coupon_code) {
			return { ok: false, reason: __("Coupon sales require an online connection.") };
		}

		for (const row of doc.items) {
			const has_serial = cint(row.has_serial_no) === 1 || Boolean(scrub_token(row.serial_no));
			const has_batch = cint(row.has_batch_no) === 1 || Boolean(scrub_token(row.batch_no));
			if (has_serial || has_batch) {
				return {
					ok: false,
					reason: __("Serial/Batch items cannot be queued offline in this phase."),
				};
			}
		}

		const total = erpnext.PointOfSale.get_invoice_total
			? erpnext.PointOfSale.get_invoice_total(doc)
			: flt(doc.rounded_total) || flt(doc.grand_total);
		const paid = flt(doc.paid_amount);
		const outstanding = flt(doc.outstanding_amount);
		const allow_partial =
			cint(settings.allow_partial_payment) === 1 ||
			cint(doc.allow_partial_payment) === 1;

		// Unpaid / credit (Paid = 0) is always allowed — matching online Execute path.
		if (paid <= 0.0001) {
			return { ok: true, payment_status: "Unpaid" };
		}

		// Fully paid
		if (outstanding <= 0.0001 && paid + 0.0001 >= total) {
			return { ok: true, payment_status: "Paid" };
		}

		// Partial requires Allow Partial Payment on the POS Profile
		if (!allow_partial) {
			return {
				ok: false,
				reason: __(
					"Partial payment requires Allow Partial Payment on the POS Profile."
				),
			};
		}

		return { ok: true, payment_status: payment_label(doc) };
	}

	function build_payload(frm, ctx = {}) {
		const doc = frm.doc;
		const local_uuid = uuid();
		const terminal = terminal_id();
		const idempotency_key = `pos:${ctx.pos_profile || doc.pos_profile}:${terminal}:${local_uuid}`;

		// Keep positive payment rows only — zero paid means empty payments list.
		// Server seeds POS Profile modes with amount 0 when needed (ERPNext validate).
		const payments = (doc.payments || [])
			.filter((p) => flt(p.amount) > 0)
			.map((p) => ({
				mode_of_payment: p.mode_of_payment,
				amount: flt(p.amount),
			}));

		const items = (doc.items || [])
			.filter((row) => row.item_code && flt(row.qty) > 0)
			.map((row) => ({
				item_code: row.item_code,
				item_name: row.item_name,
				qty: flt(row.qty),
				uom: row.uom,
				stock_uom: row.stock_uom,
				rate: flt(row.rate),
				price_list_rate: flt(row.price_list_rate),
				discount_percentage: flt(row.discount_percentage),
				discount_amount: flt(row.discount_amount),
				notes: row.notes || "",
				warehouse: row.warehouse || doc.set_warehouse,
			}));

		const total = erpnext.PointOfSale.get_invoice_total
			? erpnext.PointOfSale.get_invoice_total(doc)
			: flt(doc.rounded_total) || flt(doc.grand_total);
		const paid = flt(doc.paid_amount);
		const outstanding = flt(doc.outstanding_amount);

		return {
			local_uuid,
			idempotency_key,
			terminal_id: terminal,
			created_at: new Date().toISOString(),
			pos_profile: ctx.pos_profile || doc.pos_profile,
			pos_opening: ctx.pos_opening || null,
			company: ctx.company || doc.company,
			user: frappe.session.user,
			invoice_doctype: doc.doctype,
			customer: doc.customer,
			customer_name: doc.customer_name,
			local_customer_id: nozom_pos.offline.customer_store?.is_local_id?.(doc.customer)
				? doc.customer
				: null,
			tax_id: doc.tax_id || "",
			customer_address: doc.customer_address || "",
			address_display: doc.address_display || "",
			shipping_address_name: doc.shipping_address_name || "",
			shipping_address: doc.shipping_address || "",
			contact_mobile: doc.contact_mobile || doc.nozom_customer_phone_snapshot || "",
			nozom_address_title_snapshot: doc.nozom_address_title_snapshot || "",
			nozom_customer_phone_snapshot: doc.nozom_customer_phone_snapshot || doc.contact_mobile || "",
			nozom_delivery_location_link_snapshot: doc.nozom_delivery_location_link_snapshot || "",
			local_address_id: doc._local_address_id || null,
			selling_price_list: doc.selling_price_list,
			currency: doc.currency,
			conversion_rate: flt(doc.conversion_rate) || 1,
			order_notes: doc.order_notes || "",
			nozom_order_number: doc.nozom_order_number || "",
			additional_discount_percentage: flt(doc.additional_discount_percentage),
			discount_amount: flt(doc.discount_amount),
			net_total: flt(doc.net_total),
			grand_total: flt(doc.grand_total),
			rounded_total: flt(doc.rounded_total),
			paid_amount: paid,
			change_amount: flt(doc.change_amount),
			outstanding_amount: outstanding,
			payment_status: payment_label({
				rounded_total: total,
				grand_total: total,
				paid_amount: paid,
				outstanding_amount: outstanding,
			}),
			allow_partial_payment: cint(ctx.settings?.allow_partial_payment),
			set_warehouse: doc.set_warehouse,
			taxes: (doc.taxes || []).map((t) => ({
				description: t.description,
				charge_type: t.charge_type,
				account_head: t.account_head,
				rate: flt(t.rate),
				tax_amount_after_discount_amount: flt(t.tax_amount_after_discount_amount),
			})),
			items,
			payments,
		};
	}

	function to_summary_doc(tx) {
		const status = tx.payment_status || payment_label(tx);
		let queue_status = __("Pending Sync");
		if (tx.status === "CONFLICT" || tx.error_code === "VALIDATION_FAILED") {
			queue_status =
				tx.error_code === "VALIDATION_FAILED"
					? __("Sync Failed / Validation Error")
					: __("Conflict");
		} else if (tx.status === "FAILED") {
			queue_status = __("Sync Failed");
		} else if (tx.status === "SYNCING") {
			queue_status = __("Syncing");
		} else if (tx.status === "SYNCED") {
			queue_status = __("Synced");
		}

		return {
			doctype: tx.invoice_doctype || "POS Invoice",
			name: tx.local_receipt_no,
			customer: tx.customer,
			customer_name: tx.customer_name || tx.customer,
			owner: tx.user || frappe.session.user,
			currency: tx.currency,
			paid_amount: tx.paid_amount,
			outstanding_amount: flt(tx.outstanding_amount),
			net_total: tx.net_total,
			grand_total: tx.grand_total,
			rounded_total: tx.rounded_total,
			discount_amount: tx.discount_amount,
			additional_discount_percentage: tx.additional_discount_percentage,
			order_notes: tx.order_notes,
			nozom_order_number: tx.nozom_order_number || "",
			status: `${__(status)} · ${queue_status}`,
			payment_status: status,
			docstatus: 1,
			is_return: 0,
			items: (tx.items || []).map((row, idx) => ({
				...row,
				name: `local-item-${idx + 1}`,
			})),
			payments: tx.payments || [],
			taxes: tx.taxes || [],
			_nozom_local_queue: true,
			_nozom_tx_id: tx.id,
			_nozom_tx: tx,
		};
	}

	function backoff_ms(retry_count) {
		// Conservative: 5s → 10s → 20s → 30s → 45s → 60s (cap)
		const steps = [5000, 10000, 20000, 30000, 45000, 60000];
		const n = Math.max(0, cint(retry_count));
		return steps[Math.min(n, steps.length - 1)];
	}

	function is_ready_for_retry(tx, now = Date.now()) {
		if (!tx) return false;
		if (tx.status === "QUEUED") return true;
		if (tx.status !== "FAILED") return false;
		if (cint(tx.retry_count) >= MAX_RETRIES) return false;
		if (!tx.next_retry_at) return true;
		return new Date(tx.next_retry_at).getTime() <= now;
	}

	async function enqueue(frm, ctx = {}) {
		const check = can_queue_sale(frm.doc, ctx.settings || {});
		if (!check.ok) {
			const err = new Error(check.reason);
			err.nozom_reason = check.reason;
			throw err;
		}

		const payload = build_payload(frm, ctx);
		payload.local_receipt_no = await next_local_receipt_no();

		const record = {
			id: payload.local_uuid,
			...payload,
			status: "QUEUED",
			sync_status: "QUEUED",
			retry_count: 0,
			next_retry_at: null,
			last_error: null,
			server_doctype: null,
			server_name: null,
			queued_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		};

		await db().put("tx_queue", record);
		return record;
	}

	async function list_pending() {
		const all = await db().get_all("tx_queue");
		return all
			.filter((row) => ["QUEUED", "FAILED", "SYNCING"].includes(row.status))
			.sort((a, b) => String(a.queued_at || "").localeCompare(String(b.queued_at || "")));
	}

	async function list_ready(limit = 10) {
		const now = Date.now();
		const pending = await list_pending();
		return pending.filter((tx) => tx.status !== "SYNCING" && is_ready_for_retry(tx, now)).slice(0, limit);
	}

	async function list_conflicts() {
		const all = await db().get_all("tx_queue");
		return all
			.filter((row) => row.status === "CONFLICT")
			.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
	}

	async function list_actionable() {
		const all = await db().get_all("tx_queue");
		return all
			.filter((row) => ["QUEUED", "FAILED", "CONFLICT", "SYNCING"].includes(row.status))
			.sort((a, b) => String(b.updated_at || a.queued_at || "").localeCompare(String(a.updated_at || a.queued_at || "")));
	}

	async function get(id) {
		if (!id) return null;
		return db().get("tx_queue", id);
	}

	async function update(id, patch) {
		const current = await db().get("tx_queue", id);
		if (!current) return null;
		const next = {
			...current,
			...patch,
			updated_at: new Date().toISOString(),
		};
		await db().put("tx_queue", next);
		return next;
	}

	async function mark_failed(id, message, retry_count) {
		const next_retry = cint(retry_count) >= MAX_RETRIES ? null : new Date(Date.now() + backoff_ms(retry_count)).toISOString();
		return update(id, {
			status: cint(retry_count) >= MAX_RETRIES ? "CONFLICT" : "FAILED",
			sync_status: cint(retry_count) >= MAX_RETRIES ? "CONFLICT" : "FAILED",
			last_error: message,
			retry_count,
			next_retry_at: next_retry,
		});
	}

	async function requeue(id) {
		return update(id, {
			status: "QUEUED",
			sync_status: "QUEUED",
			next_retry_at: null,
			last_error: null,
		});
	}

	async function discard(id) {
		return update(id, {
			status: "DISCARDED",
			sync_status: "DISCARDED",
			discarded_at: new Date().toISOString(),
		});
	}

	async function counts() {
		const all = await db().get_all("tx_queue");
		return {
			queued: all.filter((r) => r.status === "QUEUED").length,
			failed: all.filter((r) => r.status === "FAILED").length,
			syncing: all.filter((r) => r.status === "SYNCING").length,
			conflicts: all.filter((r) => r.status === "CONFLICT").length,
			synced: all.filter((r) => r.status === "SYNCED").length,
			discarded: all.filter((r) => r.status === "DISCARDED").length,
		};
	}

	return {
		terminal_id,
		MAX_RETRIES,
		can_queue_sale,
		payment_label,
		build_payload,
		to_summary_doc,
		enqueue,
		get,
		list_pending,
		list_ready,
		list_conflicts,
		list_actionable,
		update,
		mark_failed,
		requeue,
		discard,
		counts,
		backoff_ms,
	};
})();
