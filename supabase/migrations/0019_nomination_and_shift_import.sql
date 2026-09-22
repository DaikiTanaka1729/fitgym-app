-- ============================================================
-- 指名券とシフトのCSV取り込み
-- ------------------------------------------------------------
-- 1. 通い放題の予約が通らなかった不具合を直す
-- 2. 指名券(メニューの一種)を追加する
-- 3. 指名しない予約は、その時間にいるトレーナーから無作為に割り当てる
-- 4. 指名していない予約は、あとから担当トレーナーを付け替えられる
-- 5. 受付枠をCSVでまとめて登録できるようにする
-- ============================================================

-- ------------------------------------------------------------
-- 1. 通い放題の予約が通らなかった不具合
-- ------------------------------------------------------------
-- reservations.source は 0001 で ('time','membership','ticket') に
-- 制限したまま、0005 以降の create_reservation は menus.billing_type を
-- そのまま入れている。通い放題は 'unlimited' なので CHECK に引っかかり、
-- 予約が必ず失敗していた。実際に使う値に合わせて広げる。
-- 'membership' は過去データのために残す。
-- ------------------------------------------------------------
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_source_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_source_check
  CHECK (source IN ('time', 'unlimited', 'membership', 'ticket'));

-- ------------------------------------------------------------
-- 2. 指名券
-- ------------------------------------------------------------
-- 指名券もメニューとして登録する。メニュー設定の画面から値段を付けて
-- 売れるようにするため。ただし指名券そのものは予約できない。
-- 「どのメニューに使えるか」は nomination_menus で指定する。
--
-- 券の保有は回数券と同じ tickets を使う(残回数・有効期限の扱いが同じ)。
-- 会員詳細の「回数券・通い放題」からまとめて付与できる。
-- ------------------------------------------------------------
ALTER TABLE menus DROP CONSTRAINT IF EXISTS menus_billing_type_check;
ALTER TABLE menus ADD CONSTRAINT menus_billing_type_check
  CHECK (billing_type IN ('time', 'unlimited', 'ticket', 'nomination'));

CREATE TABLE IF NOT EXISTS nomination_menus (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id           UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  nomination_menu_id UUID NOT NULL REFERENCES menus(id) ON DELETE CASCADE,  -- 指名券
  menu_id            UUID NOT NULL REFERENCES menus(id) ON DELETE CASCADE,  -- 使えるメニュー
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (nomination_menu_id, menu_id)
);

CREATE INDEX IF NOT EXISTS idx_nomination_menus_menu ON nomination_menus(menu_id);

DROP TRIGGER IF EXISTS trg_nomination_menus_updated_at ON nomination_menus;
CREATE TRIGGER trg_nomination_menus_updated_at
  BEFORE UPDATE ON nomination_menus
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE nomination_menus ENABLE ROW LEVEL SECURITY;

-- 会員には見せない。会員側で必要な情報は list_my_menus が返す。
DROP POLICY IF EXISTS nomination_menus_admin ON nomination_menus;
CREATE POLICY nomination_menus_admin ON nomination_menus
  FOR ALL TO authenticated
  USING (is_admin() AND store_id = current_admin_store_id())
  WITH CHECK (is_admin() AND store_id = current_admin_store_id());

-- 予約が指名だったかどうか。
-- 指名した予約は担当トレーナーを動かせない(会員が選んだ相手のため)。
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS nominated            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS nomination_ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 3. 会員に見せるメニュー一覧(指名券の使用可否を足す)
-- ------------------------------------------------------------
-- nominatable      … このメニューに指名券を使えるか(券を持っているか)
-- nomination_left  … 使える指名券の残り回数
-- 指名券そのものは予約できないので一覧から外す。
--
-- 返す列が増えるため、CREATE OR REPLACE では置き換えられない。
-- 一度削除してから作り直す。
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS list_my_menus();

CREATE FUNCTION list_my_menus()
RETURNS TABLE (
  id              UUID,
  name            TEXT,
  billing_type    TEXT,
  duration_min    INT,
  price           INT,
  bookable        BOOLEAN,
  note            TEXT,
  nominatable     BOOLEAN,
  nomination_left INT
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
      -- 時間課金:購入(利用登録)がある会員のみ
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
    -- 指名券を使えるか
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
    ), 0)
  FROM menus m
  WHERE m.store_id = v_store_id
    AND m.is_active
    AND m.status = 'published'
    AND m.billing_type <> 'nomination'   -- 指名券そのものは予約できない
  ORDER BY m.billing_type, m.name;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_my_menus() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_my_menus() TO authenticated;

-- ------------------------------------------------------------
-- 4. その時刻に指名できるトレーナー
-- ------------------------------------------------------------
-- 所要時間ぶん連続して空いている人だけを返す。
-- 会員にも管理者にも使うため、返すのは氏名だけにする
-- (admins にはメールアドレスが入っているため)。
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
-- 5. 予約の作成(指名あり / なし)
-- ------------------------------------------------------------
-- p_staff_id を指定する = 指名する。指名券を1回消費する。
-- 指定しない場合は、その時刻に空いているトレーナーから無作為に選ぶ。
-- 特定の人に予約が偏らないようにするため、順番ではなく無作為にする。
--
-- 引数が増えるため、古い定義を消してから作り直す。
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS create_reservation(UUID, TIMESTAMPTZ, UUID);
DROP FUNCTION IF EXISTS create_reservation(UUID, TIMESTAMPTZ, UUID, BOOLEAN);
DROP FUNCTION IF EXISTS create_reservation(UUID, TIMESTAMPTZ, UUID, BOOLEAN, UUID);

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
  IF v_menu.billing_type = 'nomination' THEN
    RAISE EXCEPTION 'menu_not_bookable';   -- 指名券そのものは予約できない
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
  -- 権利がないときは、p_allow_unpurchased が TRUE なら
  -- 「要購入」の予約として通す。FALSE ならこれまでどおり断る。
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
    -- 有効な回数券を1枚ロックして押さえる。期限の近いものから使う。
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
      -- 回数券を持っていない予約。来店時に購入して消費する。
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
  -- 指名がなければ無作為の順で試す。指名があればその人だけを試す。
  -- 枠を FOR UPDATE でロックしてから空きを再確認するため、
  -- 同時に予約が来ても二重に割り当たらない。
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

  -- 回数券・指名券を1回消費する。キャンセル時に戻す。
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

-- ------------------------------------------------------------
-- 6. キャンセル(指名券も戻す)
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
  IF v_res.nomination_ticket_id IS NOT NULL THEN
    UPDATE tickets SET remaining = remaining + 1 WHERE id = v_res.nomination_ticket_id;
  END IF;

  RETURN TRUE;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION cancel_reservation(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION cancel_reservation(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 7. 担当トレーナーの付け替え
-- ------------------------------------------------------------
-- 指名された予約は動かせない。会員がその人を選んで券を使っているため。
-- 移動先のトレーナーは、そのメニューを担当でき、
-- 所要時間ぶん枠が空いていることを確かめる。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION reassign_reservation(p_reservation_id UUID, p_staff_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_res      reservations%ROWTYPE;
  v_blocks   INT;
  v_ok       INT;
  v_slot_ids UUID[];
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO v_res FROM reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND OR v_res.store_id <> current_admin_store_id() THEN
    RAISE EXCEPTION 'reservation_not_found';
  END IF;
  IF v_res.status <> 'booked' THEN
    RAISE EXCEPTION 'already_cancelled';
  END IF;
  IF v_res.nominated THEN
    RAISE EXCEPTION 'nominated_fixed';
  END IF;
  IF v_res.staff_id = p_staff_id THEN
    RETURN TRUE;   -- 変更なし
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM admins a
      JOIN staff_menus sm ON sm.admin_id = a.id AND sm.menu_id = v_res.menu_id
     WHERE a.id = p_staff_id AND a.store_id = v_res.store_id
  ) THEN
    RAISE EXCEPTION 'staff_menu_unlinked';
  END IF;

  v_blocks := GREATEST(
    1,
    CEIL(EXTRACT(EPOCH FROM (v_res.end_at - v_res.start_at)) / 1800.0)::INT
  );

  PERFORM 1 FROM slots s
    WHERE s.staff_id = p_staff_id
      AND s.start_at >= v_res.start_at
      AND s.start_at <  v_res.end_at
    ORDER BY s.start_at
    FOR UPDATE;

  SELECT COUNT(*) INTO v_ok
    FROM slots s
   WHERE s.staff_id = p_staff_id
     AND s.start_at >= v_res.start_at
     AND s.start_at <  v_res.end_at
     AND NOT s.is_closed
     AND slot_booked_count(s.id) < s.capacity;
  IF v_ok <> v_blocks THEN
    RAISE EXCEPTION 'staff_unavailable';
  END IF;

  SELECT array_agg(s.id ORDER BY s.start_at) INTO v_slot_ids
    FROM slots s
   WHERE s.staff_id = p_staff_id
     AND s.start_at >= v_res.start_at
     AND s.start_at <  v_res.end_at;

  DELETE FROM reservation_slots WHERE reservation_id = p_reservation_id;
  INSERT INTO reservation_slots (reservation_id, slot_id)
  SELECT p_reservation_id, unnest(v_slot_ids);

  UPDATE reservations SET staff_id = p_staff_id WHERE id = p_reservation_id;

  RETURN TRUE;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION reassign_reservation(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION reassign_reservation(UUID, UUID) TO authenticated;

-- ------------------------------------------------------------
-- 8. 指名券とメニューの紐づけ(管理者)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_nomination_links()
RETURNS TABLE (
  nomination_menu_id UUID,
  menu_id            UUID
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
  SELECT n.nomination_menu_id, n.menu_id
    FROM nomination_menus n
   WHERE n.store_id = current_admin_store_id();
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_nomination_links() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_nomination_links() TO authenticated;

CREATE OR REPLACE FUNCTION set_nomination_link(
  p_nomination_menu_id UUID,
  p_menu_id            UUID,
  p_on                 BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
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

  IF NOT EXISTS (SELECT 1 FROM menus m
                  WHERE m.id = p_nomination_menu_id
                    AND m.store_id = v_store_id
                    AND m.billing_type = 'nomination') THEN
    RAISE EXCEPTION 'menu_not_found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM menus m
                  WHERE m.id = p_menu_id
                    AND m.store_id = v_store_id
                    AND m.billing_type <> 'nomination') THEN
    RAISE EXCEPTION 'menu_not_found';
  END IF;

  IF p_on THEN
    INSERT INTO nomination_menus (store_id, nomination_menu_id, menu_id)
    VALUES (v_store_id, p_nomination_menu_id, p_menu_id)
    ON CONFLICT (nomination_menu_id, menu_id) DO NOTHING;
  ELSE
    DELETE FROM nomination_menus n
     WHERE n.nomination_menu_id = p_nomination_menu_id AND n.menu_id = p_menu_id;
  END IF;

  RETURN TRUE;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION set_nomination_link(UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION set_nomination_link(UUID, UUID, BOOLEAN) TO authenticated;

-- ------------------------------------------------------------
-- 9. 一覧に「指名」を載せる
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS list_my_reservations(BOOLEAN);

CREATE FUNCTION list_my_reservations(p_include_past BOOLEAN DEFAULT FALSE)
RETURNS TABLE (
  id             UUID,
  start_at       TIMESTAMPTZ,
  end_at         TIMESTAMPTZ,
  status         TEXT,
  source         TEXT,
  menu_name      TEXT,
  billing_type   TEXT,
  trainer_name   TEXT,
  cancelable     BOOLEAN,
  needs_purchase BOOLEAN,
  nominated      BOOLEAN
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
    a.name::TEXT,          -- 氏名だけ。メールアドレスは返さない。
    (r.status = 'booked' AND r.start_at > now()),
    r.needs_purchase,
    r.nominated
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
  id             UUID,
  start_at       TIMESTAMPTZ,
  end_at         TIMESTAMPTZ,
  status         TEXT,
  source         TEXT,
  member_id      UUID,
  member_name    TEXT,
  member_email   TEXT,
  menu_name      TEXT,
  menu_id        UUID,
  staff_id       UUID,
  trainer_name   TEXT,
  needs_purchase BOOLEAN,
  nominated      BOOLEAN
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
    r.staff_id, a.name::TEXT, r.needs_purchase, r.nominated
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
  id             UUID,
  start_at       TIMESTAMPTZ,
  end_at         TIMESTAMPTZ,
  status         TEXT,
  source         TEXT,
  menu_name      TEXT,
  trainer_name   TEXT,
  needs_purchase BOOLEAN,
  nominated      BOOLEAN
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
         mn.name::TEXT, a.name::TEXT, r.needs_purchase, r.nominated
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
-- 10. 受付枠のCSV取り込み
-- ------------------------------------------------------------
-- 1行 = 「誰が・いつ・何時から何時まで」。
-- 行ごとに結果を返し、一部の行が駄目でも残りは登録する。
-- 出勤表をそのまま貼れるようにするため、途中で止めない方針にする。
--
-- トレーナーはメールアドレス優先で照合し、無ければ氏名で照合する。
-- 同姓同名が2人いる行は曖昧なので登録しない。
--
-- 終了時刻の枠は作らない(18:00 指定なら最後の枠は 17:30)。
-- すでにある枠は作り直さない(予約が入っていても壊れない)。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION import_shifts(p_rows JSONB)
RETURNS TABLE (
  row_no  INT,
  staff   TEXT,
  created INT,
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
  v_hits     INT;
  v_from     DATE;
  v_to       DATE;
  v_start    TIME;
  v_end      TIME;
  v_cap      INT;
  v_made     INT;
BEGIN
  IF NOT is_store_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_store_id := current_admin_store_id();

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_no    := v_no + 1;
    v_key   := btrim(COALESCE(v_item->>'staff', ''));
    v_admin := NULL;

    BEGIN
      IF v_key = '' THEN
        RAISE EXCEPTION 'トレーナーが空です';
      END IF;

      -- メールアドレスで照合(大文字小文字は無視)
      SELECT a.id INTO v_admin
        FROM admins a
       WHERE a.store_id = v_store_id AND lower(a.email) = lower(v_key)
       LIMIT 1;

      -- 見つからなければ氏名で照合。空白の有無は無視する。
      IF v_admin IS NULL THEN
        SELECT COUNT(*) INTO v_hits
          FROM admins a
         WHERE a.store_id = v_store_id
           AND replace(replace(a.name, ' ', ''), '　', '')
             = replace(replace(v_key, ' ', ''), '　', '');
        IF v_hits = 0 THEN
          RAISE EXCEPTION 'トレーナーが見つかりません';
        ELSIF v_hits > 1 THEN
          RAISE EXCEPTION '同じ氏名のトレーナーが複数います。メールアドレスで指定してください';
        END IF;
        SELECT a.id INTO v_admin
          FROM admins a
         WHERE a.store_id = v_store_id
           AND replace(replace(a.name, ' ', ''), '　', '')
             = replace(replace(v_key, ' ', ''), '　', '');
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

      row_no := v_no; staff := v_key; created := v_made; error := NULL;
      RETURN NEXT;

    EXCEPTION WHEN OTHERS THEN
      -- 1行の失敗で全体を止めない。どの行が駄目だったかを返す。
      row_no := v_no; staff := v_key; created := 0; error := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION import_shifts(JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION import_shifts(JSONB) TO authenticated;

-- ------------------------------------------------------------
-- 11. 会員が持つ権利の一覧に指名券を区別して出す
-- ------------------------------------------------------------
-- 指名券も tickets に入るため、そのままでは回数券と見分けがつかない。
-- kind に 'nomination' を返して、画面で区別できるようにする。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_member_entitlements(p_member_id UUID)
RETURNS TABLE (
  kind       TEXT,        -- 'ticket' | 'nomination' | 'membership'
  id         UUID,
  menu_id    UUID,
  menu_name  TEXT,
  remaining  INT,         -- 回数券・指名券のみ
  expire_on  DATE,        -- 回数券・指名券のみ
  start_on   DATE,        -- 通い放題のみ
  end_on     DATE,        -- 通い放題のみ
  is_valid   BOOLEAN,
  created_at TIMESTAMPTZ
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
    CASE WHEN m.billing_type = 'nomination' THEN 'nomination' ELSE 'ticket' END::TEXT,
    t.id, t.menu_id, m.name::TEXT,
    t.remaining, t.expire_on, NULL::DATE, NULL::DATE,
    (t.remaining > 0 AND (t.expire_on IS NULL OR t.expire_on >= CURRENT_DATE)),
    t.created_at
    FROM tickets t
    JOIN menus m ON m.id = t.menu_id
   WHERE t.member_id = p_member_id AND t.store_id = v_store_id

  UNION ALL

  SELECT 'membership'::TEXT, ms.id, ms.menu_id, m.name::TEXT,
         NULL::INT, NULL::DATE, ms.start_on, ms.end_on,
         (CURRENT_DATE BETWEEN ms.start_on AND ms.end_on),
         ms.created_at
    FROM memberships ms
    JOIN menus m ON m.id = ms.menu_id
   WHERE ms.member_id = p_member_id AND ms.store_id = v_store_id

  ORDER BY 9 DESC, 10 DESC;   -- is_valid, created_at
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_member_entitlements(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_member_entitlements(UUID) TO authenticated;
