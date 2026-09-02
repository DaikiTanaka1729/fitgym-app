-- ============================================================
-- 受付枠のタイムテーブル表示 と 管理者の共有メモ
-- ------------------------------------------------------------
-- 既存の「トレーナー別に枠を作る」画面に加えて、
-- 「24時間の各枠にどのトレーナーを配置するか」を見る画面を用意する。
-- どちらも同じ slots テーブルを別の切り口で見ているだけ。
-- ============================================================

-- ------------------------------------------------------------
-- 指定日の枠を、トレーナー名と予約件数つきで返す
-- ------------------------------------------------------------
-- reservations は RLS で他人の分が見えないため、件数だけを返す。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_day_slots(p_date DATE)
RETURNS TABLE (
  id         UUID,
  staff_id   UUID,
  staff_name TEXT,
  start_at   TIMESTAMPTZ,
  capacity   INT,
  is_closed  BOOLEAN,
  booked     INT
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
    s.id,
    s.staff_id,
    a.name::TEXT,
    s.start_at,
    s.capacity,
    s.is_closed,
    (SELECT COUNT(*)::INT
       FROM reservation_slots rs
       JOIN reservations r ON r.id = rs.reservation_id
      WHERE rs.slot_id = s.id AND r.status = 'booked')
  FROM slots s
  JOIN admins a ON a.id = s.staff_id
  WHERE s.store_id = v_store_id
    AND s.start_at >= (p_date::TIMESTAMP AT TIME ZONE 'Asia/Tokyo')
    AND s.start_at <  ((p_date + 1)::TIMESTAMP AT TIME ZONE 'Asia/Tokyo')
  ORDER BY s.start_at, a.created_at;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_day_slots(DATE) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_day_slots(DATE) TO authenticated;

-- ------------------------------------------------------------
-- 枠の配置 / 解除(タイムテーブル画面のクリック操作)
-- ------------------------------------------------------------
-- 戻り値: 'added' | 'removed'
-- 予約が入っている枠は解除できない(slot_in_use)。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION toggle_slot(
  p_staff_id  UUID,
  p_start_at  TIMESTAMPTZ,
  p_capacity  INT DEFAULT 1
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_store_id UUID;
  v_slot     slots%ROWTYPE;
  v_booked   INT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_store_id := current_admin_store_id();

  IF NOT EXISTS (SELECT 1 FROM admins a WHERE a.id = p_staff_id AND a.store_id = v_store_id) THEN
    RAISE EXCEPTION 'member_not_found';
  END IF;

  SELECT * INTO v_slot
    FROM slots s
   WHERE s.staff_id = p_staff_id AND s.start_at = p_start_at
   FOR UPDATE;

  IF FOUND THEN
    SELECT COUNT(*) INTO v_booked
      FROM reservation_slots rs
      JOIN reservations r ON r.id = rs.reservation_id
     WHERE rs.slot_id = v_slot.id AND r.status = 'booked';
    IF v_booked > 0 THEN
      RAISE EXCEPTION 'slot_in_use';
    END IF;
    DELETE FROM slots WHERE id = v_slot.id;
    RETURN 'removed';
  END IF;

  INSERT INTO slots (store_id, staff_id, start_at, capacity)
  VALUES (v_store_id, p_staff_id, p_start_at, GREATEST(1, p_capacity));
  RETURN 'added';
END;
$fn$;

REVOKE EXECUTE ON FUNCTION toggle_slot(UUID, TIMESTAMPTZ, INT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION toggle_slot(UUID, TIMESTAMPTZ, INT) TO authenticated;

-- ------------------------------------------------------------
-- 管理者の共有メモ(日付ごと)
-- ------------------------------------------------------------
-- タイムテーブル画面に置く申し送り欄。店舗の管理者・スタッフ全員が
-- 読み書きできる。会員には一切見せない。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  note_date  DATE NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  updated_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, note_date)
);

DROP TRIGGER IF EXISTS trg_admin_notes_updated_at ON admin_notes;
CREATE TRIGGER trg_admin_notes_updated_at
  BEFORE UPDATE ON admin_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE admin_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_notes_all ON admin_notes;
CREATE POLICY admin_notes_all ON admin_notes
  FOR ALL TO authenticated
  USING (is_admin() AND store_id = current_admin_store_id())
  WITH CHECK (is_admin() AND store_id = current_admin_store_id());

-- ------------------------------------------------------------
-- メモの取得・保存
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_admin_note(p_date DATE)
RETURNS TABLE (body TEXT, updated_at TIMESTAMPTZ, updated_by_name TEXT)
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
  SELECT n.body, n.updated_at, a.name::TEXT
    FROM admin_notes n
    LEFT JOIN admins a ON a.id = n.updated_by
   WHERE n.store_id = v_store_id AND n.note_date = p_date;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION get_admin_note(DATE) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION get_admin_note(DATE) TO authenticated;

CREATE OR REPLACE FUNCTION save_admin_note(p_date DATE, p_body TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_store_id UUID;
  v_admin_id UUID;
  v_updated  TIMESTAMPTZ;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_store_id := current_admin_store_id();
  v_admin_id := current_admin_id();

  INSERT INTO admin_notes (store_id, note_date, body, updated_by)
  VALUES (v_store_id, p_date, COALESCE(p_body, ''), v_admin_id)
  ON CONFLICT (store_id, note_date) DO UPDATE
    SET body = EXCLUDED.body,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
  RETURNING updated_at INTO v_updated;

  RETURN v_updated;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION save_admin_note(DATE, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION save_admin_note(DATE, TEXT) TO authenticated;
