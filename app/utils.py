import random

from .config import ADJECTIVES, NOUNS


def generate_random_alias() -> str:
    return f"{random.choice(ADJECTIVES)}{random.choice(NOUNS)}_{random.randint(100, 999)}"


def make_dm_room_id(u1: str, u2: str) -> str:
    pair = sorted([u1.lower(), u2.lower()])
    return f"dm_{pair[0]}__{pair[1]}"


def parse_dm_target(room_id: str, my_username: str) -> str:
    raw = room_id.replace("dm_", "")
    my_clean = my_username.strip().lower()
    if "__" in raw:
        parts = raw.split("__")
        return parts[1] if parts[0].lower() == my_clean else parts[0]
    if raw.lower().startswith(f"{my_clean}_"):
        return raw[len(my_clean) + 1:]
    if raw.lower().endswith(f"_{my_clean}"):
        return raw[:-len(my_clean) - 1]
    parts = raw.split("_")
    for p in parts:
        if p.lower() != my_clean:
            return p
    return parts[0]

