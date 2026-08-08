-- 0004_security_hardening.sql
-- 安全加固（Supabase Security Advisor）：
--   handle_new_user 是 SECURITY DEFINER（要访问 auth schema 建 profile），
--   但不应允许 anon / authenticated 直接调用（可绕过 RLS 造 profile）。
--   它只由 auth.users 的 INSERT 触发器调用（postgres 身份，不受此 revoke 影响）。

revoke execute on function public.handle_new_user() from public;

-- 明确兜底（anon / authenticated 都是 PUBLIC 成员，上面已覆盖，这里再显式声明防未来加角色）
revoke execute on function public.handle_new_user() from anon, authenticated;
