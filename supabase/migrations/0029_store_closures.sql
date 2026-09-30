-- ============================================================
-- 休館日
-- ------------------------------------------------------------
-- これまで休館は「その日の受付枠を全部クローズする」で表していた。
-- トレーナーごとの操作になるうえ、会員の画面では
-- 「空きがない日」と「休館日」の区別が付かない。
--
-- 店舗として休む日を持たせる。
--   定休日   … 曜日で指定(毎週月曜など)
--   臨時休館 … 日付で指定(年末年始、設備点検など)
--   臨時営業 … 定休日だが営業する日(祝日営業など)
--
-- 休館日に予約が入っている場合、予約は自動で取り消さない。
-- 会員に断りなく消すことになるため。件数を返して管理者に知らせ、
-- 個別に連絡してもらう運用にする。
-- ============================================================

-- 定休日。0=日曜 〜 6=土曜。空なら定休日なし。
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS closed_weekdays SMALLINT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN stores.closed_weekdays IS
  '定休日。0=日曜〜6=土曜。store_closures の臨時営業で個別に上書きできる。';

-- 日付単位の指定。is_open = true なら「定休日だが営業する日」。
CREATE TABLE IF NOT EXISTS store_closures (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  closed_on  DATE NOT NULL,
  is_open    BOOLEAN NOT NULL DEFAULT FALSE,
  note       TEXT,
  created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, closed_on)
);

CREATE INDEX IF NOT EXISTS idx_store_closures_date ON store_closures(store_id, closed_on);

DROP TRIGGER IF EXISTS trg_store_closures_updated_at ON store_closures;
CREATE TRIGGER trg_store_closures_updated_at
  BEFORE UPDATE ON store_closures
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE store_closures ENABLE ROW LEVEL SECURITY;

-- 会員も参照する(予約画面で休館日を灰色にするため)。
-- 店舗の営業日は秘密ではない。
DROP POLICY IF EXISTS store_closures_read ON store_closures;
CREATE POLICY store_closures_read ON store_closures
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS store_closures_admin ON store_closures;
CREATE POLICY store_closures_admin ON store_closures
  FOR ALL TO authenticated
  USING (is_store_admin() AND store_id = current_admin_store_id())
  WITH CHECK (is_store_admin() AND store_id = current_admin_store_id());

-- ------------------------------------------------------------
-- その日が休館かどうか
-- ------------------------------------------------------------
-- 日付の指定があればそちらが優先。無ければ定休日の曜日で判定する。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_store_closed(p_store_id UUID, p_date DATE)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(
    -- 日付の指定(臨時休館 / 臨時営業)
    (SELECT NOT c.is_open
       FROM store_closures c
      WHERE c.store_id = p_store_id AND c.closed_on = p_date),
    -- 無ければ定休日
    (SELECT EXTRACT(DOW FROM p_date)::SMALLINT = ANY (s.closed_weekdays)
       FROM stores s WHERE s.id = p_store_id),
    FALSE
  );
$fn$;

REVOKE EXECUTE ON FUNCTION is_store_closed(UUID, DATE) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION is_store_closed(UUID, DATE) TO authenticated;

-- ------------------------------------------------------------
-- 休館日は予約できない
-- ------------------------------------------------------------
-- 予約の入り口は複数あるため、テーブルの引き金で止める。
-- 管理者の代理予約は通す(個別の事情で受けることがあるため)。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_reservation_menu()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM menus m
     WHERE m.id = NEW.menu_id
       AND m.is_active
       AND m.status = 'published'
  ) THEN
    RAISE EXCEPTION 'menu_not_found';
  END IF;

  IF NOT is_admin()
     AND is_store_closed(NEW.store_id,
                         (NEW.start_at AT TIME ZONE 'Asia/Tokyo')::DATE) THEN
    RAISE EXCEPTION 'store_closed';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_reservations_menu_guard ON reservations;
CREATE TRIGGER trg_reservations_menu_guard
  BEFORE INSERT ON reservations
  FOR EACH ROW EXECUTE FUNCTION guard_reservation_menu();

-- ------------------------------------------------------------
-- 予約できる時刻の一覧(休館日は空にする)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_available_times(p_date DATE, p_menu_id UUID)
RETURNS TABLE (
  start_at  TIMESTAMPTZ,
  available INT,
  mine      BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_member_id UUID;
  v_store_id  UUID;
  v_blocks    INT;
  v_cutoff    INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_member_id := current_member_id();
  SELECT COALESCE(
    (SELECT m.store_id FROM members m WHERE m.id = v_member_id),
    current_admin_store_id()
  ) INTO v_store_id;

  SELECT GREATEST(1, CEIL(COALESCE(mn.duration_min, 30) / 30.0)::INT)
    INTO v_blocks
    FROM menus mn
   WHERE mn.id = p_menu_id AND mn.store_id = v_store_id
     AND mn.is_active AND mn.status = 'published';
  IF v_blocks IS NULL THEN
    RAISE EXCEPTION 'menu_not_found';
  END IF;

  -- 休館日は何も返さない
  IF is_store_closed(v_store_id, p_date) THEN
    RETURN;
  END IF;

  v_cutoff := booking_cutoff_min(p_menu_id);

  RETURN QUERY
  WITH free AS (
    SELECT s.staff_id, s.start_at
      FROM slots s
      JOIN staff_menus sm ON sm.admin_id = s.staff_id AND sm.menu_id = p_menu_id
     WHERE s.store_id = v_store_id
       AND NOT s.is_closed
       AND slot_booked_count(s.id) < s.capacity
  ),
  candidates AS (
    SELECT f.staff_id, f.start_at
      FROM free f
     WHERE f.start_at >= (p_date::TIMESTAMP AT TIME ZONE 'Asia/Tokyo')
       AND f.start_at <  ((p_date + 1)::TIMESTAMP AT TIME ZONE 'Asia/Tokyo')
       -- 締切を過ぎた時刻は出さない
       AND f.start_at > now() + (v_cutoff * INTERVAL '1 minute')
       AND NOT EXISTS (
         SELECT 1
           FROM generate_series(0, v_blocks - 1) AS i
          WHERE NOT EXISTS (
            SELECT 1 FROM free f2
             WHERE f2.staff_id = f.staff_id
               AND f2.start_at = f.start_at + (i * INTERVAL '30 minute')
          )
       )
  )
  SELECT
    c.start_at,
    COUNT(DISTINCT c.staff_id)::INT,
    EXISTS (
      SELECT 1 FROM reservations r
       WHERE r.member_id = v_member_id
         AND r.status = 'booked'
         AND r.start_at = c.start_at
    )
  FROM candidates c
  GROUP BY c.start_at
  ORDER BY c.start_at;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_available_times(DATE, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_available_times(DATE, UUID) TO authenticated;

-- ------------------------------------------------------------
-- 期間内の休館日(会員の予約画面で日付を灰色にするのに使う)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_closed_days(p_from DATE, p_to DATE)
RETURNS TABLE (
  day    DATE,
  note   TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_store_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_to < p_from OR p_to - p_from > 400 THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  SELECT COALESCE(
    (SELECT m.store_id FROM members m WHERE m.id = current_member_id()),
    current_admin_store_id()
  ) INTO v_store_id;

  RETURN QUERY
  SELECT d::DATE,
         (SELECT c.note FROM store_closures c
           WHERE c.store_id = v_store_id AND c.closed_on = d::DATE)
    FROM generate_series(p_from, p_to, INTERVAL '1 day') AS d
   WHERE is_store_closed(v_store_id, d::DATE)
   ORDER BY d;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_closed_days(DATE, DATE) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_closed_days(DATE, DATE) TO authenticated;

-- ------------------------------------------------------------
-- 管理者:休館日の一覧(設定内容そのもの)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_store_closures(p_from DATE, p_to DATE)
RETURNS TABLE (
  closed_on    DATE,
  is_open      BOOLEAN,
  note         TEXT,
  reservations INT
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
  SELECT c.closed_on, c.is_open, c.note,
         (SELECT COUNT(*)::INT FROM reservations r
           WHERE r.store_id = v_store_id
             AND r.status = 'booked'
             AND (r.start_at AT TIME ZONE 'Asia/Tokyo')::DATE = c.closed_on)
    FROM store_closures c
   WHERE c.store_id = v_store_id
     AND c.closed_on BETWEEN p_from AND p_to
   ORDER BY c.closed_on;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_store_closures(DATE, DATE) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_store_closures(DATE, DATE) TO authenticated;

-- ------------------------------------------------------------
-- その日に入っている予約の件数(休館にする前の確認に使う)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION count_reservations_on(p_from DATE, p_to DATE)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COUNT(*)::INT
    FROM reservations r
   WHERE is_admin()
     AND r.store_id = current_admin_store_id()
     AND r.status = 'booked'
     AND (r.start_at AT TIME ZONE 'Asia/Tokyo')::DATE BETWEEN p_from AND p_to;
$fn$;

REVOKE EXECUTE ON FUNCTION count_reservations_on(DATE, DATE) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION count_reservations_on(DATE, DATE) TO authenticated;

-- ------------------------------------------------------------
-- 休館日の登録 / 解除
-- ------------------------------------------------------------
-- p_mode … 'closed'(臨時休館)/ 'open'(臨時営業)/ 'clear'(指定を消す)
-- 予約が入っていても登録は通す。件数を返すので、画面で知らせる。
-- 予約は自動で取り消さない。会員に断りなく消すことになるため。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_store_closure(
  p_from DATE,
  p_to   DATE,
  p_mode TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS TABLE (
  affected     INT,
  reservations INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_store_id UUID;
  v_n        INT;
BEGIN
  IF NOT is_store_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_mode NOT IN ('closed', 'open', 'clear') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;
  IF p_to < p_from OR p_to - p_from > 400 THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;
  v_store_id := current_admin_store_id();

  IF p_mode = 'clear' THEN
    DELETE FROM store_closures c
     WHERE c.store_id = v_store_id AND c.closed_on BETWEEN p_from AND p_to;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSE
    INSERT INTO store_closures (store_id, closed_on, is_open, note, created_by)
    SELECT v_store_id, d::DATE, (p_mode = 'open'), NULLIF(btrim(COALESCE(p_note, '')), ''), current_admin_id()
      FROM generate_series(p_from, p_to, INTERVAL '1 day') AS d
    ON CONFLICT (store_id, closed_on) DO UPDATE
      SET is_open = EXCLUDED.is_open,
          note    = EXCLUDED.note,
          created_by = EXCLUDED.created_by;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;

  RETURN QUERY
  SELECT v_n,
         (SELECT COUNT(*)::INT FROM reservations r
           WHERE r.store_id = v_store_id
             AND r.status = 'booked'
             AND (r.start_at AT TIME ZONE 'Asia/Tokyo')::DATE BETWEEN p_from AND p_to);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION set_store_closure(DATE, DATE, TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION set_store_closure(DATE, DATE, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 定休日(曜日)の設定
-- ------------------------------------------------------------
-- 変更すると今後の予約に影響するので、該当する予約の件数を返す。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_closed_weekdays(p_weekdays SMALLINT[])
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_store_id UUID;
  v_days     SMALLINT[];
BEGIN
  IF NOT is_store_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_store_id := current_admin_store_id();

  v_days := COALESCE(p_weekdays, '{}');
  IF EXISTS (SELECT 1 FROM unnest(v_days) AS w WHERE w < 0 OR w > 6) THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;

  UPDATE stores SET closed_weekdays = v_days WHERE id = v_store_id;

  -- これから先の予約のうち、新しい定休日に当たるものの件数
  RETURN (
    SELECT COUNT(*)::INT FROM reservations r
     WHERE r.store_id = v_store_id
       AND r.status = 'booked'
       AND r.start_at > now()
       AND EXTRACT(DOW FROM (r.start_at AT TIME ZONE 'Asia/Tokyo'))::SMALLINT = ANY (v_days)
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION set_closed_weekdays(SMALLINT[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION set_closed_weekdays(SMALLINT[]) TO authenticated;

-- ------------------------------------------------------------
-- 店舗の設定に定休日を含める
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS get_store_settings();

CREATE FUNCTION get_store_settings()
RETURNS TABLE (
  id                 UUID,
  name               TEXT,
  booking_cutoff_min INT,
  closed_weekdays    SMALLINT[]
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
  SELECT s.id, s.name::TEXT, s.booking_cutoff_min, s.closed_weekdays
    FROM stores s
   WHERE s.id = current_admin_store_id();
END;
$fn$;

REVOKE EXECUTE ON FUNCTION get_store_settings() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION get_store_settings() TO authenticated;
