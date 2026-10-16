from typing import Optional

from fastapi import APIRouter, Query

from ..messages_repo import get_message_readers

router = APIRouter()


@router.get("/api/messages/readers")
async def fetch_message_readers(message_id: int = Query(...), token: Optional[str] = Query(None)):
    readers = await get_message_readers(message_id)
    return {"message_id": message_id, "readers": readers}
