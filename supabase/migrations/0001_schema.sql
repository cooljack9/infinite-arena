-- ════════════════════════════════════════════════════════════
-- 0001_schema.sql —— 表结构
-- 无限勇者竞技场 · Supabase Postgres
-- ════════════════════════════════════════════════════════════

-- ── 玩家档案（账号级，跨局持久）────────────────────────────
create table if not exists public.profiles (
  id               uuid primary key references auth.users on delete cascade,
  nickname         text,
  best_layer       int  not null default 0,
  endless_unlocked boolean not null default false,
  team_presets     jsonb not null default '[]'::jsonb,
  prefs            jsonb not null default '{"battleSpeed":1,"colorblind":false}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- 新用户注册时自动建档，省得每个入口都判空
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nickname)
  values (new.id, coalesce(new.raw_user_meta_data->>'nickname', '勇者' || substr(new.id::text, 1, 6)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ── 对局（一次爬塔）──────────────────────────────────────
create table if not exists public.runs (
  id           text primary key,
  user_id      uuid not null references auth.users on delete cascade,

  -- 乐观锁。每次写 +1；客户端带着旧 version 来写 → STATE_STALE
  -- 挡的是多标签页并发和恶意重放，不是网络重试（那个靠 idempotency_keys）
  version      int  not null default 1,

  -- 回放兼容性契约。旧号存的 replay 必须能用同号引擎放出来
  core_version text not null,

  -- ★★ 服务端秘密：整局所有掉落/Boss/商店的母体 ★★
  --    这一列**永不下发**。下发即等于玩家可以预演整局、挑最优路线，
  --    排行榜当场作废。读取一律走 runs_public 视图（见 0003）。
  seed         bigint not null,

  layer        int  not null default 1,
  status       text not null default 'active'
                 check (status in ('active','won','lost','abandoned')),

  -- RunSnapshot 全量（不含 seed）
  snapshot     jsonb not null,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists runs_user_status_idx on public.runs (user_id, status);
create index if not exists runs_leaderboard_idx on public.runs (user_id, layer desc)
  where status in ('won','lost');


-- ── 战斗记录（用于回放、反作弊、漂移监测）────────────────
create table if not exists public.battles (
  id              text primary key,
  run_id          text not null references public.runs on delete cascade,
  layer           int  not null,
  battle_seed     bigint not null,

  -- 服务端权威 trace 校验和
  checksum        text not null,
  -- 前端本地复现算出的值。两者不等 = 引擎漂移（多半是旧缓存页面）
  client_checksum text,

  outcome         jsonb not null,
  created_at      timestamptz not null default now()
);

create index if not exists battles_run_idx on public.battles (run_id, layer);
-- 漂移监测：抓 checksum 不一致的记录
create index if not exists battles_drift_idx on public.battles (created_at desc)
  where client_checksum is not null and client_checksum <> checksum;


-- ── 幂等键 ────────────────────────────────────────────────
-- 倒计时结束瞬间的连点、断网重试，靠这张表兜住：
-- 同 key 第二次进来直接回放上次响应，不重复扣费/不重复发奖
create table if not exists public.idempotency_keys (
  key        text primary key,
  user_id    uuid not null references auth.users on delete cascade,
  action     text not null,
  response   jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idem_gc_idx on public.idempotency_keys (created_at);


-- ── 运行时配置（数值调参，改数值不用重新部署函数）────────
create table if not exists public.game_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

comment on column public.runs.seed is
  '服务端秘密种子，永不下发。客户端读取请用 runs_public 视图。';
