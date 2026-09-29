# MAGELIAN — application Angular

Interface Angular de MAGELIAN, en cours de migration depuis React
(`docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md`).
Elle appelle l'API Next.js existante, qui reste la seule source de vérité.

## Démarrer

    # 1. la base locale et l'API (à la racine du dépôt)
    bash scripts/local/00-docker-up.sh && bash scripts/local/01-supabase-up.sh
    npm run dev                  # API sur :3000

    # 2. l'application Angular
    cd angular
    npm install
    npm start                    # :4200, écrit d'abord public/config.local.json

Se connecter avec le même compte que sur :3000 — la session est dans un cookie
partagé par les deux.

## Commandes

    npm start          # serveur de dev, /api redirigé vers :3000
    npm test           # tests (Vitest)
    npm run build      # build de production
    npm run config     # régénère public/config.local.json

## Règles

- Aucun import hors de `angular/` (verrouillé par `tests/unit/angular/isolement.test.ts`).
- Jetons de couleur copiés de `app/globals.css`, jamais modifiés ici seuls
  (`tests/unit/angular/jetons-paritaires.test.ts`).
- Toute adresse d'API passe par `HttpBaseService`.
