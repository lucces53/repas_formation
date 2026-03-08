#!/bin/bash
cd /opt/repas
git pull origin main
pm2 restart repas
echo "✅ Déployé le $(date)"
