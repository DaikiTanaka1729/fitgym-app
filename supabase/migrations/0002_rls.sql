-- ============================================================
-- FitGym 9/20版 RLS ポリシー
-- ------------------------------------------------------------
-- 0001_init.sql で全テーブルの RLS を有効化した(=既定拒否)。
-- 本ファイルで「誰が何を読み書きできるか」を定義する。
--
-- 前提:
--   ・anon キーはブラウザに露出する。守るのは RLS であってキーではない。
--   ・会員は自分のデータのみ。管理者は自店舗のデータのみ。
--   ・体験予約フォームだけは未ログイン(anon)からの INSERT を許す。
--   ・service_role(サーバー側)は RLS を迂回するため、ポリシー不要。
--
-- 判定用の関数は SECURITY DEFINER にしている。
-- そうしないと members のポリシーが members を参照して無限再帰する。
-- ============================================================

-- ------------------------------------------------------------
-- 判定用のヘルパー関数
-- ------------------------------------------------------------

-- ログイン中のユーザーに対応する会員ID(会員でなければ NULL)
CREATE OR REPLACE FUNCTION current_member_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM members WHERE auth_user_id = auth.uid();
$$;

-- ログイン中のユーザーに対応する管理者ID(管理者でなければ NULL)
CREATE OR REPLACE FUNCTION current_admin_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM admins WHERE auth_user_id = auth.uid();
$$;

-- ログイン中の管理者が所属する店舗ID
CREATE OR REPLACE FUNCTION current_admin_store_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT store_id FROM admins WHERE auth_user_id = auth.uid();
$$;

-- 店舗管理者(role = 'admin')かどうか。スタッフと権限を分けるのに使う。
CREATE OR REPLACE FUNCTION is_store_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM admins WHERE auth_user_id = auth.uid() AND role = 'admin'
  );
$$;

-- 管理者(店舗管理者 or スタッフ)かどうか
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM admins WHERE auth_user_id = auth.uid());
$$;

-- ------------------------------------------------------------
-- stores(店舗)
--   ログインユーザーは店舗情報を読める。更新は店舗管理者のみ。
-- ------------------------------------------------------------
CREATE POLICY stores_select ON stores
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY stores_update ON stores
  FOR UPDATE TO authenticated
  USING (is_store_admin() AND id = current_admin_store_id())
  WITH CHECK (is_store_admin() AND id = current_admin_store_id());

-- ------------------------------------------------------------
-- members(会員)
--   会員は自分の行のみ。管理者は自店舗の会員を管理できる。
-- ------------------------------------------------------------
CREATE POLICY members_select_self ON members
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY members_update_self ON members
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  -- 会員が自分でグレードや所属店舗を書き換えられないようにする
  WITH CHECK (
    auth_user_id = auth.uid()
    AND store_id = (SELECT store_id FROM members m WHERE m.id = members.id)
    AND grade = (SELECT grade FROM members m WHERE m.id = members.id)
  );

CREATE POLICY members_admin_all ON members
  FOR ALL TO authenticated
  USING (is_admin() AND store_id = current_admin_store_id())
  WITH CHECK (is_admin() AND store_id = current_admin_store_id());

-- ------------------------------------------------------------
-- admins(管理者)
--   管理者は自店舗の管理者一覧を読める。会員には見せない(メールを含むため)。
--   トレーナー名を会員に出す必要が生じたら、公開用ビューを別途用意する。
-- ------------------------------------------------------------
CREATE POLICY admins_select ON admins
  FOR SELECT TO authenticated
  USING (is_admin() AND store_id = current_admin_store_id());

CREATE POLICY admins_update_self ON admins
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY admins_manage ON admins
  FOR ALL TO authenticated
  USING (is_store_admin() AND store_id = current_admin_store_id())
  WITH CHECK (is_store_admin() AND store_id = current_admin_store_id());

-- ------------------------------------------------------------
-- menus(メニュー)
--   会員も選択肢として読む必要がある。編集は管理者のみ。
-- ------------------------------------------------------------
CREATE POLICY menus_select ON menus
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY menus_admin_all ON menus
  FOR ALL TO authenticated
  USING (is_admin() AND store_id = current_admin_store_id())
  WITH CHECK (is_admin() AND store_id = current_admin_store_id());

-- ------------------------------------------------------------
-- memberships(通い放題の契約)
-- ------------------------------------------------------------
CREATE POLICY memberships_select_self ON memberships
  FOR SELECT TO authenticated
  USING (member_id = current_member_id());

CREATE POLICY memberships_admin_all ON memberships
  FOR ALL TO authenticated
  USING (is_admin() AND store_id = current_admin_store_id())
  WITH CHECK (is_admin() AND store_id = current_admin_store_id());

-- ------------------------------------------------------------
-- tickets(回数券)
--   残回数の増減は RPC(service_role)で行う。会員は読むだけ。
-- ------------------------------------------------------------
CREATE POLICY tickets_select_self ON tickets
  FOR SELECT TO authenticated
  USING (member_id = current_member_id());

CREATE POLICY tickets_admin_all ON tickets
  FOR ALL TO authenticated
  USING (is_admin() AND store_id = current_admin_store_id())
  WITH CHECK (is_admin() AND store_id = current_admin_store_id());

-- ------------------------------------------------------------
-- slots(予約枠)
--   空き状況を出すため、会員も読める必要がある。作成・クローズは管理者のみ。
-- ------------------------------------------------------------
CREATE POLICY slots_select ON slots
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY slots_admin_all ON slots
  FOR ALL TO authenticated
  USING (is_admin() AND store_id = current_admin_store_id())
  WITH CHECK (is_admin() AND store_id = current_admin_store_id());

-- ------------------------------------------------------------
-- reservations(予約)
--   会員は自分の予約を読める。
--   作成は create_reservation RPC 経由(定員と残回数を同時に判定するため)。
--   キャンセルも cancel_reservation RPC 経由に統一し、
--   クライアントからの直接 INSERT / UPDATE は許可しない。
-- ------------------------------------------------------------
CREATE POLICY reservations_select_self ON reservations
  FOR SELECT TO authenticated
  USING (member_id = current_member_id());

CREATE POLICY reservations_admin_all ON reservations
  FOR ALL TO authenticated
  USING (is_admin() AND store_id = current_admin_store_id())
  WITH CHECK (is_admin() AND store_id = current_admin_store_id());

-- ------------------------------------------------------------
-- staff_menus(トレーナー × メニュー)
-- ------------------------------------------------------------
CREATE POLICY staff_menus_select ON staff_menus
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY staff_menus_admin_all ON staff_menus
  FOR ALL TO authenticated
  USING (is_admin() AND store_id = current_admin_store_id())
  WITH CHECK (is_admin() AND store_id = current_admin_store_id());

-- ------------------------------------------------------------
-- training_records(トレーニング記録)
--   会員側の画面は 9/20版では封印しているが、
--   最終モデルで解禁するため読み取りポリシーは先に入れておく。
--   入力は管理者のみ。
-- ------------------------------------------------------------
CREATE POLICY records_select_self ON training_records
  FOR SELECT TO authenticated
  USING (member_id = current_member_id());

CREATE POLICY records_admin_all ON training_records
  FOR ALL TO authenticated
  USING (is_admin() AND store_id = current_admin_store_id())
  WITH CHECK (is_admin() AND store_id = current_admin_store_id());

-- ------------------------------------------------------------
-- survey_responses(アンケート)
--   会員は自分の回答を投稿・閲覧できる。集計は管理者。
-- ------------------------------------------------------------
CREATE POLICY survey_insert_self ON survey_responses
  FOR INSERT TO authenticated
  WITH CHECK (member_id = current_member_id());

CREATE POLICY survey_select_self ON survey_responses
  FOR SELECT TO authenticated
  USING (member_id = current_member_id());

CREATE POLICY survey_admin_read ON survey_responses
  FOR SELECT TO authenticated
  USING (is_admin() AND store_id = current_admin_store_id());

-- ------------------------------------------------------------
-- trial_bookings(体験予約フォーム)
--   ここだけ未ログイン(anon)からの INSERT を許す。会員登録前の導線のため。
--   読み取りは管理者のみ。anon が他人の申し込みを読めてはならない。
-- ------------------------------------------------------------
CREATE POLICY trial_insert_anon ON trial_bookings
  FOR INSERT TO anon, authenticated
  WITH CHECK (status = 'new');

CREATE POLICY trial_admin_all ON trial_bookings
  FOR ALL TO authenticated
  USING (is_admin() AND store_id = current_admin_store_id())
  WITH CHECK (is_admin() AND store_id = current_admin_store_id());

-- ------------------------------------------------------------
-- audit_logs(監査ログ)
--   閲覧は店舗管理者のみ。書き込みはサーバー側(service_role)のみとし、
--   クライアントからの INSERT ポリシーは意図的に作らない。
--   改ざんを防ぐため UPDATE / DELETE も許可しない。
-- ------------------------------------------------------------
CREATE POLICY audit_select ON audit_logs
  FOR SELECT TO authenticated
  USING (is_store_admin() AND store_id = current_admin_store_id());

-- ------------------------------------------------------------
-- 補足
-- ------------------------------------------------------------
-- ・会員登録時に members 行を作るのは signUp 後のサーバー処理(トリガ)に任せる。
--   クライアントからの members への INSERT ポリシーは作らない。
-- ・予約の作成・キャンセルは 0003 で追加する RPC に集約する。
-- ・ポリシー投入後は、会員アカウントと管理者アカウントの両方で
--   「他人のデータが見えないこと」を必ず確認する。
