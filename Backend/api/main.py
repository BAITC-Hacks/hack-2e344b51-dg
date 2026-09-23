"""FastAPI backend для симулятора «Аким на 5 часов».

POST /api/simulate — единственный смысловой эндпоинт: принимает 5 решений,
валидирует, считает Score детерминированным движком, получает AI-объяснение,
отдаёт всё одним ответом.
"""
from dataclasses import asdict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from Backend.engine.data_loader import load_districts, load_activities, load_rules
from Backend.engine.validator import Decision, validate
from Backend.engine.calculator import compute
from Backend.ai.explainer import explain_scenario

app = FastAPI(title="Аким на 5 часов — API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class DecisionIn(BaseModel):
    activity_id: str
    district_id: str | None = None


class SimulateRequest(BaseModel):
    decisions: list[DecisionIn]


@app.get("/api/districts")
def get_districts():
    return load_districts()


@app.get("/api/activities")
def get_activities():
    return load_activities()


@app.get("/api/rules")
def get_rules():
    return load_rules()


@app.get("/api/base-score")
def get_base_score():
    result = compute([])
    return asdict(result)


@app.post("/api/simulate")
def simulate(request: SimulateRequest):
    decisions = [Decision(d.activity_id, d.district_id) for d in request.decisions]

    validation = validate(decisions)
    if not validation.ok:
        raise HTTPException(status_code=422, detail=validation.reason)

    result = compute(validation.normalized_decisions)
    base = compute([])

    payload = asdict(result)
    payload["base_score"] = base.score

    explanation = explain_scenario(payload)
    payload["explanation"] = explanation

    return payload


@app.get("/api/health")
def health():
    return {"status": "ok"}
