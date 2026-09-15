-- ════════════════════════════════════════════════════════════
-- 0003_views_leaderboard.sql —— 脱敏视图 + 排行榜
-- ════════════════════════════════════════════════════════════

-- ── 脱敏视图：物理上没有 seed 列 ──────────────────────────
--
-- 为什么不靠"列级权限"而用视图：
--   RLS 是行级的，允许 select 就能读到整行（含 seed）。
--   列级 grant 虽然也能做，但 PostgREST 的报错信息会泄露列名，
--   而且新加列时默认可见——容易漏。视图是白名单，加列不会意外暴露。
create or replace view public.runs_public
with (security_invoker = true) as
  select id, user_id, version, core_version, layer, status, snapshot, created_at, updated_at
  from public.runs;
  --      ↑ 无 seed 列

revoke all on public.runs from anon, authenticated;
grant select on public.runs_public to authenticated;


-- ── 排行榜（物化视图）─────────────────────────────────────
--
-- 用物化视图而非实时聚合：免费版 CPU 有限，
-- 每次打开排行榜都全表 max() 扫，几千条之后就开始肉眼可见地卡。
-- 5 分钟延迟对爬塔榜完全可接受。
drop materialized view if exists public.leaderboard;
create materialized view public.leaderboard as
  select
    row_number() over (order by max(r.layer) desc, min(r.created_at) asc) as rank,
    p.id          as user_id,
    p.nickname,
    max(r.layer)  as best_layer,
    count(*)      as total_runs,
    max(r.updated_at) as last_played
  from public.runs r
  join public.profiles p on p.id = r.user_id
  where r.status in ('won', 'lost')          -- abandoned 不上榜
  group by p.id, p.nickname
  order by best_layer desc
  limit 200;

create unique index if not exists leaderboard_rank_idx on public.leaderboard (rank);
-- unique index 是 refresh concurrently 的前提（刷新时不锁表）

grant select on public.leaderboard to anon, authenticated;


-- ── 定时刷新 ──────────────────────────────────────────────
-- 需要在 Supabase Dashboard → Database → Extensions 里启用 pg_cron。
-- 若不想开扩展，也可以让 Edge Function 在 ackBattle 后异步触发刷新。
create extension if not exists pg_cron;

select cron.unschedule('refresh-leaderboard')
  where exists (select 1 from cron.job where jobname = 'refresh-leaderboard');

select cron.schedule(
  'refresh-leaderboard',
  '*/5 * * * *',
  $$ refresh materialized view concurrently public.leaderboard $$
);


-- ── 幂等键清理 ────────────────────────────────────────────
-- 24 小时前的键没有保留价值，留着白占 500MB 免费空间
select cron.schedule(
  'gc-idempotency',
  '17 * * * *',
  $$ delete from public.idempotency_keys where created_at < now() - interval '24 hours' $$
);
