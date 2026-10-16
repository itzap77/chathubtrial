import json
import secrets
import time

from typing import Optional

from fastapi import APIRouter, Form, HTTPException, Query, Response

from ..auth import create_session, get_user_by_token, hash_pass
from ..config import USERNAME_RE
from ..db import get_conn

router = APIRouter()


@router.post("/api/register")
async def register(username: str = Form(...), password: str = Form(...)):
    username = username.strip().lower()
    if not USERNAME_RE.match(username) or len(password) < 6:
        raise HTTPException(status_code=400, detail="Username 2-25 chars, password 6+ chars.")
    salt, pwd_hash = hash_pass(password)
    now = time.time()
    try:
        async with get_conn() as conn:
            await conn.execute(
                "INSERT INTO users (username, salt, password_hash, created_at) VALUES (?, ?, ?, ?)",
                (username, salt, pwd_hash, now)
            )
            await conn.commit()
        return {"status": "ok", "detail": "Account created successfully! Please sign in."}
    except Exception:
        raise HTTPException(status_code=409, detail="Username already exists.")


@router.post("/api/login")
async def login(username: str = Form(...), password: str = Form(...)):
    username = username.strip().lower()
    async with get_conn() as conn:
        async with conn.execute("SELECT salt, password_hash FROM users WHERE username = ?", (username,)) as cursor:
            row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    salt, stored_hash = row
    _, computed_hash = hash_pass(password, salt)
    if not secrets.compare_digest(computed_hash, stored_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    token = await create_session(username)
    return {"status": "ok", "username": username, "token": token}


@router.post("/api/logout")
async def logout(token: str = Form(...)):
    async with get_conn() as conn:
        await conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        await conn.commit()
    return {"status": "ok"}


@router.get("/api/account/profile")
async def get_account_profile(token: str = Query(...)):
    user = await get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    async with get_conn() as conn:
        async with conn.execute(
            """SELECT display_name, bio, show_display_name, show_bio,
                      custom_status, status_emoji, avatar_color, created_at, hide_presence
               FROM users WHERE username = ?""",
            (user,)
        ) as cursor:
            row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found.")
    display_name, bio, show_display_name, show_bio, custom_status, status_emoji, avatar_color, created_at, hide_presence = row
    return {
        "status": "ok",
        "username": user,
        "display_name": display_name,
        "bio": bio,
        "show_display_name": bool(show_display_name),
        "show_bio": bool(show_bio),
        "custom_status": custom_status,
        "status_emoji": status_emoji,
        "avatar_color": avatar_color,
        "created_at": created_at,
        "hide_presence": bool(hide_presence),
    }


@router.post("/api/account/update_profile")
async def update_profile(
    token: str = Form(...),
    display_name: Optional[str] = Form(None),
    bio: Optional[str] = Form(None),
    show_display_name: Optional[str] = Form(None),
    show_bio: Optional[str] = Form(None),
    custom_status: Optional[str] = Form(None),
    status_emoji: Optional[str] = Form(None),
    avatar_color: Optional[str] = Form(None),
    hide_presence: Optional[str] = Form(None)
):
    user = await get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    clean_name = (display_name or "").strip()[:50] or None
    clean_bio = (bio or "").strip()[:160] or None
    flag_display = 1 if show_display_name in ("true", "1", "on") else 0
    flag_bio = 1 if show_bio in ("true", "1", "on") else 0
    clean_status = (custom_status or "").strip()[:100] or None
    clean_emoji = (status_emoji or "").strip()[:10] or None
    clean_color = (avatar_color or "").strip()[:60] or None
    flag_hide_presence = 1 if hide_presence in ("true", "1", "on") else 0

    async with get_conn() as conn:
        await conn.execute(
            """UPDATE users SET
                display_name = ?,
                bio = ?,
                show_display_name = ?,
                show_bio = ?,
                custom_status = ?,
                status_emoji = ?,
                avatar_color = ?,
                hide_presence = ?
               WHERE username = ?""",
            (clean_name, clean_bio, flag_display, flag_bio, clean_status, clean_emoji, clean_color, flag_hide_presence, user)
        )
        await conn.commit()
    return {
        "status": "ok",
        "display_name": clean_name,
        "bio": clean_bio,
        "show_display_name": bool(flag_display),
        "show_bio": bool(flag_bio),
        "custom_status": clean_status,
        "status_emoji": clean_emoji,
        "avatar_color": clean_color,
        "hide_presence": bool(flag_hide_presence),
    }


@router.get("/api/account/stats")
async def get_account_stats(token: str = Query(...)):
    user = await get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    async with get_conn() as conn:
        async with conn.execute(
            "SELECT created_at, public_key FROM users WHERE username = ?", (user,)
        ) as cursor:
            user_row = await cursor.fetchone()
        created_at, pub_key = user_row if user_row else (None, None)

        async with conn.execute("SELECT COUNT(*) FROM messages WHERE sender = ?", (user,)) as cursor:
            msg_count = (await cursor.fetchone())[0]

        async with conn.execute("SELECT COUNT(*) FROM user_rooms WHERE username = ?", (user,)) as cursor:
            rooms_count = (await cursor.fetchone())[0]

        async with conn.execute("SELECT COUNT(*) FROM rooms WHERE created_by = ?", (user,)) as cursor:
            spaces_created = (await cursor.fetchone())[0]

    return {
        "status": "ok",
        "username": user,
        "member_since": created_at,
        "messages_sent": msg_count,
        "rooms_joined": rooms_count,
        "spaces_created": spaces_created,
        "e2ee_verified": bool(pub_key),
    }


@router.get("/api/account/export")
async def export_account_data(token: str = Query(...)):
    user = await get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    async with get_conn() as conn:
        async with conn.execute(
            "SELECT username, display_name, bio, custom_status, status_emoji, avatar_color, created_at, hide_presence FROM users WHERE username = ?",
            (user,)
        ) as cursor:
            profile_row = await cursor.fetchone()

        async with conn.execute(
            """SELECT r.room_id, r.room_name, r.created_by, ur.joined_at
               FROM user_rooms ur
               JOIN rooms r ON ur.room_id = r.room_id
               WHERE ur.username = ?
               ORDER BY ur.joined_at ASC""",
            (user,)
        ) as cursor:
            space_rows = await cursor.fetchall()

        async with conn.execute(
            """SELECT id, room_id, text, filename, original_name, created_at
               FROM messages
               WHERE sender = ?
               ORDER BY created_at DESC LIMIT 300""",
            (user,)
        ) as cursor:
            msg_rows = await cursor.fetchall()

    export_payload = {
        "export_metadata": {
            "application": "ChatHub Secure Messaging",
            "format_version": "1.0",
            "exported_at": time.time(),
            "export_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        },
        "user_profile": {
            "username": profile_row[0] if profile_row else user,
            "display_name": profile_row[1] if profile_row else None,
            "bio": profile_row[2] if profile_row else None,
            "custom_status": profile_row[3] if profile_row else None,
            "status_emoji": profile_row[4] if profile_row else None,
            "avatar_color": profile_row[5] if profile_row else None,
            "member_since": profile_row[6] if profile_row else None,
            "hide_presence": bool(profile_row[7]) if profile_row else False
        },
        "spaces_joined": [
            {
                "room_id": s[0],
                "room_name": s[1],
                "created_by": s[2],
                "is_creator": (s[2] == user),
                "joined_at": s[3]
            }
            for s in space_rows
        ],
        "messages_sample": [
            {
                "id": m[0],
                "room_id": m[1],
                "text": m[2],
                "has_attachment": bool(m[3]),
                "original_filename": m[4],
                "sent_at": m[5]
            }
            for m in msg_rows
        ]
    }

    content_str = json.dumps(export_payload, indent=2)
    return Response(
        content=content_str,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="chathub-account-{user}.json"'
        }
    )


@router.post("/api/account/delete_account")
async def delete_account(token: str = Form(...), password: str = Form(...)):
    user = await get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    async with get_conn() as conn:
        async with conn.execute("SELECT salt, password_hash FROM users WHERE username = ?", (user,)) as cursor:
            row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Account not found.")
        salt, stored_hash = row
        _, check_hash = hash_pass(password, salt)
        if not secrets.compare_digest(check_hash, stored_hash):
            raise HTTPException(status_code=403, detail="Incorrect password. Account deletion aborted.")

        # Purge user records safely
        await conn.execute("DELETE FROM sessions WHERE username = ?", (user,))
        await conn.execute("DELETE FROM user_rooms WHERE username = ?", (user,))
        await conn.execute("DELETE FROM dm_requests WHERE sender = ? OR recipient = ?", (user, user))
        await conn.execute("DELETE FROM room_bans WHERE username = ? OR banned_by = ?", (user, user))
        await conn.execute("DELETE FROM users WHERE username = ?", (user,))
        await conn.commit()

    return {"status": "ok", "detail": "Account and all associated records permanently wiped."}


@router.post("/api/account/change_password")
async def change_password(
    token: str = Form(...),
    current_password: str = Form(...),
    new_password: str = Form(...)
):
    user = await get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be 6+ characters.")

    async with get_conn() as conn:
        async with conn.execute("SELECT salt, password_hash FROM users WHERE username = ?", (user,)) as cursor:
            row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Account not found.")
        salt, stored_hash = row
        _, check_hash = hash_pass(current_password, salt)
        if not secrets.compare_digest(check_hash, stored_hash):
            raise HTTPException(status_code=403, detail="Current password is incorrect.")

        new_salt, new_hash = hash_pass(new_password)
        await conn.execute(
            "UPDATE users SET salt = ?, password_hash = ? WHERE username = ?",
            (new_salt, new_hash, user)
        )
        await conn.commit()

    return {"status": "ok", "detail": "Password updated successfully."}


@router.get("/api/account/sessions")
async def get_active_sessions(token: str = Query(...)):
    user = await get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    async with get_conn() as conn:
        async with conn.execute(
            "SELECT token, created_at FROM sessions WHERE username = ? ORDER BY created_at DESC",
            (user,)
        ) as cursor:
            rows = await cursor.fetchall()

    sessions = []
    for s_tok, s_created in rows:
        is_cur = (s_tok == token)
        sessions.append({
            "session_id": s_tok[:8] + "...",
            "is_current": is_cur,
            "created_at": s_created,
            "device": "Web Browser Client"
        })

    return {"sessions": sessions, "total": len(sessions)}


@router.post("/api/account/revoke_sessions")
async def revoke_other_sessions(token: str = Form(...)):
    user = await get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    async with get_conn() as conn:
        cursor = await conn.execute(
            "DELETE FROM sessions WHERE username = ? AND token != ?",
            (user, token)
        )
        revoked_count = cursor.rowcount
        await conn.commit()

    return {
        "status": "ok",
        "revoked_count": revoked_count,
        "detail": f"Successfully revoked {revoked_count} other active session(s)."
    }

