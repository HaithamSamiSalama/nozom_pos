frappe.provide("nozom_pos.offline");

/**
 * Compact top-bar status — LEFT side only:
 * NOZOM POS | Online/Offline | Synced/Pending
 *
 * Action buttons (Sync Queue, Fullscreen, Close, Recent Orders) live in
 * page standard-actions on the RIGHT via pos_controller.prepare_btns.
 */
nozom_pos.offline.status_ui = (() => {
	let $bar = null;
	let page_ref = null;
	let state = {
		online: true,
		checking: false,
		queued: 0,
		syncing: 0,
		conflicts: 0,
		cache_items: 0,
		cart_saved: false,
		terminal_id: "",
		message: "",
	};

	function fullscreen_element() {
		return (
			document.fullscreenElement ||
			document.webkitFullscreenElement ||
			document.mozFullScreenElement ||
			document.msFullscreenElement ||
			null
		);
	}

	function is_fullscreen() {
		return Boolean(fullscreen_element());
	}

	function request_fullscreen(el) {
		const target = el || document.documentElement;
		const req =
			target.requestFullscreen ||
			target.webkitRequestFullscreen ||
			target.mozRequestFullScreen ||
			target.msRequestFullscreen;
		if (!req) return Promise.reject(new Error("Fullscreen API unavailable"));
		return Promise.resolve(req.call(target));
	}

	function exit_fullscreen() {
		const exit =
			document.exitFullscreen ||
			document.webkitExitFullscreen ||
			document.mozCancelFullScreen ||
			document.msExitFullscreen;
		if (!exit) return Promise.reject(new Error("Fullscreen exit unavailable"));
		return Promise.resolve(exit.call(document));
	}

	function update_fullscreen_btn($btn) {
		const $target = $btn?.length ? $btn : $(".nozom-fullscreen-btn");
		if (!$target.length) return;
		const active = is_fullscreen();
		$target.toggleClass("is-active", active);
		$target.attr("aria-pressed", active ? "true" : "false");
		$target.find(".nozom-fullscreen-label").text(active ? __("Restore") : __("Fullscreen"));
		if (!$target.find(".nozom-fullscreen-label").length) {
			$target.text(active ? __("Restore") : __("Fullscreen"));
		}
	}

	async function toggle_fullscreen() {
		try {
			if (is_fullscreen()) {
				await exit_fullscreen();
			} else {
				await request_fullscreen(document.documentElement);
			}
		} catch (e) {
			console.warn("NOZOM POS fullscreen:", e);
			(nozom_pos.notify || frappe.show_alert)({
				message: __("Fullscreen requires a user gesture in this browser."),
				indicator: "orange",
			});
		} finally {
			update_fullscreen_btn();
		}
	}

	function bind_fullscreen_events() {
		if (window.__nozom_fs_bound) return;
		window.__nozom_fs_bound = true;
		["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"].forEach(
			(evt) => {
				document.addEventListener(evt, () => update_fullscreen_btn());
			}
		);
	}

	function bind_fullscreen_button($btn) {
		// Fullscreen ONLY via the Fullscreen button click handler in prepare_btns.
		// Never auto-enter fullscreen here — prepare_btns re-runs on language switch.
		bind_fullscreen_events();
		update_fullscreen_btn($btn);
	}

	function open_queue() {
		nozom_pos.offline?.conflict_ui?.open?.();
	}

	function ensure_bar(page, $fallback_wrapper) {
		page_ref = page || page_ref;

		if ($bar && $bar.length && $bar.closest("body").length) {
			return $bar;
		}

		$(".nozom-pos-topbar, .nozom-pos-sync-status").remove();

		const html = `
			<div class="nozom-pos-topbar" role="status" aria-live="polite">
				<div class="nozom-pos-topbar__brand">${__("NOZOM POS")}</div>
				<div class="nozom-pos-topbar__pills">
					<span class="nozom-pill nozom-pill-conn">
						<span class="nozom-pill-dot"></span>
						<span class="nozom-pill-conn-text"></span>
					</span>
					<span class="nozom-pill nozom-pill-sync"></span>
				</div>
			</div>
		`;

		const $page_head = page_ref?.wrapper
			? $(page_ref.wrapper).find(".page-head .page-head-content").first()
			: $();

		if ($page_head.length) {
			$page_head.prepend(html);
			$bar = $page_head.find(".nozom-pos-topbar");
		} else if ($fallback_wrapper?.length) {
			$fallback_wrapper.prepend(html);
			$bar = $fallback_wrapper.find(".nozom-pos-topbar");
		} else {
			$("body").prepend(html);
			$bar = $(".nozom-pos-topbar").first();
		}

		bind_fullscreen_events();
		update_fullscreen_btn();
		return $bar;
	}

	function update_queue_badges(pending) {
		// Right-side Sync Queue button (page actions)
		$(".nozom-sync-queue-btn").each(function () {
			const $b = $(this);
			const $badge = $b.find(".nozom-sync-queue-count");
			if (!$badge.length) return;
			if (pending > 0) {
				$badge.prop("hidden", false).text(pending);
				$b.addClass("has-pending");
			} else {
				$badge.prop("hidden", true).text("0");
				$b.removeClass("has-pending");
			}
		});
	}

	function render() {
		if (!$bar || !$bar.length) return;

		const online = state.online;
		const syncing = cint(state.syncing) > 0;
		const conflicts = cint(state.conflicts) > 0;
		const queued = cint(state.queued);
		const pending = queued + conflicts;

		$bar.toggleClass("is-offline", !online);
		$bar.toggleClass("is-online", online);
		$bar.toggleClass("is-syncing", syncing);
		$bar.toggleClass("has-pending", pending > 0);

		$bar.find(".nozom-pill-conn-text").text(online ? __("Online") : __("Offline"));
		$bar
			.find(".nozom-pill-conn")
			.toggleClass("is-online", online)
			.toggleClass("is-offline", !online);

		let sync_text = __("Synced");
		let sync_cls = "is-synced";
		if (!online) {
			sync_text = pending ? __("{0} Pending", [pending]) : __("Offline");
			sync_cls = "is-pending";
		} else if (conflicts) {
			sync_text = __("Sync conflicts: {0}", [conflicts]);
			sync_cls = "is-conflict";
		} else if (syncing) {
			sync_text = __("Syncing");
			sync_cls = "is-syncing";
		} else if (queued > 0) {
			sync_text = __("Pending sync: {0}", [queued]);
			sync_cls = "is-pending";
		}

		$bar
			.find(".nozom-pill-sync")
			.attr("class", `nozom-pill nozom-pill-sync ${sync_cls}`)
			.text(sync_text);

		update_queue_badges(pending);
		update_fullscreen_btn();
	}

	function mount(page_or_wrapper, maybe_wrapper) {
		if (page_or_wrapper?.wrapper || page_or_wrapper?.set_title) {
			ensure_bar(page_or_wrapper, maybe_wrapper ? $(maybe_wrapper) : null);
		} else {
			ensure_bar(page_ref, $(page_or_wrapper));
		}
		render();
		return $bar;
	}

	function update(partial = {}) {
		state = { ...state, ...partial };
		render();
	}

	function get_state() {
		return { ...state };
	}

	return {
		mount,
		update,
		get_state,
		toggle_fullscreen,
		is_fullscreen,
		bind_fullscreen_button,
		open_queue,
	};
})();
