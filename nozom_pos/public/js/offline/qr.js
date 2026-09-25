frappe.provide("nozom_pos.offline");

/**
 * Local QR generation for delivery-location links.
 * Uses vendored qrcode-generator (no network). Works offline.
 */
nozom_pos.offline.qr = (() => {
	function is_safe_url(url) {
		const value = cstr(url || "").trim();
		if (!value) return false;
		const lower = value.toLowerCase();
		if (!(lower.startsWith("http://") || lower.startsWith("https://"))) return false;
		if (
			lower.startsWith("javascript:") ||
			lower.startsWith("data:") ||
			lower.startsWith("vbscript:") ||
			lower.startsWith("file:")
		) {
			return false;
		}
		return true;
	}

	function sanitize(url) {
		const value = cstr(url || "").trim();
		return is_safe_url(value) ? value : "";
	}

	function ensure_lib() {
		if (typeof window.qrcode === "function") return true;
		console.warn("NOZOM POS: qrcode library not loaded");
		return false;
	}

	function to_svg(url, { cell = 4, margin = 2 } = {}) {
		const safe = sanitize(url);
		if (!safe || !ensure_lib()) return "";

		const qr = window.qrcode(0, "M");
		qr.addData(safe);
		qr.make();

		const count = qr.getModuleCount();
		const size = (count + margin * 2) * cell;
		let paths = "";
		for (let row = 0; row < count; row++) {
			for (let col = 0; col < count; col++) {
				if (!qr.isDark(row, col)) continue;
				const x = (col + margin) * cell;
				const y = (row + margin) * cell;
				paths += `M${x} ${y}h${cell}v${cell}h-${cell}z`;
			}
		}
		return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path fill="#000" d="${paths}"/></svg>`;
	}

	function section_html(url, opts = {}) {
		const safe = sanitize(url);
		if (!safe) return "";
		const svg = to_svg(safe, opts);
		if (!svg) return "";
		const label = opts.label || __("Delivery Location");
		const hint = opts.hint || __("Scan to open location");
		return `<div class="nozom-location-qr" style="text-align:center;margin-top:10px;">
			<div style="font-weight:700;margin-bottom:4px;">${frappe.utils.escape_html(label)}</div>
			<div>${svg}</div>
			<div style="font-size:11px;color:#555;margin-top:4px;">${frappe.utils.escape_html(hint)}</div>
		</div>`;
	}

	/** Large on-screen QR for cashier / driver scan (offline-capable). */
	function screen_html(url, opts = {}) {
		const safe = sanitize(url);
		if (!safe) return "";
		const svg = to_svg(safe, { cell: opts.cell || 7, margin: opts.margin || 2 });
		if (!svg) return "";
		const label = opts.label || __("Delivery Location");
		const hint = opts.hint || __("Scan to open location");
		return `<div class="nozom-location-qr nozom-location-qr--screen" dir="ltr">
			<div class="nozom-location-qr__label">${frappe.utils.escape_html(label)}</div>
			<div class="nozom-location-qr__code">${svg}</div>
			<div class="nozom-location-qr__hint">${frappe.utils.escape_html(hint)}</div>
		</div>`;
	}

	return { is_safe_url, sanitize, to_svg, section_html, screen_html };
})();
