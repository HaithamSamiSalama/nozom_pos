frappe.provide("nozom_pos");

/**
 * Close Period popup — cash denomination count + ERPNext closing lifecycle.
 * Post-close actions: Exit Desktop / Logout / Open New / Print.
 */
nozom_pos.close_period = (() => {
	const cd = () => nozom_pos.cash_denom;
	let dialog = null;
	let state = null;

	function esc(v) {
		return frappe.utils.escape_html(cstr(v || ""));
	}

	function money(amount, currency) {
		return cd()?.money?.(amount, currency) || String(flt(amount));
	}

	function is_online() {
		return !window.nozom_pos?.offline?.network || nozom_pos.offline.network.is_online();
	}

	async function pending_counts() {
		let pending_sales = 0;
		let local_drafts = 0;
		try {
			const counts = await nozom_pos.offline?.tx_queue?.counts?.();
			pending_sales = cint(counts?.queued) + cint(counts?.syncing) + cint(counts?.conflicts);
		} catch (e) {
			pending_sales = 0;
		}
		try {
			const drafts = await nozom_pos.offline?.draft_store?.list?.({
				pos_profile: state?.controller?.pos_profile || "",
			});
			local_drafts = (drafts || []).length;
		} catch (e) {
			local_drafts = 0;
		}
		return { pending_sales, local_drafts };
	}

	function denom_qty(denom) {
		return cd().qty_of(state.denoms, denom);
	}

	function denom_amount(denom) {
		return cd().amount_of(state.denoms, denom);
	}

	function actual_cash() {
		return cd().total(state.denoms);
	}

	function cash_payload() {
		return cd().payload(state.denoms);
	}

	function payment_payload(preview) {
		const actual = actual_cash();
		const cash_modes = preview.cash?.modes || [];
		const primary = cash_modes[0];
		return (preview.payments || []).map((p) => {
			let closing = flt(p.expected_amount);
			if (primary && p.mode_of_payment === primary) {
				closing = actual;
			} else if (cash_modes.includes(p.mode_of_payment) && p.mode_of_payment !== primary) {
				closing = flt(p.expected_amount);
			}
			return {
				mode_of_payment: p.mode_of_payment,
				opening_amount: flt(p.opening_amount),
				expected_amount: flt(p.expected_amount),
				closing_amount: closing,
				difference: closing - flt(p.expected_amount),
			};
		});
	}

	function keypad_html() {
		return cd().keypad_html();
	}

	function denom_rows_html() {
		return cd().denom_cols_html(state.denoms, state.selected_denom, state.preview.currency);
	}

	function summary_side_html(preview) {
		const currency = preview.currency;
		const sales = preview.sales || {};
		const cash = preview.cash || {};
		const opening = preview.opening || {};
		const actual = actual_cash();
		const diff = actual - flt(cash.expected_cash);
		const pay_rows = (preview.payments || [])
			.map(
				(p) =>
					`<div class="nz-sum-row"><span>${esc(__(p.mode_of_payment))}</span><strong dir="ltr">${money(
						p.expected_amount,
						currency
					)}</strong></div>`
			)
			.join("");

		return `
			<div class="nozom-close-section nozom-close-session">
				<div class="nozom-close-section__title">${esc(__("Session"))}</div>
				<div class="nozom-close-session__grid">
					<div class="nz-sum-row"><span>${esc(__("Opening Entry"))}</span><strong>${esc(
						opening.name
					)}</strong></div>
					<div class="nz-sum-row"><span>${esc(__("Cashier"))}</span><strong>${esc(opening.user)}</strong></div>
					<div class="nz-sum-row"><span>${esc(__("POS Profile"))}</span><strong>${esc(
						opening.pos_profile
					)}</strong></div>
					<div class="nz-sum-row"><span>${esc(__("Opening Time"))}</span><strong dir="ltr">${esc(
						frappe.datetime.str_to_user(opening.period_start_date)
					)}</strong></div>
					<div class="nz-sum-row"><span>${esc(__("Closing Time"))}</span><strong dir="ltr">${esc(
						frappe.datetime.str_to_user(preview.period_end_date)
					)}</strong></div>
				</div>
			</div>
			<div class="nozom-close-section">
				<div class="nozom-close-section__title">${esc(__("Cash Summary"))}</div>
				<div class="nz-sum-row"><span>${esc(__("Opening Cash"))}</span><strong dir="ltr">${money(
					cash.opening_cash,
					currency
				)}</strong></div>
				<div class="nz-sum-row"><span>${esc(__("Cash Sales"))}</span><strong dir="ltr">${money(
					cash.cash_sales,
					currency
				)}</strong></div>
				<div class="nz-sum-row"><span>${esc(__("Expected Cash"))}</span><strong dir="ltr">${money(
					cash.expected_cash,
					currency
				)}</strong></div>
				<div class="nz-sum-row"><span>${esc(__("Actual Cash"))}</span><strong class="nozom-close-actual" dir="ltr">${money(
					actual,
					currency
				)}</strong></div>
				<div class="nz-sum-row"><span>${esc(__("Difference"))}</span><strong class="nozom-close-diff ${
					diff < -0.0001 ? "is-neg" : diff > 0.0001 ? "is-pos" : ""
				}" dir="ltr">${money(diff, currency)}</strong></div>
			</div>
			<div class="nozom-close-section">
				<div class="nozom-close-section__title">${esc(__("Sales Summary"))}</div>
				<div class="nz-sum-row"><span>${esc(__("Gross Sales"))}</span><strong dir="ltr">${money(
					sales.gross_sales,
					currency
				)}</strong></div>
				<div class="nz-sum-row"><span>${esc(__("Discount"))}</span><strong dir="ltr">${money(
					sales.discount,
					currency
				)}</strong></div>
				<div class="nz-sum-row"><span>${esc(__("Net Sales"))}</span><strong dir="ltr">${money(
					sales.net_sales,
					currency
				)}</strong></div>
				<div class="nz-sum-row"><span>${esc(__("Returns"))}</span><strong dir="ltr">${money(
					sales.returns,
					currency
				)}</strong></div>
				<div class="nz-sum-row"><span>${esc(__("Grand Total"))}</span><strong dir="ltr">${money(
					sales.grand_total,
					currency
				)}</strong></div>
				<div class="nz-sum-row"><span>${esc(__("Invoices"))}</span><strong>${cint(
					preview.invoice_count
				)}</strong></div>
			</div>
			<div class="nozom-close-section">
				<div class="nozom-close-section__title">${esc(__("Payment Summary"))}</div>
				${pay_rows || `<div class="muted">${esc(__("No payments in this period."))}</div>`}
			</div>
		`;
	}

	function main_html(preview, meta) {
		const can_close = meta.online && meta.pending_sales <= 0;
		return `
			<div class="nozom-close-period">
				${warnings_html(meta)}
				<div class="nozom-close-layout nozom-close-layout--3col">
					<div class="nozom-close-grid nozom-close-grid--3col">
						<div class="nozom-close-col nozom-close-col--summaries">
							${summary_side_html(preview)}
						</div>
						<div class="nozom-close-col nozom-close-col--keypad">
							<div class="nozom-close-section nozom-close-keypad-card">
								${keypad_html()}
							</div>
							<div class="nozom-close-total-box">
								<div class="nozom-close-total-box__label">${esc(__("Total Counted Cash"))}</div>
								<strong class="nozom-close-total-box__value nozom-close-actual" dir="ltr">${money(
									actual_cash(),
									preview.currency
								)}</strong>
							</div>
						</div>
						<div class="nozom-close-col nozom-close-col--count">
							<div class="nozom-close-section nozom-close-count">
								<div class="nozom-close-section__title">${esc(__("Cash Count"))}</div>
								<div class="nozom-denom-list">${denom_rows_html()}</div>
							</div>
						</div>
					</div>
					<div class="nozom-close-actions nozom-close-actions--bottom">
						<button type="button" class="btn nozom-close-btn-close" ${can_close ? "" : "disabled"}>${esc(
							__("Close Period")
						)}</button>
						<button type="button" class="btn nozom-close-btn-cancel">${esc(__("Cancel"))}</button>
					</div>
				</div>
			</div>
		`;
	}

	function warnings_html({ pending_sales, local_drafts, online }) {
		let html = "";
		if (!online) {
			html += `<div class="nozom-close-warn is-danger">${esc(
				__("Closing the POS requires an online connection.")
			)}</div>`;
		}
		if (pending_sales > 0) {
			html += `<div class="nozom-close-warn is-danger">${esc(
				__("POS cannot be closed while offline sales are waiting to sync.")
			)}
			<div class="nozom-close-warn__meta">${esc(__("Pending Offline Sales"))}: <strong>${pending_sales}</strong></div>
			</div>`;
		}
		if (local_drafts > 0) {
			html += `<div class="nozom-close-warn is-info">${esc(__("Local Drafts"))}: <strong>${local_drafts}</strong></div>`;
		}
		return html;
	}

	function refresh_counts($root) {
		const currency = state.preview.currency;
		const cash = state.preview.cash || {};
		const actual = actual_cash();
		const diff = actual - flt(cash.expected_cash);
		$root.find(".nozom-denom-list").html(denom_rows_html());
		$root.find(".nozom-close-actual").text(money(actual, currency));
		$root
			.find(".nozom-close-diff")
			.text(money(diff, currency))
			.toggleClass("is-neg", diff < -0.0001)
			.toggleClass("is-pos", diff > 0.0001);
		bind_denom_clicks($root);
	}

	function apply_key(key) {
		const denom = cd().normalize_denom(state.selected_denom);
		if (denom == null) return;
		cd().set_qty(state.denoms, denom, cd().apply_qty_key(cd().qty_of(state.denoms, denom), key));
	}

	function bind_denom_clicks($root) {
		$root.find(".nozom-denom-row").off("click.nozom_close").on("click.nozom_close", function () {
			state.selected_denom = cd().normalize_denom($(this).attr("data-denom"));
			refresh_counts($root);
		});
	}

	function bind_main($root, meta) {
		bind_denom_clicks($root);
		$root.find(".nozom-close-key").on("click", function () {
			apply_key($(this).attr("data-key"));
			refresh_counts($root);
		});
		$(document)
			.off("keydown.nozom_close_period")
			.on("keydown.nozom_close_period", (e) => {
				if (!dialog?.display || state?.closed) return;
				if (e.key === "Enter") {
					e.preventDefault();
					if (!$root.find(".nozom-close-btn-close").prop("disabled")) do_close();
					return;
				}
				if (e.key === "Escape") return;
				if (/^\d$/.test(e.key) || e.key === "Backspace" || e.key === "c" || e.key === "C" || e.key === ".") {
					e.preventDefault();
					apply_key(e.key === "c" ? "C" : e.key);
					refresh_counts($root);
				}
			});
		dialog.$wrapper.on("hide.bs.modal", () => {
			$(document).off("keydown.nozom_close_period");
		});
		$root.find(".nozom-close-btn-cancel").on("click", () => dialog.hide());
		$root.find(".nozom-close-btn-close").on("click", () => do_close());
	}

	function build_report_html(data) {
		const currency = data.currency;
		const cash = data.cash || {};
		const sales = data.sales || {};
		const denom_lines = (data.denominations || data.cash_denominations || [])
			.map((r) => {
				const qty = cint(r.qty);
				const amt = r.amount ?? flt(flt(r.denomination) * qty, 2);
				const label =
					Math.abs(flt(r.denomination) - 0.5) < 0.0001
						? __("0.50")
						: cstr(r.denomination);
				return `<div class="row"><span dir="ltr">${esc(label)} × ${esc(qty)}</span><strong dir="ltr">${money(
					amt,
					currency
				)}</strong></div>`;
			})
			.join("");
		const pay_lines = (data.payments || [])
			.map(
				(p) =>
					`<div class="row"><span>${esc(__(p.mode_of_payment))}</span><strong dir="ltr">${money(
						p.expected_amount ?? p.closing_amount,
						currency
					)}</strong></div>`
			)
			.join("");

		return `
			<h1>${esc(__("NOZOM POS"))}</h1>
			<h2>${esc(__("Closing Report"))}</h2>
			<div class="meta"><span>${esc(__("Company"))}</span><strong>${esc(data.company)}</strong></div>
			<div class="meta"><span>${esc(__("POS Profile"))}</span><strong>${esc(data.pos_profile)}</strong></div>
			<div class="meta"><span>${esc(__("Cashier"))}</span><strong>${esc(data.user)}</strong></div>
			<div class="meta"><span>${esc(__("Opening Entry"))}</span><strong>${esc(data.pos_opening_entry)}</strong></div>
			<div class="meta"><span>${esc(__("Closing Entry"))}</span><strong>${esc(data.name)}</strong></div>
			<div class="meta"><span>${esc(__("Opening Time"))}</span><strong dir="ltr">${esc(
				frappe.datetime.str_to_user(data.period_start_date)
			)}</strong></div>
			<div class="meta"><span>${esc(__("Closing Time"))}</span><strong dir="ltr">${esc(
				frappe.datetime.str_to_user(data.period_end_date)
			)}</strong></div>
			<h2>${esc(__("SALES"))}</h2>
			<div class="row"><span>${esc(__("Gross Sales"))}</span><strong dir="ltr">${money(
				sales.gross_sales ?? data.gross_sales,
				currency
			)}</strong></div>
			<div class="row"><span>${esc(__("Discount"))}</span><strong dir="ltr">${money(
				sales.discount ?? data.discount,
				currency
			)}</strong></div>
			<div class="row"><span>${esc(__("Net Sales"))}</span><strong dir="ltr">${money(
				sales.net_sales ?? data.net_total,
				currency
			)}</strong></div>
			<div class="row"><span>${esc(__("Returns"))}</span><strong dir="ltr">${money(
				sales.returns ?? data.returns,
				currency
			)}</strong></div>
			<div class="row"><span>${esc(__("Grand Total"))}</span><strong dir="ltr">${money(
				sales.grand_total ?? data.grand_total,
				currency
			)}</strong></div>
			${
				cint(data.invoice_count)
					? `<div class="row"><span>${esc(__("Invoices"))}</span><strong>${cint(
							data.invoice_count
					  )}</strong></div>`
					: ""
			}
			<h2>${esc(__("PAYMENTS"))}</h2>
			${pay_lines || `<div class="muted">${esc(__("No payments in this period."))}</div>`}
			<h2>${esc(__("CASH COUNT"))}</h2>
			${denom_lines || `<div class="muted">${esc(__("No cash counted."))}</div>`}
			<div class="row"><span>${esc(__("Expected Cash"))}</span><strong dir="ltr">${money(
				cash.expected_cash,
				currency
			)}</strong></div>
			<div class="row"><span>${esc(__("Actual Cash"))}</span><strong dir="ltr">${money(
				cash.actual_cash ?? data.actual_cash,
				currency
			)}</strong></div>
			<div class="row"><span>${esc(__("Difference"))}</span><strong dir="ltr">${money(
				cash.difference ?? data.cash_difference,
				currency
			)}</strong></div>
			<div class="muted" style="margin-top:10px;">${esc(__("Printed At"))}: ${esc(
				frappe.datetime.str_to_user(frappe.datetime.now_datetime())
			)}</div>
			<div class="muted">${esc(__("Cashier"))}: ${esc(frappe.session.user)}</div>
		`;
	}

	function print_closing(data) {
		const html = build_report_html(data);
		if (nozom_pos.offline?.local_print?.open_print_window) {
			nozom_pos.offline.local_print.open_print_window(__("Closing Report"), html);
		} else {
			const w = window.open("", "_blank", "width=420,height=640");
			if (!w) {
				frappe.msgprint(__("Please allow pop-ups to print."));
				return;
			}
			w.document.write(
				`<!DOCTYPE html><html><head><title>${esc(__("Closing Report"))}</title>
				<style>body{font-family:sans-serif;font-size:13px;margin:12px}h1{font-size:16px}h2{font-size:14px;margin:10px 0 4px}
				.row,.meta{display:flex;justify-content:space-between;gap:8px;margin:2px 0}.muted{color:#666;font-size:11px}</style>
				</head><body>${html}<script>window.onload=function(){setTimeout(function(){window.print();},120);}</script></body></html>`
			);
			w.document.close();
		}
	}

	async function exit_to_desktop(controller) {
		try {
			if (nozom_pos.offline?.status_ui?.is_fullscreen?.()) {
				await nozom_pos.offline.status_ui.toggle_fullscreen();
			}
		} catch (e) {
			/* ignore */
		}
		try {
			await controller.clear_local_cart?.();
		} catch (e) {
			/* ignore */
		}
		nozom_pos.i18n?.restore_desk_language?.();
		dialog?.hide();
		frappe.set_route("");
	}

	let logging_out = false;

	function clear_transient_pos_state(controller) {
		if (!controller) return;
		try {
			controller.nozom_period_closed = false;
			controller.nozom_close_in_progress = false;
			controller.nozom_last_closing = null;
			controller.pos_opening = null;
			controller.unlock_closed_pos_workspace?.();
		} catch (e) {
			/* ignore */
		}
		try {
			controller.clear_local_cart?.();
		} catch (e) {
			/* ignore */
		}
		// Keep POS language preference (localStorage) intact.
	}

	async function logout_user($btn) {
		if (logging_out) return;
		logging_out = true;

		const $logout_btn = $btn?.length ? $btn : dialog?.$wrapper?.find?.(".nozom-close-btn-logout");
		if ($logout_btn?.length) {
			$logout_btn.prop("disabled", true).text(__("Logging out..."));
		}
		dialog?.$wrapper?.find?.(".nozom-close-btn-desktop, .nozom-close-btn-open-new, .nozom-close-btn-print")
			?.prop?.("disabled", true);

		// Exit fullscreen — never block logout on Fullscreen API errors
		try {
			if (nozom_pos.offline?.status_ui?.is_fullscreen?.()) {
				await nozom_pos.offline.status_ui.toggle_fullscreen();
			} else if (document.fullscreenElement || document.webkitFullscreenElement) {
				const exit =
					document.exitFullscreen ||
					document.webkitExitFullscreen ||
					document.mozCancelFullScreen ||
					document.msExitFullscreen;
				if (exit) await exit.call(document);
			}
		} catch (e) {
			console.warn("NOZOM POS logout fullscreen:", e);
		}

		clear_transient_pos_state(state?.controller);

		try {
			dialog?.hide();
		} catch (e) {
			/* ignore */
		}

		// Match Desk logout: mark logged_out then POST to whitelist method "logout"
		try {
			if (frappe.app) frappe.app.logged_out = true;
		} catch (e) {
			/* ignore */
		}

		const go_login = () => {
			window.location.href = "/login";
		};

		// Prefer the same call Desk uses inside frappe.app.logout (without confirm —
		// user already chose Logout on the post-close dialog).
		try {
			await frappe.call({
				method: "logout",
				freeze: false,
			});
		} catch (e) {
			console.warn("NOZOM POS logout call:", e);
		}

		go_login();

		// Hard fallback if navigation is blocked somehow
		setTimeout(() => {
			if (!/\/login(?:\/|$|\?)/.test(window.location.pathname + window.location.search)) {
				window.location.href = "/login";
			}
		}, 2500);
	}

	function post_close_html(result) {
		const closed_at = result.period_end_date
			? frappe.datetime.str_to_user(result.period_end_date)
			: "";
		return `
			<div class="nozom-close-success nozom-checkout-success">
				<div class="nozom-checkout-success__icon">✓</div>
				<div class="nozom-checkout-success__title">${esc(__("Period Closed Successfully"))}</div>
				<div class="nz-success-summary">
					<div class="nz-sum-row"><span>${esc(__("Closing Entry"))}</span><strong>${esc(
						result.name
					)}</strong></div>
					<div class="nz-sum-row"><span>${esc(__("Closed At"))}</span><strong dir="ltr">${esc(
						closed_at
					)}</strong></div>
				</div>
				<div class="nozom-checkout-success__actions nozom-close-actions--post">
					<button type="button" class="nz-success-btn nozom-close-btn-desktop">${esc(
						__("Exit to Desktop")
					)}</button>
					<button type="button" class="nz-success-btn nozom-close-btn-logout">${esc(__("Logout"))}</button>
					<button type="button" class="nz-success-btn nozom-close-btn-open-new">${esc(
						__("Open New Period")
					)}</button>
					<button type="button" class="nz-success-btn nozom-close-btn-print">${esc(
						__("Print Current Closing")
					)}</button>
				</div>
			</div>
		`;
	}

	async function do_close() {
		if (!state?.preview || !state?.controller) return;
		if (!is_online()) {
			frappe.msgprint(__("Closing the POS requires an online connection."));
			return;
		}
		const counts = await pending_counts();
		if (counts.pending_sales > 0) {
			frappe.msgprint(__("POS cannot be closed while offline sales are waiting to sync."));
			return;
		}

		const controller = state.controller;
		controller.begin_nozom_close?.();

		try {
			frappe.dom.freeze(__("Closing period..."));
			const r = await frappe.call({
				method: "nozom_pos.api.closing.submit_closing_entry",
				args: {
					pos_opening_entry: controller.pos_opening,
					payment_reconciliation: payment_payload(state.preview),
					period_end_date: state.preview.period_end_date,
					cash_denominations: cash_payload(),
				},
				freeze: false,
			});
			state.result = r.message;
			state.closed = true;

			controller.complete_nozom_close?.({
				result: state.result,
				preview: state.preview,
				cash_denominations: cash_payload(),
			});

			try {
				frappe.hide_msgprint?.();
			} catch (e) {
				/* ignore */
			}

			dialog.set_title(__("Period Closed Successfully"));
			dialog.$wrapper
				.removeClass("nozom-close-period-dialog")
				.addClass("nozom-post-close-dialog nozom-checkout-dialog");
			dialog.$wrapper.find(".modal-dialog").css({ width: "420px", "max-width": "min(420px, 94vw)" });
			dialog.$wrapper.find(".modal-header .btn-modal-close, .modal-header .close").hide();
			// Keep dialog open until an action is chosen
			dialog.disable_primary_action?.();
			const $body = dialog.$wrapper.find(".modal-body");
			$body.html(post_close_html(state.result));
			$body.find(".nozom-close-btn-desktop").on("click", () => exit_to_desktop(controller));
			$body.find(".nozom-close-btn-logout").on("click", function () {
				logout_user($(this));
			});
			$body.find(".nozom-close-btn-open-new").on("click", () => {
				dialog.hide();
				open_period_popup(controller, {
					company: state.preview.opening.company,
					pos_profile: state.preview.opening.pos_profile,
					after_close: true,
				});
			});
			$body.find(".nozom-close-btn-print").on("click", () => print_current_closing());
			nozom_pos.i18n?.apply_direction?.(nozom_pos.i18n.get());

			// Ensure our dialog sits above any leftover freeze overlay
			dialog.$wrapper.css("z-index", 1060);
		} catch (e) {
			controller.fail_nozom_close?.();
			const msg =
				e.message ||
				e.exc?.split?.("\n")?.filter?.(Boolean)?.pop?.() ||
				__("Could not close POS period.");
			frappe.msgprint({
				title: __("POS Closing Failed"),
				indicator: "red",
				message: msg,
			});
		} finally {
			frappe.dom.unfreeze();
		}
	}

	function print_current_closing() {
		const closing = state.result || state.controller?.nozom_last_closing?.result;
		const preview = state.preview || state.controller?.nozom_last_closing?.preview;
		if (!closing) {
			frappe.msgprint(__("Closing report data is unavailable."));
			return;
		}
		frappe
			.call({
				method: "nozom_pos.api.closing.get_closing_report_data",
				args: { closing_entry: closing.name },
				freeze: false,
			})
			.then((rr) => {
				print_closing({
					...rr.message,
					sales: preview?.sales,
					cash_denominations: closing.cash_denominations,
					actual_cash: closing.actual_cash,
					cash_difference: closing.cash_difference,
				});
			})
			.catch(() => {
				print_closing({
					...closing,
					company: preview?.opening?.company,
					currency: preview?.currency,
					cash: {
						opening_cash: preview?.cash?.opening_cash,
						expected_cash: preview?.cash?.expected_cash,
						actual_cash: closing.actual_cash,
						difference: closing.cash_difference,
					},
					invoice_count: preview?.invoice_count,
				});
			});
	}

	async function open(controller) {
		if (!controller?.pos_opening) {
			frappe.msgprint(__("No active POS Opening Entry."));
			return;
		}

		state = {
			controller,
			preview: null,
			result: null,
			closed: false,
			denoms: cd().empty_map(),
			selected_denom: 1000,
		};

		dialog = new frappe.ui.Dialog({
			title: __("Close Period"),
			size: "extra-large",
			static: true,
			fields: [{ fieldname: "html", fieldtype: "HTML" }],
		});
		dialog.$wrapper.addClass("nozom-pos-centered-dialog nozom-close-period-dialog");
		dialog.$wrapper.find(".modal-footer").hide();
		dialog.show();
		nozom_pos.i18n?.apply_direction?.(nozom_pos.i18n.get());

		const $body = dialog.fields_dict.html.$wrapper;
		$body.html(`<div class="text-muted" style="padding:1rem;">${esc(__("Loading..."))}</div>`);

		const online = is_online();
		const counts = await pending_counts();
		const meta = { online, pending_sales: counts.pending_sales, local_drafts: counts.local_drafts };

		if (!online) {
			$body.html(`
				<div class="nozom-close-period">
					${warnings_html(meta)}
					<div class="nozom-close-actions">
						<button type="button" class="btn nozom-close-btn-cancel">${esc(__("Cancel"))}</button>
					</div>
				</div>`);
			$body.find(".nozom-close-btn-cancel").on("click", () => dialog.hide());
			return;
		}

		try {
			frappe.dom.freeze(__("Loading closing summary..."));
			const r = await frappe.call({
				method: "nozom_pos.api.closing.get_closing_preview",
				args: { pos_opening_entry: controller.pos_opening },
				freeze: false,
			});
			state.preview = r.message;
			$body.html(main_html(state.preview, meta));
			bind_main($body, meta);
			nozom_pos.i18n?.apply_direction?.(nozom_pos.i18n.get());
		} catch (e) {
			$body.html(`
				<div class="nozom-close-warn is-danger">${esc(e.message || __("Could not load closing summary."))}</div>
				<div class="nozom-close-actions">
					<button type="button" class="btn nozom-close-btn-cancel">${esc(__("Cancel"))}</button>
				</div>`);
			$body.find(".nozom-close-btn-cancel").on("click", () => dialog.hide());
		} finally {
			frappe.dom.unfreeze();
		}
	}

	async function open_period_popup(controller, opts = {}) {
		const cd = nozom_pos.cash_denom;
		if (!cd) {
			frappe.msgprint(__("Cash count UI is unavailable."));
			return;
		}

		const online = is_online();
		let defaults = {};
		try {
			if (online) {
				const r = await frappe.call({
					method: "nozom_pos.api.closing.get_opening_defaults",
					args: {
						pos_profile: opts.pos_profile || controller.pos_profile,
						company: opts.company || controller.company,
					},
					freeze: false,
				});
				defaults = r.message || {};
			} else {
				defaults = {
					company: opts.company || controller.company,
					pos_profile: opts.pos_profile || controller.pos_profile,
					user: frappe.session.user,
					posting_date: frappe.datetime.get_today(),
					posting_time: "",
					payments: [],
				};
			}
		} catch (e) {
			defaults = {
				company: opts.company || controller.company,
				pos_profile: opts.pos_profile || controller.pos_profile,
				user: frappe.session.user,
				payments: [],
			};
		}

		const open_state = {
			defaults,
			denoms: cd.empty_map(),
			selected_denom: 1000,
			submitting: false,
			idempotency_key:
				(window.crypto && crypto.randomUUID && crypto.randomUUID()) ||
				`open-${Date.now()}-${Math.random().toString(16).slice(2)}`,
		};

		const currency = defaults.currency || undefined;

		function opening_html() {
			const pay_rows = (defaults.payments || [])
				.map((p) => {
					const is_cash = (p.type || "") === "Cash";
					const amt = is_cash ? cd.total(open_state.denoms) : flt(p.opening_amount);
					return `<div class="nz-sum-row">
						<span>${esc(__(p.mode_of_payment))}${
						is_cash ? ` <em class="muted">(${esc(__("from cash count"))})</em>` : ""
					}</span>
						<strong class="nozom-open-pay-amt" data-mode="${esc(p.mode_of_payment)}" data-cash="${
						is_cash ? 1 : 0
					}" dir="ltr">${cd.money(amt, currency)}</strong>
					</div>`;
				})
				.join("");

			const can_open = online && defaults.pos_profile && defaults.company && !(defaults.existing_open);
			const warn = !online
				? `<div class="nozom-close-warn is-danger">${esc(
						__("Opening a POS period requires an online connection.")
				  )}</div>`
				: defaults.existing_open
				? `<div class="nozom-close-warn is-danger">${esc(
						__(
							"POS Opening Entry {0} is already open. Close it before opening a new period.",
							[defaults.existing_open.name]
						)
				  )}</div>`
				: "";

			return `
			<div class="nozom-close-period nozom-open-period">
				${warn}
				<div class="nozom-close-layout nozom-close-layout--3col">
					<div class="nozom-close-grid nozom-close-grid--3col">
						<div class="nozom-close-col nozom-close-col--summaries">
							<div class="nozom-close-section nozom-close-session">
								<div class="nozom-close-section__title">${esc(__("Session"))}</div>
								<div class="nozom-close-session__grid">
									<div class="nz-sum-row"><span>${esc(__("Company"))}</span><strong>${esc(
				defaults.company || ""
			)}</strong></div>
									<div class="nz-sum-row"><span>${esc(__("POS Profile"))}</span><strong>${esc(
				defaults.pos_profile || ""
			)}</strong></div>
									<div class="nz-sum-row"><span>${esc(__("Cashier"))}</span><strong>${esc(
				defaults.user || frappe.session.user
			)}</strong></div>
									<div class="nz-sum-row"><span>${esc(__("Opening Date"))}</span><strong dir="ltr">${esc(
										frappe.datetime.str_to_user(defaults.posting_date || "")
									)}</strong></div>
									<div class="nz-sum-row"><span>${esc(__("Opening Time"))}</span><strong dir="ltr">${esc(
										defaults.posting_time || ""
									)}</strong></div>
								</div>
							</div>
							<div class="nozom-close-section">
								<div class="nozom-close-section__title">${esc(__("Opening Cash"))}</div>
								${
									pay_rows ||
									`<div class="muted">${esc(
										__("No Mode of Payment configured in POS Profile.")
									)}</div>`
								}
							</div>
						</div>
						<div class="nozom-close-col nozom-close-col--keypad">
							<div class="nozom-close-section nozom-close-keypad-card">
								${cd.keypad_html()}
							</div>
							<div class="nozom-close-total-box">
								<div class="nozom-close-total-box__label">${esc(__("Total Opening Cash"))}</div>
								<strong class="nozom-close-total-box__value nozom-open-total" dir="ltr">${cd.money(
									cd.total(open_state.denoms),
									currency
								)}</strong>
							</div>
						</div>
						<div class="nozom-close-col nozom-close-col--count">
							<div class="nozom-close-section nozom-close-count">
								<div class="nozom-close-section__title">${esc(__("Cash Count"))}</div>
								<div class="nozom-denom-list">${cd.denom_cols_html(
									open_state.denoms,
									open_state.selected_denom,
									currency
								)}</div>
							</div>
						</div>
					</div>
					<div class="nozom-close-actions nozom-close-actions--bottom">
						<button type="button" class="btn nozom-open-btn-submit" ${can_open ? "" : "disabled"}>${esc(
							__("Open Period")
						)}</button>
						<button type="button" class="btn nozom-open-btn-cancel">${esc(__("Cancel"))}</button>
					</div>
				</div>
			</div>`;
		}

		function refresh_open_ui($root) {
			$root.find(".nozom-denom-list").html(
				cd.denom_cols_html(open_state.denoms, open_state.selected_denom, currency)
			);
			const total = cd.total(open_state.denoms);
			$root.find(".nozom-open-total").text(cd.money(total, currency));
			$root.find(".nozom-open-pay-amt").each(function () {
				if (cint($(this).attr("data-cash"))) {
					$(this).text(cd.money(total, currency));
				}
			});
			bind_denom($root);
		}

		function bind_denom($root) {
			$root.find(".nozom-denom-row").off("click.nozom_open").on("click.nozom_open", function () {
				open_state.selected_denom = cd.normalize_denom($(this).attr("data-denom"));
				refresh_open_ui($root);
			});
		}

		function apply_key(key) {
			const denom = cd.normalize_denom(open_state.selected_denom);
			if (denom == null) return;
			cd.set_qty(open_state.denoms, denom, cd.apply_qty_key(cd.qty_of(open_state.denoms, denom), key));
		}

		const d = new frappe.ui.Dialog({
			title: __("Open Period"),
			size: "extra-large",
			static: true,
			fields: [{ fieldname: "html", fieldtype: "HTML" }],
		});
		d.$wrapper.addClass(
			"nozom-pos-centered-dialog nozom-open-period-dialog nozom-close-period-dialog"
		);
		d.$wrapper.find(".modal-footer").hide();
		const $root = d.fields_dict.html.$wrapper;
		$root.html(opening_html());
		d.show();
		nozom_pos.i18n?.apply_direction?.(nozom_pos.i18n.get());

		bind_denom($root);
		$root.find(".nozom-close-key").on("click", function () {
			apply_key($(this).attr("data-key"));
			refresh_open_ui($root);
		});
		$(document)
			.off("keydown.nozom_open_period")
			.on("keydown.nozom_open_period", (e) => {
				if (!d.display || open_state.submitting) return;
				if (/^\d$/.test(e.key) || e.key === "Backspace" || e.key === "c" || e.key === "C" || e.key === ".") {
					e.preventDefault();
					apply_key(e.key === "c" ? "C" : e.key);
					refresh_open_ui($root);
				}
			});
		d.$wrapper.on("hide.bs.modal", () => $(document).off("keydown.nozom_open_period"));

		$root.find(".nozom-open-btn-cancel").on("click", () => {
			d.hide();
			if (opts.after_close || controller.nozom_period_closed) {
				exit_to_desktop(controller);
			}
		});

		$root.find(".nozom-open-btn-submit").on("click", async function () {
			if (open_state.submitting) return;
			if (!is_online()) {
				frappe.msgprint(__("Opening a POS period requires an online connection."));
				return;
			}
			if (!defaults.pos_profile || !defaults.company) {
				frappe.msgprint(__("Company and POS Profile are required."));
				return;
			}
			if (defaults.existing_open) {
				frappe.msgprint(
					__(
						"POS Opening Entry {0} is already open. Close it before opening a new period.",
						[defaults.existing_open.name]
					)
				);
				return;
			}

			const balance_details = (defaults.payments || []).map((p) => ({
				mode_of_payment: p.mode_of_payment,
				opening_amount: (p.type || "") === "Cash" ? 0 : flt(p.opening_amount),
			}));
			if (!balance_details.length) {
				frappe.show_alert({
					message: __("Please add Mode of payments and opening balance details."),
					indicator: "red",
				});
				return;
			}

			open_state.submitting = true;
			const $btn = $(this);
			$btn.prop("disabled", true).text(__("Opening..."));

			// Preserve POS-only language across session reinit
			const pos_lang = nozom_pos.i18n?.get?.();

			try {
				frappe.dom.freeze(__("Opening period..."));
				const res = await frappe.call({
					method: "nozom_pos.api.closing.submit_opening_entry",
					args: {
						pos_profile: defaults.pos_profile,
						company: defaults.company,
						balance_details,
						cash_denominations: cd.payload(open_state.denoms),
						idempotency_key: open_state.idempotency_key,
					},
					freeze: false,
				});
				d.hide();
				try {
					await controller.clear_local_cart?.();
				} catch (e) {
					/* ignore */
				}
				controller.wrapper?.find?.(".point-of-sale-app")?.remove?.();
				await controller.prepare_app_defaults(res.message);
				if (pos_lang) {
					try {
						await nozom_pos.i18n?.apply?.(pos_lang, { refresh_ui: true });
					} catch (e) {
						nozom_pos.i18n?.apply_direction?.(pos_lang);
					}
				}
				frappe.show_alert({ message: __("POS period opened."), indicator: "green" });
			} catch (e) {
				frappe.msgprint(e.message || __("Could not open POS period."));
				open_state.submitting = false;
				$btn.prop("disabled", false).text(__("Open Period"));
			} finally {
				frappe.dom.unfreeze();
			}
		});
	}

	return { open, open_period_popup, print_closing };
})();
