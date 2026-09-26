frappe.provide("nozom_pos");

/**
 * NOZOM POS notification policy.
 *
 * Lightweight floating toasts are suppressed on the POS page.
 * Feedback belongs in:
 * - top-bar Online / Offline / Sync status
 * - dedicated success dialogs (Payment Successful, Period Closed, …)
 * - blocking msgprint / modal workflows for real errors
 *
 * Critical/validation alerts (red / orange) still surface so cashiers
 * never miss ValidationError / payment / accounting failures.
 *
 * Desk / ERPNext outside POS is untouched.
 */

const CRITICAL_INDICATORS = new Set(["red", "orange", "yellow"]);

/** Informational / success noise — suppress even if marked orange. */
const SUPPRESS_MESSAGE_PATTERNS = [
	/connection restored/i,
	/connection lost/i,
	/server unavailable/i,
	/backend (online|offline)/i,
	/payment successful/i,
	/sale saved offline/i,
	/pos invoice .+ created successfully/i,
	/offline sale .+ synced/i,
	/draft saved/i,
	/local draft saved/i,
	/customer (created|updated|saved)/i,
	/address (created|updated|saved)/i,
	/pos period opened/i,
	/sale requeued/i,
	/order cancelled/i,
	/item added/i,
	/\bsynced\b/i,
	/update available/i,
	/app updated/i,
	/cache (refreshed|updated|cleared)/i,
];

function normalize_payload(message, indicator) {
	if (typeof message === "string") {
		return { message, indicator: indicator || "blue" };
	}
	if (message && typeof message === "object") {
		return {
			message: message.message || message.msg || "",
			indicator: message.indicator || indicator || "blue",
			...message,
		};
	}
	return { message: cstr(message), indicator: indicator || "blue" };
}

function is_pos_active() {
	return Boolean(document.body?.classList?.contains("nozom-pos-page-active"));
}

function matches_suppress_pattern(text) {
	return SUPPRESS_MESSAGE_PATTERNS.some((re) => re.test(cstr(text || "")));
}

function should_suppress_toast(payload) {
	if (!is_pos_active()) return false;

	const text = cstr(payload.message || "");
	const indicator = cstr(payload.indicator || "blue").toLowerCase();

	// Known informational noise — never toast on POS
	if (matches_suppress_pattern(text)) {
		return true;
	}

	// Real error / validation indicators stay visible
	if (CRITICAL_INDICATORS.has(indicator)) {
		return false;
	}

	// Default: suppress blue / green / grey / info toasts on POS
	return true;
}

/**
 * Public helper used across NOZOM POS.
 * Non-critical → no-op. Critical → show_alert (or msgprint when force_modal).
 */
nozom_pos.notify = function (message, indicator = "blue", seconds = 3.5) {
	const payload = normalize_payload(message, indicator);

	if (should_suppress_toast(payload)) {
		return null;
	}

	if (payload.force_modal || payload.msgprint) {
		frappe.msgprint({
			title: payload.title || __("Notice"),
			message: payload.message,
			indicator: payload.indicator,
		});
		return null;
	}

	return frappe.show_alert(payload, seconds);
};

/**
 * Wrap frappe.show_alert while POS is active so direct callers are also filtered.
 * Does not affect Desk when POS page is inactive.
 */
nozom_pos.install_toast_guard = function install_toast_guard() {
	if (window.__nozom_pos_toast_guard) return;
	window.__nozom_pos_toast_guard = true;

	const original = frappe.show_alert.bind(frappe);
	frappe.show_alert = function (msg, seconds) {
		const payload = normalize_payload(msg, msg?.indicator);
		if (should_suppress_toast(payload)) {
			return null;
		}
		return original(msg, seconds);
	};

	frappe.__nozom_show_alert_raw = original;
};

// Install as soon as the bundle loads; suppression only applies on POS page.
if (typeof frappe !== "undefined" && frappe.show_alert) {
	nozom_pos.install_toast_guard();
} else {
	$(document).on("app_ready", () => nozom_pos.install_toast_guard());
}
