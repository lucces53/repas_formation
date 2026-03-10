const http = require('http')
const fs   = require('fs')
const path = require('path')

const PORT         = 3001
const CONFIG_FILE  = path.join(__dirname, 'data', 'config.json')
const MEALS_FILE   = path.join(__dirname, 'data', 'meals.json')
const HISTORY_FILE = path.join(__dirname, 'data', 'history.json')
const PUBLIC_DIR   = path.join(__dirname, 'public')

// Crée le dossier data s'il n'existe pas
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'))
}
if (!fs.existsSync(CONFIG_FILE))  fs.writeFileSync(CONFIG_FILE,  JSON.stringify({ formations: [], restaurants: [] }))
if (!fs.existsSync(MEALS_FILE))   fs.writeFileSync(MEALS_FILE,   JSON.stringify({}))
if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, JSON.stringify({}))

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch(e) { return {} }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.css':  'text/css',
  '.svg':  'image/svg+xml',
  '.webp': 'image/webp',
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath)
  const contentType = MIME[ext] || 'application/octet-stream'
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return }
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(data)
  })
}

function readBody(req) {
  return new Promise(resolve => {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => resolve(body))
  })
}

// ═══════════════════════════════════════════════
// ARCHIVAGE AUTOMATIQUE DES FORMATIONS TERMINÉES
// ═══════════════════════════════════════════════
function archiverEtNettoyerFormations() {
  const aujourd_hui = new Date()
  aujourd_hui.setHours(0, 0, 0, 0)

  const config  = readJSON(CONFIG_FILE)
  const meals   = readJSON(MEALS_FILE)
  const history = readJSON(HISTORY_FILE)

  if (!config.formations || config.formations.length === 0) {
    console.log(`🧹 Nettoyage : aucune formation en base`)
    return
  }

  const aSupprimer = config.formations.filter(f => {
    if (!f.endDate) return false
    const fin = new Date(f.endDate)
    fin.setHours(0, 0, 0, 0)
    return fin < aujourd_hui
  })

  if (aSupprimer.length === 0) {
    console.log(`🧹 Nettoyage : aucune formation terminée (${config.formations.length} active(s))`)
    return
  }

  // ── Archivage dans history.json ────────────────────────────────────────
  aSupprimer.forEach(f => {
    const formationMeals = meals[f.id] || {}

    // Calcule le total par restaurateur pour cette formation
    const totauxParRestaurateur = {}
    Object.values(formationMeals).forEach(jourData => {
      Object.entries(jourData).forEach(([restaurant, qte]) => {
        totauxParRestaurateur[restaurant] = (totauxParRestaurateur[restaurant] || 0) + qte
      })
    })

    const totalRepas = Object.values(totauxParRestaurateur).reduce((a, b) => a + b, 0)

    // Crée l'entrée d'archive
    const archive = {
      id:          f.id,
      name:        f.name,
      color:       f.color || '#2563eb',
      startDate:   f.startDate,
      endDate:     f.endDate,
      restaurants: f.restaurants || [],
      totalRepas,
      totauxParRestaurateur,
      archivedAt:  new Date().toISOString()
    }

    // Ajoute dans history par restaurateur
    Object.keys(totauxParRestaurateur).forEach(restaurant => {
      if (!history[restaurant]) history[restaurant] = []
      // Évite les doublons si déjà archivé
      const exists = history[restaurant].find(a => a.id === f.id)
      if (!exists) {
        history[restaurant].push(archive)
        console.log(`  📦 Archivé : ${f.name} → ${restaurant} (${totauxParRestaurateur[restaurant]} repas)`)
      }
    })

    // Si la formation n'a aucun repas, l'archiver quand même sans restaurateur
    if (Object.keys(totauxParRestaurateur).length === 0) {
      const key = '__aucun__'
      if (!history[key]) history[key] = []
      const exists = history[key].find(a => a.id === f.id)
      if (!exists) history[key].push(archive)
    }
  })

  // ── Suppression des formations terminées ───────────────────────────────
  config.formations = config.formations.filter(f => {
    if (!f.endDate) return true
    const fin = new Date(f.endDate)
    fin.setHours(0, 0, 0, 0)
    return fin >= aujourd_hui
  })

  const idsSupprimes = aSupprimer.map(f => f.id)
  idsSupprimes.forEach(id => {
    if (meals[id]) {
      delete meals[id]
      console.log(`  🗑️  Repas supprimés pour formation id=${id}`)
    }
  })

  writeJSON(CONFIG_FILE,  config)
  writeJSON(MEALS_FILE,   meals)
  writeJSON(HISTORY_FILE, history)

  console.log(`🧹 Archivage + nettoyage : ${aSupprimer.length} formation(s) → `, aSupprimer.map(f => `${f.name} (fin: ${f.endDate})`).join(', '))
}

archiverEtNettoyerFormations()
setInterval(archiverEtNettoyerFormations, 60 * 60 * 1000)

// ═══════════════════════════════════════════════
// SERVEUR HTTP
// ═══════════════════════════════════════════════
const server = http.createServer(async (req, res) => {

// ---------- WEBSOCKET REALTIME (broadcast) ----------
const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

const MEALS_FILE = path.join(__dirname, 'meals.json') // ajuste le chemin si besoin

// Attacher un WebSocketServer au serveur HTTP existant
const wss = new WebSocket.Server({ server })

function broadcastJSON(obj) {
  const msg = JSON.stringify(obj)
  wss.clients.forEach(s => {
    if (s.readyState === WebSocket.OPEN) s.send(msg)
  })
}

// lecture utilitaire (déjà dans ton code probablement)
function safeReadJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8') || '{}')
  } catch (e) {
    return {}
  }
}

// Build “flat” map for TODAY from meals structure
function buildTodayMapFromMeals(meals) {
  const map = {}
  const today = new Date()
  today.setHours(0,0,0,0)
  // structure attendue : meals[formationId][date][resto] = qty
  Object.keys(meals || {}).forEach(fId => {
    const dates = meals[fId] || {}
    Object.keys(dates).forEach(dateStr => {
      const d = new Date(dateStr)
      d.setHours(0,0,0,0)
      if (d.getTime() !== today.getTime()) return
      const restos = dates[dateStr] || {}
      Object.keys(restos).forEach(resto => {
        const key = `${fId}||${dateStr}||${resto}`
        map[key] = restos[resto] || 0
      })
    })
  })
  return map
}

// Garde l'état précédent en mémoire
let previousMealsTodayMap = buildTodayMapFromMeals(safeReadJSON(MEALS_FILE))

// Watch file changes (fallback if meals modifiés par fichiers externes)
fs.watchFile(MEALS_FILE, { interval: 800 }, (curr, prev) => {
  try {
    const meals = safeReadJSON(MEALS_FILE)
    const newMap = buildTodayMapFromMeals(meals)

    const added = []
    const removed = []
    const changed = []

    // Detect additions/changes
    Object.keys(newMap).forEach(k => {
      const prevQty = previousMealsTodayMap[k] || 0
      const curQty = newMap[k] || 0
      if (!(k in previousMealsTodayMap)) {
        added.push({ key: k, prev: 0, cur: curQty })
      } else if (curQty > prevQty) {
        changed.push({ key: k, prev: prevQty, cur: curQty, type: 'increase' })
      } else if (curQty < prevQty) {
        changed.push({ key: k, prev: prevQty, cur: curQty, type: 'decrease' })
      }
    })

    // Detect removals
    Object.keys(previousMealsTodayMap).forEach(k => {
      if (!(k in newMap)) {
        removed.push({ key: k, prev: previousMealsTodayMap[k], cur: 0 })
      }
    })

    // Si quelque chose a changé, on broadcast
    if (added.length || removed.length || changed.length) {
      // Préparer snapshot "user-friendly" d'aujourd'hui pour client
      const todaySnapshot = []
      // we need formation names -> try to read config
      const config = safeReadJSON(path.join(__dirname, 'config.json'))
      const formations = (config.formations || []).reduce((acc,f) => { acc[f.id] = f.name; return acc }, {})

      Object.keys(newMap).forEach(k => {
        const [fId, dateStr, resto] = k.split('||')
        todaySnapshot.push({
          formationId: fId,
          formation: formations[fId] || fId,
          date: dateStr,
          resto,
          qty: newMap[k]
        })
      })

      broadcastJSON({
        type: 'today_diff',
        added, removed, changed,
        todaySnapshot
      })
    }

    previousMealsTodayMap = newMap
  } catch (err) {
    console.error('Error processing MEALS_FILE change', err)
  }
})
// ---------- end WEBSOCKET REALTIME ----------

  
  const url = req.url.split('?')[0]

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  // ── API CONFIG ───────────────────────────────────────────────────────────
  if (url === '/api/config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(readJSON(CONFIG_FILE)))
    return
  }

  if (url === '/api/config' && req.method === 'POST') {
    const body = await readBody(req)
    try {
      const data = JSON.parse(body)
      writeJSON(CONFIG_FILE, data)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    } catch(e) {
      res.writeHead(400); res.end('Bad JSON')
    }
    return
  }

  // ── API MEALS ────────────────────────────────────────────────────────────
  if (url === '/api/meals' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(readJSON(MEALS_FILE)))
    return
  }

  if (url === '/api/meals' && req.method === 'POST') {
    const body = await readBody(req)
    try {
      const data = JSON.parse(body)
      writeJSON(MEALS_FILE, data)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    } catch(e) {
      res.writeHead(400); res.end('Bad JSON')
    }
    return
  }

  if (url === '/dashboard-restaurateur' || url === '/dashboard-restaurateur.html') {
    const file = path.join(PUBLIC_DIR, 'dashboard-restaurateur.html')
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(data)
    })
    return
  }

  // ── API HISTORY ──────────────────────────────────────────────────────────
  if (url === '/api/history' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(readJSON(HISTORY_FILE)))
    return
  }

  if (url === '/api/history' && req.method === 'POST') {
    const body = await readBody(req)
    try {
      const data = JSON.parse(body)
      writeJSON(HISTORY_FILE, data)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    } catch(e) {
      res.writeHead(400); res.end('Bad JSON')
    }
    return
  }

  // ── API HISTORY ARCHIVE (archivage manuel depuis le front) ───────────────
  if (url === '/api/history/archive' && req.method === 'POST') {
    const body = await readBody(req)
    try {
      const { formation, meals: formationMeals } = JSON.parse(body)
      const history = readJSON(HISTORY_FILE)

      const totauxParRestaurateur = {}
      Object.values(formationMeals || {}).forEach(jourData => {
        Object.entries(jourData).forEach(([restaurant, qte]) => {
          totauxParRestaurateur[restaurant] = (totauxParRestaurateur[restaurant] || 0) + qte
        })
      })

      const totalRepas = Object.values(totauxParRestaurateur).reduce((a, b) => a + b, 0)

      const archive = {
        id:          formation.id,
        name:        formation.name,
        color:       formation.color || '#2563eb',
        startDate:   formation.startDate,
        endDate:     formation.endDate,
        restaurants: formation.restaurants || [],
        totalRepas,
        totauxParRestaurateur,
        archivedAt:  new Date().toISOString()
      }

      const restaurants = Object.keys(totauxParRestaurateur)
      if (restaurants.length === 0) restaurants.push('__aucun__')

      restaurants.forEach(restaurant => {
        if (!history[restaurant]) history[restaurant] = []
        const exists = history[restaurant].find(a => a.id === formation.id)
        if (!exists) history[restaurant].push(archive)
      })

      writeJSON(HISTORY_FILE, history)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    } catch(e) {
      res.writeHead(400); res.end('Bad JSON')
    }
    return
  }

  // ── Fichiers statiques depuis /public ────────────────────────────────────
  if (url === '/' || url === '/index.html') {
    serveStatic(res, path.join(PUBLIC_DIR, 'index.html'))
    return
  }

  const filePath = path.join(PUBLIC_DIR, url)
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    serveStatic(res, filePath)
    return
  }

  res.writeHead(404); res.end('Not found')
})

server.listen(PORT, () => {
  console.log(`✅ Serveur démarré → http://localhost:${PORT}`)
  console.log(`🕐 Archivage automatique actif (toutes les heures)`)
})
