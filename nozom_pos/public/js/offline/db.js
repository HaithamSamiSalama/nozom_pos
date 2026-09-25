frappe.provide("nozom_pos.offline");

/**
 * Minimal IndexedDB helper for NOZOM POS local-first.
 * No external deps — reusable later inside a desktop shell.
 */
nozom_pos.offline.db = (() => {
	const DB_NAME = "nozom_pos_offline";
	const DB_VERSION = 7;
	const STORES = [
		"config",
		"items",
		"meta",
		"tx_queue",
		"active_cart",
		"recent_orders",
		"customers",
		"item_groups",
		"customer_queue",
		"local_drafts",
		"addresses",
		"address_queue",
	];

	let db_promise = null;

	function open() {
		if (db_promise) return db_promise;

		db_promise = new Promise((resolve, reject) => {
			if (!window.indexedDB) {
				reject(new Error("IndexedDB is not available"));
				return;
			}

			const request = indexedDB.open(DB_NAME, DB_VERSION);

			request.onupgradeneeded = (event) => {
				const db = event.target.result;
				STORES.forEach((name) => {
					if (!db.objectStoreNames.contains(name)) {
						db.createObjectStore(name, { keyPath: "id" });
					}
				});
			};

			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
		});

		return db_promise;
	}

	function with_store(store_name, mode, fn) {
		return open().then(
			(db) =>
				new Promise((resolve, reject) => {
					const tx = db.transaction(store_name, mode);
					const store = tx.objectStore(store_name);
					let result;

					try {
						result = fn(store);
					} catch (e) {
						reject(e);
						return;
					}

					tx.oncomplete = () => resolve(result);
					tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
					tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
				})
		);
	}

	function request_to_promise(request) {
		return new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}

	async function get(store_name, id) {
		const db = await open();
		return request_to_promise(db.transaction(store_name, "readonly").objectStore(store_name).get(id));
	}

	async function put(store_name, record) {
		await with_store(store_name, "readwrite", (store) => store.put(record));
		return record;
	}

	async function remove(store_name, id) {
		await with_store(store_name, "readwrite", (store) => store.delete(id));
	}

	async function get_all(store_name) {
		const db = await open();
		return request_to_promise(db.transaction(store_name, "readonly").objectStore(store_name).getAll());
	}

	async function put_many(store_name, records) {
		if (!records?.length) return;
		await with_store(store_name, "readwrite", (store) => {
			records.forEach((record) => store.put(record));
		});
	}

	async function clear(store_name) {
		await with_store(store_name, "readwrite", (store) => store.clear());
	}

	async function count(store_name) {
		const db = await open();
		return request_to_promise(db.transaction(store_name, "readonly").objectStore(store_name).count());
	}

	return {
		DB_NAME,
		DB_VERSION,
		open,
		get,
		put,
		remove,
		get_all,
		put_many,
		clear,
		count,
	};
})();
