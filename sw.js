const CACHE_NAME = 'liquor-scanner-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './script.js',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

// インストール時に静的アセットをキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching app shell and assets');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// アクティベート時に古いキャッシュをクリーンアップ
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// フェッチ処理 (ネットワーク優先でキャッシュにフォールバック、APIコールは常にネットワーク)
self.addEventListener('fetch', (event) => {
  // Google Cloud Vision APIへのリクエストはキャッシュしない
  if (event.request.url.includes('googleapis.com')) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // レスポンスが正常ならクローンしてキャッシュを更新
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // オフラインまたはエラーの場合はキャッシュから取得
        return caches.match(event.request);
      })
  );
});
