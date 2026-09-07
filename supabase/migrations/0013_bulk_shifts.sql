-- ============================================================
-- 受付枠の一括操作(作成 / 削除 / クローズ / 再開)
-- ------------------------------------------------------------
-- create_shift は作成しかできなかった。
-- 臨時休業や担当変更のたびに1枠ずつ触るのは現実的でないため、
-- 期間 × 時間帯 × 曜日 を指定してまとめて操作できるようにする。
--
--   p_admin_id が NULL のときは、店舗の全トレーナーが対象。
--   p_weekdays が NULL のときは、期間内のすべての曜日が対象。
--     (0=日, 1=月, ... 6=土)
--
-- 予約が入っている枠は削除しない。何件見送ったかを skipped で返す。
-- クローズは枠を残したまま受付だけ止めるので、予約済みでも実行できる。
-- ============================================================

-- ------------------------------------------------------------
-- 期間・時間帯・曜日の判定(日本時間)
-- ------------------------------------------------------------
-- サーバーの既定は UTC のため、日付と時刻は日本時間に直してから比べる。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION in_range(
  p_at       TIMESTAMPTZ,
  p_from     DATE,
  p_to       DATE,
  p_start    TIME,
  p_end      TIME,
  p_weekdays INT[]
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT (p_at AT TIME ZONE 'Asia/Tokyo')::DATE BETWEEN p_from AND p_to
     AND (p_at AT TIME ZONE 'Asia/Tokyo')::TIME >= p_start
     AND (p_at AT TIME ZONE 'Asia/Tokyo')::TIME <  p_end
     AND (p_weekdays IS NULL
          OR EXTRACT(DOW FROM (p_at AT TIME ZONE 'Asia/Tokyo'))::INT = ANY (p_weekdays));
$fn$;

DROP FUNCTION IF EXISTS bulk_shifts(UUID, DATE, DATE, TIME, TIME, TEXT, INT, INT[]);

CREATE FUNCTION bulk_shifts(
  p_admin_id UUID,
  p_from     DATE,
  p_to       DATE,
  p_start    TIME,
  p_end      TIME,
  p_action   TEXT,                 -- 'create' | 'delete' | 'close' | 'open'
  p_capacity INT   DEFAULT 1,
  p_weekdays INT[] DEFAULT NULL
)
RETURNS TABLE (affected INT, skipped INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_store_id UUID;
  v_affected INT := 0;
  v_skipped  INT := 0;
BEGIN
  IF NOT is_store_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_store_id := current_admin_store_id();

  IF p_action NOT IN ('create', 'delete', 'close', 'open') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;
  IF p_to < p_from THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;
  IF p_end <= p_start THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  -- 対象トレーナーの確認(指定された場合)
  IF p_admin_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM admins a WHERE a.id = p_admin_id AND a.store_id = v_store_id) THEN
    RAISE EXCEPTION 'member_not_found';
  END IF;

  -- ---------------- 作成 ----------------
  IF p_action = 'create' THEN
    INSERT INTO slots (store_id, staff_id, start_at, capacity)
    SELECT
      v_store_id,
      a.id,
      ((p_from + d)::TIMESTAMP + (n * INTERVAL '30 minute')) AT TIME ZONE 'Asia/Tokyo',
      GREATEST(1, p_capacity)
    FROM admins a,
         generate_series(0, (p_to - p_from)) AS d,
         generate_series(0, 47) AS n
    WHERE a.store_id = v_store_id
      AND (p_admin_id IS NULL OR a.id = p_admin_id)
      AND (n * INTERVAL '30 minute') >= p_start
      AND (n * INTERVAL '30 minute') <  p_end
      AND (p_weekdays IS NULL
           OR EXTRACT(DOW FROM (p_from + d))::INT = ANY (p_weekdays))
    ON CONFLICT (staff_id, start_at) DO NOTHING;

    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RETURN QUERY SELECT v_affected, 0;
    RETURN;
  END IF;

  -- ---------------- 削除 ----------------
  IF p_action = 'delete' THEN
    -- 予約が入っている枠は消さずに数える
    SELECT COUNT(*)::INT INTO v_skipped
      FROM slots s
     WHERE s.store_id = v_store_id
       AND (p_admin_id IS NULL OR s.staff_id = p_admin_id)
       AND in_range(s.start_at, p_from, p_to, p_start, p_end, p_weekdays)
       AND slot_booked_count(s.id) > 0;

    DELETE FROM slots s
     WHERE s.store_id = v_store_id
       AND (p_admin_id IS NULL OR s.staff_id = p_admin_id)
       AND in_range(s.start_at, p_from, p_to, p_start, p_end, p_weekdays)
       AND slot_booked_count(s.id) = 0;

    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RETURN QUERY SELECT v_affected, v_skipped;
    RETURN;
  END IF;

  -- ---------------- クローズ / 再開 ----------------
  UPDATE slots s
     SET is_closed = (p_action = 'close')
   WHERE s.store_id = v_store_id
     AND (p_admin_id IS NULL OR s.staff_id = p_admin_id)
     AND in_range(s.start_at, p_from, p_to, p_start, p_end, p_weekdays)
     AND s.is_closed <> (p_action = 'close');

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RETURN QUERY SELECT v_affected, 0;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION bulk_shifts(UUID, DATE, DATE, TIME, TIME, TEXT, INT, INT[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION bulk_shifts(UUID, DATE, DATE, TIME, TIME, TEXT, INT, INT[]) TO authenticated;

