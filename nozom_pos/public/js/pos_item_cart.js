erpnext.PointOfSale.ItemCart = class {
	constructor({ wrapper, events, settings }) {
		this.wrapper = wrapper;
		this.events = events;
		this.customer_info = undefined;
		this.hide_images = settings.hide_images;
		this.allowed_customer_groups = settings.customer_groups;
		this.allow_rate_change = settings.allow_rate_change;
		this.allow_discount_change = settings.allow_discount_change;
		this.init_component();
	}

	init_component() {
		this.prepare_dom();
		this.init_child_components();
		this.bind_events();
		this.attach_shortcuts();
	}

	prepare_dom() {
		this.wrapper.append(`<section class="customer-cart-container"></section>`);

		this.$component = this.wrapper.find(".customer-cart-container");
	}

	init_child_components() {
		this.init_customer_selector();
		this.init_cart_components();
	}

	init_customer_selector() {
		this.$component.append(`<div class="customer-section"></div>`);
		this.$customer_section = this.$component.find(".customer-section");
		this.make_customer_selector();
	}

	reset_customer_selector() {
		const frm = this.events.get_frm();
		frm.set_value("customer", "");
		this.make_customer_selector();
		this.customer_field.set_focus();
	}

	init_cart_components() {
		this.$component.append(
			`<div class="cart-container">
				<div class="abs-cart-container">
					<div class="cart-header">
						<div class="name-header">${__("Item")}</div>
						<div class="qty-header">${__("Quantity")}</div>
						<div class="rate-amount-header">${__("Amount")}</div>
					</div>
					<div class="cart-items-section"></div>
					<div class="cart-totals-section"></div>
					<div class="numpad-section"></div>
				</div>
			</div>`
		);
		this.$cart_container = this.$component.find(".cart-container");

		this.make_cart_totals_section();
		this.make_cart_items_section();
		this.make_cart_numpad();
	}

	make_cart_items_section() {
		this.$cart_header = this.$component.find(".cart-header");
		this.$cart_items_wrapper = this.$component.find(".cart-items-section");

		this.make_no_items_placeholder();
	}

	make_no_items_placeholder() {
		this.$cart_header.css("display", "none");
		this.$cart_items_wrapper.html(`<div class="no-item-wrapper">${__("No items in cart")}</div>`);
	}

	refresh_i18n_labels() {
		const $root = this.$component;
		if (!$root?.length) return;

		$root.find(".name-header").text(__("Item"));
		$root.find(".qty-header").text(__("Quantity"));
		$root.find(".rate-amount-header").text(__("Amount"));
		$root.find(".nozom-clear-cart-btn").text(__("Clear Cart"));
		$root.find(".nozom-save-draft-btn").text(__("Save Draft"));
		$root.find(".checkout-btn").each(function () {
			$(this).text(__("Checkout"));
		});
		$root.find(".no-item-wrapper").text(__("No items in cart"));

		if (this.$add_discount_elem?.length) {
			this.$add_discount_elem.html(`${this.get_discount_icon()} ${__("Add Discount")}`);
		}

		if (this.order_notes_field?.df) {
			this.order_notes_field.df.label = __("Order Notes");
			this.order_notes_field.df.placeholder = __("Order Notes");
			this.order_notes_field.refresh?.();
			this.order_notes_field.$input?.attr("placeholder", __("Order Notes"));
		}
		if (this.order_number_field?.df) {
			this.order_number_field.df.label = __("Order Number");
			this.order_number_field.df.placeholder = __("Order Number");
			this.order_number_field.refresh?.();
			this.order_number_field.$input?.attr("placeholder", __("Order Number"));
		}

		this.update_totals_section?.(this.events.get_frm?.());
	}

	get_discount_icon() {
		return `<svg class="discount-icon" width="24" height="24" viewBox="0 0 24 24" stroke="currentColor" fill="none" xmlns="http://www.w3.org/2000/svg">
				<path d="M19 15.6213C19 15.2235 19.158 14.842 19.4393 14.5607L20.9393 13.0607C21.5251 12.4749 21.5251 11.5251 20.9393 10.9393L19.4393 9.43934C19.158 9.15804 19 8.7765 19 8.37868V6.5C19 5.67157 18.3284 5 17.5 5H15.6213C15.2235 5 14.842 4.84196 14.5607 4.56066L13.0607 3.06066C12.4749 2.47487 11.5251 2.47487 10.9393 3.06066L9.43934 4.56066C9.15804 4.84196 8.7765 5 8.37868 5H6.5C5.67157 5 5 5.67157 5 6.5V8.37868C5 8.7765 4.84196 9.15804 4.56066 9.43934L3.06066 10.9393C2.47487 11.5251 2.47487 12.4749 3.06066 13.0607L4.56066 14.5607C4.84196 14.842 5 15.2235 5 15.6213V17.5C5 18.3284 5.67157 19 6.5 19H8.37868C8.7765 19 9.15804 19.158 9.43934 19.4393L10.9393 20.9393C11.5251 21.5251 12.4749 21.5251 13.0607 20.9393L14.5607 19.4393C14.842 19.158 15.2235 19 15.6213 19H17.5C18.3284 19 19 18.3284 19 17.5V15.6213Z" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/>
				<path d="M15 9L9 15" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/>
				<path d="M10.5 9.5C10.5 10.0523 10.0523 10.5 9.5 10.5C8.94772 10.5 8.5 10.0523 8.5 9.5C8.5 8.94772 8.94772 8.5 9.5 8.5C10.0523 8.5 10.5 8.94772 10.5 9.5Z" fill="white" stroke-linecap="round" stroke-linejoin="round"/>
				<path d="M15.5 14.5C15.5 15.0523 15.0523 15.5 14.5 15.5C13.9477 15.5 13.5 15.0523 13.5 14.5C13.5 13.9477 13.9477 13.5 14.5 13.5C15.0523 13.5 15.5 13.9477 15.5 14.5Z" fill="white" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>`;
	}

	make_cart_totals_section() {
		this.$totals_section = this.$component.find(".cart-totals-section");

		this.$totals_section.append(
			`<div class="order-note-wrapper">
				<div class="order-note-field"></div>
			</div>
			<div class="add-discount-wrapper">
				${this.get_discount_icon()} ${__("Add Discount")}
			</div>
			<div class="cart-footer-grid">
				<div class="cart-totals-card">
					<div class="item-qty-total-container">
						<div class="item-qty-total-label">${__("Total Quantity")}</div>
						<div class="item-qty-total-value">0</div>
					</div>
					<div class="net-total-container">
						<div class="net-total-label">${__("Net Total")}</div>
						<div class="net-total-value">0.00</div>
					</div>
					<div class="taxes-container"></div>
					<div class="grand-total-container">
						<div class="grand-total-label">${__("Grand Total")}</div>
						<div class="grand-total-value">0.00</div>
					</div>
				</div>
				<div class="cart-actions-card">
					<div class="order-number-field"></div>
					<div class="cart-action-buttons">
						<button type="button" class="btn btn-sm nozom-clear-cart-btn" disabled>${__(
							"Clear Cart"
						)}</button>
						<button type="button" class="btn btn-sm nozom-save-draft-btn" disabled>${__(
							"Save Draft"
						)}</button>
					</div>
				</div>
			</div>
			<div class="checkout-btn">${__("Checkout")}</div>
			<div class="edit-cart-btn">${__("Edit Cart")}</div>`
		);

		this.$add_discount_elem = this.$component.find(".add-discount-wrapper");
		this.$clear_cart_btn = this.$component.find(".nozom-clear-cart-btn");
		this.$save_draft_btn = this.$component.find(".nozom-save-draft-btn");
		this.make_order_note_control();
		this.make_order_number_control();
	}

	make_order_note_control() {
		const me = this;
		this.order_note_field = frappe.ui.form.make_control({
			df: {
				fieldtype: "Data",
				label: __("Order Notes"),
				fieldname: "order_notes",
				placeholder: __("Order Notes"),
				onchange: function () {
					const frm = me.events.get_frm();
					if (!frm || frm.doc.order_notes === this.value) return;
					frm.set_value("order_notes", this.value).then(() => {
						me.events.persist_local_cart?.();
					});
				},
			},
			parent: this.$totals_section.find(".order-note-field"),
			render_input: true,
		});
		this.order_note_field.toggle_label(false);
		this.$totals_section
			.find(".order-note-field input")
			.attr("placeholder", __("Order Notes"))
			.addClass("order-note-input");
	}

	set_order_note_value(value) {
		if (!this.order_note_field) return;
		this.order_note_field.set_value(value || "");
	}

	make_order_number_control() {
		const me = this;
		this.order_number_field = frappe.ui.form.make_control({
			df: {
				fieldtype: "Data",
				label: __("Order Number"),
				fieldname: "nozom_order_number",
				placeholder: __("Order Number"),
				onchange: function () {
					const frm = me.events.get_frm();
					if (!frm) return;
					const value = cstr(this.value || "").trim();
					if (cstr(frm.doc.nozom_order_number || "") === value) return;
					frm.doc.nozom_order_number = value;
					if (frm.set_value) {
						frm.set_value("nozom_order_number", value).then(() => {
							me.events.persist_local_cart?.();
						}).catch(() => {
							frm.doc.nozom_order_number = value;
							me.events.persist_local_cart?.();
						});
					} else {
						me.events.persist_local_cart?.();
					}
				},
			},
			parent: this.$totals_section.find(".order-number-field"),
			render_input: true,
		});
		this.order_number_field.toggle_label(true);
		this.$totals_section
			.find(".order-number-field input")
			.attr("placeholder", __("Order Number"))
			.addClass("order-number-input");
	}

	set_order_number_value(value) {
		if (!this.order_number_field) return;
		this.order_number_field.set_value(value || "");
	}

	make_cart_numpad() {
		this.$numpad_section = this.$component.find(".numpad-section");

		this.number_pad = new erpnext.PointOfSale.NumberPad({
			wrapper: this.$numpad_section,
			events: {
				numpad_event: this.on_numpad_event.bind(this),
			},
			cols: 5,
			keys: [
				[1, 2, 3, "Quantity"],
				[4, 5, 6, "Discount"],
				[7, 8, 9, "Rate"],
				[".", 0, "Delete", "Remove"],
			],
			css_classes: [
				["", "", "", "col-span-2"],
				["", "", "", "col-span-2"],
				["", "", "", "col-span-2"],
				["", "", "", "col-span-2 remove-btn"],
			],
			fieldnames_map: { Quantity: "qty", Discount: "discount_percentage" },
		});

		this.$numpad_section.prepend(
			`<div class="numpad-totals">
			<span class="numpad-item-qty-total"></span>
				<span class="numpad-net-total"></span>
				<span class="numpad-grand-total"></span>
			</div>`
		);

		this.$numpad_section.append(
			`<div class="numpad-btn checkout-btn" data-button-value="checkout">${__("Checkout")}</div>`
		);
	}

	bind_events() {
		const me = this;
		this.$customer_section.on("click", ".close-details-btn, .nozom-btn-hide-tx", function () {
			me.toggle_customer_info(false);
		});

		this.$customer_section.on("click", ".nozom-tx-row", function (e) {
			e.preventDefault();
			e.stopPropagation();
			const doctype = $(this).attr("data-doctype");
			const name = $(this).attr("data-name");
			const local_id = $(this).attr("data-local-id");
			if (me.events.open_customer_order) {
				me.events.open_customer_order(doctype, name, local_id || "");
			}
		});

		this.$cart_items_wrapper.on("click", ".cart-item-wrapper", function () {
			const $cart_item = $(this);

			me.toggle_item_highlight(this);

			const numpad_section_hidden = !me.$numpad_section.is(":visible");
			if (numpad_section_hidden) {
				const scrollTop = $cart_item.offset().top - me.$cart_items_wrapper.offset().top;
				me.$cart_items_wrapper.animate({ scrollTop });
			}

			const payment_section_hidden = !me.$totals_section.find(".edit-cart-btn").is(":visible");
			if (!payment_section_hidden) {
				// payment section is visible
				// edit cart first and then open item details section
				me.$totals_section.find(".edit-cart-btn").click();
			}

			const item_row_name = unescape($cart_item.attr("data-row-name"));
			me.events.cart_item_clicked({ name: item_row_name });
			this.numpad_value = "";
		});

		this.$component.on("click", ".checkout-btn", async function () {
			if (!$(this).hasClass("highlighted")) return;

			const opened = await me.events.checkout();
			if (opened === false) {
				me.toggle_checkout_btn(true);
				return;
			}

			me.toggle_checkout_btn(false);
			me.disable_customer_selection();

			me.allow_discount_change && me.$add_discount_elem.removeClass("d-none");
		});

		this.$component.on("click", ".nozom-clear-cart-btn", (e) => {
			e.preventDefault();
			e.stopPropagation();
			if ($(e.currentTarget).prop("disabled")) return;
			me.events.clear_cart?.();
		});

		this.$component.on("click", ".nozom-save-draft-btn", (e) => {
			e.preventDefault();
			e.stopPropagation();
			if ($(e.currentTarget).prop("disabled")) return;
			me.events.save_draft?.();
		});

		this.$totals_section.on("click", ".edit-cart-btn", () => {
			this.events.edit_cart();
			this.toggle_checkout_btn(true);
			me.enable_customer_selection();
		});

		this.$component.on("click", ".add-discount-wrapper", (e) => {
			// Ignore clicks on action buttons / inputs while editing
			if (
				$(e.target).closest(
					".discount-action-btn, .discount-type-btn, .add-discount-field, .frappe-control, input"
				).length
			) {
				return;
			}

			// Already editing
			if (this.$add_discount_elem.find(".discount-control-row").length) {
				return;
			}

			const can_edit_discount = this.$add_discount_elem.find(".edit-discount-btn").length;
			if (!this.discount_field || can_edit_discount) {
				this.show_discount_control();
			}
		});

		this.$component.on("click", ".edit-order-discount-btn", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.show_discount_control();
		});

		this.$component.on("click", ".remove-order-discount-btn", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.clear_order_discount();
		});

		frappe.ui.form.on("POS Invoice", "paid_amount", (frm) => {
			// called when discount is applied
			this.update_totals_section(frm);
		});

		frappe.ui.form.on("Sales Invoice", "paid_amount", (frm) => {
			// called when discount is applied
			this.update_totals_section(frm);
		});
	}

	attach_shortcuts() {
		for (let row of this.number_pad.keys) {
			for (let btn of row) {
				if (typeof btn !== "string") continue; // do not make shortcuts for numbers

				let shortcut_key = `ctrl+${frappe.scrub(String(btn))[0]}`;
				if (btn === "Delete") shortcut_key = "ctrl+backspace";
				if (btn === "Remove") shortcut_key = "shift+ctrl+backspace";
				if (btn === ".") shortcut_key = "ctrl+>";

				// to account for fieldname map
				const fieldname = this.number_pad.fieldnames[btn]
					? this.number_pad.fieldnames[btn]
					: typeof btn === "string"
						? frappe.scrub(btn)
						: btn;

				let shortcut_label = shortcut_key.split("+").map(frappe.utils.to_title_case).join("+");
				shortcut_label = frappe.utils.is_mac() ? shortcut_label.replace("Ctrl", "⌘") : shortcut_label;
				this.$numpad_section
					.find(`.numpad-btn[data-button-value="${fieldname}"]`)
					.attr("title", shortcut_label);

				frappe.ui.keys.on(`${shortcut_key}`, () => {
					const cart_is_visible = this.$component.is(":visible");
					if (cart_is_visible && this.item_is_selected && this.$numpad_section.is(":visible")) {
						this.$numpad_section.find(`.numpad-btn[data-button-value="${fieldname}"]`).click();
					}
				});
			}
		}
		const ctrl_label = frappe.utils.is_mac() ? "⌘" : "Ctrl";
		this.$component.find(".checkout-btn").attr("title", `${ctrl_label}+Enter`);
		frappe.ui.keys.add_shortcut({
			shortcut: "ctrl+enter",
			action: () => this.$component.find(".checkout-btn").click(),
			condition: () =>
				this.$component.is(":visible") && !this.$totals_section.find(".edit-cart-btn").is(":visible"),
			description: __("Checkout Order / Submit Order / New Order"),
			ignore_inputs: true,
			page: cur_page.page.page,
		});
		this.$component.find(".edit-cart-btn").attr("title", `${ctrl_label}+E`);
		frappe.ui.keys.on("ctrl+e", () => {
			const item_cart_visible = this.$component.is(":visible");
			const checkout_btn_invisible = !this.$totals_section.find(".checkout-btn").is("visible");
			if (item_cart_visible && checkout_btn_invisible) {
				this.$component.find(".edit-cart-btn").click();
			}
		});
		this.$component.find(".add-discount-wrapper").attr("title", `${ctrl_label}+D`);
		frappe.ui.keys.add_shortcut({
			shortcut: "ctrl+d",
			action: () => this.$component.find(".add-discount-wrapper").click(),
			condition: () => this.$add_discount_elem.is(":visible"),
			description: __("Add Order Discount"),
			ignore_inputs: true,
			page: cur_page.page.page,
		});
		frappe.ui.keys.on("escape", () => {
			const item_cart_visible = this.$component.is(":visible");
			if (item_cart_visible && this.$add_discount_elem.find(".discount-control-row").length) {
				this.hide_discount_control();
			}
		});
	}

	toggle_item_highlight(item) {
		const $cart_item = $(item);
		const item_is_highlighted = $cart_item.hasClass("active-item");

		if (!item || item_is_highlighted) {
			this.item_is_selected = false;
			this.$cart_container.find(".cart-item-wrapper").removeClass("active-item");
		} else {
			$cart_item.addClass("active-item");
			this.item_is_selected = true;
			this.$cart_container.find(".cart-item-wrapper").not(item).removeClass("active-item");
		}
	}

	make_customer_selector() {
		this.$customer_section.html(`
			<div class="customer-field"></div>
			<div class="nozom-customer-offline-actions">
				<button type="button" class="btn btn-xs btn-default nozom-new-customer-btn">${__(
					"New Customer"
				)}</button>
			</div>
		`);
		const me = this;
		const allowed_customer_group = this.allowed_customer_groups || [];
		let filters = {};
		if (allowed_customer_group.length) {
			filters = {
				customer_group: ["in", allowed_customer_group],
			};
		}
		this.customer_field = frappe.ui.form.make_control({
			df: {
				label: __("Customer"),
				fieldtype: "Link",
				options: "Customer",
				placeholder: __("Search by customer name, phone, email, TRN."),
				// Offline Link validate_link_and_fetch cannot reach the server;
				// selection is committed via apply_customer_selection from cache.
				ignore_link_validation: true,
				get_query: function () {
					return {
						filters: filters,
					};
				},
				onchange: function () {
					if (this.value) {
						me.apply_customer_selection(this.value);
					}
				},
			},
			parent: this.$customer_section.find(".customer-field"),
			render_input: true,
		});
		this.customer_field.toggle_label(false);
		this.wire_offline_customer_search();
		this.$customer_section
			.find(".nozom-new-customer-btn")
			.off("click")
			.on("click", () => this.open_new_customer_dialog());
	}

	wire_offline_customer_search() {
		const me = this;
		const field = this.customer_field;
		if (!field?.on_input) return;

		const sync_ignore_flag = () => {
			const online = !window.nozom_pos?.offline?.network || nozom_pos.offline.network.is_online();
			// Always ignore for local IDs; when offline ignore for all (no server validate).
			field.df.ignore_link_validation = true;
			field._validated = !online;
		};
		sync_ignore_flag();

		const original_on_input = field.on_input.bind(field);
		field.on_input = function (e) {
			sync_ignore_flag();
			const online = !window.nozom_pos?.offline?.network || nozom_pos.offline.network.is_online();
			if (online) {
				return original_on_input(e);
			}

			const term = e ? e.target.value : field.$input.val();
			const pos_profile = me.events.get_frm?.()?.doc?.pos_profile || me.pos_profile;
			Promise.resolve(
				nozom_pos.offline.catalog.search_customers({
					pos_profile,
					search_term: term,
					limit: 40,
				})
			).then((rows) => {
				const list = (rows || []).map((r) => {
					const normalized = nozom_pos.offline.customer_store?.normalize_customer
						? nozom_pos.offline.customer_store.normalize_customer(r, pos_profile)
						: r;
					return {
						value: normalized.name,
						label: normalized.customer_name || normalized.name,
						description: [normalized.mobile_no, normalized.tax_id, normalized.email_id]
							.filter(Boolean)
							.join(" · "),
					};
				});
				list.push({
					html:
						"<span class='link-option'><i class='fa fa-plus' style='margin-right: 5px;'></i> " +
						__("Create a new {0}", [__("Customer")]) +
						"</span>",
					label: __("Create a new {0}", [__("Customer")]),
					value: "create_new__link_option",
					action: () => me.open_new_customer_dialog(),
				});
				field.awesomplete.list = list;
			});
		};

		// Commit cached customer immediately offline (bypass broken Link validate).
		const original_validate = field.validate?.bind(field);
		field.validate = function (value) {
			const online = !window.nozom_pos?.offline?.network || nozom_pos.offline.network.is_online();
			if (!online || nozom_pos.offline.customer_store?.is_local_id?.(value)) {
				return value;
			}
			// Still skip server validate — POS commits via apply_customer_selection
			if (field.df.ignore_link_validation) return value;
			return original_validate ? original_validate(value) : value;
		};

		// Intercept create-new action when offline
		const original_new_doc = field.new_doc?.bind(field);
		if (original_new_doc) {
			field.new_doc = function () {
				const online = !window.nozom_pos?.offline?.network || nozom_pos.offline.network.is_online();
				if (!online) {
					me.open_new_customer_dialog();
					return false;
				}
				return original_new_doc();
			};
		}
	}

	normalize_customer_ref(customer) {
		if (!customer) return null;
		if (typeof customer === "string") return customer;
		return (
			customer.name ||
			customer.customer ||
			customer.server_customer_name ||
			customer.local_customer_id ||
			null
		);
	}

	async apply_customer_selection(customer) {
		const customer_id = this.normalize_customer_ref(customer);
		if (!customer_id) return;

		const frm = this.events.get_frm();
		const online = !window.nozom_pos?.offline?.network || nozom_pos.offline.network.is_online();
		const is_local = nozom_pos.offline.customer_store?.is_local_id?.(customer_id);

		frappe.dom.freeze();
		try {
			frm.doc.customer = customer_id;
			frm.doc.customer_name = customer_id;

			if (online && !is_local) {
				await frappe.model.set_value(frm.doc.doctype, frm.doc.name, "customer", customer_id);
				await frm.script_manager.trigger("customer", frm.doc.doctype, frm.doc.name);
			}

			await this.fetch_customer_details(customer_id);
			await this.load_default_address_for_customer(customer_id);
			this.events.customer_details_updated(this.customer_info);
			this.update_customer_section();
			this.update_totals_section();
			this.events.persist_local_cart?.();
		} finally {
			frappe.dom.unfreeze();
		}
	}

	get_customer_form_fields(seed = {}) {
		return [
			{
				fieldname: "customer_name",
				label: __("Customer Name"),
				fieldtype: "Data",
				reqd: 1,
				default: seed.customer_name || "",
			},
			{
				fieldname: "mobile_no",
				label: __("Mobile"),
				fieldtype: "Data",
				default: seed.mobile_no || "",
			},
			{
				fieldname: "email_id",
				label: __("Email"),
				fieldtype: "Data",
				options: "Email",
				default: seed.email_id || "",
			},
			{
				fieldname: "tax_id",
				label: __("TRN / Tax ID"),
				fieldtype: "Data",
				default: seed.tax_id || "",
			},
			{ fieldname: "address_section", label: __("Address"), fieldtype: "Section Break" },
			{
				fieldname: "address_title",
				label: __("Address Title"),
				fieldtype: "Data",
				default: seed.address_title || "",
				description: __("e.g. Home, Office, Villa"),
			},
			{
				fieldname: "address_line1",
				label: __("Address Line 1"),
				fieldtype: "Data",
				default: seed.address_line1 || "",
			},
			{
				fieldname: "address_line2",
				label: __("Address Line 2"),
				fieldtype: "Data",
				default: seed.address_line2 || "",
			},
			{
				fieldname: "city",
				label: __("City"),
				fieldtype: "Data",
				default: seed.city || "",
			},
			{
				fieldname: "state",
				label: __("State / Emirate"),
				fieldtype: "Data",
				default: seed.state || "",
			},
			{
				fieldname: "pincode",
				label: __("Postal Code"),
				fieldtype: "Data",
				default: seed.pincode || "",
			},
			{
				fieldname: "country",
				label: __("Country"),
				fieldtype: "Link",
				options: "Country",
				default: seed.country || "",
			},
			{
				fieldname: "address_phone",
				label: __("Address Phone"),
				fieldtype: "Data",
				default: seed.address_phone || seed.phone || "",
			},
			{
				fieldname: "nozom_delivery_location_link",
				label: __("Delivery Location Link"),
				fieldtype: "Data",
				options: "URL",
				default: seed.nozom_delivery_location_link || "",
				description: __("Optional map URL (http/https only)."),
			},
		];
	}

	icon_action_btn({ action, icon, label, color, disabled = false }) {
		const icon_html = frappe.utils.icon(icon, "sm");
		return `<button type="button"
			class="nozom-icon-btn nozom-icon-btn--${frappe.utils.escape_html(color)} nozom-btn-${frappe.utils.escape_html(
			action
		)}"
			title="${frappe.utils.escape_html(label)}"
			aria-label="${frappe.utils.escape_html(label)}"
			data-tooltip="${frappe.utils.escape_html(label)}"
			${disabled ? "disabled" : ""}>
			${icon_html}
		</button>`;
	}

	async build_customer_form_seed(existing = {}) {
		const seed = {
			name: existing.name || existing.customer || "",
			customer_name: existing.customer_name || "",
			mobile_no: existing.mobile_no || "",
			email_id: existing.email_id || "",
			tax_id: existing.tax_id || "",
		};
		const pos_profile = this.events.get_frm?.()?.doc?.pos_profile;
		const addr_name =
			existing._selected_address ||
			this.selected_address_name ||
			this.customer_info?._selected_address ||
			null;
		if (addr_name && nozom_pos.offline.address_store) {
			const addr = await nozom_pos.offline.address_store.get(pos_profile, addr_name);
			if (addr) {
				seed.address_name = addr.name;
				seed.address_title = addr.address_title || "";
				seed.address_line1 = addr.address_line1 || "";
				seed.address_line2 = addr.address_line2 || "";
				seed.city = addr.city || "";
				seed.state = addr.state || "";
				seed.pincode = addr.pincode || "";
				seed.country = addr.country || "";
				seed.address_phone = addr.phone || "";
				seed.nozom_delivery_location_link = addr.nozom_delivery_location_link || "";
			}
		} else if (existing.address_line1 || existing.selected_address_display) {
			seed.address_title = existing.selected_address_title || existing.address_title || "";
			seed.address_line1 = existing.address_line1 || "";
			seed.city = existing.city || "";
			seed.country = existing.country || "";
			seed.nozom_delivery_location_link = existing.selected_location_link || "";
		}
		return seed;
	}

	async save_customer_and_address(values, seed = {}) {
		const pos_profile = this.events.get_frm?.()?.doc?.pos_profile;
		const store = nozom_pos.offline.address_store;
		const online = !window.nozom_pos?.offline?.network || nozom_pos.offline.network.is_online();
		const is_edit = Boolean(seed.name);
		const customer_fields = {
			customer_name: values.customer_name,
			mobile_no: values.mobile_no,
			email_id: values.email_id,
			tax_id: values.tax_id,
		};
		const has_address_input = Boolean(cstr(values.address_line1 || "").trim());
		const address_payload = {
			address_title: values.address_title || __("Address"),
			address_line1: values.address_line1,
			address_line2: values.address_line2,
			city: values.city,
			state: values.state,
			pincode: values.pincode,
			country: values.country,
			phone: values.address_phone || values.mobile_no,
			nozom_delivery_location_link: values.nozom_delivery_location_link,
			is_shipping_address: 1,
		};

		let customer_name = seed.name;

		if (!online) {
			if (is_edit) {
				await nozom_pos.offline.customer_store.update_local(pos_profile, seed.name, customer_fields);
				customer_name = seed.name;
			} else {
				const record = await nozom_pos.offline.customer_store.create_local(pos_profile, customer_fields);
				customer_name = record.name;
			}

			let addr = null;
			if (has_address_input) {
				if (seed.address_name) {
					// Update existing address — never create a duplicate on edit
					addr = await store.update_local(pos_profile, seed.address_name, address_payload);
				} else {
					addr = await store.create_local(pos_profile, customer_name, address_payload);
				}
			}
			await this.apply_customer_selection(customer_name);
			if (addr) await this.select_address(addr, { persist: true });
			return customer_name;
		}

		if (is_edit) {
			await frappe.db.set_value("Customer", seed.name, customer_fields);
			customer_name = seed.name;
		} else {
			const doc = await frappe.db.insert({
				doctype: "Customer",
				customer_type: "Individual",
				...customer_fields,
			});
			customer_name = doc.name;
		}

		await nozom_pos.offline.catalog?.cache_customers?.(pos_profile, [
			{ name: customer_name, ...customer_fields },
		]);

		if (has_address_input) {
			const location = store.sanitize_location(address_payload.nozom_delivery_location_link);
			if (cstr(address_payload.nozom_delivery_location_link || "").trim() && !location) {
				throw new Error(__("Delivery Location Link must be an http:// or https:// URL."));
			}
			const country =
				cstr(address_payload.country || "").trim() ||
				(await this.resolve_default_address_country()) ||
				"United Arab Emirates";
			const city =
				cstr(address_payload.city || "").trim() ||
				cstr(address_payload.address_line1 || "").trim() ||
				"N/A";

			let addr_name = null;
			if (seed.address_name && store.is_local_id(seed.address_name)) {
				const local = await store.update_local(pos_profile, seed.address_name, {
					...address_payload,
					country,
					city,
					nozom_delivery_location_link: location,
				});
				await this.apply_customer_selection(customer_name);
				await this.select_address(local, { persist: true });
				return customer_name;
			}

			if (seed.address_name) {
				// Update existing Address — never insert a duplicate on customer edit
				const doc = await frappe.db.get_doc("Address", seed.address_name);
				Object.assign(doc, {
					address_title: address_payload.address_title,
					address_line1: address_payload.address_line1,
					address_line2: address_payload.address_line2 || "",
					city,
					state: address_payload.state || "",
					pincode: address_payload.pincode || "",
					country,
					phone: address_payload.phone || "",
					nozom_delivery_location_link: location,
				});
				await frappe.call({ method: "frappe.client.save", args: { doc } });
				addr_name = seed.address_name;
			} else {
				const addr_doc = await frappe.db.insert({
					doctype: "Address",
					address_title: address_payload.address_title,
					address_type: "Shipping",
					address_line1: address_payload.address_line1,
					address_line2: address_payload.address_line2 || "",
					city,
					state: address_payload.state || "",
					pincode: address_payload.pincode || "",
					country,
					phone: address_payload.phone || "",
					nozom_delivery_location_link: location,
					is_shipping_address: 1,
					links: [{ link_doctype: "Customer", link_name: customer_name }],
				});
				addr_name = addr_doc.name;
			}

			const fetched = await frappe.db.get_doc("Address", addr_name);
			const record = await store.upsert(pos_profile, {
				...fetched,
				customer: customer_name,
				server_customer_name: customer_name,
				server_address_name: addr_name,
				server_modified: fetched.modified,
			});
			await this.apply_customer_selection(customer_name);
			await this.select_address(record, { persist: true });
			return customer_name;
		}

		await this.apply_customer_selection(customer_name);
		return customer_name;
	}

	async open_new_customer_dialog(seed_in = {}) {
		const me = this;
		const seed = await this.build_customer_form_seed(seed_in);
		const is_edit = Boolean(seed.name);
		const d = new frappe.ui.Dialog({
			title: is_edit ? __("Edit Customer") : __("New Customer"),
			fields: this.get_customer_form_fields(seed),
			primary_action_label: __("Save"),
			primary_action: async (values) => {
				const online = !window.nozom_pos?.offline?.network || nozom_pos.offline.network.is_online();
				try {
					await me.save_customer_and_address(values, seed);
					d.hide();
					frappe.show_alert({
						message: online
							? is_edit
								? __("Customer updated.")
								: __("Customer created.")
							: __("Customer saved locally. Will sync when online."),
						indicator: online ? "green" : "orange",
					});
				} catch (e) {
					frappe.msgprint(e.message || __("Could not save customer."));
				}
			},
		});
		d.$wrapper.addClass("nozom-pos-centered-dialog nozom-customer-dialog");
		nozom_pos.i18n?.apply_direction?.(nozom_pos.i18n.get());
		d.show();
	}

	async resolve_default_address_country() {
		const frm = this.events.get_frm?.();
		const company = frm?.doc?.company;
		if (!company) return frappe.boot?.sysdefaults?.country || "";
		try {
			const r = await frappe.db.get_value("Company", company, "country");
			return r?.message?.country || frappe.boot?.sysdefaults?.country || "";
		} catch (e) {
			return frappe.boot?.sysdefaults?.country || "";
		}
	}

	apply_address_snapshot_to_doc(snapshot = {}) {
		const frm = this.events.get_frm?.();
		if (!frm?.doc) return;
		const doc = frm.doc;
		const fields = [
			"customer_address",
			"address_display",
			"shipping_address_name",
			"shipping_address",
			"contact_mobile",
			"nozom_address_title_snapshot",
			"nozom_customer_phone_snapshot",
			"nozom_delivery_location_link_snapshot",
		];
		fields.forEach((f) => {
			if (snapshot[f] !== undefined) {
				doc[f] = snapshot[f] || "";
			}
		});
		doc._nozom_selected_address = snapshot._selected_address || null;
		doc._local_address_id = snapshot._local_address_id || null;
		this.selected_address_name = snapshot._selected_address || null;
		this.customer_info = {
			...(this.customer_info || {}),
			_selected_address: snapshot._selected_address || null,
			_local_address_id: snapshot._local_address_id || null,
			selected_address_title: snapshot.nozom_address_title_snapshot || "",
			selected_address_display: snapshot.address_display || "",
			selected_address_phone: snapshot.nozom_customer_phone_snapshot || "",
			selected_location_link: snapshot.nozom_delivery_location_link_snapshot || "",
		};
	}

	async select_address(addr, { persist = true } = {}) {
		const snapshot = nozom_pos.offline.address_store.snapshot_from_address(addr, this.customer_info);
		this.apply_address_snapshot_to_doc(snapshot);
		this.update_customer_section();
		if (persist) this.events.persist_local_cart?.();
	}

	async load_default_address_for_customer(customer, preferred = null) {
		const pos_profile = this.events.get_frm?.()?.doc?.pos_profile;
		const store = nozom_pos.offline.address_store;
		if (!store || !customer) {
			this.apply_address_snapshot_to_doc(
				store?.snapshot_from_address?.(null, this.customer_info) || {}
			);
			return null;
		}

		const preferred_name =
			preferred ||
			this.events.get_frm?.()?.doc?._nozom_selected_address ||
			this.events.get_frm?.()?.doc?.shipping_address_name ||
			this.events.get_frm?.()?.doc?.customer_address ||
			null;

		let addr = await store.pick_default(pos_profile, customer, preferred_name);
		if (!addr && (!window.nozom_pos?.offline?.network || nozom_pos.offline.network.is_online())) {
			await this.refresh_customer_addresses(customer);
			addr = await store.pick_default(pos_profile, customer, preferred_name);
		}
		await this.select_address(addr, { persist: false });
		return addr;
	}

	async refresh_customer_addresses(customer) {
		const pos_profile = this.events.get_frm?.()?.doc?.pos_profile;
		const online = !window.nozom_pos?.offline?.network || nozom_pos.offline.network.is_online();
		if (!online || !customer || nozom_pos.offline.customer_store?.is_local_id?.(customer)) {
			return;
		}
		try {
			const r = await frappe.call({
				method: "nozom_pos.api.address.get_customer_addresses",
				args: { customer },
				freeze: false,
			});
			await nozom_pos.offline.address_store.cache_many(pos_profile, customer, r.message || []);
		} catch (e) {
			console.warn("NOZOM POS address refresh failed", e);
		}
	}

	fetch_customer_details(customer) {
		if (!customer) {
			return new Promise((resolve) => {
				this.customer_info = {};
				resolve();
			});
		}

		const online = !window.nozom_pos?.offline?.network || nozom_pos.offline.network.is_online();
		const pos_profile = this.events.get_frm?.()?.doc?.pos_profile;

		if (!online) {
			return Promise.resolve(
				nozom_pos.offline.customer_store?.get?.(pos_profile, customer) ||
					nozom_pos.offline.catalog?.get_customer?.(pos_profile, customer)
			).then((cached) => {
				this.customer_info = {
					customer,
					customer_name: cached?.customer_name || customer,
					email_id: cached?.email_id || "",
					mobile_no: cached?.mobile_no || "",
					tax_id: cached?.tax_id || "",
					image: cached?.image || "",
					address_line1: cached?.address_line1 || "",
					address_line2: cached?.address_line2 || "",
					city: cached?.city || "",
					state: cached?.state || "",
					pincode: cached?.pincode || "",
					country: cached?.country || "",
					primary_address:
						cached?.primary_address ||
						cached?.address_line1 ||
						cached?.address ||
						"",
					server_address_name: cached?.server_address_name || null,
					local_address_id: cached?.local_address_id || null,
					loyalty_program: "",
					loyalty_points: "",
					_from_cache: true,
				};
				const frm = this.events.get_frm();
				if (frm?.doc) {
					frm.doc.customer = customer;
					frm.doc.customer_name = this.customer_info.customer_name;
					if (this.customer_info.tax_id) frm.doc.tax_id = this.customer_info.tax_id;
				}
			});
		}

		return new Promise((resolve) => {
			frappe.db
				.get_value("Customer", customer, [
					"email_id",
					"customer_name",
					"mobile_no",
					"tax_id",
					"image",
					"loyalty_program",
					"customer_primary_address",
					"primary_address",
				])
				.then(async ({ message }) => {
					const { loyalty_program } = message || {};
					let address_fields = {
						primary_address: message?.primary_address || "",
						server_address_name: message?.customer_primary_address || null,
					};
					if (message?.customer_primary_address) {
						try {
							const addr = await frappe.db.get_value(
								"Address",
								message.customer_primary_address,
								[
									"address_line1",
									"address_line2",
									"city",
									"state",
									"pincode",
									"country",
								]
							);
							if (addr?.message) {
								address_fields = {
									...address_fields,
									address_line1: addr.message.address_line1 || "",
									address_line2: addr.message.address_line2 || "",
									city: addr.message.city || "",
									state: addr.message.state || "",
									pincode: addr.message.pincode || "",
									country: addr.message.country || "",
								};
							}
						} catch (e) {
							/* keep primary_address text */
						}
					}

					const finish = (extra = {}) => {
						this.customer_info = {
							...(message || {}),
							customer,
							...address_fields,
							...extra,
						};
						nozom_pos.offline.customer_store?.upsert_cached?.(pos_profile, {
							name: customer,
							...this.customer_info,
						});
						resolve();
					};

					if (loyalty_program) {
						frappe.call({
							method: "erpnext.accounts.doctype.loyalty_program.loyalty_program.get_loyalty_program_details_with_points",
							args: { customer, loyalty_program, silent: true },
							callback: (r) => {
								const { loyalty_points, conversion_factor } = r.message || {};
								finish({ loyalty_points, conversion_factor });
							},
						});
					} else {
						finish();
					}
				})
				.catch(async () => {
					const cached = await nozom_pos.offline.catalog?.get_customer?.(pos_profile, customer);
					this.customer_info = {
						customer,
						customer_name: cached?.customer_name || customer,
						email_id: cached?.email_id || "",
						mobile_no: cached?.mobile_no || "",
						tax_id: cached?.tax_id || "",
						image: cached?.image || "",
						address_line1: cached?.address_line1 || "",
						primary_address: cached?.primary_address || cached?.address_line1 || "",
					};
					resolve();
				});
		});
	}

	show_discount_control() {
		this.$add_discount_elem.addClass("is-editing").css({
			padding: "var(--padding-sm) var(--padding-md)",
			border: "1.5px solid #1f272e",
		});
		this.$add_discount_elem.html(
			`<div class="discount-control-row">
				<div class="discount-type-toggle">
					<button type="button" class="discount-type-btn" data-discount-type="percentage">%</button>
					<button type="button" class="discount-type-btn" data-discount-type="amount">${__(
						"Amount"
					)}</button>
				</div>
				<div class="add-discount-field"></div>
				<button type="button" class="discount-action-btn remove-order-discount-btn" title="${__(
					"Remove"
				)}">${__("Remove")}</button>
			</div>`
		);

		const me = this;
		const frm = me.events.get_frm();
		const has_percentage = flt(frm.doc.additional_discount_percentage);
		const has_amount = flt(frm.doc.discount_amount);
		this.order_discount_type =
			has_amount && !has_percentage ? "amount" : "percentage";

		this.$add_discount_elem
			.find(`.discount-type-btn[data-discount-type="${this.order_discount_type}"]`)
			.addClass("active");

		this.$add_discount_elem.find(".discount-type-btn").on("click", function (e) {
			e.preventDefault();
			e.stopPropagation();
			me.order_discount_type = $(this).attr("data-discount-type");
			me.$add_discount_elem.find(".discount-type-btn").removeClass("active");
			$(this).addClass("active");
			me.refresh_order_discount_field();
			me.discount_field && me.discount_field.set_focus();
			me.schedule_discount_apply();
		});

		this.refresh_order_discount_field();
		this.discount_field && this.discount_field.set_focus();
	}

	refresh_order_discount_field() {
		const me = this;
		const frm = me.events.get_frm();
		const is_amount = this.order_discount_type === "amount";
		const current_value = is_amount
			? flt(frm.doc.discount_amount)
			: flt(frm.doc.additional_discount_percentage);

		this.$add_discount_elem.find(".add-discount-field").empty();
		this.discount_field = frappe.ui.form.make_control({
			df: {
				fieldtype: "Data",
				label: is_amount ? __("Discount Amount") : __("Discount Percentage"),
				fieldname: "pos_order_discount",
				placeholder: is_amount
					? __("Enter discount amount.")
					: __("Enter discount percentage."),
				input_class: "input-xs",
			},
			parent: this.$add_discount_elem.find(".add-discount-field"),
			render_input: true,
		});
		this.discount_field.toggle_label(false);

		if (current_value) {
			this.discount_field.$input.val(current_value);
		}

		this.discount_field.$input
			.off("keydown.pos-discount input.pos-discount blur.pos-discount")
			.on("keydown.pos-discount", (e) => {
				if (e.key === "Escape" || e.which === 27) {
					e.preventDefault();
					e.stopPropagation();
					me.hide_discount_control();
				} else if (e.key === "Enter" || e.which === 13) {
					e.preventDefault();
					e.stopPropagation();
					me.apply_order_discount(flt(me.discount_field.$input.val()), { keep_open: true });
				}
			})
			.on("input.pos-discount", () => {
				me.schedule_discount_apply();
			})
			.on("blur.pos-discount", () => {
				me.apply_order_discount(flt(me.discount_field.$input.val()), { keep_open: true });
			});
	}

	schedule_discount_apply() {
		clearTimeout(this._discount_apply_timer);
		this._discount_apply_timer = setTimeout(() => {
			if (!this.discount_field?.$input) return;
			this.apply_order_discount(flt(this.discount_field.$input.val()), { keep_open: true });
		}, 400);
	}

	async apply_order_discount(value, opts = {}) {
		const frm = this.events.get_frm();
		value = flt(value);
		const keep_open = Boolean(opts.keep_open);
		const applied_key = `${this.order_discount_type}:${value}`;
		if (this._last_applied_discount === applied_key && keep_open) {
			return;
		}

		const offline = window.nozom_pos?.offline?.network && !nozom_pos.offline.network.is_online();

		if (this.order_discount_type === "percentage") {
			if (value > 100) {
				frappe.msgprint({
					title: __("Invalid Discount"),
					indicator: "red",
					message: __("Discount cannot be greater than 100%."),
				});
				return;
			}
			if (offline) {
				frm.doc.additional_discount_percentage = value;
				frm.doc.discount_amount = 0;
				nozom_pos.offline.totals?.recalculate?.(frm);
			} else {
				await frappe.model.set_value(
					frm.doc.doctype,
					frm.doc.name,
					"additional_discount_percentage",
					value
				);
			}
		} else {
			const net_total = flt(frm.doc.net_total);
			if (net_total > 0 && value > net_total) {
				frappe.msgprint({
					title: __("Invalid Discount"),
					indicator: "red",
					message: __("Discount amount cannot be greater than net total."),
				});
				return;
			}
			frm.doc.additional_discount_percentage = 0;
			if (offline) {
				frm.doc.discount_amount = value;
				nozom_pos.offline.totals?.recalculate?.(frm);
			} else {
				await frappe.model.set_value(frm.doc.doctype, frm.doc.name, "discount_amount", value);
			}
		}

		this._last_applied_discount = applied_key;
		this.$add_discount_elem.addClass("is-editing").css({
			border: "1.5px solid #1f272e",
			padding: "var(--padding-sm) var(--padding-md)",
		});
		this.update_totals_section(frm);
		this.events.persist_local_cart?.();
		if (!keep_open) {
			this.hide_discount_control();
		}
	}

	hide_discount_control() {
		clearTimeout(this._discount_apply_timer);
		this._last_applied_discount = null;
		const frm = this.events.get_frm();
		const percentage = flt(frm?.doc?.additional_discount_percentage);
		const amount = flt(frm?.doc?.discount_amount);
		const has_percentage = percentage > 0;
		const has_amount = amount > 0 && !has_percentage;

		if (!has_percentage && !has_amount) {
			this.$add_discount_elem.removeClass("is-editing").css({
				border: "1.5px solid #1f272e",
				padding: "var(--padding-sm) var(--padding-md)",
			});
			this.$add_discount_elem.html(`${this.get_discount_icon()} ${__("Add Discount")}`);
			this.discount_field = undefined;
		} else {
			const currency = frm.doc.currency;
			const label = has_percentage
				? `${__("Additional")}&nbsp;${String(percentage).bold()}% ${__("discount applied")}`
				: `${__("Additional")}&nbsp;${format_currency(amount, currency).bold()} ${__(
						"discount applied"
				  )}`;

			this.$add_discount_elem.removeClass("is-editing").css({
				border: "1.5px solid #1f272e",
				padding: "var(--padding-sm) var(--padding-md)",
			});
			this.$add_discount_elem.html(
				`<div class="applied-discount-row">
					<div class="edit-discount-btn">
						${this.get_discount_icon()} ${label}
					</div>
					<div class="discount-actions">
						<button type="button" class="discount-action-btn edit-order-discount-btn">${__("Edit")}</button>
						<button type="button" class="discount-action-btn remove-order-discount-btn">${__("Remove")}</button>
					</div>
				</div>`
			);
			this.discount_field = undefined;
		}
	}

	async clear_order_discount() {
		const frm = this.events.get_frm();
		if (!frm) return;

		frm.doc.additional_discount_percentage = 0;
		frm.doc.discount_amount = 0;
		const offline = window.nozom_pos?.offline?.network && !nozom_pos.offline.network.is_online();
		if (offline) {
			nozom_pos.offline.totals?.recalculate?.(frm);
		} else {
			await frappe.model.set_value(frm.doc.doctype, frm.doc.name, "additional_discount_percentage", 0);
			await frappe.model.set_value(frm.doc.doctype, frm.doc.name, "discount_amount", 0);
		}
		this.hide_discount_control();
		this.update_totals_section(frm);
		this.events.persist_local_cart?.();
	}

	update_customer_section() {
		const me = this;
		const info = this.customer_info || {};
		const { customer, customer_name, image } = info;
		const phone =
			info.selected_address_phone ||
			info.mobile_no ||
			info.nozom_customer_phone_snapshot ||
			"";
		const addr_title = info.selected_address_title || "";
		const addr_display_raw = info.selected_address_display || "";
		const addr_display = nozom_pos.address_format?.plain_text?.(addr_display_raw, " · ") || "";
		const has_location = Boolean(info.selected_location_link);
		const addr_line = addr_title
			? addr_display
				? `${addr_title} — ${addr_display}`
				: addr_title
			: addr_display || __("No delivery address");

		if (customer) {
			const has_addr = Boolean(info._selected_address || this.selected_address_name);
			this.$customer_section.html(
				`<div class="customer-details nozom-customer-header">
					<div class="nozom-customer-header-row">
						<div class="customer-display nozom-customer-display">
							${this.get_customer_image()}
							<div class="customer-name-desc">
								<div class="customer-name">${frappe.utils.escape_html(customer_name || customer)}</div>
								${
									phone
										? `<div class="customer-desc nozom-customer-phone" dir="ltr">${frappe.utils.escape_html(
												phone
										  )}</div>`
										: ""
								}
							</div>
						</div>
						<div class="nozom-customer-actions" role="toolbar" aria-label="${frappe.utils.escape_html(
							__("Customer Actions")
						)}">
							${this.icon_action_btn({
								action: "change-customer",
								icon: "users",
								label: __("Change Customer"),
								color: "blue",
							})}
							${this.icon_action_btn({
								action: "edit-customer",
								icon: "edit",
								label: __("Edit Customer"),
								color: "orange",
							})}
							${this.icon_action_btn({
								action: "recent-tx",
								icon: "history",
								label: __("Recent Orders"),
								color: "purple",
							})}
							${this.icon_action_btn({
								action: "change-address",
								icon: "map-pin",
								label: __("Change Address"),
								color: "green",
							})}
							${this.icon_action_btn({
								action: "edit-address",
								icon: "map-pin-plus",
								label: __("Edit Address"),
								color: "amber",
								disabled: !has_addr,
							})}
						</div>
					</div>
					<div class="customer-desc nozom-customer-address nozom-customer-address-row">
						${has_location ? "📍 " : ""}${frappe.utils.escape_html(addr_line)}
					</div>
				</div>`
			);
			this.bind_customer_header_actions();
		} else {
			this.reset_customer_selector();
		}
	}

	bind_customer_header_actions() {
		const me = this;
		const $root = this.$customer_section;
		$root.find(".nozom-btn-change-customer").on("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			me.reset_customer_selector();
		});
		$root.find(".nozom-btn-edit-customer").on("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			me.open_new_customer_dialog({
				name: me.customer_info.customer,
				customer_name: me.customer_info.customer_name,
				mobile_no: me.customer_info.mobile_no,
				email_id: me.customer_info.email_id,
				tax_id: me.customer_info.tax_id,
				_selected_address: me.selected_address_name || me.customer_info._selected_address,
			});
		});
		$root.find(".nozom-btn-recent-tx").on("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			me.toggle_customer_info(true);
		});
		$root.find(".nozom-btn-change-address").on("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			nozom_pos.address_ui.open_change(me, {
				on_selected: async (addr) => me.select_address(addr),
			});
		});
		$root.find(".nozom-btn-edit-address").on("click", async (e) => {
			e.preventDefault();
			e.stopPropagation();
			const name = me.selected_address_name || me.customer_info._selected_address;
			if (!name) return;
			const pos_profile = me.events.get_frm?.()?.doc?.pos_profile;
			const addr = await nozom_pos.offline.address_store.get(pos_profile, name);
			nozom_pos.address_ui.open_add_edit(me, {
				mode: "edit",
				seed: addr || {},
				on_saved: async (updated) => me.select_address(updated),
			});
		});
	}

	get_customer_image() {
		const { customer, image } = this.customer_info || {};
		if (image) {
			return `<div class="customer-image"><img src="${image}" alt="${image}""></div>`;
		} else {
			return `<div class="customer-image customer-abbr">${frappe.get_abbr(customer)}</div>`;
		}
	}

	update_totals_section(frm) {
		if (!frm) frm = this.events.get_frm();

		this.render_net_total(frm.doc.net_total);
		this.render_total_item_qty(frm.doc.items);
		this.render_grand_total(erpnext.PointOfSale.get_invoice_total(frm.doc));

		this.render_taxes(frm.doc.taxes);
	}

	render_net_total(value) {
		const currency = this.events.get_frm().doc.currency;
		this.$totals_section.find(".net-total-container").html(
			`<div class="net-total-label">${__("Net Total")}</div>
			<div class="net-total-value">${format_currency(value, currency)}</div>`
		);

		this.$numpad_section
			.find(".numpad-net-total")
			.html(`<div>${__("Net Total")}: <span>${format_currency(value, currency)}</span></div>`);
	}

	render_total_item_qty(items) {
		var total_item_qty = 0;
		(items || []).map((item) => {
			total_item_qty = total_item_qty + item.qty;
		});

		this.$totals_section.find(".item-qty-total-container").html(
			`<div class="item-qty-total-label">${__("Total Quantity")}</div>
			<div class="item-qty-total-value">${total_item_qty}</div>`
		);

		this.$numpad_section
			.find(".numpad-item-qty-total")
			.html(`<div>${__("Total Quantity")}: <span>${total_item_qty}</span></div>`);
	}

	render_grand_total(value) {
		const currency = this.events.get_frm().doc.currency;
		this.$totals_section.find(".grand-total-container").html(
			`<div class="grand-total-label">${__("Grand Total")}</div>
			<div class="grand-total-value">${format_currency(value, currency)}</div>`
		);

		this.$numpad_section
			.find(".numpad-grand-total")
			.html(`<div>${__("Grand Total")}: <span>${format_currency(value, currency)}</span></div>`);
	}

	update_cart_action_buttons({ has_items = false, online = true, draft_enabled = false } = {}) {
		if (this.$clear_cart_btn?.length) {
			this.$clear_cart_btn.prop("disabled", !has_items);
		}
		if (this.$save_draft_btn?.length) {
			this.$save_draft_btn.prop("disabled", !draft_enabled);
			this.$save_draft_btn.attr(
				"title",
				!has_items
					? __("Add items to save a draft.")
					: online
					? __("Save current cart as Draft")
					: __("Save Local Draft (offline)")
			);
		}
	}

	render_taxes(taxes) {
		if (taxes && taxes.length) {
			const currency = this.events.get_frm().doc.currency;
			const taxes_html = taxes
				.map((t) => {
					if (t.tax_amount_after_discount_amount == 0.0) return;
					return `<div class="tax-row">
					<div class="tax-label">${t.description}</div>
					<div class="tax-value">${format_currency(t.tax_amount_after_discount_amount, currency)}</div>
				</div>`;
				})
				.join("");
			this.$totals_section.find(".taxes-container").css("display", "flex").html(taxes_html);
		} else {
			this.$totals_section.find(".taxes-container").css("display", "none").html("");
		}
	}

	get_cart_item({ name }) {
		const item_selector = `.cart-item-wrapper[data-row-name="${escape(name)}"]`;
		return this.$cart_items_wrapper.find(item_selector);
	}

	get_item_from_frm(item) {
		const doc = this.events.get_frm().doc;
		return doc.items.find((i) => i.name == item.name);
	}

	update_item_html(item, remove_item) {
		const $item = this.get_cart_item(item);

		if (remove_item) {
			$item && $item.next().remove() && $item.remove();
		} else {
			const item_row = this.get_item_from_frm(item);
			this.render_cart_item(item_row, $item);
		}

		const no_of_cart_items = this.$cart_items_wrapper.find(".cart-item-wrapper").length;
		this.highlight_checkout_btn(no_of_cart_items > 0);

		this.update_empty_cart_section(no_of_cart_items);
	}

	render_cart_item(item_data, $item_to_update) {
		if (!item_data) return;
		const currency = this.events.get_frm().doc.currency;
		const me = this;

		if (!$item_to_update.length) {
			this.$cart_items_wrapper.append(
				`<div class="cart-item-wrapper" data-row-name="${escape(item_data.name)}"></div>
				<div class="seperator"></div>`
			);
			$item_to_update = this.get_cart_item(item_data);
		}

		$item_to_update.html(
			`${get_item_image_html()}
			<div class="item-name-desc">
				<div class="item-name">
					${item_data.item_name}
				</div>
				${get_description_html()}
				${get_notes_html()}
			</div>
			${get_rate_discount_html()}`
		);

		set_dynamic_rate_header_width();

		function set_dynamic_rate_header_width() {
			const rate_cols = Array.from(me.$cart_items_wrapper.find(".item-rate-amount"));
			me.$cart_header.find(".rate-amount-header").css("width", "");
			me.$cart_items_wrapper.find(".item-rate-amount").css("width", "");
			let max_width = rate_cols.reduce((max_width, elm) => {
				if ($(elm).width() > max_width) max_width = $(elm).width();
				return max_width;
			}, 0);

			max_width += 1;
			if (max_width == 1) max_width = "";

			me.$cart_header.find(".rate-amount-header").css("width", max_width);
			me.$cart_items_wrapper.find(".item-rate-amount").css("width", max_width);
		}

		function get_rate_discount_html() {
			if (item_data.rate && item_data.amount && item_data.rate !== item_data.amount) {
				return `
					<div class="item-qty-rate">
						<div class="item-qty"><span>${item_data.qty || 0} ${item_data.uom}</span></div>
						<div class="item-rate-amount">
							<div class="item-rate">${format_currency(item_data.amount, currency)}</div>
							<div class="item-amount">${format_currency(item_data.rate, currency)}</div>
						</div>
					</div>`;
			} else {
				return `
					<div class="item-qty-rate">
						<div class="item-qty"><span>${item_data.qty || 0} ${item_data.uom}</span></div>
						<div class="item-rate-amount">
							<div class="item-rate">${format_currency(item_data.rate, currency)}</div>
						</div>
					</div>`;
			}
		}

		function get_description_html() {
			if (item_data.description) {
				if (item_data.description.indexOf("<div>") != -1) {
					try {
						item_data.description = $(item_data.description).text();
					} catch (error) {
						item_data.description = item_data.description
							.replace(/<div>/g, " ")
							.replace(/<\/div>/g, " ")
							.replace(/ +/g, " ");
					}
				}
				item_data.description = frappe.ellipsis(item_data.description, 45);
				return `<div class="item-desc">${item_data.description}</div>`;
			}
			return ``;
		}

		function get_notes_html() {
			if (!item_data.notes) return ``;
			const notes = frappe.ellipsis(frappe.utils.escape_html(cstr(item_data.notes)), 60);
			return `<div class="item-notes">${notes}</div>`;
		}

		function get_item_image_html() {
			const { image, item_name } = item_data;
			if (!me.hide_images && image) {
				return `
					<div class="item-image">
						<img
							onerror="cur_pos.cart.handle_broken_image(this)"
							src="${image}" alt="${frappe.get_abbr(item_name)}"">
					</div>`;
			} else {
				return `<div class="item-image item-abbr">${frappe.get_abbr(item_name)}</div>`;
			}
		}
	}

	handle_broken_image($img) {
		const item_abbr = $($img).attr("alt");
		$($img).parent().replaceWith(`<div class="item-image item-abbr">${item_abbr}</div>`);
	}

	update_selector_value_in_cart_item(selector, value, item) {
		const $item_to_update = this.get_cart_item(item);
		$item_to_update.attr(`data-${selector}`, escape(value));
	}

	toggle_checkout_btn(show_checkout) {
		if (show_checkout) {
			this.$totals_section.find(".checkout-btn").css("display", "flex");
			this.$totals_section.find(".edit-cart-btn").css("display", "none");
		} else {
			this.$totals_section.find(".checkout-btn").css("display", "none");
			this.$totals_section.find(".edit-cart-btn").css("display", "flex");
		}
	}

	disable_customer_selection() {
		this.$customer_section
			.find(".nozom-customer-actions button, .nozom-address-actions button")
			.prop("disabled", true);
	}

	enable_customer_selection() {
		this.$customer_section
			.find(".nozom-customer-actions button, .nozom-address-actions button")
			.prop("disabled", false);
	}

	highlight_checkout_btn(toggle) {
		if (toggle) {
			this.$add_discount_elem.css("display", "flex");
			this.$cart_container.find(".checkout-btn").addClass("highlighted");
		} else {
			this.$add_discount_elem.css("display", "none");
			this.$cart_container.find(".checkout-btn").removeClass("highlighted");
		}
	}

	update_empty_cart_section(no_of_cart_items) {
		const $no_item_element = this.$cart_items_wrapper.find(".no-item-wrapper");

		// if cart has items and no item is present
		no_of_cart_items > 0 &&
			$no_item_element &&
			$no_item_element.remove() &&
			this.$cart_header.css("display", "flex");

		no_of_cart_items === 0 && !$no_item_element.length && this.make_no_items_placeholder();
	}

	on_numpad_event($btn) {
		const current_action = $btn.attr("data-button-value");
		const action_is_field_edit = ["qty", "discount_percentage", "rate"].includes(current_action);
		const action_is_allowed = action_is_field_edit
			? (current_action == "rate" && this.allow_rate_change) ||
			(current_action == "discount_percentage" && this.allow_discount_change) ||
			current_action == "qty"
			: true;

		const action_is_pressed_twice = this.prev_action === current_action;
		const first_click_event = !this.prev_action;
		const field_to_edit_changed = this.prev_action && this.prev_action != current_action;

		if (action_is_field_edit) {
			if (!action_is_allowed) {
				const label = current_action == "rate" ? "Rate".bold() : "Discount".bold();
				const message = __("Editing {0} is not allowed as per POS Profile settings", [label]);
				frappe.show_alert({
					indicator: "red",
					message: message,
				});
				frappe.utils.play_sound("error");
				return;
			}
			this.highlight_numpad_btn($btn, current_action);

			if (first_click_event || field_to_edit_changed) {
				this.prev_action = current_action;
			} else if (action_is_pressed_twice) {
				this.prev_action = undefined;
			}
			this.numpad_value = "";
		} else if (current_action === "checkout") {
			this.prev_action = undefined;
			this.toggle_item_highlight();
			this.events.numpad_event(undefined, current_action);
			return;
		} else if (current_action === "remove") {
			this.prev_action = undefined;
			this.toggle_item_highlight();
			this.events.numpad_event(undefined, current_action);
			return;
		} else {
			this.numpad_value =
				current_action === "delete"
					? this.numpad_value.slice(0, -1)
					: this.numpad_value + current_action;
			this.numpad_value = this.numpad_value || 0;
		}

		const first_click_event_is_not_field_edit = !action_is_field_edit && first_click_event;

		if (first_click_event_is_not_field_edit) {
			frappe.show_alert({
				indicator: "red",
				message: __("Please select a field to edit from numpad"),
			});
			frappe.utils.play_sound("error");
			return;
		}

		if (flt(this.numpad_value) > 100 && this.prev_action === "discount_percentage") {
			frappe.show_alert({
				message: __("Discount cannot be greater than 100%"),
				indicator: "orange",
			});
			frappe.utils.play_sound("error");
			this.numpad_value = current_action;
		}

		this.events.numpad_event(this.numpad_value, this.prev_action);
	}

	highlight_numpad_btn($btn, curr_action) {
		const curr_action_is_highlighted = $btn.hasClass("highlighted-numpad-btn");
		const curr_action_is_action = ["qty", "discount_percentage", "rate", "done"].includes(curr_action);

		if (!curr_action_is_highlighted) {
			$btn.addClass("highlighted-numpad-btn");
		}
		if (this.prev_action === curr_action && curr_action_is_highlighted) {
			// if Qty is pressed twice
			$btn.removeClass("highlighted-numpad-btn");
		}
		if (this.prev_action && this.prev_action !== curr_action && curr_action_is_action) {
			// Order: Qty -> Rate then remove Qty highlight
			const prev_btn = $(`[data-button-value='${this.prev_action}']`);
			prev_btn.removeClass("highlighted-numpad-btn");
		}
		if (!curr_action_is_action || curr_action === "done") {
			// if numbers are clicked
			setTimeout(() => {
				$btn.removeClass("highlighted-numpad-btn");
			}, 200);
		}
	}

	toggle_numpad(show) {
		if (show) {
			this.$totals_section.css("display", "none");
			this.$numpad_section.css("display", "flex");
		} else {
			this.$totals_section.css("display", "flex");
			this.$numpad_section.css("display", "none");
		}
		this.reset_numpad();
	}

	reset_numpad() {
		this.numpad_value = "";
		this.prev_action = undefined;
		this.$numpad_section.find(".highlighted-numpad-btn").removeClass("highlighted-numpad-btn");
	}

	toggle_numpad_field_edit(fieldname) {
		if (["qty", "discount_percentage", "rate"].includes(fieldname)) {
			this.$numpad_section.find(`[data-button-value="${fieldname}"]`).click();
		}
	}

	toggle_customer_info(show) {
		if (show) {
			const { customer_name } = this.customer_info || {};

			this.$cart_container.css("display", "none");
			this.$customer_section.css({
				height: "100%",
				"padding-top": "0px",
			});
			this.$customer_section.html(
				`<div class="customer-details nozom-recent-tx-panel">
					<div class="header">
						<div class="label">${__("Recent Orders")} — ${frappe.utils.escape_html(
							customer_name || ""
						)}</div>
						<button type="button" class="btn btn-xs btn-default nozom-btn-hide-tx">${__(
							"Hide Orders"
						)}</button>
					</div>
					<div class="customer-transactions"></div>
				</div>`
			);
			this.fetch_customer_transactions();
		} else {
			this.$cart_container.css("display", "flex");
			this.$customer_section.css({
				height: "",
				"padding-top": "",
			});
			this.update_customer_section();
		}
	}

	render_customer_fields() {
		const $customer_form = this.$customer_section.find(".customer-fields-container");
		const online = !window.nozom_pos?.offline?.network || nozom_pos.offline.network.is_online();

		const dfs = [
			{
				fieldname: "email_id",
				label: __("Email"),
				fieldtype: "Data",
				options: "email",
				placeholder: __("Enter customer's email"),
			},
			{
				fieldname: "mobile_no",
				label: __("Phone Number"),
				fieldtype: "Data",
				placeholder: __("Enter customer's phone number"),
			},
			{
				fieldname: "tax_id",
				label: __("TRN / Tax ID"),
				fieldtype: "Data",
				placeholder: __("Enter TRN / Tax ID"),
			},
			{
				fieldname: "address_line1",
				label: __("Address"),
				fieldtype: "Data",
				placeholder: __("Shop / street address"),
			},
			{
				fieldname: "loyalty_program",
				label: __("Loyalty Program"),
				fieldtype: "Link",
				options: "Loyalty Program",
				placeholder: __("Select Loyalty Program"),
				read_only: !online,
			},
			{
				fieldname: "loyalty_points",
				label: __("Loyalty Points"),
				fieldtype: "Data",
				read_only: 1,
			},
		];

		const me = this;
		dfs.forEach((df) => {
			this[`customer_${df.fieldname}_field`] = frappe.ui.form.make_control({
				df: df,
				parent: $customer_form.find(`.${df.fieldname}-field`),
				render_input: true,
			});
			this[`customer_${df.fieldname}_field`].$input?.on("blur", () => {
				handle_customer_field_change.apply(this[`customer_${df.fieldname}_field`]);
			});
			this[`customer_${df.fieldname}_field`].set_value(this.customer_info[df.fieldname]);
		});

		async function handle_customer_field_change() {
			const current_value = me.customer_info[this.df.fieldname];
			const current_customer = me.customer_info.customer;
			const fieldname = this.df.fieldname;

			if (this.value == null || current_value == this.value || fieldname === "loyalty_points") {
				return;
			}
			if (fieldname === "loyalty_program" && !online) {
				frappe.show_alert({
					message: __("Loyalty updates require an online connection."),
					indicator: "orange",
				});
				return;
			}

			const is_online = !window.nozom_pos?.offline?.network || nozom_pos.offline.network.is_online();
			const pos_profile = me.events.get_frm?.()?.doc?.pos_profile;

			if (!is_online) {
				try {
					const updated = await nozom_pos.offline.customer_store.update_local(
						pos_profile,
						current_customer,
						{ [fieldname]: this.value }
					);
					me.customer_info[fieldname] = this.value;
					me.customer_info.customer_name = updated.customer_name;
					const frm = me.events.get_frm();
					if (frm?.doc && fieldname === "tax_id") {
						frm.doc.tax_id = this.value;
					}
					frappe.show_alert({
						message: __("Customer updated locally. Will sync when online."),
						indicator: "orange",
					});
					me.update_customer_section();
				} catch (e) {
					frappe.msgprint(e.message || __("Could not update customer."));
				}
				return;
			}

			if (fieldname === "tax_id") {
				frappe.db.set_value("Customer", current_customer, "tax_id", this.value).then(async () => {
					me.customer_info.tax_id = this.value;
					const frm = me.events.get_frm();
					if (frm?.doc) frm.doc.tax_id = this.value;
					await nozom_pos.offline.customer_store?.upsert_cached?.(pos_profile, {
						name: current_customer,
						...me.customer_info,
					});
					frappe.show_alert({
						message: __("Customer contact updated successfully."),
						indicator: "green",
					});
				});
				return;
			}

			if (fieldname === "address_line1") {
				try {
					const existing = me.customer_info.server_address_name;
					if (existing) {
						await frappe.db.set_value("Address", existing, "address_line1", this.value);
					} else if (cstr(this.value || "").trim()) {
						const addr = await me.create_customer_address(current_customer, {
							customer_name: me.customer_info.customer_name,
							address_line1: this.value,
							city: me.customer_info.city,
							country: me.customer_info.country,
						});
						me.customer_info.server_address_name = addr?.name || null;
					}
					me.customer_info.address_line1 = this.value;
					me.customer_info.primary_address = this.value;
					await nozom_pos.offline.customer_store?.upsert_cached?.(pos_profile, {
						name: current_customer,
						...me.customer_info,
					});
					frappe.show_alert({
						message: __("Customer contact updated successfully."),
						indicator: "green",
					});
				} catch (e) {
					frappe.msgprint(e.message || __("Could not update address."));
				}
				return;
			}

			frappe.call({
				method: "erpnext.selling.page.point_of_sale.point_of_sale.set_customer_info",
				args: {
					fieldname,
					customer: current_customer,
					value: this.value,
				},
				callback: async (r) => {
					if (!r.exc) {
						me.customer_info[fieldname] = this.value;
						await nozom_pos.offline.customer_store?.upsert_cached?.(pos_profile, {
							name: current_customer,
							...me.customer_info,
						});
						frappe.show_alert({
							message: __("Customer contact updated successfully."),
							indicator: "green",
						});
						frappe.utils.play_sound("submit");
					}
				},
			});
		}
	}

	async fetch_customer_transactions() {
		const transaction_container = this.$customer_section.find(".customer-transactions");
		const customer = this.customer_info?.customer;
		const online = !window.nozom_pos?.offline?.network || nozom_pos.offline.network.is_online();
		const rows = [];

		if (online && customer && !nozom_pos.offline.customer_store?.is_local_id?.(customer)) {
			try {
				const res = await frappe.call({
					method: "erpnext.selling.page.point_of_sale.point_of_sale.get_customer_recent_transactions",
					args: { customer },
				});
				(res.message || []).forEach((invoice) => {
					rows.push({
						doctype: invoice.doctype || "POS Invoice",
						name: invoice.name,
						posting_date: invoice.posting_date,
						posting_time: invoice.posting_time,
						grand_total: invoice.grand_total,
						currency: invoice.currency,
						status: invoice.status,
					});
				});
			} catch (e) {
				/* fall through to local */
			}
		}

		try {
			const pending = (await nozom_pos.offline.tx_queue?.list_pending?.()) || [];
			pending
				.filter((tx) => tx.customer === customer || tx.customer_name === this.customer_info?.customer_name)
				.forEach((tx) => {
					rows.push({
						doctype: tx.invoice_doctype || "POS Invoice",
						name: tx.server_invoice_name || tx.local_receipt_no || tx.id,
						local_id: tx.id,
						posting_date: (tx.created_at || "").slice(0, 10),
						posting_time: "",
						grand_total: tx.grand_total || tx.rounded_total,
						currency: tx.currency,
						status: tx.payment_status || "Queued",
						offline: true,
						tx,
					});
				});
		} catch (e) {
			/* ignore */
		}

		if (!rows.length) {
			transaction_container.html(
				`<div class="no-transactions-placeholder">${__("No recent transactions found")}</div>`
			);
			return;
		}

		transaction_container.html(
			rows
				.map((invoice) => {
					const posting_datetime = invoice.posting_date
						? frappe.datetime.str_to_user(
								`${invoice.posting_date}${invoice.posting_time ? " " + invoice.posting_time : ""}`
						  )
						: "";
					return `<button type="button" class="invoice-wrapper nozom-tx-row" data-doctype="${frappe.utils.escape_html(
						invoice.doctype || ""
					)}" data-name="${frappe.utils.escape_html(invoice.name || "")}" data-local-id="${frappe.utils.escape_html(
						invoice.local_id || ""
					)}">
						<div class="invoice-name-date">
							<div class="invoice-name">${frappe.utils.escape_html(invoice.name)}</div>
							<div class="invoice-date">${frappe.utils.escape_html(posting_datetime)}</div>
						</div>
						<div class="invoice-total-status">
							<div class="invoice-total">${
								format_currency(
									invoice.grand_total,
									invoice.currency,
									frappe.sys_defaults.currency_precision
								) || 0
							}</div>
							<div class="invoice-status"><span>${__(invoice.status || "")}</span></div>
						</div>
					</button>`;
				})
				.join("")
		);
	}

	async open_transaction_preview({ doctype, name, local_id } = {}) {
		// Unified with main Recent Orders preview
		if (this.events.open_customer_order) {
			this.events.open_customer_order(doctype, name, local_id || "");
			return;
		}
		frappe.msgprint(__("Order preview is unavailable."));
	}

	attach_refresh_field_event(frm) {
		$(frm.wrapper).off("refresh-fields");
		$(frm.wrapper).on("refresh-fields", () => {
			if (frm.doc.items.length) {
				this.$cart_items_wrapper.html("");
				frm.doc.items.forEach((item) => {
					this.update_item_html(item);
				});
			}
			this.update_totals_section(frm);
		});
	}

	load_invoice() {
		const frm = this.events.get_frm();

		this.attach_refresh_field_event(frm);

		this.fetch_customer_details(frm.doc.customer).then(async () => {
			await this.load_default_address_for_customer(frm.doc.customer, frm.doc.shipping_address_name || frm.doc.customer_address);
			this.events.customer_details_updated(this.customer_info);
			this.update_customer_section();
		});

		this.$cart_items_wrapper.html("");
		if (frm.doc.items.length) {
			frm.doc.items.forEach((item) => {
				this.update_item_html(item);
			});
		} else {
			this.make_no_items_placeholder();
			this.highlight_checkout_btn(false);
		}

		this.hide_discount_control();
		this.set_order_note_value(frm.doc.order_notes);
		this.set_order_number_value(frm.doc.nozom_order_number);
		this.update_totals_section(frm);

		if (frm.doc.docstatus === 1) {
			this.$totals_section.find(".checkout-btn").css("display", "none");
			this.$totals_section.find(".edit-cart-btn").css("display", "none");
		} else {
			this.$totals_section.find(".checkout-btn").css("display", "flex");
			this.$totals_section.find(".edit-cart-btn").css("display", "none");
		}

		this.toggle_component(true);
	}

	toggle_component(show) {
		show ? this.$component.css("display", "flex") : this.$component.css("display", "none");
	}
};
