frappe.provide("nozom_pos.offline");

/**
 * Background flush of queued offline sales.
 * Retries only when there is pending work, with conservative backoff.
 * No heartbeat / connectivity polling.
 */
nozom_pos.offline.sync_worker = (() => {
	let running = false;
	let timer = null;
	let controller_ctx = null;
	let current_delay_ms = 5000;
	let net_bound = false;

	const DELAYS_MS = [5000, 10000, 20000, 30000, 45000, 60000];

	function set_ctx(ctx) {
		controller_ctx = ctx || null;
	}

	function next_delay(from_ms) {
		const cur = cint(from_ms) || DELAYS_MS[0];
		const idx = DELAYS_MS.findIndex((d) => d >= cur);
		if (idx < 0) return DELAYS_MS[DELAYS_MS.length - 1];
		return DELAYS_MS[Math.min(idx + 1, DELAYS_MS.length - 1)];
	}

	async function has_pending() {
		try {
			const counts = await nozom_pos.offline.tx_queue.counts();
			const cust = await nozom_pos.offline.customer_store?.list_ready?.(5);
			const addrs = await nozom_pos.offline.address_store?.list_ready?.(5);
			const drafts = await nozom_pos.offline.draft_store?.list_ready?.(5);
			return (
				cint(counts.queued) + cint(counts.syncing) + cint(counts.failed) > 0 ||
				Boolean(cust?.length) ||
				Boolean(addrs?.length) ||
				Boolean(drafts?.length)
			);
		} catch (e) {
			return false;
		}
	}

	async function flush_drafts({ limit = 20 } = {}) {
		const store = nozom_pos.offline.draft_store;
		if (!store?.list_ready) return { synced: 0, failed: 0, conflicts: 0 };

		const batch = await store.list_ready(limit);
		if (!batch.length) return { synced: 0, failed: 0, conflicts: 0 };

		// Resolve local customers on drafts before sync
		const resolved = [];
		for (const draft of batch) {
			try {
				if (draft.customer && nozom_pos.offline.customer_store?.is_local_id?.(draft.customer)) {
					const mapped = await nozom_pos.offline.customer_store.resolve_server_name(
						draft.pos_profile,
						draft.customer
					);
					if (!mapped) {
						await store.update(draft.id, {
							last_error: __("Customer must sync before the draft."),
						});
						continue;
					}
					await store.update(draft.id, {
						customer: mapped,
						local_customer_id: draft.customer,
					});
					resolved.push({ ...draft, customer: mapped, local_customer_id: draft.customer });
				} else {
					resolved.push(draft);
				}
			} catch (e) {
				await store.mark_failed(draft.id, e.message);
			}
		}

		if (!resolved.length) return { synced: 0, failed: 0, conflicts: 0 };

		const request = nozom_pos.offline.request;
		let response = null;
		try {
			const r = request
				? await request.call({
						method: "nozom_pos.api.offline.sync_drafts",
						args: { payloads: resolved },
						timeout_ms: 12000,
						timeout_label: "draft_sync",
				  })
				: await new Promise((resolve, reject) => {
						frappe.call({
							method: "nozom_pos.api.offline.sync_drafts",
							args: { payloads: resolved },
							freeze: false,
							callback: (res) => resolve(res),
							error: (err) => reject(err),
						});
				  });
			response = r.message || { results: [] };
			nozom_pos.offline.network.mark_reachable({ reason: "draft_sync_ok" });
		} catch (err) {
			nozom_pos.offline.network.mark_unreachable({ reason: "draft_sync_transport" });
			for (const row of resolved) {
				await store.mark_failed(row.id, err?.message || __("Network error while syncing drafts"));
			}
			return { synced: 0, failed: resolved.length, conflicts: 0 };
		}

		const results = response.results || [];
		let synced = 0;
		let failed = 0;
		let conflicts = 0;

		for (let i = 0; i < resolved.length; i++) {
			const row = resolved[i];
			const result =
				results.find((r) => r.local_uuid === row.id || r.local_uuid === row.local_uuid) ||
				results.find((r) => r.idempotency_key === row.idempotency_key) ||
				results[i] || { status: "FAILED", message: __("Missing draft sync result") };

			if (result.status === "SYNCED" && result.name) {
				await store.mark_synced(row.id, result.doctype, result.name);
				synced += 1;
			} else if (result.status === "CONFLICT") {
				await store.mark_failed(row.id, result.message || result.error_code, true);
				conflicts += 1;
			} else {
				await store.mark_failed(row.id, result.message || result.error_code || __("Draft sync failed"));
				failed += 1;
			}
		}

		return { synced, failed, conflicts };
	}

	async function flush_customers({ limit = 20 } = {}) {
		const store = nozom_pos.offline.customer_store;
		if (!store?.list_ready) return { synced: 0, failed: 0, conflicts: 0 };

		const batch = await store.list_ready(limit);
		if (!batch.length) return { synced: 0, failed: 0, conflicts: 0 };

		const request = nozom_pos.offline.request;
		let response = null;
		try {
			const r = request
				? await request.call({
						method: "nozom_pos.api.offline.sync_customers",
						args: { payloads: batch },
						timeout_ms: 12000,
						timeout_label: "customer_sync",
				  })
				: await new Promise((resolve, reject) => {
						frappe.call({
							method: "nozom_pos.api.offline.sync_customers",
							args: { payloads: batch },
							freeze: false,
							callback: (res) => resolve(res),
							error: (err) => reject(err),
						});
				  });
			response = r.message || { results: [] };
			nozom_pos.offline.network.mark_reachable({ reason: "customer_sync_ok" });
		} catch (err) {
			nozom_pos.offline.network.mark_unreachable({ reason: "customer_sync_transport" });
			for (const row of batch) {
				await store.mark_failed(row, err?.message || __("Network error while syncing customers"));
			}
			return { synced: 0, failed: batch.length, conflicts: 0 };
		}

		const results = response.results || [];
		let synced = 0;
		let failed = 0;
		let conflicts = 0;

		for (let i = 0; i < batch.length; i++) {
			const row = batch[i];
			const result =
				results.find((r) => r.local_customer_id === row.local_customer_id) ||
				results.find((r) => r.idempotency_key === row.idempotency_key) ||
				results[i] || {
					status: "FAILED",
					message: __("Missing result for customer sync"),
				};

			if (result.status === "SYNCED" && result.server_customer_name) {
				await store.mark_synced(row, result.server_customer_name, {
					server_address_name: result.server_address_name || null,
				});

				// Remap any queued invoices still pointing at the local customer id
				const pending = await nozom_pos.offline.tx_queue.list_pending();
				for (const tx of pending) {
					if (tx.customer === row.local_customer_id || tx.local_customer_id === row.local_customer_id) {
						await nozom_pos.offline.tx_queue.update(tx.id, {
							customer: result.server_customer_name,
							local_customer_id: row.local_customer_id,
							customer_name: tx.customer_name,
						});
					}
				}
				synced += 1;
			} else if (result.status === "CONFLICT") {
				await store.mark_failed(row, result.message || result.error_code, true);
				conflicts += 1;
			} else {
				await store.mark_failed(row, result.message || result.error_code || __("Customer sync failed"));
				failed += 1;
			}
		}

		return { synced, failed, conflicts };
	}

	async function flush_addresses({ limit = 20 } = {}) {
		const store = nozom_pos.offline.address_store;
		if (!store?.list_ready) return { synced: 0, failed: 0, conflicts: 0 };

		const batch = await store.list_ready(limit);
		if (!batch.length) return { synced: 0, failed: 0, conflicts: 0 };

		// Resolve local customer → server customer before address sync
		const resolved_batch = [];
		for (const row of batch) {
			const payload = { ...(row.payload || {}), ...row };
			if (
				payload.local_customer_id &&
				nozom_pos.offline.customer_store?.is_local_id?.(payload.local_customer_id)
			) {
				const server = await nozom_pos.offline.customer_store.resolve_server_name(
					row.pos_profile,
					payload.local_customer_id
				);
				if (!server) {
					await store.mark_failed(
						row,
						__("Customer must sync before Address."),
						false
					);
					continue;
				}
				payload.server_customer_name = server;
				payload.customer = server;
			}
			resolved_batch.push({ row, payload });
		}

		if (!resolved_batch.length) return { synced: 0, failed: batch.length, conflicts: 0 };

		const request = nozom_pos.offline.request;
		let response = null;
		try {
			const r = request
				? await request.call({
						method: "nozom_pos.api.address.sync_addresses",
						args: { payloads: resolved_batch.map((x) => ({ ...x.row, payload: x.payload })) },
						timeout_ms: 12000,
						timeout_label: "address_sync",
				  })
				: await new Promise((resolve, reject) => {
						frappe.call({
							method: "nozom_pos.api.address.sync_addresses",
							args: { payloads: resolved_batch.map((x) => ({ ...x.row, payload: x.payload })) },
							freeze: false,
							callback: (res) => resolve(res),
							error: (err) => reject(err),
						});
				  });
			response = r.message || { results: [] };
			nozom_pos.offline.network.mark_reachable({ reason: "address_sync_ok" });
		} catch (err) {
			nozom_pos.offline.network.mark_unreachable({ reason: "address_sync_transport" });
			for (const { row } of resolved_batch) {
				await store.mark_failed(row, err?.message || __("Network error while syncing addresses"));
			}
			return { synced: 0, failed: resolved_batch.length, conflicts: 0 };
		}

		const results = response.results || [];
		let synced = 0;
		let failed = 0;
		let conflicts = 0;

		for (let i = 0; i < resolved_batch.length; i++) {
			const { row } = resolved_batch[i];
			const result =
				results.find((r) => r.local_address_id === row.local_address_id) ||
				results.find((r) => r.idempotency_key === row.idempotency_key) ||
				results[i] || {
					status: "FAILED",
					message: __("Missing result for address sync"),
				};

			if (result.status === "SYNCED" && result.server_address_name) {
				await store.mark_synced(row, result.server_address_name, {
					server_customer_name: result.server_customer_name,
					modified: result.modified,
				});

				const pending = await nozom_pos.offline.tx_queue.list_pending();
				for (const tx of pending) {
					if (
						tx.local_address_id === row.local_address_id ||
						tx.customer_address === row.local_address_id ||
						tx.shipping_address_name === row.local_address_id
					) {
						await nozom_pos.offline.tx_queue.update(tx.id, {
							customer_address: result.server_address_name,
							shipping_address_name: result.server_address_name,
							local_address_id: row.local_address_id,
						});
					}
				}
				synced += 1;
			} else if (result.status === "CONFLICT") {
				await store.mark_failed(row, result.message || result.error_code, true);
				conflicts += 1;
			} else {
				await store.mark_failed(row, result.message || result.error_code || __("Address sync failed"));
				failed += 1;
			}
		}

		return { synced, failed, conflicts };
	}

	async function flush({ limit = 10 } = {}) {
		if (running) return { skipped: true };
		if (!nozom_pos.offline.network.is_online()) {
			if (await has_pending()) schedule_retry(current_delay_ms || DELAYS_MS[0]);
			return { offline: true };
		}

		running = true;
		let summary = {
			synced: 0,
			failed: 0,
			conflicts: 0,
			batch_size: 0,
			customers: null,
			addresses: null,
			drafts: null,
		};

		try {
			// Customer → Address → Draft/Invoice
			summary.customers = await flush_customers({ limit: 20 });
			summary.addresses = await flush_addresses({ limit: 20 });
			summary.drafts = await flush_drafts({ limit: 20 });

			const ready = await nozom_pos.offline.tx_queue.list_ready(limit);
			const batch = [];
			for (const tx of ready) {
				try {
					const resolved = await nozom_pos.offline.customer_store.ensure_invoice_customer(tx);
					let next = { ...tx, ...resolved };

					// Address dependency: local address must sync before invoice
					const local_addr =
						next.local_address_id ||
						(nozom_pos.offline.address_store?.is_local_id?.(next.customer_address)
							? next.customer_address
							: null) ||
						(nozom_pos.offline.address_store?.is_local_id?.(next.shipping_address_name)
							? next.shipping_address_name
							: null);
					if (local_addr && nozom_pos.offline.address_store?.is_local_id?.(local_addr)) {
						const server_addr = await nozom_pos.offline.address_store.resolve_server_name(
							next.pos_profile,
							local_addr
						);
						if (!server_addr) {
							await nozom_pos.offline.tx_queue.update(tx.id, {
								last_error: __("Address must sync before the invoice."),
								status: "QUEUED",
								sync_status: "QUEUED",
							});
							continue;
						}
						next = {
							...next,
							customer_address: server_addr,
							shipping_address_name: server_addr,
							local_address_id: local_addr,
						};
					}

					if (next.customer !== tx.customer || next.customer_address !== tx.customer_address) {
						await nozom_pos.offline.tx_queue.update(tx.id, {
							customer: next.customer,
							local_customer_id: next.local_customer_id || tx.local_customer_id,
							customer_address: next.customer_address,
							shipping_address_name: next.shipping_address_name,
							local_address_id: next.local_address_id || tx.local_address_id,
						});
					}
					batch.push(next);
				} catch (dep_err) {
					// Leave invoice queued — customer/address dependency not ready
					await nozom_pos.offline.tx_queue.update(tx.id, {
						last_error: dep_err.message,
						status: "QUEUED",
						sync_status: "QUEUED",
					});
				}
			}

			if (!batch.length) {
				current_delay_ms = DELAYS_MS[0];
				if (await has_pending()) schedule_retry(next_delay(current_delay_ms));
				return summary;
			}

			for (const tx of batch) {
				await nozom_pos.offline.tx_queue.update(tx.id, {
					status: "SYNCING",
					sync_status: "SYNCING",
				});
			}
			await refresh_ui();

			const request = nozom_pos.offline.request;
			let response = null;
			try {
				const r = request
					? await request.call({
							method: "nozom_pos.api.offline.sync_transactions",
							args: { payloads: batch },
							timeout_ms: 12000,
							timeout_label: "sync",
					  })
					: await new Promise((resolve, reject) => {
							frappe.call({
								method: "nozom_pos.api.offline.sync_transactions",
								args: { payloads: batch },
								freeze: false,
								callback: (res) => resolve(res),
								error: (err) => reject(err),
							});
					  });
				response = r.message || { results: [] };
				nozom_pos.offline.network.mark_reachable({ reason: "sync_ok" });
			} catch (err) {
				nozom_pos.offline.network.mark_unreachable({ reason: "sync_transport" });
				for (const tx of batch) {
					await nozom_pos.offline.tx_queue.mark_failed(
						tx.id,
						err?.message || __("Network error while syncing"),
						cint(tx.retry_count) + 1
					);
				}
				summary.failed = batch.length;
				schedule_retry(next_delay(current_delay_ms));
				return summary;
			}

			const results = response.results || [];
			summary.batch_size = results.length;
			summary.synced = cint(response.synced);
			summary.failed = cint(response.failed);
			summary.conflicts = cint(response.conflicts);

			const by_key = {};
			const by_local = {};
			results.forEach((result) => {
				if (result.idempotency_key) by_key[result.idempotency_key] = result;
				if (result.local_uuid) by_local[result.local_uuid] = result;
			});

			for (const tx of batch) {
				const result =
					by_local[tx.id] ||
					by_local[tx.local_uuid] ||
					by_key[tx.idempotency_key] || {
						status: "FAILED",
						message: __("Missing result for queued sale"),
					};

				await apply_result(tx, result);

				if (result.status === "SYNCED") {
					frappe.show_alert({
						message: __("Offline sale {0} synced as {1}", [
							tx.local_receipt_no,
							result.name,
						]),
						indicator: "green",
					});
				} else if (result.status === "CONFLICT") {
					frappe.show_alert({
						message: __("Offline sale conflict: {0}", [
							result.message || tx.local_receipt_no,
						]),
						indicator: "red",
					});
				}
			}

			if (summary.conflicts > 0) {
				nozom_pos.offline.status_ui.update({
					message: __("Tap Sync Queue to review conflicts"),
				});
			}

			if (await has_pending()) {
				schedule_retry(DELAYS_MS[0]);
			} else {
				current_delay_ms = DELAYS_MS[0];
			}
		} finally {
			running = false;
			await refresh_ui();
		}

		return summary;
	}

	async function refresh_ui() {
		const counts = await nozom_pos.offline.tx_queue.counts();
		nozom_pos.offline.status_ui.update({
			online: nozom_pos.offline.network.is_online(),
			queued: counts.queued,
			syncing: counts.syncing,
			conflicts: counts.conflicts,
		});
		if (nozom_pos.offline.refresh_status) {
			await nozom_pos.offline.refresh_status();
		}
	}

	function clear_schedule() {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
	}

	function schedule_retry(delay_ms) {
		clear_schedule();
		current_delay_ms = cint(delay_ms) || DELAYS_MS[0];
		timer = setTimeout(async () => {
			timer = null;
			const pending = await has_pending();
			if (!pending) {
				current_delay_ms = DELAYS_MS[0];
				return;
			}
			// Soft reachability check only because we have work to do
			if (!nozom_pos.offline.network.is_online()) {
				await nozom_pos.offline.network.probe({ timeout_ms: 2500 });
			}
			if (nozom_pos.offline.network.is_online()) {
				await flush();
			} else {
				schedule_retry(next_delay(current_delay_ms));
			}
		}, current_delay_ms);
	}

	function apply_result(tx, result) {
		if (result.status === "SYNCED") {
			return nozom_pos.offline.tx_queue.update(tx.id, {
				status: "SYNCED",
				sync_status: "SYNCED",
				server_doctype: result.doctype,
				server_name: result.name,
				last_error: null,
				next_retry_at: null,
				synced_at: new Date().toISOString(),
			});
		}

		if (result.status === "CONFLICT") {
			return nozom_pos.offline.tx_queue.update(tx.id, {
				status: "CONFLICT",
				sync_status: "CONFLICT",
				last_error: result.message || result.error_code,
				retry_count: cint(tx.retry_count) + 1,
				next_retry_at: null,
			});
		}

		const retry_count = cint(tx.retry_count) + 1;
		return nozom_pos.offline.tx_queue.mark_failed(
			tx.id,
			result.message || result.error_code || __("Sync failed"),
			retry_count
		);
	}

	async function on_browser_online() {
		if (!(await has_pending())) return;
		current_delay_ms = DELAYS_MS[0];
		schedule_retry(800);
	}

	function start() {
		if (!net_bound) {
			net_bound = true;
			nozom_pos.offline.network.on_change((net) => {
				if (net.online) {
					current_delay_ms = DELAYS_MS[0];
					flush();
				} else {
					has_pending().then((pending) => {
						if (pending) schedule_retry(DELAYS_MS[0]);
					});
				}
			});
		}

		// If queue already has work at boot, schedule a conservative retry.
		has_pending().then((pending) => {
			if (pending) schedule_retry(DELAYS_MS[0]);
		});
	}

	return {
		set_ctx,
		start,
		flush,
		refresh_ui,
		on_browser_online,
		schedule_retry,
	};
})();
