-- ---------------------------------------------------------------------------
-- Умный холодильник — схема базы данных (финальная рабочая версия)
-- Выполните целиком в Supabase Dashboard → SQL Editor → New query
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
  created_at timestamptz default now()
);

create table if not exists household_members (
  household_code text not null references households(code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text,
  joined_at timestamptz default now(),
  primary key (household_code, user_id)
);

create table if not exists api_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  count int not null default 0,
  primary key (user_id, day)
);

-- Индексы
create index if not exists products_household_idx on products (household_code);
create index if not exists members_user_idx on household_members (user_id);

-- ---------------------------------------------------------------------------
-- Включение Row Level Security (RLS)
-- ---------------------------------------------------------------------------
alter table households enable row level security;
alter table products enable row level security;
alter table household_members enable row level security;
alter table api_usage enable row level security;

-- ---------------------------------------------------------------------------
-- Пересоздание политик доступа (RLS)
-- ---------------------------------------------------------------------------

-- 1. Households
drop policy if exists "members can view their household" on households;
create policy "members can view their household" on households
  for select using (
    exists (
      select 1 from household_members hm
      where hm.household_code = households.code and hm.user_id = auth.uid()
    )
  );

-- 2. Household Members
drop policy if exists "members can view their membership rows" on household_members;
create policy "members can view their membership rows" on household_members
  for select using (user_id = auth.uid());

drop policy if exists "members can leave their household" on household_members;
create policy "members can leave their household" on household_members
  for delete using (user_id = auth.uid());

-- 3. Products
drop policy if exists "members can view products of their household" on products;
create policy "members can view products of their household" on products
  for select using (
    exists (
      select 1 from household_members hm
      where hm.household_code = products.household_code and hm.user_id = auth.uid()
    )
  );

drop policy if exists "members can add products to their household" on products;
create policy "members can add products to their household" on products
  for insert with check (
    exists (
      select 1 from household_members hm
      where hm.household_code = products.household_code and hm.user_id = auth.uid()
    )
  );

drop policy if exists "members can update products of their household" on products;
create policy "members can update products of their household" on products
  for update using (
    exists (
      select 1 from household_members hm
      where hm.household_code = products.household_code and hm.user_id = auth.uid()
    )
  );

-- ИСПРАВЛЕНО: удалять продукты могут только члены хозяйства по household_code
drop policy if exists "members can delete products of their household" on products;
create policy "members can delete products of their household" on products
  for delete using (
    exists (
      select 1 from household_members hm
      where hm.household_code = products.household_code and hm.user_id = auth.uid()
    )
  );

-- 4. API Usage
drop policy if exists "users manage their own api usage" on api_usage;
create policy "users manage their own api usage" on api_usage
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Функции SECURITY DEFINER
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
-- Realtime
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and tablename = 'products'
  ) then
    alter publication supabase_realtime add table products;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Дополнение v4: кастомный срок годности + история (product_events)
-- Уже выполняли v1-v3? Пересоздавать всё не нужно — выполните только этот блок.
-- ---------------------------------------------------------------------------

-- Кастомный срок годности (перекрывает автоматический расчёт по категории)
alter table products add column if not exists expiry_override bigint;

-- Лог событий: добавление и удаление (съедено/выброшено) продуктов
create table if not exists product_events (
  id uuid primary key default gen_random_uuid(),
  household_code text not null references households(code) on delete cascade,
  product_name text not null,
  category text not null,
  action text not null check (action in ('added','removed')),
  reason text check (reason in ('eaten','discarded') or reason is null),
  occurred_at timestamptz not null default now(),
  by text
);

create index if not exists product_events_household_idx on product_events (household_code);

alter table product_events enable row level security;

drop policy if exists "members can view events of their household" on product_events;
create policy "members can view events of their household" on product_events
  for select using (
    exists (
      select 1 from household_members hm
      where hm.household_code = product_events.household_code and hm.user_id = auth.uid()
    )
  );

drop policy if exists "members can add events to their household" on product_events;
create policy "members can add events to their household" on product_events
  for insert with check (
    exists (
      select 1 from household_members hm
      where hm.household_code = product_events.household_code and hm.user_id = auth.uid()
    )
  );

-- Realtime для истории (необязательно — можно включить позже без переделок)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'product_events'
  ) then
    alter publication supabase_realtime add table product_events;
  end if;
end $$;
