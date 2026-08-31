// ============================================================
// サービスワーカー(PWA としてインストール可能にするための最小構成)
// ------------------------------------------------------------
// Android Chrome は「アプリをインストール」を出す条件として
// fetch ハンドラを持つサービスワーカーを要求するため用意している。
//
// 方針はネットワーク優先。オフライン時だけキャッシュを返す。
// 古い画面が残り続けると原因の分かりにくい不具合になるため、
// キャッシュ優先にはしない。
// ============================================================

const CACHE = "fitgym-shell-v1";

self.addEventListener("install", () => {
  // 新しいワーカーを即座に有効化する
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 古い世代のキャッシュを破棄する
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // GET 以外と、外部ホスト(Supabase など)は素通しする。
  // API のレスポンスをキャッシュすると古い予約状況を掴んでしまう。
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone());
        return response;
      } catch (e) {
        // オフライン時はキャッシュ、なければアプリの入口を返す
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const shell = await caches.match("/");
          if (shell) return shell;
        }
        throw e;
      }
    })()
  );
});
