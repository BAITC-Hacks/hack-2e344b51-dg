"""Тесты на три контрольных значения из ТЗ.

Запуск: pytest backend/engine/calculator_test.py -v
"""
import pytest

from .validator import Decision, validate
from .calculator import compute, compute_base_score


def test_base_score_without_any_measures():
    """Базовый Score без каких-либо мероприятий должен быть 52.56."""
    result = compute([])
    assert result.score == pytest.approx(52.56, abs=0.01)
    assert result.d_avg == pytest.approx(56.86, abs=0.01)
    assert result.weakest_district_name == "Нура"
    assert result.weakest_d == pytest.approx(49.18, abs=0.01)
    assert result.n_crit == 2  # S1 и S2 в Нуре


def test_example_scenario_from_spec():
    """Набор {M7->Нура, M8->Нура, M10->Нура, M12->город, M5->Сарыарка}:
    стоимость 95, Score ≈ 56.5, синергия M10+M12 срабатывает."""
    decisions = [
        Decision("M7", "nura"),
        Decision("M8", "nura"),
        Decision("M10", "nura"),
        Decision("M12", None),
        Decision("M5", "saryarka"),
    ]
    validation = validate(decisions)
    assert validation.ok, validation.reason
    assert validation.total_cost == 95

    result = compute(validation.normalized_decisions)
    assert result.total_cost == 95
    assert result.score == pytest.approx(56.5, abs=0.6)

    synergy_pairs = [tuple(s["pair"]) for s in result.triggered_synergies]
    assert ("M10", "M12") in synergy_pairs


def test_cheapest_valid_scenario_cost():
    """Самый дешёвый валидный набор {M9, M11, M10, M12, M4} стоит 61."""
    decisions = [
        Decision("M9", "nura"),
        Decision("M11", "nura"),
        Decision("M10", "nura"),
        Decision("M12", None),
        Decision("M4", "saryarka"),
    ]
    validation = validate(decisions)
    assert validation.ok, validation.reason
    assert validation.total_cost == 61


def test_incompatibility_m1_m3_any_district():
    decisions = [
        Decision("M1", "esil"),
        Decision("M3", "nura"),
        Decision("M9", "nura"),
        Decision("M10", "nura"),
        Decision("M12", None),
    ]
    validation = validate(decisions)
    assert not validation.ok
    assert "M1" in validation.reason and "M3" in validation.reason


def test_incompatibility_m4_m7_same_district_only():
    # в одном районе — запрещено
    decisions_same = [
        Decision("M4", "nura"),
        Decision("M7", "nura"),
        Decision("M9", "esil"),
        Decision("M10", "esil"),
        Decision("M12", None),
    ]
    assert not validate(decisions_same).ok

    # в разных районах — разрешено
    decisions_diff = [
        Decision("M4", "nura"),
        Decision("M7", "esil"),
        Decision("M9", "esil"),
        Decision("M10", "esil"),
        Decision("M12", None),
    ]
    assert validate(decisions_diff).ok


def test_budget_exceeded():
    decisions = [
        Decision("M3", "esil"),   # 30
        Decision("M7", "nura"),   # 24
        Decision("M8", "nura"),   # 20
        Decision("M13", "almaty"),  # 28
        Decision("M6", None),     # 20 -> итого 122
    ]
    validation = validate(decisions)
    assert not validation.ok
    assert "бюджет" in validation.reason.lower()


def test_wrong_number_of_decisions():
    decisions = [Decision("M9", "nura"), Decision("M10", "nura")]
    validation = validate(decisions)
    assert not validation.ok
    assert "5" in validation.reason


def test_duplicate_activity_forbidden():
    decisions = [
        Decision("M9", "nura"),
        Decision("M9", "esil"),
        Decision("M10", "nura"),
        Decision("M11", "nura"),
        Decision("M12", None),
    ]
    validation = validate(decisions)
    assert not validation.ok
    assert "M9" in validation.reason


def test_max_two_per_direction():
    # 3 меры из направления "safety" — недопустимо (в каталоге их всего 2, поэтому
    # проверяем на "social": M7, M8, M9 — все из social)
    decisions = [
        Decision("M7", "nura"),
        Decision("M8", "nura"),
        Decision("M9", "esil"),
        Decision("M10", "esil"),
        Decision("M12", None),
    ]
    validation = validate(decisions)
    assert not validation.ok
    assert "social" in validation.reason.lower() or "соцсфер" in validation.reason.lower()


def test_city_type_ignores_district_if_passed():
    decisions = [
        Decision("M9", "nura"),
        Decision("M10", "nura"),
        Decision("M11", "esil"),
        Decision("M12", "esil"),  # M12 - тип city, район должен игнорироваться
        Decision("M14", "esil"),  # тоже city
    ]
    validation = validate(decisions)
    assert validation.ok, validation.reason
    m12 = [d for d in validation.normalized_decisions if d.activity_id == "M12"][0]
    assert m12.district_id is None


def test_district_type_requires_district():
    decisions = [
        Decision("M9", None),  # M9 требует район
        Decision("M10", "nura"),
        Decision("M11", "nura"),
        Decision("M12", None),
        Decision("M4", "esil"),
    ]
    validation = validate(decisions)
    assert not validation.ok
    assert "M9" in validation.reason
