# Jesty Backend

Express + TypeScript + MongoDB backend for **Jesty** — official WhatsApp Cloud API inbox.

## Setup

```bash
npm install
cp .env.example .env   # fill in real values
npm run dev             # http://localhost:5000
```

Swagger docs: `http://localhost:5000/api-docs`

## What's wired up

- **Webhook** (`POST /api/webhook`) — your other backend owns the real Meta webhook + verify-token
  handshake with Meta directly. It forwards the same payload it receives from Meta to Jesty at this
  endpoint, authenticated via an `x-webhook-secret` header that must match `INTERNAL_WEBHOOK_SECRET`
  on both sides. Jesty then does all the actual processing: creates/updates contacts, conversations,
  messages, status updates, and stamps the 24h window.
- **24-hour service window** — every inbound customer message stamps `Conversation.lastCustomerMessageAt`.
  `POST /conversations/:id/messages` rejects freeform text/media sends once that's >24h old (`403`),
  but always allows `type: "template"` sends, per Meta's rule. Inbox list responses include a
  `canSendFreeform` boolean per conversation so the frontend can grey out the input.
- **Two MongoDB connections**
  - **Primary** (`MONGO_URI`) — Jesty's own operational data: `Contact`, `Conversation`, `Message`,
    `Group`, `Tag`, `Attribute`, `DeviceToken`, `UserSession` (a fast local mirror of the logged-in
    user's profile).
  - **Second, shared connection** (`AUTH_MONGO_URI`) — the same database your other service(s) use.
    Two models live here, bound via `authConnection.model(...)` in `src/config/db.ts`:
    - `models/User.ts` — the Users collection (email/password, referral, wallet, etc.).
    - `models/Integration.ts` — per-user, per-channel credentials (WhatsApp, email, SMS, AI
      provider, Google Sheets, Razorpay, meeting scheduling). Secret fields (access tokens, API
      keys, app secrets) are transparently AES-256-GCM encrypted at rest via `utils/crypto.ts`
      (`ENCRYPTION_KEY` — use the same value across services so they can read each other's
      Integration documents).
- **Auth — owned locally now.** `POST /api/auth/login` takes `{ email, password }` and checks it
  directly against the `User` model on the second/shared connection (bcrypt compare). Jesty then
  mints its own JWT access + refresh tokens (`JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`), sets them
  as httpOnly cookies and returns them in the response body. `POST /api/auth/refresh` rotates them;
  `POST /api/auth/logout` revokes the refresh token. Nothing is proxied to another auth service
  anymore — see `src/services/auth.service.ts` and `src/middleware/auth.ts`.
- **Multiple WhatsApp numbers per login.** One user can connect and manage several WhatsApp numbers
  under a single Jesty login — each is its own `channel: "whatsapp"` `Integration` document owned by
  that user (`models/Integration.ts`). `GET/POST /api/integrations/whatsapp` lists/connects numbers;
  `PATCH/DELETE /api/integrations/whatsapp/:id` updates (rename, rotate token, set default,
  activate/deactivate) or disconnects one. On login, `assignedPhoneNumberIds` on the returned user
  (and on every subsequent authenticated request, `req.user.assignedPhoneNumberIds`) is the list of
  `phone_number_id`s from that user's active WhatsApp integrations — every outbound send resolves the
  right integration's access token by the conversation's `phoneNumberId` (`services/integration.service.ts`),
  so each connected number sends with its own credentials.
- **Contacts / Tags / Groups / Attributes** — full CRUD, search, tag/group filtering on contacts.
- **Profile** — `GET/PATCH /api/profile` for WhatsApp Business Profile fields (about, description,
  address, email, websites); `POST /api/profile/picture` (multipart) uploads to Meta and sets it.
- **Media endpoints require a service token.** In addition to the normal Bearer access token, both
  media-handling endpoints — `POST /api/messages/upload` and `POST /api/profile/picture` — require a
  `jesty-backend-service-token` header matching `JESTY_BACKEND_SERVICE_TOKEN` (see
  `middleware/auth.ts#requireServiceToken`). This is a static, service-level token (not per-user),
  meant for whatever gateway/service proxies these multipart requests to Jesty.
- **Realtime** — Socket.IO pushes `message:new`, `message:status`, `inbox:update` events, auth'd via
  the same JWT (`services/socket.service.ts`).

## Not yet built (flagged, not faked)

- Bulk messaging / campaigns (the `sendTemplateMessage` service function is ready to be looped over
  a contact list once you want this — remember to resolve each recipient's integration/access token
  via `services/integration.service.ts`).
- Media storage — inbound media currently stores Meta's `media_id`; add an S3/local download step
  in `webhook.controller.ts` where noted if you want permanent URLs instead of re-fetching from Meta.

Jesty does **not** implement password reset or email OTP/verification — login is plain email +
password only (`POST /api/auth/login`). The `User` schema has no OTP fields at all.
