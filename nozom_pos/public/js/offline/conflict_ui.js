frappe.provide("nozom_pos.offline");

/**
 * Conflict / queue review dialog for offline sales.
 *
 * Normal cashiers may retry eligible transactions.
 * Administrative discard is available only to authorized administrators,
 * requires the POS Profile offline admin password, and never hard-deletes
 * the queue record.
 */
nozom_pos.offline.conflict_ui = (() => {
	let dialog = null;

	function money(tx) {
		return format_currency(flt(tx.grand_total || tx.paid_amount), tx.currency);
	}

	function can_manage() {
		return Boolean(
			nozom_pos.offline.admin_auth?.can_manage_offline_transactions?.()
		);
	}

	function can_delete(tx) {
		return Boolean(
			can_manage() &&
			nozom_pos.offline.tx_queue?.can_admin_discard?.(tx)
		);
	}

	function status_label(status, error_code) {
		if (error_code === "VALIDATION_FAILED" || status === "CONFLICT") {
			if (error_code === "VALIDATION_FAILED") {
				return __("Sync Failed / Validation Error");
			}
			return __("Conflict");
		}

		const map = {
			QUEUED: __("Pending Sync"),
			FAILED: __("Sync Failed"),
			CONFLICT: __("Conflict"),
			SYNCING: __("Syncing"),
			SYNCED: __("Synced"),
			DISCARDED: __("Discarded"),
		};

		return map[status] || status;
	}

	function payment_meta(tx) {
		const pay =
			tx.payment_status ||
			nozom_pos.offline.tx_queue?.payment_label?.(tx) ||
			"";

		const total = format_currency(
			flt(tx.rounded_total) || flt(tx.grand_total),
			tx.currency
		);

		const paid = format_currency(
			flt(tx.paid_amount),
			tx.currency
		);

		const outstanding = format_currency(
			flt(tx.outstanding_amount),
			tx.currency
		);

		return `${__(pay)} · ${__("Total")}: ${total} · ${__(
			"Paid"
		)}: ${paid} · ${__("Outstanding")}: ${outstanding}`;
	}

	function payment_method(tx) {
		const payments = (tx.payments || [])
			.filter((row) => flt(row.amount) !== 0)
			.map((row) => cstr(row.mode_of_payment || "").trim())
			.filter(Boolean);

		return [...new Set(payments)].join(", ");
	}

	function row_html(tx) {
		const err = frappe.utils.escape_html(
			cstr(tx.last_error || "")
		);

		const receipt = frappe.utils.escape_html(
			cstr(tx.local_receipt_no || tx.id)
		);

		const customer = frappe.utils.escape_html(
			cstr(tx.customer_name || tx.customer || "")
		);

		const can_retry = ["FAILED", "CONFLICT", "QUEUED"].includes(
			tx.status
		);

		const show_delete = can_delete(tx);

		return `
			<div
				class="nozom-conflict-row"
				data-tx-id="${frappe.utils.escape_html(tx.id)}"
			>
				<div class="nozom-conflict-row__main">
					<div class="nozom-conflict-row__title">
						<strong>${receipt}</strong>

						<span class="nozom-conflict-status is-${(
							tx.status || ""
						).toLowerCase()}">
							${status_label(tx.status, tx.error_code)}
						</span>
					</div>

					<div class="nozom-conflict-row__meta">
						${customer}<br>
						${payment_meta(tx)}

						${
							tx.terminal_id
								? `<br>${__("Terminal")}: ${frappe.utils.escape_html(
										cstr(tx.terminal_id).slice(0, 10)
									)}`
								: ""
						}

						${
							tx.server_name
								? `<br>${__("Server")}: ${frappe.utils.escape_html(
										tx.server_name
									)}`
								: ""
						}
					</div>

					${
						err
							? `<div class="nozom-conflict-row__error">${err}</div>`
							: ""
					}
				</div>

				<div class="nozom-conflict-row__actions">
					${
						can_retry
							? `<button
									type="button"
									class="btn btn-sm btn-primary nozom-tx-retry"
								>${__("Retry Sync")}</button>`
							: ""
					}

					${
						show_delete
							? `<button
									type="button"
									class="btn btn-sm btn-danger nozom-tx-delete"
								>${__("Delete")}</button>`
							: ""
					}
				</div>
			</div>
		`;
	}

	async function render_list($body) {
		const rows =
			await nozom_pos.offline.tx_queue.list_actionable();

		if (!rows.length) {
			$body.html(
				`<div class="nozom-conflict-empty">${__(
					"No pending offline sales or conflicts."
				)}</div>`
			);
			return;
		}

		$body.html(rows.map(row_html).join(""));
	}

	async function refresh_status() {
		try {
			await nozom_pos.offline.status_ui?.refresh?.();
		} catch (e) {
			// Status refresh is non-critical.
		}
	}

	function open_delete_dialog(tx) {
		if (!tx || !can_delete(tx)) {
			frappe.msgprint(
				__("Only failed offline transactions can be discarded.")
			);
			return;
		}

		const receipt = cstr(
			tx.local_receipt_no || tx.id
		);

		const customer = cstr(
			tx.customer_name || tx.customer || ""
		);

		const method = payment_method(tx);

		const confirm_dialog = new frappe.ui.Dialog({
			title: __("Delete Offline Transaction"),
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "transaction_summary",
					options: `
						<div class="mb-3">
							<div>
								<strong>${frappe.utils.escape_html(receipt)}</strong>
							</div>

							${
								customer
									? `<div>${frappe.utils.escape_html(customer)}</div>`
									: ""
							}

							<div>${__("Total")}: ${money(tx)}</div>

							${
								method
									? `<div>${__("Payment Method")}: ${frappe.utils.escape_html(
											method
										)}</div>`
									: ""
							}

							<div>
								${__("Status")}: ${frappe.utils.escape_html(
									status_label(
										tx.status,
										tx.error_code
									)
								)}
							</div>
						</div>

						<div class="alert alert-warning">
							${__(
								"This failed offline transaction will be discarded and will not be synchronized."
							)}
						</div>
					`,
				},
				{
					fieldname: "admin_password",
					label: __("Admin Password"),
					fieldtype: "Password",
					reqd: 1,
				},
				{
					fieldname: "reason",
					label: __("Reason"),
					fieldtype: "Small Text",
					reqd: 0,
				},
			],

			primary_action_label: __("Delete"),

			primary_action: async (values) => {
				const password = cstr(
					values?.admin_password || ""
				);

				if (!password) {
					frappe.msgprint(
						__("Admin Password is required.")
					);
					return;
				}

				confirm_dialog.disable_primary_action();

				try {
					const result =
						await nozom_pos.offline.admin_auth.verify(
							tx.pos_profile,
							password
						);

					if (!result?.ok) {
						frappe.msgprint(
							result?.reason ||
								__("Invalid admin password.")
						);

						confirm_dialog.enable_primary_action();
						return;
					}

					const discarded =
						await nozom_pos.offline.tx_queue.admin_discard(
							tx.id,
							{
								reason: cstr(
									values?.reason || ""
								).trim(),

								display_name: receipt,
							}
						);

					if (!discarded) {
						throw new Error(
							__("Offline transaction was not found.")
						);
					}

					confirm_dialog.hide();

					frappe.show_alert({
						message: __("Transaction discarded."),
						indicator: "green",
					});

					await render_list(
						dialog.$body.find(
							".nozom-conflict-list"
						)
					);

					await refresh_status();

				} catch (e) {
					frappe.msgprint(
						e?.message ||
							__(
								"Could not discard offline transaction."
							)
					);

					confirm_dialog.enable_primary_action();
				}
			},
		});

		confirm_dialog.$wrapper.addClass(
			"nozom-pos-centered-dialog nozom-offline-delete-dialog"
		);

		nozom_pos.i18n?.apply_direction?.(
			nozom_pos.i18n.get()
		);

		confirm_dialog.show();
	}

	async function open() {
		if (dialog) {
			dialog.show();

			await render_list(
				dialog.$body.find(".nozom-conflict-list")
			);

			return dialog;
		}

		dialog = new frappe.ui.Dialog({
			title: __("Sync Queue"),
			size: "large",

			fields: [
				{
					fieldtype: "HTML",
					fieldname: "conflict_html",
					options:
						`<div class="nozom-conflict-list"></div>`,
				},
			],

			primary_action_label: __("Close"),
			primary_action: () => dialog.hide(),
		});

		dialog.$wrapper.addClass(
			"nozom-pos-centered-dialog nozom-conflict-dialog"
		);

		nozom_pos.i18n?.apply_direction?.(
			nozom_pos.i18n.get()
		);

		dialog.$body.on(
			"click",
			".nozom-tx-retry",
			async function () {
				const id = $(this)
					.closest(".nozom-conflict-row")
					.attr("data-tx-id");

				await nozom_pos.offline.tx_queue.requeue(id);

				await nozom_pos.offline.sync_worker.flush({
					limit: 10,
				});

				await render_list(
					dialog.$body.find(
						".nozom-conflict-list"
					)
				);
			}
		);

		dialog.$body.on(
			"click",
			".nozom-tx-delete",
			async function () {
				const id = $(this)
					.closest(".nozom-conflict-row")
					.attr("data-tx-id");

				const tx =
					await nozom_pos.offline.tx_queue.get(id);

				if (!tx) {
					frappe.msgprint(
						__("Offline transaction was not found.")
					);
					return;
				}

				open_delete_dialog(tx);
			}
		);

		dialog.show();

		await render_list(
			dialog.$body.find(".nozom-conflict-list")
		);

		return dialog;
	}

	return {
		open,
		can_manage,
		can_delete,
	};
})();
