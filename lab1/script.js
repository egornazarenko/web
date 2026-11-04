"use strict";
 
/*Конфигурация вариантов значений полей формы */
const Y_VALUES = ["-3", "-2", "-1", "0", "1", "2", "3", "4", "5"];
const R_VALUES = ["1", "1.5", "2", "2.5", "3"];
const X_MIN = -5;
const X_MAX = 5;
 
const STORAGE_KEY = "area-task-results";
 
/* Состояние выбранных кнопочных полей*/
const selectedY = new Set();   // можно выбрать несколько Y
const selectedR = new Set();   // можно выбрать несколько R
let displayedR = R_VALUES[0];  // R, для которого сейчас нарисована область
 
/* Проверка попадания точки (x, y) в область варианта при заданном R.
   Область - объединение трёх частей:
     1)квадрат:           -R <= x <= 0,  0 <= y <= R
     2)треугольник:        0 <= x <= R,  0 <= y <= R/2 - x/2
     3)четверть круга:     x <= 0, y <= 0,  x^2 + y^2 <= (R/2)^2*/
function isPointInArea(xStr, yStr, rStr) {
  // Все значения приходят СТРОКАМИ и переводятся в точные дроби на BigInt
  const x = toFraction(xStr);
  const y = toFraction(yStr);
  const r = toFraction(rStr);
  const zero = toFraction("0");
  const negR = fMul(r, toFraction("-1"));
  const halfR = fDivByInt(r, 2);
 
  const inSquare = fGte(x, negR) && fLte(x, zero) && fGte(y, zero) && fLte(y, r);
 
  const lineY = fSub(halfR, fDivByInt(x, 2)); // R/2 - x/2
  const inTriangle = fGte(x, zero) && fLte(x, r) && fGte(y, zero) && fLte(y, lineY);
 
  const sumSquares = fAdd(fMul(x, x), fMul(y, y));
  const inQuarterCircle = fLte(x, zero) && fLte(y, zero) && fLte(sumSquares, fMul(halfR, halfR));
 
  return inSquare || inTriangle || inQuarterCircle;
}
 
/*Точная арифметика на BigInt: число хранится как дробь {num, den},
   где den всегда положительный (10^k или произведение таких)*/
function toFraction(decimalStr) {
  let s = decimalStr;
  let sign = 1n;
  if (s.startsWith("-")) {
    sign = -1n;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  const parts = s.split(".");
  const intPart = parts[0] || "0";
  const fracPart = parts[1] || "";
  return {
    num: sign * BigInt(intPart + fracPart),
    den: 10n ** BigInt(fracPart.length),
  };
}
 
function fAdd(a, b) {
  return { num: a.num * b.den + b.num * a.den, den: a.den * b.den };
}
 
function fSub(a, b) {
  return { num: a.num * b.den - b.num * a.den, den: a.den * b.den };
}
 
function fMul(a, b) {
  return { num: a.num * b.num, den: a.den * b.den };
}
 
function fDivByInt(a, n) {
  return { num: a.num, den: a.den * BigInt(n) };
}
 
function fCompare(a, b) {
  const left = a.num * b.den;
  const right = b.num * a.den;
  return left < right ? -1 : left > right ? 1 : 0;
}
 
function fLte(a, b) {
  return fCompare(a, b) <= 0;
}
 
function fGte(a, b) {
  return fCompare(a, b) >= 0;
}
 
/*Построение кнопочных групп для Y и R*/
function buildButtonGroup(containerId, values, onSelect) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  values.forEach((val) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "opt-btn";
    btn.dataset.value = val;
    btn.textContent = val;
    btn.addEventListener("click", () => {
      const nowActive = btn.classList.toggle("active"); // клик включает/выключает кнопку
      onSelect(val, nowActive);
    });
    container.appendChild(btn);
  });
}
 
/*Валидация поля X*/
function validateX() {
  const input = document.getElementById("x-input");
  const errorEl = document.getElementById("x-error");
  const raw = input.value.trim().replace(",", ".");
 
  if (raw === "") {
    input.setCustomValidity("Поле обязательно для заполнения");
    errorEl.textContent = "Введите значение X";
    return null;
  }
 
  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    input.setCustomValidity("Некорректный формат числа");
    errorEl.textContent = "X должен быть числом";
    return null;
  }
 
  const xFrac = toFraction(raw);
  if (fCompare(xFrac, toFraction(String(X_MIN))) < 0 ||
      fCompare(xFrac, toFraction(String(X_MAX))) > 0) {
    input.setCustomValidity("Вне диапазона");
    errorEl.textContent = `X должен быть в диапазоне от ${X_MIN} до ${X_MAX}`;
    return null;
  }
 
  input.setCustomValidity("");
  errorEl.textContent = "";
  return raw; // возвращаем точную строку, а не округлённое число
}
 
/*Отрисовка координатной плоскости и области на Canvas*/
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
 
  // Заливка области (квадрат + треугольник + четверть круга)
  ctx.fillStyle = "rgba(64, 143, 222, 0.75)";
 
  // Квадрат: [-r, 0] x [0, r]
  ctx.beginPath();
  ctx.moveTo(toX(-r), toY(0));
  ctx.lineTo(toX(-r), toY(r));
  ctx.lineTo(toX(0), toY(r));
  ctx.lineTo(toX(0), toY(0));
  ctx.closePath();
  ctx.fill();
 
  // Треугольник: (0,0) (0, r/2) (r, 0)
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(0));
  ctx.lineTo(toX(0), toY(r / 2));
  ctx.lineTo(toX(r), toY(0));
  ctx.closePath();
  ctx.fill();
 
  // Четверть круга радиуса r/2 в третьей четверти (x<=0, y<=0)
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(0));
  ctx.arc(toX(0), toY(0), (r / 2) * scale, Math.PI / 2, Math.PI, false);
  ctx.closePath();
  ctx.fill();
 
  // Оси координат
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
 
  // Стрелки осей
  drawArrow(ctx, w - margin + 10, cy, "right");
  drawArrow(ctx, cx, margin - 10, "up");
 
  ctx.fillText("X", w - margin + 14, cy - 6);
  ctx.fillText("Y", cx + 8, margin - 14);
 
  // Метки на осях
  const ticks = [-r, -r / 2, r / 2, r];
  ticks.forEach((t) => {
    const labelX = t === -r ? "-R" : t === -r / 2 ? "-R/2" : t === r / 2 ? "R/2" : "R";
    const labelY = t === -r ? "-R" : t === -r / 2 ? "-R/2" : t === r / 2 ? "R/2" : "R";
 
    ctx.beginPath();
    ctx.moveTo(toX(t), cy - 4);
    ctx.lineTo(toX(t), cy + 4);
    ctx.stroke();
    ctx.fillText(labelX, toX(t) - 10, cy + 18);
 
    ctx.beginPath();
    ctx.moveTo(cx - 4, toY(t));
    ctx.lineTo(cx + 4, toY(t));
    ctx.stroke();
    ctx.fillText(labelY, cx + 8, toY(t) + 4);
  });
 
  // Точка, если передана
  (points || []).forEach((point) => {
    ctx.beginPath();
    ctx.arc(toX(point.x), toY(point.y), 5, 0, Math.PI * 2);
    ctx.fillStyle = point.hit ? "#1c7a3e" : "#c0392b";
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
 
/* Хранилище результатов (LocalStorage). Время хранится как абсолютная
   метка (timestamp в мс), а форматируется под текущий часовой пояс
   устройства в момент отображения — при смене часового пояса и
   перезагрузке страницы время пересчитается корректно.*/
function loadResults() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}
 
function saveResults(results) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(results));
}
 
function formatTimestamp(ts) {
  return new Date(ts).toLocaleString("ru-RU", {
    dateStyle: "long",
    timeStyle: "medium",
  });
}
 
function renderResults() {
  const results = loadResults();
  const tbody = document.getElementById("results-body");
  tbody.innerHTML = "";
 
  if (results.length === 0) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    row.innerHTML = '<td colspan="6">Пока нет ни одной проверки</td>';
    tbody.appendChild(row);
    return;
  }
 
  results.forEach((rec, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${rec.x}</td>
      <td>${rec.y}</td>
      <td>${rec.r}</td>
      <td class="${rec.hit ? "hit-yes" : "hit-no"}">${rec.hit ? "Попадание" : "Не попадание"}</td>
      <td>${formatTimestamp(rec.timestamp)}</td>
    `;
    tbody.appendChild(row);
  });
}
 
/*Инициализация страницы*/
function init() {
  buildButtonGroup("y-group", Y_VALUES, (val, active) => {
    if (active) selectedY.add(val); else selectedY.delete(val);
    document.getElementById("y-error").textContent = "";
  });
 
  buildButtonGroup("r-group", R_VALUES, (val, active) => {
    if (active) {
      selectedR.add(val);
      displayedR = val; // область рисуем для последнего выбранного R
    } else {
      selectedR.delete(val);
      if (displayedR === val) {
        // если сняли выбор с отображаемого R - показываем другой выбранный
        displayedR = R_VALUES.find((v) => selectedR.has(v)) || val;
      }
    }
    document.getElementById("r-error").textContent = "";
    drawArea(parseFloat(displayedR));
  });
 
  // Значение R по умолчанию - чтобы область была видна сразу
  selectedR.add(R_VALUES[0]);
  document.querySelector('#r-group .opt-btn[data-value="' + R_VALUES[0] + '"]').classList.add("active");
  drawArea(parseFloat(displayedR));
 
  const xInput = document.getElementById("x-input");
  xInput.addEventListener("input", validateX);
 
  document.getElementById("check-form").addEventListener("submit", (event) => {
    event.preventDefault();
 
    const xValue = validateX();
 
    let hasError = false;
    if (xValue === null) hasError = true;
 
    if (selectedY.size === 0) {
      document.getElementById("y-error").textContent = "Выберите хотя бы одно значение Y";
      hasError = true;
    }
    if (selectedR.size === 0) {
      document.getElementById("r-error").textContent = "Выберите хотя бы одно значение R";
      hasError = true;
    }
 
    if (hasError) return;
 
    // Берём выбранные значения в порядке, заданном в списках
    const ys = Y_VALUES.filter((v) => selectedY.has(v));
    const rs = R_VALUES.filter((v) => selectedR.has(v));
 
    const results = loadResults();
    const now = Date.now();
    const drawn = [];
 
    // Каждая комбинация (Y, R) - отдельная проверка и отдельная строка таблицы
    rs.forEach((rVal) => {
      ys.forEach((yVal) => {
        const hit = isPointInArea(xValue, yVal, rVal); // точная проверка (BigInt)
        results.push({ x: xValue, y: yVal, r: rVal, hit: hit, timestamp: now });
        // На canvas рисуем только точки для R, который сейчас показан
        if (rVal === displayedR) {
          drawn.push({ x: parseFloat(xValue), y: parseFloat(yVal), hit: hit });
        }
      });
    });
 
    saveResults(results);
    renderResults();
    drawArea(parseFloat(displayedR), drawn);
  });
 
  document.getElementById("clear-btn").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    renderResults();
  });
 
  renderResults();
}
 
document.addEventListener("DOMContentLoaded", init);
 