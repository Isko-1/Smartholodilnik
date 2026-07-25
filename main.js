import { SUPABASE_CONFIG } from "./config.js";
import { state } from "./state.js";
import { safeAddListener } from "./utils.js";
import { getExpiry } from "./categories.js";
import { populateCategorySelect, startNotifyPolling } from "./products.js";
import { renderHistoryPage } from "./history.js";
import { renderFavoritesPage, openRecipesFor } from "./recipes.js";
import { showModeBanner, initAuth } from "./auth.js";
import "./delivery.js";

// ---------------------------------------------------------------------------
// Навигация между страницами
// ---------------------------------------------------------------------------
function showPage(name) {
  ["home", "history", "favorites", "profile"].forEach(p => {
    const el = document.getElementById(`page-${p}`);
    if (el) el.classList.toggle("hidden", p !== name);
  });
  document.querySelectorAll(".nav-button").forEach(btn => {
    if (btn.dataset.page === name) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  if (name === "favorites") renderFavoritesPage();
  if (name === "history") renderHistoryPage();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".nav-button").forEach(btn => {
  btn.addEventListener("click", () => showPage(btn.dataset.page));
});

safeAddListener("cook-btn", "click", () => {
  const priority = state.products.filter(p => ["red", "yellow"].includes(getExpiry(p).status));
  openRecipesFor(priority);
});

// ---------------------------------------------------------------------------
// Старт приложения
// ---------------------------------------------------------------------------
populateCategorySelect();
if (window.lucide) lucide.createIcons();
startNotifyPolling();

const backendConfigured = SUPABASE_CONFIG.url && SUPABASE_CONFIG.url.startsWith("http")
  && SUPABASE_CONFIG.anonKey && SUPABASE_CONFIG.anonKey.length > 20;

if (!backendConfigured) {
  showModeBanner("error");
} else {
  state.sb = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
  initAuth();
}
