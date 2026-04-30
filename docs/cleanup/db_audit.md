# Audit DB — A4.6 phase 3

> Date : 2026-04-30
> Source : Supabase project `vkkdbygwbrxyogqosten`

## 3.1 État global

| Métrique | Valeur |
|---|---|
| Tables publiques | 70 |
| Tables avec RLS | 69 (1 sans = `spatial_ref_sys` PostGIS) |
| Tables sans PK | **1** (`carreaux_1km`) |
| RPCs / functions custom | ~24 (sur 880 incl. PostGIS) |
| Migrations | 39 |

## 3.2 Schéma DB cohérent

### Tables sans PRIMARY KEY (anomalie)

```sql
SELECT t.table_name FROM information_schema.tables t
WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    WHERE tc.table_name=t.table_name AND tc.constraint_type='PRIMARY KEY'
  );
```

**Résultat** : `carreaux_1km`

**Recommandation** : ajouter PK ou expliquer pourquoi (table d'agrégat possiblement déduite, vérifier les patterns d'écriture/écrasement). À traiter dans une migration `add_pk_carreaux_1km.sql` après vérif que rien n'utilise une UPSERT non-keyée.

### FK orphelines

```sql
SELECT conname FROM pg_constraint c
WHERE contype='f' AND NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=c.confrelid);
```

**Résultat : 0** ✓

### JSONB sans default

À auditer en P2 dédié — tolérable pour les colonnes optionnelles.

## 3.3 Indexes manquants ou inutilisés

À auditer plus précisément en chantier dédié (les `pg_stat_user_indexes` ne sont pas significatifs en mode démo).

Checklist pour quand le repo passera en prod-load :
- Vérifier que toutes les FK ont un index (sinon JOIN slow).
- Vérifier les indexes partial mal calibrés.
- Identifier les indexes jamais scannés après 2 semaines de prod.

## 3.4 RPCs orphelines

880 functions custom dans `public` (incl. PostGIS). Filtrage manuel nécessaire.

Recommandation : audit ciblé avec filtre sur les RPCs créées via nos migrations (`docs/cleanup/rpc_inventory.md` futur).

## 3.5 Adform legacy strict (vérification finale)

```sql
SELECT COUNT(*) FROM dsp_campaigns WHERE is_demo=false;
-- 4 ✓
SELECT COUNT(*) FROM dsp_campaign_data WHERE campaign_id IN (SELECT id FROM dsp_campaigns WHERE is_demo=false);
-- 294135 ✓
SELECT SUM(tracked_ads) FROM dsp_campaign_data WHERE campaign_id IN (SELECT id FROM dsp_campaigns WHERE is_demo=false);
-- 172056383 ✓
```

✓ État Adform inchangé depuis import initial.

## 3.6 Recommandations consolidées

| # | Action | Effort | Risque |
|---|---|---|---|
| 1 | Ajouter PK sur `carreaux_1km` | 1h | low |
| 2 | Audit FK → index manquant (post-prod 2 sem) | 2h | low |
| 3 | Inventaire RPCs métier orphelines | 3h | low |
