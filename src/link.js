// @ts-check
/**
 * Apron links (SPEC.md): what a link refers to, read from and written to
 * its two forms.
 *
 * ```text
 * https://link.apron.chat/#server=wss://chat.example/ws&room=general&message=1724803200042
 * apron:?server=wss://chat.example/ws&room=general&message=1724803200042
 * ```
 *
 * Pure functions only, so the page and the tests share them.
 */

export const LINK_ORIGIN = 'https://link.apron.chat';

/** Transports this page knows how to check. Others are kept, but only a client that lists them can open them. */
export const KNOWN_TRANSPORTS = ['wss', 'ws'];

/** Keys that carry a credential (SPEC.md §2.1): only a sign-in link has them, and only in the fragment. */
export const CREDENTIAL_KEYS = ['token'];

/** Keys this page reads into a `Link`. Readers use the first value of a repeated key. */
const LINK_KEYS = ['server', 'room', 'message', 'user'];

/** Keys of a sign-in link, passed on with their first value only: a client given two tokens could use either. */
const SIGN_IN_KEYS = ['token', 'state'];

/**
 * @typedef {object} Server
 * @property {string} value the `server` value as normalized: a URL for `wss` and `ws`, as written otherwise
 * @property {string} transport its scheme, lowercased: `wss`, `ws`, or a transport this page doesn't know
 * @property {boolean} known whether this page can check it (`KNOWN_TRANSPORTS`)
 * @property {string} [host] host and port, ASCII (internationalized names in punycode); only for known transports
 * @property {'loopback' | 'private'} [network] set when the host is on this device or a private network
 */

/**
 * @typedef {object} Link
 * @property {Server} server
 * @property {string} [room] a room, also a thread
 * @property {string} [message] only with `room`
 * @property {string} [user] a user; with `room`, a member of that room
 * @property {[string, string][]} extra keys this page doesn't use, kept in order and passed on to the client
 */

/**
 * @typedef {{ kind: 'empty' }
 *   | { kind: 'invalid', reason: Reason, detail?: string }
 *   | { kind: 'link', link: Link }} Parsed
 */

/**
 * @typedef {'no-server' | 'sign-in-without-server' | 'exposed-credential' | 'bad-server' | 'insecure-server' | 'bad-room' | 'bad-message' | 'bad-user'
 *   | 'message-without-room' | 'not-a-link'} Reason
 */

/**
 * Reads either form of a link: a link.apron.chat URL or an `apron:` URI,
 * or the bare key list after the `#`.
 * @param {string} input
 * @returns {Parsed}
 */
export function parseLink(input) {
	const text = input.trim();
	const scheme = /^apron:/i.exec(text);
	if (scheme) return parseParams(new URLSearchParams(text.slice(scheme[0].length).replace(/^\?/, '')));
	if (/^https?:\/\//i.test(text)) {
		let url;
		try {
			url = new URL(text);
		} catch {
			return { kind: 'invalid', reason: 'not-a-link' };
		}
		if (url.origin !== LINK_ORIGIN) return { kind: 'invalid', reason: 'not-a-link' };
		return parseLocation(url);
	}
	// Bare keys: text without a single `key=value`, or a URI of another scheme, is something else pasted.
	if (!text.includes('=') || /^[a-z][a-z0-9+.-]*:/i.test(text)) return { kind: 'invalid', reason: 'not-a-link' };
	return parseParams(new URLSearchParams(text.replace(/^[#?]/, '')));
}

/**
 * Reads the page's own address. The link belongs in the fragment, but keys
 * in the query are read too, so that a web.apron.chat address with its
 * domain swapped (`?server=…&room=…#message=…`) still works. They follow the
 * fragment's keys, so the fragment's value of a repeated key wins. A
 * credential in the query has already reached the site's host, so it is refused.
 * @param {Pick<Location, 'search' | 'hash'>} location
 * @returns {Parsed}
 */
export function parseLocation(location) {
	const query = new URLSearchParams(location.search);
	if (CREDENTIAL_KEYS.some((key) => query.has(key))) return { kind: 'invalid', reason: 'exposed-credential' };
	const params = new URLSearchParams(location.hash.replace(/^#/, ''));
	for (const [key, value] of query) params.append(key, value);
	return parseParams(params);
}

/**
 * Reads a link's keys. A repeated key counts with its first value, as
 * `URLSearchParams.get` gives it (SPEC.md §2).
 * @param {URLSearchParams} params form-decoded, so a `+` is a space
 * @returns {Parsed}
 */
export function parseParams(params) {
	if ([...params.keys()].length === 0) return { kind: 'empty' };

	const value = params.get('server');
	const signIn = CREDENTIAL_KEYS.some((key) => params.has(key));
	if (value === null) return { kind: 'invalid', reason: signIn ? 'sign-in-without-server' : 'no-server' };
	const server = parseServer(value);
	if (typeof server === 'string') return { kind: 'invalid', reason: server, detail: value };

	const room = params.get('room') ?? undefined;
	const message = params.get('message') ?? undefined;
	const user = params.get('user') ?? undefined;
	if (room !== undefined && !isOpaqueId(room)) return { kind: 'invalid', reason: 'bad-room', detail: room };
	if (message !== undefined) {
		if (room === undefined) return { kind: 'invalid', reason: 'message-without-room' };
		if (!isMessageId(message)) return { kind: 'invalid', reason: 'bad-message', detail: message };
	}
	if (user !== undefined && !isOpaqueId(user)) return { kind: 'invalid', reason: 'bad-user', detail: user };

	/** @type {[string, string][]} */
	const extra = [...params].filter(([key], index, all) => !LINK_KEYS.includes(key) && !(SIGN_IN_KEYS.includes(key) && all.findIndex(([k]) => k === key) < index));
	return {
		kind: 'link',
		link: {
			server,
			...(room !== undefined ? { room } : {}),
			...(message !== undefined ? { message } : {}),
			...(user !== undefined ? { user } : {}),
			extra
		}
	};
}

/**
 * A `server` value: `<transport>:<rest>`. `wss` and `ws` are checked as URLs;
 * any other transport is kept as written.
 * @param {string} value
 * @returns {Server | 'bad-server' | 'insecure-server'}
 */
export function parseServer(value) {
	// Transport names have no dots, so `chat.example:8443` is not mistaken for one.
	const scheme = /^([a-z][a-z0-9-]*):/i.exec(value);
	if (!scheme || /[\s\p{Cc}]/u.test(value)) return 'bad-server';
	const transport = scheme[1].toLowerCase();
	if (!KNOWN_TRANSPORTS.includes(transport)) return { value, transport, known: false };

	let url;
	try {
		url = new URL(value);
	} catch {
		return 'bad-server';
	}
	// A user name or password in a server URL is a credential, and `chat.acme.com@evil.example` is a disguise.
	if (!url.hostname || url.username || url.password || url.hash || !value.slice(scheme[0].length).startsWith('//')) return 'bad-server';
	const network = networkOf(url.hostname);
	if (transport === 'ws' && network !== 'loopback') return 'insecure-server';
	return { value: url.toString(), transport, known: true, host: url.host, ...(network ? { network } : {}) };
}

/**
 * Where a host is, when that isn't the public internet. The hostname is as
 * the URL parser gives it: lowercased, IPv4 in dotted decimal, IPv6 in brackets.
 * @param {string} hostname
 * @returns {'loopback' | 'private' | undefined}
 */
export function networkOf(hostname) {
	if (hostname === 'localhost' || hostname.endsWith('.localhost')) return 'loopback';
	if (hostname === '[::1]') return 'loopback';
	const ipv4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(hostname);
	if (ipv4) {
		const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
		if (a === 127) return 'loopback';
		if (a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)) return 'private';
		return undefined;
	}
	if (hostname.startsWith('[')) {
		const ipv6 = hostname.slice(1, -1);
		// fc00::/7 and fe80::/10. The parser drops leading zeros, so a full first group has four digits.
		if (/^f[cd][0-9a-f]{2}:/.test(ipv6) || /^fe[89ab][0-9a-f]:/.test(ipv6)) return 'private';
		const mapped = /^::ffff:(.+)$/.exec(ipv6);
		if (mapped) return mapped[1].includes('.') ? networkOf(mapped[1]) : mappedNetwork(mapped[1]);
		return undefined;
	}
	if (/\.(local|internal|lan|home\.arpa)$/.test(hostname) || !hostname.includes('.')) return 'private';
	return undefined;
}

/** An IPv4-mapped IPv6 address as the URL parser writes it, in hex: `::ffff:7f00:1` is 127.0.0.1. */
function mappedNetwork(/** @type {string} */ hex) {
	const parts = hex.split(':').map((part) => parseInt(part, 16));
	if (parts.length !== 2 || parts.some(Number.isNaN)) return undefined;
	return networkOf([parts[0] >> 8, parts[0] & 255, parts[1] >> 8, parts[1] & 255].join('.'));
}

/** A `room_id` (Apron §2.4): not empty, no whitespace or control characters. */
export function isOpaqueId(/** @type {string} */ value) {
	return value.length > 0 && !/[\s\p{Cc}]/u.test(value);
}

/** A `message_id` (Apron §2.2): a `log_id`, a positive decimal below 2^53. */
export function isMessageId(/** @type {string} */ value) {
	return /^[1-9][0-9]{0,15}$/.test(value) && Number(value) <= Number.MAX_SAFE_INTEGER;
}

/**
 * The link.apron.chat URL for a link.
 * @param {Link} link
 */
export function formatLink(link) {
	return `${LINK_ORIGIN}/#${formatParams(link)}`;
}

/**
 * The URI form of a link: `apron:?…`.
 * @param {Link} link
 */
export function formatUri(link) {
	return `apron:?${formatParams(link)}`;
}

/**
 * A link's keys, in a fixed order: server, room, message, user, then
 * the rest as they came.
 * @param {Link} link
 */
export function formatParams(link) {
	/** @type {[string, string][]} */
	const entries = [['server', link.server.value]];
	if (link.room !== undefined) entries.push(['room', link.room]);
	if (link.message !== undefined) entries.push(['message', link.message]);
	if (link.user !== undefined) entries.push(['user', link.user]);
	entries.push(...link.extra);
	return entries.map(([key, value]) => `${encodeValue(key)}=${encodeValue(value)}`).join('&');
}

/**
 * Whether a link signs in: it carries a credential key (SPEC.md §2.1), to
 * pass on to the client and never to copy or keep.
 * @param {Link} link
 */
export function signsIn(link) {
	return link.extra.some(([key]) => CREDENTIAL_KEYS.includes(key));
}

/**
 * Whether an address carries a credential key anywhere, valid link or not:
 * such an address leaves the address bar before anything else.
 * @param {Pick<Location, 'search' | 'hash'>} location
 */
export function hasCredential(location) {
	const keys = [...new URLSearchParams(location.search).keys(), ...new URLSearchParams(location.hash.replace(/^#/, '')).keys()];
	return keys.some((key) => CREDENTIAL_KEYS.includes(key));
}

/**
 * Percent-encodes everything but unreserved characters, `:` and `/`, so a
 * server URL stays readable. `+` is encoded, because form decoding reads a
 * bare `+` as a space. `!'()*` are encoded too: chat apps that find links in
 * text drop them from a link's end.
 * @param {string} value
 */
export function encodeValue(value) {
	return encodeURIComponent(value)
		.replace(/%3A/gi, ':')
		.replace(/%2F/gi, '/')
		.replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * The text to show for an ID or server value. A link chooses these, so
 * characters that hide or reorder text are shown as their code points, and
 * long values are cut.
 * @param {string} value
 * @param {number} [max] the most characters to show
 */
export function visible(value, max = 80) {
	const shown = value.replace(/[\p{Cf}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/gu, (char) => `⟨U+${char.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')}⟩`);
	const chars = [...shown];
	return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : shown;
}

/**
 * When a message was sent: its `message_id` is its `log_id`, Unix epoch
 * milliseconds (Apron §2.1).
 * @param {string} message
 */
export function messageTime(message) {
	return new Date(Number(message));
}
