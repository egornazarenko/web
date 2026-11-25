"use strict";

/* ==========================================================================
   Настройки
   ========================================================================== */
const API_URL = "fcgi-bin/area.jar";        // запросы к FastCGI-серверу (через Apache)
const R_VALUES = ["1", "2", "3", "4", "5"];
const Y_MIN = "-3";
const Y_MAX = "5";

let selectedR = R_VALUES[0];
let history = [];                            // история проверок, пришедшая с сервера

/* ==========================================================================
   Точное сравнение десятичных чисел (BigInt), чтобы граница Y
   проверялась без округления double.
   ========================================================================== */
function toFraction(decimalStr) {
  let s = decimalStr;
  let sign = 1n;
  if (s.startsWith("-")) {
    sign = -1n;
    s = s.slice(1);
  }
  const parts = s.split(".");
  const fracPart = parts[1] || "";
  return { num: sign * BigInt(parts[0] + fracPart), den: 10n ** BigInt(fracPart.length) };
}

function compareDecimal(a, b) {
  const fa = toFraction(a);
  const fb = toFraction(b);
  const left = fa.num * fb.den;
  const right = fb.num * fa.den;
  return left < right ? -1 : left > right ? 1 : 0;
}

/* ==========================================================================
   Валидация на клиенте (сервер проверяет всё ещё раз)
   ========================================================================== */
function validateY() {
  const input = document.getElementById("y-input");
  const errorEl = document.getElementById("y-error");
  const raw = input.value.trim().replace(",", ".");

  if (raw === "") {
    return failY(input, errorEl, "Введите значение Y");
  }
  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    return failY(input, errorEl, "Y должен быть числом");
  }
  if (compareDecimal(raw, Y_MIN) < 0 || compareDecimal(raw, Y_MAX) > 0) {
    return failY(input, errorEl, `Y должен быть в диапазоне от ${Y_MIN} до ${Y_MAX}`);
  }

  input.setCustomValidity("");
  errorEl.textContent = "";
  return raw;
}

function failY(input, errorEl, message) {
  input.setCustomValidity(message);
  errorEl.textContent = message;
  return null;
}

/* ==========================================================================
   Кнопки R (выбирается одно значение)
   ========================================================================== */
function buildRButtons() {
  const container = document.getElementById("r-group");
  container.innerHTML = "";
  R_VALUES.forEach((val) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "opt-btn" + (val === selectedR ? " active" : "");
    btn.dataset.value = val;
    btn.textContent = val;
    btn.addEventListener("click", () => {
      container.querySelectorAll(".opt-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedR = val;
      document.getElementById("r-error").textContent = "";
      redraw();
    });
    container.appendChild(btn);
  });
}

/* ==========================================================================
   Canvas: область по варианту
   ========================================================================== */
function redraw() {
  // Рисуем только точки, проверенные с текущим R: у разных R разный масштаб области
  const points = history
    .filter((rec) => rec.r === selectedR)
    .map((rec) => ({ x: parseFloat(rec.x), y: parseFloat(rec.y), hit: rec.hit }));
  drawArea(parseFloat(selectedR), points);
}

function drawArea(r, points) {
  const canvas = document.getElementById("area-canvas");
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const margin = 40;
  const scale = (Math.min(w, h) / 2 - margin) / r;

  const toX = (x) => cx + x * scale;
  const toY = (y) => cy - y * scale;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(64, 143, 222, 0.75)";

  // I четверть: треугольник (0,0) (R,0) (0,R)
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(0));
  ctx.lineTo(toX(r), toY(0));
  ctx.lineTo(toX(0), toY(r));
  ctx.closePath();
  ctx.fill();

  // IV четверть: прямоугольник [0, R] x [-R, 0]
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(0));
  ctx.lineTo(toX(r), toY(0));
  ctx.lineTo(toX(r), toY(-r));
  ctx.lineTo(toX(0), toY(-r));
  ctx.closePath();
  ctx.fill();

  // II четверть: четверть круга радиуса R/2 (x <= 0, y >= 0)
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(0));
  ctx.arc(toX(0), toY(0), (r / 2) * scale, Math.PI, Math.PI * 1.5, false);
  ctx.closePath();
  ctx.fill();

  // Оси
  ctx.strokeStyle = "#1b2733";
  ctx.fillStyle = "#1b2733";
  ctx.lineWidth = 1.5;
  ctx.font = "12px Verdana, sans-serif";

  ctx.beginPath();
  ctx.moveTo(margin - 10, cy);
  ctx.lineTo(w - margin + 10, cy);
  ctx.moveTo(cx, h - margin + 10);
  ctx.lineTo(cx, margin - 10);
  ctx.stroke();

  drawArrow(ctx, w - margin + 10, cy, "right");
  drawArrow(ctx, cx, margin - 10, "up");
  ctx.fillText("X", w - margin + 14, cy - 6);
  ctx.fillText("Y", cx + 8, margin - 14);

  // Деления: -R, -R/2, R/2, R
  const ticks = [
    { v: -r, label: "-R" },
    { v: -r / 2, label: "-R/2" },
    { v: r / 2, label: "R/2" },
    { v: r, label: "R" },
  ];
  ticks.forEach((t) => {
    ctx.beginPath();
    ctx.moveTo(toX(t.v), cy - 4);
    ctx.lineTo(toX(t.v), cy + 4);
    ctx.stroke();
    ctx.fillText(t.label, toX(t.v) - 10, cy + 18);

    ctx.beginPath();
    ctx.moveTo(cx - 4, toY(t.v));
    ctx.lineTo(cx + 4, toY(t.v));
    ctx.stroke();
    ctx.fillText(t.label, cx + 8, toY(t.v) + 4);
  });

  // Точки
  (points || []).forEach((p) => {
    ctx.beginPath();
    ctx.arc(toX(p.x), toY(p.y), 5, 0, Math.PI * 2);
    ctx.fillStyle = p.hit ? "#1c7a3e" : "#c0392b";
    ctx.fill();
    ctx.strokeStyle = "#1b2733";
    ctx.lineWidth = 1;
    ctx.stroke();
  });
}

function drawArrow(ctx, x, y, direction) {
  ctx.beginPath();
  if (direction === "right") {
    ctx.moveTo(x, y);
    ctx.lineTo(x - 8, y - 4);
    ctx.lineTo(x - 8, y + 4);
  } else {
    ctx.moveTo(x, y);
    ctx.lineTo(x - 4, y + 8);
    ctx.lineTo(x + 4, y + 8);
  }
  ctx.closePath();
  ctx.fillStyle = "#1b2733";
  ctx.fill();
}

/* ==========================================================================
   Таблица результатов
   ========================================================================== */
// Время приходит с сервера как момент (мс с 1970 г.) и форматируется
// в русской локали в часовом поясе устройства.
function formatTimestamp(ts) {
  return new Date(ts).toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "medium" });
}

function renderTable() {
  const tbody = document.getElementById("results-body");
  tbody.innerHTML = "";

  if (history.length === 0) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.textContent = "Пока нет ни одной проверки";
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  history.forEach((rec, index) => {
    const row = document.createElement("tr");
    const cells = [
      String(index + 1),
      rec.x,
      rec.y,
      rec.r,
      rec.hit ? "Попадание" : "Не попадание",
      formatTimestamp(rec.timestamp),
      rec.execTimeMs,
    ];
    cells.forEach((text, i) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (i === 4) td.className = rec.hit ? "hit-yes" : "hit-no";
      row.appendChild(td);
    });
    tbody.appendChild(row);
  });
}

/* ==========================================================================
   AJAX: обмен с FastCGI-сервером
   ========================================================================== */
function showInfo(text, isError) {
  const box = document.getElementById("server-info");
  box.textContent = text;
  box.classList.toggle("error", Boolean(isError));
}

async function callServer(method, body) {
  const options = { method: method, headers: {} };
  if (body) {
    options.headers["Content-Type"] = "application/x-www-form-urlencoded";
    options.body = body.toString();
  }

  let response;
  try {
    response = await fetch(API_URL, options);
  } catch (e) {
    throw new Error("Не удалось связаться с сервером");
  }

  let data = null;
  try {
    data = await response.json();
  } catch (e) {
    throw new Error(`Некорректный ответ сервера (HTTP ${response.status})`);
  }

  if (!response.ok || data.status !== "ok") {
    throw new Error(data && data.message ? data.message : `Ошибка сервера (HTTP ${response.status})`);
  }
  return data;
}

function applyResponse(data) {
  history = data.history || [];
  renderTable();
  redraw();
  showInfo(
    `Ответ сервера получен: ${formatTimestamp(data.serverTime)}. ` +
    `Время работы скрипта: ${data.execTimeMs} мс.`,
    false
  );
}

async function loadHistory() {
  try {
    applyResponse(await callServer("GET"));
  } catch (e) {
    showInfo(e.message, true);
  }
}

async function submitPoint(event) {
  event.preventDefault();

  const x = document.getElementById("x-select").value;
  const y = validateY();
  if (y === null) return;

  const body = new URLSearchParams();
  body.set("x", x);
  body.set("y", y);
  body.set("r", selectedR);

  const button = document.getElementById("submit-btn");
  button.disabled = true;
  try {
    applyResponse(await callServer("POST", body));
  } catch (e) {
    showInfo(e.message, true);
  } finally {
    button.disabled = false;
  }
}

async function clearHistory() {
  const body = new URLSearchParams();
  body.set("action", "clear");
  try {
    applyResponse(await callServer("POST", body));
  } catch (e) {
    showInfo(e.message, true);
  }
}

/* ==========================================================================
   Инициализация
   ========================================================================== */
function init() {
  buildRButtons();
  redraw();
  renderTable();

  document.getElementById("y-input").addEventListener("input", validateY);
  document.getElementById("check-form").addEventListener("submit", submitPoint);
  document.getElementById("clear-btn").addEventListener("click", clearHistory);

  loadHistory(); // восстановить историю, сохранённую на сервере
}

document.addEventListener("DOMContentLoaded", init);
