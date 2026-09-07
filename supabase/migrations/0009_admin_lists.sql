-- ============================================================
-- 管理者向けの一覧取得
-- ------------------------------------------------------------
-- 会員一覧・予約一覧は、複数テーブルを集計して出す必要がある。
-- reservations / tickets は RLS で「自分の分」しか見えない設計だが、
-- 管理者は自店舗の全件を見る必要があるため、権限を確認したうえで
-- SECURITY DEFINER の関数で返す。
-- ============================================================

-- ------------------------------------------------------------
-- A-03 会員一覧(検索つき)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_members(p_query TEXT DEFAULT NULL)
RETURNS TABLE (
  id                UUID,
  name              TEXT,
  email             TEXT,
  birth_date        DATE,
  grade             TEXT,
  created_at        TIMESTAMPTZ,
  upcoming          INT,   -- これからの予約件数
  total_reservations INT,  -- 累計の予約件数(キャンセル除く)
  tickets_left      INT,   -- 有効な回数券の残回数
  membership_until  DATE,  -- 通い放題の契約終了日
  last_visit        DATE   -- 直近の来店(完了した予約)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_store_id UUID;
  v_q        TEXT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_store_id := current_admin_store_id();
  v_q := NULLIF(TRIM(COALESCE(p_query, '')), '');

  RETURN QUERY
  SELECT
    m.id,
    m.name::TEXT,
    m.email::TEXT,
    m.birth_date,
    m.grade::TEXT,
    m.created_at,
    (SELECT COUNT(*)::INT FROM reservations r
      WHERE r.member_id = m.id AND r.status = 'booked' AND r.start_at > now()),
    (SELECT COUNT(*)::INT FROM reservations r
      WHERE r.member_id = m.id AND r.status <> 'cancelled'),
    COALESCE((SELECT SUM(t.remaining)::INT FROM tickets t
       WHERE t.member_id = m.id AND t.remaining > 0
         AND (t.expire_on IS NULL OR t.expire_on >= CURRENT_DATE)), 0),
    (SELECT MAX(ms.end_on) FROM memberships ms
      WHERE ms.member_id = m.id AND CURRENT_DATE BETWEEN ms.start_on AND ms.end_on),
    (SELECT MAX(r.start_at)::DATE FROM reservations r
      WHERE r.member_id = m.id AND r.status <> 'cancelled' AND r.start_at <= now())
  FROM members m
  WHERE m.store_id = v_store_id
    AND (v_q IS NULL OR m.name ILIKE '%' || v_q || '%' OR m.email ILIKE '%' || v_q || '%')
  ORDER BY m.created_at DESC;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_members(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_members(TEXT) TO authenticated;

-- ------------------------------------------------------------
-- A-05 指定日の予約一覧
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_day_reservations(p_date DATE)
RETURNS TABLE (
  id           UUID,
  start_at     TIMESTAMPTZ,
  end_at       TIMESTAMPTZ,
  status       TEXT,
  source       TEXT,
  member_id    UUID,
  member_name  TEXT,
  member_email TEXT,
  menu_name    TEXT,
  trainer_name TEXT
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
  SELECT
    r.id,
    r.start_at,
    r.end_at,
    r.status::TEXT,
    r.source::TEXT,
    r.member_id,
    m.name::TEXT,
    m.email::TEXT,
    mn.name::TEXT,
    a.name::TEXT
  FROM reservations r
  JOIN members m  ON m.id  = r.member_id
  JOIN menus   mn ON mn.id = r.menu_id
  LEFT JOIN admins a ON a.id = r.staff_id
  WHERE r.store_id = v_store_id
    AND r.start_at >= (p_date::TIMESTAMP AT TIME ZONE 'Asia/Tokyo')
    AND r.start_at <  ((p_date + 1)::TIMESTAMP AT TIME ZONE 'Asia/Tokyo')
  ORDER BY r.start_at, a.created_at;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_day_reservations(DATE) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_day_reservations(DATE) TO authenticated;

-- ------------------------------------------------------------
-- A-03d 会員詳細
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_member_detail(p_member_id UUID)
RETURNS TABLE (
  id         UUID,
  name       TEXT,
  email      TEXT,
  birth_date DATE,
  grade      TEXT,
  created_at TIMESTAMPTZ,
  must_change_password BOOLEAN
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
  SELECT m.id, m.name::TEXT, m.email::TEXT, m.birth_date, m.grade::TEXT,
         m.created_at, m.must_change_password
    FROM members m
   WHERE m.id = p_member_id AND m.store_id = v_store_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION get_member_detail(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION get_member_detail(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 会員の予約履歴(管理者向け)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_member_reservations(p_member_id UUID)
RETURNS TABLE (
  id           UUID,
  start_at     TIMESTAMPTZ,
  end_at       TIMESTAMPTZ,
  status       TEXT,
  source       TEXT,
  menu_name    TEXT,
  trainer_name TEXT
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
  SELECT r.id, r.start_at, r.end_at, r.status::TEXT, r.source::TEXT,
         mn.name::TEXT, a.name::TEXT
    FROM reservations r
    JOIN menus mn ON mn.id = r.menu_id
    LEFT JOIN admins a ON a.id = r.staff_id
   WHERE r.member_id = p_member_id AND r.store_id = v_store_id
   ORDER BY r.start_at DESC
   LIMIT 100;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_member_reservations(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_member_reservations(UUID) TO authenticated;
