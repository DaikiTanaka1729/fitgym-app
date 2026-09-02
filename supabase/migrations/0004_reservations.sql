-- ============================================================
-- FitGym 9/20版 予約処理
-- ------------------------------------------------------------
-- 予約可否は2段階(基本設計書_予約メニュー追補 第2章)。
--   A) 課金形態別チェック … time / unlimited / ticket で分岐
--   B) 枠の空きチェック   … 全形態共通(booked件数 < capacity)
--
-- A と B の判定、予約の作成、回数券の減算は必ず1トランザクションで行う。
-- 別々にやると、同時アクセスで定員超過や残数のズレが起きる。
-- 枠の行を FOR UPDATE でロックし、同一枠への予約を直列化する。
--
-- エラーは英字コードで RAISE する。画面側(src/api/errors.js)が
-- 日本語メッセージに変換して表示する。
-- ============================================================

-- ------------------------------------------------------------
-- 指定日の予約枠と空き状況
-- ------------------------------------------------------------
-- reservations は RLS により「自分の予約」しか見えないため、
-- 埋まり具合を素の SELECT では数えられない。
-- SECURITY DEFINER の関数で件数だけを返し、他人の予約は露出させない。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_slots(p_date DATE)
RETURNS TABLE (
  id        UUID,
  start_at  TIMESTAMPTZ,
  capacity  INT,
  booked    INT,
  is_closed BOOLEAN,
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_member_id := current_member_id();

  SELECT COALESCE(
    (SELECT m.store_id FROM members m WHERE m.id = v_member_id),
    current_admin_store_id(),
    (SELECT s.id FROM stores s ORDER BY s.created_at LIMIT 1)
  ) INTO v_store_id;

  RETURN QUERY
  SELECT
    s.id,
    s.start_at,
    s.capacity,
    (SELECT COUNT(*)::INT FROM reservations r
       WHERE r.slot_id = s.id AND r.status = 'booked'),
    s.is_closed,
    EXISTS (SELECT 1 FROM reservations r2
              WHERE r2.slot_id = s.id
                AND r2.member_id = v_member_id
                AND r2.status = 'booked')
  FROM slots s
  WHERE s.store_id = v_store_id
    -- 日付の境界は日本時間で切る(サーバーの既定は UTC のため)
    AND s.start_at >= (p_date::TIMESTAMP AT TIME ZONE 'Asia/Tokyo')
    AND s.start_at <  ((p_date + 1)::TIMESTAMP AT TIME ZONE 'Asia/Tokyo')
  ORDER BY s.start_at;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_slots(DATE) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_slots(DATE) TO authenticated;

-- ------------------------------------------------------------
-- 予約の作成
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_reservation(
  p_member_id UUID,
  p_menu_id   UUID,
  p_slot_id   UUID,
  p_source    TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_member_id   UUID;
  v_slot        slots%ROWTYPE;
  v_menu        menus%ROWTYPE;
  v_ticket      tickets%ROWTYPE;
  v_booked      INT;
  v_active      INT;
  v_max_active  INT;
  v_ticket_id   UUID;
  v_reservation UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- 予約主体の決定。
  -- 会員は自分の予約しか作れない。管理者は自店舗の会員の代理予約ができる。
  IF is_admin() THEN
    v_member_id := COALESCE(p_member_id, current_member_id());
    IF NOT EXISTS (
      SELECT 1 FROM members m
       WHERE m.id = v_member_id AND m.store_id = current_admin_store_id()
    ) THEN
      RAISE EXCEPTION 'member_not_found';
    END IF;
  ELSE
    v_member_id := current_member_id();
    IF v_member_id IS NULL THEN
      RAISE EXCEPTION 'not_authenticated';
    END IF;
    -- 引数で他人を指定されても無視する
  END IF;

  -- 枠をロックする。ここから先、同じ枠への予約は直列に処理される。
  SELECT * INTO v_slot FROM slots WHERE id = p_slot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'slot_not_found';
  END IF;
  IF v_slot.is_closed THEN
    RAISE EXCEPTION 'slot_closed';
  END IF;
  IF v_slot.start_at <= now() THEN
    RAISE EXCEPTION 'slot_past';
  END IF;

  SELECT * INTO v_menu FROM menus WHERE id = p_menu_id;
  IF NOT FOUND OR NOT v_menu.is_active THEN
    RAISE EXCEPTION 'menu_not_found';
  END IF;
  IF v_menu.store_id <> v_slot.store_id THEN
    RAISE EXCEPTION 'menu_not_found';
  END IF;
  IF v_menu.billing_type <> p_source THEN
    RAISE EXCEPTION 'source_mismatch';
  END IF;

  -- ---- A) 課金形態別チェック ----
  IF p_source = 'time' THEN
    -- 都度課金。契約チェックは不要。
    NULL;

  ELSIF p_source = 'unlimited' THEN
    IF NOT EXISTS (
      SELECT 1 FROM memberships ms
       WHERE ms.member_id = v_member_id
         AND ms.menu_id   = p_menu_id
         AND CURRENT_DATE BETWEEN ms.start_on AND ms.end_on
    ) THEN
      RAISE EXCEPTION 'membership_expired';
    END IF;

    -- 同時に保有できる未消化の予約数。メニュー個別設定がなければ基準5件。
    v_max_active := COALESCE(v_menu.max_active, 5);
    SELECT COUNT(*) INTO v_active
      FROM reservations r
      JOIN slots sl ON sl.id = r.slot_id
     WHERE r.member_id = v_member_id
       AND r.status = 'booked'
       AND sl.start_at > now();
    IF v_active >= v_max_active THEN
      RAISE EXCEPTION 'reservation_limit';
    END IF;

  ELSIF p_source = 'ticket' THEN
    -- 有効期限が近いものから消化する。行をロックして残数のズレを防ぐ。
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
      -- 残数はあるが期限切れ、という場合を区別して伝える
      IF EXISTS (
        SELECT 1 FROM tickets t
         WHERE t.member_id = v_member_id AND t.menu_id = p_menu_id AND t.remaining > 0
      ) THEN
        RAISE EXCEPTION 'ticket_expired';
      END IF;
      RAISE EXCEPTION 'ticket_exhausted';
    END IF;
    v_ticket_id := v_ticket.id;

  ELSE
    RAISE EXCEPTION 'source_mismatch';
  END IF;

  -- ---- B) 枠の空きチェック(全形態共通) ----
  SELECT COUNT(*) INTO v_booked
    FROM reservations r
   WHERE r.slot_id = p_slot_id AND r.status = 'booked';
  IF v_booked >= v_slot.capacity THEN
    RAISE EXCEPTION 'slot_full';
  END IF;

  -- ---- 予約の確定 ----
  BEGIN
    INSERT INTO reservations (store_id, member_id, menu_id, slot_id, ticket_id, source, status)
    VALUES (v_slot.store_id, v_member_id, p_menu_id, p_slot_id, v_ticket_id, p_source, 'booked')
    RETURNING id INTO v_reservation;
  EXCEPTION WHEN unique_violation THEN
    -- 同一会員が同じ枠を二重に取ろうとした(部分ユニーク索引で防いでいる)
    RAISE EXCEPTION 'duplicate_reservation';
  END;

  IF v_ticket_id IS NOT NULL THEN
    UPDATE tickets SET remaining = remaining - 1 WHERE id = v_ticket_id;
  END IF;

  RETURN v_reservation;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION create_reservation(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION create_reservation(UUID, UUID, UUID, TEXT) TO authenticated;

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
  v_slot   slots%ROWTYPE;
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

  -- 会員は開始前のみキャンセルできる。管理者は事後処理のため制限しない。
  SELECT * INTO v_slot FROM slots WHERE id = v_res.slot_id;
  IF v_is_own AND NOT is_admin() AND v_slot.start_at <= now() THEN
    RAISE EXCEPTION 'cancel_too_late';
  END IF;

  UPDATE reservations SET status = 'cancelled' WHERE id = p_reservation_id;

  -- 回数券から消化していた場合は残数を戻す
  IF v_res.ticket_id IS NOT NULL THEN
    UPDATE tickets SET remaining = remaining + 1 WHERE id = v_res.ticket_id;
  END IF;

  RETURN TRUE;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION cancel_reservation(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION cancel_reservation(UUID) TO authenticated;
