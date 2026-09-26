frappe.provide("nozom_pos.offline");

/**
 * Offline navigation / Close POS safety guards.
 * Native browser chrome cannot be fully disabled; this is best-effort.
 */
nozom_pos.offline.guards = (() => {
	let enabled = false;
	let controller = null;
	let close_btn = null;
	let popstate_bound = false;

	const MSG = () =>
		__(
			"Internet connection is unavailable. You can continue selling offline, but this action is disabled until the connection is restored."
		);

	function show_blocked() {
		const msg = MSG();
		// Blocking dialog only — no floating toast
		frappe.msgprint({
			title: __("Offline"),
			indicator: "orange",
			message: msg,
		});
	}

	async function has_pending() {
		try {
			const counts = await nozom_pos.offline.tx_queue.counts();
			return cint(counts.queued) + cint(counts.conflicts) + cint(counts.syncing) > 0;
		} catch (e) {
			return false;
		}
	}

	function on_beforeunload(e) {
		if (!enabled) return;
		e.preventDefault();
		e.returnValue = MSG();
		return MSG();
	}

	function on_keydown(e) {
		if (!enabled) return;
		const key = (e.key || "").toLowerCase();
		const reload =
			key === "f5" || ((e.ctrlKey || e.metaKey) && key === "r") || ((e.ctrlKey || e.metaKey) && key === "f5");
		if (reload) {
			e.preventDefault();
			e.stopPropagation();
			show_blocked();
		}
	}

	function on_popstate() {
		if (!enabled) return;
		history.pushState({ nozom_pos_guard: 1 }, "", location.href);
		show_blocked();
	}

	function set_close_btn_state() {
		if (!close_btn || !close_btn.length) return;
		if (enabled) {
			close_btn.addClass("disabled nozom-offline-disabled").attr("disabled", true);
			close_btn.attr("title", MSG());
		} else {
			close_btn.removeClass("disabled nozom-offline-disabled").removeAttr("disabled");
			close_btn.removeAttr("title");
		}
	}

	function bind_close_interceptor() {
		if (!close_btn || !close_btn.length) return;
		close_btn.off("click.nozom_guard").on("click.nozom_guard", async function (e) {
			// Online: allow Close POS popup to open (it handles pending-sales UX).
			// Offline: block Close POS — closing requires the server.
			if (!enabled) return;
			e.preventDefault();
			e.stopImmediatePropagation();
			show_blocked();
			return false;
		});
	}

	function enable() {
		if (enabled) {
			set_close_btn_state();
			return;
		}
		enabled = true;
		window.addEventListener("beforeunload", on_beforeunload);
		document.addEventListener("keydown", on_keydown, true);
		if (!popstate_bound) {
			history.pushState({ nozom_pos_guard: 1 }, "", location.href);
			window.addEventListener("popstate", on_popstate);
			popstate_bound = true;
		}
		set_close_btn_state();
	}

	function disable() {
		if (!enabled) {
			set_close_btn_state();
			return;
		}
		enabled = false;
		window.removeEventListener("beforeunload", on_beforeunload);
		document.removeEventListener("keydown", on_keydown, true);
		set_close_btn_state();
	}

	function set_online(online) {
		if (online) disable();
		else enable();
	}

	function init(ctrl, $close_btn) {
		controller = ctrl;
		close_btn = $close_btn;
		bind_close_interceptor();
		const online = !nozom_pos.offline.network || nozom_pos.offline.network.is_online();
		set_online(online);

		if (!window.__nozom_guards_net_bound) {
			window.__nozom_guards_net_bound = true;
			nozom_pos.offline.network?.on_change?.((net) => {
				set_online(net.online);
			});
		}
	}

	function is_enabled() {
		return enabled;
	}

	return {
		init,
		enable,
		disable,
		set_online,
		is_enabled,
		has_pending,
		show_blocked,
		MSG,
	};
})();
