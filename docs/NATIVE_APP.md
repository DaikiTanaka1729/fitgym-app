# ネイティブアプリ化 — TestFlight 優先の手順

作成日:2026/8/31 / 対象:FitGym 9/20版
方式:**Capacitor**(既存の React コードをそのまま iOS / Android アプリに同梱する)
更新:2026/9/1

## 進め方(2段階)

| 時期 | 形態 | 配布方法 | 前提 |
|---|---|---|---|
| **9/20(デモ)** | **PWA** | QRを読み取り「ホーム画面に追加」 | **なし**(Apple/Google のアカウント不要・審査不要) |
| 法人化後 | ネイティブアプリ | TestFlight → App Store / Google Play | 法人名義のアカウント + D-U-N-S |

**9/20 はデモのため PWA で配布します。** 成田様の法人化がこれからで D-U-N-S 番号を取得できず、
Organization アカウントが作れないためです。PWA なら審査もアカウントも要らず、
QRを読み取ってホーム画面に追加すれば、アイコンから全画面で起動する「アプリ」になります。

ネイティブ側(iOS / Android プロジェクトと CI)は構築済みで、そのまま残します。
**同じコードベースから両方出せる**ので、法人化が完了した時点でストア展開に進めます。

### PWA として用意済みのもの

- `public/manifest.webmanifest` — アプリ名・アイコン・`display: standalone`(全画面起動)
- `public/sw.js` — サービスワーカー(Android の「アプリをインストール」に必要)
- `public/icons/` — 192 / 512 / マスカブル / apple-touch-icon
- `index.html` の iOS 用メタタグ

配布用QRは、Vercel のURLが決まったら下記で生成します。

```bash
npm run qr -- https://〇〇.vercel.app
```

`dist-qr/` に印刷用PNG(1200px)とSVGが出ます。

---

## 以降はネイティブアプリ(法人化後)の話です

最初の目標:**TestFlight で成田様が実機で触れる状態にする**

---

## なぜ Capacitor か

React Native に移すと全画面を書き直すことになり、残り期間では選べません。
Capacitor は `npm run build` の成果物(`dist/`)をネイティブアプリの中で動かす方式なので、
**いま書いてある画面コードは1行も捨てずに済みます**。

導入済みのもの:

```
capacitor.config.json   appId = jp.fitgym.app / appName = FitGym
ios/                    Xcode プロジェクト(Swift Package Manager 構成)
android/                Android Studio プロジェクト
```

Web を直したら `npm run build && npx cap sync` で両方に反映されます。

---

## 越えられない前提が2つあります

### 1. Windows では iOS アプリをビルド・署名できない

Apple の署名ツールが macOS でしか動かないためで、回避策はありません。
**本プロジェクトはクラウド macOS CI(GitHub Actions)で進めます。** Mac の購入・レンタルは不要です。

ワークフローは [.github/workflows/ios-testflight.yml](../.github/workflows/ios-testflight.yml) に用意済みです。
設定手順は下の「CI の設定」を参照してください。

Capacitor 8 は CocoaPods ではなく Swift Package Manager 構成なので、CI 側の準備は比較的軽く済みます。

### 2. Apple Developer Program の登録が要る(TestFlight も対象)

- 費用:**年間 $99**
- 個人名義なら Apple ID だけで申請可。**法人名義は D-U-N-S 番号**が必要で、未取得の場合その取得だけで数日〜2週間かかります
- 申請から承認まで、通常1〜3営業日

TestFlight は Apple Developer Program に入っていないと使えません。**ここが一番のクリティカルパスです。今日中に着手してください。**

---

## TestFlight の2区分

| 区分 | 人数 | 審査 | 使いどころ |
|---|---|---|---|
| **内部テスト** | 最大100名(App Store Connect にユーザー登録した人) | **不要**。アップロード処理が終わり次第すぐ配信 | 成田様に最速で触ってもらうならこれ |
| 外部テスト | 最大10,000名 | Beta App Review が入る(通常1日程度) | 店舗スタッフや会員モニターに広げる段階 |

**成田様は「内部テスター」として App Store Connect に招待する**のが最短です。
成田様側で Apple ID と、iPhone への TestFlight アプリのインストールが必要になります。

---

## CI の設定(クラウド macOS ビルド)

Mac が無くても iOS アプリをビルドして TestFlight へ上げられます。
署名は **App Store Connect API キー**に任せ、Xcode 側に証明書とプロビジョニングプロファイルを
自動生成させる方式にしました(`-allowProvisioningUpdates`)。
そのため、**証明書(.p12)を手元で作って登録する作業は不要**です。ここが一番つまずくところなので、避けてあります。

### 手順

**① Apple Developer Program の承認を待つ**(前述。ここが通らないと先に進めません)

**② App Store Connect にアプリを登録する**(ブラウザのみ。Mac 不要)
1. [App Store Connect](https://appstoreconnect.apple.com) → 「マイ App」→ 「+」
2. プラットフォーム:iOS / 名前:FitGym / 主要言語:日本語
3. バンドルID:`jp.fitgym.app`(先に Developer サイトの Identifiers で登録が必要)
4. SKU:任意の管理用文字列(例:`fitgym-app-001`)

**③ API キーを発行する**(ブラウザのみ)
1. App Store Connect →「ユーザとアクセス」→「インテグレーション」→ App Store Connect API
2. 「+」でキーを生成。アクセス権は **App Manager 以上**(証明書を自動生成させるため必須)
3. **`.p8` ファイルは一度しかダウンロードできません。** 必ず保存してください
4. 同じ画面に表示される **キーID** と **Issuer ID** も控える

**④ Team ID を確認する**
[Apple Developer のメンバーシップ画面](https://developer.apple.com/account)に表示される10文字の英数字です。

**⑤ GitHub にシークレットを登録する**
リポジトリ → Settings → Secrets and variables → Actions → New repository secret

| シークレット名 | 中身 |
|---|---|
| `APPSTORE_KEY_ID` | ③のキーID |
| `APPSTORE_ISSUER_ID` | ③の Issuer ID |
| `APPSTORE_PRIVATE_KEY` | ③の `.p8` ファイルの中身をそのまま貼り付け(`-----BEGIN PRIVATE KEY-----` の行を含めて全部) |
| `APPLE_TEAM_ID` | ④の Team ID |
| `VITE_SUPABASE_URL` | Supabase の Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase の anon キー |
| `VITE_PASSWORD_RESET_URL` | パスワード再設定メールの戻り先(独自ドメイン取得後) |

### 実行のしかた

GitHub の Actions タブ →「iOS TestFlight」→「Run workflow」。
`ios-v1.0.0` のようなタグを push しても走ります。

ビルド番号は GitHub の実行番号を自動で使うため、手で上げる必要はありません。
アップロード後、App Store Connect の TestFlight タブで処理完了(通常5〜15分)を待ってから配信します。

### 費用について

GitHub Actions の macOS ランナーは、プライベートリポジトリだと**通常の10倍**の分数を消費します。
1回のビルドが10分なら100分相当です。Free プランの月2,000分だと月20回程度が上限になります。
頻繁に回す場合は Team プラン以上への変更を検討してください。

---

## 提出までに必要なもの

- [ ] アプリアイコン **1024×1024 PNG**(角丸なし・透過なし)
- [ ] バンドルID `jp.fitgym.app` を App Store Connect で登録
- [ ] バージョン / ビルド番号の運用ルール(例:`1.0.0` + ビルド番号を毎回インクリメント)
- [ ] 暗号化の輸出申告(通信が HTTPS のみなら「該当なし」で申告)
- [ ] テスターへの案内文(何をテストしてほしいか)
- [ ] プライバシーポリシーの URL ※外部テストと本公開で必須。内部テストのみなら後回し可
- [ ] スプラッシュ画面の画像

アイコンとスプラッシュは元画像を1点いただければ、こちらで両OS分のサイズに展開します。

---

## Android(Google Play)は後追いにします

Play ストアには、iOS には無い日数の壁があります。

- **2023年11月以降に作成した個人開発者アカウント**は、本番公開の前に
  **12名以上のテスターによるクローズドテストを14日間連続**で実施する必要があります
- **法人(組織)アカウントはこの要件が免除**されます

14日間は短縮できないため、個人アカウントで進めると9月中の Play 公開はできません。
**Android も出すなら、法人アカウントで登録する**ことを強く推奨します(D-U-N-S 番号が必要です)。
費用は登録料 $25 の1回払いのみです。

なお Android プロジェクトはすでに生成済みで、いつでもビルドに入れます。
ローカルでビルドする場合は JDK 21 と Android Studio が必要です(このPCには未導入)。

---

## パスワード再設定メールの戻り先

ネイティブアプリでは画面のURLが `capacitor://localhost` になるため、
メール内のリンクをそのままでは開けません。独自ドメインに **Universal Links(iOS)/ App Links(Android)** を張り、
そのURLを `VITE_PASSWORD_RESET_URL` に設定します。

つまり [SETUP_ACCOUNTS.md](./SETUP_ACCOUNTS.md) の **B系(独自ドメイン取得 → Resend)は引き続き必須**です。
むしろネイティブ化したことで、ドメインの用途がメール送信だけでなくアプリのリンク解決にも広がりました。

---

## 日程の見立て

| 時期 | 内容 |
|---|---|
| 8/31 週 | Apple Developer Program 申請(**最優先**)/ Mac または CI の手配 / アイコン原画の用意 |
| 9月上旬 | 初回ビルドを TestFlight にアップロード → 成田様が実機で起動できる状態に |
| 9/20 | 認証 + 予約機能まで入った版を TestFlight で配信 |
| 10月以降 | App Store 本公開の審査 / Google Play(法人アカウント + クローズドテスト14日) |

**9/20 に「App Store で一般公開」は成立しません。**
9/20 の受入は「TestFlight で実機動作を確認いただく」形に読み替える必要があります。
この点は成田様との合意が要るため、早めにお伝えください。

---

## 開発中のコマンド

```bash
npm run dev                      # ブラウザで確認(いちばん速い)
npm run build && npx cap sync    # ネイティブ側へ反映
npx cap open ios                 # Xcode を開く(macOS のみ)
npx cap open android             # Android Studio を開く
```

日々の画面づくりはブラウザで進め、実機確認のタイミングで `cap sync` する運用が効率的です。

---

## ストアの規約について

App Store / Google Play の審査基準と料金は変わることがあります。
本書は 2026年8月時点の内容です。実際の申請前に各ストアの公式ドキュメントで最新の条件をご確認ください。
