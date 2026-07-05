# Brique C — Bilan de campagne (report) — Design

> Sous-projet du module de pilotage (voir memory `project_demo_bout_en_bout`).
> Suit le moteur A (boucle, mergé `8558336`) et l'agent B (orchestrateur, mergé `d2888b8`).
> Date : 2026-07-05 · Branche cible : `feat/bilan-report-C`

## Goal

Produire le **bilan de fin de campagne** : un dashboard qui synthétise une boucle de
pilotage déjà exécutée (les snapshots `campaign_plan_snapshot` v1→vN) en quatre blocs —
courbe de conformité, zone-par-zone avant/après, budget planifié vs dépensé, et KPI +
synthèse narrative IA optionnelle. Feature produit (livrable de fin de boucle Magelian),
bâtie sur les **vraies** données du moteur A, pas simulée.

## Décisions de cadrage (validées avec Vincent, 2026-07-05)

| Décision | Choix retenu |
|----------|--------------|
| Livrable v1 | **Dashboard seul** dans `/demo/pilote` (onglet « Bilan »). PDF reporté à plus tard (hors scope). |
| Source de données | **Agrégateur TS pur** qui rejoue `get_campaign_pacing` sur v1…vN (zéro nouveau SQL PostGIS). |
| Périmètre | Scopé à la campagne démo (`DEMO_CAMPAIGN_ID`), mais couche d'agrégation **générique** (réutilisable pour un futur `/api/digital/[id]/report`). |
| Budget « dépensé » | **Cumulé sur tout le vol** (total plan vs somme des dépenses v1→vN) en chiffre principal, + état final (dernière version) en ligne secondaire. |
| Synthèse narrative | KPI déterministes **toujours** affichés + bouton **« Synthèse IA »** (Gemini) optionnel. |

## Global Constraints

- **Supabase Nano I/O** : l'agrégateur boucle `get_campaign_pacing` **séquentiellement** (jamais en parallèle). Nombre d'appels = nombre de versions (3 en démo, borné). Une seule requête de métadonnées snapshot en plus. Aucun `Promise.all` > 3.
- **Design System MAGELIAN** : couleurs via `var(--token)` uniquement (jamais de hex en dur), pas de violet, accent teal `var(--brand-teal)`, statut via `PACING_STATUS_META[status].colorVar`. Fonts `Inter` (UI) + `JetBrains Mono` (données). Sentence case. Flat total.
- **TypeScript strict**, imports absolus `@/`, types dans le module.
- **Routes API** : `export const dynamic = 'force-dynamic'`, `requireAdmin` + `adminUnauthorized`, `createAdminClient()` depuis `@/lib/auth`, `assertDemo` (défense en profondeur — aucune `campaign_id` acceptée du body, tout scopé à `DEMO_CAMPAIGN_ID`), réponses `Cache-Control: no-store`.
- **Pas de PDF** dans ce périmètre. Pas de nouvelle table. Pas de modification des fichiers protégés (`middleware.ts` déjà couvre `/demo/*`).
- **PilotChatPanel non modifié** : l'onglet Bilan est ajouté à côté, pas dans le chat.

## Architecture

```
lib/report/
  types.ts        → CampaignReport et ses sous-types (pur, aucune dépendance runtime)
  aggregate.ts    → buildCampaignReport(supabase, campaignId, metric): Promise<CampaignReport | null>

app/api/demo/report/
  route.ts            → GET  · requireAdmin · assertDemo · buildCampaignReport(DEMO_CAMPAIGN_ID)
  narrative/route.ts  → POST · requireAdmin · assertDemo · Gemini résume le report → { narrative }

app/demo/pilote/
  page.tsx                       → rend <PiloteWorkspace/> (au lieu de <PilotChatPanel/> direct)
  _components/PiloteWorkspace.tsx → 'use client' · onglets « Pilotage » | « Bilan » · état local
  _components/BilanPanel.tsx      → 'use client' · fetch /api/demo/report · rend les 4 blocs
  _components/ConvergenceChart.tsx→ 'use client' · Recharts LineChart (mean_delta par version)
  _components/ZoneBeforeAfterTable.tsx → 'use client' · table cible/réel v1/réel final/statut
  _components/BudgetCard.tsx      → 'use client' · budget plan vs dépensé + spillover
  _components/KpiStrip.tsx        → 'use client' · KPI + bouton « Synthèse IA »
```

**PilotChatPanel** reste inchangé ; `PiloteWorkspace` l'englobe avec `BilanPanel` derrière un
sélecteur d'onglet. Le PDF (`CampaignReportPDF`) est explicitement hors scope.

## Modèle de données — `lib/report/types.ts`

```ts
import type { PacingStatus } from '@/lib/pacing/compute';

export interface ReportHeader {
  campaign_id: string;
  campaign_name: string;
  zone_name: string;        // ex. CIRFA BRETAGNE
  dsp: string;              // ex. dv360
  cible: string;            // ex. total
  period_start: string;     // period_start de la v1 (ISO date)
  period_end: string;       // period_end de la dernière version (ISO date)
  version_count: number;
}

export interface ConvergencePoint {
  version: number;
  mean_delta: number;       // moyenne |delta_pts| de la version, 2 décimales
  converged: boolean;       // mean_delta < CONVERGENCE_TOLERANCE (2)
}

export interface ZoneBeforeAfter {
  item_id: string;
  item_name: string;
  expected_share: number;   // cible fixe [0,1]
  actual_share_first: number; // réel en v1 [0,1]
  actual_share_last: number;  // réel en dernière version [0,1]
  delta_first: number;      // (actual_first - expected) * 100, 1 décimale
  delta_last: number;       // (actual_last  - expected) * 100, 1 décimale
  status_first: PacingStatus;
  status_last: PacingStatus;
}

export interface BudgetSummary {
  planned_total: number;    // Σ budget par version (chaque version = une période)
  spent_total: number;      // Σ dépense livrée sur toutes les versions
  variance_pct: number;     // (spent_total - planned_total) / planned_total * 100, 1 déc.
  planned_last: number;     // budget de la dernière version (une période)
  spent_last: number;       // dépense de la dernière version
  variance_last_pct: number;
  in_plan_imp_total: number;   // Σ impressions dans le plan
  total_imp_total: number;     // Σ impressions totales livrées
  spillover_imp_total: number; // Σ (total - in_plan) = hors-plan
  spillover_pct: number;       // spillover / total * 100, 1 déc. (0 si total=0)
}

export interface ReportKpis {
  corrections: number;         // version_count - 1
  delta_first: number;         // mean_delta de la v1
  delta_last: number;          // mean_delta de la dernière version
  improvement_pts: number;     // delta_first - delta_last (peut être négatif)
  converged: boolean;          // convergence de la dernière version
  conforming_items_last: number; // items status_last === 'conforme'
  total_items: number;
}

export interface CampaignReport {
  header: ReportHeader;
  convergence: ConvergencePoint[];
  zones: ZoneBeforeAfter[];
  budget: BudgetSummary;
  kpis: ReportKpis;
  narrative?: string | null;   // rempli par la route narrative, pas par l'agrégateur
}
```

## Couche d'agrégation — `lib/report/aggregate.ts`

`buildCampaignReport(supabase, campaignId, metric = 'impressions'): Promise<CampaignReport | null>`

Étapes :

1. **Métadonnées snapshot** (1 requête) : `SELECT version, budget, cpm, cible, dsp, zone_name, period_start, period_end` sur `campaign_plan_snapshot WHERE campaign_id = campaignId`, dédupliqué par version (une ligne par version suffit — les colonnes d'entête sont dupliquées sur chaque ligne). Trié `version ASC`.
   - Si aucune ligne → `return null` (le report affichera « lance d'abord le pilotage »).
   - `version_count = versions.length` ; `maxVersion = dernière`.
2. **Pacing par version** (boucle **séquentielle**, un appel par version) :
   `supabase.rpc('get_campaign_pacing', { p_campaign_id: campaignId, p_metric_field: metric, p_version: v })`.
   Chaque retour : `{ version, items[], in_plan_imp, total_imp, spillover }`, où chaque item porte les champs bruts `{ zone_id, zone_name, item_id, item_name, item_weight, expected_share, actual_imp, actual_spend, cp_count }`.
   On applique `computePacing(items)` de `@/lib/pacing/compute` (réutilise la logique testée, ne pas la ré-implémenter) pour dériver `actual_share`/`delta_pts`/`status` par item. C'est l'appel DIRECT à la RPC (pas via `readDemoPacing`) qui préserve `actual_spend`/`in_plan_imp`/`total_imp`/`spillover` que le pipeline démo jette.
3. **convergence[]** : pour chaque version, `mean_delta = round(moyenne(|delta_pts|), 2)`, `converged = mean_delta < CONVERGENCE_TOLERANCE`.
4. **zones[]** : pour chaque item (clé `item_id`), croiser sa ligne dans la **v1** (premier pacing) et dans la **dernière** version : `expected_share` (identique, cible fixe), `actual_share_first/last`, `delta_first/last`, `status_first/last`.
5. **budget** :
   - `planned_total = Σ versions.budget` ; `planned_last = budget de maxVersion`.
   - **Dépense d'une version** = `Σ items.actual_spend`. Si la RPC renvoie des `actual_spend` nuls (le simulateur ne suit que les impressions), fallback dérivé : `Σ items.actual_imp × cpm_version / 1000`. Le fallback est déterministe et documenté dans le code.
   - `spent_total = Σ dépenses par version` ; `spent_last = dépense de maxVersion`.
   - `variance_pct`, `variance_last_pct` calculés (garde `planned == 0 → 0`).
   - `in_plan_imp_total / total_imp_total / spillover_imp_total` = sommes des champs RPC sur toutes les versions ; `spillover_pct = spillover/total*100` (0 si total=0).
6. **kpis** : dérivés de `convergence` (première/dernière) et des `zones` (comptage `status_last === 'conforme'`).
7. `narrative` non renseigné ici (`undefined`).

**Pureté & test** : `aggregate.ts` ne dépend que du client Supabase injecté et de `@/lib/pacing/compute` + `@/lib/demo/constants` (`CONVERGENCE_TOLERANCE`). Testable en TDD avec un faux client (rpc + from().select() stubés renvoyant des versions synthétiques).

## Routes API

### `GET /api/demo/report` — `app/api/demo/report/route.ts`

```
export const dynamic = 'force-dynamic';
GET(request):
  profile = requireAdmin(request); if (!profile) return adminUnauthorized();
  supabase = createAdminClient();
  await assertDemo(supabase, DEMO_CAMPAIGN_ID);   // fail-closed
  report = await buildCampaignReport(supabase, DEMO_CAMPAIGN_ID);
  if (!report) return NextResponse.json({ report: null }, { headers: no-store });
  return NextResponse.json({ report }, { headers: { 'Cache-Control': 'no-store' } });
  // catch → { error } 400
```

Aucune `campaign_id` lue du body/query : la constante réservée est la seule cible (isolation
identique aux autres routes `/api/demo/*`).

### `POST /api/demo/report/narrative` — `app/api/demo/report/narrative/route.ts`

```
export const dynamic = 'force-dynamic';
POST(request):
  profile = requireAdmin(request); if (!profile) return adminUnauthorized();
  supabase = createAdminClient();
  await assertDemo(supabase, DEMO_CAMPAIGN_ID);
  report = await buildCampaignReport(supabase, DEMO_CAMPAIGN_ID);
  if (!report) return NextResponse.json({ error: 'no_snapshot' }, { status: 400 });
  const { text } = await generateText({
    model: createModel('gemini'),
    system: <analyste média : résume ce bilan en 3-4 phrases, chiffres réels, factuel, sentence case, français>,
    prompt: JSON.stringify({ convergence, zones, budget, kpis }),
    temperature: 0.2,
    providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
  });
  return NextResponse.json({ narrative: text.trim() }, { headers: no-store });
  // catch → { error } 400
```

`createModel` depuis `@/lib/chat/providers` ; `generateText` de `ai`. La narration est
générée **à la demande** (pas persistée) — cohérent avec l'esprit démo idempotent.

## Composants dashboard

### `PiloteWorkspace.tsx`
`'use client'`. État `tab: 'pilotage' | 'bilan'` (défaut `'pilotage'`). Barre d'onglets en
haut (pattern DESIGN_SYSTEM tabs : actif `color var(--text-primary)` + `border-bottom 2px
var(--brand-teal)`, inactif `var(--text-tertiary)`, sentence case). Rend `<PilotChatPanel/>`
ou `<BilanPanel/>` selon l'onglet. `BilanPanel` re-fetch à chaque activation de l'onglet
(les données changent après un run de pilotage).

### `BilanPanel.tsx`
`'use client'`. Au montage (et à l'activation) : `GET /api/demo/report` avec le Bearer lu
depuis le cookie `sb-<ref>-auth-token`. La logique d'extraction du token (identique à celle
inline de PilotChatPanel) est mise dans un nouvel util `app/demo/pilote/_lib/authHeader.ts`
que BilanPanel importe. **PilotChatPanel n'est pas modifié** : sa copie inline reste en place
(la déduplication éventuelle de PilotChatPanel vers cet util est différée, hors scope).
- `report === null` → état vide : « Lance d'abord le pilotage dans l'onglet Pilotage. »
- Sinon rend, dans l'ordre : `KpiStrip`, `ConvergenceChart`, `ZoneBeforeAfterTable`, `BudgetCard`.
- Section headers au format bandeau (`background var(--elevated)`, dot teal, `Inter 500 12px`).

### `ConvergenceChart.tsx`
`'use client'`. Recharts `LineChart` : X = `version` (v1, v2, v3), Y = `mean_delta`.
`ReferenceLine y={CONVERGENCE_TOLERANCE}` (seuil de convergence, label « seuil »).
Ligne accent `var(--brand-teal)`. Axes/grid via tokens (`var(--text-tertiary)`,
`var(--border-subtle)`). `ResponsiveContainer`.

### `ZoneBeforeAfterTable.tsx`
`'use client'`. Colonnes : item · cible % · réel v1 % · réel final % · Δ v1 (signé) · Δ final
(signé) · statut avant → statut après. Statut coloré via `PACING_STATUS_META[status].colorVar`.
`JetBrains Mono` sur les chiffres. Trié par `delta_last` décroissant.

### `BudgetCard.tsx`
`'use client'`. Chiffre principal : `planned_total` vs `spent_total` + `variance_pct`
(couleur : conforme `var(--brand-teal)`, dépassement `var(--warning)`). Ligne secondaire :
état final (`planned_last`/`spent_last`). Bloc spillover : `in_plan` vs `spillover` (%
hors-plan). Format monétaire `fr-FR`.

### `KpiStrip.tsx`
`'use client'`. Cartes KPI : nb corrections · écart moyen v1 → final · gain (`improvement_pts`)
· items conformes (`conforming_items_last`/`total_items`) · badge « convergé » si `kpis.converged`.
Bouton **« Synthèse IA »** → `POST /api/demo/report/narrative` → affiche `narrative` dans un
encart (état `loading` pendant l'appel, `error` géré). Sentence case, CTA teal.

## Data flow

```
Onglet Bilan activé
  → GET /api/demo/report → { report | null }
     → null    : état vide
     → report  : KpiStrip + ConvergenceChart + ZoneBeforeAfterTable + BudgetCard
  → clic « Synthèse IA »
     → POST /api/demo/report/narrative → { narrative } → encart texte
```

## Gestion d'erreurs

- Aucun snapshot (`buildCampaignReport` → null) : route renvoie `{ report: null }`, UI affiche l'état vide.
- `assertDemo` échoue (collision id réel) : route 400 `{ error }` (fail-closed, comme les autres routes démo).
- Narration : `no_snapshot` si report null ; erreur LLM → `{ error }` 400, l'UI garde les KPI déterministes (la narration est un bonus).
- `requireAdmin` absent → 403.

## Tests

- **`lib/report/aggregate.ts`** (TDD, cœur) : faux client Supabase renvoyant 3 versions synthétiques (v1 déséquilibrée, v3 convergée) →
  - `convergence` = 3 points, `mean_delta` décroissant, dernier `converged === true` ;
  - `zones` : `expected_share` identique v1/v3, `delta_first` > `delta_last` en valeur absolue, `status_first`/`status_last` corrects ;
  - `budget` : `planned_total = budget × 3`, `spent_total` = somme, `variance_pct` cohérent, fallback spend dérivé testé (cas `actual_spend = 0`) ;
  - `kpis.corrections === 2`, `improvement_pts` = delta_first − delta_last, comptage conformes ;
  - cas **aucun snapshot** → `null`.
- **Routes** : non couvertes par unit (dépendent d'auth réelle + Gemini) → vérif navigateur.
- **Dashboard** : vérif navigateur (Playwright authentifié) — lancer un pilotage via l'agent, ouvrir l'onglet Bilan, confirmer les 4 blocs cohérents avec les PacingCards, tester « Synthèse IA ».

## Découpage en tâches (pour writing-plans)

1. `lib/report/types.ts` + `lib/report/aggregate.ts` (TDD, cœur pur).
2. `GET /api/demo/report`.
3. `POST /api/demo/report/narrative` (Gemini).
4. `app/demo/pilote/_lib/authHeader.ts` (extraction util cookie) + `BilanPanel` + sous-composants (ConvergenceChart, ZoneBeforeAfterTable, BudgetCard, KpiStrip).
5. `PiloteWorkspace` + intégration `page.tsx` (onglets), sans toucher `PilotChatPanel`.

## Hors scope (explicite)

- Export PDF (`@react-pdf`) — reporté à une itération ultérieure.
- Report sur campagnes réelles / route générique `/api/digital/[id]/report` — la couche
  `aggregate.ts` est conçue générique pour le rendre trivial, mais la route n'est pas livrée ici.
- Persistance/matérialisation du report (table `campaign_reports`).
