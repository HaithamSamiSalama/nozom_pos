frappe.provide("nozom_pos.offline");

/**
 * Fail-fast helpers for NOZOM POS network work.
 * Does not patch global frappe.call — only used by POS offline paths.
 */
nozom_pos.offline.request = (() => {
	const DEFAULT_TIMEOUT_MS = 3000;
	const HEALTH_TIMEOUT_MS = 2500;

	function TimeoutError(message, timeout_ms) {
		const err = new Error(message || __("Request timed out"));
		err.name = "NozomTimeoutError";
		err.nozom_timeout = true;
		err.timeout_ms = timeout_ms;
		return err;
	}

	function is_network_failure(err) {
		if (!err) return false;
		if (err.nozom_timeout) return true;
		if (err.name === "AbortError") return true;
		const status = cint(err.status || err.statusCode || err.xhr?.status);
		if (status === 0 || status === 502 || status === 503 || status === 504) return true;
		const msg = cstr(err.message || err.statusText || "").toLowerCase();
		return (
			msg.includes("timeout") ||
			msg.includes("network") ||
			msg.includes("failed to fetch") ||
			msg.includes("load failed") ||
			msg.includes("connection")
		);
	}

	function mark_if_unreachable(err) {
		if (is_network_failure(err)) {
			nozom_pos.offline?.network?.mark_unreachable?.({ reason: "request_failed" });
			return true;
		}
		return false;
	}

	/**
	 * Race a promise against a hard timeout. Does not cancel the underlying work,
	 * but unlocks the UI so POS can fall back to offline immediately.
	 */
	function with_timeout(promise, timeout_ms = DEFAULT_TIMEOUT_MS, label = "request") {
		const ms = cint(timeout_ms) || DEFAULT_TIMEOUT_MS;
		let timer = null;
		const timeout_promise = new Promise((_, reject) => {
			timer = setTimeout(() => {
				reject(TimeoutError(__(`Timed out waiting for {0}`, [label]), ms));
			}, ms);
		});

		return Promise.race([Promise.resolve(promise), timeout_promise]).finally(() => {
			if (timer) clearTimeout(timer);
		});
	}

	/**
	 * frappe.call with freeze disabled and a hard timeout.
	 * On timeout / network error → mark backend unavailable.
	 */
	function call(opts = {}) {
		const timeout_ms = cint(opts.timeout_ms) || DEFAULT_TIMEOUT_MS;
		const label = opts.timeout_label || opts.method || "server";

		return with_timeout(
			new Promise((resolve, reject) => {
				const args = { ...opts };
				delete args.timeout_ms;
				delete args.timeout_label;
				args.freeze = false;

				const prev_callback = args.callback;
				const prev_error = args.error;

				args.callback = (r) => {
					try {
						prev_callback?.(r);
					} finally {
						nozom_pos.offline?.network?.mark_reachable?.({ reason: "call_ok" });
						resolve(r);
					}
				};
				args.error = (r) => {
					try {
						prev_error?.(r);
					} finally {
						mark_if_unreachable(r || { status: 0 });
						reject(r || TimeoutError(__("Server request failed"), timeout_ms));
					}
				};

				try {
					frappe.call(args);
				} catch (e) {
					mark_if_unreachable(e);
					reject(e);
				}
			}),
			timeout_ms,
			label
		).catch((err) => {
			mark_if_unreachable(err);
			throw err;
		});
	}

	/**
	 * Run async work under an optional freeze that is ALWAYS cleared,
	 * with a hard max freeze duration so a dead backend cannot brick POS.
	 */
	async function with_safe_freeze(message, fn, { max_ms = 4000, freeze = true } = {}) {
		let frozen = false;
		let watchdog = null;
		if (freeze) {
			frappe.dom.freeze(message || "");
			frozen = true;
			watchdog = setTimeout(() => {
				if (frozen) {
					frappe.dom.unfreeze();
					frozen = false;
					nozom_pos.offline?.network?.mark_unreachable?.({ reason: "freeze_watchdog" });
				}
			}, cint(max_ms) || 4000);
		}
		try {
			return await fn();
		} finally {
			if (watchdog) clearTimeout(watchdog);
			if (frozen) {
				frappe.dom.unfreeze();
				frozen = false;
			}
		}
	}

	/** Force-clear any leftover freeze overlays (stuck after dead server / payment). */
	function force_unfreeze() {
		try {
			frappe.dom.freeze_count = 0;
			for (let i = 0; i < 5; i++) {
				frappe.dom.unfreeze();
			}
		} catch (e) {
			/* ignore */
		}
		// Frappe freeze uses #freeze.modal-backdrop — not class "freeze"
		$("#freeze, .freeze, .freeze-message-container").remove();
	}

	/**
	 * Scoped cleanup for NOZOM checkout dialog leftovers only.
	 * Does not wipe unrelated desk modals.
	 */
	function cleanup_checkout_ui($dialog_wrapper) {
		force_unfreeze();

		const $wrap = $dialog_wrapper?.length
			? $dialog_wrapper.filter(".nozom-checkout-dialog, .nozom-pos-centered-dialog")
			: $(".nozom-checkout-dialog, .nozom-pos-centered-dialog");

		$wrap.each(function () {
			const $m = $(this);
			$m.removeClass("show in");
			$m.css({ display: "none", "pointer-events": "none" });
			$m.attr("aria-hidden", "true");
			$m.nextAll(".modal-backdrop").first().remove();
		});

		// Remove orphan backdrops only when no other visible Bootstrap modal remains
		const open_modals = $(".modal.show, .modal.in").not($wrap).filter(":visible").length;
		if (!open_modals) {
			$("body").removeClass("modal-open").css({ overflow: "", paddingRight: "" });
			$(".modal-backdrop")
				.not("#freeze")
				.each(function () {
					const $b = $(this);
					// Keep backdrops that still belong to a visible non-NOZOM modal
					const for_open = $(".modal.show, .modal.in")
						.not(".nozom-checkout-dialog, .nozom-pos-centered-dialog")
						.length;
					if (!for_open) $b.remove();
				});
		}
	}

	return {
		DEFAULT_TIMEOUT_MS,
		HEALTH_TIMEOUT_MS,
		TimeoutError,
		is_network_failure,
		mark_if_unreachable,
		with_timeout,
		call,
		with_safe_freeze,
		force_unfreeze,
		cleanup_checkout_ui,
	};
})();
