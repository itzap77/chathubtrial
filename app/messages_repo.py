import time
from typing import List, Optional

from .config import HISTORY_LIMIT
from .db import get_conn


async def is_user_banned(room_id: str, username: str):
    if room_id == "public" or room_id.startswith("dm_") or room_id.startswith("tmp_"):
        return False, 0
    async with get_conn() as conn:
        async with conn.execute(
            "SELECT expires_at FROM room_bans WHERE room_id = ? AND username = ?", (room_id, username)
        ) as cursor:
            row = await cursor.fetchone()
        if not row:
            return False, 0
        expires_at = row[0]
        if expires_at == -1:
            return True, -1
        if expires_at > time.time():
            return True, expires_at
        await conn.execute("DELETE FROM room_bans WHERE room_id = ? AND username = ?", (room_id, username))
        await conn.commit()
        return False, 0


async def save_message(
    room_id: str,
    sender: str,
    text: Optional[str],
    filename: Optional[str] = None,
    original_name: Optional[str] = None,
    reply_to_id: Optional[int] = None,
    reply_to_sender: Optional[str] = None,
    reply_to_text: Optional[str] = None,
    is_read: int = 0
) -> int:
    async with get_conn() as conn:
        cursor = await conn.execute(
            """INSERT INTO messages 
               (room_id, sender, recipient, text, filename, original_name, reply_to_id, reply_to_sender, reply_to_text, is_read, created_at) 
               VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (room_id, sender, text, filename, original_name, reply_to_id, reply_to_sender, reply_to_text, is_read, time.time()),
        )
        await conn.commit()
        return cursor.lastrowid


async def record_read(message_id: int, username: str):
    async with get_conn() as conn:
        await conn.execute("INSERT OR IGNORE INTO message_reads (message_id, username, read_at) VALUES (?, ?, ?)",
                           (message_id, username, time.time()))
        await conn.execute("UPDATE messages SET is_read = 2 WHERE id = ?", (message_id,))
        await conn.commit()


async def get_message_readers(message_id: int) -> List[str]:
    async with get_conn() as conn:
        async with conn.execute("SELECT username FROM message_reads WHERE message_id = ? ORDER BY read_at ASC", (message_id,)) as cursor:
            rows = await cursor.fetchall()
            return [r[0] for r in rows]


async def load_history(room_id: str, limit: int = HISTORY_LIMIT):
    from .profile_repo import get_public_display_names  # local import avoids a circular import at module load

    async with get_conn() as conn:
        async with conn.execute(
            """SELECT id, sender, text, filename, original_name, reply_to_id, reply_to_sender, reply_to_text, is_read, created_at 
               FROM messages WHERE room_id = ? ORDER BY id DESC LIMIT ?""",
            (room_id, limit)
        ) as cursor:
            rows = await cursor.fetchall()
    rows.reverse()
    display_names = await get_public_display_names([r[1] for r in rows])
    res = []
    for r in rows:
        res.append({
            "id": r[0],
            "sender": r[1],
            "sender_display": display_names.get(r[1]),
            "text": r[2],
            "filename": r[3],
            "original_name": r[4],
            "reply_to": {
                "id": r[5],
                "sender": r[6],
                "text": r[7]
            } if r[5] else None,
            "is_read": r[8],
            "timestamp": r[9]
        })
    return res
