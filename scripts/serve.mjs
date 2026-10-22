#!/usr/bin/env node
/**
 * Serves build/ locally with the headers production sends, so the page runs
 * under the same Content-Security-Policy.
 *
 *   npm run dev              # http://localhost:8788
 *   PORT=9000 npm run dev
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { build, CONTENT_TYPES, HEADERS } from './build.mjs';

const out = build();
const port = Number(process.env.PORT ?? 8788);

/** @type {Record<string, string>} */
const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.json': 'application/json',
	'.txt': 'text/plain; charset=utf-8'
};

createServer(async (request, response) => {
	const path = new URL(request.url ?? '/', 'http://localhost').pathname;
	const file = normalize(join(out, path.endsWith('/') ? `${path}index.html` : path));
	const known = /** @type {Record<string, string>} */ (CONTENT_TYPES)[path];
	try {
		if (!file.startsWith(out) || path === '/_headers') throw new Error('not served');
		const body = await readFile(file);
		response.writeHead(200, { ...HEADERS, 'Content-Type': known ?? TYPES[extname(file)] ?? 'application/octet-stream' });
		response.end(body);
	} catch {
		response.writeHead(404, { ...HEADERS, 'Content-Type': TYPES['.html'] });
		response.end(await readFile(join(out, '404.html')));
	}
}).listen(port, () => console.log(`Serving ${out} at http://localhost:${port}/`));
