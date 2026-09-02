-- ============================================================
-- FitGym 9/20版 予約処理(トレーナー割当方式)
-- ------------------------------------------------------------
-- 【設計変更】2026/9/1
--   予約メニュー追補では「予約枠は全メニュー共通・同一キャパ」としていたが、
--   実運用の要件により以下に変更する。
--
--     予約枠 = トレーナー1人 × 30分
--     メニューXの時刻Tの空き
--       = Tにシフトがあり、Xを担当でき、所要時間ぶん連続して空いている
--         トレーナーの人数
--
--   会員の操作は「メニューを選ぶ → 30分刻みで時刻を選ぶ」。
--   トレーナーは自動で割り当てる(指名は Phase2)。
--   割当順は決定的にする(admins の作成順で上から)。
--
--   所要時間60分のメニューは、同じトレーナーの連続する2枠を占有する。
--   このため予約と枠の関係は 1対1 から 1対多 になり、
--   reservation_slots(中間表)で表現する。
-- ============================================================

-- ------------------------------------------------------------
-- 旧方式の関数を破棄
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS create_reservation(UUID, UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS cancel_reservation(UUID);
DROP FUNCTION IF EXISTS list_slots(DATE);

-- ------------------------------------------------------------
-- slots をトレーナー別の受付枠にする
-- ------------------------------------------------------------
-- 旧データ(staff_id が NULL の共通枠)は使えないので破棄する。
DELETE FROM reservations;
DELETE FROM slots;

ALTER TABLE slots ALTER COLUMN staff_id SET NOT NULL;
ALTER TABLE slots ALTER COLUMN capacity SET DEFAULT 1;

-- 同じトレーナーの同じ時刻は1行だけ
CREATE UNIQUE INDEX IF NOT EXISTS uq_slots_staff_start ON slots(staff_id, start_at);

-- ------------------------------------------------------------
-- reservations を「開始時刻 + 担当トレーナー」で持つ形にする
-- ------------------------------------------------------------
DROP INDEX IF EXISTS uq_res_member_slot_active;
DROP INDEX IF EXISTS idx_res_slot;

ALTER TABLE reservations DROP COLUMN IF EXISTS slot_id;

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES admins(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_at   TIMESTAMPTZ;

ALTER TABLE reservations ALTER COLUMN start_at SET NOT NULL;
ALTER TABLE reservations ALTER COLUMN end_at   SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_res_start ON reservations(store_id, start_at);
-- 同じ会員が同じ開始時刻で二重に取らない(重なりの検査は RPC 側で行う)
CREATE UNIQUE INDEX IF NOT EXISTS uq_res_member_start_active
  ON reservations(member_id, start_at) WHERE status = 'booked';

-- ------------------------------------------------------------
-- reservation_slots(予約が占有する枠。1予約 = 1〜3枠)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservation_slots (
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  slot_id        UUID NOT NULL REFERENCES slots(id) ON DELETE RESTRICT,
  PRIMARY KEY (reservation_id, slot_id)
);
CREATE INDEX IF NOT EXISTS idx_res_slots_slot ON reservation_slots(slot_id);

ALTER TABLE reservation_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS res_slots_admin ON reservation_slots;
CREATE POLICY res_slots_admin ON reservation_slots
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM reservations r
     WHERE r.id = reservation_id
       AND is_admin() AND r.store_id = current_admin_store_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM reservations r
     WHERE r.id = reservation_id
       AND is_admin() AND r.store_id = current_admin_store_id()
  ));

-- ------------------------------------------------------------
-- 枠の使用状況を数える
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION slot_booked_count(p_slot_id UUID)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COUNT(*)::INT
    FROM reservation_slots rs
    JOIN reservations r ON r.id = rs.reservation_id
   WHERE rs.slot_id = p_slot_id AND r.status = 'booked';
$fn$;

-- ------------------------------------------------------------
-- シフト(受付枠)の一括作成。管理者の A-10 画面から使う。
-- ------------------------------------------------------------
-- 例: 田中トレーナーに 9/1〜9/14 の 09:00〜18:00 を作る
--   SELECT create_shift('<admin_id>', '2026-09-01', '2026-09-14', '09:00', '18:00');
-- 終了時刻の枠は作らない(18:00 指定なら最後の枠は 17:30)。
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
  IF NOT is_store_admin() THEN
    RAISE EXCEPTION 'forbidden';
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

-- ------------------------------------------------------------
-- 指定メニュー・指定日の予約可能な開始時刻
-- ------------------------------------------------------------
-- 所要時間ぶん連続して空いているトレーナーがいる時刻だけを返す。
-- reservations は RLS で他人の分が見えないため SECURITY DEFINER にし、
-- 件数だけを返して個々の予約は露出させない。
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_member_id := current_member_id();
  SELECT COALESCE(
    (SELECT m.store_id FROM members m WHERE m.id = v_member_id),
    current_admin_store_id()
  ) INTO v_store_id;

  -- 所要時間を30分ブロック数に換算(未設定は1ブロック)
  SELECT GREATEST(1, CEIL(COALESCE(mn.duration_min, 30) / 30.0)::INT)
    INTO v_blocks
    FROM menus mn
   WHERE mn.id = p_menu_id AND mn.store_id = v_store_id AND mn.is_active;
  IF v_blocks IS NULL THEN
    RAISE EXCEPTION 'menu_not_found';
  END IF;

  RETURN QUERY
  WITH free AS (
    -- そのメニューを担当できるトレーナーの、空きがある枠
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
       AND f.start_at > now()
       -- 所要時間ぶん、同じトレーナーの枠が連続して空いていること
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
-- 予約の作成
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_reservation(
  p_menu_id   UUID,
  p_start_at  TIMESTAMPTZ,
  p_member_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_member_id   UUID;
  v_store_id    UUID;
  v_menu        menus%ROWTYPE;
  v_blocks      INT;
  v_end_at      TIMESTAMPTZ;
  v_staff       UUID;
  v_chosen      UUID;
  v_slot_ids    UUID[];
  v_ok          INT;
  v_active      INT;
  v_max_active  INT;
  v_ticket      tickets%ROWTYPE;
  v_ticket_id   UUID;
  v_reservation UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- 予約主体。会員は自分の分のみ。管理者は自店舗の会員の代理予約が可能。
  IF is_admin() THEN
    v_member_id := COALESCE(p_member_id, current_member_id());
    SELECT store_id INTO v_store_id FROM members WHERE id = v_member_id;
    IF v_store_id IS NULL OR v_store_id <> current_admin_store_id() THEN
      RAISE EXCEPTION 'member_not_found';
    END IF;
  ELSE
    v_member_id := current_member_id();
    IF v_member_id IS NULL THEN
      RAISE EXCEPTION 'not_authenticated';
    END IF;
    SELECT store_id INTO v_store_id FROM members WHERE id = v_member_id;
  END IF;

  SELECT * INTO v_menu FROM menus WHERE id = p_menu_id AND store_id = v_store_id;
  IF NOT FOUND OR NOT v_menu.is_active THEN
    RAISE EXCEPTION 'menu_not_found';
  END IF;

  v_blocks := GREATEST(1, CEIL(COALESCE(v_menu.duration_min, 30) / 30.0)::INT);
  v_end_at := p_start_at + (v_blocks * INTERVAL '30 minute');

  IF p_start_at <= now() THEN
    RAISE EXCEPTION 'slot_past';
  END IF;

  -- 同じ会員の予約時間が重ならないこと
  IF EXISTS (
    SELECT 1 FROM reservations r
     WHERE r.member_id = v_member_id
       AND r.status = 'booked'
       AND r.start_at < v_end_at
       AND r.end_at   > p_start_at
  ) THEN
    RAISE EXCEPTION 'duplicate_reservation';
  END IF;

  -- ---- A) 課金形態別チェック ----
  IF v_menu.billing_type = 'time' THEN
    NULL;  -- 都度課金。契約チェック不要。

  ELSIF v_menu.billing_type = 'unlimited' THEN
    IF NOT EXISTS (
      SELECT 1 FROM memberships ms
       WHERE ms.member_id = v_member_id
         AND ms.menu_id   = p_menu_id
         AND CURRENT_DATE BETWEEN ms.start_on AND ms.end_on
    ) THEN
      RAISE EXCEPTION 'membership_expired';
    END IF;

    v_max_active := COALESCE(v_menu.max_active, 5);
    SELECT COUNT(*) INTO v_active
      FROM reservations r
     WHERE r.member_id = v_member_id
       AND r.status = 'booked'
       AND r.start_at > now();
    IF v_active >= v_max_active THEN
      RAISE EXCEPTION 'reservation_limit';
    END IF;

  ELSIF v_menu.billing_type = 'ticket' THEN
    SELECT * INTO v_ticket
      FROM tickets t
     WHERE t.member_id = v_member_id
       AND t.menu_id   = p_menu_id
       AND t.remaining > 0
       AND (t.expire_on IS NULL OR t.expire_on >= CURRENT_DATE)
     ORDER BY t.expire_on NULLS LAST
     LIMIT 1
     FOR UPDATE;
    IF NOT FOUND THEN
      IF EXISTS (SELECT 1 FROM tickets t
                  WHERE t.member_id = v_member_id AND t.menu_id = p_menu_id AND t.remaining > 0) THEN
        RAISE EXCEPTION 'ticket_expired';
      END IF;
      RAISE EXCEPTION 'ticket_exhausted';
    END IF;
    v_ticket_id := v_ticket.id;
  END IF;

  -- ---- B) トレーナーの割当と枠の確保 ----
  -- 担当できるトレーナーを上から順に試す。
  -- 枠を FOR UPDATE でロックしてから空きを再確認するため、
  -- 同時に予約が来ても二重に割り当たらない。
  FOR v_staff IN
    SELECT a.id
      FROM admins a
      JOIN staff_menus sm ON sm.admin_id = a.id AND sm.menu_id = p_menu_id
     WHERE a.store_id = v_store_id
     ORDER BY a.created_at, a.id
  LOOP
    PERFORM 1 FROM slots s
      WHERE s.staff_id = v_staff
        AND s.start_at >= p_start_at
        AND s.start_at <  v_end_at
      ORDER BY s.start_at
      FOR UPDATE;

    SELECT COUNT(*) INTO v_ok
      FROM slots s
     WHERE s.staff_id = v_staff
       AND s.start_at >= p_start_at
       AND s.start_at <  v_end_at
       AND NOT s.is_closed
       AND slot_booked_count(s.id) < s.capacity;

    IF v_ok = v_blocks THEN
      SELECT array_agg(s.id ORDER BY s.start_at) INTO v_slot_ids
        FROM slots s
       WHERE s.staff_id = v_staff
         AND s.start_at >= p_start_at
         AND s.start_at <  v_end_at;
      v_chosen := v_staff;
      EXIT;
    END IF;
  END LOOP;

  IF v_chosen IS NULL THEN
    RAISE EXCEPTION 'slot_full';
  END IF;

  -- ---- 予約の確定 ----
  BEGIN
    INSERT INTO reservations
      (store_id, member_id, menu_id, staff_id, start_at, end_at, ticket_id, source, status)
    VALUES
      (v_store_id, v_member_id, p_menu_id, v_chosen, p_start_at, v_end_at,
       v_ticket_id, v_menu.billing_type, 'booked')
    RETURNING id INTO v_reservation;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_reservation';
  END;

  INSERT INTO reservation_slots (reservation_id, slot_id)
  SELECT v_reservation, unnest(v_slot_ids);

  IF v_ticket_id IS NOT NULL THEN
    UPDATE tickets SET remaining = remaining - 1 WHERE id = v_ticket_id;
  END IF;

  RETURN v_reservation;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION create_reservation(UUID, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION create_reservation(UUID, TIMESTAMPTZ, UUID) TO authenticated;

-- ------------------------------------------------------------
-- 予約のキャンセル
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION cancel_reservation(p_reservation_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_res    reservations%ROWTYPE;
  v_is_own BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_res FROM reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found';
  END IF;

  v_is_own := (v_res.member_id = current_member_id());
  IF NOT v_is_own AND NOT (is_admin() AND v_res.store_id = current_admin_store_id()) THEN
    RAISE EXCEPTION 'reservation_not_found';
  END IF;

  IF v_res.status <> 'booked' THEN
    RAISE EXCEPTION 'already_cancelled';
  END IF;

  -- 会員は開始前のみ。管理者は事後処理のため制限しない。
  IF NOT is_admin() AND v_res.start_at <= now() THEN
    RAISE EXCEPTION 'cancel_too_late';
  END IF;

  UPDATE reservations SET status = 'cancelled' WHERE id = p_reservation_id;
  DELETE FROM reservation_slots WHERE reservation_id = p_reservation_id;

  IF v_res.ticket_id IS NOT NULL THEN
    UPDATE tickets SET remaining = remaining + 1 WHERE id = v_res.ticket_id;
  END IF;

  RETURN TRUE;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION cancel_reservation(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION cancel_reservation(UUID) TO authenticated;
