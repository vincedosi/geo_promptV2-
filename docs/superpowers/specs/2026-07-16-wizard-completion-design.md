# Wizard campagne 100% complet (hors API) — Design

> Validé avec Vincent le 16/07/2026. Périmètre : tout ce qui manque au wizard de
> création de campagne pour être autonome de bout en bout SANS connexion API DSP
> (les connexions API restent une phase ultérieure).
> Hors périmètre : formats d'inventaire, export PDF du plan (reportés).

## Contexte

Le wizard (overlay MAGELIAN, onglet Création, 5 étapes Cible → Canaux → Pression
→ Stratégie → Lancement) sait aujourd'hui programmer une campagne **déjà
importée** depuis un DSP/ad server. Le cycle de vie réel est inverse : la
campagne naît dans MAGELIAN **avant** d'exister chez Adform/CM360 ; les données
de diffusion arrivent après et doivent se rattacher à la campagne existante.

Acquis du 16/07 : liaisons plateformes manuelles par canal
(`dsp_channel_registry.link_levels`, `channels.links[code]`), annonceur/produit
sur `dsp_campaigns`.

## 1. Naissance : « Nouvelle campagne »

**UI** — Bouton « + Nouvelle campagne » dans le sélecteur de campagne en haut de
l'overlay MAGELIAN (`components/magelian/MagelianOverlay.tsx`), au-dessus des
onglets. Au clic : création puis bascule immédiate sur l'onglet Création, étape
Cible (le nom se change là).

**API** — `POST /api/admin/campaigns` (route existante, méthode nouvelle,
`requireAdmin`) :
- Body : `{ name?, organization_id? }` (défauts : « Nouvelle campagne — JJ/MM/AAAA »,
  org active du profil). Un admin non super_admin ne peut créer que dans son org.
- Insert `dsp_campaigns` : `dsp_source = 'magelian'`, zéro ligne de données,
  `advertiser/product` null, dates null.
- Retour : `{ campaign }`.

**Comportement** — Une campagne `dsp_source='magelian'` sans données se comporte
partout comme une campagne importée (stats vides, suivi vide tant que rien n'est
rattaché). Vérifier que les vues liste/suivi tolèrent 0 ligne (déjà le cas pour
les campagnes fraîchement importées vides).

## 2. Rattachement Adform/CM360 — les deux sens

La clé de rattachement est la liaison ad server saisie à l'étape Canaux :
`geo_strategy.channels.links.adform.campaign_id` (ou `.cm360.…`), à défaut le
nom exact de campagne.

### 2a. Import → campagne existante

Dans `app/api/admin/campaigns/import/route.ts`, avant la création de la
campagne :
1. Chercher dans l'org une campagne dont `links.<adserver>.campaign_id` == ID
   campagne du fichier (si le mapping source fournit un ID), sinon dont le
   `name` == nom de campagne du fichier (comparaison trim, insensible à la casse).
2. Match → `campaign_id` cible = campagne existante ; les lignes s'insèrent
   dedans (pipeline d'insertion inchangé, y compris matching IRIS post-import).
   Les métadonnées de la campagne existante (nom, annonceur, dates) ne sont PAS
   écrasées par le fichier.
3. Pas de match → création comme aujourd'hui.
4. Le flux SSE de l'import annonce le rattachement (« Données rattachées à la
   campagne "X" ») — progression obligatoire, règle maison.

### 2b. Campagne → import orphelin (« Rattacher un import existant »)

Dans le panel de liaison de l'ad server sélectionné (étape Canaux), bouton
« Rattacher un import existant » :
- `GET /api/admin/campaigns?unprogrammed=1` (filtre : campagnes de l'org avec
  données mais sans stratégie de bidding et ≠ campagne courante) → liste
  (nom, source, nb lignes, période).
- Sélection + modal de confirmation (fusion irréversible, wording explicite).
- `POST /api/admin/campaigns/[id]/absorb` : body `{ source_campaign_id }`.
  Transaction : `UPDATE dsp_campaign_data SET campaign_id = [id] WHERE
  campaign_id = source`, recopie des totaux/dates si la cible n'en a pas,
  `DELETE` de la coquille source, recalcul `total_tracked_ads`. Scope org
  vérifié sur les deux campagnes (anti-IDOR).
- L'unicité `idx_dsp_data_unique` peut faire échouer la bascule en cas de
  doublon exact (même date/CP/ville/média) : fusionner en pré-agrégeant
  (SUM tracked_ads) les lignes en conflit, pattern DELETE ciblé + insert
  (l'index d'expression n'est pas inferable par `onConflict` — voir
  ARCHITECTURE, table `dsp_campaign_data`).
- Volumes : campagnes 200k+ lignes possibles → batcher l'UPDATE (par
  tranches de date ou LIMIT itératif), progression SSE si > quelques
  secondes. Budget I/O Nano à respecter.

## 3. Mini-graph hub + double validation (étape Canaux)

**Composant** `components/campaign/wizard/steps/ChannelHubRecap.tsx` :
- Hub central : nom de campagne + annonceur (depuis le draft).
- Trois branches : MESURE (ad server), DSP, SOCIAL. Chaque canal sélectionné :
  label + état de liaison (`✓ liée` + ID le plus profond renseigné, ou
  « — non liée »). Données 100% locales (draft + catalogue déjà chargé) : zéro
  fetch.
- Rendu flexbox/CSS pur (pas de lib de graphe), tokens design system
  (`var(--…)`), dot teal, flat.

**Double validation** :
1. Étape Canaux : coche « Je confirme ces liaisons » sous le hub. `Continuer`
   grisé tant qu'elle n'est pas cochée. La coche se **réinitialise** à toute
   modification de canaux/liaisons/ad server après coup (état local dérivé d'un
   hash de la sélection).
2. Étape Lancement : le récap réaffiche le hub en condensé ; le CTA « Créer la
   campagne » exige une seconde coche « Liaisons vérifiées » (état local à
   l'étape, non persisté).

Champ draft : `linksConfirmed: boolean` (réinitialisé par le hash) — non
persisté en base, re-demandé à chaque session (c'est le but d'une validation).

## 4. Pression sur l'indicateur choisi (fix structurel)

**Problème** — `TARGET_VARIABLE_CODE = 'abstention_pres_2022'` en dur
(`components/campaign/wizard/steps/types.ts`) ; le RPC
`apply_zone_weights_to_strategy` n'interpole que via un JOIN sur
`dataset_abstention_2022`. Toute cible construite sur un autre indicateur
produit une courbe d'enchère appliquée au mauvais signal.

**Nouvelle table** `indicator_cp_values` :
```
indicator_code text, postal_code text, value numeric,
computed_at timestamptz, PK (indicator_code, postal_code)
```
- Alimentée par RPC `materialize_indicator_cp_values(p_indicator_code)` :
  agrégation IRIS → CP en moyenne pondérée par population (via
  `postal_code_commune` + `iris`, `is_true_iris = true`), ~6 000 lignes par
  indicateur. Indicateurs à l'échelle CP (pollen/ATMO) : copie directe.
- Appelée à la première utilisation d'un indicateur (lazy) depuis le Lancement ;
  re-matérialisation si `computed_at` > 30 j ou indicateur dynamique.
- `dataset_abstention_2022` migré dans la table (l'abstention devient un
  indicateur comme un autre) ; l'ancienne table reste en lecture le temps de la
  transition puis le JOIN legacy est retiré du RPC.
- `EXPLAIN ANALYZE` sur la requête d'agrégation (contrainte maison), batch par
  département si nécessaire pour le budget I/O.

**RPC généralisé** — `apply_zone_weights_to_strategy` : le CASE
`by_insee_variable` JOIN `indicator_cp_values` sur
`p_in_weights->>'variable_code'` (plus de garde en dur sur l'abstention).
Sémantique identique sinon (GREATEST/LEAST 0..5, exclusion, uniform, tiers).

**Wizard** :
- `types.ts` : `TARGET_VARIABLE_CODE` supprimé ; le draft porte
  `pressureVariable: string | null`, déduit du panier de cibles.
- Étape Pression : « Pression sur : *<label indicateur>* ». Plusieurs
  indicateurs dans le panier → select. Aucun indicateur (zones
  dessinées/galerie, national pur) → mode **uniforme** : `in_zone_weights =
  { mode: 'uniform', value: pression }`, l'UI l'explique (« pression uniforme
  ×N dans ta cible »).
- Étape Lancement : construit `in_zone_weights` avec le `variable_code` choisi
  (courbe normalisée sur les bornes slider de l'indicateur — `slider_min/max`
  du registre cibles remplacent les x 20/30/45 câblés sur l'abstention).
- Export custom bidding (`lib/digital/bidding-export.ts`) : lit déjà la courbe
  de la stratégie ; adapter la source des valeurs CP à `indicator_cp_values`.

## 5. Brouillon persistant

Brancher l'existant (chantier A4.7, jamais câblé) : table
`bidding_strategy_drafts` + routes `/api/bidding/strategies/drafts[/id]`.
- Autosave du `ProgDraft` (debounce 1 s) depuis `CampaignCockpit`, clé logique
  `campaign_id` + user (`draft_data` = ProgDraft sérialisé + étape courante).
- Au montage : si un draft existe pour cette campagne → restauration silencieuse
  + bandeau discret « Brouillon restauré (il y a X h) — repartir de zéro »
  (action : delete draft + reset).
- Au Lancement réussi : DELETE du draft.
- Expiration 30 j déjà gérée. Vérifier le schéma réel de la table avant câblage
  (colonnes `user_id`, `draft_data`, `last_saved_at`).

## 6. Forecast en direct

Composant `ForecastStrip` (étapes Canaux + Lancement) :
- **Impressions estimées** = budget global ÷ CPM × 1000 — calcul local,
  réactif au clavier.
- **Audience cible** : habitants couverts + % France — réutilise les RPC du
  plan média zones custom (`compute_zone_items_audience` / totaux nationaux
  `get_national_population_totals`, caches serveur existants). Fetch UNE fois
  par zone matérialisée, cache `useRef` côté client (contrainte Nano).
- **Coût par 1 000 habitants touchés** (budget ÷ habitants × 1000) si
  l'audience est connue.
- National pur (panier vide) : audience = total France (RPC totaux nationaux).
- Dégradé gracieux : si l'audience n'est pas calculable (zone sans codes),
  n'afficher que les impressions.

## 7. Étape Stratégie enrichie (objectif, KPI, capping, pacing)

Tous les champs existent dans `bidding_strategies` et le schéma Zod du POST :
- **Objectif** : 3 OptionRow — Notoriété (`maximize_reach`), Trafic
  (`maximize_traffic`), Conversions (`maximize_leads`, défaut actuel).
  `objective_code` cesse d'être en dur au Lancement. Vérifier les
  `objective_code` acceptés en base (contrainte CHECK éventuelle) et aligner.
- **KPI cible** (optionnel) : input numérique + unité contextuelle à l'objectif
  (reach : habitants ; trafic : visites ; conversions : leads) → `kpi_target`.
- **Capping fréquence** (optionnel) : « X impressions / Y jours » →
  `frequency_cap_imps` + `frequency_cap_period_days`. Vides = pas de cap.
- **Pacing** : select Régulier (`even`, défaut) / Départ fort (`front_loaded`) /
  Montée en puissance (`back_loaded`) → `pacing_strategy`.
- Draft étendu (`objective`, `kpiTarget`, `freqCapImps`, `freqCapDays`,
  `pacing`) ; envoyés au POST/PATCH stratégie au Lancement ; récap Lancement
  les affiche.

## Données & migrations

| Objet | Type | Contenu |
|---|---|---|
| sql/106 | table + RPC | `indicator_cp_values` + `materialize_indicator_cp_values` + généralisation `apply_zone_weights_to_strategy` + migration abstention |
| `POST /api/admin/campaigns` | route | création campagne vierge `dsp_source='magelian'` |
| `POST /api/admin/campaigns/[id]/absorb` | route | fusion import orphelin → campagne |
| import route | modif | matching liaison/nom avant création |
| drafts | câblage | routes existantes, zéro migration |

## Erreurs & garde-fous

- Fusion (absorb) : modal irréversible, scope org strict, doublons pré-agrégés,
  batch + progression.
- Matérialisation d'indicateur : timeout/erreur → Lancement bloqué avec message
  clair (« indicateur en préparation, réessaie ») plutôt que courbe fausse.
- Double validation : jamais persistée, re-demandée à chaque passage.
- Aucun `Promise.all` > 3 appels Supabase ; caches client `useRef` pour
  l'audience.

## Tests

- Unitaires : matching import (ID / nom / aucun), pré-agrégation des doublons de
  fusion, déduction `pressureVariable` depuis le panier, courbe normalisée sur
  bornes d'indicateur, reset de la coche sur changement de sélection, calculs
  forecast.
- RPC : `apply_zone_weights_to_strategy` sur un indicateur non-abstention
  (valeurs connues → multiplicateurs attendus), mode uniforme.
- Browser (mode démo) : nouvelle campagne → wizard complet → hub + double
  validation → lancement → rattachement d'un import orphelin → suivi alimenté.

## Ordre de construction

1. **Pression sur l'indicateur choisi** (indépendant, le plus profond)
2. **Nouvelle campagne + rattachement** (les deux sens)
3. **Hub + double validation**
4. **Brouillon persistant**
5. **Forecast**
6. **Stratégie enrichie**

Chaque incrément est livrable seul (commit atomique, tests verts, vérif browser).
