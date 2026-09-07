// ============================================================
// アプリの名称
// ------------------------------------------------------------
// サービス名が決まったら、このファイルの3つの値を書き換える。
// 画面・CSVのファイル名はすべてここを参照している。
//
// ここ以外に、下記の静的ファイルも手で書き換える必要がある:
//   index.html                  <title> と apple-mobile-web-app-title
//   public/manifest.webmanifest name / short_name / description
//   capacitor.config.json       appName と appId(逆ドメイン形式)
//   package.json                name
// ============================================================

// 画面に表示する名前(日本語可)
export const APP_NAME = "FitGym";

// 管理者側のヘッダー
export const ADMIN_CONSOLE_NAME = `${APP_NAME} 管理コンソール`;

// CSVなどファイル名に使う英小文字のスラッグ。日本語・空白は使わない。
export const APP_SLUG = "fitgym";
