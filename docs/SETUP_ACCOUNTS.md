# アカウント作成・契約 手順(実行用チェックリスト)

作成日:2026/8/31 / 対象:FitGym 9/20版
名義方針:**開発者の1アカウントで一括運用**(成田様側の作業は原則不要)

> 既存の `FitGym_アカウント作成手順書.docx`(8/4・開発者名義)を実行用にまとめ直し、
> Resend・独自ドメインを追加したものです。
> `FitGym_インフラ契約_構築手順書.docx`(7/27)は「店舗名義」前提で書かれており、
> 現在の方針(CLAUDE.md 記載の開発者1アカウント運用)とは**食い違っています**。
> 本書と CLAUDE.md を正とし、7/27版は参考資料として扱ってください。

---

## 全体の進め方

| 系統 | 内容 | 所要 | 備考 |
|---|---|---|---|
| A系(即日で終わる) | GitHub → Supabase → Vercel | 合計 60〜90分 | 3つとも GitHub でサインインするので一気にやるのが速い |
| B系(待ちが発生する) | 独自ドメイン取得 → Resend 登録 → DNS認証 | 作業30分+**反映待ち 数十分〜最大48時間** | A系と**並行で今日中に着手** |
| C系(任意・後回し可) | Sentry(エラー監視) | 15分 | 9/20版では無くても可 |

**B系を最優先で着手してください。** DNS の反映待ちだけは、こちらの実装努力で短縮できません。
ドメインが無いと Resend は本番送信ができず(テスト用アドレスへの送信のみ)、パスワード再設定メールが
実運用できないため、Step 3(認証)の完了条件に直結します。

---

## A-1. GitHub

1. https://github.com → 「Sign up」
2. メール / パスワード / ユーザー名を入力(ユーザー名例:`fitgym-dev`)
3. メール宛の確認コードを入力
4. **2FA を有効化**:右上アイコン → Settings → Password and authentication →
   Enable two-factor authentication → Authentication app → 認証アプリでQR読取 → 6桁入力
5. **リカバリーコードを保管**(パスワード管理ツール or 印刷して保管)
6. リポジトリを作成:名前 `fitgym-app`、**Private**、README等のチェックは**すべて外す**
   (既に手元にファイルがあるため、空のリポジトリにする)

- [ ] アカウント作成・2FA・リカバリーコード保管
- [ ] `fitgym-app` リポジトリ作成(Private・空)

## A-2. Supabase

1. https://supabase.com → 「Start your project」
2. 「Continue with GitHub」でサインイン
3. Organization 作成:名前 `FitGym`(プラン:Free)
4. 「New Project」
   - Project name: `fitgym-prod`
   - Database Password: **Generate a password** → **必ずコピーして保管**(再表示されない)
   - **Region: `Northeast Asia (Tokyo)`** ← 最重要。ここを間違えると作り直し
5. 初期化(数分)を待つ
6. 接続情報を控える:Settings → API
   - `Project URL`
   - `anon public` キー
   - `service_role` キー(※取扱注意。詳細は下の「鍵の扱い」参照)

- [ ] Organization `FitGym` 作成
- [ ] プロジェクト作成・**東京リージョン**選択
- [ ] DBパスワード保管
- [ ] Project URL / anon key / service_role key 取得

> **注意**:Free プランは一定期間アクセスが無いと自動で一時停止されます。
> 受入〜本番運用の段階で Pro($25/月〜)への切り替えが必要です(日次バックアップも Pro から)。

## A-3. Vercel

1. https://vercel.com → 「Sign Up」→ 「Continue with GitHub」
2. GitHub リポジトリへのアクセス許可を承認
3. アカウント種別を聞かれたら **Hobby(個人)** で開始
4. ダッシュボードが出れば完了(**リポジトリの Import・環境変数の登録はこちらで行います**)

- [ ] アカウント作成・GitHub連携の承認

---

## B-1. 独自ドメイン取得

1. お名前.com / ムームードメイン / Cloudflare Registrar 等で取得
2. 候補を第2希望まで用意(例:`fitgym-app.jp` / `fitgym-app.com`)
3. 費用:年 ¥1,000〜4,000 程度
4. 取得後、**DNS管理画面にログインできる状態**にしておく(この後 Resend と Vercel でレコードを追加します)

- [ ] ドメイン取得
- [ ] DNS管理画面へログインできることを確認

> SSL証明書は Vercel が自動発行するので、別途購入は不要です。

## B-2. Resend(メール送信)

1. https://resend.com → Sign up(GitHub サインイン可)
2. 「Domains」→ 「Add Domain」→ 取得したドメインを入力
3. 表示される **DNSレコード(SPF / DKIM / DMARC)** を、B-1 のDNS管理画面に追加
4. Resend の画面で「Verify」→ ステータスが **Verified** になるまで待つ
   - 通常 数十分、遅い場合は最大48時間
5. 「API Keys」→ 「Create API Key」→ 権限は `Sending access` → **キーを保管**
6. 送信元アドレスを決める(例:`noreply@<ドメイン>`、表示名「FitGym 事務局」)

- [ ] Resend 登録
- [ ] DNSレコード追加
- [ ] ドメインが **Verified** になった
- [ ] API キー発行・保管
- [ ] 送信元アドレス/表示名を決定

---

## C. Sentry(任意・後回し可)

https://sentry.io → Sign up → プロジェクト作成(React)→ DSN を控える。
9/20版のスコープでは必須ではありません。時間が押した場合は省略して構いません。

---

## 鍵の扱い(重要)

| 鍵 | 置き場所 | 備考 |
|---|---|---|
| Supabase `anon` key | `.env.local` と Vercel 環境変数 | ブラウザに露出する前提の公開鍵。RLS で守る |
| Supabase `service_role` key | **Vercel の環境変数画面に成田様/開発者が直接入力** | 全権限。**フロントのコード・`.env.local`・チャットに貼らない** |
| Resend API キー | 同上(サーバー側のみ) | パスワード相当 |
| Supabase DBパスワード | パスワード管理ツールに保管のみ | アプリからは使わない |

`service_role` キーと Resend API キーは、チャットに貼り付けず、**Vercel の管理画面に直接入力**してください。
こちらの実装では「環境変数名」だけを指定します。

---

## 完了後に私へ共有いただくもの

A-1〜A-3 が終わった時点で、以下だけお知らせいただければ実装を進められます。

1. GitHub リポジトリの URL
2. Supabase の **Project URL**
3. Supabase の **anon public キー**
4. (B系完了後)独自ドメイン名と、Resend の送信元アドレス

これらが揃えば、Step 1(DBマイグレーション投入)→ Step 2(API実接続)へ進みます。
A系だけ先に終われば、B系(ドメイン/Resend)の反映待ち中に Step 1〜2 を進められます。

---

## 成田様との合意事項(1アカウント運用のため)

開発者名義に集約する以上、以下は着手前に文書で握っておくことを推奨します
(`FitGym_アカウント作成手順書.docx` 第1章の再掲)。

- **データの所有・管理**:会員/予約データが開発者の Supabase 内に置かれること
- **費用負担**:有料プランの決済が開発者カードになること、立替・請求の扱い
- **契約終了・移管時**:アカウント譲渡またはデータ移行の手順と費用
- **医療データ(最終モデル)**:規制上、その段階で店舗名義への分離を再検討すること
