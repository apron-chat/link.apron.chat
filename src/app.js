// @ts-check
/**
 * The link.apron.chat page: reads the link in its own address, shows what it
 * refers to, and offers the Apron apps that can open it. It only ever shows
 * and offers; it never opens anything by itself (SPEC.md §7).
 *
 * All markup is built with DOM calls and `textContent`: the page's CSP
 * forbids the HTML sinks (Trusted Types), because a link chooses every value.
 */
import { formatLink, formatParams, formatUri, messageTime, parseLink, parseLocation, visible } from './link.js';
import { blockedEntry, detectPlatform, nativeStore, offersFor, unsupportedTransports } from './registry.js';
import { blocked, registry } from './data.js';

/** @typedef {import('./link.js').Link} Link */
/** @typedef {import('./link.js').Reason} Reason */

const PREFERRED_KEY = 'preferred-client';
const REPOSITORY = 'https://github.com/apron-chat/link.apron.chat';
const platform = detectPlatform(navigator);

/** @type {Record<Reason, string>} */
const REASONS = {
	'no-server': "This link doesn't say which server it's for. Links inside Apron messages can leave the server out, but they only work in the app that showed them. Ask for a link made with the app's Copy link.",
	'bad-server': "The server in this link isn't a valid address.",
	'insecure-server': 'This link connects without encryption (ws://) to a server that is not on this device. Apron links allow ws:// only for localhost.',
	'bad-room': "The room in this link isn't a valid room ID.",
	'bad-thread': "The thread in this link isn't a valid room ID.",
	'bad-message': "The message in this link isn't a valid message ID.",
	'thread-without-room': 'This link has a thread but no room.',
	'message-without-room': 'This link has a message but no room.',
	'duplicate-key': 'This link gives the same key more than once.',
	'not-a-link': "That isn't an Apron link."
};

/**
 * Makes an element. `attrs` are set with `setAttribute`, so they are values,
 * never code; strings among `children` become text nodes.
 * @param {string} tag
 * @param {Record<string, string | undefined>} [attrs]
 * @param {(Node | string | undefined | false)[]} children
 */
function h(tag, attrs = {}, ...children) {
	const element = document.createElement(tag);
	for (const [name, value] of Object.entries(attrs)) if (value !== undefined) element.setAttribute(name, value);
	for (const child of children) if (child) element.append(child);
	return element;
}

function loadPreferred() {
	try {
		return localStorage.getItem(PREFERRED_KEY) ?? undefined;
	} catch {
		return undefined;
	}
}

function savePreferred(/** @type {string} */ id) {
	try {
		localStorage.setItem(PREFERRED_KEY, id);
	} catch {
		// Storage can be off (private windows, blocked site data); the choice is a convenience.
	}
}

function render() {
	const parsed = parseLocation(location);
	const main = /** @type {HTMLElement} */ (document.getElementById('app'));
	if (parsed.kind === 'sign-in') {
		// A credential: out of the address bar, history and bookmarks before anything else.
		history.replaceState(null, '', '/');
		main.replaceChildren(signInView());
	} else if (parsed.kind === 'empty') {
		main.replaceChildren(landingView());
	} else if (parsed.kind === 'invalid') {
		main.replaceChildren(invalidView(REASONS[parsed.reason], parsed.reason === 'duplicate-key' ? parsed.detail : undefined));
	} else {
		const canonical = `/#${formatParams(parsed.link)}`;
		if (location.pathname + location.search + location.hash !== canonical) history.replaceState(null, '', canonical);
		main.replaceChildren(linkView(parsed.link));
	}
	main.focus({ preventScroll: true });
}

/** @param {Link} link */
function linkView(link) {
	const block = blockedEntry(link, blocked);
	const card = h('section', { class: 'card' }, h('h1', {}, 'Open in an Apron app'), destinationView(link));

	const network = link.servers[0].network;
	if (block) {
		card.append(notice('danger', `link.apron.chat has blocked this server: ${block.reason}`));
		card.append(copyRow(link));
		return card;
	}
	if (network === 'loopback') card.append(notice('warn', 'This link points at a server on your own device. Open it only if you expected it: a local server can run tools and code for you.'));
	else if (network === 'private') card.append(notice('warn', 'This link points at a server on a private network, such as a home or office network.'));

	const offers = offersFor(link, registry, platform, loadPreferred());
	const actions = h('div', { class: 'actions' });
	offers.forEach((offer, index) => {
		// No highlighted button for a local server: opening one should be a choice, not a reflex.
		const primary = index === 0 && offer.kind === 'web' && !network;
		const label = offer.kind === 'web' ? `Open in ${offer.client.name}` : `Get ${offer.client.name}`;
		const button = h('a', { class: primary ? 'button primary' : 'button', href: offer.href, rel: 'noopener noreferrer' }, h('span', {}, label), h('span', { class: 'button-meta' }, new URL(offer.href).host));
		if (offer.kind === 'web') button.addEventListener('click', () => savePreferred(offer.client.id));
		actions.append(button);
	});
	if (registry.clients.some((client) => nativeStore(client, platform))) {
		actions.append(h('a', { class: 'button', href: formatUri(link) }, h('span', {}, 'Open in an installed app'), h('span', { class: 'button-meta' }, 'apron:')));
	}
	if (offers.length) card.append(actions);
	else {
		const missing = unsupportedTransports(link, registry);
		card.append(notice('info', missing.length ? `No Apron app listed here supports ${missing.join(', ')} yet. Copy the link into an app that does.` : 'No Apron app listed here can open this link yet.'));
	}

	card.append(h('p', { class: 'caution' }, 'An Apron server controls everything you see on it, including names and sign-in pages. Open links only to servers you trust.'));
	card.append(copyRow(link));
	return card;
}

/** @param {Link} link */
function destinationView(link) {
	const [first, ...others] = link.servers;
	const rows = h('dl', { class: 'destination' });
	const row = (/** @type {string} */ term, /** @type {Node[]} */ ...details) => rows.append(h('div', { class: 'row' }, h('dt', {}, term), h('dd', {}, ...details)));

	const serverDetail = [h('div', { class: 'host' }, visible(first.host ?? first.value))];
	if (first.host) serverDetail.push(h('div', { class: 'url' }, visible(first.value, 120)));
	else serverDetail.push(h('div', { class: 'url' }, `${first.transport} transport`));
	for (const other of others) serverDetail.push(h('div', { class: 'url' }, `or ${visible(other.value, 120)}`));
	row('Server', ...serverDetail);
	if (link.room !== undefined) row('Room', h('code', {}, visible(link.room)));
	if (link.thread !== undefined) row('Thread', h('code', {}, visible(link.thread)));
	if (link.message !== undefined) {
		const time = messageTime(link.message);
		row('Message', h('time', { datetime: time.toISOString() }, time.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })), h('code', { class: 'id' }, link.message));
	}
	return rows;
}

/** @param {Link} link */
function copyRow(link) {
	return h('div', { class: 'copy' }, copyButton('Copy link', formatLink(link)), copyButton('Copy apron: URI', formatUri(link)));
}

function copyButton(/** @type {string} */ label, /** @type {string} */ text) {
	const button = h('button', { type: 'button', class: 'link-button' }, label);
	button.addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(text);
			button.textContent = 'Copied';
		} catch {
			button.textContent = "Couldn't copy";
		}
		setTimeout(() => (button.textContent = label), 1600);
	});
	return button;
}

/** @param {'info' | 'warn' | 'danger'} tone */
function notice(tone, /** @type {string} */ text) {
	return h('p', { class: `notice ${tone}`, role: tone === 'info' ? undefined : 'alert' }, text);
}

function signInView() {
	return h(
		'section',
		{ class: 'card' },
		h('h1', {}, 'This is a sign-in link'),
		h('p', {}, "Sign-in links carry a password-like token, so link.apron.chat never passes them on, and has removed this one from the address bar. Open the sign-in link in the app that asked for it. If you didn't ask to sign in, ignore it: someone may be trying to sign you in to their account.")
	);
}

function invalidView(/** @type {string} */ reason, /** @type {string | undefined} */ key) {
	return h('section', { class: 'card' }, h('h1', {}, "This link doesn't work"), notice('danger', key ? `${reason} (${visible(key, 20)})` : reason), pasteForm());
}

function landingView() {
	const apps = h('ul', { class: 'apps' });
	for (const client of registry.clients) {
		const get = client.web ? client.web.url : nativeStore(client, platform) ?? client.homepage;
		apps.append(
			h(
				'li',
				{},
				h('a', { href: get, rel: 'noopener noreferrer', class: 'app-name' }, client.name),
				client.description && h('span', { class: 'app-description' }, client.description)
			)
		);
	}
	return h(
		'section',
		{ class: 'card' },
		h('h1', {}, 'Apron links'),
		h('p', {}, 'A link.apron.chat link opens an Apron server, room or message in whichever Apron app you use. The link stays in your browser: it is never sent to link.apron.chat.'),
		h('pre', { class: 'example' }, 'https://link.apron.chat/#server=wss://chat.example/ws&room=general'),
		h('h2', {}, 'Apron apps'),
		apps,
		h('p', { class: 'muted' }, 'Making an Apron app? ', h('a', { href: `${REPOSITORY}#adding-a-client` }, 'Add it to this list'), '.'),
		pasteForm()
	);
}

function pasteForm() {
	const input = /** @type {HTMLInputElement} */ (h('input', { type: 'text', name: 'link', placeholder: 'apron:?server=… or https://link.apron.chat/#…', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Apron link' }));
	const error = h('p', { class: 'form-error', 'aria-live': 'polite' });
	const form = h('form', { class: 'paste' }, h('label', {}, 'Have a link? Paste it here.'), h('div', { class: 'paste-row' }, input, h('button', { type: 'submit', class: 'button primary' }, 'Show')), error);
	form.addEventListener('submit', (event) => {
		event.preventDefault();
		const parsed = parseLink(input.value);
		if (parsed.kind === 'link') location.hash = formatParams(parsed.link);
		else if (parsed.kind === 'sign-in') error.textContent = 'That is a sign-in link. Open it in the app that asked for it.';
		else if (parsed.kind === 'invalid') error.textContent = REASONS[parsed.reason];
		else error.textContent = REASONS['not-a-link'];
	});
	return form;
}

window.addEventListener('hashchange', render);
render();
