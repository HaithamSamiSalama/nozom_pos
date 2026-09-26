frappe.provide("nozom_pos.offline");

/**
 * Conflict / queue review dialog for offline sales (Phase D).
 * Cashier Discard removed — completed offline sales must not be casually deletable.
 */
nozom_pos.offline.conflict_ui = (() => {
	let dialog = null;

	function money(tx) {
		return format_currency(flt(tx.grand_total || tx.paid_amount), tx.currency);
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
		const total = format_currency(flt(tx.rounded_total) || flt(tx.grand_total), tx.currency);
		const paid = format_currency(flt(tx.paid_amount), tx.currency);
		const outstanding = format_currency(flt(tx.outstanding_amount), tx.currency);
		return `${__(pay)} · ${__("Total")}: ${total} · ${__("Paid")}: ${paid} · ${__(
			"Outstanding"
		)}: ${outstanding}`;
	}

	function row_html(tx) {
		const err = frappe.utils.escape_html(cstr(tx.last_error || ""));
		const receipt = frappe.utils.escape_html(cstr(tx.local_receipt_no || tx.id));
		const customer = frappe.utils.escape_html(cstr(tx.customer_name || tx.customer || ""));
		const can_retry = ["FAILED", "CONFLICT", "QUEUED"].includes(tx.status);

		return `
			<div class="nozom-conflict-row" data-tx-id="${frappe.utils.escape_html(tx.id)}">
				<div class="nozom-conflict-row__main">
					<div class="nozom-conflict-row__title">
						<strong>${receipt}</strong>
						<span class="nozom-conflict-status is-${(tx.status || "").toLowerCase()}">${status_label(
							tx.status,
							tx.error_code
						)}</span>
					</div>
					<div class="nozom-conflict-row__meta">
						${customer}<br>${payment_meta(tx)}
						${
							tx.terminal_id
								? `<br>${__("Terminal")}: ${frappe.utils.escape_html(
										cstr(tx.terminal_id).slice(0, 10)
								  )}`
								: ""
						}
						${tx.server_name ? `<br>${__("Server")}: ${frappe.utils.escape_html(tx.server_name)}` : ""}
					</div>
					${err ? `<div class="nozom-conflict-row__error">${err}</div>` : ""}
				</div>
				<div class="nozom-conflict-row__actions">
					${
						can_retry
							? `<button type="button" class="btn btn-sm btn-primary nozom-tx-retry">${__(
									"Retry Sync"
							  )}</button>`
							: ""
					}
				</div>
			</div>
		`;
	}

	async function render_list($body) {
		const rows = await nozom_pos.offline.tx_queue.list_actionable();
		if (!rows.length) {
			$body.html(
				`<div class="nozom-conflict-empty">${__("No pending offline sales or conflicts.")}</div>`
			);
			return;
		}
		$body.html(rows.map(row_html).join(""));
	}

	async function open() {
		if (dialog) {
			dialog.show();
			await render_list(dialog.$body.find(".nozom-conflict-list"));
			return dialog;
		}

		dialog = new frappe.ui.Dialog({
			title: __("Sync Queue"),
			size: "large",
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "conflict_html",
					options: `<div class="nozom-conflict-list"></div>`,
				},
			],
			primary_action_label: __("Close"),
			primary_action: () => dialog.hide(),
		});

		dialog.$wrapper.addClass("nozom-pos-centered-dialog nozom-conflict-dialog");
		nozom_pos.i18n?.apply_direction?.(nozom_pos.i18n.get());

		dialog.$body.on("click", ".nozom-tx-retry", async function () {
			const id = $(this).closest(".nozom-conflict-row").attr("data-tx-id");
			await nozom_pos.offline.tx_queue.requeue(id);
			await nozom_pos.offline.sync_worker.flush({ limit: 10 });
			await render_list(dialog.$body.find(".nozom-conflict-list"));
		});

		dialog.show();
		await render_list(dialog.$body.find(".nozom-conflict-list"));
		return dialog;
	}

	return { open };
})();
