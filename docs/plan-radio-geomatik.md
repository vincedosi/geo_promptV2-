# GEOMATIK — Feature Radio FM/DAB+ en France

## Plan d'action complet

---

## 1. Vision produit

Intégrer dans GEOMATIK une couche cartographique complète des émetteurs radio FM et DAB+ en France, enrichie des noms de radios, de leur classification, de données d'audience et de tarifs publicitaires.

**Objectif consulting :** Montrer à un client OOH quelles radios locales couvrent la même zone que son réseau de panneaux, avec l'audience et le coût d'achat d'espace radio — pour vendre du couplage radio + affichage.

**Objectif SaaS :** Offrir aux utilisateurs GEOMATIK une couche radio exploitable dans la carte, filtrable par type/genre/groupe, croisable avec les autres données géo.

---

## 2. Décisions actées

| Sujet | Décision |
|---|---|
| Historique | 12 mois glissants, purge au-delà |
| Pipeline de mise à jour | Script manuel Node.js (pas d'automatisation V1) |
| Source noms de radios | Crawler Arcom "Ma Radio FM" |
| Page admin | `/admin/radio`, super-admin uniquement |
| Multi-tenant | Données radio publiques, pas de `org_id` |
| Intégration ELM | Non en V1, plus tard |
| Audience & tarifs | Modèle flexible JSONB, alimentation ultérieure |

### Classification V1

- **Catégorie Arcom** : A (associative), B (locale commerciale), C (locale franchisée nationale), D (thématique nationale), E (généraliste nationale)
- **Portée** : nationale, régionale, locale, autoroute
- **Genre** : généraliste, musicale, info/talk, culturelle, communautaire
- **Groupe média** : NRJ Group, Radio France, RTL Group, Lagardère, indépendant…
- **Audience Médiamétrie** : données agrégées publiques (modèle flexible)

---

## 3. Sources de données

### 3.1 ANFR — Émetteurs (données techniques)

- **Quoi :** Position GPS, fréquence, puissance, hauteur, exploitant technique de chaque émetteur radio en France
- **Format :** ZIP mensuel (~64 Mo) contenant `SUP_EMETTEUR.txt` + `SUP_SUPPORT.txt` (CSV, séparateur `;`)
- **Filtre :** `EMR_LB_SYSTEME IN ('RDF FM', 'RDF T-DAB')`
- **Jointure :** `STA_NM_ANFR` entre les deux tables
- **URL :** https://www.data.gouv.fr/datasets/donnees-sur-les-installations-radioelectriques-de-plus-de-5-watts-1/
- **Licence :** Licence Ouverte 2.0
- **Volume :** ~8 500 fréquences FM + ~1 500 DAB+ = ~10 000 émetteurs
- **Mise à jour :** mensuelle

### 3.2 Arcom "Ma Radio FM" — Noms de radios

- **Quoi :** Correspondance fréquence + zone → nom de la radio, catégorie Arcom, nombre de villes couvertes
- **Accès :** Scraping HTML (pas d'API publique)
- **URL patterns :**
  - Par station : `csa.fr/maradiofm/liste_radio?recherche=1&station=NRJ`
  - Par ville : `csa.fr/maradiofm/liste_ville?recherche=3&commune=belfort`
- **Fréquence de mise à jour :** trimestriel suffit (les attributions bougent peu)

### 3.3 Audience Médiamétrie (ultérieur)

- Rapports trimestriels publics avec part d'audience et cumul par radio
- Saisie manuelle ou semi-automatique dans le JSONB `audience_data`

### 3.4 Tarifs publicitaires (ultérieur)

- Grilles tarifaires des régies radio (données à sourcer manuellement)
- Stockées dans le JSONB `tarifs_data`

---

## 4. Modèle de données

### Table `radios`

Référentiel des stations radio.

| Colonne | Type | Description |
|---|---|---|
| `id` | UUID PK | |
| `nom` | TEXT NOT NULL | Nom de la radio (NRJ, France Inter…) |
| `categorie_arcom` | TEXT | A, B, C, D ou E |
| `portee` | TEXT | nationale, régionale, locale, autoroute |
| `genre` | TEXT | généraliste, musicale, info_talk, culturelle, communautaire |
| `groupe_media` | TEXT | NRJ Group, Radio France, RTL Group… |
| `logo_url` | TEXT | URL du logo |
| `site_web` | TEXT | Site officiel |
| `audience_data` | JSONB | Données audience flexibles (voir exemples ci-dessous) |
| `tarifs_data` | JSONB | Données tarifaires flexibles (voir exemples ci-dessous) |
| `audience_updated_at` | TIMESTAMPTZ | Dernière MAJ audience |
| `tarifs_updated_at` | TIMESTAMPTZ | Dernière MAJ tarifs |
| `metadata` | JSONB | Champs libres pour extensions futures |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Exemple `audience_data` :**

```json
{
  "source": "mediametrie",
  "periode": "2025-T4",
  "part_audience_pct": 4.2,
  "cumul_auditeurs": 3850000,
  "cibles": {
    "25-49": { "part": 5.1 },
    "CSP+": { "part": 4.8 }
  }
}
```

**Exemple `tarifs_data` :**

```json
{
  "spot_30s_moyen": 1200,
  "grille": {
    "morning_6h_9h": 2500,
    "drive_17h_20h": 1800,
    "nuit": 350
  },
  "regie": {
    "nom": "NRJ Global",
    "contact": "commercial@nrj.fr",
    "tel": "01 xx xx xx xx"
  },
  "cpm_estime": 8.5
}
```

### Table `emetteurs_radio`

État courant des émetteurs.

| Colonne | Type | Description |
|---|---|---|
| `id` | UUID PK | |
| `sta_nm_anfr` | TEXT UNIQUE | Identifiant ANFR |
| `radio_id` | UUID FK → radios | Lien vers la radio (null si pas encore matché) |
| `systeme` | TEXT | RDF FM ou RDF T-DAB |
| `frequence_mhz` | NUMERIC | Fréquence en MHz |
| `puissance_w` | NUMERIC | Puissance PIRE en watts |
| `hauteur_m` | NUMERIC | Hauteur de l'antenne |
| `exploitant` | TEXT | TDF, Towercast, etc. |
| `adresse` | TEXT | Adresse de l'émetteur |
| `commune` | TEXT | Commune |
| `departement` | TEXT | Code département |
| `geom` | GEOMETRY(Point, 4326) | Position GPS |
| `rayon_couverture_m` | NUMERIC | Rayon estimé de couverture |
| `snapshot_date` | DATE | Date du fichier ANFR source |
| `created_at` | TIMESTAMPTZ | |

**Index :** GIST sur `geom`, B-tree sur `radio_id`, `systeme`, `departement`

### Table `emetteurs_radio_archive`

Même structure que `emetteurs_radio`, avec purge automatique > 12 mois.

### Vue `radio_couvertures` (ou table matérialisée)

Buffers de couverture pré-calculés à partir de la puissance et hauteur.

---

## 5. Intégrations UI — Vue complète

### 5.1 Sidebar navigation

Ajouter dans la section "Admin" :
- **Radio** (avec badge `Admin`) → lien vers `/admin/radio`
- Position : après "IRIS Crawler", avant la section "Système"

### 5.2 Page `/admin/sources` (existante — modifications)

**Header stats :** Ajouter une 6ème carte statistique :
- Titre : "Radio"
- Valeur principale : nombre total d'émetteurs (ex: `10 024`)
- Sous-texte : "FM 8 502 · DAB+ 1 522"
- Couleur accent : teal (cohérent design system)

**Onglets de filtre :** Ajouter un onglet "Radio (10k)" après "Transport & Flux"

**Section "Données système" :** Ajouter un bloc "Radio — Émetteurs FM & DAB+" :
- Badge `Radio` (teal)
- Stats inline : nombre émetteurs FM, nombre DAB+, nombre radios identifiées, date dernier import ANFR
- Lien "Gérer →" vers `/admin/radio`

### 5.3 Page `/admin/radio` (nouvelle — super-admin uniquement)

**Onglet Import :**
- Bouton "Importer données ANFR" (lance le script, affiche progression + logs en temps réel)
- Bouton "Crawler radios Arcom" (lance le crawl, progression + logs)
- Tableau historique des imports : date, type (ANFR/Arcom), nombre de lignes, durée, statut (succès/erreur)
- Indicateur de fraîcheur : "Dernière MAJ ANFR : il y a 23 jours" avec alerte orange si > 45 jours

**Onglet Radios :**
- Liste paginée, triable, filtrable (par catégorie, portée, genre, groupe)
- Recherche par nom de radio
- Édition inline : nom, catégorie Arcom, portée, genre, groupe média, logo URL
- Import CSV bulk pour audience et tarifs (upload → mapping colonnes → prévisualisation → validation)
- Clic sur une radio → drawer avec fiche complète + formulaire JSONB audience/tarifs
- Badge indiquant si audience et/ou tarifs sont renseignés

**Onglet Stats :**
- KPIs en cartes : total émetteurs, FM/DAB+ split, radios identifiées, % matching (émetteurs avec radio associée)
- Répartition par catégorie Arcom (bar chart)
- Répartition par genre (donut chart)
- Répartition par portée (bar chart)
- Top 10 radios par nombre d'émetteurs
- Carte miniature de densité des émetteurs par département

### 5.4 Page `/map` (existante — ajouts)

**Layer switcher :** Nouveau layer group "Radio" avec 4 sous-couches toggleables :

1. **Points émetteurs (clusters)** — Vue par défaut
   - Clustering MapLibre avec dégroupement au zoom
   - Symbologie par portée : nationale (bleu), locale (vert), associative (orange), autoroute (jaune)
   - Icône différente FM vs DAB+ (cercle vs losange, ou indicateur dans le cluster)

2. **Zones de couverture (buffers)** — Toggle optionnel
   - Cercles semi-transparents autour de chaque émetteur
   - Rayon calculé depuis puissance + hauteur
   - Opacité réduite pour voir les superpositions
   - Disclaimer visible : "Couverture estimée (approximation)"

3. **Heatmap densité radio** — Toggle optionnel
   - Heatmap MapLibre basée sur la densité de points émetteurs
   - Pondération par puissance (un émetteur 100 kW pèse plus qu'un 100 W)
   - Utile pour visualiser les zones sur/sous-couvertes

4. **Couche par radio spécifique** — Sélection dans le panel filtre
   - Sélectionner une radio (ex: "NRJ") → affiche uniquement ses émetteurs + couverture
   - Utile pour un pitch client : "voici la couverture NRJ dans votre zone"

**Panel filtre latéral (section Radio) :**
- Filtre par portée (nationale / locale / asso / autoroute)
- Filtre par genre (généraliste / musicale / info / etc.)
- Filtre par groupe média (NRJ Group / Radio France / etc.)
- Recherche par nom de radio spécifique (autocomplete)
- Filtre FM / DAB+ / les deux
- Slider puissance min/max (pour filtrer les gros vs petits émetteurs)

**Popup clic émetteur :**
- Nom de la radio (ou "Non identifié" si pas encore matché)
- Fréquence (ex: "95.0 MHz FM")
- Puissance et portée estimée
- Catégorie Arcom + portée
- Lien "Voir fiche radio →" ouvrant le drawer

**Drawer fiche radio (sheet latéral) :**
- En-tête : logo + nom + groupe média
- Classification : catégorie, portée, genre
- Stats : nombre d'émetteurs FM / DAB+, nombre de villes couvertes
- Mini-carte : tous les émetteurs de cette radio
- Section audience (si renseignée) : part d'audience, cumul auditeurs, cibles
- Section tarifs (si renseignée) : grille tarifaire, CPM estimé, contact régie
- Bouton "Filtrer la carte sur cette radio"

### 5.5 API routes (backend)

| Route | Description |
|---|---|
| `GET /api/radio/emetteurs` | GeoJSON des émetteurs avec filtres (systeme, portee, genre, groupe, radio_id, bbox) |
| `GET /api/radio/emetteurs/heatmap` | Points pondérés pour la heatmap |
| `GET /api/radio/stations` | Liste des radios avec stats agrégées |
| `GET /api/radio/stations/[id]` | Fiche détaillée d'une radio |
| `GET /api/radio/stats` | KPIs pour le dashboard admin |
| `GET /api/radio/in-zone` | Radios couvrant une géométrie donnée |
| `POST /api/radio/import-anfr` | Lance l'import ANFR (super-admin) |
| `POST /api/radio/crawl-arcom` | Lance le crawl Arcom (super-admin) |
| `PUT /api/radio/stations/[id]` | Mise à jour d'une radio (classification, audience, tarifs) |
| `POST /api/radio/stations/bulk-update` | Import CSV bulk audience/tarifs |

---

## 6. Phases de développement

### Phase 0 — Modèle de données ✅
- ✅ Migrations SQL (tables, index, RLS, RPC PostGIS) — `supabase/migrations/20260401_radio_tables.sql`
- ✅ Fonction `estimate_radio_coverage(puissance, hauteur)` → rayon en mètres
- ✅ Fonction `get_radios_in_zone(geom)` → radios couvrant une zone
- ✅ Fonction `archive_and_purge_radio()` → archivage + purge 12 mois
- ✅ Fonction `get_radio_stats()` → KPIs dashboard
- ✅ RLS : lecture pour tous les utilisateurs authentifiés (SELECT TO authenticated)
- ✅ Vue matérialisée `radio_couvertures_agg` (ST_Union des buffers couverture)
- ✅ 4 tables, 22 index, 4 fonctions, 4 policies, 1 matview, 1 trigger

### Phase 1 — Import ANFR (données techniques)
- Script `scripts/update-radio.mjs`
- Téléchargement ZIP data.gouv.fr
- Parsing CSV, filtrage FM/DAB+, jointure support
- Diff avec état courant, archivage, insertion
- Calcul des rayons de couverture estimés
- **Lancement :** `npm run update-radio`

### Phase 2 — Crawler Arcom (noms de radios)
- Script `scripts/crawl-arcom-radios.mjs`
- Crawl de la liste des radios par département
- Extraction : nom, fréquences, émetteurs, catégorie
- Matching avec les données ANFR (fréquence + proximité géo)
- Peuplement table `radios` + FK `radio_id`
- Rate limiting 1 req/s, cache local `data/cache-arcom/`, mode incrémental
- **Lancement :** `npm run crawl-radios`

### Phase 3 — API backend
- Routes API listées en section 5.5
- RPC PostGIS pour les requêtes spatiales
- Endpoint GeoJSON avec filtres combinables
- Endpoint heatmap (points pondérés)
- Protection super-admin sur les routes d'écriture

### Phase 4 — Page admin `/admin/radio`
- Sidebar : ajout lien Radio
- Page `/admin/sources` : carte stats Radio + onglet + bloc données système
- Page `/admin/radio` : 3 onglets (Import, Radios, Stats)
- Lancement import/crawl depuis l'UI avec logs temps réel
- CRUD référentiel radios + import CSV bulk
- Dashboard stats avec charts
- Design System GEOMATIK (dark minimal, teal accent)

### Phase 5 — Intégration `/map`
- Layer group Radio dans le layer switcher
- 4 sous-couches : points clusters, buffers couverture, heatmap densité, radio spécifique
- Panel filtre latéral section Radio
- Popup émetteur + drawer fiche radio
- Symbologie par portée et système (FM/DAB+)

### Phase 6 — Croisement OOH (V2)
- Requête spatiale : panneaux sélectionnés → radios couvrant la même zone
- Indicateur complémentarité radio × affichage par IRIS
- Section radio dans les rapports ELM
- Export recommandation média (quelles radios acheter pour compléter l'affichage)

---

## 7. Estimation

| Phase | Durée estimée | Dépendance |
|---|---|---|
| Phase 0 — Modèle BDD | 0.5 jour | — |
| Phase 1 — Import ANFR | 1-2 jours | Phase 0 |
| Phase 2 — Crawler Arcom | 2-3 jours | Phase 0 |
| Phase 3 — API backend | 1-2 jours | Phases 1+2 |
| Phase 4 — Admin `/admin/radio` + `/admin/sources` | 3-4 jours | Phase 3 |
| Phase 5 — Intégration `/map` (4 modes d'affichage) | 3-4 jours | Phase 3 |
| Phase 6 — Croisement OOH | 2-3 jours | Phases 4+5 |
| **Total** | **~13-18 jours** | |

---

## 8. Points de vigilance

- **PostgREST row limits :** les requêtes émetteurs (~10k lignes) dépassent le seuil par défaut → utiliser des RPC JSON ou `.limit(100000)`
- **Supabase Disk I/O :** l'import bulk doit éviter `Promise.all()` massif → batches de 500 lignes max
- **Perf carte 4 couches :** ne pas charger les 4 couches simultanément, lazy loading par toggle. La heatmap et les buffers sont lourds → calculer côté serveur, envoyer un résumé
- **GeoJSON vs MVT :** 10k points passent en GeoJSON, mais les buffers (10k polygones) peuvent nécessiter du MVT si ça lag → prévoir le fallback
- **Crawl Arcom :** être poli (1 req/s, User-Agent identifié), le site peut changer de structure → prévoir un fallback frequence-radio.org
- **JSONB audience/tarifs :** prévoir la validation côté front pour éviter les données mal structurées, et un schéma JSON documenté pour chaque type
- **Buffers de couverture :** la formule puissance → rayon est une approximation (pas de modèle terrain), le disclaimer doit être visible dans l'UI
- **Cohérence UI :** la page `/admin/radio` doit suivre exactement le même design pattern que `/admin/sources` (même layout, mêmes composants, même sidebar)
- **Fichiers protégés :** ne jamais modifier `/api/isochrone-battle/route.ts` ni les fonctions PostGIS `battle_*`
- **Tests avant intégration map :** valider que les données sont correctes et le matching radio→émetteur fiable AVANT de brancher le frontend. Sinon on debug l'UI alors que le problème est dans les données
