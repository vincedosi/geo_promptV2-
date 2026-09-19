# Import ICPE Géorisques — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** faire entrer les 138 423 installations classées (ICPE) de Géorisques en base comme catégorie de POI `risque_industriel`, filtrable par nature de risque et colorée par gravité.

**Architecture:** aucune table nouvelle pour les points — `poi_france` porte tout. Un registre en base (`icpe_rubrique_familles`) traduit le préfixe de rubrique en nature de risque et donne le rang qui départage la nature dominante. Une fonction pure fait tout le classement (testable sans base ni réseau), une route NDJSON fait l'ingestion par lots de 50 avec identifiant déterministe.

**Tech Stack:** Next.js 15 App Router · TypeScript strict · Supabase (PostgreSQL 17 + PostGIS) · Zod · Vitest · API REST Géorisques v1 (sans jeton)

**Spec:** `docs/superpowers/specs/2026-09-17-georisques-icpe-design.md` (commit 28cf3f6)

## Global Constraints

- Source : `GET https://www.georisques.gouv.fr/api/v1/installations_classees`, **sans jeton**, `page_size` **maximum 1 000** (2 000 rend 0 ligne — mesuré).
- Volume : **138 423** lignes nationales ; **139 appels** sortants ; écritures par **lots de 50 maximum**, une seule requête par lot.
- Le filtre `statut_seveso` de l'API **est ignoré** : ne jamais s'y fier, classer en base.
- Tout appel sortant passe par `lib/http/lecture-avec-reprise.ts` (lecture idempotente). Jamais un `fetch` nu.
- Tout corps de requête passe par `lireCorps()` de `lib/api/valider-corps.ts`. Jamais `await request.json()`.
- `upsert(..., { onConflict: 'id' })` **suivi de `.select('id')`** — sinon « inséré » et « déjà présent » sont indiscernables.
- Toute route API : `export const dynamic = 'force-dynamic'`, `requireAdmin()`, client par `createAdminClient()` de `@/lib/auth`.
- Import = **progression obligatoire** : pourcentage, lignes traitées/total, étapes nommées, compteurs finaux. Jamais de traitement DB silencieux.
- Couleurs : uniquement les jetons du DESIGN_SYSTEM (`--seq-1..5`, `--donnee-absente`). Jamais de hex en dur. Pas de violet. Sentence case.
- `ARCHITECTURE.md` mis à jour **dans le même commit** que le code qui l'affecte.
- Migrations SQL par **MCP Supabase** (`apply_migration`), jamais de SQL manuel demandé à l'utilisateur.

---

### Task 1: Registre des familles de rubriques + catégorie POI

**Files:**
- Create: `sql/173_icpe_rubrique_familles.sql` (trace versionnée de la migration)
- Test: `tests/unit/import/icpe-registre.test.ts`

**Interfaces:**
- Produces: table `icpe_rubrique_familles(prefixe text PK, libelle text NOT NULL, rang_gravite int NOT NULL)`, et une ligne `poi_categories` avec `categorie='risque_industriel'`.
- Produces: la constante `FAMILLES_ICPE_SEED` exportée par `lib/import/georisques/familles.ts` (Task 2), qui doit rester le miroir exact du seed SQL.

- [ ] **Step 1: Écrire le test qui échoue** (`tests/unit/import/icpe-registre.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { FAMILLES_ICPE_SEED } from '@/lib/import/georisques/familles';

describe('registre des familles de rubriques ICPE', () => {
  it('couvre les neuf familles mesurées sur la source le 2026-09-17', () => {
    // Relevé réel sur 400 sites du département 13 : ces préfixes existent
    // dans la donnée, le registre doit donc les nommer.
    const mesurees = ['41', '43', '45', '47', '14', '15', '27', '34', '35', '29', '25', '26'];
    const connus = new Set(FAMILLES_ICPE_SEED.map((f) => f.prefixe));
    expect(mesurees.filter((p) => !connus.has(p))).toEqual([]);
  });

  it('attribue un rang de gravité unique et décroissant au toxique', () => {
    const rang = (p: string) => FAMILLES_ICPE_SEED.find((f) => f.prefixe === p)!.rang_gravite;
    // La toxicité aiguë primve sur les matériaux : c'est ce rang qui départage
    // la nature dominante d'un site qui porte les deux.
    expect(rang('41')).toBeGreaterThan(rang('25'));
    expect(rang('47')).toBeGreaterThan(rang('29'));
  });

  it('ne déclare aucun rang en double — sinon la nature dominante ne serait pas déterministe', () => {
    const rangs = FAMILLES_ICPE_SEED.map((f) => f.rang_gravite);
    expect(new Set(rangs).size).toBe(rangs.length);
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `npx vitest run tests/unit/import/icpe-registre.test.ts`
Expected: FAIL — `Cannot find module '@/lib/import/georisques/familles'`

- [ ] **Step 3: Écrire le seed TypeScript** (`lib/import/georisques/familles.ts`)

```ts
/**
 * @file lib/import/georisques/familles.ts
 *
 * Miroir TypeScript du seed de `icpe_rubrique_familles`.
 *
 * Pourquoi les deux : le classement tourne dans le processus d'import (donc en
 * TS, sans aller-retour base par ligne), mais le libellé affiché doit rester
 * modifiable sans déploiement — d'où la table. Le test
 * `tests/unit/import/icpe-registre.test.ts` verrouille la couverture des
 * familles mesurées ; la dérive libellé TS ↔ base est acceptée et sans effet,
 * seul le `rang_gravite` compte pour le classement.
 */
export interface FamilleIcpe {
  prefixe: string;
  libelle: string;
  rang_gravite: number;
}

export const FAMILLES_ICPE_SEED: FamilleIcpe[] = [
  { prefixe: '41', libelle: 'Toxicité aiguë', rang_gravite: 100 },
  { prefixe: '42', libelle: 'Explosibles', rang_gravite: 95 },
  { prefixe: '47', libelle: 'GPL et produits pétroliers', rang_gravite: 90 },
  { prefixe: '43', libelle: 'Gaz et liquides inflammables', rang_gravite: 85 },
  { prefixe: '14', libelle: 'Inflammables (ancienne nomenclature)', rang_gravite: 80 },
  { prefixe: '27', libelle: 'Déchets', rang_gravite: 75 },
  { prefixe: '45', libelle: "Dangereux pour le milieu aquatique", rang_gravite: 70 },
  { prefixe: '34', libelle: 'Chimie (IED)', rang_gravite: 65 },
  { prefixe: '35', libelle: 'Déchets (IED)', rang_gravite: 60 },
  { prefixe: '15', libelle: 'Entrepôts et stockages', rang_gravite: 55 },
  { prefixe: '29', libelle: 'Combustion et refroidissement', rang_gravite: 50 },
  { prefixe: '26', libelle: 'Plastiques et caoutchouc', rang_gravite: 45 },
  { prefixe: '25', libelle: 'Matériaux et minéraux', rang_gravite: 40 },
  { prefixe: '22', libelle: 'Agroalimentaire et divers', rang_gravite: 35 },
  { prefixe: '11', libelle: 'Fluides frigorigènes', rang_gravite: 30 },
];

/** Nature servie quand aucun préfixe connu ne s'applique, ou qu'il n'y a aucune rubrique. */
export const NATURE_NON_PRECISEE = 'Nature non précisée';
```

- [ ] **Step 4: Lancer le test, vérifier qu'il passe**

Run: `npx vitest run tests/unit/import/icpe-registre.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Appliquer la migration** via MCP Supabase `apply_migration`, nom `icpe_rubrique_familles`, et déposer le même SQL dans `sql/173_icpe_rubrique_familles.sql`

```sql
create table if not exists public.icpe_rubrique_familles (
  prefixe      text primary key,
  libelle      text not null,
  rang_gravite int  not null unique
);
comment on table public.icpe_rubrique_familles is
  'Familles de rubriques ICPE : traduit le prefixe du numero de rubrique en nature de risque. rang_gravite ne sert QUA departager la nature dominante dun site qui porte plusieurs rubriques (spec 2026-09-17). Miroir TS : lib/import/georisques/familles.ts';

alter table public.icpe_rubrique_familles enable row level security;
-- RLS deny-all : lue par le service_role uniquement, comme les autres registres.

insert into public.icpe_rubrique_familles (prefixe, libelle, rang_gravite) values
  ('41','Toxicité aiguë',100),
  ('42','Explosibles',95),
  ('47','GPL et produits pétroliers',90),
  ('43','Gaz et liquides inflammables',85),
  ('14','Inflammables (ancienne nomenclature)',80),
  ('27','Déchets',75),
  ('45','Dangereux pour le milieu aquatique',70),
  ('34','Chimie (IED)',65),
  ('35','Déchets (IED)',60),
  ('15','Entrepôts et stockages',55),
  ('29','Combustion et refroidissement',50),
  ('26','Plastiques et caoutchouc',45),
  ('25','Matériaux et minéraux',40),
  ('22','Agroalimentaire et divers',35),
  ('11','Fluides frigorigènes',30)
on conflict (prefixe) do update set libelle = excluded.libelle, rang_gravite = excluded.rang_gravite;

insert into public.poi_categories (categorie, sous_categorie, label_fr, icone, couleur_carte, source_defaut, actif, description)
values ('risque_industriel', null, 'Zones risque indus', 'factory', 'var(--seq-3)', 'georisques_icpe', true,
        'Installations classees pour la protection de lenvironnement (ICPE), source Georisques. Gravite en sous_categorie, nature du risque dans metadata.libelle_nature.')
on conflict do nothing;
```

- [ ] **Step 6: Vérifier en base**

Run (MCP `execute_sql`): `select count(*) from icpe_rubrique_familles;` → 15
Run: `select categorie, label_fr from poi_categories where categorie = 'risque_industriel';` → une ligne

- [ ] **Step 7: Commit**

```bash
git add sql/173_icpe_rubrique_familles.sql lib/import/georisques/familles.ts tests/unit/import/icpe-registre.test.ts
git commit -m "feat(georisques): registre des familles de rubriques ICPE + categorie POI"
```

---

### Task 2: Classement pur — gravité et nature dominante

**Files:**
- Create: `lib/import/georisques/classement.ts`
- Test: `tests/unit/import/icpe-classement.test.ts`

**Interfaces:**
- Consumes: `FAMILLES_ICPE_SEED`, `NATURE_NON_PRECISEE` (Task 1).
- Produces:
  - `export interface RubriqueIcpe { numeroRubrique: string | null; nature?: string | null; regimeAutoriseAlinea?: string | null; quantiteTotale?: string | null; unite?: string | null }`
  - `export interface SiteIcpeBrut { codeAIOT: string; raisonSociale: string | null; adresse1?: string | null; adresse2?: string | null; adresse3?: string | null; codePostal?: string | null; codeInsee?: string | null; commune?: string | null; longitude: number | null; latitude: number | null; regime?: string | null; statutSeveso?: string | null; ied?: boolean | null; prioriteNationale?: boolean | null; etatActivite?: string | null; serviceAIOT?: string | null; siret?: string | null; codeNaf?: string | null; date_maj?: string | null; rubriques?: RubriqueIcpe[] | null; inspections?: Array<{ dateInspection?: string | null }> | null }`
  - `export type GraviteIcpe = 'seveso_haut' | 'seveso_bas' | 'ied' | 'autorisation' | 'enregistrement' | 'autre'`
  - `export function graviteIcpe(site: SiteIcpeBrut): GraviteIcpe`
  - `export function naturesDuSite(site: SiteIcpeBrut): string[]`
  - `export function natureDominante(site: SiteIcpeBrut): string`

- [ ] **Step 1: Écrire le test qui échoue** (`tests/unit/import/icpe-classement.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { graviteIcpe, natureDominante, naturesDuSite } from '@/lib/import/georisques/classement';
import type { SiteIcpeBrut } from '@/lib/import/georisques/classement';

const site = (p: Partial<SiteIcpeBrut>): SiteIcpeBrut => ({
  codeAIOT: '0006400036', raisonSociale: 'TEST', longitude: 5.3, latitude: 43.3, ...p,
});

describe('gravité ICPE — première règle qui s applique', () => {
  it('Seveso seuil haut primve sur tout', () => {
    expect(graviteIcpe(site({ statutSeveso: 'Seveso seuil haut', regime: 'Autorisation', ied: true }))).toBe('seveso_haut');
  });
  it('Seveso seuil bas primve sur IED', () => {
    expect(graviteIcpe(site({ statutSeveso: 'Seveso seuil bas', ied: true }))).toBe('seveso_bas');
  });
  it('IED sans Seveso', () => {
    expect(graviteIcpe(site({ statutSeveso: 'Non Seveso', ied: true, regime: 'Autorisation' }))).toBe('ied');
  });
  it('Autorisation', () => {
    expect(graviteIcpe(site({ statutSeveso: 'Non Seveso', ied: false, regime: 'Autorisation' }))).toBe('autorisation');
  });
  it('Enregistrement', () => {
    expect(graviteIcpe(site({ statutSeveso: 'Non Seveso', regime: 'Enregistrement' }))).toBe('enregistrement');
  });
  it('« Non ICPE » et « Autres régimes » tombent dans autre', () => {
    expect(graviteIcpe(site({ regime: 'Non ICPE' }))).toBe('autre');
    expect(graviteIcpe(site({ regime: 'Autres régimes' }))).toBe('autre');
  });
  it('statutSeveso null ne fait pas planter — 31 sites sur 200 mesurés', () => {
    expect(graviteIcpe(site({ statutSeveso: null, regime: null, ied: null }))).toBe('autre');
  });
});

describe('nature du risque', () => {
  it('rend toutes les natures du site, dédoublonnées', () => {
    const s = site({ rubriques: [
      { numeroRubrique: '4734' }, { numeroRubrique: '4718' }, { numeroRubrique: '2515' },
    ] });
    expect(naturesDuSite(s)).toEqual(['GPL et produits pétroliers', 'Matériaux et minéraux']);
  });
  it('retient la nature de plus haut rang de gravité comme dominante', () => {
    const s = site({ rubriques: [{ numeroRubrique: '2515' }, { numeroRubrique: '4110' }] });
    expect(natureDominante(s)).toBe('Toxicité aiguë');
  });
  it('départage un rang égal par la quantité, pour rester déterministe', () => {
    const s = site({ rubriques: [
      { numeroRubrique: '4734', quantiteTotale: '10' },
      { numeroRubrique: '4718', quantiteTotale: '900' },
    ] });
    // Même famille 47 : la quantité tranche, donc le résultat ne dépend pas
    // de l'ordre dans lequel l'API a renvoyé les rubriques.
    expect(natureDominante(s)).toBe('GPL et produits pétroliers');
  });
  it('rubriques vides ou absentes → nature non précisée (40 % des sites)', () => {
    expect(natureDominante(site({ rubriques: [] }))).toBe('Nature non précisée');
    expect(natureDominante(site({ rubriques: null }))).toBe('Nature non précisée');
  });
  it('préfixe inconnu → nature non précisée, sans exception', () => {
    expect(natureDominante(site({ rubriques: [{ numeroRubrique: '9999' }] }))).toBe('Nature non précisée');
  });
  it('numéro de rubrique nul ou trop court est ignoré', () => {
    expect(natureDominante(site({ rubriques: [{ numeroRubrique: null }, { numeroRubrique: '4' }] }))).toBe('Nature non précisée');
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `npx vitest run tests/unit/import/icpe-classement.test.ts`
Expected: FAIL — module `classement` introuvable

- [ ] **Step 3: Écrire l'implémentation** (`lib/import/georisques/classement.ts`)

```ts
/**
 * @file lib/import/georisques/classement.ts
 *
 * Classement d'une installation classée : sa GRAVITÉ (qui colore) et sa NATURE
 * de risque (qui filtre). Fonctions pures — aucun accès base, aucun réseau,
 * donc testables sur table de vérité.
 *
 * Deux décisions de la spec 2026-09-17 sont encodées ici :
 *
 *  - Le filtre carte porte sur UNE nature, la DOMINANTE, parce que le
 *    mécanisme existant fait `.in('metadata->>libelle_nature', …)` sur un
 *    champ scalaire. `naturesDuSite()` rend la liste complète pour le panneau
 *    de détail, mais elle ne filtre pas.
 *  - La dominante doit être DÉTERMINISTE : l'API ne garantit pas l'ordre des
 *    rubriques, et un réimport qui changerait la couleur d'un point serait
 *    indétectable à l'œil. D'où le départage explicite rang → quantité →
 *    numéro de rubrique.
 */
import { FAMILLES_ICPE_SEED, NATURE_NON_PRECISEE } from './familles';

export interface RubriqueIcpe {
  numeroRubrique: string | null;
  nature?: string | null;
  regimeAutoriseAlinea?: string | null;
  quantiteTotale?: string | null;
  unite?: string | null;
}

export interface SiteIcpeBrut {
  codeAIOT: string;
  raisonSociale: string | null;
  adresse1?: string | null;
  adresse2?: string | null;
  adresse3?: string | null;
  codePostal?: string | null;
  codeInsee?: string | null;
  commune?: string | null;
  longitude: number | null;
  latitude: number | null;
  regime?: string | null;
  statutSeveso?: string | null;
  ied?: boolean | null;
  prioriteNationale?: boolean | null;
  etatActivite?: string | null;
  serviceAIOT?: string | null;
  siret?: string | null;
  codeNaf?: string | null;
  date_maj?: string | null;
  rubriques?: RubriqueIcpe[] | null;
  inspections?: Array<{ dateInspection?: string | null }> | null;
}

export type GraviteIcpe =
  | 'seveso_haut' | 'seveso_bas' | 'ied' | 'autorisation' | 'enregistrement' | 'autre';

const PAR_PREFIXE = new Map(FAMILLES_ICPE_SEED.map((f) => [f.prefixe, f]));

export function graviteIcpe(site: SiteIcpeBrut): GraviteIcpe {
  const seveso = (site.statutSeveso ?? '').trim();
  if (seveso === 'Seveso seuil haut') return 'seveso_haut';
  if (seveso === 'Seveso seuil bas') return 'seveso_bas';
  if (site.ied === true) return 'ied';
  const regime = (site.regime ?? '').trim();
  if (regime === 'Autorisation') return 'autorisation';
  if (regime === 'Enregistrement') return 'enregistrement';
  return 'autre';
}

/** Rubriques utilisables : numéro d'au moins 2 caractères et préfixe connu. */
function rubriquesConnues(site: SiteIcpeBrut) {
  return (site.rubriques ?? [])
    .map((r) => {
      const num = (r.numeroRubrique ?? '').trim();
      if (num.length < 2) return null;
      const famille = PAR_PREFIXE.get(num.slice(0, 2));
      if (!famille) return null;
      const quantite = Number(r.quantiteTotale ?? 0);
      return { num, famille, quantite: Number.isFinite(quantite) ? quantite : 0 };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

export function naturesDuSite(site: SiteIcpeBrut): string[] {
  const vues = new Set<string>();
  for (const r of rubriquesConnues(site)) vues.add(r.famille.libelle);
  return [...vues];
}

export function natureDominante(site: SiteIcpeBrut): string {
  const candidates = rubriquesConnues(site);
  if (candidates.length === 0) return NATURE_NON_PRECISEE;
  candidates.sort((a, b) =>
    b.famille.rang_gravite - a.famille.rang_gravite ||
    b.quantite - a.quantite ||
    a.num.localeCompare(b.num));
  return candidates[0].famille.libelle;
}
```

- [ ] **Step 4: Lancer le test, vérifier qu'il passe**

Run: `npx vitest run tests/unit/import/icpe-classement.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/import/georisques/classement.ts tests/unit/import/icpe-classement.test.ts
git commit -m "feat(georisques): classement pur gravite + nature dominante"
```

---

### Task 3: Identité déterministe sur un identifiant externe

**Files:**
- Modify: `lib/import/identite-poi.ts` (ajout d'une fonction, rien de retiré)
- Test: `tests/unit/import/icpe-identite.test.ts`

**Interfaces:**
- Produces: `export function identitePoiSourceExterne(source: string, refExterne: string): string`

- [ ] **Step 1: Écrire le test qui échoue**

```ts
import { describe, it, expect } from 'vitest';
import { identitePoiSourceExterne, identitePoi } from '@/lib/import/identite-poi';

describe('identité sur identifiant externe', () => {
  it('est stable : même source + même référence → même UUID', () => {
    const a = identitePoiSourceExterne('georisques_icpe', '0006400036');
    const b = identitePoiSourceExterne('georisques_icpe', '0006400036');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('sépare deux références voisines', () => {
    expect(identitePoiSourceExterne('georisques_icpe', '0006400036'))
      .not.toBe(identitePoiSourceExterne('georisques_icpe', '0006400037'));
  });
  it('sépare deux sources portant la même référence', () => {
    expect(identitePoiSourceExterne('georisques_icpe', '1'))
      .not.toBe(identitePoiSourceExterne('autre_source', '1'));
  });
  it('ne collisionne pas avec identitePoi, qui compose une autre clé', () => {
    expect(identitePoiSourceExterne('georisques_icpe', 'X'))
      .not.toBe(identitePoi({ source: 'georisques_icpe', categorie: 'risque_industriel', nom: 'X', adresse: null, code_postal: null, ville: null, lat: 0, lng: 0 }));
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npx vitest run tests/unit/import/icpe-identite.test.ts`
Expected: FAIL — `identitePoiSourceExterne` n'existe pas

- [ ] **Step 3: Ajouter la fonction à la fin de `lib/import/identite-poi.ts`**

```ts
/**
 * Identité d'un POI qui vient d'une source portant DÉJÀ un identifiant stable
 * (ex. `codeAIOT` pour une installation classée Géorisques).
 *
 * `identitePoi()` ci-dessus compose sa clé du nom, de l'adresse et des
 * coordonnées, parce que les fichiers importés n'apportent aucun identifiant.
 * Quand la source en fournit un, il est strictement meilleur : il survit à un
 * changement de raison sociale, à une correction d'adresse ou à un
 * repositionnement du point, là où la clé composée créerait un doublon.
 *
 * Le préfixe de source est inclus pour que deux référentiels utilisant la même
 * numérotation ne se télescopent pas.
 */
export function identitePoiSourceExterne(source: string, refExterne: string): string {
  const cle = ['ref-externe', normaliserTexte(source), normaliserTexte(refExterne)].join(SEP);
  return uuidV5(cle, ESPACE_POI);
}
```

- [ ] **Step 4: Lancer, vérifier le succès**

Run: `npx vitest run tests/unit/import/icpe-identite.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/import/identite-poi.ts tests/unit/import/icpe-identite.test.ts
git commit -m "feat(import): identite deterministe sur identifiant externe de source"
```

---

### Task 4: Normalisation d'un site en ligne `poi_france`

**Files:**
- Modify: `lib/import/georisques/classement.ts` (ajout de `normaliserSiteIcpe`)
- Test: `tests/unit/import/icpe-normalisation.test.ts`

**Interfaces:**
- Consumes: `graviteIcpe`, `natureDominante`, `naturesDuSite` (Task 2), `identitePoiSourceExterne` (Task 3).
- Produces: `export const SOURCE_ICPE = 'georisques_icpe'`, `export const CATEGORIE_ICPE = 'risque_industriel'`, `export function normaliserSiteIcpe(site: SiteIcpeBrut): LignePoiIcpe | null` — rend `null` quand le site est inutilisable (pas de `codeAIOT`, ou coordonnées absentes).

- [ ] **Step 1: Écrire le test qui échoue**

```ts
import { describe, it, expect } from 'vitest';
import { normaliserSiteIcpe, SOURCE_ICPE, CATEGORIE_ICPE } from '@/lib/import/georisques/classement';
import { identitePoiSourceExterne } from '@/lib/import/identite-poi';

const brut = {
  codeAIOT: '0006400036', raisonSociale: 'BRENNTAG MEDITERRANEE',
  adresse1: '  ZI LES ESTROUBLANS ', adresse2: 'RUE DE LA MER', adresse3: null,
  codePostal: '13127', codeInsee: '13117', commune: 'Vitrolles',
  longitude: 5.2467, latitude: 43.4419,
  regime: 'Autorisation', statutSeveso: 'Seveso seuil haut', ied: false,
  prioriteNationale: true, etatActivite: 'En exploitation avec titre',
  serviceAIOT: 'DREAL PACA', siret: '30000000000018', codeNaf: '4675Z',
  date_maj: '2026-06-11/15-11-56',
  rubriques: [{ numeroRubrique: '4110', nature: 'Toxicité aiguë catégorie 1', quantiteTotale: '12.5', unite: 't' }],
  inspections: [{ dateInspection: '2026-04-07' }, { dateInspection: '2025-02-01' }],
};

describe('normalisation ICPE vers poi_france', () => {
  const ligne = normaliserSiteIcpe(brut)!;

  it('pose un id déterministe dérivé du codeAIOT', () => {
    expect(ligne.id).toBe(identitePoiSourceExterne(SOURCE_ICPE, '0006400036'));
  });
  it('classe la gravité en sous_categorie et la nature en metadata', () => {
    expect(ligne.categorie).toBe(CATEGORIE_ICPE);
    expect(ligne.sous_categorie).toBe('seveso_haut');
    expect(ligne.metadata.libelle_nature).toBe('Toxicité aiguë');
    expect(ligne.metadata.natures_risque).toEqual(['Toxicité aiguë']);
  });
  it('recolle et détrime l adresse — les données publiques portent des espaces invisibles', () => {
    expect(ligne.adresse).toBe('ZI LES ESTROUBLANS RUE DE LA MER');
  });
  it('garde la traçabilité de la source et de sa fraîcheur', () => {
    expect(ligne.source).toBe(SOURCE_ICPE);
    expect(ligne.metadata.code_aiot).toBe('0006400036');
    expect(ligne.metadata.date_maj_source).toBe('2026-06-11');
    expect(ligne.metadata.derniere_inspection).toBe('2026-04-07');
    expect(ligne.metadata.nb_inspections).toBe(2);
  });
  it('écarte un site sans coordonnées plutôt que de le poser en (0,0)', () => {
    expect(normaliserSiteIcpe({ ...brut, longitude: null })).toBeNull();
    expect(normaliserSiteIcpe({ ...brut, latitude: null })).toBeNull();
  });
  it('écarte un site sans codeAIOT — sans lui, aucune identité stable', () => {
    expect(normaliserSiteIcpe({ ...brut, codeAIOT: '' })).toBeNull();
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npx vitest run tests/unit/import/icpe-normalisation.test.ts`
Expected: FAIL — `normaliserSiteIcpe` n'existe pas

- [ ] **Step 3: Ajouter à `lib/import/georisques/classement.ts`**

```ts
import { identitePoiSourceExterne } from '../identite-poi';

export const SOURCE_ICPE = 'georisques_icpe';
export const CATEGORIE_ICPE = 'risque_industriel';

export interface LignePoiIcpe {
  id: string;
  categorie: string;
  sous_categorie: GraviteIcpe;
  nom: string | null;
  adresse: string | null;
  ville: string | null;
  code_postal: string | null;
  lat: number;
  lng: number;
  source: string;
  metadata: Record<string, unknown>;
}

/** `2026-06-11/15-11-56` → `2026-06-11`. La source colle l'heure à la date. */
function dateSeule(valeur: string | null | undefined): string | null {
  const v = (valeur ?? '').trim();
  return v ? v.split('/')[0] : null;
}

export function normaliserSiteIcpe(site: SiteIcpeBrut): LignePoiIcpe | null {
  const codeAiot = (site.codeAIOT ?? '').trim();
  if (!codeAiot) return null;
  if (typeof site.longitude !== 'number' || typeof site.latitude !== 'number') return null;

  const adresse = [site.adresse1, site.adresse2, site.adresse3]
    .map((p) => (p ?? '').trim()).filter(Boolean).join(' ') || null;

  const inspections = (site.inspections ?? [])
    .map((i) => (i.dateInspection ?? '').trim()).filter(Boolean).sort().reverse();

  return {
    id: identitePoiSourceExterne(SOURCE_ICPE, codeAiot),
    categorie: CATEGORIE_ICPE,
    sous_categorie: graviteIcpe(site),
    nom: (site.raisonSociale ?? '').trim() || null,
    adresse,
    ville: (site.commune ?? '').trim() || null,
    code_postal: (site.codePostal ?? '').trim() || null,
    lat: site.latitude,
    lng: site.longitude,
    source: SOURCE_ICPE,
    metadata: {
      libelle_nature: natureDominante(site),
      natures_risque: naturesDuSite(site),
      code_aiot: codeAiot,
      code_insee: (site.codeInsee ?? '').trim() || null,
      regime: site.regime ?? null,
      statut_seveso: site.statutSeveso ?? null,
      ied: site.ied === true,
      priorite_nationale: site.prioriteNationale === true,
      etat_activite: site.etatActivite ?? null,
      dreal: site.serviceAIOT ?? null,
      siret: (site.siret ?? '').trim() || null,
      code_naf: (site.codeNaf ?? '').trim() || null,
      rubriques: (site.rubriques ?? []).map((r) => ({
        numero: r.numeroRubrique, nature: r.nature ?? null,
        regime: r.regimeAutoriseAlinea ?? null,
        quantite: r.quantiteTotale ?? null, unite: r.unite ?? null,
      })),
      date_maj_source: dateSeule(site.date_maj),
      derniere_inspection: inspections[0] ?? null,
      nb_inspections: inspections.length,
    },
  };
}
```

- [ ] **Step 4: Lancer, vérifier le succès**

Run: `npx vitest run tests/unit/import/icpe-normalisation.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/import/georisques/classement.ts tests/unit/import/icpe-normalisation.test.ts
git commit -m "feat(georisques): normalisation dun site ICPE vers poi_france"
```

---

### Task 5: Route d'import NDJSON

**Files:**
- Create: `app/api/admin/import-georisques/route.ts`
- Test: `tests/unit/api/import-georisques-contrat.test.ts`

**Interfaces:**
- Consumes: `normaliserSiteIcpe`, `SOURCE_ICPE` (Task 4).
- Produces: `POST /api/admin/import-georisques`, corps `{ departements?: string[], page_size?: number }`, réponse NDJSON.

- [ ] **Step 1: Écrire le test de contrat qui échoue**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'app/api/admin/import-georisques/route.ts'), 'utf8');

describe('contrat de la route dimport Georisques', () => {
  it('lit son corps par lireCorps, jamais request.json() nu', () => {
    expect(SRC).toContain('lireCorps');
    expect(SRC).not.toMatch(/await\s+req(uest)?\.json\(\)/);
  });
  it('appelle lexterieur par lecture-avec-reprise, jamais un fetch nu', () => {
    expect(SRC).toContain('lecture-avec-reprise');
    expect(SRC).not.toMatch(/\bawait fetch\(/);
  });
  it('borne le domaine appele — garde-fou SSRF', () => {
    expect(SRC).toContain('georisques.gouv.fr');
    expect(SRC).toMatch(/DOMAINES_AUTORISES|ALLOWED_DOMAINS/);
  });
  it('ecrit par lots de 50 au maximum', () => {
    expect(SRC).toMatch(/TAILLE_LOT\s*=\s*50/);
  });
  it('distingue insere de deja present — upsert suivi dun select', () => {
    expect(SRC).toContain("onConflict: 'id'");
    expect(SRC).toMatch(/\.select\('id'\)/);
  });
  it('est protegee et dynamique', () => {
    expect(SRC).toContain('requireAdmin');
    expect(SRC).toContain("export const dynamic = 'force-dynamic'");
  });
  it('emet une progression, jamais un traitement silencieux', () => {
    expect(SRC).toMatch(/etape/);
    expect(SRC).toMatch(/pourcentage|traitees/);
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec** (fichier absent → le `readFileSync` lève)

Run: `npx vitest run tests/unit/api/import-georisques-contrat.test.ts`
Expected: FAIL — ENOENT

- [ ] **Step 3: Écrire la route** — voir le corps complet dans la spec §8. Points imposés : `TAILLE_LOT = 50`, `PAGE_SIZE_MAX = 1000`, `DOMAINES_AUTORISES = ['georisques.gouv.fr']`, flux NDJSON `{ etape, pourcentage, traitees, total, inserted, ignored, ecartes }`, `upsert(..., { onConflict: 'id' }).select('id')`, lecture par `lireAvecReprise`, corps validé par Zod `.passthrough()`.

- [ ] **Step 4: Lancer, vérifier le succès**

Run: `npx vitest run tests/unit/api/import-georisques-contrat.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Type-check et suite complète**

Run: `npx tsc --noEmit` puis `npx vitest run tests/unit/import tests/unit/api`
Expected: 0 erreur, tous verts

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/import-georisques/route.ts tests/unit/api/import-georisques-contrat.test.ts
git commit -m "feat(georisques): route dimport NDJSON des installations classees"
```

---

### Task 6: Import réel en local, mesuré

**Files:** aucun (exécution)

- [ ] **Step 1: Import d'un seul département, pour mesurer avant d'engager la France**

Run: `curl -N -X POST http://127.0.0.1:3000/api/admin/import-georisques -H 'Content-Type: application/json' -d '{"departements":["13"]}'` (avec le cookie de session)
Expected: flux NDJSON, ~1 985 lignes, compteurs finaux cohérents

- [ ] **Step 2: Vérifier le classement obtenu**

Run (psql local): `select sous_categorie, count(*) from poi_france where source='georisques_icpe' group by 1 order by 2 desc;`
Expected: les six classes, `seveso_haut` et `seveso_bas` non vides

- [ ] **Step 3: Vérifier l'idempotence en rejouant le même import**

Expected: `inserted` = 0, `ignored` = 1 985, et `count(*)` inchangé

- [ ] **Step 4: Import national**

Run: même appel sans `departements`
Expected: ~138 423 lignes, durée et compteurs relevés

- [ ] **Step 5: Mesurer le coût de la requête carte**

Run: `EXPLAIN (ANALYZE, BUFFERS)` sur la requête de `/api/map/pois` filtrée sur cette catégorie
Expected: passage par index, pas de balayage complet — à consigner

---

### Task 7: Natures servies depuis le registre + UI

**Files:**
- Modify: `app/api/map/poi-natures/route.ts`
- Modify: `app/map/_components/filter-panel/PoiSection.tsx`
- Test: `tests/unit/api/poi-natures-registre.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'app/api/map/poi-natures/route.ts'), 'utf8');

describe('poi-natures ne balaye pas 138 423 jsonb', () => {
  it('sert la categorie risque_industriel depuis le registre borne', () => {
    // Le chemin generique fait `.select('metadata')` puis deduplique cote
    // client : indolore sur des centaines de lycees, balayage complet sur les
    // 138 423 ICPE — la famille de lincident du 28/03.
    expect(SRC).toContain('risque_industriel');
    expect(SRC).toContain('icpe_rubrique_familles');
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npx vitest run tests/unit/api/poi-natures-registre.test.ts`
Expected: FAIL

- [ ] **Step 3: Brancher le cas registre dans la route**, avant le chemin générique : si `categorie === 'risque_industriel'`, lire `icpe_rubrique_familles` (15 lignes) plus `NATURE_NON_PRECISEE`, trier par `rang_gravite` décroissant, et rendre.

- [ ] **Step 4: Ajouter les deux éléments d'UI** dans `PoiSection.tsx` : case « Inclure les sites en fin d'exploitation » (décochée par défaut, ne s'affiche que si `risque_industriel` est sélectionné) et légende de gravité (six pastilles, jetons `--seq-5` → `--seq-1` et `--donnee-absente`, libellés en sentence case).

- [ ] **Step 5: Vérifier**

Run: `npx vitest run tests/unit/api tests/unit/design` puis `npx tsc --noEmit`
Expected: verts — dont `jetons-css.test.ts`, qui échouerait sur un `var(--x)` sans jeton en face

- [ ] **Step 6: Commit**

```bash
git add app/api/map/poi-natures/route.ts app/map/_components/filter-panel/PoiSection.tsx tests/unit/api/poi-natures-registre.test.ts
git commit -m "fix(poi-natures): servir les natures ICPE depuis le registre + legende de gravite"
```

---

### Task 8: Documentation dans le même commit

**Files:**
- Modify: `ARCHITECTURE.md`

- [ ] **Step 1: Ajouter** la route `/api/admin/import-georisques` au tableau « Administration générale », la table `icpe_rubrique_familles` au tableau des tables, `georisques.gouv.fr` aux dépendances externes, et la catégorie POI `risque_industriel` à la ligne `poi_france`.

- [ ] **Step 2: Vérifier que le garde de dérive passe**

Run: `npx vitest run tests/unit/docs/derive-documentation.test.ts`
Expected: PASS — il échoue si une dépendance externe appelée par le code n'est pas documentée

- [ ] **Step 3: Commit**

```bash
git add ARCHITECTURE.md
git commit -m "docs: route dimport Georisques, registre des familles ICPE, categorie risque industriel"
```

---

## Self-Review

**Couverture de la spec :** §3 (source, volumes, plafonds) → Tasks 5 et 6 · §4 (nature dominante déterministe) → Task 2 · §5 (registre en base) → Task 1 · §6 (table et champs, dérivation de gravité) → Tasks 1, 2, 4 · §7 (UX, couleurs) → Task 7 · §8 (import) → Task 5 · §8bis (défaut poi-natures) → Task 7 · §10 (vérifications) → Tasks 2, 3, 4, 6, 8. Le §9 est hors périmètre et n'a volontairement aucune tâche.

**Cohérence de nommage :** `SiteIcpeBrut`, `GraviteIcpe`, `LignePoiIcpe`, `graviteIcpe`, `naturesDuSite`, `natureDominante`, `normaliserSiteIcpe`, `identitePoiSourceExterne`, `SOURCE_ICPE`, `CATEGORIE_ICPE`, `FAMILLES_ICPE_SEED`, `NATURE_NON_PRECISEE` — un seul nom par chose, utilisé à l'identique d'une tâche à l'autre.

**Point laissé ouvert, assumé :** Task 5 Step 3 renvoie à la spec §8 pour le corps de la route au lieu de le recopier en entier. C'est le seul endroit où le plan ne contient pas le code littéral, parce que la route est longue et que ses contraintes sont toutes verrouillées par le test de contrat de l'étape 1.

---

## Feuille de route — trois chantiers (cadrage Vincent, 2026-09-17)

Ce plan ne couvre que le chantier A. Les deux suivants sont notes ici parce
qu'ils contraignent des choix de A, et qu'un plan qui les ignore ferait prendre
les mauvais.

### Chantier A — les POINTS ICPE (ce plan)
Livre : import, classement, 99 152 sites en base locale, palette validee.
Reste : section dediee separee des autres POI, filtre multi-choix par type,
halo optionnel, couleur par type sur le point ET le halo, popup complete.

### Chantier B — les ZONES A RISQUE autour des POI
**A trancher avant de coder**, la formulation admet deux lectures qui ne se
substituent pas :

| Lecture | Ce que c'est | Couverture | Limite |
|---|---|---|---|
| Perimetres **PPRT** | polygones reglementaires, WFS `PPRT_PERIMETRE_RISQIND` | ~415 procedures | source figee a **fevrier 2023**, reponses WFS plafonnees a **80 000** features |
| Zones **calculees** | rayon de danger autour de chaque site, facon isochrone | les 99 152 sites | le rayon est un ARBITRAGE : fixe ? par type de risque ? par quantite stockee (`rubriques[].quantiteTotale`, qu'on a deja) ? |

La seconde est la seule generalisable, la premiere la seule opposable. Elles
peuvent cohabiter — un perimetre PPRT quand il existe, un rayon calcule sinon —
mais il faut alors le DIRE sur la carte, sinon deux objets de nature differente
portent la meme apparence.

### Chantier C — la POPULATION EXPOSEE, par POI et par zone
La finalite produit : « combien de personnes vivent dans le perimetre de ce
site Seveso ». Croisement de chaque zone avec `carreaux_filosofi` ou `iris`.

Ce qui existe deja et qu'il faut REUTILISER, pas reecrire :
- `compute_zone_items_audience` (sql/088) fait exactement ce croisement pour les
  zones custom, avec son cache `items_audience_stats` ;
- `get_carreaux_for_scoring` lit les carreaux dans un rayon ;
- les paliers agreges `carreaux_1km` / `2km` / `5km` existent pour ne pas payer
  les 4,6 Go du 200 m quand la precision n'est pas rendue.

Les deux contraintes qui decident de l'architecture :
1. **99 152 sites x 2,3 M carreaux ne se calcule pas a la volee.** C'est un
   traitement par LOTS, resultat STOCKE, avec progression — la regle des
   imports du projet. Une intersection live serait l'incident du 28/03 en pire.
2. **Le palier de carreaux doit suivre le rayon.** 200 m pour un rayon de
   500 m, `carreaux_1km` au-dela.

Consequence pour A, a ne pas oublier : le rayon et le palier retenus devront
etre STOCKES avec le resultat, sinon deux calculs faits a six mois d'ecart
donneront deux populations differentes sans qu'on sache laquelle croire.
