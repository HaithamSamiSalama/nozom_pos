frappe.provide("nozom_pos.offline");

/**
 * POS Profile payment modes — server is authoritative when online.
 *
 * Sources (in priority when online):
 * 1. Fresh `get_pos_profile_data` / POS Profile.payments
 * 2. Controller `settings.payments` (loaded at POS boot)
 * 3. IndexedDB `pos_config` / invoice bootstrap (offline only)
 *
 * Cache is invalidated when POS Profile.modified changes.
 */
nozom_pos.offline.payment_modes = (() => {
	function normalize_row(pay) {
		if (!pay) return null;
		const mode = cstr(pay.mode_of_payment || pay.mop || "").trim();
		if (!mode) return null;
		return {
			mode_of_payment: mode,
			account: pay.account || pay.default_account || "",
			type: pay.type || "",
			default: cint(pay.default),
			allow_in_returns: cint(pay.allow_in_returns),
			amount: 0,
		};
	}

	function list_from_settings(settings) {
		return (settings?.payments || []).map(normalize_row).filter(Boolean);
	}

	function modes_signature(rows) {
		return (rows || [])
			.map((r) => `${r.mode_of_payment}|${cint(r.default)}|${r.account || ""}|${r.type || ""}`)
			.join("||");
	}

	/**
	 * Sync invoice payment child table to profile modes.
	 * Preserves entered amounts when the cashier already typed values.
	 * Adds missing modes; replaces the full set when all amounts are zero.
	 */
	function sync_onto_frm(frm, profile_payments) {
		if (!frm?.doc) return false;
		const wanted = (profile_payments || []).map(normalize_row).filter(Boolean);
		if (!wanted.length) return false;

		const existing = frm.doc.payments || [];
		const has_amounts = existing.some((p) => flt(p.amount) !== 0);
		const amount_by_mode = {};
		existing.forEach((p) => {
			if (p.mode_of_payment) amount_by_mode[p.mode_of_payment] = flt(p.amount);
		});

		const existing_sig = modes_signature(
			existing.filter((p) => p.mode_of_payment).map(normalize_row)
		);
		const wanted_sig = modes_signature(wanted);
		if (existing_sig === wanted_sig && existing.length) {
			return false;
		}

		if (has_amounts) {
			const have = new Set(existing.map((p) => p.mode_of_payment).filter(Boolean));
			let added = false;
			wanted.forEach((pay) => {
				if (have.has(pay.mode_of_payment)) return;
				const row = frm.add_child("payments");
				row.mode_of_payment = pay.mode_of_payment;
				row.account = pay.account;
				row.type = pay.type;
				row.default = pay.default;
				row.amount = 0;
				added = true;
			});
			if (added) frm.refresh_field("payments");
			return added;
		}

		frm.clear_table("payments");
		wanted.forEach((pay) => {
			const row = frm.add_child("payments");
			row.mode_of_payment = pay.mode_of_payment;
			row.account = pay.account;
			row.type = pay.type;
			row.default = pay.default;
			row.amount = amount_by_mode[pay.mode_of_payment] || 0;
		});
		frm.refresh_field("payments");
		return true;
	}

	async function fetch_profile_data(pos_profile) {
		if (!pos_profile) return null;
		const r = await frappe.call({
			method: "erpnext.selling.page.point_of_sale.point_of_sale.get_pos_profile_data",
			args: { pos_profile },
			freeze: false,
		});
		return r.message || null;
	}

	/**
	 * When online: pull latest POS Profile payments, update controller.settings,
	 * refresh IndexedDB cache if modified changed, sync onto current draft invoice.
	 */
	async function refresh_from_server(controller, { sync_frm = true } = {}) {
		if (!controller?.pos_profile) return null;
		const online =
			!window.nozom_pos?.offline?.network || nozom_pos.offline.network.is_online();
		if (!online) {
			return list_from_settings(controller.settings);
		}

		let profile;
		try {
			profile = await fetch_profile_data(controller.pos_profile);
			nozom_pos.offline.network?.mark_reachable?.({ reason: "pos_profile_payments" });
		} catch (e) {
			console.warn("NOZOM POS payment modes refresh failed:", e);
			nozom_pos.offline.network?.mark_unreachable?.({ reason: "pos_profile_payments" });
			return list_from_settings(controller.settings);
		}

		if (!profile) return list_from_settings(controller.settings);

		const payments = list_from_settings(profile);
		const prev_modified = controller.settings?.modified;
		const next_modified = profile.modified;

		controller.settings = Object.assign(controller.settings || {}, profile, {
			payments: profile.payments || [],
			customer_groups: (profile.customer_groups || []).map((g) =>
				typeof g === "string" ? g : g.name
			),
			frm_doctype: controller.settings?.frm_doctype,
			invoice_fields: controller.settings?.invoice_fields,
		});

		const catalog = nozom_pos.offline.catalog;
		if (catalog?.save_pos_config) {
			const cached = await catalog.get_pos_config?.(controller.pos_profile);
			const cache_modified = cached?.settings?.modified || cached?.profile_modified;
			if (!cache_modified || cache_modified !== next_modified || prev_modified !== next_modified) {
				try {
					await catalog.save_pos_config({
						pos_profile: controller.pos_profile,
						company: controller.company,
						pos_opening: controller.pos_opening,
						settings: controller.settings,
						price_list:
							controller.settings?.selling_price_list ||
							controller.frm?.doc?.selling_price_list,
						profile_modified: next_modified,
					});
					if (controller.frm?.doc && catalog.cache_invoice_bootstrap) {
						await catalog.cache_invoice_bootstrap(controller.frm, {
							pos_profile: controller.pos_profile,
							settings: controller.settings,
						});
					}
				} catch (e) {
					console.warn("NOZOM POS payment modes cache update failed:", e);
				}
			}
		}

		if (sync_frm && controller.frm?.doc && !cint(controller.frm.doc.docstatus)) {
			sync_onto_frm(controller.frm, payments);
		}

		return payments;
	}

	async function resolve_for_checkout(controller, frm) {
		const online =
			!window.nozom_pos?.offline?.network || nozom_pos.offline.network.is_online();

		if (online) {
			const payments = await refresh_from_server(controller, { sync_frm: true });
			if (payments?.length) return payments;
		}

		let payments = list_from_settings(controller?.settings);
		if (payments.length) {
			sync_onto_frm(frm, payments);
			return payments;
		}

		try {
			const config = await nozom_pos.offline.catalog?.get_pos_config?.(
				controller?.pos_profile
			);
			payments = list_from_settings(config?.settings);
			if (payments.length) {
				sync_onto_frm(frm, payments);
				return payments;
			}
			const bootstrap = await nozom_pos.offline.catalog?.get_invoice_bootstrap?.(
				controller?.pos_profile
			);
			payments = (bootstrap?.payments || []).map(normalize_row).filter(Boolean);
			if (payments.length) sync_onto_frm(frm, payments);
		} catch (e) {
			/* ignore */
		}
		return payments;
	}

	return {
		normalize_row,
		list_from_settings,
		sync_onto_frm,
		refresh_from_server,
		resolve_for_checkout,
	};
})();
