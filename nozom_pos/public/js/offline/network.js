frappe.provide("nozom_pos.offline");

/**
 * LOCAL-FIRST backend availability for NOZOM POS.
 *
 * No periodic health-check polling. Connectivity is inferred from:
 * - real POS / sync request success or failure
 * - browser online / offline events
 * - conservative sync retries only when the queue has pending work
 *
 * States:
 * - ONLINE
 * - OFFLINE_BACKEND (browser may still be online)
 * - OFFLINE_DEVICE
 */
nozom_pos.offline.network = (() => {
	const listeners = new Set();
	// Kept for callers that previously passed probe timeouts — not used for pings.
	const CART_PROBE_TIMEOUT_MS = 2500;
	const DEFAULT_PROBE_TIMEOUT_MS = 3000;

	let server_available = typeof navigator !== "undefined" ? navigator.onLine : true;
	let started = false;
	let last_change_at = 0;
	let last_ok_at = 0;
	let last_fail_at = 0;

	function device_is_online() {
		return typeof navigator === "undefined" ? true : Boolean(navigator.onLine);
	}

	function get_status() {
		if (!device_is_online()) return "OFFLINE_DEVICE";
		return server_available ? "ONLINE" : "OFFLINE_BACKEND";
	}

	function get_state() {
		return {
			online: server_available,
			server_available,
			device_online: device_is_online(),
			probed: true,
			checking: false,
			last_change_at,
			last_ok_at,
			last_fail_at,
			status: get_status(),
		};
	}

	function is_online() {
		return Boolean(server_available);
	}

	function notify() {
		const state = get_state();
		listeners.forEach((fn) => {
			try {
				fn(state);
			} catch (e) {
				console.error(e);
			}
		});
	}

	/**
	 * Only notify listeners when ONLINE ↔ OFFLINE actually flips.
	 * No connectivity toasts — top-bar status is enough.
	 */
	function set_server_available(value, { reason = "" } = {}) {
		const next = Boolean(value);
		if (next === server_available) {
			if (next) last_ok_at = Date.now();
			else last_fail_at = Date.now();
			return false;
		}

		const was_online = server_available;
		server_available = next;
		last_change_at = Date.now();
		if (next) last_ok_at = last_change_at;
		else last_fail_at = last_change_at;

		if (!next) {
			nozom_pos.offline?.request?.force_unfreeze?.();
		}

		notify();

		if (next && !was_online) {
			// Real recovery — sync worker listens and flushes pending work.
			console.info("NOZOM POS backend ONLINE", reason || "");
		} else if (!next && was_online) {
			console.info("NOZOM POS backend OFFLINE", reason || "");
		}
		return true;
	}

	function mark_reachable(opts = {}) {
		if (!device_is_online()) {
			set_server_available(false, { reason: "device_offline" });
			return false;
		}
		return set_server_available(true, { reason: opts.reason || "request_ok" });
	}

	function mark_unreachable(opts = {}) {
		return set_server_available(false, { reason: opts.reason || "request_failed" });
	}

	/**
	 * Legacy API: do NOT ping the server.
	 * Returns current local-first flag so callers keep working.
	 */
	async function ensure_fresh() {
		if (!device_is_online()) {
			mark_unreachable({ reason: "device_offline" });
			return false;
		}
		return is_online();
	}

	/**
	 * Optional opportunistic check — only used when there is pending sync work
	 * (browser came back online). Still a single short request, never on an interval.
	 */
	async function probe({ timeout_ms = DEFAULT_PROBE_TIMEOUT_MS } = {}) {
		if (!device_is_online()) {
			mark_unreachable({ reason: "device_offline" });
			return false;
		}

		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), timeout_ms);
			let response;
			try {
				response = await fetch("/api/method/frappe.ping", {
					method: "GET",
					credentials: "same-origin",
					cache: "no-store",
					headers: { "X-Frappe-CSRF-Token": frappe.csrf_token || "" },
					signal: controller.signal,
				});
			} finally {
				clearTimeout(timeout);
			}
			if (response.ok) {
				mark_reachable({ reason: "probe_ok" });
				return true;
			}
			mark_unreachable({ reason: "probe_http" });
			return false;
		} catch (e) {
			mark_unreachable({ reason: "probe_error" });
			return false;
		}
	}

	function on_change(fn) {
		listeners.add(fn);
		return () => listeners.delete(fn);
	}

	function start() {
		if (started) return;
		started = true;

		window.addEventListener("online", () => {
			// Do not auto-mark ONLINE — wait for a real successful request,
			// or a pending-queue soft probe from sync_worker.
			nozom_pos.offline?.sync_worker?.on_browser_online?.();
		});
		window.addEventListener("offline", () => mark_unreachable({ reason: "browser_offline" }));
	}

	function stop() {
		started = false;
	}

	return {
		start,
		stop,
		probe,
		ensure_fresh,
		mark_reachable,
		mark_unreachable,
		is_online,
		get_state,
		get_status,
		on_change,
		CART_PROBE_TIMEOUT_MS,
		DEFAULT_PROBE_TIMEOUT_MS,
	};
})();
