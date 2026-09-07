// ============================================================
// アプリ名の一括変更
// ------------------------------------------------------------
//   node scripts/rename-app.mjs "サービス名" "service-slug" "jp.example.app"
//
// src/appConfig.js と、参照できない静的ファイル(index.html /
// manifest / capacitor.config.json / package.json)をまとめて書き換える。
// appId は逆ドメイン形式。ストア申請前なら後から変えても問題ない。
// ============================================================
import { readFile, writeFile } from "node:fs/promises";

const [name, slug, appId] = process.argv.slice(2);

if (!name || !slug) {
  console.error('使い方: node scripts/rename-app.mjs "サービス名" "service-slug" ["jp.example.app"]');
  process.exit(1);
}
if (!/^[a-z0-9-]+$/.test(slug)) {
  console.error("slug は英小文字・数字・ハイフンのみで指定してください");
  process.exit(1);
}
if (appId && !/^[a-z0-9.]+$/.test(appId)) {
  console.error("appId は英小文字・数字・ドットのみで指定してください(例: jp.example.app)");
  process.exit(1);
}

async function patch(path, fn) {
  const before = await readFile(path, "utf8");
  const after = fn(before);
  if (before === after) {
    console.log(`  変更なし  ${path}`);
    return;
  }
  await writeFile(path, after, "utf8");
  console.log(`  更新      ${path}`);
}

console.log(`アプリ名を「${name}」(${slug})に変更します`);

await patch("src/appConfig.js", (s) =>
  s
    .replace(/export const APP_NAME = ".*";/, `export const APP_NAME = "${name}";`)
    .replace(/export const APP_SLUG = ".*";/, `export const APP_SLUG = "${slug}";`)
);

await patch("index.html", (s) =>
  s
    .replace(/<title>.*<\/title>/, `<title>${name}</title>`)
    .replace(
      /<meta name="apple-mobile-web-app-title" content=".*" \/>/,
      `<meta name="apple-mobile-web-app-title" content="${name}" />`
    )
);

await patch("public/manifest.webmanifest", (s) => {
  const m = JSON.parse(s);
  m.name = name;
  m.short_name = name;
  m.description = `${name} の予約アプリ`;
  return JSON.stringify(m, null, 2) + "\n";
});

await patch("capacitor.config.json", (s) => {
  const c = JSON.parse(s);
  c.appName = name;
  if (appId) c.appId = appId;
  return JSON.stringify(c, null, 2) + "\n";
});

await patch("package.json", (s) => {
  const p = JSON.parse(s);
  p.name = `${slug}-app`;
  return JSON.stringify(p, null, 2) + "\n";
});

console.log("");
console.log("完了しました。次に確認してください:");
console.log("  npm run build");
if (appId) console.log("  npx cap sync   (appId を変えたのでネイティブ側にも反映)");
