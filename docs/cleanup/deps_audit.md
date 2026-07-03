# Audit dépendances — A4.6 phase 4

> Date : 2026-04-30
> Source : `npm audit --prod` sur `package.json`

## 4.1 Vulnérabilités

`npm audit --prod` :

| Sévérité | Nombre |
|---|---|
| **Critical** | 1 |
| **High** | 2 |
| **Moderate** | 7 |
| **Total** | **10** |

### Détail des packages affectés

| Package | Sévérité | Fix dispo | Action |
|---|---|---|---|
| `xlsx` | **High** | ❌ Aucun fix officiel (bibliothèque non maintenue) | Évaluer migration vers `exceljs` ou `xlsx-populate` |
| `protocol-buffers-schema` (<3.6.1) | Moderate | ✓ via `npm audit fix` | Apply (transitive) |
| `yaml` (2.0.0-2.8.2) | Moderate | ✓ via `npm audit fix` | Apply (transitive) |
| Autres (transitives) | Moderate/Critical | Variable | À auditer cas par cas |

### Recommandations

1. **Quick wins** : `npm audit fix` pour patcher les vulns transitives sans risque (yaml, protocol-buffers-schema, etc.) → ~7 vulns réglées
2. **xlsx** : migrer vers `exceljs` (compatible, mieux maintenu) — chantier dédié 4-6h car utilisé pour les imports OOH/POI
3. **Critical** : creuser la stack trace pour identifier le package racine, voir si une mise à jour mineure suffit

## 4.2 Packages outdated

À lancer post-fix : `npm outdated --depth=0` pour lister les packages mineurs upgradables sans risque.

**Exclus du scope A4.6** (risque trop élevé, à faire dans chantier dédié) :
- Next.js 14 → 15
- React 18 → 19 (déjà en 19 d'après package.json)
- Supabase JS Client majeur

## 4.3 Packages inutilisés

À vérifier via `npx depcheck --ignores='@types/*,eslint*,prettier'`. Suspects à retirer :
- À auditer (depcheck pas lancé dans cette session — impact bundle size mais 0 risque sécu).

## 4.4 Cohérence package.json

Checklist :
- [ ] `engines.node >= 20`
- [x] `scripts.dev`, `build`, `lint`, `test` présents
- [ ] Pas de duplicata `dependencies` ↔ `devDependencies`
- [ ] `pnpm-lock.yaml` ou `package-lock.json` commité

## 4.5 Recommandations consolidées

| # | Action | Effort | Risque |
|---|---|---|---|
| 1 | `npm audit fix` (vulns transitives sans risque) | 30min | low (test build après) |
| 2 | Migration `xlsx` → `exceljs` | 4-6h | medium |
| 3 | `npx depcheck` puis `npm remove` packages unused | 1-2h | low |
| 4 | Ajouter `engines.node` au `package.json` | 5min | nul |
