import secrets
import time

from fastapi import APIRouter, Form, HTTPException, Query

from ..auth import get_user_by_token
from ..config import EPHEMERAL_ROOMS
from ..connection_manager import manager
from ..db import get_conn
from ..utils import generate_random_alias, make_dm_room_id, parse_dm_target

router = APIRouter()


@router.post("/api/ephemeral/create")
async def create_ephemeral(room_type: str = Form("dm"), max_limit: int = Form(2)):
    if room_type == "dm":
        limit = 2
    else:
        try:
            limit = int(max_limit)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid capacity limit format.")
        if limit < 2 or limit > 50:
            raise HTTPException(status_code=400, detail="Capacity limit must be between 2 and 50.")

    room_code = f"tmp_{secrets.token_hex(4)}"
    EPHEMERAL_ROOMS[room_code] = {"max_users": limit, "is_ephemeral": True, "has_had_users": False}
    random_alias = generate_random_alias()
    return {
        "status": "ok",
        "room_id": room_code,
        "max_users": limit,
        "room_type": room_type,
        "assigned_alias": random_alias
    }


@router.post("/api/ephemeral/verify")
async def verify_ephemeral(room_id: str = Form(...)):
    rid = room_id.strip().lower()
    if rid not in EPHEMERAL_ROOMS:
        raise HTTPException(status_code=404, detail="Ephemeral space not found or already terminated.")
    current_count = len(manager.rooms.get(rid, {}))
    meta = EPHEMERAL_ROOMS[rid]
    if current_count >= meta["max_users"]:
        raise HTTPException(status_code=403, detail="Room is full.")
    random_alias = generate_random_alias()
    return {
        "status": "ok",
        "room_id": rid,
        "current_users": current_count,
        "max_users": meta["max_users"],
        "assigned_alias": random_alias
    }


@router.post("/api/dm/request")
async def send_dm_request(target: str = Form(...), token: str = Form(...)):
    me = await get_user_by_token(token)
    target = target.strip().lower()
    if not me:
        raise HTTPException(status_code=401, detail="Authentication required.")
    if me == target:
        raise HTTPException(status_code=400, detail="Cannot chat with yourself.")

    dm_room_id = make_dm_room_id(me, target)

    async with get_conn() as conn:
        async with conn.execute("SELECT 1 FROM user_rooms WHERE username = ? AND room_id = ?", (me, dm_room_id)) as cursor:
            if await cursor.fetchone():
                return {"status": "already_connected", "room_id": dm_room_id, "room_name": f"@{target}"}

        async with conn.execute("SELECT id, sender FROM dm_requests WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)",
                       (me, target, target, me)) as cursor:
            existing = await cursor.fetchone()
            if existing:
                if existing[1] == me:
                    return {"status": "pending", "detail": "Permission request already sent."}
                else:
                    return {"status": "pending_incoming", "detail": f"{target} already invited you!"}

        await conn.execute("INSERT INTO dm_requests (sender, recipient, status, created_at) VALUES (?, ?, 'pending', ?)",
                       (me, target, time.time()))
        await conn.commit()

    await manager.notify_user(target, {"type": "dm_request_received", "from": me})
    return {"status": "sent", "detail": f"Request sent to @{target}."}


@router.get("/api/dm/requests")
async def get_dm_requests(token: str = Query(...)):
    me = await get_user_by_token(token)
    if not me:
        raise HTTPException(status_code=401, detail="Invalid session.")
    async with get_conn() as conn:
        async with conn.execute("SELECT id, sender, created_at FROM dm_requests WHERE recipient = ? AND status = 'pending'", (me,)) as cursor:
            rows = await cursor.fetchall()
    return [{"id": r[0], "sender": r[1], "created_at": r[2]} for r in rows]


@router.post("/api/dm/respond")
async def respond_dm_request(request_id: int = Form(...), action: str = Form(...), token: str = Form(...)):
    me = await get_user_by_token(token)
    if not me:
        raise HTTPException(status_code=401, detail="Authentication required.")

    async with get_conn() as conn:
        async with conn.execute("SELECT sender, recipient FROM dm_requests WHERE id = ?", (request_id,)) as cursor:
            row = await cursor.fetchone()
            if not row or row[1] != me:
                raise HTTPException(status_code=404, detail="Request not found.")

        sender = row[0]
        await conn.execute("DELETE FROM dm_requests WHERE id = ?", (request_id,))

        if action == "accept":
            dm_room_id = make_dm_room_id(me, sender)
            await conn.execute("INSERT OR IGNORE INTO rooms VALUES (?, ?, '', '', 'system', ?)", (dm_room_id, f"@{sender}", time.time()))
            await conn.execute("INSERT OR IGNORE INTO user_rooms VALUES (?, ?, ?)", (me, dm_room_id, time.time()))
            await conn.execute("INSERT OR IGNORE INTO user_rooms VALUES (?, ?, ?)", (sender, dm_room_id, time.time()))
            await conn.commit()
            await manager.notify_user(sender, {"type": "dm_request_accepted", "by": me, "room_id": dm_room_id, "room_name": f"@{me}"})
            return {"status": "accepted", "room_id": dm_room_id, "room_name": f"@{sender}"}
        await conn.commit()
        return {"status": "rejected"}
