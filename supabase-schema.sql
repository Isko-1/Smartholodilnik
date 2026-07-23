-- ---------------------------------------------------------------------------
-- Умный холодильник — схема базы данных (v3, с настоящей авторизацией)
-- Выполните целиком в Supabase Dashboard → SQL Editor → New query
--
-- ВАЖНО: перед выполнением включите провайдеры входа:
-- Authentication → Sign In / Providers → Email → Enable (обычно включён по умолчанию)
-- Authentication → Sign In / Providers → Google → Enable (см. README, как получить
-- Client ID/Secret в Google Cloud Console)
--
-- auth.uid() теперь берётся из настоящей учётной записи пользователя
-- (email+пароль или Google), а не из анонимной сессии браузера — доступ
-- к семье привязан к аккаунту человека, а не к конкретному устройству.
--
-- Если вы уже выполняли предыдущую версию этого файла (v1/v2), не нужно
-- пересоздавать всё заново — просто выполните блок «Дополнение v3» в самом
-- низу файла, он добавляет только то, чего не было раньше.
-- ---------------------------------------------------------------------------

create table if not exists households (
  code text primary key,
  created_at timestamptz default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  household_code text not null references households(code) on delete cascade,
  name text not null,
  category text not null,
  added_at bigint not null,
  added_by text,
  expires_at bigint,              -- если задано вручную, перекрывает авторасчёт по категории
  created_at timestamptz default now()
);

-- История: одна строка на весь жизненный цикл продукта (что купили и когда
-- убрали). Не зависит от products — переживает удаление самой строки в
-- products, поэтому это отдельная таблица, а не производная от неё.
create table if not exists product_history (
  id uuid primary key,            -- тот же id, что был у строки в products
  household_code text not null references households(code) on delete cascade,
  name text not null,
  category text not null,
  added_at bigint not null,
  removed_at bigint,               -- null, пока продукт ещё в холодильнике
  added_by text,
  created_at timestamptz default now()
);
create index if not exists history_household_idx on product_history (household_code, added_at desc);

-- Кто состоит в какой семье. user_id берётся из анонимной сессии Supabase Auth
-- (стабилен для конкретного браузера/устройства, пока не очищено хранилище).
create table if not exists household_members (
  household_code text not null references households(code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text,
  joined_at timestamptz default now(),
  primary key (household_code, user_id)
);

create index if not exists products_household_idx on products (household_code);
create index if not exists members_user_idx on household_members (user_id);

-- ---------------------------------------------------------------------------
-- Row Level Security: видно и редактируемо только то, что относится
-- к семьям, участником которых является текущий пользователь
-- ---------------------------------------------------------------------------
alter table households enable row level security;
alter table products enable row level security;
alter table household_members enable row level security;

create policy "members can view their household" on households
  for select using (
    exists (
      select 1 from household_members hm
      where hm.household_code = households.code and hm.user_id = auth.uid()
    )
  );

create policy "members can view their membership rows" on household_members
  for select using (user_id = auth.uid());

create policy "members can leave their household" on household_members
  for delete using (user_id = auth.uid());

create policy "members can view products of their household" on products
  for select using (
    exists (
      select 1 from household_members hm
      where hm.household_code = products.household_code and hm.user_id = auth.uid()
    )
  );

create policy "members can add products to their household" on products
  for insert with check (
    exists (
      select 1 from household_members hm
      where hm.household_code = products.household_code and hm.user_id = auth.uid()
    )
  );

create policy "members can update products of their household" on products
  for update using (
    exists (
      select 1 from household_members hm
      where hm.household_code = products.household_code and hm.user_id = auth.uid()
    )
  );

create policy "members can delete products of their household" on products
  for delete using (
    exists (
      select 1 from household_members hm
      where hm.household_code = products.household_code and hm.user_id = auth.uid()
    )
  );

alter table product_history enable row level security;

create policy "members can view history of their household" on product_history
  for select using (
    exists (
      select 1 from household_members hm
      where hm.household_code = product_history.household_code and hm.user_id = auth.uid()
    )
  );

create policy "members can add history rows for their household" on product_history
  for insert with check (
    exists (
      select 1 from household_members hm
      where hm.household_code = product_history.household_code and hm.user_id = auth.uid()
    )
  );

create policy "members can close out history rows of their household" on product_history
  for update using (
    exists (
      select 1 from household_members hm
      where hm.household_code = product_history.household_code and hm.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER функции: единственный способ создать семью или
-- присоединиться к ней. Работают в обход RLS ровно настолько, чтобы можно
-- было проверить существование кода и добавить самого себя в участники —
-- и ни байтом больше.
-- ---------------------------------------------------------------------------
create or replace function create_household(p_code text, p_display_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  insert into households(code) values (p_code);
  insert into household_members(household_code, user_id, display_name)
  values (p_code, auth.uid(), p_display_name);
end;
$$;

create or replace function join_household(p_code text, p_display_name text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  code_exists boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select exists(select 1 from households where code = p_code) into code_exists;
  if not code_exists then
    return false;
  end if;
  insert into household_members(household_code, user_id, display_name)
  values (p_code, auth.uid(), p_display_name)
  on conflict (household_code, user_id) do update set display_name = excluded.display_name;
  return true;
end;
$$;

grant execute on function create_household(text, text) to anon, authenticated;
grant execute on function join_household(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: включаем стриминг изменений products.
-- Supabase Realtime сам уважает RLS выше — participant увидит только
-- изменения в своей семье.
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- Дневной лимит вызовов Spoonacular на пользователя — защищает общую
-- (небольшую) дневную квоту API от того, что один аккаунт съест её всю
-- за раз. Используется только Edge Function supabase/functions/recipes.
-- ---------------------------------------------------------------------------
create table if not exists api_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  count int not null default 0,
  primary key (user_id, day)
);

alter table api_usage enable row level security;

create policy "users manage their own api usage" on api_usage
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter publication supabase_realtime add table products;

-- ---------------------------------------------------------------------------
-- Дополнение v3 — выполните ЭТОТ блок отдельно, если у вас уже была
-- применена версия v1/v2 схемы (создание таблиц выше упадёт с ошибкой
-- "already exists", а этот блок безопасно выполнить повторно).
-- ---------------------------------------------------------------------------
drop policy if exists "members can leave their household" on household_members;
create policy "members can leave their household" on household_members
  for delete using (user_id = auth.uid());

create table if not exists api_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  count int not null default 0,
  primary key (user_id, day)
);
alter table api_usage enable row level security;
drop policy if exists "users manage their own api usage" on api_usage;
create policy "users manage their own api usage" on api_usage
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Дополнение v4 — свой срок годности + история покупок. Безопасно выполнить
-- повторно, если часть уже применена.
-- ---------------------------------------------------------------------------
alter table products add column if not exists expires_at bigint;

create table if not exists product_history (
  id uuid primary key,
  household_code text not null references households(code) on delete cascade,
  name text not null,
  category text not null,
  added_at bigint not null,
  removed_at bigint,
  added_by text,
  created_at timestamptz default now()
);
create index if not exists history_household_idx on product_history (household_code, added_at desc);

alter table product_history enable row level security;

drop policy if exists "members can view history of their household" on product_history;
create policy "members can view history of their household" on product_history
  for select using (
    exists (
      select 1 from household_members hm
      where hm.household_code = product_history.household_code and hm.user_id = auth.uid()
    )
  );

drop policy if exists "members can add history rows for their household" on product_history;
create policy "members can add history rows for their household" on product_history
  for insert with check (
    exists (
      select 1 from household_members hm
      where hm.household_code = product_history.household_code and hm.user_id = auth.uid()
    )
  );

drop policy if exists "members can close out history rows of their household" on product_history;
create policy "members can close out history rows of their household" on product_history
  for update using (
    exists (
      select 1 from household_members hm
      where hm.household_code = product_history.household_code and hm.user_id = auth.uid()
    )
  );
