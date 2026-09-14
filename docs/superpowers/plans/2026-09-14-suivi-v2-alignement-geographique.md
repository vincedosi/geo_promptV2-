# Suivi V2 — Score d'alignement géographique — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer intégralement l'onglet Suivi de l'overlay MAGELIAN par un cockpit organisé autour d'un indicateur propriétaire — le score d'alignement géographique — et faire de la carte et de l'overlay deux vues d'une même session de travail.

**Architecture:** Le score et toutes les agrégations sont calculés **en base** (RPC PostGIS), toujours à la maille code postal, quelle que soit la maille affichée. Un store React unique (`useCampagneSession`) devient la seule source de vérité pour campagne / vue / onglet / maille / fil d'Ariane / unité sélectionnée, synchronisé avec l'URL. L'overlay cesse d'être démonté à la bascule : il est masqué, ses enfants survivent.

**Tech Stack:** Next.js 15 App Router · TypeScript strict · Supabase PostgreSQL 17.6 + PostGIS · MapLibre GL JS 5.x · Recharts · Tailwind + tokens MAGELIAN · Vitest

**Spec:** `docs/DOC INTERFACE/PROMPT_OVERLAY_SUIVI_V2.md` · Maquette de référence : `docs/DOC INTERFACE/magelian-suivi.html`

---

## Global Constraints

- **Le score est TOUJOURS calculé à la maille code postal**, quelle que soit la maille affichée. Une mention sous le score le dit à l'utilisateur. Un score qui monte quand on dézoome est un défaut bloquant.
- **Les deux thèmes, clair et sombre.** Zéro hex en dur dans le JSX/CSS : uniquement `var(--token)` de `app/globals.css`. Seule exception autorisée : les propriétés `paint` de MapLibre, qui ne résolvent pas `var()` — elles lisent une table `Record<'dark'|'light', …>` et se réabonnent au thème (patron `app/copilote/_hooks/useMapInit.ts:1091-1102`).
- **Rien en dur** : campagnes, périodes, mailles, indicateurs, seuils, pondérations et variable du plan viennent tous de la base. Aucun enum figé, aucune liste de départements ou de régions dans le front.
- **Paramètres du score en base**, au niveau campagne : `tolerance_pct` (défaut 10) et `overpressure_weight` (défaut 1.0). Le score doit rester recalculable à l'identique depuis les données brutes.
- **Budget I/O Supabase** : pas de scan bbox France entière, max 3 appels Supabase parallèles, agrégation côté base — jamais de remontée de lignes CP au client pour agréger en JS.
- **Volumétrie maille CP** : ~6 000 CP en France entière. Ne jamais tout charger pour dessiner une vignette. Tableau et graphique bornés aux N unités les plus déréglées ; cartes servies par agrégation pré-calculée.
- **Jointure départementale : `ref_codes_postaux.code_dept → ref_departements`, JAMAIS la colonne `campaign_cp_rollup.dept`.** Cette colonne vaut `LEFT(postal_code, 2)` (`sql/113_campaign_actors.sql:71`) : tous les DROM (97x) s'effondrent sur `97`, et elle ne porte aucun nom de département.
- **Sommer sur les acteurs avant tout calcul.** La PK de `campaign_cp_rollup` est `(campaign_id, postal_code, actor)` : un CP y apparaît jusqu'à 5 fois (mesuré : 10 205 lignes pour 2 041 CP). Un `count`/`sum` naïf compte cinq fois.
- Fichiers protégés, non modifiés : `app/api/isochrone-battle/route.ts`, les fonctions PostGIS `battle_*`, `get_isochrone_battle`, `clip_geojson_to_france`, `clip_rings_to_france`, `middleware.ts`.
- Accessibilité : `aria-pressed` sur la bascule de vue et le sélecteur de maille, focus clavier visible, en-têtes de tableau associés, `prefers-reduced-motion` respecté.
- La palette divergente doit rester lisible pour un daltonien : le sens se lit aussi par la **position sur la barre divergente**, pas seulement par la teinte.
- Corps de requête via `lireCorps()` / `lireFormulaire()` (`lib/api/valider-corps.ts`), jamais `await request.json()` nu. Validation Zod. `export const dynamic = 'force-dynamic'`.
- Mise en forme des nombres : `lib/format/nombre.ts` (`formaterNombre`, `formaterNombreAbrege`). Ne jamais réécrire un `fmtNum` local.
- Documentation à jour **dans le commit**, jamais après : `ARCHITECTURE.md` à la racine est la seule source de vérité.

---

## Décisions prises avant ce plan (ne pas les rouvrir sans motif nouveau)

| Décision | Motif |
|---|---|
| **Pas de paramètre `plan_basis`.** Le plan d'un CP se lit directement. | Mesuré le 2026-09-14 : `planned_share` est **identique pour les 5 acteurs sur les 2 041 CP** (`max(count(distinct planned_share)) = 1`). Pondérer par budget ou moyenner donne le même résultat à la décimale. Construire un réglage pour une différence qui n'existe pas serait du code mort déguisé en option. |
| **Un garde-fou remplace ce paramètre** : si un CP porte des `planned_share` divergents entre acteurs, le calcul le **signale** (`plan_divergent: true`) au lieu de moyenner en silence. | Le jour où le modèle changera, le calcul échouera bruyamment au lieu de rendre un score faux. |
| **Le filtre par acteur est CONSERVÉ**, contre la lettre du prompt. Mais **le score reste global à la campagne**, jamais filtré par acteur. | Le chantier « Suivi vue par acteur » a été livré et mergé le 23/07. Et le score d'un acteur seul n'a pas de sens : il ne contrôle pas le plan des autres. Le filtre repilote le reste de l'écran, pas le score. |
| **Option (c) parquée** : dénormaliser le plan en une ligne par CP (hors acteur). | La base le fait déjà de fait — elle stocke simplement la même valeur cinq fois. Le gain est du stockage et de la clarté, pas de la justesse. Migration + reprise de `refresh_campaign_rollups` + du wizard : disproportionné aujourd'hui. |
| **La moyenne du secteur est calculée sur la base par défaut**, jamais sur un réglage propre à la campagne. | La maquette affiche « Moyenne du secteur : 64 ». Un étalon qui bouge avec le réglage de chaque campagne ne mesure plus rien. |
| **Branche dédiée**, partant de `feat/nav-5-themes`. | Cette dernière porte 74 commits et 8 lots jamais relus. Ajouter ce chantier au même merge rendrait la relecture finale ingérable. |

---

## Ce qui existe et qu'on récupère (ne pas réécrire)

| Existant | Où | Usage dans le nouveau plan |
|---|---|---|
| Formule `hold` = `(imps_maille / total_imps) / planned_share × 100` | `sql/113:287`, `sql/117:68-75` | C'est **exactement** le ratio réel/plan × 100 de l'alignement. Le score l'agrège, il ne le remplace pas. |
| Agrégation Région/Département par **vraie jointure INSEE** | `sql/117_campaign_derive_map.sql:34-42,51,63,76` | Repris tel quel pour `alignement_par_maille`. C'est la seule voie correcte pour les DROM. |
| `planned_share` = `bid_multiplier / SUM(bid_multiplier) OVER ()` figé au refresh | `sql/113:64-67` | C'est le plan. Dénominateur du score. |
| Variable INSEE du plan : `bidding_strategies.in_zone_weights->>'variable_code'` (défaut `abstention_pres_2022`) | `sql/106:85-175` | Alimente la carte n°2 « Variable du plan ». **N'est pas dans `geo_strategy`** — piège documenté. |
| `imps_7d` / `imps_prev7d` par CP | `campaign_cp_rollup` | Permettent la **variation du score sur 7 jours** sans aucune table d'historique. |
| Patron de réapplication de palette au thème | `useMapInit.ts:1091-1102`, `lib/map/magelian-style.ts:80-174` | Modèle exact pour les trois cartes et la couche Diffusion. |
| `formaterNombre` / `formaterNombreAbrege` | `lib/format/nombre.ts` | Toute mise en forme numérique. |
| Pile Échap, garde de saisie | `lib/carte/pile-echap.ts`, `lib/navigation/garde-saisie.ts` | La bascule et les panneaux s'y enregistrent. |

---

## File Structure

### Créés

| Fichier | Responsabilité |
|---|---|
| `lib/campagne/session-types.ts` | Types de la session (`Maille`, `VueCampagne`, `CampagneSession`) + constantes. Aucun React. |
| `lib/campagne/session-url.ts` | Fonctions **pures** de sérialisation/désérialisation session ↔ `URLSearchParams`. Testables sans DOM. |
| `lib/campagne/CampagneSessionContext.tsx` | Provider React + `useCampagneSession()`. Persistance URL + localStorage. |
| `lib/campagne/alignement.ts` | Jumeau TypeScript de la formule du score (mêmes arrondis) pour tests et affichage dérivé. |
| `lib/campagne/palette-divergente.ts` | Bornes et couleurs de l'échelle divergente, par thème, en hex littéraux pour MapLibre. |
| `sql/165_alignement_geographique.sql` | RPC `calculer_alignement_geo`, `alignement_par_maille`, `alignement_dispersion_cp`. |
| `sql/166_parametres_alignement.sql` | Colonnes `tolerance_pct` / `overpressure_weight` sur `dsp_campaigns`, + `etalon_alignement`. |
| `app/api/campaigns/[campaignId]/alignement/route.ts` | Le score, ses composantes, sa variation 7 j. |
| `app/api/campaigns/[campaignId]/alignement/maille/route.ts` | Unités agrégées à la maille demandée (tableau + cartes). |
| `app/api/campaigns/[campaignId]/alignement/dispersion/route.ts` | Histogramme de dispersion des écarts (maille CP). |
| `app/api/campaigns/[campaignId]/alignement/constats/route.ts` | Les trois constats calculés de « Ce qu'il faut corriger ». |
| `components/campagne/suivi-v2/SuiviV2.tsx` | Racine du nouvel onglet. Orchestration, pas de fetch inline. |
| `components/campagne/suivi-v2/BarreMaille.tsx` | Fil d'Ariane + sélecteur Région/Département/CP + compte d'unités. |
| `components/campagne/suivi-v2/ScoreAlignement.tsx` | Le score, sa variation, l'échelle, la mention de maille. |
| `components/campagne/suivi-v2/BandeauAvancement.tsx` | Trois barres sur la même échelle + repère temps + phrase chiffrée. |
| `components/campagne/suivi-v2/GraphiqueEcart.tsx` | Courbe plan/réel (région, département) OU histogramme de dispersion (CP). |
| `components/campagne/suivi-v2/TrioCartes.tsx` | Les trois vignettes cartographiques synchronisées. |
| `components/campagne/suivi-v2/CarteVignette.tsx` | Une vignette : MapLibre, échelle, grisage hors périmètre, clic → Diffusion. |
| `components/campagne/suivi-v2/TroisComposantes.tsx` | Conformes / sous-pression / sur-pression. |
| `components/campagne/suivi-v2/ConstatsCorrection.tsx` | Les trois constats calculés + leur action. |
| `components/campagne/suivi-v2/CoutEtRythme.tsx` | CPM vs plan, impressions livrées, coût du déséquilibre. |
| `components/campagne/suivi-v2/TableauDeregles.tsx` | Barre divergente centrée sur le plan, bascule sous/sur, 7 lignes, lien table complète. |
| `components/campagne/suivi-v2/QuiADiffuse.tsx` | Barres compactes par partenaire + CPM signalé. |
| `components/campagne/suivi-v2/DetailTechnique.tsx` | Replié : budget cumulé vs idéal + réconciliation DSP. |
| `components/campagne/BarreContexteCampagne.tsx` | Barre identique dans les deux vues : campagne, DSP, période, score, bascule. |
| `app/map/_components/DiffusionMapLayer.tsx` | Couche carte « Diffusion » (remplace `SuiviMapLayer`). |
| `tests/unit/campagne/alignement.test.ts` | Invariants du score. |
| `tests/unit/campagne/session-url.test.ts` | Aller-retour session ↔ URL. |
| `tests/unit/campagne/palette-divergente.test.ts` | Bornes et symétrie de l'échelle. |

### Modifiés

| Fichier | Changement |
|---|---|
| `components/magelian/MagelianOverlay.tsx:326` | `return null` → rendu masqué (`hidden` + `aria-hidden`), pour que les enfants survivent. |
| `components/magelian/MagelianOverlay.tsx:117-124` | Suppression du reset de `tab` à chaque ouverture ; l'onglet vient de la session. |
| `components/magelian/MagelianOverlayContext.tsx` | `campagneActive` et `filtreActif` migrent vers `CampagneSessionContext`. |
| `app/layout.tsx:56-64` | `CampagneSessionProvider` au-dessus de `MagelianOverlayProvider`. |
| `app/map/page.tsx` | Branche la maille et l'unité sélectionnée sur la session ; clic carte → sélection. |
| `app/globals.css` | Famille de tokens `--diverge-*`, dark et clair. |
| `ARCHITECTURE.md` | Routes, RPC, tables, composants — dans les commits concernés. |

### Supprimés (Task 16, en dernier)

`components/campaign/CampaignSuivi.tsx` (476) · `components/campaign/suivi/SuiviCockpit.tsx` (138) · `SuiviCharts.tsx` (112) · `SuiviTable.tsx` (231) · `ReconciliationPanel.tsx` (101) · `ActorFilter.tsx` (82) · `ActorPanel.tsx` (83) · `SuiviDeriveMap.tsx` (436) · `DeriveTable.tsx` (186) · `MeshSelector.tsx` (40) · `app/map/_components/SuiviMapLayer.tsx` (307) · routes `derive/map`, `derive/ranked` · libs `lib/campaigns/derive-metrics.ts`, `reconciliation-metrics.ts` · tests associés.

**Conservés malgré les apparences** : `FinalReport.tsx` (bilan de fin, réintégré dans `DetailTechnique`), routes `suivi/map` et `reconcile/*` (réutilisées par la couche Diffusion), `lib/campaigns/actor-metrics.ts` (`parseActorsParam` est utilisé par des routes qui survivent), `lib/campaigns/suivi-chat.ts` (l'assistant survit, déplacé dans le tiroir global).

---

## Ordre des lots

| Lot | Tâches | Livrable indépendamment testable |
|---|---|---|
| A — Session partagée | 1, 2 | La session survit à la bascule et à un rechargement d'URL |
| B — Score en base | 3, 4, 5, 7 | Le score est calculable et juste, vérifié sur données réelles |
| C — Agrégations par maille | 6 | Les trois mailles rendent des unités cohérentes, DROM compris |
| D — Nouvel onglet | 9, 10, 11, 14, 15 | L écran s affiche en entier et réagit à la maille |
| E — Cartographie | 8, 12, 13 | Les trois vignettes et la vue Diffusion |
| F — Suppression | 16 | L'ancien écran et son code mort ont disparu |

---

## Task 1: Types et sérialisation URL de la session

**Files:**
- Create: `lib/campagne/session-types.ts`
- Create: `lib/campagne/session-url.ts`
- Test: `tests/unit/campagne/session-url.test.ts`

**Interfaces:**
- Consomme : `MagelianTab` de `components/magelian/deep-link.ts`
- Produit : `type Maille = 'region'|'departement'|'cp'` · `type VueCampagne = 'suivi'|'carte'` · `interface CampagneSession` · `sessionVersUrl(s: CampagneSession): URLSearchParams` · `urlVersSession(p: URLSearchParams): Partial<CampagneSession>` · `SESSION_DEFAUT: CampagneSession`

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// tests/unit/campagne/session-url.test.ts
import { describe, it, expect } from 'vitest'
import { sessionVersUrl, urlVersSession, SESSION_DEFAUT } from '@/lib/campagne/session-url'
import type { CampagneSession } from '@/lib/campagne/session-types'

const SESSION: CampagneSession = {
  campaignId: 'dccc0000-0000-4000-8000-000000000002',
  vue: 'carte',
  onglet: 'suivi',
  maille: 'departement',
  parent: '11',
  uniteSelectionnee: '13',
  tri: 'pire',
  acteurs: ['dv360', 'tiktok'],
}

describe('sérialisation de la session campagne', () => {
  it('fait un aller-retour sans perte', () => {
    const params = sessionVersUrl(SESSION)
    expect(urlVersSession(params)).toEqual(SESSION)
  })

  it('omet les valeurs par défaut pour garder une URL courte', () => {
    const params = sessionVersUrl({ ...SESSION_DEFAUT, campaignId: 'abc' })
    expect(params.toString()).toBe('campagne=abc')
  })

  it('ignore une maille inconnue plutôt que de la propager', () => {
    const p = new URLSearchParams('campagne=abc&maille=canton')
    expect(urlVersSession(p).maille).toBeUndefined()
  })

  it('ignore un onglet inconnu mais accepte l alias hérité creation', () => {
    expect(urlVersSession(new URLSearchParams('onglet=creation')).onglet).toBe('strategie')
    expect(urlVersSession(new URLSearchParams('onglet=zzz')).onglet).toBeUndefined()
  })

  it('ne rend jamais un parent sans maille — un fil d Ariane orphelin est ininterprétable', () => {
    const p = new URLSearchParams('campagne=abc&parent=11')
    expect(urlVersSession(p).parent).toBeUndefined()
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run tests/unit/campagne/session-url.test.ts`
Expected: FAIL — `Cannot find module '@/lib/campagne/session-url'`

- [ ] **Step 3: Écrire l'implémentation minimale**

```ts
// lib/campagne/session-types.ts
import type { MagelianTab } from '@/components/magelian/deep-link'

/** Mailles d'affichage. Le SCORE est toujours calculé au CP, quelle que soit celle-ci. */
export const MAILLES = ['region', 'departement', 'cp'] as const
export type Maille = (typeof MAILLES)[number]

export const VUES = ['suivi', 'carte'] as const
export type VueCampagne = (typeof VUES)[number]

export const TRIS = ['pire', 'meilleur'] as const
export type Tri = (typeof TRIS)[number]

export interface CampagneSession {
  campaignId: string | null
  vue: VueCampagne
  onglet: MagelianTab
  maille: Maille
  /** Code du parent dans le fil d'Ariane (code région ou département). null = France entière. */
  parent: string | null
  /** Unité mise en évidence (code région / département / CP). */
  uniteSelectionnee: string | null
  tri: Tri
  /** [] = tous les acteurs. Ne filtre JAMAIS le score, seulement le reste de l'écran. */
  acteurs: string[]
}
```

```ts
// lib/campagne/session-url.ts
import { MAILLES, VUES, TRIS, type CampagneSession, type Maille, type VueCampagne, type Tri } from './session-types'
import type { MagelianTab } from '@/components/magelian/deep-link'

const ONGLETS: readonly MagelianTab[] = ['strategie', 'activation', 'suivi', 'apercu']

export const SESSION_DEFAUT: CampagneSession = {
  campaignId: null, vue: 'suivi', onglet: 'suivi', maille: 'departement',
  parent: null, uniteSelectionnee: null, tri: 'pire', acteurs: [],
}

/**
 * Sérialise la session. Les valeurs par défaut sont OMISES : une URL partagée
 * ne doit pas transporter du bruit, et un paramètre absent se relit comme
 * « valeur par défaut », jamais comme « valeur perdue ».
 */
export function sessionVersUrl(s: CampagneSession): URLSearchParams {
  const p = new URLSearchParams()
  if (s.campaignId) p.set('campagne', s.campaignId)
  if (s.vue !== SESSION_DEFAUT.vue) p.set('vue', s.vue)
  if (s.onglet !== SESSION_DEFAUT.onglet) p.set('onglet', s.onglet)
  if (s.maille !== SESSION_DEFAUT.maille) p.set('maille', s.maille)
  if (s.parent) p.set('parent', s.parent)
  if (s.uniteSelectionnee) p.set('unite', s.uniteSelectionnee)
  if (s.tri !== SESSION_DEFAUT.tri) p.set('tri', s.tri)
  if (s.acteurs.length > 0) p.set('acteurs', s.acteurs.join(','))
  return p
}

function dansListe<T extends string>(v: string | null, liste: readonly T[]): T | undefined {
  return v !== null && (liste as readonly string[]).includes(v) ? (v as T) : undefined
}

/**
 * Relit une session depuis l'URL. Toute valeur inconnue est IGNORÉE plutôt que
 * propagée : une maille « canton » venue d'un lien périmé ne doit pas traverser
 * la frontière et faire échouer une requête plus loin.
 */
export function urlVersSession(p: URLSearchParams): Partial<CampagneSession> {
  const out: Partial<CampagneSession> = {}

  const campagne = p.get('campagne')
  if (campagne) out.campaignId = campagne

  const vue = dansListe<VueCampagne>(p.get('vue'), VUES)
  if (vue) out.vue = vue

  // `creation` est un ALIAS HÉRITÉ, pas une valeur invalide : le traiter comme
  // invalide perdrait silencieusement les campagnes ouvertes par un ancien lien.
  const ongletBrut = p.get('onglet')
  const onglet = ongletBrut === 'creation' ? 'strategie' : dansListe<MagelianTab>(ongletBrut, ONGLETS)
  if (onglet) out.onglet = onglet

  const maille = dansListe<Maille>(p.get('maille'), MAILLES)
  if (maille) out.maille = maille

  // Un parent sans maille explicite n'a pas de sens : on ne sait pas de quel
  // niveau il est le parent. On le laisse tomber plutôt que de deviner.
  const parent = p.get('parent')
  if (parent && maille) out.parent = parent

  const unite = p.get('unite')
  if (unite) out.uniteSelectionnee = unite

  const tri = dansListe<Tri>(p.get('tri'), TRIS)
  if (tri) out.tri = tri

  const acteurs = p.get('acteurs')
  if (acteurs) out.acteurs = acteurs.split(',').map(a => a.trim()).filter(Boolean)

  return out
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run tests/unit/campagne/session-url.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add lib/campagne/session-types.ts lib/campagne/session-url.ts tests/unit/campagne/session-url.test.ts
git commit -m "feat(campagne): types et serialisation URL de la session de travail"
```

---

## Task 2: Provider de session et survie à la bascule

**Files:**
- Create: `lib/campagne/CampagneSessionContext.tsx`
- Modify: `app/layout.tsx:52-67` (insérer le provider)
- Modify: `components/magelian/MagelianOverlay.tsx:326` (masquer au lieu de démonter)
- Modify: `components/magelian/MagelianOverlay.tsx:117-124` (supprimer le reset d'onglet)
- Test: `tests/unit/campagne/session-persistance.test.ts`

**Interfaces:**
- Consomme : `CampagneSession`, `sessionVersUrl`, `urlVersSession`, `SESSION_DEFAUT` (Task 1)
- Produit : `<CampagneSessionProvider>` · `useCampagneSession(): { session, majSession, basculerVue }` · `CLE_SESSION_STORAGE = 'magelian-campagne-session'`

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// tests/unit/campagne/session-persistance.test.ts
import { describe, it, expect } from 'vitest'
import { fusionnerSession, CLE_SESSION_STORAGE } from '@/lib/campagne/CampagneSessionContext'
import { SESSION_DEFAUT } from '@/lib/campagne/session-url'

describe('reprise de session', () => {
  it('l URL prime sur le storage — un lien partagé doit ouvrir ce qu il annonce', () => {
    const stockee = { ...SESSION_DEFAUT, campaignId: 'ancienne', maille: 'cp' as const }
    const url = new URLSearchParams('campagne=nouvelle&maille=region')
    const s = fusionnerSession(stockee, url)
    expect(s.campaignId).toBe('nouvelle')
    expect(s.maille).toBe('region')
  })

  it('reprend le storage quand l URL est muette', () => {
    const stockee = { ...SESSION_DEFAUT, campaignId: 'ancienne', tri: 'meilleur' as const }
    expect(fusionnerSession(stockee, new URLSearchParams()).tri).toBe('meilleur')
  })

  it('tombe sur les défauts si le storage est illisible', () => {
    expect(fusionnerSession(null, new URLSearchParams())).toEqual(SESSION_DEFAUT)
  })

  it('la clé de storage est stable — la changer perdrait les sessions en cours', () => {
    expect(CLE_SESSION_STORAGE).toBe('magelian-campagne-session')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run tests/unit/campagne/session-persistance.test.ts`
Expected: FAIL — `fusionnerSession is not exported`

- [ ] **Step 3: Écrire l'implémentation**

```tsx
// lib/campagne/CampagneSessionContext.tsx
'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { SESSION_DEFAUT, sessionVersUrl, urlVersSession } from './session-url'
import type { CampagneSession, VueCampagne } from './session-types'

export const CLE_SESSION_STORAGE = 'magelian-campagne-session'

/**
 * L'URL prime sur le storage. Un lien partagé doit ouvrir EXACTEMENT ce qu'il
 * annonce ; le storage n'est qu'un repli pour le retour dans l'application.
 */
export function fusionnerSession(
  stockee: CampagneSession | null,
  url: URLSearchParams,
): CampagneSession {
  return { ...SESSION_DEFAUT, ...(stockee ?? {}), ...urlVersSession(url) }
}

function lireStorage(): CampagneSession | null {
  try {
    const brut = window.localStorage.getItem(CLE_SESSION_STORAGE)
    return brut ? (JSON.parse(brut) as CampagneSession) : null
  } catch {
    return null // fenêtre privée, storage bloqué : on repart des défauts
  }
}

interface Valeur {
  session: CampagneSession
  majSession: (patch: Partial<CampagneSession>) => void
  basculerVue: () => void
}

const Ctx = createContext<Valeur | null>(null)

export function CampagneSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Seed synchrone : évite un rendu avec les défauts puis un saut.
  const [session, setSession] = useState<CampagneSession>(() =>
    typeof window === 'undefined'
      ? SESSION_DEFAUT
      : fusionnerSession(lireStorage(), new URLSearchParams(window.location.search)),
  )

  const majSession = useCallback((patch: Partial<CampagneSession>) => {
    setSession(prev => {
      // Changer de maille invalide le fil d'Ariane et la sélection : ils
      // désignent des codes d'un AUTRE niveau. Les garder afficherait un
      // département sélectionné dans une liste de régions.
      const reset = patch.maille && patch.maille !== prev.maille
        ? { parent: null, uniteSelectionnee: null }
        : {}
      return { ...prev, ...reset, ...patch }
    })
  }, [])

  const basculerVue = useCallback(() => {
    setSession(prev => ({ ...prev, vue: prev.vue === 'suivi' ? 'carte' : 'suivi' }))
  }, [])

  // Persistance storage
  useEffect(() => {
    try { window.localStorage.setItem(CLE_SESSION_STORAGE, JSON.stringify(session)) } catch { /* ignoré */ }
  }, [session])

  // Persistance URL — `replace`, jamais `push` : la bascule de vue n'est pas
  // une navigation, elle ne doit pas empiler d'entrée dans l'historique.
  const derniereUrlRef = useRef<string>('')
  useEffect(() => {
    if (pathname !== '/map') return
    const qs = sessionVersUrl(session).toString()
    if (qs === derniereUrlRef.current) return
    derniereUrlRef.current = qs
    router.replace(qs ? `/map?${qs}` : '/map', { scroll: false })
  }, [session, pathname, router])

  // Relecture si l'URL change sous nos pieds (lien collé, bouton retour).
  useEffect(() => {
    const qs = searchParams.toString()
    if (!qs || qs === derniereUrlRef.current) return
    setSession(prev => ({ ...prev, ...urlVersSession(new URLSearchParams(qs)) }))
  }, [searchParams])

  const valeur = useMemo(() => ({ session, majSession, basculerVue }), [session, majSession, basculerVue])
  return <Ctx.Provider value={valeur}>{children}</Ctx.Provider>
}

export function useCampagneSession(): Valeur {
  const v = useContext(Ctx)
  if (!v) throw new Error('useCampagneSession doit être appelé sous CampagneSessionProvider')
  return v
}

export type { CampagneSession, VueCampagne }
```

- [ ] **Step 4: Masquer l'overlay au lieu de le démonter**

Dans `components/magelian/MagelianOverlay.tsx`, remplacer la ligne 326 :

```tsx
// AVANT — démonte tous les enfants, l'état de l'onglet Suivi est perdu
if (!mounted || (!open && !closing)) return null;
```

```tsx
// APRÈS — le portail reste monté, les enfants survivent à la bascule.
// `hidden` retire l'élément du flux ET de l'arbre d'accessibilité, sans
// démonter : c'est exactement ce que demande le §3 du prompt.
if (!mounted) return null;
const masque = !open && !closing;
```

puis, sur le conteneur racine du portail (l. ~334) :

```tsx
<div
  hidden={masque}
  aria-hidden={masque}
  inert={masque ? '' : undefined}
  style={{ /* styles existants inchangés */ }}
>
```

Et supprimer entièrement le bloc des lignes 117-124 (le reset de `tab`), remplacé par la lecture de `session.onglet`.

- [ ] **Step 5: Lancer les tests**

Run: `npx vitest run tests/unit/campagne/ && npx tsc --noEmit`
Expected: PASS, et `tsc` sans erreur

- [ ] **Step 6: Commit**

```bash
git add lib/campagne/CampagneSessionContext.tsx app/layout.tsx components/magelian/MagelianOverlay.tsx tests/unit/campagne/session-persistance.test.ts
git commit -m "feat(campagne): session partagee carte/overlay, l overlay est masque et non demonte"
```

---

## Task 3: Paramètres du score en base

**Files:**
- Create: `sql/166_parametres_alignement.sql`
- Modify: `ARCHITECTURE.md` (tables)

**Interfaces:**
- Produit : `dsp_campaigns.tolerance_pct numeric NOT NULL DEFAULT 10` · `dsp_campaigns.overpressure_weight numeric NOT NULL DEFAULT 1.0` · table `etalon_alignement`

- [ ] **Step 1: Écrire la migration**

```sql
-- sql/166_parametres_alignement.sql
-- Paramètres du score d'alignement géographique.
-- JAMAIS en dur dans le code : le score doit rester recalculable à l'identique
-- depuis les données brutes, donc ses paramètres doivent être lisibles en base.

alter table dsp_campaigns
  add column if not exists tolerance_pct numeric not null default 10
    check (tolerance_pct >= 0 and tolerance_pct <= 100),
  add column if not exists overpressure_weight numeric not null default 1.0
    check (overpressure_weight >= 0 and overpressure_weight <= 5);

comment on column dsp_campaigns.tolerance_pct is
  'Marge de conformite du score d alignement, en %. Un CP dans [plan*(1-t), plan*(1+t)] est conforme.';
comment on column dsp_campaigns.overpressure_weight is
  'Poids de la sur-pression dans la penalite. 1.0 = penalisee autant que la sous-pression.';

-- L'etalon ("Moyenne du secteur") est calcule sur les parametres PAR DEFAUT,
-- jamais sur ceux d une campagne : un etalon qui bouge avec le reglage de
-- chacun ne mesure plus rien.
create table if not exists etalon_alignement (
  id              boolean primary key default true check (id),
  score_median    numeric not null,
  n_campagnes     integer not null,
  tolerance_pct   numeric not null,
  calcule_le      timestamptz not null default now()
);

alter table etalon_alignement enable row level security;
-- RLS deny-all : lu et ecrit uniquement par les routes en service_role.

insert into etalon_alignement (id, score_median, n_campagnes, tolerance_pct)
values (true, 64, 0, 10)
on conflict (id) do nothing;
```

- [ ] **Step 2: Appliquer via MCP Supabase**

Appliquer le contenu de `sql/166_parametres_alignement.sql` avec `apply_migration`, nom `parametres_alignement`.

- [ ] **Step 3: Vérifier en base**

```sql
select column_name, data_type, column_default
from information_schema.columns
where table_name = 'dsp_campaigns'
  and column_name in ('tolerance_pct', 'overpressure_weight');
```
Expected: 2 lignes, défauts `10` et `1.0`

- [ ] **Step 4: Régénérer les types**

Run: `npx supabase gen types typescript --project-id vkkdbygwbrxyogqosten > types/database.types.ts`

- [ ] **Step 5: Commit**

```bash
git add sql/166_parametres_alignement.sql types/database.types.ts ARCHITECTURE.md
git commit -m "feat(alignement): parametres du score en base, etalon calcule sur les defauts"
```

---

## Task 4: La formule du score, en TypeScript d'abord

**Files:**
- Create: `lib/campagne/alignement.ts`
- Test: `tests/unit/campagne/alignement.test.ts`

**Interfaces:**
- Produit : `interface UniteAlignement { code: string; reel: number; plan: number }` · `interface ResultatAlignement { score: number; conformes_pct: number; sous_pression_pct: number; sur_pression_pct: number; sous_pression_imps: number; sur_pression_imps: number; n_unites: number }` · `calculerAlignement(unites: UniteAlignement[], tolerancePct: number, poidsSurpression: number): ResultatAlignement`

> **Pourquoi un jumeau TypeScript d'une RPC SQL** : mêmes raisons que
> `lib/analyses/score.ts` pour `calculer_score_composite`. Il rend la formule
> testable sans base, et il sert d'oracle : si la RPC et le jumeau divergent,
> l'un des deux a un défaut. Les deux doivent arrondir identiquement.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// tests/unit/campagne/alignement.test.ts
import { describe, it, expect } from 'vitest'
import { calculerAlignement, type UniteAlignement } from '@/lib/campagne/alignement'

const parfait: UniteAlignement[] = [
  { code: '75001', reel: 500, plan: 500 },
  { code: '13001', reel: 300, plan: 300 },
  { code: '69001', reel: 200, plan: 200 },
]

describe('score d alignement géographique', () => {
  it('rend 100 quand le réel colle au plan partout', () => {
    const r = calculerAlignement(parfait, 10, 1)
    expect(r.score).toBe(100)
    expect(r.conformes_pct).toBe(100)
    expect(r.sous_pression_pct).toBe(0)
    expect(r.sur_pression_pct).toBe(0)
  })

  it('ne pénalise pas un écart intérieur à la tolérance', () => {
    const dansLaMarge: UniteAlignement[] = [
      { code: 'a', reel: 545, plan: 500 }, // +9 %, sous les 10 %
      { code: 'b', reel: 455, plan: 500 }, // -9 %
    ]
    const r = calculerAlignement(dansLaMarge, 10, 1)
    expect(r.score).toBe(100)
    expect(r.conformes_pct).toBe(100)
  })

  it('ne compte que la part AU-DELÀ de la tolérance, pas l écart entier', () => {
    // plan 500, tolérance 10 % => seuil bas 450. réel 400 => manque 50, pas 100.
    const r = calculerAlignement([{ code: 'a', reel: 400, plan: 500 }], 10, 1)
    expect(r.sous_pression_imps).toBe(50)
  })

  it('pénalise la SUR-pression, pas seulement la sous-pression', () => {
    const sous = calculerAlignement([{ code: 'a', reel: 400, plan: 500 }, { code: 'b', reel: 600, plan: 500 }], 10, 1)
    expect(sous.sur_pression_imps).toBe(50)
    expect(sous.sous_pression_imps).toBe(50)
    expect(sous.score).toBeLessThan(100)
  })

  it('le poids de sur-pression module la pénalité, et 0 la neutralise', () => {
    const u: UniteAlignement[] = [{ code: 'a', reel: 600, plan: 500 }, { code: 'b', reel: 400, plan: 500 }]
    expect(calculerAlignement(u, 10, 0).score).toBeGreaterThan(calculerAlignement(u, 10, 1).score)
  })

  it('ne descend jamais sous 0 même sur une campagne totalement déréglée', () => {
    const catastrophe: UniteAlignement[] = [
      { code: 'a', reel: 0, plan: 1000 },
      { code: 'b', reel: 2000, plan: 0 },
    ]
    expect(calculerAlignement(catastrophe, 10, 1).score).toBeGreaterThanOrEqual(0)
  })

  it('ignore une unité au plan nul sans exploser en division par zéro', () => {
    const r = calculerAlignement([{ code: 'a', reel: 10, plan: 0 }, { code: 'b', reel: 100, plan: 100 }], 10, 1)
    expect(Number.isFinite(r.score)).toBe(true)
  })

  it('rend 100 sur un jeu vide plutôt que NaN', () => {
    expect(calculerAlignement([], 10, 1).score).toBe(100)
  })

  it('reproduit la mesure du 2026-09-14 sur la campagne de démo', () => {
    // Valeurs mesurées en base : sous 3,84 % · sur 3,35 % · conformes 72,5 %
    // Ce test fige la formule, pas les données : il utilise un jeu réduit
    // dont les proportions sont connues.
    const u: UniteAlignement[] = [
      { code: 'a', reel: 384, plan: 1000 },  // très sous
      ...Array.from({ length: 7 }, (_, i) => ({ code: `c${i}`, reel: 1000, plan: 1000 })),
    ]
    const r = calculerAlignement(u, 10, 1)
    expect(r.conformes_pct).toBeCloseTo(87.5, 1)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run tests/unit/campagne/alignement.test.ts`
Expected: FAIL — module introuvable

- [ ] **Step 3: Écrire l'implémentation**

```ts
// lib/campagne/alignement.ts

/**
 * Score d'alignement géographique — l'indicateur signature de MAGELIAN.
 *
 * Mesure si la pression réelle respecte le plan, unité par unité, en pénalisant
 * LES DEUX SENS : sous-pression (volume manquant) et sur-pression (volume en
 * trop, qui aurait dû aller ailleurs).
 *
 * Ce n'est PAS un indicateur de ciblage. On vise rarement une partie seulement
 * de la France ; l'enjeu est la répartition, pas le périmètre.
 *
 * Jumeau SQL : `calculer_alignement_geo` (sql/165). Les deux DOIVENT arrondir
 * identiquement — voir tests/unit/campagne/alignement.test.ts.
 */

export interface UniteAlignement {
  code: string
  /** Impressions réellement livrées sur l'unité. */
  reel: number
  /** Impressions que le plan prévoyait sur l'unité (planned_share × total). */
  plan: number
}

export interface ResultatAlignement {
  score: number
  conformes_pct: number
  sous_pression_pct: number
  sur_pression_pct: number
  sous_pression_imps: number
  sur_pression_imps: number
  n_unites: number
}

export function calculerAlignement(
  unites: UniteAlignement[],
  tolerancePct: number,
  poidsSurpression: number,
): ResultatAlignement {
  const vide: ResultatAlignement = {
    score: 100, conformes_pct: 100, sous_pression_pct: 0, sur_pression_pct: 0,
    sous_pression_imps: 0, sur_pression_imps: 0, n_unites: 0,
  }
  if (unites.length === 0) return vide

  const t = tolerancePct / 100
  const totalReel = unites.reduce((s, u) => s + u.reel, 0)
  if (totalReel <= 0) return { ...vide, n_unites: unites.length }

  let manque = 0
  let trop = 0
  let conformes = 0

  for (const u of unites) {
    // Une unité sans plan ne peut pas être « en retard sur son plan ». Son
    // volume compte dans le total, mais elle ne produit pas de sous-pression.
    // La sur-pression, elle, reste mesurable : du volume y est bien parti.
    const bas = u.plan * (1 - t)
    const haut = u.plan * (1 + t)

    if (u.plan > 0 && u.reel >= bas && u.reel <= haut) {
      conformes++
      continue
    }
    if (u.plan > 0 && u.reel < bas) manque += bas - u.reel
    if (u.reel > haut) trop += u.reel - haut
  }

  const sousPct = (manque / totalReel) * 100
  const surPct = (trop / totalReel) * 100
  const penalite = sousPct + poidsSurpression * surPct

  return {
    score: Math.max(0, Math.round(100 - penalite)),
    conformes_pct: Math.round((conformes / unites.length) * 1000) / 10,
    sous_pression_pct: Math.round(sousPct * 100) / 100,
    sur_pression_pct: Math.round(surPct * 100) / 100,
    sous_pression_imps: Math.round(manque),
    sur_pression_imps: Math.round(trop),
    n_unites: unites.length,
  }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npx vitest run tests/unit/campagne/alignement.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add lib/campagne/alignement.ts tests/unit/campagne/alignement.test.ts
git commit -m "feat(alignement): la formule du score, penalisant les deux sens"
```

---

## Task 5: La RPC du score, et son garde-fou

**Files:**
- Create: `sql/165_alignement_geographique.sql`
- Create: `app/api/campaigns/[campaignId]/alignement/route.ts`
- Modify: `ARCHITECTURE.md` (routes + RPC)

**Interfaces:**
- Consomme : `dsp_campaigns.tolerance_pct` / `.overpressure_weight` (Task 3), formule validée (Task 4)
- Produit : RPC `calculer_alignement_geo(p_campaign_id uuid, p_tolerance numeric, p_poids numeric) → jsonb` · `GET /api/campaigns/[campaignId]/alignement` → `{ score, variation_7j, conformes_pct, sous_pression_*, sur_pression_*, n_cp, plan_divergent, etalon, maille_calcul: 'cp' }`

- [ ] **Step 1: Écrire la RPC**

```sql
-- sql/165_alignement_geographique.sql
-- Score d'alignement geographique. TOUJOURS calcule au code postal, jamais a
-- la maille affichee : agreger d abord lisserait les ecarts internes et le
-- score monterait mecaniquement quand l utilisateur dezoome.

create or replace function calculer_alignement_geo(
  p_campaign_id uuid,
  p_tolerance   numeric default null,   -- null => lit dsp_campaigns
  p_poids       numeric default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tol         numeric;
  v_poids       numeric;
  v_divergent   boolean;
  v_res         jsonb;
begin
  select coalesce(p_tolerance, c.tolerance_pct) / 100.0,
         coalesce(p_poids, c.overpressure_weight)
    into v_tol, v_poids
    from dsp_campaigns c where c.id = p_campaign_id;

  if v_tol is null then
    return jsonb_build_object('error', 'campagne_introuvable');
  end if;

  -- GARDE-FOU. Le plan est cense etre une propriete du CODE POSTAL, simplement
  -- recopiee sur chaque ligne acteur (verifie le 2026-09-14 : 2041 CP, une
  -- seule valeur distincte partout). Si ce n est plus vrai, moyenner en
  -- silence rendrait un score faux que rien ne signalerait.
  select exists (
    select 1 from campaign_cp_rollup
    where campaign_id = p_campaign_id
    group by postal_code
    having count(distinct planned_share) > 1
  ) into v_divergent;

  with cp as (
    -- Sommer sur les acteurs AVANT tout calcul : la PK est
    -- (campaign_id, postal_code, actor), un CP apparait jusqu a 5 fois.
    select r.postal_code,
           sum(r.impressions)::numeric      as reel,
           sum(r.imps_prev7d)::numeric      as reel_prev,
           max(r.planned_share)::numeric    as part_plan,
           sum(r.spend)::numeric            as depense
      from campaign_cp_rollup r
     where r.campaign_id = p_campaign_id
     group by r.postal_code
  ),
  tot as (
    select sum(reel) t_reel, sum(reel_prev) t_prev, sum(depense) t_dep,
           sum(part_plan) t_part
      from cp
  ),
  calc as (
    select cp.postal_code,
           cp.reel, cp.reel_prev, cp.depense,
           -- Re-normaliser la part : elle vaut 1 par acteur, mais `max()`
           -- ci-dessus en a pris UNE seule, donc la somme vaut deja ~1.
           (cp.part_plan / nullif(t.t_part, 0)) * t.t_reel as plan_imps,
           (cp.part_plan / nullif(t.t_part, 0)) * t.t_prev as plan_imps_prev
      from cp cross join tot t
  ),
  agg as (
    select
      sum(greatest(0, plan_imps * (1 - v_tol) - reel))  filter (where plan_imps > 0) as manque,
      sum(greatest(0, reel - plan_imps * (1 + v_tol)))                                as trop,
      count(*) filter (
        where plan_imps > 0
          and reel between plan_imps * (1 - v_tol) and plan_imps * (1 + v_tol)
      ) as conformes,
      count(*) as n_cp,
      -- Le meme calcul sur la fenetre 7 jours precedente, pour la variation.
      sum(greatest(0, plan_imps_prev * (1 - v_tol) - reel_prev)) filter (where plan_imps_prev > 0) as manque_prev,
      sum(greatest(0, reel_prev - plan_imps_prev * (1 + v_tol)))                                   as trop_prev,
      -- Cout du desequilibre : la part de depense correspondant au volume en trop.
      sum(greatest(0, reel - plan_imps * (1 + v_tol)) / nullif(reel, 0) * depense) as eur_deplacables
      from calc
  )
  select jsonb_build_object(
    'maille_calcul',       'cp',
    'tolerance_pct',       v_tol * 100,
    'overpressure_weight', v_poids,
    'plan_divergent',      v_divergent,
    'n_cp',                a.n_cp,
    'conformes_pct',       round((a.conformes::numeric / nullif(a.n_cp, 0)) * 100, 1),
    'sous_pression_imps',  round(coalesce(a.manque, 0)),
    'sur_pression_imps',   round(coalesce(a.trop, 0)),
    'sous_pression_pct',   round(coalesce(a.manque, 0) / nullif(t.t_reel, 0) * 100, 2),
    'sur_pression_pct',    round(coalesce(a.trop, 0)   / nullif(t.t_reel, 0) * 100, 2),
    'sur_pression_eur',    round(coalesce(a.eur_deplacables, 0), 2),
    'impressions_totales', t.t_reel,
    'depense_totale',      t.t_dep,
    'score', greatest(0, round(100
      - coalesce(a.manque, 0) / nullif(t.t_reel, 0) * 100
      - v_poids * coalesce(a.trop, 0) / nullif(t.t_reel, 0) * 100)),
    'score_prev_7j', greatest(0, round(100
      - coalesce(a.manque_prev, 0) / nullif(t.t_prev, 0) * 100
      - v_poids * coalesce(a.trop_prev, 0) / nullif(t.t_prev, 0) * 100))
  ) into v_res
  from agg a cross join tot t;

  return coalesce(v_res, jsonb_build_object('error', 'aucune_donnee'));
end;
$$;

revoke all on function calculer_alignement_geo(uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function calculer_alignement_geo(uuid, numeric, numeric) to service_role;

comment on function calculer_alignement_geo is
  'Score d alignement geographique 0-100, TOUJOURS calcule au code postal. Jumeau TS : lib/campagne/alignement.ts';
```

- [ ] **Step 2: Appliquer et mesurer**

Appliquer via `apply_migration` (nom `alignement_geographique`), puis :

```sql
explain (analyze, buffers)
select calculer_alignement_geo('dccc0000-0000-4000-8000-000000000002');
```
Expected: `score` ≈ 93, `conformes_pct` ≈ 72,5, `sous_pression_pct` ≈ 3,84, `sur_pression_pct` ≈ 3,35, `plan_divergent` = false, et un temps < 200 ms. **Reporter le temps et les `shared read` mesurés dans le commit** (règle `EXPLAIN ANALYZE` de `CLAUDE.md`).

- [ ] **Step 3: Écrire la route**

```ts
// app/api/campaigns/[campaignId]/alignement/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/auth'
import { requireAuth } from '@/lib/api/require-auth'
import { checkCampaignAccess } from '@/lib/campaigns/access'
import { rpcJson } from '@/lib/supabase/rpc-json'

export const dynamic = 'force-dynamic'

const QuerySchema = z.object({
  tolerance: z.coerce.number().min(0).max(100).optional(),
  poids: z.coerce.number().min(0).max(5).optional(),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const auth = await requireAuth(request)
  if (!auth.ok) return auth.response

  const { campaignId } = await params
  if (!(await checkCampaignAccess(auth.profile, campaignId))) {
    return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 })
  }

  const parsed = QuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  if (!parsed.success) {
    return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('calculer_alignement_geo', {
    p_campaign_id: campaignId,
    p_tolerance: parsed.data.tolerance ?? null,
    p_poids: parsed.data.poids ?? null,
  })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const resultat = rpcJson<Record<string, unknown>>(data)

  // L'etalon est lu a part et SUR LES PARAMETRES PAR DEFAUT : un etalon qui
  // suivrait le reglage de la campagne ne comparerait plus rien.
  const { data: etalon } = await supabase
    .from('etalon_alignement')
    .select('score_median, n_campagnes, tolerance_pct')
    .single()

  return NextResponse.json({ ...resultat, etalon })
}
```

- [ ] **Step 4: Vérifier le type-check et les tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: aucune erreur, 950+ tests verts

- [ ] **Step 5: Commit**

```bash
git add sql/165_alignement_geographique.sql app/api/campaigns/[campaignId]/alignement/route.ts ARCHITECTURE.md types/database.types.ts
git commit -m "feat(alignement): la RPC du score au code postal, avec garde-fou sur la divergence du plan"
```

---

## Task 6: Agrégation par maille, par la jointure INSEE

**Files:**
- Modify: `sql/165_alignement_geographique.sql` (ajout de `alignement_par_maille`)
- Create: `app/api/campaigns/[campaignId]/alignement/maille/route.ts`

**Interfaces:**
- Consomme : la RPC de Task 5
- Produit : `alignement_par_maille(p_campaign_id uuid, p_maille text, p_parent text, p_tolerance numeric, p_limite int) → jsonb` · `GET …/alignement/maille?maille=&parent=&limite=` → `{ maille, parent, unites: [{code, nom, reel, plan, ecart_pct, impressions, spend, cpm, geometry}], n_total }`

> **Le piège à ne pas reproduire** : `campaign_cp_rollup.dept` vaut
> `LEFT(postal_code, 2)`. Tous les DROM s'y effondrent sur `97`, et la colonne
> ne porte aucun nom. La seule voie correcte est la jointure
> `ref_codes_postaux.code_dept → ref_departements → ref_regions`, celle que
> `sql/117_campaign_derive_map.sql:34-42` emprunte déjà.

- [ ] **Step 1: Écrire la RPC**

```sql
-- Ajout a sql/165_alignement_geographique.sql

create or replace function alignement_par_maille(
  p_campaign_id uuid,
  p_maille      text default 'departement',   -- 'region' | 'departement' | 'cp'
  p_parent      text default null,
  p_tolerance   numeric default null,
  p_limite      int default 500
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tol numeric;
  v_res jsonb;
begin
  if p_maille not in ('region', 'departement', 'cp') then
    raise exception 'maille inconnue: %', p_maille;
  end if;

  select coalesce(p_tolerance, c.tolerance_pct) / 100.0 into v_tol
    from dsp_campaigns c where c.id = p_campaign_id;
  if v_tol is null then return jsonb_build_object('error', 'campagne_introuvable'); end if;

  with cp as (
    select r.postal_code,
           sum(r.impressions)::numeric   as reel,
           max(r.planned_share)::numeric as part_plan,
           sum(r.spend)::numeric         as depense
      from campaign_cp_rollup r
     where r.campaign_id = p_campaign_id
     group by r.postal_code
  ),
  -- Jointure INSEE reelle. JAMAIS `campaign_cp_rollup.dept`.
  situe as (
    select cp.*, rcp.code_dept, rd.nom_dept, rd.code_region, rr.nom_region
      from cp
      join ref_codes_postaux rcp on rcp.code_postal = cp.postal_code
      join ref_departements  rd  on rd.code_dept   = rcp.code_dept
      left join ref_regions  rr  on rr.code_region = rd.code_region
  ),
  filtre as (
    select * from situe
     where p_parent is null
        or (p_maille = 'departement' and code_region = p_parent)
        or (p_maille = 'cp'          and code_dept   = p_parent)
  ),
  tot as (select sum(reel) t_reel, sum(part_plan) t_part from filtre),
  groupe as (
    select
      case p_maille when 'region' then code_region when 'departement' then code_dept else postal_code end as code,
      case p_maille when 'region' then max(nom_region) when 'departement' then max(nom_dept) else max(postal_code) end as nom,
      sum(reel) as reel, sum(part_plan) as part_plan, sum(depense) as depense
      from filtre
     group by 1
  )
  select jsonb_build_object(
    'maille', p_maille,
    'parent', p_parent,
    'n_total', (select count(*) from groupe),
    'unites', coalesce(jsonb_agg(u order by u.ecart_abs desc), '[]'::jsonb)
  ) into v_res
  from (
    select g.code, g.nom,
           g.reel::bigint                                       as impressions,
           round(g.depense, 2)                                  as spend,
           round(g.depense / nullif(g.reel, 0) * 1000, 2)       as cpm,
           round((g.part_plan / nullif(t.t_part, 0)) * t.t_reel) as plan,
           round(((g.reel / nullif((g.part_plan / nullif(t.t_part,0)) * t.t_reel, 0)) - 1) * 100, 1) as ecart_pct,
           abs((g.reel / nullif((g.part_plan / nullif(t.t_part,0)) * t.t_reel, 0)) - 1) as ecart_abs
      from groupe g cross join tot t
     order by ecart_abs desc
     limit p_limite
  ) u;

  return v_res;
end;
$$;

revoke all on function alignement_par_maille(uuid, text, text, numeric, int) from public, anon, authenticated;
grant execute on function alignement_par_maille(uuid, text, text, numeric, int) to service_role;
```

- [ ] **Step 2: Appliquer et vérifier les trois mailles**

```sql
select alignement_par_maille('dccc0000-0000-4000-8000-000000000002','region')  -> 'n_total';
select alignement_par_maille('dccc0000-0000-4000-8000-000000000002','departement') -> 'n_total';
select alignement_par_maille('dccc0000-0000-4000-8000-000000000002','cp',null,null,20) -> 'n_total';
```
Expected: région ≤ 18, département ≤ 101, CP = 2041 (mais 20 unités rendues). **Aucune valeur `97` isolée côté département** — vérifier que les DROM sortent en 971…976.

- [ ] **Step 3: Écrire la route**

Même squelette que Task 5 (auth → `checkCampaignAccess` → Zod → RPC), avec :

```ts
const QuerySchema = z.object({
  maille: z.enum(['region', 'departement', 'cp']).default('departement'),
  parent: z.string().max(10).optional(),
  limite: z.coerce.number().int().min(1).max(500).default(200),
})
```

En maille `cp` **sans parent**, la route borne à 200 unités et renseigne
`n_total` — la page doit dire « 200 sur 2 041, les plus déréglées », jamais
laisser croire à une liste exhaustive.

- [ ] **Step 4: Tests**

Run: `npx tsc --noEmit && npx vitest run`

- [ ] **Step 5: Commit**

```bash
git add sql/165_alignement_geographique.sql "app/api/campaigns/[campaignId]/alignement/maille/route.ts" ARCHITECTURE.md
git commit -m "feat(alignement): agregation par maille via la jointure INSEE, les DROM cessent de s effondrer sur 97"
```

---

## Task 7: Invariance du score au changement de maille

**Files:**
- Test: `tests/unit/campagne/alignement-invariance.test.ts`

> C'est le test le plus important du chantier. Le prompt en fait une règle non
> négociable, et c'est exactement le genre de défaut qui ne se voit pas à
> l'œil : un score qui monte en vue Région a l'air d'une bonne nouvelle.

- [ ] **Step 1: Écrire le test**

```ts
// tests/unit/campagne/alignement-invariance.test.ts
import { describe, it, expect } from 'vitest'
import { calculerAlignement, type UniteAlignement } from '@/lib/campagne/alignement'

/** Deux CP d'un même département, déréglés en sens OPPOSÉS. */
const CPS: UniteAlignement[] = [
  { code: '13001', reel: 200, plan: 1000 },  // très sous-pression
  { code: '13002', reel: 1800, plan: 1000 }, // très sur-pression
]
/** Le même département, agrégé : les deux écarts s'annulent parfaitement. */
const DEPT: UniteAlignement[] = [{ code: '13', reel: 2000, plan: 2000 }]

describe('invariance du score à la maille', () => {
  it('agréger AVANT de calculer efface les écarts — c est le piège à éviter', () => {
    expect(calculerAlignement(DEPT, 10, 1).score).toBe(100)
    expect(calculerAlignement(CPS, 10, 1).score).toBeLessThan(100)
  })

  it('l écart entre les deux lectures est massif, pas marginal', () => {
    const auCp = calculerAlignement(CPS, 10, 1).score
    const auDept = calculerAlignement(DEPT, 10, 1).score
    // 100 contre 65 : un score calculé à la mauvaise maille ne se corrige pas
    // « à peu près », il raconte l'inverse de la vérité.
    expect(auDept - auCp).toBeGreaterThan(30)
  })
})
```

- [ ] **Step 2: Lancer et vérifier qu'il passe**

Run: `npx vitest run tests/unit/campagne/alignement-invariance.test.ts`
Expected: PASS — 2 tests

- [ ] **Step 3: Vérifier l'invariance CÔTÉ BASE**

```sql
-- Le score doit être IDENTIQUE quelle que soit la maille demandée ailleurs :
-- calculer_alignement_geo n'accepte aucun paramètre de maille, par construction.
select (calculer_alignement_geo('dccc0000-0000-4000-8000-000000000002') ->> 'score')::int as score,
       calculer_alignement_geo('dccc0000-0000-4000-8000-000000000002') ->> 'maille_calcul' as maille;
```
Expected: `maille_calcul = 'cp'` toujours, quelle que soit la vue.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/campagne/alignement-invariance.test.ts
git commit -m "test(alignement): le score ne doit pas monter quand on dezoome"
```

---

## Task 8: Palette divergente, dans les deux thèmes

**Files:**
- Modify: `app/globals.css` (tokens `--diverge-*`, `:root` et `html.light`)
- Create: `lib/campagne/palette-divergente.ts`
- Test: `tests/unit/campagne/palette-divergente.test.ts`

**Interfaces:**
- Produit : `BORNES_DIVERGENTES: readonly number[]` · `couleurDivergente(ecartPct: number, theme: 'dark'|'light'): string` · `RAMPE_MAPLIBRE: Record<'dark'|'light', string[]>`

- [ ] **Step 1: Écrire le test**

```ts
// tests/unit/campagne/palette-divergente.test.ts
import { describe, it, expect } from 'vitest'
import { BORNES_DIVERGENTES, couleurDivergente, RAMPE_MAPLIBRE } from '@/lib/campagne/palette-divergente'

describe('échelle divergente', () => {
  it('est symétrique autour de zéro — sinon la sur-pression paraît moins grave', () => {
    const neg = BORNES_DIVERGENTES.filter(b => b < 0).map(Math.abs).sort((a, b) => a - b)
    const pos = BORNES_DIVERGENTES.filter(b => b > 0).sort((a, b) => a - b)
    expect(neg).toEqual(pos)
  })

  it('donne la même couleur neutre au centre dans les deux thèmes… non : une par thème', () => {
    expect(couleurDivergente(0, 'dark')).not.toBe(couleurDivergente(0, 'light'))
  })

  it('rend des hex littéraux — MapLibre ne résout pas var()', () => {
    for (const theme of ['dark', 'light'] as const) {
      for (const c of RAMPE_MAPLIBRE[theme]) {
        expect(c).toMatch(/^#[0-9a-fA-F]{6}$/)
      }
    }
  })

  it('a autant de couleurs que de tranches', () => {
    expect(RAMPE_MAPLIBRE.dark).toHaveLength(BORNES_DIVERGENTES.length + 1)
    expect(RAMPE_MAPLIBRE.light).toHaveLength(BORNES_DIVERGENTES.length + 1)
  })

  it('classe correctement les trois cas métier', () => {
    expect(couleurDivergente(-60, 'dark')).toBe(RAMPE_MAPLIBRE.dark[0])
    expect(couleurDivergente(0, 'dark')).toBe(RAMPE_MAPLIBRE.dark[3])
    expect(couleurDivergente(60, 'dark')).toBe(RAMPE_MAPLIBRE.dark[6])
  })
})
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `npx vitest run tests/unit/campagne/palette-divergente.test.ts`
Expected: FAIL — module introuvable

- [ ] **Step 3: Ajouter les tokens CSS**

Dans `app/globals.css`, bloc `:root` (dark), après les tokens de statut :

```css
    /* ── Échelle divergente d'alignement (sous-pression ↔ conforme ↔ sur-pression)
       Le sens se lit AUSSI par la position sur la barre : la teinte seule ne
       suffit pas pour un daltonien. */
    --diverge-sous-3: #c2410c;
    --diverge-sous-2: #ea7c4a;
    --diverge-sous-1: #f0b48c;
    --diverge-neutre: #4a4a4a;
    --diverge-sur-1:  #8fb8d8;
    --diverge-sur-2:  #4a86b8;
    --diverge-sur-3:  #1f5c8f;
```

et le miroir dans `html.light` (mêmes rôles, contrastes remontés) :

```css
    --diverge-sous-3: #9a2f08;
    --diverge-sous-2: #cc5f27;
    --diverge-sous-1: #e8a878;
    --diverge-neutre: #c6d2cf;
    --diverge-sur-1:  #7ba7cc;
    --diverge-sur-2:  #2f6fa3;
    --diverge-sur-3:  #14496f;
```

- [ ] **Step 4: Écrire le module**

```ts
// lib/campagne/palette-divergente.ts

/**
 * Échelle divergente de l'écart au plan.
 *
 * Deux consommateurs, deux formats :
 *  - le DOM lit les tokens `--diverge-*` de globals.css ;
 *  - MapLibre ne résout PAS `var()` dans `paint` et doit recevoir des hex
 *    littéraux — d'où la duplication assumée ci-dessous. Elle est verrouillée
 *    par tests/unit/campagne/palette-divergente.test.ts.
 */

/** Bornes en % d'écart au plan. Symétriques : la sur-pression pèse autant. */
export const BORNES_DIVERGENTES = [-50, -25, -10, 10, 25, 50] as const

export const RAMPE_MAPLIBRE: Record<'dark' | 'light', string[]> = {
  dark:  ['#c2410c', '#ea7c4a', '#f0b48c', '#4a4a4a', '#8fb8d8', '#4a86b8', '#1f5c8f'],
  light: ['#9a2f08', '#cc5f27', '#e8a878', '#c6d2cf', '#7ba7cc', '#2f6fa3', '#14496f'],
}

export const LIBELLES_TRANCHES = [
  'moins de la moitié', 'sous-pression', 'légèrement sous',
  'conforme', 'légèrement au-dessus', 'sur-pression', 'plus de 50 % au-dessus',
] as const

export function couleurDivergente(ecartPct: number, theme: 'dark' | 'light'): string {
  const rampe = RAMPE_MAPLIBRE[theme]
  let i = 0
  while (i < BORNES_DIVERGENTES.length && ecartPct >= BORNES_DIVERGENTES[i]) i++
  return rampe[i]
}
```

- [ ] **Step 5: Lancer le test**

Run: `npx vitest run tests/unit/campagne/palette-divergente.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 6: Commit**

```bash
git add app/globals.css lib/campagne/palette-divergente.ts tests/unit/campagne/palette-divergente.test.ts
git commit -m "feat(design): echelle divergente d alignement, dark et clair, lisible daltonien"
```

---

## Task 9: Barre de maille et fil d'Ariane

**Files:**
- Create: `components/campagne/suivi-v2/BarreMaille.tsx`
- Test: `tests/unit/campagne/barre-maille.test.ts`

**Interfaces:**
- Consomme : `useCampagneSession()` (Task 2), `MAILLES` (Task 1)
- Produit : `<BarreMaille nUnites={number} nTotal={number} />` · `libelleFilAriane(session, nomParent): string[]`

- [ ] **Step 1: Écrire le test de la logique pure**

```ts
// tests/unit/campagne/barre-maille.test.ts
import { describe, it, expect } from 'vitest'
import { libelleFilAriane, LIBELLES_MAILLE } from '@/components/campagne/suivi-v2/BarreMaille'

describe('fil d Ariane', () => {
  it('annonce France entière quand aucun parent n est posé', () => {
    expect(libelleFilAriane('departement', null, null)).toEqual(['France entière'])
  })

  it('ajoute le nom du parent, jamais son code brut', () => {
    expect(libelleFilAriane('departement', '11', 'Île-de-France'))
      .toEqual(['France entière', 'Île-de-France'])
  })

  it('retombe sur le code si le nom n est pas encore chargé — jamais un trou', () => {
    expect(libelleFilAriane('cp', '13', null)).toEqual(['France entière', '13'])
  })

  it('nomme les mailles en sentence case', () => {
    expect(LIBELLES_MAILLE).toEqual({ region: 'Région', departement: 'Département', cp: 'Code postal' })
  })
})
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `npx vitest run tests/unit/campagne/barre-maille.test.ts`
Expected: FAIL

- [ ] **Step 3: Écrire le composant**

```tsx
// components/campagne/suivi-v2/BarreMaille.tsx
'use client'
import { useCampagneSession } from '@/lib/campagne/CampagneSessionContext'
import { MAILLES, type Maille } from '@/lib/campagne/session-types'
import { formaterNombre } from '@/lib/format/nombre'

export const LIBELLES_MAILLE: Record<Maille, string> = {
  region: 'Région', departement: 'Département', cp: 'Code postal',
}

/** Logique pure, testée sans DOM. */
export function libelleFilAriane(_maille: Maille, parent: string | null, nomParent: string | null): string[] {
  const fil = ['France entière']
  if (parent) fil.push(nomParent ?? parent)
  return fil
}

export function BarreMaille({ nUnites, nTotal, nomParent }: {
  nUnites: number; nTotal: number; nomParent: string | null
}) {
  const { session, majSession } = useCampagneSession()
  const fil = libelleFilAriane(session.maille, session.parent, nomParent)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16,
      padding: '10px 14px',
      background: 'var(--bg-level-2)',
      borderBottom: '1px solid var(--border-subtle)',
    }}>
      <nav aria-label="Fil d'Ariane" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {fil.map((seg, i) => (
          <span key={seg} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {i > 0 && <span style={{ color: 'var(--text-tertiary)' }}>›</span>}
            {i < fil.length - 1 ? (
              <button
                onClick={() => majSession({ parent: null, uniteSelectionnee: null })}
                style={{
                  border: 0, background: 'none', padding: 0, cursor: 'pointer',
                  color: 'var(--brand-teal)', fontSize: 13, textDecoration: 'underline',
                  textUnderlineOffset: 3,
                }}
              >{seg}</button>
            ) : (
              <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 500 }}>{seg}</span>
            )}
          </span>
        ))}
      </nav>

      <div role="group" aria-label="Maille d'affichage" style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
        {MAILLES.map(m => (
          <button
            key={m}
            aria-pressed={session.maille === m}
            onClick={() => majSession({ maille: m })}
            style={{
              border: '0.5px solid ' + (session.maille === m ? 'var(--brand-teal)' : 'var(--border-default)'),
              background: session.maille === m ? 'var(--brand-teal-10)' : 'transparent',
              color: session.maille === m ? 'var(--brand-teal)' : 'var(--text-secondary)',
              borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
            }}
          >{LIBELLES_MAILLE[m]}</button>
        ))}
        <span style={{
          marginLeft: 8, alignSelf: 'center', fontSize: 11,
          fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-tertiary)',
        }}>
          {nUnites < nTotal
            ? `${formaterNombre(nUnites)} sur ${formaterNombre(nTotal)}, les plus déréglées`
            : `${formaterNombre(nTotal)} unités`}
        </span>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Lancer le test**

Run: `npx vitest run tests/unit/campagne/barre-maille.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add components/campagne/suivi-v2/BarreMaille.tsx tests/unit/campagne/barre-maille.test.ts
git commit -m "feat(suivi): barre de maille et fil d Ariane branches sur la session"
```

---

## Task 10: Le score à l'écran, et sa mention de maille

**Files:**
- Create: `components/campagne/suivi-v2/ScoreAlignement.tsx`
- Create: `components/campagne/suivi-v2/TroisComposantes.tsx`

**Interfaces:**
- Consomme : `GET /api/campaigns/[id]/alignement` (Task 5)
- Produit : `<ScoreAlignement data={ReponseAlignement} />` · `<TroisComposantes data={ReponseAlignement} />`

- [ ] **Step 1: Écrire le composant du score**

Trois exigences non négociables, chacune visible à l'écran :
1. le score en très grand (104 px, `--brand-teal`), avec `/100` en 26 px ;
2. la variation 7 jours, calculée depuis `score_prev_7j` ;
3. **la mention « Toujours calculé au code postal, quelle que soit la maille affichée. »** — c'est ce qui empêche l'utilisateur de mal lire un score qui ne bouge pas quand il change de vue ;
4. si `plan_divergent === true`, un bandeau d'avertissement remplace le score : le plan diverge entre acteurs, le nombre n'est pas fiable.

```tsx
// components/campagne/suivi-v2/ScoreAlignement.tsx (extrait de la partie qui porte les règles)
{data.plan_divergent ? (
  <div role="alert" style={{
    background: 'rgba(247,183,49,0.1)', border: '0.5px solid rgba(247,183,49,0.2)',
    color: 'var(--warning)', borderRadius: 6, padding: 12, fontSize: 13,
  }}>
    Le plan diverge entre acteurs sur au moins un code postal. Le score n'est pas
    calculable de façon fiable tant que ce n'est pas tranché.
  </div>
) : (
  <>
    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
      Alignement géographique
    </div>
    <div style={{
      fontSize: 104, lineHeight: 0.88, letterSpacing: '-0.05em',
      color: 'var(--brand-teal)', display: 'flex', alignItems: 'baseline', gap: 6,
    }}>
      {data.score}
      <span style={{ fontSize: 26, color: 'var(--text-tertiary)' }}>/100</span>
    </div>
    <Variation valeur={data.score - data.score_prev_7j} />
    <Echelle score={data.score} etalon={data.etalon?.score_median ?? null} />
    <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 10 }}>
      Toujours calculé au code postal, quelle que soit la maille affichée.
    </p>
  </>
)}
```

- [ ] **Step 2: Écrire les trois composantes**

Conformes (`conformes_pct`), sous-pression (`sous_pression_pct` + `sous_pression_imps` impressions), sur-pression (`sur_pression_pct` + `sur_pression_eur` € déplaçables). Chacune avec sa phrase d'explication, reprise mot pour mot de la maquette.

- [ ] **Step 3: Vérifier à l'écran, dans les DEUX thèmes**

Run: `npm run dev`, ouvrir `/map?campagne=dccc0000-0000-4000-8000-000000000002&onglet=suivi`, basculer le thème avec `ThemeToggle`.
Expected: aucune couleur ne « saute », aucun texte illisible, le score reste `var(--brand-teal)` dans les deux.

- [ ] **Step 4: Commit**

```bash
git add components/campagne/suivi-v2/ScoreAlignement.tsx components/campagne/suivi-v2/TroisComposantes.tsx
git commit -m "feat(suivi): le score signature et ses trois composantes"
```

---

## Task 11: Bandeau d'avancement, constats calculés, coût et rythme

**Files:**
- Create: `components/campagne/suivi-v2/BandeauAvancement.tsx`
- Create: `components/campagne/suivi-v2/ConstatsCorrection.tsx`
- Create: `components/campagne/suivi-v2/CoutEtRythme.tsx`
- Create: `app/api/campaigns/[campaignId]/alignement/constats/route.ts`
- Test: `tests/unit/campagne/constats.test.ts`

**Interfaces:**
- Produit : `calculerConstats(data): Constat[]` où `interface Constat { id: string; titre: string; action: string; cible: string | null }`

> **Les constats sont CALCULÉS, jamais rédigés en dur.** Trois familles, et un
> constat qui ne s'applique pas ne s'affiche pas — il n'y a donc pas toujours
> trois lignes.

- [ ] **Step 1: Écrire le test**

```ts
// tests/unit/campagne/constats.test.ts
import { describe, it, expect } from 'vitest'
import { calculerConstats } from '@/lib/campagne/constats'

describe('constats de correction', () => {
  it('n affiche rien quand tout va bien', () => {
    expect(calculerConstats({
      unites: [{ code: '75', nom: 'Paris', ecart_pct: 2, impressions: 1000, cpm: 6.5 }],
      cpm_moyen: 6.5, canaux: [{ code: 'dv360', cpm: 6.4 }],
    })).toEqual([])
  })

  it('nomme les départements qui concentrent la sous-pression', () => {
    const c = calculerConstats({
      unites: [
        { code: '13', nom: 'Bouches-du-Rhône', ecart_pct: -52, impressions: 400, cpm: 6.5 },
        { code: '59', nom: 'Nord', ecart_pct: -48, impressions: 420, cpm: 6.5 },
        { code: '75', nom: 'Paris', ecart_pct: 1, impressions: 5000, cpm: 6.5 },
      ],
      cpm_moyen: 6.5, canaux: [],
    })
    expect(c[0].titre).toContain('13')
    expect(c[0].titre).toContain('59')
  })

  it('signale un canal nettement plus cher que la moyenne', () => {
    const c = calculerConstats({
      unites: [], cpm_moyen: 6.5,
      canaux: [{ code: 'tiktok', cpm: 9.2 }, { code: 'dv360', cpm: 6.1 }],
    })
    expect(c.some(x => x.titre.includes('tiktok') && x.titre.includes('41'))).toBe(true)
  })

  it('rend au plus trois constats, les plus lourds d abord', () => {
    const c = calculerConstats({
      unites: Array.from({ length: 20 }, (_, i) => ({
        code: String(i), nom: `d${i}`, ecart_pct: -60, impressions: 100, cpm: 6.5,
      })),
      cpm_moyen: 6.5, canaux: [{ code: 'tiktok', cpm: 12 }],
    })
    expect(c.length).toBeLessThanOrEqual(3)
  })
})
```

- [ ] **Step 2: Lancer pour vérifier l'échec, puis implémenter**

Run: `npx vitest run tests/unit/campagne/constats.test.ts` → FAIL, puis écrire `lib/campagne/constats.ts` avec les trois familles :
- **concentration de la sous-pression** : les unités dont `ecart_pct < -tolerance`, triées par volume manquant, les 2 premières nommées ;
- **concentration de la sur-pression** : symétrique, avec le montant € déplaçable ;
- **canal le plus cher** : `cpm > cpm_moyen × 1.25`, écart exprimé en %.

- [ ] **Step 3: Bandeau d'avancement**

Trois barres **sur la même échelle** (temps écoulé, budget consommé, volume livré) plus un repère vertical marquant la position du temps sur les deux barres du bas, et une phrase chiffrée sur ce que le retard implique en fin de campagne. Données : `get_campaign_suivi` (`pacing`, `objective`), déjà existant.

- [ ] **Step 4: Lancer les tests et vérifier les deux thèmes**

Run: `npx vitest run && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add lib/campagne/constats.ts components/campagne/suivi-v2/BandeauAvancement.tsx components/campagne/suivi-v2/ConstatsCorrection.tsx components/campagne/suivi-v2/CoutEtRythme.tsx "app/api/campaigns/[campaignId]/alignement/constats/route.ts" tests/unit/campagne/constats.test.ts
git commit -m "feat(suivi): avancement, constats calcules et couts — aucun texte redige en dur"
```

---

## Task 12: Le graphique qui explique le score

**Files:**
- Create: `components/campagne/suivi-v2/GraphiqueEcart.tsx`
- Modify: `sql/165_alignement_geographique.sql` (ajout `alignement_dispersion_cp`)
- Create: `app/api/campaigns/[campaignId]/alignement/dispersion/route.ts`

**Interfaces:**
- Produit : `alignement_dispersion_cp(p_campaign_id uuid, p_parent text, p_tolerance numeric) → jsonb` → `{ tranches: [{ borne_basse, borne_haute, n_cp, impressions }] }`

> **Deux graphiques, un seul composant.** En Région et Département : courbe du
> plan en pointillés, courbe du réel en plein, deux surfaces d'écart colorées.
> En maille CP, **la courbe n'a plus de sens** — 2 000 points alignés ne
> racontent rien — elle est remplacée par un histogramme de dispersion des
> écarts, tranche conforme au centre, couleurs divergentes de part et d'autre.

- [ ] **Step 1: RPC de dispersion**

```sql
create or replace function alignement_dispersion_cp(
  p_campaign_id uuid,
  p_parent      text default null,
  p_tolerance   numeric default null
) returns jsonb
language sql
security definer
set search_path = public
as $$
  with bornes as (select unnest(array[-50,-25,-10,10,25,50]) as b),
  cp as (
    select r.postal_code,
           sum(r.impressions)::numeric   as reel,
           max(r.planned_share)::numeric as part
      from campaign_cp_rollup r
      join ref_codes_postaux rcp on rcp.code_postal = r.postal_code
      join ref_departements  rd  on rd.code_dept   = rcp.code_dept
     where r.campaign_id = p_campaign_id
       and (p_parent is null or rd.code_dept = p_parent or rd.code_region = p_parent)
     group by r.postal_code
  ),
  tot as (select sum(reel) tr, sum(part) tp from cp),
  ecarts as (
    select cp.postal_code, cp.reel,
           ((cp.reel / nullif((cp.part / nullif(t.tp,0)) * t.tr, 0)) - 1) * 100 as ecart
      from cp cross join tot t
  ),
  classe as (
    select width_bucket(ecart, array[-50,-25,-10,10,25,50]) as tranche,
           count(*) n_cp, sum(reel) impressions
      from ecarts group by 1
  )
  select jsonb_build_object('tranches', jsonb_agg(
    jsonb_build_object('tranche', tranche, 'n_cp', n_cp, 'impressions', impressions)
    order by tranche))
  from classe;
$$;

revoke all on function alignement_dispersion_cp(uuid, text, numeric) from public, anon, authenticated;
grant execute on function alignement_dispersion_cp(uuid, text, numeric) to service_role;
```

- [ ] **Step 2: Composant, avec bascule sur la maille**

```tsx
// components/campagne/suivi-v2/GraphiqueEcart.tsx — la décision de forme
const { session } = useCampagneSession()
// En maille CP, une courbe de 2 000 points ne raconte rien : on change de
// forme, pas seulement d'échelle.
return session.maille === 'cp'
  ? <HistogrammeDispersion parent={session.parent} />
  : <CourbePlanReel maille={session.maille} parent={session.parent} />
```

Les couleurs des surfaces et des barres viennent de `RAMPE_MAPLIBRE[theme]` (Task 8) — Recharts accepte des hex littéraux, pas des `var()`. Le composant doit donc appeler `useTheme()` et relire la rampe à chaque bascule.

- [ ] **Step 3: Vérifier dans les deux thèmes et aux trois mailles**

Run: `npm run dev`, parcourir Région → Département → CP, basculer le thème à chaque étape.

- [ ] **Step 4: Commit**

```bash
git add sql/165_alignement_geographique.sql components/campagne/suivi-v2/GraphiqueEcart.tsx "app/api/campaigns/[campaignId]/alignement/dispersion/route.ts" ARCHITECTURE.md
git commit -m "feat(suivi): le graphique change de FORME en maille CP, pas seulement d echelle"
```

---

## Task 13: Les trois cartes et la vue Diffusion

**Files:**
- Create: `components/campagne/suivi-v2/TrioCartes.tsx`
- Create: `components/campagne/suivi-v2/CarteVignette.tsx`
- Create: `app/map/_components/DiffusionMapLayer.tsx`
- Modify: `app/map/page.tsx` (clic carte → `uniteSelectionnee`)

**Interfaces:**
- Consomme : `alignement_par_maille` (Task 6), `RAMPE_MAPLIBRE` (Task 8), session (Task 2)
- Produit : `<TrioCartes />` · `<CarteVignette type="impressions"|"variable"|"alignement" />`

> **Trois pièges, chacun déjà vécu dans ce dépôt :**
> 1. Les couches carte lisent leurs couleurs par `getComputedStyle` **une seule
>    fois à la création** et ne se réabonnent pas au thème (`SuiviMapLayer.tsx:45-53`,
>    `CivicHealthMapLayer.tsx:99`). Les trois vignettes DOIVENT avoir un effet
>    `[theme]` qui réapplique la rampe, sur le patron de `useMapInit.ts:1091-1102`.
> 2. Un `interpolate` MapLibre à bornes non croissantes est rejeté **en silence**.
>    Vérifier `BORNES_DIVERGENTES` strictement croissant avant de construire
>    l'expression.
> 3. La valeur d'un CP est appliquée à ses carreaux, et **la légende doit le
>    dire** : ne jamais désagréger sous le code postal.

- [ ] **Step 1: Vignette générique**

Même projection et même cadrage pour les trois (`fitBounds` partagé sur la bbox du périmètre actif), mini-échelle propre à chacune, **pas d'annotation de noms** (trop petit — les noms restent sur la grande carte), zones hors périmètre **grisées et non masquées**, clic → `majSession({ vue: 'carte' })` avec le calque correspondant déjà actif.

- [ ] **Step 2: Les trois sources**

| # | Vignette | Échelle | Source |
|---|---|---|---|
| 1 | Impressions | séquentielle | `alignement_par_maille` → `impressions` |
| 2 | Variable du plan | séquentielle | `indicator_cp_values` pour `bidding_strategies.in_zone_weights->>'variable_code'`, avec sélecteur d'un autre indicateur de `cible_indicator_registry` |
| 3 | Alignement | **divergente** | `alignement_par_maille` → `ecart_pct` |

- [ ] **Step 3: Sélection bidirectionnelle**

Il n'existe **aucun** canal clic-carte → sélection aujourd'hui : les 14 couches cliquables ouvrent un popup éphémère. À construire :
- clic sur une zone → `majSession({ uniteSelectionnee: code })` ;
- `uniteSelectionnee` → surlignage sur la carte **et** remontée + mise en évidence de la ligne dans `TableauDeregles` ;
- épingle d'une ligne → `majSession({ vue: 'carte', uniteSelectionnee: code })` + centrage.

- [ ] **Step 4: Vérifier**

Run: `npm run dev`. Cliquer un département sur la vignette 3 → la ligne correspondante doit être visible et surlignée dans le tableau. Basculer vers la carte, revenir : **même maille, même fil d'Ariane, même tri, même défilement**.

- [ ] **Step 5: Commit**

```bash
git add components/campagne/suivi-v2/TrioCartes.tsx components/campagne/suivi-v2/CarteVignette.tsx app/map/_components/DiffusionMapLayer.tsx app/map/page.tsx ARCHITECTURE.md
git commit -m "feat(suivi): trois cartes synchronisees et selection bidirectionnelle carte/tableau"
```

---

## Task 14: Tableau des unités déréglées, qui a diffusé, détail technique

**Files:**
- Create: `components/campagne/suivi-v2/TableauDeregles.tsx`
- Create: `components/campagne/suivi-v2/QuiADiffuse.tsx`
- Create: `components/campagne/suivi-v2/DetailTechnique.tsx`
- Test: `tests/unit/campagne/tableau-deregles.test.ts`

**Interfaces:**
- Consomme : `alignement_par_maille` (Task 6), `RAMPE_MAPLIBRE` (Task 8), session (Task 2)
- Produit : `<TableauDeregles unites={UniteMaille[]} />` · `<QuiADiffuse canaux={CanalRow[]} cpmMoyen={number} />` · `<DetailTechnique campaignId={string} />` · `trierDeregles(unites, sens: 'sous'|'sur'): UniteMaille[]` · `largeurBarre(ecartPct: number): { cote: 'gauche'|'droite'; pct: number }`

- [ ] **Step 1: Écrire le test de la logique pure**

```ts
// tests/unit/campagne/tableau-deregles.test.ts
import { describe, it, expect } from 'vitest'
import { trierDeregles, largeurBarre } from '@/components/campagne/suivi-v2/TableauDeregles'

const UNITES = [
  { code: '13', nom: 'Bouches-du-Rhône', ecart_pct: -52, impressions: 400, cpm: 6.5, spend: 2600, plan: 830 },
  { code: '75', nom: 'Paris', ecart_pct: 31, impressions: 5000, cpm: 6.1, spend: 30500, plan: 3800 },
  { code: '59', nom: 'Nord', ecart_pct: -4, impressions: 900, cpm: 6.4, spend: 5760, plan: 940 },
]

describe('tableau des unités déréglées', () => {
  it('en bascule sous-pression, ne montre QUE les unités sous le plan', () => {
    const r = trierDeregles(UNITES, 'sous')
    expect(r.every(u => u.ecart_pct < 0)).toBe(true)
    expect(r[0].code).toBe('13') // la pire d'abord
  })

  it('en bascule sur-pression, ne montre QUE celles au-dessus', () => {
    const r = trierDeregles(UNITES, 'sur')
    expect(r.map(u => u.code)).toEqual(['75'])
  })

  it('la barre part à gauche pour un manque, à droite pour un excès', () => {
    expect(largeurBarre(-52).cote).toBe('gauche')
    expect(largeurBarre(31).cote).toBe('droite')
  })

  it('la barre est centrée sur le plan : zéro ne dessine rien d un côté ni de l autre', () => {
    expect(largeurBarre(0).pct).toBe(0)
  })

  it('borne la barre à 100 % pour qu une unité à -95 % ne déborde pas de la cellule', () => {
    expect(largeurBarre(-300).pct).toBeLessThanOrEqual(100)
    expect(largeurBarre(900).pct).toBeLessThanOrEqual(100)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run tests/unit/campagne/tableau-deregles.test.ts`
Expected: FAIL — module introuvable

- [ ] **Step 3: Écrire la logique pure et le tableau**

```ts
// components/campagne/suivi-v2/TableauDeregles.tsx (partie pure, testée)
export interface UniteMaille {
  code: string; nom: string; ecart_pct: number
  impressions: number; cpm: number; spend: number; plan: number
}

/** Sept lignes maximum : au-delà, la liste cesse d'être lisible d'un coup d'œil. */
export const LIGNES_MAX = 7

export function trierDeregles(unites: UniteMaille[], sens: 'sous' | 'sur'): UniteMaille[] {
  return unites
    .filter(u => (sens === 'sous' ? u.ecart_pct < 0 : u.ecart_pct > 0))
    .sort((a, b) => Math.abs(b.ecart_pct) - Math.abs(a.ecart_pct))
    .slice(0, LIGNES_MAX)
}

/**
 * Barre divergente centrée sur le plan. Le sens se lit par le CÔTÉ, pas
 * seulement par la teinte — c'est ce qui la rend lisible pour un daltonien.
 * Bornée à 100 % : une unité à -95 % ne doit pas déborder de sa cellule.
 */
export function largeurBarre(ecartPct: number): { cote: 'gauche' | 'droite'; pct: number } {
  return {
    cote: ecartPct < 0 ? 'gauche' : 'droite',
    pct: Math.min(100, Math.abs(ecartPct)),
  }
}
```

Le rendu : titre et en-têtes qui **suivent la maille** (« Régions déréglées » / « Départements déréglés » / « Codes postaux déréglés », via `LIBELLES_MAILLE` de Task 9), bascule `aria-pressed` sous-pression / sur-pression, clic sur une ligne → `majSession({ parent: code, maille: niveauSuivant })` pour descendre d'un niveau, épingle → `majSession({ vue: 'carte', uniteSelectionnee: code })`, et un lien « Voir les N restantes » qui charge la table complète **à la demande**, jamais au montage.

- [ ] **Step 4: Qui a diffusé**

Barres compactes par partenaire (`GET /api/digital/[id]/actors`, route conservée), avec le **CPM signalé quand il dépasse nettement la moyenne** — seuil `cpm > cpm_moyen × 1.25`, le même que celui des constats de Task 11, importé et non recopié.

- [ ] **Step 5: Détail technique, replié par défaut**

`<details>` natif (pas de state), contenant : budget cumulé contre trajectoire idéale (données `get_campaign_suivi` → `daily`), et la réconciliation DSP contre ad server (`GET /api/digital/[id]/reconcile`, route conservée, plus le bouton `reconcile/pull`). C'est ici que `FinalReport.tsx` est réintégré quand `strategyStatus === 'completed'`.

- [ ] **Step 6: Lancer les tests**

Run: `npx vitest run tests/unit/campagne/ && npx tsc --noEmit`
Expected: PASS — 5 nouveaux tests, aucune erreur de type

- [ ] **Step 7: Commit**

```bash
git add components/campagne/suivi-v2/TableauDeregles.tsx components/campagne/suivi-v2/QuiADiffuse.tsx components/campagne/suivi-v2/DetailTechnique.tsx tests/unit/campagne/tableau-deregles.test.ts
git commit -m "feat(suivi): tableau divergent, partenaires et detail technique replie"
```

---

## Task 15: Barre de contexte commune et assemblage de l'écran

**Files:**
- Create: `components/campagne/BarreContexteCampagne.tsx`
- Create: `components/campagne/suivi-v2/SuiviV2.tsx`
- Modify: `components/magelian/MagelianOverlay.tsx` (monte `SuiviV2` au lieu de `CampaignSuivi`)
- Modify: `app/map/page.tsx` (monte `BarreContexteCampagne` en vue carte)
- Test: `tests/unit/campagne/bascule-vue.test.ts`

**Interfaces:**
- Consomme : tous les blocs des Tasks 9 à 14
- Produit : `<BarreContexteCampagne />` · `<SuiviV2 campaignId={string} />`

> **Une barre identique dans les deux vues** : campagne, DSP, période, score
> d'alignement, bascule. Le sélecteur de campagne y est, donc changer de
> campagne ne demande jamais de rouvrir un écran et **conserve la vue courante**.

- [ ] **Step 1: Écrire le test de la bascule**

```ts
// tests/unit/campagne/bascule-vue.test.ts
import { describe, it, expect } from 'vitest'
import { SESSION_DEFAUT } from '@/lib/campagne/session-url'
import { appliquerBascule, appliquerChangementCampagne } from '@/lib/campagne/transitions'

describe('bascule entre carte et suivi', () => {
  it('ne change QUE la vue — maille, fil d Ariane, tri et sélection survivent', () => {
    const avant = {
      ...SESSION_DEFAUT, campaignId: 'a', vue: 'suivi' as const,
      maille: 'cp' as const, parent: '13', uniteSelectionnee: '13001', tri: 'meilleur' as const,
    }
    const apres = appliquerBascule(avant)
    expect(apres.vue).toBe('carte')
    expect({ ...apres, vue: avant.vue }).toEqual(avant)
  })

  it('revient exactement au même état au second aller-retour', () => {
    const s = { ...SESSION_DEFAUT, campaignId: 'a', maille: 'region' as const, parent: null }
    expect(appliquerBascule(appliquerBascule(s))).toEqual(s)
  })

  it('changer de campagne CONSERVE la vue courante', () => {
    const s = { ...SESSION_DEFAUT, campaignId: 'a', vue: 'carte' as const, maille: 'cp' as const }
    expect(appliquerChangementCampagne(s, 'b').vue).toBe('carte')
  })

  it('changer de campagne remet à zéro le fil d Ariane et la sélection', () => {
    // Un département sélectionné dans la campagne A n'a aucune raison d'être
    // pertinent dans la campagne B — et il peut n'y exister aucune donnée.
    const s = { ...SESSION_DEFAUT, campaignId: 'a', parent: '11', uniteSelectionnee: '75' }
    const apres = appliquerChangementCampagne(s, 'b')
    expect(apres.parent).toBeNull()
    expect(apres.uniteSelectionnee).toBeNull()
  })

  it('changer de campagne conserve la MAILLE — c est une préférence de lecture', () => {
    const s = { ...SESSION_DEFAUT, campaignId: 'a', maille: 'region' as const }
    expect(appliquerChangementCampagne(s, 'b').maille).toBe('region')
  })
})
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `npx vitest run tests/unit/campagne/bascule-vue.test.ts`
Expected: FAIL — `@/lib/campagne/transitions` introuvable

- [ ] **Step 3: Écrire les transitions pures**

```ts
// lib/campagne/transitions.ts
import type { CampagneSession } from './session-types'

/** La bascule est un changement de VUE, pas une navigation : rien d'autre ne bouge. */
export function appliquerBascule(s: CampagneSession): CampagneSession {
  return { ...s, vue: s.vue === 'suivi' ? 'carte' : 'suivi' }
}

/**
 * Changer de campagne conserve la vue et la maille (préférences de lecture),
 * mais remet à zéro le fil d'Ariane et la sélection : ils désignent des codes
 * dont rien ne garantit qu'ils portent des données dans la nouvelle campagne.
 */
export function appliquerChangementCampagne(s: CampagneSession, campaignId: string): CampagneSession {
  return { ...s, campaignId, parent: null, uniteSelectionnee: null }
}
```

- [ ] **Step 4: Assembler `SuiviV2`**

Ordre exact du §2 de la spec : `BarreMaille` → rangée 1 (`ScoreAlignement` | `BandeauAvancement`) → rangée 2 (`GraphiqueEcart` | `TrioCartes`) → `TroisComposantes` → `ConstatsCorrection` → `CoutEtRythme` → `TableauDeregles` → `QuiADiffuse` → `DetailTechnique`.

**Chargement sans écran blanc** : pendant qu'une nouvelle campagne ou une nouvelle maille charge, les chiffres précédents restent affichés en `opacity: 0.5` avec un indicateur discret. Jamais de remise à zéro visuelle, jamais de squelette qui remplace des données déjà justes.

**Au plus 3 appels Supabase en parallèle** (règle `CLAUDE.md`) : `alignement`, `alignement/maille`, `suivi` d'abord ; `dispersion`, `constats`, `actors`, `reconcile` ensuite, et seulement s'ils sont visibles.

- [ ] **Step 5: État d'erreur explicite**

Si la campagne n'existe plus ou n'est plus accessible : un état clair proposant d'en choisir une, **jamais une erreur brute**.

- [ ] **Step 6: Lancer les tests et le build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: PASS, zéro erreur

- [ ] **Step 7: Commit**

```bash
git add lib/campagne/transitions.ts components/campagne/BarreContexteCampagne.tsx components/campagne/suivi-v2/SuiviV2.tsx components/magelian/MagelianOverlay.tsx app/map/page.tsx tests/unit/campagne/bascule-vue.test.ts
git commit -m "feat(suivi): barre de contexte commune aux deux vues et assemblage de l ecran"
```

---

## Task 16: Suppression de l'ancien écran

**Files:**
- Delete: les 11 composants et 2 routes listés dans « File Structure › Supprimés »
- Modify: `components/magelian/MagelianOverlay.tsx` (monte `SuiviV2`)
- Modify: `ARCHITECTURE.md`

> **En dernier, et pas avant.** Tant que le nouvel écran n'est pas complet,
> l'ancien reste le seul moyen de comparer deux chiffres.

- [ ] **Step 1: Extraire les formatteurs partagés avant toute suppression**

`lib/campaigns/suivi-metrics.ts` est la source de `fmtInt`/`fmtCpm`/`fmtPct`/`toneColor`, **ré-exportés en chaîne** par `actor-metrics.ts` → `derive-metrics.ts` et par `reconciliation-metrics.ts`. Supprimer sans extraire emporterait des fonctions encore utilisées par des routes qui survivent.

Déplacer ces quatre fonctions vers `lib/format/nombre.ts` (ou les y aliaser), puis réécrire les imports.

- [ ] **Step 2: Vérifier qu'aucun consommateur ne subsiste**

```bash
grep -rn "CampaignSuivi\|SuiviCockpit\|SuiviCharts\|SuiviTable\|ReconciliationPanel\|ActorFilter\|ActorPanel\|SuiviDeriveMap\|DeriveTable\|MeshSelector\|SuiviMapLayer\|derive-metrics\|reconciliation-metrics" \
  --include="*.ts" --include="*.tsx" app components lib tests
```
Expected: uniquement les fichiers à supprimer eux-mêmes.

- [ ] **Step 3: Supprimer**

```bash
git rm components/campaign/CampaignSuivi.tsx \
       components/campaign/suivi/SuiviCockpit.tsx \
       components/campaign/suivi/SuiviCharts.tsx \
       components/campaign/suivi/SuiviTable.tsx \
       components/campaign/suivi/ReconciliationPanel.tsx \
       components/campaign/suivi/ActorFilter.tsx \
       components/campaign/suivi/ActorPanel.tsx \
       components/campaign/suivi/SuiviDeriveMap.tsx \
       components/campaign/suivi/DeriveTable.tsx \
       components/campaign/suivi/MeshSelector.tsx \
       app/map/_components/SuiviMapLayer.tsx \
       lib/campaigns/derive-metrics.ts \
       lib/campaigns/reconciliation-metrics.ts \
       tests/unit/campaigns/derive-metrics.test.ts \
       tests/unit/campaigns/reconciliation-metrics.test.ts
git rm -r "app/api/digital/[campaignId]/derive"
```

- [ ] **Step 4: Retirer les RPC devenues orphelines**

`get_campaign_derive_map`, `get_campaign_derive_ranked`, `get_campaign_derive_headline` (sql/117, sql/118) n'ont plus d'appelant. Vérifier qu'aucune vue ni fonction ne les référence, puis les supprimer dans `sql/167_menage_derive.sql` — leur définition reste dans git, donc restaurer est une opération git, pas une restauration de sauvegarde.

- [ ] **Step 5: Build vert et tests**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: zéro erreur, zéro `any` introduit, zéro `catch` non typé, 950+ tests verts

- [ ] **Step 6: Passe knip**

Run: `npm run catalogue`
Expected: aucun nouvel export mort introduit par le chantier

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(suivi): l ancien ecran et son code mort disparaissent"
```

---

## Post-livraison

Après le dernier commit, lancer `@cleanup-geomatik` Parties 2 et 3 **sur les fichiers modifiés uniquement**. Rapport rapide : failles de sécurité, `any` introduits, `catch` non typés. Corriger avant de considérer la tâche terminée.

Puis rapport final, conformément au §6 du prompt : ce qui a été remplacé, ce qui a été supprimé, les requêtes ajoutées **et leur coût mesuré**, les points restés ouverts.

---

## Points restés ouverts, à trancher pendant l'exécution

| Point | Pourquoi il n'est pas tranché ici |
|---|---|
| **L'étalon « Moyenne du secteur »** est initialisé à 64 en dur dans `sql/166`. | Il n'existe **qu'une seule campagne avec des rollups** en base (la démo). Une médiane sur n=1 n'est pas un étalon. À recalculer quand il y aura des campagnes réelles — d'ici là, la valeur affichée est une convention, et l'interface devrait le dire. |
| **Trois seuils de décrochage incompatibles coexistent** aujourd'hui : 70 (alerte SQL `sql/113:210-249`), 60/80 (tons TS et carte), 80 (curseur de la dérive). | Le nouvel écran n'en utilise qu'un, `tolerance_pct`. Mais les alertes SQL de `get_campaign_suivi` continuent d'exister avec leurs propres seuils : les aligner ou les retirer est un arbitrage produit. |
| **L'assistant « Interroger la campagne »** quitte la colonne fixe pour le tiroir global. | Le tiroir Assistant existe (`Ctrl+K`), mais il n'a aucun contexte campagne aujourd'hui. Lui passer la campagne active est un travail distinct de ce plan. |
| **Option (c)** : dénormaliser le plan en une ligne par CP. | Parquée, motif en tête de plan. |
| **`campaign_cp_rollup.dept`** reste en base, faux pour les DROM, encore lu par `get_campaign_suivi` / `_cps`. | Ce plan cesse de s'en servir mais ne le corrige pas — le corriger toucherait `refresh_campaign_rollups`, donc l'import DSP. À traiter séparément. |
