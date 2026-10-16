import secrets
import time
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..auth import get_user_by_token
from ..config import MAX_UPLOAD_SIZE, UPLOAD_DIR
from ..connection_manager import manager
from ..messages_repo import save_message
from ..profile_repo import get_public_display_names

router = APIRouter()


@router.post("/api/upload")
async def upload_file(
    file: UploadFile = File(...),
    token: Optional[str] = Form(None),
    room_id: str = Form(...),
    guest_user: Optional[str] = Form(None),
    client_id: Optional[str] = Form(None),
    reply_to_id: Optional[int] = Form(None),
    reply_to_sender: Optional[str] = Form(None),
    reply_to_text: Optional[str] = Form(None)
):
    room_id = room_id.strip().lower()

    if room_id.startswith("tmp_"):
        me = guest_user or "Anonymous"
    else:
        me = await get_user_by_token(token)
        if not me:
            raise HTTPException(status_code=401, detail="Unauthorized")

    orig_name = Path(file.filename).name
    ext = Path(file.filename).suffix.lower()
    safe_ext = ext if len(ext) > 1 and len(ext) <= 8 else ".bin"
    unique_name = f"{int(time.time())}_{secrets.token_hex(4)}{safe_ext}"
    save_path = UPLOAD_DIR / unique_name

    total_written = 0
    with open(save_path, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            total_written += len(chunk)
            if total_written > MAX_UPLOAD_SIZE:
                f.close()
                save_path.unlink(missing_ok=True)
                raise HTTPException(status_code=400, detail="File limit is 100MB")
            f.write(chunk)

    peers = manager.rooms.get(room_id, {})
    other_peers_present = any(uname != me for uname, _ in peers.values())
    initial_read = 1 if other_peers_present else 0

    msg_id = await save_message(
        room_id=room_id,
        sender=me,
        text="",
        filename=unique_name,
        original_name=orig_name,
        reply_to_id=reply_to_id,
        reply_to_sender=reply_to_sender,
        reply_to_text=reply_to_text,
        is_read=initial_read
    )

    sender_display = (await get_public_display_names([me])).get(me)

    payload = {
        "type": "chat",
        "id": msg_id,
        "sender": me,
        "sender_display": sender_display,
        "sender_cid": client_id,
        "text": "",
        "filename": unique_name,
        "original_name": orig_name,
        "reply_to": {
            "id": reply_to_id,
            "sender": reply_to_sender,
            "text": reply_to_text
        } if reply_to_id else None,
        "is_read": initial_read,
        "timestamp": time.time()
    }
    await manager.broadcast_payload(room_id, payload)
    return {"status": "ok", "filename": unique_name, "original_name": orig_name, "id": msg_id}
