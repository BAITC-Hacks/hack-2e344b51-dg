"""Детерминированный расчёт Astana Quality of Life Score.

ВАЖНО: этот модуль не делает ни одного обращения к LLM/AI API.
Он реализует формулы из ТЗ буквально, шаг за шагом:
  эффект меры -> лаг -> синергии -> клип [0,100] -> веса -> D_d -> D_avg -> Score
"""
from dataclasses import dataclass, field

from .data_loader import load_districts, load_activities, load_rules, activities_by_id
from .validator import Decision


def _clip(value: float, lo: float = 0, hi: float = 100) -> float:
    return max(lo, min(hi, value))


@dataclass
class DistrictResult:
    id: str
    name: str
    population_share: float
    before: dict
    after: dict
    d_before: float
    d_after: float


@dataclass
class MeasureContribution:
    activity_id: str
    name: str
    direction: str
    district_id: str | None
    district_name: str | None
    cost: int
    lag: int
    realized_fraction: float  # (H - lag) / H
    nominal_effects: dict  # эффекты до применения лага
    realized_effects: dict  # эффекты после применения лага, до клипа/синергий


@dataclass
class ScenarioResult:
    total_cost: int
    budget: int
    districts: list  # list[DistrictResult]
    d_avg: float
    weakest_district_id: str
    weakest_district_name: str
    weakest_d: float
    n_crit: int
    critical_pairs: list  # list[dict(district, indicator, value)]
    score: float
    score_breakdown: dict  # {city_component, weakest_component, penalty}
    triggered_synergies: list
    measure_contributions: list  # list[MeasureContribution]
    base_score: float  # Score без каких-либо мероприятий, для сравнения


def _weighted_d(indicator_values: dict, weights: dict) -> float:
    return sum(weights[k] * indicator_values[k] for k in weights)


def _compute_indicators(decisions: list[Decision]) -> tuple[dict, list, list]:
    """Возвращает (new_indicators_by_district, triggered_synergies, measure_contributions)."""
    districts_data = load_districts()["districts"]
    activities = activities_by_id()
    rules = load_rules()
    horizon = rules["horizon_quarters"]

    base_by_district = {d["id"]: dict(d["indicators"]) for d in districts_data}
    all_district_ids = [d["id"] for d in districts_data]

    # deltas[district_id][indicator] = накопленная сумма эффектов (после лага) + синергии
    deltas = {did: {k: 0.0 for k in base_by_district[did]} for did in all_district_ids}

    measure_contributions: list[MeasureContribution] = []

    for dec in decisions:
        activity = activities[dec.activity_id]
        lag = activity["lag"]
        realized_fraction = (horizon - lag) / horizon
        realized_effects = {k: v * realized_fraction for k, v in activity["effects"].items()}

        target_districts = all_district_ids if activity["type"] == "city" else [dec.district_id]
        for did in target_districts:
            for k, v in realized_effects.items():
                deltas[did][k] += v

        district_name = None
        if dec.district_id:
            district_name = next(d["name"] for d in districts_data if d["id"] == dec.district_id)

        measure_contributions.append(
            MeasureContribution(
                activity_id=dec.activity_id,
                name=activity["name"],
                direction=activity["direction"],
                district_id=dec.district_id,
                district_name=district_name,
                cost=activity["cost"],
                lag=lag,
                realized_fraction=round(realized_fraction, 4),
                nominal_effects=activity["effects"],
                realized_effects={k: round(v, 4) for k, v in realized_effects.items()},
            )
        )

    # синергии: фиксированный бонус, лагом не масштабируется
    chosen_ids = {dec.activity_id: dec for dec in decisions}
    triggered_synergies = []
    for synergy in rules["synergies"]:
        a_id, b_id = synergy["pair"]
        if a_id in chosen_ids and b_id in chosen_ids:
            source_activity_id = synergy["district_from"]
            source_decision = chosen_ids[source_activity_id]
            target_district = source_decision.district_id
            if target_district is None:
                # мера-источник синергии внезапно оказалась типа "город" — пропускаем защитно
                continue
            deltas[target_district][synergy["bonus_indicator"]] += synergy["bonus_value"]
            triggered_synergies.append(
                {
                    "pair": synergy["pair"],
                    "bonus_indicator": synergy["bonus_indicator"],
                    "bonus_value": synergy["bonus_value"],
                    "district_id": target_district,
                }
            )

    new_indicators = {}
    for did in all_district_ids:
        new_indicators[did] = {
            k: _clip(base_by_district[did][k] + deltas[did][k]) for k in base_by_district[did]
        }

    return new_indicators, triggered_synergies, measure_contributions


def compute_base_score() -> float:
    """Score без каких-либо мероприятий — используется как точка сравнения."""
    return compute([]).score


def compute(decisions: list[Decision]) -> ScenarioResult:
    """Главная функция движка. Принимает уже нормализованный список решений
    (обычно после успешной validate()) и возвращает полный расчёт.
    Пустой список decisions допустим — используется для расчёта базового Score.
    """
    districts_data = load_districts()["districts"]
    rules = load_rules()
    weights = rules["weights"]
    critical_threshold = rules["critical_threshold"]
    activities = activities_by_id()

    new_indicators, triggered_synergies, measure_contributions = _compute_indicators(decisions)

    district_results = []
    critical_pairs = []
    for d in districts_data:
        before = dict(d["indicators"])
        after = new_indicators[d["id"]]
        d_before = _weighted_d(before, weights)
        d_after = _weighted_d(after, weights)
        district_results.append(
            DistrictResult(
                id=d["id"],
                name=d["name"],
                population_share=d["population_share"],
                before=before,
                after=after,
                d_before=round(d_before, 4),
                d_after=round(d_after, 4),
            )
        )
        for indicator, value in after.items():
            if value < critical_threshold:
                critical_pairs.append({"district": d["name"], "indicator": indicator, "value": round(value, 2)})

    d_avg = sum(dr.population_share * dr.d_after for dr in district_results)
    weakest = min(district_results, key=lambda dr: dr.d_after)
    n_crit = len(critical_pairs)

    city_component = 0.7 * d_avg
    weakest_component = 0.3 * weakest.d_after
    penalty = 1.0 * n_crit
    score = city_component + weakest_component - penalty

    total_cost = sum(activities[dec.activity_id]["cost"] for dec in decisions)

    return ScenarioResult(
        total_cost=total_cost,
        budget=rules["budget"],
        districts=district_results,
        d_avg=round(d_avg, 4),
        weakest_district_id=weakest.id,
        weakest_district_name=weakest.name,
        weakest_d=weakest.d_after,
        n_crit=n_crit,
        critical_pairs=critical_pairs,
        score=round(score, 2),
        score_breakdown={
            "city_component": round(city_component, 4),
            "weakest_component": round(weakest_component, 4),
            "penalty": penalty,
        },
        triggered_synergies=triggered_synergies,
        measure_contributions=measure_contributions,
        base_score=0.0,  # заполняется снаружи при необходимости, чтобы не пересчитывать рекурсивно всегда
    )
