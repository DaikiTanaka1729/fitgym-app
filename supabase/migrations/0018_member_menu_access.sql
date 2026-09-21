-- ============================================================
-- 購入したメニューだけを予約できるようにする
-- ------------------------------------------------------------
-- これまでの動き:
--   時間課金 … 全会員が無条件で予約できた
--   回数券   … 残回数のある会員のみ(予約時に1回消費)
--   通い放題 … 契約期間中の会員のみ
--
-- これからの動き:
--   3種類とも「購入済みの会員だけ」が通常の予約画面に出る。
--   購入していないメニューは別枠(未購入メニュー)にまとめ、
--   そこからでも予約はできる。ただし「店舗でのお支払いが必要」な
--   予約として記録し、来店時に店舗で購入として処理する。
--
-- 時間課金には残数や契約期間のような「権利の実体」がないため、
-- member_menus に購入の登録を持たせる(このファイルで追加)。
--
-- 予約の可否は画面だけでなくデータベース側でも決める。
-- メニューIDを直接指定して予約APIを呼ばれても、
-- 未購入であれば必ず「要購入」の印がつく。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 時間課金メニューの購入登録
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS member_menus (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  member_id  UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  menu_id    UUID NOT NULL REFERENCES menus(id)   ON DELETE CASCADE,
  granted_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, menu_id)
);

CREATE INDEX IF NOT EXISTS idx_member_menus_member ON member_menus(member_id);

DROP TRIGGER IF EXISTS trg_member_menus_updated_at ON member_menus;
CREATE TRIGGER trg_member_menus_updated_at
  BEFORE UPDATE ON member_menus
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE member_menus ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS member_menus_admin ON member_menus;
CREATE POLICY member_menus_admin ON member_menus
  FOR ALL TO authenticated
  USING (is_admin() AND store_id = current_admin_store_id())
  WITH CHECK (is_admin() AND store_id = current_admin_store_id());

-- 会員は自分の分だけ参照できる(画面では RPC を使うため必須ではない)
DROP POLICY IF EXISTS member_menus_self ON member_menus;
CREATE POLICY member_menus_self ON member_menus
  FOR SELECT TO authenticated
  USING (member_id = current_member_id());

-- すでに時間課金のメニューを予約したことがある会員は、
-- そのメニューを購入済みとして引き継ぐ。
-- これをしないと、既存の会員が急に予約できなくなる。
INSERT INTO member_menus (store_id, member_id, menu_id)
SELECT DISTINCT r.store_id, r.member_id, r.menu_id
  FROM reservations r
  JOIN menus m ON m.id = r.menu_id
 WHERE m.billing_type = 'time'
ON CONFLICT (member_id, menu_id) DO NOTHING;

-- ------------------------------------------------------------
-- 2. 「店舗でのお支払いが必要」な予約の印
-- ------------------------------------------------------------
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS needs_purchase BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN reservations.needs_purchase IS
  '未購入のメニューで入った予約。来店時に店舗で購入として処理する。';

-- ------------------------------------------------------------
-- 3. 会員に見せるメニュー一覧(購入状況を反映)
-- ------------------------------------------------------------
-- bookable = 購入済み。画面はこれで「ご利用中」と「未購入」に分ける。
-- 未購入のメニューも一覧から消さない。何を扱っている店舗なのかが
-- 会員に伝わらなくなるため。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_my_menus()
RETURNS TABLE (
  id           UUID,
  name         TEXT,
  billing_type TEXT,
  duration_min INT,
  price        INT,
  bookable     BOOLEAN,
  note         TEXT
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
    END
  FROM menus m
  WHERE m.store_id = v_store_id
    AND m.is_active
    AND m.status = 'published'
  ORDER BY m.billing_type, m.name;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_my_menus() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_my_menus() TO authenticated;

-- ------------------------------------------------------------
-- 4. 予約の作成(未購入でも受け付ける。ただし印を残す)
-- ------------------------------------------------------------
-- p_allow_unpurchased … 「未購入メニュー」の画面から予約したときだけ TRUE。
--   通常の予約画面から誤って未購入のメニューを予約してしまうことがないよう、
--   既定は FALSE のままにし、その場合はこれまでどおり断る。
--
-- 引数が増えるため、CREATE OR REPLACE では置き換えられない。
-- 古い定義を消してから作り直す(残すと呼び出しが曖昧になる)。
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS create_reservation(UUID, TIMESTAMPTZ, UUID);

CREATE FUNCTION create_reservation(
  p_menu_id            UUID,
  p_start_at           TIMESTAMPTZ,
  p_member_id          UUID    DEFAULT NULL,
  p_allow_unpurchased  BOOLEAN DEFAULT FALSE
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
      (store_id, member_id, menu_id, staff_id, start_at, end_at,
       ticket_id, source, status, needs_purchase)
    VALUES
      (v_store_id, v_member_id, p_menu_id, v_chosen, p_start_at, v_end_at,
       v_ticket_id, v_menu.billing_type, 'booked', v_unpaid)
    RETURNING id INTO v_reservation;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_reservation';
  END;

  INSERT INTO reservation_slots (reservation_id, slot_id)
  SELECT v_reservation, unnest(v_slot_ids);

  -- 回数券を1回消費する。キャンセル時に戻す。
  IF v_ticket_id IS NOT NULL THEN
    UPDATE tickets SET remaining = remaining - 1 WHERE id = v_ticket_id;
  END IF;

  RETURN v_reservation;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION create_reservation(UUID, TIMESTAMPTZ, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION create_reservation(UUID, TIMESTAMPTZ, UUID, BOOLEAN) TO authenticated;

-- ------------------------------------------------------------
-- 5. 公開されていないメニューでの予約を拒否する
-- ------------------------------------------------------------
-- 未購入は「要購入」として通すが、仮登録(未公開)のメニューは通さない。
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
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_reservations_menu_guard ON reservations;
CREATE TRIGGER trg_reservations_menu_guard
  BEFORE INSERT ON reservations
  FOR EACH ROW EXECUTE FUNCTION guard_reservation_menu();

-- ------------------------------------------------------------
-- 6. 店舗での購入を反映する
-- ------------------------------------------------------------
-- 来店した会員から代金を受け取ったあと、管理者がこれを実行する。
--   時間課金 … 購入登録を作り、「要購入」を外す
--   回数券   … 有効な回数券から1回消費し、「要購入」を外す
--               (先に会員詳細で回数券を付与しておく)
--   通い放題 … 有効な契約があることを確かめて「要購入」を外す
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION settle_reservation_purchase(p_reservation_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_res       reservations%ROWTYPE;
  v_menu      menus%ROWTYPE;
  v_ticket    tickets%ROWTYPE;
  v_ticket_id UUID;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO v_res FROM reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND OR v_res.store_id <> current_admin_store_id() THEN
    RAISE EXCEPTION 'reservation_not_found';
  END IF;
  IF NOT v_res.needs_purchase THEN
    RETURN TRUE;  -- すでに処理済み。二重に押しても害がないようにする。
  END IF;

  SELECT * INTO v_menu FROM menus WHERE id = v_res.menu_id;

  IF v_menu.billing_type = 'time' THEN
    INSERT INTO member_menus (store_id, member_id, menu_id, granted_by)
    VALUES (v_res.store_id, v_res.member_id, v_res.menu_id, current_admin_id())
    ON CONFLICT (member_id, menu_id) DO NOTHING;

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
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ticket_exhausted';
    END IF;
    v_ticket_id := v_ticket.id;
    UPDATE tickets SET remaining = remaining - 1 WHERE id = v_ticket_id;

  ELSIF v_menu.billing_type = 'unlimited' THEN
    IF NOT EXISTS (
      SELECT 1 FROM memberships ms
       WHERE ms.member_id = v_res.member_id
         AND ms.menu_id   = v_res.menu_id
         AND CURRENT_DATE BETWEEN ms.start_on AND ms.end_on
    ) THEN
      RAISE EXCEPTION 'membership_expired';
    END IF;
  END IF;

  UPDATE reservations
     SET needs_purchase = FALSE,
         ticket_id      = COALESCE(v_ticket_id, ticket_id)
   WHERE id = p_reservation_id;

  RETURN TRUE;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION settle_reservation_purchase(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION settle_reservation_purchase(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 7. 一覧に「要購入」を載せる
-- ------------------------------------------------------------
-- 戻り値の列構成が変わるので、一度削除してから作り直す。
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
  needs_purchase BOOLEAN
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
    r.needs_purchase
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
  staff_id       UUID,
  trainer_name   TEXT,
  needs_purchase BOOLEAN
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
    r.member_id, m.name::TEXT, m.email::TEXT, mn.name::TEXT,
    r.staff_id, a.name::TEXT, r.needs_purchase
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
  needs_purchase BOOLEAN
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
         mn.name::TEXT, a.name::TEXT, r.needs_purchase
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
-- 8. 管理者:時間課金メニューの購入登録
-- ------------------------------------------------------------
-- 回数券・通い放題は残数や契約期間で管理するため、ここでは扱わない。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_member_menu_access(p_member_id UUID)
RETURNS TABLE (
  menu_id      UUID,
  name         TEXT,
  billing_type TEXT,
  duration_min INT,
  price        INT,
  purchased    BOOLEAN,
  status       TEXT
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
  SELECT m.id, m.name::TEXT, m.billing_type::TEXT,
         COALESCE(m.duration_min, 30), m.price,
         EXISTS (SELECT 1 FROM member_menus am
                  WHERE am.member_id = p_member_id AND am.menu_id = m.id),
         m.status::TEXT
    FROM menus m
   WHERE m.store_id = v_store_id
     AND m.billing_type = 'time'
     AND m.is_active
   ORDER BY m.name;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_member_menu_access(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_member_menu_access(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION set_member_menu(p_member_id UUID, p_menu_id UUID, p_on BOOLEAN)
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

  IF NOT EXISTS (SELECT 1 FROM members m WHERE m.id = p_member_id AND m.store_id = v_store_id) THEN
    RAISE EXCEPTION 'member_not_found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM menus m WHERE m.id = p_menu_id AND m.store_id = v_store_id) THEN
    RAISE EXCEPTION 'menu_not_found';
  END IF;

  IF p_on THEN
    INSERT INTO member_menus (store_id, member_id, menu_id, granted_by)
    VALUES (v_store_id, p_member_id, p_menu_id, current_admin_id())
    ON CONFLICT (member_id, menu_id) DO NOTHING;
  ELSE
    DELETE FROM member_menus am
     WHERE am.member_id = p_member_id AND am.menu_id = p_menu_id;
  END IF;

  RETURN TRUE;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION set_member_menu(UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION set_member_menu(UUID, UUID, BOOLEAN) TO authenticated;
