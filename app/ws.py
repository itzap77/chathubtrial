import re
import secrets
import time
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from .auth import get_user_by_token
from .config import MAX_MESSAGE_CHARS
from .connection_manager import manager
from .messages_repo import record_read, save_message
from .profile_repo import get_public_display_names

router = APIRouter()


@router.websocket("/ws/{room_id}/{username}")
async def ws_endpoint(websocket: WebSocket, room_id: str, username: str, token: Optional[str] = Query(None), client_id: Optional[str] = Query(None)):
    room_id = room_id.strip().lower()
    requested_username = username.strip()
    cid = client_id or secrets.token_hex(6)

    if not room_id.startswith("tmp_"):
        auth_user = await get_user_by_token(token)
        if not auth_user or auth_user.lower() != requested_username.lower():
            await websocket.close(code=4003, reason="Authentication required to join persistent spaces.")
            return

    actual_user = await manager.connect(websocket, room_id, requested_username, cid)
    if not actual_user:
        return

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "chat":
                text = str(data.get("text", ""))[:MAX_MESSAGE_CHARS].strip()
                reply_to = data.get("reply_to")
                if text:
                    peers = manager.rooms.get(room_id, {})
                    other_peers_present = any(uname != actual_user for uname, _ in peers.values())
                    initial_read = 1 if other_peers_present else 0

                    reply_id = reply_to.get("id") if reply_to else None
                    reply_sender = reply_to.get("sender") if reply_to else None
                    reply_text = reply_to.get("text") if reply_to else None

                    msg_id = await save_message(
                        room_id=room_id,
                        sender=actual_user,
                        text=text,
                        reply_to_id=reply_id,
                        reply_to_sender=reply_sender,
                        reply_to_text=reply_text,
                        is_read=initial_read
                    )

                    mentions = list(set(re.findall(r"@([A-Za-z0-9_-]+)", text)))
                    sender_display = (await get_public_display_names([actual_user])).get(actual_user)

                    payload = {
                        "type": "chat",
                        "id": msg_id,
                        "room_id": room_id,
                        "sender": actual_user,
                        "sender_display": sender_display,
                        "sender_cid": cid,
                        "text": text,
                        "filename": None,
                        "original_name": None,
                        "reply_to": {
                            "id": reply_id,
                            "sender": reply_sender,
                            "text": reply_text
                        } if reply_id else None,
                        "mentions": mentions,
                        "is_read": initial_read,
                        "timestamp": time.time()
                    }
                    await manager.broadcast_payload(room_id, payload)

                    # Directly alert tagged users across all active connections
                    for tagged_name in mentions:
                        if tagged_name.lower() != actual_user.lower():
                            await manager.notify_user(tagged_name, {
                                "type": "user_mentioned",
                                "by": actual_user,
                                "room_id": room_id,
                                "text": text
                            })

            elif msg_type == "typing":
                await manager.broadcast_payload(room_id, {"type": "typing", "sender": actual_user, "sender_cid": cid})

            elif msg_type == "read_ack":
                msg_id = data.get("message_id")
                if msg_id:
                    await record_read(msg_id, actual_user)
                    await manager.broadcast_payload(room_id, {
                        "type": "read_ack",
                        "message_id": msg_id,
                        "reader": actual_user
                    })

            elif msg_type == "webrtc_signal":
                target_user = data.get("target")
                action = data.get("action", "signal")
                signal_payload = {
                    **data,
                    "type": "webrtc_signal",
                    "sender": actual_user,
                    "sender_cid": cid,
                    "target": target_user,
                    "room_id": room_id,
                    "signal": data.get("signal"),
                    "call_type": data.get("call_type", "video"),
                    "media_type": data.get("media_type"),
                    "action": action
                }
                if target_user:
                    target_clean = str(target_user).strip().lower()
                    target_online = any(u.lower() == target_clean for u in manager.get_online_users(include_ephemeral=True))
                    if not target_online and action == "call":
                        await websocket.send_json({
                            "type": "webrtc_signal",
                            "action": "offline",
                            "sender": str(target_user),
                            "target": actual_user
                        })
                    else:
                        await manager.notify_user(str(target_user), signal_payload)
                else:
                    await manager.broadcast_payload(room_id, signal_payload)

    except WebSocketDisconnect:
        await manager.disconnect(room_id, cid)
