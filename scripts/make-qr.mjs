// ============================================================
// 配布用QRコードを作る
// ------------------------------------------------------------
//   npm run qr -- https://fitgym-app.vercel.app
//
// dist-qr/ に PNG(印刷用・1200px)と SVG(拡大しても劣化しない)を出力する。
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

// 誤り訂正レベル M。印刷して壁に貼る用途なら十分。
const options = { errorCorrectionLevel: "M", margin: 2, color: { dark: "#1E2761", light: "#FFFFFF" } };

await QRCode.toFile(path.join(outDir, "fitgym-qr.png"), url, { ...options, width: 1200 });

const svg = await QRCode.toString(url, { ...options, type: "svg" });
await writeFile(path.join(outDir, "fitgym-qr.svg"), svg, "utf8");

console.log(`QRコードを生成しました: ${url}`);
console.log(`  ${path.join(outDir, "fitgym-qr.png")}  (印刷用 1200px)`);
console.log(`  ${path.join(outDir, "fitgym-qr.svg")}  (拡大しても劣化しません)`);
