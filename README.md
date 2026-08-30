# FitGym アプリ(9/20版)

トレーニングジム向けの予約・会員管理アプリ。
プロジェクトの前提・設計方針・進め方は [CLAUDE.md](./CLAUDE.md) を参照。

## 起動

```bash
npm install
npm run dev
```

http://localhost:5173 が開く。ビルドは `npm run build`。

Supabase の接続情報が未設定のあいだは画面上部に注意書きが出て、仮の認証(`mockAuth`)で動作する。
接続するには `.env.example` を `.env.local` にコピーし、Supabase の Project URL と anon キーを入れる。

```bash
cp .env.example .env.local
```

## 画面(9/20版・認証まで)

| パス | 画面 | ID |
|---|---|---|
| `/signup` | 会員登録 | M-01 |
| `/login` | 会員ログイン | M-02 |
| `/reset-password` | パスワード再設定(会員セルフ) | M-08 |
| `/admin/login` | 管理者ログイン | A-01 |
| `/admin/reset-password` | パスワード再設定(管理者セルフ) | A-07 |

予約・管理者機能の画面は Step 4 以降で追加する。

## フォルダ構成

```
fitgimapp/
├── CLAUDE.md                   プロジェクトの前提・設計方針・次にやること
├── index.html / vite.config.js Vite + React のエントリ
├── vercel.json                 SPA ルーティング用の rewrite
├── .env.example                環境変数のひな形(実値は .env.local へ)
├── src/
│   ├── main.jsx                エントリ(BrowserRouter)
│   ├── App.jsx                 ルーティング
│   ├── theme/tokens.js         デザイントークン(配色はここに集約)
│   ├── components/             共通UIコンポーネント
│   ├── api/                    API基盤(client / errors / auth / menus / reservations / records)
│   └── screens/auth/           認証画面
├── supabase/
│   ├── migrations/0001_init.sql 初期スキーマ
│   └── seed.sql                開発用シードデータ
├── demo/fitgym-demo.html       全画面の動作デモ(ブラウザで開くだけ)
└── docs/                       設計ドキュメント一式
    ├── SETUP_ACCOUNTS.md       アカウント作成・契約の実行チェックリスト
    ├── FitGym_基本設計書_W1成果物.docx
    ├── FitGym_基本設計書_予約メニュー追補.docx
    ├── FitGym_基本設計書_パスワード再設定追補.docx
    ├── FitGym_予約枠要望_対応状況整理.docx
    ├── FitGym_次フェーズ拡張方針書.docx
    ├── FitGym_開発スケジュール.xlsx
    ├── FitGym_インフラ構成_設計比較書.docx
    ├── FitGym_インフラ契約_構築手順書.docx
    ├── FitGym_アカウント作成手順書.docx
    └── FitGym_ClaudeCode引き継ぎ資料.docx
```

## 実装上の約束

- 配色は `src/theme/tokens.js` の `T` 経由。画面に直値のカラーコードを書かない。
- API 呼び出しは `src/api/` 経由に統一。戻り値は `{ data, error }`。画面は `error` を表示するだけ。
- 認証は Supabase Auth に一元化。`members` / `admins` は `auth_user_id` で紐づくプロフィール表。
- `src/screens/auth/mockAuth.js` は仮実装。Step 3 で `authApi` に差し替えて削除する。
