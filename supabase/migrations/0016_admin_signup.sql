-- ============================================================
-- 管理者の新規登録(承認制)
-- ------------------------------------------------------------
-- 管理者ログイン画面は誰でも開ける。そこから無条件に管理者を作れると、
-- 第三者が全会員の個人情報を閲覧できてしまう。
--
-- そのため、登録はできるが「承認待ち」から始める設計にする。
--   ・既存の店舗管理者が承認するまで、管理画面は一切操作できない
--   ・店舗に有効な管理者が1人もいない場合だけ、自動で承認する
--     (初期セットアップで詰まらないようにするため)
--
-- 承認の判定は画面ではなくデータベース側で行う。
-- ボタンを隠すだけでは、APIを直接叩けば操作できてしまう。
-- ============================================================

-- ------------------------------------------------------------
-- 承認状態
-- ------------------------------------------------------------
ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

-- 既存の管理者はすべて有効として扱う
UPDATE admins SET status = 'active' WHERE status IS NULL OR status = '';

ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_status_check;
ALTER TABLE admins ADD CONSTRAINT admins_status_check
  CHECK (status IN ('pending', 'active'));

CREATE INDEX IF NOT EXISTS idx_admins_status ON admins(store_id, status);

-- ------------------------------------------------------------
-- 既存の判定関数を「有効な管理者のみ」に絞る
-- ------------------------------------------------------------
-- 承認待ちの管理者がデータを読めてしまわないよう、
-- RLS の土台になっている関数をすべて status で絞る。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM admins a
     WHERE a.auth_user_id = auth.uid() AND a.status = 'active'
  );
$fn$;

CREATE OR REPLACE FUNCTION is_store_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM admins a
     WHERE a.auth_user_id = auth.uid()
       AND a.role = 'admin' AND a.status = 'active'
  );
$fn$;

CREATE OR REPLACE FUNCTION current_admin_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT id FROM admins WHERE auth_user_id = auth.uid() AND status = 'active';
$fn$;

CREATE OR REPLACE FUNCTION current_admin_store_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT store_id FROM admins WHERE auth_user_id = auth.uid() AND status = 'active';
$fn$;

CREATE OR REPLACE FUNCTION can_approve_menus()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM admins a
     WHERE a.auth_user_id = auth.uid()
       AND a.can_approve_menus AND a.status = 'active'
  );
$fn$;

-- ------------------------------------------------------------
-- 管理者の新規登録
-- ------------------------------------------------------------
-- Supabase Auth でのアカウント作成は画面側で済ませ、
-- その直後にこの関数を呼んで admins 行を作る。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION register_admin(p_name TEXT)
RETURNS TEXT          -- 'active'(自動承認)または 'pending'
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid      UUID;
  v_email    TEXT;
  v_store_id UUID;
  v_status   TEXT;
  v_role     TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF length(TRIM(COALESCE(p_name, ''))) = 0 THEN
    RAISE EXCEPTION 'name_required';
  END IF;

  -- すでに管理者として登録済み
  IF EXISTS (SELECT 1 FROM admins a WHERE a.auth_user_id = v_uid) THEN
    RAISE EXCEPTION 'already_registered';
  END IF;

  -- 会員として登録済みのアカウントは管理者にしない(役割を混ぜない)
  IF EXISTS (SELECT 1 FROM members m WHERE m.auth_user_id = v_uid) THEN
    RAISE EXCEPTION 'member_account';
  END IF;

  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;
  SELECT s.id INTO v_store_id FROM stores s ORDER BY s.created_at LIMIT 1;
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'store_not_found';
  END IF;

  -- 有効な管理者が1人もいなければ、最初の1人として自動承認する
  IF EXISTS (SELECT 1 FROM admins a WHERE a.store_id = v_store_id AND a.status = 'active'
                                     AND a.auth_user_id IS NOT NULL) THEN
    v_status := 'pending';
    v_role   := 'staff';
  ELSE
    v_status := 'active';
    v_role   := 'admin';
  END IF;

  BEGIN
    INSERT INTO admins (store_id, auth_user_id, name, email, role, status, can_approve_menus)
    VALUES (v_store_id, v_uid, TRIM(p_name), LOWER(v_email), v_role, v_status,
            v_status = 'active');
  EXCEPTION WHEN unique_violation THEN
    -- 同じメールで先にトレーナーとして登録されている場合は、そこへ紐づける
    UPDATE admins a
       SET auth_user_id = v_uid,
           name = TRIM(p_name),
           status = v_status
     WHERE a.email = LOWER(v_email) AND a.store_id = v_store_id;
  END;

  RETURN v_status;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION register_admin(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION register_admin(TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 自分の管理者情報(承認待ちでも取得できる)
-- ------------------------------------------------------------
-- is_admin() は承認待ちを弾くため、承認待ち本人が自分の状態を
-- 確認できるよう別の入口を用意する。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_my_admin()
RETURNS TABLE (
  id                UUID,
  name              TEXT,
  email             TEXT,
  role              TEXT,
  store_id          UUID,
  status            TEXT,
  can_approve_menus BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  RETURN QUERY
  SELECT a.id, a.name::TEXT, a.email::TEXT, a.role::TEXT,
         a.store_id, a.status::TEXT, a.can_approve_menus
    FROM admins a
   WHERE a.auth_user_id = auth.uid();
END;
$fn$;

REVOKE EXECUTE ON FUNCTION get_my_admin() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION get_my_admin() TO authenticated;

-- ------------------------------------------------------------
-- 承認 / 却下
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION approve_admin(p_admin_id UUID, p_role TEXT DEFAULT 'staff')
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_store_id UUID;
BEGIN
  IF NOT is_store_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_role NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;
  v_store_id := current_admin_store_id();

  UPDATE admins a
     SET status = 'active',
         role   = p_role
   WHERE a.id = p_admin_id AND a.store_id = v_store_id AND a.status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_not_found';
  END IF;

  INSERT INTO audit_logs (store_id, actor_admin_id, action, detail)
  VALUES (v_store_id, current_admin_id(), 'approve_admin',
          jsonb_build_object('admin_id', p_admin_id, 'role', p_role));

  RETURN TRUE;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION approve_admin(UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION approve_admin(UUID, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 管理者の削除(認証アカウントも一緒に消す)
-- ------------------------------------------------------------
-- 従来の delete_staff は admins 行だけを消していた。
-- 画面から登録した管理者は認証アカウントを持つため、
-- そちらも消さないと不要なアカウントが残り続ける。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_staff(p_admin_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_store_id     UUID;
  v_auth_user_id UUID;
  v_remain       INT;
BEGIN
  IF NOT is_store_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_store_id := current_admin_store_id();

  IF p_admin_id = current_admin_id() THEN
    RAISE EXCEPTION 'cannot_delete_self';
  END IF;

  SELECT a.auth_user_id INTO v_auth_user_id
    FROM admins a
   WHERE a.id = p_admin_id AND a.store_id = v_store_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_not_found';
  END IF;

  -- 予約が入っていない枠を先に片付ける
  DELETE FROM slots s
   WHERE s.staff_id = p_admin_id
     AND slot_booked_count(s.id) = 0;

  SELECT COUNT(*)::INT INTO v_remain FROM slots s WHERE s.staff_id = p_admin_id;
  IF v_remain > 0 THEN
    RAISE EXCEPTION 'staff_in_use';
  END IF;

  INSERT INTO audit_logs (store_id, actor_admin_id, action, detail)
  VALUES (v_store_id, current_admin_id(), 'delete_admin',
          jsonb_build_object('admin_id', p_admin_id));

  DELETE FROM admins a WHERE a.id = p_admin_id AND a.store_id = v_store_id;

  -- 会員としても使われていない認証アカウントは削除する
  IF v_auth_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM members m WHERE m.auth_user_id = v_auth_user_id) THEN
    DELETE FROM auth.users u WHERE u.id = v_auth_user_id;
  END IF;

  RETURN TRUE;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION delete_staff(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION delete_staff(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 一覧に承認状態を含める
-- ------------------------------------------------------------
-- admins の RLS は is_admin() を通すため、承認待ちの行も
-- 有効な管理者からは見える。画面で承認操作ができるようにする。
-- ------------------------------------------------------------
