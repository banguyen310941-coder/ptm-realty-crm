const CACHE_NAME="ptm-crm-shell-v1";
const OFFLINE_URL="/offline";
const STATIC_PREFIXES=["/_next/static/","/pwa/icon-192","/pwa/icon-512"];

self.addEventListener("install",(event)=>{
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache)=>cache.addAll([OFFLINE_URL]))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener("activate",(event)=>{
  event.waitUntil(
    caches.keys()
      .then((keys)=>Promise.all(keys.filter((key)=>key!==CACHE_NAME).map((key)=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("message",(event)=>{
  if(event.data?.type==="SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch",(event)=>{
  const request=event.request;
  if(request.method!=="GET") return;

  const url=new URL(request.url);
  if(url.origin!==self.location.origin) return;

  // CRM APIs, authentication and business data must never be cached by the service worker.
  if(url.pathname.startsWith("/api/")) return;

  if(request.mode==="navigate"){
    event.respondWith(
      fetch(request).catch(()=>caches.match(OFFLINE_URL))
    );
    return;
  }

  if(STATIC_PREFIXES.some((prefix)=>url.pathname.startsWith(prefix))){
    event.respondWith(
      caches.match(request).then((cached)=>{
        if(cached) return cached;
        return fetch(request).then((response)=>{
          if(response.ok){
            const copy=response.clone();
            caches.open(CACHE_NAME).then((cache)=>cache.put(request,copy));
          }
          return response;
        });
      })
    );
  }
});
