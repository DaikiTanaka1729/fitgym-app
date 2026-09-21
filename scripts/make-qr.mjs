// ============================================================
// 配布用QRコードを作る
// ------------------------------------------------------------
//   npm run qr -- https://example.vercel.app
//
// 会員用と管理者用の2種類を dist-qr/ に出力する。
//   会員用   … そのままトップ(ログイン画面)へ
//   管理者用 … /admin/login へ
//
// それぞれ PNG(印刷用・1200px)と SVG(拡大しても劣化しない)を作る。
// スマホのカメラで読み取ると当アプリが開き、「ホーム画面に追加」で
// アイコンが常駐する。
// ============================================================
import QRCode from "qrcode";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const url = process.argv[2];

if (!url) {
  console.error("URL を指定してください。例: npm run qr -- https://fitgym-app.vercel.app");
  process.exit(1);
}

try {
  new URL(url);
} catch {
  console.error(`URL の形式が正しくありません: ${url}`);
  process.exit(1);
}

if (!url.startsWith("https://")) {
  console.error("PWA は HTTPS でないとホーム画面に追加できません。https:// のURLを指定してください。");
  process.exit(1);
}

const outDir = "dist-qr";
await mkdir(outDir, { recursive: true });

const base = url.replace(/\/+$/, "");

// 会員用は緑、管理者用はネイビー。印刷したときに取り違えないよう色を分ける。
const targets = [
  { name: "member", label: "会員用", to: base + "/login", dark: "#1A9E6E" },
  { name: "admin", label: "管理者用", to: base + "/admin/login", dark: "#1E2761" },
];

// 誤り訂正レベル M。印刷して壁に貼る用途なら十分。
for (const t of targets) {
  const options = { errorCorrectionLevel: "M", margin: 2, color: { dark: t.dark, light: "#FFFFFF" } };

  await QRCode.toFile(path.join(outDir, `qr-${t.name}.png`), t.to, { ...options, width: 1200 });

  const svg = await QRCode.toString(t.to, { ...options, type: "svg" });
  await writeFile(path.join(outDir, `qr-${t.name}.svg`), svg, "utf8");

  console.log(`${t.label}  ${t.to}`);
  console.log(`  ${path.join(outDir, `qr-${t.name}.png`)}  (印刷用 1200px)`);
  console.log(`  ${path.join(outDir, `qr-${t.name}.svg`)}  (拡大しても劣化しません)`);
  console.log("");
}
