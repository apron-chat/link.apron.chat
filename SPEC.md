# Apron links

An Apron link refers to an Apron server, or to a room, thread, or message on
one. Any Apron client can open it. One person copies a link from their app,
and another person opens it in a different app.

Apron has no global namespace. A server is the authority for its own rooms
and messages, and a server is reached at an address. So every link carries
the server's address, and everything else in the link is relative to that
server.

```text
https://link.apron.chat/#server=wss://chat.example/ws&room=general&message=1724803200042
apron:?server=wss://chat.example/ws&room=general&message=1724803200042
```

## 1. Forms

A link has three forms. They carry the same key list and differ only in
their prefix:

| form | prefix | for |
|------|--------|-----|
| web | `https://link.apron.chat/#` | sharing between people: chat, email, QR codes |
| URI | `apron:?` | desktop apps, and references inside apps |
| web handler | `web+apron:?` | web clients, through `navigator.registerProtocolHandler` |

- The key list follows the prefix, as `application/x-www-form-urlencoded`
  pairs joined with `&`.
- In the web form, the key list is the URL fragment. Browsers do not send a
  fragment to the server, so link.apron.chat never receives the link.
- Clients MUST read all three forms.
- Clients SHOULD write the web form when the user copies or shares a link.
- Readers SHOULD also accept the keys in the query of a link.apron.chat
  URL, and treat them as if they were in the fragment.

## 2. Keys

| key | value | count |
|-----|-------|-------|
| `server` | where to reach the server ([§3](#3-servers)) | one or more; required |
| `room` | a `room_id` | at most one |
| `thread` | the `room_id` of a thread in `room` | at most one; requires `room` |
| `message` | a `message_id` in `room` or `thread` | at most one; requires `room` |

- A link without `room` refers to the server.
- `room` and `thread` are `room_id`s. They MUST NOT be empty, or contain
  whitespace or control characters.
- `message` is a `message_id`: a positive decimal integer below 2^53, with no
  leading zero.
- A reader MUST refuse a link that repeats `room`, `thread`, or `message`.
  (Two readers that keep different copies would open different places.)
- Readers ignore other keys. Writers keep the keys that they do not know.
- A link MUST NOT carry a credential. Readers MUST refuse a link that has a
  `token` key, and MUST NOT act on it.
- New keys are defined in this document only.

## 3. Servers

A `server` value is `<transport>:<rest>`. The transport defines how to reach
the server and what `<rest>` holds.

| transport | value | status |
|-----------|-------|--------|
| `wss` | a WebSocket URL with TLS | defined |
| `ws` | a WebSocket URL without TLS, on a loopback host only | defined |
| `webtransport` | `webtransport://host/path`, reached as `https://host/path` | reserved |
| `tls` | `tls://host:port`, newline-delimited JSON over TLS | reserved |
| `webrtc` | `webrtc:<public key>`, with `signal` hints | reserved |

- Transport names are lowercase letters, digits, and dashes. They contain no
  `+`, which form decoding reads as a space, and no `.`.
- A `wss` or `ws` value is an absolute URL with a host. It MUST NOT contain a
  user name, a password, or a fragment.
- A `ws` value's host MUST be a loopback host: `localhost`, a name under
  `localhost`, `127.0.0.0/8`, or `::1`.
- A link MAY repeat `server` for one server that is reachable in more than
  one way. The values are in order of preference.
- A client uses the first value whose transport it supports.
- A client that supports none of the values tells the user which transports
  the link needs. It MUST NOT try another way to reach the server.
- A transport's own options go in their own keys, defined with the
  transport, such as `signal`. They do not go inside the `server` value.

## 4. Encoding

Writers percent-encode each key and value, so that the link stays readable
and survives text that apps scan for links:

- Writers leave ASCII letters, digits, `-`, `.`, `_`, `~`, `:` and `/` as
  they are, and encode every other character.
- Writers MUST encode `+` as `%2B`, `&` as `%26`, `=` as `%3D`, `#` as `%23`,
  and `%` as `%25`.
- Readers decode with form decoding, where a bare `+` is a space.
- Writers write the keys in this order: `server` values, `room`, `thread`,
  `message`, then other keys in the order that they came.

A room with the ID `#ops/alerts`:

```text
https://link.apron.chat/#server=wss://chat.example/ws&room=%23ops/alerts
```

## 5. Relative links

Message content MAY contain a URI without `server`. It refers to the server
that sent the content:

```text
apron:?room=ops
apron:?room=ops&message=1724803200042
```

- Relative links are valid only in content from a server, such as a
  message's text.
- A client resolves a relative link against the server that sent the
  content. It does not resolve it against the server that the user is
  viewing.
- A client MUST make a relative link absolute, by adding the server, before
  the link leaves its server: when the user copies it, or forwards or quotes
  the content to another server.
- A bridge MUST make relative links in the content that it relays absolute,
  or remove them.
- link.apron.chat refuses a link without `server`.

## 6. Clients

- A client recognizes links in all three forms in content, and opens them
  itself, without a browser.
- Opening a link only shows its place. A client MUST NOT send, post, join,
  sign in, upload, or change a setting because of a link, without an action
  of the user on a screen that shows the server.
- Before a client connects to a server that the user has not used, it shows
  the server's host and asks the user. It shows an internationalized host
  name in its ASCII form.
- A client SHOULD warn the user more strongly before it connects to a server
  on a loopback host or a private network.
- A client MUST NOT connect to a server that the user has not used only to
  preview a link.
- A client keeps credentials for one exact server address. A link MUST NOT
  cause a client to send a credential to a different address, also when the
  link repeats `server`.
- A client shows the host of the server for every place that it opens, in its
  own interface, apart from content that the server controls.
- A client shows `room` and `thread` values as code: it escapes characters
  that hide or reorder text, and cuts long values.

## 7. link.apron.chat

link.apron.chat is a static page. It reads the link in the browser, shows
what the link refers to, and offers the clients that can open it.

- The site has no server code. Its host never receives a link.
- The page only offers. It MUST NOT open a client, or navigate away, by
  itself.
- The page shows the server's host first, before any value that the link
  chooses.
- The page builds each client's address from the client's entry in the
  registry, or from a web client that the viewer added on the page. It never
  takes an address from the link.
- A viewer MAY add the address of a self-hosted copy of a web client that the
  registry marks `self_hostable`. The page opens links there in that
  client's format.
- Only the viewer adds a web client, on the page itself. A link MUST NOT add
  one, or choose the default. (A link that could would send its readers to an
  attacker's copy of a web client, to collect their passwords.)
- The page keeps the viewer's default client and added web clients in the
  browser only. The default is offered first. The page still does not open it
  by itself.
- The page loads no script, style, or image from another origin.
- The page removes a link with a `token` key from the address bar, and does
  not offer it to any client.
- The page refuses a server on the blocklist (`blocked.json`), and the names
  under it.

The registry (`clients.json`) lists the clients that the page offers. The
build makes the iOS and Android app association files from it, so each app
in the registry can open link.apron.chat links directly.

## 8. Security considerations

link.apron.chat lends a trusted domain to a destination that anyone
chooses. A phone, a QR code reader, or a chat app's link preview shows
"link.apron.chat", but the link can refer to any server. The rules above
exist because of these threats:

- **Malicious servers.** A server is the authority on identity in it. A
  malicious server can show any names, avatars, and welcome text, and can
  send the user to a sign-in page that it controls. Lookalike hosts, such as
  `chat.acrne.co` for `chat.acme.co`, make this easier. The confirmation
  before a new server ([§6](#6-clients)) and the host in ASCII form slow
  this down. They do not stop it.
- **Credentials sent to the wrong address.** A link can repeat `server` and
  pair a trusted address with an attacker's address. A client that treated
  both as one server could send the trusted server's token to the attacker.
  Only the server can show that two addresses are the same server, over a
  connection that the client already trusts.
- **Local servers.** Apron servers include coding harnesses and bots that run
  on the user's own computer, often with guest sign-in. A link that could
  post would let anyone run commands there with one click. So links never
  act ([§6](#6-clients)), and `ws` is allowed only on loopback hosts. A web
  page can also open a WebSocket to `localhost` with no link at all. A local
  server checks the `Origin` header, or requires sign-in.
- **Connections without a click.** A client that previews links by
  connecting to their servers would let anyone who can post a message make
  every reader's client connect to any host. That shows the readers' IP
  addresses and when they read, and reaches services on their networks.
- **The page itself.** The page builds addresses from values that a link
  chooses. That invites script injection and open redirects. So it builds
  markup with DOM calls only, forbids the HTML sinks through Trusted Types,
  and takes client addresses from the registry only. A script from another
  origin could read the fragment, so the page loads none, and has no
  analytics.
- **The registry.** Whoever can change the registry or the app association
  files decides which apps receive Apron links on phones. On iOS, an app in
  the association file can take links with no choice shown to the user.
  Changes to the registry get the review of code that runs on every user's
  phone. A link carries no secret, so an app that takes links gains little.
- **Sign-in links.** A sign-in link carries a bearer token. If link.apron.chat
  passed one on, someone could sign the user in to the attacker's account
  (login cross-site request forgery) or capture the token.
- **Disclosure.** A link shows its server's address and its room ID to anyone
  who sees it. Room IDs and server addresses are not secrets, and the server
  enforces access. The fragment keeps links out of link.apron.chat's logs,
  but not out of the apps and people that handle the link.
- **Hidden characters.** A `room_id` can contain characters that hide or
  reverse text, such as U+202E. A confirmation screen could then show a
  different name than the link has.

## Appendix A. Examples

```text
server        https://link.apron.chat/#server=wss://chat.example/ws
room          https://link.apron.chat/#server=wss://chat.example/ws&room=general
thread        https://link.apron.chat/#server=wss://chat.example/ws&room=general&thread=t-123
message       https://link.apron.chat/#server=wss://chat.example/ws&room=general&message=1724803200042
local server  https://link.apron.chat/#server=ws://localhost:8080/ws&room=agent
two ways      https://link.apron.chat/#server=webtransport://chat.example/wt&server=wss://chat.example/ws&room=general
peer          https://link.apron.chat/#server=webrtc:k2Fp9xQ&signal=wss://signal.example/s&room=general
relative      apron:?room=ops&message=1724803200042
```

The `webtransport` and `webrtc` examples use reserved transports. Their
values and keys are not defined yet.
