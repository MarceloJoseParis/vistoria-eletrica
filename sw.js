/* Vistoria Elétrica Básica – service worker
   Guarda os arquivos do app (como ArrayBuffer, aceito também pelo Safari) num banco próprio (IndexedDB "vistoriaEletrica-shell"), e não no Cache Storage,
   porque outros apps do mesmo endereço (marcelojoseparis.github.io) podem apagar caches que não são deles. */
const VERSAO = 've-2.0.2';
const ARQUIVOS = ['vistoria.html', 'manifest.webmanifest', 'lib/docx.umd.js', 'lib/exifr.lite.umd.js', 'lib/firebase.js', 'icons/icon-192.png', 'icons/icon-512.png'];
const BASE = new URL('./', self.location).href;

function abrir() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open('vistoriaEletrica-shell', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('arquivos');
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
async function ler(chave) {
  const db = await abrir();
  return new Promise((res, rej) => { const r = db.transaction('arquivos').objectStore('arquivos').get(chave); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function gravar(chave, valor) {
  const db = await abrir();
  return new Promise((res, rej) => { const tx = db.transaction('arquivos', 'readwrite'); tx.objectStore('arquivos').put(valor, chave); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
async function baixarTudo() {
  for (const a of ARQUIVOS) {
    const r = await fetch(new URL(a, BASE).href, { cache: 'reload' });
    if (!r.ok) throw new Error('falha ao baixar ' + a);
    await gravar(a, { versao: VERSAO, tipo: r.headers.get('Content-Type') || '', corpo: await r.arrayBuffer() });
  }
  await gravar('__versao', { versao: VERSAO });
}

self.addEventListener('install', (e) => { e.waitUntil(baixarTudo().then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    await self.clients.claim();
    const cs = await self.clients.matchAll({ type: 'window' });
    cs.forEach((c) => c.postMessage({ tipo: 'atualizado', versao: VERSAO }));
  })());
});

function chaveDe(url) {
  if (!url.href.startsWith(BASE)) return null;
  let rel = url.href.slice(BASE.length).split('#')[0].split('?')[0];
  if (rel === '' || rel === 'index.html') rel = 'vistoria.html';
  return ARQUIVOS.includes(rel) ? rel : null;
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // OpenStreetMap e outros: sempre pela rede
  const chave = chaveDe(url);
  if (!chave) return;
  e.respondWith((async () => {
    try {
      const x = await ler(chave);
      if (x && x.corpo) return new Response(x.corpo, { headers: { 'Content-Type': x.tipo || 'application/octet-stream' } });
    } catch (err) { /* segue para a rede */ }
    const r = await fetch(e.request);
    if (r.ok) { const c = r.clone(); c.arrayBuffer().then((b) => gravar(chave, { versao: VERSAO, tipo: r.headers.get('Content-Type') || '', corpo: b })).catch(() => {}); }
    return r;
  })());
});
