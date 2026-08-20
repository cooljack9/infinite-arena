// Service Worker：网络优先（导航）+ stale-while-revalidate（静态）
// 设计要点：
// - 导航请求（HTML）走 network-first：保证新版本生效，回落已缓存的 index 维持可用
// - 构建产物（assets）走 stale-while-revalidate：首屏用缓存秒出，后台静默更新
// - 超出版本缓存的旧文件惰性清理，零无效网络
const VERSION = 'v2.4.4';
const CORE = `arena-core-${VERSION}`;
const RUNTIME = `arena-runtime-${VERSION}`;

// 核心预缓存（shell + 关键静态）。/src/ 与 /assets/ 由 Vite 产物的 hash 命名驱动，
// 会在运行时被 RUNTIME 缓存接管；此处只预存极少量永不变量以保证完全离线首屏。
const PRECACHE = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CORE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n !== CORE && n !== RUNTIME)
          .map((n) => caches.delete(n)),
      ),
    ).then(() => self.clients.claim()),
  );
});

const isAsset = (url) =>
  url.origin === self.location.origin &&
  (url.pathname.startsWith('/assets/') ||
   /\.(?:js|mjs|css|wasm|woff2?|ttf|png|jpg|jpeg|webp|svg|gif)$/.test(url.pathname));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 导航：网络优先，回落缓存
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CORE).then((c) => c.put('/', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/').then((m) => m || caches.match('/index.html'))),
    );
    return;
  }

  // 静态资源：stale-while-revalidate
  if (isAsset(url)) {
    event.respondWith(
      caches.open(RUNTIME).then(async (cache) => {
        const cached = await cache.match(req);
        const fetchPromise = fetch(req)
          .then((res) => {
            if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
            return res;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      }),
    );
  }
});
