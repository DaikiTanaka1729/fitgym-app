-- ============================================================
-- 「購入を反映」で権利まで作る
-- ------------------------------------------------------------
-- これまでの settle_reservation_purchase は、回数券・通い放題について
-- 「有効な権利がすでにあること」を前提にしていた。
-- 無い場合は ticket_exhausted / membership_expired で止まる。
--
-- しかし未購入で入った予約は、そもそも権利が無いから「要購入」なのであって、
-- 店頭で代金を受け取った時点では必ず権利が無い。
-- つまり通常の流れで必ず失敗していた。
-- 「通い放題の契約期間が終了しています」という、
-- 一度も契約していない会員には意味の通らない文言も出ていた。
--
-- 代金を受け取ったらその場で完結するよう、権利が無ければここで作る。
-- 何回ぶん・何ヶ月ぶんかはメニューの登録内容(回数・有効期限)に従う。
--
-- 何をしたかを文章で返し、画面にそのまま出す。
-- 「10回券を登録して1回消費しました」のように、
-- 受付で会員に伝えられる形にするため。
-- ============================================================

-- 通い放題にも契約期間(月数)を持たせる。
-- これまで valid_months は回数券と指名券だけに使っていた。
COMMENT ON COLUMN menus.valid_months IS
  '回数券・指名券は有効期限(月数)。通い放題は1契約あたりの期間(月数)。';

-- 戻り値が変わるので、引数の形にかかわらず消してから作り直す。
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
    RETURN '処理済みです';   -- 二重に押しても害がないようにする
  END IF;

  SELECT * INTO v_menu FROM menus WHERE id = v_res.menu_id;

  -- ---- 時間課金 ----
  IF v_menu.billing_type = 'time' THEN
    INSERT INTO member_menus (store_id, member_id, menu_id, granted_by)
    VALUES (v_res.store_id, v_res.member_id, v_res.menu_id, current_admin_id())
    ON CONFLICT (member_id, menu_id) DO NOTHING;
    v_msg := v_menu.name || ' を購入済みにしました';

  -- ---- 回数券 ----
  ELSIF v_menu.billing_type = 'ticket' THEN
    -- 使える回数券があればそれを消費する
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
      -- 無ければ、メニューの登録内容どおりに1口ぶん発行して消費する。
      -- 回数の登録が無いメニューは、その1回ぶんだけ売ったものとして扱う。
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

  -- ---- 通い放題 ----
  ELSIF v_menu.billing_type = 'unlimited' THEN
    IF EXISTS (
      SELECT 1 FROM memberships ms
       WHERE ms.member_id = v_res.member_id
         AND ms.menu_id   = v_res.menu_id
         AND CURRENT_DATE BETWEEN ms.start_on AND ms.end_on
    ) THEN
      v_msg := v_menu.name || ' の契約を確認しました';
    ELSE
      -- 契約が無ければ、本日から1口ぶんの契約を作る。
      -- 期間の登録が無いメニューは1ヶ月として扱う。
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

  UPDATE reservations
     SET needs_purchase = FALSE,
         ticket_id      = COALESCE(v_ticket_id, ticket_id)
   WHERE id = p_reservation_id;

  RETURN v_msg;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION settle_reservation_purchase(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION settle_reservation_purchase(UUID) TO authenticated;
