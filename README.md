# Trading dashboard

Tableau de bord du bot crypto (lecture seule). Hébergé sur Vercel, données lues dans Neon par la fonction serveur `api/data.js`.
Le navigateur ne voit jamais la base : il appelle `/api/data` avec l'en-tête `x-dashboard-key`.

## Variables d'environnement (Vercel → Settings → Environment Variables)
- `DATABASE_URL` : chaîne de connexion Neon
- `DASHBOARD_KEY` : clé d'accès au tableau de bord (longue, aléatoire)

## Tests
`npm install && npm test`
