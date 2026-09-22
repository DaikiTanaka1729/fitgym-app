-- ============================================================
-- シフトCSVの入れ替え取り込み
-- ------------------------------------------------------------
-- これまでの import_shifts は追加しかしなかった(ON CONFLICT DO NOTHING)。
-- そのため、同じ月を二度読み込ませると先に入っている枠が残り、
--   ・9:00〜18:00 を 9:00〜15:00 に直しても 15:00〜18:00 の枠が残る
--   ・出勤を取り消して空欄にしても、その日の枠が残る
-- という状態になっていた。出勤表は直して出し直すものなので、
-- 「その期間を入れ替える」を選べるようにする。
--
-- 入れ替えでも、予約が入っている枠は消さない。
-- 会員の予約を店舗側の都合で黙って消さないため。
-- 消せなかった枠は kept として返し、画面に出す。
--
-- p_scope … ファイルが扱っている範囲。[{ staff, from, to }]
--   出勤を取り消した日(ファイル上は空欄)を消すために必要。
--   空欄の日は p_rows に現れないので、範囲を別に受け取る。
-- ============================================================

-- ------------------------------------------------------------
-- トレーナーの照合
-- ------------------------------------------------------------
-- メールアドレスを優先し、見つからなければ氏名で照合する。
-- 同姓同名が2人いる場合は、取り違えると出勤が入れ替わるので登録しない。
-- 空白の有無は無視する(「田中太郎」と「田中 太郎」を同じとみなす)。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_staff(p_store_id UUID, p_key TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_admin UUID;
  v_hits  INT;
BEGIN
  IF p_key IS NULL OR btrim(p_key) = '' THEN
    RAISE EXCEPTION 'トレーナーが空です';
  END IF;

  SELECT a.id INTO v_admin
    FROM admins a
   WHERE a.store_id = p_store_id AND lower(a.email) = lower(btrim(p_key))
   LIMIT 1;
  IF v_admin IS NOT NULL THEN
    RETURN v_admin;
  END IF;

  SELECT COUNT(*) INTO v_hits
    FROM admins a
   WHERE a.store_id = p_store_id
     AND replace(replace(a.name, ' ', ''), '　', '')
       = replace(replace(btrim(p_key), ' ', ''), '　', '');

  IF v_hits = 0 THEN
    RAISE EXCEPTION 'トレーナーが見つかりません';
  ELSIF v_hits > 1 THEN
    RAISE EXCEPTION '同じ氏名のトレーナーが複数います。メールアドレスで指定してください';
  END IF;

  SELECT a.id INTO v_admin
    FROM admins a
   WHERE a.store_id = p_store_id
     AND replace(replace(a.name, ' ', ''), '　', '')
       = replace(replace(btrim(p_key), ' ', ''), '　', '');

  RETURN v_admin;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION resolve_staff(UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION resolve_staff(UUID, TEXT) TO authenticated;

-- 戻り値の列が増えるため、古い定義を消してから作り直す。
-- 引数違いで残っていると CREATE が通らないので、両方の形を消す。
-- (このファイルを二度実行しても通るようにするため)
DROP FUNCTION IF EXISTS import_shifts(JSONB);
DROP FUNCTION IF EXISTS import_shifts(JSONB, BOOLEAN, JSONB);

CREATE FUNCTION import_shifts(
  p_rows    JSONB,
  p_replace BOOLEAN DEFAULT FALSE,
  p_scope   JSONB   DEFAULT NULL
)
RETURNS TABLE (
  row_no  INT,
  staff   TEXT,
  created INT,
  removed INT,     -- 入れ替えで消した枠
  kept    INT,     -- 予約が入っていて消さなかった枠
  error   TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_store_id UUID;
  v_item     JSONB;
  v_no       INT := 0;
  v_key      TEXT;
  v_admin    UUID;
  v_from     DATE;
  v_to       DATE;
  v_start    TIME;
  v_end      TIME;
  v_cap      INT;
  v_made     INT;
  v_del      INT;
  v_keep     INT;
BEGIN
  IF NOT is_store_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_store_id := current_admin_store_id();

  -- ------------------------------------------------------------
  -- 1) 入れ替えのときは、対象期間の枠を先に片づける
  -- ------------------------------------------------------------
  IF p_replace AND p_scope IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_scope)
    LOOP
      v_key := btrim(COALESCE(v_item->>'staff', ''));

      BEGIN
        v_admin := resolve_staff(v_store_id, v_key);
        v_from  := (v_item->>'from')::DATE;
        v_to    := (v_item->>'to')::DATE;

        -- 予約が入っている枠は残す
        SELECT COUNT(*) INTO v_keep
          FROM slots s
         WHERE s.staff_id = v_admin
           AND s.start_at >= (v_from::TIMESTAMP AT TIME ZONE 'Asia/Tokyo')
           AND s.start_at <  ((v_to + 1)::TIMESTAMP AT TIME ZONE 'Asia/Tokyo')
           AND EXISTS (SELECT 1 FROM reservation_slots rs
                        JOIN reservations r ON r.id = rs.reservation_id
                       WHERE rs.slot_id = s.id AND r.status = 'booked');

        DELETE FROM slots s
         WHERE s.staff_id = v_admin
           AND s.start_at >= (v_from::TIMESTAMP AT TIME ZONE 'Asia/Tokyo')
           AND s.start_at <  ((v_to + 1)::TIMESTAMP AT TIME ZONE 'Asia/Tokyo')
           AND NOT EXISTS (SELECT 1 FROM reservation_slots rs WHERE rs.slot_id = s.id);

        GET DIAGNOSTICS v_del = ROW_COUNT;

        row_no := 0; staff := v_key; created := 0;
        removed := v_del; kept := v_keep; error := NULL;
        RETURN NEXT;

      EXCEPTION WHEN OTHERS THEN
        row_no := 0; staff := v_key; created := 0;
        removed := 0; kept := 0; error := SQLERRM;
        RETURN NEXT;
      END;
    END LOOP;
  END IF;

  -- ------------------------------------------------------------
  -- 2) 出勤を1件ずつ入れる
  -- ------------------------------------------------------------
  -- 行ごとに結果を返し、一部の行が駄目でも残りは登録する。
  -- 出勤表をそのまま貼れるようにするため、途中で止めない。
  -- ------------------------------------------------------------
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_no  := v_no + 1;
    v_key := btrim(COALESCE(v_item->>'staff', ''));

    BEGIN
      v_admin := resolve_staff(v_store_id, v_key);

      v_from  := (v_item->>'date')::DATE;
      v_to    := COALESCE(NULLIF(v_item->>'date_to', ''), v_item->>'date')::DATE;
      v_start := (v_item->>'start')::TIME;
      v_end   := (v_item->>'end')::TIME;
      v_cap   := GREATEST(1, COALESCE(NULLIF(v_item->>'capacity', '')::INT, 1));

      IF v_to < v_from THEN
        RAISE EXCEPTION '終了日が開始日より前です';
      END IF;
      IF v_end <= v_start THEN
        RAISE EXCEPTION '終了時刻が開始時刻より後になっていません';
      END IF;

      INSERT INTO slots (store_id, staff_id, start_at, capacity)
      SELECT
        v_store_id,
        v_admin,
        ((v_from + d)::TIMESTAMP + (n * INTERVAL '30 minute')) AT TIME ZONE 'Asia/Tokyo',
        v_cap
      FROM generate_series(0, (v_to - v_from)) AS d,
           generate_series(0, 47) AS n
      WHERE (n * INTERVAL '30 minute') >= v_start
        AND (n * INTERVAL '30 minute') <  v_end
      ON CONFLICT (staff_id, start_at) DO NOTHING;

      GET DIAGNOSTICS v_made = ROW_COUNT;

      row_no := v_no; staff := v_key; created := v_made;
      removed := 0; kept := 0; error := NULL;
      RETURN NEXT;

    EXCEPTION WHEN OTHERS THEN
      row_no := v_no; staff := v_key; created := 0;
      removed := 0; kept := 0; error := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION import_shifts(JSONB, BOOLEAN, JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION import_shifts(JSONB, BOOLEAN, JSONB) TO authenticated;
