-- ============================================================
-- メニューの削除
-- ------------------------------------------------------------
-- これまで画面からメニューを消せず、「停止中」にするしかなかった。
-- 試用中に作ったメニューが残り続けるため、削除を用意する。
--
-- 予約・回数券・通い放題から参照されているメニューは消さない。
-- 外部キーが ON DELETE RESTRICT なので消そうとすれば止まるが、
-- そのままではデータベースの文言が出てしまう。
-- 何件残っているかを添えて断る。
--
-- 担当の紐づけ(staff_menus)・購入登録(member_menus)・
-- 指名券の適用(nomination_menus)は、メニューと一緒に消える(CASCADE)。
--
-- 過去の履歴を残したい場合は、削除ではなく「停止中」にしてください。
-- 停止したメニューは会員の画面から消えますが、記録は残ります。
-- ============================================================

CREATE OR REPLACE FUNCTION delete_menu(p_menu_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_store_id UUID;
  v_name     TEXT;
  v_res      INT;
  v_tickets  INT;
  v_members  INT;
BEGIN
  IF NOT is_store_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_store_id := current_admin_store_id();

  SELECT m.name INTO v_name
    FROM menus m
   WHERE m.id = p_menu_id AND m.store_id = v_store_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'menu_not_found';
  END IF;

  SELECT COUNT(*) INTO v_res      FROM reservations r WHERE r.menu_id = p_menu_id;
  SELECT COUNT(*) INTO v_tickets  FROM tickets t      WHERE t.menu_id = p_menu_id;
  SELECT COUNT(*) INTO v_members  FROM memberships ms WHERE ms.menu_id = p_menu_id;

  IF v_res > 0 OR v_tickets > 0 OR v_members > 0 THEN
    RAISE EXCEPTION 'menu_in_use';
  END IF;

  -- 指名券を消すときは、そのメニューを使う設定も一緒に消える。
  -- 逆に、指名券の対象になっているだけのメニューも同様。
  DELETE FROM menus WHERE id = p_menu_id;

  INSERT INTO audit_logs (store_id, actor_admin_id, action, detail)
  VALUES (v_store_id, current_admin_id(), 'delete_menu',
          jsonb_build_object('menu_id', p_menu_id, 'name', v_name));

  RETURN TRUE;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION delete_menu(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION delete_menu(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 削除できるかどうかを先に見る
-- ------------------------------------------------------------
-- 画面で「削除」を押す前に、使われているかどうかを出すために使う。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION menu_usage(p_menu_id UUID)
RETURNS TABLE (
  reservations INT,
  tickets      INT,
  memberships  INT,
  deletable    BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_store_id UUID;
  v_res      INT;
  v_tic      INT;
  v_mem      INT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_store_id := current_admin_store_id();

  IF NOT EXISTS (SELECT 1 FROM menus m WHERE m.id = p_menu_id AND m.store_id = v_store_id) THEN
    RAISE EXCEPTION 'menu_not_found';
  END IF;

  SELECT COUNT(*) INTO v_res FROM reservations r WHERE r.menu_id = p_menu_id;
  SELECT COUNT(*) INTO v_tic FROM tickets t      WHERE t.menu_id = p_menu_id;
  SELECT COUNT(*) INTO v_mem FROM memberships ms WHERE ms.menu_id = p_menu_id;

  RETURN QUERY SELECT v_res, v_tic, v_mem, (v_res = 0 AND v_tic = 0 AND v_mem = 0);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION menu_usage(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION menu_usage(UUID) TO authenticated;
