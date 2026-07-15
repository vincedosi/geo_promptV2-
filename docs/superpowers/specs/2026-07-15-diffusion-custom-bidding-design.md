# Diffusion zones/national + génération custom bidding — Design

> Validé par Vincent le 15/07/2026. Contexte : wizard campagne 5 étapes
> (Cible → Canaux & budgets → Pression → Stratégie → Lancement).

## Problème

1. Une campagne doit être **soit strictement sur ses zones**, **soit nationale
   avec surpression** sur les zones. Aujourd'hui le wizard envoie
   `out_zone_weights: {}` en dur → `computeMultiplier` retombe sur ×1.0 hors
   zone : toute campagne zonée est de facto « nationale avec surpression »,
   sans que ce soit un choix. Incohérence : avec pression ×2,2, le bas de la
   cible in-zone descend à ×0,45 alors que le hors-zone reste à ×1,0.
2. L'étape 5 (Lancement) doit proposer la **génération des fichiers custom
   bidding par plateforme** sélectionnée à l'étape Canaux.

## Décisions

- Choix de diffusion exposé à l'**étape Pression** (visible seulement si des
  zones sont sélectionnées). Défaut : `zones_only`.
- Fidélité **à la courbe de pression** : score par CP interpolé sur la
  variable INSEE (abstention), regroupé en paliers.
- Génération **après armement** (approche A) : source de vérité = la stratégie
  armée. Fallback plateformes sans format dédié : **CSV `postal_code;score`**.

## 1. Modèle de diffusion

- `ProgDraft.diffusion: 'zones_only' | 'national_boost'` (défaut
  `zones_only`), ignoré si panier de cibles vide (national pur, inchangé).
- Persistance au Lancement :
  - `zones_only` → `out_zone_weights: { mode: 'exclusion' }` (×0 hors zone)
  - `national_boost` → `out_zone_weights: { mode: 'uniform', value: 1.0 }`
- Aucune migration SQL : `computeMultiplier` supporte déjà ces modes.
- Correction de cohérence : en `national_boost`, la courbe in-zone est bornée
  à ≥1 (×1 → ×p). En `zones_only`, courbe inchangée (1/p → p).
  → `pressureCurve(m, floor?)` gagne un paramètre optionnel.

## 2. UI — Étape Pression

Bloc « Et en dehors de la cible ? » sous le slider, deux options segmentées :
- **Zones strictes** — diffusion coupée hors zones (×0)
- **National avec surpression** — France à ×1, zones boostées jusqu'à ×p

Le récap de l'étape 5 affiche le mode dans la ligne Cible.

## 3. API — `GET /api/bidding/strategies/[id]/export?channel=<code>`

`requireAuth` + scope org (même contrôle que les autres routes stratégie),
`force-dynamic`.

1. Charge la stratégie : `zone_id`, `scope_type`, `in_zone_weights`
   (courbe + variable_code), `out_zone_weights`.
2. Récupère CP + valeur INSEE par CP (réutilise la mécanique de
   `preview-weights` — requêtes bornées, Nano-safe).
3. Score par CP = `interpolateOnCurve(curve, valeur)` ; regroupement en
   5 paliers (quantiles) ; score hors-zone = 0 (exclusion) ou valeur uniform.
4. Rendu selon la catégorie/code du canal (résolu via `dsp_channel_registry`,
   rien de hardcodé) :
   - `dv360` → script Python custom bidding (paliers + palier hors-zone)
   - `tiktok` → fiche ad groups (pattern export tiktok_geo existant)
   - autres → CSV `postal_code;score`
5. `scope_type='national'` sans zone : paliers sur toute la France par
   quantiles de la variable (mécanique fullFranceMode de preview-weights).

## 4. UI — Étape Lancement

Bloc « Fichiers custom bidding » sous le récap : une ligne par canal
sélectionné + bouton téléchargement. Désactivé avant armement (hint
« disponible après l'armement »). Après « Armer » réussi : état de succès
avec boutons actifs + CTA « Aller au pilotage » (= `onCompleted` actuel).

## 5. Tests

- `pressureCurve` avec floor ; mapping diffusion → `out_zone_weights` ;
  binning en paliers ; rendu des 3 formats.

## Hors périmètre

AdjustPanel (affichage diffusion = follow-up), push API DV360,
`/api/custom-geo/[id]/export` (inchangé, zones hors campagne),
plan média zones custom.
