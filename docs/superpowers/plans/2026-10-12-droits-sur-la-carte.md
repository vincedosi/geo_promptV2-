# Droits sur la carte — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sur la carte, chacun — super_admin compris — voit les données communes (socle) + celles de son espace actif, rangées en deux groupes, et changer d'espace remet la carte à l'état de ce nouvel espace.

**Architecture:** côté serveur, une option `vueEspace` de `getOrgSourceIds` applique la règle de l'espace actif au super_admin ; `sourcesVisiblesDeLaRequete` (point d'entrée de toutes les routes non-admin) la passe toujours, et les deux routes qui appellent `getOrgSourceIds` directement (`map/categories`, `map/pois`) aussi. `/api/map/categories` ajoute `origine: 'commune' | 'espace'` à chaque catégorie. Côté Angular, la route carte recrée sa page au changement d'espace (patron `generation` de la coquille), et la section POI du panneau Calques affiche deux groupes.

**Tech Stack:** Next.js 15 (routes API), supabase-js, Vitest (racine : `npm run test:unit`, `npm run test:integration`) ; Angular 21.2.4 standalone zoneless signals, Tailwind 4, Vitest (`cd angular && npx ng test --watch=false`).

**Spec:** `docs/superpowers/specs/2026-10-12-droits-sur-la-carte-design.md` (approuvée par Vincent le 2026-10-12 ; § 4.1 arbitré à l'écriture de ce plan : recréation de la page plutôt qu'une liste d'invalidations).

## Global Constraints

- Droits **par espace**, jamais par utilisateur (R1). Super_admin filtré par son espace actif sur la carte (R3) ; « dentsu.explore (interne) » = un espace comme un autre (R4).
- Pages et routes d'administration (`app/api/admin/**`, `lib/espaces/**`) : comportement INCHANGÉ (R7). `getOrgSourceIds` sans option garde exactement son contrat (`null` pour super_admin).
- La jumelle SQL `source_visible()` n'est PAS modifiée.
- `app/api/isochrone-battle/route.ts` (fichier protégé) n'est PAS modifié : il passe déjà par `sourcesVisiblesDeLaRequete`.
- `middleware.ts` non modifié. Routes API : `getSession()`/`getSessionOrg`, jamais `getUser()`.
- Règles I/O de `CLAUDE.md` : pas plus de 3 appels Supabase simultanés, aucun scan de `poi_france`, `EXPLAIN ANALYZE` sur toute requête nouvelle (local : `docker exec supabase_db_genesis_app psql -U postgres`).
- React gelé (P5) : aucun fichier de `app/map/**`, `components/**` côté écran ; le champ `origine` est ajouté, rien n'est retiré de la réponse.
- Angular : skill `~/.claude/skills/porting-react-to-angular/SKILL.md` (racine d'ombre, pas de `providedIn` pour les services d'API, pas de rxjs-interop, jetons de couleur uniquement, liens relatifs).
- Libellés provisoires des groupes : « Données communes » / « Données de l'espace » (sentence case). Pas de « MAGELIAN » visible.
- `ARCHITECTURE.md` mis à jour dans le commit de chaque tâche qui change une route ou un comportement (Grep par nom de route, jamais lu en entier).
- Base locale seulement. Pas de push sur `main`, pas de PR.

## Review Focus

1. **Super_admin sans espace actif (`orgId` null)** : doit voir le socle seul sur la carte, jamais `null` (tout). → test T1.
2. **Un appelant d'administration qui appelle `getOrgSourceIds(session)` sans option** : doit toujours recevoir `null` pour un super_admin (aperçu d'espace, listes). → test T1 (non-régression).
3. **Catégorie mixte** (POI socle + POI de l'espace dans la même catégorie) : rangée « espace ». → test T2.
4. **Espace sans aucune source privée** (interne aujourd'hui) : toutes les catégories « commune », le groupe « Données de l'espace » n'est pas affiché. → tests T2 et T4.
5. **Changement d'espace pendant un chargement en cours** (catalogue ou POI) : la réponse de l'ancien espace ne doit jamais s'afficher dans le nouveau. → test T3 (la page détruite désabonne ses lectures).

---

### Task 1: Le super_admin filtré par son espace actif sur la carte

**Files:**
- Modify: `lib/auth/getOrgSourceIds.ts` (signature + règle)
- Modify: `lib/auth/perimetre-donnees.ts` (`sourcesVisiblesDeLaRequete`, en-têtes de `empreintePerimetre` / `cleDeCacheDuPerimetre` / `categorieEntierementVisible` qui parlent du super_admin)
- Modify: `app/api/map/categories/route.ts:57`, `app/api/map/pois/route.ts:82` (passer l'option)
- Test: `tests/unit/auth/get-org-source-ids-caracterisation.test.ts` (ajouts), `tests/unit/auth/perimetre-vue-espace.test.ts` (nouveau)
- Doc: `ARCHITECTURE.md` (Grep `getOrgSourceIds` et `perimetre-donnees` : la phrase « super_admin = aucun filtre » côté carte)

**Interfaces:**
- Produces: `getOrgSourceIds(session: SessionOrg | null, options?: { vueEspace?: boolean }): Promise<string[] | null>` — avec `vueEspace: true`, ne rend JAMAIS `null`. `sourcesVisiblesDeLaRequete(req)` rend toujours un tableau.

- [ ] **Step 1: Tests (échec)** — dans `get-org-source-ids-caracterisation.test.ts`, nouveau `describe` :

```ts
describe('getOrgSourceIds — vue espace (carte) : le super_admin voit comme son espace', () => {
  it('super_admin + vueEspace → filtre de son espace actif, pas null', async () => {
    reponse.data = [{ id: 'a' }]; reponse.error = null;
    const r = await getOrgSourceIds(session({ role: 'super_admin', orgId: ORG_UUID }), { vueEspace: true });
    expect(r).toEqual(['a']);
    expect(dernierOu()).toBe(`visibilite.eq.socle,organization_id.eq.${ORG_UUID},shared_with.cs.{${ORG_UUID}}`);
  });
  it('super_admin sans espace actif + vueEspace → le socle seul', async () => {
    reponse.data = [{ id: 's' }]; reponse.error = null;
    expect(await getOrgSourceIds(session({ role: 'super_admin', orgId: null }), { vueEspace: true })).toEqual(['s']);
    expect(dernierOu()).toBe('visibilite.eq.socle');
  });
  it('sans option, super_admin → null (administration inchangée)', async () => {
    expect(await getOrgSourceIds(session({ role: 'super_admin', orgId: ORG_UUID }))).toBeNull();
  });
  it('client + vueEspace → même règle que sans option', async () => {
    reponse.data = [{ id: 'c' }]; reponse.error = null;
    expect(await getOrgSourceIds(session({ role: 'client', orgId: ORG_UUID }), { vueEspace: true })).toEqual(['c']);
  });
});
```

Et `tests/unit/auth/perimetre-vue-espace.test.ts` : mocker `@/lib/auth/getSessionOrg` (rend une session super_admin) et `@/lib/auth/getOrgSourceIds` (espion), appeler `sourcesVisiblesDeLaRequete({} as never)` et vérifier que l'espion a reçu `{ vueEspace: true }`. Plus un test « source » qui lit `app/api/map/categories/route.ts` et `app/api/map/pois/route.ts` et exige `getOrgSourceIds(session, { vueEspace: true })` (verrou contre une route qui oublierait l'option) :

```ts
import { readFileSync } from 'node:fs';
for (const f of ['app/api/map/categories/route.ts', 'app/api/map/pois/route.ts']) {
  it(`${f} passe vueEspace`, () => {
    expect(readFileSync(f, 'utf8')).toMatch(/getOrgSourceIds\(session,\s*\{\s*vueEspace:\s*true\s*\}\)/);
  });
}
```

- [ ] **Step 2: Lancer, vérifier l'échec** — `npx vitest run --project unit tests/unit/auth` → FAIL (option ignorée, `null` rendu).

- [ ] **Step 3: Implémenter** — `lib/auth/getOrgSourceIds.ts` :

```ts
export async function getOrgSourceIds(
  session: SessionOrg | null,
  options: { vueEspace?: boolean } = {},
): Promise<string[] | null> {
  // Administration : le super_admin voit tout. Carte (`vueEspace`) : il voit
  // comme son espace actif, exactement comme un client de cet espace
  // (décision de Vincent du 2026-10-12, spec droits-sur-la-carte R3/R4).
  if (session?.role === 'super_admin' && !options.vueEspace) return null;
  // … corps actuel inchangé (orgId vérifié, condition, lecture, [] sur erreur)
}
```

Mettre à jour l'en-tête du fichier (`null = aucun filtre — super_admin, et LUI SEUL, HORS vue espace`). `lib/auth/perimetre-donnees.ts` :

```ts
/**
 * Les sources visibles de l'appelant d'une route de la CARTE (toute route hors
 * /api/admin) : le socle + son espace actif + ses partages — super_admin
 * compris, qui voit la carte comme l'espace qu'il a choisi (2026-10-12).
 * Ne rend jamais `null`.
 */
export async function sourcesVisiblesDeLaRequete(req: NextRequest): Promise<string[]> {
  return (await getOrgSourceIds(await getSessionOrg(req), { vueEspace: true })) ?? [];
}
```

Dans `map/categories/route.ts:57` et `map/pois/route.ts:82` : `await getOrgSourceIds(session, { vueEspace: true })`. Les branches `sourceIds === null` de ces deux routes deviennent mortes : les GARDER (un appelant futur sans option) mais corriger leur commentaire. Les fonctions de `perimetre-donnees.ts` qui acceptent encore `string[] | null` gardent leur signature (chat, administration).

- [ ] **Step 4: PASS** — `npx vitest run --project unit tests/unit/auth tests/unit/securite` ; puis `npx tsc --noEmit` (code de retour, sans pipe) ; puis `npm run test:unit` (échec connu ignorable : `suppressions-sans-garde` hors dépôt principal).

- [ ] **Step 5: Vérification réelle** — `npm run dev` (s'il ne tourne pas, en arrière-plan ; ne jamais arrêter un :3000 existant). Avec le compte super_admin local (mémoire `reference_geomatik_credentials.md`), espace actif BMW GROUP puis MARINE puis interne (`POST /api/user/switch-org`), relever `GET /api/map/categories` : BMW contient `bmw` et pas `cirfa`, MARINE l'inverse, interne ni l'un ni l'autre. Noter les trois listes dans le rapport. Remettre l'espace actif d'origine du compte à la fin.

- [ ] **Step 6: Commit** — `feat(droits): la carte filtre le super_admin par son espace actif`.

---

### Task 2: L'origine de chaque catégorie (`commune` / `espace`)

**Files:**
- Modify: `lib/auth/getOrgSourceIds.ts` (nouvelle fonction `getSourcesPropresEspace`)
- Modify: `app/api/map/categories/route.ts` (champ `origine`)
- Test: `tests/unit/auth/sources-propres-espace.test.ts` (nouveau), `tests/unit/api/map-categories-origine.test.ts` (nouveau)
- Doc: `ARCHITECTURE.md` (Grep `/api/map/categories` : forme de la réponse)

**Interfaces:**
- Consumes: `getOrgSourceIds(session, { vueEspace: true })` (T1), `getCategoriesVisibles(sources)` (`lib/poi/categories.ts`, cache par empreinte, inchangé).
- Produces: `getSourcesPropresEspace(session: SessionOrg | null): Promise<string[]>` — sources NON socle visibles de l'espace actif (`visibilite = 'privee'`, propriétaire = espace OU `shared_with` contient l'espace, non supprimées) ; `[]` sans espace ou sur erreur. Réponse `GET /api/map/categories` : `{ categories: { id: string; label: string; origine: 'commune' | 'espace' }[] }`.

- [ ] **Step 1: Tests (échec)** — `sources-propres-espace.test.ts`, même chaîne factice que le test de T1 (copier `fausseChaine`, en ajoutant `eq(colonne, valeur)` qui pousse `{ methode: 'eq', argument: \`${colonne}=${valeur}\` }`) :

```ts
it('espace actif → sources privées de l\'espace ou partagées avec lui, socle exclu', async () => {
  reponse.data = [{ id: 'p' }]; reponse.error = null;
  expect(await getSourcesPropresEspace(session({ role: 'super_admin', orgId: ORG_UUID }))).toEqual(['p']);
  expect(filtresObserves).toContainEqual({ methode: 'eq', argument: 'visibilite=privee' });
  expect(dernierOu()).toBe(`organization_id.eq.${ORG_UUID},shared_with.cs.{${ORG_UUID}}`);
});
it('sans espace actif → [] sans lecture', async () => {
  filtresObserves.length = 0;
  expect(await getSourcesPropresEspace(session({ role: 'client', orgId: null }))).toEqual([]);
  expect(filtresObserves).toHaveLength(0);
});
it('lecture en échec → []', async () => {
  reponse.data = null; reponse.error = { message: 'x' };
  expect(await getSourcesPropresEspace(session({ role: 'client', orgId: ORG_UUID }))).toEqual([]);
});
```

`map-categories-origine.test.ts` : mocker `getSessionOrg`, `getOrgSourceIds` (→ `['s1','p1']`), `getSourcesPropresEspace` (→ `['p1']`), `getDistinctCategories`, `getCategoriesVisibles` (→ `['bmw','lycee']` pour `['s1','p1']`, `['bmw']` pour `['p1']`) et `createAdminClient` (labels vides). Attendus :
- `bmw` → `origine: 'espace'`, `lycee` → `'commune'` ;
- catégorie mixte : si `getCategoriesVisibles(['p1'])` rend `['lycee']`, alors `lycee` → `'espace'` ;
- `getSourcesPropresEspace` → `[]` : toutes `'commune'` et `getCategoriesVisibles` appelé UNE seule fois (pas de leapfrog vide).

- [ ] **Step 2: FAIL** — `npx vitest run --project unit tests/unit/auth/sources-propres-espace.test.ts tests/unit/api/map-categories-origine.test.ts`.

- [ ] **Step 3: Implémenter** — dans `lib/auth/getOrgSourceIds.ts` :

```ts
/**
 * Les sources PROPRES à l'espace actif : privées, possédées par lui ou
 * partagées avec lui — jamais le socle. Sert à ranger un jeu dans « Données de
 * l'espace » sur la carte (spec droits-sur-la-carte R6). Ce n'est PAS une
 * règle d'autorisation : `getOrgSourceIds` le reste.
 */
export async function getSourcesPropresEspace(session: SessionOrg | null): Promise<string[]> {
  const orgId = session?.orgId && UUID.test(session.orgId) ? session.orgId : null;
  if (!orgId) return [];
  const { data, error } = await createAdminClient()
    .from('data_sources')
    .select('id')
    .eq('visibilite', 'privee')
    .or(FILTRE_SOURCE_NON_SUPPRIMEE)
    .or(`organization_id.eq.${orgId},shared_with.cs.{${orgId}}`);
  if (error) return [];
  return data?.map((s: { id: string }) => s.id) ?? [];
}
```

Dans `app/api/map/categories/route.ts`, après le calcul de `filteredCats` (branche tableau ; la branche `null` reçoit `origine: 'commune'` partout) :

```ts
// « Données de l'espace » : au moins un POI visible vient d'une source propre
// à l'espace. Une catégorie mixte est rangée « espace » (ce que le client a
// importé prime). Un leapfrog de plus, sur les seules sources propres, en
// cache par empreinte comme le premier ; aucun s'il n'y en a pas.
const propres = await getSourcesPropresEspace(session);
const catsEspace = new Set(propres.length > 0 ? await getCategoriesVisibles(propres) : []);
return NextResponse.json({
  categories: withLabels(filteredCats, labelMap).map((c) => ({
    ...c, origine: catsEspace.has(c.id) ? 'espace' : 'commune',
  })),
});
```

Les deux lectures sont SÉQUENTIELLES (jamais de `Promise.all` ici).

- [ ] **Step 4: PASS + mesure I/O** — tests ci-dessus, `npx tsc --noEmit`, `npm run test:unit`. Puis `EXPLAIN (ANALYZE, BUFFERS)` en local de l'étape du leapfrog restreint aux sources propres de BMW (`select categorie from poi_france where data_source_id in (…) and categorie is not null and categorie > '' order by categorie limit 1`) : relever buffers et durée dans le rapport.

- [ ] **Step 5: Vérification réelle** — mêmes trois espaces qu'en T1 : BMW → `bmw` en `espace`, `lycee` en `commune` ; MARINE → `cirfa` en `espace` ; interne → tout `commune`.

- [ ] **Step 6: Commit** — `feat(droits): /api/map/categories dit l'origine de chaque catégorie`.

---

### Task 3: Changer d'espace recrée la page carte

**Files:**
- Create: `angular/src/app/features/carte/carte-hote.component.ts` (+ spec) — composant de la ROUTE carte, porte `generation` et rend `<mg-carte-page>` dans un bloc recréé.
- Modify: `angular/src/app/app.routes.ts` (la route `carte` charge l'hôte au lieu de la page — changer SEULEMENT le composant chargé ; enfants et fournisseurs inchangés), `angular/src/app/features/carte/carte.page.ts` (`organisationChangee` émet vers l'hôte au lieu de nettoyer à la main ; sélecteur `mg-carte-page` si la page n'en a pas)
- Doc: `ARCHITECTURE.md` § Application Angular (une puce « Droits sur la carte, T3 »)

**Interfaces:**
- Consumes: `orgChangee` de `mg-barre-haut` (déjà relayé à `carte.page.ts:297`).
- Produces: `CarteHoteComponent` (`selector: 'mg-carte-hote'`), `CartePage.espaceChange = output<void>()`.

Exigences :
- Patron EXACT de `layout/coquille.component.ts` (`generation = signal(0)`, `actualiser()` l'incrémente, le gabarit recrée l'enfant : `@for (g of [generation()]; track g) { <mg-carte-page (espaceChange)="actualiser()" /> }`). TOUS les services d'état de la carte sont fournis par la page (`providers` de `CartePage`) : la recréer les remet à zéro — le vérifier en lisant `carte.page.ts` ; tout service de la carte fourni AILLEURS (route, racine) qui garde un état dépendant du périmètre doit être listé dans le rapport et, s'il existe, réinitialisé explicitement par l'hôte.
- Les enfants de la route carte (`carte/risques`, lot 4 T13) continuent de fonctionner : le `<router-outlet>` éventuel de la page vit dans la page recréée.
- Aucun appel réseau de plus qu'une ouverture de carte (règles I/O).
- La carte MapLibre est détruite et recréée : c'est voulu ici (équivalent du `reload` React) ; vérifier qu'aucune fuite (écouteurs, `ResizeObserver`) ne survit — `DestroyRef` existants.

- [ ] **Step 1: Specs (échec)** — `carte-hote.component.spec.ts` : (a) émettre `espaceChange` depuis la page → l'instance de `CartePage` change (référence différente) et l'instance de `CataloguePoiService` aussi ; (b) une lecture `GET /api/map/categories` en cours (HttpTestingController) au moment du changement est ANNULÉE (`req.cancelled === true`) et sa réponse tardive n'atteint pas la nouvelle page (Review Focus 5) ; (c) aucun appel HTTP n'est émis par la recréation seule. `carte.page.spec.ts` : `organisationChangee()` émet `espaceChange` (et ne fait plus le nettoyage manuel).
- [ ] **Step 2: FAIL** — `cd angular && npx ng test --watch=false --include='src/app/features/carte/carte-hote.component.spec.ts'`.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: PASS** — suite Angular complète `cd angular && npx ng test --watch=false` (sans pipe ; les timeouts de 5 s connus de `remote.spec.ts` sur poste chargé sont à signaler, pas à corriger), `npm run build`.
- [ ] **Step 5: Navigateur** — Angular `:4202` (`cd angular && npm run config && npx ng serve --port 4202`), Next `:3000` réutilisé. Super_admin, espace BMW : ouvrir Calques › POI, sélectionner `bmw`, afficher → N points. Passer à MARINE par le badge : la page se recrée, la section POI ne propose plus `bmw`, aucun point BMW ne reste à l'écran. Capture avant/après, deux thèmes. Couper `:4202` à la fin.
- [ ] **Step 6: Commit** — `feat(angular): changer d'espace recrée la page carte`.

---

### Task 4: Deux groupes dans la section POI

**Files:**
- Modify: `angular/src/app/features/carte/data/carte.api.ts` (`CategoriePoi` : `{ id; label; origine?: 'commune' | 'espace' } | string`)
- Modify: `angular/src/app/features/carte/etat/catalogue-poi.service.ts` (`TypePoi.origine: 'commune' | 'espace'`, défaut `'commune'` pour une chaîne ou un objet sans champ)
- Modify: `angular/src/app/features/carte/panneaux/calques/section-poi.component.ts` (deux groupes)
- Test: specs des trois fichiers
- Doc: `ARCHITECTURE.md` § Application Angular (puce « Droits sur la carte, T4 »)

**Interfaces:**
- Consumes: réponse de T2.
- Produces: `TypePoi { id: string; label: string; origine: 'commune' | 'espace' }` ; `typeDePoi(c)` rend toujours `origine`.

Exigences de rendu :
- Au-dessus de la liste, deux sous-titres, dans cet ordre : **« Données de l'espace »** (types `origine === 'espace'`) puis **« Données communes »**. Ordre retenu : ce que le client a importé d'abord — arbitrage du chef de projet, coût si faux : inverser deux blocs.
- Chaque groupe est une `mg-liste-multiple` (composant existant, `panneaux/filtre/liste-multiple.component.ts`) ; la sélection reste UNE (`etat.poiSelectionnes`) : cocher dans un groupe n'efface pas l'autre. Si `mg-liste-multiple` ne sait pas recevoir une sélection qui contient des ids absents de ses `items`, le lire et l'adapter (sans casser ses autres usages) ou filtrer l'entrée/sortie dans la section — choix consigné au rapport.
- Un groupe vide n'est pas rendu, sous-titre compris. Si TOUT est commun (espace interne), la section a le rendu d'aujourd'hui sans aucun sous-titre (Review Focus 4).
- Sous-titres : style des libellés existants de la section (`text-[11px] font-medium text-secondary`), jetons uniquement, sentence case. Le compteur « (N) » global reste.

- [ ] **Step 1: Specs (échec)** — `catalogue-poi.service.spec.ts` : `typeDePoi('lycee').origine === 'commune'`, `typeDePoi({id:'bmw',label:'BMW',origine:'espace'}).origine === 'espace'`, objet sans `origine` → `'commune'`. `section-poi.component.spec.ts` : catalogue `[bmw espace, lycee commune]` → deux sous-titres dans l'ordre, `bmw` sous le premier ; catalogue tout commun → aucun sous-titre ; sélectionner `bmw` puis `lycee` → `poiSelectionnes` = `['bmw','lycee']`.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS** (suite Angular complète, build).
- [ ] **Step 5: Navigateur** — espaces BMW, MARINE, interne : captures de la section POI ouverte, deux thèmes ; interne sans sous-titre.
- [ ] **Step 6: Commit** — `feat(angular): la section POI range les types en données de l'espace et données communes`.

---

### Task 5: Preuve de bout en bout et documentation

**Files:**
- Modify: `ARCHITECTURE.md` (relecture des puces T1-T4, cohérence), `docs/superpowers/specs/2026-10-12-droits-sur-la-carte-design.md` (§ « Écarts à la livraison » s'il y en a)
- Create: `.superpowers/sdd/2026-10-12-droits-carte/T5-*.png` (non suivi par git)

- [ ] **Step 1: Parcours navigateur** (spec § 5), Angular `:4202` + Next `:3000`, deux thèmes, chiffres relevés :
  - super_admin, espace BMW : nombre de concessions BMW affichées (France entière interdite : utiliser le filtre de périmètre habituel de la section, une région) ; CIRFA absents de la liste ;
  - super_admin, espace MARINE : CIRFA présents, `bmw` absent ;
  - super_admin, espace interne : ni `bmw` ni `cirfa` ; lycées, Brest présents en « Données communes » ;
  - compte CLIENT de BMW (créer un compte jetable `[ESSAI droits-carte]` rattaché à BMW GROUP depuis la page Accès si aucun n'existe ; le supprimer à la fin, vérifier par SQL) : même liste de catégories et même nombre de points que le super_admin dans BMW ;
  - une zone custom créée dans BMW (`[ESSAI droits-carte]`) n'apparaît ni dans MARINE ni dans interne ; supprimée à la fin ;
  - non-régression admin : page Accès, onglet Données d'un espace : le super_admin voit toujours tous les jeux.
- [ ] **Step 2: Tests complets** — `npm run test:unit`, `npm run test:integration` (le seul échec connu admis : l'attente « habitants » de zone-risque 41 025 366 vs 42 409 940), `npx tsc --noEmit`, `cd angular && npx ng test --watch=false`, `npm run build` (Angular).
- [ ] **Step 3: Doc** — vérifier que `ARCHITECTURE.md` dit la nouvelle règle (super_admin filtré sur la carte, pas en admin) à chaque endroit où `getOrgSourceIds`/`sourcesVisiblesDeLaRequete` sont décrits ; `tests/unit/docs/derive-documentation.test.ts` vert.
- [ ] **Step 4: Commit** — `docs(droits): droits sur la carte livrés — preuve et architecture`.
