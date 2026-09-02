-- ============================================================
-- 会員向け:自分の予約一覧
-- ------------------------------------------------------------
-- admins は RLS により管理者しか読めない(メールアドレスを含むため)。
-- そのため会員側から担当トレーナー名を引けない。
-- 必要な項目だけを返す関数を用意して解決する。
-- ============================================================

CREATE OR REPLACE FUNCTION list_my_reservations(p_include_past BOOLEAN DEFAULT FALSE)
RETURNS TABLE (
  id           UUID,
  start_at     TIMESTAMPTZ,
  end_at       TIMESTAMPTZ,
  status       TEXT,
  source       TEXT,
  menu_name    TEXT,
  billing_type TEXT,
  trainer_name TEXT,
  cancelable   BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_member_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_member_id := current_member_id();
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.start_at,
    r.end_at,
    r.status::TEXT,
    r.source::TEXT,
    m.name::TEXT,
    m.billing_type::TEXT,
    a.name::TEXT,          -- 氏名だけ。メールアドレスは返さない。
    (r.status = 'booked' AND r.start_at > now())
  FROM reservations r
  JOIN menus m  ON m.id = r.menu_id
  LEFT JOIN admins a ON a.id = r.staff_id
  WHERE r.member_id = v_member_id
    AND (p_include_past OR (r.status = 'booked' AND r.start_at > now()))
  ORDER BY r.start_at;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_my_reservations(BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_my_reservations(BOOLEAN) TO authenticated;

-- ------------------------------------------------------------
-- 会員が予約に使える権利(通い放題の契約・回数券の残数)
-- ------------------------------------------------------------
-- メニュー一覧に「残り8回」「契約期間内」などを添えて出すために使う。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_my_menus()
RETURNS TABLE (
  id           UUID,
  name         TEXT,
  billing_type TEXT,
  duration_min INT,
  price        INT,
  bookable     BOOLEAN,
  note         TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_member_id UUID;
  v_store_id  UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_member_id := current_member_id();
  SELECT store_id INTO v_store_id FROM members WHERE id = v_member_id;
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.name::TEXT,
    m.billing_type::TEXT,
    COALESCE(m.duration_min, 30),
    m.price,
    CASE m.billing_type
      WHEN 'time' THEN TRUE
      WHEN 'unlimited' THEN EXISTS (
        SELECT 1 FROM memberships ms
         WHERE ms.member_id = v_member_id AND ms.menu_id = m.id
           AND CURRENT_DATE BETWEEN ms.start_on AND ms.end_on)
      WHEN 'ticket' THEN EXISTS (
        SELECT 1 FROM tickets t
         WHERE t.member_id = v_member_id AND t.menu_id = m.id
           AND t.remaining > 0
           AND (t.expire_on IS NULL OR t.expire_on >= CURRENT_DATE))
      ELSE FALSE
    END,
    CASE m.billing_type
      WHEN 'time' THEN '都度払い'
      WHEN 'unlimited' THEN COALESCE(
        (SELECT '契約期間 ' || to_char(ms.end_on, 'YYYY/MM/DD') || ' まで'
           FROM memberships ms
          WHERE ms.member_id = v_member_id AND ms.menu_id = m.id
            AND CURRENT_DATE BETWEEN ms.start_on AND ms.end_on
          ORDER BY ms.end_on DESC LIMIT 1),
        '契約がありません')
      WHEN 'ticket' THEN COALESCE(
        (SELECT '残り ' || SUM(t.remaining)::TEXT || ' 回'
           FROM tickets t
          WHERE t.member_id = v_member_id AND t.menu_id = m.id
            AND t.remaining > 0
            AND (t.expire_on IS NULL OR t.expire_on >= CURRENT_DATE)),
        '回数券がありません')
      ELSE ''
    END
  FROM menus m
  WHERE m.store_id = v_store_id AND m.is_active
  ORDER BY m.billing_type, m.name;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_my_menus() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_my_menus() TO authenticated;
