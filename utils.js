// ---------------------------------------------------------------------------
// Утилиты безопасности DOM и мелкие форматтеры
// ---------------------------------------------------------------------------
export function safeAddListener(id, event, handler) {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener(event, handler);
  } else {
    console.warn(`[DOM Safe] Элемент #${id} не найден.`);
  }
}

export function uuid() {
  if (window.crypto && crypto.randomUUID && window.isSecureContext) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function formatQty(quantity, unit) {
  const n = Number(quantity) || 1;
  const rounded = Math.round(n * 10) / 10;
  return `${rounded} ${unit || "шт"}`;
}

/**
 * Плавно «докручивает» числовое значение в элементе до нового —
 * vanilla-аналог Number Ticker из MagicUI (без зависимости от motion/framer-motion).
 * Если значение не меняется или элемент отсутствует — просто выходит.
 */
export function animateCountUp(el, newValue, duration = 500) {
  if (!el) return;
  const from = Number(el.dataset.countValue ?? el.textContent) || 0;
  const to = Number(newValue) || 0;
  if (from === to) {
    el.textContent = to;
    el.dataset.countValue = to;
    return;
  }
  el.dataset.countValue = to;
  const start = performance.now();
  const ease = t => 1 - Math.pow(1 - t, 3); // easeOutCubic — мягкое замедление в конце, как у spring в MagicUI
  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const value = Math.round(from + (to - from) * ease(progress));
    el.textContent = value;
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

export function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Блокирует кнопку и показывает состояние загрузки на время выполнения fn(),
 * чтобы двойной клик/сабмит не отправлял запрос к Supabase дважды.
 * Возвращает то, что вернул fn (или undefined, если кнопка уже была занята).
 */
export async function withBusy(btn, fn) {
  if (!btn || btn.disabled) return;
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.dataset.busy = "1";
  btn.classList.add("opacity-60", "cursor-wait", "pointer-events-none");
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    delete btn.dataset.busy;
    btn.classList.remove("opacity-60", "cursor-wait", "pointer-events-none");
    if (btn.dataset.restoreHtmlOnDone) btn.innerHTML = originalHtml;
  }
}

// ---------------------------------------------------------------------------
// Tilt-card эффект
// ---------------------------------------------------------------------------
export function attachTiltEffect(el, maxTilt = 7) {
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
// Мелкие модалки (открыть/закрыть с анимацией)
// ---------------------------------------------------------------------------
export function openSmallModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.remove("hidden");
  requestAnimationFrame(() => {
    const panel = modal.querySelector(".modal-panel");
    if (panel) panel.classList.remove("translate-y-6", "opacity-0");
  });
}

export function closeSmallModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  const panel = modal.querySelector(".modal-panel");
  if (panel) panel.classList.add("translate-y-6", "opacity-0");
  setTimeout(() => modal.classList.add("hidden"), 200);
}
