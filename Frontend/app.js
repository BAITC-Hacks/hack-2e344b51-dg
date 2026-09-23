const API_BASE = window.API_BASE || "http://localhost:8000";

const state = {
  activities: [],
  districts: [],
  directionIndicators: {},
  directionLabels: {},
  selected: new Map(),
  scenarios: [],
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

  state.activities.forEach((activity) => {
    const card = document.createElement("div");
    card.className = "activity-card";
    card.dataset.id = activity.id;

    const effectsStr = Object.entries(activity.effects)
      .map(([key, value]) => `${key} ${value > 0 ? "+" : ""}${value}`)
      .join(", ");

    card.innerHTML = `
      <div class="activity-direction">${directionLabel(activity.direction)}</div>
      <div class="activity-name">${activity.name}</div>
      <div class="activity-effects">Эффект: ${effectsStr}</div>
      <div class="activity-meta">
        <span>💰 ${activity.cost}</span>
        <span>⏳ лаг ${activity.lag} кв.</span>
        <span>${activity.type === "city" ? "🏙️ город" : "📍 район"}</span>
      </div>
      ${activity.type === "district" ? districtSelectHTML(activity.id) : ""}
    `;

    card.addEventListener("click", (event) => {
      if (event.target.tagName === "SELECT") return;
      toggleActivity(activity.id);
    });

    grid.appendChild(card);
  });
}

function districtSelectHTML(activityId) {
  const options = state.districts
    .map((district) => `<option value="${district.id}">${district.name}</option>`)
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
  const activity = state.activities.find((item) => item.id === id);

  if (state.selected.has(id)) {
    state.selected.delete(id);
  } else {
    if (state.selected.size >= 5) {
      showValidation("Уже выбрано 5 решений — сначала уберите одно, чтобы выбрать другое.");
      return;
    }

    const sameDirectionCount = [...state.selected.keys()].filter((activityId) => {
      const selectedActivity = state.activities.find((item) => item.id === activityId);
      return selectedActivity.direction === activity.direction;
    }).length;

    if (sameDirectionCount >= 2) {
      showValidation(
        `Не более 2 мер из направления «${directionLabel(activity.direction)}» — выберите мероприятие из другого направления.`
      );
      return;
    }

    // Сохраняем район, если пользователь выбрал его до выбора карточки.
    const districtSelect = document.querySelector(
      `.district-select[data-activity="${id}"]`
    );

    state.selected.set(id, {
      district_id: districtSelect?.value || null,
    });
  }

  showValidation("");
  syncCardStates();
  updateBudgetUI();
}

function syncCardStates() {
  document.querySelectorAll(".activity-card").forEach((card) => {
    card.classList.toggle("selected", state.selected.has(card.dataset.id));
  });
}

function updateBudgetUI() {
  const total = [...state.selected.keys()].reduce((sum, id) => {
    const activity = state.activities.find((item) => item.id === id);
    return sum + activity.cost;
  }, 0);

  const overBudget = total > 100;

  el("budget-label").textContent = `Бюджет: ${total} / 100`;
  el("decisions-label").textContent = `Решений: ${state.selected.size} / 5`;

  const fill = el("budget-fill");
  fill.style.width = `${Math.min(100, total)}%`;
  fill.classList.toggle("over", overBudget);

  const allDistrictsChosen = [...state.selected.entries()].every(([id, value]) => {
    const activity = state.activities.find((item) => item.id === id);
    return activity.type !== "district" || Boolean(value.district_id);
  });

  el("submit-btn").disabled = !(
    state.selected.size === 5 &&
    !overBudget &&
    allDistrictsChosen
  );

  if (overBudget) {
    showValidation(`Превышен бюджет: ${total} / 100. Уберите одно из решений.`);
  } else if (state.selected.size === 5 && !allDistrictsChosen) {
    showValidation("Для всех районных мероприятий нужно выбрать район.");
  } else if (state.selected.size < 5) {
    showValidation("");
  }
}

function showValidation(message) {
  el("validation-message").textContent = message;
}

document.addEventListener("change", (event) => {
  if (!event.target.classList.contains("district-select")) return;

  const activityId = event.target.dataset.activity;
  const districtId = event.target.value || null;

  if (state.selected.has(activityId)) {
    state.selected.set(activityId, { district_id: districtId });
  }

  const district = state.districts.find((item) => item.id === districtId);
  const hint = document.querySelector(`[data-hint-for="${activityId}"]`);

  if (hint) {
    hint.textContent = district ? district.profile : "";
  }

  updateBudgetUI();
});

el("submit-btn").addEventListener("click", submitScenario);

el("restart-btn").addEventListener("click", () => {
  // Сбрасываем текущий выбор, но оставляем историю для сравнения сценариев.
  state.selected.clear();

  document.querySelectorAll(".district-select").forEach((select) => {
    select.value = "";
  });

  document.querySelectorAll(".district-profile-hint").forEach((hint) => {
    hint.textContent = "";
  });

  el("result-screen").classList.add("hidden");
  el("setup-screen").classList.remove("hidden");

  syncCardStates();
  updateBudgetUI();
});

async function submitScenario() {
  const decisions = [...state.selected.entries()].map(([activity_id, value]) => ({
    activity_id,
    district_id: value.district_id,
  }));

  el("submit-btn").disabled = true;
  el("submit-btn").textContent = "Считаем…";

  try {
    const response = await fetch(`${API_BASE}/api/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisions }),
    });

    if (!response.ok) {
      const error = await response.json();
      showValidation(error.detail || "Сценарий невалиден");
      return;
    }

    const result = await response.json();
    renderResult(result, decisions);
  } catch (error) {
    showValidation(
      `Ошибка соединения с backend: ${error}. Убедитесь, что API запущен на ${API_BASE}.`
    );
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
  deltaEl.className = `score-delta ${delta >= 0 ? "positive" : "negative"}`;

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
        .map((synergy) => `<div>${synergy.pair.join(" + ")} → ${synergy.bonus_indicator} +${synergy.bonus_value}</div>`)
        .join("")
    : "<div>Синергии не сработали — ни одна пара совместимых мер не выбрана вместе.</div>";

  const criticalEl = el("critical-list");
  criticalEl.innerHTML = result.critical_pairs.length
    ? result.critical_pairs
        .map((item) => `<div>${item.district} — ${item.indicator}: ${item.value}</div>`)
        .join("")
    : "<div>Критических значений (&lt;40) не осталось 🎉</div>";

  state.scenarios.push({
    label: `Сценарий ${state.scenarios.length + 1}`,
    score: result.score,
    cost: result.total_cost,
    decisions: decisions.map((decision) => decision.activity_id).join(", "),
  });

  renderCompareTable();
}

function renderRadarGrid(result) {
  const grid = el("radar-grid");
  grid.innerHTML = "";

  const directions = Object.keys(state.directionIndicators);

  result.districts.forEach((district) => {
    const before = directions.map((direction) =>
      avgForDirection(district.before, direction)
    );
    const after = directions.map((direction) =>
      avgForDirection(district.after, direction)
    );

    const card = document.createElement("div");
    card.className = "radar-card";
    card.innerHTML = `
      ${radarSVG(directions, before, after)}
      <h4>${district.name}</h4>
      <div class="d-values">D: ${district.d_before.toFixed(1)} → ${district.d_after.toFixed(1)}</div>
    `;

    grid.appendChild(card);
  });
}

function avgForDirection(indicators, direction) {
  const keys = state.directionIndicators[direction];
  const sum = keys.reduce((total, key) => total + indicators[key], 0);
  return sum / keys.length;
}

function radarSVG(labels, before, after) {
  const size = 180;
  const center = size / 2;
  const maxRadius = size / 2 - 22;
  const count = labels.length;

  const pointFor = (value, index) => {
    const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
    const radius = (value / 100) * maxRadius;
    return [
      center + radius * Math.cos(angle),
      center + radius * Math.sin(angle),
    ];
  };

  const polygon = (values, opacity, color) => {
    const points = values
      .map((value, index) => pointFor(value, index).join(","))
      .join(" ");

    return `<polygon points="${points}" fill="${color}" fill-opacity="${opacity}" stroke="${color}" stroke-width="1.5" />`;
  };

  const axisLines = labels
    .map((_, index) => {
      const [x, y] = pointFor(100, index);
      return `<line x1="${center}" y1="${center}" x2="${x}" y2="${y}" stroke="#2b3b4a" stroke-width="1" />`;
    })
    .join("");

  const labelEls = labels
    .map((direction, index) => {
      const [x, y] = pointFor(112, index);
      return `<text x="${x}" y="${y}" font-size="8" fill="#93a4b3" text-anchor="middle">${shortDirLabel(direction)}</text>`;
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

function shortDirLabel(direction) {
  const labels = {
    transport: "Трансп.",
    ecology: "Экол.",
    social: "Соцсфера",
    safety: "Безоп.",
    services: "Сервис",
  };

  return labels[direction] || direction;
}

function renderCompareTable() {
  const container = el("compare-table");

  if (state.scenarios.length === 0) {
    container.innerHTML = "";
    return;
  }

  const rows = state.scenarios
    .map(
      (scenario) => `
        <tr>
          <td>${scenario.label}</td>
          <td>${scenario.score}</td>
          <td>${scenario.cost}</td>
          <td>${scenario.decisions}</td>
        </tr>
      `
    )
    .join("");

  container.innerHTML = `
    <table>
      <thead>
        <tr><th>Сценарий</th><th>Score</th><th>Стоимость</th><th>Решения</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

loadData().catch((error) => {
  showValidation(
    `Не удалось загрузить данные с backend (${API_BASE}). Проверьте, что сервер запущен.`
  );
  console.error(error);
});
loadData().catch((e) => {
  showValidation(`Не удалось загрузить данные с backend (${API_BASE}). Проверьте, что сервер запущен.`);
  console.error(e);
});
