-- ============================================================
-- トレーナー(admins)の追加・編集・削除
-- ------------------------------------------------------------
-- これまでトレーナーの登録は SQL を直接叩く必要があった。
-- 画面から行えるようにする。
--
-- 削除には注意が要る。slots.staff_id は NOT NULL なので、
-- 単に admins を消すと外部キーの ON DELETE SET NULL が働けず、
-- 分かりにくいエラーになる。予約の入っていない枠を先に片付け、
-- 予約が残っている場合は理由を示して拒否する。
--
-- ログイン用の認証アカウントは別物。トレーナーは予約枠を持つだけなら
-- ログイン不要で、必要になったら grant_admin で紐づける。
-- ============================================================

-- ------------------------------------------------------------
-- 追加
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
-- 編集
-- ------------------------------------------------------------
-- メールアドレスは認証アカウントの紐づけに使うため、この画面からは変えない。
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

  -- 自分自身を店舗管理者から降格させると、誰も権限を戻せなくなる
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

-- ------------------------------------------------------------
-- 削除
-- ------------------------------------------------------------
-- 予約の入っていない受付枠は一緒に片付ける。
-- 予約が残っている場合は削除せず、件数を添えて拒否する。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_staff(p_admin_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_store_id UUID;
  v_remain   INT;
BEGIN
  IF NOT is_store_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_store_id := current_admin_store_id();

  IF p_admin_id = current_admin_id() THEN
    RAISE EXCEPTION 'cannot_delete_self';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM admins a WHERE a.id = p_admin_id AND a.store_id = v_store_id) THEN
    RAISE EXCEPTION 'member_not_found';
  END IF;

  -- 予約が入っていない枠を先に片付ける
  DELETE FROM slots s
   WHERE s.staff_id = p_admin_id
     AND slot_booked_count(s.id) = 0;

  -- 予約が残っている枠があれば削除できない
  SELECT COUNT(*)::INT INTO v_remain FROM slots s WHERE s.staff_id = p_admin_id;
  IF v_remain > 0 THEN
    RAISE EXCEPTION 'staff_in_use';
  END IF;

  -- staff_menus は CASCADE、reservations / training_records の担当は NULL になる
  DELETE FROM admins a WHERE a.id = p_admin_id AND a.store_id = v_store_id;

  RETURN TRUE;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION delete_staff(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION delete_staff(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 会員が持つ権利(回数券・通い放題)の一覧
-- ------------------------------------------------------------
-- 期限切れや使い切ったものも含めて返す。画面側で色分けする。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_member_entitlements(p_member_id UUID)
RETURNS TABLE (
  kind       TEXT,        -- 'ticket' | 'membership'
  id         UUID,
  menu_id    UUID,
  menu_name  TEXT,
  remaining  INT,         -- 回数券のみ
  expire_on  DATE,        -- 回数券のみ
  start_on   DATE,        -- 通い放題のみ
  end_on     DATE,        -- 通い放題のみ
  is_valid   BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_store_id UUID;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_store_id := current_admin_store_id();

  RETURN QUERY
  SELECT 'ticket'::TEXT, t.id, t.menu_id, m.name::TEXT,
         t.remaining, t.expire_on, NULL::DATE, NULL::DATE,
         (t.remaining > 0 AND (t.expire_on IS NULL OR t.expire_on >= CURRENT_DATE)),
         t.created_at
    FROM tickets t
    JOIN menus m ON m.id = t.menu_id
   WHERE t.member_id = p_member_id AND t.store_id = v_store_id

  UNION ALL

  SELECT 'membership'::TEXT, ms.id, ms.menu_id, m.name::TEXT,
         NULL::INT, NULL::DATE, ms.start_on, ms.end_on,
         (CURRENT_DATE BETWEEN ms.start_on AND ms.end_on),
         ms.created_at
    FROM memberships ms
    JOIN menus m ON m.id = ms.menu_id
   WHERE ms.member_id = p_member_id AND ms.store_id = v_store_id

  ORDER BY 9 DESC, 10 DESC;   -- is_valid, created_at
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_member_entitlements(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_member_entitlements(UUID) TO authenticated;
