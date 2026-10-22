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
import { autoOpen, blockedEntry, checkWebAppUrl, CUSTOM_PREFIX, detectPlatform, nativeStore, offersFor, selfHostable, unsupportedTransports, withCustom } from './registry.js';
import { blocked, registry } from './data.js';

/** @typedef {import('./link.js').Link} Link */
/** @typedef {import('./link.js').Reason} Reason */
/** @typedef {import('./registry.js').SavedWebApp} SavedWebApp */

/** The id of the client chosen last: the default, offered first. */
const PREFERRED_KEY = 'preferred-client';
/** Set when the viewer chose "Remember my choice": links open in the default without asking. */
const REMEMBER_KEY = 'remember-choice';
/** Self-hosted web clients the viewer added, as `SavedWebApp[]` in JSON. */
const SAVED_KEY = 'web-apps';
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

function savePreferred(/** @type {string | undefined} */ id) {
	try {
		if (id) localStorage.setItem(PREFERRED_KEY, id);
		else localStorage.removeItem(PREFERRED_KEY);
	} catch {
		// Storage can be off (private windows, blocked site data); the choice is a convenience.
	}
}

function loadRemember() {
	try {
		return localStorage.getItem(REMEMBER_KEY) === '1';
	} catch {
		return false;
	}
}

function saveRemember(/** @type {boolean} */ remember) {
	try {
		if (remember) localStorage.setItem(REMEMBER_KEY, '1');
		else localStorage.removeItem(REMEMBER_KEY);
	} catch {
		// As with the default: without storage, the page asks each time.
	}
}

/** @returns {SavedWebApp[]} */
function loadSaved() {
	try {
		const saved = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]');
		return Array.isArray(saved) ? saved.filter((app) => typeof app?.url === 'string' && typeof app?.base === 'string') : [];
	} catch {
		return [];
	}
}

/** Saves the list; false when this browser keeps no site data. */
function storeSaved(/** @type {SavedWebApp[]} */ saved) {
	try {
		localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
		return true;
	} catch {
		return false;
	}
}

/** A web client's address, short: its host, and its path when it has one. */
function where(/** @type {string} */ address) {
	const url = new URL(address);
	return url.pathname === '/' ? url.host : `${url.host}${url.pathname.replace(/\/$/, '')}`;
}

/** The registry, with the web clients this viewer added first. */
function allClients() {
	return withCustom(registry, loadSaved());
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
		const auto = loadRemember() ? autoOpen(parsed.link, allClients(), blocked, loadPreferred()) : undefined;
		if (auto) {
			// Replaced, not pushed: Back then skips this page instead of opening the app again.
			main.replaceChildren(openingView(auto.client.name, auto.href));
			location.replace(auto.href);
			return;
		}
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

	const clients = allClients();
	const preferred = loadPreferred();
	const offers = offersFor(link, clients, platform, preferred);
	const actions = h('div', { class: 'actions' });
	const remember = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', name: 'remember' }));
	remember.checked = loadRemember();
	offers.forEach((offer, index) => {
		// No highlighted button for a local server: opening one should be a choice, not a reflex.
		const primary = index === 0 && offer.kind === 'web' && !network;
		const label = offer.kind === 'web' ? `Open in ${offer.client.name}` : `Get ${offer.client.name}`;
		const host = offer.kind === 'web' && offer.client.web ? where(offer.client.web.url) : new URL(offer.href).host;
		const meta = offer.kind === 'web' && offer.client.id === preferred ? `${host} · default` : host;
		const button = h('a', { class: primary ? 'button primary' : 'button', href: offer.href, rel: 'noopener noreferrer' }, h('span', {}, label), h('span', { class: 'button-meta' }, meta));
		if (offer.kind === 'web') {
			button.addEventListener('click', () => {
				savePreferred(offer.client.id);
				saveRemember(remember.checked);
			});
		}
		actions.append(button);
	});
	if (registry.clients.some((client) => nativeStore(client, platform))) {
		actions.append(h('a', { class: 'button', href: formatUri(link) }, h('span', {}, 'Open in an installed app'), h('span', { class: 'button-meta' }, 'apron:')));
	}
	if (offers.length) {
		card.append(actions);
		// A local or private server always shows this page, so remembering doesn't apply to it.
		if (offers.some((offer) => offer.kind === 'web') && !network) {
			card.append(h('label', { class: 'remember' }, remember, h('span', {}, 'Remember my choice, and open links in it without asking')));
		}
	}
	else {
		const missing = unsupportedTransports(link, clients);
		card.append(notice('info', missing.length ? `No Apron app listed here supports ${missing.join(', ')} yet. Copy the link into an app that does.` : 'No Apron app listed here can open this link yet.'));
	}

	if (selfHostable(registry).length) {
		card.append(h('details', { class: 'add-app' }, h('summary', {}, `Use your own ${selfHostable(registry)[0].name}`), webAppForm(render)));
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
		defaultsView(),
		pasteForm()
	);
}

/**
 * The web clients links open in, to pick the default and to add or remove
 * the viewer's own. Kept in this browser only.
 */
function defaultsView() {
	const preferred = loadPreferred();
	const list = h('ul', { class: 'choices' });
	for (const client of allClients().clients) {
		if (!client.web) continue;
		const radio = /** @type {HTMLInputElement} */ (h('input', { type: 'radio', name: 'default', value: client.id }));
		radio.checked = client.id === preferred;
		radio.addEventListener('change', () => savePreferred(client.id));
		const item = h('li', {}, h('label', {}, radio, h('span', { class: 'app-name' }, client.name), h('span', { class: 'app-host' }, where(client.web.url))));
		if (client.custom) {
			const remove = h('button', { type: 'button', class: 'link-button' }, 'Remove');
			remove.addEventListener('click', () => {
				storeSaved(loadSaved().filter((app) => `${CUSTOM_PREFIX}${app.url}` !== client.id));
				if (loadPreferred() === client.id) savePreferred(undefined);
				render();
			});
			item.append(remove);
		}
		list.append(item);
	}
	const remember = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', name: 'remember' }));
	remember.checked = loadRemember();
	remember.disabled = !preferred;
	remember.addEventListener('change', () => saveRemember(remember.checked));
	const section = h(
		'section',
		{ class: 'defaults' },
		h('h2', {}, 'Open links with'),
		h('p', { class: 'muted' }, 'Your choice is the first one offered for every link. It stays in this browser.'),
		list,
		h('label', { class: 'remember' }, remember, h('span', {}, 'Open links in my choice without asking. Links to servers on this device or a private network still ask.'))
	);
	// Remembering needs a default to remember.
	list.addEventListener('change', () => (remember.disabled = !loadPreferred()));
	if (selfHostable(registry).length) section.append(webAppForm(render));
	return section;
}

/** Shown for the moment before a remembered choice opens. */
function openingView(/** @type {string} */ name, /** @type {string} */ href) {
	return h(
		'section',
		{ class: 'card' },
		h('h1', {}, `Opening in ${name}…`),
		h('p', { class: 'muted' }, h('a', { href, rel: 'noopener noreferrer' }, new URL(href).host), '. To choose again, turn off "Remember my choice" on ', h('a', { href: '/' }, 'link.apron.chat'), '.')
	);
}

/**
 * Adds a self-hosted web client: its address, saved in this browser, and
 * made the default. Only the viewer adds one; a link never can (SPEC.md §7).
 * @param {() => void} added
 */
function webAppForm(added) {
	const bases = selfHostable(registry);
	const input = /** @type {HTMLInputElement} */ (h('input', { type: 'text', inputmode: 'url', name: 'web-app', placeholder: 'https://chat.example.com/', autocomplete: 'url', spellcheck: 'false', 'aria-label': 'Address of your web app' }));
	const select = bases.length > 1 ? /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Which app it runs' }, ...bases.map((base) => h('option', { value: base.id }, base.name)))) : undefined;
	const error = h('p', { class: 'form-error', 'aria-live': 'polite' });
	const label = bases.length > 1 ? 'Host your own Apron web app? Add its address.' : `Host your own ${bases[0].name}? Add its address.`;
	const form = h('form', { class: 'paste' }, h('label', {}, label), h('div', { class: 'paste-row' }, input, select, h('button', { type: 'submit', class: 'button' }, 'Add')), error);
	form.addEventListener('submit', (event) => {
		event.preventDefault();
		const saved = loadSaved();
		const checked = checkWebAppUrl(input.value, registry, saved);
		if ('problem' in checked) {
			error.textContent = checked.problem;
			return;
		}
		if (!storeSaved([...saved, { url: checked.url, base: select?.value ?? bases[0].id }])) {
			error.textContent = "This browser isn't keeping data for this site (a private window, or site data blocked), so it can't remember the app.";
			return;
		}
		savePreferred(`${CUSTOM_PREFIX}${checked.url}`);
		added();
	});
	return form;
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
