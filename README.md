# link.apron.chat

Client-agnostic links to Apron servers, rooms (threads too), messages and users. Copy a
link from one Apron app, and open it in any other.

```text
https://link.apron.chat/#server=wss://chat.example/ws&room=general&message=1724803200042
apron:?server=wss://chat.example/ws&room=general&message=1724803200042
```

[SPEC.md](SPEC.md) defines the link format, what clients do with links, and
why. This repository is also the site at https://link.apron.chat: a static
page that shows what a link refers to and offers the apps that can open it.

The link stays in the URL fragment, so it never reaches the site's host. The
site is files only, with no server code, and the page loads nothing from
another origin.

## Development

There are no dependencies. You need Node 22 or later.

```sh
npm test        # parser, registry and build checks
npm run dev     # build, then serve at http://localhost:8788 with production's headers
npm run build   # write the site to build/
```

| path | what |
|------|------|
| `src/link.js` | reads and writes links: parsing, checks, encoding |
| `src/registry.js` | checks `clients.json` and `blocked.json`, picks what to offer, builds the app association files |
| `src/app.js` | the page |
| `clients.json` | the apps the page offers |
| `blocked.json` | server hosts that the page refuses |
| `scripts/build.mjs` | builds `build/`, including `_headers` and `.well-known/` |

`build/` holds:

- the page
- `data.js`, built from the registry and the blocklist
- `.well-known/apple-app-site-association` and `.well-known/assetlinks.json`
- `_headers`, with the Content-Security-Policy and the content types

## Adding a client

Add your app to [`clients.json`](clients.json) in a pull request.
`npm test` checks the entry.

```jsonc
{
	"id": "my-app",                      // lowercase letters, digits and dashes
	"name": "My App",                    // up to 40 characters
	"description": "What it is.",        // optional, up to 140 characters
	"homepage": "https://my-app.example/",
	"source": "https://github.com/me/my-app",   // optional
	"transports": ["wss"],               // the server transports it supports (SPEC.md §3)
	"self_hostable": true,               // optional: others host copies of this web client

	// A web client: how it takes a link. Each key is a link key, and each
	// value is the name of the key in your app's URL.
	"web": {
		"url": "https://my-app.example/open",
		"query": { "server": "server", "room": "room" },
		"fragment": { "message": "message" }
	},

	// Native apps: these go into the app association files, so the app
	// opens link.apron.chat links directly.
	"ios": { "app_ids": ["TEAMID1234.example.myapp"], "store": "https://apps.apple.com/app/id…" },
	"android": {
		"package": "example.myapp",
		"sha256_cert_fingerprints": ["AB:CD:…"],
		"store": "https://play.google.com/store/apps/details?id=example.myapp"
	},
	"desktop": { "download": "https://my-app.example/download" }
}
```

Keys you don't map, such as `user`, arrive in your URL's fragment under
their own names, after the keys you map. A sign-in link
([SPEC.md §2.1](SPEC.md#21-sign-in-links)) arrives as, for example,
`https://my-app.example/open?server=wss%3A%2F%2Fchat.example%2Fws#token=…&state=…`.
A key whose name your format already uses is not passed on.

A client in the registry agrees to follow [SPEC.md §6](SPEC.md#6-clients):

- Links never act on their own.
- The client confirms a new server before it connects.
- Credentials stay with their exact server address.
- The client never connects to a server only to preview a link.

Set `self_hostable` when people run their own copies of your web client at
other addresses, as with Apron Web. Viewers can then add their copy's address
on the page, under "Open links with" or "Use your own Apron Web", and links
open there in your `web` format. The page keeps added copies, the viewer's
default app, and "Remember my choice" in the browser's localStorage.

With "Remember my choice", links open in the default web app without the
page asking. Links to a blocked server, or to one on the viewer's device or
private network, still show the page. Turn it off on https://link.apron.chat/.

The page offers a native app's store link on its platform. It also offers
"Open in an installed app", which opens the `apron:` URI, when any app in
the registry has a native build for that platform, but not for a sign-in
link: any app can claim `apron:`. Native apps get sign-in links through the
app association files.

## Blocking a server

Add the host to [`blocked.json`](blocked.json), with a reason that the page
shows:

```json
{ "hosts": [{ "host": "evil.example", "reason": "Impersonates Acme's chat to collect passwords." }] }
```

The entry also blocks every name under the host. The page shows the reason
and offers no app. Apps should keep their own lists, because a link can be
opened without this page.

## Deploying

The site is a Cloudflare Worker with static assets only. `wrangler.toml` has
no `main`, so no Worker code runs, and `npm test` fails if one is added.

One-time setup, as for apron-web:

1. In the Cloudflare dashboard, create a Worker from this repository with
   Workers Builds.
2. Set the build command to `npm run build`, and the deploy command to
   `npx wrangler deploy`.
3. The custom domain `link.apron.chat` comes from `wrangler.toml`.

After a deploy that changes the registry, check what the platforms see:

- iOS reads the association file through Apple's CDN, which can take a day
  to update. Check
  `https://app-site-association.cdn-apple.com/a/v1/link.apron.chat`.
- Android checks `assetlinks.json` when an app is installed or updated.
  Check with Google's Digital Asset Links API:
  `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://link.apron.chat&relation=delegate_permission/common.handle_all_urls`.
