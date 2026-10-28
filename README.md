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
`npm test` checks the entry. A client in the registry agrees to follow
[SPEC.md §6](SPEC.md#6-clients):

- Links never act on their own.
- The client confirms a new server before it connects.
- Credentials stay with their exact server address.
- The client never connects to a server only to preview a link.

Every entry has these keys, and then `web`, native app keys, or both:

```jsonc
{
	"id": "my-app",                             // lowercase letters, digits and dashes
	"name": "My App",                           // up to 40 characters
	"description": "What it is.",               // optional, up to 140 characters
	"homepage": "https://my-app.example/",
	"source": "https://github.com/me/my-app",   // optional
	"transports": ["wss"]                       // the server transports it supports (SPEC.md §3)
}
```

### Web clients

```jsonc
"web": {
	"url": "https://my-app.example/open",
	"query": { "server": "server", "room": "room" },
	"fragment": { "message": "message" }
},
"self_hostable": true                           // optional
```

Each key in `query` and `fragment` is a link key (`server`, `room`,
`message`, `user`), and its value is the name your URL uses for it.
`server` is required. Use the fragment where you can: it never reaches your
host, so your host doesn't learn which servers and rooms people open.

Link keys you don't map, and a sign-in link's `token` and `state`, arrive in
the fragment under their own names, unless your format already uses that
name. A sign-in link ([SPEC.md §2.1](SPEC.md#21-sign-in-links)) opens the
example above as
`https://my-app.example/open?server=wss%3A%2F%2Fchat.example%2Fws#token=…&state=…`.

Set `self_hostable` if people run copies of your web client at other
addresses, as with Apron Web. They can then add their copy on the page, and
links open there in your `web` format.

### Native apps

Add a key for each platform your app runs on. The page offers it only on
those platforms.

```jsonc
"ios": { "app_ids": ["TEAMID1234.example.myapp"], "store": "https://apps.apple.com/app/id…" },
"android": {
	"package": "example.myapp",
	"sha256_cert_fingerprints": ["AB:CD:…"],
	"store": "https://play.google.com/store/apps/details?id=example.myapp"
},
"macos": { "app_ids": ["TEAMID1234.example.myapp.mac"], "download": "https://my-app.example/download" },
"windows": { "download": "https://my-app.example/download" },
"linux": { "download": "https://my-app.example/download" }
```

`store` is optional, and so are a Mac app's `app_ids`.

- **iOS, Android, and Mac apps with `app_ids`** open link.apron.chat links
  directly, sign-in links too: the build puts them in the app association
  files. On iOS and macOS, add the Associated Domains entitlement
  `applinks:link.apron.chat`; an app ID shared by an iOS and a Mac build goes
  in both lists. On Android, add an `android:autoVerify="true"` intent filter
  for `https://link.apron.chat`.
- **Windows and Linux apps, and Mac apps without `app_ids`,** get links
  through the `apron:` URI scheme, which the page offers as "Open in an
  installed app". It never offers it for a sign-in link, since any app can
  claim `apron:`.

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

- iOS and macOS read the association file through Apple's CDN, which can
  take a day to update. Check
  `https://app-site-association.cdn-apple.com/a/v1/link.apron.chat`.
- Android checks `assetlinks.json` when an app is installed or updated.
  Check with Google's Digital Asset Links API:
  `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://link.apron.chat&relation=delegate_permission/common.handle_all_urls`.
