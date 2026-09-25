/* NOZOM POS Service Worker — Phase E
 *
 * Goals:
 * - Cache NOZOM/POS static assets for faster reload and weak networks
 * - Never cache API mutations or invent successful offline API responses
 * - Avoid breaking the rest of Frappe Desk
 */

const SW_VERSION = "nozom-pos-sw-v1";
const ASSET_CACHE = `nozom-pos-assets-${SW_VERSION}`;
const SHELL_CACHE = `nozom-pos-shell-${SW_VERSION}`;

const PRECACHE_URLS = [
	"/assets/nozom_pos/images/nozom-pos.svg",
	"/nozom-pos.webmanifest",
];

function is_api_request(url) {
	return url.pathname.startsWith("/api/");
}

function is_nozom_or_pos_asset(url) {
	const p = url.pathname;
	return (
		p.includes("/assets/nozom_pos/") ||
		p.includes("nozom_pos.bundle") ||
		p.includes("point-of-sale.bundle") ||
		p.endsWith("/nozom-pos.webmanifest") ||
		p.endsWith("/sw-nozom-pos.js")
	);
}

function is_pos_navigation(url, request) {
	if (request.mode !== "navigate") return false;
	return p_includes_pos(url.pathname);
}

function p_includes_pos(pathname) {
	return (
		pathname === "/app/point-of-sale" ||
		pathname.startsWith("/app/point-of-sale/") ||
		pathname === "/desk/point-of-sale" ||
		pathname.startsWith("/desk/point-of-sale") ||
		pathname.includes("/point-of-sale")
	);
}

async function cache_first(request) {
	const cache = await caches.open(ASSET_CACHE);
	const cached = await cache.match(request, { ignoreSearch: false });
	if (cached) {
		// Revalidate in background
		fetch(request)
			.then((response) => {
				if (response && response.ok) cache.put(request, response.clone());
			})
			.catch(() => {});
		return cached;
	}
	const response = await fetch(request);
	if (response && response.ok) {
		cache.put(request, response.clone());
	}
	return response;
}

async function network_first(request) {
	const cache = await caches.open(SHELL_CACHE);
	try {
		const response = await fetch(request);
		if (response && response.ok) {
			cache.put(request, response.clone());
		}
		return response;
	} catch (e) {
		const cached = await cache.match(request);
		if (cached) return cached;
		return new Response(
			"<h1>NOZOM POS offline</h1><p>Connection unavailable. Open POS again when online to refresh the app shell.</p>",
			{ status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
		);
	}
}

self.addEventListener("install", (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(ASSET_CACHE);
			await cache.addAll(PRECACHE_URLS.map((u) => new Request(u, { cache: "reload" })));
			await self.skipWaiting();
		})()
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(
				keys
					.filter((key) => key.startsWith("nozom-pos-") && key !== ASSET_CACHE && key !== SHELL_CACHE)
					.map((key) => caches.delete(key))
			);
			await self.clients.claim();
		})()
	);
});

self.addEventListener("message", (event) => {
	const data = event.data || {};
	if (data.type === "NOZOM_POS_SKIP_WAITING") {
		self.skipWaiting();
		return;
	}
	if (data.type === "NOZOM_POS_CACHE_URLS" && Array.isArray(data.urls)) {
		event.waitUntil(
			(async () => {
				const cache = await caches.open(ASSET_CACHE);
				for (const url of data.urls) {
					try {
						const response = await fetch(url, { cache: "reload", credentials: "same-origin" });
						if (response && response.ok) {
							await cache.put(url, response.clone());
						}
					} catch (e) {
						/* ignore individual asset failures */
					}
				}
			})()
		);
	}
});

self.addEventListener("fetch", (event) => {
	const request = event.request;
	if (request.method !== "GET") {
		return;
	}

	const url = new URL(request.url);
	if (url.origin !== self.location.origin) {
		return;
	}

	// Never touch API — desk auth/mutations must stay network-only
	if (is_api_request(url)) {
		return;
	}

	if (is_nozom_or_pos_asset(url)) {
		event.respondWith(cache_first(request));
		return;
	}

	if (is_pos_navigation(url, request)) {
		event.respondWith(network_first(request));
	}
});
