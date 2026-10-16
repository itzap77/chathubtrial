import asyncio
import time

import aiosqlite

from .config import DB_PATH, UPLOAD_DIR


def get_conn():
    return aiosqlite.connect(DB_PATH, timeout=30.0)


async def init_db():
    async with get_conn() as conn:
        await conn.execute("PRAGMA journal_mode=WAL")
        await conn.execute("PRAGMA busy_timeout = 5000")
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                salt TEXT NOT NULL,
                password_hash TEXT NOT NULL
            )
        """)
        async with conn.execute("PRAGMA table_info(users)") as cursor:
            user_cols = [col[1] for col in await cursor.fetchall()]
            if "display_name" not in user_cols:
                await conn.execute("ALTER TABLE users ADD COLUMN display_name TEXT DEFAULT NULL")
            if "bio" not in user_cols:
                await conn.execute("ALTER TABLE users ADD COLUMN bio TEXT DEFAULT NULL")
            if "show_display_name" not in user_cols:
                await conn.execute("ALTER TABLE users ADD COLUMN show_display_name INTEGER DEFAULT 0")
            if "show_bio" not in user_cols:
                await conn.execute("ALTER TABLE users ADD COLUMN show_bio INTEGER DEFAULT 0")
            if "public_key" not in user_cols:
                await conn.execute("ALTER TABLE users ADD COLUMN public_key TEXT DEFAULT NULL")
            if "custom_status" not in user_cols:
                await conn.execute("ALTER TABLE users ADD COLUMN custom_status TEXT DEFAULT NULL")
            if "status_emoji" not in user_cols:
                await conn.execute("ALTER TABLE users ADD COLUMN status_emoji TEXT DEFAULT NULL")
            if "avatar_color" not in user_cols:
                await conn.execute("ALTER TABLE users ADD COLUMN avatar_color TEXT DEFAULT NULL")
            if "created_at" not in user_cols:
                await conn.execute("ALTER TABLE users ADD COLUMN created_at REAL DEFAULT NULL")
            if "hide_presence" not in user_cols:
                await conn.execute("ALTER TABLE users ADD COLUMN hide_presence INTEGER DEFAULT 0")
        await conn.execute("UPDATE users SET created_at = ? WHERE created_at IS NULL", (time.time(),))
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                created_at REAL NOT NULL
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS rooms (
                room_id TEXT PRIMARY KEY,
                room_name TEXT NOT NULL,
                passkey_salt TEXT NOT NULL,
                passkey_hash TEXT NOT NULL,
                created_by TEXT,
                created_at REAL NOT NULL
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS user_rooms (
                username TEXT NOT NULL,
                room_id TEXT NOT NULL,
                joined_at REAL NOT NULL,
                PRIMARY KEY (username, room_id)
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS dm_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender TEXT NOT NULL,
                recipient TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at REAL NOT NULL,
                UNIQUE(sender, recipient)
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS room_bans (
                room_id TEXT NOT NULL,
                username TEXT NOT NULL,
                banned_by TEXT NOT NULL,
                expires_at REAL NOT NULL,
                PRIMARY KEY (room_id, username)
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room_id TEXT NOT NULL,
                sender TEXT NOT NULL,
                recipient TEXT,
                text TEXT,
                filename TEXT,
                original_name TEXT,
                reply_to_id INTEGER DEFAULT NULL,
                reply_to_sender TEXT DEFAULT NULL,
                reply_to_text TEXT DEFAULT NULL,
                is_read INTEGER DEFAULT 0,
                created_at REAL NOT NULL
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS message_reads (
                message_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                read_at REAL NOT NULL,
                PRIMARY KEY (message_id, username)
            )
        """)
        async with conn.execute("PRAGMA table_info(messages)") as cursor:
            cols = [col[1] for col in await cursor.fetchall()]
            if "reply_to_id" not in cols:
                await conn.execute("ALTER TABLE messages ADD COLUMN reply_to_id INTEGER DEFAULT NULL")
            if "reply_to_sender" not in cols:
                await conn.execute("ALTER TABLE messages ADD COLUMN reply_to_sender TEXT DEFAULT NULL")
            if "reply_to_text" not in cols:
                await conn.execute("ALTER TABLE messages ADD COLUMN reply_to_text TEXT DEFAULT NULL")
        await conn.commit()


async def purge_expired_public_messages():
    while True:
        try:
            cutoff = time.time() - (48 * 3600)
            async with get_conn() as conn:
                async with conn.execute(
                    "SELECT filename FROM messages WHERE room_id = 'public' AND created_at < ? AND filename IS NOT NULL",
                    (cutoff,)
                ) as cursor:
                    old_files = await cursor.fetchall()
                    for (f,) in old_files:
                        try:
                            p = UPLOAD_DIR / f
                            if p.exists():
                                p.unlink()
                        except Exception:
                            pass
                await conn.execute("DELETE FROM messages WHERE room_id = 'public' AND created_at < ?", (cutoff,))
                await conn.commit()
        except Exception:
            pass
        await asyncio.sleep(3600)
