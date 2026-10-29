#!/usr/bin/env node
/**
 * Builds the site into build/: the page, the registry and blocklist as a
 * module the page imports, the iOS and Android association files, and
 * `_headers`. Fails, building nothing, when clients.json or blocked.json has
 * a problem.
 *
 *   npm run build
 *
 * The output is files only. Nothing in it runs on the server.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appleAppSiteAssociation, assetLinks, checkBlocklist, checkRegistry } from '../src/registry.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'build');

/** Files copied from src/ as they are. */
const PAGE_FILES = ['index.html', '404.html', 'style.css', 'app.js', 'link.js', 'registry.js', 'qr.js', 'logo.svg', 'robots.txt'];

/**
 * Headers for every response. The page builds all of its markup with DOM
 * calls, so it can forbid inline code, other origins, and the DOM's HTML
 * sinks (Trusted Types). No script from anywhere else can read a link.
 */
export const HEADERS = {
	'Content-Security-Policy': [
		"default-src 'none'",
		"script-src 'self'",
		"style-src 'self'",
		"img-src 'self'",
		"base-uri 'none'",
		"form-action 'none'",
		"frame-ancestors 'none'",
		"require-trusted-types-for 'script'",
		"trusted-types 'none'"
	].join('; '),
	'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
	'Referrer-Policy': 'no-referrer',
	'X-Content-Type-Options': 'nosniff',
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
};

/** Content types the host can't tell from an extension. */
export const CONTENT_TYPES = {
	'/.well-known/apple-app-site-association': 'application/json'
};

/** `_headers` for Cloudflare static assets. */
export function headersFile() {
	const block = (/** @type {string} */ path, /** @type {Record<string, string>} */ headers) =>
		`${path}\n${Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`).join('\n')}\n`;
	return [block('/*', HEADERS), ...Object.entries(CONTENT_TYPES).map(([path, type]) => block(path, { 'Content-Type': type }))].join('\n');
}

export function build() {
	const registry = JSON.parse(readFileSync(join(root, 'clients.json'), 'utf8'));
	const blocklist = JSON.parse(readFileSync(join(root, 'blocked.json'), 'utf8'));
	const problems = [...checkRegistry(registry), ...checkBlocklist(blocklist)];
	if (problems.length) throw new Error(`Registry problems:\n${problems.map((p) => `  - ${p}`).join('\n')}`);

	rmSync(out, { recursive: true, force: true });
	mkdirSync(join(out, '.well-known'), { recursive: true });
	for (const file of PAGE_FILES) cpSync(join(root, 'src', file), join(out, file));
	writeFileSync(
		join(out, 'data.js'),
		`// Built from clients.json and blocked.json by scripts/build.mjs.\nexport const registry = ${JSON.stringify(registry)};\nexport const blocked = ${JSON.stringify(blocklist.hosts)};\n`
	);
	writeFileSync(join(out, '.well-known', 'apple-app-site-association'), `${JSON.stringify(appleAppSiteAssociation(registry), null, '\t')}\n`);
	writeFileSync(join(out, '.well-known', 'assetlinks.json'), `${JSON.stringify(assetLinks(registry), null, '\t')}\n`);
	writeFileSync(join(out, '_headers'), headersFile());
	return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		console.log(`Built ${build()}`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}
