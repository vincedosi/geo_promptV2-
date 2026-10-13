# La carte en parcours — lots 1 et 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** la carte Angular devient un parcours ① Périmètre › ② Données › ③ Analyse › ④ Zones › ⑤ Plan › ⑥ Activation › ⑦ Live, sans rail et sans perdre une seule fonction (lot 1), puis ② range TOUS les jeux en « Données de l'espace » / « Données communes » avec une sélection recommandée par espace réglée dans Accès (lot 2).

**Architecture:** lot 1 — une logique pure (`logique/parcours.ts`), un service d'état fourni par la page qui reflète l'étape dans `?etape=` (`etat/parcours.service.ts`, patron `EtatRisqueService`), une barre du parcours (`mg-fil-ariane` + `mg-fil-etapes`), un panneau d'étape en flux à poignée (patron `RisquePage`) où chaque panneau existant est MONTÉ à la première visite de son étape puis gardé, et une boîte à outils sur la carte (tiroir dans le flux, pile Échap). Lot 2 — une table `espace_jeux_recommandes` écrite par une RPC `jsonb` atomique, un registre des jeux de la carte copié serveur/Angular (test de parité), deux routes (carte et admin), un bloc « Sélection recommandée » dans Accès › fiche espace › Données, et un panneau `mg-panneau-donnees` qui remplace `mg-panneau-calques`.

**Tech Stack:** Angular 21.2 standalone zoneless signals, Tailwind 4, Vitest (`cd angular && npx ng test --watch=false`) ; Next.js 15 (routes API), supabase-js, Zod, Vitest racine (`npm run test:unit`, `npm run test:integration`) ; PostgreSQL 17.6 local (`docker exec supabase_db_genesis_app psql -U postgres`).

**Spec:** `docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md` (validée le 2026-10-13, § 14 : les cinq recommandations du § 13 retenues, arbitrages de détail délégués au chef de projet) ; maquette `.superpowers/sdd/2026-10-12-parcours-carte/maquette-parcours.html`.

## Base d'exécution — À LIRE AVANT LA TÂCHE 1

L'exécution part du **commit qui intègre le lot 5 de la suppression de l'IA** sur `feat/suppression-ia` (`docs/superpowers/plans/2026-10-12-suppression-ia.md`, lot 5 : entrée « Assistant » retirée de `features/carte/logique/navigation.ts`, `rail/rail.component.ts`, `panneaux/aide.component.ts`, `carte.page.ts` ; Ctrl+K inerte). Ce plan décrit l'état APRÈS ce retrait. Créer la branche `feat/carte-parcours` depuis ce commit.

Contrôle d'entrée (tous doivent passer, sinon s'arrêter et le signaler) :

```bash
git log --oneline -1                                   # le commit « chore(ia): retrait du copilote, du chat et de l'entrée Assistant » ou un descendant
grep -c "id: 'assistant'" angular/src/app/features/carte/logique/navigation.ts   # 0
grep -n "getSourcesPropresEspace" lib/auth/getOrgSourceIds.ts                   # présent (feat/droits-carte intégrée)
grep -n "origine" app/api/map/categories/route.ts | head -2                      # présent
ls sql | sort -V | tail -3                                                       # noter le dernier numéro (250 au 2026-10-13)
```

## Global Constraints

- Les sept étapes, libellés EXACTS : « Périmètre », « Données », « Analyse », « Zones », « Plan », « Activation », « Live » ; valeurs d'URL EXACTES : `perimetre` · `donnees` · `analyse` · `zones` · `plan` · `activation` · `live` (spec § 5).
- Le fil n'est pas un tunnel : toute étape cliquable dans les deux sens, pastille « renseignée », jamais « validée » (`mg-fil-etapes` tel quel).
- Changer d'étape ne relit rien et ne démonte rien : un panneau visité reste monté (`visibility: hidden` + `inert`), jamais `@if` sur l'étape quittée (spec § 3, § 11).
- URL : `replaceUrl: true`, `queryParamsHandling: 'merge'`, navigation RELATIVE ; la valeur par défaut (`perimetre`) ne s'écrit pas ; une URL illisible donne un état lisible, jamais une exception (patron `features/risques/logique/etat-url.ts`).
- Angular / AIDA (skill `~/.claude/skills/porting-react-to-angular/SKILL.md`) : aucun `position: fixed`, aucun écouteur sur `window`/`document`, services d'état fournis par la page (jamais `providedIn: 'root'`), services d'API dans `FOURNISSEURS_DISTANTS`, pas de `@angular/core/rxjs-interop`, couleurs par jetons (`var(--…)`/classes du thème), jamais un hex.
- Aucun fichier `.ts` non-spec d'`angular/src` au-delà de 400 lignes (`tests/unit/angular/taille-fichiers.test.ts`).
- DESIGN_SYSTEM : sentence case, Inter + JetBrains Mono, bordures 0,5 px, accent teal, pas de violet, flat total ; libellés « Données de l'espace », « Données communes », « Autres données communes (n) » (spec V6).
- I/O (CLAUDE.md § Disk I/O) : la recommandation NE PRÉCHARGE AUCUN calque ; ≤ 3 appels simultanés ; `EXPLAIN (ANALYZE, BUFFERS)` sur toute requête nouvelle ; base LOCALE seulement.
- PostgREST coupe à 1 000 lignes : la RPC nouvelle rend `jsonb` ; la lecture de table nouvelle est bornée par construction (≤ 200 clés par espace, borne écrite en commentaire).
- React gelé (P5) : aucun fichier de `app/map/**`, `components/**`, `lib/navigation/**` modifié. Fichiers protégés intouchés : `middleware.ts`, `app/api/isochrone-battle/route.ts`.
- Routes API : `export const dynamic = 'force-dynamic'`, Zod, `lireCorps()` pour un corps JSON, `getSessionOrg` (jamais `getUser()`), `requireAdmin()` pour `/api/admin/**`.
- `ARCHITECTURE.md` mis à jour DANS le commit de chaque tâche qui change une route, une table, une RPC ou un écran (Grep par nom, jamais lu en entier) ; `angular/src/app/features/carte/README.md` aussi.
- Tests : codes de retour lus SANS pipe (`npx tsc --noEmit`, `cd angular && npx ng test --watch=false`, `cd angular && npm run build`, `npm run test:unit`, `npm run test:integration`). Échec connu admissible : l'attente « habitants » de zone-risque (41 025 366 vs 42 409 940).
- Preuve navigateur : Angular `:4202` (`cd angular && npm run config && npx ng serve --port 4202`), Next `:3000` réutilisé s'il tourne (jamais arrêté), deux thèmes, captures dans `.superpowers/sdd/2026-10-13-carte-parcours/` (non suivi). Couper `:4202` à la fin.
- Git : commits atomiques `type: description`, pas de push, pas de PR, rien sur `main`.

## Review Focus

1. **Lien ancien, tronqué ou partagé** (`?etape=inconnue`, `?etape=` vide, `?customZone=<id>` sans `etape`) : la carte s'ouvre sur une étape lisible (① ou ④ pour `customZone`), l'URL est réécrite UNE fois sous sa forme canonique, jamais d'écran blanc. → tests T1 (`etapeInitiale`) et T2 (service).
2. **Module risque ouvert depuis ② ou ④, puis fermé** (et Alt+n frappé pendant qu'il est ouvert) : on revient à l'étape quittée, `?etape=` survit à l'aller-retour, et un raccourci ne ferme jamais le module ni ne change l'étape dessous. → tests T2 (navigations `merge`) et T4 (garde clavier).
3. **Changer d'espace à ③ ou ④, un tiroir ouvert, un calcul en vol** : la page est recréée à ① (`etape` et `customZone` retirés par l'hôte), aucune réponse de l'ancien espace n'atteint la nouvelle page. → test T2 (`carte-hote.component.spec.ts`).
4. **Quitter une étape pendant un calcul** (bataille, clustering, création de zone, liste en lecture) puis y revenir : le calcul a continué, le résultat est là, et cinq bascules d'étape n'émettent aucune lecture de plus que les premières visites. → test T4 (« zéro relecture »).
5. **Sélection recommandée périmée ou hors d'atteinte** (clés de jeux disparus, catégorie POI non visible, sélection qui ne désigne aucun jeu commun présent, lecture en échec) : « Données communes » montre tout, déplié — jamais un bloc vide ; et une catégorie POI au nom non conforme n'empêche jamais d'enregistrer. → tests T10 (`jeuxRecommandables`) et T12 (`rangerJeux`).

## Arbitrages du chef de projet (spec § 14 : « arbitrages de détail délégués »)

| # | Point de la spec | Tranché | Coût si faux |
|---|---|---|---|
| A1 | § 3 « le panneau d'une étape reste monté » | Monté à la PREMIÈRE visite de l'étape, puis gardé (`invisible` + `inert`). Monter les quatre au chargement lirait référentiel, zones, rôle et jeux d'un coup (prefetch interdit). | Monter tout d'avance : une ligne. |
| A2 | § 5 état URL complet | Le lot 1 n'écrit QUE `etape`. Pastilles : ① = filtre ou périmètre posé, ② = un calque allumé (état de la page) ; ③-⑦ sans pastille jusqu'aux lots qui écrivent leurs paramètres. `?customZone=` sans `etape` ouvre ④ (la redirection vers `jeu=` attend le lot 5). | Pastilles de ③④ à brancher au lot 4-5. |
| A3 | § 3-4 bandeau KPI par étape | Reporté : aucun chiffre de ① n'est lisible sans requête de comptage (le référentiel chargé ne porte pas la population), ③④ arrivent aux lots 4-5. Pas de bandeau vide. | Un emplacement à ajouter sous la barre. |
| A4 | Raccourcis « revus » | Alt+1…Alt+7 = ①…⑦, lus par `KeyboardEvent.code` (Digit/Numpad) puis `key` — Alt+1 marche enfin en AZERTY (`key` = `&`). Alt+C retiré (⑤ = Alt+5). Inertes sous le module risque. Échap : pile (tiroir, mode immersif). | Rajouter Alt+C : une ligne. |
| A5 | § 3 barre « ● Carte … [outils] ✕ » | Barre : logo dentsu (DESIGN_SYSTEM § 1, 18 px), fil d'Ariane (remplace la puce de filtre), fil d'étapes, puis Script bidding DV360 / Plan média (n) quand ils existent, Tout effacer, mode immersif, thème, session. Pas de titre « Carte », pas de croix (la carte ne se ferme pas). Les boutons flottants disparaissent ; Plan média et Script DV360 restent dans la barre jusqu'aux lots 6-7. | Déplacer deux boutons. |
| A6 | § 6 boîte à outils | Mes analyses (sort de Calques), Mes zones (jeux de zones + Mes zones + opérations sortent de ④, qui garde « Créer une zone »), Fond de carte (le sélecteur compact « FOND » et la section Fond des Réglages y sont réunis), Légende (bascule d'affichage), Aide (contextuelle à l'étape + raccourcis), Réglages (apparence, back office) ; le bouton « quitter le mode immersif » s'y ajoute en immersif. « Fiche » arrive avec le catalogue (lot 8) : détail IRIS et tiroir Street View restent où ils sont. | — |
| A7 | § 12 ⑤-⑦ « bientôt + lien vers l'existant » | Un panneau « bientôt » avec un lien vers l'overlay React `/map?tab=strategie|activation|suivi` (deep-link existant, `components/magelian/deep-link.ts`). Origine React lue dans `config.local.json` (`urlApplicationReact`, recopiée de `NEXT_PUBLIC_APP_URL` par `npm run config`, aucune variable nouvelle) ; absente (AIDA) : pas de lien, jamais une URL inventée. | — |
| A8 | Q1 corrélation en ⑦ ; § 9 module risque | Tant que ⑦ et le lot 4 n'existent pas : la corrélation reste en ③, la section « Zones à risque industriel » et la route `carte/risques` restent telles quelles. Les deux navigations vers `risques` et la fermeture du module passent en `merge` pour ne plus effacer `?etape=`. | — |
| A9 | § 9 « rail retiré » | `features/carte/logique/navigation.ts` (copie Angular du rail React) est SUPPRIMÉ et retiré de `tests/unit/angular/carte-logique-paritaire.test.ts` ; React gelé garde son rail et `lib/navigation/config.ts`. | — |
| A10 | § 4 ② « rangement pour TOUS les jeux » | Lot 2 : les 10 référentiels (carreaux, IRIS, indicateurs CP, transport, OOH, radio, TMJA, ICPE+PPRT, santé, météo) sont « communs » par un registre statique (`lib/carte/jeux-carte.ts` + copie Angular, clés `famille:nom`) ; les types de POI prennent `origine` de `/api/map/categories`. Indicateurs privés = lot 8 (catalogue) ; zones de l'espace = boîte à outils (lien depuis le bloc espace) ; campagnes = lot 3. ICPE et PPRT restent UNE ligne jusqu'au lot 4. | — |
| A11 | § 7.2 « colonne Recommandé dans l'onglet Données » | Un BLOC sous le tableau, pas une colonne : le tableau liste des `data_sources`, la recommandation porte sur des jeux de CARTE (référentiels + types de POI du socle), que le tableau ne contient pas. Écriture atomique par la RPC `remplacer_jeux_recommandes` (`jsonb`, ≤ 200 clés). | — |
| A12 | § 4 ② « ligne uniforme… interrupteur afficher » | Ligne uniforme = nom, nature · maille, pastille « affiché », puis une CASE (type de POI : choisir ; « Afficher les POI » reste un geste explicite, comme aujourd'hui) ou un CHEVRON qui déplie les réglages existants de la section (son en-tête interne masqué par `integre`). Un interrupteur unique par jeu exigerait de réécrire 9 sections : hors lot. | Lot de finition. |

## File Structure

Lot 1 (`angular/src/app/features/carte/`) :

| Fichier | Responsabilité |
|---|---|
| `logique/parcours.ts` (créé) | Étapes, libellés, consignes, URL (`lireEtape`, `etapeInitiale`, `ecrireEtape`), raccourcis, fil, fil d'Ariane, lien React. Pur. |
| `etat/parcours.service.ts` (créé) | Étape courante + étapes visitées, reflet `?etape=`. Fourni par la page. |
| `parcours/barre-parcours.component.ts` (créé) | Barre : logo, Ariane, fil, actions, thème, session. Remplace `rail/barre-haut`. |
| `parcours/panneau-etape.component.ts` (créé) | Aside en flux, consigne, poignée 320-900, repli « carte seule ». Remplace `rail/panneau`. |
| `parcours/etape-bientot.component.ts` (créé) | ⑤ ⑥ ⑦ « bientôt » + lien React. |
| `outils/outils-carte.service.ts`, `outils/boite-outils.component.ts`, `outils/outil-mes-analyses.component.ts`, `outils/outil-mes-zones.component.ts` (créés) | Boîte à outils et tiroir. |
| `outils/mes-analyses.component.ts`, `outils/mes-analyses.service.ts` (déplacés de `panneaux/calques/`) | « Mes analyses ». |
| `commun/choix-fond.component.ts` (créé) | Choix du fond (extrait de `panneaux/reglages.component.ts`). |
| `carte.page.ts/.html` (réécrits), `etat/etat-carte.service.ts`, `legende/legende-carte.component.ts`, `panneaux/aide.component.ts`, `panneaux/reglages.component.ts`, `panneaux/calques/panneau-calques.component.ts`, `panneaux/zones/panneau-zones.component.ts`, `carte-hote.component.ts` (modifiés) | |
| `rail/*`, `filtre/puce-filtre.component.*`, `commun/boutons-flottants.component.*`, `commun/fond-compact.component.*`, `logique/navigation.ts` (supprimés) | |
| Hors carte : `core/config/config.service.ts`, `angular/scripts/ecrire-config.mjs`, `features/risques/risque.page.ts`, `panneaux/calques/section-risque.component.ts`, `panneaux/zones/jeux-de-zones.component.ts`, `tests/unit/angular/carte-logique-paritaire.test.ts` (modifiés) | |

Lot 2 :

| Fichier | Responsabilité |
|---|---|
| `sql/251_espace_jeux_recommandes.sql` (créé — numéro à confirmer, premier libre) | Table + RPC `jsonb`. |
| `lib/carte/jeux-carte.ts` + `angular/src/app/features/carte/logique/jeux-carte.ts` (créés, parité) | Registre des jeux de la carte, clés, natures. |
| `lib/poi/libelles-categories.ts` (créé, extrait de la route catégories) | Libellés des catégories. |
| `lib/carte/jeux-recommandables.ts` (créé) | Liste des jeux communs recommandables d'un espace. |
| `app/api/map/jeux-recommandes/route.ts`, `app/api/admin/espaces/[id]/jeux-recommandes/route.ts` (créés) | Routes. |
| `features/admin/espaces/jeux-recommandes.component.ts` (créé), `onglet-donnees.component.ts`, `data/espaces.api.ts` (modifiés) | Accès. |
| `features/carte/logique/rangement-jeux.ts`, `etat/jeux-recommandes.service.ts`, `panneaux/donnees/ligne-jeu.component.ts`, `panneaux/donnees/actions-poi.component.ts`, `panneaux/donnees/panneau-donnees.component.ts` (créés) | ② rangée. |
| `panneaux/calques/panneau-calques.component.*`, `groupe-calques.component.*`, `section-poi.component.*` (supprimés) ; 8 sections (`integre`) modifiées | |

---

## LOT 1 — Squelette du parcours (7 tâches)

### Task 1: La logique pure du parcours

**Files:**
- Create: `angular/src/app/features/carte/logique/parcours.ts`
- Test: `angular/src/app/features/carte/logique/parcours.spec.ts`

**Interfaces:**
- Consumes: `EtapeAffichee` (`ui/fil-etapes/fil-etapes.component.ts`), `SegmentAriane` (`ui/fil-ariane/fil-ariane.component.ts`), `FiltreActif` (`logique/filtre.ts`), `PARAM_ZONE_LIEN = 'customZone'` (`logique/zones/zone-du-lien.ts`).
- Produces: `ETAPES_CARTE`, `type EtapeCarte`, `ETAPE_PAR_DEFAUT`, `PARAM_ETAPE = 'etape'`, `LIBELLE_ETAPE_CARTE`, `CONSIGNE_ETAPE`, `ETAPES_BIENTOT`, `LARGEUR_PANNEAU_ETAPE = { min: 320, max: 900, defaut: 480 }`, `rangEtapeCarte(e): number`, `lireEtape(brut): EtapeCarte | null`, `etapeInitiale(params: { get(n: string): string | null }): EtapeCarte`, `ecrireEtape(e): string`, `etapeParRaccourci(e: Pick<KeyboardEvent,'key'|'code'|'ctrlKey'|'metaKey'|'altKey'|'shiftKey'>): EtapeCarte | null`, `interface EtatRenseigne { filtrePose: boolean; calquesActifs: boolean }`, `etapesDuFil(r: EtatRenseigne): EtapeAffichee[]`, `segmentsDuFiltre(f: FiltreActif | null): SegmentAriane[]`, `precisionDuPerimetre(scope: 'metro' | 'all' | null): string | undefined`, `lienApplicationReact(base: string | undefined, e: EtapeCarte): string | null`.

- [ ] **Step 1: Écrire le test (échec)** — `logique/parcours.spec.ts` :

```ts
import {
  ETAPES_CARTE, LIBELLE_ETAPE_CARTE, ecrireEtape, etapeInitiale, etapeParRaccourci, etapesDuFil, lienApplicationReact,
  lireEtape, precisionDuPerimetre, rangEtapeCarte, segmentsDuFiltre,
} from './parcours';

const params = (q: string) => new URLSearchParams(q);
const alt = (code: string, key: string, extra: Partial<KeyboardEvent> = {}) =>
  ({ code, key, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, ...extra }) as KeyboardEvent;

describe('parcours de la carte — logique pure', () => {
  it('sept étapes, dans l’ordre de la spec, libellés exacts, rangs 1 à 7', () => {
    expect([...ETAPES_CARTE]).toEqual(['perimetre', 'donnees', 'analyse', 'zones', 'plan', 'activation', 'live']);
    expect(ETAPES_CARTE.map((e) => LIBELLE_ETAPE_CARTE[e])).toEqual(['Périmètre', 'Données', 'Analyse', 'Zones', 'Plan', 'Activation', 'Live']);
    expect(ETAPES_CARTE.map(rangEtapeCarte)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it('lireEtape : une valeur connue, sinon null — jamais d’exception', () => {
    expect(lireEtape('zones')).toBe('zones');
    expect(lireEtape('ZONES')).toBeNull();
    expect(lireEtape('')).toBeNull();
    expect(lireEtape(null)).toBeNull();
    expect(lireEtape(undefined)).toBeNull();
  });
  it('etapeInitiale : etape valide > customZone (④) > Périmètre (Review Focus 1)', () => {
    expect(etapeInitiale(params('etape=analyse&customZone=z'))).toBe('analyse');
    expect(etapeInitiale(params('customZone=z'))).toBe('zones');
    expect(etapeInitiale(params('etape=inconnue'))).toBe('perimetre');
    expect(etapeInitiale(params('etape=inconnue&customZone=z'))).toBe('zones');
    expect(etapeInitiale(params(''))).toBe('perimetre');
  });
  it('ecrireEtape : la valeur par défaut ne s’écrit pas', () => {
    expect(ecrireEtape('perimetre')).toBe('');
    expect(ecrireEtape('live')).toBe('live');
  });
  it('Alt+1…7 par le code physique (AZERTY : key « & »), pavé numérique compris', () => {
    expect(etapeParRaccourci(alt('Digit1', '&'))).toBe('perimetre');
    expect(etapeParRaccourci(alt('Digit2', '2'))).toBe('donnees');
    expect(etapeParRaccourci(alt('Numpad7', '7'))).toBe('live');
    expect(etapeParRaccourci(alt('', '4'))).toBe('zones');
  });
  it('rien hors Alt seul, rien au-delà de 7, Alt+C n’est plus rien', () => {
    expect(etapeParRaccourci(alt('Digit8', '8'))).toBeNull();
    expect(etapeParRaccourci(alt('Digit2', '2', { shiftKey: true }))).toBeNull();
    expect(etapeParRaccourci(alt('Digit2', '2', { ctrlKey: true }))).toBeNull();
    expect(etapeParRaccourci(alt('Digit2', '2', { metaKey: true }))).toBeNull();
    expect(etapeParRaccourci({ ...alt('Digit2', '2'), altKey: false } as KeyboardEvent)).toBeNull();
    expect(etapeParRaccourci(alt('KeyC', 'c'))).toBeNull();
  });
  it('etapesDuFil : ① renseignée par le filtre, ② par un calque, les autres jamais (lot 1)', () => {
    const fil = etapesDuFil({ filtrePose: true, calquesActifs: false });
    expect(fil.map((e) => [e.cle, e.rang, e.renseignee])).toEqual([
      ['perimetre', 1, true], ['donnees', 2, false], ['analyse', 3, false], ['zones', 4, false],
      ['plan', 5, false], ['activation', 6, false], ['live', 7, false],
    ]);
    expect(etapesDuFil({ filtrePose: false, calquesActifs: true })[1].renseignee).toBe(true);
  });
  it('segmentsDuFiltre : « France entière » puis le filtre ; une zone ne montre pas son uuid', () => {
    expect(segmentsDuFiltre(null)).toEqual([{ cle: 'france', libelle: 'France entière' }]);
    expect(segmentsDuFiltre({ type: 'france', code: 'FR', label: 'France' })).toEqual([{ cle: 'france', libelle: 'France entière' }]);
    expect(segmentsDuFiltre({ type: 'departement', code: '29', label: 'Finistère' })[1])
      .toEqual({ cle: 'departement:29', libelle: 'Finistère', titre: 'Département 29' });
    expect(segmentsDuFiltre({ type: 'zone', code: '0b7e-uuid', label: 'Brest' })[1].titre).toBe('Zone enregistrée');
  });
  it('precisionDuPerimetre', () => {
    expect(precisionDuPerimetre(null)).toBeUndefined();
    expect(precisionDuPerimetre('metro')).toBe('métropole');
    expect(precisionDuPerimetre('all')).toBe('métropole + DROM');
  });
  it('lienApplicationReact : seulement ⑤-⑦, seulement avec une origine', () => {
    expect(lienApplicationReact('http://localhost:3000/', 'plan')).toBe('http://localhost:3000/map?tab=strategie');
    expect(lienApplicationReact('http://localhost:3000', 'activation')).toBe('http://localhost:3000/map?tab=activation');
    expect(lienApplicationReact('http://localhost:3000', 'live')).toBe('http://localhost:3000/map?tab=suivi');
    expect(lienApplicationReact('http://localhost:3000', 'zones')).toBeNull();
    expect(lienApplicationReact(undefined, 'plan')).toBeNull();
    expect(lienApplicationReact('', 'plan')).toBeNull();
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec** — `cd angular && npx ng test --watch=false --include='src/app/features/carte/logique/parcours.spec.ts'` → FAIL (module introuvable).

- [ ] **Step 3: Implémenter** — `logique/parcours.ts` :

```ts
/**
 * Le parcours de la carte — ① Périmètre › ② Données › ③ Analyse › ④ Zones › ⑤ Plan › ⑥ Activation › ⑦ Live
 * (spec `docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md`, V1-V2, § 5).
 *
 * Logique PURE : le fil, l'URL, le clavier et l'aide lisent tous cette définition, jamais une copie.
 * Ce n'est pas un tunnel : rien ici ne vérifie qu'une étape est « validée » avant la suivante, et rien ne doit le faire.
 */
import type { EtapeAffichee } from '../../../ui/fil-etapes/fil-etapes.component';
import type { SegmentAriane } from '../../../ui/fil-ariane/fil-ariane.component';
import type { FiltreActif } from './filtre';
import { PARAM_ZONE_LIEN } from './zones/zone-du-lien';

/** Les sept étapes, dans l'ordre. L'ordre EST la numérotation ; ce sont aussi les valeurs de `?etape=`. */
export const ETAPES_CARTE = ['perimetre', 'donnees', 'analyse', 'zones', 'plan', 'activation', 'live'] as const;
export type EtapeCarte = (typeof ETAPES_CARTE)[number];

export const ETAPE_PAR_DEFAUT: EtapeCarte = 'perimetre';
/** Le paramètre d'URL de l'étape (spec § 5). La valeur par défaut ne s'écrit pas. */
export const PARAM_ETAPE = 'etape';

export const LIBELLE_ETAPE_CARTE: Readonly<Record<EtapeCarte, string>> = {
  perimetre: 'Périmètre', donnees: 'Données', analyse: 'Analyse', zones: 'Zones',
  plan: 'Plan', activation: 'Activation', live: 'Live',
};

/** Ce que chaque panneau attend, en une ligne (spec § 11 : « le parcours peut se lire comme un tunnel »). */
export const CONSIGNE_ETAPE: Readonly<Record<EtapeCarte, string>> = {
  perimetre: 'Choisissez où regarder : région, département, ville, code postal ou zone enregistrée. Ce périmètre borne les calculs des étapes suivantes.',
  donnees: 'Allumez ce que vous voulez voir. Rien n’est chargé tant que vous ne l’allumez pas.',
  analyse: 'Calculez : score, corrélation, isochrones, bataille, clustering. Chaque résultat s’affiche sur la carte.',
  zones: 'Fabriquez une zone : capture de ce qui est affiché, codes postaux, rayon, dessin. Vos zones enregistrées sont dans la boîte à outils, « Mes zones ».',
  plan: 'Le plan de campagne arrive dans le parcours. En attendant, il se prépare dans l’application actuelle.',
  activation: 'L’activation plateforme par plateforme arrive dans le parcours. En attendant, elle se fait dans l’application actuelle.',
  live: 'Le suivi de la campagne en vol arrive dans le parcours. En attendant, il se consulte dans l’application actuelle.',
};

/** Étapes dont le contenu n'est pas encore porté (lots 3, 6, 7 de la spec). */
export const ETAPES_BIENTOT: ReadonlySet<EtapeCarte> = new Set<EtapeCarte>(['plan', 'activation', 'live']);

/** L'onglet de l'overlay campagne React qui porte aujourd'hui l'étape (`components/magelian/deep-link.ts`, `TABS`). */
const ONGLET_REACT: Partial<Record<EtapeCarte, 'strategie' | 'activation' | 'suivi'>> = {
  plan: 'strategie', activation: 'activation', live: 'suivi',
};

/** Bornes de la poignée du panneau d'étape : celles de `RisquePage` (320-900 px, 480 par défaut). */
export const LARGEUR_PANNEAU_ETAPE = { min: 320, max: 900, defaut: 480 } as const;

export function rangEtapeCarte(e: EtapeCarte): number {
  return ETAPES_CARTE.indexOf(e) + 1;
}

/** Une valeur d'URL connue, sinon `null`. Ne lève jamais : l'URL vient de l'extérieur. */
export function lireEtape(brut: string | null | undefined): EtapeCarte | null {
  return (ETAPES_CARTE as readonly string[]).includes(brut ?? '') ? (brut as EtapeCarte) : null;
}

/**
 * L'étape d'ouverture : `?etape=` s'il est lisible ; sinon ④ si l'URL porte une zone (`?customZone=`, le lien
 * historique d'une zone enregistrée — sa redirection vers `jeu=` attend le lot 5) ; sinon ①.
 */
export function etapeInitiale(params: { get(nom: string): string | null }): EtapeCarte {
  return lireEtape(params.get(PARAM_ETAPE)) ?? (params.get(PARAM_ZONE_LIEN) ? 'zones' : ETAPE_PAR_DEFAUT);
}

/** La valeur écrite dans l'URL : vide pour l'étape par défaut. */
export function ecrireEtape(e: EtapeCarte): string {
  return e === ETAPE_PAR_DEFAUT ? '' : e;
}

type FrappeClavier = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

/**
 * Alt+1…Alt+7 → ①…⑦. Alt SEUL (ni Ctrl, ni Méta, ni Maj). Le chiffre est lu sur la touche PHYSIQUE (`code` :
 * `Digit1`, `Numpad1`) puis, à défaut, sur `key` : en AZERTY, Alt+1 rend `key` = « & » — l'ancien raccourci du rail
 * (`entreeParRaccourci`, lu sur `key`) n'y marchait pas.
 */
export function etapeParRaccourci(e: FrappeClavier): EtapeCarte | null {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  const parCode = /^(?:Digit|Numpad)([1-9])$/.exec(e.code ?? '')?.[1];
  const chiffre = parCode ?? (/^[1-9]$/.test(e.key) ? e.key : null);
  if (!chiffre) return null;
  return ETAPES_CARTE[Number(chiffre) - 1] ?? null;
}

/** Ce qui allume la pastille « renseignée » au lot 1 (arbitrage A2). Les autres étapes s'allument avec leur paramètre d'URL. */
export interface EtatRenseigne {
  readonly filtrePose: boolean;
  readonly calquesActifs: boolean;
}

export function etapesDuFil(r: EtatRenseigne): EtapeAffichee[] {
  return ETAPES_CARTE.map((e) => ({
    cle: e,
    rang: rangEtapeCarte(e),
    libelle: LIBELLE_ETAPE_CARTE[e],
    renseignee: e === 'perimetre' ? r.filtrePose : e === 'donnees' ? r.calquesActifs : false,
  }));
}

const TITRE_TYPE_FILTRE: Readonly<Record<FiltreActif['type'], string>> = {
  region: 'Région', departement: 'Département', commune: 'Commune', cp: 'Code postal', zone: 'Zone enregistrée', france: 'France entière',
};

/** « Où je regarde » : France entière, puis le filtre unique de ① (il remplace la puce de filtre du rail). */
export function segmentsDuFiltre(f: FiltreActif | null): SegmentAriane[] {
  const racine: SegmentAriane = { cle: 'france', libelle: 'France entière' };
  if (!f || f.type === 'france') return [racine];
  const titre = f.type === 'zone' ? TITRE_TYPE_FILTRE.zone : `${TITRE_TYPE_FILTRE[f.type]} ${f.code}`;
  return [racine, { cle: `${f.type}:${f.code}`, libelle: f.label, titre }];
}

/** La précision du fil d'Ariane : les pastilles Métro / +DROM de ①. */
export function precisionDuPerimetre(scope: 'metro' | 'all' | null): string | undefined {
  return scope === 'metro' ? 'métropole' : scope === 'all' ? 'métropole + DROM' : undefined;
}

/** Le lien d'une étape « bientôt » vers l'overlay React. Sans origine connue (hôte AIDA) : aucun lien, jamais une URL inventée. */
export function lienApplicationReact(base: string | undefined, e: EtapeCarte): string | null {
  const onglet = ONGLET_REACT[e];
  if (!base || !onglet) return null;
  return `${base.replace(/\/+$/, '')}/map?tab=${onglet}`;
}
```

- [ ] **Step 4: Vérifier** — même commande → PASS.
- [ ] **Step 5: Commit** — `git add angular/src/app/features/carte/logique/parcours.ts angular/src/app/features/carte/logique/parcours.spec.ts && git commit -m "feat(angular): logique pure du parcours de la carte"`.

---

### Task 2: L'étape dans l'URL, et les navigations qui ne la perdent plus

**Files:**
- Create: `angular/src/app/features/carte/etat/parcours.service.ts` (+ `parcours.service.spec.ts`)
- Modify: `angular/src/app/features/carte/carte-hote.component.ts` (`actualiser`), `angular/src/app/features/risques/risque.page.ts:215` (`fermer`), `angular/src/app/features/carte/panneaux/calques/section-risque.component.ts:367` (`analyser`), `angular/src/app/features/carte/panneaux/zones/jeux-de-zones.component.ts:95` (`ouvrir`)
- Test: specs des quatre fichiers modifiés (`carte-hote.component.spec.ts`, `risque.page.spec.ts`, `section-risque.component.spec.ts`, `jeux-de-zones.component.spec.ts`)

**Interfaces:**
- Consumes: T1 (`etapeInitiale`, `lireEtape`, `ecrireEtape`, `PARAM_ETAPE`, `ETAPE_PAR_DEFAUT`, `EtapeCarte`).
- Produces: `ParcoursService` (`@Injectable()` sans `providedIn`) : `etape: Signal<EtapeCarte>`, `visitees: Signal<ReadonlySet<EtapeCarte>>`, `choisir(e: EtapeCarte): void`.

- [ ] **Step 1: Tests (échec)** — `etat/parcours.service.spec.ts` (harnais de routeur, hôte factice qui FOURNIT le service, comme `CartePage`) :

```ts
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, RouterOutlet, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ParcoursService } from './parcours.service';

@Component({ selector: 'mg-hote-parcours', template: '<router-outlet />', providers: [ParcoursService],
  imports: [RouterOutlet] })
class Hote { readonly parcours = inject(ParcoursService); }
@Component({ selector: 'mg-module', template: '' }) class Module {}

const attendre = () => new Promise((r) => setTimeout(r, 0));

async function ouvrir(url: string) {
  TestBed.configureTestingModule({
    providers: [provideRouter([{ path: 'carte', component: Hote, children: [{ path: 'risques', component: Module }] }])],
  });
  const harness = await RouterTestingHarness.create();
  const hote = await harness.navigateByUrl(url, Hote);
  await attendre(); await harness.fixture.whenStable();
  const router = TestBed.inject(Router);
  return { harness, hote, router, stable: async () => { await attendre(); await harness.fixture.whenStable(); } };
}

describe('ParcoursService — l’étape dans l’URL', () => {
  it('/carte : ① sans paramètre ; choisir ② écrit ?etape=donnees, en remplaçant l’entrée d’historique', async () => {
    const { hote, router, stable } = await ouvrir('/carte');
    expect(hote.parcours.etape()).toBe('perimetre');
    expect(router.url).toBe('/carte');
    const nav = vi.spyOn(router, 'navigate');
    hote.parcours.choisir('donnees');
    await stable();
    expect(router.url).toBe('/carte?etape=donnees');
    expect(nav.mock.calls[0][1]).toMatchObject({ replaceUrl: true, queryParamsHandling: 'merge' });
  });
  it('revenir à ① retire le paramètre (le défaut ne s’écrit pas)', async () => {
    const { hote, router, stable } = await ouvrir('/carte?etape=zones');
    hote.parcours.choisir('perimetre');
    await stable();
    expect(router.url).toBe('/carte');
  });
  it('?etape=inconnue : ① et URL nettoyée une fois (Review Focus 1)', async () => {
    const { hote, router } = await ouvrir('/carte?etape=inconnue');
    expect(hote.parcours.etape()).toBe('perimetre');
    expect(router.url).toBe('/carte');
  });
  it('?customZone=z sans etape : ④, etape=zones écrit, customZone gardé', async () => {
    const { hote, router } = await ouvrir('/carte?customZone=z');
    expect(hote.parcours.etape()).toBe('zones');
    expect(router.url).toContain('customZone=z');
    expect(router.url).toContain('etape=zones');
  });
  it('une navigation EXTÉRIEURE (retour, lien collé) change l’étape sans recréer le service', async () => {
    const { hote, router, stable } = await ouvrir('/carte');
    await router.navigateByUrl('/carte?etape=analyse');
    await stable();
    expect(hote.parcours.etape()).toBe('analyse');
  });
  it('les étapes visitées s’accumulent (leurs panneaux restent montés)', async () => {
    const { hote, stable } = await ouvrir('/carte');
    hote.parcours.choisir('zones'); await stable();
    hote.parcours.choisir('donnees'); await stable();
    hote.parcours.choisir('zones'); await stable();
    expect([...hote.parcours.visitees()].sort()).toEqual(['donnees', 'perimetre', 'zones']);
  });
  it('module enfant ouvert : écrire l’étape garde /carte/risques et ?risque= (Review Focus 2)', async () => {
    const { hote, router, stable } = await ouvrir('/carte/risques?risque=etape%3Drayon');
    hote.parcours.choisir('zones');
    await stable();
    expect(router.url.startsWith('/carte/risques?')).toBe(true);
    expect(router.url).toContain('risque=etape%3Drayon');
    expect(router.url).toContain('etape=zones');
  });
});
```

Ajouts aux specs existantes :
- `carte-hote.component.spec.ts` : ouvrir `/carte?etape=analyse&customZone=z`, émettre `orgChangee` depuis `mg-barre-parcours` (le sélecteur `mg-barre-haut` de ce spec devient `mg-barre-parcours` en T4 — dans CETTE tâche, garder `mg-barre-haut`) → UNE navigation, URL finale sans `etape` ni `customZone`, page recréée (Review Focus 3). Ouvrir `/carte?etape=zones` seul → même résultat (`etape` retiré). Le test (g) existant (« navigation rejetée ») reste vert.
- `risque.page.spec.ts` : ouvrir `/carte/risques?risque=etape%3Drayon&etape=donnees` (route parent `carte` factice), cliquer la croix → `router.url === '/carte?etape=donnees'`.
- `section-risque.component.spec.ts` : depuis `/carte?etape=donnees`, `analyser()` → URL `/carte/risques?…` contient `etape=donnees`.
- `jeux-de-zones.component.spec.ts` : depuis `/carte?etape=zones`, `ouvrir(id)` → URL contient `etape=zones`.

- [ ] **Step 2: Lancer, vérifier l'échec** — `cd angular && npx ng test --watch=false --include='src/app/features/carte/etat/parcours.service.spec.ts' --include='src/app/features/carte/carte-hote.component.spec.ts' --include='src/app/features/risques/risque.page.spec.ts' --include='src/app/features/carte/panneaux/calques/section-risque.component.spec.ts' --include='src/app/features/carte/panneaux/zones/jeux-de-zones.component.spec.ts'` → FAIL.

- [ ] **Step 3: Implémenter** — `etat/parcours.service.ts` :

```ts
import { DestroyRef, Injectable, type Signal, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ETAPE_PAR_DEFAUT, type EtapeCarte, PARAM_ETAPE, ecrireEtape, etapeInitiale, lireEtape } from '../logique/parcours';

/**
 * L'étape courante du parcours de la carte, et son reflet dans `?etape=` (spec § 5) — patron EXACT de
 * `EtatRisqueService` (`features/risques/etat/etat-risque.service.ts`) : lu à la construction, réécrit à chaque geste
 * (`replaceUrl`, `merge`, navigation RELATIVE), relu à chaque `?etape=` qui ne vient pas de nous. Une navigation de
 * requête RÉUTILISE la page : changer d'étape ne recrée rien.
 *
 * `visitees` : les étapes déjà ouvertes. Leur panneau est monté à la première visite puis GARDÉ (arbitrage A1) — un
 * calcul en cours survit au changement d'étape, et revenir ne relit rien.
 *
 * Écriture relative à la route ENFANT active quand il y en a une (le module risque, `carte/risques`) : relative à la
 * carte, `navigate([])` fermerait le module.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle (un changement d'espace la recrée).
 */
@Injectable()
export class ParcoursService {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly courante = signal<EtapeCarte>(etapeInitiale(this.route.snapshot.queryParamMap));
  readonly etape: Signal<EtapeCarte> = this.courante.asReadonly();
  private readonly _visitees = signal<ReadonlySet<EtapeCarte>>(new Set([this.courante()]));
  readonly visitees: Signal<ReadonlySet<EtapeCarte>> = this._visitees.asReadonly();
  /** Le dernier `?etape=` écrit OU lu : sans lui, chaque passe réécrirait l'URL. Une valeur illisible est réécrite une fois. */
  private dernier = this.route.snapshot.queryParamMap.get(PARAM_ETAPE) ?? '';

  constructor() {
    const abonnement = this.route.queryParamMap.subscribe((p) => {
      const brut = p.get(PARAM_ETAPE) ?? '';
      if (brut === this.dernier) return;
      this.dernier = brut;
      this.poser(lireEtape(brut) ?? ETAPE_PAR_DEFAUT);
    });
    inject(DestroyRef).onDestroy(() => abonnement.unsubscribe());

    effect(() => {
      const encode = ecrireEtape(this.courante());
      if (encode === this.dernier) return;
      this.dernier = encode;
      void this.router.navigate([], {
        relativeTo: this.route.firstChild ?? this.route,
        queryParams: { [PARAM_ETAPE]: encode === '' ? null : encode },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });
  }

  choisir(e: EtapeCarte): void {
    this.poser(e);
  }

  private poser(e: EtapeCarte): void {
    this.courante.set(e);
    this._visitees.update((s) => (s.has(e) ? s : new Set([...s, e])));
  }
}
```

`carte-hote.component.ts` — `actualiser()` retire `customZone` ET `etape` (changer d'espace remet le parcours à ①, spec § 3) en UNE navigation :

```ts
import { PARAM_ETAPE } from './logique/parcours';
/** Ce qui appartient à l'ancien espace et quitte l'URL avant la recréation : sa zone, et l'étape (retour à ①, spec § 3). */
const PARAMS_DE_L_ESPACE = [PARAM_ZONE_LIEN, PARAM_ETAPE] as const;

  protected actualiser(): void {
    const q = this.route.snapshot.queryParamMap;
    const aRetirer = PARAMS_DE_L_ESPACE.filter((p) => q.has(p));
    if (aRetirer.length === 0) {
      this.recreer();
      return;
    }
    const recreer = () => this.recreer();
    void this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: Object.fromEntries(aRetirer.map((p) => [p, null])),
        queryParamsHandling: 'merge',
        replaceUrl: true,
      })
      .then(recreer, recreer);
  }
```

Mettre à jour l'en-tête « ── L'URL ── » du fichier (« SAUF `customZone` ET `etape` »).

`risque.page.ts` `fermer()` : `void this.router.navigate(['..'], { relativeTo: this.route, queryParams: { [PARAM_RISQUE]: null }, queryParamsHandling: 'merge' });` (importer `PARAM_RISQUE` de `./etat/etat-risque.service`) ; compléter le commentaire : « les paramètres de la carte (`etape`, `customZone`) survivent ; seul `risque` part ».

`section-risque.component.ts` `analyser()` et `jeux-de-zones.component.ts` `ouvrir()` : ajouter `queryParamsHandling: 'merge'` à leur `navigate(['risques'], …)` (la valeur `risque` passée l'emporte sur l'ancienne) ; une phrase de commentaire chacun.

- [ ] **Step 4: PASS** — même commande ; puis la suite `risques` entière : `cd angular && npx ng test --watch=false --include='src/app/features/risques/**/*.spec.ts'`.
- [ ] **Step 5: Commit** — `feat(angular): l'étape du parcours vit dans l'URL, le module risque ne l'efface plus`.

---

### Task 3: ⑤ ⑥ ⑦ « bientôt », et l'origine de l'application React

**Files:**
- Create: `angular/src/app/features/carte/parcours/etape-bientot.component.ts` (+ spec)
- Modify: `angular/src/app/core/config/config.service.ts` (champ facultatif), `angular/src/app/core/config/config.service.spec.ts`, `angular/scripts/ecrire-config.mjs`

**Interfaces:**
- Consumes: T1 (`EtapeCarte`, `CONSIGNE_ETAPE`, `lienApplicationReact`).
- Produces: `ConfigApplication.urlApplicationReact?: string` ; `EtapeBientotComponent` (`selector: 'mg-etape-bientot'`, `etape = input.required<EtapeCarte>()`).

- [ ] **Step 1: Tests (échec)** — `parcours/etape-bientot.component.spec.ts` :

```ts
import { TestBed } from '@angular/core/testing';
import { ConfigService } from '../../../core/config/config.service';
import { EtapeBientotComponent } from './etape-bientot.component';

function rendre(etape: string, valeur: unknown) {
  TestBed.configureTestingModule({ providers: [{ provide: ConfigService, useValue: { get valeur() { if (valeur instanceof Error) throw valeur; return valeur; } } }] });
  const f = TestBed.createComponent(EtapeBientotComponent);
  f.componentRef.setInput('etape', etape);
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}

describe('EtapeBientotComponent', () => {
  it('⑤ avec une origine React : la consigne et un lien vers l’onglet Stratégie, nouvel onglet', () => {
    const el = rendre('plan', { urlApplicationReact: 'http://localhost:3000' });
    expect(el.querySelector('[data-etape-bientot="plan"]')).not.toBeNull();
    const a = el.querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('http://localhost:3000/map?tab=strategie');
    expect(a.target).toBe('_blank');
    expect(a.rel).toContain('noopener');
  });
  it('⑦ → onglet Suivi', () => {
    expect(rendre('live', { urlApplicationReact: 'http://x' }).querySelector('a')!.getAttribute('href')).toBe('http://x/map?tab=suivi');
  });
  it('sans origine (hôte AIDA) : aucun lien, « Bientôt dans le parcours. »', () => {
    const el = rendre('activation', {});
    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent).toContain('Bientôt dans le parcours.');
  });
  it('configuration pas encore chargée : aucun lien, aucune exception', () => {
    expect(rendre('plan', new Error('pas chargée')).querySelector('a')).toBeNull();
  });
});
```

`config.service.spec.ts` : `config.local.json` avec `urlApplicationReact` → `valeur.urlApplicationReact` rendu ; sans le champ → absent.

- [ ] **Step 2: FAIL** — `cd angular && npx ng test --watch=false --include='src/app/features/carte/parcours/etape-bientot.component.spec.ts' --include='src/app/core/config/config.service.spec.ts'`.

- [ ] **Step 3: Implémenter.**

`config.service.ts` — dans `ConfigApplication` :

```ts
  /**
   * Origine de l'application React (Next.js), FACULTATIVE : les étapes ⑤-⑦ du parcours de la carte y renvoient tant
   * qu'elles ne sont pas portées (arbitrage A7). Écrite par `npm run config` depuis `NEXT_PUBLIC_APP_URL` ; absente
   * dans un hôte AIDA, où aucun lien n'est affiché.
   */
  urlApplicationReact?: string;
```

et dans `charger()` : `...(brut.urlApplicationReact ? { urlApplicationReact: brut.urlApplicationReact } : {}),`.

`angular/scripts/ecrire-config.mjs` — après la clé Google :

```js
// Origine de l'application React, facultative (parcours de la carte, étapes ⑤-⑦) : la même variable que Next.
const urlReact = vars.NEXT_PUBLIC_APP_URL
  || (existsSync(sourceSecours) ? lire(sourceSecours).NEXT_PUBLIC_APP_URL : '');
if (urlReact) config.urlApplicationReact = urlReact.replace(/\/+$/, '');
```

`parcours/etape-bientot.component.ts` :

```ts
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ConfigService } from '../../../core/config/config.service';
import { CONSIGNE_ETAPE, type EtapeCarte, lienApplicationReact } from '../logique/parcours';

/**
 * Le panneau d'une étape pas encore portée (⑤ Plan, ⑥ Activation, ⑦ Live — spec § 12, lot 1) : ce qu'elle fera, et un
 * lien vers l'écran React qui le fait aujourd'hui (`/map?tab=…`, nouvel onglet). Sans origine React connue — hôte AIDA,
 * configuration pas encore lue — aucun lien : on n'invente pas une adresse.
 */
@Component({
  selector: 'mg-etape-bientot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-3 px-5 py-4' },
  template: `
    <div [attr.data-etape-bientot]="etape()" class="flex flex-col gap-3">
      <p class="m-0 text-[13px] leading-[1.5] text-secondary">{{ consigne() }}</p>
      @if (lien(); as href) {
        <a [href]="href" target="_blank" rel="noopener noreferrer"
           class="self-start rounded-[6px] border-fin border-teal px-4 py-2 text-[12px] font-medium text-teal no-underline transition-colors duration-150 ease-[var(--ease-hover)] hover:bg-teal-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-teal-50)]">
          Ouvrir dans l’application actuelle
        </a>
      } @else {
        <p class="m-0 text-[12px] text-tertiary">Bientôt dans le parcours.</p>
      }
    </div>
  `,
})
export class EtapeBientotComponent {
  readonly etape = input.required<EtapeCarte>();
  private readonly config = inject(ConfigService);
  protected readonly consigne = computed(() => CONSIGNE_ETAPE[this.etape()]);
  protected readonly lien = computed(() => lienApplicationReact(this.origine(), this.etape()));

  /** `valeur` lève tant que la configuration n'est pas chargée : pas d'origine, pas de lien. */
  private origine(): string | undefined {
    try {
      return this.config.valeur.urlApplicationReact;
    } catch {
      return undefined;
    }
  }
}
```

- [ ] **Step 4: PASS** — même commande. Puis `cd angular && npm run config` et vérifier `angular/public/config.local.json` (contient `urlApplicationReact` si `NEXT_PUBLIC_APP_URL` est posée ; ne JAMAIS commiter ce fichier, il est ignoré).
- [ ] **Step 5: Commit** — `feat(angular): étapes Plan, Activation et Live « bientôt », avec le lien vers l'écran React`.

---

### Task 4: La page en parcours — barre, fil, panneau d'étape, clavier ; le rail retiré

**Files:**
- Create: `angular/src/app/features/carte/parcours/barre-parcours.component.ts` (+ spec), `angular/src/app/features/carte/parcours/panneau-etape.component.ts` (+ spec)
- Modify: `angular/src/app/features/carte/carte.page.ts`, `carte.page.html`, `carte.page.spec.ts`, `etat/etat-carte.service.ts` (+ spec), `legende/legende-carte.component.ts` (+ `.html` si `gauche` y est lu), `carte-hote.component.spec.ts` (`mg-barre-haut` → `mg-barre-parcours`), `tests/unit/angular/carte-logique-paritaire.test.ts`
- Delete: `rail/rail.component.ts`, `rail/barre-haut.component.ts`, `rail/panneau.component.ts` (+ leurs specs), `filtre/puce-filtre.component.ts` (+ spec), `commun/boutons-flottants.component.ts` (+ spec), `logique/navigation.ts`

**Interfaces:**
- Consumes: T1 (tout), T2 (`ParcoursService`), T3 (`EtapeBientotComponent`), `FilEtapesComponent`, `FilArianeComponent`, `LogoComponent` (`mg-logo [hauteur]`), `BasculeThemeComponent` (`mg-bascule-theme`), `BadgeSessionComponent` (`mg-badge-session`, `orgChangee: output<string|null>`), `ignorerRaccourciClavier` (`logique/garde-saisie.ts`).
- Produces:
  - `BarreParcoursComponent` (`mg-barre-parcours`) : inputs `etapes: EtapeAffichee[]`, `courante: string`, `segments: SegmentAriane[]`, `precision?: string`, `zoneScript: string | null`, `planMedia: number | null` ; outputs `choisir: string`, `remonter: number`, `toutEffacer`, `genererScript`, `rouvrirPlan`, `basculerImmersif`, `orgChangee: string | null`. Export `HAUTEUR_BARRE_PARCOURS = 44`.
  - `PanneauEtapeComponent` (`mg-panneau-etape`) : inputs `etape: EtapeCarte`, `masque: boolean` ; `replie = model(false)` ; `<ng-content>`.
  - `EtatCarteService` : `immersif = signal(false)` (ex-`railMasque`) ; `entreeActive`, `choisirEntree`, `fermerEntree` RETIRÉS.
  - `CartePage` : `parcours: ParcoursService` (fourni), `choisirEtape(cle: string)`, `remonterAriane(i: number)`.

Exigences de rendu et de comportement :
- Hôte de la page : `relative flex h-full flex-col overflow-hidden`, `tabindex="-1"`, `(keydown)` seul (le `(mousedown)` « clic hors du panneau » disparaît : le panneau est dans le flux, il ne se ferme plus).
- Corps : `mg-panneau-etape` (aside 320-900 px, défaut 480, poignée `role="separator"` capturée sur ELLE-MÊME, jamais sur `window`) puis le conteneur carte `relative flex-1` (`data-zone-carte`).
- Panneaux : `@for (e of etapesMontees(); track e)`, chacun `absolute inset-0 overflow-y-auto`, l'étape non courante `invisible` + `inert` + `aria-hidden` — jamais `@if` sur l'étape quittée. ① `mg-panneau-filtre`, ② `mg-panneau-calques`, ③ `mg-panneau-analyse`, ④ `mg-panneau-zones`, ⑤-⑦ `mg-etape-bientot`.
- Mode immersif (`etat.immersif`) : barre retirée, aside `visibility: hidden` largeur 0 (panneaux MONTÉS) ; Échap le quitte (pile, id `'immersif'`) ; en immersif, un bouton `[data-quitter-immersif]` (icône `agrandir`) en haut à droite du conteneur carte (T5 le range dans la boîte à outils).
- Panneau replié (« carte seule ») : un onglet `[data-afficher-panneau]` (icône `chevron-droite`) au bord gauche du conteneur carte, centré verticalement, le rouvre.
- Légende, plan média (`[haut]="0"`), annonce, détail IRIS, tiroir Street View, zone active, badge de zoom, sélecteur compact de fond : DANS le conteneur carte. `legende-carte` : `gauche = 12` (plus de `LARGEUR_RAIL`).
- Clavier : garde de saisie, puis Échap → `pile.fermerLePlusHaut()` (sauf `defaultPrevented`), puis **si `moduleOuvert()` : rien** (Review Focus 2), puis `etapeParRaccourci` → `parcours.choisir`.
- Fil d'Ariane : `segmentsDuFiltre(etat.filtre())`, précision `precisionDuPerimetre(etat.perimetreScope())` ; « France entière » (index 0) retire le filtre (`etat.filtre.set(null)`) — c'est la croix de l'ancienne puce.
- Pastilles : `filtrePose = etat.filtre() !== null || etat.perimetreScope() !== null` ; `calquesActifs = etat.degradeActif() !== null || etat.poiSelectionnes().length > 0 || tmja.visible() || radio.visible() || risqueCarte.actif() || risqueCarte.pprtActif()`.
- `carte.page.ts` ≤ 400 lignes.

- [ ] **Step 1: Specs (échec)** — `parcours/barre-parcours.component.spec.ts` :

```ts
import { TestBed } from '@angular/core/testing';
import { BarreParcoursComponent } from './barre-parcours.component';
import { etapesDuFil } from '../logique/parcours';
// Fournir les fausses dépendances de mg-badge-session exactement comme carte.page.spec.ts (AuthService, OrganisationsApi).

describe('BarreParcoursComponent', () => {
  it('rend le logo, le fil d’Ariane, les sept étapes dans l’ordre, Tout effacer, le mode immersif, le thème, la session', async () => { /* … */
    // attendus : mg-logo, mg-fil-ariane, 7 boutons dans mg-fil-etapes nav, [data-tout-effacer], [data-immersif], mg-bascule-theme, mg-badge-session
  });
  it('Script bidding DV360 et Plan média (n) n’existent que s’ils ont un objet', async () => {
    // zoneScript null, planMedia null → aucun [data-script-dv360], [data-rouvrir-plan] ; zoneScript 'Brest', planMedia 3 → les deux, « Plan média (3) »
  });
  it('relaie choisir, remonter, toutEffacer, genererScript, rouvrirPlan, basculerImmersif, orgChangee', async () => { /* … */ });
});
```

(Écrire les trois corps avec `TestBed.createComponent`, `setInput('etapes', etapesDuFil({ filtrePose: false, calquesActifs: false }))`, `setInput('courante', 'perimetre')`, `setInput('segments', [{ cle: 'france', libelle: 'France entière' }])`, et des espions sur les `output` via `componentInstance.<sortie>.subscribe`.)

`parcours/panneau-etape.component.spec.ts` (hôte de test qui projette `<div data-contenu>`) :
- consigne de l'étape rendue (`[data-consigne]` = `CONSIGNE_ETAPE.donnees` pour `etape = 'donnees'`), `aside[aria-label="Étape 2 — Données"]` ;
- largeur 480 par défaut ; `pointerdown` puis `pointermove` +200 px sur la poignée → 680 ; +2 000 → 900 ; −2 000 → 320 ;
- `[data-replier]` → `replie` vrai, aside `visibility: hidden` et largeur 0, contenu TOUJOURS dans le DOM, poignée absente ;
- `masque = true` → même chose sans toucher à `replie`.

`carte.page.spec.ts` — remplacer/adapter (le harnais `ouvrir()` reste, `CarteApi` factice inchangé ; retirer l'import de `ENTREES_NAVIGATION`) :

| Test existant | Devient |
|---|---|
| (f) rail, 5 + 2 entrées | « la barre rend ① à ⑦ dans l'ordre, ① courante (`aria-current="step"`), aucun `mg-rail` » |
| (g) Alt+2 ouvre Calques, Échap le ferme | « Alt+2 (code `Digit2`, key `&`) passe à ② : `[data-panneau-etape="donnees"]` contient `mg-panneau-calques`, URL `?etape=donnees` ; Échap ne le ferme pas » |
| (h) Alt+2 depuis un `<input>` | inchangé dans l'esprit : l'étape reste ① |
| (i) Échap depuis un `<input>` | « Échap depuis un `<input>` quitte quand même le mode immersif » |
| (j) Campagne inerte, Ctrl+K | « Alt+5 ouvre ⑤ : `mg-etape-bientot[…][data-etape-bientot="plan"]` ; Alt+C et Ctrl+K : l'étape ne change pas, frappe non consommée » |
| clic d'entrée ouvre/ferme, même panneau | « cliquer ③ dans le fil la rend courante ; revenir à ① retrouve la MÊME instance de `PanneauFiltreComponent` (`By.directive`) » |
| clic hors du panneau le ferme | « un clic sur la carte ne replie ni ne change rien » |
| croix du panneau rend le focus / re-clic | « replier puis rouvrir le panneau garde les panneaux montés » |
| Échap dans le menu du badge | garder : Échap consommé par le menu (`defaultPrevented`) → `PileEchapService.fermerLePlusHaut` non appelé (espion) |
| (k) immersif | « `[data-immersif]` : barre retirée, aside caché, panneaux montés ; Échap rétablit ; `[data-quitter-immersif]` aussi » |
| Échap ferme le DERNIER ouvert | déplacé en T5 (tiroir + immersif) |
| barre du haut (logo, Campagne/Carte, thème, session) | « la barre porte logo, fil d'Ariane, fil d'étapes, Tout effacer, immersif, thème, session » |
| navigation de requête réutilise l'écran | garder, avec `?etape=analyse` : même `CartePage`, carte créée une fois, étape ③ |
| T4 « sélecteur compact FOND » | garder jusqu'en T5 |
| Tout effacer | déclenché par `[data-tout-effacer]` de la barre |
| Réglages et Aide | retiré ici, couvert en T5 |
| T5 panneau Filtre, pastille, puce | « ① monte le panneau Filtre ; un filtre posé allume la pastille de ① (`.sr-only` « (renseignée) » quand on est à ②) et ajoute son segment au fil d'Ariane ; cliquer « France entière » le retire » |
| T5 « rouvrir re-sème » | « revenir à ① garde « France entière » pressée (panneau monté, aucune relecture) » |
| T6, T7, T11 (Calques, IRIS, météo) | ouvrir ② par Alt+2 au lieu du rail ; T7 revue 1 : « fermer le détail rend le focus : Alt+2 répond encore » |
| T13 module risque | garder les 4 ; AJOUTER « module ouvert : Alt+3 ne change ni l'étape ni l'URL `/carte/risques…` » (Review Focus 2) |
| T13 « Zones › Jeux de zones » | garder jusqu'en T6 (ouvrir ④ par Alt+4) |
| T14 customZone | « `?customZone=<id>` ouvre ④ » + bouton `[data-script-dv360]` dans la barre |
| T14 changement d'organisation | émis depuis `mg-barre-parcours` |
| T15 plan média | bouton `[data-rouvrir-plan]` dans la barre |

AJOUTER (Review Focus 4) :

```ts
  it('zéro relecture : après une visite de ① à ④, cinq bascules ne relisent rien', async () => {
    const geo = vi.fn(() => of({ regions: [] }));
    const lister = vi.fn(() => of({ zones: [] }));
    const { hote, stable } = await ouvrir({ referentiel: geo, zones: { lister } });
    for (const n of ['2', '3', '4', '1']) { frapper(hote, { key: n, code: `Digit${n}`, altKey: true }); await stable(); }
    const avant = [geo.mock.calls.length, lister.mock.calls.length];
    for (const n of ['3', '1', '4', '2', '1']) { frapper(hote, { key: n, code: `Digit${n}`, altKey: true }); await stable(); }
    expect([geo.mock.calls.length, lister.mock.calls.length]).toEqual(avant);
    expect(hote.querySelectorAll('[data-panneau-etape]').length).toBe(4);
  });
```

(Ajouter à `OptionsOuverture` un champ `referentiel?: () => unknown` utilisé par le faux `ReferentielApi` : `{ geo: options.referentiel ?? (() => of({ regions: [] })) }`.)

`etat-carte.service.spec.ts` : retirer les tests de `choisirEntree`/`fermerEntree` ; renommer `railMasque` → `immersif`.

- [ ] **Step 2: FAIL** — `cd angular && npx ng test --watch=false --include='src/app/features/carte/**/*.spec.ts'`.

- [ ] **Step 3: Implémenter.**

`parcours/barre-parcours.component.ts` :

```ts
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { BadgeSessionComponent } from '../../../layout/badge-session.component';
import { BasculeThemeComponent } from '../../../layout/bascule-theme.component';
import { FilArianeComponent, type SegmentAriane } from '../../../ui/fil-ariane/fil-ariane.component';
import { type EtapeAffichee, FilEtapesComponent } from '../../../ui/fil-etapes/fil-etapes.component';
import { IconeComponent } from '../../../ui/icone/icone.component';
import { LogoComponent } from '../../../ui/logo/logo.component';

export const HAUTEUR_BARRE_PARCOURS = 44;

const BOUTON_TEAL = 'flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] border-fin border-teal bg-transparent px-[10px] py-[5px] text-[11px] font-medium text-teal transition-colors duration-150 ease-[var(--ease-hover)] hover:bg-teal-10';
const BOUTON_NEUTRE = 'flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] border-fin border-default bg-transparent px-[10px] py-[5px] text-[11px] text-secondary transition-colors duration-150 ease-[var(--ease-hover)] hover:border-hover hover:bg-elevated hover:text-primary';

/**
 * La barre du parcours (spec § 3) : OÙ JE REGARDE (fil d'Ariane, nourri par ①) puis OÙ J'EN SUIS (fil d'étapes) — deux
 * fils, pas un doublon, comme l'en-tête du module risque. À droite, ce qui vaut à toute étape (arbitrage A5) : les deux
 * boutons contextuels de l'ancienne colonne flottante (Script bidding DV360 de la zone du lien, Plan média (n) panneau
 * fermé), Tout effacer, le mode immersif, le thème, la session. Elle remplace la barre du haut et le rail.
 * Dans le flux de la page (jamais `fixed`, racine d'ombre).
 */
@Component({
  selector: 'mg-barre-parcours',
  imports: [BadgeSessionComponent, BasculeThemeComponent, FilArianeComponent, FilEtapesComponent, IconeComponent, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'banner',
    class: 'flex shrink-0 items-center gap-3 border-b-fin border-subtle bg-surface pl-4 pr-[14px]',
    '[style.height.px]': 'hauteur',
  },
  template: `
    <mg-logo [hauteur]="18" class="block shrink-0" />
    <mg-fil-ariane class="shrink-0" [segments]="segments()" [precision]="precision()" (remonter)="remonter.emit($event)" />
    <div class="min-w-0 flex-1 overflow-x-auto">
      <mg-fil-etapes [etapes]="etapes()" [courante]="courante()" (choisir)="choisir.emit($event)" />
    </div>
    @if (zoneScript(); as nom) {
      <button type="button" data-script-dv360 (click)="genererScript.emit()" [class]="boutonTeal"
              [attr.title]="'Générer le fichier custom bidding DV360 pour « ' + nom + ' »'">
        <mg-icone nom="fichier-bas" [taille]="13" [trait]="1.5" />Script bidding DV360
      </button>
    }
    @if (planMedia(); as n) {
      <button type="button" data-rouvrir-plan (click)="rouvrirPlan.emit()" title="Rouvrir le plan média des zones affichées"
              [class]="boutonTeal">Plan média ({{ n }})</button>
    }
    <button type="button" data-tout-effacer (click)="toutEffacer.emit()" title="Tout effacer (couches et zones affichées)" [class]="boutonNeutre">
      <mg-icone nom="gomme" [taille]="13" [trait]="1.5" />Tout effacer
    </button>
    <button type="button" data-immersif (click)="basculerImmersif.emit()" aria-label="Mode immersif"
            title="Masquer la barre et le panneau (mode immersif, Échap pour revenir)"
            class="flex shrink-0 cursor-pointer items-center rounded-[6px] border-0 bg-transparent p-1.5 text-tertiary hover:text-primary">
      <mg-icone nom="reduire" [taille]="16" [trait]="1.5" />
    </button>
    <mg-bascule-theme />
    <mg-badge-session (orgChangee)="orgChangee.emit($event)" />
  `,
})
export class BarreParcoursComponent {
  protected readonly hauteur = HAUTEUR_BARRE_PARCOURS;
  protected readonly boutonTeal = BOUTON_TEAL;
  protected readonly boutonNeutre = BOUTON_NEUTRE;

  readonly etapes = input.required<EtapeAffichee[]>();
  readonly courante = input.required<string>();
  readonly segments = input.required<SegmentAriane[]>();
  readonly precision = input<string>();
  /** Le nom de la zone du lien `?customZone=` ; `null` sans elle (le bouton DV360 n'existe que pour elle). */
  readonly zoneScript = input<string | null>(null);
  /** Le nombre de zones du plan média quand son panneau est FERMÉ, `null` sinon. */
  readonly planMedia = input<number | null>(null);

  readonly choisir = output<string>();
  readonly remonter = output<number>();
  readonly toutEffacer = output<void>();
  readonly genererScript = output<void>();
  readonly rouvrirPlan = output<void>();
  readonly basculerImmersif = output<void>();
  /** Relais de `mg-badge-session` : l'hôte de la route recrée la page (droits sur la carte, T3). */
  readonly orgChangee = output<string | null>();
}
```

`parcours/panneau-etape.component.ts` :

```ts
import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { IconeComponent } from '../../../ui/icone/icone.component';
import { CONSIGNE_ETAPE, type EtapeCarte, LARGEUR_PANNEAU_ETAPE, LIBELLE_ETAPE_CARTE, rangEtapeCarte } from '../logique/parcours';

/**
 * Le panneau de l'étape courante (spec § 3) — patron du module risque (`RisquePage` : aside dans le flux, poignée
 * 320-900 px, repli « carte seule »). Il porte la consigne d'une ligne de l'étape et PROJETTE les panneaux montés par la
 * page : replié ou masqué (mode immersif), il passe à `visibility: hidden` et largeur nulle, jamais `display: none` ni
 * `@if` — rien de ce qu'il porte ne se démonte. La largeur et le repli restent LOCAUX : un lien partagé n'impose pas sa
 * mise en page (comme le risque).
 */
@Component({
  selector: 'mg-panneau-etape',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <aside [attr.aria-label]="titre()" class="relative flex min-w-0 shrink-0 flex-col overflow-hidden bg-surface"
           [style.width.px]="cache() ? 0 : largeur()" [style.visibility]="cache() ? 'hidden' : 'visible'">
      <div class="flex shrink-0 items-start gap-2 border-b-fin border-subtle px-4 py-2.5">
        <p data-consigne class="m-0 flex-1 text-[12px] leading-[1.5] text-secondary">{{ consigne() }}</p>
        <button type="button" data-replier (click)="replie.set(true)" aria-label="Replier le panneau (carte seule)" title="Carte seule"
                class="flex shrink-0 cursor-pointer border-0 bg-transparent p-1 text-tertiary hover:text-primary">
          <mg-icone nom="chevron-gauche" [taille]="14" [trait]="1.5" />
        </button>
      </div>
      <div class="relative min-h-0 flex-1"><ng-content /></div>
    </aside>
    @if (!cache()) {
      <div role="separator" aria-orientation="vertical" aria-label="Largeur du panneau"
           [attr.aria-valuenow]="largeur()" [attr.aria-valuemin]="bornes.min" [attr.aria-valuemax]="bornes.max"
           class="w-[5px] shrink-0 cursor-col-resize touch-none bg-[var(--border-subtle)]"
           (pointerdown)="saisirPoignee($event)"></div>
    }
  `,
})
export class PanneauEtapeComponent {
  readonly etape = input.required<EtapeCarte>();
  /** Mode immersif : caché sans toucher au repli choisi. */
  readonly masque = input(false);
  readonly replie = model(false);

  protected readonly bornes = LARGEUR_PANNEAU_ETAPE;
  readonly largeur = signal<number>(LARGEUR_PANNEAU_ETAPE.defaut);
  protected readonly cache = computed(() => this.masque() || this.replie());
  protected readonly titre = computed(() => `Étape ${rangEtapeCarte(this.etape())} — ${LIBELLE_ETAPE_CARTE[this.etape()]}`);
  protected readonly consigne = computed(() => CONSIGNE_ETAPE[this.etape()]);

  /** Capture du pointeur sur la POIGNÉE elle-même, jamais `window` (celui du shell) — recopie de `RisquePage.saisirPoignee`. */
  protected saisirPoignee(ev: PointerEvent): void {
    const poignee = ev.currentTarget as HTMLElement;
    poignee.setPointerCapture?.(ev.pointerId);
    const depart = ev.clientX;
    const initiale = this.largeur();
    const deplacer = (e: PointerEvent) => {
      this.largeur.set(Math.max(this.bornes.min, Math.min(this.bornes.max, initiale + e.clientX - depart)));
    };
    const relacher = () => {
      poignee.removeEventListener('pointermove', deplacer);
      poignee.removeEventListener('pointerup', relacher);
      poignee.removeEventListener('pointercancel', relacher);
    };
    poignee.addEventListener('pointermove', deplacer);
    poignee.addEventListener('pointerup', relacher);
    poignee.addEventListener('pointercancel', relacher);
  }
}
```

`etat/etat-carte.service.ts` : retirer l'import de `../logique/navigation`, le signal `entree`, `entreeActive`, `choisirEntree`, `fermerEntree` et la section « ENTRÉES DU RAIL » de l'en-tête ; `railMasque` devient `/** Mode immersif : barre du parcours et panneau d'étape masqués. */ readonly immersif = signal(false);`.

`carte.page.html` (contenu complet) :

```html
<!-- La barre du parcours (spec § 3) : retirée en mode immersif. -->
@if (!etat.immersif()) {
  <mg-barre-parcours
    [etapes]="etapes()" [courante]="parcours.etape()"
    [segments]="segmentsAriane()" [precision]="precisionAriane()"
    [zoneScript]="lienZone.zoneDuLien()?.nom ?? null" [planMedia]="zonesPlanFerme()"
    (choisir)="choisirEtape($event)" (remonter)="remonterAriane($event)"
    (toutEffacer)="toutEffacer()" (genererScript)="genererScriptDv360()" (rouvrirPlan)="planMedia.ouvert.set(true)"
    (basculerImmersif)="basculerImmersif()" (orgChangee)="organisationChangee()"
  />
}

<div class="flex min-h-0 flex-1">
  <!-- Les panneaux d'étape : MONTÉS à la première visite, puis gardés (arbitrage A1). L'étape quittée devient
       invisible et inerte — jamais @if : un calcul en cours (bataille, clustering, zone en création) lui survit. -->
  <mg-panneau-etape [etape]="parcours.etape()" [masque]="etat.immersif()" [(replie)]="panneauReplie">
    @for (e of etapesMontees(); track e) {
      <div [attr.data-panneau-etape]="e" class="absolute inset-0 flex flex-col overflow-y-auto"
           [class.invisible]="e !== parcours.etape()"
           [attr.inert]="e !== parcours.etape() ? '' : null"
           [attr.aria-hidden]="e !== parcours.etape() ? 'true' : null">
        @switch (e) {
          @case ('perimetre') { <mg-panneau-filtre /> }
          @case ('donnees') { <mg-panneau-calques /> }
          @case ('analyse') { <mg-panneau-analyse /> }
          @case ('zones') { <mg-panneau-zones /> }
          @default { <mg-etape-bientot [etape]="e" /> }
        }
      </div>
    }
  </mg-panneau-etape>

  <!-- La carte, permanente. `inert` pendant le module risque (T13 du lot 4). -->
  <div class="relative flex min-w-0 flex-1 overflow-hidden" data-zone-carte [attr.inert]="moduleOuvert() ? '' : null">
    @for (f of [fond()]; track f) {
      <mg-carte class="min-h-0 min-w-0 flex-1" [fond]="urlFond()" [centre]="centre" [zoomInitial]="zoomInitial"
                [navigation]="navigation" (prete)="cartePrete($event)" (zoom)="zoomChange($event)">
        <div data-badge-zoom
             class="pointer-events-none absolute left-[10px] top-[10px] z-10 rounded-[4px] border-fin border-default bg-card-overlay px-2 py-[3px] font-mono text-[11px] leading-[20px] tracking-[0.05em] text-secondary">{{ texteZoom() }}</div>
        <mg-fond-compact [fond]="fond()" (choisirFond)="choisirFond($event)" />
      </mg-carte>
    }
    <mg-detail-iris />
    <mg-zone-active />
    <mg-tiroir-panneau />
    <mg-legende-carte [degradeActif]="etat.degradeActif()" />
    @if (planMedia.visible()) {
      <mg-plan-media [haut]="0" (fermer)="planMedia.ouvert.set(false)" />
    }
    @if (panneauReplie() && !etat.immersif()) {
      <button type="button" data-afficher-panneau (click)="panneauReplie.set(false)" aria-label="Afficher le panneau de l’étape" title="Afficher le panneau"
              class="absolute left-0 top-1/2 z-40 flex -translate-y-1/2 cursor-pointer rounded-r-[6px] border-fin border-l-0 border-default bg-surface px-1 py-3 text-secondary hover:text-primary">
        <mg-icone nom="chevron-droite" [taille]="14" [trait]="1.5" />
      </button>
    }
    @if (etat.immersif()) {
      <button type="button" data-quitter-immersif (click)="basculerImmersif()" aria-label="Quitter le mode immersif" title="Afficher la barre et le panneau (Échap)"
              class="absolute top-[10px] z-50 flex cursor-pointer rounded-[6px] border-fin border-default bg-surface p-2 text-secondary hover:border-hover hover:bg-elevated hover:text-primary"
              [style.right.px]="decalageOutils()">
        <mg-icone nom="agrandir" [taille]="16" [trait]="1.5" />
      </button>
    }
    <mg-annonce />
  </div>
</div>

<!-- Le dialogue « Zones météo » : un <dialog> natif DANS la racine d'ombre (B13). -->
@if (meteo.dialogueOuvert()) {
  <mg-dialogue-meteo />
}

<!-- Le module risque, route enfant `risques` (lot 4, B2) : en surimpression de toute la page, la carte intacte dessous.
     Il reste tel quel jusqu'au lot 4 du parcours (arbitrage A8). -->
<div class="absolute inset-0 z-[60]" [class.hidden]="!moduleOuvert()" data-module-risque>
  <router-outlet (activate)="moduleOuvert.set(true)" (deactivate)="moduleOuvert.set(false)" />
</div>
```

`carte.page.ts` — partir du fichier actuel et :
1. Imports : retirer `AideComponent`, `BarreHautComponent`/`HAUTEUR_BARRE_HAUT`, `BoutonsFlottantsComponent`, `PanneauComponent`, `RailComponent`, `PuceFiltreComponent`, `ReglagesComponent`, `ENTREES_NAVIGATION`/`LARGEUR_RAIL`/`EntreeId`/`entreeParRaccourci`, `viewChild`, la constante `POINT_PAR_ENTREE` ; ajouter `IconeComponent`, `BarreParcoursComponent`, `PanneauEtapeComponent`, `EtapeBientotComponent`, `ParcoursService`, `ETAPES_CARTE`, `etapeParRaccourci`, `etapesDuFil`, `lireEtape`, `precisionDuPerimetre`, `segmentsDuFiltre`, `SegmentAriane`.
2. `imports` du composant : `AnnonceComponent, BarreParcoursComponent, CarteComponent, DetailIrisComponent, DialogueMeteoComponent, EtapeBientotComponent, FondCompactComponent, IconeComponent, LegendeCarteComponent, PanneauAnalyseComponent, PanneauCalquesComponent, PanneauEtapeComponent, PanneauFiltreComponent, PanneauZonesComponent, PlanMediaComponent, RouterOutlet, TiroirPanneauComponent, ZoneActiveComponent`.
3. `providers` : ajouter `ParcoursService` en tête (le reste inchangé).
4. `host` : `{ class: 'relative flex h-full flex-col overflow-hidden bg-[var(--bg-primary)] outline-none', tabindex: '-1', '(keydown)': 'clavier($event)' }`.
5. Membres retirés : `largeurRail`, `hauteurBarre`, `panneau`, `panneauOuvert`, `cadrePanneau`, `composantPanneau`, `rail`, `choisir`, `panneauFerme`, `pointerHors`. `decalageBoutons` est renommé `decalageOutils` (même formule).
6. Membres ajoutés :

```ts
  /** L'étape courante et les étapes visitées, reflétées dans `?etape=` (T2). */
  protected readonly parcours = inject(ParcoursService);
  private readonly tmja = inject(TmjaService);
  private readonly radio = inject(RadioService);
  private readonly risqueCarte = inject(RisqueCarteService);
  /** « Carte seule » : local, jamais dans l'URL (comme le risque). */
  protected readonly panneauReplie = signal(false);
  /** Les panneaux montés, dans l'ordre du parcours. */
  protected readonly etapesMontees = computed(() => ETAPES_CARTE.filter((e) => this.parcours.visitees().has(e)));
  protected readonly etapes = computed(() => etapesDuFil({
    filtrePose: this.etat.filtre() !== null || this.etat.perimetreScope() !== null,
    calquesActifs: this.etat.degradeActif() !== null || this.etat.poiSelectionnes().length > 0 || this.tmja.visible()
      || this.radio.visible() || this.risqueCarte.actif() || this.risqueCarte.pprtActif(),
  }));
  protected readonly segmentsAriane = computed<SegmentAriane[]>(() => segmentsDuFiltre(this.etat.filtre()));
  protected readonly precisionAriane = computed(() => precisionDuPerimetre(this.etat.perimetreScope()));

  protected choisirEtape(cle: string): void {
    const e = lireEtape(cle);
    if (e) this.parcours.choisir(e);
  }

  /** « France entière » du fil d'Ariane : retire le filtre — la croix de l'ancienne puce. */
  protected remonterAriane(index: number): void {
    if (index === 0) this.etat.filtre.set(null);
  }
```

7. Le constructeur : l'effet du mode immersif empile `'immersif'` (au lieu de `'rail-masque'`) sur `etat.immersif()` ; `basculerImmersif()` bascule `etat.immersif`. Le reste du constructeur est inchangé (services instanciés, surcharges MAGELIAN, retours de focus iris/pois/météo/module, focus d'ouverture).
8. `clavier(e)` :

```ts
  protected clavier(e: KeyboardEvent): void {
    // `nodeType` et non `instanceof Element` : la cible peut venir d'un autre domaine de JavaScript.
    const premier = e.composedPath()[0] as Node | undefined;
    const cible = premier && premier.nodeType === 1 ? (premier as Element) : null;
    if (ignorerRaccourciClavier(e.key, cible)) return;
    if (e.key === 'Escape') {
      if (e.defaultPrevented) return;
      e.preventDefault();
      this.pile.fermerLePlusHaut();
      return;
    }
    // Sous le module risque, le parcours ne bouge pas : un raccourci n'écrit pas l'URL de la carte dessous (Review Focus 2).
    if (this.moduleOuvert()) return;
    const etape = etapeParRaccourci(e);
    if (!etape) return;
    e.preventDefault();
    this.parcours.choisir(etape);
  }
```

9. Réécrire l'en-tête de la classe : « La carte principale, en PARCOURS (spec 2026-10-13, lot 1) » ; garder les blocs « fond recrée la carte », « un seul écouteur clavier, sur l'hôte », « pile Échap » ; remplacer « une route plein écran / rail » par « barre du parcours + panneau d'étape + carte, tout dans le flux ».

`legende/legende-carte.component.ts` : retirer l'import de `../logique/navigation` ; `protected readonly gauche = 12;` avec le commentaire « à 12 px du bord du conteneur carte (le panneau d'étape est dans le flux, à gauche) ». Mettre à jour la phrase d'en-tête qui cite `LARGEUR_RAIL`.

`tests/unit/angular/carte-logique-paritaire.test.ts` : retirer `import * as An from '…/carte/logique/navigation'` et les trois `it('navigation — …')` ; si `Rn` n'est plus utilisé, retirer aussi son import ; ajouter en tête : « Depuis le parcours de la carte (2026-10-13, lot 1), Angular n'a plus de rail : sa copie de `lib/navigation/config.ts` est supprimée. React, gelé, garde la sienne. » Les autres blocs (garde de saisie, filtre…) restent.

`carte-hote.component.spec.ts` : `mg-barre-haut` → `mg-barre-parcours`.

Supprimer les fichiers listés (`git rm`), puis vérifier qu'aucune référence ne reste :

```bash
grep -rn "logique/navigation\|rail/\|mg-rail\|mg-barre-haut\|mg-panneau-carte\|mg-puce-filtre\|mg-boutons-flottants\|railMasque\|choisirEntree\|entreeActive\|LARGEUR_RAIL\|HAUTEUR_BARRE_HAUT" angular/src tests/unit/angular
```
→ aucune ligne (hors commentaires historiques explicitement datés).

- [ ] **Step 4: PASS** — `cd angular && npx ng test --watch=false` (suite complète ; les dépassements de 5 s connus de `remote.spec.ts` sur poste chargé se signalent, ne se corrigent pas), `npx vitest run --project unit tests/unit/angular`, `cd angular && npm run build`, `npx tsc --noEmit`.
- [ ] **Step 5: Navigateur** — `:4202`, super_admin, espace BMW GROUP : ① à ⑦ au clic et à Alt+1…7 (clavier AZERTY), poignée, carte seule, immersif + Échap, ⑤ « bientôt » avec lien qui ouvre `:3000/map?tab=strategie` ; ② → Zones à risque → « Analyser » → fermer le module : retour à ②, `?etape=donnees` dans l'URL. Captures deux thèmes.
- [ ] **Step 6: Commit** — `feat(angular): la carte en parcours — barre, fil d'étapes, panneau d'étape ; le rail est retiré`.

---

### Task 5: La boîte à outils — fond, légende, aide, réglages

**Files:**
- Create: `angular/src/app/features/carte/outils/outils-carte.service.ts` (+ spec), `outils/boite-outils.component.ts` (+ spec), `commun/choix-fond.component.ts` (+ spec)
- Modify: `panneaux/aide.component.ts` (+ spec), `panneaux/reglages.component.ts` (+ spec), `carte.page.ts`, `carte.page.html`, `carte.page.spec.ts`
- Delete: `commun/fond-compact.component.ts` (+ spec)

**Interfaces:**
- Consumes: T1 (`EtapeCarte`, `ETAPES_CARTE`, `LIBELLE_ETAPE_CARTE`, `CONSIGNE_ETAPE`, `rangEtapeCarte`), `PileEchapService.empiler(id, fermer)/depiler(id)`, `MAP_STYLES` (`logique/fonds.ts`).
- Produces:
  - `type OutilCarte = 'analyses' | 'zones' | 'fond' | 'aide' | 'reglages'` ; `OutilsCarteService` (`@Injectable()`, fourni par la page) : `outil: Signal<OutilCarte | null>`, `legendeVisible: WritableSignal<boolean>`, `revisionZones: Signal<number>`, `basculer(o)`, `ouvrir(o)`, `fermer()`, `zonesModifiees()`. Constante `PILE_OUTIL = 'outil'`.
  - `BoiteOutilsComponent` (`mg-boite-outils`) : inputs `droite: number`, `fond: string`, `etape: EtapeCarte`, `immersif: boolean` ; outputs `choisirFond: string`, `quitterImmersif: void`. Liste `OUTILS` exportée (T6 y ajoute deux entrées).
  - `ChoixFondComponent` (`mg-choix-fond`) : `fond = input.required<string>()`, `choisirFond = output<string>()`.
  - `AideComponent` : `etape = input.required<EtapeCarte>()` ; `formaterRaccourci` reste exporté.
  - `ReglagesComponent` : plus d'`input` ni d'`output` (section Fond retirée).

- [ ] **Step 1: Specs (échec)**
  - `outils-carte.service.spec.ts` (service fourni avec `PileEchapService`) : `basculer('fond')` ouvre, re-`basculer('fond')` ferme, `basculer('aide')` remplace ; outil ouvert → `pile.fermerLePlusHaut()` le ferme ; fermé → la pile ne contient plus `'outil'` ; `zonesModifiees()` incrémente `revisionZones` ; `legendeVisible` vrai par défaut.
  - `boite-outils.component.spec.ts` : la barre `role="toolbar"` rend, dans l'ordre, `[data-outil="fond"]`, `legende`, `aide`, `reglages` avec `aria-label` « Fond de carte », « Légende », « Aide », « Réglages » ; clic Fond → `[data-tiroir-outil]` titré « Fond de carte » contenant `mg-choix-fond`, `aria-pressed="true"` sur le bouton ; clic Légende → `legendeVisible` faux, aucun tiroir ; croix du tiroir → fermé ; `immersif = true` → `[data-quitter-immersif]` présent et relayé ; `droite = 620` → `style.right` = `620px` sur la barre et `668px` sur le tiroir.
  - `choix-fond.component.spec.ts` : reprendre les tests « Fond de carte » de `reglages.component.spec.ts` (4 boutons `[data-fond]`, `aria-pressed` sur le courant, émission de l'id).
  - `aide.component.spec.ts` : `etape = 'zones'` → `[data-aide-etape]` titré « 4. Zones » + `CONSIGNE_ETAPE.zones` ; 8 `[data-raccourci]` : « 1. Périmètre » `Alt + 1` … « 7. Live » `Alt + 7`, puis Échap ; `formaterRaccourci('alt+1') === 'Alt + 1'`.
  - `reglages.component.spec.ts` : plus de section `[data-section="fond"]` ; Apparence et Back office inchangés (Accès et Health check actifs, huit inertes).
  - `carte.page.spec.ts` : « Échap ferme le DERNIER ouvert : immersif puis tiroir Aide → tiroir d'abord, puis immersif » ; « le tiroir Aide suit l'étape : ② puis ④ → titre « 4. Zones » » ; « Fond › Clair recrée la carte (test T4 « choisir Clair » rejoué depuis le tiroir) » ; « Légende masque `mg-legende-carte` » ; « fermer le tiroir qui portait le focus le rend à l'hôte : Alt+2 répond encore » ; le test « sélecteur compact FOND » est SUPPRIMÉ (fonction couverte par le tiroir Fond).

- [ ] **Step 2: FAIL** — `cd angular && npx ng test --watch=false --include='src/app/features/carte/**/*.spec.ts'`.

- [ ] **Step 3: Implémenter.**

`outils/outils-carte.service.ts` :

```ts
import { Injectable, type Signal, effect, inject, signal } from '@angular/core';
import { PileEchapService } from '../etat/pile-echap.service';

/** Les outils qui ouvrent un tiroir. La légende et le mode immersif sont des bascules, pas des tiroirs. */
export type OutilCarte = 'analyses' | 'zones' | 'fond' | 'aide' | 'reglages';
/** L'id du tiroir dans la pile Échap : un seul tiroir à la fois (spec § 6). */
export const PILE_OUTIL = 'outil';

/**
 * La boîte à outils de la carte (spec § 6) : l'outil ouvert, l'affichage de la légende, et un compteur que « Créer une
 * zone » (④) incrémente pour que « Mes zones », ouvert dans le tiroir, se relise sans être recréé.
 * `@Injectable()` sans `providedIn` : fourni par la page carte.
 */
@Injectable()
export class OutilsCarteService {
  private readonly pile = inject(PileEchapService);
  private readonly _outil = signal<OutilCarte | null>(null);
  readonly outil: Signal<OutilCarte | null> = this._outil.asReadonly();
  readonly legendeVisible = signal(true);
  private readonly _revisionZones = signal(0);
  readonly revisionZones: Signal<number> = this._revisionZones.asReadonly();

  constructor() {
    effect((nettoyer) => {
      if (!this._outil()) return;
      this.pile.empiler(PILE_OUTIL, () => this.fermer());
      nettoyer(() => this.pile.depiler(PILE_OUTIL));
    });
  }

  basculer(o: OutilCarte): void {
    this._outil.update((c) => (c === o ? null : o));
  }

  ouvrir(o: OutilCarte): void {
    this._outil.set(o);
  }

  fermer(): void {
    this._outil.set(null);
  }

  zonesModifiees(): void {
    this._revisionZones.update((n) => n + 1);
  }
}
```

`commun/choix-fond.component.ts` : le `<section data-section="fond">` de `reglages.component.ts` sans son `<h4>`, en composant :

```ts
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MAP_STYLES } from '../logique/fonds';

/** Le choix du fond de carte (tiroir « Fond de carte ») — extrait de la section Fond des Réglages ; la page recrée la carte (B11). */
@Component({
  selector: 'mg-choix-fond',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'grid grid-cols-2 gap-1.5 px-3.5 py-3' },
  template: `
    @for (s of fonds; track s.id) {
      <button type="button" [attr.data-fond]="s.id" [attr.aria-pressed]="s.id === fond()" (click)="choisirFond.emit(s.id)"
        class="cursor-pointer rounded-[6px] border-fin px-2.5 py-2 font-sans text-[11px] transition-[background-color,border-color,color] duration-150 ease-[var(--ease-hover)]"
        [class]="s.id === fond() ? 'border-teal bg-teal-10 text-teal' : 'border-default bg-transparent text-secondary'">{{ s.label }}</button>
    }
  `,
})
export class ChoixFondComponent {
  readonly fond = input.required<string>();
  readonly choisirFond = output<string>();
  protected readonly fonds = MAP_STYLES;
}
```

`outils/boite-outils.component.ts` :

```ts
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { IconeComponent } from '../../../ui/icone/icone.component';
import type { NomIcone } from '../../../ui/icone/icones';
import { ChoixFondComponent } from '../commun/choix-fond.component';
import type { EtapeCarte } from '../logique/parcours';
import { AideComponent } from '../panneaux/aide.component';
import { ReglagesComponent } from '../panneaux/reglages.component';
import { type OutilCarte, OutilsCarteService } from './outils-carte.service';

export interface EntreeOutil {
  readonly id: OutilCarte | 'legende';
  readonly libelle: string;
  readonly icone: NomIcone;
  /** Un filet AVANT l'entrée (Aide et Réglages, à part : maquette du 2026-10-13). */
  readonly separeAvant?: boolean;
}

/** Les boutons, dans l'ordre de la maquette. T6 ajoute « Mes analyses » et « Mes zones » en tête. */
export const OUTILS: readonly EntreeOutil[] = [
  { id: 'fond', libelle: 'Fond de carte', icone: 'carte' },
  { id: 'legende', libelle: 'Légende', icone: 'menu' },
  { id: 'aide', libelle: 'Aide', icone: 'aide', separeAvant: true },
  { id: 'reglages', libelle: 'Réglages', icone: 'reglages' },
];

/**
 * La boîte à outils (spec § 6) : une colonne de boutons-icônes en haut à droite du conteneur carte, hors du fil, et UN
 * tiroir à sa gauche. Tout est `absolute` dans le conteneur carte (jamais `fixed`, racine d'ombre) ; `droite` écarte la
 * colonne du plan média quand il est ouvert. Échap ferme le tiroir (pile, `OutilsCarteService`). En mode immersif, la
 * colonne porte aussi le bouton qui en sort.
 */
@Component({
  selector: 'mg-boite-outils',
  imports: [AideComponent, ChoixFondComponent, IconeComponent, ReglagesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <div role="toolbar" aria-label="Boîte à outils" aria-orientation="vertical" data-boite-outils
         class="absolute top-[10px] z-[45] flex flex-col gap-1 rounded-[8px] border-fin border-subtle bg-card-overlay p-1"
         [style.right.px]="droite()">
      @for (o of liste; track o.id) {
        @if (o.separeAvant) { <div aria-hidden="true" class="mx-1 my-0.5 h-[0.5px] bg-subtle"></div> }
        <button type="button" [attr.data-outil]="o.id" [attr.title]="o.libelle" [attr.aria-label]="o.libelle"
                [attr.aria-pressed]="o.id === 'legende' ? outils.legendeVisible() : outils.outil() === o.id"
                (click)="cliquer(o.id)"
                class="grid size-8 cursor-pointer place-items-center rounded-[6px] border-0 bg-transparent text-secondary hover:bg-[var(--overlay)] hover:text-primary aria-pressed:bg-teal-10 aria-pressed:text-teal">
          <mg-icone [nom]="o.icone" [taille]="16" [trait]="1.5" />
        </button>
      }
      @if (immersif()) {
        <div aria-hidden="true" class="mx-1 my-0.5 h-[0.5px] bg-subtle"></div>
        <button type="button" data-quitter-immersif (click)="quitterImmersif.emit()" aria-label="Quitter le mode immersif"
                title="Afficher la barre et le panneau (Échap)"
                class="grid size-8 cursor-pointer place-items-center rounded-[6px] border-0 bg-transparent text-secondary hover:bg-[var(--overlay)] hover:text-primary">
          <mg-icone nom="agrandir" [taille]="16" [trait]="1.5" />
        </button>
      }
    </div>

    @if (outils.outil(); as o) {
      <section role="region" data-tiroir-outil [attr.data-outil-ouvert]="o" [attr.aria-label]="titre()"
               class="absolute top-[10px] z-[45] flex max-h-[calc(100%-20px)] w-[320px] flex-col overflow-hidden rounded-[8px] border-fin border-subtle bg-surface"
               [style.right.px]="droite() + 48">
        <header class="flex shrink-0 items-center gap-2 border-b-fin border-subtle px-3.5 py-2.5">
          <span aria-hidden="true" class="size-1.5 shrink-0 rounded-full bg-teal"></span>
          <span class="text-[12px] font-medium text-primary">{{ titre() }}</span>
          <button type="button" aria-label="Fermer" (click)="outils.fermer()"
                  class="ml-auto flex cursor-pointer border-0 bg-transparent p-1 text-tertiary hover:text-primary">
            <mg-icone nom="croix" [taille]="14" [trait]="1.5" />
          </button>
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto">
          @switch (o) {
            @case ('fond') { <mg-choix-fond [fond]="fond()" (choisirFond)="choisirFond.emit($event)" /> }
            @case ('aide') { <mg-aide [etape]="etape()" /> }
            @case ('reglages') { <mg-reglages /> }
          }
        </div>
      </section>
    }
  `,
})
export class BoiteOutilsComponent {
  protected readonly outils = inject(OutilsCarteService);
  protected readonly liste = OUTILS;

  /** Écart au bord droit du conteneur carte : 10 px, plus le plan média ouvert. */
  readonly droite = input(10);
  readonly fond = input.required<string>();
  readonly etape = input.required<EtapeCarte>();
  readonly immersif = input(false);
  readonly choisirFond = output<string>();
  readonly quitterImmersif = output<void>();

  protected readonly titre = computed(() => OUTILS.find((x) => x.id === this.outils.outil())?.libelle ?? '');

  protected cliquer(id: EntreeOutil['id']): void {
    if (id === 'legende') this.outils.legendeVisible.update((v) => !v);
    else this.outils.basculer(id);
  }
}
```

`panneaux/aide.component.ts` (réécrit) :

```ts
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CONSIGNE_ETAPE, ETAPES_CARTE, type EtapeCarte, LIBELLE_ETAPE_CARTE, rangEtapeCarte } from '../logique/parcours';

/** 'alt+1' -> 'Alt + 1' — `formaterRaccourci` de `HelpOverlay.tsx:7-12`. */
export function formaterRaccourci(raccourci: string): string {
  return raccourci.split('+').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' + ');
}

const RACCOURCIS = [
  ...ETAPES_CARTE.map((e) => ({ libelle: `${rangEtapeCarte(e)}. ${LIBELLE_ETAPE_CARTE[e]}`, touches: formaterRaccourci(`alt+${rangEtapeCarte(e)}`) })),
  { libelle: 'Fermer le tiroir, quitter le mode immersif', touches: 'Échap' },
];

/**
 * Le tiroir « Aide » de la boîte à outils (spec § 6) : l'aide de l'ÉTAPE COURANTE, puis les raccourcis du parcours,
 * DÉRIVÉS de `ETAPES_CARTE` (jamais recopiés). L'ancienne liste dérivait de la navigation du rail, retirée.
 */
@Component({
  selector: 'mg-aide',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-4 px-4 py-3 font-sans' },
  template: `
    <section data-aide-etape>
      <h4 class="m-0 text-[12px] font-medium text-primary">{{ rang() }}. {{ libelle() }}</h4>
      <p class="mb-0 mt-1 text-[12px] leading-[1.5] text-secondary">{{ consigne() }}</p>
      <p class="mb-0 mt-1 text-[11px] leading-[1.5] text-tertiary">Le parcours n’est pas un tunnel : chaque étape reste ouverte, dans les deux sens.</p>
    </section>
    <section>
      <h4 class="mb-2 mt-0 text-[11px] font-medium text-secondary">Raccourcis clavier</h4>
      @for (r of raccourcis; track r.touches) {
        <div data-raccourci class="flex items-center justify-between border-b-fin border-subtle px-1.5 py-2">
          <span class="text-[12px] text-primary">{{ r.libelle }}</span>
          <span class="rounded-[4px] border-fin border-default bg-elevated px-2 py-0.5 font-mono text-[11px] text-secondary">{{ r.touches }}</span>
        </div>
      }
    </section>
  `,
})
export class AideComponent {
  readonly etape = input.required<EtapeCarte>();
  protected readonly rang = computed(() => rangEtapeCarte(this.etape()));
  protected readonly libelle = computed(() => LIBELLE_ETAPE_CARTE[this.etape()]);
  protected readonly consigne = computed(() => CONSIGNE_ETAPE[this.etape()]);
  protected readonly raccourcis = RACCOURCIS;
}
```

`panneaux/reglages.component.ts` : retirer la `<section data-section="fond">`, `fond`/`choisirFond`, `input`/`output`/`MAP_STYLES` des imports et `fonds` ; en-tête : « Deux sections : Apparence, Back office. Le fond de carte a son propre outil (tiroir « Fond de carte », 2026-10-13). » ; les `cible` relatives (`'../admin/acces'`) restent justes : le tiroir est rendu par la page de la route `carte`.

`carte.page.ts` / `.html` : fournir `OutilsCarteService` ; injecter `protected readonly outils = inject(OutilsCarteService)` ; remplacer `<mg-fond-compact …/>` (retiré) et le bouton `[data-quitter-immersif]` de la page par `<mg-boite-outils [droite]="decalageOutils()" [fond]="fond()" [etape]="parcours.etape()" [immersif]="etat.immersif()" (choisirFond)="choisirFond($event)" (quitterImmersif)="basculerImmersif()" />` dans le conteneur carte ; `@if (outils.legendeVisible()) { <mg-legende-carte … /> }` ; ajouter `this.rendreFocusALaFermeture(() => this.outils.outil() !== null);` ; retirer `FondCompactComponent` et ajouter `BoiteOutilsComponent` aux `imports`. Supprimer `commun/fond-compact.component.ts` et sa spec (`git rm`).

- [ ] **Step 4: PASS** — suite Angular complète, `npm run build` (Angular), `npx tsc --noEmit`.
- [ ] **Step 5: Navigateur** — chaque outil ouvert/fermé (clic, croix, Échap), plan média ouvert : colonne et tiroir à sa gauche sans chevauchement ; Aide à ① puis ④ ; deux thèmes.
- [ ] **Step 6: Commit** — `feat(angular): boîte à outils de la carte — fond, légende, aide, réglages`.

---

### Task 6: « Mes analyses » et « Mes zones » dans la boîte à outils

**Files:**
- Move: `panneaux/calques/mes-analyses.component.ts` → `outils/mes-analyses.component.ts`, `panneaux/calques/mes-analyses.service.ts` → `outils/mes-analyses.service.ts` (+ specs ; `git mv`, imports relatifs corrigés)
- Create: `outils/outil-mes-analyses.component.ts`, `outils/outil-mes-zones.component.ts` (+ specs)
- Modify: `outils/boite-outils.component.ts` (`OUTILS` + deux `@case`), `panneaux/calques/panneau-calques.component.ts` (+ spec), `panneaux/zones/panneau-zones.component.ts` (+ spec), `carte.page.spec.ts`

**Interfaces:**
- Consumes: T5 (`OutilsCarteService.revisionZones`, `zonesModifiees()`, `ouvrir()`), `MesAnalysesService.demanderChargement()`, `MesZonesComponent` (`rafraichir = input(0)`), `JeuxDeZonesComponent`.
- Produces: `OutilMesAnalysesComponent` (`mg-outil-mes-analyses`), `OutilMesZonesComponent` (`mg-outil-mes-zones`) ; `OUTILS` commence par `{ id: 'analyses', libelle: 'Mes analyses', icone: 'fiole' }, { id: 'zones', libelle: 'Mes zones', icone: 'formes' }`.

- [ ] **Step 1: Specs (échec)**
  - `outil-mes-analyses.component.spec.ts` : `AnalysesApi.lister` espionné → appelé UNE fois à la création du composant (= ouverture du tiroir) ; liste rendue par `mg-mes-analyses` ; « Rejouer » d'un score appelle `ScoreService.afficher` (reprendre le test existant de `mes-analyses.component.spec.ts`).
  - `outil-mes-zones.component.spec.ts` : rend `mg-jeux-de-zones` puis `mg-mes-zones` ; `zonesModifiees()` sur le service → `MesZonesComponent.rafraichir` passe à 1 (même instance, la sélection survit).
  - `panneau-zones.component.spec.ts` : plus de `mg-jeux-de-zones` ni `mg-mes-zones` ; `[data-ouvrir-mes-zones]` → `OutilsCarteService.outil() === 'zones'` ; une zone créée (`(cree)` d'un `mg-creer-*`) → `revisionZones` incrémenté.
  - `panneau-calques.component.spec.ts` : plus de groupe « Mes analyses » ni de `MesAnalysesService`.
  - `carte.page.spec.ts` : le test T13 « Zones › Jeux de zones » devient « outil Mes zones : la liste des jeux est rendue dans le tiroir » ; T14 « le panneau Zones monte le vrai panneau » : créer à ④, jeux + Mes zones dans l'outil.
- [ ] **Step 2: FAIL** — suite `src/app/features/carte/**`.
- [ ] **Step 3: Implémenter.**

`outils/outil-mes-analyses.component.ts` :

```ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MesAnalysesComponent } from './mes-analyses.component';
import { MesAnalysesService } from './mes-analyses.service';

/**
 * Le tiroir « Mes analyses » (spec § 6 : « Mes analyses » sort des calques). Créé à l'ouverture du tiroir, détruit à sa
 * fermeture : la liste est lue à CHAQUE ouverture, jamais au chargement de la carte — l'équivalent du premier dépliage
 * du groupe de Calques, qu'il remplace. Le service est fourni ICI.
 */
@Component({
  selector: 'mg-outil-mes-analyses',
  imports: [MesAnalysesComponent],
  providers: [MesAnalysesService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mg-mes-analyses />`,
})
export class OutilMesAnalysesComponent {
  constructor() {
    inject(MesAnalysesService).demanderChargement();
  }
}
```

`outils/outil-mes-zones.component.ts` :

```ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { JeuxDeZonesComponent } from '../panneaux/zones/jeux-de-zones.component';
import { MesZonesComponent } from '../panneaux/zones/mes-zones.component';
import { OutilsCarteService } from './outils-carte.service';

/**
 * Le tiroir « Mes zones » (spec § 6) : les jeux de zones, puis « Mes zones » (recherche, puces, opérations, affichage,
 * export, suppression) — sortis du panneau Zones, qui garde « Créer une zone ». Une zone créée à ④ relit la liste
 * (`revisionZones`) sans recréer le composant : la sélection en cours survit.
 */
@Component({
  selector: 'mg-outil-mes-zones',
  imports: [JeuxDeZonesComponent, MesZonesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mg-jeux-de-zones />
    <section data-section="mes-zones" class="pt-3">
      <h4 class="mb-2 mt-0 px-4 text-[11px] font-medium text-secondary">Mes zones</h4>
      <mg-mes-zones [rafraichir]="outils.revisionZones()" />
    </section>
  `,
})
export class OutilMesZonesComponent {
  protected readonly outils = inject(OutilsCarteService);
}
```

`boite-outils.component.ts` : préfixer `OUTILS` des deux entrées ; ajouter `@case ('analyses') { <mg-outil-mes-analyses /> }` et `@case ('zones') { <mg-outil-mes-zones /> }` ; importer les deux composants ; corriger le commentaire de `OUTILS`.

`panneau-zones.component.ts` : retirer `JeuxDeZonesComponent`, `MesZonesComponent`, `<mg-jeux-de-zones />`, la section `mes-zones` et le signal `rafraichir` ; `relire()` devient `this.outils.zonesModifiees()` (`private readonly outils = inject(OutilsCarteService)`, rendre `protected`) ; ajouter sous « Créer une zone » :

```html
    <section data-section="vers-mes-zones" class="px-4 py-3">
      <p class="m-0 text-[12px] leading-[1.5] text-tertiary">Vos zones et jeux de zones enregistrés sont dans la boîte à outils.</p>
      <button type="button" data-ouvrir-mes-zones (click)="outils.ouvrir('zones')"
              class="mt-2 cursor-pointer rounded-[6px] border-fin border-default bg-transparent px-3 py-1.5 text-[12px] text-secondary hover:border-hover hover:bg-elevated hover:text-primary">Ouvrir « Mes zones »</button>
    </section>
```

Mettre à jour l'en-tête (« trois sections » → « Créer une zone, puis le renvoi vers l'outil Mes zones (2026-10-13) »).

`panneau-calques.component.ts` : retirer le groupe « Mes analyses », `MesAnalysesComponent`, `MesAnalysesService` (`providers`, injection), `basculerAnalyses`, la clé `analyses` de `CleGroupe`/`groupes` ; en-tête : « Mes analyses » vit dans la boîte à outils depuis le 2026-10-13.

- [ ] **Step 4: PASS** — suite Angular complète, build, `tsc`.
- [ ] **Step 5: Commit** — `feat(angular): Mes analyses et Mes zones passent dans la boîte à outils`.

---

### Task 7: Aucune fonction perdue — l'inventaire verrouillé, la preuve, la doc (fin du lot 1)

**Files:**
- Modify: `angular/src/app/features/carte/carte.page.spec.ts` (nouveau `describe`), `ARCHITECTURE.md`, `angular/src/app/features/carte/README.md`, `docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md` (§ « Écarts à la livraison », s'il y en a)
- Create: `.superpowers/sdd/2026-10-13-carte-parcours/lot1-*.png` (non suivi)

**Interfaces:**
- Consumes: T1-T6 (sélecteurs `data-*` posés par elles).

Le tableau « fonction → nouvelle place » (spec § 12 : « sans aucune perte ») :

| # | Fonction (avant) | Où elle était | Nouvelle place | Preuve (sélecteur) |
|---|---|---|---|---|
| 1 | Filtre « où je regarde » | rail › Filtre (Alt+1) | ① (Alt+1) | `[data-panneau-etape="perimetre"] mg-panneau-filtre` |
| 2 | Pastille « filtre posé » | rail | pastille de ① | `mg-fil-etapes` « (renseignée) » |
| 3 | Puce du filtre + sa croix | sur la carte | fil d'Ariane, « France entière » | `mg-barre-parcours mg-fil-ariane` |
| 4 | Calques (tous groupes) | rail › Calques (Alt+2) | ② (Alt+2) | `[data-panneau-etape="donnees"] mg-panneau-calques` |
| 5 | Zones à risque industriel → module | Calques › Environnement | ② (inchangé jusqu'au lot 4) | `mg-section-risque` |
| 6 | Analyse (score, corrélation, isochrones, bataille, clustering, Voronoï) | rail › Analyse (Alt+3) | ③ (Alt+3) | `[data-panneau-etape="analyse"] mg-panneau-analyse` |
| 7 | Créer une zone (capture, CP, rayon, dessin) | rail › Zones (Alt+4) | ④ (Alt+4) | `[data-panneau-etape="zones"] [data-section="creer"]` |
| 8 | Jeux de zones à risque | Zones | outil Mes zones | `[data-tiroir-outil] mg-jeux-de-zones` |
| 9 | Mes zones (opérations, export, suppression) | Zones | outil Mes zones | `[data-tiroir-outil] mg-mes-zones` |
| 10 | Mes analyses (rejouer, supprimer) | Calques | outil Mes analyses | `[data-tiroir-outil] mg-mes-analyses` |
| 11 | Fond de carte (Réglages) + sélecteur compact « FOND » | Réglages, carte | outil Fond de carte | `[data-tiroir-outil] mg-choix-fond` |
| 12 | Apparence (thème) | Réglages, barre | outil Réglages + barre | `mg-reglages [data-section="apparence"]`, `mg-barre-parcours mg-bascule-theme` |
| 13 | Back office (Accès, Health check) | Réglages | outil Réglages | `mg-reglages a[href*="admin/acces"]` |
| 14 | Raccourcis clavier | Aide | outil Aide (+ aide de l'étape) | `[data-raccourci]` ×8, `[data-aide-etape]` |
| 15 | Légende | carte | carte + outil Légende | `mg-legende-carte`, `[data-outil="legende"]` |
| 16 | Tout effacer | bouton flottant | barre | `[data-tout-effacer]` |
| 17 | Mode immersif (+ Échap) | bouton flottant | barre + boîte à outils | `[data-immersif]`, `[data-quitter-immersif]` |
| 18 | Script bidding DV360 (zone du lien) | bouton flottant | barre | `[data-script-dv360]` (avec `?customZone=`) |
| 19 | Plan média (n) | bouton flottant | barre | `[data-rouvrir-plan]` (zone affichée, panneau fermé) |
| 20 | Session, changement d'espace | barre du haut | barre | `mg-barre-parcours mg-badge-session` |
| 21 | Campagne (inerte, Alt+C) | rail, barre du haut | ⑤ « bientôt » + lien React (Alt+5) | `[data-etape-bientot="plan"]` |
| 22 | Badge de zoom, détail IRIS, Street View, zone active, dialogue météo, module risque | carte | inchangés | `[data-badge-zoom]`, `mg-detail-iris`, `mg-tiroir-panneau`, `mg-zone-active`, `[data-module-risque]` |

- [ ] **Step 1: Le test d'inventaire (échec attendu seulement si une ligne manque)** — dans `carte.page.spec.ts` :

```ts
type Lieu = { etape?: 1 | 2 | 3 | 4 | 5; outil?: 'analyses' | 'zones' | 'fond' | 'aide' | 'reglages' };
interface LigneInventaire { n: number; fonction: string; lieu: Lieu; preuve: string; url?: string; avant?: (h: HTMLElement) => void }

const INVENTAIRE: readonly LigneInventaire[] = [
  { n: 1, fonction: 'Filtre', lieu: { etape: 1 }, preuve: '[data-panneau-etape="perimetre"] mg-panneau-filtre' },
  { n: 3, fonction: 'Puce du filtre', lieu: {}, preuve: 'mg-barre-parcours mg-fil-ariane' },
  { n: 4, fonction: 'Calques', lieu: { etape: 2 }, preuve: '[data-panneau-etape="donnees"] mg-panneau-calques' },
  { n: 6, fonction: 'Analyse', lieu: { etape: 3 }, preuve: '[data-panneau-etape="analyse"] mg-panneau-analyse' },
  { n: 7, fonction: 'Créer une zone', lieu: { etape: 4 }, preuve: '[data-panneau-etape="zones"] [data-section="creer"]' },
  { n: 8, fonction: 'Jeux de zones', lieu: { outil: 'zones' }, preuve: '[data-tiroir-outil] mg-jeux-de-zones' },
  { n: 9, fonction: 'Mes zones', lieu: { outil: 'zones' }, preuve: '[data-tiroir-outil] mg-mes-zones' },
  { n: 10, fonction: 'Mes analyses', lieu: { outil: 'analyses' }, preuve: '[data-tiroir-outil] mg-mes-analyses' },
  { n: 11, fonction: 'Fond de carte', lieu: { outil: 'fond' }, preuve: '[data-tiroir-outil] mg-choix-fond' },
  { n: 12, fonction: 'Apparence', lieu: { outil: 'reglages' }, preuve: 'mg-reglages [data-section="apparence"]' },
  { n: 13, fonction: 'Back office', lieu: { outil: 'reglages' }, preuve: 'mg-reglages a[href*="admin/acces"]' },
  { n: 14, fonction: 'Raccourcis', lieu: { outil: 'aide' }, preuve: '[data-aide-etape]' },
  { n: 15, fonction: 'Légende', lieu: {}, preuve: 'mg-legende-carte' },
  { n: 16, fonction: 'Tout effacer', lieu: {}, preuve: '[data-tout-effacer]' },
  { n: 17, fonction: 'Mode immersif', lieu: {}, preuve: '[data-immersif]' },
  { n: 18, fonction: 'Script bidding DV360', lieu: {}, preuve: '[data-script-dv360]', url: '/carte?customZone=00000000-0000-0000-0000-0000000000aa' },
  { n: 20, fonction: 'Session', lieu: {}, preuve: 'mg-barre-parcours mg-badge-session' },
  { n: 21, fonction: 'Campagne', lieu: { etape: 5 }, preuve: '[data-etape-bientot="plan"]' },
  { n: 22, fonction: 'Badge de zoom', lieu: {}, preuve: '[data-badge-zoom]' },
];

describe('CartePage — aucune fonction perdue (spec § 12, lot 1)', () => {
  it.each(INVENTAIRE)('$n. $fonction → $preuve', async (l) => {
    const { hote, stable } = await ouvrir({ url: l.url, zones: l.url ? { geometrie: () => of(ZONE_DU_LIEN) } : undefined });
    if (l.lieu.etape) { frapper(hote, { key: String(l.lieu.etape), code: `Digit${l.lieu.etape}`, altKey: true }); await stable(); }
    if (l.lieu.outil) { (hote.querySelector(`[data-outil="${l.lieu.outil}"]`) as HTMLElement).click(); await stable(); }
    expect(hote.querySelector(l.preuve), `${l.n}. ${l.fonction}`).not.toBeNull();
  });
});
```

(`ZONE_DU_LIEN` : la fixture de zone déjà employée par les tests T14 du même fichier ; la réutiliser telle quelle. La ligne 19 « Plan média (n) » est couverte par le test T15 du fichier, la ligne 2 par le test T5 adapté en T4, la ligne 5 par les tests T13 : le dire en commentaire au-dessus de `INVENTAIRE`.)

- [ ] **Step 2: Lancer** — `cd angular && npx ng test --watch=false --include='src/app/features/carte/carte.page.spec.ts'` → PASS (sinon : une fonction a été perdue en T4-T6 ; la rétablir, ne pas retirer la ligne).
- [ ] **Step 3: Preuve navigateur, deux thèmes** — `:4202`, super_admin, BMW GROUP puis MARINE (badge) : à chaque ligne du tableau, une capture ou un relevé ; changer d'espace depuis ③ avec le tiroir Aide ouvert → page recréée à ①, URL sans `etape` ; un lien `/carte?etape=zones&customZone=<id réel>` collé dans un nouvel onglet → ④ et la zone recadrée. Relever dans l'onglet Réseau qu'un aller-retour ①→④→① ne relit rien.
- [ ] **Step 4: Doc** — `ARCHITECTURE.md` : Grep `## Application Angular`, ajouter une puce « **Carte en parcours, lot 1 (2026-10-13)** » : `logique/parcours.ts`, `ParcoursService` et `?etape=`, barre du parcours, panneau d'étape monté à la première visite, boîte à outils (6 outils), ⑤-⑦ « bientôt » et `urlApplicationReact`, raccourcis Alt+1…7, fichiers retirés (rail, barre du haut, panneau, puce, boutons flottants, sélecteur compact, `navigation.ts`), arbitrages A1-A9. Grep `config.local.json` pour documenter le champ facultatif. `features/carte/README.md` : réécrire la section de navigation. `npm run test:unit` (dont `tests/unit/docs/derive-documentation.test.ts`) vert.
- [ ] **Step 5: Tests complets** — `npx tsc --noEmit`, `npm run test:unit`, `cd angular && npx ng test --watch=false`, `cd angular && npm run build`.
- [ ] **Step 6: Commit** — `docs(carte): parcours lot 1 livré — inventaire des fonctions, preuve et architecture`.

---

## LOT 2 — Données rangées (7 tâches)

### Task 8: La table de la sélection recommandée et sa RPC

**Files:**
- Create: `sql/251_espace_jeux_recommandes.sql` (prendre le premier numéro libre au moment d'exécuter : `ls sql | sort -V | tail -3`)
- Test: `tests/integration/jeux-recommandes.test.ts`
- Doc: `ARCHITECTURE.md` (Grep `zone_set_extractions` pour trouver la liste des tables, et la liste des RPC)

**Interfaces:**
- Produces: table `public.espace_jeux_recommandes (organization_id uuid FK organizations ON DELETE CASCADE, cle_jeu text CHECK '^[a-z]+:[a-z0-9_-]{1,64}$', cree_le timestamptz, PK (organization_id, cle_jeu))` ; RPC `public.remplacer_jeux_recommandes(p_organization_id uuid, p_cles text[]) RETURNS jsonb` → `{ "cles": [...] }` trié, dédoublonné ; > 200 clés → erreur `22023`.

- [ ] **Step 1: Test d'intégration (échec)** — `tests/integration/jeux-recommandes.test.ts` :

```ts
/**
 * La sélection recommandée d'un espace (spec carte-en-parcours § 7.2) : une RPC qui REMPLACE la liste en une
 * transaction (jamais un DELETE suivi d'un INSERT côté route, qui doublerait ou viderait sur une erreur à moitié).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { creerClientTest } from './_client';

const admin = creerClientTest();
let org = '';

async function remplacer(cles: string[]) {
  return admin.rpc('remplacer_jeux_recommandes', { p_organization_id: org, p_cles: cles });
}
async function lire(): Promise<string[]> {
  const { data, error } = await admin.from('espace_jeux_recommandes').select('cle_jeu').eq('organization_id', org).order('cle_jeu');
  if (error) throw new Error(error.message);
  return (data ?? []).map((l) => l.cle_jeu as string);
}

beforeAll(async () => {
  const { data, error } = await admin.from('organizations')
    .insert({ name: '[ESSAI parcours] Recommandés', slug: `essai-parcours-reco-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(`création de l'espace : ${error?.message}`);
  org = data.id as string;
});
afterAll(async () => {
  const { error } = await admin.from('organizations').delete().eq('id', org);
  if (error) throw new Error(`nettoyage : ${error.message}`);
});

describe('remplacer_jeux_recommandes', () => {
  it('remplace, dédoublonne et trie', async () => {
    const { data, error } = await remplacer(['poi:lycee', 'iris:socio-demo', 'poi:lycee']);
    expect(error).toBeNull();
    expect(data).toEqual({ cles: ['iris:socio-demo', 'poi:lycee'] });
    expect(await lire()).toEqual(['iris:socio-demo', 'poi:lycee']);
  });
  it('une seconde liste REMPLACE la première', async () => {
    await remplacer(['tmja:comptages']);
    expect(await lire()).toEqual(['tmja:comptages']);
  });
  it('une clé mal formée est refusée et la liste précédente reste intacte (transaction)', async () => {
    await remplacer(['iris:socio-demo']);
    const { error } = await remplacer(['iris:socio-demo', 'Pas Une Clé']);
    expect(error?.code).toBe('23514');
    expect(await lire()).toEqual(['iris:socio-demo']);
  });
  it('plus de 200 clés : refusé', async () => {
    const { error } = await remplacer(Array.from({ length: 201 }, (_, i) => `poi:c${i}`));
    expect(error?.code).toBe('22023');
  });
  it('une liste vide efface tout', async () => {
    await remplacer([]);
    expect(await lire()).toEqual([]);
  });
  it('supprimer l’espace emporte ses recommandations', async () => {
    const { data } = await admin.from('organizations')
      .insert({ name: '[ESSAI parcours] Cascade', slug: `essai-parcours-cascade-${Date.now()}` }).select('id').single();
    const id = data!.id as string;
    await admin.rpc('remplacer_jeux_recommandes', { p_organization_id: id, p_cles: ['meteo:zones'] });
    const { error } = await admin.from('organizations').delete().eq('id', id);
    expect(error).toBeNull();
    const { count } = await admin.from('espace_jeux_recommandes').select('cle_jeu', { count: 'exact', head: true }).eq('organization_id', id);
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 2: FAIL** — `npx vitest run --project integration tests/integration/jeux-recommandes.test.ts` (relation inexistante).

- [ ] **Step 3: Migration** — `sql/251_espace_jeux_recommandes.sql` :

```sql
-- 251 — Sélection recommandée de données par espace (2026-10-13)
--
-- Spec : docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md § 7.2 (V6).
-- À l'étape ② de la carte, « Données communes » s'ouvre sur la sélection recommandée de l'espace ; le reste se range
-- dans « Autres données communes ». Une recommandation RANGE : elle ne donne ni ne retire aucun droit (les droits
-- restent ceux de data_sources / getOrgSourceIds), et ne précharge aucun calque.
--
-- cle_jeu : la clé d'un jeu de la carte, `famille:nom` — registre lib/carte/jeux-carte.ts (référentiels, ex.
-- `iris:socio-demo`) ou `poi:<categorie>`. Le CHECK est la MÊME expression que RE_CLE_JEU de ce registre.
--
-- Écriture : UNIQUEMENT par remplacer_jeux_recommandes (une transaction : la liste entière remplace l'ancienne ; une
-- clé refusée laisse l'ancienne intacte). Taille : ≤ 200 lignes par espace (garde de la fonction) — sous le plafond
-- PostgREST de 1 000, la lecture de table par espace est bornée par construction.
--
-- Coût : lecture par la clé primaire (organization_id en tête) ; quelques dizaines de lignes au plus.
-- Droits : service_role seul (les routes passent par createAdminClient). Rejouable.

begin;

create table if not exists public.espace_jeux_recommandes (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cle_jeu         text not null check (cle_jeu ~ '^[a-z]+:[a-z0-9_-]{1,64}$'),
  cree_le         timestamptz not null default now(),
  primary key (organization_id, cle_jeu)
);

comment on table public.espace_jeux_recommandes is
  'Selection recommandee de jeux de la carte par espace (etape 2, bloc Donnees communes). Range, ne donne aucun droit. Ecrite par remplacer_jeux_recommandes (sql/251).';

alter table public.espace_jeux_recommandes enable row level security;
revoke all on table public.espace_jeux_recommandes from public, anon, authenticated;
grant select, insert, delete on table public.espace_jeux_recommandes to service_role;

create or replace function public.remplacer_jeux_recommandes(p_organization_id uuid, p_cles text[])
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if cardinality(coalesce(p_cles, '{}'::text[])) > 200 then
    raise exception 'au plus 200 jeux recommandes par espace' using errcode = '22023';
  end if;
  delete from public.espace_jeux_recommandes where organization_id = p_organization_id;
  insert into public.espace_jeux_recommandes (organization_id, cle_jeu)
    select distinct p_organization_id, c
    from unnest(coalesce(p_cles, '{}'::text[])) as c
    where c is not null;
  return jsonb_build_object(
    'cles',
    coalesce(
      (select jsonb_agg(r.cle_jeu order by r.cle_jeu)
       from public.espace_jeux_recommandes r
       where r.organization_id = p_organization_id),
      '[]'::jsonb
    )
  );
end;
$function$;

comment on function public.remplacer_jeux_recommandes(uuid, text[]) is
  'Remplace la selection recommandee d un espace en une transaction ; rend {cles} trie. RETURNS jsonb (sql/251).';

revoke all on function public.remplacer_jeux_recommandes(uuid, text[]) from public, anon, authenticated;
grant execute on function public.remplacer_jeux_recommandes(uuid, text[]) to service_role;

commit;
```

Appliquer DEUX fois (rejouable), en local seulement :

```bash
docker exec -i supabase_db_genesis_app psql -U postgres -d postgres -v ON_ERROR_STOP=1 < sql/251_espace_jeux_recommandes.sql
docker exec -i supabase_db_genesis_app psql -U postgres -d postgres -v ON_ERROR_STOP=1 < sql/251_espace_jeux_recommandes.sql
docker exec supabase_db_genesis_app psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema';"
```

- [ ] **Step 4: PASS + EXPLAIN** — le test ci-dessus ; puis `EXPLAIN (ANALYZE, BUFFERS) select cle_jeu from public.espace_jeux_recommandes where organization_id = '<uuid d'un espace>' order by cle_jeu;` → noter le plan (Index Scan sur la clé primaire) et les buffers dans le rapport.
- [ ] **Step 5: Doc** — `ARCHITECTURE.md` : la table et la RPC aux listes concernées (Grep `remplacer_` / `## Base de données` ou la section des tables), avec « range, ne donne aucun droit ».
- [ ] **Step 6: Commit** — `feat(db): sélection recommandée de données par espace (sql/251)`.

---

### Task 9: Le registre des jeux de la carte, copié serveur / Angular

**Files:**
- Create: `lib/carte/jeux-carte.ts`, `angular/src/app/features/carte/logique/jeux-carte.ts`, `lib/poi/libelles-categories.ts`
- Modify: `app/api/map/categories/route.ts` (importe `libellesCategories`/`avecLibelles` au lieu de ses deux fonctions locales — comportement identique)
- Test: `tests/unit/carte/jeux-carte.test.ts`, `tests/unit/angular/jeux-carte-paritaire.test.ts`, `tests/unit/api/map-categories-origine.test.ts` (inchangé, doit rester vert)

**Interfaces:**
- Produces (identiques dans les deux copies) : `type NatureJeu = 'poi' | 'carreau' | 'indicateur_iris' | 'indicateur_cp' | 'ligne' | 'polygone' | 'a_la_demande'` ; `interface JeuReferentiel { cle; nom; nature: NatureJeu; maille }` ; `JEUX_REFERENTIELS` (10 entrées) ; `LIBELLE_NATURE: Record<NatureJeu, string>` ; `PREFIXE_POI = 'poi:'` ; `CATEGORIES_HORS_POI = ['risque_industriel']` ; `RE_CLE_JEU = /^[a-z]+:[a-z0-9_-]{1,64}$/` ; `MAX_JEUX_RECOMMANDES = 200` ; `cleJeuPoi(categorie: string): string | null` ; `estCleJeuConnue(cle: string): boolean` ; `interface JeuRecommandable extends JeuReferentiel { recommande: boolean }` ; `interface ReponseJeuxRecommandables { jeux: JeuRecommandable[] }`. Serveur seulement : `libellesCategories(supabase, cats): Promise<Record<string, string>>`, `avecLibelles(cats, libelles): { id: string; label: string }[]`.

- [ ] **Step 1: Tests (échec)** — `tests/unit/carte/jeux-carte.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { CATEGORIES_HORS_POI, JEUX_REFERENTIELS, RE_CLE_JEU, cleJeuPoi, estCleJeuConnue } from '@/lib/carte/jeux-carte';

describe('registre des jeux de la carte', () => {
  it('10 référentiels, clés uniques et conformes au CHECK de sql/251', () => {
    expect(JEUX_REFERENTIELS).toHaveLength(10);
    const cles = JEUX_REFERENTIELS.map((j) => j.cle);
    expect(new Set(cles).size).toBe(cles.length);
    for (const c of cles) expect(RE_CLE_JEU.test(c), c).toBe(true);
  });
  it('le RE_CLE_JEU est EXACTEMENT celui du CHECK de la migration', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const f = readdirSync('sql').find((n) => /_espace_jeux_recommandes\.sql$/.test(n))!;
    expect(readFileSync(`sql/${f}`, 'utf8')).toContain(`cle_jeu ~ '${RE_CLE_JEU.source}'`);
  });
  it('cleJeuPoi : une catégorie conforme, sinon null (jamais une clé que la base refuserait)', () => {
    expect(cleJeuPoi('lycee')).toBe('poi:lycee');
    expect(cleJeuPoi('arret_transport')).toBe('poi:arret_transport');
    expect(cleJeuPoi('Lycée')).toBeNull();
    expect(cleJeuPoi('')).toBeNull();
  });
  it('estCleJeuConnue : un référentiel, ou poi:<catégorie> hors catégories rangées ailleurs', () => {
    expect(estCleJeuConnue('iris:socio-demo')).toBe(true);
    expect(estCleJeuConnue('poi:bmw')).toBe(true);
    expect(estCleJeuConnue(`poi:${CATEGORIES_HORS_POI[0]}`)).toBe(false);
    expect(estCleJeuConnue('iris:inconnu')).toBe(false);
    expect(estCleJeuConnue('n importe quoi')).toBe(false);
  });
});
```

`tests/unit/angular/jeux-carte-paritaire.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import * as R from '@/lib/carte/jeux-carte';
import * as A from '../../../angular/src/app/features/carte/logique/jeux-carte';

describe('registre des jeux de la carte : Angular = serveur', () => {
  it('mêmes référentiels, natures, catégories hors POI, borne et expression', () => {
    expect(A.JEUX_REFERENTIELS).toEqual(R.JEUX_REFERENTIELS);
    expect(A.LIBELLE_NATURE).toEqual(R.LIBELLE_NATURE);
    expect(A.CATEGORIES_HORS_POI).toEqual(R.CATEGORIES_HORS_POI);
    expect(A.MAX_JEUX_RECOMMANDES).toBe(R.MAX_JEUX_RECOMMANDES);
    expect(A.RE_CLE_JEU.source).toBe(R.RE_CLE_JEU.source);
    expect(A.PREFIXE_POI).toBe(R.PREFIXE_POI);
  });
  it('mêmes réponses des fonctions', () => {
    for (const c of ['lycee', 'Lycée', '', 'risque_industriel', 'bmw']) expect(A.cleJeuPoi(c)).toBe(R.cleJeuPoi(c));
    for (const k of ['iris:socio-demo', 'poi:bmw', 'poi:risque_industriel', 'x', 'meteo:zones']) expect(A.estCleJeuConnue(k)).toBe(R.estCleJeuConnue(k));
  });
});
```

- [ ] **Step 2: FAIL** — `npx vitest run --project unit tests/unit/carte/jeux-carte.test.ts tests/unit/angular/jeux-carte-paritaire.test.ts`.

- [ ] **Step 3: Implémenter** — `lib/carte/jeux-carte.ts` (la copie Angular `features/carte/logique/jeux-carte.ts` est IDENTIQUE hors en-tête, qui dit « Copie VERBATIM de `lib/carte/jeux-carte.ts`, verrouillée par `tests/unit/angular/jeux-carte-paritaire.test.ts` ») :

```ts
/**
 * @file lib/carte/jeux-carte.ts — le registre des jeux de la carte (spec carte-en-parcours § 4 ②, § 7 ; arbitrage A10).
 *
 * Un « jeu » est ce qu'on allume à l'étape ② : un référentiel commun (ci-dessous, statique) ou un type de POI
 * (`poi:<categorie>`, dont l'origine espace/commune vient de `GET /api/map/categories`). Sa clé `famille:nom` est celle
 * de la sélection recommandée (`espace_jeux_recommandes.cle_jeu`, sql/251) : `RE_CLE_JEU` est EXACTEMENT le CHECK de
 * la table (tests/unit/carte/jeux-carte.test.ts).
 *
 * Les référentiels sont tous COMMUNS jusqu'au catalogue (lot 8), qui rendra un indicateur privable.
 * Copie Angular : angular/src/app/features/carte/logique/jeux-carte.ts (parité verrouillée).
 */
export type NatureJeu = 'poi' | 'carreau' | 'indicateur_iris' | 'indicateur_cp' | 'ligne' | 'polygone' | 'a_la_demande';

export interface JeuReferentiel {
  readonly cle: string;
  readonly nom: string;
  readonly nature: NatureJeu;
  readonly maille: string;
}

/** Les référentiels communs, dans l'ordre d'affichage de ② (maquette du 2026-10-13). */
export const JEUX_REFERENTIELS: readonly JeuReferentiel[] = [
  { cle: 'iris:socio-demo', nom: 'IRIS socio-démographie (Filosofi)', nature: 'indicateur_iris', maille: 'IRIS' },
  { cle: 'carreaux:filosofi', nom: 'Carreaux Filosofi', nature: 'carreau', maille: 'carreau 200 m à 20 km' },
  { cle: 'civique:indicateurs-cp', nom: 'Indicateurs au code postal', nature: 'indicateur_cp', maille: 'code postal' },
  { cle: 'transport:arrets', nom: 'Arrêts de transport en commun', nature: 'poi', maille: 'point' },
  { cle: 'ooh:panneaux', nom: 'Panneaux OOH et DOOH', nature: 'poi', maille: 'point' },
  { cle: 'radio:emetteurs', nom: 'Émetteurs radio FM / DAB+', nature: 'poi', maille: 'point' },
  { cle: 'tmja:comptages', nom: 'Flux routier (TMJA)', nature: 'ligne', maille: 'tronçon' },
  { cle: 'risques:icpe-pprt', nom: 'Sites industriels (ICPE) et périmètres PPRT', nature: 'poi', maille: 'point et polygone' },
  { cle: 'sante:air-pollen', nom: 'Santé environnementale (air, pollen)', nature: 'indicateur_cp', maille: 'département, code postal' },
  { cle: 'meteo:zones', nom: 'Météo', nature: 'a_la_demande', maille: 'zone' },
];

export const LIBELLE_NATURE: Readonly<Record<NatureJeu, string>> = {
  poi: 'POI', carreau: 'Carreau', indicateur_iris: 'Indicateur IRIS', indicateur_cp: 'Indicateur',
  ligne: 'Ligne', polygone: 'Polygone', a_la_demande: 'À la demande',
};

export const PREFIXE_POI = 'poi:';
/** Catégories de POI rangées dans un AUTRE jeu (les sites ICPE vivent dans `risques:icpe-pprt` jusqu'au lot 4). */
export const CATEGORIES_HORS_POI: readonly string[] = ['risque_industriel'];
/** La forme d'une clé — le CHECK de `espace_jeux_recommandes.cle_jeu` (sql/251). */
export const RE_CLE_JEU = /^[a-z]+:[a-z0-9_-]{1,64}$/;
/** La borne de la RPC `remplacer_jeux_recommandes` (sql/251). */
export const MAX_JEUX_RECOMMANDES = 200;

/** La clé d'un type de POI, ou `null` si la catégorie ne donnerait pas une clé conforme (elle n'est alors pas recommandable). */
export function cleJeuPoi(categorie: string): string | null {
  const cle = `${PREFIXE_POI}${categorie}`;
  return RE_CLE_JEU.test(cle) ? cle : null;
}

/** Une clé que la carte sait afficher : un référentiel, ou un type de POI hors catégories rangées ailleurs. */
export function estCleJeuConnue(cle: string): boolean {
  if (!RE_CLE_JEU.test(cle)) return false;
  if (JEUX_REFERENTIELS.some((j) => j.cle === cle)) return true;
  return cle.startsWith(PREFIXE_POI) && !CATEGORIES_HORS_POI.includes(cle.slice(PREFIXE_POI.length));
}

/** Une ligne du bloc « Sélection recommandée » d'Accès. */
export interface JeuRecommandable extends JeuReferentiel {
  readonly recommande: boolean;
}

/** `GET /api/admin/espaces/[id]/jeux-recommandes`. */
export interface ReponseJeuxRecommandables {
  jeux: JeuRecommandable[];
}
```

`lib/poi/libelles-categories.ts` : y déplacer à l'identique `buildLabelMap` (renommé `libellesCategories`) et `withLabels` (renommé `avecLibelles`) de `app/api/map/categories/route.ts`, avec `type Sb = ReturnType<typeof createAdminClient>` (`import type { createAdminClient } from '@/lib/auth'`) ; la route importe les deux et supprime ses copies locales.

- [ ] **Step 4: PASS** — `npx vitest run --project unit tests/unit/carte tests/unit/angular/jeux-carte-paritaire.test.ts tests/unit/api/map-categories-origine.test.ts`, `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(carte): registre des jeux de la carte, serveur et Angular`.

---

### Task 10: Les routes de la sélection recommandée

**Files:**
- Create: `lib/carte/jeux-recommandables.ts`, `app/api/map/jeux-recommandes/route.ts`, `app/api/admin/espaces/[id]/jeux-recommandes/route.ts`
- Test: `tests/unit/carte/jeux-recommandables.test.ts`, `tests/unit/api/map-jeux-recommandes.test.ts`, `tests/integration/jeux-recommandes-admin.test.ts`
- Doc: `ARCHITECTURE.md` (Grep `/api/map/categories` pour la section des routes carte ; Grep `/api/admin/espaces/[id]/donnees` pour les routes Accès)

**Interfaces:**
- Consumes: T8 (table, RPC), T9 (registre, `libellesCategories`, `avecLibelles`), `getOrgSourceIds(null, { vueEspace: true })` (le socle seul), `getCategoriesVisibles(sources)` (`lib/poi/categories.ts`, cache par empreinte), `getSessionOrg`, `requireAdmin`/`adminUnauthorized` (`lib/api/middleware`), `lireCorps` (`lib/api/valider-corps.ts`).
- Produces:
  - `jeuxRecommandables(supabase, orgId: string): Promise<ReponseJeuxRecommandables | null>` (`null` = espace introuvable).
  - `GET /api/map/jeux-recommandes` → `{ cles: string[] }` pour l'espace ACTIF (`[]` sans session ou sans espace) ; 500 `{ error }` sur lecture en échec.
  - `GET /api/admin/espaces/[id]/jeux-recommandes` → `ReponseJeuxRecommandables` ; `PUT` corps `{ cles: string[] }` → `{ cles: string[] }` ; 400 (corps, clé inconnue), 401, 404 (espace), 500.

- [ ] **Step 1: Tests (échec)**

`tests/unit/carte/jeux-recommandables.test.ts` (mocks de `@/lib/auth/getOrgSourceIds` → `['s1']`, `@/lib/poi/categories` → `getCategoriesVisibles` rend `['lycee', 'risque_industriel', 'Lycée Pro', 'panneaux']`, `@/lib/poi/libelles-categories` → `{ lycee: 'Lycées' }` et `avecLibelles` réel ; client factice dont `from('organizations')` rend `{ data: { id }, error: null }` et `from('espace_jeux_recommandes')` rend `[{ cle_jeu: 'poi:lycee' }, { cle_jeu: 'iris:socio-demo' }, { cle_jeu: 'poi:disparue' }]`) :
- rend d'abord les 10 référentiels (ordre du registre), puis `poi:lycee` (« Lycées ») et `poi:panneaux` ;
- `risque_industriel` (rangé ailleurs) et `Lycée Pro` (clé non conforme) ABSENTS (Review Focus 5) ;
- `recommande` vrai pour `iris:socio-demo` et `poi:lycee`, faux ailleurs ; `poi:disparue` n'apparaît pas ;
- espace introuvable (`maybeSingle` → `data: null`) → `null` ; aucune lecture de catégories dans ce cas ;
- `getCategoriesVisibles` appelé avec `['s1']` (le SOCLE : `getOrgSourceIds(null, { vueEspace: true })`).

`tests/unit/api/map-jeux-recommandes.test.ts` :
- session avec `orgId` UUID → `{ cles: ['iris:socio-demo', 'poi:lycee'] }`, filtre `.eq('organization_id', orgId)` observé ;
- session sans `orgId`, `orgId` non UUID, aucune session → `{ cles: [] }` SANS lecture ;
- lecture en échec → 500, message français.

`tests/integration/jeux-recommandes-admin.test.ts` (patron `espace-interne-indelebile.test.ts` : `requireAdmin` simulé, vraie base locale, espace `[ESSAI parcours]` créé puis supprimé) :
- `PUT` `{ cles: ['iris:socio-demo', 'poi:lycee'] }` → 200 `{ cles: [...] }` ; `GET` → ces deux lignes `recommande: true` ;
- `PUT` `{ cles: ['iris:inconnu'] }` → 400, liste inchangée ;
- `PUT` corps illisible → 400 ; `PUT` sur un uuid inexistant → 404 ;
- `requireAdmin` → `null` : 401 sur `GET` et `PUT`.

- [ ] **Step 2: FAIL** — `npx vitest run --project unit tests/unit/carte/jeux-recommandables.test.ts tests/unit/api/map-jeux-recommandes.test.ts` puis `npx vitest run --project integration tests/integration/jeux-recommandes-admin.test.ts`.

- [ ] **Step 3: Implémenter.**

`lib/carte/jeux-recommandables.ts` :

```ts
/**
 * Les jeux COMMUNS qu'un espace peut se voir recommander (Accès › fiche espace › Données, spec § 7.2) : les
 * référentiels du registre, puis les types de POI du SOCLE (ce que tout espace voit). Une catégorie rangée dans un
 * autre jeu (`CATEGORIES_HORS_POI`) ou dont le nom ne donne pas une clé conforme n'est pas proposée : elle ne peut pas
 * être enregistrée, et la proposer ferait échouer l'enregistrement de TOUTE la sélection.
 *
 * Lectures SÉQUENTIELLES (règles I/O) : l'espace, les sources du socle, les catégories (leapfrog en cache par
 * empreinte), leurs libellés, la sélection (≤ 200 lignes, sql/251 — sous le plafond PostgREST de 1 000).
 */
import type { createAdminClient } from '@/lib/auth';
import { getOrgSourceIds } from '@/lib/auth/getOrgSourceIds';
import { getCategoriesVisibles } from '@/lib/poi/categories';
import { avecLibelles, libellesCategories } from '@/lib/poi/libelles-categories';
import { CATEGORIES_HORS_POI, JEUX_REFERENTIELS, type JeuRecommandable, type ReponseJeuxRecommandables, cleJeuPoi } from './jeux-carte';

type Sb = ReturnType<typeof createAdminClient>;

export async function jeuxRecommandables(supabase: Sb, orgId: string): Promise<ReponseJeuxRecommandables | null> {
  const { data: org, error: eOrg } = await supabase.from('organizations').select('id').eq('id', orgId).maybeSingle();
  if (eOrg) throw new Error(`lecture de l'espace : ${eOrg.message}`);
  if (!org) return null;

  // Le socle seul : une session absente, en vue espace, rend `visibilite = socle` (getOrgSourceIds).
  const socle = (await getOrgSourceIds(null, { vueEspace: true })) ?? [];
  const categories = (await getCategoriesVisibles(socle))
    .filter((c) => !CATEGORIES_HORS_POI.includes(c) && cleJeuPoi(c) !== null);
  const libelles = await libellesCategories(supabase, categories);

  const { data: lignes, error } = await supabase
    .from('espace_jeux_recommandes').select('cle_jeu').eq('organization_id', orgId);
  if (error) throw new Error(`lecture de la sélection : ${error.message}`);
  const choisies = new Set((lignes ?? []).map((l: { cle_jeu: string }) => l.cle_jeu));

  const jeux: JeuRecommandable[] = [
    ...JEUX_REFERENTIELS.map((j) => ({ ...j, recommande: choisies.has(j.cle) })),
    ...avecLibelles(categories, libelles).map((c) => {
      const cle = cleJeuPoi(c.id) as string;
      return { cle, nom: c.label, nature: 'poi' as const, maille: 'point', recommande: choisies.has(cle) };
    }),
  ];
  return { jeux };
}
```

`app/api/map/jeux-recommandes/route.ts` :

```ts
/**
 * GET /api/map/jeux-recommandes
 * La sélection recommandée de l'espace ACTIF pour l'étape ② de la carte : `{ cles: string[] }` (spec § 7.2).
 * Super_admin compris : la carte voit comme l'espace choisi. Sans session ni espace : `[]` — rien n'est révélé, et ②
 * montre alors toutes les données communes dépliées. Lecture bornée (≤ 200 lignes par espace, sql/251).
 * La recommandation RANGE : elle n'ouvre aucun droit et ne précharge rien.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { getSessionOrg } from '@/lib/auth/getSessionOrg';

export const dynamic = 'force-dynamic';

const Uuid = z.string().uuid();

export async function GET(req: NextRequest) {
  const session = await getSessionOrg(req);
  const orgId = session?.orgId && Uuid.safeParse(session.orgId).success ? session.orgId : null;
  if (!orgId) return NextResponse.json({ cles: [] });

  const { data, error } = await createAdminClient()
    .from('espace_jeux_recommandes').select('cle_jeu').eq('organization_id', orgId).order('cle_jeu');
  if (error) return NextResponse.json({ error: 'Sélection recommandée indisponible.' }, { status: 500 });
  return NextResponse.json({ cles: (data ?? []).map((l: { cle_jeu: string }) => l.cle_jeu) });
}
```

`app/api/admin/espaces/[id]/jeux-recommandes/route.ts` :

```ts
/**
 * GET  /api/admin/espaces/[id]/jeux-recommandes — les jeux communs recommandables de l'espace, et sa sélection.
 * PUT  /api/admin/espaces/[id]/jeux-recommandes — remplace la sélection : `{ cles: string[] }` (≤ 200 clés connues).
 *
 * super_admin seul. L'écriture passe par la RPC `remplacer_jeux_recommandes` (sql/251) : une transaction, jamais un
 * DELETE suivi d'un INSERT côté route. Une recommandation range ; elle ne donne ni ne retire aucun droit.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { adminUnauthorized, requireAdmin } from '@/lib/api/middleware';
import { lireCorps } from '@/lib/api/valider-corps';
import { MAX_JEUX_RECOMMANDES, RE_CLE_JEU, estCleJeuConnue } from '@/lib/carte/jeux-carte';
import { jeuxRecommandables } from '@/lib/carte/jeux-recommandables';

export const dynamic = 'force-dynamic';

const IdSchema = z.string().uuid();
const CorpsSchema = z.object({
  cles: z.array(
    z.string().regex(RE_CLE_JEU, 'Clé de jeu invalide.').refine(estCleJeuConnue, 'Jeu inconnu de la carte.'),
  ).max(MAX_JEUX_RECOMMANDES, `Au plus ${MAX_JEUX_RECOMMANDES} jeux recommandés.`),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  if (!(await requireAdmin(request))) return adminUnauthorized();
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return NextResponse.json({ error: 'Identifiant d\'espace invalide.' }, { status: 400 });
  try {
    const reponse = await jeuxRecommandables(createAdminClient(), id);
    if (!reponse) return NextResponse.json({ error: 'Espace introuvable.' }, { status: 404 });
    return NextResponse.json(reponse);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  if (!(await requireAdmin(request))) return adminUnauthorized();
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return NextResponse.json({ error: 'Identifiant d\'espace invalide.' }, { status: 400 });
  const corps = await lireCorps(request, CorpsSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });

  const supabase = createAdminClient();
  const { data: org, error: eOrg } = await supabase.from('organizations').select('id').eq('id', id).maybeSingle();
  if (eOrg) return NextResponse.json({ error: eOrg.message }, { status: 500 });
  if (!org) return NextResponse.json({ error: 'Espace introuvable.' }, { status: 404 });

  const { data, error } = await supabase.rpc('remplacer_jeux_recommandes', { p_organization_id: id, p_cles: corps.valeur.cles });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data as { cles: string[] });
}
```

(Si `lib/supabase/database.types.ts` doit connaître la table et la RPC pour que `tsc` passe, régénérer les types contre la base LOCALE par la commande documentée dans `ARCHITECTURE.md` — Grep `database.types` — et commiter le fichier régénéré dans cette tâche.)

- [ ] **Step 4: PASS** — les trois fichiers de test ; `npx vitest run --project unit tests/unit/api/validation-corps.test.ts tests/unit/db` (lireCorps, suppressions, troncature) ; `npx tsc --noEmit`. Puis, en local, `npm run dev` (en arrière-plan s'il ne tourne pas ; jamais arrêter un :3000 existant) et relever `GET /api/map/jeux-recommandes` (super_admin, espace BMW GROUP : `{ "cles": [] }`).
- [ ] **Step 5: Doc** — `ARCHITECTURE.md` : les deux routes (méthodes, corps, réponses, droits, « range, ne donne aucun droit »), `lib/carte/` (registre, jeux recommandables), `lib/poi/libelles-categories.ts`.
- [ ] **Step 6: Commit** — `feat(api): sélection recommandée — lecture carte et réglage par espace`.

---

### Task 11: Accès › fiche espace › Données : le bloc « Sélection recommandée sur la carte »

**Files:**
- Create: `angular/src/app/features/admin/espaces/jeux-recommandes.component.ts` (+ spec)
- Modify: `angular/src/app/features/admin/espaces/data/espaces.api.ts`, `onglet-donnees.component.ts` (+ spec)

**Interfaces:**
- Consumes: T10 (routes), T9 copie Angular (`JeuRecommandable`, `ReponseJeuxRecommandables`, `LIBELLE_NATURE` de `features/carte/logique/jeux-carte.ts`), `NotificationsService.success/error`, `messageErreur` (`admin/espaces/logique/libelles.ts`).
- Produces: `EspacesApi.jeuxRecommandables(id): Observable<ReponseJeuxRecommandables>`, `EspacesApi.enregistrerJeuxRecommandes(id, cles: readonly string[]): Observable<{ cles: string[] }>` ; `JeuxRecommandesComponent` (`mg-jeux-recommandes`, `espaceId = input.required<string>()`).

Exigences :
- Sous le tableau de l'onglet, TOUJOURS rendu (indépendant de l'erreur/du squelette du tableau). Bandeau `mg-entete-section` « Sélection recommandée sur la carte », puis la phrase : « Les jeux cochés s'affichent d'abord dans « Données communes » à l'étape ② ; les autres se rangent dans « Autres données communes ». Une recommandation range : elle ne donne ni ne retire aucun droit. Aucune case cochée : l'espace voit tout, déplié. »
- Tableau (cellules `mgTh`/`mgTd` comme l'onglet) : Jeu, Nature (`LIBELLE_NATURE`), Maille, Recommandé (case `aria-label` « Recommander <nom> »).
- Boutons : « Enregistrer la sélection » (teal, désactivé si rien n'a changé ou pendant l'écriture), « Annuler les changements » (neutre, même condition). Aucune écriture optimiste : succès → notification « Sélection enregistrée » + relecture ; échec → notification du message serveur, cases laissées telles quelles.
- `espaceId` réactif : changer d'espace abandonne la lecture en vol (`Subscription.unsubscribe`) et repart de la lecture.
- États : squelette (3 lignes) pendant la lecture ; erreur + « Réessayer ».

- [ ] **Step 1: Specs (échec)** — `jeux-recommandes.component.spec.ts` (hôte de test, `EspacesApi` factice) :
  - lecture → 12 lignes (10 référentiels + 2 POI), `iris:socio-demo` cochée ;
  - « Enregistrer » désactivé au départ ; cocher `poi:lycee` → actif ; clic → `enregistrerJeuxRecommandes('e1', ['iris:socio-demo', 'poi:lycee'])` (ordre de la liste) puis relecture, notification de succès ;
  - écriture en erreur → notification d'erreur, case `poi:lycee` toujours cochée, bouton toujours actif ;
  - « Annuler les changements » → état lu ;
  - changer `espaceId` pendant une lecture → l'abonnement précédent est désabonné, la réponse tardive n'est pas affichée.
  `onglet-donnees.component.spec.ts` : `mg-jeux-recommandes` présent avec `espaceId`, y compris quand le tableau est en erreur.
- [ ] **Step 2: FAIL** — `cd angular && npx ng test --watch=false --include='src/app/features/admin/espaces/**/*.spec.ts'`.
- [ ] **Step 3: Implémenter.**

`data/espaces.api.ts` (dans la classe, à côté de `donnees`) :

```ts
  /** `GET admin/espaces/:id/jeux-recommandes` — jeux communs recommandables et sélection de l'espace (parcours, lot 2). */
  jeuxRecommandables(id: string): Observable<ReponseJeuxRecommandables> {
    return this.httpClient.get<ReponseJeuxRecommandables>(`${this.espaceUrl(id)}/jeux-recommandes`);
  }

  /** `PUT admin/espaces/:id/jeux-recommandes` — remplace la sélection (≤ 200 clés). */
  enregistrerJeuxRecommandes(id: string, cles: readonly string[]): Observable<{ cles: string[] }> {
    return this.httpClient.put<{ cles: string[] }>(`${this.espaceUrl(id)}/jeux-recommandes`, { cles });
  }
```

(import `type ReponseJeuxRecommandables` de `../../../carte/logique/jeux-carte`.)

`jeux-recommandes.component.ts` :

```ts
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import type { Subscription } from 'rxjs';
import { EnteteSectionComponent } from '../../../ui/entete-section/entete-section.component';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { Cellule, EnteteCellule } from '../../../ui/tableau/cellules';
import { type JeuRecommandable, LIBELLE_NATURE } from '../../carte/logique/jeux-carte';
import { EspacesApi } from './data/espaces.api';
import { messageErreur } from './logique/libelles';

/**
 * « Sélection recommandée sur la carte » (spec carte-en-parcours § 7.2, arbitrage A11) : sous le tableau des jeux de
 * l'onglet Données, parce que celui-ci liste des SOURCES importées, alors qu'une recommandation porte sur un jeu de la
 * CARTE (référentiel ou type de POI du socle). Aucune écriture optimiste ; `espaceId` réactif.
 */
@Component({
  selector: 'mg-jeux-recommandes',
  imports: [Cellule, EnteteCellule, EnteteSectionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mg-entete-section libelle="Sélection recommandée sur la carte" class="mt-6 rounded-t-lg" />
    <p class="intro">Les jeux cochés s’affichent d’abord dans « Données communes » à l’étape ② ; les autres se rangent dans
      « Autres données communes ». Une recommandation range : elle ne donne ni ne retire aucun droit. Aucune case cochée :
      l’espace voit tout, déplié.</p>
    @if (erreur(); as m) {
      <div role="alert" class="erreur"><p class="m-0">{{ m }}</p>
        <button type="button" data-reessayer class="bouton-neutre" (click)="lire()">Réessayer</button></div>
    } @else if (jeux() === null) {
      @for (i of [1, 2, 3]; track i) { <div data-squelette class="squelette" aria-hidden="true"></div> }
    } @else {
      <div class="cadre">
        <table class="w-full border-collapse text-[12px]">
          <thead><tr class="border-b-fin border-default">
            <th mgTh alignement="gauche">Jeu</th><th mgTh alignement="gauche">Nature</th>
            <th mgTh alignement="gauche">Maille</th><th mgTh>Recommandé</th>
          </tr></thead>
          <tbody>
            @for (j of jeux(); track j.cle) {
              <tr class="border-b-fin border-subtle" [attr.data-jeu-recommandable]="j.cle">
                <td mgTd alignement="gauche" fort class="!font-sans !text-[12px]">{{ j.nom }}</td>
                <td mgTd alignement="gauche" class="!font-sans !text-[12px]">{{ nature[j.nature] }}</td>
                <td mgTd alignement="gauche" class="!font-sans !text-[12px]">{{ j.maille }}</td>
                <td mgTd><input type="checkbox" class="case" [checked]="cochees().has(j.cle)" [disabled]="ecriture()"
                                [attr.aria-label]="'Recommander ' + j.nom" (change)="basculer(j.cle)" /></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <div class="actions">
        <button type="button" data-annuler class="bouton-neutre" [disabled]="!modifie() || ecriture()" (click)="annuler()">Annuler les changements</button>
        <button type="button" data-enregistrer class="bouton-teal" [disabled]="!modifie() || ecriture()" (click)="enregistrer()">Enregistrer la sélection</button>
      </div>
    }
  `,
  styles: `
    :host { display: block; font-family: var(--font-sans); }
    .intro { margin: 0; padding: 10px 14px; font-size: 12px; line-height: 1.5; color: var(--text-secondary); }
    .cadre { border: 0.5px solid var(--border-subtle); border-radius: 8px; background: var(--bg-surface); overflow-x: auto; }
    .case { accent-color: var(--brand-teal); cursor: pointer; }
    .case:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
    .bouton-neutre, .bouton-teal { border-radius: 6px; padding: 5px 12px; font-family: var(--font-sans); font-size: 12px; font-weight: 500; cursor: pointer; }
    .bouton-neutre { background: transparent; border: 0.5px solid var(--border-default); color: var(--text-secondary); }
    .bouton-neutre:not(:disabled):hover { border-color: var(--border-hover); background: var(--bg-level-2); color: var(--text-primary); }
    .bouton-teal { background: transparent; border: 0.5px solid var(--brand-teal); color: var(--brand-teal); }
    .bouton-teal:not(:disabled):hover { background: var(--brand-teal-10); }
    .bouton-neutre:disabled, .bouton-teal:disabled { opacity: 0.5; cursor: not-allowed; }
    .bouton-neutre:focus-visible, .bouton-teal:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
    .squelette { height: 32px; margin-bottom: 8px; border-radius: 6px; background: var(--bg-level-2); }
    .erreur { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; padding: 12px; border-radius: 6px; font-size: 12px;
      color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); border: 0.5px solid color-mix(in srgb, var(--danger) 20%, transparent); }
  `,
})
export class JeuxRecommandesComponent {
  private readonly api = inject(EspacesApi);
  private readonly notifications = inject(NotificationsService);
  readonly espaceId = input.required<string>();

  protected readonly nature = LIBELLE_NATURE;
  protected readonly jeux = signal<JeuRecommandable[] | null>(null);
  protected readonly erreur = signal<string | null>(null);
  protected readonly ecriture = signal(false);
  private readonly lues = signal<ReadonlySet<string>>(new Set());
  protected readonly cochees = signal<ReadonlySet<string>>(new Set());
  protected readonly modifie = computed(() => {
    const a = this.lues(); const b = this.cochees();
    return a.size !== b.size || [...b].some((c) => !a.has(c));
  });

  private lecture: Subscription | null = null;
  private envoi: Subscription | null = null;

  constructor() {
    effect(() => {
      this.espaceId();
      untracked(() => this.lire());
    });
    inject(DestroyRef).onDestroy(() => { this.lecture?.unsubscribe(); this.envoi?.unsubscribe(); });
  }

  protected lire(): void {
    this.lecture?.unsubscribe();
    this.jeux.set(null);
    this.erreur.set(null);
    this.lecture = this.api.jeuxRecommandables(this.espaceId()).subscribe({
      next: (r) => {
        const jeux = Array.isArray(r?.jeux) ? r.jeux : [];
        const cochees = new Set(jeux.filter((j) => j.recommande).map((j) => j.cle));
        this.jeux.set(jeux);
        this.lues.set(cochees);
        this.cochees.set(cochees);
      },
      error: (e: unknown) => this.erreur.set(messageErreur(e)),
    });
  }

  protected basculer(cle: string): void {
    this.cochees.update((s) => { const n = new Set(s); if (n.has(cle)) n.delete(cle); else n.add(cle); return n; });
  }

  protected annuler(): void {
    this.cochees.set(this.lues());
  }

  protected enregistrer(): void {
    const ordre = (this.jeux() ?? []).map((j) => j.cle).filter((c) => this.cochees().has(c));
    this.ecriture.set(true);
    this.envoi?.unsubscribe();
    this.envoi = this.api.enregistrerJeuxRecommandes(this.espaceId(), ordre).subscribe({
      next: () => {
        this.ecriture.set(false);
        this.notifications.success('Sélection enregistrée');
        this.lire();
      },
      error: (e: unknown) => {
        this.ecriture.set(false);
        this.notifications.error(messageErreur(e));
      },
    });
  }
}
```

`onglet-donnees.component.ts` : importer `JeuxRecommandesComponent` ; ajouter `<mg-jeux-recommandes [espaceId]="espaceId()" />` APRÈS le bloc `@if (erreur()) … @else …` du tableau et avant `@if (transfert())` ; compléter l'en-tête (« puis la sélection recommandée sur la carte, spec carte-en-parcours § 7.2 »). Vérifier `wc -l` ≤ 400.

- [ ] **Step 4: PASS** — suite admin espaces, suite Angular complète, build.
- [ ] **Step 5: Navigateur** — Accès › BMW GROUP › Données : cocher IRIS, Carreaux, Panneaux OOH, Flux routier ; enregistrer ; relire ; deux thèmes.
- [ ] **Step 6: Commit** — `feat(angular): Accès › Données — sélection recommandée sur la carte`.

---

### Task 12: Ranger les jeux — la règle, la lecture, la ligne

**Files:**
- Create: `angular/src/app/features/carte/logique/rangement-jeux.ts` (+ spec), `etat/jeux-recommandes.service.ts` (+ spec), `panneaux/donnees/ligne-jeu.component.ts` (+ spec)
- Modify: `data/carte.api.ts` (`jeuxRecommandes()`), 8 sections (`integre`) : `panneaux/calques/section-{civique,meteo,ooh,radio,risque,sante,tmja,transport}.component.ts` (+ un test d'`integre` dans `section-tmja.component.spec.ts` et `section-risque.component.spec.ts`)

**Interfaces:**
- Consumes: T9 (`JEUX_REFERENTIELS`, `CATEGORIES_HORS_POI`, `NatureJeu`, `LIBELLE_NATURE`), `TypePoi` (`etat/catalogue-poi.service.ts`).
- Produces:
  - `interface JeuAffichable { cle: string; nom: string; nature: NatureJeu; maille: string; origine: 'espace' | 'commune' }` ; `jeuxDeLaCarte(types: readonly TypePoi[]): JeuAffichable[]` ; `interface RangementJeux { espace; recommandes; autres: readonly JeuAffichable[]; sansSelection: boolean }` ; `rangerJeux(jeux, recommandes: readonly string[]): RangementJeux` ; `filtrerJeux(jeux, recherche: string): JeuAffichable[]`.
  - `CarteApi.jeuxRecommandes(): Observable<{ cles?: string[]; error?: string }>`.
  - `JeuxRecommandesService` (`@Injectable()`, fourni par le panneau Données) : `cles: Signal<readonly string[] | null>` (`null` = en lecture), `indisponible: Signal<boolean>`.
  - `LigneJeuComponent` (`mg-ligne-jeu`) : inputs `jeu: JeuAffichable`, `affiche: boolean`, `mode: 'case' | 'reglages'`, `coche: boolean`, `deplie: boolean` ; outputs `cocher: void`, `basculer: void` ; `<ng-content>` rendu si `mode === 'reglages' && deplie()`.
  - Les 8 sections : `readonly integre = input(false)` ; intégrée, leur `mg-entete-filtre` n'est pas rendu et leur contenu est TOUJOURS ouvert.

- [ ] **Step 1: Tests (échec)** — `logique/rangement-jeux.spec.ts` :

```ts
import { filtrerJeux, jeuxDeLaCarte, rangerJeux } from './rangement-jeux';

const types = [
  { id: 'bmw', label: 'Concessions BMW', origine: 'espace' as const },
  { id: 'lycee', label: 'Lycées', origine: 'commune' as const },
  { id: 'risque_industriel', label: 'Risque', origine: 'commune' as const },
];

describe('rangement des jeux de ②', () => {
  it('jeuxDeLaCarte : POI de l’espace, puis référentiels, puis POI communs ; risque_industriel rangé ailleurs', () => {
    const j = jeuxDeLaCarte(types);
    expect(j[0]).toMatchObject({ cle: 'poi:bmw', origine: 'espace', nature: 'poi', maille: 'point' });
    expect(j[1].cle).toBe('iris:socio-demo');
    expect(j.at(-1)).toMatchObject({ cle: 'poi:lycee', origine: 'commune' });
    expect(j.some((x) => x.cle === 'poi:risque_industriel')).toBe(false);
    expect(j).toHaveLength(12);
  });
  it('une sélection range : recommandés dans l’ordre des jeux, le reste dans « Autres »', () => {
    const r = rangerJeux(jeuxDeLaCarte(types), ['poi:lycee', 'carreaux:filosofi']);
    expect(r.espace.map((x) => x.cle)).toEqual(['poi:bmw']);
    expect(r.recommandes.map((x) => x.cle)).toEqual(['carreaux:filosofi', 'poi:lycee']);
    expect(r.autres).toHaveLength(9);
    expect(r.sansSelection).toBe(false);
  });
  it('aucune sélection : tout déplié', () => {
    const r = rangerJeux(jeuxDeLaCarte(types), []);
    expect(r.recommandes).toHaveLength(11);
    expect(r.autres).toEqual([]);
    expect(r.sansSelection).toBe(true);
  });
  it('sélection périmée (aucune clé ne désigne un jeu commun présent) : tout déplié, jamais un bloc vide (Review Focus 5)', () => {
    const r = rangerJeux(jeuxDeLaCarte(types), ['poi:disparue', 'poi:bmw']);
    expect(r.recommandes).toHaveLength(11);
    expect(r.sansSelection).toBe(true);
  });
  it('un jeu de l’espace recommandé reste dans le bloc de l’espace', () => {
    const r = rangerJeux(jeuxDeLaCarte(types), ['poi:bmw', 'meteo:zones']);
    expect(r.espace.map((x) => x.cle)).toEqual(['poi:bmw']);
    expect(r.recommandes.map((x) => x.cle)).toEqual(['meteo:zones']);
  });
  it('filtrerJeux : sans casse ni accents, vide = tout', () => {
    const j = jeuxDeLaCarte(types);
    expect(filtrerJeux(j, 'METEO').map((x) => x.cle)).toEqual(['meteo:zones']);
    expect(filtrerJeux(j, 'lycées').map((x) => x.cle)).toEqual(['poi:lycee']);
    expect(filtrerJeux(j, '  ')).toHaveLength(12);
  });
});
```

`etat/jeux-recommandes.service.spec.ts` : réponse `{ cles: ['iris:socio-demo'] }` → `cles()` ; `null` avant la réponse ; erreur → `cles() = []` et `indisponible() = true` ; destruction pendant la lecture → désabonné.

`panneaux/donnees/ligne-jeu.component.spec.ts` : nom, `LIBELLE_NATURE · maille` ; `affiche` → `[data-affiche]` présent ; mode `case` → `input[type=checkbox]` (`aria-label` « Choisir <nom> »), `change` émet `cocher` ; mode `reglages` → bouton `aria-expanded`, clic émet `basculer`, contenu projeté rendu seulement si `deplie`.

`section-tmja.component.spec.ts` / `section-risque.component.spec.ts` : `integre = true` → aucun `mg-entete-filtre`, contenu rendu même si `selections.sections()['tmja'] === false`.

- [ ] **Step 2: FAIL** — `cd angular && npx ng test --watch=false --include='src/app/features/carte/logique/rangement-jeux.spec.ts' --include='src/app/features/carte/etat/jeux-recommandes.service.spec.ts' --include='src/app/features/carte/panneaux/donnees/**/*.spec.ts' --include='src/app/features/carte/panneaux/calques/section-*.spec.ts'`.

- [ ] **Step 3: Implémenter.**

`logique/rangement-jeux.ts` :

```ts
/**
 * Le rangement de ② (spec § 4 ②, § 7.2 ; arbitrage A10) : « Données de l'espace » d'abord, puis « Données communes »
 * ouvertes sur la sélection recommandée de l'espace, le reste dans « Autres données communes ». Rien n'est caché, tout
 * est rangé. Une sélection qui ne désigne AUCUN jeu commun présent (aucune, ou périmée) vaut « pas de sélection » :
 * tout est déplié — jamais un bloc vide. Pur.
 */
import type { TypePoi } from '../etat/catalogue-poi.service';
import { CATEGORIES_HORS_POI, JEUX_REFERENTIELS, type NatureJeu, PREFIXE_POI } from './jeux-carte';

export interface JeuAffichable {
  readonly cle: string;
  readonly nom: string;
  readonly nature: NatureJeu;
  readonly maille: string;
  readonly origine: 'espace' | 'commune';
}

export interface RangementJeux {
  readonly espace: readonly JeuAffichable[];
  readonly recommandes: readonly JeuAffichable[];
  readonly autres: readonly JeuAffichable[];
  readonly sansSelection: boolean;
}

export function jeuxDeLaCarte(types: readonly TypePoi[]): JeuAffichable[] {
  const pois = types
    .filter((t) => !CATEGORIES_HORS_POI.includes(t.id))
    .map((t): JeuAffichable => ({ cle: `${PREFIXE_POI}${t.id}`, nom: t.label, nature: 'poi', maille: 'point', origine: t.origine }));
  return [
    ...pois.filter((p) => p.origine === 'espace'),
    ...JEUX_REFERENTIELS.map((j): JeuAffichable => ({ ...j, origine: 'commune' })),
    ...pois.filter((p) => p.origine === 'commune'),
  ];
}

export function rangerJeux(jeux: readonly JeuAffichable[], recommandes: readonly string[]): RangementJeux {
  const espace = jeux.filter((j) => j.origine === 'espace');
  const communs = jeux.filter((j) => j.origine === 'commune');
  const choisis = new Set(recommandes);
  const reco = communs.filter((j) => choisis.has(j.cle));
  if (reco.length === 0) return { espace, recommandes: communs, autres: [], sansSelection: true };
  return { espace, recommandes: reco, autres: communs.filter((j) => !choisis.has(j.cle)), sansSelection: false };
}

const plier = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** « Chercher un jeu par nom » (spec § 4 ②) : sans casse ni accents ; une recherche vide rend tout. */
export function filtrerJeux(jeux: readonly JeuAffichable[], recherche: string): JeuAffichable[] {
  const q = plier(recherche);
  return q === '' ? [...jeux] : jeux.filter((j) => plier(j.nom).includes(q));
}
```

`data/carte.api.ts` (à côté de `categories`) :

```ts
  /** `GET /api/map/jeux-recommandes` — la sélection recommandée de l'espace actif (parcours, lot 2). Ne précharge rien. */
  jeuxRecommandes(): Observable<{ cles?: string[]; error?: string }> {
    return this.httpClient.get<{ cles?: string[]; error?: string }>(`${this.baseUrl}/map/jeux-recommandes`);
  }
```

`etat/jeux-recommandes.service.ts` :

```ts
import { DestroyRef, Injectable, type Signal, inject, signal } from '@angular/core';
import { CarteApi } from '../data/carte.api';

/**
 * La sélection recommandée de l'espace actif, lue UNE fois, à la première visite de ② (le panneau Données fournit ce
 * service et reste monté ensuite). Un échec vaut « pas de sélection » — tout déplié — et le dit (`indisponible`).
 * `@Injectable()` sans `providedIn`.
 */
@Injectable()
export class JeuxRecommandesService {
  private readonly _cles = signal<readonly string[] | null>(null);
  readonly cles: Signal<readonly string[] | null> = this._cles.asReadonly();
  private readonly _indisponible = signal(false);
  readonly indisponible: Signal<boolean> = this._indisponible.asReadonly();

  constructor() {
    const lecture = inject(CarteApi).jeuxRecommandes().subscribe({
      next: (r) => this._cles.set(Array.isArray(r?.cles) ? r.cles : []),
      error: () => { this._cles.set([]); this._indisponible.set(true); },
    });
    inject(DestroyRef).onDestroy(() => lecture.unsubscribe());
  }
}
```

`panneaux/donnees/ligne-jeu.component.ts` :

```ts
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { LIBELLE_NATURE } from '../../logique/jeux-carte';
import type { JeuAffichable } from '../../logique/rangement-jeux';

/**
 * La ligne uniforme d'un jeu de ② (arbitrage A12) : nom, nature · maille, pastille « affiché », puis une CASE (type de
 * POI : le choisir) ou un CHEVRON qui déplie les réglages existants de sa section (projetée).
 */
@Component({
  selector: 'mg-ligne-jeu',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block border-t-fin border-subtle', '[attr.data-jeu]': 'jeu().cle' },
  template: `
    <div class="flex items-center gap-2 px-[14px] py-2">
      @if (mode() === 'case') {
        <input type="checkbox" class="case shrink-0" [checked]="coche()" [attr.aria-label]="'Choisir ' + jeu().nom" (change)="cocher.emit()" />
      }
      <div class="min-w-0 flex-1">
        <div class="truncate text-[12px] text-primary">{{ jeu().nom }}</div>
        <div class="text-[11px] text-tertiary">{{ meta() }}</div>
      </div>
      @if (affiche()) {
        <span data-affiche title="Affiché sur la carte" class="size-1.5 shrink-0 rounded-full bg-teal"></span>
        <span class="sr-only">(affiché)</span>
      }
      @if (mode() === 'reglages') {
        <button type="button" [attr.aria-expanded]="deplie()" [attr.aria-label]="(deplie() ? 'Replier ' : 'Régler ') + jeu().nom"
                (click)="basculer.emit()" class="flex shrink-0 cursor-pointer border-0 bg-transparent p-1 text-tertiary hover:text-primary">
          <mg-icone [nom]="deplie() ? 'chevron-bas' : 'chevron-droite'" [taille]="14" [trait]="1.5" />
        </button>
      }
    </div>
    @if (mode() === 'reglages' && deplie()) {
      <div data-reglages class="px-[14px] pb-3"><ng-content /></div>
    }
  `,
  styles: `.case { accent-color: var(--brand-teal); cursor: pointer; } .case:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }`,
})
export class LigneJeuComponent {
  readonly jeu = input.required<JeuAffichable>();
  readonly affiche = input(false);
  readonly mode = input<'case' | 'reglages'>('reglages');
  readonly coche = input(false);
  readonly deplie = input(false);
  readonly cocher = output<void>();
  readonly basculer = output<void>();
  protected readonly meta = computed(() => `${LIBELLE_NATURE[this.jeu().nature]} · ${this.jeu().maille}`);
}
```

Les 8 sections — même modification mécanique dans chacune (exemple exact pour `section-tmja.component.ts`) :

```ts
  /** Rendue dans une ligne de ② (parcours, lot 2) : la ligne porte déjà le nom, l'en-tête interne n'est pas rendu et le contenu reste ouvert. */
  readonly integre = input(false);
  protected readonly ouvert = computed(() => this.integre() || this.selections.sections()['tmja'] !== false);
```

et dans le gabarit, entourer l'en-tête : `@if (!integre()) { <mg-entete-filtre … /> }` (le `@if (ouvert())` du contenu reste tel quel). Pour `section-sante` la condition d'origine est `=== true` : `this.integre() || this.selections.sections()['civicHealth'] === true`. Pour `section-risque`, `ouvert` est la ligne 323 (`risqueIndustriel`) ; les `ouvert` des sous-composants `RepliRisqueComponent`/`ProvenanceZonesComponent` ne changent pas. Ajouter `input` aux imports d'`@angular/core` où il manque.

- [ ] **Step 4: PASS** — commande du Step 2, puis suite carte complète (les sections non intégrées ne changent pas de rendu).
- [ ] **Step 5: Commit** — `feat(angular): ranger les jeux de ② — règle, sélection lue, ligne uniforme`.

---

### Task 13: Le panneau ② « Données » remplace « Calques »

**Files:**
- Create: `angular/src/app/features/carte/panneaux/donnees/panneau-donnees.component.ts` (+ spec), `panneaux/donnees/actions-poi.component.ts` (+ spec)
- Modify: `carte.page.ts`, `carte.page.html`, `carte.page.spec.ts` (inventaire : lignes 4 et 5, + lignes par jeu)
- Delete: `panneaux/calques/panneau-calques.component.ts`, `panneaux/calques/groupe-calques.component.ts`, `panneaux/calques/section-poi.component.ts` (+ leurs specs). Avant suppression : `grep -rn "AIDE_POI\|SectionPoiComponent\|PanneauCalquesComponent\|GroupeCalquesComponent" angular/src` ; déplacer `AIDE_POI` dans `actions-poi.component.ts` s'il a un autre consommateur.

**Interfaces:**
- Consumes: T12 (tout), `CataloguePoiService` (`types`, `chargement`, `erreur`, `chargerUneFois()`, `charger(true)`), `EtatCarteService.poiSelectionnes`, `PoisService` (`chercher`, `chargement`, `erreur`, `styles`, `styleDe`, `reglerStyle`, `oublierStyle`, `modeDensite`), `SelectionsCalquesService` (`typesTransport`, `regiesOoh`, `sections`, `basculerSection`), services de couche de la page (carreaux, iris, tmja, radio, civique, santé, météo, risque), `OutilsCarteService.ouvrir('zones')`.
- Produces: `PanneauDonneesComponent` (`mg-panneau-donnees`, `providers: [SelectionsCalquesService, JeuxRecommandesService]`) ; `ActionsPoiComponent` (`mg-actions-poi`).

Exigences :
- Construction (= première visite de ②) : `catalogue.chargerUneFois()` (le catalogue n'attend plus l'ouverture d'une section) ; `JeuxRecommandesService` lit la sélection. Deux GET légers, rien d'autre — aucun calque chargé (la recommandation ne précharge pas).
- Haut du panneau : « Actifs (n) » — le bloc et le calcul `actifs` repris VERBATIM de `panneau-calques.component.ts` (labels, croix) ; puis `mg-actions-poi` ; puis un champ « Chercher un jeu » (`filtrerJeux`).
- « Données de l'espace » (`mg-entete-section`) : les jeux `espace` ; vide → « Cet espace n'a importé aucune donnée. » ; toujours, une dernière ligne « Zones de l'espace : boîte à outils, « Mes zones » » avec un bouton qui ouvre l'outil.
- « Données communes » (`mg-entete-section`) + précision : « sélection recommandée » ou « aucune sélection : tout est visible » ; si `indisponible()` : « Sélection recommandée indisponible : tout est visible. » ; pendant la lecture (`cles() === null`) : « Lecture de la sélection… » à la place des lignes communes.
- Repli `[data-repli-autres]` « ▸ Autres données communes (n) » / « ▾ … », fermé par défaut ; absent quand `sansSelection`.
- Chaque jeu : `mg-ligne-jeu`. Types de POI (`cle` commence par `poi:`) : mode `case`, `coche` = `poiSelectionnes` contient l'id, `cocher` bascule l'id dans `poiSelectionnes` (ordre gardé, ajouts à la fin), `affiche` = sélectionné. Référentiels : mode `reglages`, `deplie` local (`signal<ReadonlySet<string>>`), contenu par `@switch (j.cle)` : `iris:socio-demo` → `<mg-section-iris />`, `carreaux:filosofi` → `<mg-section-carreaux />`, `civique:indicateurs-cp` → `<mg-section-civique [integre]="true" />`, `transport:arrets` → `<mg-section-transport [integre]="true" />`, `ooh:panneaux` → `<mg-section-ooh [integre]="true" />`, `radio:emetteurs` → `<mg-section-radio [integre]="true" />`, `tmja:comptages` → `<mg-section-tmja [integre]="true" />`, `risques:icpe-pprt` → `<mg-section-risque [integre]="true" />`, `sante:air-pollen` → `<mg-section-sante [integre]="true" />`, `meteo:zones` → `<mg-section-meteo [integre]="true" />`.
- `affiche` par clé : carreaux `carreaux.visible()`, IRIS `iris.visible()`, civique `civique.variable() !== null`, transport `selections.typesTransport().length > 0`, OOH `selections.regiesOoh().length > 0`, radio `radio.visible()`, TMJA `tmja.visible()`, risques `risque.actif() || risque.pprtActif()`, santé `sante.jeu() !== null`, météo `meteo.visible()`.
- Repris de `panneau-calques` : l'effet « santé s'ouvre d'elle-même au premier IRIS sélectionné, une fois » → déplier la ligne `sante:air-pollen` (et non plus la section).
- `mg-actions-poi` : repris VERBATIM de `section-poi.component.ts` hors listes de types — ligne « Points d'intérêt — n sélectionné(s) » + « ↻ » (`catalogue.charger(true)`) + erreur catalogue + cartes de style + « AFFICHER LES POI SUR LA CARTE » / « CHARGEMENT... » + « Densité » + erreur de recherche ; `afficher()` identique (`pois.chercher({ poi_types, scope: etat.perimetreScope(), regions: [], depts: [], ville: '', rayon_poi: null, poi_natures: {} })`).
- Fichiers ≤ 400 lignes : si `panneau-donnees` dépasse, extraire le bloc « Actifs » en `panneaux/donnees/actifs.component.ts`.

- [ ] **Step 1: Specs (échec)** — `panneau-donnees.component.spec.ts` (services de couche factices fournis comme dans `panneau-calques.component.spec.ts`, `CarteApi` factice : `categories` → `[{ id: 'bmw', label: 'Concessions BMW', origine: 'espace' }, { id: 'lycee', label: 'Lycées', origine: 'commune' }]`, `jeuxRecommandes` espionné) :
  - montage : `categories` appelé 1 fois, `jeuxRecommandes` 1 fois, AUCUN autre appel d'API de couche (transport, OOH, POI, tuiles) — la recommandation ne précharge rien ;
  - sélection `['iris:socio-demo', 'poi:lycee']` : bloc espace = `[data-jeu="poi:bmw"]` ; bloc commun = IRIS puis Lycées ; repli « Autres données communes (9) » fermé ; clic → 9 lignes de plus ;
  - sélection `[]` → 11 lignes communes, aucun repli, précision « aucune sélection : tout est visible » ;
  - `jeuxRecommandes` en erreur → 11 lignes, « Sélection recommandée indisponible : tout est visible. » ;
  - espace sans POI propre → « Cet espace n'a importé aucune donnée. » et le bouton vers « Mes zones » ;
  - cocher Concessions BMW puis Lycées → `poiSelectionnes() = ['bmw', 'lycee']`, `mg-actions-poi` montre le bouton d'affichage ; décocher BMW → `['lycee']` ;
  - déplier « Flux routier (TMJA) » → `mg-section-tmja` sans `mg-entete-filtre` ; allumer le TMJA (`tmja.visible.set(true)`) → `[data-jeu="tmja:comptages"] [data-affiche]` ;
  - « Chercher un jeu » « meteo » → seule la ligne Météo reste (dans son bloc) ;
  - « Actifs (n) » : reprendre les tests `actifs` de `panneau-calques.component.spec.ts` (libellés et croix).
  `actions-poi.component.spec.ts` : reprendre les tests « cartes de style », « afficher », « densité », « erreur catalogue / réessayer » de `section-poi.component.spec.ts`.
  `carte.page.spec.ts` : inventaire ligne 4 → `'[data-panneau-etape="donnees"] mg-panneau-donnees'`, ligne 5 → déplier `risques:icpe-pprt` puis `mg-section-risque` ; AJOUTER une ligne par référentiel (`[data-panneau-etape="donnees"] [data-jeu="<cle>"]` ×10) ; le faux `CarteApi` du harnais reçoit `jeuxRecommandes: () => of({ cles: [] })` ; les tests T6/T7/T11 qui ouvraient un groupe de Calques déplient désormais la ligne du jeu.
- [ ] **Step 2: FAIL** — `cd angular && npx ng test --watch=false --include='src/app/features/carte/**/*.spec.ts'`.
- [ ] **Step 3: Implémenter** — `actions-poi.component.ts` puis `panneau-donnees.component.ts` selon les exigences (gabarit : `@for (j of rangement().espace; track j.cle)`, `@for (j of rangement().recommandes; …)`, `@if (!rangement().sansSelection) { repli + @if (autresOuverts()) { @for (j of rangement().autres; …) } }` ; `rangement = computed(() => rangerJeux(filtrerJeux(jeuxDeLaCarte(this.catalogue.types()), this.recherche()), this.reco.cles() ?? []))` ; toute valeur affichée est un `computed`, aucune méthode appelée dans le gabarit hors gestionnaires d'événement). Page : `<mg-panneau-calques />` → `<mg-panneau-donnees />`, `PanneauCalquesComponent` → `PanneauDonneesComponent` dans `imports`. `git rm` des trois composants retirés et de leurs specs.
- [ ] **Step 4: PASS** — suite Angular complète, `npx vitest run --project unit tests/unit/angular`, `cd angular && npm run build`, `npx tsc --noEmit`, `grep -rn "mg-panneau-calques\|mg-groupe-calques\|mg-section-poi" angular/src` → rien.
- [ ] **Step 5: Commit** — `feat(angular): ② Données — données de l'espace, données communes recommandées, autres données`.

---

### Task 14: Preuve du lot 2 et documentation

**Files:**
- Modify: `ARCHITECTURE.md`, `angular/src/app/features/carte/README.md`, `docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md` (§ « Écarts à la livraison » s'il y en a)
- Create: `.superpowers/sdd/2026-10-13-carte-parcours/lot2-*.png` (non suivi)

- [ ] **Step 1: Parcours navigateur, deux thèmes** (`:4202` + `:3000`), chiffres relevés :
  - super_admin, BMW GROUP, aucune sélection : ② « Données de l'espace » = Concessions BMW ; « Données communes » : 11+ lignes dépliées, précision « aucune sélection » ;
  - Accès › BMW GROUP › Données : recommander IRIS, Carreaux, Panneaux OOH, Flux routier ; retour carte (le changement d'espace n'est pas nécessaire : rouvrir la carte) → ces quatre en tête, « Autres données communes (n) » replié ; Réseau : AUCUNE tuile ni requête de calque avant un geste ;
  - MARINE : CIRFA dans l'espace, sélection propre (vide → tout déplié) ;
  - interne : bloc espace « Cet espace n'a importé aucune donnée. » ;
  - recommander une catégorie puis la rendre invisible au socle n'est pas à provoquer : couvert par le test T12 (sélection périmée).
  - Nettoyer : remettre la sélection de BMW à son état d'avant (vide), vérifier par SQL `select count(*) from espace_jeux_recommandes;`.
- [ ] **Step 2: Tests complets** — `npm run test:unit`, `npm run test:integration` (seul échec admis : l'attente « habitants » de zone-risque), `npx tsc --noEmit`, `cd angular && npx ng test --watch=false`, `cd angular && npm run build`.
- [ ] **Step 3: Doc** — `ARCHITECTURE.md` § Application Angular : puce « **Carte en parcours, lot 2 (2026-10-13)** » (panneau Données, rangement, ligne uniforme, `integre`, sélection lue à la première visite, Accès › bloc recommandé, arbitrages A10-A12) ; vérifier les entrées table/RPC/routes de T8-T10. README carte. `tests/unit/docs/derive-documentation.test.ts` vert.
- [ ] **Step 4: Commit** — `docs(carte): parcours lot 2 livré — données rangées, preuve et architecture`.

---

## Registre d'exécution

| Tâche | État | Commit | Notes (écarts, mesures) |
|---|---|---|---|
| T1 Logique du parcours | à faire | | |
| T2 Étape dans l'URL | à faire | | |
| T3 ⑤-⑦ « bientôt » | à faire | | |
| T4 Page en parcours | à faire | | |
| T5 Boîte à outils | à faire | | |
| T6 Mes analyses / Mes zones | à faire | | |
| T7 Inventaire, preuve, doc lot 1 | à faire | | |
| T8 Table + RPC (sql/251) | à faire | | EXPLAIN : |
| T9 Registre des jeux | à faire | | |
| T10 Routes | à faire | | |
| T11 Accès › bloc recommandé | à faire | | |
| T12 Rangement, ligne, sections | à faire | | |
| T13 Panneau Données | à faire | | |
| T14 Preuve, doc lot 2 | à faire | | |

Consignes d'exécution : une tâche = un commit (deux au plus si la doc est lourde) ; relecture par le modèle le plus capable après T4, T5, T13 (mémoire `feedback_angular_vigilance`) ; preuve navigateur dans les deux thèmes avant de cocher T4, T5, T7, T11, T13, T14 ; tout écart à ce plan est noté dans le registre ET dans le § « Écarts à la livraison » de la spec.
