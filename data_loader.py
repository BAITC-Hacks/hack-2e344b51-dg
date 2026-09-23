"""Загрузка статических данных проекта (районы, мероприятия, правила).

Ничего не считает и не валидирует — только читает JSON и отдаёт python-объекты.
"""
import json
from pathlib import Path
from functools import lru_cache

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


@lru_cache
def load_districts() -> dict:
    with open(DATA_DIR / "districts.json", encoding="utf-8") as f:
        return json.load(f)


@lru_cache
def load_activities() -> dict:
    with open(DATA_DIR / "activities.json", encoding="utf-8") as f:
        return json.load(f)


@lru_cache
def load_rules() -> dict:
    with open(DATA_DIR / "rules.json", encoding="utf-8") as f:
        return json.load(f)


def activities_by_id() -> dict:
    return {a["id"]: a for a in load_activities()["activities"]}


def districts_by_id() -> dict:
    return {d["id"]: d for d in load_districts()["districts"]}


def district_name_to_id() -> dict:
    return {d["name"]: d["id"] for d in load_districts()["districts"]}
