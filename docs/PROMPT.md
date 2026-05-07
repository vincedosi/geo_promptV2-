# Prompt Claude Code — Finitions cleanup MAGELIAN (one-shot)

> À coller dans Claude Code depuis `C:\GENESIS\genesis_app`. Branche en cours : `chore/cleanup-tech-debt`. Pré-requis : commit ou stash propre avant de lancer.

---

## Mission

Finir les 3 chantiers laissés ouverts par le cleanup précédent (cf. `CLEANUP_REPORT.md`) :

1. **Finition du renommage GEOMATIK → MAGELIAN** (le nouveau nom du projet)
2. **Page `/admin/filosofi-import`** cassée pré-cleanup → kill ou flag
3. **Validation des findings Supabase** (drops candidats) → préparation d'un script SQL READ-ONLY de vérification + script de drop prêt-à-coller, **sans aucune exécution destructive**

Tu fais le travail **en autonomie complète**. Commits atomiques. Build vert à la fin. Rapport final.

---

## Règles dures

**NE JAMAIS :**
- Exécuter de `DROP TABLE`, `DROP FUNCTION`, `ALTER TABLE ... DROP COLUMN` via le MCP Supabase ou autrement
- Toucher à `app/api/isochrone-battle/route.ts`, aux RPC battle (`get_isochrone_battle_v10`), à `compute_panneau_scores_v2`, `refresh_ville_stats_chunk`
- Toucher aux migrations dans `supabase/migrations/`
- Réintroduire un cadrage OOH/affichage extérieur dans la doc ou les noms

**TOUJOURS :**
- Commits atomiques avec messages clairs (`refactor(brand): rename GEOMATIK to MAGELIAN`)
- `npm run build` après chaque batch significatif. Si ça casse → rollback immédiat du commit fautif.

---

## Phase 1 — Rename GEOMATIK → MAGELIAN (autonome, destructif côté code only)

### 1.1 Fichiers résiduels identifiés

- `lib/map/geomatik-style.ts` → `lib/map/magelian-style.ts` (renomme le fichier + tous ses imports)
- `public/geomatik-icon.svg` → `public/magelian-icon.svg` (renomme + toutes les références dans le code)

### 1.2 Grep récursif

Lance un grep insensible à la casse sur **tout le repo** (hors `node_modules`, `.next`, `.git`, `dist`, `build`) pour les chaînes :
- `GEOMATIK`, `Geomatik`, `geomatik`
- Toutes occurrences à remplacer par `MAGELIAN`, `Magelian`, `magelian` respectivement

Zones à scanner explicitement :
- Code source : `.ts`, `.tsx`, `.js`, `.jsx`, `.css`, `.scss`
- Doc : `.md` (incl. `ARCHITECTURE.md`, `README.md`, `DESIGN_SYSTEM.md`, `CLAUDE.md`, `CLEANUP_REPORT.md`)
- SQL : `.sql` (commentaires uniquement, pas de schéma applicatif)
- Config : `package.json` (champ `name`, `description`), `next.config.js` (constantes), `manifest.json` si présent
- HTML/meta : `app/layout.tsx` (title, meta description, OG tags), `app/icon.*`, `app/apple-icon.*`, `public/manifest.webmanifest`
- Copys UI : labels, placeholders, toasts, alerts, system prompts du copilote (`lib/chat/system-prompt.ts`)
- Commentaires de code (oui, même les `// GEOMATIK: ...`)
- Variables d'env documentées dans `.env.example` (préfixes `GEOMATIK_*` éventuels)

### 1.3 Cas à NE PAS toucher

- **Tables Supabase** dont le nom contient `geomatik` (changer le nom d'une table en prod = casse) → laisser tel quel, juste flagger dans le rapport
- **Buckets Supabase Storage** : pareil, flagger sans renommer
- **Branches Git, tags, anciens commits** : intouchables
- **Le repo GitHub `vincedosi/geo_promptV2-`** : pas de rename automatique
- **`CLEANUP_REPORT.md`** historique : tu le laisses tel quel, c'est l'archive

### 1.4 Livrable Phase 1

Un commit (ou 2-3 max si la diff est massive) : `refactor(brand): finish GEOMATIK to MAGELIAN rename`

---

## Phase 2 — Page `/admin/filosofi-import`

### 2.1 Diagnostic

- Trouve la page (`app/admin/filosofi-import/**`)
- Identifie l'endpoint qu'elle appelle et qui n'existe pas
- Vérifie si elle est référencée depuis :
  - La nav admin
  - Un autre lien interne (`<Link href="/admin/filosofi-import" ...>`)
  - Une redirection ou un middleware

### 2.2 Décision automatique

- **Si aucune référence active dans le code** ET **endpoint backend inexistant** : tu **supprimes la page** (et son dossier complet, ses sous-composants si exclusifs, ses imports cassés)
- **Si référencée quelque part** : tu **ne supprimes pas**, tu ajoutes un `// TODO(filosofi-import): page cassée pré-cleanup, endpoint manquant — décider fix vs remove` au-dessus du composant et tu flagges dans le rapport

### 2.3 Livrable Phase 2

Commit : `chore(admin): remove broken filosofi-import page` ou `chore(admin): flag broken filosofi-import page for decision`

---

## Phase 3 — Validation findings Supabase (READ-ONLY)

### 3.1 Findings à vérifier

Depuis `CLEANUP_REPORT.md` :
- Tables candidates au drop : `isochrone_carreaux_coverage`, `laposte_hexasmal`
- RPCs candidates au drop : `get_iris_geojson_by_bbox`, `get_iris_geojson_by_codes`

### 3.2 Vérifications via MCP Supabase (lecture seule)

Pour **chaque table candidate**, exécute via le MCP Supabase :

```sql
-- 1. Cherche les RPCs/fonctions qui référencent la table
SELECT n.nspname AS schema, p.proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE pg_get_functiondef(p.oid) ILIKE '%<TABLE_NAME>%'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema');

-- 2. Cherche les vues qui référencent la table
SELECT schemaname, viewname
FROM pg_views
WHERE definition ILIKE '%<TABLE_NAME>%'
  AND schemaname NOT IN ('pg_catalog', 'information_schema');

-- 3. Cherche les triggers liés
SELECT event_object_schema, event_object_table, trigger_name
FROM information_schema.triggers
WHERE event_object_table = '<TABLE_NAME>';

-- 4. Stats d'usage récent (lecture seule)
SELECT relname, n_live_tup, n_tup_ins, n_tup_upd, n_tup_del, last_vacuum, last_autovacuum
FROM pg_stat_user_tables
WHERE relname = '<TABLE_NAME>';
```

Pour **chaque RPC candidate**, vérifie côté code applicatif (grep récursif TS) :
```
supabase.rpc('get_iris_geojson_by_bbox'
supabase.rpc('get_iris_geojson_by_codes'
```

### 3.3 Décision

Pour chaque candidat, classe-le dans une de ces 3 catégories :
- ✅ **SAFE TO DROP** : zéro référence côté SQL (pas de fonction, vue, trigger qui le référence) ET zéro référence côté code
- ⚠️ **REVIEW NEEDED** : référencé par au moins une RPC/vue → besoin de Vince pour décider
- ❌ **KEEP** : usage actif détecté (RPC critique, écritures récentes via stats, ou référence côté code TS)

### 3.4 Livrable Phase 3

Génère un fichier `sql/cleanup/DROPS_PROPOSED.sql` à la racine, structuré comme suit :

```sql
-- =============================================================
-- DROPS PROPOSÉS APRÈS CLEANUP MAGELIAN
-- Généré le : <DATE ISO>
-- À EXÉCUTER MANUELLEMENT après revue par Vincent
-- Faire un backup Supabase avant !
-- =============================================================

-- ✅ SAFE TO DROP (0 référence détectée)
-- <pour chaque item safe>
-- Justification: <résumé des checks faits>
DROP TABLE IF EXISTS public.<table_name>;
-- ou
DROP FUNCTION IF EXISTS public.<function_name>(<signature>);

-- ⚠️ REVIEW NEEDED (référencé, à confirmer avec Vincent)
-- <pour chaque item review>
-- Référencé par : <liste des RPCs/vues qui pointent dessus>
-- DROP TABLE IF EXISTS public.<table_name>;  -- DÉCOMMENTER UNIQUEMENT APRÈS DÉCISION

-- ❌ KEEP (usage actif détecté, ne pas drop)
-- <liste avec justification>
```

**Tu n'exécutes JAMAIS ce script.** Il est livré pour validation manuelle.

Commit : `docs(supabase): prepare drop scripts for cleanup candidates`

---

## Livrable final

Mets à jour `CLEANUP_REPORT.md` (ou crée `FINISH_REPORT.md` à la racine) avec :

1. **Phase 1 — Rename** : nb d'occurrences remplacées, fichiers renommés, items flaggés à ne pas renommer (tables/buckets/repo)
2. **Phase 2 — filosofi-import** : décision prise (suppression / flag) + justification
3. **Phase 3 — Supabase findings** : tableau des 4 candidats avec leur classification (SAFE / REVIEW / KEEP) + résumé des checks
4. **Build & lint status** : output de `npm run build` + `npm run lint`
5. **Liste des commits** créés (`git log --oneline` depuis le dernier commit du cleanup précédent)
6. **Prochaine action requise par Vincent** : revue de `sql/cleanup/DROPS_PROPOSED.sql` et exécution manuelle après backup Supabase

---

## Go

Démarre maintenant. Phase 1 → Phase 2 → Phase 3, dans cet ordre. Build vert à la fin. Aucune exécution destructive sur Supabase.