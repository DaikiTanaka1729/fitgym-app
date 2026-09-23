-- ============================================================
-- 試用データの削除(1回限りの作業。マイグレーションではない)
-- ------------------------------------------------------------
-- 消すもの
--   ・予約(と枠の割当)
--   ・会員(と回数券・通い放題・指名券・利用メニュー・記録)
--   ・会員のログインアカウント(auth.users)
--   ・店舗管理者以外の管理者・トレーナー(とその受付枠・担当メニュー)
--     承認待ちの管理者も消す
--   ・その管理者のログインアカウント(auth.users)
--
-- 残すもの
--   ・店舗(stores)
--   ・メニュー(menus)と指名券の適用設定(nomination_menus)
--   ・店舗管理者(admins.role = 'admin' かつ status = 'active')
--
-- 実行後の状態について
--   トレーナーが店舗管理者1名だけになり、担当メニューの紐づけも
--   受付枠も無くなる。この状態では会員は誰も予約できない。
--   本番のトレーナーを登録し、担当メニューを設定し、
--   シフトを取り込むところから始めることになる。
--
-- 元に戻せない。実行前に Supabase のバックアップをご確認ください。
--
-- ------------------------------------------------------------
-- 削除処理をまるごと1つの DO ブロックに入れている。
-- SQL Editor は文ごとにコミットするため、
-- 一時表(CREATE TEMP TABLE ... ON COMMIT DROP)は作った直後に消える。
-- 消す対象は DO ブロック内の変数で持つ。
-- ============================================================

-- ------------------------------------------------------------
-- 1) 消す前の件数を確認する(ここだけ先に実行してもよい)
-- ------------------------------------------------------------
SELECT '会員'            AS 対象, COUNT(*) AS 件数 FROM members
UNION ALL SELECT '予約',            COUNT(*) FROM reservations
UNION ALL SELECT '回数券・指名券',  COUNT(*) FROM tickets
UNION ALL SELECT '通い放題',        COUNT(*) FROM memberships
UNION ALL SELECT '利用メニュー',    COUNT(*) FROM member_menus
UNION ALL SELECT '記録',            COUNT(*) FROM training_records
UNION ALL SELECT '受付枠',          COUNT(*) FROM slots
UNION ALL SELECT '管理者(残す)',  COUNT(*) FROM admins WHERE role = 'admin' AND status = 'active'
UNION ALL SELECT '管理者(消す)',  COUNT(*) FROM admins WHERE role <> 'admin' OR status <> 'active'
UNION ALL SELECT 'メニュー(残す)', COUNT(*) FROM menus;

-- ------------------------------------------------------------
-- 2) 削除
-- ------------------------------------------------------------
DO $reset$
DECLARE
  v_admin_ids    UUID[];   -- 消す管理者
  v_admin_users  UUID[];   -- 消す管理者のログインアカウント
  v_member_users UUID[];   -- 消す会員のログインアカウント
  v_keep_users   UUID[];   -- 残る管理者のログインアカウント
BEGIN
  -- 消す対象を先に控える。members / admins を消すと引けなくなるため。
  SELECT COALESCE(array_agg(id), '{}')
    INTO v_admin_ids
    FROM admins
   WHERE role <> 'admin' OR status <> 'active';

  SELECT COALESCE(array_agg(auth_user_id), '{}')
    INTO v_admin_users
    FROM admins
   WHERE (role <> 'admin' OR status <> 'active')
     AND auth_user_id IS NOT NULL;

  SELECT COALESCE(array_agg(auth_user_id), '{}')
    INTO v_member_users
    FROM members
   WHERE auth_user_id IS NOT NULL;

  -- 残る管理者のアカウントは消さない。
  -- 会員登録の引き金で、管理者にも会員の行ができていることがあるため。
  SELECT COALESCE(array_agg(auth_user_id), '{}')
    INTO v_keep_users
    FROM admins
   WHERE role = 'admin' AND status = 'active' AND auth_user_id IS NOT NULL;

  -- 予約(reservation_slots は連鎖で消える)
  DELETE FROM reservations;

  -- アンケートと体験予約。試用中の回答なので一緒に消す。
  -- 残したい場合はこの2行をコメントアウトしてください。
  DELETE FROM survey_responses;
  DELETE FROM trial_bookings;

  -- 申し送りメモ。試用中のものなので消す。
  DELETE FROM admin_notes;

  -- 監査ログ(仮パスワード発行などの記録)。試用中のものなので消す。
  DELETE FROM audit_logs;

  -- 会員。回数券・通い放題・指名券・利用メニュー・記録は連鎖で消える。
  DELETE FROM members;

  -- 消す管理者の受付枠。slots.staff_id は NOT NULL なので、
  -- 管理者より先に消さないと外部キーで止まる。
  DELETE FROM slots WHERE staff_id = ANY (v_admin_ids);

  -- 店舗管理者以外の管理者・トレーナー(担当メニューは連鎖で消える)
  DELETE FROM admins WHERE id = ANY (v_admin_ids);

  -- ログインアカウント
  DELETE FROM auth.users
   WHERE (id = ANY (v_member_users) OR id = ANY (v_admin_users))
     AND NOT (id = ANY (v_keep_users));

  RAISE NOTICE '削除しました。消した管理者 % 名、会員アカウント % 件。',
    COALESCE(array_length(v_admin_ids, 1), 0),
    COALESCE(array_length(v_member_users, 1), 0);
END
$reset$;

-- ------------------------------------------------------------
-- 3) 結果を確認する
-- ------------------------------------------------------------
SELECT '会員'         AS 対象, COUNT(*) AS 件数 FROM members
UNION ALL SELECT '予約',         COUNT(*) FROM reservations
UNION ALL SELECT '受付枠',       COUNT(*) FROM slots
UNION ALL SELECT '管理者',       COUNT(*) FROM admins
UNION ALL SELECT 'メニュー',     COUNT(*) FROM menus;

SELECT a.name AS 残った管理者, a.email, a.role FROM admins a ORDER BY a.created_at;
SELECT m.name AS 残ったメニュー, m.billing_type, m.status FROM menus m ORDER BY m.billing_type, m.name;
