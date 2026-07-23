// ---------------------------------------------------------------------------
// Конфигурация категорий: срок годности (в днях) и иконки
// ---------------------------------------------------------------------------
const CATEGORIES = {
  meat:    { label: "Мясо",       days: 3,   icon: "beef",      color: "#B5651D" },
  fish:    { label: "Рыба",       days: 2,   icon: "fish",      color: "#3D6E8C" },
  dairy:   { label: "Молочка",    days: 5,   icon: "milk",      color: "#E8DCC4" },
  veg:     { label: "Овощи",      days: 7,   icon: "carrot",    color: "#6E9075" },
  fruit:   { label: "Фрукты",     days: 14,  icon: "apple",     color: "#BC4B34" },
  bakery:  { label: "Выпечка",    days: 4,   icon: "croissant", color: "#C89355" },
  eggs:    { label: "Яйца",       days: 21,  icon: "egg",       color: "#D8A468" },
  frozen:  { label: "Заморозка",  days: 60,  icon: "snowflake", color: "#5A7D9A" },
  grains:  { label: "Бакалея",    days: 180, icon: "wheat",     color: "#A6672C" },
  other:   { label: "Другое",     days: 10,  icon: "package",   color: "#7A7267" }
};

const STORAGE_KEY = "smart-fridge-products";
const FAMILY_KEY = "smart-fridge-family-sync";
const FAVORITES_KEY = "smart-fridge-favorite-recipes";

const FAMILY_MEMBERS = [
  { name: "Вы", initials: "ВЫ" },
  { name: "Алия", initials: "АЛ" },
  { name: "Дана", initials: "ДА" }
];

// ---------------------------------------------------------------------------
// Утилиты безопасности DOM
// ---------------------------------------------------------------------------
function safeAddListener(id, event, handler) {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener(event, handler);
  } else {
    console.warn(`[DOM Safe] Элемент #${id} не найден.`);
  }
}

// ---------------------------------------------------------------------------
// Глобальное состояние
// ---------------------------------------------------------------------------
const BACKEND_ENABLED = typeof SUPABASE_CONFIG !== "undefined"
  && SUPABASE_CONFIG.url && SUPABASE_CONFIG.url.startsWith("http")
  && SUPABASE_CONFIG.anonKey && SUPABASE_CONFIG.anonKey.length > 20;

let sb = null;
let householdCode = null;
let memberName = null;
let currentUser = null;
let productsChannel = null;
let presenceChannelRef = null;
let authTab = "login";
let currentTab = "create";
let products = [];
let lastAddedId = null;

function uuid() {
  if (window.crypto && crypto.randomUUID && window.isSecureContext) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ---------------------------------------------------------------------------
// Хранилище (Local Demo)
// ---------------------------------------------------------------------------
function loadProducts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore corrupted storage */ }
  return seedProducts();
}

function saveProducts() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
  } catch (e) {
    console.error("Ошибка сохранения в localStorage:", e);
  }
}

function seedProducts() {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  return [
    { id: uuid(), name: "Курица (грудка)", category: "meat", addedAt: now - 2 * day },
    { id: uuid(), name: "Молоко", category: "dairy", addedAt: now - 4 * day },
    { id: uuid(), name: "Яблоки", category: "fruit", addedAt: now - 1 * day },
    { id: uuid(), name: "Морковь", category: "veg", addedAt: now - 6 * day },
    { id: uuid(), name: "Творог", category: "dairy", addedAt: now - 1 * day },
    { id: uuid(), name: "Яйца", category: "eggs", addedAt: now - 10 * day }
  ];
}

// ---------------------------------------------------------------------------
// Tilt-card эффект
// ---------------------------------------------------------------------------
function attachTiltEffect(el, maxTilt = 7) {
  if (!el) return;
  const glare = document.createElement("div");
  glare.className = "tilt-glare";
  el.classList.add("tilt-card");
  el.appendChild(glare);

  function handleMove(clientX, clientY) {
    const rect = el.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width;
    const py = (clientY - rect.top) / rect.height;
    const rotateY = (px - 0.5) * maxTilt * 2;
    const rotateX = (0.5 - py) * maxTilt * 2;
    el.style.transform = `perspective(700px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.015,1.015,1.015)`;
    glare.style.setProperty("--glare-x", `${px * 100}%`);
    glare.style.setProperty("--glare-y", `${py * 100}%`);
  }

  function reset() {
    el.classList.remove("tilt-active");
    el.style.transform = "";
  }

  el.addEventListener("mouseenter", () => el.classList.add("tilt-active"));
  el.addEventListener("mousemove", (e) => handleMove(e.clientX, e.clientY));
  el.addEventListener("mouseleave", reset);
  el.addEventListener("touchstart", (e) => {
    el.classList.add("tilt-active");
    const t = e.touches[0];
    if (t) handleMove(t.clientX, t.clientY);
  }, { passive: true });
  el.addEventListener("touchmove", (e) => {
    const t = e.touches[0];
    if (t) handleMove(t.clientX, t.clientY);
  }, { passive: true });
  el.addEventListener("touchend", reset);
}

// ---------------------------------------------------------------------------
// Расчёт свежести
// ---------------------------------------------------------------------------
function getExpiry(product) {
  const cat = CATEGORIES[product.category] || CATEGORIES.other;
  const expiresAt = product.addedAt + cat.days * 24 * 60 * 60 * 1000;
  const msLeft = expiresAt - Date.now();
  const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
  let status;
  if (daysLeft <= 1) status = "red";
  else if (daysLeft <= 3) status = "yellow";
  else status = "green";
  return { daysLeft, status };
}

const STATUS_META = {
  red:    { label: "Съесть срочно", ring: "#BC4B34", chip: "bg-[#BC4B34]/15 text-[#8f3623]", pulse: true },
  yellow: { label: "Срок подходит", ring: "#D6A24C", chip: "bg-[#D6A24C]/20 text-[#8a6520]", pulse: false },
  green:  { label: "Свежий",        ring: "#059669", chip: "bg-[#059669]/15 text-[#065f46]", pulse: false }
};

function formatQty(quantity, unit) {
  const n = Number(quantity) || 1;
  const rounded = Math.round(n * 10) / 10;
  return `${rounded} ${unit || "шт"}`;
}

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Операции с продуктами
// ---------------------------------------------------------------------------
async function addProduct(name, category, quantity = 1, unit = "шт") {
  if (BACKEND_ENABLED && householdCode) {
    const { data, error } = await sb.from("products").insert({
      household_code: householdCode,
      name,
      category,
      quantity,
      unit,
      added_at: Date.now(),
      added_by: memberName
    }).select().single();
    if (error) {
      console.error(error);
      alert("Не удалось добавить продукт. Проверьте подключение к базе данных.");
      return;
    }
    if (data && !products.find(p => p.id === data.id)) {
      products.push({ id: data.id, name: data.name, category: data.category, quantity: Number(data.quantity) || 1, unit: data.unit || "шт", addedAt: Number(data.added_at), addedBy: data.added_by });
      lastAddedId = data.id;
      render();
      triggerFamilySyncPulse();
    }
  } else {
    const id = uuid();
    products.push({ id, name, category, quantity, unit, addedAt: Date.now() });
    lastAddedId = id;
    saveProducts();
    render();
    triggerFamilySyncPulse();
  }
}

async function removeProduct(id) {
  if (BACKEND_ENABLED && householdCode) {
    const { error } = await sb.from("products").delete().eq("id", id);
    if (error) {
      console.error(error);
      alert("Не удалось удалить продукт. Проверьте подключение.");
      return;
    }
    products = products.filter(p => p.id !== id);
    render();
  } else {
    products = products.filter(p => p.id !== id);
    saveProducts();
    render();
  }
}

// ---------------------------------------------------------------------------
// Рендеринг интерфейса
// ---------------------------------------------------------------------------
function render() {
  renderStats();
  renderGrid();
  if (window.lucide) lucide.createIcons();
  checkExpiryNotifications();
}

function renderStats() {
  const counts = { red: 0, yellow: 0, green: 0 };
  products.forEach(p => counts[getExpiry(p).status]++);
  
  const elRed = document.getElementById("stat-red");
  const elYellow = document.getElementById("stat-yellow");
  const elGreen = document.getElementById("stat-green");

  if (elRed) elRed.textContent = counts.red;
  if (elYellow) elYellow.textContent = counts.yellow;
  if (elGreen) elGreen.textContent = counts.green;
}

function renderGrid() {
  const fridgeGrid = document.getElementById("fridge-grid");
  const emptyState = document.getElementById("empty-state");
  if (!fridgeGrid) return;

  const sorted = [...products].sort((a, b) => getExpiry(a).daysLeft - getExpiry(b).daysLeft);
  fridgeGrid.innerHTML = "";
  if (emptyState) emptyState.classList.toggle("hidden", sorted.length > 0);

  const justAddedId = lastAddedId;
  lastAddedId = null;

  sorted.forEach((product, index) => {
    const cat = CATEGORIES[product.category] || CATEGORIES.other;
    const { daysLeft, status } = getExpiry(product);
    const meta = STATUS_META[status];

    const card = document.createElement("div");
    card.className = "group relative flex items-stretch bg-white/80 rounded-2xl shadow-sm border border-bone-dark overflow-hidden hover:bg-bone-dark/70 hover:border-navy/25 hover:shadow-lg transition-all duration-200 list-item-in";
    card.style.animationDelay = `${Math.min(index, 8) * 40}ms`;
    if (product.id === justAddedId) card.classList.add("list-item-fresh");

    const dayLabel = daysLeft < 0
      ? `Просрочен на ${Math.abs(daysLeft)} дн.`
      : daysLeft === 0
        ? "Съесть сегодня"
        : `${daysLeft} дн. осталось`;

    const qtyLabel = formatQty(product.quantity, product.unit);

    card.innerHTML = `
      <div class="w-2.5 shrink-0 status-strip${meta.pulse ? " status-strip-urgent" : ""}" style="--status-color:${meta.ring}"></div>
      <div class="flex-1 flex items-center gap-3 p-3.5">
        <div class="relative w-12 h-12 shrink-0 rounded-xl flex items-center justify-center" style="background:${cat.color}22">
          <i data-lucide="${cat.icon}" class="w-6 h-6" style="color:${cat.color}"></i>
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-display font-semibold text-navy truncate">${escapeHtml(product.name)}</p>
          <p class="text-xs text-navy/50">${cat.label} · ${qtyLabel}${product.addedBy ? ` · добавил(а) ${escapeHtml(product.addedBy)}` : ""}</p>
        </div>
        <div class="text-right shrink-0">
          <span class="inline-block text-[11px] font-mono font-semibold px-2 py-1 rounded-full ${meta.chip}">${dayLabel}</span>
          <button data-id="${product.id}" class="delete-btn block ml-auto mt-1.5 text-navy/30 hover:text-terracotta transition-colors">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
      </div>
    `;
    fridgeGrid.appendChild(card);
    attachTiltEffect(card, 5);
  });

  document.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", () => removeProduct(btn.dataset.id));
  });
}

// ---------------------------------------------------------------------------
// Инициализация форм
// ---------------------------------------------------------------------------
function populateCategorySelect() {
  const categorySelect = document.getElementById("product-category");
  if (categorySelect) {
    fillCategoryOptions(categorySelect);
    updateShelfLifeHint();
  }
}

function fillCategoryOptions(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = Object.entries(CATEGORIES)
    .map(([key, c]) => `<option value="${key}">${c.label}</option>`)
    .join("");
}

function updateShelfLifeHint() {
  const categorySelect = document.getElementById("product-category");
  const shelfLifeHint = document.getElementById("shelf-life-hint");
  if (!categorySelect || !shelfLifeHint) return;
  const cat = CATEGORIES[categorySelect.value] || CATEGORIES.other;
  shelfLifeHint.textContent = `Срок годности рассчитается автоматически: ~${cat.days} дн.`;
}

safeAddListener("product-category", "change", updateShelfLifeHint);

safeAddListener("add-form", "submit", (e) => {
  e.preventDefault();
  const nameInput = document.getElementById("product-name");
  const categorySelect = document.getElementById("product-category");
  const qtyInput = document.getElementById("product-qty");
  const unitSelect = document.getElementById("product-unit");

  if (!nameInput) return;
  const name = nameInput.value.trim();
  if (!name) return;

  const quantity = parseFloat(qtyInput ? qtyInput.value : "1") || 1;
  const category = categorySelect ? categorySelect.value : "other";
  const unit = unitSelect ? unitSelect.value : "шт";

  addProduct(name, category, quantity, unit);
  nameInput.value = "";
  if (qtyInput) qtyInput.value = "1";
  nameInput.focus();
});

// ---------------------------------------------------------------------------
// Регулярные покупки
// ---------------------------------------------------------------------------
const REGULARS_KEY = "smart-fridge-regulars";

function loadRegulars() {
  try { return JSON.parse(localStorage.getItem(REGULARS_KEY)) || []; }
  catch (e) { return []; }
}

function saveRegulars(list) {
  try { localStorage.setItem(REGULARS_KEY, JSON.stringify(list)); } catch (e) {}
}

function renderRegulars() {
  const regularList = document.getElementById("regular-list");
  const regularEmpty = document.getElementById("regular-empty");
  if (!regularList) return;

  const list = loadRegulars();
  if (regularEmpty) regularEmpty.classList.toggle("hidden", list.length > 0);

  regularList.innerHTML = list.map(item => {
    const cat = CATEGORIES[item.category] || CATEGORIES.other;
    return `
      <div class="flex items-center gap-3 bg-bone/60 border border-bone-dark rounded-xl px-3 py-2.5">
        <div class="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center" style="background:${cat.color}22">
          <i data-lucide="${cat.icon}" class="w-4.5 h-4.5" style="color:${cat.color}"></i>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-navy truncate">${escapeHtml(item.name)}</p>
          <p class="text-xs text-navy/45">${cat.label}</p>
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
    btn.addEventListener("click", () => {
      const item = loadRegulars().find(r => r.id === btn.dataset.id);
      if (item) addProduct(item.name, item.category, 1, "шт");
    });
  });
  regularList.querySelectorAll(".regular-remove-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      saveRegulars(loadRegulars().filter(r => r.id !== btn.dataset.id));
      renderRegulars();
    });
  });
}

const regCatSelect = document.getElementById("regular-category");
if (regCatSelect) fillCategoryOptions(regCatSelect);

safeAddListener("regular-form", "submit", (e) => {
  e.preventDefault();
  const nameInput = document.getElementById("regular-name");
  const catSelect = document.getElementById("regular-category");
  if (!nameInput) return;
  const name = nameInput.value.trim();
  if (!name) return;
  const list = loadRegulars();
  list.push({ id: uuid(), name, category: catSelect ? catSelect.value : "other" });
  saveRegulars(list);
  nameInput.value = "";
  renderRegulars();
});

renderRegulars();

// ---------------------------------------------------------------------------
// Локальный режим семейного доступа
// ---------------------------------------------------------------------------
function loadFamilySync() {
  return localStorage.getItem(FAMILY_KEY) !== "off";
}

function renderFamilyState() {
  const familyToggle = document.getElementById("family-toggle");
  const familyStatusText = document.getElementById("family-status-text");
  if (!familyToggle) return;

  const on = loadFamilySync();
  familyToggle.setAttribute("aria-checked", String(on));
  familyToggle.classList.toggle("bg-cognac", on);
  familyToggle.classList.toggle("bg-navy/15", !on);
  const dot = familyToggle.querySelector("span");
  if (dot) {
    dot.classList.toggle("translate-x-5", on);
    dot.classList.toggle("translate-x-0.5", !on);
  }
  if (familyStatusText) {
    familyStatusText.textContent = on
      ? "Включено — изменения видят все члены семьи"
      : "Выключено — холодильник виден только вам";
  }
}

safeAddListener("family-toggle", "click", () => {
  const on = loadFamilySync();
  localStorage.setItem(FAMILY_KEY, on ? "off" : "on");
  renderFamilyState();
});

function triggerFamilySyncPulse() {
  const familySyncPulse = document.getElementById("family-sync-pulse");
  if (BACKEND_ENABLED || !loadFamilySync() || !familySyncPulse) return;
  familySyncPulse.classList.remove("hidden");
  familySyncPulse.classList.add("animate-ping-once");
  setTimeout(() => {
    familySyncPulse.classList.add("hidden");
    familySyncPulse.classList.remove("animate-ping-once");
  }, 900);
}

// ---------------------------------------------------------------------------
// Уведомления
// ---------------------------------------------------------------------------
const NOTIFY_PREF_KEY = "smart-fridge-notify-enabled";
const NOTIFIED_LOG_KEY = "smart-fridge-notified-today";

function isNotifyEnabled() {
  return localStorage.getItem(NOTIFY_PREF_KEY) === "on"
    && typeof Notification !== "undefined" && Notification.permission === "granted";
}

function renderNotifyToggle() {
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

  const urgent = products.filter(p => {
    const { daysLeft, status } = getExpiry(p);
    return status === "red" && daysLeft >= 0 && !notifiedToday.ids.includes(p.id);
  });
  if (urgent.length === 0) return;

  const body = urgent.length === 1
    ? `${urgent[0].name} скоро испортится — самое время его съесть.`
    : `${urgent.length} продукта(ов) скоро испортятся: ${urgent.slice(0, 3).map(p => p.name).join(", ")}${urgent.length > 3 ? "…" : ""}`;
  new Notification("Умный холодильник", { body, icon: "https://api.iconify.design/lucide/refrigerator.svg" });

  notifiedToday.ids.push(...urgent.map(p => p.id));
  localStorage.setItem(NOTIFIED_LOG_KEY, JSON.stringify(notifiedToday));
}

renderNotifyToggle();
setInterval(checkExpiryNotifications, 15 * 60 * 1000);

function renderFamilyMembers() {
  const wrap = document.getElementById("family-members");
  if (!wrap) return;
  wrap.innerHTML = FAMILY_MEMBERS.map((m, i) => `
    <div class="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-semibold text-bone border-2 border-bone shadow-sm"
         style="background:${i === 0 ? "#14213D" : "#A6672C"}; margin-left:${i === 0 ? 0 : "-10px"}">
      ${m.initials}
    </div>
  `).join("");
}

// ---------------------------------------------------------------------------
// Supabase Бэкенд и Синхронизация
// ---------------------------------------------------------------------------
function showModeBanner(state) {
  const el = document.getElementById("mode-banner");
  if (!el) return;
  el.classList.remove("hidden");
  if (state === "demo") {
    el.textContent = "Демо-режим: данные хранятся в браузере. Для синхронизации настройте Supabase.";
    el.className = "text-xs sm:text-sm px-4 py-2.5 text-center font-medium bg-amber/20 text-[#8a6520]";
  } else if (state === "connecting") {
    el.textContent = "Подключение к семейному холодильнику…";
    el.className = "text-xs sm:text-sm px-4 py-2.5 text-center font-medium bg-navy/10 text-navy/70";
  } else if (state === "connected") {
    el.classList.add("hidden");
  } else if (state === "error") {
    el.textContent = "Не удалось подключиться к базе данных. Проверьте SUPABASE_CONFIG в config.js.";
    el.className = "text-xs sm:text-sm px-4 py-2.5 text-center font-medium bg-terracotta/15 text-terracotta";
  }
}

function generateHouseholdCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function currentRedirectUrl() {
  return window.location.origin + window.location.pathname;
}

async function signUpWithPassword(email, password) {
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { emailRedirectTo: currentRedirectUrl() }
  });
  if (error) throw error;
  return data;
}

async function signInWithPassword(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signInWithGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: currentRedirectUrl() }
  });
  if (error) throw error;
}

async function requestPasswordReset(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: currentRedirectUrl()
  });
  if (error) throw error;
}

async function setNewPassword(password) {
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw error;
}

async function signOutAccount() {
  await sb.auth.signOut();
}

async function fetchProductsFromBackend() {
  const { data, error } = await sb
    .from("products")
    .select("*")
    .eq("household_code", householdCode)
    .order("added_at", { ascending: true });
  if (error) throw error;
  products = data.map(row => ({
    id: row.id, name: row.name, category: row.category,
    quantity: Number(row.quantity) || 1, unit: row.unit || "шт",
    addedAt: Number(row.added_at), addedBy: row.added_by
  }));
}

async function subscribeToProductChanges() {
  if (productsChannel) {
    await sb.removeChannel(productsChannel);
    productsChannel = null;
  }
  productsChannel = sb.channel(`products-changes-${householdCode}`)
    .on("postgres_changes", {
      event: "*", schema: "public", table: "products",
      filter: `household_code=eq.${householdCode}`
    }, (payload) => {
      if (payload.eventType === "INSERT") {
        const row = payload.new;
        if (!products.find(p => p.id === row.id)) {
          products.push({ id: row.id, name: row.name, category: row.category, quantity: Number(row.quantity) || 1, unit: row.unit || "шт", addedAt: Number(row.added_at), addedBy: row.added_by });
        }
      } else if (payload.eventType === "DELETE") {
        products = products.filter(p => p.id !== payload.old.id);
      } else if (payload.eventType === "UPDATE") {
        const row = payload.new;
        const idx = products.findIndex(p => p.id === row.id);
        if (idx >= 0) products[idx] = { id: row.id, name: row.name, category: row.category, quantity: Number(row.quantity) || 1, unit: row.unit || "шт", addedAt: Number(row.added_at), addedBy: row.added_by };
      }
      render();
    });

  productsChannel.subscribe();
}

async function subscribeToPresence() {
  if (presenceChannelRef) {
    await sb.removeChannel(presenceChannelRef);
    presenceChannelRef = null;
  }
  const memberId = currentUser ? currentUser.id : uuid();
  const presenceChannel = sb.channel(`presence-${householdCode}`, {
    config: { presence: { key: memberId } }
  });

  presenceChannel.on("presence", { event: "sync" }, () => {
    renderPresence(presenceChannel.presenceState());
  });

  presenceChannelRef = presenceChannel;

  presenceChannel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await presenceChannel.track({ name: memberName, joinedAt: Date.now() });
    }
  });
}

function renderPresence(state) {
  const names = Object.values(state).map(arr => arr[0] && arr[0].name).filter(Boolean);
  const presenceList = document.getElementById("presence-list");
  if (presenceList) {
    presenceList.innerHTML = names.map(n => `
      <span class="text-[11px] px-2.5 py-1 rounded-full bg-sage/15 text-sage font-medium flex items-center gap-1">
        <span class="w-1.5 h-1.5 rounded-full bg-sage"></span>${escapeHtml(n)}
      </span>
    `).join("") || `<span class="text-[11px] text-navy/35">Пока никого нет онлайн</span>`;
  }

  const headerAvatars = document.getElementById("family-members");
  if (headerAvatars) {
    headerAvatars.innerHTML = names.slice(0, 4).map((n, i) => `
      <div class="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-semibold text-bone border-2 border-bone shadow-sm"
           style="background:${i % 2 === 0 ? "#14213D" : "#A6672C"}; margin-left:${i === 0 ? 0 : "-8px"}">
        ${escapeHtml(n.slice(0, 2).toUpperCase())}
      </div>
    `).join("");
  }
}

async function enterHousehold(code, name) {
  householdCode = code.toUpperCase().trim();
  memberName = name.trim();

  const onboardingEl = document.getElementById("onboarding");
  const codeDisplay = document.getElementById("household-code-display");
  const subtitleEl = document.getElementById("household-subtitle");

  if (onboardingEl) onboardingEl.classList.add("hidden");
  if (codeDisplay) codeDisplay.textContent = householdCode;
  if (subtitleEl) subtitleEl.textContent = `Семья: ${householdCode}`;

  showModeBanner("connecting");
  try {
    await fetchProductsFromBackend();
    await subscribeToProductChanges();
    await subscribeToPresence();
    showModeBanner("connected");
  } catch (err) {
    console.error(err);
    showModeBanner("error");
  }
  render();
}

function setTab(tab) {
  currentTab = tab;
  const createBtn = document.getElementById("tab-create");
  const joinBtn = document.getElementById("tab-join");
  const joinField = document.getElementById("join-code-field");
  const submitLabel = document.getElementById("onboarding-submit-label");

  if (createBtn && joinBtn) {
    createBtn.classList.toggle("bg-white", tab === "create");
    createBtn.classList.toggle("shadow-sm", tab === "create");
    createBtn.classList.toggle("text-navy", tab === "create");
    createBtn.classList.toggle("text-navy/50", tab !== "create");

    joinBtn.classList.toggle("bg-white", tab === "join");
    joinBtn.classList.toggle("shadow-sm", tab === "join");
    joinBtn.classList.toggle("text-navy", tab === "join");
    joinBtn.classList.toggle("text-navy/50", tab !== "join");
  }

  if (joinField) joinField.classList.toggle("hidden", tab !== "join");
  if (submitLabel) submitLabel.textContent = tab === "create" ? "Создать и войти" : "Присоединиться";
}

function initBackendOnboarding() {
  safeAddListener("tab-create", "click", () => setTab("create"));
  safeAddListener("tab-join", "click", () => setTab("join"));
  
  safeAddListener("leave-household-btn", "click", async () => {
    if (!currentUser || !confirm("Покинуть текущую семью? Доступ к её холодильнику пропадёт.")) return;
    const { error } = await sb.from("household_members").delete().eq("user_id", currentUser.id);
    if (error) {
      console.error(error);
      alert("Не удалось покинуть семью. Попробуйте ещё раз.");
      return;
    }
    location.reload();
  });

  safeAddListener("copy-code-btn", "click", () => {
    if (!householdCode) return;
    navigator.clipboard.writeText(householdCode).catch(() => {});
    const icon = document.getElementById("copy-code-btn");
    if (icon) {
      icon.classList.add("text-sage");
      setTimeout(() => icon.classList.remove("text-sage"), 1000);
    }
  });

  safeAddListener("onboarding-form", "submit", async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("member-name-input");
    const errorEl = document.getElementById("onboarding-error");
    if (errorEl) errorEl.classList.add("hidden");
    if (!nameInput) return;

    const name = nameInput.value.trim();
    if (!name) return;

    const submitBtn = e.target.querySelector("button[type=submit]");
    if (submitBtn && submitBtn.disabled) return;
    if (submitBtn) submitBtn.disabled = true;

    try {
      if (currentTab === "create") {
        const code = generateHouseholdCode();
        const { error } = await sb.rpc("create_household", { p_code: code, p_display_name: name });
        if (error) throw error;
        await enterHousehold(code, name);
      } else {
        const joinInput = document.getElementById("join-code-input");
        const codeInput = joinInput ? joinInput.value.trim().toUpperCase() : "";
        if (!codeInput) {
          if (errorEl) {
            errorEl.textContent = "Введите код семьи";
            errorEl.classList.remove("hidden");
          }
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        const { data: joined, error } = await sb.rpc("join_household", { p_code: codeInput, p_display_name: name });
        if (error) throw error;
        if (!joined) {
          if (errorEl) {
            errorEl.textContent = "Семья с таким кодом не найдена.";
            errorEl.classList.remove("hidden");
          }
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        await enterHousehold(codeInput, name);
      }
    } catch (err) {
      console.error(err);
      if (errorEl) {
        errorEl.textContent = "Не удалось подключиться. Проверьте ключи Supabase.";
        errorEl.classList.remove("hidden");
      }
    }
    if (submitBtn) submitBtn.disabled = false;
  });
}

// ---------------------------------------------------------------------------
// Избранные рецепты
// ---------------------------------------------------------------------------
function loadFavoriteRecipes() {
  try { return JSON.parse(localStorage.getItem(FAVORITES_KEY)) || []; }
  catch (e) { return []; }
}

function saveFavoriteRecipes(list) {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(list)); } catch (e) {}
}

function isFavoriteRecipe(id) {
  return loadFavoriteRecipes().some(r => String(r.id) === String(id));
}

function toggleFavoriteRecipe(recipe) {
  const list = loadFavoriteRecipes();
  const idx = list.findIndex(r => String(r.id) === String(recipe.id));
  if (idx >= 0) list.splice(idx, 1);
  else list.push(recipe);
  saveFavoriteRecipes(list);
  return idx < 0;
}

function favoriteBtnHtml(id, filled) {
  return `
    <button type="button" class="fav-btn shrink-0 p-1.5 -m-1.5 rounded-full transition-colors ${filled ? "is-fav text-terracotta" : "text-navy/25 hover:text-terracotta/70"}" data-fav-id="${id}" title="В избранное">
      <i data-lucide="heart" class="w-4.5 h-4.5" ${filled ? 'fill="currentColor"' : ""}></i>
    </button>`;
}

function renderFavoritesPage() {
  const list = loadFavoriteRecipes();
  const wrap = document.getElementById("favorites-list");
  const emptyEl = document.getElementById("favorites-empty");
  if (!wrap) return;

  if (emptyEl) emptyEl.classList.toggle("hidden", list.length > 0);

  wrap.innerHTML = list.map(r => `
    <div class="border border-bone-dark rounded-2xl p-4 bg-white/70">
      <div class="flex items-start gap-3">
        ${r.image ? `<img src="${escapeHtml(r.image)}" alt="" class="w-14 h-14 rounded-xl object-cover shrink-0 bg-bone-dark">` : ""}
        <div class="flex-1 min-w-0">
          <h3 class="font-display font-semibold text-navy leading-snug">${escapeHtml(r.title)}</h3>
          ${r.time ? `<p class="text-xs text-navy/50 mt-1 flex items-center gap-1"><i data-lucide="clock" class="w-3.5 h-3.5"></i>${escapeHtml(r.time)}${r.difficulty ? ` · ${escapeHtml(r.difficulty)}` : ""}</p>` : ""}
        </div>
        ${favoriteBtnHtml(r.id, true)}
      </div>
      ${r.steps && r.steps.length ? `
        <ol class="mt-3 space-y-1.5 text-sm text-navy/70 list-decimal list-inside">
          ${r.steps.map(s => `<li>${escapeHtml(s)}</li>`).join("")}
        </ol>` : (r.sourceUrl ? `<a href="${escapeHtml(r.sourceUrl)}" target="_blank" rel="noopener" class="inline-block mt-3 text-xs text-cognac-dark hover:underline">Открыть оригинал рецепта →</a>` : "")}
    </div>
  `).join("");
  if (window.lucide) lucide.createIcons();

  wrap.querySelectorAll(".fav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      toggleFavoriteRecipe({ id: btn.dataset.favId });
      renderFavoritesPage();
    });
  });
}

// ---------------------------------------------------------------------------
// Навигация
// ---------------------------------------------------------------------------
function showPage(name) {
  ["home", "favorites", "profile"].forEach(p => {
    const el = document.getElementById(`page-${p}`);
    if (el) el.classList.toggle("hidden", p !== name);
  });
  document.querySelectorAll(".nav-button").forEach(btn => {
    if (btn.dataset.page === name) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  if (name === "favorites") renderFavoritesPage();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".nav-button").forEach(btn => {
  btn.addEventListener("click", () => showPage(btn.dataset.page));
});

// ---------------------------------------------------------------------------
// «Что приготовить?»
// ---------------------------------------------------------------------------
safeAddListener("cook-btn", "click", async () => {
  openModal();
  const priority = products.filter(p => ["red", "yellow"].includes(getExpiry(p).status));

  if (priority.length === 0) {
    showRecipeSourceNote("");
    renderRecipes([]);
    return;
  }

  if (BACKEND_ENABLED && sb && currentUser) {
    renderRecipesLoading();
    try {
      const { data, error } = await sb.functions.invoke("recipes", {
        body: { action: "search", ingredients: priority.map(p => p.name) }
      });
      if (error) throw error;
      if (data && data.recipes && data.recipes.length > 0) {
        showRecipeSourceNote("База рецептов: Spoonacular");
        renderApiRecipes(data.recipes);
        return;
      }
    } catch (err) {
      console.warn("Spoonacular недоступен, показываем локальную подборку:", err.message);
    }
  }

  showRecipeSourceNote("");
  const withStatus = products.map(p => ({ name: p.name, status: getExpiry(p).status }));
  renderRecipes(matchRecipes(withStatus));
});

function showRecipeSourceNote(text) {
  const noteEl = document.getElementById("recipe-source-note");
  if (noteEl) noteEl.textContent = text;
}

function renderRecipesLoading() {
  const recipeResults = document.getElementById("recipe-results");
  if (!recipeResults) return;
  recipeResults.innerHTML = `
    <div class="text-center py-12">
      <i data-lucide="loader-2" class="w-7 h-7 mx-auto text-cognac animate-spin"></i>
      <p class="text-sm text-navy/40 mt-3">Подбираем рецепты из базы Spoonacular…</p>
    </div>`;
  if (window.lucide) lucide.createIcons();
}

function renderApiRecipes(recipes) {
  const recipeResults = document.getElementById("recipe-results");
  if (!recipeResults) return;

  recipeResults.innerHTML = recipes.map(r => `
    <div class="border border-bone-dark rounded-2xl overflow-hidden bg-bone/60" data-recipe-id="${r.id}">
      <div class="flex gap-3 p-4">
        ${r.image ? `<img src="${escapeHtml(r.image)}" alt="" class="w-16 h-16 rounded-xl object-cover shrink-0 bg-bone-dark">` : ""}
        <div class="flex-1 min-w-0">
          <h3 class="font-display font-semibold text-base text-navy leading-snug">${escapeHtml(r.title)}</h3>
          <div class="flex flex-wrap gap-1.5 mt-2">
            ${(r.usedIngredients || []).map(m => `<span class="text-[11px] px-2 py-0.5 rounded-full bg-sage/15 text-sage font-medium">${escapeHtml(m)}</span>`).join("")}
            ${(r.missedIngredients || []).slice(0, 3).map(m => `<span class="text-[11px] px-2 py-0.5 rounded-full bg-navy/10 text-navy/50 font-medium">+ ${escapeHtml(m)}</span>`).join("")}
          </div>
        </div>
        ${favoriteBtnHtml(r.id, isFavoriteRecipe(r.id))}
      </div>
      <button class="recipe-expand-btn w-full text-xs font-medium text-cognac-dark border-t border-bone-dark py-2.5 hover:bg-bone-dark/30 transition-colors" data-id="${r.id}">
        Показать рецепт
      </button>
      <div class="recipe-steps hidden px-4 pb-4"></div>
    </div>
  `).join("");
  if (window.lucide) lucide.createIcons();

  document.querySelectorAll(".recipe-expand-btn").forEach(btn => {
    btn.addEventListener("click", () => toggleRecipeSteps(btn));
  });

  recipeResults.querySelectorAll(".fav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const r = recipes.find(x => String(x.id) === btn.dataset.favId);
      if (!r) return;
      const added = toggleFavoriteRecipe({ id: r.id, title: r.title, image: r.image, source: "api" });
      btn.classList.toggle("is-fav", added);
      btn.classList.toggle("text-terracotta", added);
      btn.classList.toggle("text-navy/25", !added);
      const svg = btn.querySelector("svg");
      if (svg) svg.setAttribute("fill", added ? "currentColor" : "none");
    });
  });
}

async function toggleRecipeSteps(btn) {
  const card = btn.closest("[data-recipe-id]");
  if (!card) return;
  const stepsEl = card.querySelector(".recipe-steps");
  if (!stepsEl) return;

  if (!stepsEl.classList.contains("hidden")) {
    stepsEl.classList.add("hidden");
    btn.textContent = "Показать рецепт";
    return;
  }
  if (stepsEl.dataset.loaded) {
    stepsEl.classList.remove("hidden");
    btn.textContent = "Скрыть рецепт";
    return;
  }

  btn.textContent = "Загрузка…";
  btn.disabled = true;
  try {
    const { data, error } = await sb.functions.invoke("recipes", {
      body: { action: "details", id: btn.dataset.id }
    });
    if (error) throw error;

    stepsEl.innerHTML = `
      <div class="flex items-center gap-3 text-xs text-navy/50 mb-2">
        ${data.readyInMinutes ? `<span class="flex items-center gap-1"><i data-lucide="clock" class="w-3.5 h-3.5"></i>${data.readyInMinutes} мин</span>` : ""}
        ${data.servings ? `<span class="flex items-center gap-1"><i data-lucide="users" class="w-3.5 h-3.5"></i>${data.servings} порц.</span>` : ""}
      </div>
      ${nutritionBadgesHtml(data.nutrition)}
      ${data.steps && data.steps.length
        ? `<ol class="space-y-1.5 text-sm text-navy/70 list-decimal list-inside">${data.steps.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ol>`
        : `<p class="text-sm text-navy/50">Подробные шаги не указаны автором рецепта.</p>`}
      ${data.sourceUrl ? `<a href="${escapeHtml(data.sourceUrl)}" target="_blank" rel="noopener" class="inline-block mt-3 text-xs text-cognac-dark hover:underline">Открыть оригинал рецепта →</a>` : ""}
    `;
    stepsEl.dataset.loaded = "1";
    stepsEl.classList.remove("hidden");
    btn.textContent = "Скрыть рецепт";
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error(err);
    stepsEl.innerHTML = `<p class="text-sm text-terracotta">Не удалось загрузить шаги рецепта.</p>`;
    stepsEl.classList.remove("hidden");
    btn.textContent = "Скрыть рецепт";
  }
  btn.disabled = false;
}

function nutritionBadgesHtml(nutrition) {
  if (!nutrition) return "";
  const { calories, protein, fat, carbs } = nutrition;
  const item = (label, value, unit) => value == null ? "" : `
    <span class="text-[11px] px-2 py-1 rounded-lg bg-navy/5 text-navy/60 font-mono whitespace-nowrap">${label} ${Math.round(value)}${unit}</span>`;
  return `
    <div class="flex flex-wrap gap-1.5 mt-2" title="Ориентировочно, на порцию">
      ${item("Ккал", calories, "")}
      ${item("Б", protein, "г")}
      ${item("Ж", fat, "г")}
      ${item("У", carbs, "г")}
    </div>`;
}

function renderRecipes(matches) {
  const recipeResults = document.getElementById("recipe-results");
  if (!recipeResults) return;

  if (matches.length === 0) {
    recipeResults.innerHTML = `
      <div class="text-center py-10 px-4">
        <i data-lucide="chef-hat" class="w-10 h-10 mx-auto text-navy/30 mb-3"></i>
        <p class="text-navy/60 font-medium">Пока нечего готовить впопыхах</p>
        <p class="text-sm text-navy/40 mt-1">Как только продукты пожелтеют или покраснеют, здесь появятся рецепты.</p>
      </div>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  recipeResults.innerHTML = matches.map(({ recipe, matched, score }) => `
    <div class="border border-bone-dark rounded-2xl p-4 bg-bone/60">
      <div class="flex items-start justify-between gap-3">
        <h3 class="font-display font-semibold text-lg text-navy">${escapeHtml(recipe.title)}</h3>
        <div class="flex items-center gap-1.5 shrink-0">
          <span class="text-[11px] font-mono px-2 py-1 rounded-full bg-cognac/15 text-cognac-dark whitespace-nowrap">${score} балл${score === 1 ? "" : "а"}</span>
          ${favoriteBtnHtml(recipe.id, isFavoriteRecipe(recipe.id))}
        </div>
      </div>
      <div class="flex items-center gap-3 mt-1.5 text-xs text-navy/50">
        <span class="flex items-center gap-1"><i data-lucide="clock" class="w-3.5 h-3.5"></i>${recipe.time}</span>
        <span class="flex items-center gap-1"><i data-lucide="gauge" class="w-3.5 h-3.5"></i>${recipe.difficulty}</span>
        ${recipe.servings ? `<span class="flex items-center gap-1"><i data-lucide="users" class="w-3.5 h-3.5"></i>${recipe.servings} порц.</span>` : ""}
      </div>
      ${nutritionBadgesHtml(recipe.nutrition)}
      <div class="flex flex-wrap gap-1.5 mt-3">
        ${matched.map(m => `<span class="text-[11px] px-2 py-0.5 rounded-full bg-terracotta/10 text-terracotta font-medium">${escapeHtml(m)}</span>`).join("")}
      </div>
      <ol class="mt-3 space-y-1.5 text-sm text-navy/70 list-decimal list-inside">
        ${recipe.steps.map(s => `<li>${escapeHtml(s)}</li>`).join("")}
      </ol>
    </div>
  `).join("");
  if (window.lucide) lucide.createIcons();

  recipeResults.querySelectorAll(".fav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const matchObj = matches.find(m => String(m.recipe.id) === btn.dataset.favId);
      if (!matchObj) return;
      const { recipe } = matchObj;
      const added = toggleFavoriteRecipe({ id: recipe.id, title: recipe.title, time: recipe.time, difficulty: recipe.difficulty, steps: recipe.steps, source: "local" });
      btn.classList.toggle("is-fav", added);
      btn.classList.toggle("text-terracotta", added);
      btn.classList.toggle("text-navy/25", !added);
      const svg = btn.querySelector("svg");
      if (svg) svg.setAttribute("fill", added ? "currentColor" : "none");
    });
  });
}

function openModal() {
  const recipeModal = document.getElementById("recipe-modal");
  if (!recipeModal) return;
  recipeModal.classList.remove("hidden");
  requestAnimationFrame(() => {
    const panel = recipeModal.querySelector(".modal-panel");
    if (panel) panel.classList.remove("translate-y-6", "opacity-0");
  });
  document.body.classList.add("overflow-hidden");
}

function closeModal() {
  const recipeModal = document.getElementById("recipe-modal");
  if (!recipeModal) return;
  const panel = recipeModal.querySelector(".modal-panel");
  if (panel) panel.classList.add("translate-y-6", "opacity-0");
  document.body.classList.remove("overflow-hidden");
  setTimeout(() => recipeModal.classList.add("hidden"), 200);
}

safeAddListener("recipe-modal-close", "click", closeModal);
safeAddListener("recipe-modal", "click", (e) => {
  if (e.target === document.getElementById("recipe-modal")) closeModal();
});

// ---------------------------------------------------------------------------
// Экран авторизации
// ---------------------------------------------------------------------------
function showAuthStep(step) {
  ["credentials", "forgot", "check-email", "new-password"].forEach(s => {
    const el = document.getElementById(`auth-step-${s}`);
    if (el) el.classList.toggle("hidden", s !== step);
  });
}

function setAuthTab(tab) {
  authTab = tab;
  const loginBtn = document.getElementById("auth-tab-login");
  const signupBtn = document.getElementById("auth-tab-signup");
  const pwdInput = document.getElementById("auth-password-input");
  const submitLabel = document.getElementById("auth-submit-label");
  const errorEl = document.getElementById("auth-error");
  const infoEl = document.getElementById("auth-info");

  if (loginBtn && signupBtn) {
    loginBtn.classList.toggle("bg-white", tab === "login");
    loginBtn.classList.toggle("shadow-sm", tab === "login");
    loginBtn.classList.toggle("text-navy", tab === "login");
    loginBtn.classList.toggle("text-navy/50", tab !== "login");

    signupBtn.classList.toggle("bg-white", tab === "signup");
    signupBtn.classList.toggle("shadow-sm", tab === "signup");
    signupBtn.classList.toggle("text-navy", tab === "signup");
    signupBtn.classList.toggle("text-navy/50", tab !== "signup");
  }

  if (pwdInput) pwdInput.autocomplete = tab === "login" ? "current-password" : "new-password";
  if (submitLabel) submitLabel.textContent = tab === "login" ? "Войти" : "Зарегистрироваться";
  if (errorEl) errorEl.classList.add("hidden");
  if (infoEl) infoEl.classList.add("hidden");
}

function showAuthScreen() {
  const onboardingEl = document.getElementById("onboarding");
  const accountControlEl = document.getElementById("account-control");
  const authModalEl = document.getElementById("auth-modal");

  if (onboardingEl) onboardingEl.classList.add("hidden");
  if (accountControlEl) accountControlEl.classList.add("hidden");
  showAuthStep("credentials");
  setAuthTab("login");
  if (authModalEl) authModalEl.classList.remove("hidden");
}

function hideAuthScreen() {
  const authModalEl = document.getElementById("auth-modal");
  if (authModalEl) authModalEl.classList.add("hidden");
}

function initAuthUI() {
  safeAddListener("auth-tab-login", "click", () => setAuthTab("login"));
  safeAddListener("auth-tab-signup", "click", () => setAuthTab("signup"));

  safeAddListener("auth-form", "submit", async (e) => {
    e.preventDefault();
    const emailInput = document.getElementById("auth-email-input");
    const pwdInput = document.getElementById("auth-password-input");
    const errorEl = document.getElementById("auth-error");
    const infoEl = document.getElementById("auth-info");

    if (errorEl) errorEl.classList.add("hidden");
    if (infoEl) infoEl.classList.add("hidden");
    if (!emailInput || !pwdInput) return;

    const email = emailInput.value.trim();
    const password = pwdInput.value;

    const submitBtn = e.target.querySelector("button[type=submit]");
    if (submitBtn && submitBtn.disabled) return;
    if (submitBtn) submitBtn.disabled = true;

    try {
      if (authTab === "login") {
        await signInWithPassword(email, password);
      } else {
        const data = await signUpWithPassword(email, password);
        if (!data.session) {
          const checkText = document.getElementById("check-email-text");
          if (checkText) {
            checkText.textContent = `Мы отправили письмо для подтверждения на ${email}. Перейдите по ссылке в письме.`;
          }
          showAuthStep("check-email");
        }
      }
    } catch (err) {
      console.error(err);
      if (errorEl) {
        errorEl.textContent = err.message === "Invalid login credentials"
          ? "Неверный email или пароль."
          : (err.message || "Не удалось выполнить вход.");
        errorEl.classList.remove("hidden");
      }
    }
    if (submitBtn) submitBtn.disabled = false;
  });

  safeAddListener("google-auth-btn", "click", async () => {
    try {
      await signInWithGoogle();
    } catch (err) {
      console.error(err);
      const errorEl = document.getElementById("auth-error");
      if (errorEl) {
        errorEl.textContent = "Не удалось войти через Google. Проверьте настройки провайдера в Supabase.";
        errorEl.classList.remove("hidden");
      }
    }
  });

  safeAddListener("auth-forgot-link", "click", () => showAuthStep("forgot"));
  safeAddListener("forgot-back-btn", "click", () => showAuthStep("credentials"));
  safeAddListener("check-email-back-btn", "click", () => showAuthStep("credentials"));

  safeAddListener("forgot-form", "submit", async (e) => {
    e.preventDefault();
    const emailInput = document.getElementById("forgot-email-input");
    const errorEl = document.getElementById("forgot-error");
    if (errorEl) errorEl.classList.add("hidden");
    if (!emailInput) return;

    const email = emailInput.value.trim();
    try {
      await requestPasswordReset(email);
      const checkText = document.getElementById("check-email-text");
      if (checkText) checkText.textContent = `Мы отправили ссылку для сброса пароля на ${email}.`;
      showAuthStep("check-email");
    } catch (err) {
      console.error(err);
      if (errorEl) {
        errorEl.textContent = "Не удалось отправить письмо. Проверьте email.";
        errorEl.classList.remove("hidden");
      }
    }
  });

  safeAddListener("new-password-form", "submit", async (e) => {
    e.preventDefault();
    const pwdInput = document.getElementById("new-password-input");
    const errorEl = document.getElementById("new-password-error");
    if (errorEl) errorEl.classList.add("hidden");
    if (!pwdInput) return;

    try {
      await setNewPassword(pwdInput.value);
      const { data: { session } } = await sb.auth.getSession();
      await handleAuthenticated(currentUser, session);
    } catch (err) {
      console.error(err);
      if (errorEl) {
        errorEl.textContent = "Не удалось сохранить пароль. Попробуйте ещё раз.";
        errorEl.classList.remove("hidden");
      }
    }
  });

  safeAddListener("account-logout-btn", "click", async () => {
    if (!confirm("Выйти из аккаунта?")) return;
    await signOutAccount();
  });
}

// ---------------------------------------------------------------------------
// Обработка авторизации
// ---------------------------------------------------------------------------
async function handleAuthenticated(user, session) {
  currentUser = user;
  hideAuthScreen();

  const accountControl = document.getElementById("account-control");
  const accountEmail = document.getElementById("account-email");
  const onboardingEl = document.getElementById("onboarding");

  if (accountControl) {
    accountControl.classList.remove("hidden");
    accountControl.classList.add("flex");
  }
  if (accountEmail) accountEmail.textContent = user.email || "";

  showModeBanner("connecting");
  try {
    const { data: membership, error } = await sb
      .from("household_members")
      .select("household_code, display_name")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    if (membership) {
      await enterHousehold(membership.household_code, membership.display_name || user.email.split("@")[0]);
    } else {
      const nameInput = document.getElementById("member-name-input");
      if (nameInput) nameInput.value = (user.email || "").split("@")[0];
      if (onboardingEl) onboardingEl.classList.remove("hidden");
      showModeBanner("connected");
    }
  } catch (err) {
    console.error(err);
    showModeBanner("error");
  }
}

// ---------------------------------------------------------------------------
// Старт приложения
// ---------------------------------------------------------------------------
populateCategorySelect();
if (window.lucide) lucide.createIcons();

if (BACKEND_ENABLED) {
  sb = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
  
  const localFam = document.getElementById("family-local");
  const backendFam = document.getElementById("family-backend");
  if (localFam) localFam.classList.add("hidden");
  if (backendFam) backendFam.classList.remove("hidden");

  setTab("create");
  initBackendOnboarding();
  initAuthUI();

  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      if (session) currentUser = session.user;
      const authModal = document.getElementById("auth-modal");
      if (authModal) authModal.classList.remove("hidden");
      showAuthStep("new-password");
    } else if (event === "SIGNED_IN" && session) {
      handleAuthenticated(session.user, session);
    } else if (event === "SIGNED_OUT") {
      if (productsChannel) { sb.removeChannel(productsChannel); productsChannel = null; }
      if (presenceChannelRef) { sb.removeChannel(presenceChannelRef); presenceChannelRef = null; }
      currentUser = null;
      householdCode = null;
      memberName = null;
      products = [];
      render();
      showAuthScreen();
    }
  });

  sb.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      handleAuthenticated(session.user, session);
    } else {
      showAuthScreen();
    }
  });
} else {
  showModeBanner("demo");
  products = loadProducts();
  renderFamilyMembers();
  renderFamilyState();
  render();
}