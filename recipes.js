import { state } from "./state.js";
import { escapeHtml, safeAddListener } from "./utils.js";
import { getExpiry } from "./categories.js";

// ---------------------------------------------------------------------------
// Локальная библиотека рецептов (запасной вариант, когда Spoonacular
// недоступен или для продукта ничего не нашлось) — структура данных
// намеренно совместима с апгрейдом на внешний API.
// ---------------------------------------------------------------------------
const RECIPE_LIBRARY = [
  {
    id: "chicken-veg-stirfry",
    title: "Быстрая курица с овощами вок",
    time: "20 мин",
    difficulty: "Легко",
    servings: 2,
    nutrition: { calories: 320, protein: 28, fat: 12, carbs: 22 },
    pp: true,
    ingredients: ["курица", "куриц", "морковь", "перец", "лук", "брокколи", "соевый соус"],
    steps: [
      "Нарежьте курицу тонкими полосками, обжарьте на сильном огне 5 минут.",
      "Добавьте нарезанные овощи, готовьте ещё 5–7 минут, помешивая.",
      "Влейте соевый соус, готовьте 2 минуты и подавайте с рисом."
    ]
  },
  {
    id: "milk-pancakes",
    title: "Молочные блинчики на скорую руку",
    time: "25 мин",
    difficulty: "Легко",
    servings: 3,
    nutrition: { calories: 260, protein: 8, fat: 9, carbs: 36 },
    pp: false,
    ingredients: ["молоко", "яйцо", "яйца", "мука", "масло сливочное"],
    steps: [
      "Смешайте молоко, яйца и муку до однородности венчиком.",
      "Дайте тесту постоять 10 минут.",
      "Жарьте блины на среднем огне по 1–2 минуты с каждой стороны."
    ]
  },
  {
    id: "apple-oat-bake",
    title: "Овсяная запеканка с яблоками",
    time: "35 мин",
    difficulty: "Средне",
    servings: 4,
    nutrition: { calories: 210, protein: 7, fat: 6, carbs: 33 },
    pp: true,
    ingredients: ["яблоко", "яблоки", "овсянка", "молоко", "яйцо", "яйца", "корица"],
    steps: [
      "Нарежьте яблоки тонкими дольками и выложите на дно формы.",
      "Смешайте овсянку, молоко и яйца, залейте яблоки.",
      "Запекайте 25 минут при 180°C до золотистой корочки."
    ]
  },
  {
    id: "fish-lemon-veg",
    title: "Рыба с овощами на пару",
    time: "20 мин",
    difficulty: "Легко",
    servings: 2,
    nutrition: { calories: 280, protein: 30, fat: 10, carbs: 14 },
    pp: true,
    ingredients: ["рыба", "лосось", "треска", "лимон", "кабачок", "морковь", "брокколи"],
    steps: [
      "Приправьте рыбу солью, перцем и лимонным соком.",
      "Готовьте на пару вместе с нарезанными овощами 12–15 минут.",
      "Подавайте, сбрызнув оливковым маслом."
    ]
  },
  {
    id: "veg-soup",
    title: "Овощной суп «всё, что есть в холодильнике»",
    time: "30 мин",
    difficulty: "Легко",
    servings: 4,
    nutrition: { calories: 120, protein: 3, fat: 4, carbs: 18 },
    pp: true,
    ingredients: ["картофель", "морковь", "лук", "капуста", "помидор", "перец", "кабачок"],
    steps: [
      "Обжарьте лук и морковь на масле 3–4 минуты.",
      "Добавьте остальные овощи и залейте водой или бульоном.",
      "Варите 20 минут до готовности овощей, посолите по вкусу."
    ]
  },
  {
    id: "cottage-cheese-bake",
    title: "Запеканка из творога",
    time: "40 мин",
    difficulty: "Средне",
    servings: 4,
    nutrition: { calories: 230, protein: 16, fat: 9, carbs: 21 },
    pp: true,
    ingredients: ["творог", "яйцо", "яйца", "манка", "сметана", "изюм"],
    steps: [
      "Смешайте творог, яйца и манку до однородной массы.",
      "Выложите в форму, смажьте сметаной сверху.",
      "Запекайте 30 минут при 180°C."
    ]
  },
  {
    id: "beef-mash",
    title: "Тушёная говядина с картофельным пюре",
    time: "50 мин",
    difficulty: "Средне",
    servings: 3,
    nutrition: { calories: 420, protein: 27, fat: 18, carbs: 34 },
    pp: false,
    ingredients: ["говядина", "мясо", "картофель", "лук", "морковь"],
    steps: [
      "Обжарьте кусочки говядины до румяной корочки.",
      "Добавьте лук и морковь, тушите под крышкой 35–40 минут.",
      "Подавайте с картофельным пюре."
    ]
  },
  {
    id: "yogurt-fruit-bowl",
    title: "Йогуртовая боул с фруктами",
    time: "5 мин",
    difficulty: "Легко",
    servings: 1,
    nutrition: { calories: 190, protein: 9, fat: 4, carbs: 30 },
    pp: true,
    ingredients: ["йогурт", "банан", "яблоко", "яблоки", "ягоды", "мёд"],
    steps: [
      "Нарежьте фрукты небольшими кусочками.",
      "Выложите йогурт в миску, добавьте фрукты сверху.",
      "Полейте мёдом по желанию."
    ]
  },
  {
    id: "cheese-omelet",
    title: "Омлет с сыром и зеленью",
    time: "10 мин",
    difficulty: "Легко",
    servings: 1,
    nutrition: { calories: 310, protein: 21, fat: 23, carbs: 3 },
    pp: true,
    ingredients: ["яйцо", "яйца", "сыр", "молоко", "зелень"],
    steps: [
      "Взбейте яйца с молоком и щепоткой соли.",
      "Вылейте на разогретую сковороду, готовьте на среднем огне.",
      "Посыпьте тёртым сыром и зеленью перед подачей."
    ]
  },
  {
    id: "bread-toast",
    title: "Тосты с помидором и сыром",
    time: "10 мин",
    difficulty: "Легко",
    servings: 1,
    nutrition: { calories: 240, protein: 11, fat: 10, carbs: 26 },
    pp: false,
    ingredients: ["хлеб", "батон", "помидор", "сыр", "масло сливочное"],
    steps: [
      "Слегка обжарьте хлеб на сухой сковороде или в тостере.",
      "Выложите ломтики помидора и сыр сверху.",
      "Разогрейте в духовке 3–4 минуты, пока сыр не расплавится."
    ]
  }
];

/**
 * Подбирает рецепты по списку «срочных» и «скоро истекающих» продуктов.
 * @param {{name:string, status:'red'|'yellow'|'green'}[]} products
 * @param {{ppOnly?: boolean}} [options] — ppOnly ограничивает подбор рецептами режима «ПП»
 * @returns {Array<{recipe:object, matched:string[], score:number}>}
 */
function matchRecipes(products, options = {}) {
  const { ppOnly = false } = options;
  const priority = products.filter(p => p.status === "red" || p.status === "yellow");
  if (priority.length === 0) return [];

  const library = ppOnly ? RECIPE_LIBRARY.filter(r => r.pp) : RECIPE_LIBRARY;
  const scored = library.map(recipe => {
    const matched = new Set();
    let score = 0;
    priority.forEach(p => {
      const name = p.name.toLowerCase();
      const hit = recipe.ingredients.some(kw => name.includes(kw) || kw.includes(name));
      if (hit) {
        matched.add(p.name);
        score += p.status === "red" ? 2 : 1;
      }
    });
    return { recipe, matched: Array.from(matched), score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

// ---------------------------------------------------------------------------
// Режим «ПП» (правильное питание) — фильтр, который оставляет только
// более полезные рецепты (белок/овощи, без белой муки и избытка сахара).
// Состояние живёт в state.ppMode и переживает перезагрузку страницы через localStorage.
// ---------------------------------------------------------------------------
const PP_MODE_KEY = "smart-fridge-pp-mode";

function loadPpMode() {
  try { return localStorage.getItem(PP_MODE_KEY) === "1"; }
  catch (e) { return false; }
}

function savePpMode(value) {
  try { localStorage.setItem(PP_MODE_KEY, value ? "1" : "0"); } catch (e) {}
}

state.ppMode = loadPpMode();

/** Переключает режим ПП и повторно открывает рецепты для последнего запроса. */
export function togglePpMode() {
  state.ppMode = !state.ppMode;
  savePpMode(state.ppMode);
  updatePpToggleUi();
  openRecipesFor(state.lastRecipePriority || []);
  return state.ppMode;
}

function updatePpToggleUi() {
  const btn = document.getElementById("pp-mode-toggle");
  if (!btn) return;
  btn.classList.toggle("bg-sage/15", state.ppMode);
  btn.classList.toggle("border-sage", state.ppMode);
  btn.classList.toggle("text-sage", state.ppMode);
  btn.classList.toggle("bg-bone-dark/40", !state.ppMode);
  btn.classList.toggle("border-bone-dark", !state.ppMode);
  btn.classList.toggle("text-navy/40", !state.ppMode);
  btn.setAttribute("aria-checked", state.ppMode ? "true" : "false");
}

safeAddListener("pp-mode-toggle", "click", togglePpMode);

// ---------------------------------------------------------------------------
// Избранные рецепты
// ---------------------------------------------------------------------------
const FAVORITES_KEY = "smart-fridge-favorite-recipes";

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

export function renderFavoritesPage() {
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
// «Что приготовить?»
// ---------------------------------------------------------------------------

/**
 * Открывает модалку рецептов, подобранных под конкретный список продуктов.
 * Используется и общей кнопкой «Что приготовить?» (весь приоритетный список),
 * и кнопкой «Приготовить» на отдельной карточке товара (список из одного).
 */
export async function openRecipesFor(priority) {
  openModal();
  updatePpToggleUi();

  if (priority && priority.length > 0) state.lastRecipePriority = priority;
  priority = priority && priority.length > 0 ? priority : state.lastRecipePriority;

  if (!priority || priority.length === 0) {
    showRecipeSourceNote("");
    renderRecipes([]);
    return;
  }

  if (state.sb && state.currentUser) {
    renderRecipesLoading();
    try {
      const { data, error } = await state.sb.functions.invoke("recipes", {
        body: { action: "search", ingredients: priority.map(p => p.name), ppMode: state.ppMode }
      });
      if (error) throw error;
      if (data && data.recipes && data.recipes.length > 0) {
        showRecipeSourceNote(state.ppMode ? "База рецептов: Spoonacular · режим ПП" : "База рецептов: Spoonacular");
        renderApiRecipes(data.recipes);
        return;
      }
      if (data && data.recipes && data.recipes.length === 0 && state.ppMode) {
        showRecipeSourceNote("Среди полезных рецептов Spoonacular ничего не нашлось — показываем локальную подборку");
      }
    } catch (err) {
      console.warn("Spoonacular недоступен, показываем локальную подборку:", err.message);
    }
  }

  if (!state.ppMode) {
    showRecipeSourceNote("");
  } else if (!document.getElementById("recipe-source-note")?.textContent) {
    showRecipeSourceNote("Локальная подборка · режим ПП");
  }
  const withStatus = priority.map(p => ({ name: p.name, status: getExpiry(p).status }));
  renderRecipes(matchRecipes(withStatus, { ppOnly: state.ppMode }));
}

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

  recipeResults.innerHTML = recipes.map((r, i) => `
    <div class="border border-bone-dark rounded-2xl overflow-hidden bg-bone/60 list-item-in" style="animation-delay:${Math.min(i, 6) * 50}ms" data-recipe-id="${r.id}">
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
    const { data, error } = await state.sb.functions.invoke("recipes", {
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

  recipeResults.innerHTML = matches.map(({ recipe, matched, score }, i) => `
    <div class="border border-bone-dark rounded-2xl p-4 bg-bone/60 list-item-in" style="animation-delay:${Math.min(i, 6) * 50}ms">
      <div class="flex items-start justify-between gap-3">
        <h3 class="font-display font-semibold text-lg text-navy">${escapeHtml(recipe.title)}</h3>
        <div class="flex items-center gap-1.5 shrink-0">
          ${recipe.pp ? `<span class="text-[11px] font-medium px-2 py-1 rounded-full bg-sage/15 text-sage whitespace-nowrap">ПП</span>` : ""}
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
