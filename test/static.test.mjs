import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { build } from '../scripts/build.mjs';

const root = new URL('..', import.meta.url).pathname;

test('the site is static: no Worker code is deployed', () => {
	const config = readFileSync(join(root, 'wrangler.toml'), 'utf8');
	assert.doesNotMatch(config, /^\s*main\s*=/m, 'wrangler.toml must not set main');
	assert.doesNotMatch(config, /run_worker_first/, 'wrangler.toml must not run a Worker first');
});

test('the build holds only the expected files', () => {
	const out = build();
	/** @param {string} dir @returns {string[]} */
	const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [relative(out, join(dir, entry.name))]));
	assert.deepEqual(walk(out).sort(), [
		'.well-known/apple-app-site-association',
		'.well-known/assetlinks.json',
		'404.html',
		'_headers',
		'app.js',
		'data.js',
		'index.html',
		'link.js',
		'logo.svg',
		'registry.js',
		'robots.txt',
		'style.css'
	]);
	const headers = readFileSync(join(out, '_headers'), 'utf8');
	assert.match(headers, /^\/\*\n {2}Content-Security-Policy: default-src 'none'; script-src 'self';/);
	assert.match(headers, /^\/\.well-known\/apple-app-site-association\n {2}Content-Type: application\/json$/m);
	JSON.parse(readFileSync(join(out, '.well-known/apple-app-site-association'), 'utf8'));
	JSON.parse(readFileSync(join(out, '.well-known/assetlinks.json'), 'utf8'));
});

test('the page never uses an HTML sink', () => {
	for (const file of ['app.js', 'link.js', 'registry.js']) {
		const source = readFileSync(join(root, 'src', file), 'utf8');
		assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/, file);
	}
});
