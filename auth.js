import { state } from "./state.js";
import { safeAddListener, escapeHtml, withBusy } from "./utils.js";
import {
  fetchProductsFromBackend, subscribeToProductChanges,
  fetchRegularsFromBackend, subscribeToRegularsChanges, renderRegulars,
  render
} from "./products.js";

// ---------------------------------------------------------------------------
// Баннер состояния подключения
// ---------------------------------------------------------------------------
export function showModeBanner(state_, detail) {
  const el = document.getElementById("mode-banner");
  if (!el) return;
  el.classList.remove("hidden");
  if (state_ === "connecting") {
    el.textContent = "Подключение к семейному холодильнику…";
    el.className = "text-xs sm:text-sm px-4 py-2.5 text-center font-medium bg-navy/10 text-navy/70";
  } else if (state_ === "connected") {
    el.classList.add("hidden");
  } else if (state_ === "error") {
    const base = "Не удалось подключиться к базе данных.";
    el.textContent = detail ? `${base} (${detail})` : `${base} Проверьте SUPABASE_CONFIG в config.js.`;
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

// ---------------------------------------------------------------------------
// Email / Google авторизация
// ---------------------------------------------------------------------------
async function signUpWithPassword(email, password) {
  const { data, error } = await state.sb.auth.signUp({
    email, password,
    options: { emailRedirectTo: currentRedirectUrl() }
  });
  if (error) throw error;
  return data;
}

async function signInWithPassword(email, password) {
  const { data, error } = await state.sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signInWithGoogle() {
  const { error } = await state.sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: currentRedirectUrl() }
  });
  if (error) throw error;
}

async function requestPasswordReset(email) {
  const { error } = await state.sb.auth.resetPasswordForEmail(email, {
    redirectTo: currentRedirectUrl()
  });
  if (error) throw error;
}

async function setNewPassword(password) {
  const { error } = await state.sb.auth.updateUser({ password });
  if (error) throw error;
}

async function signOutAccount() {
  await state.sb.auth.signOut();
}

// ---------------------------------------------------------------------------
// Онлайн-присутствие членов семьи
// ---------------------------------------------------------------------------
async function subscribeToPresence() {
  if (state.presenceChannelRef) {
    await state.sb.removeChannel(state.presenceChannelRef);
    state.presenceChannelRef = null;
  }
  const memberId = state.currentUser ? state.currentUser.id : crypto.randomUUID();
  const presenceChannel = state.sb.channel(`presence-${state.householdCode}`, {
    config: { presence: { key: memberId } }
  });

  presenceChannel.on("presence", { event: "sync" }, () => {
    renderPresence(presenceChannel.presenceState());
  });

  state.presenceChannelRef = presenceChannel;

  presenceChannel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await presenceChannel.track({ name: state.memberName, joinedAt: Date.now() });
    }
  });
}

function renderPresence(presenceState) {
  const names = Object.values(presenceState).map(arr => arr[0] && arr[0].name).filter(Boolean);
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

// ---------------------------------------------------------------------------
// Вход в семью (household) и первичная загрузка данных
// ---------------------------------------------------------------------------
export async function enterHousehold(code, name) {
  state.householdCode = code.toUpperCase().trim();
  state.memberName = name.trim();

  const onboardingEl = document.getElementById("onboarding");
  const codeDisplay = document.getElementById("household-code-display");
  const subtitleEl = document.getElementById("household-subtitle");

  if (onboardingEl) onboardingEl.classList.add("hidden");
  if (codeDisplay) codeDisplay.textContent = state.householdCode;
  if (subtitleEl) subtitleEl.textContent = `Семья: ${state.householdCode}`;

  showModeBanner("connecting");
  // Данные (продукты/регулярные покупки) грузятся обычным REST-запросом —
  // если он падает, показываем настоящую ошибку: без него холодильник пуст.
  let dataLoaded = false;
  try {
    await fetchProductsFromBackend();
    await fetchRegularsFromBackend();
    dataLoaded = true;
  } catch (err) {
    console.error(err);
    showModeBanner("error");
  }

  // Realtime-подписки (WebSocket) — только для живой синхронизации между
  // устройствами семьи. На некоторых мобильных сетях/браузерах (например,
  // Chrome с включённой «Экономией трафика») WebSocket-подключение может не
  // проходить через сжимающий прокси, хотя обычные HTTPS-запросы работают.
  // Раньше падение любой из этих подписок красило весь баннер в «ошибка»,
  // даже если продукты уже успешно загрузились — это вводило в заблуждение.
  // Теперь такие сбои только логируются в консоль, не перекрывая уже
  // загруженные данные красным баннером.
  if (dataLoaded) {
    try {
      await subscribeToProductChanges();
      await subscribeToRegularsChanges();
      await subscribeToPresence();
      showModeBanner("connected");
    } catch (err) {
      console.error("Realtime-подписка не установилась (живая синхронизация может не работать):", err);
      showModeBanner("connected");
    }
  }

  renderRegulars();
  render();
}

function setTab(tab) {
  state.currentTab = tab;
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
    if (!state.currentUser || !confirm("Покинуть текущую семью? Доступ к её холодильнику пропадёт.")) return;
    const { error } = await state.sb.from("household_members").delete().eq("user_id", state.currentUser.id);
    if (error) {
      console.error(error);
      alert("Не удалось покинуть семью. Попробуйте ещё раз.");
      return;
    }
    location.reload();
  });

  safeAddListener("copy-code-btn", "click", () => {
    if (!state.householdCode) return;
    navigator.clipboard.writeText(state.householdCode).catch(() => {});
    const icon = document.getElementById("copy-code-btn");
    if (icon) {
      icon.classList.add("text-sage");
      setTimeout(() => icon.classList.remove("text-sage"), 1000);
    }
  });

  safeAddListener("onboarding-form", "submit", (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("member-name-input");
    const errorEl = document.getElementById("onboarding-error");
    const submitBtn = e.target.querySelector("button[type=submit]");
    if (errorEl) errorEl.classList.add("hidden");
    if (!nameInput) return;

    const name = nameInput.value.trim();
    if (!name) return;

    withBusy(submitBtn, async () => {
      try {
        if (state.currentTab === "create") {
          const code = generateHouseholdCode();
          const { error } = await state.sb.rpc("create_household", { p_code: code, p_display_name: name });
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
            return;
          }
          const { data: joined, error } = await state.sb.rpc("join_household", { p_code: codeInput, p_display_name: name });
          if (error) throw error;
          if (!joined) {
            if (errorEl) {
              errorEl.textContent = "Семья с таким кодом не найдена.";
              errorEl.classList.remove("hidden");
            }
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
    });
  });
}

// ---------------------------------------------------------------------------
// Экран авторизации
// ---------------------------------------------------------------------------
function showAuthStep(step) {
  ["credentials", "forgot", "check-email", "new-password"].forEach(s => {
    const el = document.getElementById(`auth-step-${s}`);
    if (el) el.classList.toggle("hidden", s !== step);
  });
}

// Перезапускает CSS-анимацию blur-fade на элементе (аналог MagicUI Blur Fade
// без React: снимаем класс, форсируем reflow, ставим обратно).
function restartBlurFade(el) {
  if (!el) return;
  el.classList.remove("blur-fade-swap");
  void el.offsetWidth;
  el.classList.add("blur-fade-swap");
}

// Волна от клика на кнопке (аналог MagicUI Ripple Button без React).
function spawnRipple(button, event) {
  if (!button) return;
  const rect = button.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const ink = document.createElement("span");
  ink.className = "ripple-ink";
  ink.style.width = `${size}px`;
  ink.style.height = `${size}px`;
  ink.style.left = `${(event.clientX ?? rect.left + rect.width / 2) - rect.left - size / 2}px`;
  ink.style.top = `${(event.clientY ?? rect.top + rect.height / 2) - rect.top - size / 2}px`;
  button.appendChild(ink);
  ink.addEventListener("animationend", () => ink.remove());
}

function setAuthTab(tab) {
  state.authTab = tab;
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
  restartBlurFade(document.getElementById("auth-form"));
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

export function initAuthUI() {
  safeAddListener("auth-tab-login", "click", () => setAuthTab("login"));
  safeAddListener("auth-tab-signup", "click", () => setAuthTab("signup"));

  const authSubmitBtn = document.querySelector("#auth-form button[type=submit]");
  if (authSubmitBtn) {
    authSubmitBtn.addEventListener("click", (ev) => spawnRipple(authSubmitBtn, ev));
  }

  safeAddListener("auth-form", "submit", (e) => {
    e.preventDefault();
    const emailInput = document.getElementById("auth-email-input");
    const pwdInput = document.getElementById("auth-password-input");
    const errorEl = document.getElementById("auth-error");
    const infoEl = document.getElementById("auth-info");
    const submitBtn = e.target.querySelector("button[type=submit]");

    if (errorEl) errorEl.classList.add("hidden");
    if (infoEl) infoEl.classList.add("hidden");
    if (!emailInput || !pwdInput) return;

    const email = emailInput.value.trim();
    const password = pwdInput.value;

    withBusy(submitBtn, async () => {
      try {
        if (state.authTab === "login") {
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
    });
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
      const { data: { session } } = await state.sb.auth.getSession();
      await handleAuthenticated(state.currentUser, session);
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
// На загрузке страницы Supabase может вызвать onAuthStateChange("SIGNED_IN")
// и getSession().then(...) почти одновременно для уже залогиненного
// пользователя — это документированная особенность supabase-js, а не баг
// в этом коде. Без защиты это запускает handleAuthenticated()/enterHousehold()
// дважды параллельно: оба раза создаются одинаковые realtime-каналы
// (products-changes-CODE, regulars-changes-CODE, presence-CODE), и на более
// медленной мобильной сети параллельные вызовы чаще сталкиваются друг с
// другом — один из них падает с ошибкой, и баннер показывает «база не
// подключена», хотя данные из первого (успешного) вызова уже отрисовались.
// authHandlingPromise дедуплицирует повторные вызовы, пока первый не завершится.
let authHandlingPromise = null;

export async function handleAuthenticated(user, session) {
  if (authHandlingPromise) return authHandlingPromise;
  authHandlingPromise = runHandleAuthenticated(user, session);
  try {
    await authHandlingPromise;
  } finally {
    authHandlingPromise = null;
  }
}

async function runHandleAuthenticated(user, session) {
  state.currentUser = user;
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
    const { data: membership, error } = await state.sb
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
// Запуск: клиент Supabase, слушатель состояния сессии
// ---------------------------------------------------------------------------
export function initAuth() {
  setTab("create");
  initBackendOnboarding();
  initAuthUI();

  state.sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      if (session) state.currentUser = session.user;
      const authModal = document.getElementById("auth-modal");
      if (authModal) authModal.classList.remove("hidden");
      showAuthStep("new-password");
    } else if (event === "SIGNED_IN" && session) {
      handleAuthenticated(session.user, session);
    } else if (event === "SIGNED_OUT") {
      if (state.productsChannel) { state.sb.removeChannel(state.productsChannel); state.productsChannel = null; }
      if (state.regularsChannel) { state.sb.removeChannel(state.regularsChannel); state.regularsChannel = null; }
      if (state.presenceChannelRef) { state.sb.removeChannel(state.presenceChannelRef); state.presenceChannelRef = null; }
      state.currentUser = null;
      state.householdCode = null;
      state.memberName = null;
      state.products = [];
      state.regulars = [];
      render();
      renderRegulars();
      showAuthScreen();
    }
  });

  state.sb.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      handleAuthenticated(session.user, session);
    } else {
      showAuthScreen();
    }
  });
}