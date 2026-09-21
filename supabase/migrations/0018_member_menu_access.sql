-- ============================================================
-- 会員ごとの利用できるメニュー(購入の登録)
-- ------------------------------------------------------------
-- これまで時間課金のメニューは、全会員が無条件で予約できた。
-- 実運用に合わせ、購入した会員だけが予約できるようにする。
--
--   時間課金 … member_menus に登録された会員のみ(このファイルで追加)
--   回数券   … 残回数のある会員のみ(従来どおり)
--   通い放題 … 契約期間中の会員のみ(従来どおり)
--
-- 未購入のメニューは会員の画面から消さず、
-- 「店舗でご購入ください」と表示して選べない状態にする。
-- 何を扱っているかが会員に伝わるようにするため。
--
-- 予約の可否は画面だけでなくデータベース側でも止める。
-- メニューIDを直接指定して予約APIを呼ばれても通らないようにする。
-- ============================================================

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

-- ------------------------------------------------------------
-- 既存の会員が急に予約できなくなるのを避ける
-- ------------------------------------------------------------
-- すでに時間課金のメニューを予約したことがある会員は、
-- そのメニューを購入済みとして引き継ぐ。
-- ------------------------------------------------------------
INSERT INTO member_menus (store_id, member_id, menu_id)
SELECT DISTINCT r.store_id, r.member_id, r.menu_id
  FROM reservations r
  JOIN menus m ON m.id = r.menu_id
 WHERE m.billing_type = 'time'
ON CONFLICT (member_id, menu_id) DO NOTHING;

-- ------------------------------------------------------------
-- 会員に見せるメニュー一覧(購入状況を反映)
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
             ELSE '店舗でご購入ください' END
      WHEN 'unlimited' THEN COALESCE(
        (SELECT '契約期間 ' || to_char(ms.end_on, 'YYYY/MM/DD') || ' まで'
           FROM memberships ms
          WHERE ms.member_id = v_member_id AND ms.menu_id = m.id
            AND CURRENT_DATE BETWEEN ms.start_on AND ms.end_on
          ORDER BY ms.end_on DESC LIMIT 1),
        '店舗でご購入ください')
      WHEN 'ticket' THEN COALESCE(
        (SELECT '残り ' || SUM(t.remaining)::TEXT || ' 回'
           FROM tickets t
          WHERE t.member_id = v_member_id AND t.menu_id = m.id
            AND t.remaining > 0
            AND (t.expire_on IS NULL OR t.expire_on >= CURRENT_DATE)),
        '店舗でご購入ください')
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
-- 未購入のメニューでの予約を拒否する
-- ------------------------------------------------------------
-- 画面に出ていなくてもメニューIDを直接指定すれば予約できてしまうため、
-- 予約の作成経路がどこであってもテーブル側で止める。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_reservation_menu()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- 公開されているメニューであること
  IF NOT EXISTS (
    SELECT 1 FROM menus m
     WHERE m.id = NEW.menu_id
       AND m.is_active
       AND m.status = 'published'
  ) THEN
    RAISE EXCEPTION 'menu_not_found';
  END IF;

  -- 時間課金は購入(利用登録)が必要
  IF NEW.source = 'time' AND NOT EXISTS (
    SELECT 1 FROM member_menus am
     WHERE am.member_id = NEW.member_id AND am.menu_id = NEW.menu_id
  ) THEN
    RAISE EXCEPTION 'not_purchased';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_reservations_menu_guard ON reservations;
CREATE TRIGGER trg_reservations_menu_guard
  BEFORE INSERT ON reservations
  FOR EACH ROW EXECUTE FUNCTION guard_reservation_menu();

-- ------------------------------------------------------------
-- 管理者:会員が購入しているメニューの一覧
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

-- ------------------------------------------------------------
-- 管理者:購入の登録 / 取り消し
-- ------------------------------------------------------------
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
