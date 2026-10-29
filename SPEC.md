# Apron links

An Apron link refers to an Apron server, or to a room, message, or user on
one. Any Apron client can open it. One person copies a link from their app, and
another person opens it in a different app. A sign-in link
([§2.1](#21-sign-in-links)) uses the same form to bring a server's sign-in
token to whichever app the user signs in with.

Apron has no global namespace. A server is the authority for its own rooms
and messages, and a server is reached at an address. So every link carries
the server's address, and everything else in the link is relative to that
server.

[PROTOCOL.md Appendix A.4](https://github.com/shazow/apron/blob/main/PROTOCOL.md#a4-links)
defines Apron links, and wins where the two differ. This document adds
detail: the encoding, the transports, and the link.apron.chat page.

```text
https://link.apron.chat/#server=wss://chat.example/ws&room=general&message=1724803200042
apron:?server=wss://chat.example/ws&room=general&message=1724803200042
```

## 1. Forms

A link has two forms. They carry the same key list and differ only in
their prefix:

| form | prefix | for |
|------|--------|-----|
| web | `https://link.apron.chat/#` | sharing between people: chat, email, QR codes |
| URI | `apron:?` | desktop apps, and references inside apps |

- The key list follows the prefix, as `application/x-www-form-urlencoded`
  pairs joined with `&`.
- In the web form, the key list is the URL fragment. Browsers do not send a
  fragment to the server, so link.apron.chat never receives the link.
- Clients MUST read both forms.
- Clients write the web form when the user copies or shares a link.
- Readers SHOULD also accept the keys in the query of a link.apron.chat
  URL, and treat them as if they followed the keys in the fragment, except
  credential keys ([§2.1](#21-sign-in-links)).

## 2. Keys

| key | value | count |
|-----|-------|-------|
| `server` | where to reach the server ([§3](#3-servers)) | one; required |
| `room` | a `room_id`, also of a thread | at most one |
| `message` | a `message_id` in `room` | at most one; requires `room` |
| `user` | a `user_id`; with `room`, of a member of that room | at most one |

- A link without `room` or `user` refers to the server.
- `room` is a `room_id`, and `user` a `user_id`. They MUST NOT be empty, or
  contain whitespace or control characters.
- A thread is a room with a parent. `room` refers to it on its own: a client
  learns the parent from the room's record, not from the link.
- `message` is a `message_id`: a positive decimal integer below 2^53, with no
  leading zero.
- Readers use the first value of a repeated key. (Two readers that kept
  different copies would open different places.)
- Readers ignore other keys. Writers keep the keys that they do not know.
  link.apron.chat passes them on to the client ([§7](#7-linkapronchat)).
- Only a sign-in link carries a credential ([§2.1](#21-sign-in-links)).
- New keys are defined in
  [PROTOCOL.md Appendix A.4](https://github.com/shazow/apron/blob/main/PROTOCOL.md#a4-links)
  or in this document only.

### 2.1. Sign-in links

A server that signs a user in outside the connection, by email or with an
external sign-in page, sends a sign-in link
([PROTOCOL.md §4.11.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#4112-temporary-tokens)).
A server that invites people sends one with an invite
([PROTOCOL.md Appendix B.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#b3-an-invite-token-signs-up-several-people)).
In the web form, any Apron client can take it:

```text
https://link.apron.chat/#server=wss://chat.example/ws&token=Hk41x9…&state=q8Rz…
https://link.apron.chat/#server=wss://chat.example/ws&token=inv_Qm7x…
```

| key | value | count |
|-----|-------|-------|
| `token` | a sign-in token or an invite: a credential | one; required |
| `state` | the `state` of the proposal that the link answers | at most one |

- `token` is the only credential key. Readers treat a key as a credential
  only when this document says so.
- A sign-in link names its `server`: the server that the token is for. A
  reader MUST refuse a sign-in link without `server`, apart from a relative
  link in content from that server ([§5](#5-relative-links)).
- Credential keys go in the URL fragment only. A reader MUST refuse a
  link.apron.chat URL with a credential key in its query: its host has
  already received the token.
- A server MAY send the web form of a sign-in link to a client that is not
  tied to it, such as one that proposed sign-in with no `return_url`.
- A server never writes a sign-in link in the `apron:` form, because any
  app can claim that scheme.
- A client never writes a sign-in link, and never copies or shares one.
- A client uses a sign-in link with the `state` of a proposal that it made
  on the server that the proposal went to, whatever `server` the link
  names. It uses any other sign-in link only after the user confirms, on a
  screen that shows the server, because someone else may have made it.
- A client presents the token of a link without the `state` of its own
  proposal with `scheme: "token"`. The server knows what the token is for.

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
- A client reaches the server only over a transport that it implements. It
  never hands the `server` value to a browser or the operating system to
  open.
- A client that does not support the link's transport tells the user which
  transport the link needs. It MUST NOT try another way to reach the server.
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
- Writers write the keys in this order: `server`, `room`, `message`,
  `user`, then other keys in the order that they came.

A room with the ID `#ops/alerts`:

```text
https://link.apron.chat/#server=wss://chat.example/ws&room=%23ops/alerts
```

## 5. Relative links

Message content MAY contain a link without `server`. It refers to the server
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
- A bridge MUST make relative links in the content that it relays absolute.
- link.apron.chat refuses a link without `server`.

## 6. Clients

- A client recognizes links in both forms in content, and opens them
  itself, without a browser.
- Opening a link only shows its place. A client MUST NOT send, post, join,
  sign in, upload, or change a setting because of a link, without an action
  of the user on a screen that shows the server. A sign-in link with the
  `state` of the client's own proposal continues the user's sign-in, which
  started on such a screen ([§2.1](#21-sign-in-links)).
- Before a client connects to a server that the user has not used, it shows
  the server's host and asks the user. It shows an internationalized host
  name in its ASCII form.
- A client SHOULD warn the user more strongly before it connects to a server
  on a loopback host or a private network.
- A client MUST NOT connect to a server that the user has not used only to
  preview a link.
- A client keeps credentials for one exact server address. A link MUST NOT
  cause a client to send a credential to a different address.
- A client shows the host of the server for every place that it opens, in its
  own interface, apart from content that the server controls.
- A client shows `room` and `user` values as code: it escapes characters that
  hide or reorder text, and cuts long values.

## 7. link.apron.chat

link.apron.chat is a static page. It reads the link in the browser, shows
what the link refers to, and offers the clients that can open it.

- The site has no server code. Its host never receives a link.
- The page only offers. It MUST NOT open a client, or navigate away, by
  itself, except for a remembered choice.
- A viewer MAY choose "Remember my choice". The page then opens links in the
  viewer's default web client without asking, when all of these are true:
  - The default can open the link's server.
  - The link's server is not on the blocklist.
  - The link's server is not on a loopback host or a private network.
- The page opens a remembered choice by replacing its own history entry, so
  that going back does not open the client again.
- The page where the viewer turns off "Remember my choice" never opens a
  client by itself.
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
- The page keeps the viewer's default client, the remembered choice, and
  added web clients in the browser only. The default is offered first.
- The page loads no script, style, or image from another origin.
- The page passes the keys that the client's registry entry does not map on
  to the client, under their own names, in the fragment of the client's
  address, after the keys that it maps. It never puts them in the query, which the
  client's host receives. It leaves out a key whose name the client's
  format already uses.
- For a sign-in link, the page removes the link from the address bar before
  anything else, and keeps it in memory only. It says that the link signs
  in. It offers the link to copy and as a QR code, to pass on an invite or
  to sign in on another device, and says there that anyone who opens the
  link can sign in with it. It never offers the link as an `apron:` URI,
  because any app can claim that scheme.
- The page MAY show a link's web form as a QR code, to open it on another
  device. It does not for a server on a loopback host, which on another
  device would be that device's own.
- The page refuses a link with a credential key in its query, and removes
  it from the address bar.
- The page refuses a server on the blocklist (`blocked.json`), and the names
  under it.

The registry (`clients.json`) lists the clients that the page offers. The
build makes the Apple (iOS and macOS) and Android app association files
from it, so each app in the registry can open link.apron.chat links
directly.

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
- **Credentials sent to the wrong address.** A link can name an address
  close to a trusted server's, such as another port or path on the same
  host. A client that treated both as one server could send the trusted
  server's token to the other address. So a client keeps credentials for
  one exact server address ([§6](#6-clients)). Only the server can show that
  two addresses are the same server, over a connection that the client
  already trusts.
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
- **Remembered choices.** With "Remember my choice", the viewer does not see
  the server on this page before the client connects. So the client's own
  confirmation before a new server ([§6](#6-clients)) is the only check.
  Servers on the viewer's own device or network always show the page,
  because of the threat to local servers above.
- **The registry.** Whoever can change the registry or the app association
  files decides which apps receive Apron links on phones and Macs. On iOS
  and macOS, an app in the association file can take links with no choice
  shown to the user. Changes to the registry get the review of code that
  runs on every user's device. A link carries no secret, so an app that
  takes links gains little.
- **Sign-in links.** A sign-in link carries a bearer token. Someone could
  send the user a sign-in link to the attacker's account (login cross-site
  request forgery), or capture a token that leaks. Only the client can tell
  the user's own sign-in from a link that someone else made, because it
  holds the proposal's `state`. So link.apron.chat passes sign-in links on,
  and the client decides ([§2.1](#21-sign-in-links)). Passing a link on adds
  no risk, because anyone can link to a client with a token directly. What
  the page must not do is leak the token. So the token stays in fragments,
  out of the address bar and history, and out of `apron:` URIs. The viewer
  can still copy the link or show it as a QR code, because invites are
  made to be passed on; the page says that anyone who opens it can sign in
  with it. With "Remember my choice", the client's check is the only one.
- **Keys passed on.** The page passes keys that it does not know to the
  client. They reach only the client's fragment, which a client treats as
  untrusted in any case: anyone can write it in a direct link.
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
thread        https://link.apron.chat/#server=wss://chat.example/ws&room=t-123
message       https://link.apron.chat/#server=wss://chat.example/ws&room=general&message=1724803200042
user          https://link.apron.chat/#server=wss://chat.example/ws&room=general&user=ada
local server  https://link.apron.chat/#server=ws://localhost:8080/ws&room=agent
peer          https://link.apron.chat/#server=webrtc:k2Fp9xQ&signal=wss://signal.example/s&room=general
relative      apron:?room=ops&message=1724803200042
sign-in       https://link.apron.chat/#server=wss://chat.example/ws&token=Hk41x9&state=q8Rz
```

The `peer` example uses a reserved transport. Its value and keys are not
defined yet.
