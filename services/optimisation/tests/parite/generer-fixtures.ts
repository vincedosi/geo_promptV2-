/**
 * Générateur des fixtures de parité du plan initial (T2, plan `2026-11-04-optimisation-python-architecture.md` § 5.1).
 *
 * Le TS actuel est la référence : ce fichier exécute les fonctions pures de `lib/zones/plan.ts`,
 * `lib/zones/plan-jeu-zone.ts` et `lib/zones/part-prevue.ts` et écrit chaque appel `{ entree, sortie }` en JSON gzip
 * dans `services/optimisation/tests/parite/fixtures/`. Le noyau Python (T3) devra rendre la même sortie pour la même
 * entrée. Lancement, depuis la racine (base locale démarrée) :
 *
 *   npx vitest run --config services/optimisation/tests/parite/vitest.config.ts
 *
 * ── Comment les appels sont captés ─────────────────────────────────────────────────────────────────────────────────
 * Les trois modules sont remplacés (`vi.mock`) par des enveloppes qui appellent l'original et enregistrent l'appel :
 * arguments encodés AVANT l'appel (une fonction qui les modifie — `bornerMultiplicateur` et son journal — est aussi
 * enregistrée APRÈS, `args_apres`), sortie encodée aussitôt. Seuls les appels de PREMIER niveau sont enregistrés :
 * `planCpDeZone` appelle `genererPlanCp`, cet appel interne n'est pas un cas. Les enveloppes ne changent rien au calcul —
 * les assertions des tests importés tournent dessus et doivent rester vertes : c'est la preuve qu'on capte le vrai TS.
 *
 * Trois sources :
 * 1. les tests unitaires existants, IMPORTÉS tels quels (leurs `describe` s'enregistrent ici) ;
 * 2. six zones de référence, couvertures lues en base, déclinées comme le fait `planCp` de l'extraction ;
 * 3. les quatre extractions risque de la base, entrées relues dans `zone_set_cp`, lignes stockées jointes.
 *
 * Lectures base : séquentielles, une à la fois (CLAUDE.md : jamais plus de 3 appels simultanés), toutes en lecture
 * seule — sauf `couverture_zone`, qui remplit son cache (`couverture_zone_cache`) comme à chaque ouverture d'écran.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

// ── Enregistreur (hissé : les fabriques de `vi.mock` s'exécutent avant les imports) ──────────────────────────────────
const R = vi.hoisted(() => {
  interface Appel {
    test: string;
    module: string;
    fonction: string;
    entree: { args: unknown[] };
    sortie?: unknown;
    erreur?: string;
    args_apres?: unknown[];
  }
  const appels: Appel[] = [];
  let profondeur = 0;
  let nomTest: () => string = () => '(hors test)';

  /**
   * JSON fidèle aux valeurs JS : `Map` → `{"$map": [[k, v], …]}` (ordre d'insertion), `Set` → `{"$set": […]}`,
   * `undefined` dans un tableau ou un argument → `{"$undefined": true}`, `Infinity`/`-Infinity`/`NaN`/`-0` →
   * `{"$nombre": "…"}`. Une propriété d'objet `undefined` est OMISE (sémantique de `JSON.stringify`, celle de la base).
   */
  function encoder(v: unknown): unknown {
    if (v === undefined) return { $undefined: true };
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number') {
      if (Number.isNaN(v)) return { $nombre: 'NaN' };
      if (v === Infinity) return { $nombre: 'Infinity' };
      if (v === -Infinity) return { $nombre: '-Infinity' };
      if (Object.is(v, -0)) return { $nombre: '-0' };
      return v;
    }
    if (v instanceof Map) return { $map: [...v.entries()].map(([k, x]) => [encoder(k), encoder(x)]) };
    if (v instanceof Set) return { $set: [...v.values()].map(encoder) };
    if (Array.isArray(v)) return v.map(encoder);
    if (typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x !== undefined) o[k] = encoder(x);
      return o;
    }
    throw new Error(`valeur non encodable (${typeof v})`);
  }

  /**
   * Un appel fait à la COLLECTE (dans le corps d'un `describe`, hors de tout `it`) n'a pas de test courant : il est
   * nommé par sa ligne dans le fichier de test, lue dans la pile d'appel. Ses assertions sont dans les `it` qui suivent.
   */
  function nommer(): string {
    const t = nomTest();
    if (t !== '(hors test)') return t;
    // Chemins Windows (`\`) comme POSIX (`/`).
    const m = /tests[\\/]unit[\\/]zones[\\/]([\w-]+\.test\.ts):(\d+)/.exec(new Error().stack ?? '');
    return m ? `(collecte) ${m[1]}:${m[2]}` : t;
  }

  function envelopper(module: string, mod: Record<string, unknown>): Record<string, unknown> {
    const sortie: Record<string, unknown> = {};
    for (const [nom, valeur] of Object.entries(mod)) {
      if (typeof valeur !== 'function') { sortie[nom] = valeur; continue; }
      const f = valeur as (...a: unknown[]) => unknown;
      sortie[nom] = function enveloppe(this: unknown, ...args: unknown[]): unknown {
        if (profondeur > 0) return f.apply(this, args);
        const avant = JSON.stringify(encoder(args));
        profondeur += 1;
        try {
          const r = f.apply(this, args);
          const apres = JSON.stringify(encoder(args));
          appels.push({
            test: nommer(), module, fonction: nom, entree: { args: JSON.parse(avant) as unknown[] }, sortie: encoder(r),
            ...(apres !== avant ? { args_apres: JSON.parse(apres) as unknown[] } : {}),
          });
          return r;
        } catch (e) {
          appels.push({ test: nommer(), module, fonction: nom, entree: { args: JSON.parse(avant) as unknown[] }, erreur: e instanceof Error ? e.message : String(e) });
          throw e;
        } finally {
          profondeur -= 1;
        }
      };
    }
    return sortie;
  }

  return { appels, encoder, envelopper, poserNomTest: (f: () => string) => { nomTest = f; } };
});

vi.mock('@/lib/zones/plan', async (original) => R.envelopper('plan', await original<Record<string, unknown>>()));
vi.mock('@/lib/zones/plan-jeu-zone', async (original) => R.envelopper('plan-jeu-zone', await original<Record<string, unknown>>()));
vi.mock('@/lib/zones/part-prevue', async (original) => R.envelopper('part-prevue', await original<Record<string, unknown>>()));

R.poserNomTest(() => expect.getState().currentTestName ?? '(hors test)');

// ── Source 1 : les tests unitaires existants, importés tels quels ────────────────────────────────────────────────────
const RACINE = resolve(__dirname, '../../../..');
const TESTS_UNITAIRES = ['plan.test.ts', 'plan-jeu-zone.test.ts', 'part-prevue.test.ts'] as const;
await import('@/tests/unit/zones/plan.test');
await import('@/tests/unit/zones/plan-jeu-zone.test');
await import('@/tests/unit/zones/part-prevue.test');

/** Le `describe` de premier niveau de chaque fichier de test → son fichier (les titres sont uniques, vérifié). */
const SOURCE_DE_DESCRIBE = new Map<string, string>();
for (const fichier of TESTS_UNITAIRES) {
  const texte = readFileSync(join(RACINE, 'tests/unit/zones', fichier), 'utf-8');
  for (const m of texte.matchAll(/^describe\('((?:[^'\\]|\\.)*)'/gm)) {
    if (SOURCE_DE_DESCRIBE.has(m[1])) throw new Error(`describe en double entre fichiers : ${m[1]}`);
    SOURCE_DE_DESCRIBE.set(m[1], fichier);
  }
}

// Les fonctions, importées APRÈS les mocks : ce sont les enveloppes, donc les appels ci-dessous sont enregistrés.
const { genererPlanCp } = await import('@/lib/zones/plan');
const { planCpDeZone, plansParPlateforme, reglageDuPlan, sortiesPoids } = await import('@/lib/zones/plan-jeu-zone');
const { universDeZone } = await import('@/lib/zones/part-prevue');
const { normaliserJeu } = await import('@/lib/zones/jeu');
const { lireGroupesCp } = await import('@/lib/zones/groupes');
const { lirePoids } = await import('@/lib/zones/conversion-serveur');
const { lireVolumesAttendus } = await import('@/lib/zones/part-prevue-serveur');
const { lireTout } = await import('@/lib/supabase/lire-tout');
const { creerClientTest } = await import('@/tests/integration/_client');

type ClientAdmin = Parameters<typeof lirePoids>[0];
type LigneCouverture = Parameters<typeof planCpDeZone>[0][number];
type Groupes = Parameters<typeof planCpDeZone>[3];
type Recette = Parameters<typeof universDeZone>[1];

const sb = creerClientTest();
const client = sb as unknown as ClientAdmin;

// Lu une fois : 181 lignes (groupes de plus d'un membre), identique pour tous les cas.
let groupesLus: Groupes | null = null;
async function groupes(): Promise<Groupes> {
  groupesLus ??= await lireGroupesCp(client as never);
  return groupesLus;
}

// ── Source 2 : six zones de référence ────────────────────────────────────────────────────────────────────────────────
/**
 * Les zones de référence de Q39 (amendement E6), telles qu'elles EXISTENT dans la base locale au 04/11. Seule la
 * composite (895 unités, 13 001 km²) y était déjà ; les autres sont prises au plus près (README, « Écarts ») :
 * Strasbourg = la zone isochrone CIRFA Strasbourg, Paris = CIRFA Paris Air, « seuil sur carreaux » = « Revenu médian
 * ≥ 27 500 € », France métropolitaine et France entière = les zones pays (`couverture_pays_jsonb`, comme
 * `couverture_zone` pour une recette `pays`). La France entière porte les DROM, dont 65 unités non carroyées
 * (population inconnue, ARB-3) : elle tient lieu de zone DROM.
 */
const ZONES: readonly {
  id: string; nom: string; source: { zone: string; org: string } | { pays: 'METRO' | 'FR' }; nationale: boolean;
}[] = [
  { id: 'composite', nom: 'Cible composite (2 zones), 13 001 km²', source: { zone: '919ca65d-665a-43f6-834e-ea9f2eb68c72', org: '00000000-0000-0000-0000-000000000001' }, nationale: false },
  { id: 'strasbourg', nom: 'CIRFA Strasbourg (isochrone)', source: { zone: '50b1c705-a552-4470-81e8-f230de596e23', org: '83cae295-9239-44b5-bb12-7a8b23448b01' }, nationale: false },
  { id: 'paris', nom: 'CIRFA Paris Air (isochrone)', source: { zone: '7e1442dd-6ea7-4726-b93c-ea6bd1f39ea8', org: '83cae295-9239-44b5-bb12-7a8b23448b01' }, nationale: false },
  { id: 'seuil-carreaux', nom: 'Revenu médian ≥ 27 500 € (seuil sur carreaux)', source: { zone: '34cbe420-5493-42b2-a8f1-fb8c05bac104', org: '00000000-0000-0000-0000-000000000001' }, nationale: false },
  { id: 'metropole', nom: 'France métropolitaine (zone pays METRO)', source: { pays: 'METRO' }, nationale: true },
  { id: 'france', nom: 'France entière (zone pays FR, DROM compris)', source: { pays: 'FR' }, nationale: true },
];

/** Les seuils des plateformes : DV360 à 20 %, TTD à 10 % — deux seuils différents, pour que B12 donne deux plans. */
const DV360 = { plateforme: 'dv360', seuil: 20 } as const;
const TTD = { plateforme: 'ttd', seuil: 10 } as const;

interface Declinaison { id: string; mode: 'exclusif' | 'pondere'; choix: readonly { plateforme: string; seuil: number }[]; listeExacte: boolean }
const DECLINAISONS: readonly Declinaison[] = [
  { id: 'exclusif-dv360', mode: 'exclusif', choix: [DV360], listeExacte: false },
  { id: 'pondere-dv360', mode: 'pondere', choix: [DV360], listeExacte: false },
  { id: 'exclusif-dv360-ttd', mode: 'exclusif', choix: [DV360, TTD], listeExacte: false },
  { id: 'pondere-dv360-ttd', mode: 'pondere', choix: [DV360, TTD], listeExacte: false },
  { id: 'exclusif-dv360-liste-exacte', mode: 'exclusif', choix: [DV360], listeExacte: true },
];
/** Une zone nationale pèse ≈ 6 000 lignes par plan : deux déclinaisons suffisent (les deux modes, DV360 + TTD). */
const DECLINAISONS_NATIONALES = new Set(['exclusif-dv360-ttd', 'pondere-dv360-ttd']);

async function couverture(z: (typeof ZONES)[number]): Promise<{ lignes: LigneCouverture[]; recette: Recette }> {
  const { data, error } = 'pays' in z.source
    ? await sb.rpc('couverture_pays_jsonb', { p_code: z.source.pays, p_cible: 'ind', p_decoupage: 'cp' })
    : await sb.rpc('couverture_zone', { p_zone_id: z.source.zone, p_org_id: z.source.org, p_cible: 'ind', p_decoupage: 'cp' });
  if (error) throw new Error(`couverture ${z.id} : ${error.message}`);
  const o = data as { lignes?: LigneCouverture[]; refus?: string };
  if (o.refus !== undefined || !Array.isArray(o.lignes)) throw new Error(`couverture ${z.id} : refus ${o.refus ?? 'sans lignes'}`);
  let recette: Recette = null;
  if ('pays' in z.source) recette = { v: 1, type: 'pays', code: z.source.pays } as unknown as Recette;
  else {
    const lue = await sb.from('custom_geo_zones').select('recette').eq('id', z.source.zone).maybeSingle();
    if (lue.error) throw new Error(`recette ${z.id} : ${lue.error.message}`);
    recette = (lue.data?.recette ?? null) as Recette;
  }
  return { lignes: o.lignes, recette };
}

/**
 * La liste exacte synthétique d'une zone (recette `codes_postaux` simulée) : les 20 premières unités NON retenues à
 * 20 % (elles entrent quel que soit le seuil), les 20 premières retenues, et un code du référentiel absent de la
 * couverture (unité sans carreau : population nulle, multiplicateur neutre, ARB-3). Ordre : celui de la couverture.
 */
async function listeExacte(lignes: readonly LigneCouverture[]): Promise<string[]> {
  const non = lignes.filter((l) => l.part_brute !== null && l.part_brute < DV360.seuil).slice(0, 20).map((l) => l.code);
  const oui = lignes.filter((l) => l.part_brute !== null && l.part_brute >= DV360.seuil).slice(0, 20).map((l) => l.code);
  const presents = new Set(lignes.flatMap((l) => [l.code, ...((l as { membres?: string[] }).membres ?? [])]));
  const { data, error } = await sb.from('ref_codes_postaux').select('code_postal').order('code_postal').limit(200);
  if (error) throw new Error(`ref_codes_postaux : ${error.message}`);
  const absent = (data ?? []).map((r: { code_postal: string }) => r.code_postal).find((c) => !presents.has(c));
  return [...non, ...oui, ...(absent ? [absent] : [])];
}

const resumeZones: Record<string, { lignes: number; declinaisons: string[] }> = {};

describe('zones de référence', () => {
  for (const z of ZONES) {
    describe(z.id, () => {
      let lues: { lignes: LigneCouverture[]; recette: Recette } | null = null;
      for (const d of DECLINAISONS) {
        if (z.nationale && !DECLINAISONS_NATIONALES.has(d.id)) continue;
        it(d.id, async () => {
          lues ??= await couverture(z);
          const { lignes, recette } = lues;
          const g = await groupes();
          const auCp = d.choix;
          // La même séquence que `planCp` + `extraireJeuZone` (lib/zones/extraction-jeu-zone.ts), lecture par lecture.
          const poids = await lirePoids(client, auCp.map((c) => c.plateforme), 'cp');
          const r = reglageDuPlan(poids, auCp.map((c) => c.plateforme));
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          const liste = d.listeExacte ? await listeExacte(lignes) : undefined;
          const codes = [...lignes.map((l) => l.code), ...(liste ?? [])];
          const volumes = await lireVolumesAttendus(client, codes, universDeZone(codes, recette));
          const propres = plansParPlateforme(lignes, auCp, d.mode, g, poids, liste, volumes);
          expect(propres.ok).toBe(true);
          const commun = planCpDeZone(lignes, Math.min(...auCp.map((c) => c.seuil)), d.mode, g, liste, r.reglage, volumes);
          if (propres.ok) {
            for (const p of propres.plans) {
              sortiesPoids(poids, p.plateforme, commun.resume.n_codes, commun.resume.multiplicateur);
              sortiesPoids(poids, p.plateforme, p.plan.resume.n_codes, p.plan.resume.multiplicateur);
            }
          }
          (resumeZones[z.id] ??= { lignes: lignes.length, declinaisons: [] }).declinaisons.push(d.id);
        });
      }
    });
  }
});

// ── Source 3 : les quatre extractions risque de la base ──────────────────────────────────────────────────────────────
interface LigneStockee { code_postal: string; multiplicateur: number; retenu: boolean; classe: string; part_prevue: number | null }
const resumeRisque: Record<string, { lignes_ts: number; lignes_stockees: number; multiplicateurs_differents: number; codes_differents: number }> = {};
const stockees: Record<string, unknown> = {};

describe('extractions risque', () => {
  it('les quatre extractions, rejouées depuis zone_set_cp', async () => {
    const { data: extractions, error } = await sb.from('zone_set_extractions')
      .select('id, zone_set_id, version, mode_plan, seuil_couverture_cp, n_cp, n_retenus, taux_utile, part_plan_en_zone, empreinte')
      .order('created_at');
    if (error) throw new Error(`zone_set_extractions : ${error.message}`);
    expect((extractions ?? []).length).toBe(4);
    const g = await groupes();
    for (const e of extractions ?? []) {
      const jeuLu = await sb.from('zone_sets')
        .select('type, profil, cible, gravites, natures, modes, territoire, mode_plan, seuil_couverture_cp, poids')
        .eq('id', e.zone_set_id).single();
      if (jeuLu.error) throw new Error(`zone_sets : ${jeuLu.error.message}`);
      expect(jeuLu.data.type).toBe('risque');
      const { lignes: cpRows } = await lireTout<{ code_postal: string; classe: string; pop_en_zone: number | null; pop_totale: number | null; retenu: boolean }>(
        (de, a) => sb.from('zone_set_cp').select('code_postal, classe, pop_en_zone, pop_totale, retenu')
          // Ordre TOTAL (clé primaire) : la route n'ordonne que par code postal, et un code à cheval sur plusieurs
          // grappes rend alors ses lignes dans un ordre arbitraire — fixture non reproductible, pages qui se recouvrent.
          .eq('zone_set_id', e.zone_set_id).order('code_postal').order('cluster_id').range(de, a),
        20_000,
      );
      // Les mêmes conversions que la route d'extraction risque (`app/api/zones/jeux/[id]/extractions/route.ts`).
      const j = jeuLu.data;
      const jeu = normaliserJeu({
        profil: j.profil, cible: j.cible, gravites: j.gravites, natures: j.natures, modes: j.modes, territoire: j.territoire,
        mode_plan: j.mode_plan, seuil_couverture_cp: Number(j.seuil_couverture_cp), poids: j.poids,
      });
      const cps = cpRows.map((r) => ({
        code_postal: r.code_postal, classe: r.classe, pop_en_zone: Number(r.pop_en_zone ?? 0), pop_totale: Number(r.pop_totale ?? 0), retenu: r.retenu,
      }));
      R.poserNomTest(() => `extractions risque > ${e.id}`);
      const plan = genererPlanCp(cps, jeu, g);
      R.poserNomTest(() => expect.getState().currentTestName ?? '(hors test)');

      const { lignes: lues } = await lireTout<LigneStockee>(
        (de, a) => sb.from('zone_set_extraction_cp').select('code_postal, multiplicateur, retenu, classe, part_prevue')
          .eq('extraction_id', e.id).order('code_postal').range(de, a),
        20_000,
      );
      const stocke = new Map(lues.map((l) => [l.code_postal, Number(l.multiplicateur)]));
      const ts = new Map(plan.lignes.map((l) => [l.code_postal, l.multiplicateur]));
      const codes = new Set([...stocke.keys(), ...ts.keys()]);
      resumeRisque[e.id] = {
        lignes_ts: plan.lignes.length,
        lignes_stockees: lues.length,
        multiplicateurs_differents: [...codes].filter((c) => stocke.has(c) && ts.has(c) && stocke.get(c) !== ts.get(c)).length,
        codes_differents: [...codes].filter((c) => !stocke.has(c) || !ts.has(c)).length,
      };
      stockees[e.id] = { extraction: e, lignes: lues.map((l) => ({ ...l, multiplicateur: Number(l.multiplicateur), part_prevue: l.part_prevue === null ? null : Number(l.part_prevue) })) };
    }
  });
});

// ── Écriture ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const DOSSIER = join(RACINE, 'services/optimisation/tests/parite/fixtures');

function ecrire(nom: string, contenu: unknown): number {
  // JSON compact, ordre d'insertion préservé ; gzip sans horodatage (même entrée → même fichier).
  const brut = Buffer.from(JSON.stringify(contenu), 'utf-8');
  const gz = gzipSync(brut, { level: 9 });
  writeFileSync(join(DOSSIER, nom), gz);
  return gz.length;
}

afterAll(() => {
  mkdirSync(DOSSIER, { recursive: true });
  const source = (test: string) => (test.startsWith('(collecte) ')
    ? test.slice('(collecte) '.length).split(':')[0]
    : SOURCE_DE_DESCRIBE.get(test.split(' > ')[0]) ?? null);
  const numeroter = <T extends { test: string }>(appels: T[], prefixe: string) => {
    const rang = new Map<string, number>();
    return appels.map((a) => {
      const n = (rang.get(a.test) ?? 0) + 1;
      rang.set(a.test, n);
      return { id: `${prefixe}${a.test} #${n}`, ...a };
    });
  };

  const unitaires = R.appels.filter((a) => source(a.test) !== null).map((a) => ({ source: source(a.test) as string, ...a }));
  const zones = R.appels.filter((a) => a.test.startsWith('zones de référence > '));
  const risque = R.appels.filter((a) => a.test.startsWith('extractions risque > '))
    .map((a) => ({ ...a, stocke: stockees[a.test.slice('extractions risque > '.length)] }));
  const autres = R.appels.filter((a) => source(a.test) === null && !zones.includes(a) && !a.test.startsWith('extractions risque > '));
  if (autres.length > 0) throw new Error(`appels non classés : ${[...new Set(autres.map((a) => a.test))].join(' | ')}`);

  const format = {
    format: 1,
    genere_par: 'services/optimisation/tests/parite/generer-fixtures.ts',
    encodage: 'Map → {"$map": [[k, v], …]} ; Set → {"$set": […]} ; undefined (argument ou élément) → {"$undefined": true} ; Infinity/-Infinity/NaN/-0 → {"$nombre": "…"} ; propriété undefined omise',
  };
  const tailles = {
    'tests-unitaires.json.gz': ecrire('tests-unitaires.json.gz', { ...format, cas: numeroter(unitaires, '') }),
    'zones-reference.json.gz': ecrire('zones-reference.json.gz', { ...format, zones: ZONES, declinaisons: DECLINAISONS, cas: numeroter(zones, '') }),
    'extractions-risque.json.gz': ecrire('extractions-risque.json.gz', { ...format, ecarts_au_stocke: resumeRisque, cas: numeroter(risque, '') }),
  };

  const testsParSource = new Map<string, Set<string>>();
  for (const a of unitaires) {
    const tests = testsParSource.get(a.source) ?? new Set<string>();
    tests.add(a.test);
    testsParSource.set(a.source, tests);
  }
  const bilan = {
    tests_unitaires: Object.fromEntries([...testsParSource].map(([s, t]) => [s, { tests_avec_appel: t.size, appels: unitaires.filter((a) => a.source === s).length }])),
    zones: resumeZones,
    appels_zones: zones.length,
    risque: resumeRisque,
    tailles_octets: tailles,
  };
  writeFileSync(join(DOSSIER, 'bilan.json'), `${JSON.stringify(bilan, null, 2)}\n`);
  console.log(JSON.stringify(bilan, null, 2));
});
