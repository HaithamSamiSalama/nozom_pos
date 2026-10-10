frappe.provide("nozom_pos.offline");

nozom_pos.offline.admin_auth = (() => {
	const db = () => nozom_pos.offline.db;
	const CONFIG_PREFIX = "offline_admin_verifier::";

	function config_id(pos_profile) {
		return `${CONFIG_PREFIX}${pos_profile || ""}`;
	}

	function can_manage_offline_transactions() {
		const roles = frappe.user_roles || [];

		return (
			frappe.session?.user === "Administrator" ||
			roles.includes("System Manager")
		);
	}

	function hex_to_bytes(hex) {
		const bytes = new Uint8Array(hex.length / 2);

		for (let i = 0; i < bytes.length; i++) {
			bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
		}

		return bytes;
	}

	function bytes_to_hex(bytes) {
		return Array.from(bytes)
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
	}

	function safe_equal_hex(a, b) {
		const aa = cstr(a || "").toLowerCase();
		const bb = cstr(b || "").toLowerCase();

		let diff = aa.length ^ bb.length;
		const max = Math.max(aa.length, bb.length);

		for (let i = 0; i < max; i++) {
			diff |= (aa.charCodeAt(i) || 0) ^ (bb.charCodeAt(i) || 0);
		}

		return diff === 0;
	}

	async function get_cached(pos_profile) {
		return db().get("config", config_id(pos_profile));
	}

	async function cache_verifier(pos_profile, data = {}) {
		const record = {
			id: config_id(pos_profile),
			type: "offline_admin_verifier",
			pos_profile,
			configured: Boolean(data.configured),
			version: data.version || 1,
			algorithm: data.algorithm || "",
			iterations: cint(data.iterations || 0),
			salt: data.salt || "",
			verifier: data.verifier || "",
			profile_modified: data.profile_modified || "",
			updated_at: new Date().toISOString(),
		};

		await db().put("config", record);
		return record;
	}

	async function refresh(pos_profile) {
		if (!can_manage_offline_transactions()) {
			throw new Error(
				__("Only an administrator can manage failed offline transactions.")
			);
		}

		const result = await frappe.call({
			method: "nozom_pos.api.offline_admin.get_offline_admin_verifier",
			args: { pos_profile },
			freeze: false,
		});

		return cache_verifier(pos_profile, result.message || {});
	}

	async function derive(password, record) {
		if (!window.crypto?.subtle) {
			throw new Error(
				__("Secure password verification is not supported by this browser.")
			);
		}

		const key = await window.crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(password || ""),
			"PBKDF2",
			false,
			["deriveBits"]
		);

		const bits = await window.crypto.subtle.deriveBits(
			{
				name: "PBKDF2",
				hash: "SHA-256",
				salt: hex_to_bytes(record.salt),
				iterations: cint(record.iterations),
			},
			key,
			256
		);

		return bytes_to_hex(new Uint8Array(bits));
	}

	async function verify(pos_profile, password) {
		if (!can_manage_offline_transactions()) {
			return {
				ok: false,
				reason: __(
					"Only an administrator can manage failed offline transactions."
				),
			};
		}

		let record = await get_cached(pos_profile);

		const online =
			nozom_pos.offline.network?.is_online?.() ??
			window.navigator?.onLine ??
			true;

		if (online) {
			try {
				record = await refresh(pos_profile);
			} catch (e) {
				if (!record) {
					return {
						ok: false,
						reason: __(
							"Admin password is not available on this device. Connect to the internet and refresh POS settings."
						),
					};
				}
			}
		}

		if (!record) {
			return {
				ok: false,
				reason: __(
					"Admin password is not available on this device. Connect to the internet and refresh POS settings."
				),
			};
		}

		if (
			!record.configured ||
			!record.verifier ||
			!record.salt ||
			!record.iterations
		) {
			return {
				ok: false,
				reason: __(
					"Offline transaction admin password is not configured for this POS Profile."
				),
			};
		}

		const candidate = await derive(password, record);

		return {
			ok: safe_equal_hex(candidate, record.verifier),
			reason: __("Invalid admin password."),
		};
	}

	return {
		can_manage_offline_transactions,
		get_cached,
		cache_verifier,
		refresh,
		verify,
	};
})();
