# Design — Objet Campagne : statut & cycle de vie

> Date : 2026-07-03 · Portée : campagnes **digitales** uniquement (DSP programmatique).
> Statut du doc : validé en brainstorming, en attente de relecture avant plan d'implémentation.

## Problème

`dsp_campaigns` est déjà un objet riche (nom, DSP, annonceur, `date_start`/`date_end`,
`kpi_primary`/`kpi_target`, `total_budget`, `currency`, `countries`, `geo_strategy`
qui porte le plan média, `total_unique_impressions`…) mais **plat** : aucune notion
d'état. Une campagne est un conteneur passif de données d'impressions importées.

Conséquence : impossible de répondre à la question centrale du pilotage —
**« quelles campagnes sont LIVE, à surveiller maintenant ? »** — sans ouvrir chaque
campagne et croiser mentalement dates + données. La liste ne distingue pas une
campagne en cours d'une campagne terminée ou en pause.

## Objectif

Donner à chaque campagne un **statut** qui sert d'abord le **pilotage** (savoir quoi
surveiller), calculé automatiquement mais corrigeable à la main (Magelian ne parle
pas aux DSP — hors connexions API).

### Bénéfice mesurable
Depuis la liste des campagnes, l'utilisateur voit d'un coup d'œil les campagnes
« En cours » (remontées en tête, badge distinct), repère celles qui demandent
attention (en cours mais sans données fraîches), et peut mettre en pause / clôturer /
archiver sans quitter la liste.

## Non-objectifs (hors scope)

- **Synchro DSP live réelle** (savoir qu'un DSP a réellement mis en pause) → nécessite l'API.
- **Dashboard pacing plan-vs-réel complet** → feature adjacente distincte.
- **Création de campagne depuis un brief** → donc **pas d'état « Brouillon »**.
- **Versioning / historique / workflow d'approbation.**

## Décisions de design (arbitrées en brainstorming)

1. **Rôle du statut** : d'abord le pilotage (« savoir quoi surveiller »), pas le
   rangement ni le verrouillage de workflow.
2. **Mécanique** : hybride — le calendrier (dates + fraîcheur des données) *propose*,
   l'humain *corrige*.
3. **Jeu d'états** : 5 libellés opérationnels (pas de « Brouillon », pas de version minimale à 3).
4. **Point d'attention** conservé (léger, dans le périmètre de cet objet).

## Approche retenue : statut calculé + override

Le **statut effectif** n'est jamais stocké pour sa partie dérivée. Il se calcule :

```
statut_effectif = override_manuel  (s'il existe)
                  sinon  dérivé du calendrier :
                    aujourd'hui < date_start        → « à venir »
                    aujourd'hui > date_end          → « terminée »
                    sinon                           → « en cours »
```

Seules les corrections manuelles (« en pause », clôture anticipée, archivage) sont
persistées, comme *override*. La partie calendrier est recalculée à la lecture → **jamais
de statut périmé, aucun cron**.

Approches écartées : (2) colonne `status` stockée + cron nightly — plus de machinerie,
peut se périmer entre deux passages ; (3) statut 100 % manuel — contredit le choix
hybride, dérive faute de rigueur.

## Modèle de données

Trois colonnes ajoutées à `dsp_campaigns` (migration Supabase versionnée dans `sql/`) :

| Colonne | Type | Notes |
|---|---|---|
| `status_override` | `text NULL` | `CHECK (status_override IN ('paused','ended','archived'))` |
| `status_override_at` | `timestamptz NULL` | horodatage de la dernière correction manuelle |
| `status_override_by` | `uuid NULL` | auteur (piste d'audit) |

Aucune colonne `status` stockée pour la partie dérivée.

## États & transitions

Cinq états de surface :

| État | Origine | Badge |
|---|---|---|
| **À venir** | calendrier (`today < date_start`) | neutre |
| **En cours** | calendrier (`date_start ≤ today ≤ date_end`) | teal vif |
| **En pause** | override `paused` | warning |
| **Terminée** | calendrier (`today > date_end`) **ou** override `ended` (clôture anticipée) | grisé |
| **Archivée** | override `archived` | masquée par défaut |

Transitions (actions utilisateur, toutes permises sans garde-fou lourd) :

- **Mettre en pause** (depuis En cours) → `status_override = 'paused'`.
- **Reprendre** (depuis En pause) → efface l'override → rebascule sur le calendrier.
- **Clôturer** (depuis En cours / En pause, avant `date_end`) → `status_override = 'ended'`.
- **Archiver** (depuis n'importe quel état) → `status_override = 'archived'`.
- **Désarchiver** → efface l'override → rebascule sur le calendrier.

Effacer l'override rebascule toujours sur l'état calendaire courant.

## Point d'attention (fraîcheur des données)

Pour les campagnes **En cours** uniquement, un indicateur d'attention (point/pastille
à côté du badge) signale qu'aucune donnée n'a été importée récemment :

```
attention = (statut_effectif == 'en cours')
            ET ( last_data_date est NULL
                 OU (CURRENT_DATE - last_data_date) > FRESHNESS_DAYS )
```

- `last_data_date` = `max(dsp_campaign_data.date)` pour la campagne.
- `FRESHNESS_DAYS` = constante (défaut **3**, ajustable) — la diffusion digitale se
  reporte quasi quotidiennement ; au-delà de 3 jours sans donnée sur une campagne
  live, il y a lieu de vérifier.

L'attention est un **signal booléen léger**, pas un score de santé. Le vrai dashboard
pacing plan-vs-réel (délivrance vs plan, burn budget) est la feature suivante qui
s'appuiera sur ce statut.

## Découpage & interfaces

Unités isolées, chacune un rôle clair :

- **`lib/campaigns/status.ts`** (logique pure, testable, zéro I/O) :
  - `effectiveCampaignStatus({ date_start, date_end, status_override }, today): CampaignStatus`
    (`'a_venir' | 'en_cours' | 'en_pause' | 'terminee' | 'archivee'`).
  - `campaignNeedsAttention({ status, last_data_date }, today): boolean`.
  - Constantes : `FRESHNESS_DAYS`, libellés/couleurs des états (tokens `var(--…)`, jamais de hex en dur).
- **RPC `get_dsp_campaign_stats`** : ajouter `last_data_date date` (= `max(date)`) à la sortie
  (petit ajout à l'agrégation existante). Le statut + badge + filtre s'appliquent aux **deux**
  surfaces qui listent des campagnes (`/admin/campaigns` et la vue digitale `/map/analyse/digital`) ;
  `get_digital_campaigns_list` reçoit le même ajout `last_data_date` pour porter l'attention.
- **Routes liste** (`/api/admin/campaigns`, `/api/digital/campaigns`) : exposent
  `date_start`, `date_end`, `status_override`, `last_data_date` bruts. Le statut effectif
  et l'attention se calculent côté TS via `lib/campaigns/status.ts` (source unique,
  pas de logique dupliquée en SQL).
- **Route override** : réutilise le `PATCH /api/admin/campaigns/[id]` existant ; accepte
  `{ status_override: 'paused'|'ended'|'archived'|null }`, écrit `status_override_at/by`
  (scope org déjà en place). Un `null` efface l'override.
- **UI liste / CampaignCard** : badge couleur + point d'attention ; filtre/onglets
  *Toutes · En cours · À venir · En pause · Terminées* (Archivées masquées par défaut) ;
  tri qui remonte les « En cours ».
- **UI header campagne** : contrôles Mettre en pause / Reprendre / Clôturer / Archiver.

## Flux de données

- **Lecture** : liste → fetch bruts (dates, override, last_data_date) → `effectiveCampaignStatus`
  + `campaignNeedsAttention` → badge / filtre / tri.
- **Écriture** : action utilisateur → `PATCH` override → `status_override_at/by` mis à jour →
  la liste recalcule le statut effectif à la prochaine lecture (aucun état dérivé à propager).

## Gestion d'erreur

- `status_override` invalide (hors enum) → rejet Zod 400 sur le PATCH.
- `date_start`/`date_end` nuls ou incohérents (`start > end`) : le calcul tombe sur une
  règle sûre — si `date_start` nul → jamais « à venir » ; si `date_end` nul → jamais
  « terminée » par calendrier (seul l'override `ended` clôt). À couvrir par les tests.
- Campagne d'une autre org sur le PATCH → 403 (garde déjà en place).

## Plan de test

- **Unitaire `lib/campaigns/status.ts`** (cœur) : `effectiveCampaignStatus` sur toutes
  les branches — à venir / en cours / terminée × override présent/absent, clôture
  anticipée (`ended` avant `date_end`), dates nulles/incohérentes ; `campaignNeedsAttention`
  (en cours + données fraîches → false ; en cours + données périmées / absentes → true ;
  autre statut → false quel que soit `last_data_date`).
- **Route PATCH** : override valide persiste + horodate ; override invalide → 400 ;
  cross-org → 403 ; `null` efface.
- **RPC** : `get_dsp_campaign_stats` renvoie bien `last_data_date` = max(date).

## Migration

- `sql/093_campaign_status_override.sql` : `ALTER TABLE dsp_campaigns ADD COLUMN status_override…`
  + CHECK ; mise à jour de `get_dsp_campaign_stats` (ajout `last_data_date`). Appliquée via
  MCP Supabase, définition versionnée dans le repo (règle projet anti-dérive DB↔repo).
- Rétrocompat : les colonnes sont NULL par défaut → toutes les campagnes existantes ont
  d'emblée un statut effectif calculé depuis leurs dates, sans backfill.
