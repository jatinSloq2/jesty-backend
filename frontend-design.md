# Jesty — Frontend Design Guide (v1: Inbox + Profile/Channels)

Scope for this pass: **2 pages only.**

1. **Inbox** (main page) — WhatsApp Web clone, orange instead of green, light + dark theme.
2. **Business Profile + Channel selection** — edit the WhatsApp Business Profile, and switch which
   connected phone number ("channel") you're viewing/sending from.

Everything below maps directly to endpoints that already exist in this backend — nothing here needs
new API work except one thing already added: `GET /api/conversations?phoneNumberId=` (see
`src/controllers/conversation.controller.ts`), which is the channel selector.

---

## 0. Does the backend support this? Short answer: yes.

| Need | Backend support |
|---|---|
| Login | `POST /api/auth/login` — email+password, direct against the Users model |
| Inbox list, search, status filter | `GET /api/conversations` |
| **Channel selector** (pick one connected number) | `GET /api/conversations?phoneNumberId=...` |
| Message thread | `GET /api/conversations/:id/messages` |
| Send text / media (hosted URL) / template | `POST /api/conversations/:id/messages` |
| Send media by uploading a file | `POST /api/messages/upload` *(needs `jesty-backend-service-token` header — see §5)* |
| Forward a message | `POST /api/messages/:messageId/forward` |
| React / un-react | `POST` / `DELETE /api/messages/:messageId/react` |
| Search messages | `GET /api/messages/search?q=` |
| 24h window enforcement | Every conversation has `canSendFreeform`; `403` if you try freeform outside it |
| Contacts, tags, groups, custom attributes | `/api/contacts`, `/api/tags`, `/api/groups`, `/api/attributes` |
| Realtime (new message, status, inbox update) | Socket.IO, same JWT (`services/socket.service.ts`) |
| List connected WhatsApp numbers | `GET /api/integrations/whatsapp` |
| Connect / edit / remove a number | `POST` / `PATCH` / `DELETE /api/integrations/whatsapp/:id` |
| Get / update Business Profile | `GET` / `PATCH /api/profile?phoneNumberId=` |
| Update profile picture | `POST /api/profile/picture` *(needs `jesty-backend-service-token` header)* |
| Push notifications | `POST` / `DELETE /api/notifications/device-token` |

Nothing is missing for these two pages. The only thing worth knowing: **the two media endpoints
require an extra static header** (`jesty-backend-service-token`) on top of the normal login token —
see §5, this affects how you build the file-upload calls specifically.

---

## 1. Visual language

Think **WhatsApp Web/Desktop, re-skinned**: same three-pane layout, same bubble shapes, same density
— just swap the brand color and support both themes properly.

### 1.1 Color tokens

| Token | Light | Dark |
|---|---|---|
| `--brand` (was WhatsApp green) | `#FF7A00` (orange) | `#FF8A2B` |
| `--brand-strong` (headers, active states) | `#E8690A` | `#FF7A00` |
| `--bg-app` | `#F5F1EC` (warm off-white, not pure white) | `#0B0B0C` |
| `--bg-panel` (sidebar, chat list) | `#FFFFFF` | `#151515` |
| `--bg-chat` (message canvas) | `#FBF6EE` (faint warm tint, like WA's doodle bg) | `#0E0E0F` |
| `--bubble-out` (my messages) | `#FFE3C2` (soft orange tint) | `#3A2A17` |
| `--bubble-in` (their messages) | `#FFFFFF` | `#1E1E1F` |
| `--text-primary` | `#1B1B1B` | `#F2F2F2` |
| `--text-secondary` | `#6B6B6B` | `#9A9A9A` |
| `--border` | `#E7E1D8` | `#262626` |
| `--unread-badge` | `#FF7A00` | `#FF7A00` |
| `--online-dot` / status "sent" | `#3FA34D` (keep a neutral green ONLY for delivery ticks — not as brand) | same |
| `--danger` | `#D64545` | `#E5605B` |

Rule of thumb: **orange replaces every place WhatsApp uses green as brand color** (send button,
active nav icon, my-message-bubble accent, links, focus rings, unread badge). Delivery/read
ticks stay their natural colors (grey → blue) since that's a universal WhatsApp convention users
already read at a glance — don't reskin those.

### 1.2 Typography

- UI font: system stack — `-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` (matches
  WhatsApp's own approach; don't import a custom webfont, keep it fast and native-feeling).
- Base size 14px, chat bubble text 14.5px, timestamps/meta 12px, conversation-list name 15px/medium.

### 1.3 Theme switch

- A simple sun/moon toggle in the sidebar footer (next to the profile avatar). Persist choice
  locally (this is a UI preference, not server state — don't add a backend field for it).
- Both themes must hit AA contrast for text; the `--bubble-out` orange tint especially needs
  checking in dark mode (dark orange-brown, not a saturated orange background — saturated orange
  behind white text fails contrast and looks like an alert, not a message).

---

## 2. Page 1 — Inbox (main page)

Three-pane layout, exactly like WhatsApp Web:

```
┌───────────┬─────────────────────────┬───────────────────────┐
│  Left rail│   Chat list (conv list) │      Chat pane         │
│  (icons)  │                         │                        │
│           │  [Channel selector]     │  [Contact header]      │
│  Chats    │  [Search]               │                        │
│  Contacts │  [Status tabs]          │  [Message thread]      │
│  Settings │  ─────────────────────  │                        │
│  Profile  │  [Conversation rows...] │  [Composer]             │
└───────────┴─────────────────────────┴───────────────────────┘
```

### 2.1 Left rail (icon nav)
Vertical strip, same as WhatsApp's leftmost bar. Icons: Chats (active by default), Contacts, Groups
(if you use group broadcast lists), Notifications, and at the bottom: theme toggle, then the
logged-in user's avatar (opens Profile/Channels — page 2).

### 2.2 Chat list panel
- **Channel selector** at the very top — a WhatsApp-style dropdown/pill showing the active number
  (e.g. "🟠 Support · +91 98765 43210") with a chevron. Options come from
  `GET /api/integrations/whatsapp` (only `isActive: true` ones); selecting one re-fetches
  `GET /api/conversations?phoneNumberId=<id>`. Include an "All numbers" option at the top (omit the
  param) if the user has more than one connected number.
- Search bar (`?search=`), and status tabs/chips: **All / Open / Pending / Closed** (`?status=`).
- Each row: contact avatar, name (fallback to phone number), last message preview, timestamp,
  unread badge (orange, only when `unreadCount > 0`), and a small window indicator — a subtle
  clock/hourglass icon when `canSendFreeform` is `false` (24h window closed, template-only).
- Infinite scroll / "load more" using `page`/`limit`.
- Live updates via socket `inbox:update` — re-order/update the row in place, don't refetch the
  whole list.

### 2.3 Chat pane
- **Header**: contact name/number, avatar, a small "window closed — template only" pill when
  `canSendFreeform: false`, and a status dropdown (open/pending/closed →
  `PATCH /api/conversations/:id`).
- **Thread**: bubbles right-aligned (orange tint) for outgoing, left-aligned (white/dark-panel) for
  incoming — same corner-radius/tail convention as WhatsApp. Support: text, image, video, audio (with
  waveform-style player), document (file card), sticker, and reactions rendered as a small emoji chip
  on the bubble corner. Reply-to shows a quoted preview strip above the bubble text. Forwarded
  messages show a small "↪ Forwarded" label.
- Load via `GET /api/conversations/:id/messages` (paginate upward on scroll-to-top), live new
  messages via socket `message:new`, delivery/read ticks update via socket `message:status`.
- **Composer**: text input, emoji picker, attach button (image/video/doc — opens a file picker →
  `POST /api/messages/upload`, see §5 for the required header), send button (orange, paper-plane
  icon like WhatsApp's). When `canSendFreeform` is `false`, replace the composer with a **template
  picker** ("Start a new conversation with a template") instead of a disabled text box — this is
  the correct WhatsApp-style UX for the 24h rule, not a greyed-out input.
- Right-click / long-press on a bubble → context menu: React, Reply, Forward, Copy. Forward opens a
  contact/conversation picker → `POST /api/messages/:messageId/forward`.

### 2.4 Contact info drawer (opens from chat header, slides in from the right — same as WhatsApp)
- Avatar, name, phone number, tags (chip list, editable via `/api/tags`), group memberships
  (`/api/groups`), custom attributes (`/api/attributes`), block/unblock toggle
  (`POST /api/contacts/:id/block`).

---

## 3. Page 2 — Business Profile + Channel Selection

One settings-style page reached from the left-rail avatar. Two tabs/sections:

### 3.1 "Channels" tab — your connected WhatsApp numbers
- List every number from `GET /api/integrations/whatsapp` as cards: label, phone number, connection
  status badge (unverified/connected/failed/expired — color-coded, orange for "connected" instead of
  WhatsApp's green), a "Default" star/toggle, active/inactive switch.
- "+ Connect a number" button → form: label, phone number, phone number ID, WABA ID, App ID, App
  Secret, access token, token type → `POST /api/integrations/whatsapp`.
- Card menu: Edit (rename, rotate token, set default, activate/deactivate →
  `PATCH /api/integrations/whatsapp/:id`), Disconnect (`DELETE .../:id`).
- **This list is also what powers the channel selector dropdown on the Inbox page** — same data
  source, so keep the card design consistent with that dropdown's row style.

### 3.2 "Business Profile" tab — for whichever number is currently selected
- A `phoneNumberId` picker at the top of this tab too (reuse the same selector component from the
  inbox), since profile fields are per-number.
- Form fields: About, Description, Address, Email, up to 2 Websites, Vertical/category →
  `GET`/`PATCH /api/profile?phoneNumberId=`.
- Profile picture: circular avatar with a camera-icon overlay on hover, click → file picker →
  `POST /api/profile/picture` (multipart, field name `file`, plus `phoneNumberId` in the form body
  if not using the default number). **Requires the service-token header — see §5.**

---

## 4. Interaction details worth getting right (WhatsApp muscle memory)

- Bubble tail + grouping: consecutive messages from the same sender within a few minutes collapse
  (no repeated avatar/name, tighter spacing) — exactly like WhatsApp.
- Date separators ("Today", "Yesterday", "12 March") centered in the thread.
- Optimistic send: bubble appears immediately with a single grey tick, upgrades to double-tick
  (sent), then blue double-tick (read) as `message:status` events arrive; on failure show a small
  red "!" with a tap-to-retry.
- Unread badge uses the same orange as brand, white numerals, pill shape, top-right of the avatar or
  right-aligned in the row — pick one, WhatsApp uses right-aligned.
- Emoji reaction picker is a small floating row of 6 emoji + "more" — appears on hover (desktop) or
  long-press (touch), matches WhatsApp's exact interaction, not a full picker by default.

---

## 5. One thing to bake into your API client now

`POST /api/messages/upload` and `POST /api/profile/picture` are **media endpoints** and require a
second, static header alongside the normal Bearer token:

```
Authorization: Bearer <user's access token>
jesty-backend-service-token: <shared service token>
```

Every other endpoint only needs the Bearer token. Build your API client so file-upload calls go
through a distinct helper (e.g. `uploadClient`) that always attaches both headers, rather than
sprinkling the second header ad hoc — it's easy to forget on one call and get a confusing 401.

Where that service token value comes from (env var baked into your app at build time, fetched from a
config endpoint, held by a backend-for-frontend, etc.) depends on how your frontend is deployed —
tell me that and I'll pin down exactly where it should live.

---

## 6. Suggested page/route structure

```
/login                          — email + password
/inbox                          — Page 1 (default after login)
/inbox/:conversationId          — same layout, chat pane deep-linked
/settings/channels              — Page 2, tab: Channels
/settings/profile               — Page 2, tab: Business Profile
```

That's the full v1 scope — 2 pages, both fully backed by existing endpoints.
