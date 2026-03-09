const CACHE = 'repas-v2'

const ASSETS = [
  '/',
  '/index.html',
  '/dashboard-restaurateur.html',
  '/manifest.json'
]

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE)
          .map(k => caches.delete(k))
      )
    )
  )
})

self.addEventListener('fetch', e => {

  // on ignore les appels API
  if (e.request.url.includes('/api/')) return

  e.respondWith(
    fetch(e.request)
      .then(res => {
        return res
      })
      .catch(() => {
        return caches.match(e.request)
      })
  )

})
