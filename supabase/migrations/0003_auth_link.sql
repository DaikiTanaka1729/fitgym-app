-- ============================================================
-- FitGym 9/20版 認証とプロフィール表の橋渡し
-- ------------------------------------------------------------
-- Supabase Auth でアカウントが作られたとき、members 行を自動で作る。
-- 管理者は画面から作らせず、運用者が grant_admin() で明示的に付与する。
--
-- 重要:権限の判定は必ず admins テーブルで行う。
--   auth.users の raw_user_meta_data は登録時にクライアントから
--   自由に指定できるため、role を名乗るだけで管理者になれてしまう。
--   メタデータは表示名などの参考値としてのみ扱う。
-- ============================================================

-- ------------------------------------------------------------
-- 会員登録時に members 行を作る
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_store_id UUID;
  v_claimed_role TEXT;
BEGIN
  v_claimed_role := COALESCE(NEW.raw_user_meta_data->>'role', 'member');

  -- 管理者として作られたアカウントには members 行を作らない。
  -- (これは「作らない」方向の判定なので、詐称されても権限は増えない)
  IF v_claimed_role IN ('admin', 'staff') THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_store_id FROM stores ORDER BY created_at LIMIT 1;
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION '店舗が1件も登録されていません。先に stores を作成してください。';
  END IF;

  INSERT INTO members (store_id, auth_user_id, name, email, birth_date)
  VALUES (
    v_store_id,
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'name', ''), split_part(NEW.email, '@', 1)),
    NEW.email,
    -- 画面からは 1990/01/01 形式で来る。空文字は NULL として扱う。
    NULLIF(NEW.raw_user_meta_data->>'birth_date', '')::DATE
  )
  ON CONFLICT (email) DO UPDATE
    SET auth_user_id = EXCLUDED.auth_user_id;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- トリガ専用。RPC として呼べないようにする。
REVOKE EXECUTE ON FUNCTION handle_new_user() FROM anon, authenticated;

-- ------------------------------------------------------------
-- 管理者を付与する(運用者が SQL Editor から実行する)
-- ------------------------------------------------------------
-- 使い方:
--   1. Authentication → Users → Add user でアカウントを作る
--   2. SELECT grant_admin('admin@example.com', '山田 太郎', 'admin');
--        role は 'admin'(店舗管理者)または 'staff'(スタッフ)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION grant_admin(
  p_email TEXT,
  p_name  TEXT,
  p_role  TEXT DEFAULT 'admin'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_auth_user_id UUID;
  v_store_id UUID;
  v_admin_id UUID;
BEGIN
  IF p_role NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'role は admin または staff を指定してください(指定値: %)', p_role;
  END IF;

  SELECT id INTO v_auth_user_id FROM auth.users WHERE lower(email) = lower(p_email);
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'auth.users に % が見つかりません。先に Authentication → Users → Add user で作成してください。', p_email;
  END IF;

  SELECT id INTO v_store_id FROM stores ORDER BY created_at LIMIT 1;
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION '店舗が1件も登録されていません。';
  END IF;

  INSERT INTO admins (store_id, auth_user_id, name, email, role)
  VALUES (v_store_id, v_auth_user_id, p_name, lower(p_email), p_role)
  ON CONFLICT (email) DO UPDATE
    SET auth_user_id = EXCLUDED.auth_user_id,
        name = EXCLUDED.name,
        role = EXCLUDED.role
  RETURNING id INTO v_admin_id;

  -- 会員として作られていた場合は取り消す(会員と管理者は兼務しない)
  DELETE FROM members WHERE auth_user_id = v_auth_user_id;

  RETURN v_admin_id;
END;
$fn$;

-- 運用者だけが実行できるようにする。
-- これを外すと、ログイン中の会員が自分を管理者に昇格できてしまう。
REVOKE EXECUTE ON FUNCTION grant_admin(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION grant_admin(TEXT, TEXT, TEXT) FROM anon, authenticated;
