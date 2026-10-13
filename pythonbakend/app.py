import os
import json
import time
import random
import string
import hmac
from typing import Dict, Set, List
from dotenv import load_dotenv

import socketio
from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from pywebpush import webpush, WebPushException

load_dotenv()

PORT = int(os.environ.get("PORT", 7860))
SPECIAL_PASSWORD = os.environ.get("SPECIAL_PASSWORD", "your-special-password-here").strip().strip('"').strip("'")
OWNER_KEY = os.environ.get("OWNER_KEY", "your-owner-key-here").strip().strip('"').strip("'")
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:admin@chatroom.local")

# ── VAPID Keys Setup ───────────────────────────────────────────────────────────
VAPID_FILE = os.path.join(os.path.dirname(__file__), ".vapid.json")
vapid_public_key = os.environ.get("VAPID_PUBLIC_KEY", "").strip().strip('"').strip("'")
vapid_private_key = os.environ.get("VAPID_PRIVATE_KEY", "").strip().strip('"').strip("'")

if not (vapid_public_key and vapid_private_key):
    if os.path.exists(VAPID_FILE):
        try:
            with open(VAPID_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                vapid_public_key = saved.get("publicKey", "")
                vapid_private_key = saved.get("privateKey", "")
        except Exception as e:
            print(f"[VAPID] Error reading .vapid.json: {e}")

if not (vapid_public_key and vapid_private_key):
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import serialization
    import base64

    # Generate EC prime256v1 keys
    priv_key = ec.generate_private_key(ec.SECP256R1())
    raw_priv = priv_key.private_numbers().private_value.to_bytes(32, byteorder="big")
    vapid_private_key = base64.urlsafe_b64encode(raw_priv).decode("utf-8").rstrip("=")

    pub_bytes = priv_key.public_key().public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint
    )
    vapid_public_key = base64.urlsafe_b64encode(pub_bytes).decode("utf-8").rstrip("=")

    try:
        with open(VAPID_FILE, "w", encoding="utf-8") as f:
            json.dump({"publicKey": vapid_public_key, "privateKey": vapid_private_key}, f, indent=2)
        print("[VAPID] Auto-generated and saved keys to .vapid.json")
    except Exception as e:
        print(f"[VAPID] Running in memory with auto-generated keys: {e}")

print(f"[VAPID] Public key: {vapid_public_key[:15]}...")

# ── Socket.IO Server Setup ─────────────────────────────────────────────────────
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    max_http_buffer_size=64 * 1024,
)
fastapi_app = FastAPI()

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app = socketio.ASGIApp(socketio_server=sio, other_asgi_app=fastapi_app)

# ── In-Memory State ────────────────────────────────────────────────────────────
# rooms: { roomId: { "type": "normal"|"special", "members": { clientId: { "socketIds": set(), "subs": [] } } } }
rooms: Dict[str, dict] = {}
owners: Set[str] = set()
owner_subs: List[dict] = []
visitor_names: Dict[str, str] = {}
visitor_counter = 0

login_attempts: Dict[str, dict] = {}
msg_rate_limits: Dict[str, dict] = {}

def check_owner_rate_limit(ip: str):
    now = time.time()
    rec = login_attempts.get(ip)
    if not rec:
        return {"blocked": False}
    if rec.get("blockedUntil", 0) > now:
        mins = int((rec["blockedUntil"] - now) // 60) + 1
        return {"blocked": True, "mins": mins}
    return {"blocked": False}

def record_login_attempt(ip: str, success: bool):
    if success:
        login_attempts.pop(ip, None)
        return
    now = time.time()
    rec = login_attempts.get(ip, {"count": 0, "blockedUntil": 0})
    rec["count"] += 1
    if rec["count"] >= 5:
        rec["blockedUntil"] = now + 10 * 60
        rec["count"] = 0
    login_attempts[ip] = rec

def check_msg_rate_limit(sid: str) -> bool:
    now = time.time()
    rec = msg_rate_limits.get(sid, {"count": 0, "resetAt": now + 5})
    if now > rec["resetAt"]:
        rec["count"] = 0
        rec["resetAt"] = now + 5
    rec["count"] += 1
    msg_rate_limits[sid] = rec
    return rec["count"] <= 10

def generate_code() -> str:
    chars = string.ascii_uppercase + string.digits
    while True:
        code = "".join(random.choice(chars) for _ in range(6))
        if code not in rooms:
            return code

def get_visitor_name(client_id: str) -> str:
    global visitor_counter
    if client_id not in visitor_names:
        visitor_counter += 1
        visitor_names[client_id] = f"Visitor {visitor_counter}"
    return visitor_names[client_id]

def build_visitor_list() -> List[dict]:
    res = []
    for room_id, room in rooms.items():
        if room.get("type") != "special":
            continue
        cid = room_id.replace("special-", "")
        member = room["members"].get(cid)
        if not member:
            continue
        res.append({
            "clientId": cid,
            "roomId": room_id,
            "name": get_visitor_name(cid),
            "online": len(member["socketIds"]) > 0,
        })
    return res

async def broadcast_visitor_list():
    if not owners:
        return
    vlist = build_visitor_list()
    for sid in list(owners):
        await sio.emit("visitor-list", vlist, to=sid)

async def send_push(subs_list: list, payload: dict):
    to_remove = []
    data_str = json.dumps(payload)
    for i, sub in enumerate(subs_list):
        try:
            webpush(
                subscription_info=sub,
                data=data_str,
                vapid_private_key=vapid_private_key,
                vapid_claims={"sub": VAPID_SUBJECT}
            )
        except WebPushException as ex:
            if ex.response and ex.response.status_code in (404, 410):
                to_remove.append(i)
        except Exception:
            pass
    for i in reversed(to_remove):
        if i < len(subs_list):
            subs_list.pop(i)

# ── REST Endpoints ─────────────────────────────────────────────────────────────
@fastapi_app.get("/api/vapid-public-key")
async def get_vapid_key():
    return Response(
        content=json.dumps({"publicKey": vapid_public_key}),
        media_type="application/json",
        headers={"Cache-Control": "no-store"}
    )

@fastapi_app.get("/api/health")
async def health():
    return {"status": "ok", "service": "chat-python-backend", "time": time.time()}

@fastapi_app.get("/")
async def root():
    return {"status": "running", "message": "Python WebSocket Chat Backend is active."}

# ── Socket.IO Event Handlers ───────────────────────────────────────────────────
@sio.event
async def connect(sid, environ):
    pass

@sio.event
async def disconnect(sid):
    msg_rate_limits.pop(sid, None)

    if sid in owners:
        owners.remove(sid)
        if len(owners) == 0:
            for room_id, room in rooms.items():
                if room.get("type") == "special":
                    await sio.emit("peer-offline", to=room_id)
        return

    for room_id, room in list(rooms.items()):
        for cid, member in room.get("members", {}).items():
            if sid in member["socketIds"]:
                member["socketIds"].remove(sid)
                if len(member["socketIds"]) == 0:
                    await sio.emit("peer-offline", to=room_id, skip_sid=sid)
                    if room.get("type") == "special":
                        await broadcast_visitor_list()
                return

@sio.event
async def create(sid, data):
    client_id = data.get("clientId")
    if not client_id:
        await sio.emit("error", "Missing clientId.", to=sid)
        return
    code = generate_code()
    members = {
        client_id: {"socketIds": {sid}, "subs": []}
    }
    rooms[code] = {"type": "normal", "members": members}
    sio.enter_room(sid, code)
    await sio.emit("room-created", {"code": code}, to=sid)

@sio.event
async def join(sid, data):
    code = data.get("code")
    client_id = data.get("clientId")
    if not code or not client_id:
        await sio.emit("error", "Missing fields.", to=sid)
        return

    room_id = str(code).upper().strip()
    room = rooms.get(room_id)
    if not room:
        await sio.emit("error", "Room not found. Check the code and try again.", to=sid)
        return
    if room.get("type") != "normal":
        await sio.emit("error", "Invalid room type.", to=sid)
        return

    members = room["members"]
    if client_id in members:
        members[client_id]["socketIds"].add(sid)
        sio.enter_room(sid, room_id)
        peer_online = any(cid != client_id and len(m["socketIds"]) > 0 for cid, m in members.items())
        await sio.emit("joined", {"roomId": room_id, "peerOnline": peer_online}, to=sid)
        if peer_online:
            await sio.emit("peer-online", to=room_id, skip_sid=sid)
        return

    if len(members) >= 2:
        await sio.emit("error", "This room is already full (max 2 people).", to=sid)
        return

    members[client_id] = {"socketIds": {sid}, "subs": []}
    sio.enter_room(sid, room_id)
    await sio.emit("joined", {"roomId": room_id, "peerOnline": True}, to=sid)
    await sio.emit("peer-online", to=room_id, skip_sid=sid)

@sio.event
async def special_join(sid, data):
    password = str(data.get("password", "")).strip().strip('"').strip("'")
    client_id = data.get("clientId")
    if not password or not client_id:
        await sio.emit("error", "Missing fields.", to=sid)
        return

    if not SPECIAL_PASSWORD:
        await sio.emit("error", "Special access is not configured on this server.", to=sid)
        return

    if not hmac.compare_digest(password, SPECIAL_PASSWORD):
        await sio.emit("error", "Incorrect password. Please try again.", to=sid)
        return

    room_id = f"special-{client_id}"
    is_new = room_id not in rooms

    if is_new:
        members = {
            client_id: {"socketIds": {sid}, "subs": []}
        }
        rooms[room_id] = {"type": "special", "members": members}

        for owner_sid in list(owners):
            sio.enter_room(owner_sid, room_id)
            await sio.emit("new-visitor", {
                "clientId": client_id,
                "roomId": room_id,
                "name": get_visitor_name(client_id),
                "online": True
            }, to=owner_sid)

        if owner_subs:
            await send_push(owner_subs, {
                "title": "New visitor connected",
                "body": f"{get_visitor_name(client_id)} is waiting for you",
                "url": "/owner"
            })
    else:
        room = rooms[room_id]
        if client_id in room["members"]:
            room["members"][client_id]["socketIds"].add(sid)
        else:
            room["members"][client_id] = {"socketIds": {sid}, "subs": []}

    sio.enter_room(sid, room_id)
    owner_online = len(owners) > 0
    await sio.emit("joined", {
        "roomId": room_id,
        "peerOnline": owner_online,
        "name": get_visitor_name(client_id)
    }, to=sid)
    if owner_online:
        await sio.emit("peer-online", to=room_id, skip_sid=sid)
    await broadcast_visitor_list()

@sio.on("special-join")
async def on_special_join_hyphen(sid, data):
    await special_join(sid, data)

@sio.event
async def special_rejoin(sid, data):
    client_id = data.get("clientId")
    if not client_id:
        await sio.emit("error", "Missing clientId.", to=sid)
        return

    room_id = f"special-{client_id}"
    room = rooms.get(room_id)
    if not room:
        await sio.emit("session-expired", to=sid)
        return

    if client_id in room["members"]:
        room["members"][client_id]["socketIds"].add(sid)
    else:
        room["members"][client_id] = {"socketIds": {sid}, "subs": []}

    sio.enter_room(sid, room_id)
    owner_online = len(owners) > 0
    await sio.emit("joined", {
        "roomId": room_id,
        "peerOnline": owner_online,
        "name": get_visitor_name(client_id)
    }, to=sid)
    if owner_online:
        await sio.emit("peer-online", to=room_id, skip_sid=sid)
    await broadcast_visitor_list()

@sio.on("special-rejoin")
async def on_special_rejoin_hyphen(sid, data):
    await special_rejoin(sid, data)

@sio.event
async def owner_login(sid, data):
    key = str(data.get("key", "")).strip().strip('"').strip("'")
    environ = sio.get_environ(sid)
    client_ip = environ.get("REMOTE_ADDR", "127.0.0.1") if environ else "127.0.0.1"

    rate_check = check_owner_rate_limit(client_ip)
    if rate_check["blocked"]:
        await sio.emit("login-failed", f"Too many attempts. Try again in {rate_check['mins']} minute(s).", to=sid)
        return

    if not OWNER_KEY:
        await sio.emit("login-failed", "Owner key is not configured on this server.", to=sid)
        return

    if not hmac.compare_digest(key, OWNER_KEY):
        record_login_attempt(client_ip, False)
        await sio.emit("login-failed", "Incorrect owner key.", to=sid)
        return

    record_login_attempt(client_ip, True)
    owners.add(sid)

    for room_id, room in rooms.items():
        if room.get("type") == "special":
            sio.enter_room(sid, room_id)
            await sio.emit("peer-online", to=room_id, skip_sid=sid)

    await sio.emit("owner-ready", {"visitors": build_visitor_list()}, to=sid)

@sio.on("owner-login")
async def on_owner_login_hyphen(sid, data):
    await owner_login(sid, data)

@sio.event
async def msg(sid, data):
    room_id = data.get("roomId")
    client_id = data.get("clientId")
    text = data.get("text")

    if not room_id or not client_id or not isinstance(text, str):
        return
    if not check_msg_rate_limit(sid):
        await sio.emit("error", "Slow down — too many messages.", to=sid)
        return

    sanitized = text.strip()[:2000]
    if not sanitized:
        return

    room = rooms.get(room_id)
    if not room:
        return

    is_owner = sid in owners
    ts = int(time.time() * 1000)

    await sio.emit("msg", {
        "text": sanitized,
        "ts": ts,
        "fromOwner": is_owner,
        "roomId": room_id
    }, to=room_id, skip_sid=sid)

    if room.get("type") == "normal":
        for cid, member in room.get("members", {}).items():
            if cid != client_id and member.get("subs"):
                await send_push(member["subs"], {
                    "title": "New message",
                    "body": "You have a new message in Chatroom",
                    "url": "/chat"
                })
    elif room.get("type") == "special":
        if is_owner:
            vis_cid = room_id.replace("special-", "")
            member = room.get("members", {}).get(vis_cid)
            if member and member.get("subs"):
                await send_push(member["subs"], {
                    "title": "New message",
                    "body": "You have a new message in Chatroom",
                    "url": "/"
                })
        else:
            if owner_subs:
                await send_push(owner_subs, {
                    "title": f"New message from {get_visitor_name(client_id)}",
                    "body": "You have a new message in Chatroom",
                    "url": "/owner"
                })

@sio.event
async def typing(sid, data):
    room_id = data.get("roomId")
    client_id = data.get("clientId")
    if not room_id:
        return
    is_owner = sid in owners
    name = "Owner" if is_owner else get_visitor_name(client_id)
    await sio.emit("peer-typing", {
        "fromOwner": is_owner,
        "clientId": client_id,
        "roomId": room_id,
        "name": name
    }, to=room_id, skip_sid=sid)

@sio.on("stop-typing")
async def stop_typing(sid, data):
    room_id = data.get("roomId")
    if not room_id:
        return
    await sio.emit("peer-stop-typing", {"roomId": room_id}, to=room_id, skip_sid=sid)

@sio.event
async def sub(sid, data):
    subscription = data.get("subscription")
    client_id = data.get("clientId")
    is_owner = data.get("isOwner", False)

    if not subscription or not subscription.get("endpoint"):
        return

    if is_owner and sid in owners:
        if not any(s.get("endpoint") == subscription.get("endpoint") for s in owner_subs):
            owner_subs.append(subscription)
        return

    for room in rooms.values():
        if client_id in room.get("members", {}):
            member = room["members"][client_id]
            if not any(s.get("endpoint") == subscription.get("endpoint") for s in member.get("subs", [])):
                member["subs"].append(subscription)
            break

@sio.event
async def end(sid, data):
    room_id = data.get("roomId")
    if not room_id or room_id not in rooms:
        return

    room = rooms[room_id]
    await sio.emit("ended", to=room_id)

    if room.get("type") == "special":
        vis_cid = room_id.replace("special-", "")
        visitor_names.pop(vis_cid, None)

    del rooms[room_id]
    await broadcast_visitor_list()

@sio.on("rename-visitor")
async def rename_visitor(sid, data):
    if sid not in owners:
        return
    client_id = data.get("clientId")
    name = str(data.get("name", "")).strip()[:30]
    if not client_id or not name:
        return
    visitor_names[client_id] = name
    await broadcast_visitor_list()

# Mount a minimal Gradio UI so Hugging Face Gradio SDK stays running 24/7
import gradio as gr

def get_status():
    return f"Chatroom WebSocket Backend is ONLINE 🟢 (Active rooms: {len(rooms)}, Owners connected: {len(owners)})"

with gr.Blocks(title="Chat Backend Status") as demo:
    gr.Markdown("# 🚀 Chatroom WebSocket Backend")
    gr.Markdown("Real-time Socket.IO server powering the Vercel frontend.")
    status_box = gr.Textbox(value=get_status, label="Server Status", interactive=False, every=5)

app = gr.mount_gradio_app(fastapi_app, demo, path="/status")
app = socketio.ASGIApp(socketio_server=sio, other_asgi_app=app)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
