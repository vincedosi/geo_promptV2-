# Campagnes multi-média et panneaux OOH d'une campagne — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer les 1 434 panneaux d'essai de Brest et l'import ArcGIS par des campagnes multi-média d'espace de travail, importer le plan OOH « Marine nationale — TF4 » par un script générique à adaptateurs, et afficher les panneaux d'une campagne choisie dans « Autres » → « Panneaux OOH et DOOH » de la carte Angular.

**Architecture:** Trois tables neuves (`campagnes`, `campagne_lignes`, `campagne_ligne_panneaux`, sql/261) au-dessus de `panneaux_affichage` enrichie (sql/262) ; les panneaux d'une campagne vivent dans une source PRIVÉE de l'espace (`data_sources.visibilite = 'privee'`), donc la RLS existante (`source_visible`) les cloisonne. Lecture par deux RPC `jsonb` (sql/263) servies par deux routes `GET /api/map/ooh/campagnes[/id]`. Le script `scripts/ooh/importer-plan.ts` enchaîne des fonctions pures de `lib/ooh/plan/` (lecture exceljs → adaptateurs → géolocalisation BAN + référentiel SNCF → écriture par lots de 50). Côté Angular, un service fourni par la page (`CampagneOohService`) pilote une couche MapLibre dédiée (`couche-campagne-ooh.ts`), une section qui remplace le contenu de `mg-section-ooh` et une fiche d'emplacement.

**Tech Stack:** Next.js 15 (routes API), supabase-js, PostgreSQL 17.6 + PostGIS (stack LOCAL), exceljs, papaparse, Vitest (racine : `npm run test:unit`, `npm run test:integration`) ; Angular 21 standalone zoneless signals, Tailwind 4, Vitest (`cd angular && npx ng test --watch=false`) ; MapLibre GL 5.

**Spec:** `docs/superpowers/specs/2026-10-16-ooh-campagnes-design.md` (approuvée le 16/10). L'exécutant lit la spec ET ce plan.

## Global Constraints

- Migrations à partir de **sql/260** (257-259 réservés au lot 3). Locales, `CREATE … IF NOT EXISTS`, rejouables, **sans `DROP`** (ni table, ni fonction, ni politique : les politiques se créent dans un bloc `DO` gardé par `pg_policies`). En-tête au format de sql/251 (`-- NNN — titre (date)`, spec citée, coût, droits, « Rejouable »), corps entre `begin;` et `commit;`.
- Appliquer une migration : `docker exec -i supabase_db_genesis_app psql -U postgres -v ON_ERROR_STOP=1 < sql/NNN_….sql`. **Jamais le MCP Supabase** (il pointe sur un projet étranger, CLAUDE.md).
- **Troncature PostgREST à 1 000 lignes** (`max_rows = 1000`) : une RPC dont le résultat peut dépasser 1 000 lignes est `RETURNS jsonb`, lit `p_limite + 1` et rend `tronque`. Une table de plus de 1 000 lignes se lit par `lireTout` (`lib/supabase/lire-tout.ts`).
- Inserts par lots de **50**, **une requête par lot**, repli ligne à ligne sur échec (patron `lib/import/inserter.ts`) ; tout `upsert` suivi de `.select('id')` ; toute suppression lit son `error` et passe `{ count: 'exact' }` quand un compte est rapporté.
- Routes : `export const dynamic = 'force-dynamic'`, `createAdminClient()` de `@/lib/auth`, espace actif par `getSessionOrg(req).orgId` (patron `app/api/map/jeux-recommandes/route.ts`), Zod sur les paramètres, messages d'erreur en français ; jamais `getUser()` dans un handler. `middleware.ts` est **protégé** : ne pas le modifier (`/api/map/ooh` y est déjà un préfixe protégé, il couvre `/api/map/ooh/campagnes…` par `startsWith`).
- `ARCHITECTURE.md` (≈ 670 Ko) : **ne jamais le lire en entier** — `Grep` sur la route, la table, la RPC, puis `Read` avec `offset`/`limit`. Mis à jour DANS le commit qui ajoute ou retire une route, une table, une RPC, une dépendance externe.
- Design (DESIGN_SYSTEM.md) : dark minimal, sentence case, jamais de couleur en dur (`var(--jeton)` en CSS ; valeur CALCULÉE par `CouleursService` pour MapLibre — **jamais `var()` dans `paint`**). Tout jeton neuf est défini dans `app/globals.css` (`:root` ET `html.light`) ET `angular/src/styles/jetons.css` (`:root, :host` ET `html.light, :host(.light)`), mêmes valeurs, documenté dans DESIGN_SYSTEM.md. Pas de violet.
- Nouveaux types de domaine préfixés (`MediaLigne`, `LignePlan`, `CampagneOohResume`…) : « campagne » est déjà pris par `dsp_campaigns`, `CampagnePlan` et l'étape campagne du module risque.
- **Aucune donnée client dans le dépôt** : `PM OOH/` est exclu par `.git/info/exclude` ; les tests construisent des classeurs synthétiques avec exceljs. Les noms de gares du référentiel public SNCF et de la table d'alias ne sont pas des données client.
- Script d'import : lit `.env.development.local` puis `.env.local` (cet ordre EST le garde-fou), jamais une clé en dur ; rapport CSV écrit HORS du dépôt.
- Angular : standalone, signals, zoneless ; services de carte `@Injectable()` sans `providedIn`, fournis par `CartePage` (un changement d'espace RECRÉE la page — `carte-hote.component.ts` — et détruit donc leur état) ; l'API Angular passe par des méthodes de `CarteApi` (déjà dans `FOURNISSEURS_DISTANTS`). Édition de fichiers par Edit/Write uniquement (PowerShell double-encode les accents).
- Vérifier sans pipe : `npx tsc --noEmit` rend 0 par son propre code de retour.
- Chaque tâche qui ajoute ou retire un export de `app/`, `lib/`, `components/`, `types/` relance `npm run catalogue` et commite `docs/CATALOGUE_CODE.md` (`tests/unit/docs/catalogue-code.test.ts` compare le fichier à la mesure, cliquet `CLIQUET_EXPORTS_MORTS = 141`, on ne le relève pas). knip compte aussi les TYPES et les exports employés dans leur seul fichier : si la mesure dépasse 141 après une tâche, retirer le mot-clé `export` des symboles NEUFS de ce chantier que `docs/CATALOGUE_CODE.md` liste comme morts (types et constantes internes : `Duree`, `SEUIL_SUR`, `URL_REFERENTIEL_GARES`, `PlanLu`…) jusqu'à revenir à ≤ 141 — jamais ceux d'un autre fichier, jamais le cliquet — et le dire dans le rapport de tâche. Les blocs « Interfaces » restent la référence des noms.
- Git : préfixer `export PATH="/c/GENESIS/PortableGit/cmd:$PATH"` dans Git Bash. Commits atomiques `type: description` en français, terminés par la ligne `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

### Préparation du worktree (une fois, avant la tâche 1)

Le worktree `C:\GENESIS\genesis_app\.claude\worktrees\ooh-campagnes` n'a ni `node_modules` ni fichiers d'environnement (non suivis). Depuis Git Bash :

```bash
cd /c/GENESIS/genesis_app/.claude/worktrees/ooh-campagnes
cp ../../../.env.development.local ../../../.env.local .
cmd //c "mklink /J node_modules ..\\..\\..\\node_modules"
cmd //c "mklink /J angular\\node_modules ..\\..\\..\\..\\angular\\node_modules"
docker exec supabase_db_genesis_app psql -U postgres -tAc "select count(*) from panneaux_affichage"
```

Attendu : la dernière commande rend `1434` (sinon monter la base : `scripts/local/00-docker-up.sh` puis `01-supabase-up.sh`). `.env*.local` et `node_modules` sont ignorés par git.

## Review Focus

1. **Libellé Basic-Fit contenant un autre nombre que le code club** (« … Rue du 8 Mai 1945 6789 NC ») : le code retenu est celui que suit un type de lecteur (6789), jamais l'année de la rue — test dans la tâche 6 (`basic-fit.test.ts`, cas « Rue du 8 Mai 1945 »).
2. **Nom de gare composé dont la PREMIÈRE partie est une autre gare** (« BOIS COLOMBES - LES VALLEES » tombait sur « Bois-Colombes » avec l'ordre de la spec ; mesuré le 16/10 sur TF4 : 11 paires de la liste fusionnées sur un même code UIC) : ordre plein → dernière partie → première + dernière → première, et une correspondance par la seule première partie est `a_verifier` — test dans la tâche 7 (`gares-sncf.test.ts`, « la dernière partie passe avant la première »).
3. **Rejeu après la disparition d'un emplacement de la liste de la régie** : le panneau retiré quitte la table (sinon il resterait visible dans l'espace, hors campagne), les autres gardent leur `id` — test d'intégration de la tâche 8 (`importer-plan-ooh.test.ts`, « rejeu sans un emplacement »).
4. **Adresse dont la BAN rend une autre ville ou un autre code postal avec un bon score** : jamais `sure` — test de la tâche 7 (`geolocaliser.test.ts`, « ville ou CP différents »).
5. **Réponse de campagne qui arrive après « Tout effacer » ou après le choix d'une autre campagne** : elle ne peint rien (lecture désabonnée) — test de la tâche 10 (`campagne-ooh.service.spec.ts`, « une réponse en vol après fermer() est ignorée »).

## Carte des fichiers

| Fichier | Rôle | Tâche |
|---|---|---|
| `sql/260_purge_panneaux_brest.sql` | purge rejouable de Brest | 1 |
| `sql/261_campagnes_multi_media.sql` | 3 tables, index, RLS | 2 |
| `sql/262_panneaux_enrichis.sql` | 12 colonnes de `panneaux_affichage` | 3 |
| `sql/263_campagne_ooh_jsonb.sql` | `campagne_ooh_jsonb`, `campagnes_ooh_jsonb` | 4 |
| `types/campagnes-media.ts` | types du plan (classeur, lignes, emplacements, adaptateurs) | 5 |
| `lib/ooh/plan/texte.ts`, `classeur.ts`, `durees.ts`, `fusion.ts` | lecture et normalisation | 5 |
| `lib/ooh/plan/adaptateurs/synthese-hyp.ts` | onglet de synthèse → en-tête et lignes | 5 |
| `lib/ooh/plan/adaptateurs/{mediatransports-gares,basic-fit,stride-campus,index}.ts` | listes des régies, rattachement | 6 |
| `lib/ooh/plan/gares-sncf.ts`, `geolocaliser.ts` | référentiel SNCF + alias, BAN | 7 |
| `lib/ooh/plan/ecrire.ts`, `rapport.ts`, `arguments.ts`, `scripts/ooh/importer-plan.ts` | écriture, rapport, CLI | 8 |
| `app/api/map/ooh/campagnes/route.ts`, `…/[id]/route.ts` | lecture | 9 |
| `angular/src/app/features/carte/logique/campagnes-ooh.ts` | types et logique pure de l'overlay | 10 |
| `angular/src/app/features/carte/couches/couche-campagne-ooh.ts`, `campagne-ooh.service.ts` | couche dédiée, état | 10 |
| `angular/src/app/features/carte/panneaux/calques/section-ooh.component.ts` (réécrit), `couches/fiche-emplacement-ooh.component.ts` | overlay, fiche | 11 |
| (aucun fichier de code) | import réel de TF4, preuve navigateur, écarts § 12 — contrôleur | 12 |

---

### Task 1: Purge de Brest et retrait de l'import ArcGIS

**Files:**
- Create: `sql/260_purge_panneaux_brest.sql`
- Create: `tests/integration/purge-panneaux-brest.test.ts`
- Create: `tests/unit/ooh/import-arcgis-retire.test.ts`
- Delete: `app/api/admin/import-ooh/arcgis/route.ts`, `app/admin/ooh-import/page.tsx`
- Modify: `components/AppSidebar.tsx:13,72` · `app/dashboard/page.tsx:6,90` · `components/map/overlays/SettingsOverlay.tsx:58` · `angular/src/app/layout/navigation.ts:52` · `angular/src/app/layout/barre-laterale.component.spec.ts:30-31,39-42` · `angular/src/app/features/carte/panneaux/reglages.component.ts:18` · `angular/src/app/features/carte/panneaux/reglages.component.spec.ts:51-60` · `angular/src/app/features/accueil/accueil.page.ts:22` · `angular/src/app/features/accueil/accueil.page.spec.ts:62-65` · `lib/import/inserter.ts:193-194` · `lib/format/nombre.ts:14` · `tests/unit/api/quotas-partages.test.ts:41-53` · `ARCHITECTURE.md` (≈ lignes 274, 1170, 1611, 1666-1669, 1843) · `docs/CATALOGUE_CODE.md` (régénéré)

**Interfaces:**
- Consumes: rien.
- Produces: une base sans aucun panneau `source = 'custom_geo_brest-metropole_fr'`, sans la source « Brest Métropole 2026 » ni son passage `import_runs_ooh` ; plus aucune route ni page ArcGIS, ni lien qui y mène.

- [ ] **Step 1: Écrire le test d'intégration de la purge**

`tests/integration/purge-panneaux-brest.test.ts` :

```ts
/**
 * sql/260 — purge des 1 434 panneaux d'essai de Brest (spec 2026-10-16-ooh-campagnes § 4.1).
 *
 * Le fichier est APPLIQUÉ par ce test (psql dans le conteneur, comme scripts/seed-demo-campagne-risque.ts) : deux
 * passages réussissent, le second sans rien supprimer. La garde est éprouvée sur une source factice qui porte un
 * panneau d'une AUTRE source : la purge doit refuser.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerClientTest } from './_client';

const admin = creerClientTest();
const CONTENEUR = process.env.CONTENEUR_PG ?? 'supabase_db_genesis_app';
const SOURCE_BREST = 'custom_geo_brest-metropole_fr';

function appliquer(): { statut: number | null; sortie: string } {
  const r = spawnSync('docker', ['exec', '-i', CONTENEUR, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
    input: readFileSync('sql/260_purge_panneaux_brest.sql', 'utf8'),
    encoding: 'utf8',
  });
  return { statut: r.status, sortie: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

let org = '';
beforeAll(async () => {
  const { data, error } = await admin.from('organizations')
    .insert({ name: '[ESSAI ooh] Purge Brest', slug: `essai-ooh-purge-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(`création de l'espace : ${error?.message}`);
  org = data.id as string;
});
afterAll(async () => {
  const { error: e1 } = await admin.from('panneaux_affichage').delete().eq('source', 'essai-purge-etrangere');
  if (e1) throw new Error(`nettoyage panneaux : ${e1.message}`);
  const { error: e2 } = await admin.from('organizations').delete().eq('id', org);
  if (e2) throw new Error(`nettoyage espace : ${e2.message}`);
});

describe('sql/260 — purge des panneaux de Brest', () => {
  it('appliquée deux fois : les deux passages réussissent, le second ne supprime rien', () => {
    const premier = appliquer();
    expect(premier.statut, premier.sortie).toBe(0);
    const second = appliquer();
    expect(second.statut, second.sortie).toBe(0);
    expect(second.sortie).toContain('purge Brest : 0 panneau(x), 0 passage(s) d\'import, 0 source(s) supprimés');
  });

  it('plus aucun panneau, aucune source ni aucun passage d import de Brest', async () => {
    const { count: panneaux, error: e1 } = await admin.from('panneaux_affichage')
      .select('id', { count: 'exact', head: true }).eq('source', SOURCE_BREST);
    expect(e1).toBeNull();
    expect(panneaux).toBe(0);
    const { data: sources, error: e2 } = await admin.from('data_sources').select('id').eq('mapping->>source_key', SOURCE_BREST);
    expect(e2).toBeNull();
    expect(sources).toEqual([]);
    const { data: passages, error: e3 } = await admin.from('import_runs_ooh').select('id').eq('source', 'Brest Métropole 2026');
    expect(e3).toBeNull();
    expect(passages).toEqual([]);
  });

  it('refuse de purger une source qui porte un panneau d une autre source', async () => {
    const { data: ds, error } = await admin.from('data_sources').insert({
      organization_id: org, name: '[ESSAI ooh] source piégée', type: 'panneaux', visibilite: 'privee',
      mapping: { source_key: SOURCE_BREST },
    }).select('id').single();
    if (error || !ds) throw new Error(`source factice : ${error?.message}`);
    const { error: ep } = await admin.from('panneaux_affichage').insert({
      lat: 48.39, lng: -4.49, source: 'essai-purge-etrangere', source_ref: '1', data_source_id: ds.id, organization_id: org,
    });
    expect(ep).toBeNull();
    const r = appliquer();
    expect(r.statut).not.toBe(0);
    expect(r.sortie).toContain('purge Brest refusée');
    const { count } = await admin.from('panneaux_affichage').select('id', { count: 'exact', head: true }).eq('source', 'essai-purge-etrangere');
    expect(count).toBe(1);
    const { error: ed } = await admin.from('panneaux_affichage').delete().eq('source', 'essai-purge-etrangere');
    expect(ed).toBeNull();
    const { error: es } = await admin.from('data_sources').delete().eq('id', ds.id);
    expect(es).toBeNull();
  });
});
```

- [ ] **Step 2: Le lancer, il échoue**

Run: `npx vitest run --project integration tests/integration/purge-panneaux-brest.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open 'sql/260_purge_panneaux_brest.sql'`.

- [ ] **Step 3: Écrire la migration**

`sql/260_purge_panneaux_brest.sql` :

```sql
-- 260 — Purge des panneaux de Brest : c'était un essai (2026-10-16)
--
-- Spec : docs/superpowers/specs/2026-10-16-ooh-campagnes-design.md § 1 (décision 1) et § 4.1.
-- Les 1 434 panneaux de la source « Brest Métropole 2026 » (`source = 'custom_geo_brest-metropole_fr'`), écrits en
-- 2026-07 par l'import ArcGIS (supprimé dans le même commit), étaient un test. On retire les panneaux, le seul passage
-- de `import_runs_ooh` qui les a écrits, puis la ligne `data_sources`.
--
-- Garde : le bloc REFUSE (P0001) si la source porte autre chose que des panneaux de Brest — un panneau d'une autre
-- `source`, ou un POI de `poi_france` — ou si un panneau de Brest est réservé par une campagne
-- (`campagne_ligne_panneaux`, sql/261 ; testée par `to_regclass`, la table n'existant pas avant 261).
-- Chaque suppression lit son résultat (`GET DIAGNOSTICS`) et le dit (`RAISE NOTICE`).
--
-- Mesuré le 2026-10-16 (base locale) : 1 434 panneaux, une source (640a8b18-f08c-4eb3-bbde-f51b6ddbfe16), un passage
-- `import_runs_ooh` (5a5f67b3-2be6-4cfa-af91-fde3a57f38c4), aucune clé étrangère vers `panneaux_affichage`.
-- Coût : 1 434 suppressions par `source` (index unique (source, source_ref), `source` en tête), une seule fois.
-- Rejouable : sur une base déjà purgée, la source est introuvable, tout compte 0, rien n'est supprimé.

begin;

do $$
declare
  c_source    constant text := 'custom_geo_brest-metropole_fr';
  v_ds        uuid;
  v_nom       text;
  v_run       uuid;
  n_etrangers integer := 0;
  n_poi       integer := 0;
  n_reserves  integer := 0;
  n_panneaux  integer;
  n_runs      integer;
  n_sources   integer;
begin
  select id, name, nullif(mapping->>'run_id', '')::uuid
    into v_ds, v_nom, v_run
    from public.data_sources
   where type = 'panneaux' and mapping->>'source_key' = c_source
   order by import_date
   limit 1;

  if v_ds is not null then
    select count(*) into n_etrangers
      from public.panneaux_affichage
     where data_source_id = v_ds and source is distinct from c_source;
    select count(*) into n_poi from public.poi_france where data_source_id = v_ds;
    if n_etrangers > 0 or n_poi > 0 then
      raise exception 'purge Brest refusée : la source % porte % panneau(x) d''une autre source et % POI',
        v_ds, n_etrangers, n_poi using errcode = 'P0001';
    end if;
  end if;

  if to_regclass('public.campagne_ligne_panneaux') is not null then
    execute 'select count(*) from public.campagne_ligne_panneaux clp
               join public.panneaux_affichage p on p.id = clp.panneau_id
              where p.source = $1'
       into n_reserves using c_source;
    if n_reserves > 0 then
      raise exception 'purge Brest refusée : % panneau(x) de Brest réservé(s) par une campagne', n_reserves
        using errcode = 'P0001';
    end if;
  end if;

  delete from public.panneaux_affichage where source = c_source;
  get diagnostics n_panneaux = row_count;

  delete from public.import_runs_ooh
   where (v_run is not null and id = v_run)
      or (v_nom is not null and source = v_nom);
  get diagnostics n_runs = row_count;

  delete from public.data_sources where id = v_ds;
  get diagnostics n_sources = row_count;

  raise notice 'purge Brest : % panneau(x), % passage(s) d''import, % source(s) supprimés', n_panneaux, n_runs, n_sources;

  if exists (select 1 from public.panneaux_affichage where source = c_source) then
    raise exception 'purge Brest incomplète : des panneaux de Brest subsistent' using errcode = 'P0001';
  end if;
end
$$;

commit;
```

- [ ] **Step 4: Appliquer en local et relancer le test**

Run: `docker exec -i supabase_db_genesis_app psql -U postgres -v ON_ERROR_STOP=1 < sql/260_purge_panneaux_brest.sql`
Expected: `NOTICE:  purge Brest : 1434 panneau(x), 1 passage(s) d'import, 1 source(s) supprimés`, puis `COMMIT`.

Run: `npx vitest run --project integration tests/integration/purge-panneaux-brest.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Écrire le test du retrait d'ArcGIS**

`tests/unit/ooh/import-arcgis-retire.test.ts` :

```ts
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * L'import ArcGIS de Brest est supprimé (spec 2026-10-16-ooh-campagnes § 1 décision 6, § 10) : route, page, et tout
 * lien qui y menait — React (gelé, mais un lien mort y mènerait à un 404) comme Angular.
 */
const RACINE = process.cwd();

function fichiers(dossier: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(dossier)) {
    if (nom === 'node_modules' || nom === '.next') continue;
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) out.push(...fichiers(chemin));
    else if (/\.(ts|tsx|html)$/.test(nom)) out.push(chemin);
  }
  return out;
}

describe('import ArcGIS — retiré', () => {
  it('la route et la page n existent plus', () => {
    expect(existsSync(join(RACINE, 'app', 'api', 'admin', 'import-ooh', 'arcgis', 'route.ts'))).toBe(false);
    expect(existsSync(join(RACINE, 'app', 'admin', 'ooh-import', 'page.tsx'))).toBe(false);
  });

  it('aucun lien ni appel ne vise /admin/ooh-import ou /api/admin/import-ooh', () => {
    const candidats = ['app', 'components', 'lib', join('angular', 'src')].flatMap((d) => fichiers(join(RACINE, d)));
    const fautifs = candidats
      .filter((f) => /['"`]\/admin\/ooh-import['"`]|\/api\/admin\/import-ooh/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(RACINE, f).split(sep).join('/'));
    expect(fautifs).toEqual([]);
  });

  it('plus aucune entrée « Import OOH » dans la navigation Angular', () => {
    for (const f of [
      'angular/src/app/layout/navigation.ts',
      'angular/src/app/features/carte/panneaux/reglages.component.ts',
      'angular/src/app/features/accueil/accueil.page.ts',
    ]) {
      expect(readFileSync(join(RACINE, f), 'utf8'), f).not.toMatch(/libelle:\s*'Import OOH'/);
    }
  });
});
```

- [ ] **Step 6: Le lancer, il échoue**

Run: `npx vitest run --project unit tests/unit/ooh/import-arcgis-retire.test.ts`
Expected: FAIL — les trois tests (fichiers présents, liens présents, entrées « Import OOH »).

- [ ] **Step 7: Supprimer la route, la page et les liens**

```bash
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git rm app/api/admin/import-ooh/arcgis/route.ts app/admin/ooh-import/page.tsx
```

Puis, à l'outil Edit :

- `components/AppSidebar.tsx` : supprimer la ligne 72 `      { href: '/admin/ooh-import', label: 'Import OOH', icon: Monitor, badge: 'Admin' },` et la ligne 13 `  Monitor,` (plus aucun autre usage).
- `app/dashboard/page.tsx` : supprimer la ligne 90 `    { href: '/admin/ooh-import',       icon: Monitor,  label: 'Import OOH',       sub: 'Panneaux ArcGIS' },` ; la ligne 6 devient `  MapPin, Layers, FileUp, Database, Users,`.
- `components/map/overlays/SettingsOverlay.tsx` : supprimer la ligne 58 `  { href: '/admin/ooh-import', label: 'Import OOH', icon: FileUp },` (`FileUp` reste employé).
- `angular/src/app/layout/navigation.ts` : supprimer la ligne 52 `      { href: '/admin/ooh-import', libelle: 'Import OOH', icone: 'ecran', badge: 'Admin', cible: null },`.
- `angular/src/app/features/carte/panneaux/reglages.component.ts` : supprimer la ligne 18 `  { libelle: 'Import OOH', icone: 'fichier-haut' },` ; dans le commentaire de classe, « les huit autres restent INERTES » devient « les sept autres restent INERTES ».
- `angular/src/app/features/accueil/accueil.page.ts` : supprimer la ligne 22 `  { icone: 'ecran', libelle: 'Import OOH', sous: 'Panneaux ArcGIS', cible: null },`.
- `angular/src/app/layout/barre-laterale.component.spec.ts` : la liste « Administration » attendue devient `'Import Shapefile', 'Import POI', 'IRIS Crawler', 'Radio FM/DAB+', 'Connexions API',` ; le test des badges est renommé `'badges « Admin » sur les cinq entrées d\'administration, « Sys » sur les deux dernières du système'` et attend `['Admin', 'Admin', 'Admin', 'Admin', 'Admin', 'Sys', 'Sys']`.
- `angular/src/app/features/carte/panneaux/reglages.component.spec.ts` : le test est renommé `'« Back office » : « Accès » en tête (remplace « Organisations (workspaces) » et « Utilisateurs »), puis les huit autres liens de React ; seules les pages non portées restent inertes'` ; retirer `'Import OOH', ` des deux listes attendues (lignes 55 et 60).
- `angular/src/app/features/accueil/accueil.page.spec.ts` : le test est renommé `'rend quatre cartes de navigation inertes, avec leur infobulle, et « Accès » active vers admin/acces'` et attend `expect(liens.length).toBe(4);`.
- `lib/import/inserter.ts:193-194` : le commentaire devient
  ```ts
  // NB : le type 'panneaux' a été retiré avec la page /integration-panneaux
  // (2026-07-02). L'import ArcGIS (/admin/ooh-import) est supprimé depuis le 2026-10-16 :
  // plus aucun import de panneaux depuis l'interface (spec 2026-10-16-ooh-campagnes).
  ```
- `lib/format/nombre.ts:14` : `carreaux-import, campaign, ooh-import, admin/imports, DspPanel, ZoneAudienceStats` devient `carreaux-import, campaign, ooh-import (page supprimée le 2026-10-16), admin/imports, DspPanel, ZoneAudienceStats`.

- [ ] **Step 8: Réécrire le test des quotas sur une clé d'essai**

`checkImportRateLimit` n'avait qu'un appelant, la route ArcGIS : il n'existe PAS de clé encore vivante (écart à la spec § 10, signalé). Le test vérifie un mécanisme (compteur en base, refus, échec ouvert), pas une route. Dans `tests/unit/api/quotas-partages.test.ts`, remplacer les lignes 41 à 53 (jusqu'à `const r = await checkImportRateLimit('import-ooh-arcgis');` inclus) par :

```ts
describe('checkImportRateLimit — quota partagé des imports', () => {
  // Clé d'ESSAI : le seul appelant de checkImportRateLimit (l'import ArcGIS) est supprimé depuis le 2026-10-16.
  // Le test porte sur le mécanisme — compteur en base, refus, échec ouvert —, pas sur une route.
  const CLE = 'import-essai-quota';

  it('interroge le compteur en base, pas une Map locale', async () => {
    await checkImportRateLimit(CLE);
    expect(appelsRpc).toHaveLength(1);
    expect(appelsRpc[0].nom).toBe('consommer_quota');
    expect(appelsRpc[0].args).toEqual({
      p_cle: `import:${CLE}`, p_max: 3, p_fenetre_s: 60,
    });
  });

  it('refuse quand la base dit que le quota est depasse', async () => {
    reponse.data = { ok: false, retry_s: 42 };
    const r = await checkImportRateLimit(CLE);
```

(la suite, à partir de `    expect(r.ok).toBe(false);`, est inchangée).

- [ ] **Step 9: Mettre à jour ARCHITECTURE.md**

Par `Grep` puis Edit :
- `│   │   ├── ooh-import/         # Import panneaux OOH depuis ArcGIS REST` (≈ ligne 274) : supprimer la ligne.
- `| \`/api/admin/import-ooh/arcgis\` | POST/DELETE | Import OOH ArcGIS REST |` (≈ 1611) : supprimer la ligne.
- `| \`socle\` | toutes les organisations | lycees, carroyage Filosofi, inventaire Brest Metropole |` (≈ 1170) devient `| \`socle\` | toutes les organisations | lycees, carroyage Filosofi |`.
- dans le paragraphe `> La page \`/integration-panneaux\`` (≈ 1666-1669), la phrase « Les panneaux s'importent via `/admin/ooh-import` (ArcGIS REST → `panneaux_affichage`). » devient « L'import ArcGIS (`/admin/ooh-import`, `/api/admin/import-ooh/arcgis`) est supprimé le 2026-10-16 avec les 1 434 panneaux de Brest qu'il avait écrits (sql/260) : plus aucun import de panneaux depuis l'interface. »
- ligne de table `| \`panneaux_affichage\` |` (≈ 1843) : la description devient `Panneaux OOH/DOOH — table unique (carte). **Vide depuis la purge de Brest du 2026-10-16 (sql/260)**` et les notes `UNIQUE (source, source_ref), filtrer \`actif = true\``.

- [ ] **Step 10: Vérifier, régénérer le catalogue**

Run: `npx vitest run --project unit tests/unit/ooh/import-arcgis-retire.test.ts tests/unit/api/quotas-partages.test.ts tests/unit/docs/derive-documentation.test.ts tests/unit/espaces/lien-page-acces.test.ts`
Expected: PASS.

Run: `cd angular && npx ng test --watch=false --include='src/app/layout/barre-laterale.component.spec.ts' --include='src/app/features/carte/panneaux/reglages.component.spec.ts' --include='src/app/features/accueil/accueil.page.spec.ts'`
Expected: PASS.

Run: `npx tsc --noEmit` (code de retour 0), puis `npm run catalogue`, puis `npx vitest run --project unit tests/unit/docs/catalogue-code.test.ts`
Expected: PASS — exports morts ≤ 141. Si la suppression rend un export mort, le dire dans le rapport de tâche sans relever le cliquet.

- [ ] **Step 11: Commit**

```bash
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add sql/260_purge_panneaux_brest.sql tests/integration/purge-panneaux-brest.test.ts tests/unit/ooh/import-arcgis-retire.test.ts \
  components/AppSidebar.tsx app/dashboard/page.tsx components/map/overlays/SettingsOverlay.tsx \
  angular/src/app/layout/navigation.ts angular/src/app/layout/barre-laterale.component.spec.ts \
  angular/src/app/features/carte/panneaux/reglages.component.ts angular/src/app/features/carte/panneaux/reglages.component.spec.ts \
  angular/src/app/features/accueil/accueil.page.ts angular/src/app/features/accueil/accueil.page.spec.ts \
  lib/import/inserter.ts lib/format/nombre.ts tests/unit/api/quotas-partages.test.ts ARCHITECTURE.md docs/CATALOGUE_CODE.md
git commit -m "feat: purge des panneaux de Brest (sql/260) et retrait de l'import ArcGIS" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Tables des campagnes multi-média (sql/261) et leur cloisonnement

**Files:**
- Create: `sql/261_campagnes_multi_media.sql`
- Create: `tests/integration/campagnes-media.test.ts`
- Modify: `tests/integration/cloisonnement-rls.test.ts` (nouveau `describe` en fin de fichier)
- Modify: `types/database.types.ts` (trois blocs de table, avant `      campaign_cp_rollup: {`)
- Modify: `sql/SETUP.md` (tableau « Tables créées »)
- Modify: `ARCHITECTURE.md` (nouvelle sous-section des tables, après le tableau « POI & Panneaux »)

**Interfaces:**
- Consumes: rien.
- Produces (base) :
  - `campagnes(id uuid pk, organization_id uuid not null → organizations on delete cascade, nom text not null, annonceur text, vague text, date_debut date, date_fin date, budget_total_ttc numeric, cle_import text, metadata jsonb not null default '{}', created_at, updated_at)`, `unique (organization_id, cle_import)`.
  - `campagne_lignes(id uuid pk, campagne_id → campagnes on delete cascade, media text check in ('digital','ooh','tv','radio','presse'), ordre int not null, regie, reseau, territoire text, nb_ecrans int, format text, nb_diffusions int, date_debut, date_fin date, duree_libelle, rang_option, plage_horaire text, montant_brut, montant_net, frais, honoraires, total_ttc numeric, contacts_15_plus, contacts_18_24 bigint, details jsonb not null default '{}', data_source_id → data_sources on delete set null, created_at)`, `unique (campagne_id, ordre)`.
  - `campagne_ligne_panneaux(ligne_id → campagne_lignes on delete cascade, panneau_id → panneaux_affichage on delete RESTRICT, nb_ecrans int, formats text[], details jsonb not null default '{}', created_at, primary key (ligne_id, panneau_id))`.
  - Droits : `select` pour `authenticated` sous RLS (son espace, ou super_admin), tout pour `service_role`.

- [ ] **Step 1: Écrire les tests d'intégration**

`tests/integration/campagnes-media.test.ts` :

```ts
/**
 * sql/261 — campagnes multi-média (spec 2026-10-16-ooh-campagnes § 4.2) : contraintes et suppressions en cascade, et
 * le RESTRICT qui interdit de supprimer en silence un panneau réservé par une campagne.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerClientTest } from './_client';

const admin = creerClientTest();
const SOURCE = `essai-campagnes-${Date.now()}`;
let org = '';
let ds = '';
let panneau = '';

beforeAll(async () => {
  const { data: o, error: eo } = await admin.from('organizations')
    .insert({ name: '[ESSAI ooh] Campagnes', slug: `essai-ooh-campagnes-${Date.now()}` }).select('id').single();
  if (eo || !o) throw new Error(`espace : ${eo?.message}`);
  org = o.id as string;
  const { data: d, error: ed } = await admin.from('data_sources')
    .insert({ organization_id: org, name: '[ESSAI ooh] source', type: 'panneaux', visibilite: 'privee' }).select('id').single();
  if (ed || !d) throw new Error(`source : ${ed?.message}`);
  ds = d.id as string;
  const { data: p, error: ep } = await admin.from('panneaux_affichage')
    .insert({ lat: 47.9, lng: 1.9, source: SOURCE, source_ref: '1', data_source_id: ds, organization_id: org }).select('id').single();
  if (ep || !p) throw new Error(`panneau : ${ep?.message}`);
  panneau = p.id as string;
});

afterAll(async () => {
  const { error: e1 } = await admin.from('campagnes').delete().eq('organization_id', org);
  if (e1) throw new Error(`nettoyage campagnes : ${e1.message}`);
  const { error: e2 } = await admin.from('panneaux_affichage').delete().eq('source', SOURCE);
  if (e2) throw new Error(`nettoyage panneaux : ${e2.message}`);
  const { error: e3 } = await admin.from('organizations').delete().eq('id', org);
  if (e3) throw new Error(`nettoyage espace : ${e3.message}`);
});

async function creerCampagne(cle: string | null): Promise<string> {
  const { data, error } = await admin.from('campagnes')
    .insert({ organization_id: org, nom: `[ESSAI] ${cle ?? 'sans clé'}`, cle_import: cle }).select('id').single();
  if (error || !data) throw new Error(`campagne : ${error?.message}`);
  return data.id as string;
}

describe('sql/261 — campagnes, lignes, panneaux de ligne', () => {
  it('une clé d import est unique dans un espace ; sans clé, rien n est contraint', async () => {
    await creerCampagne('essai-unique');
    const { error } = await admin.from('campagnes').insert({ organization_id: org, nom: 'doublon', cle_import: 'essai-unique' });
    expect(error?.code).toBe('23505');
    await creerCampagne(null);
    await creerCampagne(null);
  });

  it('le média d une ligne est l un des cinq, l ordre est unique dans la campagne', async () => {
    const c = await creerCampagne('essai-media');
    const { error: e1 } = await admin.from('campagne_lignes').insert({ campagne_id: c, media: 'affichage', ordre: 1 });
    expect(e1?.code).toBe('23514');
    for (const media of ['digital', 'ooh', 'tv', 'radio', 'presse']) {
      const { error } = await admin.from('campagne_lignes').insert({ campagne_id: c, media, ordre: ['digital', 'ooh', 'tv', 'radio', 'presse'].indexOf(media) + 1 });
      expect(error, media).toBeNull();
    }
    const { error: e2 } = await admin.from('campagne_lignes').insert({ campagne_id: c, media: 'ooh', ordre: 1 });
    expect(e2?.code).toBe('23505');
  });

  it('une date de fin avant le début est refusée', async () => {
    const { error } = await admin.from('campagnes')
      .insert({ organization_id: org, nom: 'dates', date_debut: '2026-09-20', date_fin: '2026-09-19' });
    expect(error?.code).toBe('23514');
  });

  it('supprimer une campagne emporte ses lignes et leurs panneaux de ligne, pas les panneaux', async () => {
    const c = await creerCampagne('essai-cascade');
    const { data: l, error: el } = await admin.from('campagne_lignes')
      .insert({ campagne_id: c, media: 'ooh', ordre: 1, data_source_id: ds }).select('id').single();
    if (el || !l) throw new Error(`ligne : ${el?.message}`);
    const { error: elien } = await admin.from('campagne_ligne_panneaux').insert({ ligne_id: l.id, panneau_id: panneau, nb_ecrans: 2, formats: ['WW'] });
    expect(elien).toBeNull();
    const { error: ed } = await admin.from('campagnes').delete().eq('id', c);
    expect(ed).toBeNull();
    const { data: liens } = await admin.from('campagne_ligne_panneaux').select('ligne_id').eq('ligne_id', l.id);
    expect(liens).toEqual([]);
    const { data: restant } = await admin.from('panneaux_affichage').select('id').eq('id', panneau);
    expect(restant).toHaveLength(1);
  });

  it('un panneau réservé par une campagne ne se supprime pas en silence (RESTRICT)', async () => {
    const c = await creerCampagne('essai-restrict');
    const { data: l } = await admin.from('campagne_lignes').insert({ campagne_id: c, media: 'ooh', ordre: 1 }).select('id').single();
    await admin.from('campagne_ligne_panneaux').insert({ ligne_id: l!.id, panneau_id: panneau });
    const { error } = await admin.from('panneaux_affichage').delete().eq('id', panneau);
    expect(error?.code).toBe('23503');
    const { error: ed } = await admin.from('campagnes').delete().eq('id', c);
    expect(ed).toBeNull();
  });

  it('updated_at suit la dernière modification', async () => {
    const c = await creerCampagne('essai-maj');
    const { data: avant } = await admin.from('campagnes').select('updated_at').eq('id', c).single();
    await new Promise((r) => setTimeout(r, 20));
    await admin.from('campagnes').update({ vague: 'TF4' }).eq('id', c);
    const { data: apres } = await admin.from('campagnes').select('updated_at').eq('id', c).single();
    expect(new Date(apres!.updated_at as string).getTime()).toBeGreaterThan(new Date(avant!.updated_at as string).getTime());
  });
});
```

Dans `tests/integration/cloisonnement-rls.test.ts`, ajouter en fin de fichier :

```ts
describe('campagnes — un espace ne voit que les siennes, et leurs panneaux privés', () => {
  const SOURCE = `essai-cloisonnement-campagne-${Date.now()}`;
  let campagne = '';
  let ligne = '';
  let panneau = '';
  let source = '';

  beforeAll(async () => {
    const { marine } = comptes;
    const { data: ds, error: eds } = await admin.from('data_sources')
      .insert({ organization_id: marine.orgId, name: '[ESSAI] campagne privée', type: 'panneaux', visibilite: 'privee' }).select('id').single();
    if (eds || !ds) throw new Error(`source : ${eds?.message}`);
    source = ds.id as string;
    const { data: p, error: ep } = await admin.from('panneaux_affichage')
      .insert({ lat: 48.1, lng: -1.6, source: SOURCE, source_ref: '1', data_source_id: source, organization_id: marine.orgId }).select('id').single();
    if (ep || !p) throw new Error(`panneau : ${ep?.message}`);
    panneau = p.id as string;
    const { data: c, error: ec } = await admin.from('campagnes')
      .insert({ organization_id: marine.orgId, nom: '[ESSAI] campagne Marine', cle_import: SOURCE }).select('id').single();
    if (ec || !c) throw new Error(`campagne : ${ec?.message}`);
    campagne = c.id as string;
    const { data: l, error: el } = await admin.from('campagne_lignes')
      .insert({ campagne_id: campagne, media: 'ooh', ordre: 1, data_source_id: source }).select('id').single();
    if (el || !l) throw new Error(`ligne : ${el?.message}`);
    ligne = l.id as string;
    const { error: elien } = await admin.from('campagne_ligne_panneaux').insert({ ligne_id: ligne, panneau_id: panneau });
    if (elien) throw new Error(`lien : ${elien.message}`);
  });

  afterAll(async () => {
    const { error: e1 } = await admin.from('campagnes').delete().eq('id', campagne);
    if (e1) throw new Error(`nettoyage campagne : ${e1.message}`);
    const { error: e2 } = await admin.from('panneaux_affichage').delete().eq('source', SOURCE);
    if (e2) throw new Error(`nettoyage panneau : ${e2.message}`);
    const { error: e3 } = await admin.from('data_sources').delete().eq('id', source);
    if (e3) throw new Error(`nettoyage source : ${e3.message}`);
  });

  it('la Marine lit sa campagne, sa ligne, son panneau de ligne et le panneau', async () => {
    const { marine } = comptes;
    const { data: cs } = await marine.client.from('campagnes').select('id').eq('id', campagne);
    const { data: ls } = await marine.client.from('campagne_lignes').select('id').eq('id', ligne);
    const { data: liens } = await marine.client.from('campagne_ligne_panneaux').select('panneau_id').eq('ligne_id', ligne);
    const { data: ps } = await marine.client.from('panneaux_affichage').select('id').eq('id', panneau);
    expect(cs).toHaveLength(1);
    expect(ls).toHaveLength(1);
    expect(liens).toHaveLength(1);
    expect(ps).toHaveLength(1);
  });

  it('BMW ne voit ni la campagne, ni la ligne, ni le panneau de ligne, ni le panneau', async () => {
    const { bmw } = comptes;
    const { data: cs } = await bmw.client.from('campagnes').select('id').eq('id', campagne);
    const { data: ls } = await bmw.client.from('campagne_lignes').select('id').eq('id', ligne);
    const { data: liens } = await bmw.client.from('campagne_ligne_panneaux').select('panneau_id').eq('ligne_id', ligne);
    const { data: ps } = await bmw.client.from('panneaux_affichage').select('id').eq('id', panneau);
    expect(cs).toEqual([]);
    expect(ls).toEqual([]);
    expect(liens).toEqual([]);
    expect(ps).toEqual([]);
  });

  it('un client ne peut rien écrire par PostgREST', async () => {
    const { marine } = comptes;
    const { error } = await marine.client.from('campagnes').insert({ organization_id: marine.orgId, nom: 'intrus' });
    expect(error?.code).toBe('42501');
  });

  it('sans connexion, rien', async () => {
    const { data, error } = await anonyme.from('campagnes').select('id').eq('id', campagne);
    expect(error?.code === '42501' || (data ?? []).length === 0).toBe(true);
  });
});
```

- [ ] **Step 2: Les lancer, ils échouent**

Run: `npx vitest run --project integration tests/integration/campagnes-media.test.ts`
Expected: FAIL — `relation "public.campagnes" does not exist` (ou `Could not find the table 'public.campagnes' in the schema cache`).

- [ ] **Step 3: Écrire la migration**

`sql/261_campagnes_multi_media.sql` :

```sql
-- 261 — Campagnes multi-média d'un espace de travail (2026-10-16)
--
-- Spec : docs/superpowers/specs/2026-10-16-ooh-campagnes-design.md § 1 (décisions 2, 3, 5), § 4.2.
-- Une CAMPAGNE appartient à un espace (`organization_id`) et porte des LIGNES, chacune d'un média parmi digital, ooh,
-- tv, radio, presse. Une ligne OOH réserve des panneaux (`campagne_ligne_panneaux`). Modèle 1 : de nouvelles tables
-- AU-DESSUS ; `dsp_campaigns` et tout le pilotage digital restent intacts. Le mot « campagne » est déjà pris
-- (`dsp_campaigns`, `CampagnePlan`, étape campagne du module risque) : voir ARCHITECTURE « Campagnes multi-média ».
--
-- `cle_import` : identité stable d'une campagne pour le rejeu du script d'import (`scripts/ooh/importer-plan.ts`) ;
-- unique dans un espace (NULLS DISTINCT : une campagne saisie sans clé n'est pas contrainte).
-- `on delete restrict` côté panneau : un panneau réservé par une campagne ne disparaît pas en silence lors d'un
-- remplacement d'import ; la suppression échoue (23503) en le disant.
-- `unique (campagne_id, ordre)` : l'ordre du plan est une identité de ligne (son index sert aussi `campagne_id`).
--
-- RLS : lecture par `authenticated` pour son espace (`get_user_org()`), ou super_admin — même règle que `ds_select`
-- (sql/234). Aucune écriture client : les écritures passent par `service_role` (script, routes). Les politiques
-- sont créées dans un bloc DO gardé par `pg_policies` (aucun DROP).
-- Coût : tables de quelques dizaines de campagnes et de lignes ; liens ≈ 1 200 par campagne OOH (TF4).
-- Droits : `select` à `authenticated` (sous RLS), tout à `service_role`. Rejouable.

begin;

create table if not exists public.campagnes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  nom              text not null,
  annonceur        text,
  vague            text,
  date_debut       date,
  date_fin         date,
  budget_total_ttc numeric,
  cle_import       text,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint campagnes_org_cle_import_key unique (organization_id, cle_import),
  constraint campagnes_dates_check check (date_debut is null or date_fin is null or date_fin >= date_debut)
);

create table if not exists public.campagne_lignes (
  id               uuid primary key default gen_random_uuid(),
  campagne_id      uuid not null references public.campagnes(id) on delete cascade,
  media            text not null check (media in ('digital', 'ooh', 'tv', 'radio', 'presse')),
  ordre            integer not null,
  regie            text,
  reseau           text,
  territoire       text,
  nb_ecrans        integer,
  format           text,
  nb_diffusions    integer,
  date_debut       date,
  date_fin         date,
  duree_libelle    text,
  rang_option      text,
  plage_horaire    text,
  montant_brut     numeric,
  montant_net      numeric,
  frais            numeric,
  honoraires       numeric,
  total_ttc        numeric,
  contacts_15_plus bigint,
  contacts_18_24   bigint,
  details          jsonb not null default '{}'::jsonb,
  data_source_id   uuid references public.data_sources(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint campagne_lignes_ordre_key unique (campagne_id, ordre),
  constraint campagne_lignes_dates_check check (date_debut is null or date_fin is null or date_fin >= date_debut)
);

create table if not exists public.campagne_ligne_panneaux (
  ligne_id   uuid not null references public.campagne_lignes(id) on delete cascade,
  panneau_id uuid not null references public.panneaux_affichage(id) on delete restrict,
  nb_ecrans  integer,
  formats    text[],
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (ligne_id, panneau_id)
);

create index if not exists campagnes_organization_id_idx on public.campagnes (organization_id);
create index if not exists campagne_lignes_campagne_id_idx on public.campagne_lignes (campagne_id);
create index if not exists campagne_ligne_panneaux_panneau_id_idx on public.campagne_ligne_panneaux (panneau_id);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_campagnes_updated_at' and tgrelid = 'public.campagnes'::regclass) then
    create trigger trg_campagnes_updated_at before update on public.campagnes
      for each row execute function public.set_updated_at();
  end if;
end
$$;

comment on table public.campagnes is
  'Campagne multi-media d un espace de travail (spec 2026-10-16-ooh-campagnes). Distincte de dsp_campaigns. Ecrite par scripts/ooh/importer-plan.ts (sql/261).';
comment on table public.campagne_lignes is
  'Ligne d une campagne, un media parmi digital/ooh/tv/radio/presse ; details = la ligne d origine du plan (sql/261).';
comment on table public.campagne_ligne_panneaux is
  'Panneaux reserves par une ligne OOH ; ON DELETE RESTRICT cote panneau (sql/261).';

alter table public.campagnes enable row level security;
alter table public.campagne_lignes enable row level security;
alter table public.campagne_ligne_panneaux enable row level security;

revoke all on table public.campagnes, public.campagne_lignes, public.campagne_ligne_panneaux from public, anon, authenticated;
grant select on table public.campagnes, public.campagne_lignes, public.campagne_ligne_panneaux to authenticated;
grant select, insert, update, delete on table public.campagnes, public.campagne_lignes, public.campagne_ligne_panneaux to service_role;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'campagnes' and policyname = 'campagnes_select') then
    create policy campagnes_select on public.campagnes for select to authenticated
      using (get_user_role() = 'super_admin' or organization_id = get_user_org());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'campagne_lignes' and policyname = 'campagne_lignes_select') then
    create policy campagne_lignes_select on public.campagne_lignes for select to authenticated
      using (exists (
        select 1 from public.campagnes c
         where c.id = campagne_lignes.campagne_id
           and (get_user_role() = 'super_admin' or c.organization_id = get_user_org())));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'campagne_ligne_panneaux' and policyname = 'campagne_ligne_panneaux_select') then
    create policy campagne_ligne_panneaux_select on public.campagne_ligne_panneaux for select to authenticated
      using (exists (
        select 1 from public.campagne_lignes l
          join public.campagnes c on c.id = l.campagne_id
         where l.id = campagne_ligne_panneaux.ligne_id
           and (get_user_role() = 'super_admin' or c.organization_id = get_user_org())));
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;
```

- [ ] **Step 4: Appliquer deux fois, puis relancer les tests**

Run: `docker exec -i supabase_db_genesis_app psql -U postgres -v ON_ERROR_STOP=1 < sql/261_campagnes_multi_media.sql` (deux fois de suite)
Expected: `COMMIT` les deux fois ; au second passage des `NOTICE: relation … already exists, skipping`, aucune erreur.

Run: `npx vitest run --project integration tests/integration/campagnes-media.test.ts tests/integration/cloisonnement-rls.test.ts tests/integration/politiques-for-all.test.ts`
Expected: PASS.

- [ ] **Step 5: Reporter les types générés**

```bash
npx supabase gen types typescript --db-url "postgresql://postgres:postgres@127.0.0.1:54322/postgres" > "$TEMP/database.types.genere.ts"
grep -n "^      campagne_ligne_panneaux: {\|^      campagne_lignes: {\|^      campagnes: {" "$TEMP/database.types.genere.ts"
```

Ne PAS écraser `types/database.types.ts` (le fichier suivi dérive déjà, ARCHITECTURE « Commandes ») : copier les trois blocs `campagne_ligne_panneaux: {`, `campagne_lignes: {` et `campagnes: {` — chacun de sa ligne d'ouverture à son `}` fermant de même indentation (6 espaces), `Row`, `Insert`, `Update` et `Relationships` compris — et les coller dans `types/database.types.ts` juste avant la ligne `      campaign_cp_rollup: {` (ordre alphabétique : `campagne…` < `campaign…`), dans cet ordre : `campagne_ligne_panneaux`, `campagne_lignes`, `campagnes`.

Run: `npx tsc --noEmit`
Expected: code de retour 0.

- [ ] **Step 6: Documenter**

`sql/SETUP.md`, tableau « Tables créées (état final) », après la ligne `espace_jeux_recommandes` :

```markdown
| `campagnes` | 261 | Campagne multi-média d'un espace (`organization_id`), clé de rejeu `cle_import` unique par espace — distincte de `dsp_campaigns` |
| `campagne_lignes` | 261 | Lignes d'une campagne, une par média (`digital`, `ooh`, `tv`, `radio`, `presse`), `unique (campagne_id, ordre)` |
| `campagne_ligne_panneaux` | 261 | Panneaux réservés par une ligne OOH ; `on delete restrict` côté panneau |
```

`ARCHITECTURE.md` : après le tableau de la section `### POI & Panneaux` (`Grep "^### POI & Panneaux"`, puis lire 12 lignes), insérer :

```markdown
### Campagnes multi-média (2026-10-16, sql/261)

> ⚠ **Trois « campagnes » coexistent, à ne pas confondre.** `dsp_campaigns` = une campagne d'ACHAT digital importée
> d'un DSP (pilotage, pacing, rollups) ; `CampagnePlan` (Angular) = le sélecteur de rattachement d'un plan média de
> zones ; `campagnes` (ici) = la campagne MULTI-MÉDIA d'un espace de travail, faite de lignes par média. Les types de
> code du modèle multi-média sont préfixés (`MediaLigne`, `LignePlan`, `CampagneOohResume`) pour ne pas collisionner.
> Les 8 `dsp_campaigns` existantes ne sont pas rattachées (prévu avec le module campagnes).

| Table | Description | Notes |
|-------|-------------|-------|
| `campagnes` | Campagne d'un espace : nom, annonceur, vague, dates, budget TTC, `metadata` (fichier source, hypothèse, coûts annexes, notes du plan) | `unique (organization_id, cle_import)` — identité de rejeu du script d'import ; `updated_at` par `set_updated_at()` ; `on delete cascade` depuis `organizations` |
| `campagne_lignes` | Une ligne par média : `media` ∈ `digital`/`ooh`/`tv`/`radio`/`presse`, régie, réseau, territoire, écrans, format, diffusions, dates, durée (libellé gardé), montants, contacts 15+ / 18-24 ; `details` = toute la ligne d'origine, plus `non_places` (emplacements introuvables, nom et raison) | `unique (campagne_id, ordre)` ; `data_source_id` = la source PRIVÉE des emplacements de la ligne (`null` : liste non fournie, ex. DROM) |
| `campagne_ligne_panneaux` | Panneaux réservés par une ligne OOH, écrans et formats propres à la réservation | PK `(ligne_id, panneau_id)` ; `on delete RESTRICT` côté panneau (un panneau réservé ne disparaît pas en silence, 23503) |

RLS : lecture `authenticated` pour son espace (`get_user_org()`) ou super_admin, aucune écriture client ; les routes
passent par `service_role` et filtrent par l'espace actif elles-mêmes. Verrouillé par
`tests/integration/cloisonnement-rls.test.ts` (« campagnes — un espace ne voit que les siennes »).
```

- [ ] **Step 7: Commit**

```bash
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add sql/261_campagnes_multi_media.sql tests/integration/campagnes-media.test.ts tests/integration/cloisonnement-rls.test.ts types/database.types.ts sql/SETUP.md ARCHITECTURE.md
git commit -m "feat: campagnes multi-média d'un espace de travail (sql/261)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Panneaux enrichis (sql/262)

**Files:**
- Create: `sql/262_panneaux_enrichis.sql`
- Create: `tests/integration/panneaux-enrichis.test.ts`
- Modify: `types/database.types.ts` (bloc `panneaux_affichage`, ≈ ligne 4167 : `Row`, `Insert`, `Update`)
- Modify: `ARCHITECTURE.md` (ligne de table `panneaux_affichage`)

**Interfaces:**
- Consumes: `panneaux_affichage` (sql/082).
- Produces (colonnes de `panneaux_affichage`) : `nom_lieu text`, `reseau text`, `type_lieu text`, `numerique boolean`, `nb_ecrans integer`, `formats text[]`, `contacts_semaine integer`, `contacts_18_25_semaine integer`, `geoloc_methode text` ∈ (`referentiel_gares`, `adresse_ban`, `alias_manuel`, `coordonnees_fournies`), `geoloc_qualite text` ∈ (`sure`, `a_verifier`), `geoloc_score double precision` ∈ [0, 1], `geoloc_libelle text`.

- [ ] **Step 1: Écrire le test d'intégration**

`tests/integration/panneaux-enrichis.test.ts` :

```ts
/** sql/262 — les colonnes d'emplacement de `panneaux_affichage` (spec 2026-10-16-ooh-campagnes § 4.3) et leurs CHECK. */
import { afterAll, describe, expect, it } from 'vitest';
import { creerClientTest } from './_client';

const admin = creerClientTest();
const SOURCE = `essai-enrichis-${Date.now()}`;
let n = 0;
const base = () => ({ lat: 43.3, lng: 5.4, source: SOURCE, source_ref: String(++n) });

afterAll(async () => {
  const { error } = await admin.from('panneaux_affichage').delete().eq('source', SOURCE);
  if (error) throw new Error(`nettoyage : ${error.message}`);
});

describe('sql/262 — panneaux enrichis', () => {
  it('écrit et relit toutes les colonnes d emplacement', async () => {
    const ligne = {
      ...base(), nom_lieu: 'Campus essai', reseau: 'DOOH borne de recharge', type_lieu: 'campus', numerique: true,
      nb_ecrans: 3, formats: ['43"'], contacts_semaine: 150000, contacts_18_25_semaine: 142500,
      geoloc_methode: 'adresse_ban', geoloc_qualite: 'a_verifier', geoloc_score: 0.48, geoloc_libelle: 'Rue Essai 13009 Marseille',
    };
    const { data, error } = await admin.from('panneaux_affichage').insert(ligne)
      .select('nom_lieu, reseau, type_lieu, numerique, nb_ecrans, formats, contacts_semaine, contacts_18_25_semaine, geoloc_methode, geoloc_qualite, geoloc_score, geoloc_libelle')
      .single();
    expect(error).toBeNull();
    const { lat: _lat, lng: _lng, source: _s, source_ref: _r, ...attendu } = ligne;
    expect(data).toEqual(attendu);
  });

  it.each([
    ['geoloc_methode', 'devine'],
    ['geoloc_qualite', 'peut-etre'],
    ['geoloc_score', 1.5],
    ['geoloc_score', -0.1],
  ] as const)('%s = %s est refusé', async (colonne, valeur) => {
    const { error } = await admin.from('panneaux_affichage').insert({ ...base(), [colonne]: valeur });
    expect(error?.code).toBe('23514');
  });
});
```

- [ ] **Step 2: Le lancer, il échoue**

Run: `npx vitest run --project integration tests/integration/panneaux-enrichis.test.ts`
Expected: FAIL — `Could not find the 'contacts_18_25_semaine' column of 'panneaux_affichage' in the schema cache`.

- [ ] **Step 3: Écrire la migration**

`sql/262_panneaux_enrichis.sql` :

```sql
-- 262 — Panneaux enrichis : ce que la régie dit d'un emplacement (2026-10-16)
--
-- Spec : docs/superpowers/specs/2026-10-16-ooh-campagnes-design.md § 1 (décision 8), § 4.3.
-- La table des panneaux doit porter le MAXIMUM d'information. Douze colonnes s'ajoutent à `panneaux_affichage` ;
-- les colonnes existantes (`regie`, `type_panneau`, `adresse`, `ville`, `code_postal`, `code_insee`,
-- `code_departement`, `nb_faces`, `reference_panneau`, `source`, `source_ref`, `data_source_id`, `organization_id`,
-- `metadata`) sont remplies par le script quand on peut. `metadata` garde la ligne d'origine EN ENTIER.
--
-- `geoloc_*` dit comment le point a été placé : méthode (référentiel des gares SNCF, adresse BAN, alias manuel
-- vérifié par l'INSEE, coordonnées fournies), qualité (`sure` / `a_verifier` — jamais placé en silence), score (BAN,
-- ou 1 pour une correspondance exacte au référentiel), libellé reconnu (pour juger d'un coup d'œil).
-- Les CHECK sont posés par un bloc DO gardé par `pg_constraint` (rejouable, aucun DROP).
-- Coût : `ADD COLUMN` sans défaut, métadonnée seule (aucune réécriture de table). Rejouable.

begin;

alter table public.panneaux_affichage
  add column if not exists nom_lieu               text,
  add column if not exists reseau                 text,
  add column if not exists type_lieu              text,
  add column if not exists numerique              boolean,
  add column if not exists nb_ecrans              integer,
  add column if not exists formats                text[],
  add column if not exists contacts_semaine       integer,
  add column if not exists contacts_18_25_semaine integer,
  add column if not exists geoloc_methode         text,
  add column if not exists geoloc_qualite         text,
  add column if not exists geoloc_score           double precision,
  add column if not exists geoloc_libelle         text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'panneaux_geoloc_methode_check') then
    alter table public.panneaux_affichage add constraint panneaux_geoloc_methode_check
      check (geoloc_methode is null or geoloc_methode in ('referentiel_gares', 'adresse_ban', 'alias_manuel', 'coordonnees_fournies'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'panneaux_geoloc_qualite_check') then
    alter table public.panneaux_affichage add constraint panneaux_geoloc_qualite_check
      check (geoloc_qualite is null or geoloc_qualite in ('sure', 'a_verifier'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'panneaux_geoloc_score_check') then
    alter table public.panneaux_affichage add constraint panneaux_geoloc_score_check
      check (geoloc_score is null or (geoloc_score >= 0 and geoloc_score <= 1));
  end if;
end
$$;

comment on column public.panneaux_affichage.geoloc_qualite is
  'sure | a_verifier : un emplacement incertain est marque, jamais place en silence (sql/262).';

notify pgrst, 'reload schema';

commit;
```

- [ ] **Step 4: Appliquer deux fois, puis relancer le test**

Run: `docker exec -i supabase_db_genesis_app psql -U postgres -v ON_ERROR_STOP=1 < sql/262_panneaux_enrichis.sql` (deux fois)
Expected: `COMMIT` les deux fois.

Run: `npx vitest run --project integration tests/integration/panneaux-enrichis.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Reporter les types**

```bash
npx supabase gen types typescript --db-url "postgresql://postgres:postgres@127.0.0.1:54322/postgres" > "$TEMP/database.types.genere.ts"
```

Dans `types/database.types.ts`, bloc `      panneaux_affichage: {` : ajouter les douze colonnes dans `Row` (`contacts_18_25_semaine: number | null`, `contacts_semaine: number | null`, `formats: string[] | null`, `geoloc_libelle: string | null`, `geoloc_methode: string | null`, `geoloc_qualite: string | null`, `geoloc_score: number | null`, `nb_ecrans: number | null`, `nom_lieu: string | null`, `numerique: boolean | null`, `reseau: string | null`, `type_lieu: string | null`), et la même liste en optionnel (`?:`) dans `Insert` et `Update`, chacune à sa place alphabétique — recopier les lignes telles que le fichier généré les écrit.

Run: `npx tsc --noEmit`
Expected: code de retour 0.

- [ ] **Step 6: Documenter**

`ARCHITECTURE.md`, ligne de table `| \`panneaux_affichage\` |` : ajouter à la description « **Colonnes d'emplacement (sql/262)** : `nom_lieu`, `reseau`, `type_lieu`, `numerique`, `nb_ecrans`, `formats text[]`, `contacts_semaine`, `contacts_18_25_semaine`, `geoloc_methode` (`referentiel_gares`/`adresse_ban`/`alias_manuel`/`coordonnees_fournies`), `geoloc_qualite` (`sure`/`a_verifier`), `geoloc_score` [0, 1], `geoloc_libelle` ; `metadata` = la ligne d'origine de la régie EN ENTIER ».

- [ ] **Step 7: Commit**

```bash
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add sql/262_panneaux_enrichis.sql tests/integration/panneaux-enrichis.test.ts types/database.types.ts ARCHITECTURE.md
git commit -m "feat: colonnes d'emplacement et de géolocalisation des panneaux (sql/262)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Lecture d'une campagne OOH en jsonb (sql/263)

**Files:**
- Create: `sql/263_campagne_ooh_jsonb.sql`
- Create: `tests/integration/campagne-ooh-jsonb.test.ts`
- Modify: `types/database.types.ts` (deux entrées de `Functions`)
- Modify: `sql/SETUP.md` (tableau « Fonctions RPC actives »)
- Modify: `ARCHITECTURE.md` (section `### Digital / Campagnes` des RPC)

**Interfaces:**
- Consumes: tables de sql/261 et colonnes de sql/262.
- Produces :
  - `campagne_ooh_jsonb(p_campagne uuid, p_org uuid, p_limite integer default 20000) returns jsonb` → `null` si la campagne n'est pas dans `p_org` ; sinon `{ campagne: { id, nom, annonceur, vague, date_debut, date_fin, budget_total_ttc, metadata }, lignes: Ligne[], emplacements: Feature[], tronque: boolean }` où `Ligne = { id, ordre, media, regie, reseau, territoire, nb_ecrans, format, nb_diffusions, date_debut, date_fin, duree_libelle, rang_option, plage_horaire, montant_brut, montant_net, frais, honoraires, total_ttc, contacts_15_plus, contacts_18_24, details, a_des_emplacements, nb_places, nb_a_verifier, nb_non_places }` (lignes `media = 'ooh'` seules, par `ordre`) et `Feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { id, ligne_id, nom_lieu, adresse, ville, code_postal, code_insee, regie, reseau, type_lieu, type_panneau, numerique, nb_ecrans, formats, contacts_semaine, contacts_18_25_semaine, geoloc_methode, geoloc_qualite, geoloc_score, geoloc_libelle, reference_panneau, metadata } }`.
  - `campagnes_ooh_jsonb(p_org uuid, p_limite integer default 200) returns jsonb` → `{ campagnes: [{ id, nom, annonceur, vague, date_debut, date_fin, lignes: [{ id, ordre, media, regie, reseau, territoire, nb_ecrans, nb_places, nb_non_places }] }], tronque: boolean }` — campagnes de `p_org` ayant au moins une ligne `ooh`, les plus récentes d'abord.
  - Erreur `22023` si `p_limite` est nul ou < 1. Les deux : `SECURITY INVOKER`, `service_role` seul.

- [ ] **Step 1: Écrire le test d'intégration**

`tests/integration/campagne-ooh-jsonb.test.ts` :

```ts
/**
 * sql/263 — lecture d'une campagne OOH en UN scalaire jsonb (spec 2026-10-16-ooh-campagnes § 4.5) : TF4 dépasse les
 * 1 000 lignes que PostgREST laisse passer d'une RPC tabulaire. On vérifie la forme, le cloisonnement par `p_org` et la
 * borne écrite (`p_limite + 1` lus, `tronque`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerClientTest } from './_client';

const admin = creerClientTest();
const SOURCE = `essai-ooh-jsonb-${Date.now()}`;
let orgA = '';
let orgB = '';
let campagne = '';
let ligneGares = '';
let ligneDrom = '';

async function espace(nom: string): Promise<string> {
  const { data, error } = await admin.from('organizations')
    .insert({ name: `[ESSAI ooh] ${nom}`, slug: `essai-ooh-jsonb-${nom}-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(`espace ${nom} : ${error?.message}`);
  return data.id as string;
}

beforeAll(async () => {
  orgA = await espace('a');
  orgB = await espace('b');
  const { data: ds } = await admin.from('data_sources')
    .insert({ organization_id: orgA, name: '[ESSAI] gares', type: 'panneaux', visibilite: 'privee' }).select('id').single();
  const { data: c } = await admin.from('campagnes').insert({
    organization_id: orgA, nom: '[ESSAI] Campagne A', vague: 'V1', date_debut: '2026-09-20', date_fin: '2026-10-02', cle_import: SOURCE,
  }).select('id').single();
  campagne = c!.id as string;
  const { data: lignes } = await admin.from('campagne_lignes').insert([
    { campagne_id: campagne, media: 'ooh', ordre: 1, regie: 'MEDIATRANSPORTS', reseau: 'DOOH GARE', nb_ecrans: 6, data_source_id: ds!.id,
      details: { non_places: [{ nom: 'GARE INCONNUE', raison: 'gare introuvable dans le référentiel SNCF' }], nb_lieux_plan: 4, unite_lieux_plan: 'gares' } },
    { campagne_id: campagne, media: 'ooh', ordre: 2, regie: 'MEDIAOUTREMER', territoire: 'LA REUNION', nb_ecrans: 200 },
    { campagne_id: campagne, media: 'tv', ordre: 3, regie: 'CHAINE' },
  ]).select('id, ordre');
  ligneGares = lignes!.find((l) => l.ordre === 1)!.id as string;
  ligneDrom = lignes!.find((l) => l.ordre === 2)!.id as string;
  const { data: panneaux } = await admin.from('panneaux_affichage').insert([1, 2, 3].map((i) => ({
    lat: 48 + i / 100, lng: 2 + i / 100, source: SOURCE, source_ref: String(i), data_source_id: ds!.id, organization_id: orgA,
    nom_lieu: `Gare ${i}`, reseau: 'DOOH gare', type_lieu: 'gare', numerique: true, nb_ecrans: 2, formats: ['solo 9/16'],
    geoloc_methode: 'referentiel_gares', geoloc_qualite: i === 3 ? 'a_verifier' : 'sure', geoloc_score: 1,
    metadata: { onglet: 'LISTING GARE', lignes: [{ numero: 5 + i, cellules: { SITES: `GARE ${i}` } }] },
  }))).select('id');
  await admin.from('campagne_ligne_panneaux').insert(panneaux!.map((p) => ({ ligne_id: ligneGares, panneau_id: p.id, nb_ecrans: 2 })));
  // Une campagne sans ligne OOH : absente de la liste.
  await admin.from('campagnes').insert({ organization_id: orgA, nom: '[ESSAI] TV seule', cle_import: `${SOURCE}-tv` })
    .select('id').single().then(async ({ data }) => { await admin.from('campagne_lignes').insert({ campagne_id: data!.id, media: 'tv', ordre: 1 }); });
});

afterAll(async () => {
  for (const org of [orgA, orgB]) {
    const { error } = await admin.from('campagnes').delete().eq('organization_id', org);
    if (error) throw new Error(`nettoyage campagnes : ${error.message}`);
  }
  const { error: ep } = await admin.from('panneaux_affichage').delete().eq('source', SOURCE);
  if (ep) throw new Error(`nettoyage panneaux : ${ep.message}`);
  for (const org of [orgA, orgB]) {
    const { error } = await admin.from('organizations').delete().eq('id', org);
    if (error) throw new Error(`nettoyage espace : ${error.message}`);
  }
});

describe('campagne_ooh_jsonb', () => {
  it('rend la campagne, ses lignes OOH dans l ordre du plan et ses emplacements en GeoJSON', async () => {
    const { data, error } = await admin.rpc('campagne_ooh_jsonb', { p_campagne: campagne, p_org: orgA });
    expect(error).toBeNull();
    expect(data.campagne).toMatchObject({ id: campagne, nom: '[ESSAI] Campagne A', vague: 'V1', date_debut: '2026-09-20', date_fin: '2026-10-02' });
    expect(data.lignes.map((l: { ordre: number }) => l.ordre)).toEqual([1, 2]);
    expect(data.lignes[0]).toMatchObject({
      id: ligneGares, media: 'ooh', regie: 'MEDIATRANSPORTS', a_des_emplacements: true, nb_places: 3, nb_a_verifier: 1, nb_non_places: 1,
    });
    expect(data.lignes[1]).toMatchObject({ id: ligneDrom, territoire: 'LA REUNION', a_des_emplacements: false, nb_places: 0, nb_non_places: 0 });
    expect(data.emplacements).toHaveLength(3);
    expect(data.emplacements[0].geometry.type).toBe('Point');
    expect(data.emplacements[0].properties).toMatchObject({ ligne_id: ligneGares, reseau: 'DOOH gare', nb_ecrans: 2, formats: ['solo 9/16'] });
    expect(data.emplacements[0].properties.metadata.onglet).toBe('LISTING GARE');
    expect(data.tronque).toBe(false);
  });

  it('une campagne d un autre espace rend null', async () => {
    const { data, error } = await admin.rpc('campagne_ooh_jsonb', { p_campagne: campagne, p_org: orgB });
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('au-delà de la borne : p_limite emplacements et tronque', async () => {
    const { data } = await admin.rpc('campagne_ooh_jsonb', { p_campagne: campagne, p_org: orgA, p_limite: 2 });
    expect(data.emplacements).toHaveLength(2);
    expect(data.tronque).toBe(true);
  });

  it('une borne nulle ou négative est refusée', async () => {
    const { error } = await admin.rpc('campagne_ooh_jsonb', { p_campagne: campagne, p_org: orgA, p_limite: 0 });
    expect(error?.code).toBe('22023');
  });
});

describe('campagnes_ooh_jsonb', () => {
  it('les campagnes de l espace ayant une ligne OOH, avec leurs lignes OOH seules', async () => {
    const { data, error } = await admin.rpc('campagnes_ooh_jsonb', { p_org: orgA });
    expect(error).toBeNull();
    expect(data.tronque).toBe(false);
    expect(data.campagnes).toHaveLength(1);
    expect(data.campagnes[0]).toMatchObject({ id: campagne, nom: '[ESSAI] Campagne A' });
    expect(data.campagnes[0].lignes).toEqual([
      { id: ligneGares, ordre: 1, media: 'ooh', regie: 'MEDIATRANSPORTS', reseau: 'DOOH GARE', territoire: null, nb_ecrans: 6, nb_places: 3, nb_non_places: 1 },
      { id: ligneDrom, ordre: 2, media: 'ooh', regie: 'MEDIAOUTREMER', reseau: null, territoire: 'LA REUNION', nb_ecrans: 200, nb_places: 0, nb_non_places: 0 },
    ]);
  });

  it('un autre espace ne voit rien', async () => {
    const { data } = await admin.rpc('campagnes_ooh_jsonb', { p_org: orgB });
    expect(data).toEqual({ campagnes: [], tronque: false });
  });

  it('borne : tronque quand l espace a plus de campagnes OOH', async () => {
    const { data: c } = await admin.from('campagnes').insert({ organization_id: orgA, nom: '[ESSAI] Seconde', cle_import: `${SOURCE}-2` }).select('id').single();
    await admin.from('campagne_lignes').insert({ campagne_id: c!.id, media: 'ooh', ordre: 1 });
    const { data } = await admin.rpc('campagnes_ooh_jsonb', { p_org: orgA, p_limite: 1 });
    expect(data.campagnes).toHaveLength(1);
    expect(data.tronque).toBe(true);
  });
});
```

- [ ] **Step 2: Le lancer, il échoue**

Run: `npx vitest run --project integration tests/integration/campagne-ooh-jsonb.test.ts`
Expected: FAIL — `Could not find the function public.campagne_ooh_jsonb(p_campagne, p_org) in the schema cache`.

- [ ] **Step 3: Écrire la migration**

`sql/263_campagne_ooh_jsonb.sql` :

```sql
-- 263 — Lecture d'une campagne OOH et de la liste des campagnes OOH d'un espace, en jsonb (2026-10-16)
--
-- Spec : docs/superpowers/specs/2026-10-16-ooh-campagnes-design.md § 4.5 et § 5.
-- `campagne_ooh_jsonb` rend la campagne, ses lignes OOH (avec placés, à vérifier et non placés) et ses emplacements en
-- GeoJSON. RETURNS jsonb et non TABLE : TF4 porte ≈ 1 230 points, au-delà des 1 000 lignes que PostgREST laisse
-- passer d'une RPC tabulaire (`max_rows`, CLAUDE.md « Troncature PostgREST »). Elle lit `p_limite + 1` emplacements
-- et rend `tronque` ; elle rend `null` si la campagne n'est pas dans `p_org` (la route en fait un 404).
-- `campagnes_ooh_jsonb` rend les campagnes de `p_org` ayant au moins une ligne `ooh` (borne 200 : un espace a peu de
-- campagnes ; au-delà, `tronque` le dit).
--
-- EXPLAIN ANALYZE : voir le bloc « Mesure » en fin de fichier (fixture de 1 230 panneaux, transaction annulée).
--
-- Non gardé : `p_campagne`/`p_org` nuls → `null` / liste vide. `p_limite` nul ou < 1 → 22023.
-- Droits : `service_role` seul (routes par `createAdminClient`), SECURITY INVOKER. Rejouable (CREATE OR REPLACE).

begin;

create or replace function public.campagne_ooh_jsonb(p_campagne uuid, p_org uuid, p_limite integer default 20000)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_campagne jsonb;
  v_lignes   jsonb;
  v_points   jsonb;
  v_lus      integer;
begin
  if p_limite is null or p_limite < 1 then
    raise exception 'p_limite doit être un entier positif' using errcode = '22023';
  end if;
  if p_campagne is null or p_org is null then
    return null;
  end if;

  select jsonb_build_object(
           'id', c.id, 'nom', c.nom, 'annonceur', c.annonceur, 'vague', c.vague,
           'date_debut', c.date_debut, 'date_fin', c.date_fin, 'budget_total_ttc', c.budget_total_ttc, 'metadata', c.metadata)
    into v_campagne
    from public.campagnes c
   where c.id = p_campagne and c.organization_id = p_org;
  if v_campagne is null then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'ordre', l.ordre, 'media', l.media, 'regie', l.regie, 'reseau', l.reseau, 'territoire', l.territoire,
           'nb_ecrans', l.nb_ecrans, 'format', l.format, 'nb_diffusions', l.nb_diffusions,
           'date_debut', l.date_debut, 'date_fin', l.date_fin, 'duree_libelle', l.duree_libelle, 'rang_option', l.rang_option,
           'plage_horaire', l.plage_horaire, 'montant_brut', l.montant_brut, 'montant_net', l.montant_net, 'frais', l.frais,
           'honoraires', l.honoraires, 'total_ttc', l.total_ttc, 'contacts_15_plus', l.contacts_15_plus,
           'contacts_18_24', l.contacts_18_24, 'details', l.details,
           'a_des_emplacements', l.data_source_id is not null,
           'nb_places', coalesce(s.nb_places, 0),
           'nb_a_verifier', coalesce(s.nb_a_verifier, 0),
           'nb_non_places', case when jsonb_typeof(l.details->'non_places') = 'array'
                                 then jsonb_array_length(l.details->'non_places') else 0 end
         ) order by l.ordre), '[]'::jsonb)
    into v_lignes
    from public.campagne_lignes l
    left join lateral (
      select count(*)::int as nb_places,
             (count(*) filter (where p.geoloc_qualite = 'a_verifier'))::int as nb_a_verifier
        from public.campagne_ligne_panneaux clp
        join public.panneaux_affichage p on p.id = clp.panneau_id
       where clp.ligne_id = l.id
    ) s on true
   where l.campagne_id = p_campagne and l.media = 'ooh';

  select count(*)::int,
         coalesce(jsonb_agg(x.entite order by x.rang) filter (where x.rang <= p_limite), '[]'::jsonb)
    into v_lus, v_points
    from (
      select row_number() over (order by l.ordre, p.id) as rang,
             jsonb_build_object(
               'type', 'Feature',
               'geometry', jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(p.lng, p.lat)),
               'properties', jsonb_build_object(
                 'id', p.id, 'ligne_id', l.id, 'nom_lieu', p.nom_lieu, 'adresse', p.adresse, 'ville', p.ville,
                 'code_postal', p.code_postal, 'code_insee', p.code_insee, 'regie', p.regie, 'reseau', p.reseau,
                 'type_lieu', p.type_lieu, 'type_panneau', p.type_panneau, 'numerique', p.numerique,
                 'nb_ecrans', coalesce(clp.nb_ecrans, p.nb_ecrans), 'formats', coalesce(clp.formats, p.formats),
                 'contacts_semaine', p.contacts_semaine, 'contacts_18_25_semaine', p.contacts_18_25_semaine,
                 'geoloc_methode', p.geoloc_methode, 'geoloc_qualite', p.geoloc_qualite, 'geoloc_score', p.geoloc_score,
                 'geoloc_libelle', p.geoloc_libelle, 'reference_panneau', p.reference_panneau, 'metadata', p.metadata)
             ) as entite
        from public.campagne_lignes l
        join public.campagne_ligne_panneaux clp on clp.ligne_id = l.id
        join public.panneaux_affichage p on p.id = clp.panneau_id
       where l.campagne_id = p_campagne and l.media = 'ooh'
       order by l.ordre, p.id
       limit p_limite + 1
    ) x;

  return jsonb_build_object('campagne', v_campagne, 'lignes', v_lignes, 'emplacements', v_points, 'tronque', v_lus > p_limite);
end;
$function$;

create or replace function public.campagnes_ooh_jsonb(p_org uuid, p_limite integer default 200)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_lus       integer;
  v_campagnes jsonb;
begin
  if p_limite is null or p_limite < 1 then
    raise exception 'p_limite doit être un entier positif' using errcode = '22023';
  end if;
  if p_org is null then
    return jsonb_build_object('campagnes', '[]'::jsonb, 'tronque', false);
  end if;

  select count(*)::int,
         coalesce(jsonb_agg(x.campagne order by x.rang) filter (where x.rang <= p_limite), '[]'::jsonb)
    into v_lus, v_campagnes
    from (
      select row_number() over (order by c.date_debut desc nulls last, c.nom, c.id) as rang,
             jsonb_build_object(
               'id', c.id, 'nom', c.nom, 'annonceur', c.annonceur, 'vague', c.vague,
               'date_debut', c.date_debut, 'date_fin', c.date_fin,
               'lignes', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'id', l.id, 'ordre', l.ordre, 'media', l.media, 'regie', l.regie, 'reseau', l.reseau,
                          'territoire', l.territoire, 'nb_ecrans', l.nb_ecrans,
                          'nb_places', (select count(*) from public.campagne_ligne_panneaux clp where clp.ligne_id = l.id),
                          'nb_non_places', case when jsonb_typeof(l.details->'non_places') = 'array'
                                                then jsonb_array_length(l.details->'non_places') else 0 end
                        ) order by l.ordre), '[]'::jsonb)
                   from public.campagne_lignes l
                  where l.campagne_id = c.id and l.media = 'ooh')
             ) as campagne
        from public.campagnes c
       where c.organization_id = p_org
         and exists (select 1 from public.campagne_lignes l where l.campagne_id = c.id and l.media = 'ooh')
       order by c.date_debut desc nulls last, c.nom, c.id
       limit p_limite + 1
    ) x;

  return jsonb_build_object('campagnes', v_campagnes, 'tronque', v_lus > p_limite);
end;
$function$;

comment on function public.campagne_ooh_jsonb(uuid, uuid, integer) is
  'Campagne OOH d un espace : campagne, lignes OOH, emplacements GeoJSON ; null hors espace ; tronque au-dela de p_limite (sql/263).';
comment on function public.campagnes_ooh_jsonb(uuid, integer) is
  'Campagnes d un espace ayant une ligne OOH, avec leurs lignes OOH ; tronque au-dela de p_limite (sql/263).';

revoke all on function public.campagne_ooh_jsonb(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.campagnes_ooh_jsonb(uuid, integer) from public, anon, authenticated;
grant execute on function public.campagne_ooh_jsonb(uuid, uuid, integer) to service_role;
grant execute on function public.campagnes_ooh_jsonb(uuid, integer) to service_role;

notify pgrst, 'reload schema';

commit;

-- ── Mesure (EXPLAIN ANALYZE, 2026-10-16, base locale) ──────────────────────
-- Fixture : 1 campagne, 1 ligne OOH, 1 230 panneaux liés (le volume de TF4), transaction ANNULÉE.
-- Requête des emplacements : <coller ici les lignes « Planning Time », « Execution Time » et le nœud racine avec ses
-- « Buffers » relevés à l'étape 5 de la tâche 4>.
-- Appel complet `campagne_ooh_jsonb` : <coller ici la durée relevée par \timing>.
```

- [ ] **Step 4: Appliquer, relancer le test**

Run: `docker exec -i supabase_db_genesis_app psql -U postgres -v ON_ERROR_STOP=1 < sql/263_campagne_ooh_jsonb.sql` (deux fois)
Expected: `COMMIT` les deux fois.

Run: `npx vitest run --project integration tests/integration/campagne-ooh-jsonb.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Mesurer (EXPLAIN ANALYZE) et reporter dans l'en-tête**

Écrire `"$TEMP/mesure-263.sql"` :

```sql
begin;
insert into public.organizations (id, name, slug) values ('00000000-0000-4000-8000-0000000002e1', '[EXPLAIN] OOH', 'explain-ooh-263');
insert into public.data_sources (id, organization_id, name, type, visibilite) values ('00000000-0000-4000-8000-0000000002e2', '00000000-0000-4000-8000-0000000002e1', '[EXPLAIN] OOH', 'panneaux', 'privee');
insert into public.campagnes (id, organization_id, nom, cle_import) values ('00000000-0000-4000-8000-0000000002e3', '00000000-0000-4000-8000-0000000002e1', '[EXPLAIN] OOH', 'explain-263');
insert into public.campagne_lignes (id, campagne_id, media, ordre, regie, data_source_id) values ('00000000-0000-4000-8000-0000000002e4', '00000000-0000-4000-8000-0000000002e3', 'ooh', 1, 'ESSAI', '00000000-0000-4000-8000-0000000002e2');
insert into public.panneaux_affichage (lat, lng, source, source_ref, data_source_id, organization_id, geoloc_qualite, metadata)
  select 43 + g / 1000.0, 2 + g / 1000.0, 'explain-263', g::text, '00000000-0000-4000-8000-0000000002e2', '00000000-0000-4000-8000-0000000002e1', 'sure',
         jsonb_build_object('onglet', 'ESSAI', 'lignes', jsonb_build_array(jsonb_build_object('numero', g, 'cellules', jsonb_build_object('a', 'b'))))
    from generate_series(1, 1230) g;
insert into public.campagne_ligne_panneaux (ligne_id, panneau_id)
  select '00000000-0000-4000-8000-0000000002e4', id from public.panneaux_affichage where source = 'explain-263';
analyze public.campagnes; analyze public.campagne_lignes; analyze public.campagne_ligne_panneaux;
explain (analyze, buffers)
  select row_number() over (order by l.ordre, p.id), p.id
    from public.campagne_lignes l
    join public.campagne_ligne_panneaux clp on clp.ligne_id = l.id
    join public.panneaux_affichage p on p.id = clp.panneau_id
   where l.campagne_id = '00000000-0000-4000-8000-0000000002e3' and l.media = 'ooh'
   order by l.ordre, p.id
   limit 20001;
\timing on
select length(public.campagne_ooh_jsonb('00000000-0000-4000-8000-0000000002e3', '00000000-0000-4000-8000-0000000002e1')::text);
rollback;
```

Run: `docker exec -i supabase_db_genesis_app psql -U postgres < "$TEMP/mesure-263.sql"`
Expected: un plan sans `Seq Scan on panneaux_affichage` sur une table pleine (accès par `panneaux_affichage_pkey`, `campagne_lignes_campagne_id_idx` ou `campagne_lignes_ordre_key`), « Execution Time » de l'ordre de quelques ms à quelques dizaines de ms, puis la durée de l'appel. Remplacer les deux lignes `<coller ici …>` du bloc « Mesure » de `sql/263_campagne_ooh_jsonb.sql` par les valeurs RELEVÉES (Planning/Execution Time, buffers du nœud racine, durée `\timing`). Si un `Seq Scan` sur `panneaux_affichage` apparaît avec un coût dominant, le dire dans le rapport de tâche avant de continuer.

- [ ] **Step 6: Types, documentation**

Générer `"$TEMP/database.types.genere.ts"` (commande de la tâche 2) et reporter dans `types/database.types.ts`, section `Functions` du schéma `public`, les deux entrées `campagne_ooh_jsonb: {` et `campagnes_ooh_jsonb: {` telles que générées (chacune `Args` + `Returns: Json`), à leur place alphabétique entre les deux entrées qui les entourent dans le fichier généré.

`sql/SETUP.md`, tableau « Fonctions RPC actives (état final) », après `remplacer_jeux_recommandes()` :

```markdown
| `campagne_ooh_jsonb()` | 263 | Campagne OOH d'un espace : campagne, lignes OOH, emplacements GeoJSON (jsonb, `null` hors espace, borne 20 000 + `tronque`) |
| `campagnes_ooh_jsonb()` | 263 | Campagnes d'un espace ayant une ligne OOH (jsonb, borne 200 + `tronque`) |
```

`ARCHITECTURE.md`, section `### Digital / Campagnes` des RPC (`Grep "^### Digital / Campagnes"`, la seconde occurrence, celle qui suit `## Fonctions RPC PostGIS`) : ajouter en fin de tableau

```markdown
| `campagne_ooh_jsonb` | Campagne OOH d'un espace (spec 2026-10-16-ooh-campagnes § 4.5) : `(p_campagne uuid, p_org uuid, p_limite int default 20000)` → `RETURNS jsonb` `{ campagne, lignes, emplacements, tronque }` — lignes `media = 'ooh'` par `ordre` (avec `a_des_emplacements`, `nb_places`, `nb_a_verifier`, `nb_non_places`), emplacements en `Feature` GeoJSON portant toutes les colonnes d'emplacement et `metadata`. `null` si la campagne n'est pas dans `p_org`. Lit `p_limite + 1` points, `tronque` le dit ; `22023` sur une borne < 1. jsonb parce que TF4 dépasse les 1 000 lignes de `max_rows`. `SECURITY INVOKER`, `service_role` seul ; mesure dans l'en-tête de sql/263 | `GET /api/map/ooh/campagnes/[id]` (sql/263, 2026-10-16) |
| `campagnes_ooh_jsonb` | Campagnes d'un espace ayant au moins une ligne `ooh`, plus récentes d'abord, avec leurs lignes OOH (`nb_places`, `nb_non_places`) : `(p_org uuid, p_limite int default 200)` → `{ campagnes, tronque }`. `SECURITY INVOKER`, `service_role` seul | `GET /api/map/ooh/campagnes` (sql/263, 2026-10-16) |
```

Run: `npx tsc --noEmit` (code de retour 0) puis `npx vitest run --project unit tests/unit/db/troncature-postgrest.test.ts`
Expected: PASS (les deux RPC sont `jsonb`, hors du contrôle des tabulaires).

- [ ] **Step 7: Commit**

```bash
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add sql/263_campagne_ooh_jsonb.sql tests/integration/campagne-ooh-jsonb.test.ts types/database.types.ts sql/SETUP.md ARCHITECTURE.md
git commit -m "feat: lecture jsonb d'une campagne OOH et des campagnes OOH d'un espace (sql/263)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Modèle du plan, lecture du classeur et onglet de synthèse

**Files:**
- Create: `types/campagnes-media.ts`
- Create: `lib/ooh/plan/texte.ts`, `lib/ooh/plan/classeur.ts`, `lib/ooh/plan/durees.ts`, `lib/ooh/plan/fusion.ts`
- Create: `lib/ooh/plan/adaptateurs/synthese-hyp.ts`
- Modify: `lib/import/xlsx-reader.ts:114` (`toNative` exporté)
- Create: `tests/unit/ooh/_classeur.ts` (aide de test, hors motif `*.test.ts`)
- Create: `tests/unit/ooh/plan-lecture.test.ts`, `tests/unit/ooh/synthese-hyp.test.ts`

**Interfaces:**
- Consumes: `toNative(value: ExcelJS.CellValue): SheetCellValue` (`lib/import/xlsx-reader.ts`, rendu public).
- Produces:
  - `types/campagnes-media.ts` : `MediaLigne`, `GeolocMethode`, `GeolocQualite`, `Cellule`, `LigneFeuille`, `Feuille`, `Classeur`, `CoutAnnexe`, `EnteteCampagne`, `LignePlan`, `AdaptateurId`, `BlocGares`, `RechercheEmplacement`, `LigneOrigine`, `MetadataEmplacement`, `EmplacementBrut`, `EmplacementPlace`, `EmplacementNonPlace`, `LecturePlan`, `AdaptateurPlan` (code ci-dessous, fait foi).
  - `lib/ooh/plan/texte.ts` : `normaliser(valeur: string): string`, `texte(c: Cellule | undefined): string | null`, `nombre(c: Cellule | undefined): number | null`, `entier(c: Cellule | undefined): number | null`, `codePostal(c: Cellule | undefined): string | null`, `departementDeInsee(insee: string): string`, `cellulesNommees(entetes: readonly string[], cellules: readonly Cellule[]): Record<string, Cellule>`.
  - `lib/ooh/plan/classeur.ts` : `lireClasseur(contenu: Buffer): Promise<Classeur>`.
  - `lib/ooh/plan/durees.ts` : `Duree { jours: number; jours_diffusion: number }`, `ajouterJours(iso: string, n: number): string`, `lireDuree(libelle: string | null): Duree | null`, `dateFinLigne(depart: string | null, libelle: string | null): string | null`, `periodeDuTitre(titre: string, annee: number): { debut: string; fin: string } | null`.
  - `lib/ooh/plan/fusion.ts` : `fusionnerEmplacements<T extends EmplacementBrut>(liste: readonly T[], cle: (e: T) => string): T[]`.
  - `lib/ooh/plan/adaptateurs/synthese-hyp.ts` : `ADAPTATEUR_SYNTHESE: AdaptateurPlan` (id `'synthese-hyp'`, `regies: []`).
  - `tests/unit/ooh/_classeur.ts` : `classeurEssai(feuilles: Record<string, ValeurEssai[][]>): Promise<Classeur>`, `ValeurEssai = string | number | Date | null`.

- [ ] **Step 1: Écrire l'aide de test et les tests**

`tests/unit/ooh/_classeur.ts` :

```ts
import ExcelJS from 'exceljs';
import { lireClasseur } from '@/lib/ooh/plan/classeur';
import type { Classeur } from '@/types/campagnes-media';

export type ValeurEssai = string | number | Date | null;

/**
 * Construit un classeur .xlsx EN MÉMOIRE (exceljs), puis le relit par `lireClasseur` : les tests ne lisent jamais un
 * fichier client (spec 2026-10-16-ooh-campagnes § 8). `lignes[i][j]` = cellule de la ligne i+1, colonne j+1 ; `null`
 * = cellule vide.
 */
export async function classeurEssai(feuilles: Record<string, ValeurEssai[][]>): Promise<Classeur> {
  const classeur = new ExcelJS.Workbook();
  for (const [nom, lignes] of Object.entries(feuilles)) {
    const feuille = classeur.addWorksheet(nom);
    lignes.forEach((cellules, i) => {
      cellules.forEach((valeur, j) => {
        if (valeur !== null) feuille.getCell(i + 1, j + 1).value = valeur;
      });
    });
  }
  const tampon = await classeur.xlsx.writeBuffer();
  return lireClasseur(Buffer.from(tampon as ArrayBuffer));
}
```

`tests/unit/ooh/plan-lecture.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { lireClasseur } from '@/lib/ooh/plan/classeur';
import { ajouterJours, dateFinLigne, lireDuree, periodeDuTitre } from '@/lib/ooh/plan/durees';
import { fusionnerEmplacements } from '@/lib/ooh/plan/fusion';
import { cellulesNommees, codePostal, departementDeInsee, entier, nombre, normaliser, texte } from '@/lib/ooh/plan/texte';
import type { EmplacementBrut } from '@/types/campagnes-media';
import { classeurEssai } from './_classeur';

describe('texte', () => {
  it('normaliser : majuscules sans accents, ponctuation en espace, ST et STE développés', () => {
    expect(normaliser("  Gare d'Évry — St-Michel / Ste Foy ")).toBe('GARE D EVRY SAINT MICHEL SAINTE FOY');
    expect(normaliser('STRIDE ')).toBe('STRIDE');
  });
  it('texte, nombre, entier, codePostal', () => {
    expect(texte('  Basic  ')).toBe('Basic');
    expect(texte('   ')).toBeNull();
    expect(nombre('1 603 636')).toBe(1603636);
    expect(nombre('12,5')).toBe(12.5);
    expect(nombre(36116.3)).toBe(36116.3);
    expect(nombre('2nd OPTION')).toBeNull();
    expect(entier(489.6)).toBe(490);
    expect(codePostal(13008)).toBe('13008');
    expect(codePostal(1000)).toBe('01000');
    expect(codePostal('75001')).toBe('75001');
    expect(codePostal('Marseille')).toBeNull();
  });
  it('departementDeInsee : deux caractères en métropole et en Corse, trois outre-mer', () => {
    expect(departementDeInsee('75105')).toBe('75');
    expect(departementDeInsee('2A004')).toBe('2A');
    expect(departementDeInsee('97411')).toBe('974');
  });
  it('cellulesNommees : par en-tête, « colonne N » sans en-tête, doublons suffixés, vides sans en-tête omises', () => {
    expect(cellulesNommees(['A', '', 'A'], ['x', null, 'z'])).toEqual({ A: 'x', 'A (2)': 'z' });
    expect(cellulesNommees(['A'], ['x', 'y'])).toEqual({ A: 'x', 'colonne 2': 'y' });
  });
});

describe('lireClasseur', () => {
  it('rend chaque feuille, ses lignes non vides avec leur numéro Excel, et les dates en ISO', async () => {
    const c = await classeurEssai({ Essai: [['titre'], [], [null, 'b', 42, new Date(Date.UTC(2026, 8, 21))]] });
    const f = c.feuilles.get('Essai')!;
    expect(f.lignes.map((l) => l.numero)).toEqual([1, 3]);
    expect(f.lignes[1].cellules).toEqual([null, 'b', 42, '2026-09-21']);
  });
  it('un contenu qui n est pas un .xlsx lève un message français', async () => {
    await expect(lireClasseur(Buffer.from('pas un classeur'))).rejects.toThrow('Classeur illisible');
  });
});

describe('durées', () => {
  it.each([
    ['2 semaines', { jours: 14, jours_diffusion: 14 }],
    ['7 jours', { jours: 7, jours_diffusion: 7 }],
    ['14 jours', { jours: 14, jours_diffusion: 14 }],
    ['2*5 jours', { jours: 14, jours_diffusion: 10 }],
    ['9 jrs dont 2 offert', { jours: 9, jours_diffusion: 9 }],
  ])('%s', (libelle, attendu) => {
    expect(lireDuree(libelle)).toEqual(attendu);
  });
  it('une durée illisible rend null', () => {
    expect(lireDuree('deux semaines')).toBeNull();
    expect(lireDuree(null)).toBeNull();
  });
  it('date de fin = départ + durée − 1 jour, en UTC', () => {
    expect(ajouterJours('2026-09-28', 5)).toBe('2026-10-03');
    expect(dateFinLigne('2026-09-21', '2 semaines')).toBe('2026-10-04');
    expect(dateFinLigne('2026-09-24', '9 jrs dont 2 offert')).toBe('2026-10-02');
    expect(dateFinLigne(null, '7 jours')).toBeNull();
  });
  it('la période d un titre de plan, l année passant si la fin précède le début', () => {
    expect(periodeDuTitre('ESSAI CAMPAGNE - 20/09 - 02/10', 2026)).toEqual({ debut: '2026-09-20', fin: '2026-10-02' });
    expect(periodeDuTitre('ESSAI - 20/12 - 05/01', 2026)).toEqual({ debut: '2026-12-20', fin: '2027-01-05' });
    expect(periodeDuTitre('ESSAI sans période', 2026)).toBeNull();
  });
});

describe('fusionnerEmplacements', () => {
  const brut = (cle: string, nb: number, formats: string[], numero: number): EmplacementBrut => ({
    adaptateur: 'basic-fit', cle, nom_lieu: `Lieu ${cle}`, type_lieu: 'salle de sport', reseau: 'DOOH salle de sport', numerique: true,
    nb_ecrans: nb, formats, adresse: null, code_postal: null, ville: 'Villetest', reference_panneau: cle,
    contacts_semaine: null, contacts_18_25_semaine: null,
    recherche: { type: 'adresse', adresse: '', code_postal: null, ville: 'Villetest', commune_seule: true },
    metadata: { onglet: 'ESSAI', lignes: [{ numero, cellules: { A: cle } }] },
  });
  it('additionne les écrans, réunit les formats et garde toutes les lignes d origine, sans muter l entrée', () => {
    const entree = [brut('1', 1, ['WW'], 2), brut('2', 1, ['NC'], 3), brut('1', 2, ['NC', 'WW'], 4)];
    const sortie = fusionnerEmplacements(entree, (e) => e.cle);
    expect(sortie).toHaveLength(2);
    expect(sortie[0]).toMatchObject({ cle: '1', nb_ecrans: 3, formats: ['WW', 'NC'] });
    expect(sortie[0].metadata.lignes.map((l) => l.numero)).toEqual([2, 4]);
    expect(entree[0].formats).toEqual(['WW']);
    expect(entree[0].metadata.lignes).toHaveLength(1);
  });
});
```

`tests/unit/ooh/synthese-hyp.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { ADAPTATEUR_SYNTHESE } from '@/lib/ooh/plan/adaptateurs/synthese-hyp';
import { classeurEssai, type ValeurEssai } from './_classeur';

const jour = (m: number, j: number) => new Date(Date.UTC(2026, m - 1, j));

/** Un onglet de synthèse SYNTHÉTIQUE, de la forme de l'onglet HYP d'un plan de régie (colonne A vide, comme le fichier). */
const HYP: ValeurEssai[][] = [
  [null, 'ESSAI CAMPAGNE TEST - 20/09 - 02/10'],
  [null, 'HYPOTHESE 1'],
  [null, 'AFFICHEURS', 'RESEAUX', "NBRE D'ECRANS", 'FORMAT', 'LOGS', 'DEPART', 'DUREE', 'RANG OPTION', 'TARIF BRUT', 'TARIF NET ESTIME', 'FRAIS ESTIMES', 'HONO NET+FRAIS', 'TOTAL TTCHI'],
  [null, 'METROPOLE'],
  [null, 'MEDIATRANSPORTS', 'DOOH GARE \nTH MATIN - 10 gares', 20, 'DOOH', 1000, jour(9, 21), '2 semaines', '2nd OPTION', 100, 60, 5, 1, 80],
  [null, 'BASIC FIT', 'DOOH SALLE DE SPORT - BASIC FIT \nTH 16-22h - 3 clubs', 9, 'DOOH', 500, jour(9, 20), '2*5 jours', '2nd OPTION', 50, 30, 2, 1, 40],
  [null, 'DROM TOM'],
  [null, 'MEDIAOUTREMER', 'LA REUNION', 12, '12m²', null, jour(9, 24), '9 jrs dont 2 offert', '2nd OPTION', 20, 10, 1, 0.5, 13.5],
  [],
  [null, "IMPRESSION JUSQU'À 5 VISUELS", null, null, null, null, null, null, null, null, null, 400, 6, 487.2],
  [null, 'TOTAL', null, 41, null, null, null, null, null, 170, 100, 408, 8.5, 620.7],
  [],
  [null, "MEDIATRANSPORTS : diffusion d'un spot de 10\" du lundi au vendredi en TH matin (7h-10h) au sein des gares. Contacts 15+ : 1 000 000 / contacts 18-24 : 200 000"],
  [null, "BASIC FIT : diffusion d'un spot de 10\" du lundi au vendredi en TH soir (16h-22h), au sein des salles. Contacts 15+ : 50 000  / contacts 18-24 : 20 000"],
];

describe('adaptateur synthese-hyp', () => {
  it('reconnaît l onglet de synthèse par son en-tête, pas par son nom', async () => {
    expect(ADAPTATEUR_SYNTHESE.reconnait(await classeurEssai({ 'NOM LIBRE': HYP }))).toBe(true);
    expect(ADAPTATEUR_SYNTHESE.reconnait(await classeurEssai({ AUTRE: [['CLub name'], ['x']] }))).toBe(false);
  });

  it('l en-tête : titre, hypothèse, période du titre, budget total, coûts annexes, notes', async () => {
    const { entete } = ADAPTATEUR_SYNTHESE.lire(await classeurEssai({ HYP1: HYP }));
    expect(entete).toEqual({
      titre: 'ESSAI CAMPAGNE TEST - 20/09 - 02/10',
      hypothese: 'HYPOTHESE 1',
      date_debut: '2026-09-20',
      date_fin: '2026-10-02',
      budget_total_ttc: 620.7,
      couts_annexes: [{ libelle: "IMPRESSION JUSQU'À 5 VISUELS", frais: 400, honoraires: 6, total_ttc: 487.2 }],
      notes: [expect.stringMatching(/^MEDIATRANSPORTS :/), expect.stringMatching(/^BASIC FIT :/)],
    });
  });

  it('une ligne de métropole : réseau, écrans, dates calculées, montants, contacts et plage horaire des notes', async () => {
    const { lignes } = ADAPTATEUR_SYNTHESE.lire(await classeurEssai({ HYP1: HYP }));
    expect(lignes).toHaveLength(3);
    expect(lignes[0]).toMatchObject({
      ordre: 1, media: 'ooh', regie: 'MEDIATRANSPORTS', reseau: 'DOOH GARE', territoire: null,
      nb_ecrans: 20, format: 'DOOH', nb_diffusions: 1000, date_debut: '2026-09-21', date_fin: '2026-10-04',
      duree_libelle: '2 semaines', rang_option: '2nd OPTION', montant_brut: 100, montant_net: 60, frais: 5, honoraires: 1, total_ttc: 80,
      contacts_15_plus: 1000000, contacts_18_24: 200000, plage_horaire: 'du lundi au vendredi en TH matin (7h-10h)',
    });
    expect(lignes[0].details).toMatchObject({ onglet: 'HYP1', ligne: 5, section: 'METROPOLE', nb_lieux_plan: 10, unite_lieux_plan: 'gares', jours_diffusion: 14 });
    expect(lignes[0].details.cellules).toMatchObject({ AFFICHEURS: 'MEDIATRANSPORTS', LOGS: 1000, DEPART: '2026-09-21' });
    expect(lignes[1]).toMatchObject({
      regie: 'BASIC FIT', reseau: 'DOOH SALLE DE SPORT - BASIC FIT', date_debut: '2026-09-20', date_fin: '2026-10-03',
      contacts_15_plus: 50000, contacts_18_24: 20000, plage_horaire: 'du lundi au vendredi en TH soir (16h-22h)',
    });
    expect(lignes[1].details).toMatchObject({ nb_lieux_plan: 3, unite_lieux_plan: 'clubs', jours_diffusion: 10 });
  });

  it('une ligne DROM : territoire au lieu du réseau, sans diffusions, sans contacts ni plage', async () => {
    const { lignes } = ADAPTATEUR_SYNTHESE.lire(await classeurEssai({ HYP1: HYP }));
    expect(lignes[2]).toMatchObject({
      ordre: 3, regie: 'MEDIAOUTREMER', reseau: null, territoire: 'LA REUNION', nb_ecrans: 12, format: '12m²',
      nb_diffusions: null, date_debut: '2026-09-24', date_fin: '2026-10-02', contacts_15_plus: null, contacts_18_24: null, plage_horaire: null,
    });
    expect(lignes[2].details.section).toBe('DROM TOM');
  });

  it('ne lit aucun emplacement', async () => {
    expect(ADAPTATEUR_SYNTHESE.lire(await classeurEssai({ HYP1: HYP })).emplacements).toEqual([]);
  });
});
```

- [ ] **Step 2: Les lancer, ils échouent**

Run: `npx vitest run --project unit tests/unit/ooh/plan-lecture.test.ts tests/unit/ooh/synthese-hyp.test.ts`
Expected: FAIL — `Failed to load url @/lib/ooh/plan/classeur` (module absent).

- [ ] **Step 3: Écrire les types**

`types/campagnes-media.ts` :

```ts
/**
 * Campagnes multi-média et panneaux OOH d'une campagne — types du modèle d'import
 * (spec docs/superpowers/specs/2026-10-16-ooh-campagnes-design.md).
 *
 * Préfixés pour ne pas se confondre avec `dsp_campaigns` (achat digital) et `CampagnePlan` (rattachement d'un plan
 * média de zones) : voir ARCHITECTURE « Campagnes multi-média ».
 */

/** Le média d'une ligne — la contrainte CHECK de `campagne_lignes.media` (sql/261). */
export type MediaLigne = 'digital' | 'ooh' | 'tv' | 'radio' | 'presse';

/** Comment un emplacement a été placé — CHECK `panneaux_geoloc_methode_check` (sql/262). */
export type GeolocMethode = 'referentiel_gares' | 'adresse_ban' | 'alias_manuel' | 'coordonnees_fournies';

/** `sure`, ou `a_verifier` : un emplacement incertain est marqué, jamais placé en silence (sql/262). */
export type GeolocQualite = 'sure' | 'a_verifier';

/** Une cellule lue : scalaire, date ISO `yyyy-mm-dd`, ou vide (`null`). */
export type Cellule = string | number | boolean | null;

/** Une ligne de feuille : son numéro Excel (1 = première) et ses cellules, index 0 = colonne A. */
export interface LigneFeuille {
  numero: number;
  cellules: Cellule[];
}

export interface Feuille {
  nom: string;
  lignes: LigneFeuille[];
}

/** Un classeur lu (`lireClasseur`) : ses feuilles par nom exact, dans l'ordre du fichier. */
export interface Classeur {
  feuilles: Map<string, Feuille>;
}

/** Un coût du plan qui n'est pas un réseau (« IMPRESSION JUSQU'À 5 VISUELS »). */
export interface CoutAnnexe {
  libelle: string;
  frais: number | null;
  honoraires: number | null;
  total_ttc: number | null;
}

/** L'en-tête de campagne lu dans l'onglet de synthèse. */
export interface EnteteCampagne {
  titre: string | null;
  hypothese: string | null;
  date_debut: string | null;
  date_fin: string | null;
  budget_total_ttc: number | null;
  couts_annexes: CoutAnnexe[];
  notes: string[];
}

/** Une ligne de campagne telle que le plan la donne, avant écriture (colonnes de `campagne_lignes`). */
export interface LignePlan {
  ordre: number;
  media: MediaLigne;
  regie: string;
  reseau: string | null;
  territoire: string | null;
  nb_ecrans: number | null;
  format: string | null;
  nb_diffusions: number | null;
  date_debut: string | null;
  date_fin: string | null;
  duree_libelle: string | null;
  rang_option: string | null;
  plage_horaire: string | null;
  montant_brut: number | null;
  montant_net: number | null;
  frais: number | null;
  honoraires: number | null;
  total_ttc: number | null;
  contacts_15_plus: number | null;
  contacts_18_24: number | null;
  /** Toute la ligne d'origine (onglet, numéro, cellules), la section du plan, le nombre de lieux annoncé. */
  details: Record<string, unknown>;
}

/** Les formats de régie qu'un adaptateur sait lire. */
export type AdaptateurId = 'synthese-hyp' | 'mediatransports-gares' | 'basic-fit' | 'stride-campus';

/** Bloc d'une liste de gares : Île-de-France, province, ou non dit. */
export type BlocGares = 'idf' | 'province' | 'inconnu';

/** Ce que le géolocalisateur doit chercher. */
export type RechercheEmplacement =
  | { type: 'gare'; nom: string; bloc: BlocGares }
  | { type: 'adresse'; adresse: string; code_postal: string | null; ville: string | null; commune_seule: boolean };

/** Une ligne d'origine gardée dans `metadata.lignes`. */
export interface LigneOrigine {
  numero: number;
  cellules: Record<string, Cellule>;
  [cle: string]: unknown;
}

/** `panneaux_affichage.metadata` : l'onglet, les lignes d'origine EN ENTIER, et ce que l'adaptateur en a tiré. */
export interface MetadataEmplacement {
  onglet: string;
  lignes: LigneOrigine[];
  [cle: string]: unknown;
}

/** Un emplacement lu dans la liste d'une régie, pas encore placé. */
export interface EmplacementBrut {
  adaptateur: AdaptateurId;
  /** Identité dans le réseau avant géolocalisation (code club, établissement + CP, nom de gare normalisé). */
  cle: string;
  nom_lieu: string;
  type_lieu: string;
  reseau: string;
  numerique: boolean;
  nb_ecrans: number | null;
  formats: string[];
  adresse: string | null;
  code_postal: string | null;
  ville: string | null;
  reference_panneau: string | null;
  contacts_semaine: number | null;
  contacts_18_25_semaine: number | null;
  recherche: RechercheEmplacement;
  metadata: MetadataEmplacement;
}

/** Un emplacement placé : `source_ref` définitif (UIC d'une gare, code club…) et sa géolocalisation. */
export interface EmplacementPlace extends EmplacementBrut {
  source_ref: string;
  lat: number;
  lng: number;
  code_insee: string | null;
  code_departement: string | null;
  geoloc_methode: GeolocMethode;
  geoloc_qualite: GeolocQualite;
  geoloc_score: number;
  geoloc_libelle: string;
}

/** Un emplacement introuvable : il n'entre pas dans la table, il est compté sur sa ligne et listé au rapport. */
export interface EmplacementNonPlace {
  adaptateur: AdaptateurId;
  cle: string;
  nom: string;
  raison: string;
  metadata: MetadataEmplacement;
}

/** Ce qu'un adaptateur tire d'un classeur. La synthèse rend l'en-tête et les lignes ; une liste, des emplacements. */
export interface LecturePlan {
  entete: EnteteCampagne | null;
  lignes: LignePlan[];
  emplacements: EmplacementBrut[];
}

/** Un format de régie. La vague suivante = un adaptateur de plus, ou aucun si le format est le même (spec § 7). */
export interface AdaptateurPlan {
  id: AdaptateurId;
  /** Régies (normalisées par `normaliser`) dont ce format porte les emplacements ; vide pour la synthèse. */
  regies: readonly string[];
  reconnait(classeur: Classeur): boolean;
  lire(classeur: Classeur): LecturePlan;
}
```

- [ ] **Step 4: Écrire `texte.ts`, `classeur.ts`, `durees.ts`, `fusion.ts`**

Dans `lib/import/xlsx-reader.ts`, ligne 114 : `function toNative(value: ExcelJS.CellValue): SheetCellValue {` devient `export function toNative(value: ExcelJS.CellValue): SheetCellValue {` (réemployé par `lireClasseur`, une seule définition du déballage des cellules exceljs).

`lib/ooh/plan/texte.ts` :

```ts
/**
 * Normalisation des textes et nombres d'un plan de régie (spec 2026-10-16-ooh-campagnes § 7). Les fichiers de régie
 * portent des espaces insécables, des montants en texte (« 1 603 636 »), des codes postaux en nombre (13008) : tout
 * passe par ici, jamais par un `trim()` épars (CLAUDE.md : `.trim()` obligatoire sur les données importées).
 */
import type { Cellule } from '@/types/campagnes-media';

/** Majuscules sans accents, ponctuation → espace, espaces réduits, `ST`/`STE` → `SAINT`/`SAINTE`. */
export function normaliser(valeur: string): string {
  return valeur
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((m) => m !== '')
    .map((m) => (m === 'ST' ? 'SAINT' : m === 'STE' ? 'SAINTE' : m))
    .join(' ');
}

/** Le texte d'une cellule, espaces insécables remplacés et bords retirés ; `null` si vide. */
export function texte(c: Cellule | undefined): string | null {
  if (c === null || c === undefined) return null;
  const t = String(c).replace(/[  ]/g, ' ').trim();
  return t === '' ? null : t;
}

/** Le nombre d'une cellule : nombre natif, ou texte « 1 603 636 » / « 12,5 » ; `null` sinon. */
export function nombre(c: Cellule | undefined): number | null {
  if (typeof c === 'number') return Number.isFinite(c) ? c : null;
  if (typeof c !== 'string') return null;
  const t = c.replace(/[\s  ]/g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

/** Le nombre d'une cellule arrondi à l'entier ; `null` sinon. */
export function entier(c: Cellule | undefined): number | null {
  const n = nombre(c);
  return n === null ? null : Math.round(n);
}

/** Un code postal sur cinq chiffres (un nombre 1000 devient « 01000 ») ; `null` sinon. */
export function codePostal(c: Cellule | undefined): string | null {
  if (typeof c === 'number') return Number.isInteger(c) && c > 0 && c < 100000 ? String(c).padStart(5, '0') : null;
  const t = texte(c);
  return t !== null && /^\d{4,5}$/.test(t) ? t.padStart(5, '0') : null;
}

/** Le département d'un code commune INSEE : deux caractères (Corse 2A/2B comprise), trois outre-mer (97x, 98x). */
export function departementDeInsee(insee: string): string {
  return insee.startsWith('97') || insee.startsWith('98') ? insee.slice(0, 3) : insee.slice(0, 2);
}

/**
 * Les cellules d'une ligne nommées par l'en-tête — c'est ainsi que `metadata` garde la ligne d'origine EN ENTIER.
 * Sans en-tête : `colonne N`. En-tête répété : suffixe « (2) ». Une cellule vide sans en-tête est omise.
 */
export function cellulesNommees(entetes: readonly string[], cellules: readonly Cellule[]): Record<string, Cellule> {
  const sortie: Record<string, Cellule> = {};
  const n = Math.max(entetes.length, cellules.length);
  for (let i = 0; i < n; i++) {
    const valeur = cellules[i] ?? null;
    const nom = (entetes[i] ?? '').trim();
    if (nom === '' && valeur === null) continue;
    const base = nom === '' ? `colonne ${i + 1}` : nom;
    let cle = base;
    for (let k = 2; cle in sortie; k++) cle = `${base} (${k})`;
    sortie[cle] = valeur;
  }
  return sortie;
}
```

`lib/ooh/plan/classeur.ts` :

```ts
/**
 * Lecture d'un plan de régie .xlsx en grilles POSITIONNELLES (spec 2026-10-16-ooh-campagnes § 7).
 *
 * `readXlsxSheetRows` (lib/import/xlsx-reader.ts) rend des objets par en-tête de PREMIÈRE ligne : un plan de régie a
 * son en-tête en ligne 3 ou 4, des blocs côte à côte (gares IDF et province), des sections et des notes. Les
 * adaptateurs ont besoin des numéros de ligne et des colonnes telles quelles. Le déballage des cellules (texte
 * enrichi, formule, date → ISO) est celui de `toNative`, une seule définition.
 */
import ExcelJS from 'exceljs';
import { toNative } from '@/lib/import/xlsx-reader';
import type { Cellule, Classeur, Feuille, LigneFeuille } from '@/types/campagnes-media';

/** Garde-fou d'un fichier forgé : au-delà, la lecture échoue plutôt que de saturer la mémoire. */
const LIGNES_MAX = 50_000;

/**
 * Lit toutes les feuilles d'un classeur.
 *
 * @throws si le contenu n'est pas un .xlsx lisible, ou si une feuille dépasse `LIGNES_MAX` lignes.
 */
export async function lireClasseur(contenu: Buffer): Promise<Classeur> {
  const classeur = new ExcelJS.Workbook();
  try {
    // Même cast local que lib/import/xlsx-reader.ts : le Buffer d'exceljs n'est pas celui de Node pour TypeScript.
    await classeur.xlsx.load(contenu as unknown as Parameters<ExcelJS.Xlsx['load']>[0]);
  } catch {
    throw new Error('Classeur illisible : le plan doit être un fichier .xlsx (le format .xls n\'est pas lu).');
  }
  const feuilles = new Map<string, Feuille>();
  for (const feuille of classeur.worksheets) {
    const lignes: LigneFeuille[] = [];
    feuille.eachRow({ includeEmpty: false }, (rang, numero) => {
      if (lignes.length >= LIGNES_MAX) throw new Error(`Feuille « ${feuille.name} » : plus de ${LIGNES_MAX} lignes.`);
      const valeurs = rang.values as ExcelJS.CellValue[];
      const cellules: Cellule[] = [];
      for (let c = 1; c < valeurs.length; c++) cellules.push(toNative(valeurs[c]));
      lignes.push({ numero, cellules });
    });
    feuilles.set(feuille.name, { nom: feuille.name, lignes });
  }
  return { feuilles };
}
```

`lib/ooh/plan/durees.ts` :

```ts
/**
 * Durées et dates d'un plan de régie (spec 2026-10-16-ooh-campagnes § 4.2) : `date_fin` est calculée à partir du
 * départ et de la durée ; le libellé d'origine est gardé à côté (`duree_libelle`).
 */

/** Une durée : jours calendaires couverts, et jours de diffusion annoncés. */
export interface Duree {
  jours: number;
  jours_diffusion: number;
}

/** Ajoute `n` jours à une date ISO `yyyy-mm-dd`, en UTC (aucun décalage de fuseau). */
export function ajouterJours(iso: string, n: number): string {
  const [annee, mois, jour] = iso.split('-').map(Number);
  return new Date(Date.UTC(annee, mois - 1, jour + n)).toISOString().slice(0, 10);
}

/**
 * « 2 semaines », « 7 jours », « 14 jours », « 2*5 jours » (deux semaines de cinq jours de diffusion : 14 jours
 * couverts, 10 diffusés), « 9 jrs dont 2 offert » (9 jours) ; `null` pour tout autre libellé — jamais deviné.
 */
export function lireDuree(libelle: string | null): Duree | null {
  if (!libelle) return null;
  const t = libelle.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const semainesDeJours = /^(\d+)\s*[*x]\s*(\d+)\s*(?:jours?|jrs?|j)\b/.exec(t);
  if (semainesDeJours) {
    const semaines = Number(semainesDeJours[1]);
    return { jours: semaines * 7, jours_diffusion: semaines * Number(semainesDeJours[2]) };
  }
  const semaines = /^(\d+)\s*semaines?\b/.exec(t);
  if (semaines) return { jours: Number(semaines[1]) * 7, jours_diffusion: Number(semaines[1]) * 7 };
  const jours = /^(\d+)\s*(?:jours?|jrs?|j)\b/.exec(t);
  if (jours) return { jours: Number(jours[1]), jours_diffusion: Number(jours[1]) };
  return null;
}

/** La date de fin d'une ligne : départ + durée − 1 jour ; `null` si l'un manque ou si la durée est illisible. */
export function dateFinLigne(depart: string | null, libelle: string | null): string | null {
  const duree = lireDuree(libelle);
  return depart !== null && duree !== null ? ajouterJours(depart, duree.jours - 1) : null;
}

/** La période « jj/mm - jj/mm » d'un titre de plan ; l'année est donnée, une fin avant le début passe à l'année suivante. */
export function periodeDuTitre(titre: string, annee: number): { debut: string; fin: string } | null {
  const m = /(\d{1,2})\/(\d{1,2})\s*[-–]\s*(\d{1,2})\/(\d{1,2})/.exec(titre);
  if (!m) return null;
  const [j1, m1, j2, m2] = m.slice(1).map(Number);
  if (m1 < 1 || m1 > 12 || m2 < 1 || m2 > 12 || j1 < 1 || j1 > 31 || j2 < 1 || j2 > 31) return null;
  const iso = (a: number, mois: number, jour: number) => `${a}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
  return { debut: iso(annee, m1, j1), fin: iso(m2 < m1 ? annee + 1 : annee, m2, j2) };
}
```

`lib/ooh/plan/fusion.ts` :

```ts
import type { EmplacementBrut } from '@/types/campagnes-media';

/** Somme de deux compteurs facultatifs : `null` seulement si les deux le sont. */
function somme(a: number | null, b: number | null): number | null {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
}

/**
 * Réunit les emplacements de même clé : les lecteurs Basic-Fit d'un même club, deux lignes d'un même campus, deux noms
 * de la liste qui désignent la même gare (même UIC). Écrans et contacts s'additionnent, les formats se réunissent,
 * TOUTES les lignes d'origine sont gardées dans `metadata.lignes`. L'entrée n'est pas modifiée.
 */
export function fusionnerEmplacements<T extends EmplacementBrut>(liste: readonly T[], cle: (e: T) => string): T[] {
  const parCle = new Map<string, T>();
  for (const e of liste) {
    const k = cle(e);
    const deja = parCle.get(k);
    if (!deja) {
      parCle.set(k, { ...e, formats: [...e.formats], metadata: { ...e.metadata, lignes: [...e.metadata.lignes] } });
      continue;
    }
    deja.nb_ecrans = somme(deja.nb_ecrans, e.nb_ecrans);
    deja.contacts_semaine = somme(deja.contacts_semaine, e.contacts_semaine);
    deja.contacts_18_25_semaine = somme(deja.contacts_18_25_semaine, e.contacts_18_25_semaine);
    for (const f of e.formats) if (!deja.formats.includes(f)) deja.formats.push(f);
    deja.metadata.lignes.push(...e.metadata.lignes);
  }
  return [...parCle.values()];
}
```

- [ ] **Step 5: Écrire l'adaptateur de synthèse**

`lib/ooh/plan/adaptateurs/synthese-hyp.ts` :

```ts
/**
 * Adaptateur `synthese-hyp` : l'onglet de synthèse d'un plan de régie → l'en-tête de campagne et ses lignes
 * (spec 2026-10-16-ooh-campagnes § 3 et § 7). Reconnu par son EN-TÊTE (« AFFICHEURS », « RESEAUX »…), pas par le nom
 * de l'onglet (« HYP1 » aujourd'hui, « HYP2 » à la vague suivante).
 *
 * Structure lue, du haut vers le bas : titre et hypothèse au-dessus de l'en-tête ; des lignes de SECTION (une seule
 * cellule courte : « METROPOLE », « DROM TOM ») ; les lignes de réseau ; une ligne de coût sans écrans ni départ
 * (« IMPRESSION JUSQU'À 5 VISUELS ») ; la ligne « TOTAL » ; des NOTES (une seule cellule longue « RÉGIE : … ») qui
 * portent la plage horaire et les contacts 15+ / 18-24 de chaque réseau.
 * Dans la section DROM, la colonne « RESEAUX » porte le TERRITOIRE (« LA REUNION ») : `territoire` et non `reseau`.
 */
import type {
  AdaptateurPlan, Cellule, Classeur, CoutAnnexe, Feuille, LecturePlan, LigneFeuille, LignePlan,
} from '@/types/campagnes-media';
import { dateFinLigne, lireDuree, periodeDuTitre } from '../durees';
import { cellulesNommees, entier, nombre, normaliser, texte } from '../texte';

type Champ =
  | 'regie' | 'reseau' | 'nb_ecrans' | 'format' | 'nb_diffusions' | 'depart' | 'duree' | 'rang_option'
  | 'montant_brut' | 'montant_net' | 'frais' | 'honoraires' | 'total_ttc';

/** Préfixe normalisé d'un en-tête → champ. Premier préfixe qui convient : « TARIF NET » n'est pas « TARIF BRUT ». */
const ENTETES: ReadonlyArray<readonly [string, Champ]> = [
  ['AFFICHEUR', 'regie'], ['RESEAU', 'reseau'], ['NBRE', 'nb_ecrans'], ['FORMAT', 'format'], ['LOGS', 'nb_diffusions'],
  ['DEPART', 'depart'], ['DUREE', 'duree'], ['RANG', 'rang_option'], ['TARIF BRUT', 'montant_brut'],
  ['TARIF NET', 'montant_net'], ['FRAIS', 'frais'], ['HONO', 'honoraires'], ['TOTAL', 'total_ttc'],
];

/** Une ligne qui porte l'un de ces champs est une ligne chiffrée (réseau, coût ou total), pas une section ni une note. */
const CHAMPS_CHIFFRES: readonly Champ[] = ['nb_ecrans', 'depart', 'montant_brut', 'montant_net', 'frais', 'honoraires', 'total_ttc'];
const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
const CONTACTS_15 = /contacts?\s*15\s*\+\s*:\s*([\d\s  .]+)/i;
const CONTACTS_18_24 = /contacts?\s*18\s*-\s*24\s*:\s*([\d\s  .]+)/i;
/** « diffusion d'un spot de 10" <PLAGE>, au sein… » ou « …<PLAGE>, sur les écrans… ». */
const PLAGE = /diffusion d['’]un spot de \S+\s+(.+?)(?=,\s*sur les|,?\s+au sein)/i;
const LIEUX = /(\d[\d\s  ]*)\s*(gares?|clubs?|[ée]tablissements?)/i;

function colonnes(ligne: LigneFeuille): Map<Champ, number> | null {
  const m = new Map<Champ, number>();
  ligne.cellules.forEach((c, i) => {
    const t = normaliser(texte(c) ?? '');
    if (t === '') return;
    const trouve = ENTETES.find(([prefixe]) => t.startsWith(prefixe));
    if (trouve && !m.has(trouve[1])) m.set(trouve[1], i);
  });
  return m.has('regie') && m.has('reseau') ? m : null;
}

function trouverSynthese(classeur: Classeur): { feuille: Feuille; iEntete: number; cols: Map<Champ, number> } | null {
  for (const feuille of classeur.feuilles.values()) {
    for (let i = 0; i < feuille.lignes.length; i++) {
      const cols = colonnes(feuille.lignes[i]);
      if (cols) return { feuille, iEntete: i, cols };
    }
  }
  return null;
}

function uniteLieux(mot: string): string {
  const n = normaliser(mot);
  if (n.startsWith('GARE')) return 'gares';
  if (n.startsWith('CLUB')) return 'clubs';
  return 'établissements';
}

function contacts(note: string, motif: RegExp): number | null {
  const m = motif.exec(note);
  const chiffres = m ? m[1].replace(/\D/g, '') : '';
  return chiffres === '' ? null : Number(chiffres);
}

function lignePlan(
  feuille: Feuille, l: LigneFeuille, entetes: readonly string[], val: (l: LigneFeuille, c: Champ) => Cellule,
  regie: string, section: string | null, ordre: number,
): LignePlan {
  const brut = texte(val(l, 'reseau')) ?? '';
  const drom = section !== null && normaliser(section).includes('DROM');
  const premiere = brut.split(/\r?\n/)[0].replace(/\s*-\s*$/, '').trim();
  const lieux = LIEUX.exec(brut);
  const departBrut = texte(val(l, 'depart'));
  const depart = departBrut !== null && DATE_ISO.test(departBrut) ? departBrut : null;
  const dureeLibelle = texte(val(l, 'duree'));
  const duree = lireDuree(dureeLibelle);
  const details: Record<string, unknown> = {
    onglet: feuille.nom, ligne: l.numero, section, reseau_origine: brut === '' ? null : brut,
    cellules: cellulesNommees(entetes, l.cellules),
  };
  if (lieux) {
    details.nb_lieux_plan = Number(lieux[1].replace(/\D/g, ''));
    details.unite_lieux_plan = uniteLieux(lieux[2]);
  }
  if (duree) details.jours_diffusion = duree.jours_diffusion;
  return {
    ordre, media: 'ooh', regie,
    reseau: drom || premiere === '' ? null : premiere,
    territoire: drom && premiere !== '' ? premiere : null,
    nb_ecrans: entier(val(l, 'nb_ecrans')), format: texte(val(l, 'format')), nb_diffusions: entier(val(l, 'nb_diffusions')),
    date_debut: depart, date_fin: dateFinLigne(depart, dureeLibelle), duree_libelle: dureeLibelle,
    rang_option: texte(val(l, 'rang_option')), plage_horaire: null,
    montant_brut: nombre(val(l, 'montant_brut')), montant_net: nombre(val(l, 'montant_net')), frais: nombre(val(l, 'frais')),
    honoraires: nombre(val(l, 'honoraires')), total_ttc: nombre(val(l, 'total_ttc')),
    contacts_15_plus: null, contacts_18_24: null, details,
  };
}

function lire(classeur: Classeur): LecturePlan {
  const trouve = trouverSynthese(classeur);
  if (!trouve) return { entete: null, lignes: [], emplacements: [] };
  const { feuille, iEntete, cols } = trouve;
  const entetes = feuille.lignes[iEntete].cellules.map((c) => texte(c) ?? '');
  const val = (l: LigneFeuille, champ: Champ): Cellule => {
    const i = cols.get(champ);
    return i === undefined ? null : (l.cellules[i] ?? null);
  };
  const titres = feuille.lignes.slice(0, iEntete)
    .map((l) => l.cellules.map((c) => texte(c)).find((t): t is string => t !== null))
    .filter((t): t is string => t !== undefined);

  const lignes: LignePlan[] = [];
  const couts: CoutAnnexe[] = [];
  const notes: string[] = [];
  let section: string | null = null;
  let budget: number | null = null;

  for (const l of feuille.lignes.slice(iEntete + 1)) {
    const regie = texte(val(l, 'regie'));
    if (regie === null) continue;
    const remplies = l.cellules.filter((c) => texte(c) !== null).length;
    const chiffree = CHAMPS_CHIFFRES.some((c) => val(l, c) !== null);
    if (!chiffree && remplies === 1) {
      if (regie.length > 60 || regie.includes(':')) notes.push(regie);
      else section = regie;
      continue;
    }
    if (normaliser(regie).startsWith('TOTAL')) {
      budget = nombre(val(l, 'total_ttc'));
      continue;
    }
    if (val(l, 'nb_ecrans') === null && val(l, 'depart') === null) {
      couts.push({ libelle: regie, frais: nombre(val(l, 'frais')), honoraires: nombre(val(l, 'honoraires')), total_ttc: nombre(val(l, 'total_ttc')) });
      continue;
    }
    lignes.push(lignePlan(feuille, l, entetes, val, regie, section, lignes.length + 1));
  }

  // Chaque note « RÉGIE : … » complète les lignes de cette régie : plage horaire et contacts 15+ / 18-24.
  for (const note of notes) {
    const m = /^([^:]+?)\s*:\s*([\s\S]+)$/.exec(note);
    if (!m) continue;
    const cle = normaliser(m[1]);
    for (const lp of lignes) {
      if (normaliser(lp.regie) !== cle) continue;
      lp.details.note_plan = note;
      lp.contacts_15_plus ??= contacts(note, CONTACTS_15);
      lp.contacts_18_24 ??= contacts(note, CONTACTS_18_24);
      lp.plage_horaire ??= PLAGE.exec(note)?.[1]?.trim() ?? null;
    }
  }

  const debuts = lignes.map((l) => l.date_debut).filter((d): d is string => d !== null).sort();
  const fins = lignes.map((l) => l.date_fin).filter((d): d is string => d !== null).sort();
  const titre = titres[0] ?? null;
  const periode = titre !== null && debuts.length > 0 ? periodeDuTitre(titre, Number(debuts[0].slice(0, 4))) : null;
  return {
    entete: {
      titre,
      hypothese: titres[1] ?? null,
      date_debut: periode?.debut ?? debuts[0] ?? null,
      date_fin: periode?.fin ?? fins[fins.length - 1] ?? null,
      budget_total_ttc: budget,
      couts_annexes: couts,
      notes,
    },
    lignes,
    emplacements: [],
  };
}

export const ADAPTATEUR_SYNTHESE: AdaptateurPlan = {
  id: 'synthese-hyp',
  regies: [],
  reconnait: (classeur) => trouverSynthese(classeur) !== null,
  lire,
};
```

- [ ] **Step 6: Relancer les tests**

Run: `npx vitest run --project unit tests/unit/ooh/plan-lecture.test.ts tests/unit/ooh/synthese-hyp.test.ts tests/unit/import/xlsx-reader.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: code de retour 0.

- [ ] **Step 7: Catalogue, commit**

Run: `npm run catalogue`, puis `npx vitest run --project unit tests/unit/docs/catalogue-code.test.ts`
Expected: PASS (les exports neufs sont consommés par les tests, entrées de knip ; `ADAPTATEUR_SYNTHESE` le sera aussi par `adaptateurs/index.ts` à la tâche 6).

```bash
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add types/campagnes-media.ts lib/ooh/plan/texte.ts lib/ooh/plan/classeur.ts lib/ooh/plan/durees.ts lib/ooh/plan/fusion.ts \
  lib/ooh/plan/adaptateurs/synthese-hyp.ts lib/import/xlsx-reader.ts tests/unit/ooh/_classeur.ts tests/unit/ooh/plan-lecture.test.ts \
  tests/unit/ooh/synthese-hyp.test.ts docs/CATALOGUE_CODE.md
git commit -m "feat: lecture d'un plan OOH — classeur, durées et onglet de synthèse" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Listes des régies — gares, Basic-Fit, Stride — et rattachement aux lignes

**Files:**
- Create: `lib/ooh/plan/adaptateurs/mediatransports-gares.ts`, `lib/ooh/plan/adaptateurs/basic-fit.ts`, `lib/ooh/plan/adaptateurs/stride-campus.ts`, `lib/ooh/plan/adaptateurs/index.ts`
- Create: `tests/unit/ooh/gares-listing.test.ts`, `tests/unit/ooh/basic-fit.test.ts`, `tests/unit/ooh/stride-campus.test.ts`, `tests/unit/ooh/rattachement.test.ts`

**Interfaces:**
- Consumes (tâche 5) : `Classeur`, `Feuille`, `LigneFeuille`, `EmplacementBrut`, `AdaptateurPlan`, `LecturePlan`, `LignePlan`, `EnteteCampagne`, `AdaptateurId`, `BlocGares` ; `normaliser`, `texte`, `nombre`, `entier`, `codePostal`, `cellulesNommees` ; `fusionnerEmplacements` ; `ADAPTATEUR_SYNTHESE`.
- Produces:
  - `ADAPTATEUR_GARES: AdaptateurPlan` (`id 'mediatransports-gares'`, `regies ['MEDIATRANSPORTS']`) — un emplacement par gare : `cle = normaliser(nom)`, `type_lieu 'gare'`, `reseau 'DOOH gare'`, `nb_ecrans` = « Total général », `formats` (`'solo 9/16'`, `'solo 16/9'`, `'duo'`, `'trio'`, `'quatro'`), `recherche { type: 'gare', nom, bloc }`, `metadata { onglet, bloc, ecrans_par_format, patrimoine_max, lignes }`.
  - `LibelleBasicFit { code: string | null; type: string | null; ville: string; rue: string | null; lecteur: string | null }`, `decouperLibelleBasicFit(libelle: string): LibelleBasicFit | null`, `ADAPTATEUR_BASIC_FIT: AdaptateurPlan` (`id 'basic-fit'`, `regies ['BASIC FIT', 'BASICFIT']`) — un emplacement par club (`cle` = code club, ou `sans-code:<VILLE>|<RUE>`), `nb_ecrans` = nombre de lecteurs, `formats` = types de lecteur, `recherche { type: 'adresse', adresse: rue ?? '', code_postal: null, ville, commune_seule: rue === null }`.
  - `ADAPTATEUR_STRIDE: AdaptateurPlan` (`id 'stride-campus'`, `regies ['STRIDE']`) — `cle = <ETABLISSEMENT>|<cp>`, `formats [`${taille}"`]`, contacts par semaine, `recherche { type: 'adresse', adresse, code_postal, ville, commune_seule: false }`.
  - `index.ts` : `ADAPTATEURS: readonly AdaptateurPlan[]`, `PlanLu { entete: EnteteCampagne; lignes: LignePlan[]; emplacements: EmplacementBrut[]; adaptateurs: AdaptateurId[] }`, `lirePlan(classeur: Classeur): PlanLu`, `Rattachement { adaptateur: AdaptateurId; emplacements: EmplacementBrut[] }`, `rattacher(lignes: readonly LignePlan[], emplacements: readonly EmplacementBrut[]): Map<number, Rattachement>` (clé = `ordre` de la ligne ; une liste n'est rattachée qu'à la PREMIÈRE ligne de sa régie).

- [ ] **Step 1: Écrire les tests**

`tests/unit/ooh/gares-listing.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { ADAPTATEUR_GARES } from '@/lib/ooh/plan/adaptateurs/mediatransports-gares';
import { classeurEssai, type ValeurEssai } from './_classeur';

const vide = (n: number): null[] => Array.from({ length: n }, () => null);
const ENTETE: ValeurEssai[] = ['SITES', 'METRO', 'GARE', 'SOLO', 'SOLO', 'DUO', 'TRIO', 'QUATRO', 'Total général', 'Patrimoine potentiel maximal'];
const SOUS: ValeurEssai[] = [null, null, null, '9/16ème', '16/9ème', 'compacte', 'compacte', 'compacte', null, null];

/** Une liste SYNTHÉTIQUE de la forme « LISTING GARE » : deux blocs côte à côte, IDF (A-J) et province (L-U). */
const LISTE: ValeurEssai[][] = [
  ['DOOH GARE IDF', ...vide(10), 'DOOH GARE PROVINCE'],
  ['Synthèse', ...vide(10), 'Synthèse'],
  [],
  [...ENTETE, null, ...ENTETE],
  [...SOUS, null, ...SOUS],
  ['VILLE A - GARE DE VILLE A', null, 1, 1, null, null, null, null, 1, 2, null, 'VILLE B', null, 4, 1, null, null, 3, null, 4, 7],
  ['VILLE C', null, 2, 2, null, null, null, null, 2, 3, null, 'Total Région', null, 4, 1, null, null, 3, null, 4, 7],
  ['Total Paris', null, 3, 3, null, null, null, null, 3, 5],
  ['Total sites Paris : 2'],
];

describe('adaptateur mediatransports-gares', () => {
  it('reconnaît la liste par ses en-têtes SITES et GARE', async () => {
    expect(ADAPTATEUR_GARES.reconnait(await classeurEssai({ 'LISTING GARE': LISTE }))).toBe(true);
    expect(ADAPTATEUR_GARES.reconnait(await classeurEssai({ AUTRE: [['CLub name']] }))).toBe(false);
  });

  it('une gare par ligne de chaque bloc, totaux ignorés', async () => {
    const { emplacements, lignes } = ADAPTATEUR_GARES.lire(await classeurEssai({ 'LISTING GARE': LISTE }));
    expect(lignes).toEqual([]);
    expect(emplacements.map((e) => [e.nom_lieu, e.recherche])).toEqual([
      ['VILLE A - GARE DE VILLE A', { type: 'gare', nom: 'VILLE A - GARE DE VILLE A', bloc: 'idf' }],
      ['VILLE C', { type: 'gare', nom: 'VILLE C', bloc: 'idf' }],
      ['VILLE B', { type: 'gare', nom: 'VILLE B', bloc: 'province' }],
    ]);
  });

  it('écrans, formats et tout le détail de la ligne', async () => {
    const { emplacements } = ADAPTATEUR_GARES.lire(await classeurEssai({ 'LISTING GARE': LISTE }));
    const b = emplacements.find((e) => e.nom_lieu === 'VILLE B')!;
    expect(b).toMatchObject({
      adaptateur: 'mediatransports-gares', cle: 'VILLE B', type_lieu: 'gare', reseau: 'DOOH gare', numerique: true,
      nb_ecrans: 4, formats: ['solo 9/16', 'trio'], adresse: null, reference_panneau: null,
    });
    expect(b.metadata).toMatchObject({ onglet: 'LISTING GARE', bloc: 'province', ecrans_par_format: { 'solo 9/16': 1, trio: 3 }, patrimoine_max: 7 });
    expect(b.metadata.lignes).toEqual([{
      numero: 6,
      cellules: {
        SITES: 'VILLE B', METRO: null, GARE: 4, 'SOLO 9/16ème': 1, 'SOLO 16/9ème': null, 'DUO compacte': null,
        'TRIO compacte': 3, 'QUATRO compacte': null, 'Total général': 4, 'Patrimoine potentiel maximal': 7,
      },
    }]);
  });
});
```

`tests/unit/ooh/basic-fit.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { ADAPTATEUR_BASIC_FIT, decouperLibelleBasicFit } from '@/lib/ooh/plan/adaptateurs/basic-fit';
import { classeurEssai } from './_classeur';

describe('decouperLibelleBasicFit — les formes de libellé d une liste de lecteurs (libellés SYNTHÉTIQUES)', () => {
  it.each([
    ['Basic-Fit FR Villetest Avenue des Essais 1234 WW', { code: '1234', type: 'WW', ville: 'Villetest', rue: 'Avenue des Essais', lecteur: null }],
    ['FR Bourg-Essai 2345 DS-1', { code: '2345', type: 'DS', ville: 'Bourg-Essai', rue: null, lecteur: null }],
    ['FR - Saint-Essai - 3456 - Player 1 - Digital Signage 1', { code: '3456', type: 'DS', ville: 'Saint-Essai', rue: null, lecteur: 'Player 1 - Digital Signage 1' }],
    ['FR - Villetest - 3457 - Player 1 - Welcome Wall 1', { code: '3457', type: 'WW', ville: 'Villetest', rue: null, lecteur: 'Player 1 - Welcome Wall 1' }],
    ['FR 4567 Villetest rue du Banc NC', { code: '4567', type: 'NC', ville: 'Villetest', rue: 'rue du Banc', lecteur: null }],
    ['5678 WW Villetest Route des Bancs', { code: '5678', type: 'WW', ville: 'Villetest', rue: 'Route des Bancs', lecteur: null }],
    ['Basic-Fit FR Villetest Rue du 8 Mai 1945 6789 NC', { code: '6789', type: 'NC', ville: 'Villetest', rue: 'Rue du 8 Mai 1945', lecteur: null }],
    ['Basic-Fit FR Villetest Rue Sans Code NC', { code: null, type: 'NC', ville: 'Villetest', rue: 'Rue Sans Code', lecteur: null }],
    ['Basic-FIt FR Villetest Avenue de l’Essai EXPRESS 7890 WW', { code: '7890', type: 'WW', ville: 'Villetest', rue: "Avenue de l'Essai EXPRESS", lecteur: null }],
    ['FR Villetest 7029 DS-', { code: '7029', type: 'DS', ville: 'Villetest', rue: null, lecteur: null }],
    ['Basic-Fit FR Villetest Zone Industrielle Rue Haute 7032 W', { code: '7032', type: 'W', ville: 'Villetest', rue: 'Zone Industrielle Rue Haute', lecteur: null }],
    ['FR Villetest 7034 WW1', { code: '7034', type: 'WW', ville: 'Villetest', rue: null, lecteur: null }],
    ["Basic-Fit FR Port-Essai Rue du Quai", { code: null, type: null, ville: 'Port-Essai', rue: 'Rue du Quai', lecteur: null }],
    ['Basic-Fit FR Fréville-Essai Rue Haute 1111 NC', { code: '1111', type: 'NC', ville: 'Fréville-Essai', rue: 'Rue Haute', lecteur: null }],
  ])('%s', (libelle, attendu) => {
    expect(decouperLibelleBasicFit(libelle)).toEqual(attendu);
  });

  it('un libellé vide après les préfixes rend null', () => {
    expect(decouperLibelleBasicFit('Basic-Fit FR ')).toBeNull();
  });
});

describe('adaptateur basic-fit', () => {
  const LISTE = [
    ['CLub name'],
    ['Basic-Fit FR Villetest Avenue des Essais 1234 WW'],
    ['Basic-Fit FR Villetest Avenue des Essais 1234 NC'],
    ['FR Bourg-Essai 2345 DS-1'],
    ['Basic-Fit FR Villetest Rue Sans Code NC'],
    ['Basic-Fit FR Villetest Rue Sans Code WW'],
    [],
  ];

  it('reconnaît la liste par son en-tête « CLub name »', async () => {
    expect(ADAPTATEUR_BASIC_FIT.reconnait(await classeurEssai({ 'LISTING BASIC FIT': LISTE }))).toBe(true);
  });

  it('un emplacement par club : lecteurs comptés, types réunis, toutes les lignes gardées', async () => {
    const { emplacements } = ADAPTATEUR_BASIC_FIT.lire(await classeurEssai({ 'LISTING BASIC FIT': LISTE }));
    expect(emplacements).toHaveLength(3);
    const club = emplacements.find((e) => e.cle === '1234')!;
    expect(club).toMatchObject({
      adaptateur: 'basic-fit', nom_lieu: 'Basic-Fit Villetest Avenue des Essais', type_lieu: 'salle de sport',
      reseau: 'DOOH salle de sport', numerique: true, nb_ecrans: 2, formats: ['WW', 'NC'], adresse: 'Avenue des Essais',
      code_postal: null, ville: 'Villetest', reference_panneau: '1234',
      recherche: { type: 'adresse', adresse: 'Avenue des Essais', code_postal: null, ville: 'Villetest', commune_seule: false },
    });
    expect(club.metadata.lignes.map((l) => l.numero)).toEqual([2, 3]);
    expect(club.metadata.lignes[0].cellules).toEqual({ 'CLub name': 'Basic-Fit FR Villetest Avenue des Essais 1234 WW' });
  });

  it('sans rue : la commune seule est cherchée ; sans code : la clé est la ville et la rue', async () => {
    const { emplacements } = ADAPTATEUR_BASIC_FIT.lire(await classeurEssai({ 'LISTING BASIC FIT': LISTE }));
    expect(emplacements.find((e) => e.cle === '2345')!.recherche)
      .toEqual({ type: 'adresse', adresse: '', code_postal: null, ville: 'Bourg-Essai', commune_seule: true });
    const sansCode = emplacements.find((e) => e.cle === 'sans-code:VILLETEST|RUE SANS CODE')!;
    expect(sansCode).toMatchObject({ nb_ecrans: 2, formats: ['NC', 'WW'], reference_panneau: null });
  });
});
```

`tests/unit/ooh/stride-campus.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { ADAPTATEUR_STRIDE } from '@/lib/ooh/plan/adaptateurs/stride-campus';
import { classeurEssai } from './_classeur';

const ENTETE = ['Etablissement', 'Groupement', 'Type', 'Adresse', 'CP', 'Ville', 'Zone', 'Ecrans', 'Taille écrans', 'Contacts par semaine', 'Contacts 18-25 par semaine'];
const LISTE = [
  [],
  ENTETE,
  ['Campus Essai', '0', 'Campus', "1 rue de l'Essai", '13008', 'Villetest', 'Zone A', '1', '10', '6000', '5700'],
  ['Cinéma Essai', 'Groupe Essai', 'Cinéma', '2 avenue Test', 75001, 'Paris', 'Paris', 2, 43, 150000, 142500],
  [],
  ['Campus Essai', '0', 'Campus', "1 rue de l'Essai", '13008', 'Villetest', 'Zone A', '1', '10', '6000', '5700'],
];

describe('adaptateur stride-campus', () => {
  it('reconnaît la liste par ses en-têtes', async () => {
    expect(ADAPTATEUR_STRIDE.reconnait(await classeurEssai({ 'LISTING CAMPUS': LISTE }))).toBe(true);
  });

  it('un emplacement par établissement et code postal : écrans, taille, contacts, adresse complète', async () => {
    const { emplacements } = ADAPTATEUR_STRIDE.lire(await classeurEssai({ 'LISTING CAMPUS': LISTE }));
    expect(emplacements).toHaveLength(2);
    expect(emplacements[1]).toMatchObject({
      adaptateur: 'stride-campus', cle: 'CINEMA ESSAI|75001', nom_lieu: 'Cinéma Essai', type_lieu: 'cinéma',
      reseau: 'DOOH borne de recharge', numerique: true, nb_ecrans: 2, formats: ['43"'], adresse: '2 avenue Test',
      code_postal: '75001', ville: 'Paris', contacts_semaine: 150000, contacts_18_25_semaine: 142500,
      recherche: { type: 'adresse', adresse: '2 avenue Test', code_postal: '75001', ville: 'Paris', commune_seule: false },
    });
    expect(emplacements[1].metadata).toMatchObject({ onglet: 'LISTING CAMPUS', groupement: 'Groupe Essai', zone: 'Paris', taille_ecran_pouces: 43 });
  });

  it('deux lignes du même établissement sont réunies ; un groupement « 0 » est absent', async () => {
    const { emplacements } = ADAPTATEUR_STRIDE.lire(await classeurEssai({ 'LISTING CAMPUS': LISTE }));
    expect(emplacements[0]).toMatchObject({ cle: 'CAMPUS ESSAI|13008', type_lieu: 'campus', nb_ecrans: 2, contacts_semaine: 12000, contacts_18_25_semaine: 11400 });
    expect(emplacements[0].metadata.groupement).toBeNull();
    expect(emplacements[0].metadata.lignes.map((l) => l.numero)).toEqual([3, 6]);
  });
});
```

`tests/unit/ooh/rattachement.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { lirePlan, rattacher } from '@/lib/ooh/plan/adaptateurs';
import { classeurEssai, type ValeurEssai } from './_classeur';

const jour = (j: number) => new Date(Date.UTC(2026, 8, j));
const HYP: ValeurEssai[][] = [
  [null, 'ESSAI - 20/09 - 02/10'],
  [null, 'AFFICHEURS', 'RESEAUX', "NBRE D'ECRANS", 'FORMAT', 'LOGS', 'DEPART', 'DUREE', 'RANG OPTION', 'TARIF BRUT', 'TARIF NET ESTIME', 'FRAIS ESTIMES', 'HONO NET+FRAIS', 'TOTAL TTCHI'],
  [null, 'METROPOLE'],
  [null, 'MEDIATRANSPORTS', 'DOOH GARE - 2 gares', 3, 'DOOH', 10, jour(21), '2 semaines', '2nd OPTION', 1, 1, 1, 1, 1],
  [null, 'BASIC FIT', 'DOOH SALLE - 1 clubs', 4, 'DOOH', 10, jour(20), '2 semaines', '2nd OPTION', 1, 1, 1, 1, 1],
  [null, 'DROM TOM'],
  [null, 'MEDIAOUTREMER', 'LA REUNION', 5, '12m²', null, jour(24), '7 jours', '2nd OPTION', 1, 1, 1, 1, 1],
];
const GARES: ValeurEssai[][] = [
  ['DOOH GARE IDF'],
  [],
  ['SITES', 'METRO', 'GARE', 'SOLO', 'SOLO', 'DUO', 'TRIO', 'QUATRO', 'Total général', 'Patrimoine potentiel maximal'],
  [null, null, null, '9/16ème', '16/9ème', 'compacte', 'compacte', 'compacte'],
  ['VILLE A', null, 1, 1, null, null, null, null, 1, 1],
  ['VILLE C', null, 2, 2, null, null, null, null, 2, 2],
];
const CLUBS: ValeurEssai[][] = [['CLub name'], ['Basic-Fit FR Villetest Avenue des Essais 1234 WW']];

describe('lirePlan et rattacher', () => {
  it('reconnaît la synthèse et les listes, puis rattache chaque liste à la ligne de sa régie', async () => {
    const plan = lirePlan(await classeurEssai({ HYP1: HYP, 'LISTING GARE': GARES, 'LISTING BASIC FIT': CLUBS }));
    expect(plan.adaptateurs).toEqual(['synthese-hyp', 'mediatransports-gares', 'basic-fit']);
    expect(plan.lignes.map((l) => l.regie)).toEqual(['MEDIATRANSPORTS', 'BASIC FIT', 'MEDIAOUTREMER']);
    const r = rattacher(plan.lignes, plan.emplacements);
    expect(r.get(1)?.adaptateur).toBe('mediatransports-gares');
    expect(r.get(1)?.emplacements.map((e) => e.cle)).toEqual(['VILLE A', 'VILLE C']);
    expect(r.get(2)?.adaptateur).toBe('basic-fit');
    expect(r.get(2)?.emplacements).toHaveLength(1);
    expect(r.has(3)).toBe(false);
  });

  it('un plan sans onglet de synthèse est refusé, en français', async () => {
    expect(() => lirePlan({ feuilles: new Map() })).toThrow('Aucun onglet de synthèse reconnu');
  });

  it('une liste n est rattachée qu à la première ligne de sa régie', async () => {
    const plan = lirePlan(await classeurEssai({ HYP1: [...HYP, [null, 'MEDIATRANSPORTS', 'DOOH GARE BIS', 1, 'DOOH', 1, jour(28), '7 jours', '2nd OPTION', 1, 1, 1, 1, 1]], 'LISTING GARE': GARES }));
    const r = rattacher(plan.lignes, plan.emplacements);
    expect(r.get(1)?.adaptateur).toBe('mediatransports-gares');
    expect(r.has(4)).toBe(false);
  });
});
```

- [ ] **Step 2: Les lancer, ils échouent**

Run: `npx vitest run --project unit tests/unit/ooh/gares-listing.test.ts tests/unit/ooh/basic-fit.test.ts tests/unit/ooh/stride-campus.test.ts tests/unit/ooh/rattachement.test.ts`
Expected: FAIL — modules `@/lib/ooh/plan/adaptateurs/…` absents.

- [ ] **Step 3: Écrire l'adaptateur des gares**

`lib/ooh/plan/adaptateurs/mediatransports-gares.ts` :

```ts
/**
 * Adaptateur `mediatransports-gares` : la liste « LISTING GARE » d'un plan Mediatransports (spec 2026-10-16-ooh-campagnes
 * § 3) — DEUX blocs côte à côte, Île-de-France puis province, chacun avec son en-tête sur deux lignes (« SOLO » /
 * « 9/16ème »…), ses lignes de gare, puis « Total Paris » / « Total Région » / « Total sites … » (ignorés).
 * Un emplacement par gare ; la géolocalisation (référentiel SNCF) vient après, et donne l'identité définitive (UIC).
 */
import type { AdaptateurPlan, BlocGares, Cellule, Classeur, EmplacementBrut, Feuille, LecturePlan, LigneFeuille } from '@/types/campagnes-media';
import { fusionnerEmplacements } from '../fusion';
import { nombre, normaliser, texte } from '../texte';

const FORMATS = new Set(['SOLO', 'DUO', 'TRIO', 'QUATRO']);

interface Colonne {
  i: number;
  h1: string;
  h2: string;
  nom: string;
}

function contientEnTete(l: LigneFeuille, valeur: string): boolean {
  return l.cellules.some((c) => normaliser(texte(c) ?? '') === valeur);
}

function trouverFeuille(classeur: Classeur): { feuille: Feuille; iEntete: number } | null {
  for (const feuille of classeur.feuilles.values()) {
    const iEntete = feuille.lignes.findIndex((l) => contientEnTete(l, 'SITES') && contientEnTete(l, 'GARE'));
    if (iEntete >= 0) return { feuille, iEntete };
  }
  return null;
}

/** « SOLO » + « 9/16ème » → `solo 9/16` ; « DUO » + « compacte » → `duo`. */
function libelleFormat(h1: string, h2: string): string {
  const ratio = /(\d+)\s*\/\s*(\d+)/.exec(h2);
  return ratio ? `${h1.toLowerCase()} ${ratio[1]}/${ratio[2]}` : h1.toLowerCase();
}

/** Le bloc d'après le titre au-dessus de sa colonne SITES : « DOOH GARE IDF », « DOOH GARE PROVINCE ». */
function blocDuTitre(titres: readonly LigneFeuille[], debut: number): BlocGares {
  for (const l of titres) {
    const t = normaliser(texte(l.cellules[debut]) ?? '');
    if (/\bIDF\b|ILE DE FRANCE|\bPARIS\b/.test(t)) return 'idf';
    if (/PROVINCE|REGION/.test(t)) return 'province';
  }
  return 'inconnu';
}

const cel = (l: LigneFeuille, i: number | undefined): Cellule => (i === undefined ? null : (l.cellules[i] ?? null));

function lire(classeur: Classeur): LecturePlan {
  const trouve = trouverFeuille(classeur);
  if (!trouve) return { entete: null, lignes: [], emplacements: [] };
  const { feuille, iEntete } = trouve;
  const entete = feuille.lignes[iEntete];
  const sous = feuille.lignes[iEntete + 1];
  const titres = feuille.lignes.slice(0, iEntete);
  const debuts = entete.cellules.map((c, i) => (normaliser(texte(c) ?? '') === 'SITES' ? i : -1)).filter((i) => i >= 0);
  const emplacements: EmplacementBrut[] = [];

  debuts.forEach((debut, k) => {
    const fin = debuts[k + 1] ?? entete.cellules.length;
    const bloc = blocDuTitre(titres, debut);
    const cols: Colonne[] = [];
    for (let i = debut; i < fin; i++) {
      const h1 = texte(entete.cellules[i]) ?? '';
      const h2 = sous ? (texte(sous.cellules[i]) ?? '') : '';
      if (h1 === '' && h2 === '') continue;
      cols.push({ i, h1, h2, nom: `${h1} ${h2}`.trim() });
    }
    const iGare = cols.find((c) => normaliser(c.h1) === 'GARE')?.i;
    const iTotal = cols.find((c) => normaliser(c.h1).startsWith('TOTAL'))?.i;
    const iPatrimoine = cols.find((c) => normaliser(c.h1).startsWith('PATRIMOINE'))?.i;
    const formats = cols.filter((c) => FORMATS.has(normaliser(c.h1))).map((c) => ({ i: c.i, libelle: libelleFormat(c.h1, c.h2) }));

    for (const l of feuille.lignes.slice(iEntete + 2)) {
      const nom = texte(l.cellules[debut]);
      if (nom === null || normaliser(nom).startsWith('TOTAL')) continue;
      const nb = nombre(cel(l, iTotal)) ?? nombre(cel(l, iGare));
      if (nb === null) continue;
      const parFormat: Record<string, number> = {};
      for (const f of formats) {
        const v = nombre(cel(l, f.i));
        if (v) parFormat[f.libelle] = v;
      }
      emplacements.push({
        adaptateur: 'mediatransports-gares',
        cle: normaliser(nom),
        nom_lieu: nom,
        type_lieu: 'gare',
        reseau: 'DOOH gare',
        numerique: true,
        nb_ecrans: Math.round(nb),
        formats: Object.keys(parFormat),
        adresse: null,
        code_postal: null,
        ville: null,
        reference_panneau: null,
        contacts_semaine: null,
        contacts_18_25_semaine: null,
        recherche: { type: 'gare', nom, bloc },
        metadata: {
          onglet: feuille.nom,
          bloc,
          ecrans_par_format: parFormat,
          patrimoine_max: nombre(cel(l, iPatrimoine)),
          lignes: [{ numero: l.numero, cellules: Object.fromEntries(cols.map((c) => [c.nom, cel(l, c.i)])) }],
        },
      });
    }
  });

  return { entete: null, lignes: [], emplacements: fusionnerEmplacements(emplacements, (e) => e.cle) };
}

export const ADAPTATEUR_GARES: AdaptateurPlan = {
  id: 'mediatransports-gares',
  regies: ['MEDIATRANSPORTS'],
  reconnait: (classeur) => trouverFeuille(classeur) !== null,
  lire,
};
```

- [ ] **Step 4: Écrire l'adaptateur Basic-Fit**

`lib/ooh/plan/adaptateurs/basic-fit.ts` :

```ts
/**
 * Adaptateur `basic-fit` : la liste « LISTING BASIC FIT » — une colonne « CLub name », UNE LIGNE PAR LECTEUR, libellé
 * libre (spec 2026-10-16-ooh-campagnes § 3). Formes rencontrées le 16/10 :
 *   « Basic-Fit FR <Ville> <Rue> <code> <type> »          (forme principale)
 *   « FR <Ville> <code> <type>-1 »                          (sans rue : la commune seule sera cherchée → à vérifier)
 *   « FR - <Ville> - <code> - Player 1 - Digital Signage 1 » (lecteur nommé)
 *   « FR <code> <Ville> <Rue> <type> », « <code> <type> <Ville> <Rue> » (code en tête)
 *   sans code club, ou sans type de lecteur.
 * Le code club est un nombre de 4-5 chiffres SUIVI d'un type de lecteur (WW, NC, DS, W), ou en tête, ou en fin : un
 * nombre de la rue (« Rue du 8 Mai 1945 ») n'est jamais pris pour lui. La ville s'arrête au premier mot de voie.
 * Les lecteurs d'un même club sont réunis (`nb_ecrans` = nombre de lecteurs, `formats` = types).
 */
import type { AdaptateurPlan, Classeur, EmplacementBrut, Feuille, LecturePlan } from '@/types/campagnes-media';
import { fusionnerEmplacements } from '../fusion';
import { normaliser, texte } from '../texte';

/** Ce que l'on tire d'un libellé de lecteur. */
export interface LibelleBasicFit {
  code: string | null;
  type: string | null;
  ville: string;
  rue: string | null;
  lecteur: string | null;
}

const TYPE_LECTEUR = /^(WW|NC|DS|W)(?:-?\d*)$/i;
const CODE_CLUB = /^\d{4,5}$/;
/** Premiers mots d'une voie (minuscules, sans accents ni point final). */
const VOIES = new Set([
  'rue', 'avenue', 'av', 'boulevard', 'bd', 'route', 'rte', 'chemin', 'place', 'allee', 'impasse', 'quai', 'cours',
  'zac', 'za', 'zi', 'zone', 'centre', 'parc', 'lieu', 'chaussee', 'voie', 'square', 'esplanade', 'rond-point',
  'promenade', 'faubourg', 'espace', 'mail', 'parvis', 'carrefour', 'lotissement', 'domaine', 'cc',
]);

function plierMot(mot: string): string {
  return mot.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.,]+$/, '');
}

/** Découpe un libellé de lecteur ; `null` s'il ne reste rien après les préfixes « Basic-Fit » et « FR ». */
export function decouperLibelleBasicFit(libelle: string): LibelleBasicFit | null {
  const propre = libelle.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
  // « FR » en MAJUSCULES suivi d'un espace ou d'un tiret : jamais le début d'une ville (« Fréjus », « Frouard »).
  const t = propre.replace(/^basic-?fit\s+/i, '').replace(/^FR(?:\s*-\s*|\s+)/, '').trim();
  if (t === '') return null;

  const lecteurNomme = /^(.+?)\s*-\s*(\d{4,5})\s*-\s*(.+)$/.exec(t);
  if (lecteurNomme) {
    const lecteur = lecteurNomme[3].trim();
    const type = /digital signage/i.test(lecteur) ? 'DS' : /welcome wall/i.test(lecteur) ? 'WW' : null;
    return { code: lecteurNomme[2], type, ville: lecteurNomme[1].trim(), rue: null, lecteur };
  }

  const mots = t.split(' ');
  let iCode = -1;
  mots.forEach((m, i) => {
    if (!CODE_CLUB.test(m)) return;
    const suiviDunType = i + 1 < mots.length && TYPE_LECTEUR.test(mots[i + 1]);
    if (suiviDunType || i === 0 || (i === mots.length - 1 && iCode < 0)) iCode = i;
  });

  let code: string | null = null;
  let type: string | null = null;
  if (iCode >= 0) {
    code = mots[iCode];
    const suivant = mots[iCode + 1];
    if (suivant !== undefined && TYPE_LECTEUR.test(suivant)) {
      type = suivant;
      mots.splice(iCode, 2);
    } else {
      mots.splice(iCode, 1);
    }
  }
  if (type === null && mots.length > 1 && TYPE_LECTEUR.test(mots[mots.length - 1])) type = mots.pop() ?? null;
  if (mots.length === 0) return null;

  const iVoie = mots.findIndex((m, i) => i > 0 && VOIES.has(plierMot(m)));
  return {
    code,
    type: type === null ? null : type.toUpperCase().replace(/-?\d*$/, ''),
    ville: (iVoie > 0 ? mots.slice(0, iVoie) : mots).join(' '),
    rue: iVoie > 0 ? mots.slice(iVoie).join(' ') : null,
    lecteur: null,
  };
}

function trouverFeuille(classeur: Classeur): { feuille: Feuille; iEntete: number; colonne: number } | null {
  for (const feuille of classeur.feuilles.values()) {
    for (let i = 0; i < feuille.lignes.length; i++) {
      const colonne = feuille.lignes[i].cellules.findIndex((c) => normaliser(texte(c) ?? '') === 'CLUB NAME');
      if (colonne >= 0) return { feuille, iEntete: i, colonne };
    }
  }
  return null;
}

function lire(classeur: Classeur): LecturePlan {
  const trouve = trouverFeuille(classeur);
  if (!trouve) return { entete: null, lignes: [], emplacements: [] };
  const { feuille, iEntete, colonne } = trouve;
  const entete = texte(feuille.lignes[iEntete].cellules[colonne]) ?? 'CLub name';
  const lecteurs: EmplacementBrut[] = [];
  for (const l of feuille.lignes.slice(iEntete + 1)) {
    const libelle = texte(l.cellules[colonne]);
    if (libelle === null) continue;
    const d = decouperLibelleBasicFit(libelle);
    if (d === null) continue;
    lecteurs.push({
      adaptateur: 'basic-fit',
      cle: d.code ?? `sans-code:${normaliser(d.ville)}|${normaliser(d.rue ?? '')}`,
      nom_lieu: `Basic-Fit ${d.ville}${d.rue === null ? '' : ` ${d.rue}`}`,
      type_lieu: 'salle de sport',
      reseau: 'DOOH salle de sport',
      numerique: true,
      nb_ecrans: 1,
      formats: d.type === null ? [] : [d.type],
      adresse: d.rue,
      code_postal: null,
      ville: d.ville,
      reference_panneau: d.code,
      contacts_semaine: null,
      contacts_18_25_semaine: null,
      recherche: { type: 'adresse', adresse: d.rue ?? '', code_postal: null, ville: d.ville, commune_seule: d.rue === null },
      metadata: { onglet: feuille.nom, club: d.code, lignes: [{ numero: l.numero, cellules: { [entete]: libelle }, decoupe: { ...d } }] },
    });
  }
  return { entete: null, lignes: [], emplacements: fusionnerEmplacements(lecteurs, (e) => e.cle) };
}

export const ADAPTATEUR_BASIC_FIT: AdaptateurPlan = {
  id: 'basic-fit',
  regies: ['BASIC FIT', 'BASICFIT'],
  reconnait: (classeur) => trouverFeuille(classeur) !== null,
  lire,
};
```

- [ ] **Step 5: Écrire l'adaptateur Stride**

`lib/ooh/plan/adaptateurs/stride-campus.ts` :

```ts
/**
 * Adaptateur `stride-campus` : la liste « LISTING CAMPUS » de Stride, bornes de recharge à écran (spec
 * 2026-10-16-ooh-campagnes § 3) — en-tête sur une ligne (établissement, groupement, type, adresse, CP, ville, zone,
 * écrans, taille d'écran, contacts par semaine, contacts 18-25 par semaine), une ligne par lieu.
 * Identité : établissement normalisé + code postal. Deux lignes du même lieu sont réunies (écrans et contacts additionnés).
 */
import type { AdaptateurPlan, Cellule, Classeur, EmplacementBrut, Feuille, LecturePlan, LigneFeuille } from '@/types/campagnes-media';
import { fusionnerEmplacements } from '../fusion';
import { cellulesNommees, codePostal, entier, nombre, normaliser, texte } from '../texte';

type Champ = 'etablissement' | 'groupement' | 'type' | 'adresse' | 'cp' | 'ville' | 'zone' | 'ecrans' | 'taille' | 'contacts' | 'contacts_18_25';

/** En-tête normalisé → champ ; exact, sauf les deux préfixes de contacts (« CONTACTS 18 » avant « CONTACTS »). */
function champ(entete: string): Champ | null {
  const n = normaliser(entete);
  if (n === 'ETABLISSEMENT') return 'etablissement';
  if (n === 'GROUPEMENT') return 'groupement';
  if (n === 'TYPE') return 'type';
  if (n === 'ADRESSE') return 'adresse';
  if (n === 'CP' || n === 'CODE POSTAL') return 'cp';
  if (n === 'VILLE') return 'ville';
  if (n === 'ZONE') return 'zone';
  if (n === 'ECRANS') return 'ecrans';
  if (n.startsWith('TAILLE')) return 'taille';
  if (n.startsWith('CONTACTS 18')) return 'contacts_18_25';
  if (n.startsWith('CONTACTS')) return 'contacts';
  return null;
}

function trouverFeuille(classeur: Classeur): { feuille: Feuille; iEntete: number; cols: Map<Champ, number> } | null {
  for (const feuille of classeur.feuilles.values()) {
    for (let i = 0; i < feuille.lignes.length; i++) {
      const cols = new Map<Champ, number>();
      feuille.lignes[i].cellules.forEach((c, j) => {
        const ch = champ(texte(c) ?? '');
        if (ch !== null && !cols.has(ch)) cols.set(ch, j);
      });
      if (cols.has('etablissement') && cols.has('groupement')) return { feuille, iEntete: i, cols };
    }
  }
  return null;
}

function typeLieu(brut: string | null): string {
  const n = normaliser(brut ?? '');
  if (n === 'CAMPUS') return 'campus';
  if (n === 'CINEMA') return 'cinéma';
  if (n === 'RESIDENCE') return 'résidence';
  return (brut ?? 'lieu').toLowerCase();
}

function lire(classeur: Classeur): LecturePlan {
  const trouve = trouverFeuille(classeur);
  if (!trouve) return { entete: null, lignes: [], emplacements: [] };
  const { feuille, iEntete, cols } = trouve;
  const entetes = feuille.lignes[iEntete].cellules.map((c) => texte(c) ?? '');
  const val = (l: LigneFeuille, c: Champ): Cellule => {
    const i = cols.get(c);
    return i === undefined ? null : (l.cellules[i] ?? null);
  };
  const lieux: EmplacementBrut[] = [];
  for (const l of feuille.lignes.slice(iEntete + 1)) {
    const etablissement = texte(val(l, 'etablissement'));
    if (etablissement === null) continue;
    const cp = codePostal(val(l, 'cp'));
    const ville = texte(val(l, 'ville'));
    const adresse = texte(val(l, 'adresse'));
    const taille = nombre(val(l, 'taille'));
    const groupement = texte(val(l, 'groupement'));
    lieux.push({
      adaptateur: 'stride-campus',
      cle: `${normaliser(etablissement)}|${cp ?? ''}`,
      nom_lieu: etablissement,
      type_lieu: typeLieu(texte(val(l, 'type'))),
      reseau: 'DOOH borne de recharge',
      numerique: true,
      nb_ecrans: entier(val(l, 'ecrans')),
      formats: taille === null ? [] : [`${taille}"`],
      adresse,
      code_postal: cp,
      ville,
      reference_panneau: null,
      contacts_semaine: entier(val(l, 'contacts')),
      contacts_18_25_semaine: entier(val(l, 'contacts_18_25')),
      recherche: { type: 'adresse', adresse: adresse ?? '', code_postal: cp, ville, commune_seule: false },
      metadata: {
        onglet: feuille.nom,
        groupement: groupement === null || groupement === '0' ? null : groupement,
        zone: texte(val(l, 'zone')),
        taille_ecran_pouces: taille,
        lignes: [{ numero: l.numero, cellules: cellulesNommees(entetes, l.cellules) }],
      },
    });
  }
  return { entete: null, lignes: [], emplacements: fusionnerEmplacements(lieux, (e) => e.cle) };
}

export const ADAPTATEUR_STRIDE: AdaptateurPlan = {
  id: 'stride-campus',
  regies: ['STRIDE'],
  reconnait: (classeur) => trouverFeuille(classeur) !== null,
  lire,
};
```

- [ ] **Step 6: Écrire l'index des adaptateurs**

`lib/ooh/plan/adaptateurs/index.ts` :

```ts
/**
 * Les adaptateurs de plans de régie, et le rattachement d'une liste d'emplacements à sa ligne de campagne
 * (spec 2026-10-16-ooh-campagnes § 7). La vague suivante = un adaptateur de plus dans `ADAPTATEURS`, ou aucun si le
 * format est le même : le script ne change pas.
 */
import type { AdaptateurId, AdaptateurPlan, Classeur, EmplacementBrut, EnteteCampagne, LignePlan } from '@/types/campagnes-media';
import { normaliser } from '../texte';
import { ADAPTATEUR_BASIC_FIT } from './basic-fit';
import { ADAPTATEUR_GARES } from './mediatransports-gares';
import { ADAPTATEUR_STRIDE } from './stride-campus';
import { ADAPTATEUR_SYNTHESE } from './synthese-hyp';

/** Tous les formats connus, la synthèse en tête. */
export const ADAPTATEURS: readonly AdaptateurPlan[] = [ADAPTATEUR_SYNTHESE, ADAPTATEUR_GARES, ADAPTATEUR_BASIC_FIT, ADAPTATEUR_STRIDE];

/** Un plan lu : l'en-tête et les lignes de la synthèse, les emplacements de toutes les listes reconnues. */
export interface PlanLu {
  entete: EnteteCampagne;
  lignes: LignePlan[];
  emplacements: EmplacementBrut[];
  adaptateurs: AdaptateurId[];
}

/**
 * Lit un plan avec tous les adaptateurs qui le reconnaissent.
 *
 * @throws si aucun onglet de synthèse n'est reconnu : un plan sans lignes ne fait pas une campagne.
 */
export function lirePlan(classeur: Classeur): PlanLu {
  const reconnus = ADAPTATEURS.filter((a) => a.reconnait(classeur));
  const synthese = reconnus.find((a) => a.id === 'synthese-hyp');
  const lu = synthese?.lire(classeur);
  if (!lu?.entete) {
    throw new Error('Aucun onglet de synthèse reconnu (en-tête « AFFICHEURS · RESEAUX ») : ce plan demande un nouvel adaptateur.');
  }
  return {
    entete: lu.entete,
    lignes: lu.lignes,
    emplacements: reconnus.filter((a) => a.id !== 'synthese-hyp').flatMap((a) => a.lire(classeur).emplacements),
    adaptateurs: reconnus.map((a) => a.id),
  };
}

/** Les emplacements d'une ligne et le format qui les a lus. */
export interface Rattachement {
  adaptateur: AdaptateurId;
  emplacements: EmplacementBrut[];
}

/**
 * Rattache chaque liste reconnue à la ligne de sa régie (régies normalisées : « BASIC FIT », « STRIDE »…), par `ordre`.
 * Une liste ne va qu'à la PREMIÈRE ligne de sa régie : la rattacher à deux lignes doublerait ses panneaux dans la
 * campagne. Une ligne sans liste (les DROM) n'a pas d'entrée.
 */
export function rattacher(lignes: readonly LignePlan[], emplacements: readonly EmplacementBrut[]): Map<number, Rattachement> {
  const sortie = new Map<number, Rattachement>();
  const pris = new Set<AdaptateurId>();
  for (const l of lignes) {
    const a = ADAPTATEURS.find((x) => x.regies.includes(normaliser(l.regie)));
    if (!a || pris.has(a.id)) continue;
    pris.add(a.id);
    sortie.set(l.ordre, { adaptateur: a.id, emplacements: emplacements.filter((e) => e.adaptateur === a.id) });
  }
  return sortie;
}
```

- [ ] **Step 7: Relancer les tests**

Run: `npx vitest run --project unit tests/unit/ooh/`
Expected: PASS (tous les fichiers de `tests/unit/ooh/`).

Run: `npx tsc --noEmit`
Expected: code de retour 0.

- [ ] **Step 8: Catalogue, commit**

Run: `npm run catalogue`, puis `npx vitest run --project unit tests/unit/docs/catalogue-code.test.ts`
Expected: PASS.

```bash
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add lib/ooh/plan/adaptateurs/ tests/unit/ooh/gares-listing.test.ts tests/unit/ooh/basic-fit.test.ts tests/unit/ooh/stride-campus.test.ts \
  tests/unit/ooh/rattachement.test.ts docs/CATALOGUE_CODE.md
git commit -m "feat: adaptateurs des listes de régie (gares, Basic-Fit, Stride) et rattachement aux lignes" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Géolocalisation — référentiel SNCF des gares, alias, BAN

**Files:**
- Create: `lib/ooh/plan/gares-sncf.ts`, `lib/ooh/plan/geolocaliser.ts`
- Modify: `lib/import/types.ts:241-253` (`GeocodeDetailedResult.resultCitycode?`), `lib/import/geocoder.ts` (≈ 323-352 et 431-445 : lire `result_citycode`)
- Create: `tests/unit/ooh/gares-sncf.test.ts`, `tests/unit/ooh/geolocaliser.test.ts`, `tests/unit/import/geocoder-citycode.test.ts`

**Interfaces:**
- Consumes (tâches 5-6) : `EmplacementBrut`, `EmplacementPlace`, `EmplacementNonPlace`, `BlocGares`, `GeolocMethode`, `GeolocQualite` ; `normaliser`, `departementDeInsee` ; `fusionnerEmplacements`. `GeocodeDetailedResult` et `extractDeptFromCP` de `lib/import/geocoder.ts`. `fetchLectureAvecReprise` (`lib/http/lecture-avec-reprise.ts`).
- Produces:
  - `gares-sncf.ts` : `URL_REFERENTIEL_GARES: string`, `GareSncf { nom: string; code_insee: string; uic: string; lat: number; lng: number }`, `normaliserNomGare(nom: string): string`, `lireReferentielGares(csv: string): GareSncf[]`, `IndexGares = ReadonlyMap<string, readonly GareSncf[]>`, `indexerGares(gares: readonly GareSncf[]): IndexGares`, `AliasGare { sncf: string; insee: string }`, `ALIAS_GARES: Readonly<Record<string, AliasGare>>` (32 entrées, clés = `normaliser(nom de la liste)`), `ResultatGare = { trouvee: true; gare: GareSncf; methode: 'referentiel_gares' | 'alias_manuel'; qualite: GeolocQualite } | { trouvee: false; raison: string }`, `trouverGare(nom: string, bloc: BlocGares, index: IndexGares): ResultatGare`, `telechargerReferentielGares(): Promise<GareSncf[]>`.
  - `geolocaliser.ts` : `SEUIL_SUR = 0.6`, `SEUIL_NON_PLACE = 0.3`, `LigneAdresse { adresse?: string; code_postal?: string; ville?: string }`, `GeocodeurLot = (rows: LigneAdresse[], onProgress?: (fait: number, total: number) => void) => Promise<GeocodeDetailedResult[]>`, `DependancesGeoloc { gares: readonly GareSncf[]; geocoder: GeocodeurLot; progression?: (fait: number, total: number) => void }`, `ResultatGeoloc { places: EmplacementPlace[]; non_places: EmplacementNonPlace[] }`, `villeCorrespond(attendue: string, rendue: string): boolean`, `geolocaliser(emplacements: readonly EmplacementBrut[], deps: DependancesGeoloc): Promise<ResultatGeoloc>`.
  - `GeocodeDetailedResult.resultCitycode?: string` (code commune INSEE rendu par la BAN).

> **Écart mesuré à la spec (§ 7, « 21 noms composés »)** : la table d'alias porte **32** entrées. Les 21 de la spec (19 introuvables + 2 approchés) ne suffisaient pas : avec l'ordre « première partie » de la spec, 11 noms composés tombaient sur la mauvaise gare (« BOIS COLOMBES - LES VALLEES » → Bois-Colombes ; 5 paires fusionnées sur un même code UIC). Mesure du 16/10 contre le CSV SNCF téléchargé, ordre plein → dernière partie → première+dernière → première, avec les 32 alias : 111 exacts sur le nom plein, 72 sur la dernière partie, 32 par alias, **0** par la seule première partie, **0** introuvable, **215 codes UIC distincts pour 215 gares**. Chaque alias porte le code INSEE de la commune attendue, vérifié au lancement.

- [ ] **Step 1: Écrire les tests**

`tests/unit/ooh/gares-sncf.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { ALIAS_GARES, indexerGares, lireReferentielGares, normaliserNomGare, trouverGare } from '@/lib/ooh/plan/gares-sncf';
import { normaliser } from '@/lib/ooh/plan/texte';

/** Un extrait SYNTHÉTIQUE du CSV « gares-de-voyageurs » (même en-tête, BOM compris), plus une vraie gare publique pour l'alias. */
const CSV = [
  '﻿nom;libellecourt;segment_drg;position_geographique;codeinsee;codes_uic;id',
  'Villetest;VTT;C;48.80, 2.30;92001;87000001;a',
  'Ville Essai Centre;VEC;C;45.10, 5.20;38001;87000002;b',
  'Les Essais;LES;C;48.90, 2.25;92002;87000003;c',
  'Bourg Essai;BES;C;48.95, 2.20;92003;87000004;d',
  'Aix-les-Bains le Revard;ALB;B;45.688161, 5.909371;73008;87741132;e',
  'Sans position;SPS;C;;92004;87000005;f',
].join('\n');

describe('référentiel des gares SNCF', () => {
  it('lit le CSV (BOM, « lat, lon », premier code UIC) et écarte une gare sans position', () => {
    const gares = lireReferentielGares(CSV);
    expect(gares).toHaveLength(5);
    expect(gares[0]).toEqual({ nom: 'Villetest', code_insee: '92001', uic: '87000001', lat: 48.8, lng: 2.3 });
  });

  it('normaliserNomGare retire les mots vides', () => {
    expect(normaliserNomGare("Gare d'Évry - Les Essais")).toBe('EVRY ESSAIS');
  });

  const index = indexerGares(lireReferentielGares(CSV));

  it('nom plein exact : sûr si la gare est dans le bloc (IDF)', () => {
    expect(trouverGare('VILLETEST', 'idf', index)).toMatchObject({ trouvee: true, methode: 'referentiel_gares', qualite: 'sure', gare: { uic: '87000001' } });
  });

  it('une gare hors du bloc annoncé (Isère dans la liste IDF) est à vérifier', () => {
    expect(trouverGare('VILLE ESSAI CENTRE', 'idf', index)).toMatchObject({ trouvee: true, qualite: 'a_verifier' });
  });

  it('la dernière partie passe avant la première (« BOURG ESSAI - LES ESSAIS » est « Les Essais »)', () => {
    expect(trouverGare('BOURG ESSAI - LES ESSAIS', 'idf', index)).toMatchObject({ trouvee: true, qualite: 'sure', gare: { nom: 'Les Essais' } });
  });

  it('« VILLETEST - GARE DE VILLETEST » : la dernière partie, sans mots vides, est la gare', () => {
    expect(trouverGare('VILLETEST - GARE DE VILLETEST', 'idf', index)).toMatchObject({ trouvee: true, qualite: 'sure', gare: { uic: '87000001' } });
  });

  it('trouvée par la SEULE première partie : à vérifier', () => {
    expect(trouverGare('BOURG ESSAI - QUARTIER INCONNU', 'idf', index)).toMatchObject({ trouvee: true, qualite: 'a_verifier', gare: { nom: 'Bourg Essai' } });
  });

  it('alias : la gare nommée, vérifiée par son code INSEE', () => {
    expect(trouverGare('AIX LES BAINS', 'province', index)).toMatchObject({ trouvee: true, methode: 'alias_manuel', qualite: 'sure', gare: { uic: '87741132' } });
  });

  it('alias périmé (la gare a changé de commune) : non placé, et la raison le dit', () => {
    const perime = indexerGares(lireReferentielGares(CSV.replace(';73008;', ';73999;')));
    const r = trouverGare('AIX LES BAINS', 'province', perime);
    expect(r.trouvee).toBe(false);
    if (!r.trouvee) expect(r.raison).toContain('alias périmé');
  });

  it('introuvable : non placé, jamais approché', () => {
    expect(trouverGare('GARE INCONNUE', 'province', index)).toEqual({ trouvee: false, raison: 'gare introuvable dans le référentiel SNCF' });
  });

  it('la table d alias : 32 entrées, clés normalisées, chacune avec un code INSEE à cinq caractères', () => {
    const cles = Object.keys(ALIAS_GARES);
    expect(cles).toHaveLength(32);
    for (const cle of cles) {
      expect(normaliser(cle), cle).toBe(cle);
      expect(ALIAS_GARES[cle].insee, cle).toMatch(/^[0-9][0-9AB][0-9]{3}$/);
    }
  });
});
```

`tests/unit/ooh/geolocaliser.test.ts` :

```ts
import { describe, expect, it, vi } from 'vitest';
import type { GeocodeDetailedResult } from '@/lib/import/types';
import { geolocaliser, villeCorrespond, type LigneAdresse } from '@/lib/ooh/plan/geolocaliser';
import type { GareSncf } from '@/lib/ooh/plan/gares-sncf';
import type { EmplacementBrut } from '@/types/campagnes-media';

const GARES: GareSncf[] = [
  { nom: 'Villetest', code_insee: '92001', uic: '87000001', lat: 48.8, lng: 2.3 },
];

function emplacement(partiel: Partial<EmplacementBrut> & Pick<EmplacementBrut, 'cle' | 'recherche' | 'adaptateur'>): EmplacementBrut {
  return {
    nom_lieu: partiel.cle, type_lieu: 'lieu', reseau: 'DOOH essai', numerique: true, nb_ecrans: 1, formats: [],
    adresse: null, code_postal: null, ville: null, reference_panneau: null, contacts_semaine: null, contacts_18_25_semaine: null,
    metadata: { onglet: 'ESSAI', lignes: [{ numero: 1, cellules: {} }] },
    ...partiel,
  };
}

function ban(partiel: Partial<GeocodeDetailedResult>): GeocodeDetailedResult {
  return {
    rowIndex: 0, inputAddress: '', lat: 43.3, lng: 5.4, score: 0.9, resultLabel: '1 Rue Essai 13008 Villetest',
    resultType: 'housenumber', resultCity: 'Villetest', resultPostcode: '13008', resultCitycode: '13208', status: 'green', manualOverride: false,
    ...partiel,
  };
}

const campus = (cle: string, cp = '13008', ville = 'Villetest') => emplacement({
  adaptateur: 'stride-campus', cle, adresse: '1 Rue Essai', code_postal: cp, ville,
  recherche: { type: 'adresse', adresse: '1 Rue Essai', code_postal: cp, ville, commune_seule: false },
});

describe('villeCorrespond', () => {
  it('égalité normalisée, ou l une prolonge l autre d un mot', () => {
    expect(villeCorrespond('Besancon', 'Besançon')).toBe(true);
    expect(villeCorrespond('Aix en Provence La Pioline', 'Aix-en-Provence')).toBe(true);
    expect(villeCorrespond('St Essai', 'Saint-Essai')).toBe(true);
    expect(villeCorrespond('Villetest', 'Autreville')).toBe(false);
  });
});

describe('geolocaliser', () => {
  it('adresse : un seul lot pour la BAN, score ≥ 0,6 sûr, code INSEE et département repris', async () => {
    const geocoder = vi.fn(async (rows: LigneAdresse[]) => rows.map(() => ban({})));
    const { places, non_places } = await geolocaliser([campus('A|13008')], { gares: [], geocoder });
    expect(geocoder).toHaveBeenCalledTimes(1);
    expect(geocoder.mock.calls[0][0]).toEqual([{ adresse: '1 Rue Essai', code_postal: '13008', ville: 'Villetest' }]);
    expect(non_places).toEqual([]);
    expect(places[0]).toMatchObject({
      source_ref: 'A|13008', lat: 43.3, lng: 5.4, code_insee: '13208', code_departement: '13',
      geoloc_methode: 'adresse_ban', geoloc_qualite: 'sure', geoloc_score: 0.9, geoloc_libelle: '1 Rue Essai 13008 Villetest',
    });
  });

  it('score entre 0,3 et 0,6 : à vérifier ; sous 0,3 ou introuvable : non placé, raison dite', async () => {
    const reponses = [ban({ score: 0.45 }), ban({ score: 0.2 }), ban({ lat: null, lng: null, score: 0 })];
    const { places, non_places } = await geolocaliser([campus('A|1'), campus('B|1'), campus('C|1')], {
      gares: [], geocoder: async () => reponses,
    });
    expect(places.map((p) => [p.cle, p.geoloc_qualite])).toEqual([['A|1', 'a_verifier']]);
    expect(non_places.map((n) => [n.cle, n.raison])).toEqual([
      ['B|1', 'score BAN 0,20 sous 0,30'],
      ['C|1', 'adresse introuvable (BAN)'],
    ]);
  });

  it('ville ou CP différents de ceux de la régie : jamais sûr, même avec un bon score', async () => {
    const { places } = await geolocaliser([campus('VILLE|1'), campus('CP|1')], {
      gares: [], geocoder: async () => [ban({ resultCity: 'Autreville' }), ban({ resultPostcode: '13009' })],
    });
    expect(places.map((p) => p.geoloc_qualite)).toEqual(['a_verifier', 'a_verifier']);
  });

  it('Basic-Fit sans rue : la commune seule est cherchée, le point est à vérifier', async () => {
    const club = emplacement({
      adaptateur: 'basic-fit', cle: '2345', ville: 'Bourg-Essai',
      recherche: { type: 'adresse', adresse: '', code_postal: null, ville: 'Bourg-Essai', commune_seule: true },
    });
    const geocoder = vi.fn(async () => [ban({ resultCity: 'Bourg-Essai', resultType: 'municipality', resultLabel: 'Bourg-Essai' })]);
    const { places } = await geolocaliser([club], { gares: [], geocoder });
    expect(geocoder.mock.calls[0][0]).toEqual([{ adresse: '', code_postal: '', ville: 'Bourg-Essai' }]);
    expect(places[0]).toMatchObject({ geoloc_qualite: 'a_verifier', adresse: null, ville: 'Bourg-Essai' });
  });

  it('gares : référentiel, UIC pour identité, et deux noms de la liste sur la même gare réunis', async () => {
    const geocoder = vi.fn(async () => []);
    const gare = (nom: string, nb: number) => emplacement({ adaptateur: 'mediatransports-gares', cle: nom, nb_ecrans: nb, recherche: { type: 'gare', nom, bloc: 'idf' } });
    const { places, non_places } = await geolocaliser([gare('VILLETEST', 2), gare('VILLETEST - GARE DE VILLETEST', 3), gare('NULLE PART', 1)], { gares: GARES, geocoder });
    expect(geocoder).not.toHaveBeenCalled();
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({
      source_ref: '87000001', nom_lieu: 'Villetest', nb_ecrans: 5, code_insee: '92001', code_departement: '92',
      geoloc_methode: 'referentiel_gares', geoloc_qualite: 'sure', geoloc_score: 1, geoloc_libelle: 'Villetest (UIC 87000001, INSEE 92001)',
    });
    expect(non_places).toEqual([expect.objectContaining({ cle: 'NULLE PART', raison: 'gare introuvable dans le référentiel SNCF' })]);
  });

  it('la progression finit à total / total', async () => {
    const progression = vi.fn();
    await geolocaliser([campus('A|1')], { gares: [], geocoder: async () => [ban({})], progression });
    expect(progression).toHaveBeenLastCalledWith(1, 1);
  });
});
```

`tests/unit/import/geocoder-citycode.test.ts` :

```ts
import { describe, expect, it, vi } from 'vitest';

/** La BAN rend `result_citycode` (code commune INSEE) : le géocodeur le transmet, pour remplir `code_insee`. */
vi.mock('@/lib/http/lecture-avec-reprise', () => ({
  fetchLectureAvecReprise: async () => new Response(
    'adresse,code_postal,ville,latitude,longitude,result_label,result_score,result_type,result_city,result_postcode,result_citycode\n'
    + '1 Rue Essai,13008,Villetest,43.3,5.4,1 Rue Essai 13008 Villetest,0.91,housenumber,Villetest,13008,13208\n',
    { status: 200 },
  ),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }));

const { geocodeBatchDetailed } = await import('@/lib/import/geocoder');

describe('geocodeBatchDetailed — code commune INSEE', () => {
  it('rend resultCitycode', async () => {
    const [r] = await geocodeBatchDetailed([{ adresse: '1 Rue Essai', code_postal: '13008', ville: 'Villetest' }]);
    expect(r).toMatchObject({ lat: 43.3, lng: 5.4, score: 0.91, resultCity: 'Villetest', resultPostcode: '13008', resultCitycode: '13208' });
  });
});
```

- [ ] **Step 2: Les lancer, ils échouent**

Run: `npx vitest run --project unit tests/unit/ooh/gares-sncf.test.ts tests/unit/ooh/geolocaliser.test.ts tests/unit/import/geocoder-citycode.test.ts`
Expected: FAIL — modules `gares-sncf` et `geolocaliser` absents ; `resultCitycode` absent du résultat du géocodeur.

- [ ] **Step 3: Transmettre le code commune de la BAN**

`lib/import/types.ts`, interface `GeocodeDetailedResult` : ajouter après `resultPostcode: string;`

```ts
  /** Code commune INSEE rendu par la BAN (`result_citycode`) ; absent des résultats construits ailleurs. */
  resultCitycode?: string;
```

`lib/import/geocoder.ts` :
- dans la signature de retour de `geocodeChunkCSV`, après `  resultPostcode: string;` ajouter `  resultCitycode: string;` ;
- dans son `parsed.data.map((row) => { … return { … } })`, après `          resultPostcode: row.result_postcode || '',` ajouter `          resultCitycode: row.result_citycode || '',` ;
- dans `geocodeBatchDetailed`, branche « trouvé » (objet poussé avec `status,`), après `            resultPostcode: banResult.resultPostcode,` ajouter `            resultCitycode: banResult.resultCitycode,`.

- [ ] **Step 4: Écrire le référentiel des gares**

`lib/ooh/plan/gares-sncf.ts` :

```ts
/**
 * Référentiel public SNCF « gares de voyageurs » (data.sncf.com, sans clé, téléchargé au lancement du script) et
 * correspondance des noms de gare d'une liste de régie (spec 2026-10-16-ooh-campagnes § 7, § 9).
 *
 * Ordre d'essai d'un nom : le nom plein, puis la DERNIÈRE partie (« BOIS COLOMBES - LES VALLEES » est « Les Vallées »),
 * puis première + dernière (« VALENCE - TGV »), puis la première seule — qui ne donne qu'un point À VÉRIFIER. L'ordre
 * de la spec (première partie avant la dernière) fusionnait 11 paires de gares sur un même code UIC (mesuré le 16/10).
 * Une gare trouvée hors du bloc annoncé (une gare de province dans la liste IDF) est à vérifier. Jamais
 * d'approchement flou : un nom introuvable n'est pas placé, il est rapporté.
 *
 * La table d'alias est VERSIONNÉE ici : un nom de la liste → le nom exact du référentiel, vérifié au lancement par
 * le code INSEE de la commune. Un alias dont la gare a changé de commune (ou disparu) n'est pas placé.
 */
import Papa from 'papaparse';
import { fetchLectureAvecReprise } from '@/lib/http/lecture-avec-reprise';
import type { BlocGares, GeolocQualite } from '@/types/campagnes-media';
import { departementDeInsee, normaliser } from './texte';

export const URL_REFERENTIEL_GARES =
  'https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/gares-de-voyageurs/exports/csv?delimiter=%3B';

/** Une gare du référentiel. `uic` est l'identité stable d'un panneau de gare (`source_ref`). */
export interface GareSncf {
  nom: string;
  code_insee: string;
  uic: string;
  lat: number;
  lng: number;
}

const MOTS_VIDES = new Set(['GARE', 'DE', 'DU', 'DES', 'D', 'LA', 'LE', 'LES', 'L']);
const DEPARTEMENTS_IDF = new Set(['75', '77', '78', '91', '92', '93', '94', '95']);

/** `normaliser`, puis sans les mots vides d'un nom de gare (« GARE », « DE », « LES »…). */
export function normaliserNomGare(nom: string): string {
  return normaliser(nom).split(' ').filter((m) => m !== '' && !MOTS_VIDES.has(m)).join(' ');
}

/** Lit le CSV du référentiel (séparateur `;`, BOM toléré) ; une gare sans position, sans UIC ou sans INSEE est écartée. */
export function lireReferentielGares(csv: string): GareSncf[] {
  const lu = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ''), { header: true, delimiter: ';', skipEmptyLines: true });
  const gares: GareSncf[] = [];
  for (const l of lu.data) {
    const [lat, lng] = (l.position_geographique ?? '').split(',').map((v) => Number(v.trim()));
    const uic = (l.codes_uic ?? '').split(/[,;\s]+/).find((v) => v !== '');
    const nom = (l.nom ?? '').trim();
    const insee = (l.codeinsee ?? '').trim();
    if (nom === '' || !uic || insee === '' || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
    gares.push({ nom, code_insee: insee, uic, lat, lng });
  }
  return gares;
}

/** Les gares par nom normalisé (plusieurs gares peuvent partager un nom normalisé : on garde toutes). */
export type IndexGares = ReadonlyMap<string, readonly GareSncf[]>;

export function indexerGares(gares: readonly GareSncf[]): IndexGares {
  const index = new Map<string, GareSncf[]>();
  for (const g of gares) {
    const cle = normaliserNomGare(g.nom);
    index.set(cle, [...(index.get(cle) ?? []), g]);
  }
  return index;
}

/** Un alias : le nom EXACT du référentiel et le code INSEE de sa commune, vérifié à chaque lancement. */
export interface AliasGare {
  sncf: string;
  insee: string;
}

/**
 * Noms de la liste Mediatransports que la correspondance par nom ne place pas, ou place mal (mesuré le 16/10 sur le
 * plan TF4 contre le référentiel téléchargé ce jour-là). Clé = `normaliser(nom de la liste)`.
 */
export const ALIAS_GARES: Readonly<Record<string, AliasGare>> = {
  'AIX LES BAINS': { sncf: 'Aix-les-Bains le Revard', insee: '73008' },
  CHAMBERY: { sncf: 'Chambéry - Challes-les-Eaux', insee: '73065' },
  LORIENT: { sncf: 'Lorient Bretagne Sud', insee: '56121' },
  FRANCONVILLE: { sncf: 'Franconville - Le Plessis-Bouchard', insee: '95252' },
  'GARGES LES GONESSE GARGES LES GONESSE': { sncf: 'Garges - Sarcelles', insee: '95268' },
  'HOUILLES CARRIERES': { sncf: 'Houilles - Carrières-sur-Seine', insee: '78311' },
  'LE PERRAY': { sncf: 'Le Perray-en-Yvelines', insee: '78486' },
  'VALLAURIS GOLFE JUAN': { sncf: 'Golfe Juan Vallauris', insee: '06155' },
  MONTGERON: { sncf: 'Montgeron - Crosne', insee: '91421' },
  'NOISY LE GRAND LES YVRIS': { sncf: 'Les Yvris Noisy-le-Grand', insee: '93051' },
  'PARIS GARE DE BERCY': { sncf: "Paris Bercy Bourgogne - Pays d'Auvergne", insee: '75112' },
  'PARIS PEREIRE': { sncf: 'Péreire - Levallois', insee: '75117' },
  'PARIS PORTE MAILLOT': { sncf: 'Neuilly - Porte Maillot', insee: '75117' },
  'PARIS NEUILLY PORTE MAILLOT EOLE': { sncf: 'Neuilly Porte Maillot RER E', insee: '75117' },
  'PARIS SAINT MICHEL': { sncf: 'Saint-Michel Notre-Dame', insee: '75105' },
  'SAINT QUENTIN EN YVELINES': { sncf: 'Saint-Quentin en Yvelines - Montigny-le-Bretonneux', insee: '78423' },
  SURESNES: { sncf: 'Suresnes Mont Valérien', insee: '92073' },
  'TREMBLAY EN FRANCE AEROPORT 1 C DE GAULLE': { sncf: 'Aéroport Charles de Gaulle 1', insee: '93073' },
  'VILLEMOMBLE LE RAINCY VILLEMOMBLE': { sncf: 'Le Raincy - Villemomble - Montfermeil', insee: '93062' },
  'VILLIERS NEAUPHLE PONCHARTRAIN': { sncf: 'Villiers - Neauphle - Pontchartrain', insee: '78683' },
  'VILLIERS SUR MARNE': { sncf: 'Villiers-sur-Marne - Le Plessis-Trévise', insee: '94079' },
  'ASNIERES SUR SEINE GARE D ASNIERES': { sncf: 'Asnières-sur-Seine', insee: '92004' },
  'LE CREUSOT TGV': { sncf: 'Le Creusot - Montceau-les-Mines - Montchanin TGV', insee: '71187' },
  'EPINAY SUR SEINE VILLETANEUSE': { sncf: 'Épinay - Villetaneuse', insee: '93031' },
  'STRASBOURG TGV': { sncf: 'Strasbourg', insee: '67482' },
  'VALENCE TGV': { sncf: 'Valence TGV Rhône-Alpes Sud', insee: '26004' },
  'VALENCE VALENCE VILLE': { sncf: 'Valence', insee: '26362' },
  'PUTEAUX DEFENSE EOLE CNIT': { sncf: 'La Défense Grande Arche RER E', insee: '92062' },
  'RIS ORANGIS BOIS DE L EPINE': { sncf: "Orangis Bois de l'Épine", insee: '91521' },
  'SAINT DENIS LA PLAINE STADE DE FRANCE': { sncf: 'La Plaine Stade de France - Saint-Denis - Aubervilliers', insee: '93066' },
  'SAINT OUEN GARE DE SAINT OUEN RER': { sncf: 'Saint-Ouen', insee: '93070' },
  'VILLENEUVE SAINT GEORGES TRIAGE': { sncf: 'Villeneuve Triage', insee: '94078' },
};

export type ResultatGare =
  | { trouvee: true; gare: GareSncf; methode: 'referentiel_gares' | 'alias_manuel'; qualite: GeolocQualite }
  | { trouvee: false; raison: string };

/** Les noms à essayer, du plus sûr au moins sûr ; le booléen dit si la correspondance suffit pour « sûr ». */
function candidats(nom: string): Array<[string, boolean]> {
  const parties = nom.split(/\s*-\s+|\s+-\s*/).map((p) => p.trim()).filter((p) => p !== '');
  if (parties.length < 2) return [[nom, true]];
  return [
    [nom, true],
    [parties[parties.length - 1], true],
    [`${parties[0]} ${parties[parties.length - 1]}`, true],
    [parties[0], false],
  ];
}

/** Cherche une gare de la liste dans le référentiel. */
export function trouverGare(nom: string, bloc: BlocGares, index: IndexGares): ResultatGare {
  const alias = ALIAS_GARES[normaliser(nom)];
  if (alias) {
    const homonymes = index.get(normaliserNomGare(alias.sncf)) ?? [];
    const gare = homonymes.find((g) => g.code_insee === alias.insee);
    if (gare) return { trouvee: true, gare, methode: 'alias_manuel', qualite: 'sure' };
    return {
      trouvee: false,
      raison: homonymes.length > 0
        ? `alias périmé : « ${alias.sncf} » n'est plus en ${alias.insee} (INSEE ${homonymes.map((g) => g.code_insee).join(', ')})`
        : `alias périmé : « ${alias.sncf} » absente du référentiel SNCF`,
    };
  }
  for (const [candidat, suffisant] of candidats(nom)) {
    const gares = index.get(normaliserNomGare(candidat));
    if (!gares || gares.length === 0) continue;
    const gare = gares[0];
    const dansLeBloc = bloc === 'inconnu' || (bloc === 'idf') === DEPARTEMENTS_IDF.has(departementDeInsee(gare.code_insee));
    const sure = suffisant && gares.length === 1 && dansLeBloc;
    return { trouvee: true, gare, methode: 'referentiel_gares', qualite: sure ? 'sure' : 'a_verifier' };
  }
  return { trouvee: false, raison: 'gare introuvable dans le référentiel SNCF' };
}

/** Télécharge le référentiel (60 s par tentative, trois tentatives) ; lève si la réponse n'est pas un succès. */
export async function telechargerReferentielGares(): Promise<GareSncf[]> {
  const reponse = await fetchLectureAvecReprise(URL_REFERENTIEL_GARES, {}, { delaiMs: 60_000, tentatives: 3 });
  if (!reponse.ok) throw new Error(`Référentiel des gares SNCF indisponible (HTTP ${reponse.status}).`);
  const gares = lireReferentielGares(await reponse.text());
  if (gares.length === 0) throw new Error('Référentiel des gares SNCF vide ou illisible.');
  return gares;
}
```

- [ ] **Step 5: Écrire le géolocalisateur**

`lib/ooh/plan/geolocaliser.ts` :

```ts
/**
 * Géolocalisation des emplacements d'un plan (spec 2026-10-16-ooh-campagnes § 7) :
 *   - gares → référentiel SNCF et alias (`gares-sncf.ts`) : score 1 ;
 *   - adresses (Stride, Basic-Fit) → BAN `/search/csv/` par `geocodeBatchDetailed`, en UN lot :
 *     score ≥ 0,6 → `sure` ; de 0,3 à 0,6 → `a_verifier` ; sous 0,3 → non placé.
 *     Commune seule (Basic-Fit sans rue), ville ou code postal rendus différents de ceux de la régie → `a_verifier`.
 * Un emplacement introuvable n'est pas placé : il est rendu dans `non_places` avec sa raison. Le géocodeur est
 * INJECTÉ (tests sans réseau ; le script passe `geocodeBatchDetailed`).
 */
import { extractDeptFromCP } from '@/lib/import/geocoder';
import type { GeocodeDetailedResult } from '@/lib/import/types';
import type { EmplacementBrut, EmplacementNonPlace, EmplacementPlace, GeolocQualite } from '@/types/campagnes-media';
import { fusionnerEmplacements } from './fusion';
import { indexerGares, trouverGare, type GareSncf } from './gares-sncf';
import { departementDeInsee, normaliser } from './texte';

export const SEUIL_SUR = 0.6;
export const SEUIL_NON_PLACE = 0.3;

/** Une ligne envoyée à la BAN — la forme de `geocodeBatchDetailed`. */
export interface LigneAdresse {
  adresse?: string;
  code_postal?: string;
  ville?: string;
}

export type GeocodeurLot = (rows: LigneAdresse[], onProgress?: (fait: number, total: number) => void) => Promise<GeocodeDetailedResult[]>;

export interface DependancesGeoloc {
  gares: readonly GareSncf[];
  geocoder: GeocodeurLot;
  progression?: (fait: number, total: number) => void;
}

export interface ResultatGeoloc {
  places: EmplacementPlace[];
  non_places: EmplacementNonPlace[];
}

/** Même ville, à la normalisation près, ou l'une prolonge l'autre d'un mot (« Aix en Provence La Pioline »). */
export function villeCorrespond(attendue: string, rendue: string): boolean {
  const a = normaliser(attendue);
  const r = normaliser(rendue);
  return a === r || a.startsWith(`${r} `) || r.startsWith(`${a} `);
}

const virgule = (n: number) => n.toFixed(2).replace('.', ',');

function nonPlace(e: EmplacementBrut, raison: string): EmplacementNonPlace {
  return { adaptateur: e.adaptateur, cle: e.cle, nom: e.nom_lieu, raison, metadata: e.metadata };
}

function deciderAdresse(e: EmplacementBrut, r: GeocodeDetailedResult | undefined): EmplacementPlace | string {
  if (e.recherche.type !== 'adresse') return 'recherche inattendue';
  const rech = e.recherche;
  if (!r || r.lat === null || r.lng === null) return 'adresse introuvable (BAN)';
  if (r.score < SEUIL_NON_PLACE) return `score BAN ${virgule(r.score)} sous ${virgule(SEUIL_NON_PLACE)}`;
  let qualite: GeolocQualite = r.score >= SEUIL_SUR ? 'sure' : 'a_verifier';
  if (rech.commune_seule) qualite = 'a_verifier';
  if (rech.ville !== null && r.resultCity !== '' && !villeCorrespond(rech.ville, r.resultCity)) qualite = 'a_verifier';
  if (rech.code_postal !== null && r.resultPostcode !== '' && r.resultPostcode !== rech.code_postal) qualite = 'a_verifier';
  const codePostal = e.code_postal ?? (r.resultPostcode === '' ? null : r.resultPostcode);
  const insee = r.resultCitycode ? r.resultCitycode : null;
  return {
    ...e,
    source_ref: e.cle,
    lat: r.lat,
    lng: r.lng,
    adresse: rech.commune_seule ? null : (e.adresse ?? (r.resultLabel === '' ? null : r.resultLabel)),
    code_postal: codePostal,
    ville: e.ville ?? (r.resultCity === '' ? null : r.resultCity),
    code_insee: insee,
    code_departement: insee !== null ? departementDeInsee(insee) : extractDeptFromCP(codePostal),
    geoloc_methode: 'adresse_ban',
    geoloc_qualite: qualite,
    geoloc_score: r.score,
    geoloc_libelle: r.resultLabel,
  };
}

/** Place tous les emplacements ; rend les placés (réunis par adaptateur et `source_ref`) et les non placés. */
export async function geolocaliser(emplacements: readonly EmplacementBrut[], deps: DependancesGeoloc): Promise<ResultatGeoloc> {
  const total = emplacements.length;
  const places: EmplacementPlace[] = [];
  const nonPlaces: EmplacementNonPlace[] = [];
  const index = indexerGares(deps.gares);
  const adresses: EmplacementBrut[] = [];
  let fait = 0;

  for (const e of emplacements) {
    if (e.recherche.type !== 'gare') {
      adresses.push(e);
      continue;
    }
    const r = trouverGare(e.recherche.nom, e.recherche.bloc, index);
    if (r.trouvee) {
      places.push({
        ...e,
        source_ref: r.gare.uic,
        nom_lieu: r.gare.nom,
        lat: r.gare.lat,
        lng: r.gare.lng,
        code_insee: r.gare.code_insee,
        code_departement: departementDeInsee(r.gare.code_insee),
        geoloc_methode: r.methode,
        geoloc_qualite: r.qualite,
        geoloc_score: 1,
        geoloc_libelle: `${r.gare.nom} (UIC ${r.gare.uic}, INSEE ${r.gare.code_insee})`,
      });
    } else {
      nonPlaces.push(nonPlace(e, r.raison));
    }
    fait++;
  }
  deps.progression?.(fait, total);

  if (adresses.length > 0) {
    const lignes: LigneAdresse[] = adresses.map((e) => {
      const rech = e.recherche.type === 'adresse' ? e.recherche : null;
      return { adresse: rech?.adresse ?? '', code_postal: rech?.code_postal ?? '', ville: rech?.ville ?? '' };
    });
    const resultats = await deps.geocoder(lignes, (n) => deps.progression?.(fait + n, total));
    adresses.forEach((e, i) => {
      const d = deciderAdresse(e, resultats[i]);
      if (typeof d === 'string') nonPlaces.push(nonPlace(e, d));
      else places.push(d);
    });
  }
  deps.progression?.(total, total);

  return { places: fusionnerEmplacements(places, (p) => `${p.adaptateur}|${p.source_ref}`), non_places: nonPlaces };
}
```

- [ ] **Step 6: Relancer les tests**

Run: `npx vitest run --project unit tests/unit/ooh/ tests/unit/import/`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: code de retour 0.

- [ ] **Step 7: Catalogue, commit**

Run: `npm run catalogue`, puis `npx vitest run --project unit tests/unit/docs/catalogue-code.test.ts`
Expected: PASS.

```bash
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add lib/ooh/plan/gares-sncf.ts lib/ooh/plan/geolocaliser.ts lib/import/types.ts lib/import/geocoder.ts \
  tests/unit/ooh/gares-sncf.test.ts tests/unit/ooh/geolocaliser.test.ts tests/unit/import/geocoder-citycode.test.ts docs/CATALOGUE_CODE.md
git commit -m "feat: géolocalisation des emplacements OOH — référentiel SNCF, 32 alias vérifiés par l'INSEE, BAN" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Écriture en base, rapport et script `scripts/ooh/importer-plan.ts`

**Files:**
- Create: `lib/ooh/plan/ecrire.ts`, `lib/ooh/plan/rapport.ts`, `lib/ooh/plan/arguments.ts`
- Create: `scripts/ooh/importer-plan.ts`
- Create: `tests/unit/ooh/rapport.test.ts`, `tests/unit/ooh/arguments.test.ts`, `tests/integration/importer-plan-ooh.test.ts`
- Modify: `tests/unit/securite/perimetre-routes.test.ts:43-66` (`ASSUMEES` : `lib/ooh/plan/ecrire.ts`)
- Modify: `tests/unit/docs/derive-documentation.test.ts:71-74` (`hotesExternes` : référentiel SNCF)
- Modify: `ARCHITECTURE.md` (tableau de la pile technique ≈ ligne 218 ; tableau `panneaux_affichage` ; section des campagnes multi-média)

**Interfaces:**
- Consumes: `LignePlan`, `EmplacementPlace`, `EmplacementNonPlace`, `AdaptateurId` (tâche 5) ; `lireClasseur` (5) ; `lirePlan`, `rattacher` (6) ; `telechargerReferentielGares`, `geolocaliser` (7) ; `geocodeBatchDetailed` ; `uuidV5` (`lib/import/identite-poi.ts`) ; `lireTout` ; `formaterNombre` (`lib/format/nombre.ts`).
- Produces:
  - `ecrire.ts` : `EmplacementsDeLigne { adaptateur: AdaptateurId; places: EmplacementPlace[]; non_places: EmplacementNonPlace[] }`, `CampagneAEcrire { nom: string; annonceur: string | null; vague: string | null; cle_import: string; date_debut: string | null; date_fin: string | null; budget_total_ttc: number | null; metadata: Record<string, unknown> }`, `EntreeEcriture { organizationId: string; campagne: CampagneAEcrire; lignes: readonly LignePlan[]; emplacements: ReadonlyMap<number, EmplacementsDeLigne> }`, `BilanEcriture { campagne_id: string; lignes: number; panneaux_ecrits: number; liens: number; panneaux_retires: number; erreurs: string[] }`, `sourcePanneaux(cleImport: string, adaptateur: AdaptateurId): string` (= `plan-ooh:<cle>:<adaptateur>`), `identitePanneau(source: string, sourceRef: string): string` (UUIDv5), `ecrirePlan(sb: SupabaseClient, entree: EntreeEcriture, progression?: (etape: string, fait: number, total: number) => void): Promise<BilanEcriture>`.
  - `rapport.ts` : `CompteurReseau { adaptateur: AdaptateurId; lus: number; surs: number; a_verifier: number; non_places: number }`, `compterParReseau(places: readonly EmplacementPlace[], nonPlaces: readonly EmplacementNonPlace[]): CompteurReseau[]`, `csvAReprendre(places, nonPlaces): string`, `cheminRapportAutorise(dossier: string, racineDepot: string): boolean`, `nomRapport(cle: string, date: Date): string`, `ligneProgression(etape: string, fait: number, total: number): string`.
  - `arguments.ts` : `ArgumentsImport { plan: string; espace: string; campagne: string; vague: string | null; cle: string; annonceur: string | null; rapport: string; aBlanc: boolean }`, `lireArguments(argv: readonly string[], dossierRapportParDefaut: string): ArgumentsImport | { erreur: string }`.
  - CLI : `npx tsx scripts/ooh/importer-plan.ts --plan "<fichier.xlsx>" --espace <slug> --campagne "<nom>" --cle <cle> [--vague <V>] [--annonceur "<nom>"] [--rapport <dossier>] [--a-blanc]`.

- [ ] **Step 1: Écrire les tests unitaires du rapport et des arguments**

`tests/unit/ooh/rapport.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { formaterNombre } from '@/lib/format/nombre';
import { cheminRapportAutorise, compterParReseau, csvAReprendre, ligneProgression, nomRapport } from '@/lib/ooh/plan/rapport';
import type { EmplacementNonPlace, EmplacementPlace } from '@/types/campagnes-media';

const meta = { onglet: 'ESSAI', lignes: [] };
const place = (adaptateur: EmplacementPlace['adaptateur'], qualite: EmplacementPlace['geoloc_qualite'], nom: string): EmplacementPlace => ({
  adaptateur, cle: nom, nom_lieu: nom, type_lieu: 'lieu', reseau: 'DOOH essai', numerique: true, nb_ecrans: 1, formats: [],
  adresse: null, code_postal: null, ville: null, reference_panneau: null, contacts_semaine: null, contacts_18_25_semaine: null,
  recherche: { type: 'gare', nom, bloc: 'idf' }, metadata: meta, source_ref: nom, lat: 48.1, lng: 2.2,
  code_insee: null, code_departement: null, geoloc_methode: 'adresse_ban', geoloc_qualite: qualite, geoloc_score: 0.45, geoloc_libelle: `Rue ${nom}; Ville`,
});
const nonPlace = (adaptateur: EmplacementNonPlace['adaptateur'], nom: string, raison: string): EmplacementNonPlace => ({ adaptateur, cle: nom, nom, raison, metadata: meta });

describe('rapport d import', () => {
  it('compteurs par réseau : lus, sûrs, à vérifier, non placés', () => {
    expect(compterParReseau(
      [place('basic-fit', 'sure', 'a'), place('basic-fit', 'a_verifier', 'b'), place('stride-campus', 'sure', 'c')],
      [nonPlace('basic-fit', 'd', 'adresse introuvable (BAN)')],
    )).toEqual([
      { adaptateur: 'basic-fit', lus: 3, surs: 1, a_verifier: 1, non_places: 1 },
      { adaptateur: 'stride-campus', lus: 1, surs: 1, a_verifier: 0, non_places: 0 },
    ]);
  });

  it('le CSV à reprendre : à vérifier et non placés, séparateur point-virgule, valeurs échappées', () => {
    const csv = csvAReprendre([place('basic-fit', 'sure', 'a'), place('basic-fit', 'a_verifier', 'b')], [nonPlace('stride-campus', 'Campus "X"', 'score BAN 0,20 sous 0,30')]);
    expect(csv.split('\n')).toEqual([
      'reseau;nom;etat;raison;methode;score;reconnu;latitude;longitude',
      'basic-fit;b;a_verifier;;adresse_ban;0,45;"Rue b; Ville";48.1;2.2',
      'stride-campus;"Campus ""X""";non_place;score BAN 0,20 sous 0,30;;;;;',
    ]);
  });

  it('le rapport ne s écrit jamais dans le dépôt', () => {
    expect(cheminRapportAutorise('C:/Temp/rapports', 'C:/GENESIS/genesis_app')).toBe(true);
    expect(cheminRapportAutorise('C:/GENESIS/genesis_app/docs', 'C:/GENESIS/genesis_app')).toBe(false);
    expect(cheminRapportAutorise('C:/GENESIS/genesis_app', 'C:/GENESIS/genesis_app')).toBe(false);
  });

  it('nom du rapport et ligne de progression', () => {
    expect(nomRapport('marine-tf4-2026', new Date(Date.UTC(2026, 9, 16, 8, 5, 9)))).toBe('rapport-ooh-marine-tf4-2026-20261016-080509.csv');
    expect(ligneProgression('géolocalisation', 420, 1000)).toBe(`[géolocalisation] 42 % — ${formaterNombre(420)} / ${formaterNombre(1000)}`);
    expect(ligneProgression('écriture', 0, 0)).toBe('[écriture] 100 % — 0 / 0');
  });
});
```

`tests/unit/ooh/arguments.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { lireArguments } from '@/lib/ooh/plan/arguments';

const BASE = ['--plan', 'plan.xlsx', '--espace', 'marine', '--campagne', 'Campagne essai', '--cle', 'essai-2026'];

describe('lireArguments', () => {
  it('les obligatoires, les facultatifs, le rapport par défaut', () => {
    expect(lireArguments([...BASE, '--vague', 'V1', '--a-blanc'], '/tmp')).toEqual({
      plan: 'plan.xlsx', espace: 'marine', campagne: 'Campagne essai', cle: 'essai-2026', vague: 'V1', annonceur: null, rapport: '/tmp', aBlanc: true,
    });
    expect(lireArguments([...BASE, '--annonceur', 'Annonceur', '--rapport', '/ailleurs'], '/tmp'))
      .toMatchObject({ annonceur: 'Annonceur', rapport: '/ailleurs', aBlanc: false, vague: null });
  });

  it('refuse une option manquante, inconnue, sans valeur, ou une clé mal formée', () => {
    expect(lireArguments(BASE.slice(2), '/tmp')).toEqual({ erreur: 'Option obligatoire absente : --plan.' });
    expect(lireArguments([...BASE, '--force'], '/tmp')).toEqual({ erreur: 'Option inconnue : --force.' });
    expect(lireArguments([...BASE, '--vague'], '/tmp')).toEqual({ erreur: 'Valeur absente pour --vague.' });
    expect(lireArguments(['--plan', 'p.xlsx', '--espace', 'marine', '--campagne', 'C', '--cle', 'Clé Invalide'], '/tmp'))
      .toEqual({ erreur: '--cle : minuscules, chiffres et tirets, 3 à 64 caractères (ex. marine-tf4-2026).' });
  });
});
```

- [ ] **Step 2: Les lancer, ils échouent**

Run: `npx vitest run --project unit tests/unit/ooh/rapport.test.ts tests/unit/ooh/arguments.test.ts`
Expected: FAIL — modules `rapport` et `arguments` absents.

- [ ] **Step 3: Écrire `rapport.ts` et `arguments.ts`**

`lib/ooh/plan/rapport.ts` :

```ts
/**
 * Rapport du script d'import (spec 2026-10-16-ooh-campagnes § 7) : compteurs par réseau (lus, placés sûrs, à vérifier,
 * non placés) et CSV des emplacements à reprendre, écrit HORS du dépôt (les noms viennent d'un fichier client).
 */
import { relative, resolve, isAbsolute } from 'node:path';
import { formaterNombre } from '@/lib/format/nombre';
import type { AdaptateurId, EmplacementNonPlace, EmplacementPlace } from '@/types/campagnes-media';

export interface CompteurReseau {
  adaptateur: AdaptateurId;
  lus: number;
  surs: number;
  a_verifier: number;
  non_places: number;
}

export function compterParReseau(places: readonly EmplacementPlace[], nonPlaces: readonly EmplacementNonPlace[]): CompteurReseau[] {
  const parReseau = new Map<AdaptateurId, CompteurReseau>();
  const compteur = (a: AdaptateurId): CompteurReseau => {
    let c = parReseau.get(a);
    if (!c) {
      c = { adaptateur: a, lus: 0, surs: 0, a_verifier: 0, non_places: 0 };
      parReseau.set(a, c);
    }
    return c;
  };
  for (const p of places) {
    const c = compteur(p.adaptateur);
    c.lus++;
    if (p.geoloc_qualite === 'sure') c.surs++;
    else c.a_verifier++;
  }
  for (const n of nonPlaces) {
    const c = compteur(n.adaptateur);
    c.lus++;
    c.non_places++;
  }
  return [...parReseau.values()].sort((a, b) => a.adaptateur.localeCompare(b.adaptateur));
}

/** Échappe une valeur CSV (séparateur `;`) : guillemets si `;`, `"` ou retour à la ligne. */
function cellule(v: string | number | null): string {
  if (v === null) return '';
  const t = String(v);
  return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Les emplacements à reprendre : à vérifier, puis non placés. */
export function csvAReprendre(places: readonly EmplacementPlace[], nonPlaces: readonly EmplacementNonPlace[]): string {
  const lignes = ['reseau;nom;etat;raison;methode;score;reconnu;latitude;longitude'];
  for (const p of places) {
    if (p.geoloc_qualite !== 'a_verifier') continue;
    lignes.push([
      p.adaptateur, p.nom_lieu, 'a_verifier', null, p.geoloc_methode, p.geoloc_score.toFixed(2).replace('.', ','),
      p.geoloc_libelle, p.lat, p.lng,
    ].map(cellule).join(';'));
  }
  for (const n of nonPlaces) {
    lignes.push([n.adaptateur, n.nom, 'non_place', n.raison, null, null, null, null, null].map(cellule).join(';'));
  }
  return lignes.join('\n');
}

/** Vrai si `dossier` n'est PAS dans le dépôt (ni la racine, ni un de ses sous-dossiers). */
export function cheminRapportAutorise(dossier: string, racineDepot: string): boolean {
  const rel = relative(resolve(racineDepot), resolve(dossier));
  return rel.startsWith('..') || isAbsolute(rel);
}

/** `rapport-ooh-<cle>-<aaaammjj-hhmmss>.csv`, horodatage UTC. */
export function nomRapport(cle: string, date: Date): string {
  const d = date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `rapport-ooh-${cle}-${d}.csv`;
}

/** `[étape] 42 % — 420 / 1 000`. Un total nul vaut 100 %. */
export function ligneProgression(etape: string, fait: number, total: number): string {
  const pct = total === 0 ? 100 : Math.floor((fait * 100) / total);
  return `[${etape}] ${pct} % — ${formaterNombre(fait)} / ${formaterNombre(total)}`;
}
```

`lib/ooh/plan/arguments.ts` :

```ts
/** Lecture des options du script `scripts/ooh/importer-plan.ts` (spec 2026-10-16-ooh-campagnes § 7). */

export interface ArgumentsImport {
  plan: string;
  espace: string;
  campagne: string;
  vague: string | null;
  cle: string;
  annonceur: string | null;
  rapport: string;
  aBlanc: boolean;
}

const AVEC_VALEUR = ['--plan', '--espace', '--campagne', '--vague', '--cle', '--annonceur', '--rapport'] as const;
const OBLIGATOIRES = ['--plan', '--espace', '--campagne', '--cle'] as const;
const CLE = /^[a-z0-9][a-z0-9-]{2,63}$/;

/** Rend les options lues, ou `{ erreur }` en français — jamais d'exception. */
export function lireArguments(argv: readonly string[], dossierRapportParDefaut: string): ArgumentsImport | { erreur: string } {
  const valeurs = new Map<string, string>();
  let aBlanc = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--a-blanc') {
      aBlanc = true;
      continue;
    }
    if (!(AVEC_VALEUR as readonly string[]).includes(a)) return { erreur: `Option inconnue : ${a}.` };
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) return { erreur: `Valeur absente pour ${a}.` };
    valeurs.set(a, v);
    i++;
  }
  for (const o of OBLIGATOIRES) if (!valeurs.has(o)) return { erreur: `Option obligatoire absente : ${o}.` };
  const cle = valeurs.get('--cle')!;
  if (!CLE.test(cle)) return { erreur: '--cle : minuscules, chiffres et tirets, 3 à 64 caractères (ex. marine-tf4-2026).' };
  return {
    plan: valeurs.get('--plan')!,
    espace: valeurs.get('--espace')!,
    campagne: valeurs.get('--campagne')!,
    vague: valeurs.get('--vague') ?? null,
    cle,
    annonceur: valeurs.get('--annonceur') ?? null,
    rapport: valeurs.get('--rapport') ?? dossierRapportParDefaut,
    aBlanc,
  };
}
```

Run: `npx vitest run --project unit tests/unit/ooh/rapport.test.ts tests/unit/ooh/arguments.test.ts`
Expected: PASS.

- [ ] **Step 4: Écrire le test d'intégration de l'écriture**

`tests/integration/importer-plan-ooh.test.ts` :

```ts
/**
 * Écriture d'un plan OOH en base (spec 2026-10-16-ooh-campagnes § 4.4, § 7) : campagne retrouvée par
 * (espace, cle_import), lignes et liens REMPLACÉS au rejeu, panneaux upsertés sur (source, source_ref) avec les mêmes
 * id, source PRIVÉE de l'espace par réseau, emplacement disparu de la liste retiré de la table.
 * Entrée SYNTHÉTIQUE, déjà géolocalisée : aucun appel réseau.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ecrirePlan, sourcePanneaux, type EntreeEcriture } from '@/lib/ooh/plan/ecrire';
import type { EmplacementPlace, LignePlan } from '@/types/campagnes-media';
import { creerClientTest } from './_client';

const admin = creerClientTest();
const CLE = `essai-ecriture-${Date.now()}`;
const SOURCE = sourcePanneaux(CLE, 'basic-fit');
let org = '';

const ligne = (ordre: number, regie: string, territoire: string | null = null): LignePlan => ({
  ordre, media: 'ooh', regie, reseau: territoire ? null : 'DOOH SALLE', territoire, nb_ecrans: 10, format: 'DOOH',
  nb_diffusions: 100, date_debut: '2026-09-20', date_fin: '2026-10-03', duree_libelle: '2 semaines', rang_option: '2nd OPTION',
  plage_horaire: null, montant_brut: 10, montant_net: 5, frais: 1, honoraires: 1, total_ttc: 8,
  contacts_15_plus: 1000, contacts_18_24: 200, details: { onglet: 'HYP1', ligne: 4 + ordre },
});

const club = (code: string, qualite: 'sure' | 'a_verifier' = 'sure'): EmplacementPlace => ({
  adaptateur: 'basic-fit', cle: code, nom_lieu: `Basic-Fit Essai ${code}`, type_lieu: 'salle de sport', reseau: 'DOOH salle de sport',
  numerique: true, nb_ecrans: 2, formats: ['WW', 'NC'], adresse: 'Rue Essai', code_postal: null, ville: 'Villetest',
  reference_panneau: code, contacts_semaine: null, contacts_18_25_semaine: null,
  recherche: { type: 'adresse', adresse: 'Rue Essai', code_postal: null, ville: 'Villetest', commune_seule: false },
  metadata: { onglet: 'LISTING BASIC FIT', club: code, lignes: [{ numero: 2, cellules: { 'CLub name': `Basic-Fit FR Villetest Rue Essai ${code} WW` } }] },
  source_ref: code, lat: 47.9 + Number(code) / 100000, lng: 1.9, code_insee: '45234', code_departement: '45',
  geoloc_methode: 'adresse_ban', geoloc_qualite: qualite, geoloc_score: qualite === 'sure' ? 0.9 : 0.45, geoloc_libelle: 'Rue Essai 45000 Villetest',
});

function entree(codes: string[]): EntreeEcriture {
  return {
    organizationId: org,
    campagne: { nom: '[ESSAI] Campagne écrite', annonceur: 'Annonceur essai', vague: 'V1', cle_import: CLE, date_debut: '2026-09-20', date_fin: '2026-10-02', budget_total_ttc: 100, metadata: { fichier: 'essai.xlsx' } },
    lignes: [ligne(1, 'BASIC FIT'), ligne(2, 'MEDIAOUTREMER', 'LA REUNION')],
    emplacements: new Map([[1, {
      adaptateur: 'basic-fit' as const,
      places: codes.map((c, i) => club(c, i === 0 ? 'a_verifier' : 'sure')),
      non_places: [{ adaptateur: 'basic-fit' as const, cle: '9999', nom: 'Basic-Fit Essai introuvable', raison: 'adresse introuvable (BAN)', metadata: { onglet: 'LISTING BASIC FIT', lignes: [] } }],
    }]]),
  };
}

async function idsPanneaux(): Promise<Record<string, string>> {
  const { data, error } = await admin.from('panneaux_affichage').select('id, source_ref').eq('source', SOURCE);
  if (error) throw new Error(error.message);
  return Object.fromEntries((data ?? []).map((p) => [p.source_ref as string, p.id as string]));
}

beforeAll(async () => {
  const { data, error } = await admin.from('organizations')
    .insert({ name: '[ESSAI ooh] Écriture', slug: `essai-ooh-ecriture-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(`espace : ${error?.message}`);
  org = data.id as string;
});

afterAll(async () => {
  const { error: e1 } = await admin.from('campagnes').delete().eq('organization_id', org);
  if (e1) throw new Error(`nettoyage campagnes : ${e1.message}`);
  const { error: e2 } = await admin.from('panneaux_affichage').delete().eq('source', SOURCE);
  if (e2) throw new Error(`nettoyage panneaux : ${e2.message}`);
  const { error: e3 } = await admin.from('organizations').delete().eq('id', org);
  if (e3) throw new Error(`nettoyage espace : ${e3.message}`);
});

describe('ecrirePlan', () => {
  let campagne = '';
  let premiersIds: Record<string, string> = {};

  it('première écriture : campagne, deux lignes, une source privée, trois panneaux, trois liens', async () => {
    const bilan = await ecrirePlan(admin, entree(['1001', '1002', '1003']));
    expect(bilan).toMatchObject({ lignes: 2, panneaux_ecrits: 3, liens: 3, panneaux_retires: 0, erreurs: [] });
    campagne = bilan.campagne_id;
    const { data: lignes } = await admin.from('campagne_lignes').select('ordre, regie, territoire, data_source_id, details').eq('campagne_id', campagne).order('ordre');
    expect(lignes).toHaveLength(2);
    expect(lignes![0].data_source_id).not.toBeNull();
    expect(lignes![1]).toMatchObject({ regie: 'MEDIAOUTREMER', territoire: 'LA REUNION', data_source_id: null });
    expect((lignes![0].details as { non_places: unknown[] }).non_places).toEqual([{ nom: 'Basic-Fit Essai introuvable', raison: 'adresse introuvable (BAN)' }]);
    const { data: ds } = await admin.from('data_sources').select('organization_id, visibilite, type').eq('id', lignes![0].data_source_id).single();
    expect(ds).toEqual({ organization_id: org, visibilite: 'privee', type: 'panneaux' });
    const { data: p } = await admin.from('panneaux_affichage')
      .select('organization_id, data_source_id, regie, reseau, nom_lieu, nb_ecrans, nb_faces, formats, geoloc_qualite, reference_panneau, metadata')
      .eq('source', SOURCE).eq('source_ref', '1001').single();
    expect(p).toMatchObject({
      organization_id: org, data_source_id: lignes![0].data_source_id, regie: 'BASIC FIT', reseau: 'DOOH salle de sport',
      nom_lieu: 'Basic-Fit Essai 1001', nb_ecrans: 2, nb_faces: 2, formats: ['WW', 'NC'], geoloc_qualite: 'a_verifier', reference_panneau: '1001',
    });
    expect((p!.metadata as { onglet: string }).onglet).toBe('LISTING BASIC FIT');
    premiersIds = await idsPanneaux();
  });

  it('rejeu identique : même campagne, mêmes id de panneaux, lignes et liens remplacés', async () => {
    const bilan = await ecrirePlan(admin, entree(['1001', '1002', '1003']));
    expect(bilan.campagne_id).toBe(campagne);
    expect(bilan).toMatchObject({ lignes: 2, panneaux_ecrits: 3, liens: 3, panneaux_retires: 0 });
    expect(await idsPanneaux()).toEqual(premiersIds);
    const { count } = await admin.from('campagne_lignes').select('id', { count: 'exact', head: true }).eq('campagne_id', campagne);
    expect(count).toBe(2);
  });

  it('rejeu sans un emplacement : son panneau quitte la table, les autres gardent leur id', async () => {
    const bilan = await ecrirePlan(admin, entree(['1001', '1003']));
    expect(bilan).toMatchObject({ panneaux_ecrits: 2, liens: 2, panneaux_retires: 1 });
    const ids = await idsPanneaux();
    expect(ids).toEqual({ '1001': premiersIds['1001'], '1003': premiersIds['1003'] });
  });

  it('un panneau réservé ne se supprime pas en silence', async () => {
    const ids = await idsPanneaux();
    const { error } = await admin.from('panneaux_affichage').delete().eq('id', ids['1001']);
    expect(error?.code).toBe('23503');
  });
});
```

- [ ] **Step 5: Le lancer, il échoue**

Run: `npx vitest run --project integration tests/integration/importer-plan-ooh.test.ts`
Expected: FAIL — module `@/lib/ooh/plan/ecrire` absent.

- [ ] **Step 6: Écrire `ecrire.ts`**

`lib/ooh/plan/ecrire.ts` :

```ts
/**
 * Écriture d'un plan OOH géolocalisé dans une campagne d'espace (spec 2026-10-16-ooh-campagnes § 4.4, § 7).
 *
 * Ordre — chaque étape lit son erreur (supabase-js ne lève pas, il rend `{ error }`) :
 *   1. campagne : upsert sur (organization_id, cle_import) → son id, stable d'un rejeu à l'autre ;
 *   2. une source PRIVÉE de l'espace par réseau (`data_sources`, `mapping.source_key = plan-ooh:<cle>:<réseau>`) :
 *      la RLS existante (`source_visible`) cache ses panneaux aux autres espaces ;
 *   3. panneaux : upsert sur (source, source_ref), `id` DÉTERMINISTE (UUIDv5 de source + source_ref, comme
 *      `lib/import/identite-poi.ts`), lots de 50, une requête par lot, repli ligne à ligne sur échec ;
 *   4. lignes de la campagne : DELETE ciblé (erreur lue) puis INSERT — les liens partent en cascade ;
 *   5. liens ligne ↔ panneau : lots de 50, repli ligne à ligne ;
 *   6. panneaux de la source qui ne sont plus dans la liste : retirés (lots de 50, erreur lue). Sans cela un club
 *      disparu de la liste resterait visible dans l'espace, hors campagne.
 * Non transactionnel (PostgREST) : un échec au milieu laisse un état partiel que le REJEU répare (même clé).
 *
 * Écrivain du script `scripts/ooh/importer-plan.ts` (service_role, hors route) : exception assumée de
 * `tests/unit/securite/perimetre-routes.test.ts`, il ne rend rien à un appelant HTTP.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { uuidV5 } from '@/lib/import/identite-poi';
import { lireTout } from '@/lib/supabase/lire-tout';
import type { AdaptateurId, EmplacementNonPlace, EmplacementPlace, LignePlan } from '@/types/campagnes-media';

/** Taille de lot imposée par CLAUDE.md. */
const LOT = 50;
/** Espace de noms UUIDv5 des panneaux d'un plan : distinct de celui des POI (`identite-poi.ts`). */
const ESPACE_PANNEAUX_PLAN = 'e2a4c6f8-1b3d-4f5a-8c7e-9d0b2a4c6e8f';
/** Borne de lecture des panneaux d'une source (TF4 : ≈ 900 clubs au plus par réseau). */
const PLAFOND_PANNEAUX_SOURCE = 20_000;

export interface EmplacementsDeLigne {
  adaptateur: AdaptateurId;
  places: EmplacementPlace[];
  non_places: EmplacementNonPlace[];
}

export interface CampagneAEcrire {
  nom: string;
  annonceur: string | null;
  vague: string | null;
  cle_import: string;
  date_debut: string | null;
  date_fin: string | null;
  budget_total_ttc: number | null;
  metadata: Record<string, unknown>;
}

export interface EntreeEcriture {
  organizationId: string;
  campagne: CampagneAEcrire;
  lignes: readonly LignePlan[];
  /** Par `ordre` de ligne : les emplacements de sa liste. Une ligne absente n'a pas de liste (DROM). */
  emplacements: ReadonlyMap<number, EmplacementsDeLigne>;
}

export interface BilanEcriture {
  campagne_id: string;
  lignes: number;
  panneaux_ecrits: number;
  liens: number;
  panneaux_retires: number;
  erreurs: string[];
}

type Progression = (etape: string, fait: number, total: number) => void;

/** `plan-ooh:<cle_import>:<réseau>` — la vague suivante a sa propre clé, donc ses propres panneaux. */
export function sourcePanneaux(cleImport: string, adaptateur: AdaptateurId): string {
  return `plan-ooh:${cleImport}:${adaptateur}`;
}

/** L'id d'un panneau de plan : UUIDv5 de (source, source_ref) — le même à chaque rejeu. */
export function identitePanneau(source: string, sourceRef: string): string {
  return uuidV5(`${source}|${sourceRef}`, ESPACE_PANNEAUX_PLAN);
}

function echouer(quoi: string, erreur: { message: string } | null): never {
  throw new Error(`${quoi} : ${erreur?.message ?? 'aucune donnée rendue'}`);
}

/** Écrit `lignes` par lots de 50, une requête par lot ; sur échec d'un lot, ligne à ligne pour nommer la fautive. */
async function parLots<T>(
  lignes: readonly T[],
  envoyer: (lot: T[]) => PromiseLike<{ error: { message: string } | null; data: unknown[] | null }>,
  nommer: (l: T) => string,
  erreurs: string[],
  avancer: (fait: number) => void,
): Promise<unknown[]> {
  const rendues: unknown[] = [];
  for (let i = 0; i < lignes.length; i += LOT) {
    const lot = lignes.slice(i, i + LOT);
    const { data, error } = await envoyer(lot);
    if (!error) {
      rendues.push(...(data ?? []));
    } else {
      for (const l of lot) {
        const r = await envoyer([l]);
        if (r.error) erreurs.push(`${nommer(l)} : ${r.error.message}`);
        else rendues.push(...(r.data ?? []));
      }
    }
    avancer(Math.min(i + LOT, lignes.length));
  }
  return rendues;
}

async function sourcePrivee(
  sb: SupabaseClient, e: EntreeEcriture, ligne: LignePlan, adaptateur: AdaptateurId, source: string, d: EmplacementsDeLigne,
): Promise<string> {
  const champs = {
    name: `${e.campagne.nom} — ${ligne.regie}`,
    type: 'panneaux',
    category: 'ooh',
    regie: ligne.regie,
    visibilite: 'privee',
    status: 'active',
    file_format: 'xlsx',
    original_filename: typeof e.campagne.metadata.fichier === 'string' ? e.campagne.metadata.fichier : null,
    row_count: d.places.length + d.non_places.length,
    valid_count: d.places.length,
    error_count: d.non_places.length,
    mapping: { source_key: source, campagne_cle: e.campagne.cle_import, adaptateur },
  };
  const { data: existante, error: eLecture } = await sb.from('data_sources').select('id')
    .eq('organization_id', e.organizationId).eq('type', 'panneaux').eq('mapping->>source_key', source).maybeSingle();
  if (eLecture) echouer(`source ${source} (lecture)`, eLecture);
  if (existante) {
    const { error } = await sb.from('data_sources').update(champs).eq('id', existante.id);
    if (error) echouer(`source ${source} (mise à jour)`, error);
    return existante.id as string;
  }
  const { data, error } = await sb.from('data_sources').insert({ ...champs, organization_id: e.organizationId }).select('id').single();
  if (error || !data) echouer(`source ${source} (création)`, error);
  return data.id as string;
}

function ligneDePanneau(p: EmplacementPlace, source: string, dataSourceId: string, organizationId: string, regie: string) {
  return {
    id: identitePanneau(source, p.source_ref),
    lat: p.lat,
    lng: p.lng,
    source,
    source_ref: p.source_ref,
    data_source_id: dataSourceId,
    organization_id: organizationId,
    regie,
    type_panneau: p.reseau,
    reseau: p.reseau,
    nom_lieu: p.nom_lieu,
    type_lieu: p.type_lieu,
    numerique: p.numerique,
    nb_ecrans: p.nb_ecrans,
    nb_faces: p.nb_ecrans,
    formats: p.formats,
    contacts_semaine: p.contacts_semaine,
    contacts_18_25_semaine: p.contacts_18_25_semaine,
    adresse: p.adresse,
    ville: p.ville,
    code_postal: p.code_postal,
    code_insee: p.code_insee,
    code_departement: p.code_departement,
    reference_panneau: p.reference_panneau,
    geoloc_methode: p.geoloc_methode,
    geoloc_qualite: p.geoloc_qualite,
    geoloc_score: p.geoloc_score,
    geoloc_libelle: p.geoloc_libelle,
    metadata: p.metadata,
    actif: true,
    date_maj: new Date().toISOString(),
  };
}

/** Écrit (ou réécrit) une campagne, ses lignes, ses panneaux et leurs liens. */
export async function ecrirePlan(sb: SupabaseClient, e: EntreeEcriture, progression?: Progression): Promise<BilanEcriture> {
  const erreurs: string[] = [];

  // 1. Campagne.
  const { data: campagne, error: eCampagne } = await sb.from('campagnes')
    .upsert({ organization_id: e.organizationId, ...e.campagne }, { onConflict: 'organization_id,cle_import' })
    .select('id').single();
  if (eCampagne || !campagne) echouer('campagne', eCampagne);
  const campagneId = campagne.id as string;

  // 2-3. Une source privée et ses panneaux, par ligne qui a une liste.
  const sourceDeLigne = new Map<number, string>();
  const idsEcrits = new Map<string, Set<string>>();
  let panneauxEcrits = 0;
  for (const ligne of e.lignes) {
    const d = e.emplacements.get(ligne.ordre);
    if (!d || d.places.length === 0) continue;
    const source = sourcePanneaux(e.campagne.cle_import, d.adaptateur);
    const dataSourceId = await sourcePrivee(sb, e, ligne, d.adaptateur, source, d);
    sourceDeLigne.set(ligne.ordre, dataSourceId);
    const lignesPanneaux = d.places.map((p) => ligneDePanneau(p, source, dataSourceId, e.organizationId, ligne.regie));
    const rendus = await parLots(
      lignesPanneaux,
      (lot) => sb.from('panneaux_affichage').upsert(lot, { onConflict: 'source,source_ref' }).select('id'),
      (l) => `panneau ${l.source_ref} (${l.nom_lieu})`,
      erreurs,
      (fait) => progression?.(`panneaux ${d.adaptateur}`, fait, lignesPanneaux.length),
    );
    idsEcrits.set(source, new Set((rendus as { id: string }[]).map((r) => r.id)));
    panneauxEcrits += rendus.length;
  }

  // 4. Lignes : remplacées. Le DELETE est lu : un DELETE raté suivi de l'INSERT doublerait les lignes.
  const { error: eSuppression } = await sb.from('campagne_lignes').delete({ count: 'exact' }).eq('campagne_id', campagneId);
  if (eSuppression) echouer('suppression des anciennes lignes', eSuppression);
  const { data: lignesEcrites, error: eLignes } = await sb.from('campagne_lignes').insert(e.lignes.map((l) => {
    const d = e.emplacements.get(l.ordre);
    return {
      campagne_id: campagneId,
      media: l.media,
      ordre: l.ordre,
      regie: l.regie,
      reseau: l.reseau,
      territoire: l.territoire,
      nb_ecrans: l.nb_ecrans,
      format: l.format,
      nb_diffusions: l.nb_diffusions,
      date_debut: l.date_debut,
      date_fin: l.date_fin,
      duree_libelle: l.duree_libelle,
      rang_option: l.rang_option,
      plage_horaire: l.plage_horaire,
      montant_brut: l.montant_brut,
      montant_net: l.montant_net,
      frais: l.frais,
      honoraires: l.honoraires,
      total_ttc: l.total_ttc,
      contacts_15_plus: l.contacts_15_plus,
      contacts_18_24: l.contacts_18_24,
      data_source_id: sourceDeLigne.get(l.ordre) ?? null,
      details: {
        ...l.details,
        ...(d ? {
          adaptateur: d.adaptateur,
          nb_emplacements_listes: d.places.length + d.non_places.length,
          non_places: d.non_places.map((n) => ({ nom: n.nom, raison: n.raison })),
        } : {}),
      },
    };
  })).select('id, ordre');
  if (eLignes || !lignesEcrites) echouer('écriture des lignes', eLignes);
  const idDeLigne = new Map((lignesEcrites as { id: string; ordre: number }[]).map((l) => [l.ordre, l.id]));

  // 5. Liens ligne ↔ panneau.
  const liens: { ligne_id: string; panneau_id: string; nb_ecrans: number | null; formats: string[] }[] = [];
  for (const [ordre, d] of e.emplacements) {
    const ligneId = idDeLigne.get(ordre);
    if (!ligneId || !sourceDeLigne.has(ordre)) continue;
    const source = sourcePanneaux(e.campagne.cle_import, d.adaptateur);
    const ecrits = idsEcrits.get(source) ?? new Set<string>();
    for (const p of d.places) {
      const panneauId = identitePanneau(source, p.source_ref);
      if (ecrits.has(panneauId)) liens.push({ ligne_id: ligneId, panneau_id: panneauId, nb_ecrans: p.nb_ecrans, formats: p.formats });
    }
  }
  const liensEcrits = await parLots(
    liens,
    (lot) => sb.from('campagne_ligne_panneaux').insert(lot).select('panneau_id'),
    (l) => `lien ${l.panneau_id}`,
    erreurs,
    (fait) => progression?.('liens', fait, liens.length),
  );

  // 6. Panneaux de la source sortis de la liste.
  let retires = 0;
  for (const [source, ecrits] of idsEcrits) {
    const { lignes: presents } = await lireTout<{ id: string }>(
      (de, a) => sb.from('panneaux_affichage').select('id').eq('source', source).order('id').range(de, a),
      PLAFOND_PANNEAUX_SOURCE,
    );
    const orphelins = presents.map((p) => p.id).filter((id) => !ecrits.has(id));
    for (let i = 0; i < orphelins.length; i += LOT) {
      const { count, error } = await sb.from('panneaux_affichage').delete({ count: 'exact' }).in('id', orphelins.slice(i, i + LOT));
      if (error) erreurs.push(`retrait de panneaux sortis de la liste (${source}) : ${error.message}`);
      else retires += count ?? 0;
    }
  }

  return {
    campagne_id: campagneId,
    lignes: lignesEcrites.length,
    panneaux_ecrits: panneauxEcrits,
    liens: liensEcrits.length,
    panneaux_retires: retires,
    erreurs,
  };
}
```

Run: `npx vitest run --project integration tests/integration/importer-plan-ooh.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Déclarer l'écrivain au test de périmètre, vérifier**

`tests/unit/securite/perimetre-routes.test.ts`, dans `ASSUMEES`, après l'entrée `lib/import/inserter.ts` :

```ts
  ['lib/ooh/plan/ecrire.ts',
   'Écrivain du script scripts/ooh/importer-plan.ts (service_role, hors route) : il écrit les panneaux d\'une campagne '
   + 'dans une source PRIVÉE de l\'espace et ne rend rien à un appelant HTTP.'],
```

Run: `npx vitest run --project unit tests/unit/securite/perimetre-routes.test.ts`
Expected: PASS.

- [ ] **Step 8: Écrire le script**

`scripts/ooh/importer-plan.ts` :

```ts
#!/usr/bin/env node
/**
 * Import d'un plan OOH de régie dans une campagne d'un espace de travail (spec 2026-10-16-ooh-campagnes § 7).
 *
 * Étapes nommées, avec progression : lecture → synthèse du plan → emplacements par réseau → géolocalisation →
 * écriture → rapport. `--a-blanc` fait tout sauf l'écriture. Le fichier client est passé en argument et n'est JAMAIS
 * versionné (`PM OOH/` exclu par .git/info/exclude) ; le rapport CSV s'écrit HORS du dépôt.
 * Rejeu = même résultat : la campagne est retrouvée par (espace, --cle), ses lignes et liens remplacés, ses panneaux
 * gardent leurs id.
 *
 * Usage :
 *   npx tsx scripts/ooh/importer-plan.ts --plan "<fichier.xlsx>" --espace marine \
 *     --campagne "Marine nationale — TF4 septembre 2026" --vague TF4 --cle marine-tf4-2026 [--annonceur "…"] \
 *     [--rapport <dossier>] [--a-blanc]
 *
 * ⚠ CIBLE : la base LOCALE. Dépendances externes : BAN (api-adresse.data.gouv.fr) et le référentiel SNCF des gares.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { geocodeBatchDetailed } from '@/lib/import/geocoder';
import { lirePlan, rattacher } from '@/lib/ooh/plan/adaptateurs';
import { lireArguments } from '@/lib/ooh/plan/arguments';
import { lireClasseur } from '@/lib/ooh/plan/classeur';
import { ecrirePlan, type EmplacementsDeLigne } from '@/lib/ooh/plan/ecrire';
import { telechargerReferentielGares } from '@/lib/ooh/plan/gares-sncf';
import { geolocaliser } from '@/lib/ooh/plan/geolocaliser';
import { cheminRapportAutorise, compterParReseau, csvAReprendre, ligneProgression, nomRapport } from '@/lib/ooh/plan/rapport';

// Priorité au local. `dotenv` n'écrase jamais une variable déjà posée : l'ordre de ces deux lignes EST le garde-fou.
if (existsSync('.env.development.local')) dotenv.config({ path: '.env.development.local' });
dotenv.config({ path: '.env.local' });

function etape(titre: string): void {
  process.stdout.write(`\n— ${titre}\n`);
}

function suivre(nom: string): (fait: number, total: number) => void {
  return (fait, total) => process.stdout.write(`\r${ligneProgression(nom, fait, total)}   `);
}

async function main(): Promise<void> {
  const args = lireArguments(process.argv.slice(2), tmpdir());
  if ('erreur' in args) {
    console.error(args.erreur);
    process.exit(2);
  }
  if (!cheminRapportAutorise(args.rapport, process.cwd())) {
    console.error(`Le rapport doit s'écrire HORS du dépôt (il nomme des emplacements du client) : ${args.rapport}`);
    process.exit(2);
  }

  etape('1/6 Lecture du classeur');
  const classeur = await lireClasseur(readFileSync(args.plan));
  console.log(`${classeur.feuilles.size} onglet(s) : ${[...classeur.feuilles.keys()].join(', ')}`);

  etape('2/6 Synthèse du plan');
  const plan = lirePlan(classeur);
  console.log(`${plan.lignes.length} ligne(s) ; formats reconnus : ${plan.adaptateurs.join(', ')}`);

  etape('3/6 Emplacements par réseau');
  const parLigne = rattacher(plan.lignes, plan.emplacements);
  for (const l of plan.lignes) {
    const r = parLigne.get(l.ordre);
    console.log(`  ${l.ordre}. ${l.regie} · ${l.reseau ?? l.territoire ?? '—'} — ${r ? `${r.emplacements.length} emplacement(s) (${r.adaptateur})` : 'liste non fournie'}`);
  }

  etape('4/6 Géolocalisation');
  const aPlacer = [...parLigne.values()].flatMap((r) => r.emplacements);
  const gares = aPlacer.some((e) => e.recherche.type === 'gare') ? await telechargerReferentielGares() : [];
  if (gares.length > 0) console.log(`référentiel SNCF : ${gares.length} gares`);
  const geo = await geolocaliser(aPlacer, { gares, geocoder: geocodeBatchDetailed, progression: suivre('géolocalisation') });
  process.stdout.write('\n');

  const emplacements = new Map<number, EmplacementsDeLigne>();
  for (const [ordre, r] of parLigne) {
    emplacements.set(ordre, {
      adaptateur: r.adaptateur,
      places: geo.places.filter((p) => p.adaptateur === r.adaptateur),
      non_places: geo.non_places.filter((n) => n.adaptateur === r.adaptateur),
    });
  }

  etape('5/6 Écriture');
  if (args.aBlanc) {
    console.log('À blanc : rien n\'est écrit.');
  } else {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !cle) {
      console.error('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente : monter le stack local (scripts/local/).');
      process.exit(1);
    }
    const sb = createClient(url, cle, { auth: { persistSession: false } });
    const { data: espace, error } = await sb.from('organizations').select('id, name').eq('slug', args.espace).maybeSingle();
    if (error || !espace) {
      console.error(`Espace « ${args.espace} » introuvable${error ? ` : ${error.message}` : ''}.`);
      process.exit(1);
    }
    const bilan = await ecrirePlan(sb, {
      organizationId: espace.id as string,
      campagne: {
        nom: args.campagne,
        annonceur: args.annonceur ?? (espace.name as string),
        vague: args.vague,
        cle_import: args.cle,
        date_debut: plan.entete.date_debut,
        date_fin: plan.entete.date_fin,
        budget_total_ttc: plan.entete.budget_total_ttc,
        metadata: {
          fichier: basename(args.plan),
          titre_plan: plan.entete.titre,
          hypothese: plan.entete.hypothese,
          couts_annexes: plan.entete.couts_annexes,
          notes: plan.entete.notes,
          adaptateurs: plan.adaptateurs,
          importe_le: new Date().toISOString(),
        },
      },
      lignes: plan.lignes,
      emplacements,
    }, (nom, fait, total) => suivre(nom)(fait, total));
    process.stdout.write('\n');
    console.log(`campagne ${bilan.campagne_id} : ${bilan.lignes} ligne(s), ${bilan.panneaux_ecrits} panneau(x) écrit(s), `
      + `${bilan.liens} lien(s), ${bilan.panneaux_retires} panneau(x) retiré(s) de la liste.`);
    for (const e of bilan.erreurs) console.error(`  ERREUR ${e}`);
    if (bilan.erreurs.length > 0) process.exitCode = 1;
  }

  etape('6/6 Rapport');
  console.table(compterParReseau(geo.places, geo.non_places));
  const chemin = join(args.rapport, nomRapport(args.cle, new Date()));
  writeFileSync(chemin, csvAReprendre(geo.places, geo.non_places), 'utf8');
  console.log(`emplacements à reprendre : ${chemin}`);
}

main().catch((e: unknown) => {
  console.error(`\nÉCHEC : ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
```

- [ ] **Step 9: Essai à blanc sur un classeur synthétique**

Run: `npx tsc --noEmit` (code de retour 0).

Écrire `"$TEMP/essai-plan.cjs"` (hors dépôt) qui fabrique un plan synthétique minimal ; il est lancé par `node -` depuis la racine du worktree, pour que `require('exceljs')` se résolve dans son `node_modules` :

```js
const ExcelJS = require('exceljs');
(async () => {
  const wb = new ExcelJS.Workbook();
  const hyp = wb.addWorksheet('HYP1');
  hyp.addRow([null, 'ESSAI - 20/09 - 02/10']);
  hyp.addRow([null, 'AFFICHEURS', 'RESEAUX', "NBRE D'ECRANS", 'FORMAT', 'LOGS', 'DEPART', 'DUREE', 'RANG OPTION', 'TARIF BRUT', 'TARIF NET ESTIME', 'FRAIS ESTIMES', 'HONO NET+FRAIS', 'TOTAL TTCHI']);
  hyp.addRow([null, 'METROPOLE']);
  hyp.addRow([null, 'STRIDE', 'DOOH BORNES - 1 établissements', 1, 'DOOH', 10, new Date(Date.UTC(2026, 8, 20)), '7 jours', '2nd OPTION', 1, 1, 1, 1, 1]);
  const campus = wb.addWorksheet('LISTING CAMPUS');
  campus.addRow(['Etablissement', 'Groupement', 'Type', 'Adresse', 'CP', 'Ville', 'Zone', 'Ecrans', 'Taille écrans', 'Contacts par semaine', 'Contacts 18-25 par semaine']);
  campus.addRow(['Mairie essai', '0', 'Campus', '1 place de la Mairie', '45000', 'Orléans', 'Centre', 1, 10, 100, 90]);
  await wb.xlsx.writeFile(process.env.SORTIE);
})();
```

Run: `SORTIE="$TEMP/essai-plan.xlsx" node - < "$TEMP/essai-plan.cjs"` puis `npx tsx scripts/ooh/importer-plan.ts --plan "$TEMP/essai-plan.xlsx" --espace marine --campagne "Essai à blanc" --cle essai-a-blanc --rapport "$TEMP" --a-blanc`
Expected: les six étapes s'affichent, `1 ligne(s)`, `1. STRIDE · DOOH BORNES — 1 emplacement(s) (stride-campus)`, une progression de géolocalisation qui finit à `100 %`, « À blanc : rien n'est écrit. », un tableau `stride-campus` (lus 1), et le chemin du CSV dans `$TEMP`. (Appel réel à la BAN.)

Run: `npx tsx scripts/ooh/importer-plan.ts --plan x.xlsx --espace marine --campagne C --cle essai --rapport ./docs`
Expected: `Le rapport doit s'écrire HORS du dépôt …`, code de sortie 2.

- [ ] **Step 10: Documenter la dépendance externe**

`tests/unit/docs/derive-documentation.test.ts`, tableau `hotesExternes` (≈ ligne 71) :

```ts
    const hotesExternes: Array<[string, string]> = [
      ['openrouteservice', 'OpenRouteService'],
      ['open-meteo', 'Open-Meteo'],
      // Référentiel public des gares SNCF, téléchargé par scripts/ooh/importer-plan.ts (2026-10-16).
      ['ressources.data.sncf.com', 'gares de voyageurs'],
    ];
```

`ARCHITECTURE.md` :
- tableau de la pile technique (`Grep "^| Meteo | Open-Meteo API"`), ajouter après la ligne Météo :
  `| Gares (import OOH) | Référentiel public SNCF **« gares de voyageurs »** (`ressources.data.sncf.com`, export CSV, sans clé), téléchargé à chaque lancement de `scripts/ooh/importer-plan.ts` : nom, code INSEE, code UIC, position. Les noms de la liste de régie y sont cherchés (plein, dernière partie, première + dernière, première — cette dernière seulement « à vérifier ») ; 32 alias versionnés dans `lib/ooh/plan/gares-sncf.ts`, chacun vérifié par le code INSEE attendu | — |`
- dans la section `### Campagnes multi-média (2026-10-16, sql/261)` ajoutée à la tâche 2, ajouter un paragraphe :

```markdown
**Import d'un plan de régie** : `npx tsx scripts/ooh/importer-plan.ts --plan <xlsx> --espace <slug> --campagne "<nom>"
--cle <clé> [--vague V] [--annonceur …] [--rapport <dossier hors dépôt>] [--a-blanc]`. Chaîne de fonctions pures
(`lib/ooh/plan/`) : `lireClasseur` (exceljs, grilles positionnelles) → adaptateurs (`adaptateurs/` : `synthese-hyp`,
`mediatransports-gares`, `basic-fit`, `stride-campus` — la vague suivante = un adaptateur de plus) → `rattacher` (une
liste à la première ligne de sa régie) → `geolocaliser` (référentiel SNCF + alias ; BAN `/search/csv/` : ≥ 0,6 sûr,
0,3-0,6 à vérifier, < 0,3 non placé ; commune seule, ville ou CP différents → à vérifier) → `ecrirePlan` (campagne
upsertée sur (espace, `cle_import`) ; une source PRIVÉE par réseau, `source = plan-ooh:<clé>:<réseau>` ; panneaux
upsertés sur (source, source_ref), id UUIDv5 ; lignes remplacées ; liens par lots de 50 ; panneaux sortis de la liste
retirés). Rapport : compteurs par réseau et CSV des emplacements à reprendre, écrit HORS du dépôt. Pas d'import depuis
l'interface (spec § 2) : un plan de régie n'a pas d'API.
```

- ligne de table `| \`panneaux_affichage\` |` : ajouter « Les panneaux d'une campagne ont `source = plan-ooh:<clé>:<réseau>` et une source PRIVÉE de l'espace (sql/261-262, `scripts/ooh/importer-plan.ts`) ».

Run: `npx vitest run --project unit tests/unit/docs/derive-documentation.test.ts tests/unit/securite/aucun-secret-en-dur.test.ts tests/unit/ooh/`
Expected: PASS.

- [ ] **Step 11: Catalogue, commit**

Run: `npm run catalogue`, puis `npx vitest run --project unit tests/unit/docs/catalogue-code.test.ts`
Expected: PASS.

```bash
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add lib/ooh/plan/ecrire.ts lib/ooh/plan/rapport.ts lib/ooh/plan/arguments.ts scripts/ooh/importer-plan.ts \
  tests/unit/ooh/rapport.test.ts tests/unit/ooh/arguments.test.ts tests/integration/importer-plan-ooh.test.ts \
  tests/unit/securite/perimetre-routes.test.ts tests/unit/docs/derive-documentation.test.ts ARCHITECTURE.md docs/CATALOGUE_CODE.md
git commit -m "feat: script d'import générique d'un plan OOH (étapes, progression, à blanc, rejeu, rapport hors dépôt)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Routes `GET /api/map/ooh/campagnes` et `GET /api/map/ooh/campagnes/[id]`

**Files:**
- Create: `app/api/map/ooh/campagnes/route.ts`, `app/api/map/ooh/campagnes/[id]/route.ts`
- Create: `tests/unit/api/map-ooh-campagnes.test.ts`
- Modify: `tests/unit/securite/perimetre-routes.test.ts` (nouveau `describe` en fin de fichier)
- Modify: `ARCHITECTURE.md` (section `### Donnees cartographiques`, après la ligne `/api/map/ooh`)

**Interfaces:**
- Consumes: `campagnes_ooh_jsonb`, `campagne_ooh_jsonb` (tâche 4, types reportés) ; `getSessionOrg` ; `createAdminClient`.
- Produces:
  - `GET /api/map/ooh/campagnes` → 200 `{ campagnes: CampagneOohResume[]; tronque: boolean }` (forme de `campagnes_ooh_jsonb`) ; sans espace actif valide : `{ campagnes: [], tronque: false }` sans lecture ; 500 `{ error: 'Campagnes OOH indisponibles.' }`.
  - `GET /api/map/ooh/campagnes/[id]` → 200 la sortie de `campagne_ooh_jsonb` ; 400 `{ error: 'Identifiant de campagne invalide.' }` ; 404 `{ error: 'Campagne introuvable dans cet espace de travail.' }` (hors espace, ou sans espace) ; 500 `{ error: 'Campagne OOH indisponible.' }`.

- [ ] **Step 1: Écrire les tests**

`tests/unit/api/map-ooh-campagnes.test.ts` :

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Routes de lecture des campagnes OOH (spec 2026-10-16-ooh-campagnes § 5) : l'espace ACTIF de la session décide de
 * tout ; un identifiant non UUID est refusé avant toute lecture ; une campagne d'un autre espace est un 404.
 */
type Session = { userId: string; role: string; orgId: string | null } | null;
let session: Session = null;
vi.mock('@/lib/auth/getSessionOrg', () => ({ getSessionOrg: async () => session }));

const appels: { nom: string; args: Record<string, unknown> }[] = [];
let reponse: { data: unknown; error: { message: string } | null } = { data: null, error: null };
vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    rpc: async (nom: string, args: Record<string, unknown>) => {
      appels.push({ nom, args });
      return reponse;
    },
  }),
}));

const { GET: lister } = await import('@/app/api/map/ooh/campagnes/route');
const { GET: lire } = await import('@/app/api/map/ooh/campagnes/[id]/route');

const ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const CAMPAGNE = '6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const requete = (url: string) => ({ nextUrl: new URL(url), headers: new Headers(), cookies: { get: () => undefined } }) as never;

beforeEach(() => {
  appels.length = 0;
  session = { userId: 'u', role: 'client', orgId: ORG };
  reponse = { data: null, error: null };
});

describe('GET /api/map/ooh/campagnes', () => {
  it('lit les campagnes de l espace actif, bornées à 200', async () => {
    reponse = { data: { campagnes: [{ id: CAMPAGNE, nom: 'Essai', lignes: [] }], tronque: false }, error: null };
    const res = await lister(requete('http://localhost/api/map/ooh/campagnes'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ campagnes: [{ id: CAMPAGNE, nom: 'Essai', lignes: [] }], tronque: false });
    expect(appels).toEqual([{ nom: 'campagnes_ooh_jsonb', args: { p_org: ORG, p_limite: 200 } }]);
  });

  it.each([
    ['sans session', null],
    ['sans espace actif', { userId: 'u', role: 'super_admin', orgId: null }],
    ['espace non UUID', { userId: 'u', role: 'client', orgId: 'pas-un-uuid' }],
  ] as [string, Session][])('%s : liste vide, aucune lecture', async (_nom, s) => {
    session = s;
    const res = await lister(requete('http://localhost/api/map/ooh/campagnes'));
    expect(await res.json()).toEqual({ campagnes: [], tronque: false });
    expect(appels).toEqual([]);
  });

  it('lecture en échec : 500 en français, détail au journal seulement', async () => {
    reponse = { data: null, error: { message: 'relation does not exist' } };
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await lister(requete('http://localhost/api/map/ooh/campagnes'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Campagnes OOH indisponibles.' });
    expect(journal).toHaveBeenCalled();
    journal.mockRestore();
  });
});

describe('GET /api/map/ooh/campagnes/[id]', () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  it('rend la campagne de l espace actif, bornée à 20 000 emplacements', async () => {
    reponse = { data: { campagne: { id: CAMPAGNE }, lignes: [], emplacements: [], tronque: false }, error: null };
    const res = await lire(requete(`http://localhost/api/map/ooh/campagnes/${CAMPAGNE}`), params(CAMPAGNE));
    expect(res.status).toBe(200);
    expect(appels).toEqual([{ nom: 'campagne_ooh_jsonb', args: { p_campagne: CAMPAGNE, p_org: ORG, p_limite: 20000 } }]);
  });

  it('identifiant non UUID : 400, aucune lecture', async () => {
    const res = await lire(requete('http://localhost/api/map/ooh/campagnes/abc'), params('abc'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Identifiant de campagne invalide.' });
    expect(appels).toEqual([]);
  });

  it('campagne d un autre espace (la RPC rend null) : 404', async () => {
    reponse = { data: null, error: null };
    const res = await lire(requete(`http://localhost/api/map/ooh/campagnes/${CAMPAGNE}`), params(CAMPAGNE));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Campagne introuvable dans cet espace de travail.' });
  });

  it('sans espace actif : 404, aucune lecture', async () => {
    session = { userId: 'u', role: 'super_admin', orgId: null };
    const res = await lire(requete(`http://localhost/api/map/ooh/campagnes/${CAMPAGNE}`), params(CAMPAGNE));
    expect(res.status).toBe(404);
    expect(appels).toEqual([]);
  });

  it('lecture en échec : 500 en français', async () => {
    reponse = { data: null, error: { message: 'timeout' } };
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await lire(requete(`http://localhost/api/map/ooh/campagnes/${CAMPAGNE}`), params(CAMPAGNE));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Campagne OOH indisponible.' });
    journal.mockRestore();
  });
});
```

Dans `tests/unit/securite/perimetre-routes.test.ts`, ajouter en fin de fichier :

```ts
describe('campagnes multi-média — toute lecture d une route passe par l espace actif', () => {
  // Les campagnes et leurs panneaux sont PRIVÉS à un espace (spec 2026-10-16-ooh-campagnes, décision 5). Les routes
  // lisent par service_role : c'est le `p_org` de l'espace actif, et lui seul, qui cloisonne.
  const LECTURE_CAMPAGNE = /rpc\(\s*'(campagne_ooh_jsonb|campagnes_ooh_jsonb)'|from\(\s*'(campagnes|campagne_lignes|campagne_ligne_panneaux)'\s*\)/;
  const routes = candidats.filter((f) => f.startsWith('app/api/') && LECTURE_CAMPAGNE.test(readFileSync(join(RACINE, f), 'utf8')));

  it('les routes de campagne existent (le motif n est pas aveugle)', () => {
    expect(routes.length).toBeGreaterThanOrEqual(2);
  });

  for (const f of routes) {
    it(f, () => {
      const source = readFileSync(join(RACINE, f), 'utf8');
      expect(source, `${f} doit lire la session`).toMatch(/getSessionOrg\(/);
      expect(source, `${f} doit passer l espace actif à la RPC`).toMatch(/p_org:\s*orgId/);
    });
  }
});
```

- [ ] **Step 2: Les lancer, ils échouent**

Run: `npx vitest run --project unit tests/unit/api/map-ooh-campagnes.test.ts tests/unit/securite/perimetre-routes.test.ts`
Expected: FAIL — routes absentes (`Failed to load url @/app/api/map/ooh/campagnes/route`) et « les routes de campagne existent » à 0.

- [ ] **Step 3: Écrire les routes**

`app/api/map/ooh/campagnes/route.ts` :

```ts
/**
 * GET /api/map/ooh/campagnes — les campagnes de l'espace ACTIF ayant au moins une ligne OOH, pour le sélecteur de
 * « Autres » → « Panneaux OOH et DOOH » (spec 2026-10-16-ooh-campagnes § 5, § 6) :
 * `{ campagnes: [{ id, nom, annonceur, vague, date_debut, date_fin, lignes: [{ id, ordre, media, regie, reseau,
 * territoire, nb_ecrans, nb_places, nb_non_places }] }], tronque }`.
 *
 * UNE RPC `jsonb` (`campagnes_ooh_jsonb`, sql/263) : aucune troncature PostgREST, borne écrite ci-dessous et `tronque`.
 * Sans espace actif (ou un espace qui n'est pas un UUID) : liste vide SANS lecture — rien n'est révélé.
 * Protégée par le middleware (préfixe `/api/map/ooh`, `middleware.ts` inchangé). Super_admin compris : la carte voit
 * comme l'espace choisi.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { getSessionOrg } from '@/lib/auth/getSessionOrg';

export const dynamic = 'force-dynamic';

/** Un espace a peu de campagnes (une par vague) : 200 suffit ; au-delà, la RPC le dit (`tronque`). */
const BORNE_CAMPAGNES = 200;

const Uuid = z.string().uuid();

export async function GET(req: NextRequest) {
  const session = await getSessionOrg(req);
  const orgId = session?.orgId && Uuid.safeParse(session.orgId).success ? session.orgId : null;
  if (!orgId) return NextResponse.json({ campagnes: [], tronque: false });

  const { data, error } = await createAdminClient().rpc('campagnes_ooh_jsonb', { p_org: orgId, p_limite: BORNE_CAMPAGNES });
  if (error) {
    console.error('[map/ooh/campagnes] lecture :', error.message);
    return NextResponse.json({ error: 'Campagnes OOH indisponibles.' }, { status: 500 });
  }
  return NextResponse.json(data);
}
```

`app/api/map/ooh/campagnes/[id]/route.ts` :

```ts
/**
 * GET /api/map/ooh/campagnes/[id] — une campagne OOH de l'espace ACTIF, ses lignes et ses emplacements en GeoJSON
 * (spec 2026-10-16-ooh-campagnes § 5) : la sortie de `campagne_ooh_jsonb` (sql/263).
 *
 * 400 si l'identifiant n'est pas un UUID (aucune lecture) ; 404 si la campagne n'est pas dans l'espace actif — la RPC
 * rend `null` — ou s'il n'y a pas d'espace actif ; 500 avec un message français, détail au journal seulement.
 * Borne : 20 000 emplacements (TF4 en porte ≈ 1 230) ; la RPC est `jsonb`, elle lit `p_limite + 1` et rend `tronque`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { getSessionOrg } from '@/lib/auth/getSessionOrg';

export const dynamic = 'force-dynamic';

const BORNE_EMPLACEMENTS = 20_000;

const Parametres = z.object({ id: z.string().uuid() });
const Uuid = z.string().uuid();

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const p = Parametres.safeParse(await params);
  if (!p.success) return NextResponse.json({ error: 'Identifiant de campagne invalide.' }, { status: 400 });

  const session = await getSessionOrg(req);
  const orgId = session?.orgId && Uuid.safeParse(session.orgId).success ? session.orgId : null;
  if (!orgId) return NextResponse.json({ error: 'Campagne introuvable dans cet espace de travail.' }, { status: 404 });

  const { data, error } = await createAdminClient().rpc('campagne_ooh_jsonb', {
    p_campagne: p.data.id, p_org: orgId, p_limite: BORNE_EMPLACEMENTS,
  });
  if (error) {
    console.error('[map/ooh/campagnes/[id]] lecture :', error.message);
    return NextResponse.json({ error: 'Campagne OOH indisponible.' }, { status: 500 });
  }
  if (data === null) return NextResponse.json({ error: 'Campagne introuvable dans cet espace de travail.' }, { status: 404 });
  return NextResponse.json(data);
}
```

- [ ] **Step 4: Documenter les routes**

`ARCHITECTURE.md`, section `### Donnees cartographiques`, après la ligne qui commence par `| \`/api/map/ooh\` | POST |` :

```markdown
| `/api/map/ooh/campagnes` | GET | Campagnes de l'espace ACTIF ayant au moins une ligne OOH (spec 2026-10-16-ooh-campagnes § 5) : `{ campagnes: [{ id, nom, annonceur, vague, date_debut, date_fin, lignes: [{ id, ordre, media, regie, reseau, territoire, nb_ecrans, nb_places, nb_non_places }] }], tronque }`. UNE RPC `campagnes_ooh_jsonb` (sql/263), borne écrite `BORNE_CAMPAGNES` = 200. Sans espace actif ou espace non UUID : `{ campagnes: [], tronque: false }` SANS lecture. 500 « Campagnes OOH indisponibles. », détail en console serveur. Protégée par le préfixe `/api/map/ooh` du middleware |
| `/api/map/ooh/campagnes/[id]` | GET | Une campagne OOH de l'espace actif : la sortie de `campagne_ooh_jsonb` (campagne, lignes OOH, emplacements GeoJSON avec toutes leurs colonnes et `metadata`, `tronque`), borne `BORNE_EMPLACEMENTS` = 20 000. 400 identifiant non UUID ; 404 hors espace (la RPC rend `null`) ou sans espace ; 500 « Campagne OOH indisponible. ». Lue par l'overlay Angular « Autres » → « Panneaux OOH et DOOH » |
```

- [ ] **Step 5: Relancer les tests**

Run: `npx vitest run --project unit tests/unit/api/map-ooh-campagnes.test.ts tests/unit/securite/perimetre-routes.test.ts tests/unit/api/routes-publiques.test.ts tests/unit/api/validation-corps.test.ts tests/unit/db/troncature-postgrest.test.ts tests/unit/docs/derive-documentation.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: code de retour 0.

- [ ] **Step 6: Catalogue, commit**

Run: `npm run catalogue`, puis `npx vitest run --project unit tests/unit/docs/catalogue-code.test.ts`
Expected: PASS.

```bash
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add app/api/map/ooh/campagnes tests/unit/api/map-ooh-campagnes.test.ts tests/unit/securite/perimetre-routes.test.ts ARCHITECTURE.md docs/CATALOGUE_CODE.md
git commit -m "feat: routes de lecture des campagnes OOH de l'espace actif" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Jetons `--ligne-media-*`, API Angular, état et couche dédiée d'une campagne OOH

**Files:**
- Modify: `app/globals.css` (bloc `:root` après `--nature-8: #a06c8c;` ≈ ligne 172 ; bloc `html.light` après `--nature-8: #7e4e6c;` ≈ ligne 393)
- Modify: `angular/src/styles/jetons.css` (bloc `:root, :host` après `--nature-8: #a06c8c;` ≈ ligne 158 ; bloc `html.light, :host(.light)` après `--nature-8: #7e4e6c;` ≈ ligne 358)
- Modify: `DESIGN_SYSTEM.md` (nouvelle sous-section après « Échelle qualitative (natures de risque — courbes du rayon d'influence) »)
- Modify: `angular/src/app/features/carte/data/carte.api.ts` (deux méthodes) + `carte.api.spec.ts`
- Create: `angular/src/app/features/carte/logique/campagnes-ooh.ts` + `campagnes-ooh.spec.ts`
- Create: `angular/src/app/features/carte/testing/campagnes-ooh.fixture.ts` (données d'essai : `ligneEssai`, `emplacementEssai`, `DETAIL_ESSAI`)
- Create: `angular/src/app/features/carte/couches/couche-campagne-ooh.ts` + `couche-campagne-ooh.spec.ts`
- Create: `angular/src/app/features/carte/couches/campagne-ooh.service.ts` + `campagne-ooh.service.spec.ts`
- Modify: `angular/src/app/carte/testing/carte-factice.ts` (images MapLibre)
- Modify: `angular/src/app/features/carte/logique/ordre-couches.ts:45-53` (`COUCHES_APRES_LOAD`) + `tests/unit/angular/carte-ordre-couches.test.ts:16-56`

**Interfaces:**
- Consumes: `GET /api/map/ooh/campagnes[/id]` (tâche 9) ; `CouleursService.palette`, `CouchesCarteService` (`carteCourante`, `inscrireEffacement`), `quandStyleCharge`, `avantDe`, `PoisService.panneauSelectionne`, `messageHttp`, `formaterNombre` (Angular).
- Produces:
  - Jetons `--ligne-media-1` … `--ligne-media-8` (deux thèmes, deux fichiers).
  - `CarteApi.campagnesOoh(): Observable<ReponseCampagnesOoh>`, `CarteApi.campagneOoh(id: string): Observable<DetailCampagneOoh>`.
  - `logique/campagnes-ooh.ts` : types `LigneOohResume`, `CampagneOohResume`, `ReponseCampagnesOoh`, `NonPlace`, `DetailsLigneOoh`, `LigneOoh`, `QualiteGeoloc`, `MethodeGeoloc`, `ProprietesEmplacementOoh`, `EmplacementOoh`, `DetailCampagneOoh`, `GroupeDonneesRegie` ; `JETONS_CAMPAGNE_OOH`, `NB_TEINTES_LIGNES = 8`, `LIBELLES_QUALITE`, `LIBELLES_METHODE` ; `rangsDesLignes(lignes): Map<string, number>`, `collectionCarte(detail, rangs, masquees): GeoJSON.FeatureCollection<GeoJSON.Point>`, `emprise(emplacements): [number, number, number, number] | null`, `libellePeriode(debut, fin): string`, `montantTtc(v): string`, `libelleEcart(l: LigneOoh): string | null`, `libelleNonPlaces(n: number): string`, `formaterScore(s: number | null): string`, `donneesRegie(metadata): GroupeDonneesRegie[]`.
  - `couches/couche-campagne-ooh.ts` : `SOURCE_CAMPAGNE_OOH = 'campagne-ooh-source'`, `COUCHE_CAMPAGNE_OOH_POINTS = 'campagne-ooh-points'`, `COUCHE_CAMPAGNE_OOH_A_VERIFIER = 'campagne-ooh-a-verifier'`, `IMAGE_ANNEAU_A_VERIFIER = 'campagne-ooh-anneau-pointille'`, `PeintureCampagneOoh { lignes: readonly string[]; contour: string }`, `expressionCouleurLigne(lignes)`, `couleurEnRgba(couleur: string): [number, number, number, number]`, `imageAnneauPointille(couleur: string, taille?: number): { width: number; height: number; data: Uint8Array }`, `poserCoucheCampagneOoh(carte, donnees, peinture): void`, `retirerCoucheCampagneOoh(carte): void`, `ecouterCampagneOoh(carte, surClic: (id: string) => void): () => void`.
  - `couches/campagne-ooh.service.ts` : `CampagneOohService` (`@Injectable()`, fourni par la page à la tâche 11) — signaux `campagnes`, `listeTronquee`, `chargementListe`, `erreurListe`, `detail`, `chargementDetail`, `erreurDetail`, `masquees`, `emplacementSelectionne`, `rangs` ; méthodes `lireCampagnes()`, `choisir(id)`, `basculerLigne(id)`, `selectionner(id)`, `fermer()`.

> **Écart à la spec (§ 6.3, « cerne pointillé »)** : un calque `circle` de MapLibre n'a pas de trait pointillé (`circle-stroke-*` n'a pas de `dasharray`). Les points `a_verifier` perdent leur cerne plein (`circle-stroke-width` 0) et reçoivent un ANNEAU POINTILLÉ dessiné par un calque `symbol` au-dessus, dont l'image est calculée pixel par pixel (`imageAnneauPointille`) dans la couleur de `--poi-contour` — aucun canevas, testable sans navigateur.

- [ ] **Step 1: Écrire les jetons et leur documentation**

`app/globals.css`, bloc `:root`, après `    --nature-8: #a06c8c;` :

```css

    /* Lignes d'une campagne multi-media sur la carte (points OOH, une teinte
       par ligne du plan — spec 2026-10-16-ooh-campagnes § 6). QUALITATIVE,
       comme --nature-* : les lignes d'un plan ne s'ordonnent pas. Alternance
       chaud/froid, aucune teinte des --nature-* ni des couleurs de statut, pas
       le teal de marque, aucun violet. Contraste mesure >= 5:1 sur #0a0a0a.
       MapLibre ne resout pas var() : CouleursService les lit et les passe en
       valeurs calculees. */
    --ligne-media-1: #e8a33d;
    --ligne-media-2: #4f9fe0;
    --ligne-media-3: #d9667f;
    --ligne-media-4: #5cc08a;
    --ligne-media-5: #e0d05a;
    --ligne-media-6: #5d7fc4;
    --ligne-media-7: #e58a6b;
    --ligne-media-8: #8bb84a;
```

`app/globals.css`, bloc `html.light`, après `    --nature-8: #7e4e6c;` :

```css

    /* Lignes de campagne (light) — voir le bloc :root. Assombries pour tenir
       sur fond clair : contraste mesure >= 3,4:1 sur #f5f5f5 (objets
       graphiques, WCAG 1.4.11). */
    --ligne-media-1: #b9770f;
    --ligne-media-2: #2a73b8;
    --ligne-media-3: #b23a57;
    --ligne-media-4: #23874f;
    --ligne-media-5: #8c7d10;
    --ligne-media-6: #3a5aa0;
    --ligne-media-7: #b8532f;
    --ligne-media-8: #5c7f1f;
```

`angular/src/styles/jetons.css` : les MÊMES deux blocs (indentation de deux espaces, `--ligne-media-*` aux mêmes valeurs), le premier après `  --nature-8: #a06c8c;` du bloc `:root, :host`, le second après `  --nature-8: #7e4e6c;` du bloc `html.light, :host(.light)`.

`DESIGN_SYSTEM.md`, juste avant `### Niveau réglementaire d'un site à risque` :

```markdown
### Échelle qualitative (lignes d'une campagne — points OOH sur la carte)

Qualitative, comme les natures de risque : les lignes d'un plan (Mediatransports, Basic-Fit, Stride…) ne
s'ordonnent pas. Une teinte par ligne qui a des emplacements, dans l'ordre du plan ; au-delà de huit lignes, les
teintes reviennent. Les points ont un cerne `--poi-contour` ; un point **à vérifier** perd son cerne plein et porte un
anneau pointillé de la même couleur (calque `symbol`, image calculée).

| Token | Hex (dark) | Hex (light) |
|-------|-----------|-------------|
| --ligne-media-1 | #e8a33d | #b9770f |
| --ligne-media-2 | #4f9fe0 | #2a73b8 |
| --ligne-media-3 | #d9667f | #b23a57 |
| --ligne-media-4 | #5cc08a | #23874f |
| --ligne-media-5 | #e0d05a | #8c7d10 |
| --ligne-media-6 | #5d7fc4 | #3a5aa0 |
| --ligne-media-7 | #e58a6b | #b8532f |
| --ligne-media-8 | #8bb84a | #5c7f1f |

Alternance chaud/froid ; aucune des huit `--nature-*`, aucune couleur de statut, pas le teal de marque, pas de violet.
Contraste mesuré le 16/10 : ≥ 5:1 sur `#0a0a0a` en sombre, ≥ 3,4:1 sur `#f5f5f5` en clair (objets graphiques, WCAG
1.4.11). ⚠ Valeurs CALCULÉES pour MapLibre (`CouleursService`), jamais `var()` dans `paint` ; la pastille de ligne de
l'overlay, elle, est en CSS et emploie `var(--ligne-media-n)`. Choix visuel neuf, à valider par un designer.
```

Run: `npx vitest run --project unit tests/unit/design/jetons-css.test.ts tests/unit/angular/jetons-paritaires.test.ts`
Expected: PASS.

- [ ] **Step 2: Écrire les tests de la logique, de la couche et de l'API**

`angular/src/app/features/carte/testing/campagnes-ooh.fixture.ts` (données d'essai partagées par les specs de la logique, du service, de la section et de la fiche — patron de `features/risques/testing/*.fixture.ts` ; un spec n'importe jamais un autre spec, ses `describe` s'y rejoueraient) :

```ts
import type { DetailCampagneOoh, LigneOoh, ProprietesEmplacementOoh } from '../logique/campagnes-ooh';

export function ligneEssai(id: string, ordre: number, partiel: Partial<LigneOoh> = {}): LigneOoh {
  return {
    id, ordre, media: 'ooh', regie: 'REGIE', reseau: 'DOOH essai', territoire: null, nb_ecrans: 10, format: 'DOOH', nb_diffusions: 100,
    date_debut: '2026-09-20', date_fin: '2026-10-03', duree_libelle: '2 semaines', rang_option: '2nd OPTION', plage_horaire: null,
    montant_brut: 10, montant_net: 5, frais: 1, honoraires: 1, total_ttc: 8, contacts_15_plus: 1000, contacts_18_24: 200,
    details: {}, a_des_emplacements: true, nb_places: 2, nb_a_verifier: 1, nb_non_places: 0, ...partiel,
  };
}

export const DETAIL_ESSAI: DetailCampagneOoh = {
  campagne: { id: 'c1', nom: 'Campagne essai', annonceur: 'Annonceur', vague: 'V1', date_debut: '2026-09-20', date_fin: '2026-10-02', budget_total_ttc: 100, metadata: {} },
  lignes: [ligneEssai('l1', 1), ligneEssai('l2', 2, { regie: 'OUTREMER', reseau: null, territoire: 'LA REUNION', a_des_emplacements: false, nb_places: 0, nb_a_verifier: 0 })],
  emplacements: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [2.1, 48.1] }, properties: emplacementEssai('p1', 'l1', 'sure') },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [2.3, 48.3] }, properties: emplacementEssai('p2', 'l1', 'a_verifier') },
  ],
  tronque: false,
};

export function emplacementEssai(id: string, ligne: string, qualite: 'sure' | 'a_verifier'): ProprietesEmplacementOoh {
  return {
    id, ligne_id: ligne, nom_lieu: `Lieu ${id}`, adresse: '1 Rue Essai', ville: 'Villetest', code_postal: '45000', code_insee: '45234',
    regie: 'REGIE', reseau: 'DOOH essai', type_lieu: 'campus', type_panneau: 'DOOH essai', numerique: true, nb_ecrans: 2, formats: ['10"'],
    contacts_semaine: 6000, contacts_18_25_semaine: 5700, geoloc_methode: 'adresse_ban' as const, geoloc_qualite: qualite,
    geoloc_score: qualite === 'sure' ? 0.91 : 0.45, geoloc_libelle: '1 Rue Essai 45000 Villetest', reference_panneau: null,
    metadata: { onglet: 'LISTING CAMPUS', groupement: 'Groupe', lignes: [{ numero: 3, cellules: { Etablissement: `Lieu ${id}`, CP: '45000', Vide: null } }] },
  };
}
```

`angular/src/app/features/carte/logique/campagnes-ooh.spec.ts` :

```ts
import { formaterNombre } from '../../../core/format/nombre';
import { DETAIL_ESSAI, ligneEssai } from '../testing/campagnes-ooh.fixture';
import {
  collectionCarte, donneesRegie, emprise, formaterScore, libelleEcart, libelleNonPlaces, libellePeriode, montantTtc, rangsDesLignes,
} from './campagnes-ooh';

describe('campagnes OOH — logique pure', () => {
  it('rangsDesLignes : une teinte par ligne qui a des emplacements, dans l ordre, huit au plus puis on recommence', () => {
    const lignes = Array.from({ length: 9 }, (_, i) => ligneEssai(`l${i + 1}`, i + 1));
    lignes.push(ligneEssai('drom', 10, { a_des_emplacements: false }));
    const rangs = rangsDesLignes(lignes);
    expect([...rangs.values()]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 1]);
    expect(rangs.has('drom')).toBe(false);
  });

  it('collectionCarte : propriétés minimales, lignes masquées retirées', () => {
    const rangs = rangsDesLignes(DETAIL_ESSAI.lignes);
    const toutes = collectionCarte(DETAIL_ESSAI, rangs, new Set());
    expect(toutes.features.map((f) => f.properties)).toEqual([
      { id: 'p1', ligne: 'l1', rang: 1, qualite: 'sure' },
      { id: 'p2', ligne: 'l1', rang: 1, qualite: 'a_verifier' },
    ]);
    expect(collectionCarte(DETAIL_ESSAI, rangs, new Set(['l1'])).features).toEqual([]);
  });

  it('emprise des emplacements, null sans emplacement', () => {
    expect(emprise(DETAIL_ESSAI.emplacements)).toEqual([2.1, 48.1, 2.3, 48.3]);
    expect(emprise([])).toBeNull();
  });

  it('période, montant, score', () => {
    expect(libellePeriode('2026-09-20', '2026-10-02')).toBe('20/09/2026 → 02/10/2026');
    expect(libellePeriode(null, null)).toBe('—');
    expect(montantTtc(48480)).toBe(`${formaterNombre(48480)} € TTC`);
    expect(montantTtc(null)).toBe('—');
    expect(formaterScore(0.456)).toBe('0,46');
    expect(formaterScore(null)).toBe('—');
  });

  it('écart entre la liste et le plan : affiché seulement s il existe, accordé', () => {
    const clubs = ligneEssai('b', 1, { nb_places: 882, nb_ecrans: 4802, details: { nb_lieux_plan: 905, unite_lieux_plan: 'clubs' } });
    expect(libelleEcart(clubs)).toBe(`${formaterNombre(882)} clubs placés · plan : ${formaterNombre(905)} clubs, ${formaterNombre(4802)} écrans`);
    const gares = ligneEssai('g', 1, { nb_places: 213, nb_ecrans: 490, details: { nb_lieux_plan: 215, unite_lieux_plan: 'gares' } });
    expect(libelleEcart(gares)).toBe(`${formaterNombre(213)} gares placées · plan : ${formaterNombre(215)} gares, ${formaterNombre(490)} écrans`);
    expect(libelleEcart(ligneEssai('x', 1, { nb_places: 215, details: { nb_lieux_plan: 215, unite_lieux_plan: 'gares' } }))).toBeNull();
    expect(libelleEcart(ligneEssai('y', 1))).toBeNull();
  });

  it('non placés : singulier et pluriel', () => {
    expect(libelleNonPlaces(1)).toBe('1 emplacement non placé');
    expect(libelleNonPlaces(3)).toBe('3 emplacements non placés');
  });

  it('données de la régie : une ligne d origine par groupe, cellules vides omises, puis ce que l import a lu', () => {
    expect(donneesRegie(DETAIL_ESSAI.emplacements[0].properties.metadata)).toEqual([
      { titre: 'LISTING CAMPUS, ligne 3', cellules: [['Etablissement', 'Lieu p1'], ['CP', '45000']] },
      { titre: 'Lu par l’import', cellules: [['groupement', 'Groupe']] },
    ]);
    expect(donneesRegie(null)).toEqual([]);
  });
});
```

`angular/src/app/features/carte/couches/couche-campagne-ooh.spec.ts` :

```ts
import type maplibregl from 'maplibre-gl';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import {
  COUCHE_CAMPAGNE_OOH_A_VERIFIER, COUCHE_CAMPAGNE_OOH_POINTS, IMAGE_ANNEAU_A_VERIFIER, SOURCE_CAMPAGNE_OOH, couleurEnRgba,
  ecouterCampagneOoh, expressionCouleurLigne, imageAnneauPointille, poserCoucheCampagneOoh, retirerCoucheCampagneOoh,
} from './couche-campagne-ooh';

const TEINTES = ['#e8a33d', '#4f9fe0', '#d9667f', '#5cc08a', '#e0d05a', '#5d7fc4', '#e58a6b', '#8bb84a'];
const PEINTURE = { lignes: TEINTES, contour: '#ffffff' };
const donnees = (n: number): GeoJSON.FeatureCollection<GeoJSON.Point> => ({
  type: 'FeatureCollection',
  features: Array.from({ length: n }, (_, i) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [2 + i, 48] },
    properties: { id: `p${i}`, ligne: 'l1', rang: 1, qualite: i === 0 ? 'a_verifier' : 'sure' },
  })),
});

function carte(): { factice: CarteFactice; carte: maplibregl.Map } {
  const factice = new CarteFactice();
  factice.styleCharge = true;
  return { factice, carte: factice as unknown as maplibregl.Map };
}

describe('couche d une campagne OOH (pure)', () => {
  it('pose une source, l image de l anneau et deux couches : cercles colorés par ligne, anneau des points à vérifier', () => {
    const { factice, carte: c } = carte();
    poserCoucheCampagneOoh(c, donnees(2), PEINTURE);
    expect((factice.sources.get(SOURCE_CAMPAGNE_OOH)!.spec as { data: GeoJSON.FeatureCollection }).data.features).toHaveLength(2);
    expect(factice.images.has(IMAGE_ANNEAU_A_VERIFIER)).toBe(true);
    const points = factice.getLayer(COUCHE_CAMPAGNE_OOH_POINTS)!;
    expect(points['type']).toBe('circle');
    expect(points['paint']).toEqual({
      'circle-color': expressionCouleurLigne(TEINTES), 'circle-radius': 6, 'circle-opacity': 0.92,
      'circle-stroke-color': '#ffffff', 'circle-stroke-width': ['case', ['==', ['get', 'qualite'], 'a_verifier'], 0, 1.5],
    });
    const anneau = factice.getLayer(COUCHE_CAMPAGNE_OOH_A_VERIFIER)!;
    expect(anneau['type']).toBe('symbol');
    expect(anneau['filter']).toEqual(['==', ['get', 'qualite'], 'a_verifier']);
    expect((anneau['layout'] as Record<string, unknown>)['icon-image']).toBe(IMAGE_ANNEAU_A_VERIFIER);
  });

  it('l expression de couleur suit le rang de la ligne, huit teintes, la première par défaut', () => {
    expect(expressionCouleurLigne(TEINTES)).toEqual(['match', ['get', 'rang'], 1, TEINTES[0], 2, TEINTES[1], 3, TEINTES[2], 4, TEINTES[3], 5, TEINTES[4], 6, TEINTES[5], 7, TEINTES[6], 8, TEINTES[7], TEINTES[0]]);
  });

  it('reposer : setData et repeinture, jamais une couche en double', () => {
    const { factice, carte: c } = carte();
    poserCoucheCampagneOoh(c, donnees(2), PEINTURE);
    poserCoucheCampagneOoh(c, donnees(1), { lignes: ['#b9770f', ...TEINTES.slice(1)], contour: '#ffffff' });
    expect(factice.couches).toHaveLength(2);
    expect(factice.sources.get(SOURCE_CAMPAGNE_OOH)!.donnees).toEqual([donnees(1)]);
    expect(factice.peintures).toContainEqual({ couche: COUCHE_CAMPAGNE_OOH_POINTS, propriete: 'circle-color', valeur: expressionCouleurLigne(['#b9770f', ...TEINTES.slice(1)]) });
  });

  it('au-dessus des zones enregistrées, sous l aperçu du rayon (ordre des couches)', () => {
    const { factice, carte: c } = carte();
    factice.addLayer({ id: 'custom-zone-fill-z1', type: 'fill', source: 'x' });
    factice.addLayer({ id: 'apercu-rayon-fill', type: 'fill', source: 'y' });
    poserCoucheCampagneOoh(c, donnees(1), PEINTURE);
    expect(factice.ordreRendu()).toEqual(['custom-zone-fill-z1', COUCHE_CAMPAGNE_OOH_POINTS, COUCHE_CAMPAGNE_OOH_A_VERIFIER, 'apercu-rayon-fill']);
  });

  it('retirer : les deux couches, puis la source, puis l image', () => {
    const { factice, carte: c } = carte();
    poserCoucheCampagneOoh(c, donnees(1), PEINTURE);
    retirerCoucheCampagneOoh(c);
    expect(factice.retraits).toEqual([
      `couche:${COUCHE_CAMPAGNE_OOH_A_VERIFIER}`, `couche:${COUCHE_CAMPAGNE_OOH_POINTS}`, `source:${SOURCE_CAMPAGNE_OOH}`, `image:${IMAGE_ANNEAU_A_VERIFIER}`,
    ]);
    retirerCoucheCampagneOoh(c);
    expect(factice.retraits).toHaveLength(4);
  });

  it('l anneau pointillé : transparent au centre, des tirets ET des trous sur le cercle, dans la couleur donnée', () => {
    const img = imageAnneauPointille('#ffffff');
    expect(img.width).toBe(22);
    expect(img.data).toHaveLength(22 * 22 * 4);
    const alpha = (x: number, y: number) => img.data[(y * 22 + x) * 4 + 3];
    expect(alpha(11, 11)).toBe(0);
    let pleins = 0;
    let trous = 0;
    for (let a = 0; a < 360; a += 5) {
      const x = Math.floor(11 + 9 * Math.cos((a * Math.PI) / 180));
      const y = Math.floor(11 + 9 * Math.sin((a * Math.PI) / 180));
      if (alpha(x, y) > 0) pleins++;
      else trous++;
    }
    expect(pleins).toBeGreaterThan(10);
    expect(trous).toBeGreaterThan(10);
    const i = img.data.findIndex((_, k) => k % 4 === 3 && img.data[k] > 0);
    expect([...img.data.slice(i - 3, i + 1)]).toEqual([255, 255, 255, 255]);
  });

  it('couleurEnRgba : hexadécimal court ou long, rgb(), rgba() ; une couleur illisible lève', () => {
    expect(couleurEnRgba('#fff')).toEqual([255, 255, 255, 1]);
    expect(couleurEnRgba('#4ecdc4')).toEqual([78, 205, 196, 1]);
    expect(couleurEnRgba('rgba(26, 26, 26, 0.85)')).toEqual([26, 26, 26, 0.85]);
    expect(couleurEnRgba('rgb(1,2,3)')).toEqual([1, 2, 3, 1]);
    expect(() => couleurEnRgba('teal')).toThrow('Couleur illisible');
  });

  it('écoute : un clic sur un point rend son identifiant ; le survol change le curseur ; tout se retire', () => {
    const { factice, carte: c } = carte();
    const clics: string[] = [];
    const retirer = ecouterCampagneOoh(c, (id) => clics.push(id));
    factice.emettreSurCouche('click', COUCHE_CAMPAGNE_OOH_POINTS, { features: [{ properties: { id: 'p3' } }] });
    factice.emettreSurCouche('mouseenter', COUCHE_CAMPAGNE_OOH_POINTS, {});
    expect(clics).toEqual(['p3']);
    expect(factice.getCanvas().style.cursor).toBe('pointer');
    factice.emettreSurCouche('mouseleave', COUCHE_CAMPAGNE_OOH_POINTS, {});
    expect(factice.getCanvas().style.cursor).toBe('');
    retirer();
    factice.emettreSurCouche('click', COUCHE_CAMPAGNE_OOH_POINTS, { features: [{ properties: { id: 'p4' } }] });
    expect(clics).toEqual(['p3']);
  });
});
```

Dans `angular/src/app/features/carte/data/carte.api.spec.ts`, ajouter dans le `describe('CarteApi', …)` :

```ts
  it('campagnes OOH : GET /api/map/ooh/campagnes, puis une campagne par son identifiant encodé', () => {
    const { api, http } = preparer();
    let liste: unknown;
    api.campagnesOoh().subscribe((r) => (liste = r));
    http.expectOne((r) => r.method === 'GET' && r.url === '/api/map/ooh/campagnes').flush({ campagnes: [], tronque: false });
    expect(liste).toEqual({ campagnes: [], tronque: false });
    api.campagneOoh('a/b').subscribe();
    http.expectOne('/api/map/ooh/campagnes/a%2Fb').flush(null);
    http.verify();
  });
```

- [ ] **Step 3: Les lancer, ils échouent**

Run: `cd angular && npx ng test --watch=false --include='src/app/features/carte/logique/campagnes-ooh.spec.ts' --include='src/app/features/carte/couches/couche-campagne-ooh.spec.ts' --include='src/app/features/carte/data/carte.api.spec.ts'`
Expected: FAIL — `campagnes-ooh` et `couche-campagne-ooh` introuvables, `api.campagnesOoh is not a function`.

- [ ] **Step 4: Écrire la logique pure**

`angular/src/app/features/carte/logique/campagnes-ooh.ts` :

```ts
/**
 * Les campagnes OOH d'un espace sur la carte (spec 2026-10-16-ooh-campagnes § 6) : les formes rendues par
 * `GET /api/map/ooh/campagnes` et `GET /api/map/ooh/campagnes/:id` (RPC jsonb de sql/263), et la logique PURE de
 * l'overlay « Autres » → « Panneaux OOH et DOOH » et de sa couche. Préfixées OOH : « campagne » désigne déjà
 * `dsp_campaigns` et `CampagnePlan` (rattachement d'un plan média de zones).
 */
import { formaterNombre } from '../../../core/format/nombre';

/** Une ligne OOH dans la liste des campagnes. */
export interface LigneOohResume {
  id: string;
  ordre: number;
  media: string;
  regie: string | null;
  reseau: string | null;
  territoire: string | null;
  nb_ecrans: number | null;
  nb_places: number;
  nb_non_places: number;
}

/** Une campagne de l'espace ayant au moins une ligne OOH. */
export interface CampagneOohResume {
  id: string;
  nom: string;
  annonceur: string | null;
  vague: string | null;
  date_debut: string | null;
  date_fin: string | null;
  lignes: LigneOohResume[];
}

export interface ReponseCampagnesOoh {
  campagnes: CampagneOohResume[];
  tronque: boolean;
}

/** Un emplacement de la liste de la régie que l'import n'a pas pu placer. */
export interface NonPlace {
  nom: string;
  raison: string;
}

/** `campagne_lignes.details` : la ligne d'origine du plan, et ce que l'import y a ajouté. */
export interface DetailsLigneOoh {
  nb_lieux_plan?: number;
  unite_lieux_plan?: string;
  non_places?: NonPlace[];
  [cle: string]: unknown;
}

/** Une ligne OOH d'une campagne, dans l'ordre du plan. */
export interface LigneOoh {
  id: string;
  ordre: number;
  media: string;
  regie: string | null;
  reseau: string | null;
  territoire: string | null;
  nb_ecrans: number | null;
  format: string | null;
  nb_diffusions: number | null;
  date_debut: string | null;
  date_fin: string | null;
  duree_libelle: string | null;
  rang_option: string | null;
  plage_horaire: string | null;
  montant_brut: number | null;
  montant_net: number | null;
  frais: number | null;
  honoraires: number | null;
  total_ttc: number | null;
  contacts_15_plus: number | null;
  contacts_18_24: number | null;
  details: DetailsLigneOoh;
  /** Faux : la régie n'a fourni aucune liste (les DROM de TF4). */
  a_des_emplacements: boolean;
  nb_places: number;
  nb_a_verifier: number;
  nb_non_places: number;
}

export type QualiteGeoloc = 'sure' | 'a_verifier';
export type MethodeGeoloc = 'referentiel_gares' | 'adresse_ban' | 'alias_manuel' | 'coordonnees_fournies';

/** Tout ce que la table des panneaux dit d'un emplacement (sql/262), et la ligne qui le réserve. */
export interface ProprietesEmplacementOoh {
  id: string;
  ligne_id: string;
  nom_lieu: string | null;
  adresse: string | null;
  ville: string | null;
  code_postal: string | null;
  code_insee: string | null;
  regie: string | null;
  reseau: string | null;
  type_lieu: string | null;
  type_panneau: string | null;
  numerique: boolean | null;
  nb_ecrans: number | null;
  formats: string[] | null;
  contacts_semaine: number | null;
  contacts_18_25_semaine: number | null;
  geoloc_methode: MethodeGeoloc | null;
  geoloc_qualite: QualiteGeoloc | null;
  geoloc_score: number | null;
  geoloc_libelle: string | null;
  reference_panneau: string | null;
  metadata: Record<string, unknown> | null;
}

export interface EmplacementOoh {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: ProprietesEmplacementOoh;
}

export interface DetailCampagneOoh {
  campagne: {
    id: string;
    nom: string;
    annonceur: string | null;
    vague: string | null;
    date_debut: string | null;
    date_fin: string | null;
    budget_total_ttc: number | null;
    metadata: Record<string, unknown>;
  };
  lignes: LigneOoh[];
  emplacements: EmplacementOoh[];
  tronque: boolean;
}

/** Les jetons lus par `CouleursService` : les huit teintes de ligne (DESIGN_SYSTEM) et le cerne des points. */
export const JETONS_CAMPAGNE_OOH = {
  l1: 'ligne-media-1', l2: 'ligne-media-2', l3: 'ligne-media-3', l4: 'ligne-media-4',
  l5: 'ligne-media-5', l6: 'ligne-media-6', l7: 'ligne-media-7', l8: 'ligne-media-8',
  contour: 'poi-contour',
} as const;

export const NB_TEINTES_LIGNES = 8;

export const LIBELLES_QUALITE: Readonly<Record<QualiteGeoloc, string>> = { sure: 'Sûre', a_verifier: 'À vérifier' };

export const LIBELLES_METHODE: Readonly<Record<MethodeGeoloc, string>> = {
  referentiel_gares: 'Référentiel des gares SNCF',
  adresse_ban: 'Adresse (BAN)',
  alias_manuel: 'Alias vérifié par le code INSEE',
  coordonnees_fournies: 'Coordonnées fournies',
};

/** Le rang de teinte (1 à 8) de chaque ligne qui a des emplacements, dans l'ordre du plan ; au-delà de huit, on recommence. */
export function rangsDesLignes(lignes: readonly LigneOoh[]): Map<string, number> {
  const rangs = new Map<string, number>();
  [...lignes].filter((l) => l.a_des_emplacements).sort((a, b) => a.ordre - b.ordre)
    .forEach((l, i) => rangs.set(l.id, (i % NB_TEINTES_LIGNES) + 1));
  return rangs;
}

/** La collection posée sur la carte : propriétés minimales (id, ligne, rang, qualité), lignes masquées retirées. */
export function collectionCarte(
  detail: DetailCampagneOoh, rangs: ReadonlyMap<string, number>, masquees: ReadonlySet<string>,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: detail.emplacements
      .filter((e) => !masquees.has(e.properties.ligne_id))
      .map((e) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: e.geometry.coordinates },
        properties: { id: e.properties.id, ligne: e.properties.ligne_id, rang: rangs.get(e.properties.ligne_id) ?? 1, qualite: e.properties.geoloc_qualite ?? 'sure' },
      })),
  };
}

/** L'emprise `[ouest, sud, est, nord]` des emplacements ; `null` s'il n'y en a aucun. */
export function emprise(emplacements: readonly EmplacementOoh[]): [number, number, number, number] | null {
  if (emplacements.length === 0) return null;
  const lng = emplacements.map((e) => e.geometry.coordinates[0]);
  const lat = emplacements.map((e) => e.geometry.coordinates[1]);
  return [Math.min(...lng), Math.min(...lat), Math.max(...lng), Math.max(...lat)];
}

function dateFr(iso: string | null): string {
  if (!iso) return '—';
  const [a, m, j] = iso.slice(0, 10).split('-');
  return `${j}/${m}/${a}`;
}

/** « 20/09/2026 → 02/10/2026 » ; « — » sans aucune date. */
export function libellePeriode(debut: string | null, fin: string | null): string {
  if (!debut && !fin) return '—';
  return `${dateFr(debut)} → ${dateFr(fin)}`;
}

/** « 48 480 € TTC », arrondi à l'euro ; « — » sans montant. */
export function montantTtc(v: number | null): string {
  return v === null ? '—' : `${formaterNombre(Math.round(v))} € TTC`;
}

/**
 * L'écart entre la liste de la régie et le plan, quand il existe : « 882 clubs placés · plan : 905 clubs, 4 802 écrans »
 * (décision 7 de la spec : on affiche les deux chiffres, sans en inventer un troisième). `null` sans écart.
 */
export function libelleEcart(l: LigneOoh): string | null {
  const plan = l.details.nb_lieux_plan;
  if (typeof plan !== 'number' || plan === l.nb_places) return null;
  const unite = l.details.unite_lieux_plan ?? 'emplacements';
  const places = unite === 'gares' ? 'placées' : 'placés';
  return `${formaterNombre(l.nb_places)} ${unite} ${places} · plan : ${formaterNombre(plan)} ${unite}, ${formaterNombre(l.nb_ecrans)} écrans`;
}

export function libelleNonPlaces(n: number): string {
  return n === 1 ? '1 emplacement non placé' : `${formaterNombre(n)} emplacements non placés`;
}

/** Score de géolocalisation à deux décimales, virgule française ; « — » sans score. */
export function formaterScore(s: number | null): string {
  return s === null ? '—' : s.toFixed(2).replace('.', ',');
}

/** Un bloc de la fiche « Données de la régie ». */
export interface GroupeDonneesRegie {
  titre: string;
  cellules: [string, string][];
}

/**
 * `metadata` d'un panneau en blocs lisibles : une ligne d'origine par bloc (« LISTING CAMPUS, ligne 3 », toutes ses
 * cellules non vides), puis ce que l'import en a tiré (groupement, bloc, écrans par format…).
 */
export function donneesRegie(metadata: Record<string, unknown> | null): GroupeDonneesRegie[] {
  if (!metadata) return [];
  const onglet = typeof metadata['onglet'] === 'string' ? metadata['onglet'] : 'Liste de la régie';
  const groupes: GroupeDonneesRegie[] = [];
  const lignes = Array.isArray(metadata['lignes']) ? metadata['lignes'] : [];
  for (const l of lignes) {
    if (!l || typeof l !== 'object') continue;
    const ligne = l as { numero?: unknown; cellules?: unknown };
    const cellules = ligne.cellules && typeof ligne.cellules === 'object'
      ? Object.entries(ligne.cellules as Record<string, unknown>)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]): [string, string] => [k, String(v)])
      : [];
    groupes.push({ titre: `${onglet}, ligne ${String(ligne.numero ?? '?')}`, cellules });
  }
  const autres = Object.entries(metadata)
    .filter(([k, v]) => k !== 'onglet' && k !== 'lignes' && v !== null && v !== undefined && v !== '')
    .map(([k, v]): [string, string] => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
  if (autres.length > 0) groupes.push({ titre: 'Lu par l’import', cellules: autres });
  return groupes;
}
```

- [ ] **Step 5: Écrire la couche et compléter la carte factice**

`angular/src/app/carte/testing/carte-factice.ts`, après `remove(): void { this.retiree = true; }` :

```ts
  /** Les images posées par `addImage` (l'anneau pointillé des emplacements à vérifier). */
  readonly images = new Map<string, unknown>();
  hasImage(id: string): boolean { return this.images.has(id); }
  addImage(id: string, image: unknown): this { this.images.set(id, image); return this; }
  removeImage(id: string): this { this.images.delete(id); this.retraits.push(`image:${id}`); return this; }
```

`angular/src/app/features/carte/couches/couche-campagne-ooh.ts` :

```ts
/**
 * Rendu MapLibre PUR des emplacements d'une campagne OOH (spec 2026-10-16-ooh-campagnes § 6.3) : une source GeoJSON,
 * un calque de cercles coloré PAR LIGNE (`--ligne-media-*`, valeurs calculées), cerne `--poi-contour`, et un calque
 * `symbol` qui pose un ANNEAU POINTILLÉ sur les points à vérifier — un cercle MapLibre n'a pas de trait pointillé.
 * Couche DÉDIÉE (pas la zone partagée de `PoisService`), patron de `couche-zones-custom.ts`. Pose idempotente : une
 * source déjà là reçoit ses données (`setData`), une couche déjà là sa peinture (changement de thème).
 */
import type maplibregl from 'maplibre-gl';
import { avantDe } from '../logique/ordre-couches';

export const SOURCE_CAMPAGNE_OOH = 'campagne-ooh-source';
export const COUCHE_CAMPAGNE_OOH_POINTS = 'campagne-ooh-points';
export const COUCHE_CAMPAGNE_OOH_A_VERIFIER = 'campagne-ooh-a-verifier';
export const IMAGE_ANNEAU_A_VERIFIER = 'campagne-ooh-anneau-pointille';

/** Côté de l'image de l'anneau, en pixels : un cercle de 6 px de rayon et son anneau à 9 px. */
const TAILLE_ANNEAU = 22;
const SEGMENTS_ANNEAU = 16;

type CarteCampagne = Pick<maplibregl.Map,
  'addSource' | 'getSource' | 'addLayer' | 'getLayer' | 'removeLayer' | 'removeSource' | 'setPaintProperty' | 'getStyle'
  | 'hasImage' | 'addImage' | 'removeImage'>;
type CarteEcoute = Pick<maplibregl.Map, 'on' | 'off' | 'getCanvas'>;

/** Les couleurs CALCULÉES : huit teintes de ligne, dans l'ordre des rangs, et le cerne. */
export interface PeintureCampagneOoh {
  lignes: readonly string[];
  contour: string;
}

/** `['match', ['get', 'rang'], 1, c1, …, 8, c8, c1]`. */
export function expressionCouleurLigne(lignes: readonly string[]): maplibregl.ExpressionSpecification {
  return ['match', ['get', 'rang'], ...lignes.flatMap((c, i) => [i + 1, c]), lignes[0]] as unknown as maplibregl.ExpressionSpecification;
}

/** Une couleur CSS calculée (`#rgb`, `#rrggbb`, `rgb()`, `rgba()`) en `[r, g, b, a]` ; lève sur tout autre forme. */
export function couleurEnRgba(couleur: string): [number, number, number, number] {
  const t = couleur.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(t);
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3]), fn[4] === undefined ? 1 : Number(fn[4])];
  throw new Error(`Couleur illisible pour l'anneau pointillé : ${couleur}`);
}

/** L'image d'un anneau pointillé (16 segments, un sur deux plein), pixel par pixel : aucun canevas. */
export function imageAnneauPointille(couleur: string, taille = TAILLE_ANNEAU): { width: number; height: number; data: Uint8Array } {
  const [r, g, b, a] = couleurEnRgba(couleur);
  const data = new Uint8Array(taille * taille * 4);
  const centre = taille / 2;
  const rayon = centre - 2;
  for (let y = 0; y < taille; y++) {
    for (let x = 0; x < taille; x++) {
      const dx = x + 0.5 - centre;
      const dy = y + 0.5 - centre;
      if (Math.abs(Math.hypot(dx, dy) - rayon) > 1) continue;
      const angle = Math.atan2(dy, dx) + Math.PI;
      if (Math.floor((angle / (2 * Math.PI)) * SEGMENTS_ANNEAU) % 2 === 1) continue;
      const i = (y * taille + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = Math.round(a * 255);
    }
  }
  return { width: taille, height: taille, data };
}

/** Pose (ou met à jour) la source, l'image et les deux couches. */
export function poserCoucheCampagneOoh(carte: CarteCampagne, donnees: GeoJSON.FeatureCollection<GeoJSON.Point>, peinture: PeintureCampagneOoh): void {
  const source = carte.getSource(SOURCE_CAMPAGNE_OOH) as maplibregl.GeoJSONSource | undefined;
  if (source) source.setData(donnees);
  else carte.addSource(SOURCE_CAMPAGNE_OOH, { type: 'geojson', data: donnees });
  if (!carte.hasImage(IMAGE_ANNEAU_A_VERIFIER)) carte.addImage(IMAGE_ANNEAU_A_VERIFIER, imageAnneauPointille(peinture.contour));

  const couleur = expressionCouleurLigne(peinture.lignes);
  if (!carte.getLayer(COUCHE_CAMPAGNE_OOH_POINTS)) {
    carte.addLayer({
      id: COUCHE_CAMPAGNE_OOH_POINTS, type: 'circle', source: SOURCE_CAMPAGNE_OOH,
      paint: {
        'circle-color': couleur,
        'circle-radius': 6,
        'circle-opacity': 0.92,
        'circle-stroke-color': peinture.contour,
        'circle-stroke-width': ['case', ['==', ['get', 'qualite'], 'a_verifier'], 0, 1.5],
      },
    } as maplibregl.LayerSpecification, avantDe(carte, COUCHE_CAMPAGNE_OOH_POINTS));
  } else {
    carte.setPaintProperty(COUCHE_CAMPAGNE_OOH_POINTS, 'circle-color', couleur);
    carte.setPaintProperty(COUCHE_CAMPAGNE_OOH_POINTS, 'circle-stroke-color', peinture.contour);
  }
  if (!carte.getLayer(COUCHE_CAMPAGNE_OOH_A_VERIFIER)) {
    carte.addLayer({
      id: COUCHE_CAMPAGNE_OOH_A_VERIFIER, type: 'symbol', source: SOURCE_CAMPAGNE_OOH,
      filter: ['==', ['get', 'qualite'], 'a_verifier'],
      layout: { 'icon-image': IMAGE_ANNEAU_A_VERIFIER, 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    } as maplibregl.LayerSpecification, avantDe(carte, COUCHE_CAMPAGNE_OOH_A_VERIFIER));
  }
}

/** Retire les couches PUIS la source (MapLibre lève si une couche l'emploie encore), puis l'image. */
export function retirerCoucheCampagneOoh(carte: CarteCampagne): void {
  if (carte.getLayer(COUCHE_CAMPAGNE_OOH_A_VERIFIER)) carte.removeLayer(COUCHE_CAMPAGNE_OOH_A_VERIFIER);
  if (carte.getLayer(COUCHE_CAMPAGNE_OOH_POINTS)) carte.removeLayer(COUCHE_CAMPAGNE_OOH_POINTS);
  if (carte.getSource(SOURCE_CAMPAGNE_OOH)) carte.removeSource(SOURCE_CAMPAGNE_OOH);
  if (carte.hasImage(IMAGE_ANNEAU_A_VERIFIER)) carte.removeImage(IMAGE_ANNEAU_A_VERIFIER);
}

/** Clic (identifiant du point) et curseur sur les cercles ; rend la fonction qui retire les écoutes. */
export function ecouterCampagneOoh(carte: CarteEcoute, surClic: (id: string) => void): () => void {
  const clic = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
    const id = e.features?.[0]?.properties?.['id'];
    if (typeof id === 'string') surClic(id);
  };
  const entrer = () => { carte.getCanvas().style.cursor = 'pointer'; };
  const sortir = () => { carte.getCanvas().style.cursor = ''; };
  carte.on('click', COUCHE_CAMPAGNE_OOH_POINTS, clic);
  carte.on('mouseenter', COUCHE_CAMPAGNE_OOH_POINTS, entrer);
  carte.on('mouseleave', COUCHE_CAMPAGNE_OOH_POINTS, sortir);
  return () => {
    carte.off('click', COUCHE_CAMPAGNE_OOH_POINTS, clic);
    carte.off('mouseenter', COUCHE_CAMPAGNE_OOH_POINTS, entrer);
    carte.off('mouseleave', COUCHE_CAMPAGNE_OOH_POINTS, sortir);
  };
}
```

`angular/src/app/features/carte/logique/ordre-couches.ts`, dans `COUCHES_APRES_LOAD`, la ligne `  'custom-zone-*',` devient :

```ts
  'custom-zone-*',
  // Emplacements d'une campagne OOH (spec 2026-10-16-ooh-campagnes § 6) : des POINTS, au-dessus des zones
  // enregistrées (un aplat à 25 % ne les cache pas), sous l'aperçu du rayon et le tracé libre. Sans équivalent React.
  'campagne-ooh-points', 'campagne-ooh-a-verifier',
```

`tests/unit/angular/carte-ordre-couches.test.ts` : dans `SOURCES_REACT`, après l'entrée `'custom-zone-*'`, ajouter

```ts
  'campagne-ooh-points': { ecart: 'sans équivalent React : emplacements d’une campagne OOH (spec 2026-10-16-ooh-campagnes)' },
  'campagne-ooh-a-verifier': { ecart: 'sans équivalent React : anneau pointillé des emplacements à vérifier' },
```

et dans `POSEURS_ANGULAR`, après `'angular/src/app/features/carte/couches/couche-zones-custom.ts',` : `  'angular/src/app/features/carte/couches/couche-campagne-ooh.ts',`.

`angular/src/app/features/carte/data/carte.api.ts` : ajouter à l'import de tête `import type { DetailCampagneOoh, ReponseCampagnesOoh } from '../logique/campagnes-ooh';` et, après la méthode `ooh(…)`, les deux méthodes :

```ts
  /** `GET /api/map/ooh/campagnes` — les campagnes OOH de l'espace actif (spec 2026-10-16-ooh-campagnes § 5). */
  campagnesOoh(): Observable<ReponseCampagnesOoh> {
    return this.httpClient.get<ReponseCampagnesOoh>(`${this.baseUrl}/map/ooh/campagnes`);
  }

  /** `GET /api/map/ooh/campagnes/:id` — une campagne de l'espace actif, ses lignes OOH et ses emplacements. */
  campagneOoh(id: string): Observable<DetailCampagneOoh> {
    return this.httpClient.get<DetailCampagneOoh>(`${this.baseUrl}/map/ooh/campagnes/${encodeURIComponent(id)}`);
  }
```

Run: `cd angular && npx ng test --watch=false --include='src/app/features/carte/logique/campagnes-ooh.spec.ts' --include='src/app/features/carte/couches/couche-campagne-ooh.spec.ts' --include='src/app/features/carte/data/carte.api.spec.ts'`
Expected: PASS.

Run: `npx vitest run --project unit tests/unit/angular/carte-ordre-couches.test.ts`
Expected: PASS.

- [ ] **Step 6: Écrire le test du service**

`angular/src/app/features/carte/couches/campagne-ooh.service.spec.ts` :

```ts
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { Subject, of, throwError } from 'rxjs';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { CarteApi } from '../data/carte.api';
import { CouchesCarteService } from '../etat/couches-carte.service';
import type { DetailCampagneOoh, ReponseCampagnesOoh } from '../logique/campagnes-ooh';
import { DETAIL_ESSAI } from '../testing/campagnes-ooh.fixture';
import { CampagneOohService } from './campagne-ooh.service';
import { COUCHE_CAMPAGNE_OOH_POINTS, SOURCE_CAMPAGNE_OOH, expressionCouleurLigne } from './couche-campagne-ooh';
import { PoisService } from './pois.service';

const TEINTES = {
  l1: '#e8a33d', l2: '#4f9fe0', l3: '#d9667f', l4: '#5cc08a', l5: '#e0d05a', l6: '#5d7fc4', l7: '#e58a6b', l8: '#8bb84a', contour: '#ffffff',
};
const LISTE: ReponseCampagnesOoh = { campagnes: [{ id: 'c1', nom: 'Campagne essai', annonceur: null, vague: 'V1', date_debut: '2026-09-20', date_fin: '2026-10-02', lignes: [] }], tronque: false };

function monter(api: { campagnesOoh?: () => unknown; campagneOoh?: (id: string) => unknown }) {
  const palette = signal(TEINTES);
  const panneauSelectionne = signal<unknown>(null);
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), CampagneOohService, CouchesCarteService,
      { provide: CarteApi, useValue: api },
      { provide: CouleursService, useValue: { palette: () => palette } },
      { provide: PoisService, useValue: { panneauSelectionne } },
    ],
  });
  const carte = new CarteFactice();
  carte.styleCharge = true;
  const couches = TestBed.inject(CouchesCarteService);
  couches.publier(carte as unknown as maplibregl.Map);
  const service = TestBed.inject(CampagneOohService);
  TestBed.tick();
  return { service, carte, couches, palette, panneauSelectionne };
}

const donneesPosees = (c: CarteFactice) => {
  const s = c.sources.get(SOURCE_CAMPAGNE_OOH);
  if (!s) return null;
  const derniere = (s.donnees.at(-1) ?? (s.spec as { data: unknown }).data) as GeoJSON.FeatureCollection;
  return derniere.features.map((f) => f.properties?.['id']);
};

describe('CampagneOohService', () => {
  it('lireCampagnes : une seule lecture, même rappelée', () => {
    const campagnesOoh = vi.fn(() => of(LISTE));
    const { service } = monter({ campagnesOoh });
    service.lireCampagnes();
    service.lireCampagnes();
    expect(campagnesOoh).toHaveBeenCalledTimes(1);
    expect(service.campagnes()).toEqual(LISTE.campagnes);
    expect(service.listeTronquee()).toBe(false);
  });

  it('échec de la liste : le message, puis une nouvelle tentative possible', () => {
    let essai = 0;
    const campagnesOoh = vi.fn(() => (++essai === 1 ? throwError(() => ({ status: 500 })) : of(LISTE)));
    const { service } = monter({ campagnesOoh });
    service.lireCampagnes();
    expect(service.erreurListe()).toBe('HTTP 500');
    expect(service.chargementListe()).toBe(false);
    service.lireCampagnes();
    expect(campagnesOoh).toHaveBeenCalledTimes(2);
    expect(service.campagnes()).toEqual(LISTE.campagnes);
  });

  it('choisir : la couche est posée, ses points colorés par ligne, la carte recadrée sur l emprise', () => {
    const { service, carte } = monter({ campagneOoh: () => of(DETAIL_ESSAI) });
    service.choisir('c1');
    TestBed.tick();
    expect(service.detail()).toBe(DETAIL_ESSAI);
    expect(donneesPosees(carte)).toEqual(['p1', 'p2']);
    expect(carte.getLayer(COUCHE_CAMPAGNE_OOH_POINTS)!['paint']).toMatchObject({ 'circle-color': expressionCouleurLigne(Object.values(TEINTES).slice(0, 8)) });
    expect(carte.cadrages.at(-1)).toEqual({ cadre: [[2.1, 48.1], [2.3, 48.3]], options: { padding: 50, duration: 800, maxZoom: 14 } });
  });

  it('masquer une ligne retire ses points ; la réafficher les rend', () => {
    const { service, carte } = monter({ campagneOoh: () => of(DETAIL_ESSAI) });
    service.choisir('c1');
    TestBed.tick();
    service.basculerLigne('l1');
    TestBed.tick();
    expect(donneesPosees(carte)).toEqual([]);
    service.basculerLigne('l1');
    TestBed.tick();
    expect(donneesPosees(carte)).toEqual(['p1', 'p2']);
  });

  it('clic sur un point : la fiche s ouvre et le tiroir Street View des POI se ferme', () => {
    const { service, carte, panneauSelectionne } = monter({ campagneOoh: () => of(DETAIL_ESSAI) });
    service.choisir('c1');
    TestBed.tick();
    panneauSelectionne.set({ id: 'poi' });
    TestBed.tick();
    carte.emettreSurCouche('click', COUCHE_CAMPAGNE_OOH_POINTS, { features: [{ properties: { id: 'p2' } }] });
    TestBed.tick();
    expect(service.emplacementSelectionne()?.properties.id).toBe('p2');
    expect(panneauSelectionne()).toBeNull();
  });

  it('un panneau de POI choisi ferme la fiche ; masquer la ligne du point choisi aussi', () => {
    const { service, panneauSelectionne } = monter({ campagneOoh: () => of(DETAIL_ESSAI) });
    service.choisir('c1');
    service.selectionner('p1');
    TestBed.tick();
    panneauSelectionne.set({ id: 'poi' });
    TestBed.tick();
    expect(service.emplacementSelectionne()).toBeNull();
    panneauSelectionne.set(null);
    service.selectionner('p1');
    service.basculerLigne('l1');
    expect(service.emplacementSelectionne()).toBeNull();
  });

  it('Tout effacer retire la couche et vide la campagne, la liste reste', () => {
    const { service, carte, couches } = monter({ campagnesOoh: () => of(LISTE), campagneOoh: () => of(DETAIL_ESSAI) });
    service.lireCampagnes();
    service.choisir('c1');
    TestBed.tick();
    couches.toutEffacer();
    TestBed.tick();
    expect(service.detail()).toBeNull();
    expect(carte.retraits).toContain(`couche:${COUCHE_CAMPAGNE_OOH_POINTS}`);
    expect(carte.retraits).toContain(`source:${SOURCE_CAMPAGNE_OOH}`);
    expect(service.campagnes()).toEqual(LISTE.campagnes);
  });

  it('une réponse en vol après fermer() est ignorée ; choisir une autre campagne abandonne la première', () => {
    const reponses = [new Subject<DetailCampagneOoh>(), new Subject<DetailCampagneOoh>(), new Subject<DetailCampagneOoh>()];
    let n = 0;
    const { service, carte } = monter({ campagneOoh: () => reponses[n++] });
    service.choisir('c1');
    service.fermer();
    reponses[0].next(DETAIL_ESSAI);
    TestBed.tick();
    expect(service.detail()).toBeNull();
    expect(carte.sources.has(SOURCE_CAMPAGNE_OOH)).toBe(false);
    service.choisir('c1');
    service.choisir('c2');
    expect(reponses[1].observed).toBe(false);
  });

  it('changement de thème : les teintes sont repeintes', () => {
    const { service, carte, palette } = monter({ campagneOoh: () => of(DETAIL_ESSAI) });
    service.choisir('c1');
    TestBed.tick();
    palette.set({ ...TEINTES, l1: '#b9770f' });
    TestBed.tick();
    expect(carte.peintures).toContainEqual({
      couche: COUCHE_CAMPAGNE_OOH_POINTS, propriete: 'circle-color',
      valeur: expressionCouleurLigne(['#b9770f', ...Object.values(TEINTES).slice(1, 8)]),
    });
  });

  it('n est pas fourni à la racine : il vit et meurt avec la page carte', () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    expect(() => TestBed.inject(CampagneOohService)).toThrow();
  });
});
```

- [ ] **Step 7: Le lancer, il échoue**

Run: `cd angular && npx ng test --watch=false --include='src/app/features/carte/couches/campagne-ooh.service.spec.ts'`
Expected: FAIL — `campagne-ooh.service` introuvable.

- [ ] **Step 8: Écrire le service**

`angular/src/app/features/carte/couches/campagne-ooh.service.ts` :

```ts
import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type { Subscription } from 'rxjs';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { CarteApi } from '../data/carte.api';
import { CouchesCarteService, quandStyleCharge } from '../etat/couches-carte.service';
import {
  type CampagneOohResume, type DetailCampagneOoh, type EmplacementOoh, JETONS_CAMPAGNE_OOH, collectionCarte, emprise, rangsDesLignes,
} from '../logique/campagnes-ooh';
import { messageHttp } from '../logique/zones/zones-affichees';
import { ecouterCampagneOoh, poserCoucheCampagneOoh, retirerCoucheCampagneOoh } from './couche-campagne-ooh';
import { PoisService } from './pois.service';

/** Le recadrage sur l'emprise d'une campagne (métropole : les DROM n'ont pas de points). */
const RECADRAGE = { padding: 50, duration: 800, maxZoom: 14 } as const;

/**
 * La campagne OOH affichée sur la carte principale (spec 2026-10-16-ooh-campagnes § 6) : la liste des campagnes de
 * l'espace, la campagne choisie, les lignes masquées, l'emplacement ouvert dans la fiche — et la couche DÉDIÉE qui
 * les peint (`couche-campagne-ooh.ts`, patron de « Mes zones »).
 *
 * ── UNE RÉCONCILIATION ───────────────────────────────────────────────────
 * Un `effect` rend la carte conforme à (campagne, lignes masquées, palette) : il pose, met à jour ou retire. Il couvre
 * d'un même geste le choix, le masquage d'une ligne, le changement de thème (repeinture) et la carte recréée par un
 * changement de fond.
 *
 * ── CHANGER D'ESPACE ─────────────────────────────────────────────────────
 * `@Injectable()` sans `providedIn` : fourni par `CartePage`, que `CarteHoteComponent` RECRÉE à chaque changement
 * d'espace. L'état meurt avec la page et les lectures en vol sont désabonnées : une réponse de l'ancien espace
 * n'atteint jamais le nouveau. « Tout effacer » (`inscrireEffacement`) ferme la campagne et retire la couche.
 *
 * I/O : la liste n'est lue qu'à l'ouverture de la section (une fois par page) ; une campagne, à son choix.
 */
@Injectable()
export class CampagneOohService {
  private readonly api = inject(CarteApi);
  private readonly couches = inject(CouchesCarteService);
  private readonly pois = inject(PoisService);
  private readonly palette = inject(CouleursService).palette(JETONS_CAMPAGNE_OOH);

  /** `null` tant que la liste n'a pas été lue. */
  readonly campagnes = signal<readonly CampagneOohResume[] | null>(null);
  readonly listeTronquee = signal(false);
  readonly chargementListe = signal(false);
  readonly erreurListe = signal<string | null>(null);
  readonly detail = signal<DetailCampagneOoh | null>(null);
  readonly chargementDetail = signal(false);
  readonly erreurDetail = signal<string | null>(null);
  /** Les lignes dont les points sont masqués. */
  readonly masquees = signal<ReadonlySet<string>>(new Set());
  /** L'emplacement ouvert dans la fiche. */
  readonly emplacementSelectionne = signal<EmplacementOoh | null>(null);
  /** Le rang de teinte (1-8) de chaque ligne qui a des emplacements. */
  readonly rangs = computed(() => rangsDesLignes(this.detail()?.lignes ?? []));

  private lectureListe: Subscription | null = null;
  private lectureDetail: Subscription | null = null;

  constructor() {
    this.couches.inscrireEffacement('campagne-ooh', () => this.fermer());

    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      const detail = this.detail();
      const masquees = this.masquees();
      const rangs = this.rangs();
      const p = this.palette();
      if (!carte) return;
      nettoyer(quandStyleCharge(carte, () => untracked(() => {
        if (!detail) {
          retirerCoucheCampagneOoh(carte);
          return;
        }
        poserCoucheCampagneOoh(carte, collectionCarte(detail, rangs, masquees), {
          lignes: [p.l1, p.l2, p.l3, p.l4, p.l5, p.l6, p.l7, p.l8],
          contour: p.contour,
        });
      })));
    });

    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      if (!carte) return;
      nettoyer(ecouterCampagneOoh(carte, (id) => this.selectionner(id)));
    });

    // Le tiroir Street View des POI et la fiche d'un emplacement occupent la même place : l'un ferme l'autre.
    effect(() => {
      if (this.pois.panneauSelectionne() !== null) untracked(() => this.emplacementSelectionne.set(null));
    });

    inject(DestroyRef).onDestroy(() => {
      this.lectureListe?.unsubscribe();
      this.lectureDetail?.unsubscribe();
    });
  }

  /** Lit la liste UNE fois par page ; après un échec, un nouvel appel relit. */
  lireCampagnes(): void {
    if (this.campagnes() !== null || this.lectureListe !== null) return;
    this.chargementListe.set(true);
    this.erreurListe.set(null);
    const lecture = this.api.campagnesOoh().subscribe({
      next: (r) => {
        this.lectureListe = null;
        this.chargementListe.set(false);
        this.listeTronquee.set(r.tronque);
        this.campagnes.set(r.campagnes);
      },
      error: (e: unknown) => {
        this.lectureListe = null;
        this.chargementListe.set(false);
        this.erreurListe.set(messageHttp(e, 'Lecture des campagnes impossible'));
      },
    });
    if (!lecture.closed) this.lectureListe = lecture;
  }

  /** Lit une campagne et l'affiche ; une lecture précédente encore en vol est abandonnée. */
  choisir(id: string): void {
    if (this.detail()?.campagne.id === id) return;
    this.lectureDetail?.unsubscribe();
    this.lectureDetail = null;
    this.emplacementSelectionne.set(null);
    this.erreurDetail.set(null);
    this.chargementDetail.set(true);
    const lecture = this.api.campagneOoh(id).subscribe({
      next: (d) => {
        this.lectureDetail = null;
        this.chargementDetail.set(false);
        this.masquees.set(new Set());
        this.detail.set(d);
        const b = emprise(d.emplacements);
        if (b) this.couches.carteCourante()?.fitBounds([[b[0], b[1]], [b[2], b[3]]], RECADRAGE);
      },
      error: (e: unknown) => {
        this.lectureDetail = null;
        this.chargementDetail.set(false);
        this.erreurDetail.set(messageHttp(e, 'Lecture de la campagne impossible'));
      },
    });
    if (!lecture.closed) this.lectureDetail = lecture;
  }

  /** Affiche ou masque les points d'une ligne ; masquer la ligne de l'emplacement ouvert ferme sa fiche. */
  basculerLigne(id: string): void {
    this.masquees.update((m) => {
      const n = new Set(m);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    const choisi = this.emplacementSelectionne();
    if (choisi && this.masquees().has(choisi.properties.ligne_id)) this.emplacementSelectionne.set(null);
  }

  /** Ouvre la fiche d'un emplacement (clic sur la carte) ; ferme le tiroir Street View des POI. */
  selectionner(id: string): void {
    const e = this.detail()?.emplacements.find((x) => x.properties.id === id) ?? null;
    if (e) this.pois.panneauSelectionne.set(null);
    this.emplacementSelectionne.set(e);
  }

  /** Retour à la liste, « Tout effacer » : plus de campagne, ni sur la carte ni en lecture. La liste reste. */
  fermer(): void {
    this.lectureDetail?.unsubscribe();
    this.lectureDetail = null;
    this.chargementDetail.set(false);
    this.erreurDetail.set(null);
    this.emplacementSelectionne.set(null);
    this.masquees.set(new Set());
    this.detail.set(null);
  }
}
```

- [ ] **Step 9: Relancer les tests Angular et racine**

Run: `cd angular && npx ng test --watch=false --include='src/app/features/carte/couches/campagne-ooh.service.spec.ts' --include='src/app/features/carte/couches/couche-campagne-ooh.spec.ts' --include='src/app/features/carte/logique/campagnes-ooh.spec.ts' --include='src/app/features/carte/data/carte.api.spec.ts'`
Expected: PASS.

Run: `npx vitest run --project unit tests/unit/angular/ tests/unit/design/`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add app/globals.css angular/src/styles/jetons.css DESIGN_SYSTEM.md angular/src/app/carte/testing/carte-factice.ts \
  angular/src/app/features/carte/data/carte.api.ts angular/src/app/features/carte/data/carte.api.spec.ts \
  angular/src/app/features/carte/logique/campagnes-ooh.ts angular/src/app/features/carte/logique/campagnes-ooh.spec.ts \
  angular/src/app/features/carte/testing/campagnes-ooh.fixture.ts \
  angular/src/app/features/carte/couches/couche-campagne-ooh.ts angular/src/app/features/carte/couches/couche-campagne-ooh.spec.ts \
  angular/src/app/features/carte/couches/campagne-ooh.service.ts angular/src/app/features/carte/couches/campagne-ooh.service.spec.ts \
  angular/src/app/features/carte/logique/ordre-couches.ts tests/unit/angular/carte-ordre-couches.test.ts
git commit -m "feat(angular): couche dédiée et état d'une campagne OOH, teintes --ligne-media-*" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: L'overlay « Panneaux OOH et DOOH », la fiche d'un emplacement, le branchement à la page et les retraits

**Files:**
- Modify (réécrit): `angular/src/app/features/carte/panneaux/calques/section-ooh.component.ts` + `section-ooh.component.spec.ts`
- Create: `angular/src/app/features/carte/couches/fiche-emplacement-ooh.component.ts` + `fiche-emplacement-ooh.component.spec.ts`
- Modify: `angular/src/app/features/carte/carte.page.ts` (imports, `providers`, `decalageOutils`, focus) · `carte.page.html:61` · `carte.page.spec.ts:115,1415-1443`
- Modify: `angular/src/app/features/carte/panneaux/autres/panneau-autres.component.ts` (commentaire) + `panneau-autres.component.spec.ts`
- Modify: `angular/src/app/features/carte/panneaux/donnees/panneau-donnees.component.spec.ts:12,59,68,119`
- Delete: `angular/src/app/features/carte/couches/ooh.service.ts`, `angular/src/app/features/carte/couches/ooh.service.spec.ts`
- Modify: `angular/src/app/features/carte/data/carte.api.ts` (retrait de `ooh`, `CorpsOoh`, `DELAI_OOH_MS`) + `carte.api.spec.ts` (cas `ooh`)
- Modify: `angular/src/app/features/carte/panneaux/calques/selections-calques.service.ts` (retrait de `regiesOoh`)
- Modify: `angular/src/app/features/carte/logique/constantes-calques.ts:14-25` (retrait de `OOH_REGIES`) · `angular/src/app/features/carte/couches/pois.service.ts:50,191` (commentaires)
- Modify: `tests/unit/angular/carte-couches-paritaire.test.ts:562-568`
- Create: `tests/unit/angular/campagne-ooh-page.test.ts`
- Modify: `angular/src/app/features/carte/README.md:39-45` · `ARCHITECTURE.md` (route `/api/map/ooh`, section Angular de la carte)

**Interfaces:**
- Consumes (tâche 10) : `CampagneOohService` et ses signaux / méthodes ; `LigneOoh`, `libelleEcart`, `libelleNonPlaces`, `libellePeriode`, `montantTtc`, `formaterScore`, `donneesRegie`, `LIBELLES_METHODE`, `LIBELLES_QUALITE` ; `DETAIL_ESSAI`, `ligneEssai` (fixture) ; `adresseStreetView`, `LARGEUR_TIROIR_PANNEAU`, `VARIABLE_CLE_GOOGLE` (`tiroir-panneau.component.ts`) ; `EnteteFiltreComponent` ; `SelectionsCalquesService.sections`/`basculerSection('ooh')`.
- Produces: `mg-section-ooh` (même sélecteur, contenu remplacé : liste → campagne → lignes), `mg-fiche-emplacement-ooh` (`FicheEmplacementOohComponent`), `CampagneOohService` fourni par `CartePage`. Retirés de l'Angular : `OohService`, `CarteApi.ooh`, `CorpsOoh`, `DELAI_OOH_MS`, `SelectionsCalquesService.regiesOoh`, `OOH_REGIES`.

- [ ] **Step 1: Écrire les specs de la section et de la fiche**

`angular/src/app/features/carte/panneaux/calques/section-ooh.component.spec.ts` (remplace l'ancien) :

```ts
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { CouleursService } from '../../../../core/theme/couleurs.service';
import { CampagneOohService } from '../../couches/campagne-ooh.service';
import { PoisService } from '../../couches/pois.service';
import { CarteApi } from '../../data/carte.api';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import type { DetailCampagneOoh, ReponseCampagnesOoh } from '../../logique/campagnes-ooh';
import { DETAIL_ESSAI, ligneEssai } from '../../testing/campagnes-ooh.fixture';
import { SectionOohComponent } from './section-ooh.component';
import { SelectionsCalquesService } from './selections-calques.service';

const LISTE: ReponseCampagnesOoh = {
  campagnes: [{ id: 'c1', nom: 'Campagne essai', annonceur: null, vague: 'V1', date_debut: '2026-09-20', date_fin: '2026-10-02', lignes: [
    { id: 'l1', ordre: 1, media: 'ooh', regie: 'REGIE', reseau: 'DOOH essai', territoire: null, nb_ecrans: 10, nb_places: 2, nb_non_places: 1 },
    { id: 'l2', ordre: 2, media: 'ooh', regie: 'OUTREMER', reseau: null, territoire: 'LA REUNION', nb_ecrans: 10, nb_places: 0, nb_non_places: 0 },
  ] }],
  tronque: false,
};

const DETAIL: DetailCampagneOoh = {
  ...DETAIL_ESSAI,
  lignes: [
    ligneEssai('l1', 1, {
      nb_places: 2, nb_a_verifier: 1, nb_non_places: 1, nb_ecrans: 9,
      details: { nb_lieux_plan: 3, unite_lieux_plan: 'clubs', non_places: [{ nom: 'Club introuvable', raison: 'adresse introuvable (BAN)' }] },
    }),
    ligneEssai('l2', 2, { regie: 'OUTREMER', reseau: null, territoire: 'LA REUNION', nb_ecrans: 200, format: '12m²', a_des_emplacements: false, nb_places: 0, nb_a_verifier: 0 }),
  ],
};

function monter(api: { campagnesOoh: () => unknown; campagneOoh?: (id: string) => unknown }) {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), CampagneOohService, SelectionsCalquesService, CouchesCarteService,
      { provide: CarteApi, useValue: { campagneOoh: () => new Subject(), ...api } },
      { provide: CouleursService, useValue: { palette: () => signal({}) } },
      { provide: PoisService, useValue: { panneauSelectionne: signal(null) } },
    ],
  });
  const fixture = TestBed.createComponent(SectionOohComponent);
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  return { el, rendre, selections: TestBed.inject(SelectionsCalquesService), service: TestBed.inject(CampagneOohService) };
}

describe('SectionOohComponent — les campagnes OOH de l espace', () => {
  it('repliée à l ouverture : aucune lecture ; dépliée : la liste est lue UNE fois', async () => {
    const campagnesOoh = vi.fn(() => of(LISTE));
    const { el, rendre, selections } = monter({ campagnesOoh });
    await rendre();
    expect(campagnesOoh).not.toHaveBeenCalled();
    expect(el.querySelector('[data-contenu-ooh]')).toBeNull();
    selections.basculerSection('ooh');
    await rendre();
    selections.basculerSection('ooh');
    await rendre();
    selections.basculerSection('ooh');
    await rendre();
    expect(campagnesOoh).toHaveBeenCalledTimes(1);
  });

  it('espace sans campagne OOH : le dit', async () => {
    const { el, rendre, selections } = monter({ campagnesOoh: () => of({ campagnes: [], tronque: false }) });
    selections.basculerSection('ooh');
    await rendre();
    expect(el.querySelector('[data-aucune-campagne]')!.textContent!.trim()).toBe('Aucune campagne OOH dans cet espace de travail.');
  });

  it('la liste : nom, vague, période et lignes ; un clic lit la campagne', async () => {
    const campagneOoh = vi.fn(() => new Subject());
    const { el, rendre, selections } = monter({ campagnesOoh: () => of(LISTE), campagneOoh });
    selections.basculerSection('ooh');
    await rendre();
    const bouton = el.querySelector<HTMLButtonElement>('[data-choisir-campagne="c1"]')!;
    expect(bouton.textContent).toContain('Campagne essai');
    expect(bouton.textContent!.replace(/\s+/g, ' ')).toContain('V1 · 20/09/2026 → 02/10/2026 · 2 lignes');
    bouton.click();
    expect(campagneOoh).toHaveBeenCalledWith('c1');
    await rendre();
    expect(el.querySelector('[data-chargement-detail]')).not.toBeNull();
  });

  it('campagne choisie : une ligne par réseau avec sa teinte, l écart au plan, les points à vérifier, les non placés ; les DROM groupées', async () => {
    const { el, rendre, selections } = monter({ campagnesOoh: () => of(LISTE), campagneOoh: () => of(DETAIL) });
    selections.basculerSection('ooh');
    await rendre();
    el.querySelector<HTMLButtonElement>('[data-choisir-campagne="c1"]')!.click();
    await rendre();
    const ligne = el.querySelector('[data-ligne="l1"]')!;
    expect(ligne.querySelector('[data-pastille]')!.getAttribute('data-rang')).toBe('1');
    expect(ligne.textContent).toContain('REGIE · DOOH essai');
    expect(ligne.querySelector('[data-ecart]')!.textContent!.trim()).toMatch(/^2 clubs placés · plan : 3 clubs, 9 écrans$/);
    expect(ligne.querySelector('[data-a-verifier]')!.textContent!.trim()).toBe('1 à vérifier (cerne pointillé)');
    expect(ligne.querySelector('[data-non-places] summary')!.textContent!.trim()).toBe('1 emplacement non placé');
    expect(ligne.querySelector('[data-non-places] li')!.textContent).toContain('Club introuvable — adresse introuvable (BAN)');
    expect(el.querySelector('[data-ligne="l2"]')).toBeNull();
    const drom = el.querySelector('[data-sans-liste]')!;
    expect(drom.textContent).toContain('Liste des emplacements non fournie par la régie.');
    expect(drom.querySelector('[data-ligne-sans-liste="l2"]')!.textContent).toContain('OUTREMER · LA REUNION');
  });

  it('décocher une ligne la masque ; « Toutes les campagnes » revient à la liste', async () => {
    const { el, rendre, selections, service } = monter({ campagnesOoh: () => of(LISTE), campagneOoh: () => of(DETAIL) });
    selections.basculerSection('ooh');
    await rendre();
    el.querySelector<HTMLButtonElement>('[data-choisir-campagne="c1"]')!.click();
    await rendre();
    el.querySelector<HTMLInputElement>('[data-ligne="l1"] [data-afficher-ligne]')!.click();
    await rendre();
    expect(service.masquees().has('l1')).toBe(true);
    el.querySelector<HTMLButtonElement>('[data-retour-liste]')!.click();
    await rendre();
    expect(service.detail()).toBeNull();
    expect(el.querySelector('[data-choisir-campagne="c1"]')).not.toBeNull();
  });

  it('une lecture en échec est dite', async () => {
    const { el, rendre, selections } = monter({ campagnesOoh: () => throwError(() => new Error('Délai dépassé')) });
    selections.basculerSection('ooh');
    await rendre();
    expect(el.querySelector('[data-erreur]')!.textContent!.trim()).toBe('! Délai dépassé');
  });
});
```

`angular/src/app/features/carte/couches/fiche-emplacement-ooh.component.spec.ts` :

```ts
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfigService } from '../../../core/config/config.service';
import { formaterNombre } from '../../../core/format/nombre';
import type { EmplacementOoh } from '../logique/campagnes-ooh';
import { DETAIL_ESSAI } from '../testing/campagnes-ooh.fixture';
import { CampagneOohService } from './campagne-ooh.service';
import { FicheEmplacementOohComponent } from './fiche-emplacement-ooh.component';

function monter(cle: string) {
  const emplacementSelectionne = signal<EmplacementOoh | null>(null);
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: CampagneOohService, useValue: { emplacementSelectionne, detail: signal(DETAIL_ESSAI) } },
      { provide: ConfigService, useValue: { valeur: { googleMapsKey: cle } } },
    ],
  });
  const fixture = TestBed.createComponent(FicheEmplacementOohComponent);
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  return { el, rendre, emplacementSelectionne };
}

describe('FicheEmplacementOohComponent', () => {
  it('rien sans emplacement choisi', async () => {
    const { el, rendre } = monter('');
    await rendre();
    expect(el.querySelector('[data-fiche-emplacement-ooh]')).toBeNull();
  });

  it('tout ce que l on sait de l emplacement, sa géolocalisation, sa campagne et sa ligne', async () => {
    const { el, rendre, emplacementSelectionne } = monter('');
    emplacementSelectionne.set(DETAIL_ESSAI.emplacements[1]);
    await rendre();
    const fiche = el.querySelector('[data-fiche-emplacement-ooh]')!;
    expect(fiche.querySelector('[data-titre]')!.textContent!.trim()).toBe('Lieu p2');
    const infos = fiche.querySelector('[data-infos]')!.textContent!.replace(/\s+/g, ' ');
    for (const attendu of [
      'Adresse 1 Rue Essai', 'Ville 45000 Villetest', 'Réseau DOOH essai', 'Régie REGIE', 'Type de lieu campus', 'Écrans 2', 'Formats 10"',
      `Contacts / semaine ${formaterNombre(6000)}`, 'Géolocalisation À vérifier · Adresse (BAN)', 'Reconnu 1 Rue Essai 45000 Villetest',
      'Score 0,45', 'Campagne Campagne essai', 'Ligne REGIE · DOOH essai',
    ]) expect(infos, attendu).toContain(attendu.replace(/\s+/g, ' '));
  });

  it('« Données de la régie » : la ligne d origine en entier, repliée', async () => {
    const { el, rendre, emplacementSelectionne } = monter('');
    emplacementSelectionne.set(DETAIL_ESSAI.emplacements[0]);
    await rendre();
    const bloc = el.querySelector<HTMLDetailsElement>('[data-donnees-regie]')!;
    expect(bloc.open).toBe(false);
    expect(bloc.querySelector('summary')!.textContent!.trim()).toBe('Données de la régie');
    expect(bloc.textContent).toContain('LISTING CAMPUS, ligne 3');
    expect(bloc.textContent).toContain('Etablissement');
  });

  it('Street View : la vue au point, ou le bandeau qui nomme la variable manquante', async () => {
    const sans = monter('');
    sans.emplacementSelectionne.set(DETAIL_ESSAI.emplacements[1]);
    await sans.rendre();
    expect(sans.el.querySelector('[data-cle-manquante]')!.textContent!.trim()).toBe('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY manquante.');
    TestBed.resetTestingModule();
    const avec = monter('cle-essai');
    avec.emplacementSelectionne.set(DETAIL_ESSAI.emplacements[1]);
    await avec.rendre();
    expect(avec.el.querySelector('iframe[data-street-view]')!.getAttribute('src')).toContain('location=48.3,2.3');
  });

  it('« ✕ » ferme la fiche', async () => {
    const { el, rendre, emplacementSelectionne } = monter('');
    emplacementSelectionne.set(DETAIL_ESSAI.emplacements[0]);
    await rendre();
    el.querySelector<HTMLButtonElement>('[data-fermer]')!.click();
    expect(emplacementSelectionne()).toBeNull();
  });
});
```

- [ ] **Step 2: Les lancer, ils échouent**

Run: `cd angular && npx ng test --watch=false --include='src/app/features/carte/panneaux/calques/section-ooh.component.spec.ts' --include='src/app/features/carte/couches/fiche-emplacement-ooh.component.spec.ts'`
Expected: FAIL — `fiche-emplacement-ooh.component` introuvable ; la section n'a ni `[data-aucune-campagne]` ni `[data-choisir-campagne]`.

- [ ] **Step 3: Réécrire la section**

`angular/src/app/features/carte/panneaux/calques/section-ooh.component.ts` (contenu entier) :

```ts
import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import { CampagneOohService } from '../../couches/campagne-ooh.service';
import { type LigneOoh, libelleEcart, libelleNonPlaces, libellePeriode, montantTtc } from '../../logique/campagnes-ooh';
import { EnteteFiltreComponent } from '../filtre/perimetre.component';
import { SelectionsCalquesService } from './selections-calques.service';

/**
 * « Panneaux OOH et DOOH » du panneau « Autres » (spec 2026-10-16-ooh-campagnes § 6) : on ne choisit plus des régies
 * d'un inventaire partagé — les 1 434 panneaux de Brest étaient un essai, purgés (sql/260) — mais une CAMPAGNE de
 * l'espace de travail. Trois états :
 *   1. la liste des campagnes OOH de l'espace, lue UNE fois, à la première ouverture de la section (I/O) ;
 *   2. la campagne choisie : ses lignes OOH dans l'ordre du plan — pastille de teinte, régie et réseau, dates, écrans,
 *      budget, contacts, case afficher/masquer, écart entre la liste de la régie et le plan, points à vérifier,
 *      emplacements non placés (dépliables) ; les lignes sans liste (DROM) regroupées, avec la phrase qui le dit ;
 *   3. le retour à la liste.
 * L'état vit dans `CampagneOohService` (page) : fermer « Autres » ou replier la section ne perd rien ; changer
 * d'espace recrée la page et vide tout. La pastille est en CSS (`var(--ligne-media-n)`), la carte reçoit les mêmes
 * teintes calculées.
 */
@Component({
  selector: 'mg-section-ooh',
  imports: [EnteteFiltreComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    @keyframes fondu { from { opacity: 0; } to { opacity: 1; } }
    .fondu { animation: fondu 200ms var(--ease-out); }
  `,
  host: { class: 'flex flex-col gap-[10px]' },
  template: `
    <mg-entete-filtre libelle="Panneaux OOH et DOOH" [ouvert]="ouvert()" [compte]="service.detail() ? 1 : 0"
      (basculer)="selections.basculerSection('ooh')" />
    @if (ouvert()) {
      <div class="fondu flex flex-col gap-2" data-contenu-ooh>
        @if (service.detail(); as d) {
          <button type="button" data-retour-liste (click)="service.fermer()"
            class="cursor-pointer self-start border-0 bg-transparent p-0 text-[11px] text-tertiary hover:text-secondary">← Toutes les campagnes</button>
          <div data-campagne class="flex flex-col gap-0.5">
            <div class="text-[13px] font-medium text-primary">{{ d.campagne.nom }}</div>
            <div class="text-[11px] text-tertiary">
              @if (d.campagne.vague) { <span>{{ d.campagne.vague }} · </span> }{{ periode(d.campagne.date_debut, d.campagne.date_fin) }}
            </div>
          </div>
          @if (d.tronque) {
            <div data-tronque class="text-[11px] text-warning">Campagne tronquée : seuls les {{ nombre(d.emplacements.length) }} premiers emplacements sont sur la carte.</div>
          }
          @for (l of lignesAvecListe(); track l.id) {
            <div [attr.data-ligne]="l.id" class="flex flex-col gap-1 rounded-[6px] border-fin border-subtle bg-elevated p-2.5">
              <label class="flex cursor-pointer items-center gap-2 text-[12px] text-primary">
                <input type="checkbox" data-afficher-ligne [checked]="!masquee(l)" (change)="service.basculerLigne(l.id)"
                  class="cursor-pointer accent-[var(--brand-teal)]" />
                <span data-pastille class="size-2.5 shrink-0 rounded-full" [attr.data-rang]="rang(l)" [style.background-color]="couleur(l)"></span>
                <span>{{ l.regie }}@if (l.reseau) { · {{ l.reseau }} }</span>
              </label>
              <div class="flex flex-col pl-6 text-[11px] leading-[1.5] text-secondary">
                <div>{{ periode(l.date_debut, l.date_fin) }}@if (l.duree_libelle) { ({{ l.duree_libelle }}) }</div>
                <div class="font-mono">{{ nombre(l.nb_ecrans) }} écrans · {{ montant(l.total_ttc) }}</div>
                @if (l.contacts_15_plus !== null || l.contacts_18_24 !== null) {
                  <div class="font-mono">Contacts 15+ : {{ nombre(l.contacts_15_plus) }} · 18-24 : {{ nombre(l.contacts_18_24) }}</div>
                }
                @if (ecart(l); as e) { <div data-ecart class="text-tertiary">{{ e }}</div> }
                @if (l.nb_a_verifier > 0) { <div data-a-verifier class="text-tertiary">{{ nombre(l.nb_a_verifier) }} à vérifier (cerne pointillé)</div> }
                @if (l.nb_non_places > 0) {
                  <details data-non-places class="mt-1">
                    <summary class="cursor-pointer text-warning">{{ nonPlaces(l.nb_non_places) }}</summary>
                    <ul class="m-0 mt-1 list-none p-0">
                      @for (n of l.details.non_places ?? []; track $index) {
                        <li class="text-tertiary"><span class="text-secondary">{{ n.nom }}</span> — {{ n.raison }}</li>
                      }
                    </ul>
                  </details>
                }
              </div>
            </div>
          }
          @if (lignesSansListe().length > 0) {
            <div data-sans-liste class="flex flex-col gap-1 rounded-[6px] border-fin border-subtle p-2.5">
              <div class="text-[12px] text-primary">{{ lignesSansListe().length }} ligne{{ lignesSansListe().length > 1 ? 's' : '' }} sans emplacement · {{ nombre(facesSansListe()) }} faces</div>
              <p class="m-0 text-[11px] text-tertiary">Liste des emplacements non fournie par la régie.</p>
              @for (l of lignesSansListe(); track l.id) {
                <div [attr.data-ligne-sans-liste]="l.id" class="text-[11px] text-secondary">
                  {{ l.regie }} · {{ l.territoire ?? l.reseau }} — {{ nombre(l.nb_ecrans) }} faces{{ l.format ? ' ' + l.format : '' }} · {{ periode(l.date_debut, l.date_fin) }} · {{ montant(l.total_ttc) }}
                </div>
              }
            </div>
          }
        } @else {
          @if (service.chargementListe()) { <div data-chargement-liste class="text-[11px] text-tertiary">Lecture des campagnes…</div> }
          @if (service.erreurListe(); as e) { <div data-erreur class="font-mono text-[10px] text-danger">! {{ e }}</div> }
          @if (service.campagnes(); as cs) {
            @if (cs.length === 0) {
              <div data-aucune-campagne class="text-[12px] text-tertiary">Aucune campagne OOH dans cet espace de travail.</div>
            }
            @for (c of cs; track c.id) {
              <button type="button" [attr.data-choisir-campagne]="c.id" (click)="service.choisir(c.id)" [disabled]="service.chargementDetail()"
                class="flex cursor-pointer flex-col items-start gap-0.5 rounded-[6px] border-fin border-subtle bg-elevated px-3 py-2 text-left hover:border-hover disabled:cursor-wait">
                <span class="text-[12px] text-primary">{{ c.nom }}</span>
                <span class="text-[11px] text-tertiary">
                  @if (c.vague) { <span>{{ c.vague }} · </span> }{{ periode(c.date_debut, c.date_fin) }} · {{ c.lignes.length }} ligne{{ c.lignes.length > 1 ? 's' : '' }}
                </span>
              </button>
            }
            @if (service.listeTronquee()) {
              <div class="text-[11px] text-warning">Plus de 200 campagnes : seules les 200 plus récentes sont listées.</div>
            }
          }
          @if (service.chargementDetail()) { <div data-chargement-detail class="text-[11px] text-tertiary">Lecture de la campagne…</div> }
          @if (service.erreurDetail(); as e) { <div data-erreur-detail class="font-mono text-[10px] text-danger">! {{ e }}</div> }
        }
      </div>
    }
  `,
})
export class SectionOohComponent {
  protected readonly selections = inject(SelectionsCalquesService);
  protected readonly service = inject(CampagneOohService);
  protected readonly ouvert = computed(() => this.selections.sections()['ooh'] !== false);
  protected readonly lignesAvecListe = computed(() => (this.service.detail()?.lignes ?? []).filter((l) => l.a_des_emplacements));
  protected readonly lignesSansListe = computed(() => (this.service.detail()?.lignes ?? []).filter((l) => !l.a_des_emplacements));
  protected readonly facesSansListe = computed(() => this.lignesSansListe().reduce((s, l) => s + (l.nb_ecrans ?? 0), 0));
  protected readonly nombre = formaterNombre;
  protected readonly periode = libellePeriode;
  protected readonly ecart = libelleEcart;
  protected readonly nonPlaces = libelleNonPlaces;
  protected readonly montant = montantTtc;

  constructor() {
    // La liste n'est lue qu'à la première ouverture de la section (règles I/O) ; le service ne relit pas ensuite.
    effect(() => {
      if (this.ouvert()) untracked(() => this.service.lireCampagnes());
    });
  }

  protected rang(l: LigneOoh): number {
    return this.service.rangs().get(l.id) ?? 1;
  }

  protected couleur(l: LigneOoh): string {
    return `var(--ligne-media-${this.rang(l)})`;
  }

  protected masquee(l: LigneOoh): boolean {
    return this.service.masquees().has(l.id);
  }
}
```

- [ ] **Step 4: Écrire la fiche**

`angular/src/app/features/carte/couches/fiche-emplacement-ooh.component.ts` :

```ts
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { ConfigService } from '../../../core/config/config.service';
import { formaterNombre } from '../../../core/format/nombre';
import { LIBELLES_METHODE, LIBELLES_QUALITE, donneesRegie, formaterScore } from '../logique/campagnes-ooh';
import { CampagneOohService } from './campagne-ooh.service';
import { LARGEUR_TIROIR_PANNEAU, VARIABLE_CLE_GOOGLE, adresseStreetView } from './tiroir-panneau.component';

/**
 * La fiche d'un emplacement d'une campagne OOH, ouverte au clic sur son point (spec 2026-10-16-ooh-campagnes § 6.4) :
 * nom du lieu, adresse, ville, CP, réseau, régie, type de lieu, écrans et formats, contacts, qualité de la
 * géolocalisation (qualité, méthode, libellé reconnu, score), campagne et ligne ; Street View conservé ; puis
 * « Données de la régie », replié, qui montre TOUTES les cellules de la ligne d'origine (`metadata`).
 *
 * Même place que le tiroir Street View des POI (`mg-tiroir-panneau`, 420 px à droite, z-30) : l'un ferme l'autre
 * (`CampagneOohService`). Les libellés sont en sentence case, sans les étiquettes mono en capitales du tiroir React.
 */
@Component({
  selector: 'mg-fiche-emplacement-ooh',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (service.emplacementSelectionne(); as e) {
      <aside data-fiche-emplacement-ooh aria-label="Emplacement OOH"
        class="absolute bottom-0 right-0 top-0 z-30 flex max-w-[92vw] flex-col border-l-fin border-subtle bg-[var(--bg-primary)]" [style.width.px]="largeur">
        <div class="flex items-center justify-between gap-2 border-b-fin border-subtle px-[14px] py-[10px]">
          <div data-titre class="text-[13px] font-medium text-primary">{{ e.properties.nom_lieu || 'Emplacement OOH' }}</div>
          <button type="button" data-fermer aria-label="Fermer" (click)="service.emplacementSelectionne.set(null)"
            class="size-7 cursor-pointer rounded-[4px] border-fin border-subtle bg-transparent text-[13px] leading-none text-tertiary">✕</button>
        </div>
        <div class="flex flex-col gap-[10px] overflow-y-auto p-[14px]">
          <dl data-infos class="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
            @for (c of champs(); track c[0]) {
              <dt class="text-tertiary">{{ c[0] }}</dt>
              <dd class="m-0 text-secondary">{{ c[1] }}</dd>
            }
          </dl>
          @if (adresse(); as src) {
            <iframe data-street-view [title]="'Street View ' + (e.properties.nom_lieu ?? '')" width="100%" height="300" loading="lazy" allowfullscreen
              [src]="src" class="block rounded-[2px] border-fin border-subtle bg-elevated"></iframe>
          } @else {
            <div data-cle-manquante
              class="rounded-[2px] border-fin border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-[10px] font-mono text-[11px] text-danger">
              {{ variable }} manquante.
            </div>
          }
          <details data-donnees-regie class="rounded-[6px] border-fin border-subtle p-2.5 text-[11px]">
            <summary class="cursor-pointer text-secondary">Données de la régie</summary>
            @for (g of regie(); track g.titre) {
              <div class="mt-2 text-tertiary">{{ g.titre }}</div>
              <dl class="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono">
                @for (c of g.cellules; track c[0]) {
                  <dt class="text-tertiary">{{ c[0] }}</dt>
                  <dd class="m-0 break-words text-secondary">{{ c[1] }}</dd>
                }
              </dl>
            }
          </details>
        </div>
      </aside>
    }
  `,
})
export class FicheEmplacementOohComponent {
  protected readonly service = inject(CampagneOohService);
  private readonly config = inject(ConfigService);
  private readonly assainisseur = inject(DomSanitizer);
  protected readonly largeur = LARGEUR_TIROIR_PANNEAU;
  protected readonly variable = VARIABLE_CLE_GOOGLE;

  protected readonly champs = computed<[string, string][]>(() => {
    const e = this.service.emplacementSelectionne();
    if (!e) return [];
    const p = e.properties;
    const detail = this.service.detail();
    const ligne = detail?.lignes.find((l) => l.id === p.ligne_id);
    const champs: [string, string][] = [
      ['Adresse', p.adresse ?? '—'],
      ['Ville', [p.code_postal, p.ville].filter((v) => !!v).join(' ') || '—'],
      ['Réseau', p.reseau ?? '—'],
      ['Régie', p.regie ?? '—'],
      ['Type de lieu', p.type_lieu ?? '—'],
      ['Écrans', formaterNombre(p.nb_ecrans)],
      ['Formats', p.formats && p.formats.length > 0 ? p.formats.join(', ') : '—'],
    ];
    if (p.contacts_semaine !== null) champs.push(['Contacts / semaine', formaterNombre(p.contacts_semaine)]);
    if (p.contacts_18_25_semaine !== null) champs.push(['Contacts 18-25 / semaine', formaterNombre(p.contacts_18_25_semaine)]);
    champs.push(
      ['Géolocalisation', `${LIBELLES_QUALITE[p.geoloc_qualite ?? 'sure']} · ${p.geoloc_methode ? LIBELLES_METHODE[p.geoloc_methode] : '—'}`],
      ['Reconnu', p.geoloc_libelle ?? '—'],
      ['Score', formaterScore(p.geoloc_score)],
      ['Campagne', detail?.campagne.nom ?? '—'],
      ['Ligne', ligne ? `${ligne.regie ?? '—'}${ligne.reseau ? ` · ${ligne.reseau}` : ligne.territoire ? ` · ${ligne.territoire}` : ''}` : '—'],
    );
    return champs;
  });

  protected readonly regie = computed(() => donneesRegie(this.service.emplacementSelectionne()?.properties.metadata ?? null));

  /** L'adresse de l'iframe, de confiance : un domaine fixe, une clé de configuration et deux nombres. */
  protected readonly adresse = computed<SafeResourceUrl | null>(() => {
    const e = this.service.emplacementSelectionne();
    const cle = this.config.valeur.googleMapsKey;
    if (!e || !cle) return null;
    const [lng, lat] = e.geometry.coordinates;
    return this.assainisseur.bypassSecurityTrustResourceUrl(adresseStreetView(cle, lat, lng));
  });
}
```

Run: `cd angular && npx ng test --watch=false --include='src/app/features/carte/panneaux/calques/section-ooh.component.spec.ts' --include='src/app/features/carte/couches/fiche-emplacement-ooh.component.spec.ts'`
Expected: PASS.

- [ ] **Step 5: Brancher à la page, retirer l'ancienne lecture par régies**

`angular/src/app/features/carte/carte.page.ts` :
- remplacer `import { OohService } from './couches/ooh.service';` par `import { CampagneOohService } from './couches/campagne-ooh.service';` et ajouter `import { FicheEmplacementOohComponent } from './couches/fiche-emplacement-ooh.component';` ;
- dans `imports: [...]` du composant, ajouter `FicheEmplacementOohComponent` (ordre alphabétique, après `EtapeBientotComponent`) ;
- dans `providers`, `IrisService, PoisService, OohService, TransportService,` devient `IrisService, PoisService, CampagneOohService, TransportService,` ;
- après `private readonly pois = inject(PoisService);` ajouter
  ```ts
  /** La campagne OOH affichée (« Autres » → « Panneaux OOH et DOOH ») : sa fiche occupe la place du tiroir Street View. */
  private readonly campagneOoh = inject(CampagneOohService);
  ```
- `decalageOutils` : `streetView: this.pois.panneauSelectionne() !== null,` devient `streetView: this.pois.panneauSelectionne() !== null || this.campagneOoh.emplacementSelectionne() !== null,` ;
- dans la boucle `for (const ouvert of [() => this.iris.codeSelectionne() !== null, () => this.pois.panneauSelectionne() !== null,`, ajouter après le second élément `() => this.campagneOoh.emplacementSelectionne() !== null,`.

`angular/src/app/features/carte/carte.page.html`, après `  <mg-tiroir-panneau />` : `  <mg-fiche-emplacement-ooh />`.

Supprimer `angular/src/app/features/carte/couches/ooh.service.ts` et `ooh.service.spec.ts` (`git rm`).

`angular/src/app/features/carte/data/carte.api.ts` : supprimer l'interface `CorpsOoh` (≈ 84-87), la constante `DELAI_OOH_MS` (≈ 110) et la méthode `ooh(corps)` (≈ 153-156), et retirer `timeout` de l'import `rxjs` s'il n'a plus d'autre usage (`Grep "timeout(" carte.api.ts`). `carte.api.spec.ts` : supprimer le cas `it('ooh : POST /api/map/ooh', …)`.

`angular/src/app/features/carte/panneaux/calques/selections-calques.service.ts` : supprimer `readonly regiesOoh = signal<readonly string[]>([]);` et son commentaire ; le commentaire de classe « les régies OOH et les types de transport choisis » devient « les types de transport choisis », et « (sections OOH et radio, régies OOH) » devient « (sections OOH et radio) ».

`angular/src/app/features/carte/logique/constantes-calques.ts` : supprimer le bloc `/** Régies OOH filtrables dans la section Panneaux. */ export const OOH_REGIES = [ … ];` (≈ 15-25) ; dans l'en-tête, après « verrouillée par tests/unit/angular/carte-couches-paritaire.test.ts (gel P5 étendu à /map). », ajouter « `OOH_REGIES` n'est PLUS copié (2026-10-16) : l'Angular choisit une campagne de l'espace, plus des régies (spec ooh-campagnes § 6) ; React garde sa liste. »

`angular/src/app/features/carte/couches/pois.service.ts` : ligne 50, « l'autre. `OohService` et `TransportService` ne font que leur requête. » devient « l'autre. `TransportService` ne fait que sa requête. » ; ligne 191, « Écrite aussi par `OohService` et `TransportService`. » devient « Écrite aussi par `TransportService`. ».

`angular/src/app/features/carte/panneaux/autres/panneau-autres.component.ts`, commentaire de classe : « Les couches restent dans `OohService` et `RadioService`, fournis par la PAGE ; les sections ouvertes et les régies choisies dans `SelectionsCalquesService` » devient « Les couches restent dans `CampagneOohService` et `RadioService`, fournis par la PAGE ; les sections ouvertes dans `SelectionsCalquesService` ».

`angular/src/app/features/carte/panneaux/autres/panneau-autres.component.spec.ts` :
- import : remplacer `import { OohService } from '../../couches/ooh.service';` par `import { CampagneOohService } from '../../couches/campagne-ooh.service';`, et ajouter `of` à l'import `rxjs` (`import { Subject, of } from 'rxjs';`) ;
- providers : `OohService` devient `CampagneOohService` ; `{ provide: CarteApi, useValue: { ooh: () => new Subject() } }` devient `{ provide: CarteApi, useValue: { campagnesOoh: () => of({ campagnes: [], tronque: false }), campagneOoh: () => new Subject() } }` ;
- le second test devient :

```ts
  it('porte les sections Panneaux OOH puis Radio, dans cet ordre, avec SON état de sections', async () => {
    const { fixture, el, rendre } = monter();
    await rendre();
    const sections = [...el.querySelectorAll('mg-section-ooh, mg-section-radio')].map((s) => s.tagName.toLowerCase());
    expect(sections).toEqual(['mg-section-ooh', 'mg-section-radio']);
    // Repliées à l'ouverture, comme dans l'ancien groupe « Médias offline » (mode overlay de `sectionsInitiales`).
    expect(el.querySelector('[data-contenu-ooh]')).toBeNull();
    expect(el.querySelector('[data-contenu-radio]')).toBeNull();
    const selections = fixture.debugElement.injector.get(SelectionsCalquesService);
    (el.querySelector('mg-section-ooh mg-entete-filtre') as HTMLElement).click();
    await rendre();
    expect(selections.sections()['ooh']).toBe(true);
    expect(el.querySelector('[data-aucune-campagne]')!.textContent!.trim()).toBe('Aucune campagne OOH dans cet espace de travail.');
  });
```

`angular/src/app/features/carte/panneaux/donnees/panneau-donnees.component.spec.ts` : supprimer l'import `OohService` (ligne 12) et `OohService` des providers (ligne 68) ; dans le faux `CarteApi` (ligne 59), `ooh: vi.fn(() => NEVER),` devient `campagnesOoh: vi.fn(() => NEVER), campagneOoh: vi.fn(() => NEVER),` ; ligne 119, `['pois', 'ooh', 'transport', …]` devient `['pois', 'campagnesOoh', 'campagneOoh', 'transport', 'pprt', 'urlTuilesTmja', 'poiNatures', 'territoryMask']`.

`angular/src/app/features/carte/carte.page.spec.ts` : ligne 115, dans la valeur de `CarteApi`, `ooh: () => of(),` devient `campagnesOoh: () => of({ campagnes: [], tronque: false }), campagneOoh: () => of(),` ; dans le test `'/carte?etape=autres s’ouvre sur « Autres » ; les états OOH et radio survivent à la fermeture et à la réouverture'` :
- supprimer la ligne `    hote.querySelector<HTMLButtonElement>('mg-section-ooh [data-tout]')!.click();` ;
- les deux lignes `    expect(hote.querySelector('[data-afficher-ooh]')!.textContent!.trim()).toBe('Afficher — 8 régies');` deviennent `    expect(hote.querySelector('[data-aucune-campagne]')).not.toBeNull();`.

`tests/unit/angular/carte-couches-paritaire.test.ts`, test `'constantes de calques : OOH, transport, épingles, POI, rayons, modes d’isochrones'` :

```ts
  it('constantes de calques : transport, épingles, POI, rayons, modes d’isochrones ; OOH_REGIES n’est plus copié', () => {
    donneesEgales(Rfc, Acc, ['TRANSPORT_TYPES', 'PIN_SIZES', 'PIN_COLORS']);
    donneesEgales(Rfa, Acc, ['POI_TYPES', 'POI_RAYONS']);
    donneesEgales(Rfa, Ami, ['ISO_MODES', 'ISO_DURATIONS']);
    // React (gelé) garde son filtre par régies ; l'Angular choisit une campagne de l'espace (spec ooh-campagnes § 6).
    expect(Rfc.OOH_REGIES).toHaveLength(8);
    expect('OOH_REGIES' in Acc).toBe(false);
    expect(Ami.ISO_MODES.map((m) => m.id)).toEqual(['walk', 'bike', 'drive']);
  });
```

`tests/unit/angular/campagne-ooh-page.test.ts` :

```ts
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * La campagne OOH vit et meurt avec la page carte (spec 2026-10-16-ooh-campagnes § 6.5) : `CampagneOohService` est
 * fourni par `CartePage`, que `CarteHoteComponent` RECRÉE à chaque changement d'espace — l'overlay et la couche se
 * vident d'eux-mêmes. L'ancienne lecture par régies (`OohService`) n'existe plus côté Angular.
 */
const PAGE = 'angular/src/app/features/carte/carte.page.ts';

describe('campagne OOH — fournie par la page carte', () => {
  it('CampagneOohService est dans les providers de CartePage, OohService n y est plus', () => {
    const source = readFileSync(PAGE, 'utf8');
    const providers = source.slice(source.indexOf('providers: ['), source.indexOf('templateUrl'));
    expect(providers).toContain('CampagneOohService');
    expect(providers).not.toMatch(/\bOohService\b/);
  });

  it('la fiche d un emplacement est montée par la page, hors du @for du fond', () => {
    expect(readFileSync('angular/src/app/features/carte/carte.page.html', 'utf8')).toContain('<mg-fiche-emplacement-ooh />');
  });

  it('l ancien service par régies est supprimé', () => {
    expect(existsSync('angular/src/app/features/carte/couches/ooh.service.ts')).toBe(false);
  });
});
```

- [ ] **Step 6: Vérifier qu'aucune référence ne subsiste, relancer toutes les suites**

Run: `git grep -n "OohService\b\|regiesOoh\|OOH_REGIES\|CorpsOoh\|DELAI_OOH_MS\|api.ooh(" -- angular/src`
Expected: aucune ligne (le seul `OohService` restant est préfixé : `CampagneOohService`) — vérifier à l'œil chaque ligne rendue.

Run: `cd angular && npx ng test --watch=false`
Expected: PASS (suite Angular complète ; les dépassements de 5 s connus de `remote.spec.ts` sur poste chargé sont à signaler, pas à corriger).

Run: `npx vitest run --project unit tests/unit/angular/`
Expected: PASS.

Run: `cd angular && npx ng build`
Expected: build sans erreur.

- [ ] **Step 7: Documenter**

`angular/src/app/features/carte/README.md`, lignes 43-45, la phrase « Contenu : les sections Panneaux OOH et Radio, sorties de ② (on n'en construit pas de zones) ; leurs couches restent dans `OohService`/`RadioService` (page), leurs sections et régies dans le `SelectionsCalquesService` du panneau Autres, monté à la première ouverture puis gardé. » devient :

```markdown
  valeur inconnue est nettoyée comme d'habitude). Contenu : les sections Panneaux OOH et Radio, sorties de ② (on n'en
  construit pas de zones). « Panneaux OOH et DOOH » choisit une CAMPAGNE de l'espace (2026-10-16, spec
  ooh-campagnes § 6) : `CampagneOohService` (page) lit la liste à la première ouverture, puis la campagne choisie ;
  sa couche dédiée (`couches/couche-campagne-ooh.ts`, une teinte `--ligne-media-*` par ligne, anneau pointillé des
  points à vérifier) et sa fiche (`mg-fiche-emplacement-ooh`, à la place du tiroir Street View) ; la radio reste dans
  `RadioService`. Sections ouvertes : `SelectionsCalquesService` du panneau Autres, monté à la première ouverture puis gardé.
```

`ARCHITECTURE.md` :
- ligne `| \`/api/map/ooh\` | POST |` : ajouter en tête de la description « **N'est plus appelée par l'Angular depuis le 2026-10-16** (l'overlay choisit une campagne : `/api/map/ooh/campagnes`) ; reste pour le React gelé. » ;
- dans la liste des puces Angular de la carte (`Grep "Le bouton « Autres », hors du fil"`), ajouter après cette puce :

```markdown
- **Panneaux OOH d'une campagne (2026-10-16, spec `docs/superpowers/specs/2026-10-16-ooh-campagnes-design.md`)** : « Autres » → « Panneaux OOH et DOOH » (`mg-section-ooh`, contenu remplacé) liste les campagnes OOH de l'espace (`GET /api/map/ooh/campagnes`, lue à la première ouverture), puis la campagne choisie (`GET /api/map/ooh/campagnes/[id]`) : lignes dans l'ordre du plan (pastille `var(--ligne-media-n)`, régie · réseau, dates, écrans, budget TTC, contacts, case afficher/masquer, écart liste/plan, « n à vérifier », non placés dépliables), lignes sans liste (DROM) regroupées. État et couche : `CampagneOohService` (fourni par `CartePage` — un changement d'espace le détruit), `couches/couche-campagne-ooh.ts` (source GeoJSON, cercles colorés par ligne aux valeurs calculées, cerne `--poi-contour`, anneau pointillé `symbol` sur les points `a_verifier` — un cercle MapLibre n'a pas de trait pointillé), place dans `ORDRE_COUCHES` après `custom-zone-*`. Fiche `mg-fiche-emplacement-ooh` (même place que le tiroir Street View, l'un ferme l'autre) avec « Données de la régie » replié. Retirés de l'Angular : `OohService`, `CarteApi.ooh`, `OOH_REGIES`, `regiesOoh`.
```

- [ ] **Step 8: Commit**

```bash
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git rm angular/src/app/features/carte/couches/ooh.service.ts angular/src/app/features/carte/couches/ooh.service.spec.ts
git add angular/src/app/features/carte/panneaux/calques/section-ooh.component.ts angular/src/app/features/carte/panneaux/calques/section-ooh.component.spec.ts \
  angular/src/app/features/carte/couches/fiche-emplacement-ooh.component.ts angular/src/app/features/carte/couches/fiche-emplacement-ooh.component.spec.ts \
  angular/src/app/features/carte/carte.page.ts angular/src/app/features/carte/carte.page.html angular/src/app/features/carte/carte.page.spec.ts \
  angular/src/app/features/carte/panneaux/autres/panneau-autres.component.ts angular/src/app/features/carte/panneaux/autres/panneau-autres.component.spec.ts \
  angular/src/app/features/carte/panneaux/donnees/panneau-donnees.component.spec.ts angular/src/app/features/carte/data/carte.api.ts \
  angular/src/app/features/carte/data/carte.api.spec.ts angular/src/app/features/carte/panneaux/calques/selections-calques.service.ts \
  angular/src/app/features/carte/logique/constantes-calques.ts angular/src/app/features/carte/couches/pois.service.ts \
  tests/unit/angular/carte-couches-paritaire.test.ts tests/unit/angular/campagne-ooh-page.test.ts \
  angular/src/app/features/carte/README.md ARCHITECTURE.md
git commit -m "feat(angular): panneaux OOH d'une campagne dans « Autres », fiche d'emplacement, retrait du filtre par régies" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Import réel de TF4 en local, preuve navigateur dans les deux thèmes, écarts (§ 12) — menée par le contrôleur

**Files:**
- Modify: `docs/superpowers/specs/2026-10-16-ooh-campagnes-design.md` (§ 12 « Écarts à la livraison »)
- Modify: `sql/263_campagne_ooh_jsonb.sql` (bloc « Mesure » : la mesure sur TF4 réelle, en plus de la fixture)
- Modify: `ARCHITECTURE.md` (compteurs mesurés de TF4 dans la section « Campagnes multi-média »)
- Aucun fichier client, aucune capture d'écran dans le dépôt : captures dans le dossier SDD de la session, hors dépôt.

**Interfaces:**
- Consumes: tout ce qui précède. Le plan client est lu dans le checkout PRINCIPAL : `C:\GENESIS\genesis_app\PM OOH\PM  - LA MARINE NATIONALE TF4 SEPT 2026 V1.xlsx` (deux espaces après « PM »).
- Produces: la campagne « Marine nationale — TF4 septembre 2026 » dans l'espace `marine`, et les écarts consignés.

- [ ] **Step 1: Suites complètes avant l'import**

Run (racine, sans pipe) : `npx tsc --noEmit` ; `npm run test:unit` ; `npm run test:integration` ; `npm run lint`.
Expected: tout PASS (seul échec connu admis à signaler sans corriger : l'attente « habitants » de zone-risque, 41 025 366 vs 42 409 940).

Run: `cd angular && npx ng test --watch=false` puis `cd angular && npx ng build`.
Expected: PASS.

- [ ] **Step 2: Import à blanc**

```bash
cd /c/GENESIS/genesis_app/.claude/worktrees/ooh-campagnes
npx tsx scripts/ooh/importer-plan.ts --plan "/c/GENESIS/genesis_app/PM OOH/PM  - LA MARINE NATIONALE TF4 SEPT 2026 V1.xlsx" \
  --espace marine --campagne "Marine nationale — TF4 septembre 2026" --vague TF4 --cle marine-tf4-2026 \
  --annonceur "Marine nationale" --rapport "$TEMP" --a-blanc
```

Expected, à relever pour le § 12 : 4 onglets ; **11 lignes** (3 métropole + 8 DROM-COM : La Réunion ×2, Guadeloupe, Martinique, Guyane, Nouvelle-Calédonie, Mayotte, Polynésie) ; adaptateurs `synthese-hyp, mediatransports-gares, basic-fit, stride-campus` ; ligne 1 MEDIATRANSPORTS ≈ 215 emplacements, ligne 2 BASIC FIT ≈ 880-890 clubs, ligne 3 STRIDE ≈ 133 lieux, lignes 4-11 « liste non fournie » ; référentiel SNCF ≈ 2 790 gares ; compteurs du tableau final. Attendu mesuré au plan pour les gares : **215 placées, 0 à vérifier, 0 non placée, 215 UIC distincts** (183 par le nom, 32 par alias). Si un alias rend « alias périmé », le référentiel a changé depuis le 16/10 : corriger l'entrée de `ALIAS_GARES` (nom exact et INSEE relus dans le CSV) dans un commit `fix:` avant d'écrire.

- [ ] **Step 3: Import réel, puis rejeu**

Relancer la même commande SANS `--a-blanc`.
Expected: « campagne <uuid> : 11 ligne(s), N panneau(x) écrit(s), N lien(s), 0 panneau(x) retiré(s) », aucune ligne `ERREUR`.

Relancer une troisième fois (rejeu) SANS `--a-blanc`.
Expected: même campagne, mêmes compteurs, `0 panneau(x) retiré(s)`. Vérifier en base :

```bash
docker exec supabase_db_genesis_app psql -U postgres -c "
select l.ordre, l.regie, coalesce(l.reseau, l.territoire) as reseau, l.nb_ecrans, count(clp.panneau_id) as places,
       count(*) filter (where p.geoloc_qualite = 'a_verifier') as a_verifier,
       coalesce(jsonb_array_length(l.details->'non_places'), 0) as non_places
  from campagnes c join campagne_lignes l on l.campagne_id = c.id
  left join campagne_ligne_panneaux clp on clp.ligne_id = l.id
  left join panneaux_affichage p on p.id = clp.panneau_id
 where c.cle_import = 'marine-tf4-2026'
 group by l.id order by l.ordre;"
docker exec supabase_db_genesis_app psql -U postgres -c "
select ds.name, ds.visibilite, o.slug, count(p.id) from data_sources ds join organizations o on o.id = ds.organization_id
  left join panneaux_affichage p on p.data_source_id = ds.id where ds.mapping->>'campagne_cle' = 'marine-tf4-2026' group by 1,2,3;"
```

Expected: trois sources `privee` de l'espace `marine` ; les compteurs par ligne égaux à ceux du script.

- [ ] **Step 4: Mesure sur la campagne réelle**

```bash
docker exec supabase_db_genesis_app psql -U postgres -c "\timing on" -c "
select length(public.campagne_ooh_jsonb(c.id, c.organization_id)::text) as octets
  from campagnes c where c.cle_import = 'marine-tf4-2026';"
```

Puis l'`EXPLAIN (ANALYZE, BUFFERS)` de la requête des emplacements de la tâche 4 (étape 5) avec l'id réel. Ajouter au bloc « Mesure » de `sql/263_campagne_ooh_jsonb.sql` une ligne « TF4 réelle (16/10) : N emplacements, X ms, Y octets, buffers … ».

- [ ] **Step 5: Preuve navigateur, deux thèmes**

Lancer `npm run dev` (Next, :3000) et `cd angular && npm start` (:4200, `/api` → :3000). Se connecter en super_admin (identifiants dev locaux, mémoire « GEOMATIK admin credentials »), choisir l'espace **Marine nationale**, ouvrir la carte, bouton « Autres ». Captures (thème sombre PUIS thème clair, mêmes vues), dans le dossier SDD de la session :

1. « Panneaux OOH et DOOH » replié, puis déplié : la liste avec « Marine nationale — TF4 septembre 2026 · TF4 · 20/09/2026 → 02/10/2026 · 11 lignes ».
2. TF4 choisie : les trois lignes métropole (pastilles de trois teintes différentes), l'écart Basic-Fit (« N clubs placés · plan : 905 clubs, 4 802 écrans »), « n à vérifier », les non placés dépliés, le bloc des 8 lignes DROM-COM avec « Liste des emplacements non fournie par la régie. ».
3. La carte recadrée sur la France métropolitaine, points des trois réseaux ; zoom sur un point à vérifier (anneau pointillé visible).
4. La fiche d'un emplacement de CHAQUE réseau (une gare, un club Basic-Fit, un lieu Stride), « Données de la régie » déplié pour l'un d'eux ; la fiche d'un point à vérifier.
5. Une ligne décochée : ses points disparaissent ; recochée : ils reviennent.
6. « Tout effacer » (boîte à outils) : la couche disparaît, la section revient à la liste.
7. Changement d'espace vers **BMW GROUP** : l'overlay est vide (« Aucune campagne OOH dans cet espace de travail. »), aucun point ; retour à Marine : la liste revient.
8. Console du navigateur sans erreur MapLibre (`addLayer`, `addImage`, expression).

Vérifier aussi par l'onglet Réseau : une seule requête `GET /api/map/ooh/campagnes` à la première ouverture de la section, aucune à l'ouverture de la carte.

- [ ] **Step 6: Consigner les écarts (§ 12 de la spec)**

Remplacer « (à remplir à la fin du chantier) » du § 12 de `docs/superpowers/specs/2026-10-16-ooh-campagnes-design.md` par la liste RELEVÉE, au minimum :
- compteurs réels par réseau (lus, sûrs, à vérifier, non placés) et l'écart Basic-Fit affiché (clubs placés vs 905, lecteurs vs 4 802) — la spec annonçait 882 clubs ; le décompte du 16/10 au plan donnait 886 codes club distincts plus ≈ 25 clubs sans code : dire le chiffre MESURÉ ;
- 11 lignes de campagne et non 4 : une ligne par ligne du plan (La Réunion en porte deux, budgets et formats différents) ; l'overlay les regroupe en 3 lignes métropole + un bloc DROM-COM ;
- table d'alias : 32 entrées et non 21 (11 noms composés tombaient sur la mauvaise gare) ; ordre plein → dernière partie → première + dernière → première ;
- anneau pointillé par un calque `symbol` (MapLibre n'a pas de trait pointillé de cercle) ;
- une source privée par RÉSEAU (adaptateur), confondue ici avec « par ligne » : une liste n'est rattachée qu'à la première ligne de sa régie ;
- `checkImportRateLimit` n'a plus d'appelant de production après le retrait d'ArcGIS (test réécrit sur une clé d'essai) ;
- deuxième RPC `campagnes_ooh_jsonb` pour la liste (la spec ne nommait que `campagne_ooh_jsonb`) ;
- dates de campagne prises dans le titre du plan (« 20/09 - 02/10 ») ; les dates de fin des lignes, calculées départ + durée − 1, vont jusqu'au 04/10 pour Mediatransports (« 2 semaines » depuis le 21/09) ;
- mesures de `campagne_ooh_jsonb` sur TF4.

Mettre les compteurs mesurés dans la section « Campagnes multi-média » d'`ARCHITECTURE.md`.

- [ ] **Step 7: Commit**

```bash
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add docs/superpowers/specs/2026-10-16-ooh-campagnes-design.md sql/263_campagne_ooh_jsonb.sql ARCHITECTURE.md
git commit -m "docs: écarts de la livraison OOH campagnes — import réel de TF4 et preuve navigateur" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Couverture de la spec (auto-relecture)

| Spec | Tâche |
|---|---|
| § 1.1 purge Brest | 1 |
| § 1.2-1.3, § 4.2 campagnes multi-média, modèle 1 | 2 |
| § 1.4, § 6 overlay « Autres » | 10, 11 |
| § 1.5, § 4.4 panneaux privés à la campagne | 2 (RLS), 8 (source privée) |
| § 1.6, § 10 suppression ArcGIS | 1 |
| § 1.7 écart Basic-Fit affiché | 5 (nb_lieux_plan), 10 (`libelleEcart`), 11 |
| § 1.8, § 4.3 panneaux enrichis, import générique | 3, 5-8 |
| § 4.5 lecture jsonb, EXPLAIN | 4, 12 |
| § 5 routes | 9 |
| § 6.3 couche dédiée, couleurs `--ligne-media-*` | 10 |
| § 6.4 fiche, Street View, « Données de la régie » | 11 |
| § 6.5 changement d'espace, effacement | 10 (`inscrireEffacement`), 11 (fourni par la page) |
| § 7 script : étapes, progression, à blanc, adaptateurs, géolocalisation, lots de 50, rapport hors dépôt | 5-8 |
| § 8 preuves | chaque tâche ; navigateur et import réel : 12 |
| § 9 risques (homonymes, Basic-Fit sans CP, volume, nom « campagne ») | 7, 4, 2 (ARCHITECTURE) |
| § 12 écarts | 12 |
