import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLink } from '../src/link.js';
import { appleAppSiteAssociation, assetLinks, blockedEntry, checkBlocklist, checkRegistry, detectPlatform, offersFor, unsupportedTransports, webUrl } from '../src/registry.js';

const registry = JSON.parse(readFileSync(new URL('../clients.json', import.meta.url), 'utf8'));
const blocklist = JSON.parse(readFileSync(new URL('../blocked.json', import.meta.url), 'utf8'));

/** @param {string} input */
function link(input) {
	const parsed = parseLink(input);
	if (parsed.kind !== 'link') throw new Error(`not a link: ${input}`);
	return parsed.link;
}

const native = {
	id: 'pocket',
	name: 'Pocket Apron',
	homepage: 'https://pocket.example/',
	transports: ['wss'],
	ios: { app_ids: ['ABCDE12345.example.pocket'], store: 'https://apps.apple.com/app/id1' },
	android: { package: 'example.pocket', sha256_cert_fingerprints: [Array(32).fill('AB').join(':')], store: 'https://play.google.com/store/apps/details?id=example.pocket' }
};

test('clients.json and blocked.json pass their checks', () => {
	assert.deepEqual(checkRegistry(registry), []);
	assert.deepEqual(checkBlocklist(blocklist), []);
});

test('the registry check finds mistakes', () => {
	const problems = checkRegistry({
		clients: [
			{ id: 'Bad Id', name: '', homepage: 'http://x.example/', transports: [], web: { url: 'https://x.example/#a', query: { room: 'r', nope: 'n' } }, typo: 1 },
			{ ...native, id: 'pocket' },
			{ ...native, id: 'pocket', ios: { app_ids: ['bad'] }, android: { package: 'x', sha256_cert_fingerprints: ['ab'] } }
		]
	});
	for (const expected of ['unknown key "typo"', 'id: lowercase', 'name:', 'homepage:', 'transports:', 'web.url:', '"nope" is not a link key', 'must pass "server"', 'id: already used', 'ios.app_ids', 'android.package', 'android.sha256']) {
		assert.ok(problems.some((p) => p.includes(expected)), `expected a problem with ${expected} in ${JSON.stringify(problems, null, 1)}`);
	}
	assert.deepEqual(checkRegistry({ clients: [native] }), []);
});

test('opens apron-web with its own address format', () => {
	const web = registry.clients.find((/** @type {any} */ c) => c.id === 'apron-web');
	const parsed = link('apron:?server=wss://chat.example/ws&room=%23ops/alerts&thread=t-123&message=1724803200042');
	assert.equal(webUrl(web.web, parsed, parsed.servers[0]), 'https://web.apron.chat/?server=wss%3A%2F%2Fchat.example%2Fws&room=%23ops%2Falerts&thread=t-123#message=1724803200042');
	const room = link('apron:?server=wss://chat.example/ws&room=general');
	assert.equal(webUrl(web.web, room, room.servers[0]), 'https://web.apron.chat/?server=wss%3A%2F%2Fchat.example%2Fws&room=general');
});

test('offers clients that support one of the servers, the preferred one first', () => {
	const both = { clients: [registry.clients[0], native] };
	const parsed = link('apron:?server=wss://chat.example/ws&room=general');
	assert.deepEqual(offersFor(parsed, both, 'ios').map((o) => [o.client.id, o.kind]), [['apron-web', 'web'], ['pocket', 'native']]);
	assert.deepEqual(offersFor(parsed, both, 'ios', 'pocket').map((o) => o.client.id), ['pocket', 'apron-web']);
	assert.deepEqual(offersFor(parsed, both, 'desktop').map((o) => o.kind), ['web']);

	const local = link('apron:?server=ws://localhost:8080/ws');
	assert.deepEqual(offersFor(local, both, 'android').map((o) => o.client.id), ['apron-web']);

	const p2p = link('apron:?server=webrtc:k2Fp9xQ&room=general');
	assert.deepEqual(offersFor(p2p, both, 'desktop'), []);
	assert.deepEqual(unsupportedTransports(p2p, both), ['webrtc']);

	const fallback = link('apron:?server=webrtc:k2Fp9xQ&server=wss://chat.example/ws');
	const [offer] = offersFor(fallback, both, 'desktop');
	assert.ok(offer.href.includes('server=wss%3A%2F%2Fchat.example%2Fws'), 'passes the first server the client supports');
});

test('blocks a host and the names under it', () => {
	const blocked = [{ host: 'evil.example', reason: 'phishing' }];
	assert.equal(blockedEntry(link('apron:?server=wss://evil.example/'), blocked)?.reason, 'phishing');
	assert.equal(blockedEntry(link('apron:?server=wss://chat.evil.example:8443/'), blocked)?.reason, 'phishing');
	assert.equal(blockedEntry(link('apron:?server=wss://notevil.example/'), blocked), undefined);
	assert.equal(blockedEntry(link('apron:?server=wss://ok.example/&server=wss://evil.example/'), blocked)?.reason, 'phishing');
});

test('detects the platform', () => {
	assert.equal(detectPlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }), 'ios');
	assert.equal(detectPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }), 'ios');
	assert.equal(detectPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 }), 'desktop');
	assert.equal(detectPlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)' }), 'android');
	assert.equal(detectPlatform({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }), 'desktop');
});

test('builds the app association files', () => {
	assert.deepEqual(appleAppSiteAssociation(registry), { applinks: { details: [] } });
	assert.deepEqual(assetLinks(registry), []);
	assert.deepEqual(appleAppSiteAssociation({ clients: [native] }), {
		applinks: { details: [{ appIDs: ['ABCDE12345.example.pocket'], components: [{ '/': '/', comment: 'Apron links' }] }] }
	});
	assert.deepEqual(assetLinks({ clients: [native] }), [
		{
			relation: ['delegate_permission/common.handle_all_urls'],
			target: { namespace: 'android_app', package_name: 'example.pocket', sha256_cert_fingerprints: native.android.sha256_cert_fingerprints }
		}
	]);
});
