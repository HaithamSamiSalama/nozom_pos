erpnext.PointOfSale.PastOrderList = class {
	constructor({ wrapper, events }) {
		this.wrapper = wrapper;
		this.events = events;
		this.active_status = "Paid";

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
		const chips = [
			{ key: "All", label: __("All"), css: "is-all" },
			{ key: "Paid", label: __("Paid"), css: "is-paid" },
			{ key: "Partly Paid", label: __("Partially Paid"), css: "is-partial" },
			{ key: "Draft", label: __("Draft"), css: "is-draft" },
			{ key: "Return", label: __("Return"), css: "is-return" },
			{ key: "Consolidated", label: __("Consolidated"), css: "is-consolidated" },
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
					label: __("Search"),
					fieldtype: "Data",
					placeholder: __("Search by invoice id or customer name"),
				},
				parent: this.$component.find(".search-field"),
				render_input: true,
			});
			this.search_field.toggle_label(false);
		} else {
			this.search_field.df.placeholder = __("Search by invoice id or customer name");
			this.search_field.$input?.attr(
				"placeholder",
				__("Search by invoice id or customer name")
			);
		}

		this.status_field = {
			get_value: () => this.active_status,
			set_value: (v) => this.set_active_status(v),
		};

		this.$component.find(".filter-section > .label").text(__("Recent Orders"));
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

	async refresh_list() {
		const request = window.nozom_pos?.offline?.request;
		const network = window.nozom_pos?.offline?.network;
		this.events.reset_summary();
		const search_term = this.search_field.get_value();
		const status = this.active_status;
		const pos_profile = this.events.get_pos_profile?.() || "";

		this.$invoices_container.html("");

		const online = !network || network.is_online();

		try {
			if (!online) {
				await this.render_offline_list({ search_term, status, pos_profile });
				return;
			}

			const response = await (request
				? request.call({
						method: "nozom_pos.api.orders.get_past_order_list",
						args: { search_term, status },
						timeout_ms: 3000,
						timeout_label: "recent-orders",
				  })
				: new Promise((resolve, reject) => {
						frappe.call({
							method: "nozom_pos.api.orders.get_past_order_list",
							freeze: false,
							args: { search_term, status },
							callback: (r) => resolve(r),
							error: (err) => reject(err),
						});
				  }));

			const rows = response.message || [];
			await nozom_pos.offline.catalog?.cache_recent_orders?.(rows, pos_profile);
			rows.forEach((invoice) => {
				this.$invoices_container.append(this.get_invoice_html(invoice));
			});
			await this.prepend_pending_local_sales({ search_term, status });
			await this.prepend_local_drafts({ search_term, status, pos_profile });
		} catch (e) {
			console.warn(e);
			network?.mark_unreachable?.({ reason: "recent_orders_failed" });
			await this.render_offline_list({ search_term, status, pos_profile });
		} finally {
			request?.force_unfreeze?.();
		}
	}

	async prepend_pending_local_sales({ search_term = "", status = "All" } = {}) {
		if (!window.nozom_pos?.offline?.tx_queue) return;

		const pending = await nozom_pos.offline.tx_queue.list_pending();
		const term = (search_term || "").toLowerCase().trim();
		pending
			.slice()
			.reverse()
			.forEach((tx) => {
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

	async prepend_local_drafts({ search_term = "", status = "All", pos_profile = "" } = {}) {
		if (!window.nozom_pos?.offline?.draft_store) return;
		if (status && !["All", "Draft"].includes(status)) return;

		const drafts = await nozom_pos.offline.draft_store.list({ pos_profile, search_term });
		drafts.forEach((draft) => {
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

	async render_offline_list({ search_term, status, pos_profile }) {
		const cached =
			(await nozom_pos.offline.catalog?.search_recent_orders?.({
				search_term,
				status,
				pos_profile,
			})) || [];

		await this.prepend_pending_local_sales({ search_term, status });
		await this.prepend_local_drafts({ search_term, status, pos_profile });

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
