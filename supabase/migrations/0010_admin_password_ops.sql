-- ============================================================
-- A-08 管理者による会員のパスワード操作
-- ------------------------------------------------------------
-- パスワード再設定追補 第3章の「仮パスワードを発行」に対応する。
--
-- 他人のパスワードを書き換える操作なので、クライアント(anon キー)からは
-- 実行できない。権限確認をデータベース側に置いた関数で行う。
--
--   ・実行できるのは店舗管理者(role = 'admin')のみ。スタッフは不可。
--   ・対象は自店舗の会員のみ。
--   ・発行と同時に must_change_password を立て、初回ログイン時に
--     本人のパスワードへの変更を強制する。
--   ・操作は audit_logs に記録する。仮パスワードそのものは記録しない。
--
-- 仮パスワードは画面側で生成し、この関数へ渡す。DBには bcrypt ハッシュ
-- しか残らない。管理者は口頭・書面で会員に伝える運用とする。
-- ============================================================

CREATE OR REPLACE FUNCTION issue_temp_password(p_member_id UUID, p_temp_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_store_id     UUID;
  v_auth_user_id UUID;
  v_actor        UUID;
BEGIN
  IF NOT is_store_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_store_id := current_admin_store_id();
  v_actor    := current_admin_id();

  SELECT m.auth_user_id INTO v_auth_user_id
    FROM members m
   WHERE m.id = p_member_id AND m.store_id = v_store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_not_found';
  END IF;
  IF v_auth_user_id IS NULL THEN
    -- 会員登録が完了していない(認証アカウントがない)
    RAISE EXCEPTION 'user_not_found';
  END IF;
  IF length(COALESCE(p_temp_password, '')) < 8 THEN
    RAISE EXCEPTION 'weak_password';
  END IF;

  UPDATE auth.users
     SET encrypted_password = extensions.crypt(p_temp_password, extensions.gen_salt('bf')),
         updated_at = now()
   WHERE id = v_auth_user_id;

  UPDATE members
     SET must_change_password = TRUE
   WHERE id = p_member_id;

  INSERT INTO audit_logs (store_id, actor_admin_id, target_member_id, action, detail)
  VALUES (v_store_id, v_actor, p_member_id, 'issue_temp_password',
          jsonb_build_object('at', now()));

  RETURN TRUE;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION issue_temp_password(UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION issue_temp_password(UUID, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 会員が自分でパスワードを変更し終えたときのフラグ解除
-- ------------------------------------------------------------
-- 会員自身が members を更新できるポリシーはあるが、
-- このフラグだけを確実に落とすための入口を用意しておく。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION clear_must_change_password()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_member_id UUID;
BEGIN
  v_member_id := current_member_id();
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE members SET must_change_password = FALSE WHERE id = v_member_id;
  RETURN TRUE;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION clear_must_change_password() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION clear_must_change_password() TO authenticated;

-- ------------------------------------------------------------
-- 会員が自分のプロフィールを取得する(初回パスワード変更の判定に使う)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_my_profile()
RETURNS TABLE (
  id                   UUID,
  name                 TEXT,
  email                TEXT,
  store_id             UUID,
  must_change_password BOOLEAN
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
  SELECT m.id, m.name::TEXT, m.email::TEXT, m.store_id, m.must_change_password
    FROM members m
   WHERE m.auth_user_id = auth.uid();
END;
$fn$;

REVOKE EXECUTE ON FUNCTION get_my_profile() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION get_my_profile() TO authenticated;

-- ------------------------------------------------------------
-- 監査ログの閲覧(会員詳細でパスワード操作の履歴を出す)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_member_audit(p_member_id UUID)
RETURNS TABLE (
  action     TEXT,
  actor_name TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT l.action::TEXT, a.name::TEXT, l.created_at
    FROM audit_logs l
    LEFT JOIN admins a ON a.id = l.actor_admin_id
   WHERE l.target_member_id = p_member_id
     AND l.store_id = current_admin_store_id()
   ORDER BY l.created_at DESC
   LIMIT 20;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_member_audit(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_member_audit(UUID) TO authenticated;
