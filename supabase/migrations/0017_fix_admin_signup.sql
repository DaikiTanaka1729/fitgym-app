-- ============================================================
-- 修正:管理者の新規登録が必ず失敗する問題
-- ------------------------------------------------------------
-- 認証アカウントを作ると、トリガによって会員プロフィール(members)が
-- 自動で作られる。register_admin はその行を見て「会員として登録済み」と
-- 判断し、member_account で弾いていた。
--
-- 結果として /admin/signup は誰が使っても失敗していた。
--
-- 自動で作られただけの会員プロフィールは、利用実績が無ければ管理者登録の
-- 際に削除する。予約・回数券・契約・記録のいずれかがある場合は、
-- 実際に会員として使われているアカウントなので従来どおり拒否する。
-- ============================================================

CREATE OR REPLACE FUNCTION register_admin(p_name TEXT)
RETURNS TEXT          -- 'active'(自動承認)または 'pending'
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid       UUID;
  v_email     TEXT;
  v_store_id  UUID;
  v_status    TEXT;
  v_role      TEXT;
  v_member_id UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF length(TRIM(COALESCE(p_name, ''))) = 0 THEN
    RAISE EXCEPTION 'name_required';
  END IF;

  IF EXISTS (SELECT 1 FROM admins a WHERE a.auth_user_id = v_uid) THEN
    RAISE EXCEPTION 'already_registered';
  END IF;

  -- 自動で作られた会員プロフィールの扱い
  SELECT m.id INTO v_member_id FROM members m WHERE m.auth_user_id = v_uid;
  IF v_member_id IS NOT NULL THEN
    -- 実際に会員として使われている場合は、役割を混ぜずに拒否する
    IF EXISTS (SELECT 1 FROM reservations r     WHERE r.member_id  = v_member_id)
       OR EXISTS (SELECT 1 FROM tickets t       WHERE t.member_id  = v_member_id)
       OR EXISTS (SELECT 1 FROM memberships ms  WHERE ms.member_id = v_member_id)
       OR EXISTS (SELECT 1 FROM training_records tr WHERE tr.member_id = v_member_id)
    THEN
      RAISE EXCEPTION 'member_account';
    END IF;
    -- 利用実績が無い(登録しただけ)なら削除して管理者にする
    DELETE FROM members m WHERE m.id = v_member_id;
  END IF;

  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;
  SELECT s.id INTO v_store_id FROM stores s ORDER BY s.created_at LIMIT 1;
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'store_not_found';
  END IF;

  -- 有効な管理者が1人もいなければ、最初の1人として自動承認する
  IF EXISTS (SELECT 1 FROM admins a
              WHERE a.store_id = v_store_id
                AND a.status = 'active'
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
           name   = TRIM(p_name),
           status = v_status
     WHERE a.email = LOWER(v_email) AND a.store_id = v_store_id;
  END;

  RETURN v_status;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION register_admin(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION register_admin(TEXT) TO authenticated;
