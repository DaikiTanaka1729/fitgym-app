-- ============================================================
-- 指名券を持っていなくても指名できるようにする
-- ------------------------------------------------------------
-- これまで指名するには、あらかじめ指名券を買っておく必要があった。
-- 持っていない会員が予約時に指名しようとすると断られる。
--
-- メニューと同じ扱いにする。指名券が無くても指名した予約は取れて、
-- 「要購入」の印を付ける。来店時に代金を受け取ったら
-- 「購入を反映」で指名券を発行し、1回消費する。
--
-- メニューの未購入と指名券の未購入は別々に起こりうるので、
-- 印も別に持つ(メニューは買ってあるが指名券は無い、という場合がある)。
-- ============================================================

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS nomination_needs_purchase BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN reservations.nomination_needs_purchase IS
  '指名券を持たないまま指名した予約。来店時に店舗で購入として処理する。';

-- ------------------------------------------------------------
-- そのメニューに使える指名券(店舗が用意しているもの)
-- ------------------------------------------------------------
-- 会員が持っているかどうかとは無関係に、「指名できるメニューか」を返す。
-- 複数ある場合は、価格の安いものを既定として選ぶ。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION nomination_menu_for(p_menu_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT nm.id
    FROM nomination_menus nmn
    JOIN menus nm ON nm.id = nmn.nomination_menu_id
   WHERE nmn.menu_id = p_menu_id
     AND nm.is_active
     AND nm.status = 'published'
   ORDER BY nm.price, nm.name
   LIMIT 1;
$fn$;

REVOKE EXECUTE ON FUNCTION nomination_menu_for(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION nomination_menu_for(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 会員に見せるメニュー一覧
-- ------------------------------------------------------------
-- nomination_available … 指名できるメニューか(券の保有と無関係)
-- nominatable          … 使える指名券を持っているか
-- nomination_left      … 使える指名券の残り回数
-- nomination_price     … 指名券を持っていない場合に案内する金額
--
-- 返す列が増えるため、削除してから作り直す。
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS list_my_menus();

CREATE FUNCTION list_my_menus()
RETURNS TABLE (
  id                  UUID,
  name                TEXT,
  billing_type        TEXT,
  duration_min        INT,
  price               INT,
  bookable            BOOLEAN,
  note                TEXT,
  nominatable         BOOLEAN,
  nomination_left     INT,
  nomination_available BOOLEAN,
  nomination_price    INT,
  nomination_name     TEXT
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
  SELECT mm.store_id INTO v_store_id FROM members mm WHERE mm.id = v_member_id;
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
      WHEN 'time' THEN EXISTS (
        SELECT 1 FROM member_menus am
         WHERE am.member_id = v_member_id AND am.menu_id = m.id)
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
      WHEN 'time' THEN
        CASE WHEN EXISTS (SELECT 1 FROM member_menus am
                           WHERE am.member_id = v_member_id AND am.menu_id = m.id)
             THEN '都度払い'
             ELSE '店舗でのお申し込みが必要です' END
      WHEN 'unlimited' THEN COALESCE(
        (SELECT '契約期間 ' || to_char(ms.end_on, 'YYYY/MM/DD') || ' まで'
           FROM memberships ms
          WHERE ms.member_id = v_member_id AND ms.menu_id = m.id
            AND CURRENT_DATE BETWEEN ms.start_on AND ms.end_on
          ORDER BY ms.end_on DESC LIMIT 1),
        '店舗でのお申し込みが必要です')
      WHEN 'ticket' THEN COALESCE(
        (SELECT '残り ' || SUM(t.remaining)::TEXT || ' 回'
           FROM tickets t
          WHERE t.member_id = v_member_id AND t.menu_id = m.id
            AND t.remaining > 0
            AND (t.expire_on IS NULL OR t.expire_on >= CURRENT_DATE)),
        '店舗でのお申し込みが必要です')
      ELSE ''
    END,
    -- 使える指名券を持っているか
    COALESCE((
      SELECT SUM(t.remaining) > 0
        FROM tickets t
        JOIN menus nm             ON nm.id  = t.menu_id AND nm.billing_type = 'nomination'
        JOIN nomination_menus nmn ON nmn.nomination_menu_id = nm.id AND nmn.menu_id = m.id
       WHERE t.member_id = v_member_id
         AND t.remaining > 0
         AND (t.expire_on IS NULL OR t.expire_on >= CURRENT_DATE)
    ), FALSE),
    COALESCE((
      SELECT SUM(t.remaining)::INT
        FROM tickets t
        JOIN menus nm             ON nm.id  = t.menu_id AND nm.billing_type = 'nomination'
        JOIN nomination_menus nmn ON nmn.nomination_menu_id = nm.id AND nmn.menu_id = m.id
       WHERE t.member_id = v_member_id
         AND t.remaining > 0
         AND (t.expire_on IS NULL OR t.expire_on >= CURRENT_DATE)
    ), 0),
    -- 指名できるメニューか(券の保有と無関係)
    (nomination_menu_for(m.id) IS NOT NULL),
    (SELECT nm.price FROM menus nm WHERE nm.id = nomination_menu_for(m.id)),
    (SELECT nm.name::TEXT FROM menus nm WHERE nm.id = nomination_menu_for(m.id))
  FROM menus m
  WHERE m.store_id = v_store_id
    AND m.is_active
    AND m.status = 'published'
    AND m.billing_type <> 'nomination'
  ORDER BY m.priority, m.billing_type, m.name;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_my_menus() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_my_menus() TO authenticated;

-- ------------------------------------------------------------
-- 予約の作成
-- ------------------------------------------------------------
-- p_allow_unpaid_nomination … 指名券を持たないまま指名することを認める。
--   会員が「指名券は店舗で購入します」に同意した場合だけ TRUE にする。
--   誤って未購入の指名が入らないよう、既定は FALSE のままにする。
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
  p_menu_id                 UUID,
  p_start_at                TIMESTAMPTZ,
  p_member_id               UUID    DEFAULT NULL,
  p_allow_unpurchased       BOOLEAN DEFAULT FALSE,
  p_staff_id                UUID    DEFAULT NULL,
  p_allow_unpaid_nomination BOOLEAN DEFAULT FALSE
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
  v_nom_unpaid  BOOLEAN := FALSE;
  v_unpaid      BOOLEAN := FALSE;
  v_by_admin    BOOLEAN := FALSE;
  v_reservation UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

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

  IF NOT v_by_admin
     AND p_start_at <= now() + (booking_cutoff_min(p_menu_id) * INTERVAL '1 minute') THEN
    RAISE EXCEPTION 'too_close';
  END IF;

  IF EXISTS (
    SELECT 1 FROM reservations r
     WHERE r.member_id = v_member_id
       AND r.status = 'booked'
       AND r.start_at < v_end_at
       AND r.end_at   > p_start_at
  ) THEN
    RAISE EXCEPTION 'duplicate_reservation';
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
    -- そもそも指名できるメニューか
    IF nomination_menu_for(p_menu_id) IS NULL THEN
      RAISE EXCEPTION 'nomination_unavailable';
    END IF;

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

    IF FOUND THEN
      v_nom_id := v_ticket.id;
    ELSE
      -- 持っていない場合は、同意があれば「要購入」として通す
      IF NOT p_allow_unpaid_nomination THEN
        RAISE EXCEPTION 'nomination_required';
      END IF;
      v_nom_unpaid := TRUE;
    END IF;
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

  BEGIN
    INSERT INTO reservations
      (store_id, member_id, menu_id, staff_id, start_at, end_at,
       ticket_id, source, status, needs_purchase, nominated,
       nomination_ticket_id, nomination_needs_purchase)
    VALUES
      (v_store_id, v_member_id, p_menu_id, v_chosen, p_start_at, v_end_at,
       v_ticket_id, v_menu.billing_type, 'booked', v_unpaid,
       p_staff_id IS NOT NULL, v_nom_id, v_nom_unpaid)
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

REVOKE EXECUTE ON FUNCTION create_reservation(UUID, TIMESTAMPTZ, UUID, BOOLEAN, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION create_reservation(UUID, TIMESTAMPTZ, UUID, BOOLEAN, UUID, BOOLEAN) TO authenticated;

-- ------------------------------------------------------------
-- 店舗での購入を反映する(指名券にも対応)
-- ------------------------------------------------------------
-- メニューと指名券は別々に「要購入」になりうるので、両方を処理する。
-- ------------------------------------------------------------
DO $drop$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig
             FROM pg_proc p
            WHERE p.proname = 'settle_reservation_purchase'
              AND p.pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END
$drop$;

CREATE FUNCTION settle_reservation_purchase(p_reservation_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_res       reservations%ROWTYPE;
  v_menu      menus%ROWTYPE;
  v_nom       menus%ROWTYPE;
  v_ticket    tickets%ROWTYPE;
  v_ticket_id UUID;
  v_nom_id    UUID;
  v_count     INT;
  v_months    INT;
  v_end       DATE;
  v_msg       TEXT := '';
  v_nom_msg   TEXT := '';
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO v_res FROM reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND OR v_res.store_id <> current_admin_store_id() THEN
    RAISE EXCEPTION 'reservation_not_found';
  END IF;
  IF NOT v_res.needs_purchase AND NOT v_res.nomination_needs_purchase THEN
    RETURN '処理済みです';
  END IF;

  SELECT * INTO v_menu FROM menus WHERE id = v_res.menu_id;

  PERFORM set_config('app.sale_reservation_id', p_reservation_id::TEXT, true);

  -- ---- メニューの購入 ----
  IF v_res.needs_purchase THEN
    IF v_menu.billing_type = 'time' THEN
      INSERT INTO member_menus (store_id, member_id, menu_id, granted_by)
      VALUES (v_res.store_id, v_res.member_id, v_res.menu_id, current_admin_id())
      ON CONFLICT (member_id, menu_id) DO NOTHING;
      v_msg := v_menu.name || ' を購入済みにしました';

    ELSIF v_menu.billing_type = 'ticket' THEN
      SELECT * INTO v_ticket
        FROM tickets t
       WHERE t.member_id = v_res.member_id
         AND t.menu_id   = v_res.menu_id
         AND t.remaining > 0
         AND (t.expire_on IS NULL OR t.expire_on >= CURRENT_DATE)
       ORDER BY t.expire_on NULLS LAST
       LIMIT 1
       FOR UPDATE;

      IF FOUND THEN
        v_ticket_id := v_ticket.id;
        UPDATE tickets SET remaining = remaining - 1 WHERE id = v_ticket_id;
        v_msg := v_menu.name || ' を1回消費しました(残り '
                 || (v_ticket.remaining - 1)::TEXT || ' 回)';
      ELSE
        v_count := GREATEST(1, COALESCE(v_menu.ticket_count, 1));
        v_end := CASE WHEN v_menu.valid_months IS NULL THEN NULL
                      ELSE (CURRENT_DATE + (v_menu.valid_months || ' month')::INTERVAL)::DATE END;

        INSERT INTO tickets (store_id, member_id, menu_id, remaining, expire_on)
        VALUES (v_res.store_id, v_res.member_id, v_res.menu_id, v_count - 1, v_end)
        RETURNING id INTO v_ticket_id;

        v_msg := v_menu.name || ' を ' || v_count::TEXT || ' 回ぶん登録し、1回消費しました(残り '
                 || (v_count - 1)::TEXT || ' 回'
                 || CASE WHEN v_end IS NULL THEN '' ELSE '・有効期限 ' || to_char(v_end, 'YYYY/MM/DD') END
                 || ')';
      END IF;

    ELSIF v_menu.billing_type = 'unlimited' THEN
      IF EXISTS (
        SELECT 1 FROM memberships ms
         WHERE ms.member_id = v_res.member_id
           AND ms.menu_id   = v_res.menu_id
           AND CURRENT_DATE BETWEEN ms.start_on AND ms.end_on
      ) THEN
        v_msg := v_menu.name || ' の契約を確認しました';
      ELSE
        v_months := GREATEST(1, COALESCE(v_menu.valid_months, 1));
        v_end := (CURRENT_DATE + (v_months || ' month')::INTERVAL)::DATE - 1;

        INSERT INTO memberships (store_id, member_id, menu_id, start_on, end_on)
        VALUES (v_res.store_id, v_res.member_id, v_res.menu_id, CURRENT_DATE, v_end);

        v_msg := v_menu.name || ' の契約を登録しました(' || to_char(CURRENT_DATE, 'YYYY/MM/DD')
                 || ' 〜 ' || to_char(v_end, 'YYYY/MM/DD') || ')';
      END IF;

    ELSE
      RAISE EXCEPTION 'menu_not_found';
    END IF;
  END IF;

  -- ---- 指名券の購入 ----
  IF v_res.nomination_needs_purchase THEN
    SELECT * INTO v_nom FROM menus WHERE id = nomination_menu_for(v_res.menu_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'nomination_unavailable';
    END IF;

    SELECT * INTO v_ticket
      FROM tickets t
     WHERE t.member_id = v_res.member_id
       AND t.menu_id   = v_nom.id
       AND t.remaining > 0
       AND (t.expire_on IS NULL OR t.expire_on >= CURRENT_DATE)
     ORDER BY t.expire_on NULLS LAST
     LIMIT 1
     FOR UPDATE;

    IF FOUND THEN
      v_nom_id := v_ticket.id;
      UPDATE tickets SET remaining = remaining - 1 WHERE id = v_nom_id;
      v_nom_msg := v_nom.name || ' を1回消費しました(残り '
                   || (v_ticket.remaining - 1)::TEXT || ' 回)';
    ELSE
      v_count := GREATEST(1, COALESCE(v_nom.ticket_count, 1));
      v_end := CASE WHEN v_nom.valid_months IS NULL THEN NULL
                    ELSE (CURRENT_DATE + (v_nom.valid_months || ' month')::INTERVAL)::DATE END;

      INSERT INTO tickets (store_id, member_id, menu_id, remaining, expire_on)
      VALUES (v_res.store_id, v_res.member_id, v_nom.id, v_count - 1, v_end)
      RETURNING id INTO v_nom_id;

      v_nom_msg := v_nom.name || ' を ' || v_count::TEXT || ' 回ぶん登録し、1回消費しました(残り '
                   || (v_count - 1)::TEXT || ' 回'
                   || CASE WHEN v_end IS NULL THEN '' ELSE '・有効期限 ' || to_char(v_end, 'YYYY/MM/DD') END
                   || ')';
    END IF;
  END IF;

  PERFORM set_config('app.sale_reservation_id', '', true);

  UPDATE reservations
     SET needs_purchase            = FALSE,
         nomination_needs_purchase = FALSE,
         ticket_id                 = COALESCE(v_ticket_id, ticket_id),
         nomination_ticket_id      = COALESCE(v_nom_id, nomination_ticket_id)
   WHERE id = p_reservation_id;

  RETURN NULLIF(btrim(concat_ws(' / ', NULLIF(v_msg, ''), NULLIF(v_nom_msg, ''))), '');
END;
$fn$;

REVOKE EXECUTE ON FUNCTION settle_reservation_purchase(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION settle_reservation_purchase(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 一覧に指名券の「要購入」を載せる
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS list_my_reservations(BOOLEAN);

CREATE FUNCTION list_my_reservations(p_include_past BOOLEAN DEFAULT FALSE)
RETURNS TABLE (
  id                        UUID,
  start_at                  TIMESTAMPTZ,
  end_at                    TIMESTAMPTZ,
  status                    TEXT,
  source                    TEXT,
  menu_name                 TEXT,
  billing_type              TEXT,
  trainer_name              TEXT,
  cancelable                BOOLEAN,
  needs_purchase            BOOLEAN,
  nominated                 BOOLEAN,
  nomination_needs_purchase BOOLEAN
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
    r.id, r.start_at, r.end_at, r.status::TEXT, r.source::TEXT,
    m.name::TEXT, m.billing_type::TEXT,
    a.name::TEXT,
    (r.status = 'booked' AND r.start_at > now()),
    r.needs_purchase,
    r.nominated,
    r.nomination_needs_purchase
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

DROP FUNCTION IF EXISTS list_day_reservations(DATE);

CREATE FUNCTION list_day_reservations(p_date DATE)
RETURNS TABLE (
  id                        UUID,
  start_at                  TIMESTAMPTZ,
  end_at                    TIMESTAMPTZ,
  status                    TEXT,
  source                    TEXT,
  member_id                 UUID,
  member_name               TEXT,
  member_email              TEXT,
  menu_name                 TEXT,
  menu_id                   UUID,
  staff_id                  UUID,
  trainer_name              TEXT,
  needs_purchase            BOOLEAN,
  nominated                 BOOLEAN,
  nomination_needs_purchase BOOLEAN
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
    r.id, r.start_at, r.end_at, r.status::TEXT, r.source::TEXT,
    r.member_id, m.name::TEXT, m.email::TEXT, mn.name::TEXT, mn.id,
    r.staff_id, a.name::TEXT, r.needs_purchase, r.nominated,
    r.nomination_needs_purchase
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

DROP FUNCTION IF EXISTS list_member_reservations(UUID);

CREATE FUNCTION list_member_reservations(p_member_id UUID)
RETURNS TABLE (
  id                        UUID,
  start_at                  TIMESTAMPTZ,
  end_at                    TIMESTAMPTZ,
  status                    TEXT,
  source                    TEXT,
  menu_name                 TEXT,
  trainer_name              TEXT,
  needs_purchase            BOOLEAN,
  nominated                 BOOLEAN,
  nomination_needs_purchase BOOLEAN
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
         mn.name::TEXT, a.name::TEXT, r.needs_purchase, r.nominated,
         r.nomination_needs_purchase
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

-- ------------------------------------------------------------
-- 売上見込みに指名券の未購入分も含める
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_expected_sales()
RETURNS TABLE (
  reservation_id UUID,
  start_at       TIMESTAMPTZ,
  member_id      UUID,
  member_name    TEXT,
  menu_name      TEXT,
  kind           TEXT,
  amount         INT,
  overdue        BOOLEAN
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
  -- メニューの未購入分
  SELECT r.id, r.start_at, r.member_id, m.name::TEXT, mn.name::TEXT,
         mn.billing_type::TEXT, COALESCE(mn.price, 0), (r.start_at <= now())
    FROM reservations r
    JOIN members m  ON m.id  = r.member_id
    JOIN menus   mn ON mn.id = r.menu_id
   WHERE r.store_id = v_store_id
     AND r.needs_purchase
     AND r.status = 'booked'

  UNION ALL

  -- 指名券の未購入分
  SELECT r.id, r.start_at, r.member_id, m.name::TEXT, nm.name::TEXT,
         'nomination'::TEXT, COALESCE(nm.price, 0), (r.start_at <= now())
    FROM reservations r
    JOIN members m ON m.id = r.member_id
    JOIN menus   nm ON nm.id = nomination_menu_for(r.menu_id)
   WHERE r.store_id = v_store_id
     AND r.nomination_needs_purchase
     AND r.status = 'booked'

  ORDER BY 2;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_expected_sales() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_expected_sales() TO authenticated;
