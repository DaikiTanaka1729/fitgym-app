-- ============================================================
-- メニュー登録の承認フロー
-- ------------------------------------------------------------
-- 仮登録(draft)は管理者・スタッフの誰でもできるが、
-- 会員に見える状態(published)にできるのは承認権限を持つ人だけ。
--
-- 権限はロールとは別の独立した項目にする。
-- ロールを増やすと組み合わせが増えて運用が複雑になるため。
--
-- 状態の変更は画面側で防ぐのではなく、データベースのトリガで拒否する。
-- ボタンを隠すだけでは、APIを直接叩けば公開できてしまう。
--
-- 既存データへの影響を避けるため:
--   ・いまあるメニューはすべて published にする
--   ・いまいる店舗管理者には承認権限を与える
--     (そうしないと誰も公開できなくなる)
-- ============================================================

-- ------------------------------------------------------------
-- 承認権限
-- ------------------------------------------------------------
ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS can_approve_menus BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE admins SET can_approve_menus = TRUE WHERE role = 'admin';

CREATE OR REPLACE FUNCTION can_approve_menus()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM admins a
     WHERE a.auth_user_id = auth.uid() AND a.can_approve_menus
  );
$fn$;

-- ------------------------------------------------------------
-- メニューの状態
-- ------------------------------------------------------------
ALTER TABLE menus
  ADD COLUMN IF NOT EXISTS status      VARCHAR(20) NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- 既存のメニューは公開済みとして扱う
UPDATE menus SET status = 'published' WHERE status = 'draft' AND created_at < now();

ALTER TABLE menus DROP CONSTRAINT IF EXISTS menus_status_check;
ALTER TABLE menus ADD CONSTRAINT menus_status_check
  CHECK (status IN ('draft', 'published'));

CREATE INDEX IF NOT EXISTS idx_menus_status ON menus(store_id, status);

-- ------------------------------------------------------------
-- 状態変更の制御
-- ------------------------------------------------------------
-- 承認権限のない人が published にすることを拒否する。
-- 新規作成は必ず draft から始める。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_menu_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- 承認権限がなければ、何を指定されても draft にする
    IF NOT can_approve_menus() THEN
      NEW.status := 'draft';
      NEW.approved_by := NULL;
      NEW.approved_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT can_approve_menus() THEN
    RAISE EXCEPTION 'approval_required';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_menus_status_guard ON menus;
CREATE TRIGGER trg_menus_status_guard
  BEFORE INSERT OR UPDATE ON menus
  FOR EACH ROW EXECUTE FUNCTION guard_menu_status();

-- ------------------------------------------------------------
-- 公開 / 公開停止
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_menu_published(p_menu_id UUID, p_published BOOLEAN)
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
  IF NOT can_approve_menus() THEN
    RAISE EXCEPTION 'approval_required';
  END IF;

  v_store_id := current_admin_store_id();

  UPDATE menus m
     SET status      = CASE WHEN p_published THEN 'published' ELSE 'draft' END,
         approved_by = CASE WHEN p_published THEN current_admin_id() ELSE NULL END,
         approved_at = CASE WHEN p_published THEN now() ELSE NULL END
   WHERE m.id = p_menu_id AND m.store_id = v_store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'menu_not_found';
  END IF;

  INSERT INTO audit_logs (store_id, actor_admin_id, action, detail)
  VALUES (v_store_id, current_admin_id(),
          CASE WHEN p_published THEN 'publish_menu' ELSE 'unpublish_menu' END,
          jsonb_build_object('menu_id', p_menu_id));

  RETURN TRUE;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION set_menu_published(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION set_menu_published(UUID, BOOLEAN) TO authenticated;

-- ------------------------------------------------------------
-- 承認権限の付与 / 解除(店舗管理者のみ)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_approval_right(p_admin_id UUID, p_can BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT is_store_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE admins a
     SET can_approve_menus = p_can
   WHERE a.id = p_admin_id AND a.store_id = current_admin_store_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_not_found';
  END IF;

  RETURN TRUE;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION set_approval_right(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION set_approval_right(UUID, BOOLEAN) TO authenticated;

-- ------------------------------------------------------------
-- 会員に見せるのは公開済みのメニューだけにする
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
      WHEN 'time' THEN TRUE
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
      WHEN 'time' THEN '都度払い'
      WHEN 'unlimited' THEN COALESCE(
        (SELECT '契約期間 ' || to_char(ms.end_on, 'YYYY/MM/DD') || ' まで'
           FROM memberships ms
          WHERE ms.member_id = v_member_id AND ms.menu_id = m.id
            AND CURRENT_DATE BETWEEN ms.start_on AND ms.end_on
          ORDER BY ms.end_on DESC LIMIT 1),
        '契約がありません')
      WHEN 'ticket' THEN COALESCE(
        (SELECT '残り ' || SUM(t.remaining)::TEXT || ' 回'
           FROM tickets t
          WHERE t.member_id = v_member_id AND t.menu_id = m.id
            AND t.remaining > 0
            AND (t.expire_on IS NULL OR t.expire_on >= CURRENT_DATE)),
        '回数券がありません')
      ELSE ''
    END
  FROM menus m
  WHERE m.store_id = v_store_id
    AND m.is_active
    AND m.status = 'published'   -- 仮登録は会員に見せない
  ORDER BY m.billing_type, m.name;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_my_menus() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_my_menus() TO authenticated;

-- ------------------------------------------------------------
-- 予約できるのも公開済みのメニューだけにする
-- ------------------------------------------------------------
-- 画面に出ていなくても、メニューIDを直接指定すれば予約できてしまうため、
-- 予約可能時刻の取得と予約作成の両方で状態を見る。
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

  SELECT GREATEST(1, CEIL(COALESCE(mn.duration_min, 30) / 30.0)::INT)
    INTO v_blocks
    FROM menus mn
   WHERE mn.id = p_menu_id AND mn.store_id = v_store_id
     AND mn.is_active AND mn.status = 'published';
  IF v_blocks IS NULL THEN
    RAISE EXCEPTION 'menu_not_found';
  END IF;

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
       AND f.start_at > now()
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
-- 仮登録メニューでの予約を拒否する
-- ------------------------------------------------------------
-- list_available_times は公開済みのメニューしか時刻を返さないが、
-- メニューIDを直接指定して create_reservation を呼べば予約できてしまう。
-- 予約の作成経路がどこであっても止まるよう、テーブル側で防ぐ。
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
