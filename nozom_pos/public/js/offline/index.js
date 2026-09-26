frappe.provide("nozom_pos.offline");

/**
 * Offline bootstrap — local-first.
 * Connectivity chatter is suppressed; top-bar status is the source of truth.
 */
nozom_pos.offline.init = async function init_offline_layer(ctx = {}) {
	const { wrapper, pos_profile, company, pos_opening, settings, price_list } = ctx;

	try {
		await nozom_pos.offline.db.open();
	} catch (e) {
		console.warn("NOZOM POS offline storage unavailable:", e);
		return null;
	}

	nozom_pos.offline.network.start();

	if (!window.__nozom_pos_ajax_guard) {
		window.__nozom_pos_ajax_guard = true;
		$(document).on("ajaxError.nozom_pos", (_event, jqxhr) => {
			if (!$("body").hasClass("nozom-pos-page-active")) return;
			const status = cint(jqxhr?.status);
			if (status === 0 || status === 502 || status === 503 || status === 504) {
				nozom_pos.offline.network.mark_unreachable({ reason: `ajax_${status}` });
				nozom_pos.offline.request?.force_unfreeze?.();
			}
		});
		$(document).on("ajaxSuccess.nozom_pos", (_event, _xhr, settings) => {
			if (!$("body").hasClass("nozom-pos-page-active")) return;
			const url = cstr(settings?.url || "");
			if (!url.includes("/api/") && !url.includes("cmd=")) return;
			nozom_pos.offline.network.mark_reachable({ reason: "ajax_ok" });
		});
	}

	const $wrapper = $(wrapper);
	nozom_pos.offline.status_ui.mount(ctx.page || null, $wrapper);

	const refresh_stats = async () => {
		try {
			const stats = await nozom_pos.offline.catalog.get_cache_stats(pos_profile);
			const queue_counts = await nozom_pos.offline.tx_queue.counts();
			const terminal = nozom_pos.offline.tx_queue.terminal_id?.() || "";
			nozom_pos.offline.status_ui.update({
				online: nozom_pos.offline.network.is_online(),
				queued: queue_counts.queued,
				syncing: queue_counts.syncing,
				conflicts: queue_counts.conflicts,
				cache_items: stats.item_count || 0,
				terminal_id: terminal,
			});
		} catch (e) {
			nozom_pos.offline.status_ui.update({
				online: nozom_pos.offline.network.is_online(),
			});
		}
	};

	if (!window.__nozom_pos_net_listener) {
		window.__nozom_pos_net_listener = true;
		nozom_pos.offline.network.on_change((net) => {
			nozom_pos.offline.status_ui.update({
				online: net.online,
				checking: false,
				message: "",
			});
			if (net.online) {
				nozom_pos.offline.request?.force_unfreeze?.();
				nozom_pos.offline.sync_worker.flush();
			} else {
				nozom_pos.offline.request?.force_unfreeze?.();
			}
		});
	}

	await nozom_pos.offline.catalog.save_pos_config({
		pos_profile,
		company,
		pos_opening,
		settings,
		price_list: price_list || settings?.selling_price_list,
	});

	nozom_pos.offline.sync_worker.set_ctx(ctx);
	nozom_pos.offline.sync_worker.start();

	try {
		await nozom_pos.offline.pwa.init();
	} catch (e) {
		console.warn("NOZOM POS PWA init failed:", e);
	}

	await refresh_stats();
	nozom_pos.offline.refresh_status = refresh_stats;

	if (nozom_pos.offline.network.is_online()) {
		frappe.call({
			method: "nozom_pos.api.offline.ensure_offline_fields",
			callback: () => {
				nozom_pos.offline.network.mark_reachable({ reason: "ensure_fields" });
			},
			error: () => {
				nozom_pos.offline.network.mark_unreachable({ reason: "ensure_fields_fail" });
			},
		});
		nozom_pos.offline.sync_worker.flush();
	}

	return {
		refresh_status: refresh_stats,
	};
};
