const CACHE_NAME = "gangjwi-seungyi-v6";
// 캐싱할 최소 파일들 (나머지는 네트워크 우선)
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

// 설치 단계: 기본 리소스 캐싱
self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// 활성화 단계: 이전 버전의 쓸모없는 캐시 정리
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 파일 요청 처리: 업데이트 반영을 위해 네트워크 우선, 실패 시 캐시 사용
self.addEventListener("fetch", (e) => {
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        // 성공한 네트워크 응답이 있으면 캐시에 복사해 둠
        if (response.status === 200) {
          const resClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, resClone);
          });
        }
        return response;
      })
      .catch(() => {
        // 네트워크 끊겼을 때만 캐시에서 서빙
        return caches.match(e.request);
      })
  );
});