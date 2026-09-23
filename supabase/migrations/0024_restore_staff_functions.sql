-- ============================================================
-- トレーナーの追加・編集ができない問題を直す
-- ------------------------------------------------------------
-- 0015 で用意した create_staff / update_staff が
-- データベースに入っていなかった。画面から呼ぶと
--   Could not find the function public.update_staff(...) in the schema cache
-- となり、トレーナーの追加と、権限の変更(スタッフ→店舗管理者)が
-- できない状態だった。
--
-- 0015 をそのまま流し直すと、同じファイルに入っている古い delete_staff が
-- 0016 の新しい版(認証アカウントも一緒に消す)を上書きしてしまう。
-- そのため、足りない2つだけをここで作り直す。
-- 0015 の定義と同じ内容。
-- ============================================================

-- ------------------------------------------------------------
-- 追加
-- ------------------------------------------------------------
-- トレーナーは受付枠を持つだけならログイン不要。
-- 管理画面に入れる必要が出たら、別途 grant_admin で認証アカウントを紐づける。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_staff(
  p_name  TEXT,
  p_email TEXT,
  p_role  TEXT DEFAULT 'staff'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_store_id UUID;
  v_id       UUID;
BEGIN
  IF NOT is_store_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_store_id := current_admin_store_id();

  IF length(TRIM(COALESCE(p_name, ''))) = 0 THEN
    RAISE EXCEPTION 'name_required';
  END IF;
  IF COALESCE(p_email, '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'invalid_email';
  END IF;
  IF p_role NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;

  BEGIN
    INSERT INTO admins (store_id, name, email, role)
    VALUES (v_store_id, TRIM(p_name), LOWER(TRIM(p_email)), p_role)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'email_exists';
  END;

  RETURN v_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION create_staff(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION create_staff(TEXT, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 編集(氏名・権限)
-- ------------------------------------------------------------
-- メールアドレスは認証アカウントの紐づけに使うため、ここからは変えない。
-- 自分自身を店舗管理者から降ろすと、誰も権限を戻せなくなるので止める。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_staff(
  p_admin_id UUID,
  p_name     TEXT,
  p_role     TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_store_id UUID;
  v_self     UUID;
BEGIN
  IF NOT is_store_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_store_id := current_admin_store_id();
  v_self     := current_admin_id();

  IF length(TRIM(COALESCE(p_name, ''))) = 0 THEN
    RAISE EXCEPTION 'name_required';
  END IF;
  IF p_role NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;

  IF p_admin_id = v_self AND p_role <> 'admin' THEN
    RAISE EXCEPTION 'cannot_demote_self';
  END IF;

  UPDATE admins a
     SET name = TRIM(p_name),
         role = p_role
   WHERE a.id = p_admin_id AND a.store_id = v_store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_not_found';
  END IF;

  RETURN TRUE;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION update_staff(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION update_staff(UUID, TEXT, TEXT) TO authenticated;
