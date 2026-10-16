import hashlib
import secrets
import time
from typing import Optional

from .config import SESSION_TTL_SECONDS
from .db import get_conn


def hash_pass(password: str, salt: str = None) -> tuple:
    if not salt:
        salt = secrets.token_hex(16)
    pwd_hash = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000).hex()
    return salt, pwd_hash


async def create_session(username: str) -> str:
    token = secrets.token_hex(32)
    async with get_conn() as conn:
        await conn.execute("INSERT INTO sessions VALUES (?, ?, ?)", (token, username, time.time()))
        await conn.commit()
    return token


async def get_user_by_token(token: Optional[str]) -> Optional[str]:
    if not token:
        return None
    now = time.time()
    async with get_conn() as conn:
        async with conn.execute("SELECT username, created_at FROM sessions WHERE token = ?", (token,)) as cursor:
            row = await cursor.fetchone()
            if not row:
                return None
            username, created_at = row
            if now - created_at > SESSION_TTL_SECONDS:
                await conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
                await conn.commit()
                return None
            return username
