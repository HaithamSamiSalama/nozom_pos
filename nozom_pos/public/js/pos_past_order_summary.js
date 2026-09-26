erpnext.PointOfSale.PastOrderSummary = class {
	constructor({ wrapper, settings, events }) {
		this.wrapper = wrapper;
		this.events = events;
		this.print_receipt_on_order_complete = settings.print_receipt_on_order_complete;
		this.settings = settings;

		this.init_component();
	}

	init_component() {
		this.prepare_dom();
		this.init_email_print_dialog();
		this.bind_events();
		this.attach_shortcuts();
	}

	prepare_dom() {
		this.wrapper.append(
			`<section class="past-order-summary">
				<div class="no-summary-placeholder">
					${__("Select an invoice to load summary data")}
				</div>
				<div class="invoice-summary-wrapper">
					<div class="abs-container summary-layout summary-layout-2col">
						<div class="summary-main-card">
							<div class="label">${__("General Information")}</div>
							<div class="upper-section summary-container"></div>
							<div class="label">${__("Sold Items")}</div>
							<div class="items-container summary-container order-summary-container"></div>
							<div class="label order-notes-label">${__("Order Notes")}</div>
							<div class="order-notes-container summary-container"></div>
							<div class="label">${__("Financial Summary")}</div>
							<div class="totals-container summary-container"></div>
							<div class="label">${__("Payments")}</div>
							<div class="payments-container summary-container"></div>
							<div class="label payment-status-label">${__("Payment Status")}</div>
							<div class="payment-status-container summary-container"></div>
						</div>
						<div class="summary-actions">
							<div class="label">${__("Actions")}</div>
							<div class="summary-btns"></div>
							<div class="summary-location-qr"></div>
						</div>
					</div>
				</div>
			</section>`
		);

		this.$component = this.wrapper.find(".past-order-summary");
		this.$summary_wrapper = this.$component.find(".invoice-summary-wrapper");
		this.$summary_container = this.$component.find(".abs-container");
		this.$summary_main = this.$summary_container.find(".summary-main-card");
		this.$upper_section = this.$summary_container.find(".upper-section");
		this.$items_container = this.$summary_container.find(".items-container");
		this.$order_notes_label = this.$summary_container.find(".order-notes-label");
		this.$order_notes_container = this.$summary_container.find(".order-notes-container");
		this.$totals_container = this.$summary_container.find(".totals-container");
		this.$payment_container = this.$summary_container.find(".payments-container");
		this.$payment_status_container = this.$summary_container.find(".payment-status-container");
		this.$payment_status_label = this.$summary_container.find(".payment-status-label");
		this.$summary_btns = this.$summary_container.find(".summary-btns");
		this.$location_qr = this.$summary_container.find(".summary-location-qr");
	}

	init_email_print_dialog() {
		const email_dialog = new frappe.ui.Dialog({
			title: __("Email Receipt"),
			fields: [
				{ fieldname: "email_id", fieldtype: "Data", options: "Email", label: "Email ID", reqd: 1 },
				{ fieldname: "content", fieldtype: "Small Text", label: "Message (if any)" },
			],
			primary_action: () => {
				this.send_email();
			},
			primary_action_label: __("Send"),
		});
		this.email_dialog = email_dialog;

		const print_dialog = new frappe.ui.Dialog({
			title: __("Print Receipt"),
			fields: [{ fieldname: "print", fieldtype: "Data", label: "Print Preview" }],
			primary_action: () => {
				this.print_receipt();
			},
			primary_action_label: __("Print"),
		});
		this.print_dialog = print_dialog;
	}

	get_upper_section_html(doc) {
		const order_no = cstr(doc.nozom_order_number || "").trim();
		const order_no_html = order_no
			? `<div class="info-row"><span>${__("Order Number")}</span><strong>${frappe.utils.escape_html(
					order_no
			  )}</strong></div>`
			: "";

		const date_txt = doc.get_formatted?.("posting_date") || doc.posting_date || "";
		const time_txt = doc.get_formatted?.("posting_time") || doc.posting_time || "";
		const addr_html = nozom_pos.address_format?.with_title?.(
			doc.nozom_address_title_snapshot,
			doc.address_display || doc.shipping_address,
			{ as_html: true }
		);
		const pay = nozom_pos.payment_status?.resolve?.(doc) || {};
		const pay_extra =
			pay.key === "Partially Paid" || pay.key === "Unpaid"
				? `<div class="info-row"><span>${__("Paid")}</span><span dir="ltr">${format_currency(
						pay.paid,
						doc.currency
				  )}</span></div>
				<div class="info-row"><span>${__("Outstanding")}</span><span dir="ltr">${format_currency(
					pay.outstanding,
					doc.currency
				)}</span></div>`
				: "";

		return `<div class="order-info-stack">
					<div class="info-row"><span>${__("Date")}</span><span dir="ltr">${frappe.utils.escape_html(
						date_txt
					)}</span></div>
					<div class="info-row"><span>${__("Time")}</span><span dir="ltr">${frappe.utils.escape_html(
						time_txt
					)}</span></div>
					<div class="info-row"><span>${__("Invoice")}</span><strong>${frappe.utils.escape_html(
						doc.name || ""
					)}</strong></div>
					${order_no_html}
					<div class="info-row"><span>${__("Customer")}</span><strong>${frappe.utils.escape_html(
						doc.customer_name || doc.customer || ""
					)}</strong></div>
					${
						addr_html
							? `<div class="info-row info-row--address"><span>${__(
									"Address"
							  )}</span><strong class="nozom-address-plain">${addr_html}</strong></div>`
							: ""
					}
					<div class="info-row"><span>${__("Payment Status")}</span><strong class="pay-status pay-status--${frappe.utils.escape_html(
						(pay.key || "").replace(/\s+/g, "-").toLowerCase()
					)}">${frappe.utils.escape_html(pay.label || "")}</strong></div>
					${pay_extra}
					<div class="info-row muted"><span>${__("Cashier")}</span><span>${frappe.utils.escape_html(
						doc.owner || ""
					)}</span></div>
				</div>`;
	}

	async get_item_html(doc, item_data) {
		const item_refund_data =
			doc._nozom_local_queue || doc.is_return || doc.docstatus === 0 ? "" : await get_returned_qty();
		const notes_html = get_item_notes_html();
		const disc =
			flt(item_data.discount_percentage) > 0
				? `${flt(item_data.discount_percentage)}%`
				: flt(item_data.discount_amount) > 0
				? format_currency(item_data.discount_amount, doc.currency)
				: "—";

		return `<div class="item-row-wrapper">
				<div class="item-row-data item-row-data--cols">
					<div class="item-name">${frappe.utils.escape_html(cstr(item_data.item_name))}</div>
					<div class="item-qty" dir="ltr">${item_data.qty || 0}</div>
					<div class="item-rate" dir="ltr">${format_currency(
						item_data.rate || item_data.price_list_rate,
						doc.currency
					)}</div>
					<div class="item-disc" dir="ltr">${disc}</div>
					<div class="item-amount" dir="ltr">${format_currency(item_data.amount, doc.currency)}</div>
				</div>
				${notes_html}
				${item_refund_data}
		</div>`;

		function get_item_notes_html() {
			if (!item_data.notes) return ``;
			const notes = frappe.utils.escape_html(cstr(item_data.notes));
			return `<div class="item-notes"><span class="item-notes-label">${__(
				"Notes"
			)}:</span> ${notes}</div>`;
		}

		async function get_returned_qty() {
			const r = await frappe.call({
				method: "erpnext.controllers.sales_and_purchase_return.get_invoice_item_returned_qty",
				args: {
					doctype: doc.doctype,
					invoice: doc.name,
					customer: doc.customer,
					item_row_name: item_data.name,
				},
			});

			if (!r.message.qty) {
				return "";
			}

			return `<div class="item-row-refund">
				<strong>${r.message.qty}</strong> ${__("Returned")}
			</div>`;
		}
	}

	get_discount_html(doc) {
		if (doc.discount_amount) {
			const discount_label = flt(doc.additional_discount_percentage)
				? `${__("Discount")} (${doc.additional_discount_percentage} %)`
				: __("Discount");
			return `<div class="summary-row-wrapper">
						<div>${discount_label}</div>
						<div>${format_currency(doc.discount_amount, doc.currency)}</div>
					</div>`;
		} else {
			return ``;
		}
	}

	get_net_total_html(doc) {
		return `<div class="summary-row-wrapper">
					<div>${__("Net Total")}</div>
					<div>${format_currency(doc.net_total, doc.currency)}</div>
				</div>`;
	}

	get_taxes_html(doc) {
		if (!(doc.taxes || []).length) return "";

		let taxes_html = doc.taxes
			.map((t) => {
				return `
				<div class="tax-row">
					<div class="tax-label">${t.description}</div>
					<div class="tax-value">${format_currency(t.tax_amount_after_discount_amount, doc.currency)}</div>
				</div>
			`;
			})
			.join("");

		return `<div class="taxes-wrapper">${taxes_html}</div>`;
	}

	get_grand_total_html(doc) {
		return `<div class="summary-row-wrapper grand-total">
					<div>${__("Grand Total")}</div>
					<div>${format_currency(doc.grand_total, doc.currency)}</div>
				</div>`;
	}

	get_payment_html(doc, payment) {
		return `<div class="summary-row-wrapper payments">
					<div>${__(payment.mode_of_payment)}</div>
					<div>${format_currency(payment.amount, doc.currency)}</div>
				</div>`;
	}

	bind_events() {
		this.$summary_container.on("click", ".return-btn", async () => {
			const r = await this.is_invoice_returnable(this.doc.doctype, this.doc.name);
			if (!r) {
				frappe.msgprint({
					title: __("Invalid Return"),
					indicator: "orange",
					message: __("All the items have been already returned."),
				});
				return;
			}
			this.events.process_return(this.doc.doctype, this.doc.name);
			this.toggle_component(false);
			this.$component.find(".no-summary-placeholder").css("display", "flex");
			this.$summary_wrapper.css("display", "none");
		});

		this.$summary_container.on("click", ".edit-btn", () => {
			if (this.doc?._nozom_local_draft) {
				this.events.edit_local_draft?.(this.doc._nozom_local_draft_id || this.doc.name);
			} else {
				this.events.edit_order(this.doc.doctype, this.doc.name);
			}
			this.toggle_component(false);
			this.$component.find(".no-summary-placeholder").css("display", "flex");
			this.$summary_wrapper.css("display", "none");
		});

		this.$summary_container.on("click", ".delete-btn", () => {
			if (this.doc?._nozom_local_draft) {
				this.events.delete_local_draft?.(this.doc._nozom_local_draft_id || this.doc.name);
			} else {
				this.events.delete_order(this.doc.doctype, this.doc.name);
			}
			this.show_summary_placeholder();
		});
		this.$summary_container.on("click", ".new-btn", () => {
			this.events.new_order();
			this.toggle_component(false);
			this.$component.find(".no-summary-placeholder").css("display", "flex");
			this.$summary_wrapper.css("display", "none");
		});

		this.$summary_container.on("click", ".email-btn", () => {
			this.email_dialog.fields_dict.email_id.set_value(this.customer_email);
			this.email_dialog.show();
		});

		this.$summary_container.on("click", ".send-btn", () => {
			const frm = this.events.get_frm();
			frappe.utils.print(
				this.doc.doctype,
				this.doc.name,
				this.settings.print_format_2 || frm.pos_print_format,
				this.doc.letter_head,
				this.doc.language || frappe.boot.lang
			);
		});

		this.$summary_container.on("click", ".print-btn", () => {
			this.print_receipt();
		});

		this.$summary_container.on("click", ".open-btn", () => {
			this.events.open_in_form_view(this.doc.doctype, this.doc.name);
		});

		this.$summary_container.on("click", ".add-btn, .continue-btn", () => {
			this.open_collect_payment_dialog();
		});
	}

	print_receipt() {
		const frm = this.events.get_frm();
		frappe.utils.print(
			this.doc.doctype,
			this.doc.name,
			frm.pos_print_format,
			this.doc.letter_head,
			this.doc.language || frappe.boot.lang
		);
	}

	attach_shortcuts() {
		const ctrl_label = frappe.utils.is_mac() ? "⌘" : "Ctrl";
		this.$summary_container.find(".print-btn").attr("title", `${ctrl_label}+P`);
		frappe.ui.keys.add_shortcut({
			shortcut: "ctrl+p",
			action: () => this.$summary_container.find(".print-btn").click(),
			condition: () =>
				this.$component.is(":visible") && this.$summary_container.find(".print-btn").is(":visible"),
			description: __("Print Receipt"),
			page: cur_page.page.page,
		});
		this.$summary_container.find(".new-btn").attr("title", `${ctrl_label}+Enter`);
		frappe.ui.keys.on("ctrl+enter", () => {
			const summary_is_visible = this.$component.is(":visible");
			if (summary_is_visible && this.$summary_container.find(".new-btn").is(":visible")) {
				this.$summary_container.find(".new-btn").click();
			}
		});
		this.$summary_container.find(".edit-btn").attr("title", `${ctrl_label}+E`);
		frappe.ui.keys.add_shortcut({
			shortcut: "ctrl+e",
			action: () => this.$summary_container.find(".edit-btn").click(),
			condition: () =>
				this.$component.is(":visible") && this.$summary_container.find(".edit-btn").is(":visible"),
			description: __("Edit Receipt"),
			page: cur_page.page.page,
		});
	}

	send_email() {
		const frm = this.events.get_frm();
		const recipients = this.email_dialog.get_values().email_id;
		const content = this.email_dialog.get_values().content;
		const doc = this.doc || frm.doc;
		const print_format = frm.pos_print_format;

		frappe.call({
			method: "frappe.core.doctype.communication.email.make",
			args: {
				recipients: recipients,
				subject: __(frm.meta.name) + ": " + doc.name,
				content: content ? content : __(frm.meta.name) + ": " + doc.name,
				doctype: doc.doctype,
				name: doc.name,
				send_email: 1,
				print_format,
				sender_full_name: frappe.user.full_name(),
				_lang: doc.language,
			},
			callback: (r) => {
				if (!r.exc) {
					frappe.utils.play_sound("email");
					if (r.message["emails_not_sent_to"]) {
						frappe.msgprint(
							__("Email not sent to {0} (unsubscribed / disabled)", [
								frappe.utils.escape_html(r.message["emails_not_sent_to"]),
							])
						);
					}
					this.email_dialog.hide();
				} else {
					frappe.msgprint(__("There were errors while sending email. Please try again."));
				}
			},
		});
	}

	add_summary_btns(map) {
		this.$summary_btns.html("");
		map.forEach((m) => {
			if (m.condition) {
				m.visible_btns.forEach((b) => {
					const class_name = b.split(" ")[0].toLowerCase();
					const btn = __(b);
					const tone = this.get_action_btn_tone(class_name);
					this.$summary_btns.append(
						`<button type="button" class="summary-btn btn ${tone} ${class_name}-btn">${btn}</button>`
					);
				});
			}
		});
	}

	get_action_btn_tone(class_name) {
		if (["add", "continue"].includes(class_name)) return "btn-success";
		if (["print"].includes(class_name)) return "btn-info";
		if (["send"].includes(class_name)) return "btn-warning summary-btn-kitchen";
		if (["return"].includes(class_name)) return "btn-warning";
		if (["delete"].includes(class_name)) return "btn-danger";
		return "btn-secondary";
	}

	toggle_summary_placeholder(show) {
		if (show) {
			this.$summary_wrapper.css("display", "none");
			this.$component.find(".no-summary-placeholder").css("display", "flex");
		} else {
			this.$summary_wrapper.css("display", "flex");
			this.$component.find(".no-summary-placeholder").css("display", "none");
		}
	}

	can_collect_payment(doc = this.doc) {
		if (!doc || doc._nozom_local_queue) return false;
		return (
			doc.docstatus === 1 &&
			!cint(doc.is_return) &&
			doc.status !== "Consolidated" &&
			flt(doc.outstanding_amount) > 0
		);
	}

	get_collect_payment_btn_key(doc = this.doc) {
		return flt(doc.paid_amount) > 0 ? "Continue Payment" : "Add Payment";
	}

	get_collect_payment_btn_label(doc = this.doc) {
		return __(this.get_collect_payment_btn_key(doc));
	}

	get_condition_btn_map(after_submission) {
		if (this.doc?._nozom_local_queue) {
			return [{ condition: true, visible_btns: ["New Order"] }];
		}

		if (this.doc?._nozom_local_draft) {
			return [
				{
					condition: true,
					visible_btns: ["Edit Order", "Delete Order", "New Order"],
				},
			];
		}

		const offline = !window.nozom_pos?.offline?.network || !nozom_pos.offline.network.is_online();
		if (offline || this.doc?._from_cache) {
			if (after_submission) {
				return [{ condition: true, visible_btns: ["New Order"] }];
			}
			return [{ condition: true, visible_btns: ["New Order"] }];
		}

		if (after_submission)
			return [{ condition: true, visible_btns: ["Print Receipt", "Send To Kitchen", "New Order"] }];

		const collectable = this.can_collect_payment();

		return [
			{ condition: this.doc.docstatus === 0, visible_btns: ["Edit Order", "Delete Order"] },
			{
				condition: collectable,
				visible_btns: [
					this.get_collect_payment_btn_key(),
					"Print Receipt",
					"Send To Kitchen",
					"Email Receipt",
				],
			},
			{
				condition:
					!collectable &&
					["Partly Paid", "Overdue", "Unpaid"].includes(this.doc.status),
				visible_btns: ["Print Receipt", "Send To Kitchen", "Email Receipt"],
			},
			{
				condition:
					!this.doc.is_return &&
					this.doc.docstatus === 1 &&
					!collectable &&
					!["Partly Paid", "Overdue", "Unpaid"].includes(this.doc.status),
				visible_btns: ["Print Receipt", "Send To Kitchen", "Email Receipt", "Return"],
			},
			{
				condition: this.doc.is_return && this.doc.docstatus === 1,
				visible_btns: ["Print Receipt", "Email Receipt"],
			},
		];
	}

	load_summary_of(doc, after_submission = false) {
		after_submission
			? this.$component.css("grid-column", "span 10 / span 10")
			: this.$component.css("grid-column", "span 6 / span 6");

		this.toggle_summary_placeholder(false);

		this.doc = doc;

		this.attach_document_info(doc);

		this.attach_items_info(doc);

		this.attach_order_notes_info(doc);

		this.attach_totals_info(doc);

		this.attach_payments_info(doc);

		this.attach_payment_status_info(doc);

		this.attach_location_qr(doc);

		const condition_btns_map = this.get_condition_btn_map(after_submission);

		this.add_summary_btns(condition_btns_map);

		if (after_submission && this.print_receipt_on_order_complete && !doc._nozom_local_queue) {
			this.print_receipt();
		}
	}

	get_invoice_total_amount(doc) {
		if (erpnext.PointOfSale.get_invoice_total) {
			return erpnext.PointOfSale.get_invoice_total(doc);
		}
		return flt(doc.rounded_total) || flt(doc.grand_total);
	}

	attach_payment_status_info(doc) {
		const show_status = doc.docstatus === 1 && !cint(doc.is_return);
		this.$payment_status_label.css("display", show_status ? "" : "none");
		this.$payment_status_container.css("display", show_status ? "flex" : "none");

		if (!show_status) {
			this.$payment_status_container.html("");
			return;
		}

		const pay = nozom_pos.payment_status?.resolve?.(doc) || {};
		this.$payment_status_container.html(`
			<div class="summary-row-wrapper">
				<div>${__("Status")}</div>
				<div><strong>${frappe.utils.escape_html(pay.label || "")}</strong></div>
			</div>
			<div class="summary-row-wrapper">
				<div>${__("Paid")}</div>
				<div>${format_currency(pay.paid, doc.currency)}</div>
			</div>
			<div class="summary-row-wrapper">
				<div>${__("Outstanding")}</div>
				<div class="${pay.outstanding > 0 ? "text-danger" : "text-success"}">${format_currency(
					pay.outstanding,
					doc.currency
				)}</div>
			</div>
		`);
	}

	attach_location_qr(doc) {
		const $qr = this.$location_qr;
		if (!$qr?.length) return;
		const location = nozom_pos.offline?.qr?.sanitize?.(doc.nozom_delivery_location_link_snapshot || "");
		if (!location) {
			$qr.html("").hide();
			return;
		}
		const qr_html = nozom_pos.offline.qr.screen_html(location, {
			label: __("Delivery Location"),
			hint: __("Scan to open location"),
		});
		$qr.html(`
			${qr_html}
			<button type="button" class="btn btn-sm btn-primary nozom-open-location-btn" style="width:100%;margin-top:0.4rem;">
				${__("Open Location")}
			</button>
		`).show();
		$qr.find(".nozom-open-location-btn").on("click", () => {
			window.open(location, "_blank", "noopener,noreferrer");
		});
	}

	attach_order_notes_info(doc) {
		const notes = cstr(doc.order_notes || "").trim();
		const show = Boolean(notes);
		this.$order_notes_label.css("display", show ? "" : "none");
		this.$order_notes_container.css("display", show ? "flex" : "none");

		if (!show) {
			this.$order_notes_container.html("");
			return;
		}

		this.$order_notes_container.html(
			`<div class="summary-row-wrapper order-notes-text">${frappe.utils.escape_html(notes)}</div>`
		);
	}

	async open_collect_payment_dialog() {
		if (!this.doc || !this.can_collect_payment(this.doc)) {
			return;
		}

		const context = await frappe.call({
			method: "nozom_pos.api.payment.get_invoice_payment_context",
			args: {
				doctype: this.doc.doctype,
				name: this.doc.name,
				pos_profile: this.settings?.name || this.doc.pos_profile,
			},
			freeze: true,
		});

		const message = context.message || {};
		if (!message.can_collect) {
			frappe.show_alert({
				message: __("This invoice has no outstanding amount."),
				indicator: "orange",
			});
			await this.reload_summary_from_server();
			return;
		}

		const modes = (message.modes_of_payment || [])
			.map((row) => cstr(row.mode_of_payment || row).trim())
			.filter(Boolean);

		if (!modes.length) {
			frappe.msgprint(__("No Mode of Payment configured in POS Profile."));
			return;
		}

		const ctrl =
			this.events.get_controller?.() ||
			window.cur_pos ||
			this.events;

		if (window.nozom_pos?.checkout_popup?.open_collect) {
			nozom_pos.checkout_popup.open_collect(ctrl, {
				invoice: message.invoice,
				invoice_total: flt(message.invoice_total),
				outstanding_amount: flt(message.outstanding_amount),
				paid_amount: flt(message.invoice?.paid_amount),
				currency: message.invoice?.currency,
				modes,
				order_summary: this,
			});
			return;
		}

		// Fallback should not normally run — Checkout popup is required.
		frappe.msgprint(__("Checkout payment UI is unavailable."));
	}

	show_touch_payment_dialog({
		invoice,
		invoice_total,
		outstanding_amount,
		paid_amount,
		currency,
		modes,
	}) {
		const me = this;
		const precision =
			cint(frappe.defaults.get_default("currency_precision")) ||
			cint(frappe.boot.sysdefaults.currency_precision) ||
			2;
		const state = {
			modes: modes.map((mode) => ({ mode_of_payment: mode, amount: 0 })),
			selected_mode: modes[0],
			buffer: "",
			outstanding: flt(outstanding_amount, precision),
			paid_already: flt(paid_amount, precision),
			invoice_total: flt(invoice_total, precision),
			currency,
			precision,
		};

		const dialog = new frappe.ui.Dialog({
			title: this.get_collect_payment_btn_label(invoice),
			size: "extra-large",
			static: true,
			fields: [{ fieldname: "payment_ui", fieldtype: "HTML" }],
			primary_action_label: __("Confirm Payment"),
			primary_action() {
				me.confirm_touch_payment(dialog, state);
			},
			secondary_action_label: __("Cancel"),
			secondary_action() {
				dialog.hide();
			},
		});

		dialog.$wrapper.addClass("nozom-touch-payment-dialog");
		dialog.fields_dict.payment_ui.$wrapper.html(this.get_touch_payment_html(invoice, state));
		dialog.show();

		this.bind_touch_payment_events(dialog, state);
		this.refresh_touch_payment_ui(dialog, state);
		dialog.get_primary_btn().addClass("btn-success btn-lg");
	}

	get_touch_payment_html(invoice, state) {
		const mode_btns = state.modes
			.map(
				(row) => `
			<button type="button" class="touch-mode-btn" data-mode="${frappe.utils.escape_html(
				row.mode_of_payment
			)}">
				${frappe.utils.escape_html(__(row.mode_of_payment))}
				<span class="touch-mode-amount" data-mode-amount="${frappe.utils.escape_html(
					row.mode_of_payment
				)}"></span>
			</button>`
			)
			.join("");

		const keys = [
			["1", "2", "3"],
			["4", "5", "6"],
			["7", "8", "9"],
			["C", "0", "."],
			["Backspace"],
		];

		const keypad = keys
			.map(
				(row) =>
					`<div class="touch-keypad-row">${row
						.map(
							(key) =>
								`<button type="button" class="touch-key ${
									key === "Backspace" ? "touch-key-wide" : ""
								}" data-key="${key}">${__(key === "C" ? "C" : key)}</button>`
						)
						.join("")}</div>`
			)
			.join("");

		return `
			<div class="touch-payment-panel">
				<div class="touch-payment-header">
					<div class="touch-invoice-name">${frappe.utils.escape_html(invoice.name)}</div>
					<div class="touch-summary-grid">
						<div class="touch-summary-row">
							<span>${__("Grand Total")}</span>
							<strong class="touch-total"></strong>
						</div>
						<div class="touch-summary-row">
							<span>${__("Paid Amount")}</span>
							<strong class="touch-paid-already"></strong>
						</div>
						<div class="touch-summary-row touch-outstanding-row">
							<span>${__("Outstanding Amount")}</span>
							<strong class="touch-outstanding"></strong>
						</div>
					</div>
				</div>

				<div class="touch-payment-body">
					<div class="touch-modes-block">
						<div class="touch-section-label">${__("Payment Methods")}</div>
						<div class="touch-modes">${mode_btns}</div>
					</div>

					<div class="touch-amount-block">
						<div class="touch-section-label">${__("Amount")}</div>
						<div class="touch-amount-display">0.00</div>
						<div class="touch-quick-actions">
							<button type="button" class="touch-quick-btn" data-quick="exact">${__("Exact Amount")}</button>
							<button type="button" class="touch-quick-btn" data-quick="10">+10</button>
							<button type="button" class="touch-quick-btn" data-quick="50">+50</button>
							<button type="button" class="touch-quick-btn" data-quick="100">+100</button>
						</div>
						<div class="touch-keypad">${keypad}</div>
					</div>
				</div>

				<div class="touch-payment-footer">
					<div class="touch-section-label">${__("Selected payments")}</div>
					<div class="touch-breakdown"></div>
					<div class="touch-footer-totals">
						<div class="touch-summary-row">
							<span>${__("Paid Now")}</span>
							<strong class="touch-paid-now"></strong>
						</div>
						<div class="touch-summary-row">
							<span>${__("Remaining")}</span>
							<strong class="touch-remaining"></strong>
						</div>
					</div>
				</div>
			</div>
		`;
	}

	bind_touch_payment_events(dialog, state) {
		const $root = dialog.fields_dict.payment_ui.$wrapper;
		const me = this;

		$root.on("click", ".touch-mode-btn", function () {
			state.selected_mode = $(this).attr("data-mode");
			const current = state.modes.find((m) => m.mode_of_payment === state.selected_mode);
			state.buffer =
				current && flt(current.amount)
					? flt(current.amount, state.precision).toFixed(state.precision)
					: "";
			me.refresh_touch_payment_ui(dialog, state);
		});

		$root.on("click", ".touch-key", function () {
			me.apply_touch_keypad($(this).attr("data-key"), state);
			me.refresh_touch_payment_ui(dialog, state);
		});

		$root.on("click", ".touch-quick-btn", function () {
			const quick = $(this).attr("data-quick");
			me.apply_touch_quick_action(quick, state);
			me.refresh_touch_payment_ui(dialog, state);
		});

		dialog.$wrapper
			.off("keydown.nozom-touch-payment")
			.on("keydown.nozom-touch-payment", (e) => {
				if (e.key === "Escape") {
					dialog.hide();
					return;
				}
				if (e.key === "Enter") {
					e.preventDefault();
					me.confirm_touch_payment(dialog, state);
					return;
				}
				if (e.key === "Backspace") {
					e.preventDefault();
					me.apply_touch_keypad("Backspace", state);
					me.refresh_touch_payment_ui(dialog, state);
					return;
				}
				if (/^[0-9.]$/.test(e.key)) {
					e.preventDefault();
					me.apply_touch_keypad(e.key, state);
					me.refresh_touch_payment_ui(dialog, state);
				}
			});
	}

	get_touch_paid_now(state) {
		return flt(
			state.modes.reduce((sum, row) => sum + flt(row.amount), 0),
			state.precision
		);
	}

	get_touch_remaining(state) {
		return flt(Math.max(state.outstanding - this.get_touch_paid_now(state), 0), state.precision);
	}

	set_selected_mode_amount(state, amount) {
		const row = state.modes.find((m) => m.mode_of_payment === state.selected_mode);
		if (!row) return;

		const other_total = flt(
			state.modes
				.filter((m) => m.mode_of_payment !== state.selected_mode)
				.reduce((sum, m) => sum + flt(m.amount), 0),
			state.precision
		);
		const max_for_mode = flt(Math.max(state.outstanding - other_total, 0), state.precision);
		row.amount = flt(Math.min(Math.max(flt(amount), 0), max_for_mode), state.precision);
		state.buffer = row.amount ? flt(row.amount, state.precision).toFixed(state.precision) : "";
	}

	apply_touch_keypad(key, state) {
		let buffer = state.buffer || "";

		if (key === "C") {
			buffer = "";
		} else if (key === "Backspace") {
			buffer = buffer.slice(0, -1);
		} else if (key === ".") {
			if (!buffer.includes(".")) buffer += buffer ? "." : "0.";
		} else if (/^\d$/.test(key)) {
			if (buffer.includes(".")) {
				const decimals = buffer.split(".")[1] || "";
				if (decimals.length >= state.precision) return;
			}
			buffer = `${buffer}${key}`.replace(/^0+(\d)/, "$1");
		} else {
			return;
		}

		state.buffer = buffer;
		this.set_selected_mode_amount(state, buffer === "" || buffer === "." ? 0 : buffer);
	}

	apply_touch_quick_action(quick, state) {
		const paid_now = this.get_touch_paid_now(state);
		const remaining = flt(Math.max(state.outstanding - paid_now, 0), state.precision);
		const selected = state.modes.find((m) => m.mode_of_payment === state.selected_mode);
		const current = selected ? flt(selected.amount) : 0;

		if (quick === "exact") {
			this.set_selected_mode_amount(state, current + remaining);
			return;
		}

		const delta = flt(quick);
		if (delta > 0) {
			this.set_selected_mode_amount(state, current + delta);
		}
	}

	refresh_touch_payment_ui(dialog, state) {
		const $root = dialog.fields_dict.payment_ui.$wrapper;
		const fmt = (value) => format_currency(flt(value, state.precision), state.currency);
		const paid_now = this.get_touch_paid_now(state);
		const remaining = this.get_touch_remaining(state);
		const selected = state.modes.find((m) => m.mode_of_payment === state.selected_mode);
		const display_amount =
			state.buffer !== ""
				? state.buffer
				: flt(selected?.amount || 0, state.precision).toFixed(state.precision);

		$root.find(".touch-total").text(fmt(state.invoice_total));
		$root.find(".touch-paid-already").text(fmt(state.paid_already));
		$root.find(".touch-outstanding").text(fmt(state.outstanding));
		$root.find(".touch-paid-now").text(fmt(paid_now));
		$root.find(".touch-remaining").text(fmt(remaining));
		$root.find(".touch-amount-display").text(display_amount);

		$root.find(".touch-mode-btn").removeClass("active");
		$root.find(".touch-mode-btn").each(function () {
			if ($(this).attr("data-mode") === state.selected_mode) {
				$(this).addClass("active");
			}
		});

		state.modes.forEach((row) => {
			const amount_text = flt(row.amount) ? fmt(row.amount) : "";
			$root.find("[data-mode-amount]").each(function () {
				if ($(this).attr("data-mode-amount") === row.mode_of_payment) {
					$(this).text(amount_text);
				}
			});
		});

		const breakdown = state.modes
			.filter((row) => flt(row.amount) > 0)
			.map(
				(row) => `
				<div class="touch-breakdown-row">
					<span>${frappe.utils.escape_html(__(row.mode_of_payment))}</span>
					<strong>${fmt(row.amount)}</strong>
				</div>`
			)
			.join("");

		$root
			.find(".touch-breakdown")
			.html(breakdown || `<div class="touch-breakdown-empty">${__("No payments entered")}</div>`);
	}

	confirm_touch_payment(dialog, state) {
		const payments = state.modes
			.filter((row) => flt(row.amount) > 0)
			.map((row) => ({
				mode_of_payment: row.mode_of_payment,
				amount: flt(row.amount, state.precision),
			}));
		const total = flt(
			payments.reduce((sum, row) => sum + flt(row.amount), 0),
			state.precision
		);

		if (!payments.length) {
			frappe.show_alert({
				message: __("Enter a payment amount greater than zero."),
				indicator: "orange",
			});
			return;
		}

		if (total > state.outstanding) {
			frappe.show_alert({
				message: __("Payment total cannot exceed outstanding amount."),
				indicator: "orange",
			});
			return;
		}

		dialog.hide();
		this.submit_additional_payment(payments);
	}

	async submit_additional_payment(payments) {
		try {
			const r = await frappe.call({
				method: "nozom_pos.api.payment.receive_invoice_payment",
				args: {
					doctype: this.doc.doctype,
					name: this.doc.name,
					payments,
				},
				freeze: true,
				freeze_message: __("Recording payment..."),
			});

			await this.reload_summary_from_server();
			// Summary reload is enough — no success toast
		} catch (e) {
			// frappe.call already shows server errors
		}
	}

	async reload_summary_from_server() {
		if (!this.doc?.doctype || !this.doc?.name) return;

		const doc = await frappe.db.get_doc(this.doc.doctype, this.doc.name);
		this.load_summary_of(doc);
	}

	attach_document_info(doc) {
		const render = () => {
			const upper_section_dom = this.get_upper_section_html(doc);
			this.$upper_section.html(upper_section_dom);
		};

		if (doc._nozom_local_draft || doc._nozom_local_queue || doc._from_cache) {
			this.customer_email = "";
			render();
			return;
		}

		frappe.db.get_value("Customer", this.doc.customer, "email_id").then(({ message }) => {
			this.customer_email = message?.email_id || "";
			render();
		});
	}

	async attach_items_info(doc) {
		this.$items_container.html(`
			<div class="item-row-data item-row-data--cols item-row-head">
				<div class="item-name">${__("Item")}</div>
				<div class="item-qty">${__("Qty")}</div>
				<div class="item-rate">${__("Rate")}</div>
				<div class="item-disc">${__("Discount")}</div>
				<div class="item-amount">${__("Amount")}</div>
			</div>
		`);
		for (const item of doc.items || []) {
			const item_dom = await this.get_item_html(doc, item);
			this.$items_container.append(item_dom);
		}
	}

	set_dynamic_rate_header_width() {
		/* column layout is fixed via CSS */
	}

	attach_payments_info(doc) {
		this.$payment_container.html("");
		(doc.payments || []).forEach((p) => {
			if (p.amount) {
				const payment_dom = this.get_payment_html(doc, p);
				this.$payment_container.append(payment_dom);
			}
		});
		if (doc.redeem_loyalty_points && doc.loyalty_amount) {
			const payment_dom = this.get_payment_html(doc, {
				mode_of_payment: "Loyalty Points",
				amount: doc.loyalty_amount,
			});
			this.$payment_container.append(payment_dom);
		}
	}

	attach_totals_info(doc) {
		this.$totals_container.html("");
		const pay = nozom_pos.payment_status?.resolve?.(doc) || {};
		const gross = flt(doc.total) || flt(doc.net_total) + flt(doc.discount_amount);
		const rows = [
			[__("Gross Total"), gross],
			[__("Discount"), flt(doc.discount_amount)],
			[__("Net Total"), flt(doc.net_total)],
			[__("Tax"), flt(doc.total_taxes_and_charges)],
			[__("Grand Total"), this.get_invoice_total_amount(doc)],
			[__("Paid"), pay.paid],
			[__("Outstanding"), pay.outstanding],
		];
		rows.forEach(([label, amount]) => {
			this.$totals_container.append(`
				<div class="summary-row-wrapper">
					<div>${label}</div>
					<div dir="ltr">${format_currency(amount, doc.currency)}</div>
				</div>
			`);
		});
		const taxes_dom = this.get_taxes_html(doc);
		if (taxes_dom) this.$totals_container.append(taxes_dom);
	}

	toggle_component(show) {
		this.$component.css("grid-column", "span 6 / span 6");
		show ? this.$component.css("display", "flex") : this.$component.css("display", "none");
	}

	refresh_i18n_labels() {
		const T = nozom_pos.t || __;
		const $c = this.$component;
		if (!$c?.length) return;
		$c.find(".no-summary-placeholder").text(T("Select an invoice to load summary data"));
		$c.find(".summary-sections .label").each(function () {
			const $el = $(this);
			if ($el.hasClass("order-notes-label")) $el.text(T("Order Notes"));
			else if ($el.hasClass("payment-status-label")) $el.text(T("Payment Status"));
		});
		// Rebuild section titles from known structure
		const map = [
			[".customer-section .label", "General Information"],
			[".item-summary-container .label", "Sold Items"],
			[".order-notes-summary .label, .order-notes-label", "Order Notes"],
			[".totals-summary-container .label", "Financial Summary"],
			[".payments-container .label", "Payments"],
			[".payment-status-summary .label, .payment-status-label", "Payment Status"],
			[".summary-btns-container .label", "Actions"],
		];
		map.forEach(([sel, key]) => {
			$c.find(sel).first().text(T(key));
		});
	}

	async is_invoice_returnable(doctype, invoice) {
		const r = await frappe.call({
			method: "erpnext.controllers.sales_and_purchase_return.is_invoice_returnable",
			args: {
				doctype: doctype,
				invoice: invoice,
			},
		});
		return r.message;
	}
};
