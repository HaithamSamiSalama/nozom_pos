frappe.provide("nozom_pos");

/**
 * Touch-optimized checkout popup for current cart payment + success actions.
 * Shared by Checkout and Continue Payment (collect).
 * Cash overpayment: Applied = min(received, outstanding); change is display-only.
 * Continue Payment posts applied amounts only — never accounts cash change.
 */
nozom_pos.checkout_popup = (() => {
	let dialog = null;
	let state = null;
	let controller = null;
	let processing = false;

	const DENOMS = [20, 50, 100, 200, 500, 1000];

	function precision_for() {
		const from_defaults =
			cint(frappe.defaults?.get_default?.("currency_precision")) ||
			cint(frappe.sys_defaults?.currency_precision) ||
			cint(frappe.boot?.sysdefaults?.currency_precision);
		if (from_defaults) return from_defaults;
		try {
			const info = get_number_format_info(frappe.sys_defaults?.number_format || "#,###.##");
			return cint(info?.precision) || 2;
		} catch (e) {
			return 2;
		}
	}

	function invoice_total(doc) {
		return erpnext.PointOfSale.get_invoice_total
			? erpnext.PointOfSale.get_invoice_total(doc)
			: flt(doc.rounded_total) || flt(doc.grand_total);
	}

	function fmt(amount, currency) {
		return format_currency(flt(amount), currency);
	}

	function notify(message, indicator = "orange") {
		if (window.nozom_pos?.notify) {
			nozom_pos.notify(message, indicator);
		} else {
			frappe.show_alert({ message, indicator });
		}
	}

	function is_cash_row(row) {
		if (!row) return false;
		if (row.type === "Cash") return true;
		const name = String(row.mode_of_payment || "");
		return /cash|نقد/i.test(name);
	}

	function build_state(frm) {
		const doc = frm.doc;
		const precision = precision_for();
		const total = flt(invoice_total(doc), precision);
		const paid_already = 0;
		const outstanding = flt(total - paid_already, precision);
		const modes = (doc.payments || [])
			.filter((p) => p.mode_of_payment)
			.map((p) => ({
				mode_of_payment: p.mode_of_payment,
				amount: 0,
				row_name: p.name,
				doctype: p.doctype,
				type: p.type || "",
				account: cstr(p.account || "").trim(),
			}));

		return {
			mode: "checkout",
			frm,
			doc,
			precision,
			currency: doc.currency,
			total,
			paid_already,
			outstanding,
			modes,
			selected_mode: modes[0]?.mode_of_payment || null,
			buffer: "",
			phase: "pay",
			result: null,
			completed: false,
			tendered: 0,
			applied: 0,
			change: 0,
			invoice: null,
			order_summary: null,
			allow_change: true,
		};
	}

	function build_collect_state({ invoice, modes, invoice_total, outstanding_amount, paid_amount, currency, order_summary }) {
		const precision = precision_for();
		const mode_rows = (modes || []).map((m) => {
			const name = typeof m === "string" ? m : m.mode_of_payment;
			return {
				mode_of_payment: name,
				account: typeof m === "string" ? "" : cstr(m.account || "").trim(),
				amount: 0,
				type: (typeof m === "object" && m.type) || "",
			};
		});

		return {
			mode: "collect",
			frm: null,
			doc: invoice,
			precision,
			currency: currency || invoice.currency,
			total: flt(invoice_total, precision),
			paid_already: flt(paid_amount, precision),
			outstanding: flt(outstanding_amount, precision),
			modes: mode_rows,
			selected_mode: mode_rows[0]?.mode_of_payment || null,
			buffer: "",
			phase: "pay",
			result: null,
			completed: false,
			tendered: 0,
			applied: 0,
			change: 0,
			invoice,
			order_summary: order_summary || null,
			// Cash overpay allowed — applied amount is capped; change is display-only
			allow_change: true,
			cash_received: 0,
		};
	}

	function selected_row(st) {
		return st.modes.find((m) => m.mode_of_payment === st.selected_mode);
	}

	function tendered_total(st) {
		return flt(
			st.modes.reduce((sum, row) => sum + flt(row.amount), 0),
			st.precision
		);
	}

	function cash_tendered(st) {
		return flt(
			st.modes.filter(is_cash_row).reduce((sum, row) => sum + flt(row.amount), 0),
			st.precision
		);
	}

	function non_cash_tendered(st) {
		return flt(tendered_total(st) - cash_tendered(st), st.precision);
	}

	function applied_payment(st) {
		return flt(Math.min(tendered_total(st), st.outstanding), st.precision);
	}

	function change_amount(st) {
		if (!st.allow_change) return 0;
		const tendered = tendered_total(st);
		const over = flt(tendered - st.outstanding, st.precision);
		if (over <= 0) return 0;
		// Change only from cash portion
		if (!st.modes.some((m) => is_cash_row(m) && flt(m.amount) > 0)) return 0;
		return flt(Math.min(over, cash_tendered(st)), st.precision);
	}

	function remaining_due(st) {
		return flt(Math.max(st.outstanding - applied_payment(st), 0), st.precision);
	}

	function sync_totals(st) {
		st.tendered = tendered_total(st);
		st.cash_received = cash_tendered(st);
		st.applied = applied_payment(st);
		st.change = change_amount(st);
	}

	/**
	 * Build payment rows to POST for Continue Payment.
	 * Cash overpayment is reduced to applied cash only — never send change as payment.
	 */
	function payments_for_server(st) {
		const precision = st.precision;
		let remaining = flt(st.outstanding, precision);
		const out = [];

		// Non-cash first (already capped in UI)
		(st.modes || []).forEach((row) => {
			if (is_cash_row(row)) return;
			const amt = flt(row.amount, precision);
			if (amt <= 0 || remaining <= 0) return;
			const applied = flt(Math.min(amt, remaining), precision);
			out.push({ mode_of_payment: row.mode_of_payment, amount: applied });
			remaining = flt(remaining - applied, precision);
		});

		// Cash applied = min(cash received, remaining outstanding)
		(st.modes || []).forEach((row) => {
			if (!is_cash_row(row)) return;
			const received = flt(row.amount, precision);
			if (received <= 0 || remaining <= 0) return;
			const applied = flt(Math.min(received, remaining), precision);
			if (applied > 0) {
				out.push({ mode_of_payment: row.mode_of_payment, amount: applied });
				remaining = flt(remaining - applied, precision);
			}
		});

		return out;
	}

	function set_buffer_from_selected(st) {
		const row = selected_row(st);
		st.buffer = row && flt(row.amount) ? String(flt(row.amount, st.precision)) : "";
	}

	function max_for_non_cash(st, row) {
		const others = flt(
			st.modes
				.filter((m) => m.mode_of_payment !== row.mode_of_payment)
				.reduce((sum, m) => sum + flt(m.amount), 0),
			st.precision
		);
		return flt(Math.max(st.outstanding - others, 0), st.precision);
	}

	function apply_buffer_to_selected(st) {
		const row = selected_row(st);
		if (!row) return;
		let value = st.buffer === "" || st.buffer === "." ? 0 : flt(st.buffer, st.precision);

		// Non-cash always capped to remaining outstanding (no change)
		if (!is_cash_row(row)) {
			const max_for_mode = max_for_non_cash(st, row);
			if (value > max_for_mode) {
				value = max_for_mode;
				st.buffer = value ? String(value) : "";
				notify(__("Card/Bank payments cannot exceed the remaining amount."), "orange");
			}
		}

		row.amount = value;
		sync_totals(st);
	}

	function set_selected_amount(st, value) {
		const row = selected_row(st);
		if (!row) return;
		value = flt(value, st.precision);
		if (!is_cash_row(row)) {
			value = Math.min(value, max_for_non_cash(st, row));
		}
		row.amount = value;
		st.buffer = value ? String(value) : "";
		sync_totals(st);
	}

	function add_to_selected(st, add) {
		const row = selected_row(st);
		if (!row) return;
		set_selected_amount(st, flt(row.amount) + flt(add));
	}

	function panel_html(st) {
		const mode_btns = st.modes
			.map(
				(row) => `
			<button type="button" class="nz-pay-mode ${is_cash_row(row) ? "is-cash" : "is-other"}" data-mode="${frappe.utils.escape_html(
				row.mode_of_payment
			)}">
				<span class="nz-pay-mode__label">${frappe.utils.escape_html(__(row.mode_of_payment))}</span>
				<span class="nz-pay-mode__amount" data-mode-amount="${frappe.utils.escape_html(
					row.mode_of_payment
				)}"></span>
			</button>`
			)
			.join("");

		const denom_btns = DENOMS.map(
			(d) =>
				`<button type="button" class="nz-denom-btn" data-denom="${d}">${d}</button>`
		).join("");

		const keys = [
			["1", "2", "3"],
			["4", "5", "6"],
			["7", "8", "9"],
			["C", "0", "."],
		];
		const keypad = keys
			.map(
				(row) =>
					`<div class="nz-keypad-row">${row
						.map(
							(key) =>
								`<button type="button" class="nz-key ${
									key === "C" ? "is-clear" : ""
								}" data-key="${key}">${key === "C" ? __("C") : key}</button>`
						)
						.join("")}</div>`
			)
			.join("");

		const is_collect = st.mode === "collect";
		const total_label = is_collect ? __("Invoice Total") : __("Total");
		const paid_label = is_collect ? __("Previously Paid") : __("Already Paid");
		const remaining_label = is_collect
			? __("Outstanding After Payment")
			: __("Outstanding After Sale");

		return `
			<div class="nz-checkout-panel" data-mode="${frappe.utils.escape_html(st.mode || "checkout")}">
				<div class="nz-checkout-grid">
					<div class="nz-checkout-left">
						<div class="nz-summary-card">
							<div class="nz-sum-row"><span>${total_label}</span><strong class="nz-total"></strong></div>
							<div class="nz-sum-row"><span>${paid_label}</span><strong class="nz-paid-already"></strong></div>
							<div class="nz-sum-row is-due"><span>${__("Amount Due")}</span><strong class="nz-outstanding"></strong></div>
						</div>

						<div class="nz-block nz-block-modes">
							<div class="nz-label">${__("Payment Methods")}</div>
							<div class="nz-modes">${mode_btns || `<div class="text-muted">${__(
								"No Mode of Payment configured in POS Profile."
							)}</div>`}</div>
						</div>

						<div class="nz-block nz-block-breakdown">
							<div class="nz-label">${__("Selected Payments")}</div>
							<div class="nz-breakdown"></div>
						</div>

						<div class="nz-summary-card nz-live-totals">
							<div class="nz-sum-row"><span>${total_label}</span><strong class="nz-total-live"></strong></div>
							<div class="nz-sum-row nz-row-cash-received"><span>${__("Cash Received")}</span><strong class="nz-cash-received"></strong></div>
							<div class="nz-sum-row"><span>${__("Applied Now")}</span><strong class="nz-applied"></strong></div>
							<div class="nz-sum-row is-change"><span>${__("Change")}</span><strong class="nz-change"></strong></div>
							<div class="nz-sum-row"><span>${remaining_label}</span><strong class="nz-remaining"></strong></div>
						</div>
					</div>

					<div class="nz-checkout-right">
						<div class="nz-amount-display">
							<div class="nz-amount-caption">${__("Cash Received / Amount")}</div>
							<div class="nz-amount-value">0.00</div>
						</div>

						<div class="nz-quick-row">
							<button type="button" class="nz-quick is-exact" data-quick="exact">${__("Exact Amount")}</button>
							<button type="button" class="nz-quick is-clear-amt" data-quick="clear">${__("Clear")}</button>
						</div>

						<div class="nz-denoms-wrap">
							<div class="nz-label">${__("Cash Denominations")}</div>
							<div class="nz-denoms">${denom_btns}</div>
						</div>

						<div class="nz-keypad">${keypad}</div>
					</div>
				</div>

				<div class="nz-checkout-actions" data-action-mode="${is_collect ? "collect" : "checkout"}">
					<button type="button" class="nz-action nz-action-confirm">${__("Confirm Payment")}</button>
					${
						is_collect
							? `<button type="button" class="nz-action nz-action-slot is-invisible" tabindex="-1" aria-hidden="true"></button>
					<button type="button" class="nz-action nz-action-back">${__("Close")}</button>
					<button type="button" class="nz-action nz-action-slot is-invisible" tabindex="-1" aria-hidden="true"></button>`
							: `<button type="button" class="nz-action nz-action-draft">${__("Save Draft")}</button>
					<button type="button" class="nz-action nz-action-back">${__("Back to Order")}</button>
					<button type="button" class="nz-action nz-action-cancel">${__("Cancel Order")}</button>`
					}
				</div>
			</div>
		`;
	}

	function success_html(result) {
		const offline = Boolean(result.offline);
		const name = frappe.utils.escape_html(result.name || result.local_receipt_no || "");
		const currency = result.currency;
		const title = offline ? __("Sale Saved Offline") : __("Payment Successful");
		const pay_status = result.payment_status || (offline ? "Paid" : "");
		const outstanding = flt(result.outstanding_amount);
		const applied = flt(result.applied ?? result.paid_now ?? result.tendered ?? 0);
		const cash_received = flt(result.cash_received ?? 0);
		const change = flt(result.change ?? 0);
		const previously_paid = flt(result.previously_paid ?? result.paid_already ?? 0);
		const change_class = change > 0.0001 ? "is-change is-change-prominent" : "is-change";

		let status_lines = "";
		const resolved_status =
			pay_status ||
			(outstanding <= 0.0001
				? "Paid"
				: applied <= 0.0001 && flt(result.paid_amount) <= 0.0001
				? "Unpaid"
				: "Partially Paid");
		const status_label =
			resolved_status === "Partially Paid"
				? __("Partially Paid")
				: resolved_status === "Unpaid"
				? __("Unpaid")
				: __("Paid");
		status_lines = `<div class="nz-sum-row"><span>${__("Payment Status")}</span><strong>${status_label}</strong></div>`;
		if (offline) {
			status_lines += `<div class="nz-sum-row"><span>${__("Sync")}</span><strong>${__(
				"Pending Sync"
			)}</strong></div>`;
		}

		const subtitle = offline
			? `${__("Local Ref")}: ${name}`
			: `${__("Invoice")}: ${name}`;
		const order_no = cstr(result.nozom_order_number || "").trim();
		const order_no_html = order_no
			? `<div class="nz-sum-row is-order-no"><span>${__("Order Number")}</span><strong>${frappe.utils.escape_html(
					order_no
			  )}</strong></div>`
			: "";

		const can_print_offline = offline && Boolean(result.tx || result.local_receipt_no);
		const can_print_online = Boolean(result.doctype && result.name);
		const receipt_enabled = can_print_offline || can_print_online;
		const kitchen_enabled =
			(can_print_offline && result.has_kitchen !== false) ||
			(can_print_online && result.has_kitchen && result.kitchen_format);

		const print_btns = `
			<button type="button" class="nz-success-btn is-receipt nozom-success-print-receipt" ${
				receipt_enabled ? "" : "disabled"
			}>${__("Print Receipt")}</button>
			<button type="button" class="nz-success-btn is-kitchen nozom-success-print-kitchen" ${
				kitchen_enabled ? "" : "disabled hidden"
			}>${__("Print Kitchen")}</button>
		`;

		const collect_rows = result.collect
			? `<div class="nz-sum-row"><span>${__("Invoice Total")}</span><strong>${fmt(
					result.total,
					currency
			  )}</strong></div>
					<div class="nz-sum-row"><span>${__("Previously Paid")}</span><strong>${fmt(
						previously_paid,
						currency
					)}</strong></div>
					<div class="nz-sum-row"><span>${__("Applied Now")}</span><strong>${fmt(
						applied,
						currency
					)}</strong></div>
					<div class="nz-sum-row"><span>${__("Cash Received")}</span><strong>${fmt(
						cash_received,
						currency
					)}</strong></div>
					<div class="nz-sum-row ${change_class}"><span>${__("Change")}</span><strong>${fmt(
						change,
						currency
					)}</strong></div>
					<div class="nz-sum-row"><span>${__("Outstanding")}</span><strong>${fmt(
						outstanding,
						currency
					)}</strong></div>`
			: `<div class="nz-sum-row"><span>${__("Total")}</span><strong>${fmt(
					result.total,
					currency
			  )}</strong></div>
					<div class="nz-sum-row"><span>${__("Paid Now")}</span><strong>${fmt(
						applied || result.paid_amount || result.tendered,
						currency
					)}</strong></div>
					${
						cash_received > 0.0001
							? `<div class="nz-sum-row"><span>${__("Cash Received")}</span><strong>${fmt(
									cash_received,
									currency
							  )}</strong></div>`
							: ""
					}
					<div class="nz-sum-row ${change_class}"><span>${__("Change")}</span><strong>${fmt(
						change,
						currency
					)}</strong></div>
					${
						outstanding > 0.0001
							? `<div class="nz-sum-row"><span>${__("Outstanding")}</span><strong>${fmt(
									outstanding,
									currency
							  )}</strong></div>`
							: ""
					}`;

		const done_label = result.collect ? __("Done") : __("New Sale");

		const customer = result.customer_name || result.customer || result.tx?.customer_name || result.tx?.customer || "";
		const phone =
			result.nozom_customer_phone_snapshot ||
			result.contact_mobile ||
			result.tx?.nozom_customer_phone_snapshot ||
			result.tx?.contact_mobile ||
			"";
		const addr_title =
			result.nozom_address_title_snapshot || result.tx?.nozom_address_title_snapshot || "";
		const addr_display_raw =
			result.address_display ||
			result.shipping_address ||
			result.tx?.address_display ||
			result.tx?.shipping_address ||
			"";
		const address_html = (() => {
			const html = nozom_pos.address_format?.with_title?.(addr_title, addr_display_raw, {
				as_html: true,
			});
			if (!html) return "";
			return `<div class="nz-sum-row nz-sum-row--address"><span>${__(
				"Delivery Address"
			)}</span><strong class="nozom-address-plain">${html}</strong></div>`;
		})();
		const delivery_rows = `
			${
				customer
					? `<div class="nz-sum-row"><span>${__("Customer")}</span><strong>${frappe.utils.escape_html(
							customer
					  )}</strong></div>`
					: ""
			}
			${
				phone
					? `<div class="nz-sum-row"><span>${__("Phone")}</span><strong dir="ltr">${frappe.utils.escape_html(
							phone
					  )}</strong></div>`
					: ""
			}
			${address_html}`;

		return `
			<div class="nozom-checkout-success">
				<div class="nozom-checkout-success__icon">✓</div>
				<div class="nozom-checkout-success__title">${title}</div>
				<div class="nozom-checkout-success__sub">${subtitle}</div>
				<div class="nz-success-summary">
					${order_no_html}
					${delivery_rows}
					${status_lines}
					${collect_rows}
				</div>
				<div class="nozom-checkout-success__actions">
					${print_btns}
					<button type="button" class="nz-success-btn is-new nozom-success-new-sale">${done_label}</button>
				</div>
			</div>
		`;
	}

	function refresh_ui(dialog, st) {
		const $root = dialog.$wrapper.find(".nz-checkout-panel");
		if (!$root.length) return;
		sync_totals(st);
		const currency = st.currency;
		const selected = selected_row(st);
		const cash_selected = is_cash_row(selected);

		$root.find(".nz-total, .nz-total-live").text(fmt(st.total, currency));
		$root.find(".nz-paid-already").text(fmt(st.paid_already, currency));
		$root.find(".nz-outstanding").text(fmt(st.outstanding, currency));
		$root.find(".nz-cash-received").text(fmt(st.cash_received || 0, currency));
		$root.find(".nz-applied").text(fmt(st.applied, currency));
		$root.find(".nz-change").text(fmt(st.change, currency));
		$root.find(".nz-remaining").text(fmt(remaining_due(st), currency));
		$root.find(".nz-row-cash-received").toggleClass("is-dimmed", !cash_selected && flt(st.cash_received) <= 0);
		$root.find(".is-change").toggleClass("is-change-prominent", flt(st.change) > 0.0001);
		$root
			.find(".nz-amount-value")
			.text(st.buffer === "" ? fmt(0, currency) : st.buffer);
		$root
			.find(".nz-amount-caption")
			.text(cash_selected ? __("Cash Received") : __("Amount"));

		$root.find(".nz-pay-mode").each(function () {
			const mode = $(this).attr("data-mode");
			$(this).toggleClass("is-selected", mode === st.selected_mode);
			const row = st.modes.find((m) => m.mode_of_payment === mode);
			$(this)
				.find(".nz-pay-mode__amount")
				.text(row && flt(row.amount) ? fmt(row.amount, currency) : "");
		});

		const confirm_label = st.tendered > 0.0000001 ? __("Confirm Payment") : __("Execute");
		$root.find(".nz-action-confirm").text(confirm_label);

		const breakdown = st.modes
			.filter((r) => flt(r.amount) > 0)
			.map(
				(r) => `
				<div class="nz-breakdown-row">
					<span>${frappe.utils.escape_html(__(r.mode_of_payment))}</span>
					<strong>${fmt(r.amount, currency)}</strong>
				</div>`
			)
			.join("");
		$root
			.find(".nz-breakdown")
			.html(breakdown || `<div class="nz-breakdown-empty">${__("No payments entered")}</div>`);

		$root.find(".nz-denoms-wrap").toggleClass("is-disabled", !cash_selected);
		$root.find(".nz-denom-btn").prop("disabled", !cash_selected);
	}

	function handle_key(st, key) {
		if (key === "C") {
			st.buffer = "";
			apply_buffer_to_selected(st);
			return;
		}
		if (key === "Backspace") {
			st.buffer = String(st.buffer).slice(0, -1);
			apply_buffer_to_selected(st);
			return;
		}
		if (key === ".") {
			if (String(st.buffer).includes(".")) return;
			st.buffer = st.buffer === "" ? "0." : `${st.buffer}.`;
			apply_buffer_to_selected(st);
			return;
		}
		if (/^\d$/.test(key)) {
			const next = `${st.buffer}${key}`;
			if (next.replace(/^0+(?=\d)/, "").split(".")[1]?.length > st.precision) return;
			st.buffer = st.buffer === "0" ? key : next;
			apply_buffer_to_selected(st);
		}
	}

	async function apply_payments_to_frm(st) {
		const frm = st.frm;
		const offline = window.nozom_pos?.offline?.network && !nozom_pos.offline.network.is_online();
		const is_unpaid = flt(st.tendered) <= 0.0000001;
		const helper = nozom_pos.offline?.payment_modes;

		// Enrich mode rows with accounts from profile/settings before apply.
		const by_mode = {};
		(frm.doc.payments || []).forEach((p) => {
			if (p.mode_of_payment && p.account) by_mode[p.mode_of_payment] = p;
		});
		(helper?.list_from_settings?.(controller?.settings) || []).forEach((p) => {
			if (p.mode_of_payment && p.account) by_mode[p.mode_of_payment] = p;
		});
		(st.modes || []).forEach((row) => {
			if (!row.account && by_mode[row.mode_of_payment]?.account) {
				row.account = by_mode[row.mode_of_payment].account;
			}
			if (!row.type && by_mode[row.mode_of_payment]?.type) {
				row.type = by_mode[row.mode_of_payment].type;
			}
		});

		// Unpaid / credit (Execute): clear payment rows — do not invent Cash=0.
		if (is_unpaid) {
			frm.clear_table("payments");
			frm.doc.paid_amount = 0;
			frm.doc.base_paid_amount = 0;
			frm.doc.change_amount = 0;
			frm.doc.base_change_amount = 0;
			const total_due = erpnext.PointOfSale?.get_invoice_total
				? erpnext.PointOfSale.get_invoice_total(frm.doc)
				: flt(frm.doc.rounded_total) || flt(frm.doc.grand_total);
			frm.doc.outstanding_amount = flt(total_due, st.precision);
			if (offline && nozom_pos.offline.totals?.apply_payments_local) {
				nozom_pos.offline.totals.apply_payments_local(frm, [], {
					precision: st.precision,
					change: 0,
				});
			} else {
				try {
					frm.cscript.calculate_outstanding_amount?.(false);
				} catch (e) {
					/* outstanding already set */
				}
			}
			frm.refresh_field("payments");
			frm.refresh_field("paid_amount");
			frm.refresh_field("change_amount");
			frm.refresh_field("outstanding_amount");
			return;
		}

		// Paid / partial — require mode + company account; never invent GL accounts.
		helper?.assert_paid_rows_have_accounts?.(frm, st.modes);

		if (offline && nozom_pos.offline.totals?.apply_payments_local) {
			nozom_pos.offline.totals.apply_payments_local(frm, st.modes, {
				precision: st.precision,
				change: st.change,
			});
			frm.refresh_field("payments");
			frm.refresh_field("paid_amount");
			frm.refresh_field("change_amount");
			frm.refresh_field("outstanding_amount");
			return;
		}

		try {
			const positive = (st.modes || []).filter((row) => flt(row.amount) > 0.0000001);
			frm.clear_table("payments");
			for (const row of positive) {
				const payment = frm.add_child("payments");
				payment.mode_of_payment = row.mode_of_payment;
				payment.account = cstr(row.account || "").trim();
				payment.type = row.type || "";
				payment.amount = flt(row.amount, st.precision);
				payment.base_amount = flt(
					payment.amount * (flt(frm.doc.conversion_rate) || 1),
					st.precision
				);
			}
			// Let ERPNext taxes_and_totals set paid_amount + change_amount from Cash overpayment
			frm.cscript.calculate_outstanding_amount?.(false);
			frm.refresh_field("payments");
			frm.refresh_field("paid_amount");
			frm.refresh_field("change_amount");
			frm.refresh_field("outstanding_amount");
		} catch (e) {
			console.warn("NOZOM POS apply_payments online path failed; using local apply", e);
			const request = window.nozom_pos?.offline?.request;
			if (e?.nozom_application_error || request?.is_application_error?.(e)) {
				nozom_pos.offline?.network?.mark_reachable?.({ reason: "apply_payments_app_error" });
				throw e;
			}
			if (request?.is_network_failure?.(e)) {
				request.mark_if_unreachable(e);
			} else {
				nozom_pos.offline?.network?.mark_reachable?.({ reason: "apply_payments_app_error" });
			}
			nozom_pos.offline.totals.apply_payments_local(frm, st.modes, {
				precision: st.precision,
				change: st.change,
			});
			frm.refresh_field("payments");
			frm.refresh_field("paid_amount");
			frm.refresh_field("change_amount");
			frm.refresh_field("outstanding_amount");
		}
	}

	async function confirm(dialog, st) {
		if (processing || st.phase !== "pay" || st.completed) return;
		sync_totals(st);

		if (st.mode === "collect") {
			await confirm_collect(dialog, st);
			return;
		}

		const allow_partial = cint(controller?.settings?.allow_partial_payment);
		const is_unpaid = st.tendered <= 0.0000001;

		// Paid Now = 0 → unpaid / credit sale (Execute). Always allowed.
		if (is_unpaid) {
			/* proceed */
		} else if (!allow_partial && remaining_due(st) > 0.0000001) {
			notify(__("You cannot submit the order without payment."), "orange");
			return;
		}

		// Reject non-cash overpayment with no cash to absorb change
		const over = flt(st.tendered - st.outstanding, st.precision);
		if (over > 0.0000001 && st.change + 0.0000001 < over) {
			notify(__("Only Cash payments can exceed the amount due."), "orange");
			return;
		}

		// Duplicate-submit lock — stays locked through success; only unlock on real failure.
		processing = true;
		dialog.$wrapper.find(".nz-action").prop("disabled", true);
		const request = window.nozom_pos?.offline?.request;

		const enter_success = (result) => {
			st.completed = true;
			st.phase = "success";
			st.result = result;
			controller.toggle_components?.(false);
			controller.payment?.toggle_component?.(false);
			dialog.set_title(result.offline ? __("Sale Saved Offline") : __("Payment Successful"));
			dialog.$wrapper.find(".modal-body").html(success_html(result));
			dialog.$wrapper.find(".modal-footer").addClass("hide");
			bind_success_actions(dialog, result, st);
		};

		try {
			await request?.with_safe_freeze?.(__("Processing payment..."), async () => {
				if (nozom_pos.offline?.network?.ensure_fresh) {
					await nozom_pos.offline.network.ensure_fresh();
				}

				// If a prior attempt already submitted, never apply_payments / save again.
				if (cint(st.frm?.doc?.docstatus) === 1) {
					const recovered = controller.build_checkout_success_payload?.(st.frm.doc) || {
						offline: false,
						name: st.frm.doc.name,
						doctype: st.frm.doc.doctype,
						total: st.total,
						paid_amount: flt(st.frm.doc.paid_amount),
						outstanding_amount: flt(st.frm.doc.outstanding_amount),
						payment_status: "Paid",
						currency: st.currency,
					};
					recovered.tendered = st.tendered;
					recovered.change = st.change;
					recovered.applied = st.applied;
					recovered.cash_received = st.cash_received;
					await controller.clear_local_cart?.();
					enter_success(recovered);
					return;
				}

				await apply_payments_to_frm(st);

				// Re-assert unpaid state immediately before submit (guards against mop reseed).
				if (flt(st.tendered) <= 0.0000001) {
					st.frm.clear_table("payments");
					st.frm.doc.paid_amount = 0;
					st.frm.doc.base_paid_amount = 0;
					st.frm.doc.change_amount = 0;
					st.frm.doc.base_change_amount = 0;
					st.frm.refresh_field("payments");
				}

				const result = await controller.submit_invoice_with_offline_support({
					from_checkout_popup: true,
				});
				if (!result) {
					controller.cart?.toggle_checkout_btn?.(true);
					const check = nozom_pos.offline?.tx_queue?.can_queue_sale?.(
						st.frm.doc,
						controller.settings
					);
					const reason =
						check && !check.ok
							? check.reason
							: __("Could not complete payment.");
					notify(reason, "red");
					return;
				}

				// Resolve local draft after successful checkout
				const draft_id = st.frm?.doc?._nozom_local_draft_id;
				if (draft_id && nozom_pos.offline.draft_store) {
					await nozom_pos.offline.draft_store.resolve(draft_id);
				}

				result.tendered = st.tendered;
				result.change = st.change;
				result.applied = st.applied;
				result.cash_received = st.cash_received;
				if (result.paid_amount == null) result.paid_amount = st.applied;
				if (result.outstanding_amount == null) {
					result.outstanding_amount = remaining_due(st);
				}

				enter_success(result);
			}, { max_ms: 35000, freeze: true });
		} catch (e) {
			console.error("NOZOM POS payment failed:", e);

			// Ambiguous / false error after real submit — recover success UI.
			if (
				cint(st.frm?.doc?.docstatus) === 1 ||
				controller.is_update_after_submit_error?.(e) ||
				/^submitted\.?$/i.test(cstr(e?.message || "").trim())
			) {
				try {
					const recovered =
						(await controller.recover_if_already_submitted?.()) ||
						controller.build_checkout_success_payload?.(st.frm.doc);
					if (recovered) {
						recovered.tendered = st.tendered;
						recovered.change = st.change;
						recovered.applied = st.applied;
						recovered.cash_received = st.cash_received;
						await controller.clear_local_cart?.();
						nozom_pos.offline?.network?.mark_reachable?.({ reason: "checkout_recovered" });
						enter_success(recovered);
						return;
					}
				} catch (recover_err) {
					console.warn("NOZOM POS submit recover failed:", recover_err);
				}
			}

			if (
				request?.is_application_error?.(e) ||
				e?.nozom_application_error ||
				request?.has_server_response?.(e) ||
				!request?.is_network_failure?.(e)
			) {
				nozom_pos.offline?.network?.mark_reachable?.({ reason: "checkout_app_error" });
			} else {
				request?.mark_if_unreachable?.(e);
			}
			request?.force_unfreeze?.();
			controller.cart?.toggle_checkout_btn?.(true);
			notify(e.nozom_reason || e.message || __("Could not complete payment."), "red");
		} finally {
			request?.force_unfreeze?.();
			// Unlock only if still on pay phase and not completed — never re-arm after success.
			if (st.phase === "pay" && !st.completed) {
				processing = false;
				dialog.$wrapper.find(".nz-action").prop("disabled", false);
			} else {
				processing = true;
				dialog.$wrapper.find(".nz-action").prop("disabled", true);
			}
		}
	}

	async function confirm_collect(dialog, st) {
		sync_totals(st);
		if (st.applied <= 0) {
			notify(__("Enter a payment amount greater than zero."), "orange");
			return;
		}

		// Reject non-cash overpayment with no cash to absorb change
		const over = flt(st.tendered - st.outstanding, st.precision);
		if (over > 0.0000001 && st.change + 0.0000001 < over) {
			notify(__("Only Cash payments can exceed the amount due."), "orange");
			return;
		}

		// POST applied amounts only — never send cash change as payment
		const payments = payments_for_server(st);
		if (!payments.length) {
			notify(__("Enter a payment amount greater than zero."), "orange");
			return;
		}

		const previously_paid = flt(st.paid_already, st.precision);
		const cash_received = flt(st.cash_received, st.precision);
		const applied_now = flt(st.applied, st.precision);
		const change_now = flt(st.change, st.precision);

		processing = true;
		dialog.$wrapper.find(".nz-action").prop("disabled", true);
		const request = window.nozom_pos?.offline?.request;
		try {
			await request?.with_safe_freeze?.(__("Recording payment..."), async () => {
				const r = await (request
					? request.call({
							method: "nozom_pos.api.payment.receive_invoice_payment",
							args: {
								doctype: st.invoice.doctype,
								name: st.invoice.name,
								payments,
							},
							timeout_ms: 12000,
							timeout_label: "collect_payment",
					  })
					: frappe.call({
							method: "nozom_pos.api.payment.receive_invoice_payment",
							args: {
								doctype: st.invoice.doctype,
								name: st.invoice.name,
								payments,
							},
							freeze: false,
					  }));

				const invoice = r.message?.invoice || {};
				const result = {
					offline: false,
					collect: true,
					doctype: invoice.doctype || st.invoice.doctype,
					name: invoice.name || st.invoice.name,
					total: flt(invoice.rounded_total) || flt(invoice.grand_total) || st.total,
					previously_paid,
					paid_already: previously_paid,
					tendered: st.tendered,
					cash_received,
					applied: applied_now,
					paid_now: applied_now,
					paid_amount: flt(invoice.paid_amount),
					outstanding_amount: flt(invoice.outstanding_amount),
					change: change_now,
					currency: st.currency,
					payment_status:
						flt(invoice.outstanding_amount) <= 0.0001
							? "Paid"
							: flt(invoice.paid_amount) > 0
							? "Partially Paid"
							: "Unpaid",
					has_kitchen: Boolean(controller?.settings?.print_format_2),
					print_format: controller?.frm?.pos_print_format || controller?.settings?.print_format,
					kitchen_format: controller?.settings?.print_format_2,
					letter_head: st.invoice.letter_head,
					language: frappe.boot.lang,
				};

				st.phase = "success";
				st.result = result;
				dialog.set_title(__("Payment Successful"));
				dialog.$wrapper.find(".modal-body").html(success_html(result));
				dialog.$wrapper.find(".modal-footer").addClass("hide");
				bind_success_actions(dialog, result, st);
				// Success screen is enough — no duplicate toast

				if (st.order_summary?.reload_summary_from_server) {
					await st.order_summary.reload_summary_from_server();
				}
				controller?.recent_order_list?.refresh_list?.();
			}, { max_ms: 12000, freeze: true });
		} catch (e) {
			console.error("NOZOM POS collect payment failed:", e);
			request?.mark_if_unreachable?.(e);
			request?.force_unfreeze?.();
			notify(e.message || __("Could not complete payment."), "red");
		} finally {
			processing = false;
			request?.force_unfreeze?.();
			if (st.phase === "pay") {
				dialog.$wrapper.find(".nz-action").prop("disabled", false);
			}
		}
	}

	async function save_draft_from_popup(dialog) {
		if (processing) return;
		if (controller.is_cart_empty?.()) {
			notify(__("Add items to save a draft."), "orange");
			return;
		}

		processing = true;
		dialog.$wrapper.find(".nz-action").prop("disabled", true);
		frappe.dom.freeze(__("Saving draft..."));
		try {
			await controller.save_draft_event?.({ from_checkout: true });
			dialog.hide();
			nozom_pos.offline?.request?.cleanup_checkout_ui?.(dialog.$wrapper);
		} catch (e) {
			console.error(e);
			notify(e.message || __("Could not save draft."), "red");
			dialog.$wrapper.find(".nz-action").prop("disabled", false);
		} finally {
			processing = false;
			nozom_pos.offline?.request?.force_unfreeze?.();
		}
	}

	async function reset_temp_payments(st) {
		if (st?.mode === "collect") return;
		const frm = st?.frm;
		if (!frm?.doc) return;
		for (const row of st.modes || []) {
			row.amount = 0;
			const payment = (frm.doc.payments || []).find((p) => p.mode_of_payment === row.mode_of_payment);
			if (payment) {
				await frappe.model.set_value(payment.doctype, payment.name, "amount", 0);
			}
		}
		frm.cscript.calculate_outstanding_amount?.();
		frm.refresh_field("payments");
	}

	function back_to_order(dialog, st) {
		if (processing) return;
		if (st?.mode === "collect") {
			dialog.hide();
			nozom_pos.offline?.request?.cleanup_checkout_ui?.(dialog.$wrapper);
			return;
		}
		reset_temp_payments(st).finally(() => {
			dialog.hide();
			nozom_pos.offline?.request?.cleanup_checkout_ui?.(dialog.$wrapper);
			controller.cart?.toggle_checkout_btn?.(true);
			controller.payment?.toggle_component?.(false);
			controller.item_selector?.toggle_component?.(true);
			controller.toggle_components?.(true);
			controller.update_draft_btn_state?.();
		});
	}

	function cancel_order(dialog) {
		if (processing) return;
		frappe.confirm(
			__(
				"Cancel this order? The cart will be cleared and any saved Draft will be permanently deleted."
			),
			async () => {
				processing = true;
				dialog.$wrapper.find(".nz-action").prop("disabled", true);
				frappe.dom.freeze(__("Cancelling order..."));
				try {
					await controller.cancel_current_order?.({ skip_confirm: true });
					dialog.hide();
					nozom_pos.offline?.request?.cleanup_checkout_ui?.(dialog.$wrapper);
					notify(__("Order cancelled"), "orange");
				} catch (e) {
					console.error(e);
					notify(e.message || __("Could not cancel order."), "red");
					dialog.$wrapper.find(".nz-action").prop("disabled", false);
				} finally {
					processing = false;
					nozom_pos.offline?.request?.force_unfreeze?.();
				}
			}
		);
	}

	function bind_success_actions(dialog, result, st) {
		dialog.$wrapper.find(".nozom-success-new-sale").on("click", () => {
			if (st?.mode === "collect") {
				finish_collect(dialog, st);
			} else {
				finish_new_sale(dialog);
			}
		});
		dialog.$wrapper.find(".nozom-success-print-receipt").on("click", () => {
			if (result.offline && (result.tx || result.local_receipt_no)) {
				nozom_pos.offline.local_print.print_receipt(result.tx || result);
				return;
			}
			if (!result.doctype || !result.name) return;
			frappe.utils.print(
				result.doctype,
				result.name,
				result.print_format,
				result.letter_head,
				result.language || frappe.boot.lang
			);
		});
		dialog.$wrapper.find(".nozom-success-print-kitchen").on("click", () => {
			if (result.offline && (result.tx || result.local_receipt_no)) {
				nozom_pos.offline.local_print.print_kitchen(result.tx || result);
				return;
			}
			if (!result.doctype || !result.name || !result.kitchen_format) return;
			frappe.utils.print(
				result.doctype,
				result.name,
				result.kitchen_format,
				result.letter_head,
				result.language || frappe.boot.lang
			);
		});
	}

	function finish_collect(dialog, st) {
		try {
			dialog.hide();
		} catch (e) {
			console.warn(e);
		}
		nozom_pos.offline?.request?.cleanup_checkout_ui?.(dialog?.$wrapper);
		st?.order_summary?.reload_summary_from_server?.();
		controller?.recent_order_list?.refresh_list?.();
	}

	function finish_new_sale(dialog) {
		try {
			dialog.hide();
		} catch (e) {
			console.warn(e);
		}
		nozom_pos.offline?.request?.cleanup_checkout_ui?.(dialog?.$wrapper);
		controller.load_new_invoice_on_pos();
		controller.toggle_components(true);
		controller.payment?.toggle_component?.(false);
		controller.cart?.toggle_checkout_btn?.(true);
		controller.update_draft_btn_state?.();
		setTimeout(() => {
			nozom_pos.offline?.request?.cleanup_checkout_ui?.(dialog?.$wrapper);
		}, 50);
	}

	function bind_pay_events(dialog, st) {
		const $body = dialog.$wrapper;
		$body.off(".nozom_checkout");

		$body.on("click.nozom_checkout", ".nz-pay-mode", function () {
			st.selected_mode = $(this).attr("data-mode");
			set_buffer_from_selected(st);
			refresh_ui(dialog, st);
		});

		$body.on("click.nozom_checkout", ".nz-key", function () {
			handle_key(st, $(this).attr("data-key"));
			refresh_ui(dialog, st);
		});

		$body.on("click.nozom_checkout", ".nz-quick", function () {
			const q = $(this).attr("data-quick");
			const row = selected_row(st);
			if (!row) return;
			if (q === "clear") {
				st.buffer = "";
				row.amount = 0;
				sync_totals(st);
			} else if (q === "exact") {
				const others = flt(
					st.modes
						.filter((m) => m.mode_of_payment !== row.mode_of_payment)
						.reduce((sum, m) => sum + flt(m.amount), 0),
					st.precision
				);
				set_selected_amount(st, Math.max(st.outstanding - others, 0));
			}
			refresh_ui(dialog, st);
		});

		$body.on("click.nozom_checkout", ".nz-denom-btn", function () {
			if ($(this).prop("disabled")) return;
			add_to_selected(st, flt($(this).attr("data-denom")));
			refresh_ui(dialog, st);
		});

		$body.on("click.nozom_checkout", ".nz-action-confirm", () => confirm(dialog, st));
		$body.on("click.nozom_checkout", ".nz-action-draft", () => save_draft_from_popup(dialog));
		$body.on("click.nozom_checkout", ".nz-action-back", () => back_to_order(dialog, st));
		$body.on("click.nozom_checkout", ".nz-action-cancel", () => cancel_order(dialog));

		$(document)
			.off("keydown.nozom_checkout")
			.on("keydown.nozom_checkout", (e) => {
				if (!dialog.display) return;
				if (st.phase !== "pay") {
					if (e.key === "Enter") finish_new_sale(dialog);
					return;
				}
				if (e.key === "Escape") {
					back_to_order(dialog, st);
					return;
				}
				if (e.key === "Enter") {
					e.preventDefault();
					confirm(dialog, st);
					return;
				}
				if (e.key === "Backspace") {
					e.preventDefault();
					handle_key(st, "Backspace");
					refresh_ui(dialog, st);
					return;
				}
				if (/^[0-9.]$/.test(e.key)) {
					handle_key(st, e.key);
					refresh_ui(dialog, st);
				}
			});
	}

	function seed_payments_from_profile(frm, settings) {
		const helper = nozom_pos.offline?.payment_modes;
		if (helper?.sync_onto_frm) {
			return helper.sync_onto_frm(frm, helper.list_from_settings(settings));
		}

		const profile_payments = settings?.payments || [];
		if (!profile_payments.length) {
			return (frm.doc.payments || []).some((p) => p.mode_of_payment);
		}

		frm.clear_table("payments");
		profile_payments.forEach((pay) => {
			if (!pay.mode_of_payment) return;
			const row = frm.add_child("payments");
			row.mode_of_payment = pay.mode_of_payment;
			row.amount = 0;
			row.default = pay.default;
			row.account = pay.account;
			row.type = pay.type;
		});
		frm.refresh_field("payments");
		return (frm.doc.payments || []).some((p) => p.mode_of_payment);
	}

	function show_dialog(st, title) {
		if (dialog) {
			dialog.$wrapper.off(".nozom_checkout");
			$(document).off("keydown.nozom_checkout");
			dialog.hide();
		}

		dialog = new frappe.ui.Dialog({
			title: title || __("Checkout"),
			size: "extra-large",
			static: true,
			fields: [{ fieldtype: "HTML", fieldname: "checkout_html" }],
		});

		dialog.fields_dict.checkout_html.$wrapper.html(panel_html(st));
		dialog.$wrapper.addClass("nozom-checkout-dialog nozom-pos-centered-dialog");
		dialog.$wrapper.find(".modal-header").addClass("hide").css("display", "none");
		dialog.$wrapper.find(".modal-footer").addClass("hide");
		nozom_pos.i18n?.apply_direction?.(nozom_pos.i18n.get());
		dialog.show();
		nozom_pos.i18n?.apply_direction?.(nozom_pos.i18n.get());
		bind_pay_events(dialog, st);
		refresh_ui(dialog, st);

		dialog.$wrapper.on("hidden.bs.modal", () => {
			$(document).off("keydown.nozom_checkout");
			processing = false;
			nozom_pos.offline?.request?.cleanup_checkout_ui?.(dialog.$wrapper);
			if (st?.phase === "pay" && st.mode !== "collect") {
				controller.cart?.toggle_checkout_btn?.(true);
			}
		});

		return true;
	}

	async function open(ctrl) {
		controller = ctrl;
		processing = false;
		const frm = ctrl.frm;
		if (!frm?.doc?.items?.length) {
			notify(__("You cannot submit empty order."), "orange");
			return false;
		}

		const helper = nozom_pos.offline?.payment_modes;
		if (helper?.resolve_for_checkout) {
			await helper.resolve_for_checkout(ctrl, frm);
		} else {
			seed_payments_from_profile(frm, ctrl.settings);
		}
		frm.cscript.calculate_outstanding_amount?.();
		state = build_state(frm);
		// Merge accounts/types from refreshed profile settings onto checkout modes.
		const enriched = helper?.list_from_settings?.(ctrl.settings) || [];
		enriched.forEach((pay) => {
			const row = state.modes.find((m) => m.mode_of_payment === pay.mode_of_payment);
			if (!row) return;
			if (pay.account) row.account = pay.account;
			if (pay.type) row.type = pay.type;
		});
		if (!state.modes.length) {
			frappe.msgprint(__("No Mode of Payment configured in POS Profile."));
			return false;
		}

		const cash = state.modes.find(is_cash_row) || state.modes[0];
		state.selected_mode = cash.mode_of_payment;
		cash.amount = state.outstanding;
		set_buffer_from_selected(state);
		sync_totals(state);

		return show_dialog(state, __("Checkout"));
	}

	/**
	 * Continue Payment / Add Payment for a submitted invoice.
	 * Reuses the same Checkout UI; payments go through receive_invoice_payment.
	 */
	function open_collect(ctrl, opts = {}) {
		controller = ctrl;
		processing = false;

		const modes = opts.modes || [];
		if (!modes.length) {
			frappe.msgprint(__("No Mode of Payment configured in POS Profile."));
			return false;
		}

		state = build_collect_state({
			invoice: opts.invoice,
			modes,
			invoice_total: opts.invoice_total,
			outstanding_amount: opts.outstanding_amount,
			paid_amount: opts.paid_amount,
			currency: opts.currency,
			order_summary: opts.order_summary,
		});

		const cash = state.modes.find(is_cash_row) || state.modes[0];
		state.selected_mode = cash.mode_of_payment;
		cash.amount = state.outstanding;
		set_buffer_from_selected(state);
		sync_totals(state);

		const title =
			flt(opts.paid_amount) > 0 ? __("Continue Payment") : __("Add Payment");
		return show_dialog(state, title);
	}

	return { open, open_collect };
})();
