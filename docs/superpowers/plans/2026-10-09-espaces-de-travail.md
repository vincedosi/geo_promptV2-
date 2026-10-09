# Espaces de travail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Tâches Angular (T5 à T10) :** charger AVANT d'écrire le skill personnel
> `porting-react-to-angular` (`~/.claude/skills/porting-react-to-angular/SKILL.md`
> + `aida-remote-app.md` + `reference-angular-21.md`). La page est NEUVE (pas de
> port d'écran), mais le contrat AIDA, les pièges Angular et les preuves
> navigateur du skill s'appliquent tels quels.

**Goal:** une page unique `admin/espaces` (Angular) où le super_admin crée les comptes, règle à quels espaces de travail chaque utilisateur appartient, et règle pour chaque espace quels jeux de données de dentsu.explore il voit (socle, privé, partagé), avec un aperçu qui prouve ce que l'espace voit réellement.

**Architecture:** la règle d'appartenance passe EN BASE (sql/236 : rattrapage, deux déclencheurs, une RPC atomique), parce que c'est la seule barrière face à un appel PostgREST direct (leçon de sql/234). La logique serveur vit dans `lib/espaces/` (fonctions pures + lectures bornées, testées contre la base locale) ; les routes `app/api/admin/espaces/**` et `users/[id]/espaces` n'en sont que l'enveloppe. Les routes existantes qui écrivaient l'appartenance dans `profiles` seul sont corrigées pour écrire `organization_members`. L'écran Angular est une route `admin/espaces` de l'administration du lot 6 : une colonne d'espaces persistante et un `<router-outlet>` pour la fiche (`socle` ou `:id`), un service d'état fourni par la page.

**Tech Stack:** Next.js 15 (routes API), Supabase local (PostgreSQL 17.6), Zod, Vitest (racine : `test:unit`, `test:integration`), Angular 21.2.4 (standalone, zoneless, signals, OnPush), Tailwind 4, Playwright MCP pour les preuves.

**Spec:** `docs/superpowers/specs/2026-10-08-espaces-de-travail-design.md` (validée le 2026-10-08, Q1 et Q2 tranchées). Le plan argumente depuis la spec : lire les deux.

---

## Décisions du chef de projet (2026-10-09)

Prises sur délégation explicite de Vincent (« tu es le chef de projet »). Chacune est réversible à faible coût.

| # | Décision | Pourquoi |
|---|---|---|
| E1 | **Branche `feat/espaces-de-travail`** partie de `feat/dentsu-explore` (qui contient `feat/droits-donnees`), dans laquelle on **fusionne `feat/angular-lot6`** (T1-T5 du lot 6 : route `admin`, garde, `mg-confirmation`, `mg-notifications`). Quatre conflits attendus, tous des ajouts d'icônes (`icones.ts`, sa spec, `icones-lucide.test.ts`, `catalogue.page.ts`) : garder les DEUX ajouts, compte du test = somme. | La page a besoin à la fois du cloisonnement (sql/234-235), du renommage et du socle admin Angular. Aucune de ces branches n'est mergée dans `main`. |
| E2 | **Libellés : « Socle dentsu.explore »** (et non « Socle MAGELIAN » comme dans la spec), et **« dentsu.explore (interne) »** pour l'organisation `genesis-global`. Le nom affiché est calculé CÔTÉ SERVEUR (`lib/espaces/nom-espace.ts`), à un seul endroit. | Règle du 2026-10-08 : MAGELIAN ne s'écrit plus dans aucun texte visible. |
| E3 | **Ajouter un super_admin à un espace ne le rétrograde plus en `client`.** `POST …/members` n'écrit le rôle QUE s'il est fourni ; `DELETE …/members` ne remet plus le rôle à `client`. | Aujourd'hui, ajouter Vincent à la MARINE depuis React le ferait `client` (le schéma pose `role` par défaut). Un retrait d'espace n'a pas à toucher au rôle. |
| E4 | **Aperçu sans effectif par catégorie** : catégories visibles listées SANS nombre de POI ; les effectifs sont ceux des JEUX (`data_sources.valid_count`). **Zones personnalisées et jeux de zones absents de l'aperçu** : `custom_geo_zones` et `zone_sets` n'ont pas d'`organization_id` (rattachées à `created_by`, un utilisateur) — les compter « par espace » serait inventer une règle que les routes n'appliquent pas. Campagnes (`dsp_campaigns.organization_id`) gardées. | § 7 de la spec : aucun `COUNT` sur `poi_france`. Et l'aperçu doit APPELER la règle des routes, pas en écrire une. Écart à la spec, à signaler à Vincent dans le rapport final. |
| E5 | **Le rôle `admin` n'est jamais proposé** (D1). Le sélecteur de rôle de la fiche utilisateur offre `client` / `super_admin`, libellés de `ROLE_LABELS`. | Spec § 3.2. |
| E6 | **Navigation Angular** : les entrées « Users » et « Organisations » de la section « Systeme » sont remplacées par UNE entrée « Espaces de travail » (`cible: 'admin/espaces'`). Écart VOULU à la parité avec la barre React, documenté dans `navigation.ts`. | Spec § 4 et § 6. |
| E7 | **Le lot 6 perd ses tâches T6, T7 et T8** (remplacées), et T18 perd le partage d'une source. Le plan du lot 6 est annoté dans le commit de T11. | Spec § 6. |

---

## Global Constraints

Valent pour CHAQUE tâche, en plus de la section « Global Constraints » du plan du lot 6 (`docs/superpowers/plans/2026-10-06-angular-lot6-administration.md`, sur `feat/angular-lot6`), qui s'applique à toute la partie Angular :

- **Base LOCALE uniquement** (`docker exec supabase_db_genesis_app psql -U postgres`). Le MCP Supabase pointe sur un AUTRE projet : ne jamais l'appeler. `scripts/local/10-sauvegarder.sh` avant T1 et avant T11.
- **Seul le super_admin administre** (D1) : toute route neuve commence par `requireAdmin` (en-tête Bearer, ce que `HttpClient` envoie).
- **Routes** : `export const dynamic = 'force-dynamic'`, validation Zod, corps par `lireCorps()` (`lib/api/valider-corps.ts`), `createAdminClient()` de `@/lib/auth`. Chaque `error` de supabase-js est LU ; `.delete()`/`.update()` avec `{ count: 'exact' }` quand un compte est rapporté.
- **Troncature PostgREST** : aucune RPC tabulaire neuve. Toute lecture de table neuve est bornée par construction (organisations, comptes, sources : quelques dizaines de lignes) et le DIT dans un commentaire, avec le plafond serveur `db-max-rows = 1 000` (mémoire `reference_postgrest_db_max_rows`).
- **I/O** : aucun `COUNT` sur `poi_france` ; effectifs = `data_sources.valid_count`. Au plus 3 requêtes Supabase simultanées par route (`Promise.all` ≤ 3). Côté Angular, au plus 3 appels à l'ouverture d'une fiche (le `limiteurInterceptor` le garantit, ne pas le contourner).
- **Textes visibles** : sentence case, français, jamais « MAGELIAN », « GENESIS » ni « GEOMATIK » (E2). Pas d'exemple de marque dans les placeholders (mémoire `feedback_no_fake_brand_examples`) : `nom@exemple.fr`, « Nom de l'espace ».
- **Couleurs : jetons seulement**, jamais d'hexadécimal ni de `rgba` littéral. Bords 0,5 px. Bandeaux de section `--bg-level-2` + point `--brand-teal`. Deux thèmes.
- **Angular** : préfixe `mg`, OnPush, `input()`/`output()`, `@if`/`@for (…; track id)`, `inject()`, `protected` pour le gabarit, pas de méthode appelée dans le gabarit (`computed`). Services d'API `@Injectable()` sans `providedIn`, héritiers de `HttpBaseService`, fournis par `FOURNISSEURS_ADMIN`. Jamais `@angular/forms` ni `@angular/core/rxjs-interop` (gardes `imports-partages.test.ts`). Jamais `position: fixed`, `window.confirm`, `scrollIntoView`. Modales = `<dialog>` natif (patron de `mg-confirmation`). Liens RELATIFS.
- **Le lien d'initialisation d'un compte est un secret d'usage unique** : affiché une fois, copiable, jamais journalisé (`console.*` interdit dessus), effacé de l'état à la fermeture du dialogue.
- **Vérifications de fin de tâche** : `npx tsc --noEmit` à la racine (code de retour lu DIRECTEMENT, jamais derrière un pipe — mémoire `feedback_verifier_sans_pipe`), `npm run test:unit`, `npm run test:integration` quand la tâche touche la base, et pour Angular `cd angular && npx ng test --watch=false` puis `npm run build` sans nouvel avertissement.
- **Documentation dans le commit** : `ARCHITECTURE.md` (Grep sur la route, la table ou la RPC, mise à jour de la section concernée) pour toute route, RPC ou déclencheur ajouté. `tests/unit/docs/derive-documentation.test.ts` doit rester vert.
- **Commits** atomiques `type: description`, terminés par `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. **Ne jamais pousser.** Ne jamais stager la doc AIDA ni `.claude/worktrees/`.
- Serveurs : racine `npm run dev` (:3000), Angular `cd angular && npm start` (:4200, routes sous `/app`). Arrêter l'arbre entier des serveurs en fin de tâche (zombies `next dev`, mémoire `reference_dev_server_zombie`).

## Review Focus

- **Retirer quelqu'un de son espace actif ne l'enferme pas dehors.** Un client membre de BMW et de la MARINE, actif sur la MARINE, retiré de la MARINE → actif sur BMW ; retiré de son seul espace → actif `null` (ne voit que le socle), jamais un espace dont il n'est pas membre. Tests : T1 (`appartenance-espaces.test.ts`, cas « report de l'espace actif »).
- **Supprimer un compte ou un espace ne casse rien en cascade.** `auth.admin.deleteUser` sur un membre, `DELETE /api/admin/organizations/[id]` sur un espace qui a des membres actifs : aucune erreur de déclencheur, profils restants cohérents. Tests : T1 (cas « suppression en cascade »).
- **Un super_admin ajouté ou retiré d'un espace garde son rôle** (E3), et peut toujours se placer sur n'importe quel espace. Tests : T2 (`appartenance.test.ts`).
- **L'aperçu dit la vérité.** Pour un vrai compte client connecté par PostgREST (règle SQL `source_visible`), l'ensemble des jeux visibles est EXACTEMENT celui de l'aperçu (règle TypeScript `getOrgSourceIds`) ; une catégorie privée d'un autre espace (« bmw » pour la MARINE) n'y apparaît pas. Tests : T3 (`espaces-apercu.test.ts`).
- **Une écriture refusée se voit.** Toute écriture de l'écran (partage, socle, transfert, membre, espaces d'un utilisateur, réglages) en 4xx/5xx → notification d'erreur avec le message du serveur, et l'état affiché N'EST PAS mis à jour comme si elle avait réussi. Tests : specs de T6 à T10 (cas « écriture en 500 »).

---

## Chiffres de référence (base locale, relevés le 2026-10-09)

À remesurer au début de T1 et de T11 :

```bash
MSYS_NO_PATHCONV=1 docker exec supabase_db_genesis_app psql -U postgres -At -c "
select 'profiles', count(*) from profiles
union all select 'organization_members', count(*) from organization_members
union all select 'organizations', count(*) from organizations
union all select 'data_sources', count(*) from data_sources where status is distinct from 'deleted'
union all select 'socle', count(*) from data_sources where visibilite='socle' and status is distinct from 'deleted';"
```

| Grandeur | Valeur |
|---|---|
| Profils | 4 (2 super_admin, 2 client) |
| Organisations | 4 : BMW GROUP (`bmw-group`), DRHAT (`drhat`), GENESIS (Global) (`genesis-global`, id `00000000-0000-0000-0000-000000000001`), MARINE (`marine`) |
| `organization_members` | 8 : les deux super_admin sont membres des 4 espaces ; **les deux clients (`souraj91@…` sur MARINE, `souraj91+1@…` sur DRHAT) ne sont membres de RIEN** — le rattrapage de sql/236 doit en créer 2 |
| Sources | 5 : CONCESSIONS BMW (poi, privée BMW, 177), CIRFA (poi, privée MARINE, 101), LYCEEE (poi, socle, 5 584), Filosofi 2021 — Carreaux 200m (carreaux, socle, 2 298 582), Brest Métropole 2026 (panneaux, socle, 1 434) |
| Déclencheurs sur `profiles` / `organization_members` | aucun |
| Clés étrangères | `organization_members.user_id → auth.users ON DELETE CASCADE`, `organization_members.organization_id → organizations ON DELETE CASCADE`, `profiles.organization_id → organizations ON DELETE SET NULL` |

**Constat qui justifie T2 :** aucun code de `app/` ni de `lib/` n'ÉCRIT `organization_members` (grep du 2026-10-09). Seuls `/api/user/switch-org` et `/api/user/organizations` la lisent. `POST/DELETE …/members` et `POST /api/admin/users` écrivent `profiles.organization_id` seul.

---

## Structure de fichiers

```
sql/236_appartenance_espaces.sql                 # T1 : rattrapage, 2 déclencheurs, RPC remplacer_espaces_utilisateur
lib/espaces/
├── types.ts                                     # T3 : types des réponses (source de la copie Angular)
├── nom-espace.ts                                # T3 : nom affiché (E2)
├── appartenance.ts                              # T2 : ajouterMembre, retirerMembre, remplacerEspaces
├── lister-espaces.ts                            # T3 : colonne des espaces + entrée socle
├── donnees-espace.ts                            # T3 : statutPourEspace (pur) + donneesDeLEspace
└── apercu-espace.ts                             # T3 : apercuEspace (appelle getOrgSourceIds / getCategoriesVisibles)
app/api/admin/espaces/route.ts                   # T3 : GET
app/api/admin/espaces/socle/route.ts             # T3 : GET
app/api/admin/espaces/[id]/donnees/route.ts      # T3 : GET
app/api/admin/espaces/[id]/membres/route.ts      # T3 : GET
app/api/admin/espaces/[id]/apercu/route.ts       # T3 : GET
app/api/admin/users/[id]/espaces/route.ts        # T4 : PUT
app/api/admin/organizations/[id]/members/route.ts  # T2 : modifié
app/api/admin/organizations/route.ts             # T2 : compte des membres par organization_members
app/api/admin/users/route.ts                     # T2 : création écrit l'appartenance
app/api/admin/users/[id]/route.ts                # T2 : refus lisible d'un espace actif non membre
tests/integration/appartenance-espaces.test.ts   # T1 + T2
tests/integration/espaces-lectures.test.ts       # T3
tests/integration/espaces-apercu.test.ts         # T3
tests/unit/espaces/statut-jeu.test.ts            # T3
tests/unit/espaces/nom-espace.test.ts            # T3
tests/unit/angular/espaces-types-paritaires.test.ts  # T5
angular/src/app/features/admin/espaces/
├── logique/types.ts                             # T5 : copie de lib/espaces/types.ts
├── logique/libelles.ts                          # T5 : textes et libellés de statut
├── data/espaces.api.ts (+ spec)                 # T5
├── etat/espaces-etat.service.ts (+ spec)        # T5
├── espaces.page.ts (+ spec)                     # T5 : colonne + outlet
├── dialogue-nouvel-espace.component.ts (+ spec) # T5
├── aucun-espace.component.ts                    # T5
├── fiche-socle.component.ts (+ spec)            # T6
├── fiche-espace.component.ts (+ spec)           # T7 : en-tête + onglets
├── onglet-membres.component.ts (+ spec)         # T7
├── dialogue-ajout-membre.component.ts (+ spec)  # T7
├── fiche-utilisateur.component.ts (+ spec)      # T7
├── onglet-donnees.component.ts (+ spec)         # T8
├── onglet-apercu.component.ts (+ spec)          # T9
└── onglet-reglages.component.ts (+ spec)        # T10
```

---

### Task 0: Branche de travail et état de départ

**Files:**
- Aucun fichier de code. Merge de `feat/angular-lot6`, conflits dans `angular/src/app/ui/icone/icones.ts`, `angular/src/app/ui/icone/icone.component.spec.ts`, `tests/unit/angular/icones-lucide.test.ts`, `angular/src/app/features/catalogue/catalogue.page.ts`.

**Interfaces:**
- Produces : une branche `feat/espaces-de-travail` où `admin/health` et `admin/qualite-donnees` s'ouvrent en Angular et où sql/234-235 sont présents.

- [ ] **Step 1: Créer la branche**

```bash
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
cd /c/GENESIS/genesis_app
git status --short            # seuls .claude/worktrees/ et deux logos non suivis doivent apparaître
git switch -c feat/espaces-de-travail feat/dentsu-explore
git merge --no-ff feat/angular-lot6 -m "merge: socle d'administration Angular (lot 6, T1-T5) dans espaces de travail"
```

Expected : `CONFLICT (content)` sur les quatre fichiers ci-dessus, et seulement eux.

- [ ] **Step 2: Résoudre les conflits**

Dans chacun des quatre fichiers, garder les ajouts des DEUX côtés (icônes du lot 4 ET icônes du lot 6 : `triangle-alerte`, `coche`, `loupe`, …), dans l'ordre : entrées du côté `HEAD`, puis celles du lot 6. Dans `tests/unit/angular/icones-lucide.test.ts`, le compte attendu = compte de `HEAD` + nombre d'icônes ajoutées par le lot 6. Dans `catalogue.page.ts`, garder les imports et les champs des deux côtés.

```bash
git add angular/src/app/ui/icone/icones.ts angular/src/app/ui/icone/icone.component.spec.ts tests/unit/angular/icones-lucide.test.ts angular/src/app/features/catalogue/catalogue.page.ts
git commit --no-edit
```

- [ ] **Step 3: Vérifier l'état de départ**

```bash
npx tsc --noEmit; echo "tsc=$?"
npm run test:unit
cd angular && npm ci && npx ng test --watch=false && npm run build; cd ..
```

Expected : `tsc=0`, toutes les suites vertes. Si une suite Angular échoue après le merge, c'est un conflit mal résolu : corriger avant d'aller plus loin (ne pas ouvrir T1 sur une base rouge).

- [ ] **Step 4: Sauvegarde de la base**

```bash
bash scripts/local/10-sauvegarder.sh
```

Relever les chiffres de référence (bloc ci-dessus) et les copier dans le rapport de tâche.

---

### Task 1: sql/236 — appartenance en base

**Files:**
- Create: `sql/236_appartenance_espaces.sql`
- Create: `tests/integration/appartenance-espaces.test.ts`
- Modify: `ARCHITECTURE.md` (section qui décrit sql/234 et le cloisonnement — `Grep "234_cloisonnement"` — ajouter un paragraphe sql/236)

**Interfaces:**
- Produces :
  - déclencheur `profiles_espace_actif_membre` (BEFORE INSERT OR UPDATE OF organization_id, role ON profiles) → refuse avec `SQLSTATE 23514` un `organization_id` non nul dont un non-super_admin n'est pas membre ;
  - déclencheur `organization_members_report_espace_actif` (AFTER DELETE ON organization_members) → reporte l'espace actif ;
  - RPC `public.remplacer_espaces_utilisateur(p_user uuid, p_espaces uuid[], p_actif uuid) returns jsonb` → `{"espaces": [uuid…], "espace_actif": uuid|null}`, exécutable par `service_role` seul. Erreurs : `P0002` utilisateur introuvable, `22023` espace actif hors de la liste (non-super_admin), `23503` espace inexistant.

- [ ] **Step 1: Écrire le test d'intégration (échec attendu)**

`tests/integration/appartenance-espaces.test.ts` :

```ts
/**
 * L'invariant d'appartenance (sql/236), attaqué contre la base locale.
 *
 * Règle : pour un non-super_admin, `profiles.organization_id` (l'espace ACTIF)
 * est toujours un espace dont il est membre (`organization_members`), ou null.
 * Elle vit EN BASE parce que la base est la seule barrière face à un appel
 * PostgREST direct (leçon de sql/234) — une route oubliée ne doit pas pouvoir
 * la violer.
 *
 * Tout est créé jetable (`[ESSAI espaces]`) et supprimé à la fin.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { creerClientTest } from './_client';

const admin = creerClientTest();
const PREFIXE = '[ESSAI espaces]';
const espaces: string[] = [];
const comptes: string[] = [];

async function creerEspace(nom: string): Promise<string> {
  const slug = `essai-espaces-${nom.toLowerCase()}-${Date.now()}`;
  const { data, error } = await admin.from('organizations')
    .insert({ name: `${PREFIXE} ${nom}`, slug }).select('id').single();
  if (error || !data) throw new Error(`espace ${nom} : ${error?.message}`);
  espaces.push(data.id as string);
  return data.id as string;
}

async function creerCompte(cle: string, role: 'client' | 'super_admin' = 'client'): Promise<string> {
  const email = `essai-espaces-${cle}-${Date.now()}@exemple.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`compte ${cle} : ${error?.message}`);
  comptes.push(data.user.id);
  const { error: e2 } = await admin.from('profiles').upsert({ id: data.user.id, email, role, organization_id: null });
  if (e2) throw new Error(`profil ${cle} : ${e2.message}`);
  return data.user.id;
}

async function rendreMembre(userId: string, orgId: string): Promise<void> {
  const { error } = await admin.from('organization_members').insert({ user_id: userId, organization_id: orgId });
  if (error) throw new Error(`membre : ${error.message}`);
}

async function espaceActif(userId: string): Promise<string | null> {
  const { data, error } = await admin.from('profiles').select('organization_id').eq('id', userId).single();
  if (error) throw new Error(error.message);
  return (data?.organization_id as string | null) ?? null;
}

let a: string, b: string;

beforeAll(async () => {
  a = await creerEspace('A');
  b = await creerEspace('B');
}, 60_000);

afterAll(async () => {
  for (const id of comptes) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.error(`nettoyage compte ${id} : ${error.message}`);
  }
  for (const id of espaces) {
    const { error } = await admin.from('organizations').delete().eq('id', id);
    if (error) console.error(`nettoyage espace ${id} : ${error.message}`);
  }
}, 60_000);

describe('invariant : espace actif ⊂ appartenance (sql/236)', () => {
  it('refuse de placer un client sur un espace dont il n\'est pas membre', async () => {
    const u = await creerCompte('refus');
    const { error } = await admin.from('profiles').update({ organization_id: a }).eq('id', u);
    expect(error?.code).toBe('23514');
    expect(await espaceActif(u)).toBeNull();
  });

  it('accepte un espace dont il est membre, et null', async () => {
    const u = await creerCompte('accepte');
    await rendreMembre(u, a);
    expect((await admin.from('profiles').update({ organization_id: a }).eq('id', u)).error).toBeNull();
    expect((await admin.from('profiles').update({ organization_id: null }).eq('id', u)).error).toBeNull();
  });

  it('laisse un super_admin se placer sur n\'importe quel espace', async () => {
    const u = await creerCompte('super', 'super_admin');
    expect((await admin.from('profiles').update({ organization_id: b }).eq('id', u)).error).toBeNull();
  });

  it('refuse de rétrograder en client un super_admin placé hors de ses espaces', async () => {
    const u = await creerCompte('retro', 'super_admin');
    await admin.from('profiles').update({ organization_id: b }).eq('id', u);
    const { error } = await admin.from('profiles').update({ role: 'client' }).eq('id', u);
    expect(error?.code).toBe('23514');
  });
});

describe('report de l\'espace actif au retrait (sql/236)', () => {
  it('retiré de son espace actif, il bascule sur un autre de ses espaces', async () => {
    const u = await creerCompte('report');
    await rendreMembre(u, a);
    await rendreMembre(u, b);
    await admin.from('profiles').update({ organization_id: a }).eq('id', u);
    const { error } = await admin.from('organization_members').delete().eq('user_id', u).eq('organization_id', a);
    expect(error).toBeNull();
    expect(await espaceActif(u)).toBe(b);
  });

  it('retiré de son seul espace, son espace actif devient null', async () => {
    const u = await creerCompte('seul');
    await rendreMembre(u, a);
    await admin.from('profiles').update({ organization_id: a }).eq('id', u);
    await admin.from('organization_members').delete().eq('user_id', u).eq('organization_id', a);
    expect(await espaceActif(u)).toBeNull();
  });

  it('retiré d\'un espace qui n\'est PAS l\'actif, l\'actif ne bouge pas', async () => {
    const u = await creerCompte('autre');
    await rendreMembre(u, a);
    await rendreMembre(u, b);
    await admin.from('profiles').update({ organization_id: a }).eq('id', u);
    await admin.from('organization_members').delete().eq('user_id', u).eq('organization_id', b);
    expect(await espaceActif(u)).toBe(a);
  });
});

describe('suppressions en cascade (sql/236)', () => {
  it('supprimer un compte membre de son espace actif ne lève rien', async () => {
    const u = await creerCompte('cascade-compte');
    await rendreMembre(u, a);
    await admin.from('profiles').update({ organization_id: a }).eq('id', u);
    const { error } = await admin.auth.admin.deleteUser(u);
    expect(error).toBeNull();
    comptes.splice(comptes.indexOf(u), 1);
  });

  it('supprimer un espace où des membres sont actifs ne lève rien', async () => {
    const c = await creerEspace('C');
    const u = await creerCompte('cascade-espace');
    await rendreMembre(u, c);
    await rendreMembre(u, a);
    await admin.from('profiles').update({ organization_id: c }).eq('id', u);
    const { error } = await admin.from('organizations').delete().eq('id', c);
    expect(error).toBeNull();
    espaces.splice(espaces.indexOf(c), 1);
    // ON DELETE SET NULL de profiles ET report par le déclencheur : l'un ou
    // l'autre, jamais un espace dont il n'est plus membre.
    expect([null, a]).toContain(await espaceActif(u));
  });
});

describe('remplacer_espaces_utilisateur (sql/236)', () => {
  it('remplace la liste et l\'espace actif en une fois', async () => {
    const u = await creerCompte('rpc');
    await rendreMembre(u, a);
    await admin.from('profiles').update({ organization_id: a }).eq('id', u);
    const { data, error } = await admin.rpc('remplacer_espaces_utilisateur', { p_user: u, p_espaces: [b], p_actif: b });
    expect(error).toBeNull();
    expect(data).toEqual({ espaces: [b], espace_actif: b });
    expect(await espaceActif(u)).toBe(b);
  });

  it('refuse un espace actif hors de la liste pour un client (22023), sans rien écrire', async () => {
    const u = await creerCompte('rpc-refus');
    await rendreMembre(u, a);
    const { error } = await admin.rpc('remplacer_espaces_utilisateur', { p_user: u, p_espaces: [a], p_actif: b });
    expect(error?.code).toBe('22023');
    const { data } = await admin.from('organization_members').select('organization_id').eq('user_id', u);
    expect((data ?? []).map((m) => m.organization_id)).toEqual([a]);
  });

  it('liste vide : plus aucun espace, actif null', async () => {
    const u = await creerCompte('rpc-vide');
    await rendreMembre(u, a);
    const { data, error } = await admin.rpc('remplacer_espaces_utilisateur', { p_user: u, p_espaces: [], p_actif: null });
    expect(error).toBeNull();
    expect(data).toEqual({ espaces: [], espace_actif: null });
  });

  it('utilisateur inconnu : P0002', async () => {
    const { error } = await admin.rpc('remplacer_espaces_utilisateur', {
      p_user: '00000000-0000-0000-0000-00000000dead', p_espaces: [], p_actif: null,
    });
    expect(error?.code).toBe('P0002');
  });
});

describe('rattrapage (sql/236)', () => {
  it('tout profil non super_admin dont l\'espace actif est posé en est membre', async () => {
    const { data, error } = await admin.from('profiles').select('id, organization_id, role').not('organization_id', 'is', null);
    expect(error).toBeNull();
    for (const p of data ?? []) {
      if (p.role === 'super_admin') continue;
      const { data: m } = await admin.from('organization_members').select('id')
        .eq('user_id', p.id).eq('organization_id', p.organization_id as string);
      expect(m?.length, `profil ${p.id}`).toBe(1);
    }
  });
});
```

- [ ] **Step 2: Lancer le test, constater l'échec**

```bash
npx vitest run --project integration tests/integration/appartenance-espaces.test.ts
```

Expected : FAIL — `refuse de placer…` reçoit `error` null (aucun déclencheur), la RPC est introuvable (`PGRST202`), le rattrapage échoue sur les deux comptes `souraj91`.

- [ ] **Step 3: Écrire la migration**

`sql/236_appartenance_espaces.sql` :

```sql
-- 236 — Appartenance aux espaces de travail, tenue EN BASE (2026-10-09)
--
-- ── DEUX COLONNES, UNE RÈGLE ───────────────────────────────────────────────
--
--   organization_members (user_id, organization_id) — à quels espaces
--     l'utilisateur APPARTIENT : source de vérité de l'appartenance ;
--   profiles.organization_id — dans quel espace il TRAVAILLE en ce moment
--     (l'espace actif), lu par getOrgSourceIds et get_user_org().
--
-- Invariant : pour un non-super_admin, l'espace actif est un espace dont il
-- est membre, ou null (il ne voit alors que le socle).
--
-- ── LE CONSTAT DU 2026-10-08 ───────────────────────────────────────────────
--
-- Aucun code n'écrivait organization_members : « ajouter un membre » ne
-- posait que profiles.organization_id. Les deux comptes clients avaient donc
-- un espace actif sans en être membres ; basculés ailleurs, ils n'auraient
-- plus pu revenir (/api/user/switch-org exige l'appartenance).
--
-- La règle est en base et pas seulement dans les routes : c'est la leçon de
-- sql/234, où la base était la seule barrière face à un appel PostgREST
-- direct. Verrouillé par tests/integration/appartenance-espaces.test.ts.

begin;

-- ── 1. Rattrapage ──────────────────────────────────────────────────────────
insert into public.organization_members (user_id, organization_id)
select p.id, p.organization_id
  from public.profiles p
 where p.organization_id is not null
on conflict (user_id, organization_id) do nothing;

-- ── 2. L'espace actif d'un non-super_admin est un de ses espaces ───────────
create or replace function public.verifier_espace_actif()
returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
begin
  if new.organization_id is null or new.role = 'super_admin' then
    return new;
  end if;
  if exists (select 1 from organization_members m
              where m.user_id = new.id and m.organization_id = new.organization_id) then
    return new;
  end if;
  raise exception 'Espace actif refusé : l''utilisateur % n''est pas membre de l''espace %.',
    new.id, new.organization_id
    using errcode = '23514';
end
$fn$;

drop trigger if exists profiles_espace_actif_membre on public.profiles;
create trigger profiles_espace_actif_membre
  before insert or update of organization_id, role on public.profiles
  for each row execute function public.verifier_espace_actif();

-- ── 3. Retirer quelqu'un de son espace actif le reporte ailleurs ───────────
-- Sur un autre de ses espaces (le plus ancien), ou null. Un super_admin n'est
-- pas lié à ses appartenances : son espace actif n'est pas touché.
create or replace function public.reporter_espace_actif()
returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
begin
  update profiles p
     set organization_id = (
       select m.organization_id from organization_members m
        where m.user_id = old.user_id
        order by m.joined_at asc nulls last, m.organization_id
        limit 1)
   where p.id = old.user_id
     and p.organization_id = old.organization_id
     and p.role <> 'super_admin';
  return old;
end
$fn$;

drop trigger if exists organization_members_report_espace_actif on public.organization_members;
create trigger organization_members_report_espace_actif
  after delete on public.organization_members
  for each row execute function public.reporter_espace_actif();

-- ── 4. Remplacer les espaces d'un utilisateur, atomiquement ────────────────
-- La fiche utilisateur coche plusieurs cases en une fois. Ordre voulu :
-- ajouter, placer l'espace actif, PUIS retirer — à aucun moment l'invariant
-- n'est violé, et le déclencheur de report n'a rien à reporter.
create or replace function public.remplacer_espaces_utilisateur(
  p_user uuid, p_espaces uuid[], p_actif uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_role text;
  v_espaces uuid[] := coalesce(p_espaces, '{}');
begin
  select role into v_role from profiles where id = p_user;
  if v_role is null then
    raise exception 'Utilisateur % introuvable.', p_user using errcode = 'P0002';
  end if;
  if p_actif is not null and v_role <> 'super_admin' and not (p_actif = any (v_espaces)) then
    raise exception 'L''espace actif doit faire partie des espaces de l''utilisateur.'
      using errcode = '22023';
  end if;

  insert into organization_members (user_id, organization_id)
  select p_user, e from unnest(v_espaces) as e
  on conflict (user_id, organization_id) do nothing;

  update profiles set organization_id = p_actif where id = p_user;

  delete from organization_members
   where user_id = p_user and not (organization_id = any (v_espaces));

  return jsonb_build_object(
    'espaces', (select coalesce(jsonb_agg(organization_id order by organization_id), '[]'::jsonb)
                  from organization_members where user_id = p_user),
    'espace_actif', (select organization_id from profiles where id = p_user));
end
$fn$;

revoke all on function public.remplacer_espaces_utilisateur(uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.remplacer_espaces_utilisateur(uuid, uuid[], uuid) to service_role;
revoke all on function public.verifier_espace_actif() from public, anon, authenticated;
revoke all on function public.reporter_espace_actif() from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
```

⚠ L'ordre `jsonb_agg(… order by organization_id)` rend `espaces` trié par uuid : le test « remplace la liste » n'a qu'un élément, mais tout appelant qui compare des listes doit trier.

- [ ] **Step 4: Appliquer en local**

```bash
MSYS_NO_PATHCONV=1 docker exec -i supabase_db_genesis_app psql -U postgres -v ON_ERROR_STOP=1 < sql/236_appartenance_espaces.sql
MSYS_NO_PATHCONV=1 docker exec supabase_db_genesis_app psql -U postgres -At -c "select count(*) from organization_members;"
```

Expected : `COMMIT`, puis `10` (8 + les 2 clients rattrapés).

- [ ] **Step 5: Relancer le test**

```bash
npx vitest run --project integration tests/integration/appartenance-espaces.test.ts
```

Expected : PASS (13 tests). Si « supprimer un compte… » lève `tuple to be deleted was already modified by an operation triggered by the current command`, le déclencheur de report entre en conflit avec la cascade de `auth.users` → `profiles` : ajouter en tête de `reporter_espace_actif()` `if not exists (select 1 from auth.users where id = old.user_id) then return old; end if;` (le compte est en cours de suppression, rien à reporter), réappliquer, relancer, et le noter dans le commentaire de la fonction.

- [ ] **Step 6: Vérifier que les tests existants tiennent**

```bash
npm run test:integration
```

Expected : vert, sauf le défaut PRÉEXISTANT connu du test zone-risque (41 025 366 attendus contre 42 409 940, mémoire `project_cloisonnement_organisations`), à citer tel quel s'il apparaît. `cloisonnement-rls.test.ts` crée ses comptes par `profiles.upsert` AVEC `organization_id` : s'il échoue sur `23514`, ajouter dans son `creerCompte` l'insertion `organization_members` AVANT l'upsert du profil (même forme que `rendreMembre` ci-dessus) — c'est le nouvel invariant, pas une régression.

- [ ] **Step 7: Documenter et committer**

Dans `ARCHITECTURE.md`, à la suite du paragraphe sql/234 : les deux colonnes, l'invariant, les deux déclencheurs, la RPC, et le constat « aucun code n'écrivait organization_members ».

```bash
git add sql/236_appartenance_espaces.sql tests/integration/appartenance-espaces.test.ts ARCHITECTURE.md
git add tests/integration/cloisonnement-rls.test.ts   # seulement si modifié au Step 6
git commit -m "feat(base): appartenance aux espaces tenue en base (sql/236)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Les routes existantes écrivent l'appartenance

**Files:**
- Create: `lib/espaces/appartenance.ts`
- Modify: `app/api/admin/organizations/[id]/members/route.ts` (POST, PATCH, DELETE)
- Modify: `app/api/admin/users/route.ts` (POST)
- Modify: `app/api/admin/users/[id]/route.ts` (PATCH : erreur 23514 lisible)
- Modify: `app/api/admin/organizations/route.ts` (GET : `member_count` par `organization_members`)
- Modify: `tests/integration/appartenance-espaces.test.ts` (nouveau `describe`)
- Modify: `ARCHITECTURE.md` (sections de ces quatre routes)

**Interfaces:**
- Consumes : sql/236 (T1).
- Produces (`lib/espaces/appartenance.ts`) :

```ts
type Sb = ReturnType<typeof createAdminClient>;
export type ResultatEcriture = { ok: true } | { ok: false; status: number; message: string };
export async function ajouterMembre(sb: Sb, orgId: string, userId: string, role?: 'client' | 'super_admin' | 'admin'): Promise<ResultatEcriture>;
export async function retirerMembre(sb: Sb, orgId: string, userId: string): Promise<ResultatEcriture>;
export function messageErreurAppartenance(code: string | undefined, message: string): { status: number; message: string };
```

- [ ] **Step 1: Ajouter les tests d'intégration (échec)**

À la fin de `tests/integration/appartenance-espaces.test.ts` :

```ts
import { ajouterMembre, retirerMembre } from '@/lib/espaces/appartenance';

describe('ajouterMembre / retirerMembre (T2)', () => {
  it('ajouter écrit organization_members et place l\'espace actif s\'il était vide', async () => {
    const u = await creerCompte('ajout');
    expect(await ajouterMembre(admin as never, a, u)).toEqual({ ok: true });
    const { data } = await admin.from('organization_members').select('organization_id').eq('user_id', u);
    expect((data ?? []).map((m) => m.organization_id)).toEqual([a]);
    expect(await espaceActif(u)).toBe(a);
  });

  it('ajouter un second espace ne change pas l\'espace actif', async () => {
    const u = await creerCompte('ajout2');
    await ajouterMembre(admin as never, a, u);
    await ajouterMembre(admin as never, b, u);
    expect(await espaceActif(u)).toBe(a);
  });

  it('ajouter deux fois est sans effet (pas d\'erreur, pas de doublon)', async () => {
    const u = await creerCompte('ajout-double');
    await ajouterMembre(admin as never, a, u);
    expect(await ajouterMembre(admin as never, a, u)).toEqual({ ok: true });
    const { data } = await admin.from('organization_members').select('id').eq('user_id', u);
    expect(data?.length).toBe(1);
  });

  it('ajouter un super_admin sans rôle fourni le laisse super_admin (E3)', async () => {
    const u = await creerCompte('ajout-super', 'super_admin');
    await ajouterMembre(admin as never, a, u);
    const { data } = await admin.from('profiles').select('role').eq('id', u).single();
    expect(data?.role).toBe('super_admin');
  });

  it('retirer supprime l\'appartenance, reporte l\'actif, et ne touche pas au rôle (E3)', async () => {
    const u = await creerCompte('retrait', 'super_admin');
    await ajouterMembre(admin as never, a, u);
    expect(await retirerMembre(admin as never, a, u)).toEqual({ ok: true });
    const { data } = await admin.from('profiles').select('role').eq('id', u).single();
    expect(data?.role).toBe('super_admin');
    const { data: m } = await admin.from('organization_members').select('id').eq('user_id', u).eq('organization_id', a);
    expect(m?.length).toBe(0);
  });

  it('retirer quelqu\'un qui n\'est pas membre rend 404', async () => {
    const u = await creerCompte('retrait-absent');
    expect(await retirerMembre(admin as never, a, u)).toEqual({ ok: false, status: 404, message: 'Cet utilisateur n\'est pas membre de cet espace.' });
  });
});
```

Run : `npx vitest run --project integration tests/integration/appartenance-espaces.test.ts` → FAIL (`Cannot find module '@/lib/espaces/appartenance'`).

- [ ] **Step 2: Écrire `lib/espaces/appartenance.ts`**

```ts
/**
 * lib/espaces/appartenance.ts
 * Écrire l'appartenance d'un utilisateur à un espace de travail.
 *
 * `organization_members` est la source de vérité de l'appartenance ;
 * `profiles.organization_id` n'est que l'espace ACTIF. sql/236 tient
 * l'invariant en base (l'actif d'un non-super_admin est un de ses espaces) et
 * reporte l'actif quand on retire quelqu'un : ce module n'a donc PAS à le
 * recalculer — il écrit l'appartenance, et pose l'actif seulement s'il était vide.
 *
 * Jusqu'au 2026-10-09, « ajouter un membre » n'écrivait QUE l'actif : aucun
 * code n'écrivait organization_members.
 */
import type { createAdminClient } from '@/lib/auth';
import type { UserRole } from '@/types/admin';

type Sb = ReturnType<typeof createAdminClient>;

export type ResultatEcriture = { ok: true } | { ok: false; status: number; message: string };

/**
 * Traduit une erreur de base en réponse lisible. Les deux codes que sql/236
 * lève exprès ont un message français ; le reste remonte tel quel en 500.
 */
export function messageErreurAppartenance(code: string | undefined, message: string): { status: number; message: string } {
  if (code === '23514') return { status: 400, message: 'Cet utilisateur n\'est pas membre de cet espace.' };
  if (code === '22023') return { status: 400, message: 'L\'espace actif doit faire partie des espaces de l\'utilisateur.' };
  if (code === '23503') return { status: 400, message: 'Espace introuvable.' };
  if (code === 'P0002') return { status: 404, message: 'Utilisateur introuvable.' };
  return { status: 500, message };
}

/**
 * Rend `userId` membre de `orgId`. Idempotent. Pose l'espace actif s'il était
 * vide ; n'écrit le rôle que s'il est FOURNI — ajouter un super_admin à un
 * espace ne doit pas le rétrograder (E3).
 */
export async function ajouterMembre(sb: Sb, orgId: string, userId: string, role?: UserRole): Promise<ResultatEcriture> {
  const { error: errMembre } = await sb
    .from('organization_members')
    .upsert({ user_id: userId, organization_id: orgId }, { onConflict: 'user_id,organization_id', ignoreDuplicates: true })
    .select('id');
  if (errMembre) return { ok: false, ...messageErreurAppartenance(errMembre.code, errMembre.message) };

  const { data: profil, error: errLecture } = await sb.from('profiles').select('organization_id').eq('id', userId).single();
  if (errLecture || !profil) return { ok: false, status: 404, message: 'Utilisateur introuvable.' };

  const maj: { organization_id?: string; role?: UserRole } = {};
  if (profil.organization_id === null) maj.organization_id = orgId;
  if (role !== undefined) maj.role = role;
  if (Object.keys(maj).length === 0) return { ok: true };

  const { error } = await sb.from('profiles').update(maj).eq('id', userId);
  if (error) return { ok: false, ...messageErreurAppartenance(error.code, error.message) };
  return { ok: true };
}

/**
 * Retire `userId` de `orgId`. Le report de l'espace actif est fait par sql/236.
 * Ne touche pas au rôle (E3).
 */
export async function retirerMembre(sb: Sb, orgId: string, userId: string): Promise<ResultatEcriture> {
  const { error, count } = await sb
    .from('organization_members')
    .delete({ count: 'exact' })
    .eq('user_id', userId)
    .eq('organization_id', orgId);
  if (error) return { ok: false, ...messageErreurAppartenance(error.code, error.message) };
  if (!count) return { ok: false, status: 404, message: 'Cet utilisateur n\'est pas membre de cet espace.' };
  return { ok: true };
}
```

- [ ] **Step 3: Brancher `…/members/route.ts`**

- `InviterMembreSchema` : `role: RoleMembreSchema.optional()` (sans `.default('client')`), et commentaire « E3 : sans rôle, on ne le touche pas ». React envoie toujours un rôle : son comportement est inchangé.
- POST : après la recherche du profil par email (inchangée, message 404 conservé mot pour mot), remplacer l'`update` de `profiles` par :

```ts
  const res = await ajouterMembre(sb, orgId, existing.id, role);
  if (!res.ok) return NextResponse.json({ success: false, error: res.message }, { status: res.status });
  return NextResponse.json({ success: true });
```

- PATCH (rôle) : remplacer `.eq('organization_id', orgId)` par une vérification d'appartenance (le filtre sur l'espace ACTIF refusait en silence un membre actif ailleurs) :

```ts
  const { data: membre, error: errMembre } = await sb.from('organization_members')
    .select('id').eq('user_id', userId).eq('organization_id', orgId).maybeSingle();
  if (errMembre) return NextResponse.json({ success: false, error: errMembre.message }, { status: 500 });
  if (!membre) return NextResponse.json({ success: false, error: 'Cet utilisateur n\'est pas membre de cet espace.' }, { status: 404 });
  const { error } = await sb.from('profiles').update({ role }).eq('id', userId);
```

- DELETE : remplacer l'`update` par `retirerMembre(sb, orgId, userId)` et rendre `res.status` / `res.message` en cas d'échec.
- Mettre à jour l'en-tête du fichier : « l'appartenance s'écrit dans organization_members (sql/236) ».

- [ ] **Step 4: Brancher `POST /api/admin/users`**

Après `createUser` réussi, REMPLACER le bloc « Update profile with role + org » (dont l'erreur était journalisée puis ignorée — le 201 annonçait un compte au rôle par défaut) par :

```ts
  const nouvelId = authUser.user.id;
  const { error: profErr } = await supabase.from('profiles')
    .update({ role, full_name: full_name || null }).eq('id', nouvelId);
  const ajout = !profErr && organization_id
    ? await ajouterMembre(supabase, organization_id, nouvelId)
    : { ok: true as const };
  if (profErr || !ajout.ok) {
    // Pas de compte à moitié créé : on le retire, et on dit pourquoi.
    const { error: errSuppr } = await supabase.auth.admin.deleteUser(nouvelId);
    if (errSuppr) console.error('[admin/users POST] compte orphelin', nouvelId, errSuppr.message);
    const message = profErr ? profErr.message : (ajout as { message: string }).message;
    return NextResponse.json({ error: message }, { status: 500 });
  }
```

Le reste (génération du lien, réponse 201) est inchangé. ⚠ Ne jamais journaliser `setup_link`.

- [ ] **Step 5: `PATCH /api/admin/users/[id]` — refus lisible**

Remplacer `if (error) return NextResponse.json({ error: error.message }, { status: 500 });` par :

```ts
  if (error) {
    const e = messageErreurAppartenance(error.code, error.message);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
```

- [ ] **Step 6: `GET /api/admin/organizations` — compter les membres là où ils sont**

Dans le `Promise.all`, remplacer `supabase.from('profiles').select('organization_id').in('organization_id', orgIds)` par `supabase.from('organization_members').select('organization_id').in('organization_id', orgIds)`. Commentaire : « une ligne par appartenance ; bornée par (comptes × espaces), quelques dizaines — sous le plafond serveur de 1 000 lignes ». La boucle de comptage est inchangée.

- [ ] **Step 7: Tests verts**

```bash
npx vitest run --project integration tests/integration/appartenance-espaces.test.ts
npx tsc --noEmit; echo "tsc=$?"
npm run test:unit
```

Expected : PASS, `tsc=0`, unitaires verts (`validation-corps.test.ts` et `suppressions-sans-garde.test.ts` compris : le `delete` de `retirerMembre` lit son erreur).

- [ ] **Step 8: Documenter et committer**

`ARCHITECTURE.md` : pour `…/members` (POST : rôle optionnel, écrit l'appartenance ; DELETE : supprime l'appartenance, ne touche plus au rôle), `POST /api/admin/users` (appartenance, compte retiré si l'écriture échoue), `GET /api/admin/organizations` (`member_count` = appartenances).

```bash
git add lib/espaces/appartenance.ts "app/api/admin/organizations/[id]/members/route.ts" app/api/admin/users/route.ts "app/api/admin/users/[id]/route.ts" app/api/admin/organizations/route.ts tests/integration/appartenance-espaces.test.ts ARCHITECTURE.md
git commit -m "fix(admin): ajouter ou retirer un membre écrit organization_members

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Lectures de la page — espaces, données d'un espace, aperçu

**Files:**
- Create: `lib/espaces/types.ts`, `lib/espaces/nom-espace.ts`, `lib/espaces/lister-espaces.ts`, `lib/espaces/donnees-espace.ts`, `lib/espaces/apercu-espace.ts`
- Create: `app/api/admin/espaces/route.ts`, `app/api/admin/espaces/socle/route.ts`, `app/api/admin/espaces/[id]/donnees/route.ts`, `app/api/admin/espaces/[id]/membres/route.ts`, `app/api/admin/espaces/[id]/apercu/route.ts`
- Create: `tests/unit/espaces/nom-espace.test.ts`, `tests/unit/espaces/statut-jeu.test.ts`, `tests/integration/espaces-lectures.test.ts`, `tests/integration/espaces-apercu.test.ts`
- Modify: `ARCHITECTURE.md` (inventaire des routes admin)

**Interfaces:**
- Consumes : `getOrgSourceIds` (`lib/auth/getOrgSourceIds.ts`), `getCategoriesVisibles` (`lib/poi/categories.ts`), `requireAdmin`, `adminUnauthorized` (`lib/api/middleware.ts`).
- Produces (`lib/espaces/types.ts`, recopié à l'identique côté Angular en T5) :

```ts
/**
 * lib/espaces/types.ts
 * Formes des réponses de la page « Espaces de travail ». Copiées dans
 * angular/src/app/features/admin/espaces/logique/types.ts, parité par
 * assignabilité mutuelle : tests/unit/angular/espaces-types-paritaires.test.ts.
 */
export type TypeJeu = 'poi' | 'panneaux' | 'carreaux';
export type Visibilite = 'socle' | 'privee';
/** Statut d'un jeu POUR un espace donné (spec § 4.4), dans l'ordre de tri. */
export type StatutJeu = 'proprietaire' | 'partage' | 'socle' | 'non_visible';
export type RoleEspace = 'super_admin' | 'admin' | 'client';

export interface EspaceResume {
  id: string;
  nom: string;            // organizations.name, tel qu'en base
  nom_affiche: string;    // E2 : « dentsu.explore (interne) » pour genesis-global
  slug: string;
  actif: boolean;
  interne: boolean;       // slug === 'genesis-global'
  nb_membres: number;     // appartenances (organization_members)
  nb_jeux_prives: number; // sources privées possédées, non supprimées
}

export interface ReponseEspaces {
  socle: { nb_jeux: number };
  espaces: EspaceResume[];   // tri : nom_affiche, internes en dernier
}

export interface ProprietaireJeu { id: string; nom_affiche: string }

export interface JeuDeDonnees {
  id: string;
  nom: string;
  type: TypeJeu;
  categorie: string | null;
  nb_lignes: number;         // data_sources.valid_count (jamais un COUNT)
  visibilite: Visibilite;
  proprietaire: ProprietaireJeu | null;
  partage_avec: ProprietaireJeu[];
}

export interface JeuPourEspace extends JeuDeDonnees { statut: StatutJeu }

export interface ReponseDonneesEspace {
  espace: EspaceResume;
  jeux: JeuPourEspace[];     // tri : statut (ordre de StatutJeu), puis nom
}

/** « Socle » : tous les jeux, sans statut (fiche Socle, spec § 4.2). */
export interface ReponseSocle {
  jeux: JeuDeDonnees[];      // tri : socle d'abord, puis nom
  nb_espaces_clients: number; // espaces non internes : « combien le perdent »
}

export interface MembreEspace {
  id: string;
  email: string;
  nom: string | null;
  role: RoleEspace;
  espace_actif: string | null;
  autres_espaces: ProprietaireJeu[]; // ses AUTRES espaces (pastilles)
}

export interface ApercuEspace {
  jeux: { socle: JeuDeDonnees[]; proprietaire: JeuDeDonnees[]; partage: JeuDeDonnees[] };
  categories: string[];      // catégories POI visibles, SANS effectif (E4)
  nb_campagnes: number;
}
```

- `nomAffiche(org: { name: string; slug: string }): string`, `SLUG_ORGANISATION_INTERNE = 'genesis-global'`.
- `statutPourEspace(jeu: Pick<JeuDeDonnees, 'visibilite'> & { organization_id: string | null; shared_with: string[] }, orgId: string): StatutJeu` (pur).
- `listerEspaces(sb): Promise<ReponseEspaces>`, `lireSocle(sb): Promise<ReponseSocle>`, `donneesDeLEspace(sb, orgId): Promise<ReponseDonneesEspace | null>` (null = espace inconnu), `membresDeLEspace(sb, orgId): Promise<MembreEspace[]>`, `apercuEspace(sb, orgId): Promise<ApercuEspace>`.
- Routes : `GET /api/admin/espaces` → `ReponseEspaces` ; `GET /api/admin/espaces/socle` → `ReponseSocle` (segment fixe, déclaré AVANT `[id]` : Next résout le segment statique en premier) ; `GET /api/admin/espaces/[id]/donnees` → `ReponseDonneesEspace` ; `GET /api/admin/espaces/[id]/membres` → `{ membres: MembreEspace[] }` ; `GET /api/admin/espaces/[id]/apercu` → `ApercuEspace`. Toutes : 403 non super_admin (`adminUnauthorized`), 400 id non UUID, 404 espace inconnu.

> Les routes `socle` et `[id]/membres` ne figurent pas dans le tableau § 5.2 de la spec : elles évitent de recalculer côté écran ce que le serveur sait (le nombre d'espaces qui perdent un jeu ; les autres espaces de chaque membre), et la spec le demande au même titre pour le statut (« le statut se calcule côté serveur, avec la règle, pas dans l'écran »). Les ajouter au § 5.2 de la spec dans le commit.

- [ ] **Step 1: Tests unitaires (échec)**

`tests/unit/espaces/nom-espace.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { nomAffiche } from '@/lib/espaces/nom-espace';

describe('nomAffiche (E2)', () => {
  it('renomme l\'organisation interne à l\'affichage seulement', () => {
    expect(nomAffiche({ name: 'GENESIS (Global)', slug: 'genesis-global' })).toBe('dentsu.explore (interne)');
  });
  it('laisse les autres noms tels quels', () => {
    expect(nomAffiche({ name: 'MARINE', slug: 'marine' })).toBe('MARINE');
  });
});
```

`tests/unit/espaces/statut-jeu.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { statutPourEspace } from '@/lib/espaces/donnees-espace';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

describe('statutPourEspace (spec § 4.4)', () => {
  it('privé de cet espace → propriétaire', () => {
    expect(statutPourEspace({ visibilite: 'privee', organization_id: A, shared_with: [] }, A)).toBe('proprietaire');
  });
  it('privé d\'un autre, partagé avec celui-ci → partagé', () => {
    expect(statutPourEspace({ visibilite: 'privee', organization_id: B, shared_with: [A] }, A)).toBe('partage');
  });
  it('privé d\'un autre, non partagé → non visible', () => {
    expect(statutPourEspace({ visibilite: 'privee', organization_id: B, shared_with: [] }, A)).toBe('non_visible');
  });
  it('socle → socle, même pour son propriétaire (le socle prime : on le règle dans la fiche Socle)', () => {
    expect(statutPourEspace({ visibilite: 'socle', organization_id: A, shared_with: [] }, A)).toBe('socle');
    expect(statutPourEspace({ visibilite: 'socle', organization_id: B, shared_with: [] }, A)).toBe('socle');
  });
  it('privé sans propriétaire → non visible (fermé par défaut)', () => {
    expect(statutPourEspace({ visibilite: 'privee', organization_id: null, shared_with: [] }, A)).toBe('non_visible');
  });
});
```

Run : `npx vitest run --project unit tests/unit/espaces` → FAIL (modules absents).

- [ ] **Step 2: `nom-espace.ts` et `types.ts`**

`lib/espaces/types.ts` : le bloc de l'en-tête « Interfaces » ci-dessus, tel quel.

`lib/espaces/nom-espace.ts` :

```ts
/**
 * lib/espaces/nom-espace.ts
 * Le nom d'un espace tel qu'on l'AFFICHE.
 *
 * « GENESIS (Global) » est l'organisation qui possède les données de
 * dentsu.explore. Renommée à l'affichage seulement (décision Q1 du
 * 2026-10-08) : la base garde son nom et son slug, que des scripts et la démo
 * (lib/demo/constants.ts) lisent. Un seul endroit pour cette règle — l'écran
 * ne la réécrit pas, il lit `nom_affiche`.
 */
export const SLUG_ORGANISATION_INTERNE = 'genesis-global';

export function nomAffiche(org: { name: string; slug: string }): string {
  return org.slug === SLUG_ORGANISATION_INTERNE ? 'dentsu.explore (interne)' : org.name;
}
```

- [ ] **Step 3: `donnees-espace.ts`**

```ts
/**
 * lib/espaces/donnees-espace.ts
 * Les jeux de données, et le statut de chacun POUR un espace (spec § 4.4).
 *
 * `statutPourEspace` est la condition de `getOrgSourceIds` (et de sa jumelle
 * SQL `source_visible`, sql/234) relue jeu par jeu : un jeu est visible de
 * l'espace SI ET SEULEMENT SI son statut n'est pas `non_visible`.
 * tests/integration/espaces-lectures.test.ts vérifie cette équivalence
 * contre `getOrgSourceIds` pour chaque espace de la base : si les deux
 * divergeaient, l'écran mentirait sur les droits.
 *
 * Lectures bornées par construction : sources, organisations et appartenances
 * se comptent en dizaines (5 sources, 4 espaces le 2026-10-09), loin du
 * plafond serveur de 1 000 lignes. Aucune RPC tabulaire : pas de troncature
 * PostgREST possible.
 */
import type { createAdminClient } from '@/lib/auth';
import { nomAffiche } from './nom-espace';
import type {
  JeuDeDonnees, JeuPourEspace, ProprietaireJeu, ReponseDonneesEspace, ReponseSocle, StatutJeu, TypeJeu, Visibilite,
} from './types';
import { resumerEspace, lireEspacesBruts } from './lister-espaces';

type Sb = ReturnType<typeof createAdminClient>;

const ORDRE: Record<StatutJeu, number> = { proprietaire: 0, partage: 1, socle: 2, non_visible: 3 };

export function statutPourEspace(
  jeu: { visibilite: Visibilite; organization_id: string | null; shared_with: string[] },
  orgId: string,
): StatutJeu {
  if (jeu.visibilite === 'socle') return 'socle';
  if (jeu.organization_id === orgId) return 'proprietaire';
  if (jeu.shared_with.includes(orgId)) return 'partage';
  return 'non_visible';
}

interface SourceBrute {
  id: string; name: string; type: string; category: string | null; valid_count: number | null;
  visibilite: string; organization_id: string | null; shared_with: string[] | null;
}

/** Toutes les sources non supprimées, avec leur propriétaire et leurs partages nommés. */
export async function lireJeux(sb: Sb): Promise<Array<JeuDeDonnees & { organization_id: string | null; shared_with: string[] }>> {
  const [{ data: sources, error }, espaces] = await Promise.all([
    sb.from('data_sources')
      .select('id, name, type, category, valid_count, visibilite, organization_id, shared_with')
      .neq('status', 'deleted')
      .order('name'),
    lireEspacesBruts(sb),
  ]);
  if (error) throw new Error(`lecture des sources : ${error.message}`);
  const nommer = (id: string): ProprietaireJeu => {
    const o = espaces.find((e) => e.id === id);
    return { id, nom_affiche: o ? nomAffiche(o) : 'Espace supprimé' };
  };
  return ((sources ?? []) as SourceBrute[]).map((s) => ({
    id: s.id,
    nom: s.name,
    type: s.type as TypeJeu,
    categorie: s.category,
    nb_lignes: s.valid_count ?? 0,
    visibilite: (s.visibilite === 'socle' ? 'socle' : 'privee') as Visibilite,
    proprietaire: s.organization_id ? nommer(s.organization_id) : null,
    partage_avec: (s.shared_with ?? []).map(nommer),
    organization_id: s.organization_id,
    shared_with: s.shared_with ?? [],
  }));
}

function sansCles<T extends { organization_id: unknown; shared_with: unknown }>(j: T): Omit<T, 'organization_id' | 'shared_with'> {
  const { organization_id: _o, shared_with: _s, ...reste } = j;
  return reste;
}

export async function donneesDeLEspace(sb: Sb, orgId: string): Promise<ReponseDonneesEspace | null> {
  const espace = await resumerEspace(sb, orgId);
  if (!espace) return null;
  const jeux: JeuPourEspace[] = (await lireJeux(sb))
    .map((j) => ({ ...sansCles(j), statut: statutPourEspace(j, orgId) }))
    .sort((x, y) => ORDRE[x.statut] - ORDRE[y.statut] || x.nom.localeCompare(y.nom, 'fr'));
  return { espace, jeux };
}

export async function lireSocle(sb: Sb): Promise<ReponseSocle> {
  const [jeux, espaces] = await Promise.all([lireJeux(sb), lireEspacesBruts(sb)]);
  return {
    jeux: jeux.map(sansCles).sort((x, y) =>
      (x.visibilite === 'socle' ? 0 : 1) - (y.visibilite === 'socle' ? 0 : 1) || x.nom.localeCompare(y.nom, 'fr')),
    nb_espaces_clients: espaces.filter((e) => !e.interne).length,
  };
}
```

⚠ Pas plus de 3 requêtes simultanées : `lireJeux` en lance 2 en parallèle ; `lireSocle` appelle `lireJeux` et `lireEspacesBruts` en parallèle, soit 3 au total. Ne pas ajouter de lecture dans ce `Promise.all`.

- [ ] **Step 4: `lister-espaces.ts`**

```ts
/**
 * lib/espaces/lister-espaces.ts
 * La colonne des espaces : chaque espace avec ses compteurs, et l'entrée Socle.
 *
 * Trois lectures, quel que soit le nombre d'espaces (organisations,
 * appartenances, sources). Bornées par construction : quelques dizaines de
 * lignes chacune, sous le plafond serveur de 1 000.
 */
import type { createAdminClient } from '@/lib/auth';
import { nomAffiche, SLUG_ORGANISATION_INTERNE } from './nom-espace';
import type { EspaceResume, MembreEspace, ReponseEspaces, RoleEspace } from './types';

type Sb = ReturnType<typeof createAdminClient>;

interface EspaceBrut { id: string; name: string; slug: string; active: boolean; interne: boolean }

export async function lireEspacesBruts(sb: Sb): Promise<EspaceBrut[]> {
  const { data, error } = await sb.from('organizations').select('id, name, slug, active');
  if (error) throw new Error(`lecture des espaces : ${error.message}`);
  return (data ?? []).map((o) => ({ ...o, interne: o.slug === SLUG_ORGANISATION_INTERNE }));
}

function trier(a: EspaceResume, b: EspaceResume): number {
  return Number(a.interne) - Number(b.interne) || a.nom_affiche.localeCompare(b.nom_affiche, 'fr');
}

export async function listerEspaces(sb: Sb): Promise<ReponseEspaces> {
  const [espaces, membres, sources] = await Promise.all([
    lireEspacesBruts(sb),
    sb.from('organization_members').select('organization_id'),
    sb.from('data_sources').select('organization_id, visibilite').neq('status', 'deleted'),
  ]);
  if (membres.error) throw new Error(`lecture des membres : ${membres.error.message}`);
  if (sources.error) throw new Error(`lecture des sources : ${sources.error.message}`);

  const nbMembres = new Map<string, number>();
  for (const m of membres.data ?? []) nbMembres.set(m.organization_id, (nbMembres.get(m.organization_id) ?? 0) + 1);
  const nbPrives = new Map<string, number>();
  let nbSocle = 0;
  for (const s of sources.data ?? []) {
    if (s.visibilite === 'socle') { nbSocle++; continue; }
    if (s.organization_id) nbPrives.set(s.organization_id, (nbPrives.get(s.organization_id) ?? 0) + 1);
  }

  return {
    socle: { nb_jeux: nbSocle },
    espaces: espaces.map((e): EspaceResume => ({
      id: e.id, nom: e.name, nom_affiche: nomAffiche(e), slug: e.slug, actif: e.active, interne: e.interne,
      nb_membres: nbMembres.get(e.id) ?? 0, nb_jeux_prives: nbPrives.get(e.id) ?? 0,
    })).sort(trier),
  };
}

/** Un espace seul, avec ses compteurs ; `null` s'il n'existe pas. */
export async function resumerEspace(sb: Sb, orgId: string): Promise<EspaceResume | null> {
  const { espaces } = await listerEspaces(sb);
  return espaces.find((e) => e.id === orgId) ?? null;
}

/** Les membres d'un espace, avec leurs AUTRES espaces (spec § 4.3). */
export async function membresDeLEspace(sb: Sb, orgId: string): Promise<MembreEspace[]> {
  const [espaces, appartenances] = await Promise.all([
    lireEspacesBruts(sb),
    sb.from('organization_members').select('user_id, organization_id'),
  ]);
  if (appartenances.error) throw new Error(`lecture des membres : ${appartenances.error.message}`);
  const ids = (appartenances.data ?? []).filter((m) => m.organization_id === orgId).map((m) => m.user_id);
  if (ids.length === 0) return [];
  const { data: profils, error } = await sb.from('profiles')
    .select('id, email, full_name, role, organization_id').in('id', ids);
  if (error) throw new Error(`lecture des profils : ${error.message}`);
  const nom = (id: string) => {
    const e = espaces.find((x) => x.id === id);
    return { id, nom_affiche: e ? nomAffiche(e) : 'Espace supprimé' };
  };
  return (profils ?? []).map((p): MembreEspace => ({
    id: p.id, email: p.email, nom: p.full_name, role: p.role as RoleEspace, espace_actif: p.organization_id,
    autres_espaces: (appartenances.data ?? [])
      .filter((m) => m.user_id === p.id && m.organization_id !== orgId)
      .map((m) => nom(m.organization_id)),
  })).sort((a, b) => a.email.localeCompare(b.email, 'fr'));
}
```

- [ ] **Step 5: `apercu-espace.ts`**

```ts
/**
 * lib/espaces/apercu-espace.ts
 * « Ce que voit cet espace » (spec § 4.5).
 *
 * L'aperçu APPELLE la règle des routes — `getOrgSourceIds` sur une session
 * simulée d'un client de cet espace, puis `getCategoriesVisibles` — il ne la
 * recopie pas. S'il la recopiait et qu'elles divergeaient, il mentirait.
 * tests/integration/espaces-apercu.test.ts le confronte à la règle SQL
 * (`source_visible`, sql/234) lue par un VRAI compte client via PostgREST.
 *
 * E4 : pas d'effectif par catégorie (ce serait un COUNT sur poi_france,
 * 390 000 lignes) ; pas de zones ni de jeux de zones (rattachés à un
 * utilisateur, pas à un espace — aucune règle de route ne les compte par
 * espace).
 */
import type { createAdminClient } from '@/lib/auth';
import { getOrgSourceIds } from '@/lib/auth/getOrgSourceIds';
import { getCategoriesVisibles } from '@/lib/poi/categories';
import { lireJeux, statutPourEspace } from './donnees-espace';
import type { ApercuEspace } from './types';

type Sb = ReturnType<typeof createAdminClient>;

/** Identifiant fictif de la session simulée — jamais écrit, jamais lu en base. */
const UTILISATEUR_APERCU = 'apercu-espace';

export async function apercuEspace(sb: Sb, orgId: string): Promise<ApercuEspace> {
  const sources = await getOrgSourceIds({ userId: UTILISATEUR_APERCU, orgId, role: 'client' });
  // `null` est réservé au super_admin : impossible ici, le rôle simulé est `client`.
  const visibles = new Set(sources ?? []);
  const jeux = (await lireJeux(sb)).filter((j) => visibles.has(j.id));
  const categories = await getCategoriesVisibles(sources ?? []);

  const { count, error } = await sb.from('dsp_campaigns')
    .select('id', { count: 'exact', head: true }).eq('organization_id', orgId);
  if (error) throw new Error(`lecture des campagnes : ${error.message}`);

  const garder = (s: 'socle' | 'proprietaire' | 'partage') =>
    jeux.filter((j) => statutPourEspace(j, orgId) === s)
      .map(({ organization_id: _o, shared_with: _s, ...j }) => j);
  return {
    jeux: { socle: garder('socle'), proprietaire: garder('proprietaire'), partage: garder('partage') },
    categories,
    nb_campagnes: count ?? 0,
  };
}
```

⚠ Le `COUNT` sur `dsp_campaigns` filtré par `organization_id` est autorisé : table de quelques lignes (8 le 2026-10-06), pas une table volumineuse. Lancer `EXPLAIN ANALYZE select count(*) from dsp_campaigns where organization_id = '<marine>'` en local et coller le plan dans le rapport.

- [ ] **Step 6: Les cinq routes**

Modèle commun, à recopier dans chaque fichier (ici `app/api/admin/espaces/[id]/donnees/route.ts`) :

```ts
/**
 * GET /api/admin/espaces/[id]/donnees
 * Chaque jeu de données avec son statut POUR cet espace (spec § 4.4).
 *
 * super_admin seul (D1). Réponse bornée par construction (une ligne par
 * source, quelques dizaines) : aucune troncature PostgREST possible.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { donneesDeLEspace } from '@/lib/espaces/donnees-espace';

export const dynamic = 'force-dynamic';

const IdSchema = z.string().uuid();

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return NextResponse.json({ error: 'Identifiant d\'espace invalide.' }, { status: 400 });

  try {
    const reponse = await donneesDeLEspace(createAdminClient(), id);
    if (!reponse) return NextResponse.json({ error: 'Espace introuvable.' }, { status: 404 });
    return NextResponse.json(reponse);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur' }, { status: 500 });
  }
}
```

- `app/api/admin/espaces/route.ts` : `GET` → `listerEspaces(createAdminClient())`, sans paramètre.
- `app/api/admin/espaces/socle/route.ts` : `GET` → `lireSocle(...)`.
- `app/api/admin/espaces/[id]/membres/route.ts` : `GET` → vérifier l'existence par `resumerEspace` (404 sinon), puis `{ membres: await membresDeLEspace(...) }`.
- `app/api/admin/espaces/[id]/apercu/route.ts` : `GET` → existence par `resumerEspace` (404), puis `apercuEspace(...)`.

- [ ] **Step 7: Tests d'intégration des lectures**

`tests/integration/espaces-lectures.test.ts` :

```ts
/**
 * Lectures de la page « Espaces de travail » contre la base locale.
 * On vérifie des RELATIONS, pas des effectifs figés.
 */
import { describe, it, expect } from 'vitest';
import { creerClientTest } from './_client';
import { listerEspaces, membresDeLEspace } from '@/lib/espaces/lister-espaces';
import { donneesDeLEspace, lireSocle } from '@/lib/espaces/donnees-espace';
import { getOrgSourceIds } from '@/lib/auth/getOrgSourceIds';

const sb = creerClientTest() as never;

describe('listerEspaces', () => {
  it('rend chaque organisation, l\'interne renommée et rangée en dernier', async () => {
    const { espaces, socle } = await listerEspaces(sb);
    const interne = espaces.find((e) => e.slug === 'genesis-global');
    expect(interne?.nom_affiche).toBe('dentsu.explore (interne)');
    expect(espaces.at(-1)?.interne).toBe(true);
    expect(socle.nb_jeux).toBeGreaterThan(0);
  });

  it('compte les membres par organization_members', async () => {
    const admin = creerClientTest();
    const { espaces } = await listerEspaces(sb);
    for (const e of espaces) {
      const { count } = await admin.from('organization_members').select('id', { count: 'exact', head: true }).eq('organization_id', e.id);
      expect(e.nb_membres, e.slug).toBe(count ?? 0);
    }
  });
});

describe('donneesDeLEspace = getOrgSourceIds', () => {
  it('pour chaque espace, les jeux non « non_visible » sont exactement les sources de la règle des routes', async () => {
    const { espaces } = await listerEspaces(sb);
    for (const e of espaces) {
      const reponse = await donneesDeLEspace(sb, e.id);
      const visiblesEcran = reponse!.jeux.filter((j) => j.statut !== 'non_visible').map((j) => j.id).sort();
      const visiblesRegle = ((await getOrgSourceIds({ userId: 't', orgId: e.id, role: 'client' })) ?? []).sort();
      expect(visiblesEcran, e.slug).toEqual(visiblesRegle);
    }
  });

  it('la MARINE possède CIRFA et ne voit pas CONCESSIONS BMW', async () => {
    const { espaces } = await listerEspaces(sb);
    const marine = espaces.find((e) => e.slug === 'marine')!;
    const { jeux } = (await donneesDeLEspace(sb, marine.id))!;
    expect(jeux.find((j) => j.nom === 'CIRFA')?.statut).toBe('proprietaire');
    expect(jeux.find((j) => j.nom === 'CONCESSIONS BMW')?.statut).toBe('non_visible');
  });

  it('espace inconnu → null', async () => {
    expect(await donneesDeLEspace(sb, '00000000-0000-0000-0000-00000000dead')).toBeNull();
  });
});

describe('lireSocle', () => {
  it('range les jeux du socle en tête et compte les espaces clients (hors interne)', async () => {
    const { jeux, nb_espaces_clients } = await lireSocle(sb);
    const premierPrive = jeux.findIndex((j) => j.visibilite === 'privee');
    expect(jeux.slice(premierPrive === -1 ? jeux.length : premierPrive).every((j) => j.visibilite === 'privee')).toBe(true);
    const { espaces } = await listerEspaces(sb);
    expect(nb_espaces_clients).toBe(espaces.filter((e) => !e.interne).length);
  });
});

describe('membresDeLEspace', () => {
  it('chaque membre rendu est bien membre, et ses autres espaces excluent celui-ci', async () => {
    const { espaces } = await listerEspaces(sb);
    const marine = espaces.find((e) => e.slug === 'marine')!;
    const membres = await membresDeLEspace(sb, marine.id);
    expect(membres.length).toBe(marine.nb_membres);
    for (const m of membres) expect(m.autres_espaces.map((x) => x.id)).not.toContain(marine.id);
  });
});
```

`tests/integration/espaces-apercu.test.ts` — l'aperçu confronté à la règle SQL vue par un vrai client :

```ts
/**
 * L'aperçu d'un espace rend EXACTEMENT ce que voit un vrai compte de cet espace.
 *
 * Deux règles écrites deux fois : en TypeScript (`getOrgSourceIds`, que
 * l'aperçu appelle) et en SQL (`source_visible` / `ds_select`, sql/234, que
 * PostgREST applique à un compte connecté avec la clé publique). Ce test les
 * confronte : si elles divergeaient, l'aperçu montrerait un droit qui n'existe
 * pas (ou en cacherait un). Même mécanique de comptes que
 * cloisonnement-rls.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { creerClientTest } from './_client';
import { apercuEspace } from '@/lib/espaces/apercu-espace';

const admin = creerClientTest();
const MOT_DE_PASSE = 'Apercu-espaces-2026!';
let compte: { id: string; orgId: string; client: SupabaseClient };

beforeAll(async () => {
  const { data: org } = await admin.from('organizations').select('id').eq('slug', 'marine').single();
  const orgId = org!.id as string;
  const email = 'test-apercu-marine@exemple.test';
  const { data: existants } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const ancien = existants?.users.find((u) => u.email === email);
  if (ancien) await admin.auth.admin.deleteUser(ancien.id);
  const { data: cree, error } = await admin.auth.admin.createUser({ email, password: MOT_DE_PASSE, email_confirm: true });
  if (error || !cree.user) throw new Error(error?.message);
  // sql/236 : l'appartenance AVANT l'espace actif.
  await admin.from('organization_members').insert({ user_id: cree.user.id, organization_id: orgId });
  const { error: e2 } = await admin.from('profiles').upsert({ id: cree.user.id, email, role: 'client', organization_id: orgId });
  if (e2) throw new Error(e2.message);
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { error: e3 } = await client.auth.signInWithPassword({ email, password: MOT_DE_PASSE });
  if (e3) throw new Error(e3.message);
  compte = { id: cree.user.id, orgId, client };
}, 60_000);

afterAll(async () => {
  if (compte?.id) {
    const { error } = await admin.auth.admin.deleteUser(compte.id);
    if (error) console.error(`nettoyage : ${error.message}`);
  }
});

describe('aperçu de la MARINE = ce que voit un vrai compte MARINE', () => {
  it('mêmes jeux de données que la RLS (règle SQL)', async () => {
    const apercu = await apercuEspace(admin as never, compte.orgId);
    const ecran = [...apercu.jeux.socle, ...apercu.jeux.proprietaire, ...apercu.jeux.partage].map((j) => j.id).sort();
    const { data, error } = await compte.client.from('data_sources').select('id');
    expect(error).toBeNull();
    expect(ecran).toEqual((data ?? []).map((d) => d.id as string).sort());
  });

  it('chaque catégorie annoncée est lisible par le compte, et « bmw » n\'est pas annoncée', async () => {
    const apercu = await apercuEspace(admin as never, compte.orgId);
    expect(apercu.categories.map((c) => c.toLowerCase())).not.toContain('bmw');
    for (const cat of apercu.categories) {
      const { data, error } = await compte.client.from('poi_france').select('id').eq('categorie', cat).limit(1);
      expect(error, cat).toBeNull();
      expect(data?.length, cat).toBe(1);
    }
  });
});
```

⚠ Si la catégorie des concessions n'est pas littéralement `bmw` en base, relever la vraie valeur (`select distinct categorie from poi_france where data_source_id = (select id from data_sources where name = 'CONCESSIONS BMW')`) et l'écrire dans le test — ne jamais affaiblir l'assertion.

- [ ] **Step 8: Tout faire passer**

```bash
npx vitest run --project unit tests/unit/espaces
npx vitest run --project integration tests/integration/espaces-lectures.test.ts tests/integration/espaces-apercu.test.ts
npx tsc --noEmit; echo "tsc=$?"
npm run test:unit
```

Expected : tout vert, `tsc=0`. `troncature-postgrest.test.ts` reste vert (aucune RPC tabulaire nouvelle) ; `perimetre-routes.test.ts` aussi (routes sous `/api/admin`).

- [ ] **Step 9: Documenter et committer**

`ARCHITECTURE.md` (section des routes admin) : les cinq routes, leur réponse, « super_admin seul, bornées ». Spec § 5.2 : ajouter les lignes `socle` et `[id]/membres` avec leur raison.

```bash
git add lib/espaces app/api/admin/espaces tests/unit/espaces tests/integration/espaces-lectures.test.ts tests/integration/espaces-apercu.test.ts ARCHITECTURE.md docs/superpowers/specs/2026-10-08-espaces-de-travail-design.md
git commit -m "feat(admin): lectures des espaces de travail — colonne, socle, données, membres, aperçu

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `PUT /api/admin/users/[id]/espaces`

**Files:**
- Modify: `lib/espaces/appartenance.ts` (ajout de `remplacerEspaces`)
- Create: `app/api/admin/users/[id]/espaces/route.ts`
- Modify: `tests/integration/appartenance-espaces.test.ts`
- Modify: `ARCHITECTURE.md`

**Interfaces:**
- Consumes : RPC `remplacer_espaces_utilisateur` (T1), `messageErreurAppartenance` (T2).
- Produces :
  - `remplacerEspaces(sb, userId: string, espaces: string[], espaceActif: string | null): Promise<{ ok: true; espaces: string[]; espace_actif: string | null } | { ok: false; status: number; message: string }>`
  - `PUT /api/admin/users/[id]/espaces`, corps `{ espaces: string[] (uuid, 50 au plus, sans doublon), espace_actif: string | null }` → 200 `{ espaces: string[], espace_actif: string | null }` ; 400 corps invalide ou refus d'invariant ; 404 utilisateur inconnu.

- [ ] **Step 1: Test d'intégration (échec)**

```ts
import { remplacerEspaces } from '@/lib/espaces/appartenance';

describe('remplacerEspaces (T4)', () => {
  it('coche deux espaces et choisit l\'actif', async () => {
    const u = await creerCompte('cases');
    const r = await remplacerEspaces(admin as never, u, [a, b], b);
    expect(r).toEqual({ ok: true, espaces: [a, b].sort(), espace_actif: b });
  });

  it('actif hors des cases → 400 avec le message français', async () => {
    const u = await creerCompte('cases-refus');
    const r = await remplacerEspaces(admin as never, u, [a], b);
    expect(r).toEqual({ ok: false, status: 400, message: 'L\'espace actif doit faire partie des espaces de l\'utilisateur.' });
  });

  it('utilisateur inconnu → 404', async () => {
    const r = await remplacerEspaces(admin as never, '00000000-0000-0000-0000-00000000dead', [], null);
    expect(r).toEqual({ ok: false, status: 404, message: 'Utilisateur introuvable.' });
  });
});
```

Run → FAIL (`remplacerEspaces` non exporté).

- [ ] **Step 2: Implémenter**

Dans `lib/espaces/appartenance.ts` :

```ts
/**
 * Remplace la liste des espaces d'un utilisateur et son espace actif, en UNE
 * transaction (RPC sql/236) : la fiche utilisateur coche plusieurs cases d'un
 * coup, et une suite d'appels séparés pourrait s'arrêter au milieu.
 */
export async function remplacerEspaces(
  sb: Sb, userId: string, espaces: string[], espaceActif: string | null,
): Promise<{ ok: true; espaces: string[]; espace_actif: string | null } | { ok: false; status: number; message: string }> {
  const { data, error } = await sb.rpc('remplacer_espaces_utilisateur', {
    p_user: userId, p_espaces: espaces, p_actif: espaceActif,
  });
  if (error) return { ok: false, ...messageErreurAppartenance(error.code, error.message) };
  const r = data as { espaces: string[]; espace_actif: string | null };
  return { ok: true, espaces: [...r.espaces].sort(), espace_actif: r.espace_actif };
}
```

Si `tsc` refuse le nom de la RPC (types générés antérieurs à sql/236), régénérer les types : `npx supabase gen types typescript --local > types/database.types.ts`, vérifier par `git diff --stat types/database.types.ts` que seuls les ajouts de sql/236 apparaissent, et l'inclure au commit.

`app/api/admin/users/[id]/espaces/route.ts` :

```ts
/**
 * PUT /api/admin/users/[id]/espaces
 * Remplace les espaces d'un utilisateur et son espace actif (fiche
 * utilisateur de la page « Espaces de travail », spec § 4.3).
 *
 * super_admin seul (D1). Une seule transaction (RPC sql/236).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { lireCorps } from '@/lib/api/valider-corps';
import { remplacerEspaces } from '@/lib/espaces/appartenance';

export const dynamic = 'force-dynamic';

/** 50 au plus : une liste bornée (règle « jamais de liste illimitée »). */
const EspacesSchema = z.object({
  espaces: z.array(z.string().uuid()).max(50).refine((l) => new Set(l).size === l.length, 'Espace en double.'),
  espace_actif: z.string().uuid().nullable(),
});

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'Identifiant d\'utilisateur invalide.' }, { status: 400 });
  const corps = await lireCorps(request, EspacesSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });

  const r = await remplacerEspaces(createAdminClient(), id, corps.valeur.espaces, corps.valeur.espace_actif);
  if (!r.ok) return NextResponse.json({ error: r.message }, { status: r.status });
  return NextResponse.json({ espaces: r.espaces, espace_actif: r.espace_actif });
}
```

- [ ] **Step 3: Vérifier, documenter, committer**

```bash
npx vitest run --project integration tests/integration/appartenance-espaces.test.ts
npx tsc --noEmit; echo "tsc=$?"
npm run test:unit
git add lib/espaces/appartenance.ts "app/api/admin/users/[id]/espaces/route.ts" tests/integration/appartenance-espaces.test.ts ARCHITECTURE.md
git add types/database.types.ts   # seulement si régénéré
git commit -m "feat(admin): remplacer les espaces d'un utilisateur en une transaction

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Angular — route, données, état, colonne des espaces, nouvel espace

**Files:**
- Create: `angular/src/app/features/admin/espaces/logique/types.ts` (copie exacte de `lib/espaces/types.ts`, en-tête « Copie de `lib/espaces/types.ts` (2026-10-09) ; parité : `tests/unit/angular/espaces-types-paritaires.test.ts` »)
- Create: `angular/src/app/features/admin/espaces/logique/libelles.ts`
- Create: `angular/src/app/features/admin/espaces/data/espaces.api.ts` (+ `.spec.ts`)
- Create: `angular/src/app/features/admin/espaces/etat/espaces-etat.service.ts` (+ `.spec.ts`)
- Create: `angular/src/app/features/admin/espaces/espaces.page.ts` (+ `.spec.ts`)
- Create: `angular/src/app/features/admin/espaces/dialogue-nouvel-espace.component.ts` (+ `.spec.ts`)
- Create: `angular/src/app/features/admin/espaces/aucun-espace.component.ts`
- Create: `tests/unit/angular/espaces-types-paritaires.test.ts`
- Modify: `angular/src/app/features/admin/admin.routes.ts` (`EspacesApi` dans `FOURNISSEURS_ADMIN`, route `espaces`)
- Modify: `angular/src/app/layout/navigation.ts` (E6) et sa spec si elle compte les entrées (`barre-laterale.component.spec.ts`)
- Modify: `ARCHITECTURE.md` (§ Application Angular, une puce « **Espaces de travail (T5, 2026-10-…)** » en fin de section)

**Interfaces:**
- Consumes : routes de T3 et T4 ; `POST /api/admin/organizations` (`{ name }` → `{ success, organization }`, 409 si le nom existe) ; `PATCH /api/admin/organizations/[id]` ; `POST/DELETE …/members` ; `POST …/members/reset-password` ; `POST/DELETE …/sources/assign` (`{ sourceId }`) ; `PATCH /api/admin/sources/[id]` (`{ organization_id?, visibilite? }`) ; `GET /api/admin/users` (tableau de profils) ; `POST /api/admin/users` (`{ email, full_name, role, organization_id }` → 201 `{ id, email, setup_link }`) ; `DELETE /api/admin/users/[id]`.
- Produces :

```ts
// data/espaces.api.ts — @Injectable() sans providedIn, hérite de HttpBaseService
export class EspacesApi extends HttpBaseService {
  lister(): Observable<ReponseEspaces>;                                    // GET  admin/espaces
  lireSocle(): Observable<ReponseSocle>;                                   // GET  admin/espaces/socle
  lireDonnees(id: string): Observable<ReponseDonneesEspace>;               // GET  admin/espaces/:id/donnees
  lireMembres(id: string): Observable<{ membres: MembreEspace[] }>;        // GET  admin/espaces/:id/membres
  lireApercu(id: string): Observable<ApercuEspace>;                        // GET  admin/espaces/:id/apercu
  creerEspace(nom: string, description: string | null): Observable<{ success: boolean; organization: { id: string } }>;
      // POST admin/organizations {name}, puis si description : PATCH admin/organizations/:id {description} — DEUX appels séquentiels (la création n'accepte pas `description`)
  lireEspace(id: string): Observable<{ organization: OrganisationComplete }>; // GET admin/organizations/:id (Réglages)
  modifierEspace(id: string, champs: ChampsEspace): Observable<unknown>;   // PATCH admin/organizations/:id
  supprimerEspace(id: string): Observable<unknown>;                        // DELETE admin/organizations/:id
  ajouterMembre(id: string, email: string): Observable<unknown>;           // POST admin/organizations/:id/members {email} — SANS role (E3)
  retirerMembre(id: string, userId: string): Observable<unknown>;          // DELETE …/members {userId}
  lienMotDePasse(id: string, email: string): Observable<{ link: string | null }>; // POST …/members/reset-password {email}
  partager(id: string, sourceId: string): Observable<unknown>;             // POST …/sources/assign {sourceId}
  retirerPartage(id: string, sourceId: string): Observable<unknown>;       // DELETE …/sources/assign {sourceId}
  modifierJeu(sourceId: string, champs: { organization_id?: string; visibilite?: 'socle' | 'privee' }): Observable<unknown>; // PATCH admin/sources/:sourceId
  listerComptes(): Observable<CompteAdmin[]>;                              // GET admin/users
  creerCompte(c: { email: string; full_name: string | null; role: 'client' | 'super_admin'; organization_id: string | null }): Observable<{ id: string; email: string; setup_link: string | null }>;
  modifierCompte(userId: string, champs: { role?: 'client' | 'super_admin'; full_name?: string | null }): Observable<unknown>; // PATCH admin/users/:id
  remplacerEspaces(userId: string, espaces: string[], espaceActif: string | null): Observable<{ espaces: string[]; espace_actif: string | null }>; // PUT admin/users/:id/espaces
  supprimerCompte(userId: string): Observable<unknown>;                    // DELETE admin/users/:id
}
// Types locaux à data/espaces.api.ts :
export interface CompteAdmin { id: string; email: string; full_name: string | null; role: string; organization_id: string | null }
export interface OrganisationComplete { id: string; name: string; description: string | null; active: boolean; config: Record<string, unknown> | null }
export interface ChampsEspace { name?: string; description?: string | null; active?: boolean; config?: Record<string, unknown> }

// etat/espaces-etat.service.ts — @Injectable() SANS providedIn, fourni par EspacesPage (détruit avec elle)
export class EspacesEtatService {
  readonly espaces: Signal<readonly EspaceResume[]>;
  readonly socle: Signal<{ nb_jeux: number } | null>;
  readonly chargement: Signal<boolean>;
  readonly erreur: Signal<string | null>;
  charger(): void;      // un GET admin/espaces ; ignoré si déjà chargé (cache)
  recharger(): void;    // force la relecture (après une écriture qui change un compteur)
  espace(id: string): Signal<EspaceResume | null>;  // computed sur la liste
}

// logique/libelles.ts
export const LIBELLES_STATUT: Record<StatutJeu, string> = { proprietaire: 'Propriétaire', partage: 'Partagé', socle: 'Socle', non_visible: 'Non visible' };
export const LIBELLES_TYPE: Record<TypeJeu, string> = { poi: 'POI', panneaux: 'Panneaux', carreaux: 'Carreaux' };
export const NOM_SOCLE = 'Socle dentsu.explore';
export function messageErreur(e: unknown): string; // lit `error.error.error` (format { error } des routes) sinon `error.message`, sinon « Erreur inattendue. »
```

Routes (`admin.routes.ts`, enfants de la route racine admin, APRÈS `qualite-donnees`) :

```ts
{
  path: 'espaces',
  loadComponent: () => import('./espaces/espaces.page').then((m) => m.EspacesPage),
  children: [
    { path: '', loadComponent: () => import('./espaces/aucun-espace.component').then((m) => m.AucunEspaceComponent) },
    { path: 'socle', loadComponent: () => import('./espaces/fiche-socle.component').then((m) => m.FicheSocleComponent) },
    { path: ':id', loadComponent: () => import('./espaces/fiche-espace.component').then((m) => m.FicheEspaceComponent) },
  ],
},
```

En T5, `fiche-socle.component.ts` et `fiche-espace.component.ts` existent comme coquilles minimales (un `<p>` « Fiche en cours de construction ») pour que les routes compilent ; T6 et T7 les remplissent.

**Rendu de la colonne (`EspacesPage`)** : grille `grid-cols-[260px_1fr]` (sous 768 px : une colonne, la liste au-dessus). Colonne : en-tête de page « Espaces de travail » (`mg-entete-page`), puis une `<nav aria-label="Espaces de travail">` contenant une liste de liens (`routerLink` RELATIF : `socle`, `espace.id`) :
- première ligne : point teal + « Socle dentsu.explore », sous-ligne « visible de tous · {nb_jeux} jeux » ;
- séparateur 0,5 px `--border-subtle` ;
- une ligne par espace : `nom_affiche`, à droite en JetBrains Mono « {nb_membres} · {nb_jeux_prives} » avec `title="{n} membres · {m} jeux privés"` ; un espace `actif: false` porte la pastille « Inactif » ;
- dernière ligne : bouton « + Nouvel espace » (bouton outline neutre).
Ligne active : `routerLinkActive` → fond `--bg-level-3`, bord gauche 2 px `--text-primary`. Clavier : flèches haut/bas déplacent le focus entre les liens (écouteur `keydown` sur la `<nav>`, jamais sur `document`), Entrée suit le lien (natif). État de chargement : trois lignes squelettes ; erreur : message + « Réessayer ».

**Dialogue nouvel espace** : `<dialog>` natif (patron `mg-confirmation`), champs « Nom » (requis) et « Description » (facultatif), boutons « Annuler » / « Créer l'espace » (CTA blanc). Validation : nom vide après `trim()` → bouton désactivé. Succès → notification « Espace créé », `etat.recharger()`, navigation relative vers l'identifiant créé, dialogue fermé. 409 → message du serveur (« Une organisation avec ce nom existe deja ») affiché DANS le dialogue, qui reste ouvert.

- [ ] **Step 1: Test de parité des types (échec)**

`tests/unit/angular/espaces-types-paritaires.test.ts` :

```ts
/**
 * Les types de la page « Espaces de travail » copiés dans angular/ restent
 * ceux du serveur. Assignabilité mutuelle vérifiée par `npx tsc --noEmit`
 * (Vitest ne type-vérifie pas) — même patron que admin-logique-paritaire.
 */
import { describe, expect, it } from 'vitest';
import type * as R from '@/lib/espaces/types';
import type * as A from '../../../angular/src/app/features/admin/espaces/logique/types';

type Egal<X, Y> = [X] extends [Y] ? ([Y] extends [X] ? true : false) : false;
const _verif: [
  Egal<R.EspaceResume, A.EspaceResume>,
  Egal<R.ReponseEspaces, A.ReponseEspaces>,
  Egal<R.JeuDeDonnees, A.JeuDeDonnees>,
  Egal<R.JeuPourEspace, A.JeuPourEspace>,
  Egal<R.ReponseDonneesEspace, A.ReponseDonneesEspace>,
  Egal<R.ReponseSocle, A.ReponseSocle>,
  Egal<R.MembreEspace, A.MembreEspace>,
  Egal<R.ApercuEspace, A.ApercuEspace>,
  Egal<R.StatutJeu, A.StatutJeu>,
] = [true, true, true, true, true, true, true, true, true];
void _verif;

describe('types des espaces de travail : Angular = serveur', () => {
  it('la copie existe et la parité est tenue par tsc', () => {
    expect(_verif.every(Boolean)).toBe(true);
  });
});
```

Run : `npx tsc --noEmit; echo "tsc=$?"` → erreur (module Angular absent). Puis écrire `logique/types.ts` (copie) → `tsc=0`.

- [ ] **Step 2: Spec de l'API (échec)** — `data/espaces.api.spec.ts`, patron de `qualite.api.spec.ts` (`provideHttpClientTesting`, `ConfigService` doublé avec `apiBaseUrl: ''`, `http.verify()` en `afterEach`). Un `it` par méthode qui vérifie méthode HTTP, URL exacte et corps EXACT. Les cas qui comptent :

```ts
it('ajouterMembre : POST …/members au corps EXACT { email } — sans rôle (E3)', () => {
  api.ajouterMembre('org-1', 'nom@exemple.fr').subscribe();
  const req = http.expectOne('/api/admin/organizations/org-1/members');
  expect(req.request.method).toBe('POST');
  expect(req.request.body).toEqual({ email: 'nom@exemple.fr' });
  req.flush({ success: true });
});

it('retirerMembre : DELETE avec corps { userId }', () => {
  api.retirerMembre('org-1', 'u-1').subscribe();
  const req = http.expectOne('/api/admin/organizations/org-1/members');
  expect(req.request.method).toBe('DELETE');
  expect(req.request.body).toEqual({ userId: 'u-1' });
  req.flush({ success: true });
});

it('creerEspace avec description : POST puis PATCH, dans cet ordre', () => {
  let fini = false;
  api.creerEspace('Nouvel espace', 'Texte').subscribe(() => (fini = true));
  const post = http.expectOne('/api/admin/organizations');
  expect(post.request.body).toEqual({ name: 'Nouvel espace' });
  post.flush({ success: true, organization: { id: 'org-9' } });
  const patch = http.expectOne('/api/admin/organizations/org-9');
  expect(patch.request.method).toBe('PATCH');
  expect(patch.request.body).toEqual({ description: 'Texte' });
  patch.flush({ success: true, organization: { id: 'org-9' } });
  expect(fini).toBe(true);
});

it('creerEspace sans description : un seul POST', () => {
  api.creerEspace('Nouvel espace', null).subscribe();
  http.expectOne('/api/admin/organizations').flush({ success: true, organization: { id: 'org-9' } });
});

it('remplacerEspaces : PUT au corps EXACT', () => {
  api.remplacerEspaces('u-1', ['a', 'b'], 'b').subscribe();
  const req = http.expectOne('/api/admin/users/u-1/espaces');
  expect(req.request.method).toBe('PUT');
  expect(req.request.body).toEqual({ espaces: ['a', 'b'], espace_actif: 'b' });
  req.flush({ espaces: ['a', 'b'], espace_actif: 'b' });
});

it('modifierJeu : PATCH admin/sources/:id au corps EXACT', () => {
  api.modifierJeu('s-1', { visibilite: 'socle' }).subscribe();
  const req = http.expectOne('/api/admin/sources/s-1');
  expect(req.request.method).toBe('PATCH');
  expect(req.request.body).toEqual({ visibilite: 'socle' });
  req.flush({ success: true });
});
```

`creerEspace` s'écrit avec `switchMap` (le PATCH n'a lieu qu'après la réponse du POST, avec son `organization.id`) ; si le PATCH échoue, l'erreur remonte — l'espace existe quand même : la page le dit (« Espace créé, mais la description n'a pas été enregistrée ») et recharge la liste.

- [ ] **Step 3: Specs de l'état, de la page et du dialogue (échec)**

`etat/espaces-etat.service.spec.ts` : `charger()` deux fois → UN seul `GET /api/admin/espaces` (cache) ; `recharger()` → nouveau GET ; erreur 500 → `erreur()` porte le message du serveur, `espaces()` vide.

`espaces.page.spec.ts` (avec `provideRouter(ROUTES_DE_TEST)`, `RouterTestingHarness`) :
- montage → un GET `admin/espaces`, aucun autre appel ;
- rend « Socle dentsu.explore » en premier, « dentsu.explore (interne) » en dernier, et pour chaque espace « {nb_membres} · {nb_jeux_prives} » ;
- jamais le texte « MAGELIAN » ni « GENESIS » dans le DOM (`expect(el.textContent).not.toMatch(/MAGELIAN|GENESIS/)`) ;
- flèche bas sur le premier lien → focus sur le second ; flèche haut sur le premier → reste sur le premier ;
- le lien d'un espace a un `href` qui finit par `/espaces/<id>` (relatif à la route) ;
- GET en 500 → message d'erreur + bouton « Réessayer » qui relance le GET.

`dialogue-nouvel-espace.component.spec.ts` :
- nom vide ou blancs → « Créer l'espace » désactivé ;
- saisie « Espace test » → POST au corps `{ name: 'Espace test' }` ; succès → `creer` émis avec l'id ;
- 409 → le message du serveur est rendu dans le dialogue (`role="alert"`), le dialogue reste ouvert ;
- Échap → `annuler` émis (comportement de `mg-confirmation`).

Run : `cd angular && npx ng test --watch=false` → FAIL.

- [ ] **Step 4: Implémenter** les fichiers de la liste « Files », selon les interfaces et le rendu ci-dessus. `FOURNISSEURS_ADMIN` reçoit `EspacesApi`. `EspacesPage` porte `providers: [EspacesEtatService]` et appelle `etat.charger()` dans son constructeur.

Navigation (E6) — dans `SECTIONS_NAVIGATION`, section « Systeme », remplacer les deux lignes « Users » et « Organisations » par :

```ts
      // Espaces de travail (2026-10-09) : remplace « Users » et « Organisations » — écart
      // VOULU à la parité avec la barre React (spec espaces de travail § 6). `href` garde le
      // chemin React d'où vient la fonction, pour la traçabilité.
      { href: '/admin/users', libelle: 'Espaces de travail', icone: 'utilisateurs', cible: 'admin/espaces' },
```

Si `barre-laterale.component.spec.ts` compte les entrées ou cite « Users » / « Organisations », mettre l'attendu à jour en citant la spec dans le commentaire du test.

- [ ] **Step 5: PASS et build**

```bash
cd angular && npx ng test --watch=false && npm run build; cd ..
npx tsc --noEmit; echo "tsc=$?"
npm run test:unit
```

- [ ] **Step 6: Navigateur, deux thèmes**

Serveurs : `npm run dev` (:3000) et `cd angular && npm start` (:4200). Se connecter en super_admin (identifiants : mémoire `reference_geomatik_credentials`). Ouvrir `http://localhost:4200/app/admin/espaces` :
- colonne : « Socle dentsu.explore » (3 jeux), BMW GROUP, DRHAT, MARINE, « dentsu.explore (interne) » en dernier, compteurs = SQL de référence (MARINE : 3 membres après rattrapage, 1 jeu privé) ;
- navigation clavier (Tab jusqu'à la liste, flèches, Entrée) ;
- recharger la page sur `…/espaces/<id-marine>` : la ligne MARINE est active ;
- créer `[ESSAI espaces] Colonne`, vérifier qu'il apparaît et qu'on y est conduit ;
- captures 1440 × 900, thèmes sombre et clair, dans `.superpowers/sdd/2026-10-09-espaces-de-travail/` : `t5-colonne-{sombre,clair}.png`, `t5-dialogue-{sombre,clair}.png`.
- Compte `client` : `…/app/admin/espaces` → message « Accès réservé aux super-administrateurs. », aucun appel `/api/admin/espaces` dans l'onglet Réseau.
- Supprimer l'espace jetable par SQL (`delete from organizations where name like '[ESSAI espaces]%'`) et le dire au rapport. Arrêter les serveurs.

- [ ] **Step 7: Commit**

```bash
git add angular/src/app/features/admin/espaces angular/src/app/features/admin/admin.routes.ts angular/src/app/layout tests/unit/angular/espaces-types-paritaires.test.ts ARCHITECTURE.md
git commit -m "feat(angular): espaces de travail — route, colonne des espaces et création (T5)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Angular — fiche « Socle dentsu.explore »

**Files:**
- Modify: `angular/src/app/features/admin/espaces/fiche-socle.component.ts` (+ `.spec.ts`)
- Modify: `ARCHITECTURE.md` (puce T6)

**Interfaces:**
- Consumes : `EspacesApi.lireSocle()`, `EspacesApi.modifierJeu(id, { visibilite })`, `EspacesEtatService.recharger()`, `NotificationsService` (fourni par le cadre admin), `ConfirmationComponent` (`mg-confirmation`).

**Rendu** (spec § 4.2) :
- en-tête « Socle dentsu.explore », sous-titre « Les jeux du socle sont visibles de tous les espaces, sans action. » ;
- section (bandeau `--bg-level-2` + point teal) « Dans le socle ({n}) » : tableau `mg-tableau` — Jeu (nom), Type (`LIBELLES_TYPE`), Propriétaire (`nom_affiche`), Lignes (`formaterNombre`, JetBrains Mono), action « Retirer du socle » (bouton outline neutre) ;
- section « Jeux privés ({n}) » : mêmes colonnes, action « Mettre au socle » (bouton CTA teal) ;
- section « Référentiels système » : deux lignes en lecture seule, « Arrêts de transport » et « Installations classées (ICPE) », mention « Référentiel système, toujours visible » (textes fixes : ces POI n'ont pas de source, `lib/auth/perimetre-donnees.ts` en-tête).

**Confirmations** :
- Retirer du socle : `mg-confirmation` variante `danger`, titre « Retirer « {nom} » du socle ? », message « Il redeviendra privé à {propriétaire}. {k} espaces clients ne le verront plus. », où k = `nb_espaces_clients` moins 1 si le propriétaire est un espace client. Confirmer → `modifierJeu(id, { visibilite: 'privee' })`.
- Mettre au socle : variante `defaut`, titre « Mettre « {nom} » au socle ? », message « Il sera visible de tous les espaces clients. » Confirmer → `modifierJeu(id, { visibilite: 'socle' })`.
- Pendant l'écriture : `enCours` vrai sur la confirmation. Succès : notification succès (« Jeu retiré du socle » / « Jeu mis au socle »), relecture de `lireSocle()` et `etat.recharger()`. Échec : notification d'erreur avec `messageErreur(e)`, confirmation fermée, tableau INCHANGÉ (pas de mise à jour optimiste).
- Un jeu sans propriétaire (`proprietaire: null`) ne peut pas être retiré du socle : le bouton est désactivé avec `title="Ce jeu n'a pas de propriétaire : il ne peut redevenir privé."` (sinon personne ne le verrait plus).

- [ ] **Step 1: Spec (échec)** — montage : un seul GET `admin/espaces/socle` ; LYCEEE rendu sous « Dans le socle », CIRFA sous « Jeux privés » ; « Retirer du socle » → confirmation dont le message cite le nombre d'espaces clients ; confirmer → PATCH `admin/sources/<id>` au corps EXACT `{ visibilite: 'privee' }`, puis un second GET `admin/espaces/socle` ; PATCH en 500 `{ error: 'Refusé' }` → notification d'erreur « Refusé », aucun second GET, le jeu reste sous « Dans le socle » ; jeu sans propriétaire → bouton désactivé.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; `npm run build`.**
- [ ] **Step 5: Navigateur, deux thèmes** — mettre CIRFA au socle, vérifier par SQL (`select visibilite from data_sources where name='CIRFA'` → `socle`), le retirer (→ `privee`), vérifier que le compteur « Socle » de la colonne suit (3 → 4 → 3). Captures `t6-socle-{sombre,clair}.png`, `t6-confirmation-{sombre,clair}.png`. État final = état initial (SQL).
- [ ] **Step 6: Commit** — `feat(angular): espaces de travail — fiche Socle (T6)`.

---

### Task 7: Angular — fiche d'un espace, onglet Membres, fiche utilisateur

**Files:**
- Modify: `angular/src/app/features/admin/espaces/fiche-espace.component.ts` (+ `.spec.ts`)
- Create: `angular/src/app/features/admin/espaces/onglet-membres.component.ts` (+ `.spec.ts`)
- Create: `angular/src/app/features/admin/espaces/dialogue-ajout-membre.component.ts` (+ `.spec.ts`)
- Create: `angular/src/app/features/admin/espaces/fiche-utilisateur.component.ts` (+ `.spec.ts`)
- Modify: `ARCHITECTURE.md` (puce T7)

**Interfaces:**
- Consumes : `EspacesApi.{lireMembres, ajouterMembre, retirerMembre, lienMotDePasse, listerComptes, creerCompte, modifierCompte, remplacerEspaces, supprimerCompte}`, `EspacesEtatService.{espaces, espace, recharger}`, `ROLE_LABELS` (`features/admin/logique/roles.ts`).
- Produces : `FicheEspaceComponent` (lit `:id` dans `ActivatedRoute.paramMap`, ABONNÉ — la route est réutilisée d'un espace à l'autre, un changement de paramètre doit tout relire et remettre l'onglet sur « Membres ») ; onglets `Membres ({nb_membres})`, `Données`, `Aperçu`, `Réglages` (onglets du design system : actif `--text-primary` + bord bas 2 px `--brand-teal`) ; T8-T10 branchent les trois derniers (en T7 : un `<p>` « Onglet en cours de construction »). Un onglet n'est créé (et ne lit rien) qu'à sa première ouverture.

**Onglet Membres** (spec § 4.3) — tableau : Utilisateur (nom en `--text-primary`, email dessous en `--text-tertiary`), Rôle (`ROLE_LABELS[role]` ; un super_admin porte la pastille « Voit tous les espaces »), Autres espaces (pastilles `nom_affiche`), Espace actif (`nom_affiche` de l'espace actif, ou « Aucun (socle seul) »), Actions : « Retirer de l'espace » et « Lien de mot de passe ». Clic ou Entrée sur la ligne → fiche utilisateur. Au-dessus : bouton « Ajouter un membre ».

- **Retirer** : `mg-confirmation` `danger`, titre « Retirer {email} de {espace} ? ». Message selon le cas, calculé dans un `computed` :
  - le membre est super_admin → « Il reste super-administrateur et voit toujours tous les espaces. » ;
  - l'espace retiré n'est pas son espace actif → « Son espace actif ne change pas. » ;
  - c'est son espace actif et il a d'autres espaces → « Il basculera sur {nom_affiche du plus ancien de ses autres espaces}. » — le serveur choisit le PLUS ANCIEN par `joined_at`, que l'écran ne connaît pas : écrire « Il basculera sur un de ses autres espaces ({liste}). » ;
  - c'est son seul espace → « Il ne verra plus que le socle. »
  Confirmer → `retirerMembre` ; succès → notification, relecture des membres, `etat.recharger()` ; échec → notification d'erreur, liste inchangée.
- **Lien de mot de passe** : `lienMotDePasse(espaceId, email)` → dialogue « Lien de réinitialisation » qui affiche le lien dans un champ en lecture seule + bouton « Copier » (`navigator.clipboard.writeText`) et la mention « Ce lien ne sera plus affiché après fermeture. » Fermeture → le lien est effacé de l'état (signal remis à `null`). Jamais de `console.*` avec le lien. `link: null` → notification d'erreur « Lien non généré ».

**Dialogue « Ajouter un membre »** : deux modes en onglets internes.
- « Compte existant » : champ de recherche par email (filtre local de `listerComptes()`, lu UNE fois à l'ouverture du dialogue, mis en cache tant que le dialogue vit), comptes déjà membres exclus de la liste ; choisir un compte → `ajouterMembre(espaceId, email)`.
- « Nouveau compte » : champs Email (requis), Nom (facultatif) ; rôle FIXÉ à `client` (créer un super_admin se fait depuis la fiche utilisateur, en connaissance de cause) → `creerCompte({ email, full_name, role: 'client', organization_id: espaceId })` ; 201 → le dialogue passe à l'écran « Compte créé » : lien d'initialisation (`setup_link`) en lecture seule + « Copier » + mention « Transmettez ce lien à la personne : il ne sera plus affiché. » ; `setup_link: null` → « Le compte est créé, mais le lien n'a pas pu être généré. Générez-en un avec « Lien de mot de passe ». » ; 409 → « Ce compte existe déjà : ajoutez-le depuis « Compte existant ». » dans le dialogue.
- Dans les deux cas, succès → relecture des membres et `etat.recharger()`.

**Fiche utilisateur** (`<dialog>` large, 560 px) : email, champ Nom (enregistré par `modifierCompte(id, { full_name })`), Rôle en boutons radio `client` / `super_admin` (libellés `ROLE_LABELS`, jamais `admin` — E5) ; passer à super_admin → confirmation « {email} verra les données de tous les espaces, quel que soit son espace actif. » ; Espaces : une case par espace de `etat.espaces()` (`nom_affiche`), cochée si membre ; Espace actif : liste déroulante limitée aux espaces cochés + « Aucun (socle seul) » ; décocher l'espace actif remet le choix sur le premier espace coché restant, ou « Aucun ». Bouton « Enregistrer les espaces » → `remplacerEspaces(id, cochés, actif)` ; 400 → message du serveur dans la fiche. Zone dangereuse en bas : « Supprimer le compte » → confirmation `danger` « Supprimer définitivement {email} ? Ses zones et jeux de zones restent en base, sans auteur. » → `supprimerCompte` ; impossible sur son propre compte (bouton désactivé : le serveur refuse `Cannot delete yourself`). Fermer la fiche après une écriture → relecture des membres et `etat.recharger()`.

L'espace actif des membres d'un espace, l'appartenance et l'état « super_admin » viennent de `lireMembres` ; la liste des espaces de la fiche utilisateur combine `autres_espaces` + l'espace courant.

- [ ] **Step 1: Specs (échec)**

`fiche-espace.component.spec.ts` : `:id` = A → un GET `admin/espaces/A/membres` ; naviguer vers `:id` = B sans recréer le composant → GET `admin/espaces/B/membres`, onglet remis sur Membres ; clic « Données » → aucun appel tant que T8 n'est pas branché (en T7) ; espace inconnu dans la liste chargée → « Espace introuvable » + lien relatif « Retour » (`..`).

`onglet-membres.component.spec.ts` :
- rend chaque membre, la pastille « Voit tous les espaces » pour un super_admin, « Aucun (socle seul) » pour un actif `null` ;
- les QUATRE messages de retrait (un `it` par cas, fixtures dédiées) ;
- confirmer le retrait → DELETE `admin/organizations/A/members` au corps `{ userId }`, puis GET membres ;
- DELETE en 500 → notification d'erreur, aucune relecture, ligne toujours présente ;
- lien de mot de passe → POST au corps `{ email }`, lien rendu ; fermer → le lien n'est plus dans le DOM ni dans l'état ; `console.log`/`console.error` espionnés : jamais appelés avec le lien.

`dialogue-ajout-membre.component.spec.ts` : ouverture → un seul GET `admin/users` même après deux frappes de recherche ; un compte déjà membre n'est pas proposé ; nouveau compte → POST `admin/users` au corps EXACT `{ email: 'nom@exemple.fr', full_name: null, role: 'client', organization_id: 'A' }` ; 201 avec lien → écran « Compte créé » ; 201 sans lien → message de repli ; 409 → message « Ce compte existe déjà… ».

`fiche-utilisateur.component.spec.ts` : aucun bouton radio `admin` ; décocher l'espace actif → le choix passe au premier coché restant ; enregistrer → PUT `admin/users/U/espaces` au corps EXACT ; PUT en 400 `{ error: 'L\'espace actif doit…' }` → message dans la fiche ; passer à super_admin → confirmation puis PATCH `admin/users/U` au corps `{ role: 'super_admin' }` ; « Supprimer le compte » désactivé sur son propre compte (identifiant de session doublé via `AuthService`).

- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; `npm run build`.**
- [ ] **Step 5: Navigateur, deux thèmes** — sur un espace jetable `[ESSAI espaces] Membres` (créé par la colonne) : créer un compte `essai-espaces-membre@exemple.test`, copier le lien (vérifier qu'il n'apparaît dans aucun journal de la console) ; ouvrir sa fiche, cocher aussi MARINE, actif MARINE, enregistrer ; vérifier par SQL (`organization_members` : 2 lignes ; `profiles.organization_id` = MARINE) ; le retirer de MARINE depuis l'onglet Membres de MARINE → message « Il basculera sur un de ses autres espaces ([ESSAI espaces] Membres) » ; SQL : actif = l'espace jetable ; supprimer le compte depuis sa fiche ; supprimer l'espace jetable (SQL). Captures `t7-membres`, `t7-ajout`, `t7-compte-cree`, `t7-fiche-utilisateur`, `t7-retrait`, deux thèmes. État final = chiffres de référence.
- [ ] **Step 6: Commit** — `feat(angular): espaces de travail — membres et fiche utilisateur (T7)`.

---

### Task 8: Angular — onglet Données

**Files:**
- Create: `angular/src/app/features/admin/espaces/onglet-donnees.component.ts` (+ `.spec.ts`)
- Modify: `angular/src/app/features/admin/espaces/fiche-espace.component.ts` (branche l'onglet)
- Modify: `ARCHITECTURE.md` (puce T8)

**Interfaces:**
- Consumes : `EspacesApi.{lireDonnees, partager, retirerPartage, modifierJeu}`, `EspacesEtatService.{espaces, recharger}`.

**Rendu** (spec § 4.4) — un tableau, tri du serveur (Propriétaire, Partagé, Socle, Non visible) : Jeu, Type, Catégorie (ou « — »), Lignes (`formaterNombre`), Statut (pastille : Propriétaire = bord `--brand-teal`, Partagé = bord `--info`, Socle = `--text-tertiary` + icône cadenas, Non visible = `--text-tertiary`), Actions :

| Statut | Actions |
|---|---|
| Propriétaire | « Transférer… » (dialogue : liste des AUTRES espaces, `nom_affiche`) → `modifierJeu(id, { organization_id })` ; « Mettre au socle » → confirmation « Il sera visible de tous les espaces clients. » → `modifierJeu(id, { visibilite: 'socle' })` |
| Partagé | « Retirer le partage » → confirmation `danger` « {espace} ne verra plus « {nom} ». » → `retirerPartage(espaceId, id)` |
| Socle | aucune ; texte « Se règle dans le socle » avec lien relatif `../socle` |
| Non visible | « Partager avec cet espace » → `partager(espaceId, id)` (sans confirmation : réversible, n'ôte rien à personne) |

Transfert : confirmation qui nomme les deux espaces (« « {nom} » passera de {source} à {cible}. {source} ne le verra plus, sauf partage. »). Après toute écriture réussie : notification, relecture de `lireDonnees(espaceId)`, `etat.recharger()` (les compteurs de jeux privés changent). Échec : notification d'erreur, tableau inchangé.

- [ ] **Step 1: Spec (échec)** — montage de l'onglet → un seul GET `admin/espaces/A/donnees` ; une ligne par statut avec ses actions (et aucune action sur « Socle ») ; « Partager » → POST `admin/organizations/A/sources/assign` au corps `{ sourceId }` puis relecture ; « Retirer le partage » → confirmation puis DELETE au même corps ; transfert vers B → PATCH `admin/sources/<id>` au corps EXACT `{ organization_id: 'B' }` ; écriture en 500 → notification, aucune relecture ; le lien « Se règle dans le socle » pointe vers `…/espaces/socle`.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; `npm run build`.**
- [ ] **Step 5: Navigateur, deux thèmes** — sur DRHAT : partager CIRFA (SQL : `shared_with` de CIRFA contient DRHAT), puis retirer le partage (SQL : vide) ; sur un espace jetable `[ESSAI espaces] Données`, transférer CIRFA vers lui puis le rendre à MARINE (SQL : `organization_id` de CIRFA = MARINE, ET `select count(*) from poi_france where data_source_id = <cirfa> and organization_id <> <marine>` = 0, puisque la route recopie l'organisation sur les POI). Captures `t8-donnees`, `t8-transfert`, deux thèmes. État final = état initial.
- [ ] **Step 6: Commit** — `feat(angular): espaces de travail — onglet Données (T8)`.

---

### Task 9: Angular — onglet Aperçu

**Files:**
- Create: `angular/src/app/features/admin/espaces/onglet-apercu.component.ts` (+ `.spec.ts`)
- Modify: `angular/src/app/features/admin/espaces/fiche-espace.component.ts`
- Modify: `ARCHITECTURE.md` (puce T9)

**Interfaces:**
- Consumes : `EspacesApi.lireApercu(id)`.

**Rendu** (spec § 4.5, E4) — encart d'explication en tête : « Ce que voit un compte client de cet espace, calculé par la même règle que la carte et les exports. » Trois sections :
- « Jeux de données visibles » : trois groupes (Du socle, Propres à l'espace, Partagés avec l'espace), chaque jeu avec type et lignes ; groupe vide → « Aucun ».
- « Catégories de POI visibles ({n}) » : pastilles, une par catégorie ; mention « Sans effectif : compter les POI d'une catégorie coûterait une lecture de la table entière. »
- « Campagnes de l'espace » : `nb_campagnes` en JetBrains Mono.
- Bouton « Recalculer » (bouton outline neutre) → relit l'aperçu (utile après une modification dans l'onglet Données, que l'aperçu ne suit pas tout seul).

Lecture à la première ouverture de l'onglet seulement (pas au montage de la fiche) ; elle peut prendre plusieurs secondes (une requête par catégorie, `getCategoriesVisibles`) : afficher « Calcul de l'aperçu… » avec la barre indéterminée de `mg-barre-progression`. Erreur → message + « Réessayer ».

- [ ] **Step 1: Spec (échec)** — monter la fiche sans ouvrir l'onglet → aucun GET `apercu` ; ouvrir → un GET ; rendu des trois groupes, « Aucun » pour un groupe vide ; « Recalculer » → second GET ; GET en 500 → message + « Réessayer ».
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; `npm run build`.**
- [ ] **Step 5: Navigateur, deux thèmes** — aperçu de la MARINE : CIRFA dans « Propres », LYCEEE / Filosofi / Brest dans « Du socle », pas de catégorie BMW. Partager CONCESSIONS BMW avec la MARINE (onglet Données), « Recalculer » → CONCESSIONS BMW apparaît sous « Partagés » et sa catégorie dans les pastilles ; retirer le partage, « Recalculer » → disparue. Captures `t9-apercu-{sombre,clair}.png` et `t9-apercu-partage-{sombre,clair}.png`. Mesurer la durée du GET `apercu` (onglet Réseau) et la citer au rapport.
- [ ] **Step 6: Commit** — `feat(angular): espaces de travail — onglet Aperçu (T9)`.

---

### Task 10: Angular — onglet Réglages

**Files:**
- Create: `angular/src/app/features/admin/espaces/onglet-reglages.component.ts` (+ `.spec.ts`)
- Modify: `angular/src/app/features/admin/espaces/fiche-espace.component.ts`
- Modify: `ARCHITECTURE.md` (puce T10)

**Interfaces:**
- Consumes : `EspacesApi.{lireEspace, modifierEspace, supprimerEspace}`, `EspacesEtatService.recharger()`.

**Rendu** (spec § 4.6) — reprend les champs de `app/admin/organizations/[id]/page.tsx:432-470` et son enregistrement l.196-240 (lire ces lignes) : Nom, Description, Quota de POI (`config.max_poi`, entier ou vide), Quota de requêtes IA (`config.max_ai_requests`, entier ou vide ; mention « Disparaîtra avec la suppression de l'IA. »), Site Centric URL (`config.site_centric_url`), Site Centric clé (`config.site_centric_key`, champ `type="password"`), puis « Enregistrer ». Corps envoyé, à l'identique de React : `{ name, description, config: { ...configLue, site_centric_url, site_centric_key, max_poi, max_ai_requests } }` — la config lue est FUSIONNÉE, jamais écrasée (d'autres clés peuvent y vivre). Section séparée « Statut » : bascule « Espace actif » → `modifierEspace(id, { active })`. Zone dangereuse : « Supprimer l'espace » → confirmation `danger` « Supprimer {nom_affiche} ? Ses {n} membres en sont retirés ; ses {m} jeux privés deviennent sans propriétaire et ne sont plus visibles que du super-administrateur. » → `supprimerEspace` → navigation relative `..` (fiche vide) et `etat.recharger()`. La suppression est INTERDITE sur l'espace interne (`interne: true`) : bouton absent, mention « L'espace interne porte les données du socle : il ne se supprime pas. »

Placeholders génériques (pas d'exemple de marque) : « https://… », « Clé d'API ».

- [ ] **Step 1: Spec (échec)** — montage de l'onglet → un GET `admin/organizations/A` ; enregistrer → PATCH au corps EXACT avec la config FUSIONNÉE (fixture dont la config porte une clé `autre: 1`, qui doit se retrouver dans le corps) ; quota vide → `null`, « 12 » → `12` ; PATCH en 500 → notification d'erreur ; espace interne → pas de bouton de suppression ; suppression confirmée → DELETE puis navigation vers `..`.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; `npm run build`.**
- [ ] **Step 5: Navigateur, deux thèmes** — sur un espace jetable `[ESSAI espaces] Réglages` : modifier le nom et un quota (SQL : `config->>'max_poi'`), le désactiver (pastille « Inactif » dans la colonne), le supprimer depuis l'onglet (SQL : absent). Captures `t10-reglages-{sombre,clair}.png`.
- [ ] **Step 6: Commit** — `feat(angular): espaces de travail — onglet Réglages (T10)`.

---

### Task 11: Bandeau React, plan du lot 6, parcours complet et documentation

**Files:**
- Modify: `app/admin/users/page.tsx`, `app/admin/organizations/page.tsx`, `app/admin/organizations/[id]/page.tsx` (bandeau en tête de page, rien d'autre)
- Modify: plan du lot 6 `docs/superpowers/plans/2026-10-06-angular-lot6-administration.md` (présent sur la branche depuis le merge de T0)
- Modify: `docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md` (ligne du lot 6 : mention des tâches remplacées)
- Modify: `ARCHITECTURE.md`, `docs/superpowers/specs/2026-10-08-espaces-de-travail-design.md` (statut : livrée, écarts E2 et E4)

- [ ] **Step 1: Bandeau React** — en tête des trois pages, sous le titre, un encart (jetons du design system : fond `var(--bg-level-2)`, bord 0,5 px `var(--border-subtle)`, texte `var(--text-secondary)`) : « Les droits se gèrent désormais dans **Espaces de travail** (interface Angular, Administration › Espaces de travail). Cette page reste disponible en lecture. » Aucune autre modification de ces pages (gel de l'administration React, lot 6).
- [ ] **Step 2: Plan du lot 6** — en tête des tâches 6, 7 et 8 : « **REMPLACÉE** (2026-10-09) par la page Espaces de travail — `docs/superpowers/plans/2026-10-09-espaces-de-travail.md`. Ne pas exécuter. » ; dans la tâche 18 : « Le partage d'une source n'est PAS porté : lien « Gérer les droits → Espaces de travail » à la place (spec espaces § 6). »
- [ ] **Step 3: Parcours complet, deux thèmes** (spec § 8), sur l'interface Angular, enregistré en captures numérotées `t11-01-…` :
  1. créer `[ESSAI espaces] Parcours` ;
  2. y créer un compte `essai-espaces-parcours@exemple.test` (lien copié) ;
  3. partager CIRFA avec l'espace (onglet Données) → l'aperçu (Recalculer) le montre sous « Partagés » ;
  4. retirer le partage → l'aperçu ne le montre plus ;
  5. mettre CONCESSIONS BMW au socle (fiche Socle) → l'aperçu de l'espace le montre sous « Du socle » ; le retirer du socle → disparu ;
  6. supprimer le compte (fiche utilisateur), puis l'espace (Réglages) ;
  7. SQL de contrôle : chiffres de référence identiques au relevé de T0 ; `select count(*) from organizations where name like '[ESSAI%'` = 0 ; `select count(*) from auth.users where email like 'essai-espaces-%'` = 0 ; CIRFA `privee` à la MARINE, `shared_with` vide ; CONCESSIONS BMW `privee` à BMW GROUP.
- [ ] **Step 4: Vérifications finales**

```bash
npx tsc --noEmit; echo "tsc=$?"
npm run test:unit
npm run test:integration
npm run lint
cd angular && npx ng test --watch=false && npm run build; cd ..
```

Toutes vertes (au défaut préexistant de zone-risque près, cité tel quel s'il apparaît).

- [ ] **Step 5: Documentation** — `ARCHITECTURE.md` : une section « Espaces de travail » (le modèle à deux colonnes, l'invariant de sql/236, les routes, l'écran) qui renvoie vers la spec ; spec : statut « livrée le … », écarts E2 et E4 consignés dans une section « Écarts à la livraison ». Mémoire : mettre à jour `project_cloisonnement_organisations.md` (l'interface de droits existe ; reste « voir comme » hors champ).
- [ ] **Step 6: Commit** — `docs: espaces de travail livrés — bandeau React, lot 6 annoté, parcours complet (T11)`.
- [ ] **Step 7: Revue de branche** — relecture de toute la branche par un relecteur frais, sur le modèle le plus capable (mémoire `feedback_angular_vigilance`), avec la spec, ce plan et la section Review Focus. Ne pas pousser ni merger sans l'accord de Vincent.

---

## Auto-relecture

- **Couverture de la spec** : § 3.1 → T1 (rattrapage, déclencheurs) + T2 (routes) ; § 3.2 → T7 (E5) ; § 3.3 → T3 (`nomAffiche`) + T5/T6 ; § 4 / 4.1 → T5 ; § 4.2 → T6 ; § 4.3 → T7 ; § 4.4 → T8 ; § 4.5 → T3 + T9 (écart E4) ; § 4.6 → T10 ; § 5.1 « vérifier que …/members écrit organization_members » → T2 (il ne l'écrivait pas) ; § 5.2 → T3 + T4 (+ `socle` et `[id]/membres`, justifiées) ; § 6 → T5 (navigation) + T11 (React, lot 6) ; § 7 → Global Constraints ; § 8 → T1 (invariant), T3 (aperçu contre vrai compte), specs T5-T10, T11 (parcours). § 10 (hors champ) respecté.
- **Placeholders** : aucun « TBD ». Les tâches Angular décrivent le comportement, les textes exacts et les cas de test plutôt que le code complet des gabarits, comme le plan du lot 6 ; le code complet est donné pour tout ce qui touche la base et les routes.
- **Cohérence des noms** : `ajouterMembre` / `retirerMembre` / `remplacerEspaces` / `messageErreurAppartenance` (T2, T4) ; `listerEspaces` / `resumerEspace` / `membresDeLEspace` / `lireEspacesBruts` (T3) ; `lireJeux` / `donneesDeLEspace` / `lireSocle` / `statutPourEspace` (T3) ; `apercuEspace` (T3) ; `EspacesApi` et `EspacesEtatService` (T5, consommés T6-T10) — vérifiés.
- **Review Focus** : chaque ligne a son test — report de l'actif et cascades (T1), rôle d'un super_admin (T2), aperçu = RLS (T3), écriture refusée visible (T6-T10).
