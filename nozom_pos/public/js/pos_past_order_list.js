erpnext.PointOfSale.PastOrderList = class {
	constructor({ wrapper, events }) {
		this.wrapper = wrapper;
		this.events = events;
		this.active_status = "Paid";
		this.from_date = frappe.datetime.get_today();
		this.to_date = frappe.datetime.get_today();

		this.init_component();
	}

	init_component() {
		this.prepare_dom();
		this.make_filter_section();
		this.bind_events();
	}

	prepare_dom() {
		this.wrapper.append(
			`<section class="past-order-list">
				<div class="filter-section">
					<div class="label">${__("Recent Orders")}</div>
					<div class="status-chips"></div>
					<div class="status-search-fields">
						<div class="search-field"></div>
						<div class="date-filter-row">
							<div class="from-date-field"></div>
							<div class="to-date-field"></div>
							<button type="button" class="btn btn-default today-date-filter">
								${__("Today")}
							</button>
							<button type="button" class="btn btn-default all-date-filter">
								${__("All Dates")}
							</button>
						</div>
					</div>
				</div>
				<div class="invoices-container"></div>
			</section>`
		);

		this.$component = this.wrapper.find(".past-order-list");
		this.$invoices_container = this.$component.find(".invoices-container");
		this.$status_chips = this.$component.find(".status-chips");
	}

	bind_events() {
		this.search_field.$input.on("input", (e) => {
			clearTimeout(this.last_search);
			this.last_search = setTimeout(() => {
				const search_term = e.target.value;
				this.refresh_list(search_term, this.active_status);
			}, 300);
		});

		const me = this;
		this.$status_chips.on("click", ".status-chip", function () {
			const status = $(this).attr("data-status");
			me.set_active_status(status);
			me.refresh_list();
		});

		this.$invoices_container.on("click", ".invoice-wrapper", function () {
			const invoice_clicked = $(this);
			const invoice_doctype = invoice_clicked.attr("data-invoice-doctype");
			const invoice_name = unescape(invoice_clicked.attr("data-invoice-name"));

			$(".invoice-wrapper").removeClass("invoice-selected");
			invoice_clicked.addClass("invoice-selected");

			me.events.open_invoice_data(invoice_doctype, invoice_name);
		});
	}

	make_filter_section() {
		const t = (text) => nozom_pos.i18n?.t?.(text) || __(text);

		const chips = [
			{ key: "All", label: t("All"), css: "is-all" },
			{ key: "Paid", label: t("Paid"), css: "is-paid" },
			{ key: "Partly Paid", label: t("Partially Paid"), css: "is-partial" },
			{ key: "Draft", label: t("Draft"), css: "is-draft" },
			{ key: "Return", label: t("Return"), css: "is-return" },
			{ key: "Consolidated", label: t("Consolidated"), css: "is-consolidated" },
		];

		this.$status_chips.html(
			chips
				.map(
					(c) =>
						`<button type="button" class="status-chip ${c.css}" data-status="${c.key}">${c.label}</button>`
				)
				.join("")
		);

		if (!this.search_field) {
			this.search_field = frappe.ui.form.make_control({
				df: {
					label: t("Search"),
					fieldtype: "Data",
					placeholder: t("Search by invoice id or customer name"),
				},
				parent: this.$component.find(".search-field"),
				render_input: true,
			});
			this.search_field.toggle_label(false);
		} else {
			this.search_field.df.placeholder = t("Search by invoice id or customer name");
			this.search_field.$input?.attr(
				"placeholder",
				t("Search by invoice id or customer name")
			);
		}

		if (!this.from_date_field) {
			this.from_date_field = frappe.ui.form.make_control({
				df: {
					label: t("From Date"),
					fieldtype: "Date",
					default: this.from_date,
				},
				parent: this.$component.find(".from-date-field"),
				render_input: true,
			});
			this.from_date_field.set_value(this.from_date);
		}

		if (!this.to_date_field) {
			this.to_date_field = frappe.ui.form.make_control({
				df: {
					label: t("To Date"),
					fieldtype: "Date",
					default: this.to_date,
				},
				parent: this.$component.find(".to-date-field"),
				render_input: true,
			});
			this.to_date_field.set_value(this.to_date);
		}

		this.from_date_field.df.label = t("From Date");
		this.to_date_field.df.label = t("To Date");
		this.from_date_field.refresh();
		this.to_date_field.refresh();

		this.from_date_field.$input
			.off("change.nozomRecentDate")
			.on("change.nozomRecentDate", () => {
				this.from_date = this.from_date_field.get_value() || frappe.datetime.get_today();
				this.refresh_list();
			});

		this.to_date_field.$input
			.off("change.nozomRecentDate")
			.on("change.nozomRecentDate", () => {
				this.to_date = this.to_date_field.get_value() || frappe.datetime.get_today();
				this.refresh_list();
			});

		this.$component
			.find(".today-date-filter")
			.off("click.nozomRecentDate")
			.on("click.nozomRecentDate", () => {
				const today = frappe.datetime.get_today();
				this.from_date = today;
				this.to_date = today;
				this.from_date_field.set_value(today);
				this.to_date_field.set_value(today);
				this.refresh_list();
			})
			.text(t("Today"));

		this.$component
			.find(".all-date-filter")
			.off("click.nozomRecentDate")
			.on("click.nozomRecentDate", () => {
				this.from_date = "";
				this.to_date = "";
				this.from_date_field.set_value("");
				this.to_date_field.set_value("");
				this.refresh_list();
			})
			.text(t("All Dates"));

		this.status_field = {
			get_value: () => this.active_status,
			set_value: (v) => this.set_active_status(v),
		};

		this.$component.find(".filter-section > .label").text(t("Recent Orders"));
		this.set_active_status(this.active_status || "Paid");
	}

	refresh_i18n_labels() {
		this.make_filter_section();
	}

	set_active_status(status) {
		this.active_status = status || "Paid";
		this.$status_chips.find(".status-chip").removeClass("is-active");
		this.$status_chips.find(`.status-chip[data-status="${this.active_status}"]`).addClass("is-active");
	}

	is_date_in_range(value, from_date, to_date) {
		const date = String(value || "").slice(0, 10);
		if (!date) return false;
		if (from_date && date < from_date) return false;
		if (to_date && date > to_date) return false;
		return true;
	}

	async refresh_list() {
		const request = window.nozom_pos?.offline?.request;
		const network = window.nozom_pos?.offline?.network;
		this.events.reset_summary();
		const search_term = this.search_field.get_value();
		const status = this.active_status;
		const pos_profile = this.events.get_pos_profile?.() || "";
		const from_date = this.from_date_field?.get_value?.() || this.from_date || frappe.datetime.get_today();
		const to_date = this.to_date_field?.get_value?.() || this.to_date || frappe.datetime.get_today();

		if (from_date > to_date) {
			frappe.msgprint(__("From Date can not be after To Date"));
			return;
		}

		this.from_date = from_date;
		this.to_date = to_date;

		this.$invoices_container.html("");

		const online = !network || network.is_online();

		try {
			if (!online) {
				await this.render_offline_list({ search_term, status, pos_profile, from_date, to_date });
				return;
			}

			const response = await (request
				? request.call({
						method: "nozom_pos.api.orders.get_past_order_list",
						args: { search_term, status, from_date, to_date },
						timeout_ms: 3000,
						timeout_label: "recent-orders",
				  })
				: new Promise((resolve, reject) => {
						frappe.call({
							method: "nozom_pos.api.orders.get_past_order_list",
							freeze: false,
							args: { search_term, status, from_date, to_date },
							callback: (r) => resolve(r),
							error: (err) => reject(err),
						});
				  }));

			const rows = response.message || [];
			await nozom_pos.offline.catalog?.cache_recent_orders?.(rows, pos_profile);
			rows.forEach((invoice) => {
				this.$invoices_container.append(this.get_invoice_html(invoice));
			});
			await this.prepend_pending_local_sales({ search_term, status, from_date, to_date });
			await this.prepend_local_drafts({ search_term, status, pos_profile, from_date, to_date });
		} catch (e) {
			console.warn(e);
			network?.mark_unreachable?.({ reason: "recent_orders_failed" });
			await this.render_offline_list({ search_term, status, pos_profile, from_date, to_date });
		} finally {
			request?.force_unfreeze?.();
		}
	}

	async prepend_pending_local_sales({
		search_term = "",
		status = "All",
		from_date = "",
		to_date = "",
	} = {}) {
		if (!window.nozom_pos?.offline?.tx_queue) return;

		const pending = await nozom_pos.offline.tx_queue.list_pending();
		const term = (search_term || "").toLowerCase().trim();
		pending
			.slice()
			.reverse()
			.forEach((tx) => {
				const tx_date = String(tx.queued_at || tx.created_at || "").slice(0, 10);
				if (!this.is_date_in_range(tx_date, from_date, to_date)) return;

				const pay = tx.payment_status || nozom_pos.offline.tx_queue.payment_label?.(tx) || "Paid";
				if (status === "Paid" && pay !== "Paid") return;
				if (status === "Partly Paid" && pay !== "Partially Paid") return;
				if (status === "Unpaid" && !["Unpaid", "Overdue"].includes(pay)) return;
				if (status === "Draft") return;
				if (
					status &&
					!["All", "Paid", "Partly Paid", "Unpaid", "Overdue", "Consolidated"].includes(status)
				) {
					return;
				}

				const hay = `${tx.local_receipt_no || ""} ${tx.customer || ""} ${
					tx.customer_name || ""
				} ${tx.nozom_order_number || ""}`.toLowerCase();
				if (term && !hay.includes(term)) return;
				this.$invoices_container.prepend(this.get_pending_invoice_html(tx));
			});
	}

	async prepend_local_drafts({
		search_term = "",
		status = "All",
		pos_profile = "",
		from_date = "",
		to_date = "",
	} = {}) {
		if (!window.nozom_pos?.offline?.draft_store) return;
		if (status && !["All", "Draft"].includes(status)) return;

		const drafts = await nozom_pos.offline.draft_store.list({ pos_profile, search_term });
		drafts.forEach((draft) => {
			const draft_date = String(draft.updated_at || draft.created_at || "").slice(0, 10);
			if (!this.is_date_in_range(draft_date, from_date, to_date)) return;
			this.$invoices_container.prepend(this.get_local_draft_html(draft));
		});
	}

	get_local_draft_html(draft) {
		const posting_datetime = frappe.datetime.str_to_user(
			(draft.updated_at || draft.created_at || "").replace("T", " ").slice(0, 19) ||
				frappe.datetime.now_datetime()
		);
		const sync_badge = draft.server_draft_name
			? `<span class="nozom-cache-badge">${__("Synced")}</span>`
			: `<span class="nozom-pending-badge">${__("Pending Sync")}</span>`;
		return `<div class="invoice-wrapper is-local-draft" data-invoice-doctype="Local Draft" data-invoice-name="${escape(
			draft.local_receipt_no || draft.id
		)}">
				<div class="invoice-name-customer">
					<div class="invoice-customer">
						${frappe.ellipsis(draft.customer_name || draft.customer || "", 20)}
					</div>
					<div class="invoice-name">${draft.local_receipt_no || draft.id}
						<span class="nozom-draft-badge">${__("Local Draft")}</span>
						${sync_badge}
					</div>
				</div>
				<div class="invoice-total-date">
					<div class="invoice-total">${format_currency(
						draft.grand_total || draft.rounded_total,
						draft.currency
					) || 0}</div>
					<div class="invoice-date">${posting_datetime}</div>
				</div>
			</div>
			<div class="seperator"></div>`;
	}

	async render_offline_list({ search_term, status, pos_profile, from_date, to_date }) {
		const cached =
			(await nozom_pos.offline.catalog?.search_recent_orders?.({
				search_term,
				status,
				pos_profile,
				from_date,
				to_date,
			})) || [];

		await this.prepend_pending_local_sales({ search_term, status, from_date, to_date });
		await this.prepend_local_drafts({ search_term, status, pos_profile, from_date, to_date });

		cached.forEach((invoice) => {
			this.$invoices_container.append(this.get_invoice_html({ ...invoice, _from_cache: true }));
		});

		if (!this.$invoices_container.children().length) {
			this.$invoices_container.html(
				`<div class="text-muted p-3">${__("No cached or pending orders available offline.")}</div>`
			);
		}
	}

	get_pending_invoice_html(tx) {
		const posting_datetime = frappe.datetime.str_to_user(
			(tx.queued_at || "").replace("T", " ").slice(0, 19) || frappe.datetime.now_datetime()
		);
		const pay = tx.payment_status || nozom_pos.offline.tx_queue.payment_label?.(tx) || "Paid";
		const pay_label =
			pay === "Partially Paid"
				? __("Partially Paid")
				: pay === "Unpaid"
				? __("Unpaid")
				: __("Paid");
		return `<div class="invoice-wrapper is-pending-sync" data-invoice-doctype="Local Offline Sale" data-invoice-name="${escape(
			tx.local_receipt_no || tx.id
		)}">
				<div class="invoice-name-customer">
					<div class="invoice-customer">
						${frappe.ellipsis(tx.customer_name || tx.customer || "", 20)}
					</div>
					<div class="invoice-name">${tx.local_receipt_no || tx.id}
						<span class="nozom-pending-badge">${__("Pending Sync")}</span>
						<span class="nozom-pay-badge is-${frappe.scrub(pay)}">${pay_label}</span>
					</div>
					<div class="invoice-pay-meta text-muted">
						${__("Total")}: ${format_currency(flt(tx.rounded_total) || flt(tx.grand_total), tx.currency)}
						· ${__("Paid")}: ${format_currency(flt(tx.paid_amount), tx.currency)}
						· ${__("Outstanding")}: ${format_currency(flt(tx.outstanding_amount), tx.currency)}
					</div>
				</div>
				<div class="invoice-total-date">
					<div class="invoice-total">${format_currency(tx.grand_total || tx.rounded_total, tx.currency) || 0}</div>
					<div class="invoice-date">${posting_datetime}</div>
				</div>
			</div>
			<div class="seperator"></div>`;
	}

	get_invoice_html(invoice) {
		const posting_datetime = frappe.datetime.str_to_user(
			(invoice.posting_date || "") + " " + (invoice.posting_time || "")
		);
		const cache_badge = invoice._from_cache
			? `<span class="nozom-cache-badge">${__("Cached")}</span>`
			: "";
		return `<div class="invoice-wrapper" data-invoice-doctype="${
			invoice.doctype || "POS Invoice"
		}" data-invoice-name="${escape(invoice.name)}">
				<div class="invoice-name-customer">
					<div class="invoice-customer">
						<svg class="mr-2" width="12" height="12" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
							<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
						</svg>
						${frappe.ellipsis(invoice.customer_name || invoice.customer || "", 20)}
					</div>
					<div class="invoice-name">${invoice.name}${cache_badge}</div>
				</div>
				<div class="invoice-total-date">
					<div class="invoice-total">${format_currency(invoice.grand_total, invoice.currency) || 0}</div>
					<div class="invoice-date">${posting_datetime}</div>
				</div>
			</div>
			<div class="seperator"></div>`;
	}

	toggle_component(show) {
		show
			? this.$component.css("display", "flex") && this.refresh_list()
			: this.$component.css("display", "none");
	}
};
