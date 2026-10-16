import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse

from .config import STATIC_DIR, UPLOAD_DIR
from .db import init_db, purge_expired_public_messages
from .static_files import NoCacheStaticFiles, SecureStaticFiles
from .routes import auth_routes, dm, messages, rooms, uploads, users
from .ws import router as ws_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    task = asyncio.create_task(purge_expired_public_messages())
    yield
    task.cancel()


app = FastAPI(lifespan=lifespan)
app.mount("/uploads", SecureStaticFiles(directory=str(UPLOAD_DIR)), name="uploads")
app.mount("/css", NoCacheStaticFiles(directory=str(STATIC_DIR / "css")), name="css")
app.mount("/js", NoCacheStaticFiles(directory=str(STATIC_DIR / "js")), name="js")

app.include_router(auth_routes.router)
app.include_router(users.router)
app.include_router(dm.router)
app.include_router(rooms.router)
app.include_router(uploads.router)
app.include_router(messages.router)
app.include_router(ws_router)


@app.get("/")
async def get_index():
    return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000)
