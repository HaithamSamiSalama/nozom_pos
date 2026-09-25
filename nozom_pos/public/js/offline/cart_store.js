frappe.provide("nozom_pos.offline");

/**
 * Phase B: persist the active POS cart for crash / refresh recovery.
 * Only snapshots with at least one item are restorable.
 */
nozom_pos.offline.cart = (() => {
	const db = () => nozom_pos.offline.db;

	function cart_id(pos_profile, user) {
		return `active_cart::${pos_profile || ""}::${user || frappe.session.user}`;
	}

	function storage_key(pos_profile, user) {
		return `nozom_pos:${cart_id(pos_profile, user)}`;
	}

	function serialize_item(row) {
		return {
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
			batch_no: row.batch_no || "",
			serial_no: row.serial_no || "",
			warehouse: row.warehouse || "",
			use_serial_batch_fields: row.use_serial_batch_fields || 1,
		};
	}

	function valid_items(doc) {
		return (doc?.items || []).filter((row) => row.item_code && flt(row.qty) > 0);
	}

	function build_snapshot(frm, ctx = {}) {
		if (!frm?.doc) return null;

		const doc = frm.doc;
		if (cint(doc.docstatus) === 1 || cint(doc.is_return)) return null;

		const items = valid_items(doc).map(serialize_item);

		// Never persist empty / customer-only carts — causes false restore prompts.
		if (!items.length) return null;

		return {
			id: cart_id(ctx.pos_profile || doc.pos_profile, ctx.user),
			status: "DRAFT_LOCAL",
			pos_profile: ctx.pos_profile || doc.pos_profile,
			company: ctx.company || doc.company,
			pos_opening: ctx.pos_opening || null,
			user: ctx.user || frappe.session.user,
			doctype: doc.doctype,
			customer: doc.customer || "",
			customer_name: doc.customer_name || "",
			customer_address: doc.customer_address || "",
			address_display: doc.address_display || "",
			shipping_address_name: doc.shipping_address_name || "",
			shipping_address: doc.shipping_address || "",
			contact_mobile: doc.contact_mobile || "",
			nozom_address_title_snapshot: doc.nozom_address_title_snapshot || "",
			nozom_customer_phone_snapshot: doc.nozom_customer_phone_snapshot || "",
			nozom_delivery_location_link_snapshot: doc.nozom_delivery_location_link_snapshot || "",
			_selected_address: doc._nozom_selected_address || doc.shipping_address_name || doc.customer_address || "",
			_local_address_id: doc._local_address_id || null,
			selling_price_list: doc.selling_price_list || "",
			order_notes: doc.order_notes || "",
			nozom_order_number: doc.nozom_order_number || "",
			additional_discount_percentage: flt(doc.additional_discount_percentage),
			discount_amount: flt(doc.discount_amount),
			items,
			updated_at: new Date().toISOString(),
			schema_version: 3,
		};
	}

	function write_local_storage(snapshot) {
		try {
			localStorage.setItem(
				storage_key(snapshot.pos_profile, snapshot.user),
				JSON.stringify(snapshot)
			);
		} catch (e) {
			console.warn("NOZOM POS cart localStorage save failed:", e);
		}
	}

	function read_local_storage(pos_profile, user) {
		try {
			const raw = localStorage.getItem(storage_key(pos_profile, user));
			return raw ? JSON.parse(raw) : null;
		} catch (e) {
			return null;
		}
	}

	function clear_local_storage(pos_profile, user) {
		try {
			localStorage.removeItem(storage_key(pos_profile, user));
		} catch (e) {
			/* ignore */
		}
	}

	function is_restorable(snapshot) {
		return Boolean(snapshot && Array.isArray(snapshot.items) && snapshot.items.length > 0);
	}

	async function save(frm, ctx = {}) {
		const snapshot = build_snapshot(frm, ctx);
		if (!snapshot) {
			await clear(ctx);
			return null;
		}

		write_local_storage(snapshot);
		await db().put("active_cart", snapshot);
		return snapshot;
	}

	async function load(ctx = {}) {
		const id = cart_id(ctx.pos_profile, ctx.user);
		let snapshot = null;
		try {
			snapshot = await db().get("active_cart", id);
		} catch (e) {
			console.warn("NOZOM POS cart IndexedDB load failed:", e);
		}

		if (!snapshot) {
			snapshot = read_local_storage(ctx.pos_profile, ctx.user);
		}

		// Auto-purge stale empty / customer-only snapshots
		if (snapshot && !is_restorable(snapshot)) {
			await clear(ctx);
			return null;
		}
		return snapshot;
	}

	async function clear(ctx = {}) {
		const id = cart_id(ctx.pos_profile, ctx.user);
		clear_local_storage(ctx.pos_profile, ctx.user);
		try {
			await db().remove("active_cart", id);
		} catch (e) {
			console.warn("NOZOM POS cart clear failed:", e);
		}
	}

	function flush_sync(frm, ctx = {}) {
		const snapshot = build_snapshot(frm, ctx);
		if (!snapshot) {
			clear_local_storage(ctx.pos_profile || frm?.doc?.pos_profile, ctx.user);
			db()
				.remove("active_cart", cart_id(ctx.pos_profile || frm?.doc?.pos_profile, ctx.user))
				.catch(() => {});
			return null;
		}
		write_local_storage(snapshot);
		db()
			.put("active_cart", snapshot)
			.catch((e) => console.warn("NOZOM POS cart flush failed:", e));
		return snapshot;
	}

	function has_content(snapshot) {
		return is_restorable(snapshot);
	}

	return {
		cart_id,
		build_snapshot,
		save,
		load,
		clear,
		flush_sync,
		has_content,
		is_restorable,
	};
})();
