-- ============================================================
-- 店舗管理者はメニューを公開できる
-- ------------------------------------------------------------
-- メニューの公開可否は admins.can_approve_menus というフラグだけで
-- 判定していた。役職(role)は見ていない。
--
-- そのため、トレーナーを店舗管理者に格上げしても、あるいは
-- 「店舗管理者として承認」しても、フラグが付かないままで
-- メニューを公開できなかった。画面には「承認待ち」とだけ出るため、
-- 何をすれば公開できるのかも分からない状態だった。
--
-- 権限の表示は「店舗管理者(すべての操作)」である。
-- 店舗管理者は常に公開できるようにし、フラグは
-- 「スタッフにも公開を任せる」ための追加指定として残す。
-- ============================================================

CREATE OR REPLACE FUNCTION can_approve_menus()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM admins a
     WHERE a.auth_user_id = auth.uid()
       AND a.status = 'active'
       AND (a.role = 'admin' OR a.can_approve_menus)
  );
$fn$;

REVOKE EXECUTE ON FUNCTION can_approve_menus() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION can_approve_menus() TO authenticated;

-- ------------------------------------------------------------
-- 画面に返す値も合わせる
-- ------------------------------------------------------------
-- get_my_admin は admins の行をそのまま返しており、
-- can_approve_menus はフラグの値のままだった。
-- 画面は「公開する」を出すかどうかにこの値を使うので、
-- 店舗管理者には真を返す。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_my_admin()
RETURNS TABLE (
  id                UUID,
  name              TEXT,
  email             TEXT,
  role              TEXT,
  store_id          UUID,
  status            TEXT,
  can_approve_menus BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  RETURN QUERY
  SELECT a.id, a.name::TEXT, a.email::TEXT, a.role::TEXT, a.store_id, a.status::TEXT,
         (a.role = 'admin' OR a.can_approve_menus)
    FROM admins a
   WHERE a.auth_user_id = auth.uid();
END;
$fn$;

REVOKE EXECUTE ON FUNCTION get_my_admin() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION get_my_admin() TO authenticated;
