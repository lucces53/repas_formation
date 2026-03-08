const http = require('http')
const crypto = require('crypto')
const { exec } = require('child_process')

const SECRET = 'Teaeden53'  // ← choisir un mot de passe
const PORT = 3002

http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/deploy') {
    res.writeHead(404); res.end(); return
  }

  let body = ''
  req.on('data', chunk => body += chunk)
  req.on('end', () => {
    // Vérification signature GitHub
    const sig = req.headers['x-hub-signature-256']
    const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex')

    if (sig !== expected) {
      console.log('❌ Signature invalide')
      res.writeHead(403); res.end('Forbidden'); return
    }

    console.log('📦 Push reçu, déploiement...')
    exec('/opt/repas/deploy.sh', (err, stdout, stderr) => {
      if (err) { console.error(stderr); res.writeHead(500); res.end('Erreur'); return }
      console.log(stdout)
      res.writeHead(200); res.end('OK')
    })
  })
}).listen(PORT, () => console.log(`🎣 Webhook en écoute sur le port ${PORT}`))
