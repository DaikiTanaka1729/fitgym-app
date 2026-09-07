-- ============================================================
-- M-10 体験予約フォーム(未ログインからの申し込み)
-- ------------------------------------------------------------
-- trial_bookings には anon の INSERT を許すポリシーが入っているが、
-- store_id を指定する必要がある一方、stores は未ログインから読めない
-- (stores_select は authenticated 限定)。
--
-- そこで、店舗の解決も含めてサーバー側で完結させる関数を用意する。
-- 未ログインに公開するのはこの関数だけで、テーブルは触らせない。
-- ============================================================

CREATE OR REPLACE FUNCTION create_trial_booking(
  p_name         TEXT,
  p_email        TEXT,
  p_phone        TEXT DEFAULT NULL,
  p_preferred_at TIMESTAMPTZ DEFAULT NULL,
  p_note         TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_store_id UUID;
  v_id       UUID;
BEGIN
  IF length(TRIM(COALESCE(p_name, ''))) = 0 THEN
    RAISE EXCEPTION 'name_required';
  END IF;
  IF COALESCE(p_email, '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'invalid_email';
  END IF;

  -- 9/20版は単一店舗。最初の店舗に紐づける。
  SELECT s.id INTO v_store_id FROM stores s ORDER BY s.created_at LIMIT 1;
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'store_not_found';
  END IF;

  -- 同じメールアドレスからの連続送信を抑える(いたずら・二重送信対策)
  IF EXISTS (
    SELECT 1 FROM trial_bookings t
     WHERE t.email = LOWER(TRIM(p_email))
       AND t.created_at > now() - INTERVAL '10 minute'
  ) THEN
    RAISE EXCEPTION 'too_many_requests';
  END IF;

  INSERT INTO trial_bookings (store_id, name, email, phone, preferred_at, note, status)
  VALUES (
    v_store_id,
    TRIM(p_name),
    LOWER(TRIM(p_email)),
    NULLIF(TRIM(COALESCE(p_phone, '')), ''),
    p_preferred_at,
    NULLIF(TRIM(COALESCE(p_note, '')), ''),
    'new'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

-- 未ログインからも実行できるようにする(公開する入口はこの関数だけ)
GRANT EXECUTE ON FUNCTION create_trial_booking(TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT) TO anon, authenticated;

-- ------------------------------------------------------------
-- A-06 アンケートの回答一覧(管理者向け)
-- ------------------------------------------------------------
-- survey_responses は RLS で管理者が自店舗ぶんを読めるが、
-- 会員名を添えるために関数でまとめて返す。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_survey_responses()
RETURNS TABLE (
  id          UUID,
  answers     JSONB,
  created_at  TIMESTAMPTZ,
  member_name TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT sr.id, sr.answers, sr.created_at, m.name::TEXT
    FROM survey_responses sr
    LEFT JOIN members m ON m.id = sr.member_id
   WHERE sr.store_id = current_admin_store_id()
   ORDER BY sr.created_at DESC;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION list_survey_responses() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION list_survey_responses() TO authenticated;

-- ------------------------------------------------------------
-- M-06 アンケートの回答(会員)
-- ------------------------------------------------------------
-- store_id を会員のものに揃えるため関数経由にする。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION submit_survey(p_answers JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_member_id UUID;
  v_store_id  UUID;
  v_id        UUID;
BEGIN
  v_member_id := current_member_id();
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT mm.store_id INTO v_store_id FROM members mm WHERE mm.id = v_member_id;

  INSERT INTO survey_responses (store_id, member_id, answers)
  VALUES (v_store_id, v_member_id, COALESCE(p_answers, '{}'::jsonb))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION submit_survey(JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION submit_survey(JSONB) TO authenticated;
