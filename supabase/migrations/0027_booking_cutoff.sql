-- ============================================================
-- 直前の予約を締め切る
-- ------------------------------------------------------------
-- これまでは開始時刻を過ぎていなければ予約できた(1分前でも通る)。
-- 実際には準備やトレーナーの移動があるため、直前の予約は受けられない。
-- 開始の何分前で締め切るかを設定できるようにする。既定は120分(2時間)。
--
-- 設定は店舗に1つ持たせる。運用のルールであってメニューの属性ではないため。
-- ただしメニューによって準備時間が違うこともあるので、
-- メニュー側で上書きできるようにする(未設定なら店舗の値を使う)。
--
-- 締め切りは画面と予約処理の両方で効かせる。
-- 一覧から消すだけでは、時刻を直接指定して呼ばれたときに通ってしまう。
-- ============================================================

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS booking_cutoff_min INT NOT NULL DEFAULT 120;

ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_cutoff_check;
ALTER TABLE stores ADD CONSTRAINT stores_cutoff_check
  CHECK (booking_cutoff_min >= 0 AND booking_cutoff_min <= 10080);   -- 上限は7日

COMMENT ON COLUMN stores.booking_cutoff_min IS
  '直前予約の締切(分)。開始のこの分数前を過ぎると予約できない。既定120分。';

ALTER TABLE menus
  ADD COLUMN IF NOT EXISTS booking_cutoff_min INT;

ALTER TABLE menus DROP CONSTRAINT IF EXISTS menus_cutoff_check;
ALTER TABLE menus ADD CONSTRAINT menus_cutoff_check
  CHECK (booking_cutoff_min IS NULL
         OR (booking_cutoff_min >= 0 AND booking_cutoff_min <= 10080));

COMMENT ON COLUMN menus.booking_cutoff_min IS
  '直前予約の締切(分)。NULL なら店舗の設定を使う。';

-- ------------------------------------------------------------
-- 締切の分数を引く
-- ------------------------------------------------------------
-- メニューに設定があればそれを、無ければ店舗の設定を使う。
-- どちらも引けない場合は120分として扱う。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION booking_cutoff_min(p_menu_id UUID)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(m.booking_cutoff_min, s.booking_cutoff_min, 120)
    FROM menus m
    JOIN stores s ON s.id = m.store_id
   WHERE m.id = p_menu_id;
$fn$;

REVOKE EXECUTE ON FUNCTION booking_cutoff_min(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION booking_cutoff_min(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 店舗の設定の読み書き
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_store_settings()
RETURNS TABLE (
  id                 UUID,
  name               TEXT,
  booking_cutoff_min INT
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
  SELECT s.id, s.name::TEXT, s.booking_cutoff_min
    FROM stores s
   WHERE s.id = current_admin_store_id();
END;
$fn$;

REVOKE EXECUTE ON FUNCTION get_store_settings() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION get_store_settings() TO authenticated;

CREATE OR REPLACE FUNCTION set_booking_cutoff(p_min INT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT is_store_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_min IS NULL OR p_min < 0 OR p_min > 10080 THEN
    RAISE EXCEPTION 'invalid_cutoff';
  END IF;

  UPDATE stores SET booking_cutoff_min = p_min
   WHERE id = current_admin_store_id();

  RETURN TRUE;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION set_booking_cutoff(INT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION set_booking_cutoff(INT) TO authenticated;

-- ------------------------------------------------------------
-- 予約できる時刻の一覧(締切を反映)
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
-- 指名できるトレーナー(締切を反映)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_available_trainers(p_start_at TIMESTAMPTZ, p_menu_id UUID)
RETURNS TABLE (
  staff_id UUID,
  name     TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_store_id UUID;
  v_blocks   INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT COALESCE(
    (SELECT m.store_id FROM members m WHERE m.id = current_member_id()),
    current_admin_store_id()
  ) INTO v_store_id;

  SELECT GREATEST(1, CEIL(COALESCE(mn.duration_min, 30) / 30.0)::INT)
    INTO v_blocks
    FROM menus mn
   WHERE mn.id = p_menu_id AND mn.store_id = v_store_id AND mn.is_active;
  IF v_blocks IS NULL THEN
    RAISE EXCEPTION 'menu_not_found';
  END IF;

  IF p_start_at <= now() + (booking_cutoff_min(p_menu_id) * INTERVAL '1 minute') THEN
    RAISE EXCEPTION 'too_close';
  END IF;

  RETURN QUERY
  SELECT a.id, a.name::TEXT
    FROM admins a
    JOIN staff_menus sm ON sm.admin_id = a.id AND sm.menu_id = p_menu_id
   WHERE a.store_id = v_store_id
     AND (
       SELECT COUNT(*)
         FROM slots s
        WHERE s.staff_id = a.id
          AND s.start_at >= p_start_at
          AND s.start_at <  p_start_at + (v_blocks * INTERVAL '30 minute')
          AND NOT s.is_closed
          AND slot_booked_count(s.id) < s.capacity
     ) = v_blocks
   ORDER BY a.name;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_available_trainers(TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_available_trainers(TIMESTAMPTZ, UUID) TO authenticated;

-- ------------------------------------------------------------
-- 予約の作成(締切を反映)
-- ------------------------------------------------------------
-- 一覧から消すだけでは、時刻を直接指定して呼ばれたときに通ってしまう。
-- ここでも必ず止める。
--
-- 管理者の代理予約は締切を適用しない。電話を受けて直前に入れる運用があるため。
-- ------------------------------------------------------------
DO $drop$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig
             FROM pg_proc p
            WHERE p.proname = 'create_reservation'
              AND p.pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END
$drop$;

CREATE FUNCTION create_reservation(
  p_menu_id            UUID,
  p_start_at           TIMESTAMPTZ,
  p_member_id          UUID    DEFAULT NULL,
  p_allow_unpurchased  BOOLEAN DEFAULT FALSE,
  p_staff_id           UUID    DEFAULT NULL
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
  v_nom_id      UUID;
  v_unpaid      BOOLEAN := FALSE;
  v_by_admin    BOOLEAN := FALSE;
  v_reservation UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- 予約主体。会員は自分の分のみ。管理者は自店舗の会員の代理予約が可能。
  IF is_admin() THEN
    v_by_admin  := TRUE;
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
  IF v_menu.billing_type = 'nomination' THEN
    RAISE EXCEPTION 'menu_not_bookable';
  END IF;

  v_blocks := GREATEST(1, CEIL(COALESCE(v_menu.duration_min, 30) / 30.0)::INT);
  v_end_at := p_start_at + (v_blocks * INTERVAL '30 minute');

  IF p_start_at <= now() THEN
    RAISE EXCEPTION 'slot_past';
  END IF;

  -- 直前の予約は締め切る。管理者の代理予約は対象外
  -- (電話で受けて直前に入れる運用があるため)。
  IF NOT v_by_admin
     AND p_start_at <= now() + (booking_cutoff_min(p_menu_id) * INTERVAL '1 minute') THEN
    RAISE EXCEPTION 'too_close';
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

  -- 同時に持てる予約の上限。課金形態によらず共通で見る。
  v_max_active := COALESCE(v_menu.max_active, 5);
  SELECT COUNT(*) INTO v_active
    FROM reservations r
   WHERE r.member_id = v_member_id
     AND r.status = 'booked'
     AND r.start_at > now();
  IF v_active >= v_max_active THEN
    RAISE EXCEPTION 'reservation_limit';
  END IF;

  -- ---- A) 課金形態別チェック ----
  IF v_menu.billing_type = 'time' THEN
    IF NOT EXISTS (
      SELECT 1 FROM member_menus am
       WHERE am.member_id = v_member_id AND am.menu_id = p_menu_id
    ) THEN
      IF NOT p_allow_unpurchased THEN
        RAISE EXCEPTION 'not_purchased';
      END IF;
      v_unpaid := TRUE;
    END IF;

  ELSIF v_menu.billing_type = 'unlimited' THEN
    IF NOT EXISTS (
      SELECT 1 FROM memberships ms
       WHERE ms.member_id = v_member_id
         AND ms.menu_id   = p_menu_id
         AND CURRENT_DATE BETWEEN ms.start_on AND ms.end_on
    ) THEN
      IF NOT p_allow_unpurchased THEN
        RAISE EXCEPTION 'membership_expired';
      END IF;
      v_unpaid := TRUE;
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

    IF FOUND THEN
      v_ticket_id := v_ticket.id;
    ELSE
      IF NOT p_allow_unpurchased THEN
        IF EXISTS (SELECT 1 FROM tickets t
                    WHERE t.member_id = v_member_id AND t.menu_id = p_menu_id AND t.remaining > 0) THEN
          RAISE EXCEPTION 'ticket_expired';
        END IF;
        RAISE EXCEPTION 'ticket_exhausted';
      END IF;
      v_unpaid := TRUE;
    END IF;
  END IF;

  -- ---- A') 指名するなら指名券を押さえる ----
  IF p_staff_id IS NOT NULL THEN
    SELECT t.* INTO v_ticket
      FROM tickets t
      JOIN menus nm             ON nm.id  = t.menu_id AND nm.billing_type = 'nomination'
      JOIN nomination_menus nmn ON nmn.nomination_menu_id = nm.id AND nmn.menu_id = p_menu_id
     WHERE t.member_id = v_member_id
       AND t.remaining > 0
       AND (t.expire_on IS NULL OR t.expire_on >= CURRENT_DATE)
     ORDER BY t.expire_on NULLS LAST
     LIMIT 1
     FOR UPDATE OF t;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'nomination_required';
    END IF;
    v_nom_id := v_ticket.id;
  END IF;

  -- ---- B) トレーナーの割当と枠の確保 ----
  FOR v_staff IN
    SELECT a.id
      FROM admins a
      JOIN staff_menus sm ON sm.admin_id = a.id AND sm.menu_id = p_menu_id
     WHERE a.store_id = v_store_id
       AND (p_staff_id IS NULL OR a.id = p_staff_id)
     ORDER BY random()
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
    IF p_staff_id IS NOT NULL THEN
      RAISE EXCEPTION 'staff_unavailable';
    END IF;
    RAISE EXCEPTION 'slot_full';
  END IF;

  -- ---- 予約の確定 ----
  BEGIN
    INSERT INTO reservations
      (store_id, member_id, menu_id, staff_id, start_at, end_at,
       ticket_id, source, status, needs_purchase, nominated, nomination_ticket_id)
    VALUES
      (v_store_id, v_member_id, p_menu_id, v_chosen, p_start_at, v_end_at,
       v_ticket_id, v_menu.billing_type, 'booked', v_unpaid,
       p_staff_id IS NOT NULL, v_nom_id)
    RETURNING id INTO v_reservation;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_reservation';
  END;

  INSERT INTO reservation_slots (reservation_id, slot_id)
  SELECT v_reservation, unnest(v_slot_ids);

  IF v_ticket_id IS NOT NULL THEN
    UPDATE tickets SET remaining = remaining - 1 WHERE id = v_ticket_id;
  END IF;
  IF v_nom_id IS NOT NULL THEN
    UPDATE tickets SET remaining = remaining - 1 WHERE id = v_nom_id;
  END IF;

  RETURN v_reservation;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION create_reservation(UUID, TIMESTAMPTZ, UUID, BOOLEAN, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION create_reservation(UUID, TIMESTAMPTZ, UUID, BOOLEAN, UUID) TO authenticated;
