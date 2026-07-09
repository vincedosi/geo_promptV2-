# Design — Action « Ajuster » (pilotage sans re-wizard)

> Date : 2026-07-09 · Statut : validé (approche A)
> Cadrage validé avec Vincent : tout doit être ré-ajustable sur une campagne
> lancée, via un panneau unique (le wizard reste pour créer/repenser) ; le
> re-push bidding part **via API** (connecteur réel DV360 + mode simulé tant que
> les droits Google sont bloqués) ; tout est historisé et visible/proposable par
> l'agent IA (qui ne s'exécute pas seul en V1). Voir [[roadmap-campagne]] #2,
> [[project_boucle_dsp_adserver]].

## 1. Objectif & périmètre

Sur une campagne avec stratégie **active**, permettre d'ajuster **budget, CPM,
dates, mode d'exécution, intensité, cible (zones), canaux** dans un panneau
compact pré-rempli, en un seul geste : enregistrer → journaliser → re-snapshotter
le plan → **pousser le bidding via API** vers les canaux de la campagne.

Hors périmètre V1 : exécution autonome par l'agent (il voit et propose
seulement), connecteurs réels autres que DV360 (TTD/Meta → `skipped`, TikTok →
`simulated`), retry asynchrone des pushes (Inngest non configuré en prod),
réconciliation ad server.

## 2. UX — le panneau Ajuster

**Point d'entrée** : bouton **« Ajuster »** dans le header de
`components/campaign/CampaignOverview.tsx` (à côté de Pause/Clôturer), rendu
seulement si une stratégie `active` existe. `CampaignOverview` reçoit
`strategyId`/`strategyStatus` en props : le cockpit les a déjà ; l'Aperçu de
l'overlay MAGELIAN (`CampaignSuivi`/overlay) fait le même `fetchStrategy`
best-effort que `CampaignCockpit.tsx:52-63`.

**Modale `AdjustPanel`** (`components/campaign/AdjustPanel.tsx`), sections
repliables **pré-remplies avec les valeurs actuelles** (stratégie +
`geo_strategy`) :

1. **Budget & période** (ouverte par défaut) — budget total, CPM prévisionnel,
   dates de vague.
2. **Mode d'exécution** — observer / suggérer / automatique.
3. **Intensité du ciblage** — doux / marqué / fort (courbes `INTENSITY_CURVES`).
4. **Cible** — panier de cibles actuel (retirer/ajouter, contrôles compacts
   repris de StepCible).
5. **Canaux** — mêmes données que StepCanaux (catalogue + disponibilité via
   `GET /channels`) **+ champ « liens DSP »** (§5, ex. IDs DV360).

**Principe : diff, pas re-saisie.** Le pied de modale affiche le résumé du diff
(« Budget 45 000 € → 60 000 € »), un champ **« Raison de l'ajustement »**
(obligatoire, min 3 caractères) et le bouton **« Appliquer & pousser »**
(désactivé si diff vide). Après clic : progression par étape (enregistrement →
journal → push par canal) puis récap avec statut de push par canal
(`poussé` / `simulé` / `échec` / `ignoré` + détail). Toast, fermeture,
rafraîchissement de l'Aperçu.

**Garde** : campagne en pause/clôturée → panneau consultable mais application
bloquée (« Reprends la campagne pour ajuster »). Design system : tokens
`var(--…)` uniquement, sentence case, flat.

**Pré-remplissage externe** : `AdjustPanel` accepte `initialChanges` +
`initialReason` (props) — utilisé par les propositions de l'agent (§7).

## 3. Route `POST /api/bidding/strategies/[id]/adjust`

Protégée comme les routes bidding existantes (auth + scope org),
`export const dynamic = 'force-dynamic'`, validation Zod :

```ts
{
  reason: string,               // min 3
  changes: {                    // uniquement les champs modifiés
    total_budget?: number,      // > 0
    forecast_cpm?: number,      // > 0
    start_date?: string, end_date?: string,   // cohérence start <= end
    execution_mode?: 'monitor_only' | 'suggest' | 'auto',
    intensity?: IntensityKey,   // clés existantes d'INTENSITY_CURVES (wizard)
    cibles?: Cible[],           // panier — même forme que ProgDraft.cibles
    channels?: CampaignChannels // { dsps[], socials[], ad_server }
  },
  links?: DspLinks              // § 5 — IDs d'entités DSP, optionnel
}
```

Orchestration serveur, séquentielle (Nano : jamais >3 requêtes parallèles) :

1. **Gardes** : stratégie existe et `status='active'` ; campagne ni en pause ni
   clôturée (`effectiveCampaignStatus`) ; `changes` non vide.
2. **Zone si `cibles` change** : `resolveFinalZone` est **extraite verbatim** de
   `StepLancement.tsx:27-58` vers `lib/campaigns/resolve-zone.ts` (seul refactor
   de l'existant ; StepLancement l'importe désormais). Composite via les routes
   custom-geo existantes.
3. **PATCH partiel** de `bidding_strategies` en réutilisant la mécanique de la
   route PATCH existante — chaque champ audité via `log_strategy_change` avec
   `change_type='adjusted'` et la `reason`. Intensité/cible → la courbe/zone
   change → `apply_zone_weights_to_strategy` se redéclenche (comportement
   existant, assumé).
4. **Canaux** : si fournis, même validation/écriture que `PUT /channels`
   (logique partagée `lib/campaigns/channels.ts`, zéro duplication). `links`
   mergés dans `geo_strategy.channels.links` (merge non destructif).
5. **Snapshot v+1** de `campaign_plan_snapshot` : le pacing plan-vs-réel compare
   désormais au plan ajusté (la vague continue, la référence change à partir de
   maintenant).
6. **Push par canal** (§5) — best-effort : un échec de push n'annule PAS
   l'ajustement.
7. **Journal consolidé** (§6) puis réponse :
   `{ changes: [{field, old, new}], snapshot_version, pushes: [{channel, status, detail}] }`.

La route PATCH existante et le wizard « Reprogrammer » restent intacts —
`adjust` est une orchestration au-dessus des mêmes briques.

## 4. Ce que « pousser le bidding » veut dire

Pour chaque canal de `channels.dsps` + `channels.socials` (l'ad server = mesure,
jamais de push), le connecteur produit/transmet :

- **Script custom bidding pondéré** régénéré via
  `buildWeightedZoneBiddingScript` (existant) avec les poids du snapshot v+1.
- **Delta budget** quand il a changé. Le CPM prévisionnel ne se pousse pas :
  c'est un paramètre de plan interne (pacing), pas un réglage DSP.

## 5. Connecteurs (`lib/dsp/push/`)

```ts
interface BiddingPusher {
  channel: string;  // code dsp_channel_registry
  push(ctx: BiddingPushContext): Promise<BiddingPushResult>;
}
// ctx : campagne, stratégie ajustée, items+poids (snapshot v+1),
//       connexion dsp_connections de l'org (ou null), is_demo, links
// résultat : { channel, status: 'pushed'|'simulated'|'failed'|'skipped',
//              detail, payload_summary }
```

Résolution par la route :

| Situation | Statut |
|---|---|
| `is_demo` OU pas de connexion `connected` pour le provider | `simulated` — le connecteur **construit le vrai payload** sans appeler d'API |
| Connexion réelle + connecteur DV360 | `pushed` / `failed` |
| Connexion réelle, connecteur non implémenté (ttd, meta, adform…) | `skipped`, détail explicite |
| Connexion réelle DV360 mais `links.dv360` absent | `skipped` (« IDs DV360 non renseignés ») |

**Connecteur DV360 (réel)** — deux actions best-effort, dans l'ordre :
1. upload du script custom bidding (`customBiddingAlgorithms.scripts`) si
   `links.dv360.algorithm_id` renseigné ;
2. patch du budget de l'insertion order (`insertionOrders.patch`) si
   `links.dv360.insertion_order_id` renseigné et budget changé.
Réutilise le client/l'auth DV360 existants (routes targeting/zones push).

**Chaînon campagne↔DSP** — nouvelle sous-clé `geo_strategy.channels.links` :

```json
{ "links": { "dv360": { "advertiser_id": "…", "insertion_order_id": "…",
             "algorithm_id": "…" } } }
```

Saisie dans la section Canaux du panneau. Jamais bloquant si absent.

**TikTok** : connecteur simulé (app dev en stand-by), payload = format
`tiktok_geo` existant.

**Traçabilité** : chaque tentative → 1 ligne `dsp_api_logs` (table existante,
RLS org) : action `bidding_push`, statut, latence, erreur, `payload_summary`.

## 6. Historisation & journal

Sans nouvelle table :

1. **Audit fin** : lignes `strategy_changes` par champ (`log_strategy_change`,
   `change_type='adjusted'`, reason).
2. **Événement consolidé** : 1 ligne `bidding_agent_actions` avec
   `trigger_source='manual_adjust'`, `intent` = reason, `action_taken` = JSON
   `{changes, pushes, snapshot_version}`. Cette table est **déjà** dans le merge
   du journal unifié (`GET .../journal`) et dans le contexte du chat campagne →
   l'ajustement est visible par l'agent **sans toucher** ni à la route journal
   ni au chat. Affichage : « Ajustement manuel — budget 45k → 60k · DV360 poussé
   ✓ · TikTok simulé ».

## 7. Agent IA : voir & proposer (pas exécuter)

- **Voir** : automatique via §6 (« Résume les décisions de pilotage » raconte
  les ajustements).
- **Proposer** : nouvel outil `proposer_ajustement` du chat campagne (pattern
  1 fichier = 1 outil dans `lib/chat/tools/`, données structurées
  `{changes, reason}`). L'UI du chat rend la proposition en **carte avec bouton
  « Ouvrir dans Ajuster »** → ouvre `AdjustPanel` pré-rempli
  (`initialChanges`/`initialReason`). L'humain relit, modifie, applique.
  L'agent ne pousse jamais seul (extension future : bornes
  `autonomy_max_budget_delta_pct` déjà en base).

## 8. Erreurs & garde-fous

- Ajustement en base OK + push KO = **succès partiel assumé** : statut `failed`
  journalisé, bandeau dans le récap, re-application possible du même diff.
- Zod strict ; budget/CPM > 0 ; `start_date <= end_date` ; garde
  `status='active'` ; raison obligatoire.
- Nano : orchestration séquentielle, aucune nouvelle requête lourde (RPC
  existantes), pas de `Promise.all` > 3.

## 9. Tests (Vitest)

- Diff builder du panneau : ne soumettre que le modifié ; diff vide → bouton
  désactivé.
- Validation Zod du payload adjust (bornes, dates, raison).
- Résolution des connecteurs : démo → `simulated` ; pas de connexion →
  `simulated` ; connecteur absent → `skipped` ; links absents → `skipped`.
- Génération du payload DV360 simulé (script pondéré + delta budget).

## 10. Ce qui ne change pas

`PATCH /api/bidding/strategies/[id]` (mécanique interne réutilisée, contrat
inchangé), wizard « Reprogrammer », `/api/isochrone-battle` (protégé), moteur
pacing/rebid, mode autonome de l'agent, `middleware.ts`.
