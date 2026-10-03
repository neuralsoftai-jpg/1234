# Chatroom

Anonymous real-time chat — no signup, no database, no file storage.

Built with **React (Vite)** + **Node.js (Express + Socket.io + Web Push)** in a single project.

---

## Features

| Feature | Details |
|---------|---------|
| **Create chat** | Server generates a unique 6-char code (A-Z 0-9) |
| **Join chat** | Enter the code — max 2 people per room |
| **Special Access** | Visitor enters password → private room with owner |
| **Owner dashboard** | Telegram-style list of all active visitor chats |
| **Real-time messaging** | Socket.io, timestamps, double-check marks |
| **Typing indicator** | 3 bouncing dots, throttled events, auto-clear |
| **Web Push** | Notifications when tab is closed (VAPID) |
| **No storage** | All data lives in server memory only |
| **Dark / Light theme** | Follows system preference |

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
SPECIAL_PASSWORD=your-special-password
OWNER_KEY=your-secret-owner-key
PORT=3000
```

### 3. Run (dev mode)

```bash
npm run dev
```

Starts the Express server with Vite in middleware mode.
Open http://localhost:3000

### 4. Build for production

```bash
npm run build
NODE_ENV=production npm start
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SPECIAL_PASSWORD` | Password visitors type for Special Access |
| `OWNER_KEY` | Secret key the owner uses at `/owner` |
| `PORT` | Port to listen on (default: 3000) |

> **Never commit `.env` or `.vapid.json`** — both are in `.gitignore`.

VAPID keys are auto-generated into `.vapid.json` on first run and persisted across restarts.

---

## Owner Access

Navigate to `/owner` (not linked from the home screen).
Enter `OWNER_KEY` to see the Telegram-style visitor dashboard.

**Rate limit:** 5 wrong attempts = 10-minute IP lockout.

---

## Web Push / Notifications

- Works in all modern browsers on **HTTPS** (or localhost for dev).
- **iPhone / iOS Safari:** The site must be **added to the Home Screen** as a PWA before push notifications work. Open the site in Safari → Share → "Add to Home Screen".
- Click the 🔔 bell icon in any screen header to subscribe.

---

## Architecture

```
server.js          Express + Socket.io + Web Push
├── Vite middleware (dev) or serves dist/ (prod)
├── /api/vapid-public-key  → VAPID public key
└── Socket.io events:
    create, join, special-join, special-rejoin
    owner-login, msg, typing, stop-typing
    sub, end, rename-visitor

src/
├── main.jsx       registers service worker
├── App.jsx        routes: / /chat /owner /owner/dash
├── socket.js      singleton io() instance
├── index.css      Telegram-style design system
└── components/
    Home, CreateChat, JoinChat, SpecialAccess
    Chat, MessageBubble, TypingIndicator
    NotificationBell
    OwnerLogin, OwnerDashboard, OwnerChat

public/
├── sw.js          service worker (push + click handling)
└── manifest.json  PWA manifest
```

### Data Model (server memory only)

```js
rooms: Map<roomId, {
  type: 'normal' | 'special',
  members: Map<clientId, {
    socketIds: Set<string>,   // supports multiple tabs
    subs: PushSubscription[]  // web-push subscriptions
  }>
}>

owners: Set<socketId>    // all owner tabs/devices
ownerSubs: []            // owner push subscriptions
visitorNames: Map<clientId, string>
```

**Room ID formats:**
- Normal: 6-char alphanumeric code e.g. `AB12CD`
- Special: `special-{visitorClientId}`

---

## Deploy to Render / Railway

Both support persistent Node.js servers (required — this app is not serverless-compatible).

### Render

1. Push to GitHub
2. New Web Service → select repo
3. Build command: `npm install && npm run build`
4. Start command: `NODE_ENV=production node server.js`
5. Add env vars: `SPECIAL_PASSWORD`, `OWNER_KEY`
6. **Enable HTTPS** (Render does this automatically)

### Railway

1. Push to GitHub → connect repo
2. Set same env vars
3. Railway auto-detects Node and deploys

### Important Notes

- You **must** use HTTPS in production for Web Push and service workers to work.
- `VAPID.json` is generated on first run and persists between deploys if you use a persistent disk (Render Disk, Railway Volume). Without persistent storage, a new VAPID key is generated on each deploy — this invalidates existing push subscriptions.
- All chat data is **in memory** — a server restart clears all rooms and messages.

---

## Security

- Owner key compared with `crypto.timingSafeEqual` — no timing attacks
- Passwords are never logged
- Messages are trimmed to 2000 chars per socket event
- Message rate limit: 10 messages per 5 seconds per socket
- Owner login: 5 attempts per 10 minutes per IP
- Special-access reconnect uses `clientId` (UUID) not the password
