import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeValue, formatLink, formatUri, hasCredential, networkOf, parseLink, parseLocation, parseServer, signsIn, visible } from '../src/link.js';

/** @param {string} input */
function link(input) {
	const parsed = parseLink(input);
	assert.equal(parsed.kind, 'link', `expected a link from ${input}, got ${JSON.stringify(parsed)}`);
	return /** @type {Extract<typeof parsed, { kind: 'link' }>} */ (parsed).link;
}

test('reads the three forms alike', () => {
	const forms = [
		'https://link.apron.chat/#server=wss://chat.example/ws&room=general&message=1724803200042',
		'apron:?server=wss://chat.example/ws&room=general&message=1724803200042',
		'web+apron:?server=wss://chat.example/ws&room=general&message=1724803200042',
		'APRON:server=wss%3A%2F%2Fchat.example%2Fws&room=general&message=1724803200042',
		'#server=wss://chat.example/ws&room=general&message=1724803200042'
	];
	for (const form of forms) {
		const parsed = link(form);
		assert.deepEqual(parsed.servers, [{ value: 'wss://chat.example/ws', transport: 'wss', known: true, host: 'chat.example' }]);
		assert.equal(parsed.room, 'general');
		assert.equal(parsed.message, '1724803200042');
	}
});

test('writes readable links that read back the same', () => {
	const parsed = link('apron:?server=wss://chat.example/ws&room=%23ops/alerts&message=1724803200042');
	assert.equal(formatLink(parsed), 'https://link.apron.chat/#server=wss://chat.example/ws&room=%23ops/alerts&message=1724803200042');
	assert.equal(formatUri(parsed), 'apron:?server=wss://chat.example/ws&room=%23ops/alerts&message=1724803200042');
	assert.equal(formatUri(parsed, 'web+apron'), 'web+apron:?server=wss://chat.example/ws&room=%23ops/alerts&message=1724803200042');
	assert.deepEqual(link(formatLink(parsed)), parsed);
});

test('encodes what form decoding or linkifiers would mangle', () => {
	assert.equal(encodeValue('a+b c&d=e#f%g'), 'a%2Bb%20c%26d%3De%23f%25g');
	assert.equal(encodeValue("(x)!*'"), '%28x%29%21%2A%27');
	assert.equal(encodeValue('wss://h/p'), 'wss://h/p');
	assert.equal(link(`apron:?server=wss://h/&room=${encodeValue('général✓')}`).room, 'général✓');
});

test('a bare + is a space, so an unencoded composite scheme is refused', () => {
	assert.deepEqual(parseLink('apron:?server=webrtc+wss://signal.example/s'), { kind: 'invalid', reason: 'bad-server', detail: 'webrtc wss://signal.example/s' });
});

test('reads the query too, for a web.apron.chat address with its domain swapped', () => {
	const parsed = parseLocation({ search: '?server=wss%3A%2F%2Fchat.example%2Fws&room=t-1', hash: '#message=1724803200042' });
	assert.equal(parsed.kind, 'link');
	if (parsed.kind !== 'link') return;
	assert.equal(parsed.link.room, 't-1');
	assert.equal(parsed.link.message, '1724803200042');
});

test('an empty link is the landing page', () => {
	assert.deepEqual(parseLink('https://link.apron.chat/'), { kind: 'empty' });
	assert.deepEqual(parseLink('apron:'), { kind: 'empty' });
	assert.deepEqual(parseLocation({ search: '', hash: '' }), { kind: 'empty' });
});

test('a sign-in link is a link that carries its token on', () => {
	const parsed = link('https://link.apron.chat/#token=Hk41x9&state=q8Rz&server=wss%3A%2F%2Fchat.example%2F');
	assert.deepEqual(parsed.servers.map((s) => s.value), ['wss://chat.example/']);
	assert.deepEqual(parsed.extra, [['token', 'Hk41x9'], ['state', 'q8Rz']]);
	assert.ok(signsIn(parsed));
	assert.ok(!signsIn(link('apron:?server=wss://chat.example/&state=q8Rz')), 'state alone is no credential');
});

test('a sign-in link keeps its token in the fragment, and names its server', () => {
	assert.deepEqual(parseLocation({ search: '?token=x&server=wss://chat.example/', hash: '' }), { kind: 'invalid', reason: 'exposed-credential' });
	assert.deepEqual(parseLink('https://link.apron.chat/?token=x#server=wss://chat.example/'), { kind: 'invalid', reason: 'exposed-credential' });
	assert.deepEqual(parseLink('https://link.apron.chat/#token=x&state=y'), { kind: 'invalid', reason: 'sign-in-without-server' });
	assert.deepEqual(parseLink('apron:?server=wss://chat.example/&token=a&token=b'), { kind: 'invalid', reason: 'duplicate-key', detail: 'token' });
	assert.deepEqual(parseLink('apron:?server=wss://chat.example/&token=a&state=b&state=c'), { kind: 'invalid', reason: 'duplicate-key', detail: 'state' });
	assert.deepEqual(parseLink('apron:?server=wss://chat.example/&server=wss://evil.example/&token=a'), { kind: 'invalid', reason: 'duplicate-key', detail: 'server' }, 'a token is for one server');
});

test('finds a credential in any address, valid link or not', () => {
	assert.ok(hasCredential({ search: '', hash: '#token=x' }));
	assert.ok(hasCredential({ search: '?token=x', hash: '' }));
	assert.ok(hasCredential({ search: '', hash: '#server=bad&token=x&token=y' }));
	assert.ok(!hasCredential({ search: '', hash: '#server=wss://chat.example/&state=x' }));
});

test('the server is required', () => {
	assert.deepEqual(parseLink('apron:?room=ops&message=1724803200042'), { kind: 'invalid', reason: 'no-server' });
});

test('a single-valued key given twice is refused', () => {
	assert.deepEqual(parseLink('apron:?server=wss://a.example/&room=a&room=b'), { kind: 'invalid', reason: 'duplicate-key', detail: 'room' });
});

test('servers repeat, in order, and unknown transports are kept', () => {
	const parsed = link('apron:?server=webtransport://chat.example/wt&server=wss://chat.example/ws&server=webrtc:k2Fp9xQ&signal=wss://signal.example/s&room=general');
	assert.deepEqual(
		parsed.servers.map((s) => [s.transport, s.known, s.value]),
		[
			['webtransport', false, 'webtransport://chat.example/wt'],
			['wss', true, 'wss://chat.example/ws'],
			['webrtc', false, 'webrtc:k2Fp9xQ']
		]
	);
	assert.deepEqual(parsed.extra, [['signal', 'wss://signal.example/s']]);
	assert.equal(formatUri(parsed), 'apron:?server=webtransport://chat.example/wt&server=wss://chat.example/ws&server=webrtc:k2Fp9xQ&room=general&signal=wss://signal.example/s');
});

test('server URLs are checked', () => {
	assert.equal(parseServer('wss://chat.example').value, 'wss://chat.example/');
	assert.equal(parseServer('WSS://Chat.Example:443/ws').value, 'wss://chat.example/ws');
	assert.equal(parseServer('wss://chat.example:8443/ws').host, 'chat.example:8443');
	assert.equal(parseServer('wss://bücher.example/').host, 'xn--bcher-kva.example');
	assert.equal(parseServer('wss://chat.acme.com@evil.example/'), 'bad-server');
	assert.equal(parseServer('wss://user:pass@chat.example/'), 'bad-server');
	assert.equal(parseServer('wss:chat.example'), 'bad-server');
	assert.equal(parseServer('chat.example/ws'), 'bad-server');
	assert.equal(parseServer('chat.example:8443/ws'), 'bad-server', 'a URL parser reads chat.example as its scheme');
	assert.equal(parseServer('localhost:8080').known, false, 'a transport named localhost, which no client lists');
	assert.equal(parseServer('wss://chat.example/ws\u0000'), 'bad-server');
	assert.equal(parseServer('wss://'), 'bad-server');
	assert.equal(parseServer('javascript:alert(1)').known, false);
});

test('ws:// only on loopback', () => {
	assert.equal(parseServer('ws://localhost:8080/ws').network, 'loopback');
	assert.equal(parseServer('ws://127.0.0.1:8080/').network, 'loopback');
	assert.equal(parseServer('ws://[::1]:8080/').network, 'loopback');
	assert.equal(parseServer('ws://[::ffff:127.0.0.1]/').network, 'loopback');
	assert.equal(parseServer('ws://chat.example/'), 'insecure-server');
	assert.equal(parseServer('ws://192.168.1.5/'), 'insecure-server');
	assert.deepEqual(parseLink('apron:?server=ws://chat.example/'), { kind: 'invalid', reason: 'insecure-server', detail: 'ws://chat.example/' });
});

test('networks', () => {
	for (const host of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.1.1', '100.64.0.1', '[fd12:3456::1]', '[fe80::1]', 'printer.local', 'nas.home.arpa', 'intranet']) {
		assert.equal(networkOf(new URL(`wss://${host}/`).hostname), 'private', host);
	}
	for (const host of ['localhost', 'app.localhost', '127.1.2.3', '[::1]']) {
		assert.equal(networkOf(new URL(`wss://${host}/`).hostname), 'loopback', host);
	}
	for (const host of ['chat.example', '172.32.0.1', '8.8.8.8', '[2001:db8::1]', '[fc0::1]']) {
		assert.equal(networkOf(new URL(`wss://${host}/`).hostname), undefined, host);
	}
});

test('IDs are checked', () => {
	assert.equal(parseLink('apron:?server=wss://h/&room=a%20b').kind, 'invalid');
	assert.equal(parseLink('apron:?server=wss://h/&room=').kind, 'invalid');
	// A thread is a room: `thread` is no key of a link, so it is passed on like any other.
	assert.deepEqual(link('apron:?server=wss://h/&room=t-1&thread=t-2').extra, [['thread', 't-2']]);
	assert.deepEqual(parseLink('apron:?server=wss://h/&message=1'), { kind: 'invalid', reason: 'message-without-room' });
	for (const bad of ['0', '01', 'abc', '1.5', '9007199254740992']) {
		assert.equal(parseLink(`apron:?server=wss://h/&room=r&message=${bad}`).kind, 'invalid', bad);
	}
	assert.equal(link('apron:?server=wss://h/&room=r&message=9007199254740991').message, '9007199254740991');
});

test('other text is not a link', () => {
	assert.deepEqual(parseLink('nonsense'), { kind: 'invalid', reason: 'not-a-link' });
	assert.deepEqual(parseLink(''), { kind: 'invalid', reason: 'not-a-link' });
	assert.deepEqual(parseLink('https://web.apron.chat/?server=wss://h/'), { kind: 'invalid', reason: 'not-a-link' });
	assert.deepEqual(parseLink('https://link.apron.chat.evil.example/#server=wss://h/'), { kind: 'invalid', reason: 'not-a-link' });
});

test('shows hidden and reordering characters, and cuts long values', () => {
	assert.equal(visible('admin‮txt.exe'), 'admin⟨U+202E⟩txt.exe');
	assert.equal(visible('a​b'), 'a⟨U+200B⟩b');
	assert.equal(visible('x'.repeat(100), 10), `${'x'.repeat(9)}…`);
});
