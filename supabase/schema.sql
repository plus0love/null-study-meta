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

alter table public.users          enable row level security;
alter table public.study_sessions enable row level security;
alter table public.todos          enable row level security;
alter table public.daily_goals    enable row level security;
alter table public.attendance     enable row level security;

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

-- 집계 함수도 anon/authenticated 에서는 못 부르게 (PostgREST rpc 차단). service_role 은 그대로.
revoke execute on function public.study_totals(text) from public, anon, authenticated;
revoke execute on function public.attendance_streaks(text, text) from public, anon, authenticated;
revoke execute on function public.list_todos(text, text) from public, anon, authenticated;
