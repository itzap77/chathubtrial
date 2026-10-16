import time
from typing import Dict, List, Optional, Set

from fastapi import WebSocket

from .config import EPHEMERAL_ROOMS, UPLOAD_DIR
from .db import get_conn
from .messages_repo import is_user_banned, load_history, record_read
from .utils import parse_dm_target


class RoomConnectionManager:
    def __init__(self):
        self.rooms: Dict[str, Dict[str, tuple[str, WebSocket]]] = {}

    def get_online_users(self, include_ephemeral: bool = False) -> Set[str]:
        online = set()
        for rid, clients in self.rooms.items():
            if not include_ephemeral and rid.startswith("tmp_"):
                continue
            for uname, _ in clients.values():
                online.add(uname)
        return online

    def get_room_participants(self, room_id: str) -> List[str]:
        room_id = room_id.strip().lower()
        if room_id == "public":
            return list(self.get_online_users(include_ephemeral=False))
        if room_id in self.rooms:
            return list({uname for uname, _ in self.rooms[room_id].values()})
        return []

    async def connect(self, websocket: WebSocket, room_id: str, requested_username: str, client_id: str) -> Optional[str]:
        room_id = room_id.strip().lower()

        if room_id.startswith("tmp_"):
            if room_id not in EPHEMERAL_ROOMS:
                await websocket.close(code=4004, reason="Ephemeral room does not exist.")
                return None
            meta = EPHEMERAL_ROOMS[room_id]
            current_users = len(self.rooms.get(room_id, {}))
            if current_users >= meta["max_users"] and client_id not in self.rooms.get(room_id, {}):
                await websocket.close(code=4003, reason="Room capacity limit reached.")
                return None
        else:
            if room_id != "public":
                banned, _ = await is_user_banned(room_id, requested_username)
                if banned:
                    await websocket.close(code=4003, reason="You are banned from this room.")
                    return None

                async with get_conn() as conn:
                    async with conn.execute("SELECT 1 FROM user_rooms WHERE username = ? AND room_id = ?", (requested_username, room_id)) as cursor:
                        if not await cursor.fetchone():
                            await websocket.close(code=4003)
                            return None

        await websocket.accept()
        if room_id not in self.rooms:
            self.rooms[room_id] = {}

        actual_username = requested_username
        existing_names = {u for u, _ in self.rooms[room_id].values()}
        if room_id.startswith("tmp_") and actual_username in existing_names:
            suffix = 2
            while f"{requested_username}_{suffix}" in existing_names:
                suffix += 1
            actual_username = f"{requested_username}_{suffix}"

        self.rooms[room_id][client_id] = (actual_username, websocket)

        if room_id in EPHEMERAL_ROOMS:
            EPHEMERAL_ROOMS[room_id]["has_had_users"] = True

        created_by = ""
        room_name = "Public Group"
        if room_id.startswith("tmp_"):
            room_name = "⚡ Ephemeral Space"
        elif room_id.startswith("dm_"):
            target_user = parse_dm_target(room_id, actual_username)
            room_name = f"@{target_user}"
        else:
            async with get_conn() as conn:
                async with conn.execute("SELECT room_name, created_by FROM rooms WHERE room_id = ?", (room_id,)) as cursor:
                    r = await cursor.fetchone()
                    if r:
                        room_name, created_by = r

        async with get_conn() as conn:
            async with conn.execute("SELECT id FROM messages WHERE room_id = ? AND sender != ?", (room_id, actual_username)) as cursor:
                unread_ids = await cursor.fetchall()
                for (mid,) in unread_ids:
                    await record_read(mid, actual_username)

        history = await load_history(room_id)
        room_members = self.get_room_participants(room_id)

        await websocket.send_json({
            "type": "init",
            "assigned_username": actual_username,
            "client_id": client_id,
            "is_admin": (created_by == actual_username),
            "created_by": created_by,
            "room_code": room_id,
            "room_name": room_name,
            "is_ephemeral": room_id.startswith("tmp_"),
            "messages": history,
            "members": room_members
        })

        await self.broadcast_payload(room_id, {"type": "all_read_ack", "reader": actual_username})
        await self.broadcast_presence_update()
        if not room_id.startswith("dm_"):
            await self.broadcast_system(room_id, f"{actual_username} connected.")
        return actual_username

    async def disconnect(self, room_id: str, client_id: str):
        room_id = room_id.strip().lower()
        if room_id in self.rooms and client_id in self.rooms[room_id]:
            username, _ = self.rooms[room_id][client_id]
            del self.rooms[room_id][client_id]

            if room_id in EPHEMERAL_ROOMS and len(self.rooms[room_id]) == 0 and EPHEMERAL_ROOMS[room_id]["has_had_users"]:
                del self.rooms[room_id]
                del EPHEMERAL_ROOMS[room_id]

                async with get_conn() as conn:
                    async with conn.execute("SELECT filename FROM messages WHERE room_id = ? AND filename IS NOT NULL", (room_id,)) as cursor:
                        files = await cursor.fetchall()
                        for (f,) in files:
                            try:
                                (UPLOAD_DIR / f).unlink(missing_ok=True)
                            except Exception:
                                pass
                    await conn.execute("DELETE FROM messages WHERE room_id = ?", (room_id,))
                    await conn.commit()
                return

            if not self.rooms[room_id]:
                del self.rooms[room_id]

            await self.broadcast_presence_update()
            if not room_id.startswith("dm_"):
                await self.broadcast_system(room_id, f"{username} disconnected.")

    async def kick_user(self, room_id: str, username: str, reason: str):
        room_id = room_id.strip().lower()
        if room_id not in self.rooms:
            return
        want = username.strip().lower()
        targets = [cid for cid, (uname, _) in self.rooms[room_id].items() if uname.lower() == want]
        for cid in targets:
            _, ws = self.rooms[room_id][cid]
            try:
                await ws.send_json({"type": "kicked", "reason": reason})
                await ws.close(code=4003)
            except Exception:
                pass
            del self.rooms[room_id][cid]
        if targets:
            await self.broadcast_presence_update()

    async def notify_user(self, username: str, payload: dict):
        want = username.strip().lower()
        for room_dict in self.rooms.values():
            for uname, ws in room_dict.values():
                if uname.lower() == want:
                    try:
                        await ws.send_json(payload)
                    except Exception:
                        pass

    async def broadcast_presence_update(self):
        for rid in list(self.rooms.keys()):
            participants = self.get_room_participants(rid)
            await self.broadcast_payload(rid, {"type": "presence_sync", "members": participants})

    async def broadcast_system(self, room_id: str, text: str):
        room_id = room_id.strip().lower()
        if room_id in self.rooms:
            payload = {"type": "system", "text": text, "timestamp": time.time()}
            for _, ws in list(self.rooms[room_id].values()):
                try:
                    await ws.send_json(payload)
                except Exception:
                    pass

    async def broadcast_payload(self, room_id: str, payload: dict):
        room_id = room_id.strip().lower()
        if room_id not in self.rooms:
            return
        for _, ws in list(self.rooms[room_id].values()):
            try:
                await ws.send_json(payload)
            except Exception:
                pass


# Single shared instance imported by routes and the websocket endpoint.
manager = RoomConnectionManager()
