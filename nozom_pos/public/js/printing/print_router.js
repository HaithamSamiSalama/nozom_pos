frappe.provide("nozom_pos.printing");

/**
 * Central POS print router.
 *
 * Browser Printing  — existing frappe.utils.print path (default).
 * Windows Printing  — browser print dialog / kiosk path; no silent-print claims.
 * NOZOM Print       — server entitlement + signed permit → local agent.
 */
nozom_pos.printing = (() => {
	const METHOD_BROWSER = "Browser Printing";
	const METHOD_WINDOWS = "Windows Printing";
	const METHOD_NOZOM_PRINT = "NOZOM Print";

	const DEVICE_KEY = "nozom_print_device_id";

	function device_id() {
		try {
			let id = localStorage.getItem(DEVICE_KEY);
			if (!id) {
				id =
					"web-" +
					(window.crypto?.randomUUID?.() ||
						`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
				localStorage.setItem(DEVICE_KEY, id);
			}
			return id;
		} catch (e) {
			return "web-anonymous";
		}
	}

	function normalize_method(value) {
		const raw = cstr(value || "").trim();
		if (!raw) return METHOD_BROWSER;
		if (raw === METHOD_BROWSER || raw === METHOD_WINDOWS || raw === METHOD_NOZOM_PRINT) {
			return raw;
		}
		const lower = raw.toLowerCase();
		if (lower.includes("nozom")) return METHOD_NOZOM_PRINT;
		if (lower.includes("windows") || lower.includes("kiosk")) return METHOD_WINDOWS;
		return METHOD_BROWSER;
	}

	function resolve_method_from_settings(settings, doc) {
		return normalize_method(
			settings?.nozom_printing_method ||
				doc?.nozom_printing_method ||
				cur_pos?.settings?.nozom_printing_method ||
				""
		);
	}

	function browser_print({ doctype, name, print_format, letter_head, language }) {
		if (!doctype || !name) return;
		frappe.utils.print(
			doctype,
			name,
			print_format,
			letter_head,
			language || frappe.boot.lang
		);
	}

	function windows_print(opts) {
		// Safe path: use the same printview flow. Do not claim silent printing —
		// Chromium kiosk / Windows may suppress dialogs, but that is OS/browser
		// policy, not something we assert from POS JavaScript.
		try {
			browser_print(opts);
		} catch (e) {
			frappe.msgprint({
				title: __("Windows Printing"),
				indicator: "orange",
				message: __(
					"Windows Printing could not start. Falling back to Browser Printing."
				),
			});
			browser_print(opts);
		}
	}

	function show_renew_dialog(message, billing_url) {
		const url = cstr(billing_url || "((frappe.boot?.lang || "en").startsWith("ar") ? "https://www.nozom.cloud/ar/dashboard/payments/new" : "https://www.nozom.cloud/en/dashboard/payments/new")");
		const safe_url = frappe.utils.escape_html(url);
		const safe_msg = frappe.utils.escape_html(
			cstr(
				message ||
					__(
						"NOZOM Print subscription or entitlement is not active. Renew from the NOZOM Cloud customer dashboard."
					)
			)
		);
		const dialog = new frappe.ui.Dialog({
			title: __("NOZOM Print — Subscription required"),
			fields: [
				{
					fieldtype: "HTML",
					options: `
						<div class="mb-2">${safe_msg}</div>
						<div class="mb-2">
							${__("Renew from NOZOM Cloud:")}
							<a href="${safe_url}" target="_blank" rel="noopener noreferrer">${safe_url}</a>
						</div>
						<div class="text-muted">
							${__("The invoice was not changed. You can still use Browser Printing if configured.")}
						</div>
					`,
				},
			],
			primary_action_label: __("Open NOZOM Cloud"),
			primary_action: () => {
				window.open(url, "_blank", "noopener,noreferrer");
				dialog.hide();
			},
			secondary_action_label: __("Close"),
			secondary_action: () => dialog.hide(),
		});
		dialog.show();
	}

	async function deliver_to_agent(agent_endpoint, job) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 4000);
		try {
			const res = await fetch(agent_endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: JSON.stringify(job),
				signal: controller.signal,
			});
			clearTimeout(timer);
			if (!res.ok) {
				throw new Error(`agent_http_${res.status}`);
			}
			return true;
		} catch (e) {
			clearTimeout(timer);
			throw e;
		}
	}

	async function nozom_print(opts) {
		const {
			doctype,
			name,
			print_format,
			letter_head,
			language,
			pos_profile,
			kitchen,
			job_type,
			station,
			printer,
		} = opts || {};

		if (!doctype || !name) return;

		const r = await frappe.call({
			method: "nozom_pos.api.nozom_print.request_print_job",
			args: {
				doctype,
				name,
				device_id: device_id(),
				pos_profile: pos_profile || cur_pos?.pos_profile || "",
				print_format: print_format || "",
				letter_head: letter_head || "",
				language: language || frappe.boot.lang,
				kitchen: kitchen ? 1 : 0,
				job_type: job_type || "",
				station: station || "",
				printer: printer || "",
			},
			freeze: true,
			freeze_message: __("Preparing NOZOM Print..."),
		});

		const msg = r.message || {};
		if (!msg.ok) {
			show_renew_dialog(msg.message, msg.billing_url);
			return { ok: false, ...msg };
		}

		const job = msg.job;
		const endpoint = msg.agent_endpoint || "http://127.0.0.1:17355/print";

		try {
			await deliver_to_agent(endpoint, job);
			await frappe.call({
				method: "nozom_pos.api.nozom_print.mark_print_job_status",
				args: { job_id: job.job_id, status: "SENT" },
				freeze: false,
			});
			frappe.show_alert({
				message: __("Print job sent to NOZOM Print."),
				indicator: "green",
			});
			return { ok: true, job, status: "SENT" };
		} catch (e) {
			await frappe.call({
				method: "nozom_pos.api.nozom_print.mark_print_job_status",
				args: {
					job_id: job.job_id,
					status: "FAILED",
					error: cstr(e?.message || e || "agent_unreachable"),
				},
				freeze: false,
			});
			frappe.msgprint({
				title: __("NOZOM Print"),
				indicator: "orange",
				message: __(
					"NOZOM Print app did not respond on this computer. Install and start NOZOM Print, then retry. The invoice was not changed."
				),
			});
			return { ok: false, job, status: "FAILED" };
		}
	}

	async function print_document(opts = {}) {
		const method = resolve_method_from_settings(opts.settings, opts.doc);
		const payload = {
			doctype: opts.doctype,
			name: opts.name,
			print_format: opts.print_format,
			letter_head: opts.letter_head,
			language: opts.language,
			pos_profile: opts.pos_profile,
			kitchen: Boolean(opts.kitchen),
			job_type: opts.job_type,
			station: opts.station,
			printer: opts.printer,
			settings: opts.settings,
			doc: opts.doc,
		};

		if (method === METHOD_NOZOM_PRINT) {
			return nozom_print(payload);
		}
		if (method === METHOD_WINDOWS) {
			windows_print(payload);
			return { ok: true, method: METHOD_WINDOWS };
		}
		browser_print(payload);
		return { ok: true, method: METHOD_BROWSER };
	}

	return {
		METHOD_BROWSER,
		METHOD_WINDOWS,
		METHOD_NOZOM_PRINT,
		normalize_method,
		resolve_method_from_settings,
		device_id,
		print_document,
		browser_print,
		windows_print,
		nozom_print,
	};
})();
