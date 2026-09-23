"""Объяснение уже посчитанного сценария через LLM.

ВАЖНО: этот модуль получает на вход только готовый JSON с результатами расчёта
(engine.calculator.ScenarioResult, сериализованный в dict). Он не пересчитывает
и не придумывает числа — работает как "переводчик" цифр в человеческий текст.

Если ANTHROPIC_API_KEY не задан, используется офлайн-объяснение на основе
шаблонов (fallback), чтобы демо работало без ключа API.
"""
import os
import json

SYSTEM_PROMPT = """Ты — городской аналитик-ассистент в симуляторе «Аким на 5 часов».
Тебе присылают уже ПОСЧИТАННЫЙ JSON с результатами сценария управления городом:
Astana Quality of Life Score, вклад каждой меры, сработавшие синергии, районы
с критическими показателями (<40).

Твоя задача — ТОЛЬКО объяснить эти цифры человеческим языком. Никогда не придумывай
и не пересчитывай числа заново, используй только то, что передано в JSON.

Формат ответа (обычный текст, не JSON), 4 коротких раздела:
1. Итог — как изменился Score относительно базового сценария и почему.
2. Сильные стороны — какие конкретно меры и районы дали наибольший эффект.
3. Риски — какие направления остались незатронуты, какой район остаётся слабым,
   какие критические показатели (если есть) сохранились.
4. Рекомендация — одна конкретная идея, что добавить или поменять в следующей
   итерации сценария (опираясь на данные, не абстрактно).

Пиши кратко, по делу, на русском языке, обращаясь к пользователю как к городскому
управленцу, который принимает решение."""


def _fallback_explanation(payload: dict) -> str:
    """Простое объяснение без обращения к LLM API — используется как запасной
    вариант, если ключ API не настроен, чтобы демо всегда работало."""
    score = payload["score"]
    base_score = payload["base_score"]
    delta = round(score - base_score, 2)
    weakest = payload["weakest_district_name"]
    n_crit = payload["n_crit"]
    top_measures = ", ".join(m["name"] for m in payload["measure_contributions"][:3])
    synergies = payload["triggered_synergies"]

    lines = [
        f"Итог: Score сценария — {score} ({'+' if delta >= 0 else ''}{delta} к базовому {base_score}).",
        f"Сильные стороны: наибольший вклад внесли меры — {top_measures}.",
    ]
    if synergies:
        pairs = ", ".join("+".join(s["pair"]) for s in synergies)
        lines.append(f"Сработали синергии: {pairs}.")
    lines.append(
        f"Риски: самым слабым районом остаётся {weakest}; "
        f"критических показателей (<40) после сценария: {n_crit}."
    )
    lines.append(
        "Рекомендация: рассмотрите меры, которые напрямую усиливают показатели "
        f"слабейшего района ({weakest}), либо направления, не затронутые в этом сценарии."
    )
    return "\n\n".join(lines)


def explain_scenario(payload: dict) -> str:
    """payload — сериализованный ScenarioResult + base_score.
    Возвращает текстовое объяснение. Пробует Anthropic API, при отсутствии
    ключа или ошибке — использует офлайн-fallback."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return _fallback_explanation(payload)

    try:
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1000,
            system=SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": "Вот посчитанный сценарий (JSON), объясни его по формату:\n\n"
                    + json.dumps(payload, ensure_ascii=False, indent=2),
                }
            ],
        )
        return "".join(block.text for block in message.content if block.type == "text")
    except Exception as e:  # noqa: BLE001 - специально широкий catch для демо-надёжности
        fallback = _fallback_explanation(payload)
        return f"{fallback}\n\n[Примечание: обращение к AI API не удалось ({e}), показано офлайн-объяснение]"
