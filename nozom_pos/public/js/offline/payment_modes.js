frappe.provide("nozom_pos.offline");

/**
 * POS Profile payment modes — server is authoritative when online.
 *
 * Sources (in priority when online):
 * 1. Fresh nozom_pos.api.payment_modes.get_profile_payment_modes (includes company account)
 * 2. Controller settings.payments (may lack account until enriched)
 * 3. IndexedDB pos_config / invoice bootstrap (offline only)
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
			account: cstr(pay.account || pay.default_account || "").trim(),
			type: pay.type || "",
			default: cint(pay.default),
			allow_in_returns: cint(pay.allow_in_returns),
			missing_account: cint(pay.missing_account) || !cstr(pay.account || pay.default_account || "").trim(),
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
			// Still fill blank accounts from wanted (profile refresh may add them).
			let filled = false;
			existing.forEach((p) => {
				if (!p.mode_of_payment || p.account) return;
				const match = wanted.find((w) => w.mode_of_payment === p.mode_of_payment);
				if (match?.account) {
					p.account = match.account;
					if (match.type) p.type = match.type;
					filled = true;
				}
			});
			if (filled) frm.refresh_field("payments");
			return filled;
		}

		if (has_amounts) {
			const have = new Set(existing.map((p) => p.mode_of_payment).filter(Boolean));
			let added = false;
			wanted.forEach((pay) => {
				if (have.has(pay.mode_of_payment)) {
					const row = existing.find((p) => p.mode_of_payment === pay.mode_of_payment);
					if (row && !row.account && pay.account) {
						row.account = pay.account;
						if (pay.type) row.type = pay.type;
						added = true;
					}
					return;
				}
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

	async function fetch_enriched_modes(pos_profile, company) {
		const request = window.nozom_pos?.offline?.request;
		const call = request?.call
			? (opts) => request.call({ ...opts, timeout_ms: opts.timeout_ms || 5000 })
			: (opts) =>
					new Promise((resolve, reject) => {
						frappe.call({
							...opts,
							freeze: false,
							callback: (r) => resolve(r),
							error: (e) => reject(e),
						});
					});

		const r = await call({
			method: "nozom_pos.api.payment_modes.get_profile_payment_modes",
			args: { pos_profile, company },
			timeout_label: "payment_modes",
		});
		return r.message || null;
	}

	/**
	 * When online: pull latest POS Profile payments with accounts, update
	 * controller.settings, refresh IndexedDB cache, sync onto draft invoice.
	 */
	async function refresh_from_server(controller, { sync_frm = true } = {}) {
		if (!controller?.pos_profile) return null;
		const online =
			!window.nozom_pos?.offline?.network || nozom_pos.offline.network.is_online();
		if (!online) {
			return list_from_settings(controller.settings);
		}

		let payload;
		try {
			payload = await fetch_enriched_modes(controller.pos_profile, controller.company);
			nozom_pos.offline.network?.mark_reachable?.({ reason: "pos_profile_payments" });
		} catch (e) {
			console.warn("NOZOM POS payment modes refresh failed:", e);
			const request = window.nozom_pos?.offline?.request;
			if (request?.is_network_failure?.(e)) {
				request.mark_if_unreachable(e);
			} else {
				nozom_pos.offline?.network?.mark_reachable?.({ reason: "payment_modes_app_error" });
			}
			return list_from_settings(controller.settings);
		}

		if (!payload) return list_from_settings(controller.settings);

		const payments = (payload.payments || []).map(normalize_row).filter(Boolean);
		const prev_modified = controller.settings?.modified;
		const next_modified = payload.modified;

		controller.settings = Object.assign(controller.settings || {}, {
			modified: next_modified || controller.settings?.modified,
			payments: payments.map((p) => ({
				mode_of_payment: p.mode_of_payment,
				default: p.default,
				allow_in_returns: p.allow_in_returns,
				account: p.account,
				type: p.type,
				missing_account: p.missing_account,
			})),
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

	/**
	 * Ensure every positive-amount payment row has mode + account for company.
	 * Throws a cashier-facing application error when config is incomplete.
	 */
	function assert_paid_rows_have_accounts(frm, modes) {
		const company = frm?.doc?.company || "";
		const positive = (modes || []).filter((row) => flt(row.amount) > 0.0000001);
		if (!positive.length) return;

		const missing_mop = positive.filter((row) => !cstr(row.mode_of_payment || "").trim());
		if (missing_mop.length) {
			const err = new Error(__("Mode of Payment is required for every payment amount."));
			err.nozom_application_error = true;
			err.exc_type = "ValidationError";
			throw err;
		}

		const missing_acct = positive.filter((row) => !cstr(row.account || "").trim());
		if (!missing_acct.length) return;

		// Try fill from frm / settings before failing
		const by_mode = {};
		(frm?.doc?.payments || []).forEach((p) => {
			if (p.mode_of_payment && p.account) by_mode[p.mode_of_payment] = p.account;
		});
		(modes || []).forEach((m) => {
			if (m.mode_of_payment && m.account) by_mode[m.mode_of_payment] = m.account;
		});

		missing_acct.forEach((row) => {
			if (by_mode[row.mode_of_payment]) row.account = by_mode[row.mode_of_payment];
		});

		const still_missing = positive.filter((row) => !cstr(row.account || "").trim());
		if (!still_missing.length) return;

		const names = still_missing.map((r) => r.mode_of_payment).join(", ");
		const err = new Error(
			__(
				"Payment account is missing for {0}. Set the default Cash or Bank account on Mode of Payment for company {1}.",
				[names, company || __("the current company")]
			)
		);
		err.nozom_application_error = true;
		err.exc_type = "ValidationError";
		throw err;
	}

	return {
		normalize_row,
		list_from_settings,
		sync_onto_frm,
		refresh_from_server,
		resolve_for_checkout,
		assert_paid_rows_have_accounts,
	};
})();
