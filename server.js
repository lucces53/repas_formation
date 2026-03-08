const http = require('http')
const fs   = require('fs')
const path = require('path')

const PORT        = 3001
const CONFIG_FILE = path.join(__dirname, 'data', 'config.json')
const MEALS_FILE  = path.join(__dirname, 'data', 'meals.json')

// Crée le dossier data s'il n'existe pas
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'))
}
if (!fs.existsSync(CONFIG_FILE)) fs.writeFileSync(CONFIG_FILE, JSON.stringify({ formations: [], restaurants: [] }))
if (!fs.existsSync(MEALS_FILE))  fs.writeFileSync(MEALS_FILE,  JSON.stringify({}))

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch(e) { return {} }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

function serveStatic(res, filePath, contentType) {
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
// NETTOYAGE AUTOMATIQUE DES FORMATIONS TERMINÉES
// ═══════════════════════════════════════════════
function nettoyerFormationsTerminees() {
  const aujourd_hui = new Date()
  aujourd_hui.setHours(0, 0, 0, 0)

  const config = readJSON(CONFIG_FILE)
  const meals  = readJSON(MEALS_FILE)

  if (!config.formations) return

  const avant = config.formations.length

  // Filtrer les formations dont la date de fin est passée
  const aSupprimer = config.formations.filter(f => {
    if (!f.dateFin) return false
    const fin = new Date(f.dateFin)
    fin.setHours(0, 0, 0, 0)
    return fin < aujourd_hui
  })

  if (aSupprimer.length === 0) {
    console.log(`🧹 Nettoyage : aucune formation terminée`)
    return
  }

  // Supprimer les formations terminées
  config.formations = config.formations.filter(f => {
    if (!f.dateFin) return true
    const fin = new Date(f.dateFin)
    fin.setHours(0, 0, 0, 0)
    return fin >= aujourd_hui
  })

  // Supprimer aussi les repas associés
  const idsSupprimes = aSupprimer.map(f => f.id)
  idsSupprimes.forEach(id => {
    delete meals[id]
  })

  writeJSON(CONFIG_FILE, config)
  writeJSON(MEALS_FILE, meals)

  const apres = config.formations.length
  console.log(`🧹 Nettoyage : ${avant - apres} formation(s) supprimée(s) → ${aSupprimer.map(f => f.nom).join(', ')}`)
}

// Lancer au démarrage puis toutes les heures
nettoyerFormationsTerminees()
setInterval(nettoyerFormationsTerminees, 60 * 60 * 1000)

// ═══════════════════════════════════════════════
// SERVEUR HTTP
// ═══════════════════════════════════════════════
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0]

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  // ── API ──────────────────────────────────────────────────────────────────
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

  // ── Fichiers statiques ───────────────────────────────────────────────────
  if (url === '/' || url === '/index.html') {
    serveStatic(res, path.join(__dirname, 'index.html'), 'text/html; charset=utf-8')
    return
  }

  res.writeHead(404); res.end('Not found')
})

server.listen(PORT, () => {
  console.log(`✅ Serveur démarré → http://localhost:${PORT}`)
})
