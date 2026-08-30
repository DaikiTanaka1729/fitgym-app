# FitGym アプリ — プロジェクトコンテキスト

トレーニングジム向けの予約・会員管理アプリ。クライアントは成田様。
このファイルは Claude Code がプロジェクトの前提を把握するためのもの。

## プロジェクト概要

- 2フェーズ構成:**9/20版(単一店舗PoC)** → **最終モデル(複数店舗・AI・医療連携)**
- 現在は 9/20版 を開発中。金額 ¥2,500,000、着手 2026/7/20 / リリース 2026/9/20。
- 業態は**トレーニングジム**(要望書は「施術」表記だが、トレーニングセッションと読み替える)。

## 技術スタック

- フロントエンド:React(会員UI + 管理者UI を1アプリで権限出し分け)
- ホスティング:Vercel(GitHub連携で自動デプロイ)
- バックエンド:Supabase(PostgreSQL / 認証 / ストレージ)、**東京リージョン必須**
- メール:Resend(パスワード再設定・通知)
- アカウントは開発者の1アカウントで一括運用(店舗名義ではない)

## 確定済みの設計方針(重要)

- 会員向け画面=**ライトテーマ(白背景)**、管理者向け=**ネイビー**。
- プライマリ=緑 #1A9E6E / ネイビー #1E2761 / アクセント紫 #534AB7。
- 予約は「課金形態(どう売るか)」と「予約枠(受入キャパ)」を**分離**して設計する。
  - 課金形態3種:time(時間課金)/ unlimited(通い放題)/ ticket(回数券)。menus.billing_type で区別。
  - 予約枠(slots)は全メニュー共通。capacity(定員)を持ち、部分的にクローズ可能。
- 予約可否は2段階:A) 課金形態別チェック(契約期間・残回数等) → B) 枠の空きチェック(共通)。
- 同時予約上限=基準5件(メニュー毎に変更可)。プレミアムは1日2回=1回扱い、他は1日1枠。
- 記録画面・マイページは 9/20版では「近日公開」で封印。最終モデルで解禁。
- パスワード再設定=会員+管理者、セルフ(メール)+管理者代行(仮PW発行/初回強制変更)。
- 配色はトークンに集約し、直値をハードコードしない。

## DB スキーマ(9/20版・PostgreSQL/Supabase)

主要テーブル(全テーブルに store_id と created_at/updated_at を持たせ、複数店舗に備える):

- `stores` — 店舗
- `members` — 会員(store_id, auth_user_id → auth.users.id, name, email, birth_date, grade, must_change_password)
- `admins` — 管理者(store_id, auth_user_id → auth.users.id, email, role, must_change_password)
- `menus` — メニュー(billing_type: time|unlimited|ticket, duration_min, price, max_active)
- `memberships` — 通い放題契約(member_id, menu_id, start_on, end_on)
- `tickets` — 回数券(member_id, menu_id, remaining, expire_on)
- `slots` — 予約枠・共通(store_id, staff_id, start_at, capacity, is_closed)
- `reservations` — 予約(member_id, menu_id, slot_id, source, status)
- `training_records` — 記録(member_id, admin_id, performed_on, exercises JSONB, trainer_memo)
- `survey_responses` — アンケート(member_id, answers JSONB, created_at)
- `audit_logs` — 監査ログ(store_id, actor_admin_id, target_member_id, action, created_at)※仮PW発行等を記録

詳細な CREATE 文は docs/ の基本設計書・予約メニュー追補を参照。

## 9/20版のスコープ

含む:認証(会員登録/ログイン/管理者/PW再設定)、予約(3課金形態・30分等の枠・チケット消費)、
メニュー設定、予約枠カレンダー(定員単位クローズ)、トレーナー×メニュー紐づけ、
会員管理(検索・CSV)、記録の代理入力(トレーナーメモ)、体験予約フォーム、アンケート。

含まない(Phase2以降):指名集計、回数券の管理機能・家族共有、会計、売上管理、
シフト作成、他店横断、属性集計、AIコーチ、医療連携。

## 実装の現状(このプロジェクトで作成済み)

Step 0(土台づくり)まで完了。`npm run dev` で認証画面が動く。

- Vite + React。エントリは `src/main.jsx` / ルーティングは `src/App.jsx`。
- `src/theme/tokens.js` — デザイントークン(T / font / radius / shadow)。配色はここに集約。
- `src/components/` — 共通UI。1部品1ファイル + `index.js` から re-export。
- `src/api/` — client / errors / auth / menus / reservations / records に分割。`index.js` が窓口。
- `src/screens/auth/` — M-01 会員登録 / M-02 ログイン / M-08・A-07 パスワード再設定 / A-01 管理者ログイン。
- `supabase/migrations/0001_init.sql` — 初期スキーマ(未投入)。`supabase/seed.sql` は開発用データ。
- `demo/fitgym-demo.html` — 全画面の遷移・動作イメージ。ブラウザで開くだけで動く。
- `docs/` — 設計ドキュメント一式 + `SETUP_ACCOUNTS.md`(アカウント作成チェックリスト)。
- **注意**:`src/screens/auth/mockAuth.js` は仮実装。Step 3 で `authApi` に差し替えてファイルごと削除する。
- **注意**:RLS は全テーブルで有効化済みだがポリシー未定義(=既定拒否)。Step 2 で `0002_rls.sql` を追加する。

## 次にやること(この順で進める)

1. 環境構築:Supabase プロジェクト作成(東京リージョン)、Vercel 連携、DB マイグレーション投入。
2. API 基盤の Supabase 実接続(src/api/ の mock を本物に置換)。
3. 認証の本番接続・結合テスト。
4. 予約機能の本番実装(3課金形態・30分枠・チケット消費・定員クローズ)。
5. 管理者機能(会員管理・記録入力・メニュー設定・トレーナー紐づけ・アンケート集計)。
6. 結合テスト → Vercel デプロイ → 受入。

## コーディング規約

- 配色はデザイントークン(T オブジェクト等)経由。直値のカラーコードを画面に書かない。
- API 呼び出しは src/api/ 経由に統一。戻り値は { data, error }。画面側は error を表示するだけ。
- 認証は **Supabase Auth** に一元化する。パスワードは `auth.users` が保持し、`members`/`admins` は
  `auth_user_id` で参照するプロフィール表とする(独自の password_hash 列は持たない)。
- 会員と管理者の役割は分離(members / admins の別テーブル+ロールで判定)。
- パスワードをコード・DB・ログに平文で保持しない。仮パスワードも発行直後に Supabase Auth へ渡すのみ。
- 破壊的変更やスキーマ変更は docs/ の設計書と整合を取る。
