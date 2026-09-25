frappe.provide("nozom_pos");

/**
 * Centered short-lived POS toasts (page-scoped via body.nozom-pos-page-active CSS).
 * Does not replace frappe.msgprint acknowledgement dialogs.
 */
nozom_pos.notify = function (message, indicator = "blue", seconds = 3.5) {
	const payload =
		typeof message === "string"
			? { message, indicator }
			: { indicator, ...message };

	if (!payload.indicator) payload.indicator = indicator;

	return frappe.show_alert(payload, seconds);
};
