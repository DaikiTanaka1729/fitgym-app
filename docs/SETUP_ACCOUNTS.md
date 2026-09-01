# アカウント作成 手順(実行用)

更新:2026/9/1 / 所要:60〜90分
名義:**開発者の1アカウント運用**(ストアのみ成田様の法人名義。詳細は [NATIVE_APP.md](./NATIVE_APP.md))

> 2026/7/27 の `FitGym_インフラ契約_構築手順書.docx` は「店舗名義」前提で書かれており、
> 現在の方針とは食い違っています。本書と CLAUDE.md を正としてください。

---

## 順番と、その理由

**① GitHub → ② Supabase → ③ Vercel** の順で進めてください。

Vercel を最後にするのは、**インポート時に Supabase の接続情報を環境変数として入れられる**からです。
先に Vercel を作ると、あとから環境変数を足して再デプロイする二度手間になります。

3つとも GitHub アカウントでサインインできるので、続けてやると速く終わります。

---

## ① GitHub(20分)

### 1-1. アカウント作成

1. https://github.com を開き「Sign up」
2. メールアドレス → パスワード → ユーザー名を入力
   ユーザー名は後から変えづらいので、管理しやすいものに(例:`fitgym-dev`)
3. 画面の指示に従いパズル認証 → メールに届く8桁コードを入力

### 1-2. 二要素認証(必須)

1. 右上のアイコン → **Settings**
2. 左メニュー **Password and authentication**
3. **Enable two-factor authentication** → **Authentication app** を選択
4. 表示されたQRを認証アプリ(Google Authenticator 等)で読み取り、6桁コードを入力
5. **リカバリーコードが表示されます。必ず保存してください。**
   スマホを失くすとログインできなくなり、すべてのサービスに波及します

### 1-3. リポジトリ作成

1. 右上の「+」→ **New repository**
2. Repository name:**`fitgym-app`**
3. **Private** を選択
4. **「Add a README file」「Add .gitignore」「Choose a license」は3つともチェックを外す**
   手元に既にコミット済みのコードがあるため、空のリポジトリにする必要があります。
   チェックを入れると履歴が衝突して push できません
5. **Create repository**
6. 次の画面に出る `https://github.com/〇〇/fitgym-app.git` の**URLをコピー**

### 1-4. コードを push

URL をこちらにお知らせいただければ設定します。ご自身でやる場合は下記です。

```bash
git remote add origin https://github.com/〇〇/fitgym-app.git
git push -u origin main
```

初回は認証を求められます。ブラウザが開いたら GitHub にサインインして許可してください。

- [ ] アカウント作成・2FA・リカバリーコード保管
- [ ] `fitgym-app` を Private・空で作成
- [ ] push 完了

---

## ② Supabase(25分・うち待ち時間5分)

### 2-1. プロジェクト作成

1. https://supabase.com → 「Start your project」
2. **Continue with GitHub** でサインイン(①のアカウント)
3. Organization を作成
   - Name:`FitGym`
   - Type:Personal
   - Plan:**Free**
4. **New project**
   - Project name:`fitgym-prod`
   - Database Password:**「Generate a password」で生成し、必ずコピーして保管**
     この画面を離れると二度と表示されません
   - **Region:`Northeast Asia (Tokyo)`**
     ⚠️ **ここが最重要です。** 国内リージョン要件があり、間違えるとプロジェクトを作り直すことになります
   - Plan:Free
5. **Create new project** → 初期化を2〜5分待つ

### 2-2. 接続情報を控える

1. 左下の **Project Settings**(歯車)→ **API**
2. 以下をコピー
   - **Project URL**(`https://xxxxxxxx.supabase.co`)
   - **anon public** キー
     ※UIの更新により「publishable key」と表示されることがあります。同じものです
   - **service_role** キー(取り扱い注意。次項参照)

### 2-3. キーの扱い

| キー | 置き場所 | 備考 |
|---|---|---|
| Project URL | 共有OK | — |
| **anon public** | 共有OK | ブラウザに露出する前提の公開鍵。RLS で保護します |
| **service_role** | **共有しない** | 全権限。Vercel の環境変数画面にご自身で直接入力してください |
| DBパスワード | 保管のみ | アプリからは使いません |

- [ ] Organization `FitGym` 作成
- [ ] プロジェクト作成・**東京リージョン**選択
- [ ] DBパスワード保管
- [ ] Project URL / anon キー取得

---

## ③ Vercel(20分)

①の push と②の接続情報が揃ってから進めてください。

### 3-1. アカウント作成

1. https://vercel.com → 「Sign Up」→ **Continue with GitHub**
2. アカウント種別を聞かれたら **Hobby(個人利用)** を選択
3. GitHub のリポジトリへのアクセス許可を承認
   「All repositories」でも「Only select repositories → fitgym-app」でも構いません

### 3-2. プロジェクトをインポート

1. ダッシュボード → **Add New...** → **Project**
2. `fitgym-app` の横の **Import**
3. Framework Preset が **Vite** に自動判定されることを確認
   Build Command `npm run build` / Output Directory `dist` も自動で入ります。変更不要です
4. **Environment Variables** を開き、②で控えた値を登録

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | Project URL |
   | `VITE_SUPABASE_ANON_KEY` | anon public キー |

5. **Deploy** → 1〜2分待つ
6. 完了画面に出る `https://fitgym-app-xxxx.vercel.app` が**アプリのURLです**

以降は `main` ブランチに push するたび自動でデプロイされます。

- [ ] アカウント作成・GitHub 連携承認
- [ ] `fitgym-app` をインポート
- [ ] 環境変数2つを登録
- [ ] デプロイ成功・URLを取得

---

## 完了後にお知らせいただくもの

1. GitHub リポジトリの URL
2. Supabase の **Project URL**
3. Supabase の **anon public** キー
4. Vercel のデプロイURL

4がわかれば、その場で配布用QRを生成します。

```bash
npm run qr -- https://fitgym-app-xxxx.vercel.app
```

---

## 今週中(反映待ちがあるため早めに)

パスワード再設定メールに必要です。QR配布自体は `vercel.app` のURLで可能ですが、
**独自ドメインが無いと会員宛にメールを送れません**(Resend のテスト送信のみになります)。

### ④ 独自ドメイン取得

1. お名前.com / ムームードメイン / Cloudflare Registrar 等で取得(年 ¥1,000〜4,000)
2. 候補は第2希望まで用意(例:`fitgym-app.jp` / `fitgym-app.com`)
3. 取得後、**DNS管理画面にログインできる状態**にしておく

SSL証明書は Vercel が自動発行するため、別途購入は不要です。

### ⑤ Resend(メール送信)

1. https://resend.com → Sign up(GitHub サインイン可)
2. **Domains** → **Add Domain** → 取得したドメインを入力
3. 表示された **SPF / DKIM / DMARC** の3レコードを、④のDNS管理画面に追加
4. Resend の画面で **Verify** → ステータスが **Verified** になるまで待つ
   **通常は数十分、遅い場合は最大48時間。ここは待つしかありません**
5. **API Keys** → **Create API Key** → 権限 `Sending access` → キーを保管
   このキーはパスワード相当です。チャットに貼らず、Vercel の環境変数画面に直接入力してください
6. 送信元アドレスと表示名を決める(例:`noreply@ドメイン` /「FitGym 事務局」)

- [ ] ドメイン取得・DNS管理画面へログイン確認
- [ ] Resend 登録・DNSレコード追加
- [ ] ステータスが **Verified** になった
- [ ] API キー発行・保管
- [ ] 送信元アドレス / 表示名を決定

---

## 成田様との合意事項

開発者名義に集約するため、以下は書面で握っておくことを推奨します。

- **データの所有・管理** — 会員/予約データが開発者の Supabase 内に置かれること
- **費用負担** — 有料プランの決済が開発者カードになること、立替・請求の扱い
- **契約終了・移管時** — アカウント譲渡またはデータ移行の手順と費用
- **医療データ(最終モデル)** — その段階で店舗名義への分離を再検討すること

ストア(App Store / Google Play)のみ**成田様の法人名義**で開設します。理由と手順は [NATIVE_APP.md](./NATIVE_APP.md) を参照してください。

---

各サービスの登録画面は、デザインやボタン名が変わることがあります。
本書は2026年9月時点の内容です。画面が異なる場合は表示されている案内に沿って進めてください。
