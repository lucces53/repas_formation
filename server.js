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
