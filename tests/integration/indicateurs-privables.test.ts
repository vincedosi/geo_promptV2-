/**
 * Un indicateur peut devenir un jeu de données (lot « Catalogue et groupes », sql/288) — contre la vraie base locale.
 *
 * Un indicateur privable est une ligne `data_sources` de type `indicateur`, et `cible_indicator_registry.data_source_id`
 * pointe dessus : les règles des jeux importés (socle, privé, partagé) s'appliquent sans second modèle de droits.
 * Seule l'identité de l'appelant est simulée ; routes, PostgREST et tables sont les vrais.
 *
 * T2 (accès croisé) rend l'abstention privée à Bercy le temps du bloc, puis la remet dans son état d'origine (relu
 * avant) dans un `afterAll`, exécuté même si un test échoue : la base locale est partagée.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { creerClientTest } from './_client';

/** L'appelant simulé des routes de la carte : `requireAuth` (profil) et `getSessionOrg` (règle) disent la même chose. */
let qui: { id: string; role: 'client' | 'super_admin'; organization_id: string } | null = null;
vi.mock('@/lib/api/middleware', async (original) => ({
  ...(await original<typeof import('@/lib/api/middleware')>()),
  requireAdmin: async () => ({ id: '00000000-0000-0000-0000-00000000a11c', role: 'super_admin', organization_id: null }),
  requireAuth: async () => (qui ? { ...qui, email: 'essai@indicateurs-privables.test', full_name: null } : null),
}));
vi.mock('@/lib/auth/getSessionOrg', async (original) => ({
  ...(await original<typeof import('@/lib/auth/getSessionOrg')>()),
  getSessionOrg: async () => (qui ? { userId: qui.id, orgId: qui.organization_id, role: qui.role } : null),
}));

const sources = await import('@/app/api/admin/sources/[id]/route');
const imports = await import('@/app/api/admin/imports/route');
const socle = await import('@/app/api/admin/espaces/socle/route');
const catalogue = await import('@/app/api/cibles/indicators/route');
const civique = await import('@/app/api/insee-variables/[code]/geojson/route');
const score = await import('@/app/api/analyses/score/route');
const correlation = await import('@/app/api/analyses/correlation/route');
const apercuZone = await import('@/app/api/zones/apercu/route');
const exportStrategie = await import('@/app/api/bidding/strategies/[id]/export/route');
const sb = creerClientTest();

const CODE = 'abstention_pres_2022';
let idAbstention = '';

beforeAll(async () => {
  const { data, error } = await sb.from('data_sources').select('id').eq('type', 'indicateur').eq('category', CODE);
  if (error) throw new Error(error.message);
  expect(data, 'sql/288 appliquée ? une seule ligne de catalogue pour l abstention').toHaveLength(1);
  idAbstention = data![0].id as string;
});

describe('l abstention est un jeu de données (T1, schéma)', () => {
  it('une ligne data_sources : type indicateur, socle, 6 186 codes postaux, et le registre y pointe', async () => {
    const { data, error } = await sb.from('data_sources')
      .select('type, category, visibilite, valid_count, status').eq('id', idAbstention).single();
    expect(error).toBeNull();
    expect(data).toEqual({ type: 'indicateur', category: CODE, visibilite: 'socle', valid_count: 6186, status: 'active' });

    const { data: reg, error: er } = await sb.from('cible_indicator_registry')
      .select('data_source_id').eq('indicator_code', CODE).single();
    expect(er).toBeNull();
    expect(reg?.data_source_id).toBe(idAbstention);
  });

  it('A-1 : aucun indicateur iris_column n a de source (leur colonne reste lisible par les tuiles IRIS)', async () => {
    const { data, error } = await sb.from('cible_indicator_registry')
      .select('indicator_code').eq('data_source', 'iris_column').not('data_source_id', 'is', null);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('A-3 : DELETE /api/admin/sources/<abstention> → 409, ligne intacte', async () => {
    const res = await sources.DELETE(
      new NextRequest(`http://localhost:3000/api/admin/sources/${idAbstention}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: idAbstention }) },
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain('ne se supprime pas');
    const { data, error } = await sb.from('data_sources').select('id').eq('id', idAbstention);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('A-4 : absente de l historique des imports, présente dans la fiche Socle d Accès', async () => {
    const hist = (await (await imports.GET(new NextRequest('http://localhost:3000/api/admin/imports'))).json()) as
      { imports: { id: string }[] };
    expect(hist.imports.map((i) => i.id)).not.toContain(idAbstention);

    const fiche = (await (await socle.GET(new NextRequest('http://localhost:3000/api/admin/espaces/socle'))).json()) as
      { jeux: { id: string; type: string; nb_lignes: number }[] };
    expect(fiche.jeux.find((j) => j.id === idAbstention)).toMatchObject({ type: 'indicateur', nb_lignes: 6186 });
  });
});

// ── T2 : une seule règle pour tout indicateur servi ─────────────────────────────────────────────────────────────

const INCONNU = 'indicateur_qui_n_existe_pas';
const ids: Record<'bercy' | 'bmw', string> = { bercy: '', bmw: '' };
let origine: { visibilite: string; organization_id: string | null } | null = null;
let campagne = '';
let strategie = '';

/** Un compte simulé par rôle et par espace : le quota d'appels (compteur en base) ne se partage pas entre eux. */
function session(espace: 'bercy' | 'bmw', role: 'client' | 'super_admin' = 'client') {
  const suffixe = `${role === 'client' ? 'c1' : '5a'}${espace === 'bmw' ? '01' : '02'}`;
  qui = { id: `00000000-0000-4000-8000-0000000${suffixe}`, role, organization_id: ids[espace] };
}

async function lireCatalogue(): Promise<{ indicator_code: string; origine: string }[]> {
  const res = await catalogue.GET(new NextRequest('http://localhost:3000/api/cibles/indicators'));
  expect(res.status).toBe(200);
  return ((await res.json()) as { indicators: { indicator_code: string; origine: string }[] }).indicators;
}

async function lireCivique(code: string) {
  const res = await civique.GET(
    new NextRequest(`http://localhost:3000/api/insee-variables/${code}/geojson?bbox=2.30,48.84,2.36,48.88`),
    { params: Promise.resolve({ code }) },
  );
  return { statut: res.status, corps: (await res.json()) as Record<string, unknown> };
}

/** Statut et message, le code demandé remplacé par `<code>` : on compare la forme du refus, pas le nom. */
async function sansLeCode(res: Response, code: string) {
  return { statut: res.status, erreur: ((await res.json()) as { error?: string }).error?.replace(code, '<code>') };
}

async function lancerScore(code: string) {
  return sansLeCode(await score.POST(new NextRequest('http://localhost:3000/api/analyses/score', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ indicateurs: [{ code, poids: 1, sens: 'croissant' }], codes_postaux: ['75001'], enregistrer: false }),
  })), code);
}

async function lancerCorrelation(code: string) {
  return sansLeCode(await correlation.GET(new NextRequest(
    `http://localhost:3000/api/analyses/correlation?campaignId=${campagne}&variable=${code}&enregistrer=false`)), code);
}

async function apercuSeuil(code: string) {
  const recette = { v: 1, type: 'seuil_territoire', indicateur: code, operateur: '>=', seuil: 30, perimetre: { type: 'departement', code: '75' } };
  const res = await apercuZone.POST(new NextRequest('http://localhost:3000/api/zones/apercu', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recette }),
  }));
  return { statut: res.status, corps: (await res.json()) as Record<string, unknown> };
}

describe('l abstention privée à Bercy : invisible ailleurs, comme un indicateur inconnu (T2, accès croisé)', () => {
  beforeAll(async () => {
    const { data: orgs, error } = await sb.from('organizations').select('id, slug').in('slug', ['bercy', 'bmw-group']);
    if (error) throw new Error(error.message);
    ids.bercy = orgs?.find((o) => o.slug === 'bercy')?.id as string;
    ids.bmw = orgs?.find((o) => o.slug === 'bmw-group')?.id as string;
    if (!ids.bercy || !ids.bmw) throw new Error('espaces bercy / bmw-group absents de la base locale');

    const { data: c, error: ec } = await sb.from('dsp_campaigns').select('id').limit(1).maybeSingle();
    if (ec) throw new Error(ec.message);
    campagne = (c?.id as string | undefined) ?? '';

    // Une stratégie à courbe bâtie sur l'abstention (relecture T1-T3, n° 1) : son export ne doit plus la lire.
    const { data: st, error: es } = await sb.from('bidding_strategies').select('id')
      .eq('in_zone_weights->>variable_code', CODE).not('in_zone_weights->curve', 'is', null).limit(1).maybeSingle();
    if (es) throw new Error(es.message);
    strategie = (st?.id as string | undefined) ?? '';

    const { data: avant, error: ea } = await sb.from('data_sources')
      .select('visibilite, organization_id').eq('id', idAbstention).single();
    if (ea || !avant) throw new Error(`lecture de la source : ${ea?.message}`);
    origine = avant as typeof origine;
    // Un passage précédent tué avant son `afterAll` aurait laissé l'abstention privée : la relire comme « origine »
    // perpétuerait l'écart. On refuse de démarrer.
    if (origine?.visibilite !== 'socle') {
      throw new Error('l abstention n est pas au socle : remettez-la au socle (Accès › Socle) avant ce test');
    }
    const { error: eu } = await sb.from('data_sources')
      .update({ visibilite: 'privee', organization_id: ids.bercy }).eq('id', idAbstention);
    if (eu) throw new Error(`passage à Bercy : ${eu.message}`);
  });

  afterAll(async () => {
    qui = null;
    if (!origine) return;
    const { error } = await sb.from('data_sources').update(origine).eq('id', idAbstention);
    if (error) throw new Error(`remise dans l état d origine : ${error.message}`);
  });

  it('BMW : le catalogue ne la rend pas ; les indicateurs du socle restent, tous « commune »', async () => {
    session('bmw');
    const liste = await lireCatalogue();
    expect(liste.map((i) => i.indicator_code)).not.toContain(CODE);
    expect(liste.map((i) => i.indicator_code)).toContain('taux_pauvrete');
    expect(new Set(liste.map((i) => i.origine))).toEqual(new Set(['commune']));
  });

  it('BMW : couche civique 404, exactement comme un code inconnu', async () => {
    session('bmw');
    expect(await lireCivique(CODE)).toEqual({ statut: 404, corps: { error: 'unknown_variable', code: CODE } });
  });

  it('BMW : score « indicateur inconnu », même statut et même message qu un code inexistant', async () => {
    session('bmw');
    const refuse = await lancerScore(CODE);
    expect(refuse.statut).toBe(400);
    expect(refuse.erreur).toMatch(/Indicateur inconnu/);
    expect(refuse).toEqual(await lancerScore(INCONNU));
  });

  it('BMW : seuil sur territoires (aperçu de zone) refusé comme un inconnu', async () => {
    session('bmw');
    const refuse = await apercuSeuil(CODE);
    expect(refuse).toEqual({ statut: 422, corps: { error: expect.any(String), refus: 'indicateur_inconnu' } });
    expect(refuse).toEqual(await apercuSeuil(INCONNU));
  });

  it('super_admin dans l espace BMW : comme BMW (catalogue, corrélation)', async () => {
    session('bmw', 'super_admin');
    expect((await lireCatalogue()).map((i) => i.indicator_code)).not.toContain(CODE);
    expect(campagne, 'une campagne en base locale pour la corrélation').not.toBe('');
    const refuse = await lancerCorrelation(CODE);
    expect(refuse.statut).toBe(400);
    expect(refuse.erreur).toMatch(/Indicateur inconnu/);
    expect(refuse).toEqual(await lancerCorrelation(INCONNU));
  });

  it('super_admin dans l espace BMW : l export de stratégie ne lit pas l abstention (422, comme un code inconnu)', async () => {
    expect(strategie, 'une stratégie à courbe sur l abstention en base locale').not.toBe('');
    const exporter = () => exportStrategie.GET(
      new NextRequest(`http://localhost:3000/api/bidding/strategies/${strategie}/export?channel=dv360`),
      { params: Promise.resolve({ id: strategie }) },
    );
    session('bmw', 'super_admin');
    const refuse = await exporter();
    expect(refuse.status).toBe(422);
    expect(await refuse.json()).toEqual({ error: 'indicator_not_materialized', variable: CODE });
    session('bercy', 'super_admin');
    expect((await exporter()).status).toBe(200);
  });

  it('Bercy : le catalogue la rend, rangée « espace » ; la couche civique répond', async () => {
    session('bercy');
    const liste = await lireCatalogue();
    expect(liste.find((i) => i.indicator_code === CODE)).toMatchObject({ origine: 'espace' });
    expect(liste.find((i) => i.indicator_code === 'taux_pauvrete')).toMatchObject({ origine: 'commune' });
    const civ = await lireCivique(CODE);
    expect(civ.statut).toBe(200);
    expect(civ.corps.type).toBe('FeatureCollection');
    // Contrôle positif : le refus de BMW vient bien de la visibilité, pas d'une étape antérieure.
    expect((await lancerScore(CODE)).statut).toBe(200);
  });
});
