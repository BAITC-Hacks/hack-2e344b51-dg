"""Валидация сценария из 5 решений по правилам ТЗ.

Ничего не считает (никаких Score/индикаторов) — только проверяет допустимость
набора решений и возвращает причину отказа, если набор невалиден.
"""
from dataclasses import dataclass, field

from .data_loader import load_rules, activities_by_id, districts_by_id


@dataclass
class Decision:
    activity_id: str
    district_id: str | None = None


@dataclass
class ValidationResult:
    ok: bool
    reason: str | None = None
    normalized_decisions: list[Decision] = field(default_factory=list)
    total_cost: int = 0


def validate(decisions: list[Decision]) -> ValidationResult:
    rules = load_rules()
    activities = activities_by_id()
    districts = districts_by_id()

    # 1. ровно N решений
    required = rules["decisions_required"]
    if len(decisions) != required:
        return ValidationResult(False, f"Нужно принять ровно {required} решений, передано {len(decisions)}")

    # 2. все activity_id существуют
    for d in decisions:
        if d.activity_id not in activities:
            return ValidationResult(False, f"Неизвестное мероприятие: {d.activity_id}")

    # 3. повторы запрещены
    ids = [d.activity_id for d in decisions]
    if len(set(ids)) != len(ids):
        dup = [x for x in ids if ids.count(x) > 1][0]
        return ValidationResult(False, f"Мероприятие {dup} выбрано более одного раза")

    # 4. район обязателен для типа "district", отсутствует/игнорируется для "city"
    normalized: list[Decision] = []
    for d in decisions:
        activity = activities[d.activity_id]
        if activity["type"] == "district":
            if not d.district_id:
                return ValidationResult(False, f"Для мероприятия {d.activity_id} нужно указать район")
            if d.district_id not in districts:
                return ValidationResult(False, f"Неизвестный район: {d.district_id}")
            normalized.append(Decision(d.activity_id, d.district_id))
        else:
            # тип "city" — район игнорируется, даже если передан
            normalized.append(Decision(d.activity_id, None))

    # 5. бюджет
    total_cost = sum(activities[d.activity_id]["cost"] for d in normalized)
    budget = rules["budget"]
    if total_cost > budget:
        return ValidationResult(False, f"Превышен бюджет: {total_cost}/{budget}")

    # 6. не более max_per_direction мер из одного направления
    max_per_direction = rules["max_per_direction"]
    direction_counts: dict[str, int] = {}
    for d in normalized:
        direction = activities[d.activity_id]["direction"]
        direction_counts[direction] = direction_counts.get(direction, 0) + 1
    for direction, count in direction_counts.items():
        if count > max_per_direction:
            label = direction
            return ValidationResult(
                False,
                f"Слишком много мер из одного направления «{label}»: {count} (максимум {max_per_direction})",
            )

    # 7. несовместимости
    chosen_ids = {d.activity_id: d for d in normalized}
    for incompat in rules["incompatibilities"]:
        a_id, b_id = incompat["pair"]
        if a_id in chosen_ids and b_id in chosen_ids:
            if incompat["scope"] == "any_district":
                return ValidationResult(False, incompat["reason"])
            if incompat["scope"] == "same_district":
                a_district = chosen_ids[a_id].district_id
                b_district = chosen_ids[b_id].district_id
                if a_district is not None and a_district == b_district:
                    return ValidationResult(False, incompat["reason"])

    return ValidationResult(True, None, normalized, total_cost)
