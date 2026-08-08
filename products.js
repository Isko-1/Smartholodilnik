import { state } from "./state.js";
import { CATEGORIES, STATUS_META, getExpiry, fillCategoryOptions } from "./categories.js";
import { safeAddListener, escapeHtml, formatQty, attachTiltEffect, withBusy, openSmallModal, closeSmallModal } from "./utils.js";
import { logEvent, fetchRegularIntervals } from "./history.js";
import { openRecipesFor, clearRecipeCache } from "./recipes.js";
import { openDeliveryFor } from "./delivery.js";
import confetti from "canvas-confetti";

// ---------------------------------------------------------------------------
// Операции с продуктами (только через Supabase — без демо-режима)
// ---------------------------------------------------------------------------
function mapProductRow(row) {
  return {
    id: row.id, name: row.name, category: row.category,
    quantity: Number(row.quantity) || 1, unit: row.unit || "шт",
    addedAt: Number(row.added_at), addedBy: row.added_by,
    expiryOverride: row.expiry_override ? Number(row.expiry_override) : null
  };
}

export async function addProduct(name, category, quantity = 1, unit = "шт", expiryOverride = null) {
  const { data, error } = await state.sb.from("products").insert({
    household_code: state.householdCode,
    name,
    category,
    quantity,
    unit,
    added_at: Date.now(),
    added_by: state.memberName,
    expiry_override: expiryOverride
  }).select().single();
  if (error) {
    console.error(error);
    alert("Не удалось добавить продукт. Проверьте подключение к базе данных.");
    return;
  }
  if (data && !state.products.find(p => p.id === data.id)) {
    state.products.push(mapProductRow(data));
    state.lastAddedId = data.id;
    logEvent(data.name, data.category, "added");
    clearRecipeCache();
    render();
  }
}

export async function removeProduct(id, reason = null) {
  const product = state.products.find(p => p.id === id);
  if (!product) return;

  const { error } = await state.sb.from("products").delete().eq("id", id);
  if (error) {
    console.error(error);
    alert("Не удалось удалить продукт. Проверьте подключение.");
    return;
  }
  state.products = state.products.filter(p => p.id !== id);
  await logEvent(product.name, product.category, "removed", reason);
  clearRecipeCache();
  render();
}

/**
 * Обновляет ручной срок годности продукта (expiryOverride) в Supabase.
 */
export async function updateProductExpiry(id, expiryTimestamp) {
  const product = state.products.find(p => p.id === id);
  if (!product) return;

  const { error } = await state.sb.from("products").update({ expiry_override: expiryTimestamp }).eq("id", id);
  if (error) {
    console.error(error);
    alert("Не удалось сохранить срок годности. Проверьте подключение.");
    return;
  }
  product.expiryOverride = expiryTimestamp;
  render();
}

export async function fetchProductsFromBackend() {
  const { data, error } = await state.sb
    .from("products")
    .select("*")
    .eq("household_code", state.householdCode)
    .order("added_at", { ascending: true });
  if (error) throw error;
  state.products = data.map(mapProductRow);
}

export async function subscribeToProductChanges() {
  if (state.productsChannel) {
    await state.sb.removeChannel(state.productsChannel);
    state.productsChannel = null;
  }
  state.productsChannel = state.sb.channel(`products-changes-${state.householdCode}`)
    .on("postgres_changes", {
      event: "*", schema: "public", table: "products",
      filter: `household_code=eq.${state.householdCode}`
    }, (payload) => {
      if (payload.eventType === "INSERT") {
        const row = payload.new;
        if (!state.products.find(p => p.id === row.id)) {
          state.products.push(mapProductRow(row));
          clearRecipeCache();
        }
      } else if (payload.eventType === "DELETE") {
        state.products = state.products.filter(p => p.id !== payload.old.id);
        clearRecipeCache();
      } else if (payload.eventType === "UPDATE") {
        const idx = state.products.findIndex(p => p.id === payload.new.id);
        if (idx >= 0) state.products[idx] = mapProductRow(payload.new);
      }
      render();
    });

  state.productsChannel.subscribe();
}

// ---------------------------------------------------------------------------
// Регулярные покупки — синхронизируются через Supabase (таблица `regulars`),
// как и сами продукты, поэтому видны всем членам семьи, а не только в
// браузере, где их добавили.
// ---------------------------------------------------------------------------
function mapRegularRow(row) {
  return { id: row.id, name: row.name, category: row.category };
}

export async function fetchRegularsFromBackend() {
  const { data, error } = await state.sb
    .from("regulars")
    .select("*")
    .eq("household_code", state.householdCode)
    .order("created_at", { ascending: true });
  if (error) throw error;
  state.regulars = data.map(mapRegularRow);
  // Не блокируем загрузку regulars, если интервалы не считаются —
  // это вторичная подсказка, не критичный путь загрузки.
  fetchRegularIntervals().then(intervals => {
    state.regularIntervals = intervals;
    renderRegulars();
  }).catch(err => console.error("Не удалось посчитать интервалы регуляров:", err));
}

export async function subscribeToRegularsChanges() {
  if (state.regularsChannel) {
    await state.sb.removeChannel(state.regularsChannel);
    state.regularsChannel = null;
  }
  state.regularsChannel = state.sb.channel(`regulars-changes-${state.householdCode}`)
    .on("postgres_changes", {
      event: "*", schema: "public", table: "regulars",
      filter: `household_code=eq.${state.householdCode}`
    }, (payload) => {
      if (payload.eventType === "INSERT") {
        const row = payload.new;
        if (!state.regulars.find(r => r.id === row.id)) {
          state.regulars.push(mapRegularRow(row));
        }
      } else if (payload.eventType === "DELETE") {
        state.regulars = state.regulars.filter(r => r.id !== payload.old.id);
      }
      renderRegulars();
    });

  state.regularsChannel.subscribe();
}

async function addRegular(name, category) {
  const { data, error } = await state.sb.from("regulars").insert({
    household_code: state.householdCode,
    name,
    category
  }).select().single();
  if (error) {
    console.error(error);
    alert("Не удалось добавить регулярную покупку. Проверьте подключение.");
    return;
  }
  if (data && !state.regulars.find(r => r.id === data.id)) {
    state.regulars.push(mapRegularRow(data));
    renderRegulars();
  }
}

async function removeRegular(id) {
  const { error } = await state.sb.from("regulars").delete().eq("id", id);
  if (error) {
    console.error(error);
    alert("Не удалось удалить регулярную покупку. Проверьте подключение.");
    return;
  }
  state.regulars = state.regulars.filter(r => r.id !== id);
  renderRegulars();
}

export function renderRegulars() {
  const regularList = document.getElementById("regular-list");
  const regularEmpty = document.getElementById("regular-empty");
  if (!regularList) return;

  if (regularEmpty) regularEmpty.classList.toggle("hidden", state.regulars.length > 0);

  regularList.innerHTML = state.regulars.map(item => {
    const cat = CATEGORIES[item.category] || CATEGORIES.other;
    const avgDays = state.regularIntervals[item.name.trim().toLowerCase()];
    const intervalHint = avgDays ? ` · обычно через ~${avgDays} дн.` : "";
    return `
      <div class="flex items-center gap-3 bg-bone/60 border border-bone-dark rounded-xl px-3 py-2.5">
        <div class="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center" style="background:${cat.color}22">
          <i data-lucide="${cat.icon}" class="w-4.5 h-4.5" style="color:${cat.color}"></i>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-navy truncate">${escapeHtml(item.name)}</p>
          <p class="text-xs text-navy/45">${cat.label}${intervalHint}</p>
        </div>
        <button data-id="${item.id}" class="regular-add-btn shrink-0 bg-navy/5 hover:bg-cognac hover:text-white text-navy text-xs font-medium rounded-lg px-3 py-1.5 flex items-center gap-1 transition-colors">
          <i data-lucide="plus" class="w-3.5 h-3.5"></i>В холодильник
        </button>
        <button data-id="${item.id}" class="regular-remove-btn shrink-0 text-navy/30 hover:text-terracotta transition-colors p-1">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>`;
  }).join("");
  if (window.lucide) lucide.createIcons();

  regularList.querySelectorAll(".regular-add-btn").forEach(btn => {
    btn.addEventListener("click", () => withBusy(btn, async () => {
      const item = state.regulars.find(r => r.id === btn.dataset.id);
      if (item) await addProduct(item.name, item.category, 1, "шт");
    }));
  });
  regularList.querySelectorAll(".regular-remove-btn").forEach(btn => {
    btn.addEventListener("click", () => withBusy(btn, () => removeRegular(btn.dataset.id)));
  });
}

const regCatSelect = document.getElementById("regular-category");
if (regCatSelect) fillCategoryOptions(regCatSelect);

safeAddListener("regular-form", "submit", (e) => {
  e.preventDefault();
  const nameInput = document.getElementById("regular-name");
  const catSelect = document.getElementById("regular-category");
  const submitBtn = e.target.querySelector("button[type=submit]");
  if (!nameInput) return;
  const name = nameInput.value.trim();
  if (!name) return;

  withBusy(submitBtn, async () => {
    await addRegular(name, catSelect ? catSelect.value : "other");
    nameInput.value = "";
  });
});

// ---------------------------------------------------------------------------
// Рендеринг интерфейса
// ---------------------------------------------------------------------------
export function render() {
  renderStats();
  renderGrid();
  if (window.lucide) lucide.createIcons();
  checkExpiryNotifications();
}

function renderStats() {
  // overdue — подмножество red (daysLeft ≤ 1), но считаем отдельно то, что уже
  // просрочено (daysLeft < 0), чтобы отличать от «съесть сегодня» в интерфейсе.
  const counts = { red: 0, yellow: 0, green: 0, overdue: 0 };
  state.products.forEach(p => {
    const { status, daysLeft } = getExpiry(p);
    counts[status]++;
    if (daysLeft < 0) counts.overdue++;
  });

  // Цифры и beam-подсветка кнопки теперь рендерятся React'ом (StatsTicker/CookBeam,
  // src/main.tsx) — они не знают про ванильный state, поэтому просто слушают эти события.
  window.dispatchEvent(new CustomEvent("fridge:stats", { detail: counts }));
  window.dispatchEvent(new CustomEvent("fridge:urgent", { detail: counts.red > 0 }));
}

function renderGrid() {
  const fridgeGrid = document.getElementById("fridge-grid");
  const emptyState = document.getElementById("empty-state");
  if (!fridgeGrid) return;

  const sorted = [...state.products].sort((a, b) => getExpiry(a).daysLeft - getExpiry(b).daysLeft);
  fridgeGrid.innerHTML = "";
  if (emptyState) emptyState.classList.toggle("hidden", sorted.length > 0);

  const justAddedId = state.lastAddedId;
  state.lastAddedId = null;

  sorted.forEach((product, index) => {
    const cat = CATEGORIES[product.category] || CATEGORIES.other;
    const { daysLeft, status } = getExpiry(product);
    const meta = STATUS_META[status];
    const pct = Math.max(0, Math.min(1, daysLeft / cat.days));

    const card = document.createElement("div");
    card.className = "group relative flex flex-col bg-white/80 rounded-2xl shadow-sm border border-bone-dark overflow-hidden hover:bg-bone-dark/70 hover:border-navy/25 hover:shadow-lg transition-all duration-200 list-item-in";
    card.style.animationDelay = `${Math.min(index, 8) * 40}ms`;
    if (product.id === justAddedId) card.classList.add("list-item-fresh");
    if (status === "red") card.classList.add("card-urgent-glow");

    const dayLabel = daysLeft < 0
      ? `Просрочен на ${Math.abs(daysLeft)} дн.`
      : daysLeft === 0
        ? "Съесть сегодня"
        : `${daysLeft} дн. осталось`;

    const qtyLabel = formatQty(product.quantity, product.unit);
    const needsAction = status === "red" || status === "yellow";

    card.innerHTML = `
      <div class="flex items-stretch">
        <div class="w-2.5 shrink-0 status-strip${meta.pulse ? " status-strip-urgent" : ""}" style="--status-color:${meta.ring}"></div>
        <div class="flex-1 flex items-center gap-3 p-3.5">
          <div class="relative w-12 h-12 shrink-0 freshness-ring" style="--pct:${pct};--status-color:${meta.ring}">
            <div class="w-full h-full rounded-xl flex items-center justify-center" style="background:${cat.color}22">
              <i data-lucide="${cat.icon}" class="w-6 h-6" style="color:${cat.color}"></i>
            </div>
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-display font-semibold text-navy truncate">${escapeHtml(product.name)}</p>
            <p class="text-xs text-navy/50">${cat.label} · ${qtyLabel}${product.addedBy ? ` · добавил(а) ${escapeHtml(product.addedBy)}` : ""}</p>
          </div>
          <div class="text-right shrink-0">
            <button data-id="${product.id}" class="expiry-badge-btn inline-block text-[11px] font-mono font-semibold px-2 py-1 rounded-full ${meta.chip} hover:ring-2 hover:ring-navy/10 transition-shadow" title="Изменить срок вручную">${dayLabel}</button>
            <button data-id="${product.id}" class="delete-btn block ml-auto mt-1.5 text-navy/30 hover:text-terracotta transition-colors">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </div>
      </div>
      ${needsAction ? `
        <div class="flex gap-2 px-3.5 pb-3.5 -mt-0.5">
          <button data-id="${product.id}" class="cook-for-product-btn btn-lift flex-1 bg-terracotta/12 hover:bg-terracotta/20 text-terracotta text-xs font-semibold rounded-xl px-3 py-2 flex items-center justify-center gap-1.5 transition-colors">
            <i data-lucide="chef-hat" class="w-3.5 h-3.5"></i>Приготовить
          </button>
          <button data-id="${product.id}" class="order-more-btn btn-lift flex-1 bg-plum-light hover:bg-plum-light/70 text-plum-dark text-xs font-semibold rounded-xl px-3 py-2 flex items-center justify-center gap-1.5 transition-colors">
            <i data-lucide="truck" class="w-3.5 h-3.5"></i>Заказать ещё
          </button>
        </div>` : ""}
    `;
    fridgeGrid.appendChild(card);
    attachTiltEffect(card, 5);
  });

  document.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", () => openRemoveReasonModal(btn.dataset.id));
  });
  document.querySelectorAll(".expiry-badge-btn").forEach(btn => {
    btn.addEventListener("click", () => openExpiryEditModal(btn.dataset.id));
  });
  document.querySelectorAll(".cook-for-product-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const product = state.products.find(p => p.id === btn.dataset.id);
      if (product) openRecipesFor([product]);
    });
  });
  document.querySelectorAll(".order-more-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const product = state.products.find(p => p.id === btn.dataset.id);
      if (product) openDeliveryFor(product);
    });
  });
}

// ---------------------------------------------------------------------------
// Инициализация формы добавления продукта
// ---------------------------------------------------------------------------
export function populateCategorySelect() {
  const categorySelect = document.getElementById("product-category");
  if (categorySelect) {
    fillCategoryOptions(categorySelect);
    updateShelfLifeHint();
  }
}

function updateShelfLifeHint() {
  const categorySelect = document.getElementById("product-category");
  const shelfLifeHint = document.getElementById("shelf-life-hint");
  if (!categorySelect || !shelfLifeHint) return;
  const cat = CATEGORIES[categorySelect.value] || CATEGORIES.other;
  shelfLifeHint.textContent = `Срок годности рассчитается автоматически: ~${cat.days} дн.`;
}

safeAddListener("product-category", "change", updateShelfLifeHint);

safeAddListener("manual-expiry-toggle", "click", () => {
  const field = document.getElementById("manual-expiry-field");
  if (field) field.classList.toggle("hidden");
});

safeAddListener("add-form", "submit", (e) => {
  e.preventDefault();
  const nameInput = document.getElementById("product-name");
  const categorySelect = document.getElementById("product-category");
  const qtyInput = document.getElementById("product-qty");
  const unitSelect = document.getElementById("product-unit");
  const manualExpiryInput = document.getElementById("manual-expiry-input");
  const submitBtn = e.target.querySelector("button[type=submit]");

  if (!nameInput) return;
  const name = nameInput.value.trim();
  if (!name) return;

  const quantity = parseFloat(qtyInput ? qtyInput.value : "1") || 1;
  const category = categorySelect ? categorySelect.value : "other";
  const unit = unitSelect ? unitSelect.value : "шт";
  const expiryOverride = manualExpiryInput && manualExpiryInput.value
    ? new Date(manualExpiryInput.value + "T23:59:59").getTime()
    : null;

  withBusy(submitBtn, async () => {
    await addProduct(name, category, quantity, unit, expiryOverride);
    nameInput.value = "";
    if (qtyInput) qtyInput.value = "1";
    if (manualExpiryInput) manualExpiryInput.value = "";
    const manualField = document.getElementById("manual-expiry-field");
    if (manualField) manualField.classList.add("hidden");
    nameInput.focus();
  });
});

// ---------------------------------------------------------------------------
// Мелкие модалки: причина удаления / ручной срок
// ---------------------------------------------------------------------------
let pendingRemoveId = null;

function openRemoveReasonModal(id) {
  const product = state.products.find(p => p.id === id);
  if (!product) return;
  pendingRemoveId = id;
  const nameEl = document.getElementById("remove-reason-name");
  if (nameEl) nameEl.textContent = product.name;
  openSmallModal("remove-reason-modal");
}

safeAddListener("remove-reason-eaten", "click", (e) => withBusy(e.currentTarget, async () => {
  if (pendingRemoveId) await removeProduct(pendingRemoveId, "eaten");
  pendingRemoveId = null;
  closeSmallModal("remove-reason-modal");
}));
safeAddListener("remove-reason-discarded", "click", (e) => withBusy(e.currentTarget, async () => {
  if (pendingRemoveId) await removeProduct(pendingRemoveId, "discarded");
  pendingRemoveId = null;
  closeSmallModal("remove-reason-modal");
}));
safeAddListener("remove-reason-cancel", "click", () => {
  pendingRemoveId = null;
  closeSmallModal("remove-reason-modal");
});

let pendingExpiryId = null;

function openExpiryEditModal(id) {
  const product = state.products.find(p => p.id === id);
  if (!product) return;
  pendingExpiryId = id;
  const nameEl = document.getElementById("expiry-edit-name");
  const input = document.getElementById("expiry-edit-input");
  if (nameEl) nameEl.textContent = product.name;
  if (input) {
    const { expiresAt } = getExpiry(product);
    input.value = new Date(expiresAt).toISOString().slice(0, 10);
  }
  openSmallModal("expiry-edit-modal");
}

safeAddListener("expiry-edit-save", "click", (e) => withBusy(e.currentTarget, async () => {
  const input = document.getElementById("expiry-edit-input");
  if (pendingExpiryId && input && input.value) {
    const timestamp = new Date(input.value + "T23:59:59").getTime();
    await updateProductExpiry(pendingExpiryId, timestamp);
  }
  pendingExpiryId = null;
  closeSmallModal("expiry-edit-modal");
}));
safeAddListener("expiry-edit-cancel", "click", () => {
  pendingExpiryId = null;
  closeSmallModal("expiry-edit-modal");
});

// ---------------------------------------------------------------------------
// Уведомления об истекающих продуктах
// ---------------------------------------------------------------------------
const NOTIFY_PREF_KEY = "smart-fridge-notify-enabled";
const NOTIFIED_LOG_KEY = "smart-fridge-notified-today";

function isNotifyEnabled() {
  return localStorage.getItem(NOTIFY_PREF_KEY) === "on"
    && typeof Notification !== "undefined" && Notification.permission === "granted";
}

export function renderNotifyToggle() {
  const notifyToggle = document.getElementById("notify-toggle");
  const notifyStatusText = document.getElementById("notify-status-text");
  if (!notifyToggle) return;

  const on = isNotifyEnabled();
  notifyToggle.setAttribute("aria-checked", String(on));
  notifyToggle.classList.toggle("bg-terracotta", on);
  notifyToggle.classList.toggle("bg-navy/15", !on);
  const dot = notifyToggle.querySelector("span");
  if (dot) {
    dot.classList.toggle("translate-x-5", on);
    dot.classList.toggle("translate-x-0.5", !on);
  }

  if (notifyStatusText) {
    if (typeof Notification === "undefined") {
      notifyStatusText.textContent = "Этот браузер не поддерживает уведомления";
    } else if (Notification.permission === "denied") {
      notifyStatusText.textContent = "Уведомления заблокированы в настройках браузера";
    } else {
      notifyStatusText.textContent = on ? "Включено — проверяем каждые 15 минут" : "Напомнить, когда продукт скоро испортится";
    }
  }
}

safeAddListener("notify-toggle", "click", async () => {
  if (typeof Notification === "undefined") return;
  if (isNotifyEnabled()) {
    localStorage.setItem(NOTIFY_PREF_KEY, "off");
    renderNotifyToggle();
    return;
  }
  const permission = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission();
  if (permission === "granted") {
    localStorage.setItem(NOTIFY_PREF_KEY, "on");
    checkExpiryNotifications();
  }
  renderNotifyToggle();
});

function checkExpiryNotifications() {
  if (!isNotifyEnabled()) return;
  const today = new Date().toDateString();
  let notifiedToday = {};
  try { notifiedToday = JSON.parse(localStorage.getItem(NOTIFIED_LOG_KEY)) || {}; } catch (e) {}
  if (notifiedToday.date !== today) notifiedToday = { date: today, ids: [] };

  // Просроченные и почти просроченные (red) — самое срочное.
  const overdue = state.products.filter(p => {
    const { daysLeft, status } = getExpiry(p);
    return status === "red" && daysLeft < 0 && !notifiedToday.ids.includes(p.id);
  });
  // Ещё не просрочены, но пора съесть (red, 0-1 день).
  const urgent = state.products.filter(p => {
    const { daysLeft, status } = getExpiry(p);
    return status === "red" && daysLeft >= 0 && !notifiedToday.ids.includes(p.id);
  });
  // Скоро испортятся (yellow, 2-3 дня) — мягкое напоминание заранее.
  const upcoming = state.products.filter(p => {
    const { status } = getExpiry(p);
    return status === "yellow" && !notifiedToday.ids.includes(p.id);
  });

  const notifiedIds = [];

  if (overdue.length > 0) {
    const body = overdue.length === 1
      ? `${overdue[0].name} уже просрочен — проверьте и выбросьте, если нужно.`
      : `${overdue.length} продукта(ов) просрочены: ${overdue.slice(0, 3).map(p => p.name).join(", ")}${overdue.length > 3 ? "…" : ""}`;
    new Notification("Умный холодильник", { body, icon: "https://api.iconify.design/lucide/refrigerator.svg" });
    notifiedIds.push(...overdue.map(p => p.id));
  }

  if (urgent.length > 0) {
    const body = urgent.length === 1
      ? `${urgent[0].name} скоро испортится — самое время его съесть.`
      : `${urgent.length} продукта(ов) скоро испортятся: ${urgent.slice(0, 3).map(p => p.name).join(", ")}${urgent.length > 3 ? "…" : ""}`;
    new Notification("Умный холодильник", { body, icon: "https://api.iconify.design/lucide/refrigerator.svg" });
    notifiedIds.push(...urgent.map(p => p.id));
  }

  if (upcoming.length > 0) {
    const body = upcoming.length === 1
      ? `${upcoming[0].name} испортится через пару дней — спланируйте, что с ним сделать.`
      : `${upcoming.length} продукта(ов) испортятся через пару дней: ${upcoming.slice(0, 3).map(p => p.name).join(", ")}${upcoming.length > 3 ? "…" : ""}`;
    new Notification("Умный холодильник", { body, icon: "https://api.iconify.design/lucide/refrigerator.svg" });
    notifiedIds.push(...upcoming.map(p => p.id));
  }

  if (notifiedIds.length === 0) return;
  notifiedToday.ids.push(...notifiedIds);
  localStorage.setItem(NOTIFIED_LOG_KEY, JSON.stringify(notifiedToday));
}

export function startNotifyPolling() {
  renderNotifyToggle();
  // Проверяем сразу при открытии приложения (не ждём первого 15-минутного тика),
  // с небольшой задержкой, чтобы state.products успел загрузиться из Supabase.
  setTimeout(checkExpiryNotifications, 3000);
  setInterval(checkExpiryNotifications, 15 * 60 * 1000);
}