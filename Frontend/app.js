const API_BASE = window.API_BASE || "http://localhost:8000";

const state = {
  activities: [],
  districts: [],
  directionIndicators: {},
  directionLabels: {},
  selected: new Map(), // activity_id -> { district_id }
  scenarios: [], // история рассчитанных сценариев для сравнения
};

const el = (id) => document.getElementById(id);

async function loadData() {
  const [activitiesRes, districtsRes] = await Promise.all([
    fetch(`${API_BASE}/api/activities`).then((r) => r.json()),
    fetch(`${API_BASE}/api/districts`).then((r) => r.json()),
  ]);
  state.activities = activitiesRes.activities;
  state.districts = districtsRes.districts;
  state.directionIndicators = districtsRes.direction_indicators;
  state.directionLabels = districtsRes.direction_labels;
  renderActivities();
  updateBudgetUI();
}

function directionLabel(dir) {
  const labels = {
    transport: "Транспорт",
    ecology: "Экология",
    social: "Соцсфера",
    safety: "Безопасность",
    services: "Городской сервис",
  };
  return labels[dir] || dir;
}

function renderActivities() {
  const grid = el("activities-grid");
  grid.innerHTML = "";
  state.activities.forEach((a) => {
    const card = document.createElement("div");
    card.className = "activity-card";
    card.dataset.id = a.id;

    const effectsStr = Object.entries(a.effects)
      .map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v}`)
      .join(", ");

    card.innerHTML = `
      <div class="activity-direction">${directionLabel(a.direction)}</div>
      <div class="activity-name">${a.name}</div>
      <div class="activity-effects">Эффект: ${effectsStr}</div>
      <div class="activity-meta">
        <span>💰 ${a.cost}</span>
        <span>⏳ лаг ${a.lag} кв.</span>
        <span>${a.type === "city" ? "🏙️ город" : "📍 район"}</span>
      </div>
      ${a.type === "district" ? districtSelectHTML(a.id) : ""}
    `;

    card.addEventListener("click", (ev) => {
      if (ev.target.tagName === "SELECT") return;
      toggleActivity(a.id);
    });

    grid.appendChild(card);
  });
}

function districtSelectHTML(activityId) {
  const options = state.districts
    .map((d) => `<option value="${d.id}">${d.name}</option>`)
    .join("");
  return `
    <select class="district-select" data-activity="${activityId}">
      <option value="">Выберите район…</option>
      ${options}
    </select>
    <div class="district-profile-hint" data-hint-for="${activityId}"></div>
  `;
}

function toggleActivity(id) {
  const activity = state.activities.find((a) => a.id === id);
  if (state.selected.has(id)) {
    state.selected.delete(id);
  } else {
    if (state.selected.size >= 5) {
      showValidation("Уже выбрано 5 решений — сначала уберите одно, чтобы выбрать другое.");
      return;
    }
    const sameDirectionCount = [...state.selected.keys()].filter(
      (aid) => state.activities.find((a) => a.id === aid).direction === activity.direction
    ).length;
    if (sameDirectionCount >= 2) {
      showValidation(
        `Не более 2 мер из направления «${directionLabel(activity.direction)}» — выберите мероприятие из другого направления.`
      );
      return;
    }
    state.selected.set(id, { district_id: null });
  }
  showValidation("");
  syncCardStates();
  updateBudgetUI();
}

function syncCardStates() {
  document.querySelectorAll(".activity-card").forEach((card) => {
    const id = card.dataset.id;
    card.classList.toggle("selected", state.selected.has(id));
  });
}

function updateBudgetUI() {
  const total = [...state.selected.keys()].reduce(
    (sum, id) => sum + state.activities.find((a) => a.id === id).cost,
    0
  );
  const over = total > 100;
  el("budget-label").textContent = `Бюджет: ${total} / 100`;
  el("decisions-label").textContent = `Решений: ${state.selected.size} / 5`;
  const fill = el("budget-fill");
  fill.style.width = `${Math.min(100, total)}%`;
  fill.classList.toggle("over", over);

  const allDistrictsChosen = [...state.selected.entries()].every(([id, val]) => {
    const activity = state.activities.find((a) => a.id === id);
    return activity.type !== "district" || !!val.district_id;
  });

  el("submit-btn").disabled = !(state.selected.size === 5 && !over && allDistrictsChosen);

  if (over) {
    showValidation(`Превышен бюджет: ${total} / 100. Уберите одно из решений.`);
  } else if (state.selected.size === 5 && !allDistrictsChosen) {
    showValidation("Для всех районных мероприятий нужно выбрать район.");
  } else if (state.selected.size < 5) {
    showValidation("");
  }
}

function showValidation(msg) {
  el("validation-message").textContent = msg;
}

document.addEventListener("change", (ev) => {
  if (ev.target.classList.contains("district-select")) {
    const activityId = ev.target.dataset.activity;
    const districtId = ev.target.value || null;
    if (state.selected.has(activityId)) {
      state.selected.set(activityId, { district_id: districtId });
    }
    const district = state.districts.find((d) => d.id === districtId);
    const hint = document.querySelector(`[data-hint-for="${activityId}"]`);
    if (hint) hint.textContent = district ? district.profile : "";
    updateBudgetUI();
  }
});

el("submit-btn").addEventListener("click", submitScenario);
el("restart-btn").addEventListener("click", () => {
  el("result-screen").classList.add("hidden");
  el("setup-screen").classList.remove("hidden");
});

async function submitScenario() {
  const decisions = [...state.selected.entries()].map(([activity_id, v]) => ({
    activity_id,
    district_id: v.district_id,
  }));

  el("submit-btn").disabled = true;
  el("submit-btn").textContent = "Считаем…";

  try {
    const res = await fetch(`${API_BASE}/api/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisions }),
    });
    if (!res.ok) {
      const err = await res.json();
      showValidation(err.detail || "Сценарий невалиден");
      return;
    }
    const result = await res.json();
    renderResult(result, decisions);
  } catch (e) {
    showValidation(`Ошибка соединения с backend: ${e}. Убедитесь, что API запущен на ${API_BASE}.`);
  } finally {
    el("submit-btn").disabled = false;
    el("submit-btn").textContent = "Рассчитать сценарий";
  }
}

function renderResult(result, decisions) {
  el("setup-screen").classList.add("hidden");
  el("result-screen").classList.remove("hidden");

  el("score-value").textContent = result.score;
  const delta = Math.round((result.score - result.base_score) * 100) / 100;
  const deltaEl = el("score-delta");
  deltaEl.textContent = `${delta >= 0 ? "+" : ""}${delta} к базовому сценарию (${result.base_score})`;
  deltaEl.className = "score-delta " + (delta >= 0 ? "positive" : "negative");

  el("score-breakdown").innerHTML = `
    <div><span>Городской компонент (0.7 × D_avg)</span><span class="value">${result.score_breakdown.city_component.toFixed(2)}</span></div>
    <div><span>Компонент слабейшего района (0.3 × min D_d)</span><span class="value">${result.score_breakdown.weakest_component.toFixed(2)}</span></div>
    <div><span>Штраф за критические значения</span><span class="value">−${result.score_breakdown.penalty.toFixed(2)}</span></div>
    <div><span>Слабейший район</span><span class="value">${result.weakest_district_name}</span></div>
    <div><span>Стоимость сценария</span><span class="value">${result.total_cost} / ${result.budget}</span></div>
  `;

  renderRadarGrid(result);

  el("ai-explanation").textContent = result.explanation;

  const synergiesEl = el("synergies-list");
  synergiesEl.innerHTML = result.triggered_synergies.length
    ? result.triggered_synergies
        .map((s) => `<div>${s.pair.join(" + ")} → ${s.bonus_indicator} +${s.bonus_value}</div>`)
        .join("")
    : `<div>Синергии не сработали — ни одна пара совместимых мер не выбрана вместе.</div>`;

  const criticalEl = el("critical-list");
  criticalEl.innerHTML = result.critical_pairs.length
    ? result.critical_pairs
        .map((c) => `<div>${c.district} — ${c.indicator}: ${c.value}</div>`)
        .join("")
    : `<div>Критических значений (&lt;40) не осталось 🎉</div>`;

  state.scenarios.push({
    label: `Сценарий ${state.scenarios.length + 1}`,
    score: result.score,
    cost: result.total_cost,
    decisions: decisions.map((d) => d.activity_id).join(", "),
  });
  renderCompareTable();
}

function renderRadarGrid(result) {
  const grid = el("radar-grid");
  grid.innerHTML = "";
  const directions = Object.keys(state.directionIndicators);

  result.districts.forEach((d) => {
    const before = directions.map((dir) => avgForDirection(d.before, dir));
    const after = directions.map((dir) => avgForDirection(d.after, dir));

    const card = document.createElement("div");
    card.className = "radar-card";
    card.innerHTML = `
      ${radarSVG(directions, before, after)}
      <h4>${d.name}</h4>
      <div class="d-values">D: ${d.d_before.toFixed(1)} → ${d.d_after.toFixed(1)}</div>
    `;
    grid.appendChild(card);
  });
}

function avgForDirection(indicators, direction) {
  const keys = state.directionIndicators[direction];
  const sum = keys.reduce((s, k) => s + indicators[k], 0);
  return sum / keys.length;
}

function radarSVG(labels, before, after) {
  const size = 180;
  const center = size / 2;
  const maxR = size / 2 - 22;
  const n = labels.length;

  const pointFor = (value, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = (value / 100) * maxR;
    return [center + r * Math.cos(angle), center + r * Math.sin(angle)];
  };

  const polygon = (values, opacity, stroke) => {
    const pts = values.map((v, i) => pointFor(v, i).join(",")).join(" ");
    return `<polygon points="${pts}" fill="${stroke}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="1.5" />`;
  };

  const axisLines = labels
    .map((_, i) => {
      const [x, y] = pointFor(100, i);
      return `<line x1="${center}" y1="${center}" x2="${x}" y2="${y}" stroke="#2b3b4a" stroke-width="1" />`;
    })
    .join("");

  const labelEls = labels
    .map((dir, i) => {
      const [x, y] = pointFor(112, i);
      return `<text x="${x}" y="${y}" font-size="8" fill="#93a4b3" text-anchor="middle">${shortDirLabel(dir)}</text>`;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${size} ${size}" width="100%" height="140">
      ${axisLines}
      ${polygon(before, 0.12, "#93a4b3")}
      ${polygon(after, 0.28, "#34c9a3")}
      ${labelEls}
    </svg>
  `;
}

function shortDirLabel(dir) {
  const map = { transport: "Трансп.", ecology: "Экол.", social: "Соцсфера", safety: "Безоп.", services: "Сервис" };
  return map[dir] || dir;
}

function renderCompareTable() {
  const container = el("compare-table");
  if (state.scenarios.length === 0) {
    container.innerHTML = "";
    return;
  }
  const rows = state.scenarios
    .map((s) => `<tr><td>${s.label}</td><td>${s.score}</td><td>${s.cost}</td><td>${s.decisions}</td></tr>`)
    .join("");
  container.innerHTML = `
    <table>
      <thead><tr><th>Сценарий</th><th>Score</th><th>Стоимость</th><th>Решения</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

loadData().catch((e) => {
  showValidation(`Не удалось загрузить данные с backend (${API_BASE}). Проверьте, что сервер запущен.`);
  console.error(e);
});
