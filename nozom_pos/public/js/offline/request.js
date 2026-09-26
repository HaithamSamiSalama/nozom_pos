frappe.provide("nozom_pos.offline");

/**
 * Fail-fast helpers for NOZOM POS network work.
 * Does not patch global frappe.call — only used by POS offline paths.
 *
 * Classification rule:
 * - Any valid Frappe/HTTP application response ⇒ ONLINE (never offline fallback)
 * - Only genuine transport / unreachable failures ⇒ may mark offline + queue
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

	function http_status(err) {
		if (!err || typeof err !== "object") return 0;
		return cint(err.status || err.statusCode || err.http_status || err.xhr?.status || 0);
	}

	/**
	 * True when the failure object carries proof the backend answered.
	 * Includes ValidationError / MandatoryError / PermissionError / HTTP 4xx-5xx
	 * with Frappe JSON — never treat these as connectivity loss.
	 */
	function has_server_response(err) {
		if (!err || typeof err !== "object") return false;
		if (err.nozom_application_error) return true;

		if (err._server_messages) return true;
		if (err.responseJSON) return true;
		if (err.xhr?.responseJSON) return true;
		if (cstr(err.xhr?.responseText || "").trim()) {
			const text = cstr(err.xhr.responseText);
			// HTML gateway pages are infrastructure; Frappe JSON is application.
			if (!text.startsWith("<!DOCTYPE") && !text.startsWith("<html")) return true;
		}

		if (cstr(err.exc_type || err.excType || "")) return true;
		if (err.exc) return true;

		const status = http_status(err);
		// Any non-zero HTTP status means a server/proxy answered.
		// 502/503/504 are still "reachable infrastructure" for classification of
		// application vs transport — handled separately in is_network_failure.
		if (status > 0) return true;

		return false;
	}

	/**
	 * Extract a cashier-facing message from a Frappe save/call failure.
	 * A valid HTTP response with _server_messages proves the backend is reachable.
	 */
	function extract_frappe_error(err) {
		if (!err) return __("Request failed");
		if (typeof err === "string") return err;

		const try_parse_server_messages = (raw) => {
			if (!raw) return "";
			try {
				const list = typeof raw === "string" ? JSON.parse(raw) : raw;
				if (!Array.isArray(list)) return "";
				return list
					.map((entry) => {
						try {
							const obj = typeof entry === "string" ? JSON.parse(entry) : entry;
							return cstr(obj?.message || obj?.title || entry);
						} catch (e) {
							return cstr(entry);
						}
					})
					.filter(Boolean)
					.join("\n");
			} catch (e) {
				return "";
			}
		};

		const from_messages =
			try_parse_server_messages(err._server_messages) ||
			try_parse_server_messages(err.responseJSON?._server_messages) ||
			try_parse_server_messages(err.xhr?.responseJSON?._server_messages);
		if (from_messages) return from_messages;

		if (err.message && !cstr(err.message).startsWith("<!DOCTYPE")) {
			return cstr(err.message);
		}
		return __("Request failed");
	}

	function is_application_error(err) {
		if (!err) return false;
		if (err.nozom_application_error) return true;
		if (err.nozom_timeout) return false;

		const exc_type = cstr(err.exc_type || err.excType || "");
		if (
			exc_type &&
			/ValidationError|PermissionError|MandatoryError|DuplicateEntryError|LinkValidationError|CharacterLengthExceededError|TimestampMismatchError|PartialPaymentValidationError|AccountingError|DoesNotExistError|OverwriteError/i.test(
				exc_type
			)
		) {
			return true;
		}

		const status = http_status(err);
		// Business / client / app server errors — backend is up.
		if (status === 417 || status === 403 || status === 401 || status === 409 || status === 404) {
			return true;
		}
		if (status === 400 || status === 422) return true;
		if (status >= 400 && status < 500 && status !== 408) return true;
		// HTTP 500 with Frappe JSON is still an application response (not offline).
		if (status === 500 && has_server_response(err)) return true;

		if (err._server_messages || err.responseJSON?._server_messages || err.xhr?.responseJSON?._server_messages) {
			return true;
		}
		if (err.responseJSON?.exc_type || err.xhr?.responseJSON?.exc_type) return true;
		if (err.responseJSON?.exc || err.xhr?.responseJSON?.exc) return true;

		const msg = cstr(err.message || err.nozom_reason || "").toLowerCase();
		if (
			msg &&
			(/is required\b/.test(msg) ||
				/mode of payment/.test(msg) ||
				/missing account/.test(msg) ||
				/payment account is missing/.test(msg) ||
				/at least one mode of payment/.test(msg) ||
				/partial payment/.test(msg) ||
				/please complete the required/.test(msg) ||
				/could not submit invoice/.test(msg) ||
				/validationerror|mandatoryerror|permissionerror|linkvalidationerror/.test(msg))
		) {
			return true;
		}
		return false;
	}

	/**
	 * Genuine connectivity / transport failure only.
	 * Presence of a Frappe/HTTP application response ⇒ false.
	 */
	function is_network_failure(err) {
		if (!err) return false;

		// Browser reports offline — always transport.
		if (typeof navigator !== "undefined" && navigator.onLine === false) {
			return true;
		}

		// Any application / Frappe response proves the backend answered.
		if (is_application_error(err)) return false;
		if (has_server_response(err) && !err.nozom_timeout) {
			const status = http_status(err);
			// Gateway timeouts / unavailable may still be infrastructure offline.
			if (status === 502 || status === 503 || status === 504) return true;
			// Any other HTTP response (incl. 500 with body) is NOT offline.
			if (status > 0) return false;
		}

		if (err.nozom_timeout) return true;
		if (err.name === "AbortError") return true;

		const status = http_status(err);
		if (status === 0 || status === 502 || status === 503 || status === 504) return true;

		const msg = cstr(err.message || err.statusText || "").toLowerCase();
		return (
			msg.includes("failed to fetch") ||
			msg.includes("load failed") ||
			msg.includes("networkerror") ||
			msg.includes("network error") ||
			msg.includes("connection refused") ||
			msg.includes("connection reset") ||
			msg.includes("err_network") ||
			msg.includes("err_connection") ||
			msg.includes("err_internet_disconnected") ||
			msg.includes("err_name_not_resolved") ||
			msg.includes("err_address_unreachable")
		);
	}

	function mark_if_unreachable(err) {
		if (is_network_failure(err)) {
			nozom_pos.offline?.network?.mark_unreachable?.({ reason: "request_failed" });
			return true;
		}
		// Explicitly keep / restore Online for application responses.
		nozom_pos.offline?.network?.mark_reachable?.({ reason: "app_or_unknown_response" });
		return false;
	}

	/**
	 * Race a promise against a hard timeout. Does not cancel the underlying work.
	 * Callers must NOT treat TimeoutError as offline-queue permission by itself
	 * when a Frappe response may still arrive (use is_network_failure).
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
	 * On application error → keep Online.
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
						const payload = r || { status: 0 };
						mark_if_unreachable(payload);
						reject(payload);
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
	 * Run async work under an optional freeze that is ALWAYS cleared.
	 * Watchdog only unlocks UI — never marks backend offline.
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

		const open_modals = $(".modal.show, .modal.in").not($wrap).filter(":visible").length;
		if (!open_modals) {
			$("body").removeClass("modal-open").css({ overflow: "", paddingRight: "" });
			$(".modal-backdrop")
				.not("#freeze")
				.each(function () {
					const $b = $(this);
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
		http_status,
		has_server_response,
		extract_frappe_error,
		is_application_error,
		is_network_failure,
		mark_if_unreachable,
		with_timeout,
		call,
		with_safe_freeze,
		force_unfreeze,
		cleanup_checkout_ui,
	};
})();
