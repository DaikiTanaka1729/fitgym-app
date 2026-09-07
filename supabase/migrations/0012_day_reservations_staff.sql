-- ============================================================
-- list_day_reservations に担当トレーナーのIDを追加
-- ------------------------------------------------------------
-- 管理画面のホームで、24時間の時間軸に「どのトレーナーの、どの時間に、
-- 誰の予約が入っているか」を描くために必要。
-- 氏名での突き合わせは同名のトレーナーがいると壊れるため、IDで持つ。
--
-- 戻り値の列構成が変わるので、CREATE OR REPLACE では置き換えられない。
-- 一度削除してから作り直す。
-- ============================================================

DROP FUNCTION IF EXISTS list_day_reservations(DATE);

CREATE FUNCTION list_day_reservations(p_date DATE)
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
  staff_id     UUID,
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
    r.staff_id,
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
