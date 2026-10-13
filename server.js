import 'dotenv/config';
import express from 'express';
import { createServer as createHttpServer } from 'http';
import { Server } from 'socket.io';
import webpush from 'web-push';
import { timingSafeEqual } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getVapidKeys } from './vapid.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// ── VAPID key management ───────────────────────────────────────────────────────
// Prefer Vercel environment variables; local development persists keys in .vapid.json.
const vapidKeys = getVapidKeys();

// ── Express + HTTP + Socket.io ─────────────────────────────────────────────────
const app = express();
const httpServer = createHttpServer(app);

// Allow cross-origin requests from Vercel frontend or any configured domain
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile, curl) and any cross-origin domain
      callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
    credentials: true,
  },
  // Allow up to 64 KB per message
  maxHttpBufferSize: 64 * 1024,
});

app.use(express.json());

// Express CORS middleware: allow preflight OPTIONS and cross-origin calls
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Health check endpoint for deployment status check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Expose VAPID public key to the frontend
app.get('/api/vapid-public-key', (_req, res) => {
  try {
    const keys = getVapidKeys();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ publicKey: keys.publicKey });
  } catch (err) {
    console.error('[VAPID] Failed to get public key:', err);
    res.status(503).json({ error: 'Push notifications unavailable.' });
  }
});

// ── In-memory data model ───────────────────────────────────────────────────────
/**
 * rooms: Map<roomId, {
 *   type: 'normal' | 'special',
 *   members: Map<clientId, {
 *     socketIds: Set<string>,   // a client may have multiple tabs open
 *     subs: PushSubscription[]  // web-push subscriptions
 *   }>
 * }>
 *
 * Special rooms: roomId = "special-" + visitorClientId
 */
const rooms = new Map();

/** Set of owner socket IDs (all owner tabs/devices) */
const owners = new Set();

/** Push subscriptions for the owner (phone + laptop etc.) */
const ownerSubs = [];

/** Owner-assigned human names for visitors */
const visitorNames = new Map();

/** Auto-incremented visitor number */
let visitorCounter = 0;

// ── Rate limiting ──────────────────────────────────────────────────────────────
/** IP → { count, blockedUntil } for owner login attempts */
const loginAttempts = new Map();

/** socketId → { count, resetAt } for message rate limiting */
const msgRateLimits = new Map();

function checkOwnerRateLimit(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec) return { blocked: false };
  if (rec.blockedUntil && rec.blockedUntil > now) {
    return { blocked: true, mins: Math.ceil((rec.blockedUntil - now) / 60000) };
  }
  return { blocked: false };
}

function recordLoginAttempt(ip, success) {
  if (success) { loginAttempts.delete(ip); return; }
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { count: 0, blockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= 5) {
    rec.blockedUntil = now + 10 * 60 * 1000; // block for 10 minutes
    rec.count = 0;
  }
  loginAttempts.set(ip, rec);
}

/** Returns false if socket has exceeded rate limit (10 msgs / 5 s) */
function checkMsgRateLimit(socketId) {
  const now = Date.now();
  const rec = msgRateLimits.get(socketId) || { count: 0, resetAt: now + 5000 };
  if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + 5000; }
  rec.count += 1;
  msgRateLimits.set(socketId, rec);
  return rec.count <= 10;
}

// ── Utility functions ──────────────────────────────────────────────────────────
/** Generate a unique 6-character alphanumeric room code (A-Z, 0-9) */
function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

/** Get or assign a human display name for a visitor */
function getVisitorName(clientId) {
  if (!visitorNames.has(clientId)) {
    visitorCounter += 1;
    visitorNames.set(clientId, `Visitor ${visitorCounter}`);
  }
  return visitorNames.get(clientId);
}

/** Send a Web Push notification; silently removes expired subscriptions (410/404) */
async function sendPush(subsArray, payload) {
  const toRemove = [];
  await Promise.all(
    subsArray.map((sub, i) =>
      webpush.sendNotification(sub, JSON.stringify(payload)).catch((err) => {
        if (err.statusCode === 410 || err.statusCode === 404) toRemove.push(i);
      })
    )
  );
  for (let i = toRemove.length - 1; i >= 0; i--) subsArray.splice(toRemove[i], 1);
}

/** Emit the current visitor list to all owner sockets */
function broadcastVisitorList() {
  if (owners.size === 0) return;
  const list = buildVisitorList();
  for (const sid of owners) {
    io.to(sid).emit('visitor-list', list);
  }
}

function buildVisitorList() {
  const list = [];
  for (const [roomId, room] of rooms) {
    if (room.type !== 'special') continue;
    const cid = roomId.slice('special-'.length);
    const member = room.members.get(cid);
    if (!member) continue;
    list.push({
      clientId: cid,
      roomId,
      name: getVisitorName(cid),
      online: member.socketIds.size > 0,
    });
  }
  return list;
}

/** Secure constant-time string comparison */
function safeEqual(a, b) {
  try {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

// ── Vite middleware (dev) or static dist (prod) ────────────────────────────────
if (!IS_PROD) {
  // Dynamically import Vite so it is not required in production
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
  console.log('[Vite] Running in middleware mode');
} else {
  const distPath = join(__dirname, 'dist');
  app.use(express.static(distPath));
  // SPA fallback — all unmatched routes serve index.html
  app.get('*', (_req, res) => res.sendFile(join(distPath, 'index.html')));
}

// ── Socket.io event handlers ───────────────────────────────────────────────────
io.on('connection', (socket) => {
  // Best-effort IP extraction (works behind proxies like nginx/Cloudflare)
  const ip =
    socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim() ||
    socket.handshake.address;

  // ── CREATE normal chat room ────────────────────────────────────────────────
  socket.on('create', ({ clientId }) => {
    if (!clientId) return socket.emit('error', 'Missing clientId.');
    const code = generateCode();
    const members = new Map();
    members.set(clientId, { socketIds: new Set([socket.id]), subs: [] });
    rooms.set(code, { type: 'normal', members });
    socket.join(code);
    socket.emit('room-created', { code });
  });

  // ── JOIN normal chat room ──────────────────────────────────────────────────
  socket.on('join', ({ code, clientId }) => {
    if (!code || !clientId) return socket.emit('error', 'Missing fields.');
    const roomId = String(code).toUpperCase().trim();
    const room = rooms.get(roomId);

    if (!room) return socket.emit('error', 'Room not found. Check the code and try again.');
    if (room.type !== 'normal') return socket.emit('error', 'Invalid room type.');

    // Reconnecting existing member
    if (room.members.has(clientId)) {
      room.members.get(clientId).socketIds.add(socket.id);
      socket.join(roomId);
      let peerOnline = false;
      for (const [cid, m] of room.members) {
        if (cid !== clientId && m.socketIds.size > 0) { peerOnline = true; break; }
      }
      socket.emit('joined', { roomId, peerOnline });
      // Tell the peer this member is back online
      if (peerOnline) socket.to(roomId).emit('peer-online');
      return;
    }

    // New member joining
    if (room.members.size >= 2) {
      return socket.emit('error', 'This room is already full (max 2 people).');
    }

    room.members.set(clientId, { socketIds: new Set([socket.id]), subs: [] });
    socket.join(roomId);
    socket.emit('joined', { roomId, peerOnline: true });
    socket.to(roomId).emit('peer-online');
  });

  // ── SPECIAL-JOIN: visitor connects via password ────────────────────────────
  socket.on('special-join', ({ password, clientId }) => {
    if (!password || !clientId) return socket.emit('error', 'Missing fields.');

    const envPwd = (process.env.SPECIAL_PASSWORD || '').trim().replace(/^["']|["']$/g, '');
    if (!envPwd) return socket.emit('error', 'Special access is not configured on this server.');
    const inputPwd = String(password).trim().replace(/^["']|["']$/g, '');
    if (!safeEqual(inputPwd, envPwd)) {
      return socket.emit('error', 'Incorrect password. Please try again.');
    }

    const roomId = `special-${clientId}`;
    const isNew = !rooms.has(roomId);

    if (isNew) {
      // Create fresh special room for this visitor
      const members = new Map();
      members.set(clientId, { socketIds: new Set([socket.id]), subs: [] });
      rooms.set(roomId, { type: 'special', members });

      // Join owner sockets to this room and notify them of the new visitor
      for (const ownerSid of owners) {
        const ownerSocket = io.sockets.sockets.get(ownerSid);
        if (ownerSocket) ownerSocket.join(roomId);
        io.to(ownerSid).emit('new-visitor', {
          clientId,
          roomId,
          name: getVisitorName(clientId),
          online: true,
        });
      }

      // Push notification to owner (even when tab is closed)
      if (ownerSubs.length > 0) {
        sendPush(ownerSubs, {
          title: 'New visitor connected',
          body: `${getVisitorName(clientId)} is waiting for you`,
          url: '/owner',
        });
      }
    } else {
      // Visitor is reconnecting
      const room = rooms.get(roomId);
      if (room.members.has(clientId)) {
        room.members.get(clientId).socketIds.add(socket.id);
      } else {
        room.members.set(clientId, { socketIds: new Set([socket.id]), subs: [] });
      }
    }

    socket.join(roomId);
    const ownerOnline = owners.size > 0;
    socket.emit('joined', {
      roomId,
      peerOnline: ownerOnline,
      name: getVisitorName(clientId),
    });
    if (ownerOnline) socket.to(roomId).emit('peer-online');
    broadcastVisitorList();
  });

  // ── SPECIAL-REJOIN: visitor reconnects without password ───────────────────
  // (The room persists on the server; only clientId is needed to reattach)
  socket.on('special-rejoin', ({ clientId }) => {
    if (!clientId) return socket.emit('error', 'Missing clientId.');
    const roomId = `special-${clientId}`;
    const room = rooms.get(roomId);

    if (!room) {
      // Room was deleted (server restarted or owner ended chat)
      return socket.emit('session-expired');
    }

    if (room.members.has(clientId)) {
      room.members.get(clientId).socketIds.add(socket.id);
    } else {
      room.members.set(clientId, { socketIds: new Set([socket.id]), subs: [] });
    }

    socket.join(roomId);
    const ownerOnline = owners.size > 0;
    socket.emit('joined', {
      roomId,
      peerOnline: ownerOnline,
      name: getVisitorName(clientId),
    });
    if (ownerOnline) socket.to(roomId).emit('peer-online');
    broadcastVisitorList();
  });

  // ── OWNER-LOGIN ────────────────────────────────────────────────────────────
  socket.on('owner-login', ({ key }) => {
    const rateCheck = checkOwnerRateLimit(ip);
    if (rateCheck.blocked) {
      return socket.emit('login-failed', `Too many attempts. Try again in ${rateCheck.mins} minute(s).`);
    }

    const ownerKey = (process.env.OWNER_KEY || '').trim().replace(/^["']|["']$/g, '');
    if (!ownerKey) return socket.emit('login-failed', 'Owner key is not configured on this server.');

    const inputKey = String(key || '').trim().replace(/^["']|["']$/g, '');
    if (!safeEqual(inputKey, ownerKey)) {
      recordLoginAttempt(ip, false);
      return socket.emit('login-failed', 'Incorrect owner key.');
    }

    recordLoginAttempt(ip, true);
    owners.add(socket.id);

    // Join all existing special rooms and tell visitors the owner is online
    for (const [roomId, room] of rooms) {
      if (room.type === 'special') {
        socket.join(roomId);
        socket.to(roomId).emit('peer-online');
      }
    }

    socket.emit('owner-ready', { visitors: buildVisitorList() });
  });

  // ── MSG: text message ──────────────────────────────────────────────────────
  socket.on('msg', ({ roomId, clientId, text }) => {
    if (!roomId || !clientId || typeof text !== 'string') return;
    if (!checkMsgRateLimit(socket.id)) {
      return socket.emit('error', 'Slow down — too many messages.');
    }

    const sanitized = text.trim().slice(0, 2000);
    if (!sanitized) return;

    const room = rooms.get(roomId);
    if (!room) return;

    const isOwner = owners.has(socket.id);
    const ts = Date.now();

    // Broadcast to the room (everyone except sender)
    // roomId is included so the owner dashboard can route the message to the right visitor
    socket.to(roomId).emit('msg', { text: sanitized, ts, fromOwner: isOwner, roomId });

    // Web Push — never include message text, only a generic notification
    if (room.type === 'normal') {
      for (const [cid, member] of room.members) {
        if (cid !== clientId && member.subs.length > 0) {
          sendPush(member.subs, {
            title: 'New message',
            body: 'You have a new message in Chatroom',
            url: '/chat',
          });
        }
      }
    } else if (room.type === 'special') {
      if (isOwner) {
        // Owner → visitor
        const visitorCid = roomId.slice('special-'.length);
        const member = room.members.get(visitorCid);
        if (member?.subs.length > 0) {
          sendPush(member.subs, {
            title: 'New message',
            body: 'You have a new message in Chatroom',
            url: '/',
          });
        }
      } else {
        // Visitor → owner
        if (ownerSubs.length > 0) {
          sendPush(ownerSubs, {
            title: `New message from ${getVisitorName(clientId)}`,
            body: 'You have a new message in Chatroom',
            url: '/owner',
          });
        }
      }
    }
  });

  // ── TYPING ─────────────────────────────────────────────────────────────────
  socket.on('typing', ({ roomId, clientId }) => {
    if (!roomId) return;
    const isOwner = owners.has(socket.id);
    // Include roomId so the owner dashboard routes typing to the correct visitor
    socket.to(roomId).emit('peer-typing', {
      fromOwner: isOwner,
      clientId,
      roomId,
      name: isOwner ? 'Owner' : getVisitorName(clientId),
    });
  });

  socket.on('stop-typing', ({ roomId }) => {
    if (!roomId) return;
    socket.to(roomId).emit('peer-stop-typing', { roomId });
  });

  // ── SUB: register a push subscription ─────────────────────────────────────
  socket.on('sub', ({ subscription, clientId, isOwner: isOwnerFlag }) => {
    if (!subscription?.endpoint) return;

    if (isOwnerFlag && owners.has(socket.id)) {
      const exists = ownerSubs.some((s) => s.endpoint === subscription.endpoint);
      if (!exists) ownerSubs.push(subscription);
      return;
    }

    // Find the member record and attach the subscription
    for (const [, room] of rooms) {
      if (room.members.has(clientId)) {
        const member = room.members.get(clientId);
        const exists = member.subs.some((s) => s.endpoint === subscription.endpoint);
        if (!exists) member.subs.push(subscription);
        break;
      }
    }
  });

  // ── END: close a chat ──────────────────────────────────────────────────────
  socket.on('end', ({ roomId, clientId }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    if (room.type === 'normal') {
      io.to(roomId).emit('ended');
      rooms.delete(roomId);
      io.socketsLeave(roomId);
    } else if (room.type === 'special') {
      // Both owner and visitor can end the chat
      io.to(roomId).emit('ended');
      const visitorCid = roomId.slice('special-'.length);
      rooms.delete(roomId);
      visitorNames.delete(visitorCid);
      io.socketsLeave(roomId);
      broadcastVisitorList();
    }
  });

  // ── RENAME-VISITOR: owner renames a visitor ────────────────────────────────
  socket.on('rename-visitor', ({ clientId, name }) => {
    if (!owners.has(socket.id)) return;
    if (typeof name !== 'string' || !name.trim()) return;
    visitorNames.set(clientId, name.trim().slice(0, 30));
    broadcastVisitorList();
  });

  // ── DISCONNECT ─────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    msgRateLimits.delete(socket.id);

    if (owners.has(socket.id)) {
      owners.delete(socket.id);
      // If no owner tabs remain, tell all visitors the owner is offline
      if (owners.size === 0) {
        for (const [roomId, room] of rooms) {
          if (room.type === 'special') io.to(roomId).emit('peer-offline');
        }
      }
      return;
    }

    // Remove this socketId from whichever room member owns it
    for (const [roomId, room] of rooms) {
      for (const [, member] of room.members) {
        if (!member.socketIds.has(socket.id)) continue;
        member.socketIds.delete(socket.id);
        if (member.socketIds.size === 0) {
          // All tabs of this member closed → tell peer they went offline
          socket.to(roomId).emit('peer-offline');
          if (room.type === 'special') broadcastVisitorList();
        }
        return; // A socket belongs to exactly one room member
      }
    }
  });
});

// ── Start server ───────────────────────────────────────────────────────────────
export { app, httpServer };

if (process.env.VERCEL !== '1') {
  httpServer.listen(PORT, () => {
    console.log(`\n🚀  Chatroom is running at http://localhost:${PORT}`);
    if (!IS_PROD) console.log('   Mode: development (Vite middleware)\n');
  });
}
