# Trading dashboard

Tableau de bord du bot crypto (lecture seule). Hébergé sur Vercel, données lues dans Neon par la fonction serveur `api/data.js`.
Le navigateur ne voit jamais la base : il appelle `/api/data` avec l'en-tête `x-dashboard-key`.

## Variables d'environnement (Vercel → Settings → Environment Variables)
- `DATABASE_URL` : chaîne de connexion Neon
- `DASHBOARD_KEY` : clé d'accès au tableau de bord (longue, aléatoire)

## Tests
`npm install && npm test`

## Comportement
- Affiche un seul mode à la fois (`paper`, `testnet` ou `live`) : celui de la dernière équité enregistrée, ou celui choisi dans le sélecteur (`?mode=`, liste blanche, jamais concaténé au SQL). Les chiffres des modes ne sont jamais additionnés.
- Bannière d'arrêt lue dans `system_state` (clé `safety`) : seuls les motifs persistants y figurent (les pannes transitoires `db_write` et `api_unstable` ne sont pas conservées par le bot).
- Rafraîchissement automatique **toutes les 15 min**, en pause quand l'onglet est caché : chaque lecture réveille Neon (veille après 5 min) et le quota gratuit est de 100 h de calcul/mois. Le bouton ⟳ force une lecture.
- « Bot actif » = dernière donnée de marché de moins de 45 min, car le bot n'écrit en base que toutes les 30 min par défaut.
