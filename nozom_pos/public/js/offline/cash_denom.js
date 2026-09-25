frappe.provide("nozom_pos");

/**
 * Shared cash denomination + touch keypad helpers for Close/Open Period.
 * Quantities are always integers; denomination values may be decimal (e.g. 0.50).
 */
nozom_pos.cash_denom = (() => {
	const DENOMS = [1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.5];
	const HALF = 0.5;

	function esc(v) {
		return frappe.utils.escape_html(cstr(v || ""));
	}

	function money(amount, currency) {
		try {
			return format_currency(flt(amount, 2), currency);
		} catch (e) {
			return String(flt(amount, 2));
		}
	}

	function same_denom(a, b) {
		return Math.abs(flt(a) - flt(b)) < 0.0001;
	}

	function normalize_denom(value) {
		const n = flt(value);
		for (const d of DENOMS) {
			if (same_denom(n, d)) return d;
		}
		return null;
	}

	/** Stable object key for map lookups (avoids 0.5 / "0.5" mismatch). */
	function denom_key(d) {
		const n = normalize_denom(d);
		if (n == null) return cstr(d);
		if (same_denom(n, HALF)) return "0.5";
		return String(n);
	}

	function denom_label(d) {
		if (same_denom(d, HALF)) return __("0.50");
		return String(normalize_denom(d) ?? d);
	}

	function empty_map() {
		const map = {};
		DENOMS.forEach((d) => {
			map[denom_key(d)] = 0;
		});
		return map;
	}

	function qty_of(map, denom) {
		return cint(map?.[denom_key(denom)] || 0);
	}

	function amount_of(map, denom) {
		return flt(flt(denom) * qty_of(map, denom), 2);
	}

	function total(map) {
		return flt(
			DENOMS.reduce((sum, d) => sum + amount_of(map, d), 0),
			2
		);
	}

	function payload(map) {
		return DENOMS.map((d) => ({
			denomination: d,
			qty: qty_of(map, d),
			amount: amount_of(map, d),
		}));
	}

	function apply_qty_key(current_qty, key) {
		let buf = String(cint(current_qty) || 0);
		if (key === "C" || key === "Clear" || key === "Escape") {
			return 0;
		}
		if (key === "Backspace" || key === "⌫") {
			buf = buf.length <= 1 ? "0" : buf.slice(0, -1);
			return cint(buf);
		}
		if (key === ".") {
			return cint(buf); // quantity is integer-only
		}
		if (/^\d$/.test(key)) {
			buf = buf === "0" ? key : buf + key;
			if (buf.length > 6) buf = buf.slice(0, 6);
			return cint(buf);
		}
		return cint(buf);
	}

	function set_qty(map, denom, qty) {
		const key = denom_key(denom);
		if (!Object.prototype.hasOwnProperty.call(map, key) && normalize_denom(denom) == null) {
			return map;
		}
		map[key] = Math.max(0, cint(qty));
		return map;
	}

	function keypad_html() {
		const keys = [
			["1", "2", "3"],
			["4", "5", "6"],
			["7", "8", "9"],
			["C", "0", "⌫"],
		];
		return `<div class="nozom-close-keypad" dir="ltr">
			${keys
				.map(
					(row) =>
						`<div class="nozom-close-keypad__row">${row
							.map(
								(k) =>
									`<button type="button" class="nozom-close-key${
										k === "C" ? " is-clear" : ""
									}" data-key="${esc(k)}">${k === "C" ? esc(__("C")) : esc(k)}</button>`
							)
							.join("")}</div>`
				)
				.join("")}
		</div>`;
	}

	function denom_cols_html(map, selected_denom, currency) {
		const selected = normalize_denom(selected_denom);
		const tiles = DENOMS.map((d) => {
			const is_sel = selected != null && same_denom(selected, d) ? "is-selected" : "";
			const qty = qty_of(map, d);
			const amt = money(amount_of(map, d), currency);
			return `<button type="button" class="nozom-denom-row nozom-denom-tile ${is_sel}" data-denom="${denom_key(
				d
			)}">
				<span class="nozom-denom-tile__line" dir="ltr">${esc(denom_label(d))} × ${qty} = ${amt}</span>
			</button>`;
		}).join("");
		return `<div class="nozom-denom-tiles">${tiles}</div>`;
	}

	return {
		DENOMS,
		empty_map,
		qty_of,
		amount_of,
		total,
		payload,
		apply_qty_key,
		set_qty,
		normalize_denom,
		same_denom,
		denom_key,
		denom_label,
		keypad_html,
		denom_cols_html,
		money,
	};
})();
