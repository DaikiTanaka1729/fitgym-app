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
BEGIN;

-- 消す対象を先に控える。members / admins を消すと引けなくなるため。
CREATE TEMP TABLE _gone_members ON COMMIT DROP AS
  SELECT id, auth_user_id FROM members;

CREATE TEMP TABLE _gone_admins ON COMMIT DROP AS
  SELECT id, auth_user_id FROM admins
   WHERE role <> 'admin' OR status <> 'active';   -- 承認待ちも消す

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
DELETE FROM slots s
 WHERE s.staff_id IN (SELECT id FROM _gone_admins);

-- 店舗管理者以外の管理者・トレーナー(担当メニューは連鎖で消える)
DELETE FROM admins a
 WHERE a.id IN (SELECT id FROM _gone_admins);

-- ログインアカウント。
-- 残る管理者が使っているアカウントは、念のため除外する。
DELETE FROM auth.users u
 WHERE u.id IN (
   SELECT auth_user_id FROM _gone_members WHERE auth_user_id IS NOT NULL
   UNION
   SELECT auth_user_id FROM _gone_admins  WHERE auth_user_id IS NOT NULL
 )
   AND u.id NOT IN (SELECT auth_user_id FROM admins WHERE auth_user_id IS NOT NULL);

COMMIT;

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
