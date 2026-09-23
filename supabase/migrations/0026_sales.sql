-- ============================================================
-- 売上
-- ------------------------------------------------------------
-- 会員に権利を付与した時点(=購入)を売上として記録する。
--   時間課金 … member_menus に登録したとき
--   回数券   … tickets を発行したとき(1口=1件)
--   指名券   … 同上
--   通い放題 … memberships の契約を作ったとき
--
-- 金額はそのときのメニュー価格を**書き写して**持つ。
-- メニューを参照するだけにすると、値上げしたときに過去の売上まで
-- 変わってしまい、集計として使えない。
--
-- 記録は引き金(トリガ)で行う。付与の経路が
-- 「会員詳細からの付与」「予約の購入を反映」「CSV等の直接登録」と
-- 複数あるため、どこから入っても取りこぼさないようにする。
--
-- 売上見込み(まだ受け取っていない分)は記録しない。
-- 未購入のまま入っている予約(needs_purchase)から、そのつど数える。
-- 予約はキャンセルされうるので、確定した売上と混ぜない。
-- ============================================================

CREATE TABLE IF NOT EXISTS sales (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  member_id      UUID REFERENCES members(id) ON DELETE SET NULL,
  member_name    TEXT,          -- 会員を消しても売上は残す
  menu_id        UUID REFERENCES menus(id) ON DELETE SET NULL,
  menu_name      TEXT NOT NULL, -- メニューを消しても売上は残す
  kind           TEXT NOT NULL CHECK (kind IN ('time', 'ticket', 'unlimited', 'nomination')),
  amount         INT  NOT NULL, -- そのときの価格
  sold_on        DATE NOT NULL,
  admin_id       UUID REFERENCES admins(id) ON DELETE SET NULL,
  admin_name     TEXT,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  source         TEXT NOT NULL DEFAULT 'grant' CHECK (source IN ('grant', 'settle', 'backfill')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_store_date ON sales(store_id, sold_on DESC);

DROP TRIGGER IF EXISTS trg_sales_updated_at ON sales;
CREATE TRIGGER trg_sales_updated_at
  BEFORE UPDATE ON sales
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

-- 会員には見せない。店舗の管理者・スタッフのみ。
DROP POLICY IF EXISTS sales_admin ON sales;
CREATE POLICY sales_admin ON sales
  FOR ALL TO authenticated
  USING (is_admin() AND store_id = current_admin_store_id())
  WITH CHECK (is_admin() AND store_id = current_admin_store_id());

-- ------------------------------------------------------------
-- 付与を売上として書き留める
-- ------------------------------------------------------------
-- どの表から呼ばれたかで種別を決める。
-- 予約の購入を反映したものは、呼び出し側が予約IDを置いていく。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_sale()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_menu   menus%ROWTYPE;
  v_member members%ROWTYPE;
  v_admin  admins%ROWTYPE;
  v_kind   TEXT;
  v_res    TEXT;
BEGIN
  SELECT * INTO v_menu FROM menus WHERE id = NEW.menu_id;
  IF NOT FOUND THEN
    RETURN NEW;   -- メニューが引けないときは記録を諦める(付与自体は通す)
  END IF;

  IF TG_TABLE_NAME = 'member_menus' THEN
    v_kind := 'time';
  ELSIF TG_TABLE_NAME = 'memberships' THEN
    v_kind := 'unlimited';
  ELSE
    v_kind := CASE WHEN v_menu.billing_type = 'nomination' THEN 'nomination' ELSE 'ticket' END;
  END IF;

  SELECT * INTO v_member FROM members WHERE id = NEW.member_id;
  SELECT * INTO v_admin  FROM admins  WHERE id = current_admin_id();

  -- 予約の購入を反映した場合だけ、呼び出し側が予約IDを置いている
  v_res := current_setting('app.sale_reservation_id', true);

  INSERT INTO sales (
    store_id, member_id, member_name, menu_id, menu_name,
    kind, amount, sold_on, admin_id, admin_name, reservation_id, source
  )
  VALUES (
    NEW.store_id, NEW.member_id, v_member.name, NEW.menu_id, v_menu.name,
    v_kind, COALESCE(v_menu.price, 0),
    (now() AT TIME ZONE 'Asia/Tokyo')::DATE,
    v_admin.id, v_admin.name,
    NULLIF(v_res, '')::UUID,
    CASE WHEN COALESCE(v_res, '') = '' THEN 'grant' ELSE 'settle' END
  );

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sale_member_menus ON member_menus;
CREATE TRIGGER trg_sale_member_menus
  AFTER INSERT ON member_menus
  FOR EACH ROW EXECUTE FUNCTION record_sale();

DROP TRIGGER IF EXISTS trg_sale_tickets ON tickets;
CREATE TRIGGER trg_sale_tickets
  AFTER INSERT ON tickets
  FOR EACH ROW EXECUTE FUNCTION record_sale();

DROP TRIGGER IF EXISTS trg_sale_memberships ON memberships;
CREATE TRIGGER trg_sale_memberships
  AFTER INSERT ON memberships
  FOR EACH ROW EXECUTE FUNCTION record_sale();

-- ------------------------------------------------------------
-- これまでの付与を売上として取り込む
-- ------------------------------------------------------------
-- 金額は今のメニュー価格で埋める。過去の価格は残っていないため、
-- 当時と違う可能性がある。source に backfill と入れて区別できるようにする。
-- ------------------------------------------------------------
INSERT INTO sales (store_id, member_id, member_name, menu_id, menu_name,
                   kind, amount, sold_on, source, created_at)
SELECT x.store_id, x.member_id, mb.name, x.menu_id, m.name,
       x.kind, COALESCE(m.price, 0),
       (x.created_at AT TIME ZONE 'Asia/Tokyo')::DATE, 'backfill', x.created_at
  FROM (
    SELECT store_id, member_id, menu_id, created_at, 'time'::TEXT AS kind FROM member_menus
    UNION ALL
    SELECT store_id, member_id, menu_id, created_at, 'unlimited' FROM memberships
    UNION ALL
    SELECT t.store_id, t.member_id, t.menu_id, t.created_at,
           CASE WHEN mn.billing_type = 'nomination' THEN 'nomination' ELSE 'ticket' END
      FROM tickets t JOIN menus mn ON mn.id = t.menu_id
  ) x
  JOIN menus m ON m.id = x.menu_id
  LEFT JOIN members mb ON mb.id = x.member_id
 WHERE NOT EXISTS (SELECT 1 FROM sales s WHERE s.store_id = x.store_id);

-- ------------------------------------------------------------
-- 予約の購入を反映したとき、売上に予約IDを残す
-- ------------------------------------------------------------
-- 直前に set_config で置いた値を、引き金が拾う。
-- 第3引数を true にしているので、この取引の中だけで有効。
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
  v_ticket    tickets%ROWTYPE;
  v_ticket_id UUID;
  v_count     INT;
  v_months    INT;
  v_end       DATE;
  v_msg       TEXT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO v_res FROM reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND OR v_res.store_id <> current_admin_store_id() THEN
    RAISE EXCEPTION 'reservation_not_found';
  END IF;
  IF NOT v_res.needs_purchase THEN
    RETURN '処理済みです';
  END IF;

  SELECT * INTO v_menu FROM menus WHERE id = v_res.menu_id;

  -- この取引の中で作られる売上に、どの予約から出たかを残す
  PERFORM set_config('app.sale_reservation_id', p_reservation_id::TEXT, true);

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
      -- すでに買ってある券を使うだけなので、売上は立てない
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
      -- すでに契約があるので売上は立てない
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

  PERFORM set_config('app.sale_reservation_id', '', true);

  UPDATE reservations
     SET needs_purchase = FALSE,
         ticket_id      = COALESCE(v_ticket_id, ticket_id)
   WHERE id = p_reservation_id;

  RETURN v_msg;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION settle_reservation_purchase(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION settle_reservation_purchase(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 売上の一覧(期間で絞る)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_sales(p_from DATE, p_to DATE)
RETURNS TABLE (
  id             UUID,
  sold_on        DATE,
  member_id      UUID,
  member_name    TEXT,
  menu_name      TEXT,
  kind           TEXT,
  amount         INT,
  admin_name     TEXT,
  source         TEXT,
  reservation_id UUID
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

  IF p_to < p_from THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  RETURN QUERY
  SELECT s.id, s.sold_on, s.member_id, s.member_name, s.menu_name,
         s.kind, s.amount, s.admin_name, s.source, s.reservation_id
    FROM sales s
   WHERE s.store_id = v_store_id
     AND s.sold_on BETWEEN p_from AND p_to
   ORDER BY s.sold_on DESC, s.created_at DESC;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_sales(DATE, DATE) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_sales(DATE, DATE) TO authenticated;

-- ------------------------------------------------------------
-- 売上の集計(メニュー別)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sales_summary(p_from DATE, p_to DATE)
RETURNS TABLE (
  menu_name TEXT,
  kind      TEXT,
  count     INT,
  amount    BIGINT
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
  SELECT s.menu_name, s.kind, COUNT(*)::INT, SUM(s.amount)::BIGINT
    FROM sales s
   WHERE s.store_id = v_store_id
     AND s.sold_on BETWEEN p_from AND p_to
   GROUP BY s.menu_name, s.kind
   ORDER BY SUM(s.amount) DESC;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION sales_summary(DATE, DATE) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION sales_summary(DATE, DATE) TO authenticated;

-- ------------------------------------------------------------
-- 売上見込み(未購入のまま入っている予約)
-- ------------------------------------------------------------
-- まだ受け取っていない代金なので、確定した売上とは分けて見せる。
-- overdue … 開始時刻を過ぎているのに処理されていない分。
--           取りはぐれなので、先に片付けられるよう印を付ける。
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
  SELECT r.id, r.start_at, r.member_id, m.name::TEXT, mn.name::TEXT,
         mn.billing_type::TEXT, COALESCE(mn.price, 0), (r.start_at <= now())
    FROM reservations r
    JOIN members m  ON m.id  = r.member_id
    JOIN menus   mn ON mn.id = r.menu_id
   WHERE r.store_id = v_store_id
     AND r.needs_purchase
     AND r.status = 'booked'
   ORDER BY r.start_at;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_expected_sales() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_expected_sales() TO authenticated;

-- ------------------------------------------------------------
-- 売上の取り消し
-- ------------------------------------------------------------
-- 誤って付与したときのため。権利そのものは消さない
-- (会員詳細で残数や契約期間を調整する運用に合わせる)。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_sale(p_sale_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT is_store_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  DELETE FROM sales
   WHERE id = p_sale_id AND store_id = current_admin_store_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_not_found';
  END IF;

  RETURN TRUE;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION delete_sale(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION delete_sale(UUID) TO authenticated;
