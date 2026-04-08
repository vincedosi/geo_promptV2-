# Design: Module d'import de campagnes DSP — Geo-Equity Bidding

> Date: 2026-04-08
> Branche: `feat/radio-multi-filter` (sera migrée ou nouvelle branche)
> Auteur: Claude + Vince Dosi

---

## Objectif

Permettre l'import d'exports DSP (Adform en premier, extensible DV360/TTD) pour analyser la répartition géographique des impressions publicitaires. Matching automatique code postal → IRIS pour les données France.

---

## Phase 1 — Modele de donnees

### Table `dsp_campaigns`

```sql
CREATE TABLE dsp_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  dsp_source TEXT NOT NULL DEFAULT 'adform',
  advertiser TEXT,
  date_start DATE,
  date_end DATE,
  total_tracked_ads INTEGER DEFAULT 0,
  countries TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);
```

Metadonnees de campagne. `dsp_source` permet de distinguer les formats d'export.

### Table `dsp_campaign_data`

```sql
CREATE TABLE dsp_campaign_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES dsp_campaigns(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  city TEXT,
  country TEXT NOT NULL,
  postal_code TEXT,
  region TEXT,
  dma_region TEXT,
  tracked_ads INTEGER NOT NULL DEFAULT 0,
  code_iris TEXT,
  code_commune TEXT,
  matched_at TIMESTAMPTZ,
  UNIQUE(campaign_id, date, postal_code, city)
);

CREATE INDEX idx_dsp_data_campaign ON dsp_campaign_data(campaign_id);
CREATE INDEX idx_dsp_data_country ON dsp_campaign_data(country);
CREATE INDEX idx_dsp_data_postal ON dsp_campaign_data(postal_code);
CREATE INDEX idx_dsp_data_iris ON dsp_campaign_data(code_iris) WHERE code_iris IS NOT NULL;
```

Donnees d'impressions par date/ville/code postal. Contrainte UNIQUE pour eviter les doublons sur re-import.

### Table `postal_code_commune` (reference)

```sql
CREATE TABLE postal_code_commune (
  code_postal TEXT NOT NULL,
  code_commune TEXT NOT NULL,
  nom_commune TEXT,
  PRIMARY KEY (code_postal, code_commune)
);

CREATE INDEX idx_postal_code ON postal_code_commune(code_postal);
```

Table de reference La Poste (~40k lignes). Un code postal peut correspondre a plusieurs communes (PK composite). Import one-shot depuis le fichier open data La Poste.

### RPC `match_campaign_postal_to_iris`

```sql
CREATE OR REPLACE FUNCTION match_campaign_postal_to_iris(p_campaign_id UUID)
RETURNS INTEGER AS $$
DECLARE
  matched_count INTEGER;
BEGIN
  UPDATE dsp_campaign_data d
  SET code_commune = sub.code_commune,
      code_iris = sub.code_iris,
      matched_at = NOW()
  FROM (
    SELECT DISTINCT ON (d2.id) d2.id, i.code_commune, i.code_iris
    FROM dsp_campaign_data d2
    JOIN postal_code_commune pc ON pc.code_postal = d2.postal_code
    JOIN iris i ON i.code_commune = pc.code_commune
    WHERE d2.campaign_id = p_campaign_id
      AND d2.country = 'France'
      AND d2.code_iris IS NULL
    ORDER BY d2.id, i.population DESC NULLS LAST
  ) sub
  WHERE d.id = sub.id;

  GET DIAGNOSTICS matched_count = ROW_COUNT;
  RETURN matched_count;
END;
$$ LANGUAGE plpgsql;
```

Jointure: `postal_code → postal_code_commune → iris.code_commune`. Quand plusieurs IRIS par commune, prend le plus peuple (DISTINCT ON + ORDER BY population DESC).

---

## Phase 2 — API Routes

Toutes les routes utilisent `requireAdmin()` + `createAdminClient()`.

### POST `/api/admin/campaigns/import`

Import en streaming SSE (comme l'import OOH). Pas de step parse/dry-run/execute — le schema Adform est fixe.

**Input**: multipart/form-data
- `file`: CSV ou XLSX
- `dsp_source`: string (defaut "adform")

**Flux**:
1. Parse fichier (papaparse CSV / SheetJS XLSX)
2. Mapping colonnes Adform:
   - `Campaign` → nom campagne
   - `Date` → date (parse DD/MM/YYYY)
   - `City` → city
   - `Country` → country
   - `Postal Code` → postal_code
   - `Region` → region
   - `DMA region` → dma_region
   - `Tracked Ads` → tracked_ads
3. Creer `dsp_campaigns` (nom, dates, pays, total)
4. Bulk insert `dsp_campaign_data` (50 lignes/batch)
5. Appeler `match_campaign_postal_to_iris` RPC
6. Streamer resultat final

**Evenements SSE**:
```
{ type: 'parsing', message }
{ type: 'progress', processed, total, message }
{ type: 'matching', matched, total_france, message }
{ type: 'complete', report: { campaign_id, total_rows, countries, total_france, matched_iris, pct_matched } }
{ type: 'error', message }
```

**Extensibilite DSP**: Le mapping est un objet JS par source. Ajouter DV360/TTD = ajouter un mapping. Pas d'abstraction prematuree.

### GET `/api/admin/campaigns`

Liste des campagnes avec stats agregees (subquery, pas de N+1):
```typescript
{
  campaigns: [{
    id, name, dsp_source, advertiser, date_start, date_end,
    total_tracked_ads, countries,
    total_rows, france_rows, matched_iris,
    created_at
  }]
}
```

### GET `/api/admin/campaigns/[id]`

Detail campagne + ventilations:
```typescript
{
  campaign: { ...metadata },
  stats: {
    by_country: [{ country, tracked_ads, row_count }],
    by_region: [{ region, tracked_ads, row_count }],
    by_department: [{ code_dept, tracked_ads, row_count }]
  },
  data: { rows: CampaignDataRow[], total: number, page: number }
}
```

Pagination: `?page=1&limit=50`

### DELETE `/api/admin/campaigns/[id]`

Suppression cascade (ON DELETE CASCADE sur dsp_campaign_data). Retourne `{ success: true }`.

---

## Phase 3 — UI Admin

Design system: dark minimal, accent teal #4ecdc4, Inter + JetBrains Mono, inline styles avec constantes couleur.

### Sidebar

Nouvel item dans AppSidebar, section Admin:
- Label: "Campagnes DSP"
- Icone: `BarChart3` (lucide-react)
- Badge: "DSP"
- Path: `/admin/campaigns`

### Page `/admin/campaigns` — Liste

- Section header "Campagnes DSP" + bouton "Importer une campagne" (white CTA)
- Table sortable: Nom, DSP (badge), Periode (mono), Pays, Impressions, France %, IRIS matches %, Actions
- Empty state: "Aucune campagne importee" + CTA upload
- Loading: GeoSkeleton

### Modal d'import

Overlay modal (pas une page separee).

**Step 1 — Upload**:
- Zone drag & drop (border #262626, hover teal)
- Accept .csv, .xlsx
- Dropdown DSP source (Adform par defaut)
- Bouton "Importer" (white CTA, disabled sans fichier)

**Step 2 — Progression**:
- Nom fichier + taille
- Barre de progression (#111111 track, #4ecdc4 fill)
- Compteurs live: lignes traitees, lignes France, IRIS matches
- Zone log auto-scroll (monospace)

**Step 3 — Resultat**:
- Carte resume avec stats cles
- "Voir la campagne" (teal outline) → detail
- "Fermer" (neutral) → ferme modal, refresh liste

### Page `/admin/campaigns/[id]` — Detail

**Header**: Nom, badge DSP, annonceur, periode, created_at. Metriques en ligne: Total | Pays | France % | IRIS %. Bouton supprimer (danger + confirm modal).

**Graphiques** (Recharts):
- Repartition par pays: bar chart horizontal (top 10)
- Repartition par region France: bar chart horizontal
- Repartition par departement: table triee avec barres inline

**Table donnees**:
- Paginee 50/page
- Colonnes: Date, Ville, Code postal, Region, Pays, Impressions, IRIS
- Filtre par pays (dropdown)

---

## Contraintes techniques

- **Supabase Nano**: L'import est sequentiel (50 lignes/batch), pas de parallel massif. Le matching IRIS est une seule requete SQL — acceptable.
- **Fichiers interdits**: Aucune modification sur `isochrone-battle`, fonctions `battle_*`, `middleware.ts`.
- **Auth**: `requireAdmin()` sur toutes les routes, `adminFetch()` cote client.
- **Pas de prefetch**: Les donnees campagne sont chargees a la demande (navigation vers la page).

---

## Hors perimetre (Phase 2 future)

- Preview/mapping interactif pour DSP a schema variable
- Visualisation cartographique des impressions sur la carte MapLibre
- Score Geo-Equity (indice d'equite territoriale)
- Export PDF rapport Geo-Equity
- Matching spatial (geocoding ville → coordonnees → ST_Intersects IRIS)
