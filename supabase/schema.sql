-- Null Study Meta — 영구 데이터 스키마 (Supabase SQL Editor 에서 실행. 여러 번 실행해도 안전)
-- 서버는 service_role 키로만 접근한다. RLS 는 켜고 정책은 없음 → anon/authenticated 는 어떤 행도 읽고 쓸 수 없다.
-- 실시간 상태(접속자·좌석·타이머·강아지 위치)는 서버 메모리에만 있고, 여기엔 영구 데이터만 둔다.

create table if not exists public.users (
  nickname    text primary key,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  avatar      jsonb,
  dog_name    text
);
alter table public.users add column if not exists updated_at timestamptz not null default now();
-- 8단계: 코인 잔액 (모든 증감은 coin_ledger 에 남고, adjust_coins() 로만 바꾼다)
alter table public.users add column if not exists coins integer not null default 0;
-- 코인으로 바뀌지 못하고 남은 공부 초 (세션마다 10분 단위로 내림하고 나머지를 이월, 다음 정산 때 합산. 기록 초기화 시 0)
alter table public.users add column if not exists coin_carry_seconds integer not null default 0;
-- 9단계: 내 책상 소품 슬롯 3개 (inventory.id 또는 null 의 배열) + "내가 놓은 가구는 나만 이동·회수" 설정
alter table public.users add column if not exists desk_items jsonb not null default '[null, null, null]'::jsonb;
alter table public.users add column if not exists layout_lock boolean not null default false;
-- 10단계: 내 펫 설정 { active: inventory.id|null, pets: { [inventory.id]: { name, cosmetics: { head, neck, back }, skills: [] } } }
alter table public.users add column if not exists pet_config jsonb;

create table if not exists public.study_sessions (
  id          bigint generated always as identity primary key,
  nickname    text not null references public.users(nickname) on delete cascade,
  started_at  timestamptz not null,
  ended_at    timestamptz not null,
  seconds     integer not null check (seconds >= 0)
);
create index if not exists study_sessions_nickname_started_at on public.study_sessions (nickname, started_at);

create table if not exists public.todos (
  id          bigint generated always as identity primary key,
  nickname    text not null references public.users(nickname) on delete cascade,
  text        text not null,
  done        boolean not null default false,
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
create index if not exists todos_nickname_created_at on public.todos (nickname, created_at);

create table if not exists public.daily_goals (
  nickname        text not null references public.users(nickname) on delete cascade,
  date            date not null,
  goal_text       text,
  target_minutes  integer,
  primary key (nickname, date)
);

create table if not exists public.attendance (
  nickname  text not null references public.users(nickname) on delete cascade,
  date      date not null,
  primary key (nickname, date)
);

-- 8단계: 코인 원장 — 증감 이력 전부 (reason: study | focus | purchase:<itemId>)
create table if not exists public.coin_ledger (
  id          bigint generated always as identity primary key,
  nickname    text not null references public.users(nickname) on delete cascade,
  delta       integer not null check (delta <> 0),
  reason      text not null,
  created_at  timestamptz not null default now()
);
create index if not exists coin_ledger_nickname_created_at on public.coin_ledger (nickname, created_at);

-- 8단계: 인벤토리 — 구매한 아이템 (카탈로그는 서버 코드 shop.js)
create table if not exists public.inventory (
  id           bigint generated always as identity primary key,
  nickname     text not null references public.users(nickname) on delete cascade,
  item_id      text not null,
  acquired_at  timestamptz not null default now(),
  meta         jsonb not null default '{}'::jsonb
);
create index if not exists inventory_nickname_acquired_at on public.inventory (nickname, acquired_at);

-- 9단계: 방에 놓인 공용 가구. 규칙(겹침·벽 전용·권한)은 서버(server/game/layout.js)가 검증하고 여기엔 결과만 둔다.
-- inventory_id: 어떤 보유 아이템을 놓았는지 (회수하면 행을 지우고 그 아이템은 다시 팔레트에 보인다). rotation 1 = 시계 90°
create table if not exists public.room_layout (
  id            bigint generated always as identity primary key,
  room_id       text not null,
  item_id       text not null,
  inventory_id  bigint references public.inventory(id) on delete cascade,
  x             integer not null,
  y             integer not null,
  rotation      integer not null default 0,
  meta          jsonb not null default '{}'::jsonb,
  placed_by     text references public.users(nickname) on delete set null,
  placed_at     timestamptz not null default now()
);
create index if not exists room_layout_room_id on public.room_layout (room_id);
create unique index if not exists room_layout_inventory_id on public.room_layout (inventory_id);

-- 10단계: 방에 풀린 공용 펫 (최대 3마리, 서버가 검증) + 기존 강아지의 꾸미기/스킬 설정 행(item_id = 'dog', inventory_id null)
-- cosmetics: { head, neck, back } 각각 { inventoryId, itemId, variant } | null. skills: ['come', 'sleep_beside', 'high_five'] 중 산 것
create table if not exists public.room_pets (
  id            bigint generated always as identity primary key,
  room_id       text not null,
  item_id       text not null,
  inventory_id  bigint references public.inventory(id) on delete cascade,
  name          text not null,
  released_by   text references public.users(nickname) on delete set null,
  released_at   timestamptz not null default now(),
  cosmetics     jsonb not null default '{}'::jsonb,
  skills        jsonb not null default '[]'::jsonb
);
create index if not exists room_pets_room_id on public.room_pets (room_id);
create unique index if not exists room_pets_inventory_id on public.room_pets (inventory_id);

alter table public.users          enable row level security;
alter table public.study_sessions enable row level security;
alter table public.todos          enable row level security;
alter table public.daily_goals    enable row level security;
alter table public.attendance     enable row level security;
alter table public.coin_ledger    enable row level security;
alter table public.inventory      enable row level security;
alter table public.room_layout    enable row level security;
alter table public.room_pets      enable row level security;

-- ── 집계 함수 ─────────────────────────────────────────────────────────
-- 시간대(tz, 기본 Asia/Seoul) 기준 0시에 날이 바뀌고 주는 월요일에 시작한다 (date_trunc('week') = ISO 월요일).
-- 세션은 started_at 이 속한 날짜로 집계한다. 서버 메모리 저장소(server/store/stats.js)와 같은 규칙.

-- 닉네임별 오늘 / 이번 주 합계(초)
create or replace function public.study_totals(tz text default 'Asia/Seoul')
returns table (nickname text, today_seconds bigint, week_seconds bigint)
language sql stable
as $$
  with bounds as (
    select (now() at time zone tz)::date as today,
           date_trunc('week', (now() at time zone tz)::date)::date as week_start
  )
  select s.nickname,
         coalesce(sum(s.seconds) filter (where (s.started_at at time zone tz)::date = b.today), 0)::bigint as today_seconds,
         coalesce(sum(s.seconds) filter (where (s.started_at at time zone tz)::date between b.week_start and b.today), 0)::bigint as week_seconds
  from public.study_sessions s cross join bounds b
  group by s.nickname
$$;

-- 출석 스트릭: 오늘 출석했으면 오늘부터, 아니면 어제부터 거슬러 센 연속 일수 + 이번 주 출석 일수 + 오늘 출석 여부
create or replace function public.attendance_streaks(tz text default 'Asia/Seoul', only_nickname text default null)
returns table (nickname text, streak integer, week_days integer, attended_today boolean)
language sql stable
as $$
  with bounds as (
    select (now() at time zone tz)::date as today,
           date_trunc('week', (now() at time zone tz)::date)::date as week_start
  ),
  runs as (
    -- 연속된 날짜는 (date - 순번) 이 같다
    select a.nickname, a.date, a.date - (row_number() over (partition by a.nickname order by a.date))::int as grp
    from public.attendance a
    where only_nickname is null or a.nickname = only_nickname
  ),
  run_agg as (
    select nickname, grp, count(*)::int as len, max(date) as last_date
    from runs group by nickname, grp
  ),
  nicks as (
    select distinct nickname from runs
  )
  select n.nickname,
         coalesce((select r.len from run_agg r, bounds b
                   where r.nickname = n.nickname and r.last_date >= b.today - 1
                   order by r.last_date desc limit 1), 0) as streak,
         (select count(*)::int from public.attendance a, bounds b
           where a.nickname = n.nickname and a.date between b.week_start and b.today) as week_days,
         exists (select 1 from public.attendance a, bounds b where a.nickname = n.nickname and a.date = b.today) as attended_today
  from nicks n
$$;

-- 할 일 목록: 미완료 전부 + 오늘 완료한 것. 어제 이전에 만든 미완료는 carried(이월) 로 맨 위
create or replace function public.list_todos(p_nickname text, tz text default 'Asia/Seoul')
returns table (id bigint, nickname text, text text, done boolean, created_at timestamptz, done_at timestamptz, carried boolean)
language sql stable
as $$
  with bounds as (select (now() at time zone tz)::date as today)
  select t.id, t.nickname, t.text, t.done, t.created_at, t.done_at,
         (not t.done and (t.created_at at time zone tz)::date < b.today) as carried
  from public.todos t cross join bounds b
  where t.nickname = p_nickname
    and (not t.done or (t.done_at is not null and (t.done_at at time zone tz)::date = b.today))
  order by carried desc, t.created_at asc
$$;

-- 8단계: 코인 증감 — 잔액 확인·차감·원장 기록을 한 트랜잭션으로. 잔액이 모자라면 ok=false 로 돌려주고 아무것도 바꾸지 않는다.
-- (행 잠금이 걸린 update 로 확인·차감을 동시에 하므로 같은 사람의 동시 구매도 음수가 되지 않는다)
create or replace function public.adjust_coins(p_nickname text, p_delta integer, p_reason text, p_at timestamptz default now())
returns table (ok boolean, balance integer, entry_id bigint, created_at timestamptz)
language plpgsql
as $$
declare
  v_balance integer;
  v_id bigint;
begin
  if p_delta is null or p_delta = 0 then
    raise exception 'delta must be non-zero';
  end if;
  insert into public.users (nickname) values (p_nickname) on conflict (nickname) do nothing;
  update public.users u
     set coins = u.coins + p_delta, updated_at = now()
   where u.nickname = p_nickname and u.coins + p_delta >= 0
  returning u.coins into v_balance;
  if not found then
    select u.coins into v_balance from public.users u where u.nickname = p_nickname;
    return query select false, coalesce(v_balance, 0), null::bigint, null::timestamptz;
    return;
  end if;
  insert into public.coin_ledger (nickname, delta, reason, created_at)
  values (p_nickname, p_delta, coalesce(p_reason, ''), coalesce(p_at, now()))
  returning coin_ledger.id into v_id;
  return query select true, v_balance, v_id, coalesce(p_at, now());
end
$$;

-- 8단계: 닉네임별 잔액 + 이번 주 획득 코인(양수 delta 합, 월요일부터). 랭킹 "이번 주 코인" 탭
create or replace function public.coin_stats(tz text default 'Asia/Seoul')
returns table (nickname text, coins integer, week_coins bigint)
language sql stable
as $$
  with bounds as (
    select (now() at time zone tz)::date as today,
           date_trunc('week', (now() at time zone tz)::date)::date as week_start
  )
  select u.nickname,
         u.coins,
         coalesce((select sum(l.delta) from public.coin_ledger l, bounds b
                    where l.nickname = u.nickname and l.delta > 0
                      and (l.created_at at time zone tz)::date between b.week_start and b.today), 0)::bigint as week_coins
  from public.users u
  where u.coins > 0
     or exists (select 1 from public.coin_ledger l, bounds b
                 where l.nickname = u.nickname and l.delta > 0
                   and (l.created_at at time zone tz)::date between b.week_start and b.today)
$$;

-- 집계 함수도 anon/authenticated 에서는 못 부르게 (PostgREST rpc 차단). service_role 은 그대로.
revoke execute on function public.study_totals(text) from public, anon, authenticated;
revoke execute on function public.attendance_streaks(text, text) from public, anon, authenticated;
revoke execute on function public.list_todos(text, text) from public, anon, authenticated;
revoke execute on function public.adjust_coins(text, integer, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.coin_stats(text) from public, anon, authenticated;
