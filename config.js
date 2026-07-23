/**
 * Настройки подключения к бэкенду (Supabase).
 *
 * 1. Зарегистрируйтесь на https://supabase.com (бесплатно) и создайте проект.
 * 2. Откройте Project Settings → API.
 * 3. Скопируйте "Project URL" в поле url ниже.
 * 4. Скопируйте "anon public" ключ в поле anonKey ниже.
 * 5. Выполните файл supabase-schema.sql в SQL Editor вашего проекта.
 * 6. Включите вход по Email (обычно уже включён) и по Google —
 *    Authentication → Providers. Подробная инструкция для Google (Client ID,
 *    Secret, redirect URL) — в README.md.
 * 7. В Authentication → URL Configuration укажите Site URL и Redirect URLs —
 *    это адрес, по которому будет открываться сайт (например, ваша ссылка
 *    на GitHub Pages). Без этого шага вход через Google и восстановление
 *    пароля будут перенаправлять не туда.
 *
 * Пока здесь стоят пустые значения — приложение работает в локальном
 * демо-режиме (данные хранятся только в этом браузере, без синхронизации
 * и без входа в аккаунт).
 */
const SUPABASE_CONFIG = {
  url: "https://jlfvsjibqiieiuvevfqn.supabase.co",
  anonKey: "sb_publishable_A_nUW50CayqQXxzGB3DpfQ_CFrfZbm2"
};

/**
 * Настройки партнёра по доставке (кнопка «Заказать ещё» на карточке продукта).
 *
 * Партнёров пока нет — enabled: false, и кнопка честно показывает модалку
 * «партнёры пока не подключены». Как только появится партнёрская программа
 * (Wolt, Chocofood и т.п.) — правите только этот блок:
 *
 *   1. enabled: true
 *   2. partnerName: "Название партнёра"
 *   3. buildSearchUrl: (productName) => `https://partner.example/search?q=${encodeURIComponent(productName)}`
 *
 * Больше никакой код трогать не нужно — кнопка сама начнёт открывать
 * реальный поиск товара у партнёра в новой вкладке.
 */
const DELIVERY_CONFIG = {
  enabled: false,
  partnerName: "",
  buildSearchUrl: (productName) => null
};
