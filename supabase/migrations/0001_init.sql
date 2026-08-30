-- ============================================================
-- FitGym 9/20版 初期スキーマ
-- ------------------------------------------------------------
-- 出典:
--   基本設計書_W1成果物 第5章(stores / training_records / survey_responses)
--   基本設計書_予約メニュー追補 第4章(menus / memberships / tickets / slots / reservations)
--   基本設計書_パスワード再設定追補 第4章(must_change_password / 監査ログ)
--
-- 設計方針:
--   ・認証は Supabase Auth に一元化。パスワードは auth.users が保持し、
--     members / admins は auth_user_id で紐づくプロフィール表とする。
--   ・全テーブルに store_id と created_at / updated_at を持たせ、複数店舗に備える。
--   ・課金形態(menus.billing_type)と予約枠(slots)を分離する。
--   ・RLS は全テーブルで有効化する(ポリシーは Step 2 で追加。現状は既定拒否)。
-- ============================================================

-- ------------------------------------------------------------
-- 共通:updated_at 自動更新
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- stores(店舗)
-- ------------------------------------------------------------
CREATE TABLE stores (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(100) NOT NULL,
  address    VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- members(会員プロフィール)
--   パスワードは持たない。auth.users を参照する。
-- ------------------------------------------------------------
CREATE TABLE members (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id             UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  auth_user_id         UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  name                 VARCHAR(100) NOT NULL,
  email                VARCHAR(255) NOT NULL UNIQUE,
  birth_date           DATE,
  grade                VARCHAR(20) NOT NULL DEFAULT 'normal',
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_members_store ON members(store_id);

-- ------------------------------------------------------------
-- admins(管理者・スタッフ)
--   role: 'admin'(店舗管理者) | 'staff'(記録入力のみ)
--   トレーナー(スタッフ)も本テーブルで管理し、slots.staff_id が参照する。
-- ------------------------------------------------------------
CREATE TABLE admins (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id             UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  auth_user_id         UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  name                 VARCHAR(100) NOT NULL,
  email                VARCHAR(255) NOT NULL UNIQUE,
  role                 VARCHAR(20) NOT NULL DEFAULT 'staff'
                         CHECK (role IN ('admin', 'staff')),
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_admins_store ON admins(store_id);

-- ------------------------------------------------------------
-- menus(メニュー。3課金形態を billing_type で区別)
-- ------------------------------------------------------------
CREATE TABLE menus (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  name         VARCHAR(100) NOT NULL,
  billing_type VARCHAR(20) NOT NULL
                 CHECK (billing_type IN ('time', 'unlimited', 'ticket')),
  duration_min INT,               -- time 系のみ使用(30/60/90 等)
  price        INT NOT NULL DEFAULT 0,
  max_active   INT,               -- 同時予約の上限。NULL なら既定値(5件)
  ticket_count INT,               -- ticket 系のみ:1口あたりの回数
  valid_months INT,               -- ticket 系のみ:有効期限(月数)
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_menus_store ON menus(store_id);

-- ------------------------------------------------------------
-- memberships(通い放題の契約期間)
-- ------------------------------------------------------------
CREATE TABLE memberships (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  member_id  UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  menu_id    UUID NOT NULL REFERENCES menus(id) ON DELETE RESTRICT,
  start_on   DATE NOT NULL,
  end_on     DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_on >= start_on)
);
CREATE INDEX idx_memberships_member ON memberships(member_id, end_on);

-- ------------------------------------------------------------
-- tickets(回数券の残数)
-- ------------------------------------------------------------
CREATE TABLE tickets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  member_id  UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  menu_id    UUID NOT NULL REFERENCES menus(id) ON DELETE RESTRICT,
  remaining  INT NOT NULL DEFAULT 0 CHECK (remaining >= 0),
  expire_on  DATE,                -- NULL は無期限
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tickets_member ON tickets(member_id, menu_id);

-- ------------------------------------------------------------
-- slots(全メニュー共通の予約枠)
--   capacity を持ち、is_closed で枠単位のクローズができる。
-- ------------------------------------------------------------
CREATE TABLE slots (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  staff_id   UUID REFERENCES admins(id) ON DELETE SET NULL,
  start_at   TIMESTAMPTZ NOT NULL,
  capacity   INT NOT NULL DEFAULT 1 CHECK (capacity >= 0),
  is_closed  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_slots_store_start ON slots(store_id, start_at);

-- ------------------------------------------------------------
-- reservations(予約。source に消費元を記録)
-- ------------------------------------------------------------
CREATE TABLE reservations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  member_id  UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  menu_id    UUID NOT NULL REFERENCES menus(id) ON DELETE RESTRICT,
  slot_id    UUID NOT NULL REFERENCES slots(id) ON DELETE RESTRICT,
  ticket_id  UUID REFERENCES tickets(id) ON DELETE SET NULL,  -- 回数券の場合の消費元
  source     VARCHAR(20) NOT NULL
               CHECK (source IN ('time', 'membership', 'ticket')),
  status     VARCHAR(20) NOT NULL DEFAULT 'booked'
               CHECK (status IN ('booked', 'done', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_res_slot ON reservations(slot_id, status);
CREATE INDEX idx_res_member ON reservations(member_id, status);
-- 同じ会員が同じ枠を二重に取ることを防ぐ(キャンセル済みは対象外)
CREATE UNIQUE INDEX uq_res_member_slot_active
  ON reservations(member_id, slot_id) WHERE status = 'booked';

-- ------------------------------------------------------------
-- staff_menus(トレーナー × メニューの紐づけ)
--   9/20版スコープの「トレーナー×メニュー紐づけ」用。設計書に表定義が無いため新設。
-- ------------------------------------------------------------
CREATE TABLE staff_menus (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  admin_id   UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  menu_id    UUID NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (admin_id, menu_id)
);

-- ------------------------------------------------------------
-- training_records(トレーニング記録。管理者の代理入力)
-- ------------------------------------------------------------
CREATE TABLE training_records (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  member_id    UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  admin_id     UUID REFERENCES admins(id) ON DELETE SET NULL,
  performed_on DATE NOT NULL,
  exercises    JSONB NOT NULL DEFAULT '[]'::jsonb,
  trainer_memo TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_records_member ON training_records(member_id, performed_on DESC);

-- ------------------------------------------------------------
-- survey_responses(ご意見アンケート)
-- ------------------------------------------------------------
CREATE TABLE survey_responses (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  member_id  UUID REFERENCES members(id) ON DELETE SET NULL,
  answers    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_survey_store ON survey_responses(store_id, created_at DESC);

-- ------------------------------------------------------------
-- trial_bookings(体験予約フォーム。会員登録前の申し込みを受ける)
--   9/20版スコープの「体験予約フォーム」用。設計書に表定義が無いため新設。
-- ------------------------------------------------------------
CREATE TABLE trial_bookings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  name         VARCHAR(100) NOT NULL,
  email        VARCHAR(255) NOT NULL,
  phone        VARCHAR(30),
  preferred_at TIMESTAMPTZ,
  note         TEXT,
  status       VARCHAR(20) NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new', 'contacted', 'done', 'cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_trial_store ON trial_bookings(store_id, created_at DESC);

-- ------------------------------------------------------------
-- audit_logs(監査ログ)
--   パスワード再設定追補の要件:仮パスワード発行操作を記録する。
-- ------------------------------------------------------------
CREATE TABLE audit_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  actor_admin_id   UUID REFERENCES admins(id) ON DELETE SET NULL,
  target_member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  action           VARCHAR(50) NOT NULL,   -- 例: 'issue_temp_password'
  detail           JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_store ON audit_logs(store_id, created_at DESC);

-- ------------------------------------------------------------
-- updated_at トリガ
-- ------------------------------------------------------------
DO $do$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'stores','members','admins','menus','memberships','tickets','slots',
    'reservations','staff_menus','training_records','survey_responses','trial_bookings'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END;
$do$;

-- ------------------------------------------------------------
-- RLS
--   全テーブルで有効化する(ポリシー未定義 = 既定拒否)。
--   会員は自分のデータのみ、管理者は自店舗のデータのみ、というポリシーは
--   Step 2(API実接続)で 0002_rls.sql として追加する。
-- ------------------------------------------------------------
DO $do$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'stores','members','admins','menus','memberships','tickets','slots',
    'reservations','staff_menus','training_records','survey_responses',
    'trial_bookings','audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END;
$do$;
