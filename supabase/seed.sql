-- ============================================================
-- 開発用シードデータ(9/20版)
-- ------------------------------------------------------------
-- 動作確認のための最小データ。本番投入はしない。
-- 会員・管理者は Supabase Auth 側にユーザーを作ってから
-- auth_user_id を紐づける(Step 3 で手順化する)。
-- ============================================================

INSERT INTO stores (id, name, address)
VALUES ('00000000-0000-0000-0000-000000000001', 'FitGym 本店', '東京都')
ON CONFLICT DO NOTHING;

-- メニュー(3課金形態を1つずつ)
INSERT INTO menus (store_id, name, billing_type, duration_min, price, max_active, ticket_count, valid_months)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'パーソナル60分', 'time',      60,  8000, NULL, NULL, NULL),
  ('00000000-0000-0000-0000-000000000001', '月額フリーパス', 'unlimited', NULL, 15000, 5,   NULL, NULL),
  ('00000000-0000-0000-0000-000000000001', '10回券',         'ticket',    60, 70000, NULL,   10,    6)
ON CONFLICT DO NOTHING;

-- 予約枠(当日 10:00〜18:00 を30分刻み・定員3)
INSERT INTO slots (store_id, start_at, capacity)
SELECT
  '00000000-0000-0000-0000-000000000001',
  date_trunc('day', now()) + INTERVAL '10 hour' + (n * INTERVAL '30 minute'),
  3
FROM generate_series(0, 15) AS n;
