-- ============================================================
-- メニューの優先度
-- ------------------------------------------------------------
-- メニューが増えると、勧めたいものが下に埋もれる。
-- 高・中・低を付けて、高いものから上に並べる。
--
-- 並び順そのものを持たせる(1/2/3)。'高''中''低' の文字で持つと
-- 並べ替えのたびに CASE を書くことになり、書き漏らすと順番が崩れる。
--   1 = 高   2 = 中(既定)   3 = 低
-- ============================================================

ALTER TABLE menus
  ADD COLUMN IF NOT EXISTS priority SMALLINT NOT NULL DEFAULT 2;

ALTER TABLE menus DROP CONSTRAINT IF EXISTS menus_priority_check;
ALTER TABLE menus ADD CONSTRAINT menus_priority_check
  CHECK (priority IN (1, 2, 3));

COMMENT ON COLUMN menus.priority IS '表示順。1=高 2=中 3=低。小さいほど上に出る。';

CREATE INDEX IF NOT EXISTS idx_menus_priority ON menus(store_id, priority);

-- ------------------------------------------------------------
-- 会員に見せるメニュー一覧(優先度の高いものから)
-- ------------------------------------------------------------
-- 戻り値の列は変えないので、中身の入れ替えだけで済む。
-- 並び順は 優先度 → 課金形態 → 名前。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_my_menus()
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
  ORDER BY m.priority, m.billing_type, m.name;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_my_menus() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_my_menus() TO authenticated;

-- ------------------------------------------------------------
-- 管理者:時間課金メニューの購入登録も同じ並びにする
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
   ORDER BY m.priority, m.name;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_member_menu_access(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_member_menu_access(UUID) TO authenticated;
