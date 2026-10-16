from fastapi import APIRouter, Form, HTTPException, Query

from ..auth import get_user_by_token
from ..connection_manager import manager
from ..db import get_conn
from ..profile_repo import get_hidden_presence_users, get_public_display_names, get_public_identity

router = APIRouter()


@router.get("/api/users/directory")
async def get_directory(token: str = Query(...)):
    me = await get_user_by_token(token)
    if not me:
        raise HTTPException(status_code=401, detail="Unauthorized")
    online_set = manager.get_online_users(include_ephemeral=False)
    hidden_users = await get_hidden_presence_users()
    effective_online = {u for u in online_set if u not in hidden_users or u == me}

    async with get_conn() as conn:
        async with conn.execute(
            "SELECT username, custom_status, status_emoji, avatar_color FROM users ORDER BY username ASC"
        ) as cursor:
            rows = await cursor.fetchall()
            user_data = {r[0]: {"custom_status": r[1], "status_emoji": r[2], "avatar_color": r[3]} for r in rows if r[0] != me}
            all_users = list(user_data.keys())

    display_names = await get_public_display_names(all_users)
    user_list = [
        {
            "username": u,
            "online": (u in effective_online),
            "display_name": display_names.get(u),
            "custom_status": user_data[u]["custom_status"],
            "status_emoji": user_data[u]["status_emoji"],
            "avatar_color": user_data[u]["avatar_color"]
        }
        for u in all_users
    ]
    user_list.sort(key=lambda x: (not x["online"], x["username"]))
    return {"total_online": len([u for u in effective_online if u != me]), "users": user_list}


@router.get("/api/users/search")
async def search_users(token: str = Query(...), q: str = Query("")):
    me = await get_user_by_token(token)
    if not me:
        raise HTTPException(status_code=401, detail="Unauthorized")
    needle = q.strip().lower().replace("%", "").replace("_", "")[:25]
    if len(needle) < 1:
        return {"users": []}
    online_set = manager.get_online_users(include_ephemeral=False)
    hidden_users = await get_hidden_presence_users()
    effective_online = {u for u in online_set if u not in hidden_users or u == me}

    async with get_conn() as conn:
        async with conn.execute(
            "SELECT username, custom_status, status_emoji, avatar_color FROM users WHERE username != ? AND username LIKE ? ORDER BY username ASC LIMIT 25",
            (me, f"%{needle}%"),
        ) as cursor:
            rows = await cursor.fetchall()
            user_data = {r[0]: {"custom_status": r[1], "status_emoji": r[2], "avatar_color": r[3]} for r in rows}
            usernames = list(user_data.keys())

    display_names = await get_public_display_names(usernames)
    users = [
        {
            "username": u,
            "online": (u in effective_online),
            "display_name": display_names.get(u),
            "custom_status": user_data[u]["custom_status"],
            "status_emoji": user_data[u]["status_emoji"],
            "avatar_color": user_data[u]["avatar_color"]
        }
        for u in usernames
    ]
    users.sort(key=lambda x: (not x["online"], x["username"]))
    return {"users": users}


@router.get("/api/users/public_profile")
async def get_public_profile(username: str = Query(...), token: str = Query(...)):
    me = await get_user_by_token(token)
    if not me:
        raise HTTPException(status_code=401, detail="Unauthorized")
    identity = await get_public_identity(username.strip().lower())
    if not identity:
        raise HTTPException(status_code=404, detail="User not found.")
    return identity


@router.post("/api/users/keys")
async def save_public_key(token: str = Form(...), public_key: str = Form(...)):
    me = await get_user_by_token(token)
    if not me:
        raise HTTPException(status_code=401, detail="Unauthorized")
    async with get_conn() as conn:
        await conn.execute("UPDATE users SET public_key = ? WHERE username = ?", (public_key.strip(), me))
        await conn.commit()
    return {"status": "ok", "username": me}


@router.get("/api/users/keys")
async def get_user_public_key(username: str = Query(...), token: str = Query(...)):
    me = await get_user_by_token(token)
    if not me:
        raise HTTPException(status_code=401, detail="Unauthorized")
    async with get_conn() as conn:
        async with conn.execute("SELECT public_key FROM users WHERE username = ?", (username.strip().lower(),)) as cursor:
            row = await cursor.fetchone()
            if not row or not row[0]:
                return {"username": username, "public_key": None}
            return {"username": username, "public_key": row[0]}

