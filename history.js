import { state } from "./state.js";
import { escapeHtml } from "./utils.js";
import { CATEGORIES } from "./categories.js";

// ---------------------------------------------------------------------------
// История: лог событий (добавлено / съедено / выброшено)
// Пишется и читается только через Supabase — локального демо-хранилища нет.
// ---------------------------------------------------------------------------
export async function logEvent(name, category, action, reason = null) {
  const { error } = await state.sb.from("product_events").insert({
    household_code: state.householdCode,
    product_name: name,
    category,
    action,
    reason,
    by: state.memberName
  });
  if (error) console.error("Не удалось записать событие в историю:", error);
}

export async function fetchEventsForHistory() {
  const { data, error } = await state.sb
    .from("product_events")
    .select("*")
    .eq("household_code", state.householdCode)
    .order("occurred_at", { ascending: false });
  if (error) {
    console.error("Не удалось загрузить историю:", error);
    return [];
  }
  return data.map(row => ({
    id: row.id, name: row.product_name, category: row.category,
    action: row.action, reason: row.reason, at: new Date(row.occurred_at).getTime(), by: row.by
  }));
}

// ---------------------------------------------------------------------------
// Средний интервал между покупками каждого названия — считается из уже существующего
// лога product_events (action = 'added'), без новых таблиц/колонок. Используется для
// подсказки в списке регулярных покупок (products.js, renderRegulars).
// ---------------------------------------------------------------------------
export async function fetchRegularIntervals() {
  const { data, error } = await state.sb
    .from("product_events")
    .select("product_name, occurred_at")
    .eq("household_code", state.householdCode)
    .eq("action", "added")
    .order("occurred_at", { ascending: true });
  if (error) {
    console.error("Не удалось загрузить интервалы покупок:", error);
    return {};
  }

  const byName = {};
  data.forEach(row => {
    const key = row.product_name.trim().toLowerCase();
    (byName[key] ??= []).push(new Date(row.occurred_at).getTime());
  });

  const intervals = {};
  for (const [name, timestamps] of Object.entries(byName)) {
    if (timestamps.length < 2) continue; // нужно минимум 2 покупки, чтобы считать интервал
    const gaps = timestamps.slice(1).map((t, i) => t - timestamps[i]);
    const avgMs = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
    intervals[name] = Math.round(avgMs / (24 * 60 * 60 * 1000));
  }
  return intervals;
}

// ---------------------------------------------------------------------------
// История: рендер таймлайна
// ---------------------------------------------------------------------------
const HISTORY_ACTION_META = {
  added:     { label: "Добавлено",  icon: "plus-circle", chip: "bg-navy/8 text-navy/60" },
  eaten:     { label: "Съедено",    icon: "utensils",    chip: "bg-sage/15 text-sage" },
  discarded: { label: "Выброшено",  icon: "trash-2",     chip: "bg-terracotta/15 text-terracotta" }
};

function historyDayLabel(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return "Сегодня";
  if (sameDay(date, yesterday)) return "Вчера";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export async function renderHistoryPage() {
  const listEl = document.getElementById("history-list");
  const emptyEl = document.getElementById("history-empty");
  if (!listEl) return;

  listEl.innerHTML = `<div class="text-center py-8"><i data-lucide="loader-2" class="w-6 h-6 mx-auto text-cognac animate-spin"></i></div>`;
  if (window.lucide) lucide.createIcons();

  const events = await fetchEventsForHistory();
  if (emptyEl) emptyEl.classList.toggle("hidden", events.length > 0);
  if (events.length === 0) {
    listEl.innerHTML = "";
    return;
  }

  const groups = [];
  events.forEach(ev => {
    const label = historyDayLabel(ev.at);
    let group = groups.find(g => g.label === label);
    if (!group) { group = { label, items: [] }; groups.push(group); }
    group.items.push(ev);
  });

  listEl.innerHTML = groups.map(group => `
    <div>
      <p class="text-xs font-semibold text-navy/40 uppercase tracking-wide mb-2">${escapeHtml(group.label)}</p>
      <div class="space-y-2">
        ${group.items.map((ev, i) => {
          const cat = CATEGORIES[ev.category] || CATEGORIES.other;
          const meta = ev.action === "added" ? HISTORY_ACTION_META.added : (HISTORY_ACTION_META[ev.reason] || HISTORY_ACTION_META.discarded);
          const time = new Date(ev.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
          return `
            <div class="flex items-center gap-3 bg-white/70 border border-bone-dark rounded-xl px-3 py-2.5 list-item-in" style="animation-delay:${Math.min(i, 8) * 30}ms">
              <div class="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center" style="background:${cat.color}22">
                <i data-lucide="${cat.icon}" class="w-4.5 h-4.5" style="color:${cat.color}"></i>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-navy truncate">${escapeHtml(ev.name)}</p>
                <p class="text-xs text-navy/40">${time}${ev.by ? ` · ${escapeHtml(ev.by)}` : ""}</p>
              </div>
              <span class="text-[11px] font-medium px-2 py-1 rounded-full ${meta.chip} shrink-0 flex items-center gap-1">
                <i data-lucide="${meta.icon}" class="w-3 h-3"></i>${meta.label}
              </span>
            </div>`;
        }).join("")}
      </div>
    </div>
  `).join("");
  if (window.lucide) lucide.createIcons();
}
