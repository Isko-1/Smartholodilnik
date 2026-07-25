/**
 * Общее изменяемое состояние приложения.
 * Один объект вместо разрозненных `let` в разных модулях — так каждый
 * модуль читает/пишет актуальные значения без циклических импортов setter'ов.
 */
export const state = {
  sb: null,               // supabase client
  householdCode: null,
  memberName: null,
  currentUser: null,
  productsChannel: null,
  regularsChannel: null,
  presenceChannelRef: null,
  authTab: "login",
  currentTab: "create",
  products: [],
  regulars: [],
  lastAddedId: null
};
