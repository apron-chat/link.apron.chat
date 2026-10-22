// @ts-check
/**
 * The client registry (clients.json) and the blocklist (blocked.json): their
 * checks, what the page offers for a link, and the app association files
 * built from them. Pure functions, shared by the page, the build and the tests.
 */

/** @typedef {import('./link.js').Link} Link */
/** @typedef {import('./link.js').Server} Server */

/**
 * @typedef {object} WebOpen how a web client opens a link: its keys, renamed, in its URL's query or fragment
 * @property {string} url
 * @property {Record<string, string>} [query] link key → the client's key
 * @property {Record<string, string>} [fragment] link key → the client's key
 */

/**
 * @typedef {object} Client
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {string} homepage
 * @property {string} [source]
 * @property {string[]} transports the `server` transports it can open
 * @property {WebOpen} [web]
 * @property {{ app_ids: string[], store?: string }} [ios]
 * @property {{ package: string, sha256_cert_fingerprints: string[], store?: string }} [android]
 * @property {{ download: string }} [desktop]
 */

/** @typedef {{ clients: Client[] }} Registry */
/** @typedef {{ host: string, reason: string }} Blocked */
/** @typedef {'ios' | 'android' | 'desktop'} Platform */

/**
 * What the page offers for one client:
 * @typedef {{ client: Client, kind: 'web', href: string }
 *   | { client: Client, kind: 'native', href: string }} Offer
 */

/** Link keys a web client can take. */
const LINK_KEYS = ['server', 'room', 'thread', 'message'];
const CLIENT_KEYS = ['id', 'name', 'description', 'homepage', 'source', 'transports', 'web', 'ios', 'android', 'desktop'];

/**
 * Checks the registry. Returns the problems found, empty when there are none.
 * @param {unknown} data
 * @returns {string[]}
 */
export function checkRegistry(data) {
	/** @type {string[]} */
	const problems = [];
	if (!isObject(data) || !Array.isArray(data.clients)) return ['clients.json: expected {"clients": [...]}'];
	const ids = new Set();
	data.clients.forEach((client, index) => {
		const at = `clients[${index}]${isObject(client) && typeof client.id === 'string' ? ` (${client.id})` : ''}`;
		const problem = (/** @type {string} */ text) => problems.push(`${at}: ${text}`);
		if (!isObject(client)) return problem('expected an object');
		for (const key of Object.keys(client)) if (!CLIENT_KEYS.includes(key)) problem(`unknown key "${key}"`);
		if (typeof client.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(client.id)) problem('id: lowercase letters, digits and dashes');
		else if (ids.has(client.id)) problem('id: already used');
		ids.add(client.id);
		if (typeof client.name !== 'string' || !client.name.trim() || client.name.length > 40) problem('name: 1 to 40 characters');
		if (client.description !== undefined && (typeof client.description !== 'string' || client.description.length > 140)) problem('description: up to 140 characters');
		if (!isHttps(client.homepage)) problem('homepage: an https URL');
		if (client.source !== undefined && !isHttps(client.source)) problem('source: an https URL');
		if (!Array.isArray(client.transports) || client.transports.length === 0 || !client.transports.every((t) => typeof t === 'string' && /^[a-z][a-z0-9-]*$/.test(t))) problem('transports: a list of transport names, such as ["wss"]');
		if (!client.web && !client.ios && !client.android && !client.desktop) problem('needs at least one of web, ios, android, desktop');

		if (client.web !== undefined) {
			const web = client.web;
			if (!isObject(web)) problem('web: expected an object');
			else {
				for (const key of Object.keys(web)) if (!['url', 'query', 'fragment'].includes(key)) problem(`web: unknown key "${key}"`);
				if (!isHttps(web.url) || new URL(String(web.url)).hash) problem('web.url: an https URL without a fragment');
				const mapped = [];
				for (const part of /** @type {const} */ (['query', 'fragment'])) {
					const map = web[part];
					if (map === undefined) continue;
					if (!isObject(map)) {
						problem(`web.${part}: expected an object`);
						continue;
					}
					for (const [ours, theirs] of Object.entries(map)) {
						if (!LINK_KEYS.includes(ours)) problem(`web.${part}: "${ours}" is not a link key (${LINK_KEYS.join(', ')})`);
						if (typeof theirs !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(theirs)) problem(`web.${part}.${ours}: a plain key name`);
						mapped.push(ours);
					}
				}
				if (!mapped.includes('server')) problem('web: must pass "server" in its query or fragment');
				if (new Set(mapped).size !== mapped.length) problem('web: a link key is passed twice');
			}
		}
		if (client.ios !== undefined) {
			const ios = client.ios;
			if (!isObject(ios)) problem('ios: expected an object');
			else {
				if (!Array.isArray(ios.app_ids) || ios.app_ids.length === 0 || !ios.app_ids.every((id) => typeof id === 'string' && /^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/.test(id))) problem('ios.app_ids: a list of "TEAMID.bundle.id"');
				if (ios.store !== undefined && !isHttps(ios.store)) problem('ios.store: an https URL');
			}
		}
		if (client.android !== undefined) {
			const android = client.android;
			if (!isObject(android)) problem('android: expected an object');
			else {
				if (typeof android.package !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(android.package)) problem('android.package: a package name, such as "chat.apron.app"');
				if (!Array.isArray(android.sha256_cert_fingerprints) || android.sha256_cert_fingerprints.length === 0 || !android.sha256_cert_fingerprints.every((f) => typeof f === 'string' && /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f))) problem('android.sha256_cert_fingerprints: a list of "AB:CD:…" SHA-256 fingerprints, uppercase');
				if (android.store !== undefined && !isHttps(android.store)) problem('android.store: an https URL');
			}
		}
		if (client.desktop !== undefined && (!isObject(client.desktop) || !isHttps(client.desktop.download))) problem('desktop.download: an https URL');
	});
	return problems;
}

/**
 * Checks the blocklist. Returns the problems found, empty when there are none.
 * @param {unknown} data
 * @returns {string[]}
 */
export function checkBlocklist(data) {
	if (!isObject(data) || !Array.isArray(data.hosts)) return ['blocked.json: expected {"hosts": [...]}'];
	/** @type {string[]} */
	const problems = [];
	data.hosts.forEach((entry, index) => {
		if (!isObject(entry) || typeof entry.host !== 'string' || !/^[a-z0-9.-]+$/.test(entry.host) || typeof entry.reason !== 'string' || !entry.reason) {
			problems.push(`hosts[${index}]: expected {"host": "lowercase.ascii.host", "reason": "..."}`);
		}
	});
	return problems;
}

/**
 * The blocklist entry that covers one of a link's servers: its host, or a
 * domain above it.
 * @param {Link} link
 * @param {Blocked[]} blocked
 * @returns {Blocked | undefined}
 */
export function blockedEntry(link, blocked) {
	for (const server of link.servers) {
		if (!server.host) continue;
		const hostname = new URL(server.value).hostname;
		const entry = blocked.find((b) => hostname === b.host || hostname.endsWith(`.${b.host}`));
		if (entry) return entry;
	}
	return undefined;
}

/**
 * Which platform the page runs on, for which apps to offer.
 * @param {{ userAgent?: string, maxTouchPoints?: number }} nav
 * @returns {Platform}
 */
export function detectPlatform(nav) {
	const ua = nav.userAgent ?? '';
	// iPadOS reports itself as a Mac; only the touch screen tells them apart.
	if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1)) return 'ios';
	if (/Android/.test(ua)) return 'android';
	return 'desktop';
}

/**
 * The first of a link's servers that a client can open.
 * @param {Client} client
 * @param {Link} link
 * @returns {Server | undefined}
 */
export function serverFor(client, link) {
	return link.servers.find((server) => server.known && client.transports.includes(server.transport));
}

/**
 * What the page offers for a link on a platform: each web client that can
 * open it, then each app for this platform that can, to get from its store.
 * The registry's order is kept, with `preferred` first.
 * @param {Link} link
 * @param {Registry} registry
 * @param {Platform} platform
 * @param {string} [preferred] the id of the client last chosen here
 * @returns {Offer[]}
 */
export function offersFor(link, registry, platform, preferred) {
	const clients = [...registry.clients].sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
	/** @type {Offer[]} */
	const offers = [];
	for (const client of clients) {
		const server = serverFor(client, link);
		if (!server) continue;
		if (client.web) offers.push({ client, kind: 'web', href: webUrl(client.web, link, server) });
		const store = nativeStore(client, platform);
		if (store) offers.push({ client, kind: 'native', href: store });
	}
	return offers;
}

/**
 * Where to get a client's app for a platform.
 * @param {Client} client
 * @param {Platform} platform
 */
export function nativeStore(client, platform) {
	if (platform === 'ios') return client.ios?.store;
	if (platform === 'android') return client.android?.store;
	return client.desktop?.download;
}

/**
 * The address that opens a link in a web client, built from the registry's
 * description with the URL API, so a link's values can only ever be values.
 * @param {WebOpen} web
 * @param {Link} link
 * @param {Server} server the one of the link's servers to pass
 */
export function webUrl(web, link, server) {
	const url = new URL(web.url);
	/** @param {string} key */
	const value = (key) => (key === 'server' ? server.value : /** @type {Record<string, string | undefined>} */ (/** @type {unknown} */ (link))[key]);
	for (const [ours, theirs] of Object.entries(web.query ?? {})) {
		const v = value(ours);
		if (v !== undefined) url.searchParams.set(theirs, v);
	}
	const fragment = new URLSearchParams();
	for (const [ours, theirs] of Object.entries(web.fragment ?? {})) {
		const v = value(ours);
		if (v !== undefined) fragment.set(theirs, v);
	}
	url.hash = fragment.toString();
	return url.toString();
}

/**
 * The transports a link uses that no client in the registry supports.
 * @param {Link} link
 * @param {Registry} registry
 */
export function unsupportedTransports(link, registry) {
	const supported = new Set(registry.clients.flatMap((client) => client.transports));
	return [...new Set(link.servers.map((server) => server.transport))].filter((transport) => !supported.has(transport));
}

/**
 * `/.well-known/apple-app-site-association`: every iOS app in the registry
 * may open link.apron.chat links. The link is in the fragment, so the path
 * is always `/`.
 * @param {Registry} registry
 */
export function appleAppSiteAssociation(registry) {
	const appIDs = registry.clients.flatMap((client) => client.ios?.app_ids ?? []);
	return {
		applinks: {
			details: appIDs.length ? [{ appIDs, components: [{ '/': '/', comment: 'Apron links' }] }] : []
		}
	};
}

/**
 * `/.well-known/assetlinks.json`: every Android app in the registry may open
 * link.apron.chat links.
 * @param {Registry} registry
 */
export function assetLinks(registry) {
	return registry.clients
		.filter((client) => client.android)
		.map((client) => ({
			relation: ['delegate_permission/common.handle_all_urls'],
			target: {
				namespace: 'android_app',
				package_name: client.android?.package,
				sha256_cert_fingerprints: client.android?.sha256_cert_fingerprints
			}
		}));
}

/** @returns {value is Record<string, any>} */
function isObject(/** @type {unknown} */ value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHttps(/** @type {unknown} */ value) {
	if (typeof value !== 'string') return false;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && !url.username && !url.password;
	} catch {
		return false;
	}
}
