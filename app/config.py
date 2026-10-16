import re
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
UPLOAD_DIR = BASE_DIR / "uploads"
DB_PATH = BASE_DIR / "chat.db"

UPLOAD_DIR.mkdir(exist_ok=True)
STATIC_DIR.mkdir(exist_ok=True)

USERNAME_RE = re.compile(r"^[A-Za-z0-9 _-]{2,25}$")
MAX_MESSAGE_CHARS = 4000
HISTORY_LIMIT = 100
MAX_UPLOAD_SIZE = 100 * 1024 * 1024
SESSION_TTL_SECONDS = 30 * 86400

ADJECTIVES = ["Neon", "Cyber", "Ghost", "Shadow", "Phantom", "Silent", "Quantum", "Echo", "Astral", "Solar", "Cosmic", "Vortex"]
NOUNS = ["Viper", "Raven", "Falcon", "Wolf", "Specter", "Otter", "Fox", "Hawk", "Phoenix", "Cipher", "Drifter", "Pulse"]

# Shared in-memory state for ephemeral (tmp_) rooms.
EPHEMERAL_ROOMS: dict = {}
