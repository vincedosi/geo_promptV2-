# Prompt Claude Code — Nettoyage GEOMATIK (one-shot)

> À coller dans Claude Code depuis `C:\GENESIS\genesis_app` après `git checkout -b chore/cleanup-tech-debt && git commit -am "Backup avant nettoyage"`.

---

## Mission

Le projet GEOMATIK a accumulé du code mort, des fichiers expérimentaux abandonnés, des composants dupliqués et de la dette technique après des dizaines d'itérations (IRIS pipeline, PMTiles, multi-agent router, scoring profiles, geodemographic clustering, WebLift, isochrone battle, DSP campaigns).

**Objectif :** rendre la base propre et maintenable pour qu'un futur dev puisse reprendre le projet avec **un minimum de friction**. Tu fais le travail **en autonomie complète**, sans me demander de validation intermédiaire. Tu commits au fur et à mesure et tu me rends un rapport final.

**Stack :** Next.js 14 (App Router), TypeScript strict, Supabase (PostgreSQL + PostGIS) + RLS, MapLibre GL JS, PMTiles, Vercel AI SDK (Gemini 2.5 Flash / Mistral Small).

---

## Règles dures (ZÉRO TOLÉRANCE)

**NE JAMAIS TOUCHER :**
- `app/api/isochrone-battle/route.ts` et toute fonction PostGIS battle (`get_isochrone_battle_v10`, etc.)
- Les RPC PostGIS de prod : `compute_panneau_scores_v2`, `refresh_ville_stats_chunk`
- Les migrations dans `supabase/migrations/` (déjà appliquées en prod)
- Les fichiers de config racine : `next.config.js`, `tsconfig.json`, `package.json` (sauf retrait de dépendances mortes — voir §5)
- Le scope métier : GEOMATIK est **digital** (DSP, impressions, audience digitale). Ne jamais réintroduire de cadrage OOH/affichage extérieur dans la doc ou les noms.

**TOUJOURS :**
- Travailler en commits atomiques avec messages clairs (`chore(cleanup): remove unused IRIS legacy parser`)
- Lancer `npm run build` après chaque batch significatif. Si ça casse → rollback immédiat du commit fautif et continue avec le reste.
- Préserver toutes les fonctionnalités utilisateur actuellement en marche.

---

## Le travail à faire

### 1. Code mort

Supprimer :
- Imports inutilisés, variables non assignées, exports jamais consommés (utilise `npx ts-prune` et `npx knip` si dispo)
- Fonctions / hooks / classes / composants jamais appelés dans le graphe d'imports
- Routes API (`app/api/**/route.ts`) non référencées par le front (croise avec les `fetch()`, `useSWR`, `useChat`, `adminFetch` côté client)
- Pages (`app/**/page.tsx`) orphelines qui ne sont plus liées dans la nav ni dans aucun lien interne
- Branches mortes : `if (false)`, feature flags toujours à la même valeur, code derrière des conditions impossibles
- Code commenté qui ressemble à de vieux tests / vieilles versions (les commentaires explicatifs **utiles** restent)

Pour les **fichiers entiers** que tu supprimes, liste-les dans le rapport final avec une ligne d'explication chacun.

### 2. Dette technique

- Simplifier les fonctions > 80 lignes ou > 4 niveaux d'imbrication
- Dédupliquer la logique copiée-collée (zones probables : `lib/clustering/`, `lib/import/`, `lib/iris-crawler/`, gestion des erreurs API)
- Uniformiser :
  - Nommage des fichiers en kebab-case
  - Signatures des handlers API et format des erreurs (`ApiError` standardisé depuis `types/api.ts`)
  - Conventions d'export (default vs named — choisis une convention par type de fichier et applique-la)
- Tightening TypeScript :
  - Remplacer les `any` triviaux par des types précis
  - Supprimer les `// @ts-ignore` / `// @ts-expect-error` qui ne sont plus nécessaires
  - Vérifier les `"use client"` manquants ou superflus

### 3. Doublons SQL

- Identifier les migrations dans `sql/archive/` qui sont des doublons de celles dans `supabase/migrations/`
- Garder `sql/archive/` mais nettoyer les vrais doublons exacts si tu en trouves
- **Ne pas toucher à `supabase/migrations/`**

### 4. Documentation & lisibilité

- Renommer les variables / fonctions obscures (`data2`, `tmp`, `handleClick3`, `result`, `obj`)
- Ajouter des **JSDoc courts** (3–5 lignes max) au-dessus :
  - Des handlers de routes API (params, retour, side effects)
  - Des fonctions exportées de `lib/` non triviales
  - Des composants principaux avec leurs props
- Mettre à jour `ARCHITECTURE.md` si la structure de dossiers a changé suite à ton nettoyage
- S'assurer que `ARCHITECTURE.md`, `README.md`, `DESIGN_SYSTEM.md`, `CLAUDE.md` ne contiennent **aucune mention OOH/affichage extérieur résiduelle** — tout doit être cadré digital

### 5. Dépendances mortes

- Lister les packages de `package.json` qui ne sont importés nulle part (utilise `depcheck` ou équivalent)
- **Désinstaller uniquement** ceux qui sont 100% sûrs (pas un peer dep, pas un loader Next/Webpack implicite). Dans le doute, tu listes mais tu ne désinstalles pas.

### 6. Schéma Supabase (rapport seulement, pas d'action)

- Liste dans le rapport final les tables jamais lues/écrites par le code applicatif
- Liste les colonnes apparemment orphelines des tables actives
- **Tu ne lances aucune migration de suppression** — c'est juste pour que je décide ensuite

---

## Livrable final

À la fin, génère un fichier `CLEANUP_REPORT.md` à la racine avec :

1. **Statistiques** : lignes supprimées, fichiers supprimés, fichiers modifiés, packages retirés
2. **Liste des fichiers supprimés** (avec raison en une ligne chacun)
3. **Liste des refactos significatifs** (fichier + nature du changement)
4. **Liste des dépendances mortes désinstallées**
5. **Liste des dépendances suspectes non touchées** (à valider avec moi)
6. **Liste des tables / colonnes Supabase suspectes** (à valider avec moi)
7. **Build status final** : output de `npm run build` + `npm run lint`
8. **Liste des commits** créés pendant la session (`git log --oneline chore/cleanup-tech-debt ^main`)

---

## Go

Démarre maintenant. Travaille en autonomie. Commits atomiques. Build vert à la fin. Rapport complet.