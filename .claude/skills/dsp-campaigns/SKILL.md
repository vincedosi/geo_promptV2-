---
name: dsp-campaigns
description: >
  Tout sur les campagnes DSP dans GEOMATIK : import CSV/XLSX, tables dsp_campaigns et
  dsp_campaign_data, matching IRIS via codes postaux, column mappings Adform, SSE streaming.
  Utilise cette skill quand le prompt mentionne campagne, DSP, Adform, DV360, import CSV,
  tracked ads, matching postal, ou tout travail sur les tables dsp_*.
---

# Campagnes DSP — GEOMATIK

## Tables

| Table | Contenu | Volume |
|-------|---------|--------|
| `dsp_campaigns` | Métadonnées campagne (nom, source DSP, dates, pays) | ~dizaines |
| `dsp_campaign_data` | Lignes d'impressions (date, city, postal_code, country, tracked_ads, code_iris, code_commune) | 280k+ |
| `postal_code_commune` | Référentiel La Poste code postal → commune INSEE | ~35k |

## Contraintes DB

- **UNIQUE** sur `(campaign_id, date, postal_code, city)` — pré-agréger doublons AVANT insert (`SUM(tracked_ads)`)
- RPC `get_dsp_campaign_stats` pour stats agrégées (évite N+1 COUNT sur 280k+ lignes)
- ⛔ Ne JAMAIS faire de COUNT séquentiels par campagne → incident 04-08 (timeout + boucle infinie)

## Flow d'import

1. Upload fichier CSV/XLSX
2. **Preview mapping** (OBLIGATOIRE avant import) — l'utilisateur valide le mapping colonnes
3. SSE streaming pendant l'import (progression temps réel)
4. Matching IRIS automatique post-import via `match_campaign_postal_to_iris`

### Points d'attention import

- `request.formData()` doit être appelé AVANT `ReadableStream.start()` (incident 04-08 : body déjà consumed)
- Column mappings extensibles dans `lib/campaigns/column-mappings.ts` (actuellement : Adform)
- Batch insert par 50 max (pattern `lib/import/inserter.ts`)

## RPCs

- `match_campaign_postal_to_iris` — postal_code → code_commune (via `postal_code_commune`) → code_iris (via `iris`)
- `get_dsp_campaign_stats` — stats agrégées par campagne

## Fichiers de référence

- Import : `app/api/admin/campaigns/import/route.ts`
- Column mappings : `lib/campaigns/column-mappings.ts`
- Inserter pattern : `lib/import/inserter.ts`

## Matching IRIS — Performance

Le matching sur campagnes volumineuses (200k+ lignes, DISTINCT ON + 3 JOINs) peut épuiser le budget I/O Nano.
Solutions : batch par commune, éviter DISTINCT ON sur gros volumes, utiliser des index sur postal_code.
