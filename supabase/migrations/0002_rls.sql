-- ════════════════════════════════════════════════════════════
-- 0002_rls.sql —— 行级安全
--
-- 核心原则：**客户端只读，不写**。
--   所有写操作走 Edge Function（service_role 身份，绕过 RLS）。
--   客户端拿 anon key 直连 PostgREST 时，改不动金币、改不动层数。
--   这是"服务端只信自己"在数据库层的最后一道锁。
-- ════════════════════════════════════════════════════════════

alter table public.profiles          enable row level security;
alter table public.runs              enable row level security;
alter table public.battles           enable row level security;
alter table public.idempotency_keys  enable row level security;
alter table public.game_config       enable row level security;

-- ── profiles：自己的档案可读；昵称/偏好允许自己改 ──────────
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

-- 只允许改 nickname/prefs/team_presets。
-- best_layer / endless_unlocked 是进度，必须由 Edge Function 写，
-- 否则玩家一条 UPDATE 就把自己刷成第 999 层。
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id)
  with check (
    auth.uid() = id
    and best_layer       = (select p.best_layer       from public.profiles p where p.id = auth.uid())
    and endless_unlocked = (select p.endless_unlocked from public.profiles p where p.id = auth.uid())
  );

-- ── runs：只读自己的。**没有任何 insert/update/delete 策略** ──
-- 没有策略 = 全部拒绝。写操作只能走 service_role。
drop policy if exists "runs_select_own" on public.runs;
create policy "runs_select_own" on public.runs
  for select using (auth.uid() = user_id);

-- ── battles：只读自己对局下的战斗 ──────────────────────────
drop policy if exists "battles_select_own" on public.battles;
create policy "battles_select_own" on public.battles
  for select using (
    exists (select 1 from public.runs r where r.id = battles.run_id and r.user_id = auth.uid())
  );

-- ── idempotency_keys：客户端完全不可见 ─────────────────────
-- 不建任何策略 = anon/authenticated 一律拒绝。只有 service_role 能碰。

-- ── game_config：所有人可读（前端要拿调参），不可写 ─────────
drop policy if exists "config_read_all" on public.game_config;
create policy "config_read_all" on public.game_config
  for select using (true);
