frappe.provide("nozom_pos");

/**
 * Shared safe address + payment-status helpers for NOZOM POS.
 * Convert ERPNext address_display HTML into readable plain text (no literal <br>).
 */
nozom_pos.address_format = (() => {
	function plain_lines(html) {
		const raw = cstr(html || "");
		if (!raw) return [];
		return raw
			.replace(/\r\n/g, "\n")
			.replace(/<\s*br\s*\/?\s*>/gi, "\n")
			.replace(/<\/\s*p\s*>/gi, "\n")
			.replace(/<\/\s*div\s*>/gi, "\n")
			.replace(/<[^>]+>/g, "")
			.replace(/&nbsp;/gi, " ")
			.replace(/&amp;/gi, "&")
			.replace(/&lt;/gi, "<")
			.replace(/&gt;/gi, ">")
			.replace(/&#39;/g, "'")
			.replace(/&quot;/g, '"')
			.split(/\n+/)
			.map((l) => l.replace(/\s+/g, " ").trim())
			.filter(Boolean);
	}

	function plain_text(html, joiner = "\n") {
		return plain_lines(html).join(joiner);
	}

	function safe_html(html, joiner = "<br>") {
		return plain_lines(html)
			.map((l) => frappe.utils.escape_html(l))
			.join(joiner);
	}

	function with_title(title, address_html, opts = {}) {
		const t = cstr(title || "").trim();
		const body = plain_lines(address_html);
		if (!t && !body.length) return "";
		if (opts.as_html) {
			const lines = [];
			if (t) lines.push(frappe.utils.escape_html(t));
			body.forEach((l) => lines.push(frappe.utils.escape_html(l)));
			return lines.join(opts.joiner || "<br>");
		}
		if (t && body.length) return [t, ...body].join(opts.joiner || "\n");
		return t || body.join(opts.joiner || "\n");
	}

	return { plain_lines, plain_text, safe_html, with_title };
})();

nozom_pos.payment_status = (() => {
	function resolve(doc = {}) {
		const total = flt(doc.rounded_total) || flt(doc.grand_total) || 0;
		const paid = flt(doc.paid_amount);
		let outstanding = flt(doc.outstanding_amount);
		if (outstanding < 0) outstanding = 0;

		let key = "Fully Paid";
		if (cint(doc.is_return)) {
			key = "Return";
		} else if (outstanding > 0.0001 && paid <= 0.0001) {
			key = "Unpaid";
		} else if (outstanding > 0.0001) {
			key = "Partially Paid";
		} else {
			key = "Fully Paid";
			outstanding = 0;
		}

		const labels = {
			"Fully Paid": __("Fully Paid"),
			"Partially Paid": __("Partially Paid"),
			Unpaid: __("Unpaid"),
			Return: __("Return"),
		};

		return {
			key,
			label: labels[key] || __(key),
			paid: key === "Unpaid" ? 0 : paid,
			outstanding: key === "Fully Paid" ? 0 : outstanding || (key === "Unpaid" ? total : outstanding),
			total,
		};
	}

	return { resolve };
})();
