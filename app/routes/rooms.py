import secrets
import time
from typing import Optional

from fastapi import APIRouter, Form, HTTPException, Query

from ..auth import get_user_by_token, hash_pass
from ..config import EPHEMERAL_ROOMS, UPLOAD_DIR
from ..connection_manager import manager
from ..db import get_conn
from ..messages_repo import is_user_banned
from ..profile_repo import get_public_display_names
from ..utils import parse_dm_target

router = APIRouter()


async def _attach_display_names(members: list) -> list:
    """Adds each member's publicly visible display_name (or None) in place."""
    names = await get_public_display_names([m["username"] for m in members])
    for m in members:
        m["display_name"] = names.get(m["username"])
    return members


@router.get("/api/user/rooms")
async def get_user_rooms(token: str = Query(...)):
    username = await get_user_by_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="Invalid session.")

    async with get_conn() as conn:
        async with conn.execute("""
            SELECT 
                r.room_id, 
                r.room_name, 
                r.created_by,
                COALESCE(
                    (SELECT MAX(created_at) FROM messages m WHERE m.room_id = r.room_id),
                    r.created_at,
                    ur.joined_at,
                    0
                ) AS last_activity,
                (
                    SELECT COUNT(*) 
                    FROM messages m 
                    WHERE m.room_id = r.room_id 
                      AND m.sender != ?
                      AND NOT EXISTS (
                          SELECT 1 FROM message_reads mr 
                          WHERE mr.message_id = m.id AND mr.username = ?
                      )
                ) AS unread_count
            FROM user_rooms ur
            JOIN rooms r ON ur.room_id = r.room_id
            WHERE ur.username = ?
            ORDER BY ur.joined_at ASC
        """, (username, username, username)) as cursor:
            rows = await cursor.fetchall()

    result = []
    for rid, rname, creator, last_act, unread in rows:
        if rid.startswith("dm_"):
            target_user = parse_dm_target(rid, username)
            result.append({
                "id": rid,
                "name": f"@{target_user}",
                "is_dm": True,
                "created_by": "system",
                "last_activity": float(last_act or 0),
                "unread_count": int(unread or 0)
            })
        else:
            result.append({
                "id": rid,
                "name": rname,
                "is_dm": False,
                "created_by": creator,
                "last_activity": float(last_act or 0),
                "unread_count": int(unread or 0)
            })
    return result


@router.get("/api/rooms/details")
async def get_room_details(room_id: str = Query(...), token: Optional[str] = Query(None)):
    room_id = room_id.strip().lower()
    global_online = manager.get_online_users(include_ephemeral=False)
    in_room_online = set()

    if room_id in manager.rooms:
        for uname, _ in manager.rooms[room_id].values():
            in_room_online.add(uname)

    if room_id.startswith("tmp_"):
        meta = EPHEMERAL_ROOMS.get(room_id, {"max_users": 2})
        members = [{"username": u, "presence": "here"} for u in in_room_online]
        return {
            "room_id": room_id,
            "room_name": "⚡ Ephemeral Space",
            "created_by": "System (Ephemeral)",
            "max_users": meta.get("max_users", 2),
            "is_ephemeral": True,
            "is_private": True,
            "members": members,
            "total_members": len(members)
        }

    if room_id.startswith("dm_"):
        my_user = await get_user_by_token(token) or ""
        target_user = parse_dm_target(room_id, my_user)
        raw_members = [my_user, target_user] if (my_user and target_user) else list(set(room_id.replace("dm_", "").split("__" if "__" in room_id else "_")))

        members = []
        for u in set(raw_members):
            if u in in_room_online:
                pres = "here"
            elif u in global_online:
                pres = "elsewhere"
            else:
                pres = "offline"
            members.append({"username": u, "presence": pres})
        await _attach_display_names(members)

        return {
            "room_id": room_id,
            "room_name": f"@{target_user}",
            "created_by": "Direct Stream",
            "is_ephemeral": False,
            "is_private": True,
            "members": members,
            "total_members": len(members)
        }

    if room_id == "public":
        members = [{"username": u, "presence": "online"} for u in global_online]
        await _attach_display_names(members)
        return {
            "room_id": "public",
            "room_name": "Public Group",
            "created_by": "Global Channel",
            "is_ephemeral": False,
            "is_private": False,
            "members": members,
            "total_members": len(members)
        }

    async with get_conn() as conn:
        async with conn.execute("SELECT room_name, created_by FROM rooms WHERE room_id = ?", (room_id,)) as cursor:
            room = await cursor.fetchone()
            if not room:
                raise HTTPException(status_code=404, detail="Space not found.")
            rname, creator = room

        async with conn.execute("SELECT username FROM user_rooms WHERE room_id = ? ORDER BY username ASC", (room_id,)) as cursor:
            rows = await cursor.fetchall()
            all_users = [r[0] for r in rows]

    members = []
    for u in all_users:
        if u in in_room_online:
            pres = "here"
        elif u in global_online:
            pres = "elsewhere"
        else:
            pres = "offline"
        members.append({"username": u, "presence": pres})

    order = {"here": 0, "elsewhere": 1, "offline": 2}
    members.sort(key=lambda x: (order.get(x["presence"], 3), x["username"]))
    await _attach_display_names(members)

    return {
        "room_id": room_id,
        "room_name": rname,
        "created_by": creator,
        "is_ephemeral": False,
        "is_private": True,
        "members": members,
        "total_members": len(members)
    }


@router.post("/api/rooms/create")
async def create_room(room_name: str = Form(...), passkey: str = Form(...), token: str = Form(...)):
    username = await get_user_by_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="Authentication required.")
    name = room_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Room title required.")
    if len(passkey) < 4:
        raise HTTPException(status_code=400, detail="Passkey must be 4+ characters.")

    room_code = f"hub_{secrets.token_hex(4)}"
    salt, p_hash = hash_pass(passkey)
    async with get_conn() as conn:
        await conn.execute("INSERT INTO rooms VALUES (?, ?, ?, ?, ?, ?)", (room_code, name, salt, p_hash, username, time.time()))
        await conn.execute("INSERT OR IGNORE INTO user_rooms VALUES (?, ?, ?)", (username, room_code, time.time()))
        await conn.commit()
    return {"status": "ok", "room_id": room_code, "room_name": name, "created_by": username}


@router.post("/api/rooms/join")
async def join_room(room_key: str = Form(...), passkey: str = Form(...), token: str = Form(...)):
    username = await get_user_by_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="Authentication required.")
    rid = room_key.strip().lower()
    if rid == "public":
        return {"status": "ok", "room_id": "public", "room_name": "Public Group", "is_admin": False}

    banned, exp = await is_user_banned(rid, username)
    if banned:
        if exp == -1:
            raise HTTPException(status_code=403, detail="You are permanently banned from this room.")
        mins = max(1, int((exp - time.time()) / 60))
        raise HTTPException(status_code=403, detail=f"You are temporarily banned. ({mins} min remaining)")

    async with get_conn() as conn:
        async with conn.execute("SELECT room_name, passkey_salt, passkey_hash, created_by FROM rooms WHERE room_id = ?", (rid,)) as cursor:
            row = await cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Invalid room key. Space not found.")
            rname, salt, stored_hash, created_by = row
            if salt and stored_hash:
                _, computed_hash = hash_pass(passkey, salt)
                if not secrets.compare_digest(computed_hash, stored_hash):
                    raise HTTPException(status_code=403, detail="Incorrect passkey.")
        await conn.execute("INSERT OR IGNORE INTO user_rooms VALUES (?, ?, ?)", (username, rid, time.time()))
        await conn.commit()

    return {"status": "ok", "room_id": rid, "room_name": rname, "is_admin": (created_by == username), "created_by": created_by}


@router.post("/api/rooms/update_passkey")
async def update_room_passkey(
    room_id: str = Form(...),
    current_passkey: str = Form(...),
    new_passkey: str = Form(...),
    token: str = Form(...)
):
    admin_user = await get_user_by_token(token)
    if not admin_user:
        raise HTTPException(status_code=401, detail="Authentication required.")
    room_id = room_id.strip().lower()
    if len(new_passkey) < 4:
        raise HTTPException(status_code=400, detail="New passkey must be at least 4 characters.")

    async with get_conn() as conn:
        async with conn.execute("SELECT created_by, passkey_salt, passkey_hash FROM rooms WHERE room_id = ?", (room_id,)) as cursor:
            row = await cursor.fetchone()
            if not row or row[0] != admin_user:
                raise HTTPException(status_code=403, detail="Only the room owner can modify space passkeys.")
            creator, salt, stored_hash = row

        _, check_hash = hash_pass(current_passkey, salt)
        if not secrets.compare_digest(check_hash, stored_hash):
            raise HTTPException(status_code=403, detail="Incorrect current passkey.")

        new_salt, new_hash = hash_pass(new_passkey)
        await conn.execute("UPDATE rooms SET passkey_salt = ?, passkey_hash = ? WHERE room_id = ?", (new_salt, new_hash, room_id))
        await conn.commit()

    return {"status": "ok", "detail": "Passkey successfully rotated."}


@router.post("/api/rooms/ban")
async def ban_user(
    room_id: str = Form(...),
    token: str = Form(...),
    target_user: Optional[str] = Form(None),
    target: Optional[str] = Form(None),
    ban_type: str = Form("temp"),
    duration: str = Form("24h"),
    duration_hours: Optional[int] = Form(None),
):
    admin_user = await get_user_by_token(token)
    if not admin_user:
        raise HTTPException(status_code=401, detail="Authentication required.")
    room_id = room_id.strip().lower()
    if room_id == "public" or room_id.startswith("dm_") or room_id.startswith("tmp_"):
        raise HTTPException(status_code=400, detail="This space cannot be moderated with bans.")
    who = (target_user or target or "").strip().lower()
    if not who:
        raise HTTPException(status_code=400, detail="Target user required.")
    if who == admin_user:
        raise HTTPException(status_code=400, detail="Cannot ban yourself.")

    async with get_conn() as conn:
        async with conn.execute("SELECT created_by FROM rooms WHERE room_id = ?", (room_id,)) as cursor:
            row = await cursor.fetchone()
            if not row or row[0] != admin_user:
                raise HTTPException(status_code=403, detail="Only the room owner can ban members.")

        if ban_type == "perm":
            expires_at = -1
        elif duration_hours is not None:
            expires_at = time.time() + (max(1, int(duration_hours)) * 3600)
        else:
            seconds_map = {"1h": 3600, "4h": 14400, "8h": 28800, "24h": 86400, "2d": 172800, "4d": 345600, "7d": 604800}
            expires_at = time.time() + seconds_map.get(duration, 86400)

        await conn.execute("INSERT OR REPLACE INTO room_bans VALUES (?, ?, ?, ?)", (room_id, who, admin_user, expires_at))
        await conn.execute("DELETE FROM user_rooms WHERE username = ? AND room_id = ?", (who, room_id))
        await conn.commit()

    await manager.kick_user(room_id, who, "You have been banned from this room.")
    await manager.broadcast_system(room_id, f"{who} was banned by the room owner.")
    return {"status": "ok", "detail": f"@{who} has been banned."}


@router.get("/api/rooms/bans")
async def list_room_bans(room_id: str = Query(...), token: str = Query(...)):
    admin_user = await get_user_by_token(token)
    if not admin_user:
        raise HTTPException(status_code=401, detail="Authentication required.")
    room_id = room_id.strip().lower()
    async with get_conn() as conn:
        async with conn.execute("SELECT created_by FROM rooms WHERE room_id = ?", (room_id,)) as cursor:
            row = await cursor.fetchone()
            if not row or row[0] != admin_user:
                raise HTTPException(status_code=403, detail="Only the room owner can view bans.")
        async with conn.execute(
            "SELECT username, banned_by, expires_at FROM room_bans WHERE room_id = ? ORDER BY username ASC",
            (room_id,),
        ) as cursor:
            rows = await cursor.fetchall()
        now = time.time()
        active = []
        expired = []
        for username, banned_by, expires_at in rows:
            if expires_at != -1 and expires_at <= now:
                expired.append(username)
            else:
                active.append({
                    "username": username,
                    "banned_by": banned_by,
                    "expires_at": expires_at,
                    "permanent": expires_at == -1,
                })
        if expired:
            await conn.executemany(
                "DELETE FROM room_bans WHERE room_id = ? AND username = ?",
                [(room_id, u) for u in expired],
            )
            await conn.commit()
    return {"bans": active}


@router.post("/api/rooms/unban")
async def unban_user(
    room_id: str = Form(...),
    token: str = Form(...),
    target_user: Optional[str] = Form(None),
    target: Optional[str] = Form(None),
):
    admin_user = await get_user_by_token(token)
    if not admin_user:
        raise HTTPException(status_code=401, detail="Authentication required.")
    room_id = room_id.strip().lower()
    who = (target_user or target or "").strip().lower()
    if not who:
        raise HTTPException(status_code=400, detail="Target user required.")
    async with get_conn() as conn:
        async with conn.execute("SELECT created_by FROM rooms WHERE room_id = ?", (room_id,)) as cursor:
            row = await cursor.fetchone()
            if not row or row[0] != admin_user:
                raise HTTPException(status_code=403, detail="Only the room owner can unban members.")
        await conn.execute("DELETE FROM room_bans WHERE room_id = ? AND username = ?", (room_id, who))
        await conn.commit()
    return {"status": "ok", "username": who, "detail": f"@{who} unbanned."}


@router.post("/api/rooms/destruct")
async def destruct_room(room_id: str = Form(...), token: str = Form(...)):
    user = await get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if room_id == "public" or room_id.startswith("dm_"):
        raise HTTPException(status_code=400, detail="Cannot destruct this space.")

    async with get_conn() as conn:
        async with conn.execute("SELECT created_by FROM rooms WHERE room_id = ?", (room_id,)) as cursor:
            row = await cursor.fetchone()
            if not row or row[0] != user:
                raise HTTPException(status_code=403, detail="Only the room owner can disband this group.")

        async with conn.execute("SELECT filename FROM messages WHERE room_id = ? AND filename IS NOT NULL", (room_id,)) as cursor:
            files = await cursor.fetchall()
            for (f,) in files:
                try:
                    (UPLOAD_DIR / f).unlink(missing_ok=True)
                except Exception:
                    pass

        await conn.execute("DELETE FROM messages WHERE room_id = ?", (room_id,))
        await conn.execute("DELETE FROM user_rooms WHERE room_id = ?", (room_id,))
        await conn.execute("DELETE FROM room_bans WHERE room_id = ?", (room_id,))
        await conn.execute("DELETE FROM rooms WHERE room_id = ?", (room_id,))
        await conn.commit()

    await manager.broadcast_payload(room_id, {
        "type": "room_destructed",
        "room_id": room_id,
        "detail": "This space has been permanently disbanded by its owner."
    })
    return {"status": "ok"}
