-- ============================================================
-- 受付枠(シフト)の権限を揃える
-- ------------------------------------------------------------
-- これまで操作ごとに必要な権限がばらばらだった。
--   一括操作・CSV取り込み … 店舗管理者のみ
--   1枠ずつの配置/解除    … 管理者なら誰でも(他人の枠も動かせた)
--   定員のクローズ/再開   … 管理者なら誰でも(RLS が is_admin() のため)
--
-- これからは1本の考え方に揃える。
--   店舗管理者 … 店舗のすべての受付枠を操作できる
--   トレーナー … 自分の受付枠だけ操作できる
--
-- 画面で隠すだけでは足りない。テーブルを直接呼ばれても
-- 他人の出勤を動かせないよう、RLS と関数の両方で止める。
-- ============================================================

-- ------------------------------------------------------------
-- 誰の枠を触れるか
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION can_edit_slots_of(p_staff_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT is_store_admin()
      OR (is_admin() AND p_staff_id IS NOT NULL AND p_staff_id = current_admin_id());
$fn$;

REVOKE EXECUTE ON FUNCTION can_edit_slots_of(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION can_edit_slots_of(UUID) TO authenticated;

-- ------------------------------------------------------------
-- slots の RLS
-- ------------------------------------------------------------
-- 参照は今までどおり全員に開ける(会員が空き状況を見るため)。
-- 書き込みだけを、店舗管理者=全部 / トレーナー=自分の分、に分ける。
-- ------------------------------------------------------------
DROP POLICY IF EXISTS slots_admin_all ON slots;

DROP POLICY IF EXISTS slots_store_admin ON slots;
CREATE POLICY slots_store_admin ON slots
  FOR ALL TO authenticated
  USING (is_store_admin() AND store_id = current_admin_store_id())
  WITH CHECK (is_store_admin() AND store_id = current_admin_store_id());

DROP POLICY IF EXISTS slots_own ON slots;
CREATE POLICY slots_own ON slots
  FOR ALL TO authenticated
  USING (is_admin() AND store_id = current_admin_store_id() AND staff_id = current_admin_id())
  WITH CHECK (is_admin() AND store_id = current_admin_store_id() AND staff_id = current_admin_id());

-- ------------------------------------------------------------
-- 1枠ずつの配置 / 解除
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
  IF NOT can_edit_slots_of(p_staff_id) THEN
    RAISE EXCEPTION 'not_own_shift';
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
-- 一括操作
-- ------------------------------------------------------------
-- トレーナーは自分を指定したときだけ通す。
-- 対象を指定しない(=店舗全員)は店舗管理者のみ。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION bulk_shifts(
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
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  -- 店舗全員が対象のときは p_admin_id が NULL になる。
  -- can_edit_slots_of(NULL) は店舗管理者のときだけ真になる。
  IF NOT can_edit_slots_of(p_admin_id) THEN
    RAISE EXCEPTION 'not_own_shift';
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

-- ------------------------------------------------------------
-- Excel / CSV の取り込み
-- ------------------------------------------------------------
-- トレーナーも使えるようにする。ただし自分以外のシートは登録しない。
-- 全員分のひな型をそのまま読み込ませても、自分の分だけが入る。
-- ------------------------------------------------------------
DO $drop$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig
             FROM pg_proc p
            WHERE p.proname = 'import_shifts'
              AND p.pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END
$drop$;

CREATE FUNCTION import_shifts(
  p_rows    JSONB,
  p_replace BOOLEAN DEFAULT FALSE,
  p_scope   JSONB   DEFAULT NULL
)
RETURNS TABLE (
  row_no  INT,
  staff   TEXT,
  created INT,
  removed INT,     -- 入れ替えで消した枠
  kept    INT,     -- 予約が入っていて消さなかった枠
  error   TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_store_id UUID;
  v_item     JSONB;
  v_no       INT := 0;
  v_key      TEXT;
  v_admin    UUID;
  v_from     DATE;
  v_to       DATE;
  v_start    TIME;
  v_end      TIME;
  v_cap      INT;
  v_made     INT;
  v_del      INT;
  v_keep     INT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_store_id := current_admin_store_id();

  -- ------------------------------------------------------------
  -- 1) 入れ替えのときは、対象期間の枠を先に片づける
  -- ------------------------------------------------------------
  IF p_replace AND p_scope IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_scope)
    LOOP
      v_key := btrim(COALESCE(v_item->>'staff', ''));

      BEGIN
        v_admin := resolve_staff(v_store_id, v_key);
        IF NOT can_edit_slots_of(v_admin) THEN
          RAISE EXCEPTION '自分以外のトレーナーの受付枠は操作できません';
        END IF;
        v_from  := (v_item->>'from')::DATE;
        v_to    := (v_item->>'to')::DATE;

        -- 予約が入っている枠は残す
        SELECT COUNT(*) INTO v_keep
          FROM slots s
         WHERE s.staff_id = v_admin
           AND s.start_at >= (v_from::TIMESTAMP AT TIME ZONE 'Asia/Tokyo')
           AND s.start_at <  ((v_to + 1)::TIMESTAMP AT TIME ZONE 'Asia/Tokyo')
           AND EXISTS (SELECT 1 FROM reservation_slots rs
                        JOIN reservations r ON r.id = rs.reservation_id
                       WHERE rs.slot_id = s.id AND r.status = 'booked');

        DELETE FROM slots s
         WHERE s.staff_id = v_admin
           AND s.start_at >= (v_from::TIMESTAMP AT TIME ZONE 'Asia/Tokyo')
           AND s.start_at <  ((v_to + 1)::TIMESTAMP AT TIME ZONE 'Asia/Tokyo')
           AND NOT EXISTS (SELECT 1 FROM reservation_slots rs WHERE rs.slot_id = s.id);

        GET DIAGNOSTICS v_del = ROW_COUNT;

        row_no := 0; staff := v_key; created := 0;
        removed := v_del; kept := v_keep; error := NULL;
        RETURN NEXT;

      EXCEPTION WHEN OTHERS THEN
        row_no := 0; staff := v_key; created := 0;
        removed := 0; kept := 0; error := SQLERRM;
        RETURN NEXT;
      END;
    END LOOP;
  END IF;

  -- ------------------------------------------------------------
  -- 2) 出勤を1件ずつ入れる
  -- ------------------------------------------------------------
  -- 行ごとに結果を返し、一部の行が駄目でも残りは登録する。
  -- 出勤表をそのまま貼れるようにするため、途中で止めない。
  -- ------------------------------------------------------------
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_no  := v_no + 1;
    v_key := btrim(COALESCE(v_item->>'staff', ''));

    BEGIN
      v_admin := resolve_staff(v_store_id, v_key);
      IF NOT can_edit_slots_of(v_admin) THEN
        RAISE EXCEPTION '自分以外のトレーナーの受付枠は登録できません';
      END IF;

      v_from  := (v_item->>'date')::DATE;
      v_to    := COALESCE(NULLIF(v_item->>'date_to', ''), v_item->>'date')::DATE;
      v_start := (v_item->>'start')::TIME;
      v_end   := (v_item->>'end')::TIME;
      v_cap   := GREATEST(1, COALESCE(NULLIF(v_item->>'capacity', '')::INT, 1));

      IF v_to < v_from THEN
        RAISE EXCEPTION '終了日が開始日より前です';
      END IF;
      IF v_end <= v_start THEN
        RAISE EXCEPTION '終了時刻が開始時刻より後になっていません';
      END IF;

      INSERT INTO slots (store_id, staff_id, start_at, capacity)
      SELECT
        v_store_id,
        v_admin,
        ((v_from + d)::TIMESTAMP + (n * INTERVAL '30 minute')) AT TIME ZONE 'Asia/Tokyo',
        v_cap
      FROM generate_series(0, (v_to - v_from)) AS d,
           generate_series(0, 47) AS n
      WHERE (n * INTERVAL '30 minute') >= v_start
        AND (n * INTERVAL '30 minute') <  v_end
      ON CONFLICT (staff_id, start_at) DO NOTHING;

      GET DIAGNOSTICS v_made = ROW_COUNT;

      row_no := v_no; staff := v_key; created := v_made;
      removed := 0; kept := 0; error := NULL;
      RETURN NEXT;

    EXCEPTION WHEN OTHERS THEN
      row_no := v_no; staff := v_key; created := 0;
      removed := 0; kept := 0; error := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION import_shifts(JSONB, BOOLEAN, JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION import_shifts(JSONB, BOOLEAN, JSONB) TO authenticated;

-- ------------------------------------------------------------
-- 古い単独作成の関数も同じ扱いにする
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_shift(
  p_admin_id UUID,
  p_from     DATE,
  p_to       DATE,
  p_start    TIME DEFAULT '00:00',
  p_end      TIME DEFAULT '24:00',
  p_capacity INT  DEFAULT 1
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_store_id UUID;
  v_created  INT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF NOT can_edit_slots_of(p_admin_id) THEN
    RAISE EXCEPTION 'not_own_shift';
  END IF;

  SELECT store_id INTO v_store_id FROM admins WHERE id = p_admin_id;
  IF v_store_id IS NULL OR v_store_id <> current_admin_store_id() THEN
    RAISE EXCEPTION 'member_not_found';
  END IF;

  INSERT INTO slots (store_id, staff_id, start_at, capacity)
  SELECT
    v_store_id,
    p_admin_id,
    ((p_from + d)::TIMESTAMP + (n * INTERVAL '30 minute')) AT TIME ZONE 'Asia/Tokyo',
    p_capacity
  FROM generate_series(0, (p_to - p_from)) AS d,
       generate_series(0, 47) AS n
  WHERE (n * INTERVAL '30 minute') >= p_start
    AND (n * INTERVAL '30 minute') <  p_end
  ON CONFLICT (staff_id, start_at) DO NOTHING;

  GET DIAGNOSTICS v_created = ROW_COUNT;
  RETURN v_created;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION create_shift(UUID, DATE, DATE, TIME, TIME, INT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION create_shift(UUID, DATE, DATE, TIME, TIME, INT) TO authenticated;
