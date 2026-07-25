// ---------------------------------------------------------------------------
// Конфигурация категорий: срок годности (в днях) и иконки
// ---------------------------------------------------------------------------
export const CATEGORIES = {
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

export const STATUS_META = {
  red:    { label: "Съесть срочно", ring: "#BC4B34", chip: "bg-[#BC4B34]/15 text-[#8f3623]", pulse: true },
  yellow: { label: "Срок подходит", ring: "#D6A24C", chip: "bg-[#D6A24C]/20 text-[#8a6520]", pulse: false },
  green:  { label: "Свежий",        ring: "#059669", chip: "bg-[#059669]/15 text-[#065f46]", pulse: false }
};

// ---------------------------------------------------------------------------
// Расчёт свежести
// ---------------------------------------------------------------------------
export function getExpiry(product) {
  const cat = CATEGORIES[product.category] || CATEGORIES.other;
  const expiresAt = product.expiryOverride
    ? product.expiryOverride
    : product.addedAt + cat.days * 24 * 60 * 60 * 1000;
  const msLeft = expiresAt - Date.now();
  const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
  let status;
  if (daysLeft <= 1) status = "red";
  else if (daysLeft <= 3) status = "yellow";
  else status = "green";
  return { daysLeft, status, expiresAt };
}

export function fillCategoryOptions(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = Object.entries(CATEGORIES)
    .map(([key, c]) => `<option value="${key}">${c.label}</option>`)
    .join("");
}
