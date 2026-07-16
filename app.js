// ---------------------------------------------------------------------------
// Конфигурация категорий: срок годности (в днях от даты добавления) и иконка
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

const STORAGE_KEY = "smart-fridge-products";       // локальный демо-режим
const FAMILY_KEY = "smart-fridge-family-sync";     // локальный демо-режим (переключатель)
const FAVORITES_KEY = "smart-fridge-favorite-recipes"; // избранные рецепты (обе схемы бэкенда)
// В режиме реального бэкенда семья и имя больше не хранятся в localStorage:
// принадлежность к семье определяется записью в household_members,
// привязанной к настоящему auth.uid() пользователя (email+пароль или Google),
// поэтому она одинакова на любом устройстве, где человек вошёл в аккаунт.

const FAMILY_MEMBERS = [ // только для локального демо-режима
  { name: "Вы", initials: "ВЫ" },
  { name: "Алия", initials: "АЛ" },
  { name: "Дана", initials: "ДА" }
];

// ---------------------------------------------------------------------------
// Режим работы: реальный бэкенд (Supabase), если заполнен config.js,
// иначе — локальное демо на этом устройстве (localStorage)
// ---------------------------------------------------------------------------
const BACKEND_ENABLED = typeof SUPABASE_CONFIG !== "undefined"
  && SUPABASE_CONFIG.url && SUPABASE_CONFIG.url.startsWith("http")
  && SUPABASE_CONFIG.anonKey && SUPABASE_CONFIG.anonKey.length > 20;

let sb = null;
let householdCode = null;
let memberName = null;
let currentUser = null;   // текущий авторизованный пользователь Supabase Auth
let productsChannel = null;
let presenceChannelRef = null;
let authTab = "login";    // "login" | "signup" на экране входа
let currentTab = "create";
let products = [];

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
// Локальный демо-режим: хранение в localStorage
// ---------------------------------------------------------------------------
function loadProducts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore corrupted storage */ }
  return seedProducts();
}

function saveProducts() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
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
// Tilt-card эффект: лёгкий 3D-наклон карточки под курсором/пальцем + блик.
// Vanilla-аналог TiltCard из unlumen-ui — без React и сборки. Подключается
// к любому элементу через attachTiltEffect(el).
// ---------------------------------------------------------------------------
function attachTiltEffect(el, maxTilt = 7) {
  const glare = document.createElement("div");
  glare.className = "tilt-glare";
  el.classList.add("tilt-card");
  el.appendChild(glare);

  function handleMove(clientX, clientY) {
    const rect = el.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width;   // 0..1
    const py = (clientY - rect.top) / rect.height;    // 0..1
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
  red:    { label: "Съесть срочно", ring: "#BC4B34", chip: "bg-[#BC4B34]/15 text-[#8f3623]" },
  yellow: { label: "Срок подходит", ring: "#D6A24C", chip: "bg-[#D6A24C]/20 text-[#8a6520]" },
  green:  { label: "Свежий",        ring: "#6E9075", chip: "bg-[#6E9075]/15 text-[#3f5a44]" }
};

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Добавление / удаление продуктов (единая точка входа для обоих режимов)
// ---------------------------------------------------------------------------
async function addProduct(name, category) {
  if (BACKEND_ENABLED && householdCode) {
    const { error } = await sb.from("products").insert({
      household_code: householdCode,
      name,
      category,
      added_at: Date.now(),
      added_by: memberName
    });
    if (error) {
      console.error(error);
      alert("Не удалось добавить продукт. Проверьте подключение к базе данных.");
    }
    // дальше список обновит realtime-подписка
  } else {
    products.push({ id: uuid(), name, category, addedAt: Date.now() });
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
      alert("Не удалось удалить продукт. Проверьте подключение к базе данных.");
    }
  } else {
    products = products.filter(p => p.id !== id);
    saveProducts();
    render();
  }
}

// ---------------------------------------------------------------------------
// Рендер холодильника
// ---------------------------------------------------------------------------
const fridgeGrid = document.getElementById("fridge-grid");
const emptyState = document.getElementById("empty-state");
const statRed = document.getElementById("stat-red");
const statYellow = document.getElementById("stat-yellow");
const statGreen = document.getElementById("stat-green");

function render() {
  renderStats();
  renderGrid();
  lucide.createIcons();
}

function renderStats() {
  const counts = { red: 0, yellow: 0, green: 0 };
  products.forEach(p => counts[getExpiry(p).status]++);
  statRed.textContent = counts.red;
  statYellow.textContent = counts.yellow;
  statGreen.textContent = counts.green;
}

function renderGrid() {
  const sorted = [...products].sort((a, b) => getExpiry(a).daysLeft - getExpiry(b).daysLeft);
  fridgeGrid.innerHTML = "";
  emptyState.classList.toggle("hidden", sorted.length > 0);

  sorted.forEach(product => {
    const cat = CATEGORIES[product.category] || CATEGORIES.other;
    const { daysLeft, status } = getExpiry(product);
    const meta = STATUS_META[status];

    const card = document.createElement("div");
    card.className = "group relative flex items-stretch bg-white/80 rounded-2xl shadow-sm border border-bone-dark overflow-hidden hover:bg-bone-dark/70 hover:border-navy/25 hover:shadow-lg transition-all duration-200";

    const dayLabel = daysLeft < 0
      ? `Просрочен на ${Math.abs(daysLeft)} дн.`
      : daysLeft === 0
        ? "Съесть сегодня"
        : `${daysLeft} дн. осталось`;

    card.innerHTML = `
      <div class="w-2.5 shrink-0" style="background:${meta.ring}"></div>
      <div class="flex-1 flex items-center gap-3 p-3.5">
        <div class="relative w-12 h-12 shrink-0 rounded-xl flex items-center justify-center" style="background:${cat.color}22">
          <i data-lucide="${cat.icon}" class="w-6 h-6" style="color:${cat.color}"></i>
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-display font-semibold text-navy truncate">${escapeHtml(product.name)}</p>
          <p class="text-xs text-navy/50">${cat.label}${product.addedBy ? ` · добавил(а) ${escapeHtml(product.addedBy)}` : ""}</p>
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
// Форма добавления продукта
// ---------------------------------------------------------------------------
const addForm = document.getElementById("add-form");
const nameInput = document.getElementById("product-name");
const categorySelect = document.getElementById("product-category");
const shelfLifeHint = document.getElementById("shelf-life-hint");

function populateCategorySelect() {
  categorySelect.innerHTML = Object.entries(CATEGORIES)
    .map(([key, c]) => `<option value="${key}">${c.label}</option>`)
    .join("");
  updateShelfLifeHint();
}

function updateShelfLifeHint() {
  const cat = CATEGORIES[categorySelect.value];
  shelfLifeHint.textContent = `Срок годности рассчитается автоматически: ~${cat.days} дн.`;
}

categorySelect.addEventListener("change", updateShelfLifeHint);

addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return;
  addProduct(name, categorySelect.value);
  nameInput.value = "";
  nameInput.focus();
});

// ---------------------------------------------------------------------------
// Семейный доступ — локальный демо-режим (переключатель-симуляция)
// ---------------------------------------------------------------------------
const familyToggle = document.getElementById("family-toggle");
const familyStatusText = document.getElementById("family-status-text");
const familySyncPulse = document.getElementById("family-sync-pulse");

function loadFamilySync() {
  return localStorage.getItem(FAMILY_KEY) !== "off";
}

function renderFamilyState() {
  const on = loadFamilySync();
  familyToggle.setAttribute("aria-checked", String(on));
  familyToggle.classList.toggle("bg-cognac", on);
  familyToggle.classList.toggle("bg-navy/15", !on);
  familyToggle.querySelector("span").classList.toggle("translate-x-5", on);
  familyToggle.querySelector("span").classList.toggle("translate-x-0.5", !on);
  familyStatusText.textContent = on
    ? "Включено — изменения видят все члены семьи"
    : "Выключено — холодильник виден только вам";
}

familyToggle.addEventListener("click", () => {
  const on = loadFamilySync();
  localStorage.setItem(FAMILY_KEY, on ? "off" : "on");
  renderFamilyState();
});

function triggerFamilySyncPulse() {
  if (BACKEND_ENABLED || !loadFamilySync()) return;
  familySyncPulse.classList.remove("hidden");
  familySyncPulse.classList.add("animate-ping-once");
  setTimeout(() => {
    familySyncPulse.classList.add("hidden");
    familySyncPulse.classList.remove("animate-ping-once");
  }, 900);
}

function renderFamilyMembers() {
  const wrap = document.getElementById("family-members");
  wrap.innerHTML = FAMILY_MEMBERS.map((m, i) => `
    <div class="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-semibold text-bone border-2 border-bone shadow-sm"
         style="background:${i === 0 ? "#14213D" : "#A6672C"}; margin-left:${i === 0 ? 0 : "-10px"}">
      ${m.initials}
    </div>
  `).join("");
}

// ---------------------------------------------------------------------------
// Семейный доступ — реальный бэкенд (Supabase): код семьи + участники онлайн
// ---------------------------------------------------------------------------
function showModeBanner(state) {
  const el = document.getElementById("mode-banner");
  el.classList.remove("hidden");
  if (state === "demo") {
    el.textContent = "Демо-режим: данные хранятся только в этом браузере. Чтобы включить синхронизацию между устройствами семьи — см. README.";
    el.className = "text-xs sm:text-sm px-4 py-2.5 text-center font-medium bg-amber/20 text-[#8a6520]";
  } else if (state === "connecting") {
    el.textContent = "Подключение к семейному холодильнику…";
    el.className = "text-xs sm:text-sm px-4 py-2.5 text-center font-medium bg-navy/10 text-navy/70";
  } else if (state === "connected") {
    el.classList.add("hidden");
  } else if (state === "error") {
    el.textContent = "Не удалось подключиться к базе данных. Проверьте SUPABASE_CONFIG в config.js и выполните supabase-schema.sql.";
    el.className = "text-xs sm:text-sm px-4 py-2.5 text-center font-medium bg-terracotta/15 text-terracotta";
  }
}

function generateHouseholdCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // без 0/O/1/I во избежание путаницы
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ---------------------------------------------------------------------------
// Настоящая авторизация: email+пароль и вход через Google (Supabase Auth).
// auth.uid() теперь принадлежит человеку, а не браузеру — вся изоляция
// данных между семьями (RLS в supabase-schema.sql) держится на нём же.
// ---------------------------------------------------------------------------
function currentRedirectUrl() {
  // Возвращаемся на ту же страницу (важно для GitHub Pages с подпапкой)
  return window.location.origin + window.location.pathname;
}

async function signUpWithPassword(email, password) {
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { emailRedirectTo: currentRedirectUrl() }
  });
  if (error) throw error;
  // Если в проекте включено подтверждение почты, сессии пока не будет —
  // это нормально, покажем экран "проверьте почту".
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
  // Дальше браузер уходит на Google и возвращается обратно — сессия
  // появится через onAuthStateChange (SIGNED_IN).
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
    addedAt: Number(row.added_at), addedBy: row.added_by
  }));
}

function subscribeToProductChanges() {
  if (productsChannel) {
    sb.removeChannel(productsChannel);
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
          products.push({ id: row.id, name: row.name, category: row.category, addedAt: Number(row.added_at), addedBy: row.added_by });
        }
      } else if (payload.eventType === "DELETE") {
        products = products.filter(p => p.id !== payload.old.id);
      } else if (payload.eventType === "UPDATE") {
        const row = payload.new;
        const idx = products.findIndex(p => p.id === row.id);
        if (idx >= 0) products[idx] = { id: row.id, name: row.name, category: row.category, addedAt: Number(row.added_at), addedBy: row.added_by };
      }
      render();
    })
    .subscribe();
}

function subscribeToPresence() {
  if (presenceChannelRef) {
    sb.removeChannel(presenceChannelRef);
    presenceChannelRef = null;
  }
  const memberId = currentUser ? currentUser.id : uuid();
  const presenceChannel = sb.channel(`presence-${householdCode}`, {
    config: { presence: { key: memberId } }
  });
  presenceChannelRef = presenceChannel;
  presenceChannel
    .on("presence", { event: "sync" }, () => {
      renderPresence(presenceChannel.presenceState());
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await presenceChannel.track({ name: memberName, joinedAt: Date.now() });
      }
    });
}

function renderPresence(state) {
  const names = Object.values(state).map(arr => arr[0] && arr[0].name).filter(Boolean);
  const presenceList = document.getElementById("presence-list");
  presenceList.innerHTML = names.map(n => `
    <span class="text-[11px] px-2.5 py-1 rounded-full bg-sage/15 text-sage font-medium flex items-center gap-1">
      <span class="w-1.5 h-1.5 rounded-full bg-sage"></span>${escapeHtml(n)}
    </span>
  `).join("") || `<span class="text-[11px] text-navy/35">Пока никого нет онлайн</span>`;

  const headerAvatars = document.getElementById("family-members");
  headerAvatars.innerHTML = names.slice(0, 4).map((n, i) => `
    <div class="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-semibold text-bone border-2 border-bone shadow-sm"
         style="background:${i % 2 === 0 ? "#14213D" : "#A6672C"}; margin-left:${i === 0 ? 0 : "-8px"}">
      ${escapeHtml(n.slice(0, 2).toUpperCase())}
    </div>
  `).join("");
}

async function enterHousehold(code, name) {
  householdCode = code.toUpperCase().trim();
  memberName = name.trim();

  document.getElementById("onboarding").classList.add("hidden");
  document.getElementById("household-code-display").textContent = householdCode;
  document.getElementById("household-subtitle").textContent = `Семья: ${householdCode}`;

  showModeBanner("connecting");
  try {
    await fetchProductsFromBackend();
    subscribeToProductChanges();
    subscribeToPresence();
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
  createBtn.classList.toggle("bg-white", tab === "create");
  createBtn.classList.toggle("shadow-sm", tab === "create");
  createBtn.classList.toggle("text-navy", tab === "create");
  createBtn.classList.toggle("text-navy/50", tab !== "create");
  joinBtn.classList.toggle("bg-white", tab === "join");
  joinBtn.classList.toggle("shadow-sm", tab === "join");
  joinBtn.classList.toggle("text-navy", tab === "join");
  joinBtn.classList.toggle("text-navy/50", tab !== "join");
  document.getElementById("join-code-field").classList.toggle("hidden", tab !== "join");
  document.getElementById("onboarding-submit-label").textContent = tab === "create" ? "Создать и войти" : "Присоединиться";
}

function initBackendOnboarding() {
  document.getElementById("tab-create").addEventListener("click", () => setTab("create"));
  document.getElementById("tab-join").addEventListener("click", () => setTab("join"));
  document.getElementById("leave-household-btn").addEventListener("click", async () => {
    if (!currentUser || !confirm("Покинуть текущую семью? Доступ к её холодильнику пропадёт, пока вы не вступите заново по коду.")) return;
    const { error } = await sb.from("household_members").delete().eq("user_id", currentUser.id);
    if (error) {
      console.error(error);
      alert("Не удалось покинуть семью. Попробуйте ещё раз.");
      return;
    }
    location.reload();
  });
  document.getElementById("copy-code-btn").addEventListener("click", () => {
    if (!householdCode) return;
    navigator.clipboard.writeText(householdCode).catch(() => {});
    const icon = document.getElementById("copy-code-btn");
    icon.classList.add("text-sage");
    setTimeout(() => icon.classList.remove("text-sage"), 1000);
  });

  document.getElementById("onboarding-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("member-name-input").value.trim();
    const errorEl = document.getElementById("onboarding-error");
    errorEl.classList.add("hidden");
    if (!name) return;
    const submitBtn = e.target.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    try {
      if (currentTab === "create") {
        const code = generateHouseholdCode();
        const { error } = await sb.rpc("create_household", { p_code: code, p_display_name: name });
        if (error) throw error;
        await enterHousehold(code, name);
      } else {
        const codeInput = document.getElementById("join-code-input").value.trim().toUpperCase();
        if (!codeInput) {
          errorEl.textContent = "Введите код семьи";
          errorEl.classList.remove("hidden");
          submitBtn.disabled = false;
          return;
        }
        const { data: joined, error } = await sb.rpc("join_household", { p_code: codeInput, p_display_name: name });
        if (error) throw error;
        if (!joined) {
          errorEl.textContent = "Семья с таким кодом не найдена. Проверьте код у того, кто её создал.";
          errorEl.classList.remove("hidden");
          submitBtn.disabled = false;
          return;
        }
        await enterHousehold(codeInput, name);
      }
    } catch (err) {
      console.error(err);
      errorEl.textContent = "Не удалось подключиться. Проверьте ключи Supabase в config.js.";
      errorEl.classList.remove("hidden");
    }
    submitBtn.disabled = false;
  });
}

// ---------------------------------------------------------------------------
// Избранные рецепты (страница «Избранное»)
// ---------------------------------------------------------------------------
function loadFavoriteRecipes() {
  try { return JSON.parse(localStorage.getItem(FAVORITES_KEY)) || []; }
  catch (e) { return []; }
}

function saveFavoriteRecipes(list) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
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
  return idx < 0; // true, если рецепт только что добавили
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
  document.getElementById("favorites-empty").classList.toggle("hidden", list.length > 0);

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
  lucide.createIcons();

  wrap.querySelectorAll(".fav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      toggleFavoriteRecipe({ id: btn.dataset.favId });
      renderFavoritesPage();
    });
  });
}

// ---------------------------------------------------------------------------
// Многостраничность: Холодильник / Избранное / Профиль (нижняя навигация)
// ---------------------------------------------------------------------------
function showPage(name) {
  ["home", "favorites", "profile"].forEach(p => {
    document.getElementById(`page-${p}`).classList.toggle("hidden", p !== name);
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
const cookBtn = document.getElementById("cook-btn");
const recipeModal = document.getElementById("recipe-modal");
const recipeModalClose = document.getElementById("recipe-modal-close");
const recipeResults = document.getElementById("recipe-results");

cookBtn.addEventListener("click", async () => {
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
      if (data.error) throw new Error(data.error);
      if (data.recipes && data.recipes.length > 0) {
        showRecipeSourceNote("База рецептов: Spoonacular");
        renderApiRecipes(data.recipes);
        return;
      }
      // Пустой ответ (например, слишком специфичные продукты) — покажем локальные варианты
    } catch (err) {
      console.warn("Spoonacular недоступен, показываю локальную подборку рецептов:", err.message);
    }
  }

  showRecipeSourceNote("");
  const withStatus = products.map(p => ({ name: p.name, status: getExpiry(p).status }));
  renderRecipes(matchRecipes(withStatus));
});

function showRecipeSourceNote(text) {
  document.getElementById("recipe-source-note").textContent = text;
}

function renderRecipesLoading() {
  recipeResults.innerHTML = `
    <div class="text-center py-12">
      <i data-lucide="loader-2" class="w-7 h-7 mx-auto text-cognac animate-spin"></i>
      <p class="text-sm text-navy/40 mt-3">Подбираем рецепты из базы Spoonacular…</p>
    </div>`;
  lucide.createIcons();
}

// ---------------------------------------------------------------------------
// Рендер рецептов из настоящей базы (Spoonacular, через Edge Function)
// ---------------------------------------------------------------------------
function renderApiRecipes(recipes) {
  recipeResults.innerHTML = recipes.map(r => `
    <div class="border border-bone-dark rounded-2xl overflow-hidden bg-bone/60" data-recipe-id="${r.id}">
      <div class="flex gap-3 p-4">
        ${r.image ? `<img src="${escapeHtml(r.image)}" alt="" class="w-16 h-16 rounded-xl object-cover shrink-0 bg-bone-dark">` : ""}
        <div class="flex-1 min-w-0">
          <h3 class="font-display font-semibold text-base text-navy leading-snug">${escapeHtml(r.title)}</h3>
          <div class="flex flex-wrap gap-1.5 mt-2">
            ${r.usedIngredients.map(m => `<span class="text-[11px] px-2 py-0.5 rounded-full bg-sage/15 text-sage font-medium">${escapeHtml(m)}</span>`).join("")}
            ${r.missedIngredients.slice(0, 3).map(m => `<span class="text-[11px] px-2 py-0.5 rounded-full bg-navy/10 text-navy/50 font-medium">+ ${escapeHtml(m)}</span>`).join("")}
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
  lucide.createIcons();

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
      btn.querySelector("i").setAttribute("fill", added ? "currentColor" : "none");
    });
  });
}

async function toggleRecipeSteps(btn) {
  const card = btn.closest("[data-recipe-id]");
  const stepsEl = card.querySelector(".recipe-steps");

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
    if (data.error) throw new Error(data.error);

    stepsEl.innerHTML = `
      <div class="flex items-center gap-3 text-xs text-navy/50 mb-2">
        ${data.readyInMinutes ? `<span class="flex items-center gap-1"><i data-lucide="clock" class="w-3.5 h-3.5"></i>${data.readyInMinutes} мин</span>` : ""}
        ${data.servings ? `<span class="flex items-center gap-1"><i data-lucide="users" class="w-3.5 h-3.5"></i>${data.servings} порц.</span>` : ""}
      </div>
      ${data.steps && data.steps.length
        ? `<ol class="space-y-1.5 text-sm text-navy/70 list-decimal list-inside">${data.steps.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ol>`
        : `<p class="text-sm text-navy/50">Подробные шаги не указаны автором рецепта.</p>`}
      ${data.sourceUrl ? `<a href="${escapeHtml(data.sourceUrl)}" target="_blank" rel="noopener" class="inline-block mt-3 text-xs text-cognac-dark hover:underline">Открыть оригинал рецепта →</a>` : ""}
    `;
    stepsEl.dataset.loaded = "1";
    stepsEl.classList.remove("hidden");
    btn.textContent = "Скрыть рецепт";
    lucide.createIcons();
  } catch (err) {
    console.error(err);
    stepsEl.innerHTML = `<p class="text-sm text-terracotta">Не удалось загрузить шаги рецепта.</p>`;
    stepsEl.classList.remove("hidden");
    btn.textContent = "Скрыть рецепт";
  }
  btn.disabled = false;
}

function renderRecipes(matches) {
  if (matches.length === 0) {
    recipeResults.innerHTML = `
      <div class="text-center py-10 px-4">
        <i data-lucide="chef-hat" class="w-10 h-10 mx-auto text-navy/30 mb-3"></i>
        <p class="text-navy/60 font-medium">Пока нечего готовить впопыхах</p>
        <p class="text-sm text-navy/40 mt-1">Как только продукты пожелтеют или покраснеют, здесь появятся рецепты из них.</p>
      </div>`;
    lucide.createIcons();
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
      </div>
      <div class="flex flex-wrap gap-1.5 mt-3">
        ${matched.map(m => `<span class="text-[11px] px-2 py-0.5 rounded-full bg-terracotta/10 text-terracotta font-medium">${escapeHtml(m)}</span>`).join("")}
      </div>
      <ol class="mt-3 space-y-1.5 text-sm text-navy/70 list-decimal list-inside">
        ${recipe.steps.map(s => `<li>${escapeHtml(s)}</li>`).join("")}
      </ol>
    </div>
  `).join("");
  lucide.createIcons();

  recipeResults.querySelectorAll(".fav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const { recipe } = matches.find(m => String(m.recipe.id) === btn.dataset.favId);
      const added = toggleFavoriteRecipe({ id: recipe.id, title: recipe.title, time: recipe.time, difficulty: recipe.difficulty, steps: recipe.steps, source: "local" });
      btn.classList.toggle("is-fav", added);
      btn.classList.toggle("text-terracotta", added);
      btn.classList.toggle("text-navy/25", !added);
      btn.querySelector("i").setAttribute("fill", added ? "currentColor" : "none");
    });
  });
}

function openModal() {
  recipeModal.classList.remove("hidden");
  requestAnimationFrame(() => {
    recipeModal.querySelector(".modal-panel").classList.remove("translate-y-6", "opacity-0");
  });
  document.body.classList.add("overflow-hidden");
}

function closeModal() {
  recipeModal.querySelector(".modal-panel").classList.add("translate-y-6", "opacity-0");
  document.body.classList.remove("overflow-hidden");
  setTimeout(() => recipeModal.classList.add("hidden"), 200);
}

recipeModalClose.addEventListener("click", closeModal);
recipeModal.addEventListener("click", (e) => {
  if (e.target === recipeModal) closeModal();
});

// ---------------------------------------------------------------------------
// Экран авторизации: вход / регистрация / Google / восстановление пароля
// ---------------------------------------------------------------------------
function showAuthStep(step) {
  ["credentials", "forgot", "check-email", "new-password"].forEach(s => {
    document.getElementById(`auth-step-${s}`).classList.toggle("hidden", s !== step);
  });
}

function setAuthTab(tab) {
  authTab = tab;
  const loginBtn = document.getElementById("auth-tab-login");
  const signupBtn = document.getElementById("auth-tab-signup");
  loginBtn.classList.toggle("bg-white", tab === "login");
  loginBtn.classList.toggle("shadow-sm", tab === "login");
  loginBtn.classList.toggle("text-navy", tab === "login");
  loginBtn.classList.toggle("text-navy/50", tab !== "login");
  signupBtn.classList.toggle("bg-white", tab === "signup");
  signupBtn.classList.toggle("shadow-sm", tab === "signup");
  signupBtn.classList.toggle("text-navy", tab === "signup");
  signupBtn.classList.toggle("text-navy/50", tab !== "signup");
  document.getElementById("auth-password-input").autocomplete = tab === "login" ? "current-password" : "new-password";
  document.getElementById("auth-submit-label").textContent = tab === "login" ? "Войти" : "Зарегистрироваться";
  document.getElementById("auth-error").classList.add("hidden");
  document.getElementById("auth-info").classList.add("hidden");
}

function showAuthScreen() {
  document.getElementById("onboarding").classList.add("hidden");
  document.getElementById("account-control").classList.add("hidden");
  showAuthStep("credentials");
  setAuthTab("login");
  document.getElementById("auth-modal").classList.remove("hidden");
}

function hideAuthScreen() {
  document.getElementById("auth-modal").classList.add("hidden");
}

function initAuthUI() {
  document.getElementById("auth-tab-login").addEventListener("click", () => setAuthTab("login"));
  document.getElementById("auth-tab-signup").addEventListener("click", () => setAuthTab("signup"));

  document.getElementById("auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("auth-email-input").value.trim();
    const password = document.getElementById("auth-password-input").value;
    const errorEl = document.getElementById("auth-error");
    const infoEl = document.getElementById("auth-info");
    errorEl.classList.add("hidden");
    infoEl.classList.add("hidden");
    const submitBtn = e.target.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    try {
      if (authTab === "login") {
        await signInWithPassword(email, password);
        // Дальше сессию подхватит onAuthStateChange (SIGNED_IN)
      } else {
        const data = await signUpWithPassword(email, password);
        if (!data.session) {
          document.getElementById("check-email-text").textContent =
            `Мы отправили письмо для подтверждения на ${email}. Перейдите по ссылке в письме, чтобы войти.`;
          showAuthStep("check-email");
        }
      }
    } catch (err) {
      console.error(err);
      errorEl.textContent = err.message === "Invalid login credentials"
        ? "Неверный email или пароль."
        : (err.message || "Не удалось выполнить вход. Попробуйте ещё раз.");
      errorEl.classList.remove("hidden");
    }
    submitBtn.disabled = false;
  });

  document.getElementById("google-auth-btn").addEventListener("click", async () => {
    try {
      await signInWithGoogle();
    } catch (err) {
      console.error(err);
      const errorEl = document.getElementById("auth-error");
      errorEl.textContent = "Не удалось войти через Google. Проверьте, включён ли провайдер в Supabase.";
      errorEl.classList.remove("hidden");
    }
  });

  document.getElementById("auth-forgot-link").addEventListener("click", () => showAuthStep("forgot"));
  document.getElementById("forgot-back-btn").addEventListener("click", () => showAuthStep("credentials"));
  document.getElementById("check-email-back-btn").addEventListener("click", () => showAuthStep("credentials"));

  document.getElementById("forgot-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("forgot-email-input").value.trim();
    const errorEl = document.getElementById("forgot-error");
    errorEl.classList.add("hidden");
    try {
      await requestPasswordReset(email);
      document.getElementById("check-email-text").textContent =
        `Мы отправили ссылку для сброса пароля на ${email}.`;
      showAuthStep("check-email");
    } catch (err) {
      console.error(err);
      errorEl.textContent = "Не удалось отправить письмо. Проверьте email и попробуйте снова.";
      errorEl.classList.remove("hidden");
    }
  });

  document.getElementById("new-password-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = document.getElementById("new-password-input").value;
    const errorEl = document.getElementById("new-password-error");
    errorEl.classList.add("hidden");
    try {
      await setNewPassword(password);
      await handleAuthenticated(currentUser, (await sb.auth.getSession()).data.session);
    } catch (err) {
      console.error(err);
      errorEl.textContent = "Не удалось сохранить пароль. Попробуйте ещё раз.";
      errorEl.classList.remove("hidden");
    }
  });

  document.getElementById("account-logout-btn").addEventListener("click", async () => {
    if (!confirm("Выйти из аккаунта?")) return;
    await signOutAccount();
  });
}

// ---------------------------------------------------------------------------
// После успешного входа: показываем аккаунт в шапке и либо сразу заходим
// в уже известную семью пользователя, либо просим создать/присоединиться.
// ---------------------------------------------------------------------------
async function handleAuthenticated(user, session) {
  currentUser = user;
  hideAuthScreen();

  const accountControl = document.getElementById("account-control");
  accountControl.classList.remove("hidden");
  accountControl.classList.add("flex");
  document.getElementById("account-email").textContent = user.email || "";

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
      document.getElementById("member-name-input").value = (user.email || "").split("@")[0];
      document.getElementById("onboarding").classList.remove("hidden");
      showModeBanner("connected");
    }
  } catch (err) {
    console.error(err);
    showModeBanner("error");
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
populateCategorySelect();
lucide.createIcons();

if (BACKEND_ENABLED) {
  sb = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
  document.getElementById("family-local").classList.add("hidden");
  document.getElementById("family-backend").classList.remove("hidden");
  setTab("create");
  initBackendOnboarding();
  initAuthUI();

  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      if (session) currentUser = session.user;
      document.getElementById("auth-modal").classList.remove("hidden");
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
