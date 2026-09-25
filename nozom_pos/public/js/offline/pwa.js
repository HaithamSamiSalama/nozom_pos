frappe.provide("nozom_pos.offline");

/**
 * Phase E — POS-scoped PWA registration.
 * Registers only while Point of Sale is open. Does not take over Desk globally
 * beyond a careful /app/ service-worker scope with POS-focused fetch rules.
 */
nozom_pos.offline.pwa = (() => {
	const MANIFEST_HREF = "/nozom-pos.webmanifest";
	const MANIFEST_FALLBACK = "/assets/nozom_pos/pwa/manifest.webmanifest";
	const SW_URL = "/sw-nozom-pos.js";
	let deferred_prompt = null;
	let registered = false;

	function ensure_manifest_link() {
		let link = document.querySelector('link[rel="manifest"][data-nozom-pos="1"]');
		if (!link) {
			link = document.createElement("link");
			link.rel = "manifest";
			link.href = MANIFEST_HREF;
			link.setAttribute("data-nozom-pos", "1");
			document.head.appendChild(link);
			// Fallback if www manifest is blocked
			fetch(MANIFEST_HREF, { method: "HEAD" }).catch(() => {
				link.href = MANIFEST_FALLBACK;
			});
		}
		let theme = document.querySelector('meta[name="theme-color"][data-nozom-pos="1"]');
		if (!theme) {
			theme = document.createElement("meta");
			theme.name = "theme-color";
			theme.content = "#1F272E";
			theme.setAttribute("data-nozom-pos", "1");
			document.head.appendChild(theme);
		}
	}

	function collect_pos_asset_urls() {
		const urls = new Set();
		document.querySelectorAll("script[src], link[rel='stylesheet'][href]").forEach((el) => {
			const src = el.src || el.href;
			if (!src) return;
			if (
				src.includes("nozom_pos") ||
				src.includes("point-of-sale") ||
				src.includes("/assets/frappe/") ||
				src.includes("/assets/erpnext/")
			) {
				urls.add(src);
			}
		});
		urls.add("/assets/nozom_pos/images/nozom-pos.svg");
		urls.add(MANIFEST_HREF);
		return Array.from(urls);
	}

	async function post_urls_to_sw(reg) {
		const worker = reg.active || reg.waiting || reg.installing;
		if (!worker) return;
		worker.postMessage({
			type: "NOZOM_POS_CACHE_URLS",
			urls: collect_pos_asset_urls(),
		});
	}

	async function register() {
		if (registered) return null;
		if (!("serviceWorker" in navigator)) {
			console.warn("NOZOM POS: Service Worker not supported");
			return null;
		}

		ensure_manifest_link();

		try {
			const reg = await navigator.serviceWorker.register(SW_URL, {
				scope: "/app/",
				updateViaCache: "none",
			});
			registered = true;

			reg.addEventListener("updatefound", () => {
				const installing = reg.installing;
				if (!installing) return;
				installing.addEventListener("statechange", () => {
					if (installing.state === "installed" && navigator.serviceWorker.controller) {
						frappe.show_alert({
							message: __("NOZOM POS update ready. Reload to apply."),
							indicator: "blue",
						});
					}
				});
			});

			await post_urls_to_sw(reg);

			if (reg.waiting) {
				frappe.show_alert({
					message: __("NOZOM POS update ready. Reload to apply."),
					indicator: "blue",
				});
			}

			return reg;
		} catch (e) {
			console.warn("NOZOM POS Service Worker registration failed:", e);
			return null;
		}
	}

	function listen_install_prompt() {
		window.addEventListener("beforeinstallprompt", (e) => {
			e.preventDefault();
			deferred_prompt = e;
			if (window.nozom_pos?.offline?.status_ui) {
				nozom_pos.offline.status_ui.update({
					message: __("Install available"),
				});
			}
		});

		window.addEventListener("appinstalled", () => {
			deferred_prompt = null;
			frappe.show_alert({
				message: __("NOZOM POS installed on this device."),
				indicator: "green",
			});
		});
	}

	async function prompt_install() {
		if (!deferred_prompt) {
			frappe.show_alert({
				message: __(
					"Install is not available yet. Use the browser menu: Add to Home Screen / Install app."
				),
				indicator: "orange",
			});
			return false;
		}
		deferred_prompt.prompt();
		const choice = await deferred_prompt.userChoice;
		deferred_prompt = null;
		return choice.outcome === "accepted";
	}

	async function check_for_updates() {
		if (!("serviceWorker" in navigator)) return;
		const reg = await navigator.serviceWorker.getRegistration("/app/");
		if (!reg) return;
		await reg.update();
		if (reg.waiting) {
			reg.waiting.postMessage({ type: "NOZOM_POS_SKIP_WAITING" });
			frappe.show_alert({
				message: __("Applying NOZOM POS update…"),
				indicator: "blue",
			});
			setTimeout(() => window.location.reload(), 600);
		} else {
			frappe.show_alert({
				message: __("NOZOM POS is up to date."),
				indicator: "green",
			});
		}
	}

	function init() {
		listen_install_prompt();
		return register();
	}

	return {
		init,
		register,
		prompt_install,
		check_for_updates,
		collect_pos_asset_urls,
	};
})();
