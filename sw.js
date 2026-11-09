/* Mi Cartera: almacena SOLO archivos de la interfaz. No intercepta datos de Firebase. */
const CACHE = 'mi-cartera-pwa-v2';
const FILES = ['./','./index.html','./app.css','./app.js','./bootstrap.js',
  './firebase-adapter.js','./firebase-config.js','./manifest.webmanifest',
  './icon-192.png','./icon-512.png','./icon-maskable.png','./apple-touch-icon.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(x => x.startsWith('mi-cartera-pwa-') && x!==CACHE).map(x => caches.delete(x)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return; // Firebase, mail, WhatsApp: nunca almacenar.
  if(req.mode==='navigate' || url.pathname.endsWith('/firebase-config.js')){
    event.respondWith(fetch(req).then(r=>{
      if(r.ok){const copy=r.clone();caches.open(CACHE).then(cache=>cache.put(req,copy));}
      return r;
    }).catch(()=>caches.match(req).then(r=>r||caches.match('./index.html'))));
    return;
  }
  event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(response=>{
    if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(req,copy));}
    return response;
  })));
});
