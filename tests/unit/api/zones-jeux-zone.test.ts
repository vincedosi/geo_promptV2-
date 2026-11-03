import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Les routes d'un jeu de ZONE (lot 5, T7) : `POST /api/zones/jeux` (corps `jeu.type = 'zone'`), `GET` de la liste,
 * `GET` / `PATCH` / `DELETE /api/zones/jeux/[id]`.
 *
 * Le client Supabase est factice : chaque requête se journalise (lecture ou écriture, avec ses filtres) et rend la
 * donnée prévue pour `table:opération` (`1` ajouté pour `.single()` / `.maybeSingle()`). Toute RPC lève : un jeu de
 * zone ne CALCULE rien à l'enregistrement — ses chiffres se relisent par la couverture (A-2).
 */
const h = vi.hoisted(() => ({
  ORG: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  JEU: '3f2504e0-4f89-11d3-9a0c-0305e82c3302',
  ZONE: '3f2504e0-4f89-11d3-9a0c-0305e82c3304',
  profil: null as Record<string, unknown> | null,
  quotaOk: true,
  quotas: 0,
  donnees: {} as Record<string, unknown>,
  erreurs: {} as Record<string, { message: string; code?: string }>,
  lectures: [] as string[],
  ecritures: [] as { table: string; op: string; valeur?: unknown; options?: unknown; filtres: string[] }[],
}));

function requete(table: string) {
  const etat = { op: 'select', valeur: undefined as unknown, options: undefined as unknown, filtres: [] as string[] };
  const fin = (unique: boolean) => {
    const cle = `${table}:${etat.op}${unique ? '1' : ''}`;
    if (etat.op === 'select') h.lectures.push(`${table}:${etat.filtres.join(',')}`);
    else h.ecritures.push({ table, op: etat.op, valeur: etat.valeur, options: etat.options, filtres: [...etat.filtres] });
    const erreur = h.erreurs[cle];
    if (erreur) return { data: null, error: erreur, count: null };
    const data = h.donnees[cle] ?? null;
    return { data, error: null, count: Array.isArray(data) ? data.length : 1 };
  };
  const q: Record<string, unknown> = {};
  for (const m of ['order', 'limit', 'range', 'select']) q[m] = () => q;
  q.eq = (c: string, v: unknown) => { etat.filtres.push(`${c}=${String(v)}`); return q; };
  q.in = (c: string, v: unknown[]) => { etat.filtres.push(`${c} in ${v.join('|')}`); return q; };
  q.not = (c: string, o: string, v: unknown) => { etat.filtres.push(`${c} not ${o} ${String(v)}`); return q; };
  for (const op of ['insert', 'upsert', 'update', 'delete']) {
    q[op] = (valeur?: unknown, options?: unknown) => {
      etat.op = op;
      etat.valeur = op === 'delete' ? undefined : valeur;
      etat.options = op === 'delete' ? valeur : options;
      return q;
    };
  }
  q.maybeSingle = async () => fin(true);
  q.single = async () => fin(true);
  q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(fin(false)).then(ok, ko);
  return q;
}

vi.mock('@/lib/api/middleware', () => ({
  requireAuth: async () => h.profil,
  authUnauthorized: () => Response.json({ error: 'Non authentifié' }, { status: 401 }),
}));
vi.mock('@/lib/api/rate-limit', () => ({
  createRateLimiter: (o: { prefix: string }) => async () => {
    expect(o.prefix).toBe('geo:rl:zone-sets');
    h.quotas += 1;
    return { ok: h.quotaOk, retrySec: 30 };
  },
  rateLimitResponse: () => Response.json({ error: 'Trop de requêtes' }, { status: 429 }),
  // Le quota des zones (`geo:rl:zones`, `session-zones.ts`) n'est jamais consommé par un jeu : il lève s'il l'est.
  createQuota: () => async () => { throw new Error('quota des zones consommé par un jeu'); },
}));
vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    from: (table: string) => requete(table),
    rpc(nom: string) { throw new Error(`RPC inattendue : ${nom}`); },
  }),
}));

const { GET: lister, POST } = await import('@/app/api/zones/jeux/route');
const R = await import('@/app/api/zones/jeux/[id]/route');

const URL_LISTE = 'http://localhost/api/zones/jeux';
const URL_JEU = `${URL_LISTE}/${h.JEU}`;
const params = { params: Promise.resolve({ id: h.JEU }) };
const corps = (methode: string, c: unknown) =>
  ({ method: methode, body: JSON.stringify(c), headers: { 'content-type': 'application/json' } });
const poster = (c: unknown) => POST(new NextRequest(URL_LISTE, corps('POST', c)));
const patcher = (c: unknown) => R.PATCH(new NextRequest(URL_JEU, corps('PATCH', c)), params);

/** Les règles de `plateformes_geo` lues pour dv360 et meta (extrait du seed sql/274), entières : `lireRegles` les valide. */
const regle = (r: { plateforme: string; maille: string; disponible: boolean; limites: object; note: string | null }) => ({
  libelle: r.maille, natif: true, doc_url: null, releve_le: '2026-10-14', a_verifier: false, ordre: 0, ...r,
});
const REGLES = [
  regle({ plateforme: 'dv360', maille: 'cp', disponible: true, limites: {}, note: null }),
  { ...regle({ plateforme: 'dv360', maille: 'pays', disponible: true, limites: {}, note: null }),
    codes_pays: { METRO: ['FR'], FR: ['FR', 'GP', 'MQ', 'GF', 'RE', 'YT'] } },
  regle({ plateforme: 'dv360', maille: 'polygone', disponible: false, limites: {}, note: 'Pas de polygone (relevé du 14/10).' }),
  regle({ plateforme: 'meta', maille: 'cercle', disponible: true, limites: { rayon_min_m: 1000, rayon_max_m: 80000 }, note: null }),
];

const jeuZone = (patch: Record<string, unknown> = {}) => ({
  type: 'zone', zone_id: h.ZONE, cible: 'ind', mode_plan: 'pondere',
  plateformes: [
    { plateforme: 'dv360', maille: 'cp', seuil: 20 },
    { plateforme: 'meta', maille: 'cercle', seuil: 30, rayon_m: 10000 },
  ],
  ...patch,
});

const ligneJeu = (type = 'zone') => ({
  id: h.JEU, org_id: h.ORG, created_by: 'u1', type, nom: 'Bretagne', description: null, version: 1, brouillon: false,
  created_at: '2026-10-24T00:00:00Z', construit_le: null, profil: null, profil_hash: null,
  custom_geo_zone_id: type === 'zone' ? h.ZONE : null, cible: 'ind', gravites: [], natures: [], modes: [],
  territoire: null, mode_plan: 'pondere', seuil_couverture_cp: 20, poids: {}, population_exposee: null,
  n_cp_retenus: null, taux_utile: null,
});

beforeEach(() => {
  h.profil = { id: 'u1', role: 'client', organization_id: h.ORG };
  h.quotaOk = true;
  h.quotas = 0;
  h.erreurs = {};
  h.lectures.length = 0;
  h.ecritures.length = 0;
  h.donnees = {
    'custom_geo_zones:select1': { id: h.ZONE, name: 'CIRFA Bretagne', recette: { v: 1, type: 'dessin' } },
    'cibles_exposition:select1': { code: 'ind' },
    'plateformes_geo:select': REGLES,
    'zone_sets:select': [{ version: 2 }],
    'zone_sets:insert1': { id: h.JEU },
    'zone_sets:select1': ligneJeu(),
    'zone_set_plateformes:select': [{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null }],
  };
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('POST /api/zones/jeux — jeu de zone', () => {
  it('401 sans session, 403 sans espace actif — rien lu, aucun jeton consommé', async () => {
    h.profil = null;
    expect((await poster({ nom: 'J', jeu: jeuZone() })).status).toBe(401);
    h.profil = { id: 'u1', role: 'client', organization_id: null };
    expect((await poster({ nom: 'J', jeu: jeuZone() })).status).toBe(403);
    expect(h.lectures).toEqual([]);
    expect(h.quotas).toBe(0);
  });

  it.each([
    ['nom absent', { jeu: jeuZone() }, 'nom : requis'],
    ['nom vide', { nom: '  ', jeu: jeuZone() }, 'nom : ne peut pas être vide'],
    ['plateforme en double', {
      nom: 'J', jeu: jeuZone({ plateformes: [{ plateforme: 'dv360', maille: 'cp', seuil: 20 }, { plateforme: 'dv360', maille: 'cp', seuil: 50 }] }),
    }, 'Une seule maille par plateforme.'],
    ['clé inconnue (corps strict)', { nom: 'J', jeu: jeuZone(), brouillon: true }, 'clé inattendue : brouillon'],
    ['rayon hors cercle', {
      nom: 'J', jeu: jeuZone({ plateformes: [{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: 5000 }] }),
    }, 'Un rayon pour la maille cercle, et pour elle seule.'],
  ])('400 %s — avant toute lecture et tout jeton', async (_n, c, message) => {
    const r = await poster(c);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain(message);
    expect(h.lectures).toEqual([]);
    expect(h.quotas).toBe(0);
  });

  it.each([
    ['couple inconnu de plateformes_geo', [{ plateforme: 'dv360', maille: 'iris', seuil: 20 }],
      'dv360 n’achète pas à la maille iris.'],
    ['maille non disponible', [{ plateforme: 'dv360', maille: 'polygone', seuil: 20 }],
      'La maille polygone n’est pas disponible chez dv360 : Pas de polygone (relevé du 14/10).'],
    ['rayon sous la borne de la plateforme', [{ plateforme: 'meta', maille: 'cercle', seuil: 20, rayon_m: 500 }],
      'Rayon de 500 m hors des bornes de meta (1 000 à 80 000 m).'],
  ])('400 %s — lu dans la table, rien écrit', async (_n, plateformes, message) => {
    const r = await poster({ nom: 'J', jeu: jeuZone({ plateformes }) });
    expect(r.status).toBe(400);
    expect((await r.json()).error.replace(/\s/g, ' ')).toBe(message.replace(/\s/g, ' '));
    expect(h.ecritures).toEqual([]);
  });

  it('400 cible inconnue (ou inactive) de cibles_exposition', async () => {
    h.donnees['cibles_exposition:select1'] = null;
    const r = await poster({ nom: 'J', jeu: jeuZone({ cible: 'xxx' }) });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('Cible inconnue : xxx.');
    expect(h.lectures).toContain('cibles_exposition:code=xxx,actif=true');
    expect(h.ecritures).toEqual([]);
  });

  it('404 zone d’un autre espace : la lecture est bornée à l’espace de la session', async () => {
    h.donnees['custom_geo_zones:select1'] = null;
    const r = await poster({ nom: 'J', jeu: jeuZone() });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'Zone introuvable dans cet espace.', refus: 'zone_introuvable' });
    expect(h.lectures).toContain(`custom_geo_zones:id=${h.ZONE},org_id=${h.ORG}`);
    expect(h.ecritures).toEqual([]);
  });

  it('429 quota geo:rl:zone-sets épuisé — avant toute lecture', async () => {
    h.quotaOk = false;
    const r = await poster({ nom: 'J', jeu: jeuZone() });
    expect(r.status).toBe(429);
    expect(h.lectures).toEqual([]);
  });

  it('201 : zone_sets (type zone, version max + 1) puis zone_set_plateformes, une requête chacune, aucun calcul', async () => {
    const r = await poster({ nom: 'Bretagne', description: 'CIRFA', jeu: jeuZone() });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ id: h.JEU, version: 3 });
    expect(h.lectures).toContain(`zone_sets:org_id=${h.ORG},nom=Bretagne`);
    expect(h.ecritures).toEqual([
      {
        table: 'zone_sets', op: 'insert', options: undefined, filtres: [],
        valeur: {
          type: 'zone', nom: 'Bretagne', description: 'CIRFA', org_id: h.ORG, created_by: 'u1', version: 3,
          custom_geo_zone_id: h.ZONE, cible: 'ind', mode_plan: 'pondere', categorie_speciale: false, brouillon: false,
        },
      },
      {
        table: 'zone_set_plateformes', op: 'insert', options: undefined, filtres: [],
        valeur: [
          { zone_set_id: h.JEU, plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null },
          { zone_set_id: h.JEU, plateforme: 'meta', maille: 'cercle', seuil: 30, rayon_m: 10000 },
        ],
      },
    ]);
  });

  it('les choix échouent : le jeu est retiré (erreur du retrait lue), 500 neutre', async () => {
    h.erreurs['zone_set_plateformes:insert'] = { message: 'panne' };
    const r = await poster({ nom: 'Bretagne', jeu: jeuZone() });
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'Enregistrement impossible.' });
    expect(h.ecritures.at(-1)).toMatchObject({ table: 'zone_sets', op: 'delete', filtres: [`id=${h.JEU}`] });
  });

  it('un corps sans `jeu.type` reste un jeu RISQUE (chemin inchangé)', async () => {
    const r = await poster({ jeu: { type: 'risque' } });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/^jeu\.profil : requis/);
  });
});

describe('C29 — la case « catégorie spéciale » du jeu de zone', () => {
  const CS = { ...regle({ plateforme: 'meta', maille: 'cercle', disponible: true,
    limites: { rayon_min_m: 1000, rayon_max_m: 80000, rayon_min_categorie_speciale: 15000 }, note: null }) };
  beforeEach(() => { h.donnees['plateformes_geo:select'] = [REGLES[0], CS]; });

  it('POST coché, cercles Meta à 10 km : 400, la borne spéciale dite, rien écrit', async () => {
    const r = await poster({ nom: 'J', jeu: jeuZone({ categorie_speciale: true }) });
    expect(r.status).toBe(400);
    expect((await r.json()).error.replace(/\s/g, ' ')).toBe('Rayon de 10 000 m hors des bornes de meta (15 000 à 80 000 m, catégorie d’annonces spéciale).');
    expect(h.ecritures).toEqual([]);
  });

  it('POST coché à 15 km : écrit categorie_speciale = true sur le jeu ; décoché par défaut', async () => {
    const plateformes = [{ plateforme: 'dv360', maille: 'cp', seuil: 20 }, { plateforme: 'meta', maille: 'cercle', seuil: 30, rayon_m: 15000 }];
    expect((await poster({ nom: 'J', jeu: jeuZone({ categorie_speciale: true, plateformes }) })).status).toBe(201);
    expect(h.ecritures.find((e) => e.table === 'zone_sets')?.valeur).toMatchObject({ categorie_speciale: true });
    h.ecritures.length = 0;
    expect((await poster({ nom: 'J', jeu: jeuZone() })).status).toBe(201);
    expect(h.ecritures.find((e) => e.table === 'zone_sets')?.valeur).toMatchObject({ categorie_speciale: false });
  });

  it('round 1 : PATCH de la seule case — les choix ENREGISTRÉS se revérifient avec elle (Meta à 10 km → 400, rien écrit)', async () => {
    h.donnees['zone_set_plateformes:select'] = [{ plateforme: 'meta', maille: 'cercle', seuil: 30, rayon_m: 10000 }];
    const r = await patcher({ categorie_speciale: true });
    expect(r.status).toBe(400);
    expect((await r.json()).error.replace(/\s/g, ' ')).toBe('Rayon de 10 000 m hors des bornes de meta (15 000 à 80 000 m, catégorie d’annonces spéciale).');
    expect(h.ecritures).toEqual([]);
    h.donnees['zone_set_plateformes:select'] = [{ plateforme: 'meta', maille: 'cercle', seuil: 30, rayon_m: 15000 }];
    expect((await patcher({ categorie_speciale: true })).status).toBe(200);
    expect(h.ecritures.map((e) => `${e.table}:${e.op}`)).toEqual(['zone_sets:update']);
  });

  it('PATCH : la case se règle, et les choix se vérifient avec elle', async () => {
    const r = await patcher({ categorie_speciale: true, plateformes: [{ plateforme: 'meta', maille: 'cercle', seuil: 30, rayon_m: 10000 }] });
    expect(r.status).toBe(400);
    expect(h.ecritures).toEqual([]);
    const ok = await patcher({ categorie_speciale: true, plateformes: [{ plateforme: 'meta', maille: 'cercle', seuil: 30, rayon_m: 15000 }] });
    expect(ok.status).toBe(200);
    expect(h.ecritures.find((e) => e.table === 'zone_sets' && e.op === 'update')?.valeur).toEqual({ categorie_speciale: true });
  });
});

describe('GET /api/zones/jeux — le type de la liste', () => {
  /*
   * Les lecteurs d'avant le lot 5 (atelier risque, wizard `SourcePlan`, `JeuxDeZonesRail`) n'envoient aucun paramètre
   * et ne savent lire qu'un jeu risque : sans paramètre, la liste reste celle d'avant (revue finale, point 1).
   */
  it('sans paramètre : les seuls jeux risque (filtre type=risque), la liste d’avant le lot 5', async () => {
    h.donnees['zone_sets:select'] = [{ id: 'a', nom: 'Seveso', type: 'risque', custom_geo_zone_id: null, zone: null }];
    const r = await lister(new NextRequest(URL_LISTE));
    expect(r.status).toBe(200);
    expect(h.lectures.at(-1)).toBe(`zone_sets:org_id=${h.ORG},brouillon=false,type=risque`);
  });

  it('type=zone : les seuls jeux de zone', async () => {
    h.donnees['zone_sets:select'] = [];
    expect((await lister(new NextRequest(`${URL_LISTE}?type=zone`))).status).toBe(200);
    expect(h.lectures.at(-1)).toBe(`zone_sets:org_id=${h.ORG},brouillon=false,type=zone`);
  });

  it('type inconnu → 400, aucune lecture', async () => {
    const r = await lister(new NextRequest(`${URL_LISTE}?type=campagne`));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('Paramètre type invalide : risque, zone ou tous.');
    expect(h.lectures).toEqual([]);
  });

  it('type=tous : les deux types, avec custom_geo_zone_id, le nom de la zone et le nombre d’extractions (aplatis)', async () => {
    h.donnees['zone_sets:select'] = [
      { id: 'a', nom: 'Seveso', type: 'risque', custom_geo_zone_id: null, zone: null, extractions: [{ count: 2 }] },
      { id: 'b', nom: 'Bretagne', type: 'zone', custom_geo_zone_id: h.ZONE, zone: { name: 'CIRFA Bretagne' }, extractions: [{ count: 0 }] },
    ];
    const r = await lister(new NextRequest(`${URL_LISTE}?type=tous`));
    expect(r.status).toBe(200);
    expect(h.lectures.at(-1)).toBe(`zone_sets:org_id=${h.ORG},brouillon=false`);
    expect((await r.json()).jeux).toEqual([
      { id: 'a', nom: 'Seveso', type: 'risque', custom_geo_zone_id: null, zone_nom: null, n_extractions: 2 },
      { id: 'b', nom: 'Bretagne', type: 'zone', custom_geo_zone_id: h.ZONE, zone_nom: 'CIRFA Bretagne', n_extractions: 0 },
    ]);
  });
});

describe('GET /api/zones/jeux/[id] — jeu de zone', () => {
  it('{ jeu, zone, plateformes } ; ni org_id ni created_by ; aucune lecture de zone_set_cp', async () => {
    const r = await R.GET(new NextRequest(URL_JEU), params);
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.jeu).toEqual({
      id: h.JEU, type: 'zone', nom: 'Bretagne', description: null, version: 1, created_at: '2026-10-24T00:00:00Z',
      custom_geo_zone_id: h.ZONE, cible: 'ind', mode_plan: 'pondere',
    });
    expect(json.zone).toEqual({ id: h.ZONE, nom: 'CIRFA Bretagne', recette: { v: 1, type: 'dessin' } });
    expect(json.plateformes).toEqual([{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null }]);
    expect(h.lectures.some((l) => l.startsWith('zone_set_cp'))).toBe(false);
    expect(h.lectures).toContain(`custom_geo_zones:id=${h.ZONE},org_id=${h.ORG}`);
  });
  it('B15 round 1 (I-2) : la recette rendue porte la COLONNE des unités constitutives (sql/321), jointe à la lecture', async () => {
    const SCORE = { indicateurs: [{ code: 'taux_pauvrete', poids: 1, sens: 'croissant' }], maille: 'cp', seuil_score: 60 };
    const unites = { maille: 'cp', codes: ['35000'], groupes_partiels: 1 };
    h.donnees['custom_geo_zones:select1'] = { id: h.ZONE, name: 'Score', recette: { v: 1, type: 'capture', source_type: 'score', parametres: SCORE }, unites_constitutives: unites };
    const json = await (await R.GET(new NextRequest(URL_JEU), params)).json();
    expect(json.zone.recette).toEqual({ v: 1, type: 'capture', source_type: 'score', parametres: SCORE, unites_constitutives: unites });
  });
});

describe('PATCH /api/zones/jeux/[id] — jeu de zone', () => {
  it('nom et mode de plan : une mise à jour de l’en-tête, puis le jeu relu', async () => {
    const r = await patcher({ nom: 'Bretagne v2', mode_plan: 'exclusif' });
    expect(r.status).toBe(200);
    expect(h.ecritures).toEqual([{
      table: 'zone_sets', op: 'update', options: undefined, valeur: { nom: 'Bretagne v2', mode_plan: 'exclusif' },
      filtres: [`id=${h.JEU}`, `org_id=${h.ORG}`],
    }]);
    expect(Object.keys(await r.json()).sort()).toEqual(['jeu', 'plateformes', 'zone']);
  });

  it('remplace les choix : couples vérifiés, upsert des nouveaux, DELETE ciblé des plateformes retirées', async () => {
    const r = await patcher({ plateformes: [{ plateforme: 'meta', maille: 'cercle', seuil: 25, rayon_m: 15000 }] });
    expect(r.status).toBe(200);
    expect(h.ecritures).toEqual([
      {
        table: 'zone_set_plateformes', op: 'upsert', options: { onConflict: 'zone_set_id,plateforme' }, filtres: [],
        valeur: [{ zone_set_id: h.JEU, plateforme: 'meta', maille: 'cercle', seuil: 25, rayon_m: 15000 }],
      },
      {
        table: 'zone_set_plateformes', op: 'delete', valeur: undefined, options: undefined,
        filtres: [`zone_set_id=${h.JEU}`, 'plateforme not in ("meta")'],
      },
    ]);
  });

  it('le DELETE ciblé échoue : 500 dit, l’erreur est lue', async () => {
    h.erreurs['zone_set_plateformes:delete'] = { message: 'panne' };
    const r = await patcher({ plateformes: [{ plateforme: 'dv360', maille: 'cp', seuil: 20 }] });
    expect(r.status).toBe(500);
    expect((await r.json()).error).toBe('Choix des plateformes partiellement enregistré : relancez l’enregistrement.');
  });

  it('les choix échouent : l’en-tête n’est PAS écrit — « Modification impossible » dit vrai (revue finale, point 8)', async () => {
    h.erreurs['zone_set_plateformes:upsert'] = { message: 'panne' };
    const r = await patcher({ nom: 'Bretagne v2', plateformes: [{ plateforme: 'dv360', maille: 'cp', seuil: 20 }] });
    expect(r.status).toBe(500);
    expect((await r.json()).error).toBe('Modification impossible.');
    expect(h.ecritures.map((e) => `${e.table}:${e.op}`)).toEqual(['zone_set_plateformes:upsert']);
  });

  it('choix puis en-tête : un renommage refusé (23505) dit que les choix sont enregistrés', async () => {
    h.erreurs['zone_sets:update'] = { message: 'doublon', code: '23505' };
    const r = await patcher({ nom: 'Bretagne', plateformes: [{ plateforme: 'dv360', maille: 'cp', seuil: 20 }] });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe('Un jeu de zones de ce nom existe déjà dans cette version. Les choix des plateformes, eux, sont enregistrés.');
    expect(h.ecritures.map((e) => `${e.table}:${e.op}`)).toEqual(['zone_set_plateformes:upsert', 'zone_set_plateformes:delete', 'zone_sets:update']);
  });

  it('un couple non disponible : 400, rien écrit', async () => {
    const r = await patcher({ plateformes: [{ plateforme: 'dv360', maille: 'polygone', seuil: 20 }] });
    expect(r.status).toBe(400);
    expect(h.ecritures).toEqual([]);
  });

  it('les réglages du risque (seuil, poids) sont refusés sur un jeu de zone (corps strict)', async () => {
    const r = await patcher({ seuil_couverture_cp: 30 });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('clé inattendue : seuil_couverture_cp');
    expect(h.ecritures).toEqual([]);
  });

  it('un nom déjà pris dans cette version : 409', async () => {
    h.erreurs['zone_sets:update'] = { message: 'duplicate key', code: '23505' };
    const r = await patcher({ nom: 'Pris' });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe('Un jeu de zones de ce nom existe déjà dans cette version.');
  });
});

describe('DELETE /api/zones/jeux/[id] — jeu de zone', () => {
  it('supprime par id ET espace (choix et extractions en cascade)', async () => {
    h.donnees['zone_sets:delete'] = [{}];
    const r = await R.DELETE(new NextRequest(URL_JEU, { method: 'DELETE' }), params);
    expect(r.status).toBe(200);
    expect(h.ecritures).toEqual([{
      table: 'zone_sets', op: 'delete', valeur: undefined, options: { count: 'exact' },
      filtres: [`id=${h.JEU}`, `org_id=${h.ORG}`],
    }]);
  });
});

describe('la garde « maille sans objet » (⑤ finitions, T2, A-3) : avant toute écriture', () => {
  const PAYS = { v: 1, type: 'pays', code: 'METRO' };
  const zonePays = () => { h.donnees['custom_geo_zones:select1'] = { id: h.ZONE, name: 'France', recette: PAYS }; };
  const CERCLES_PAYS = 'Sur toute la France, le ciblage par cercles n’a pas de sens : choisissez le pays.';

  it('POST : Meta en cercles sur une zone nationale → 400 avec sa phrase, rien écrit, la recette lue dans l’espace', async () => {
    zonePays();
    const r = await poster({ nom: 'France', jeu: jeuZone() });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: `meta — ${CERCLES_PAYS}`, refus: 'maille_sans_objet', plateforme: 'meta' });
    expect(h.ecritures).toEqual([]);
    expect(h.lectures).toContain(`custom_geo_zones:id=${h.ZONE},org_id=${h.ORG}`);
  });

  it('POST : la maille pays sur une zone qui n’est pas nationale → 400, rien écrit', async () => {
    const r = await poster({ nom: 'Bretagne', jeu: jeuZone({ plateformes: [{ plateforme: 'dv360', maille: 'pays', seuil: 0 }] }) });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({
      error: 'dv360 — La maille pays ne s’achète que pour une zone nationale.', refus: 'maille_sans_objet', plateforme: 'dv360',
    });
    expect(h.ecritures).toEqual([]);
  });

  it('POST : DV360 au pays et au CP restent possibles sur une zone nationale → 201', async () => {
    zonePays();
    expect((await poster({ nom: 'France', jeu: jeuZone({ plateformes: [{ plateforme: 'dv360', maille: 'pays', seuil: 0 }] }) })).status)
      .toBe(201);
    expect((await poster({ nom: 'France', jeu: jeuZone({ plateformes: [{ plateforme: 'dv360', maille: 'cp', seuil: 20 }] }) })).status)
      .toBe(201);
  });

  it('PATCH : Meta en cercles sur la zone nationale du jeu → 400, rien écrit (recette lue dans l’espace du jeu)', async () => {
    zonePays();
    const r = await patcher({ plateformes: [{ plateforme: 'meta', maille: 'cercle', seuil: 25, rayon_m: 15000 }] });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: `meta — ${CERCLES_PAYS}`, refus: 'maille_sans_objet', plateforme: 'meta' });
    expect(h.ecritures).toEqual([]);
    expect(h.lectures).toContain(`custom_geo_zones:id=${h.ZONE},org_id=${h.ORG}`);
  });

  it('PATCH sans plateformes : aucune lecture de la zone avant l’écriture', async () => {
    const r = await patcher({ nom: 'Bretagne v3' });
    expect(r.status).toBe(200);
    expect(h.ecritures.map((e) => `${e.table}:${e.op}`)).toEqual(['zone_sets:update']);
  });
});

describe('décision du 02/11 : une zone de rayon sous 250 m ne s’enregistre pas en jeu (jamais activée)', () => {
  const TROP_FIN = 'Rayon de 100 m : trop fin pour être activé (minimum 250 m). Gardé pour l’analyse uniquement.';
  const zonePoi = (rayon_m: number) => {
    h.donnees['custom_geo_zones:select1'] = {
      id: h.ZONE, name: 'Lycées 100 m', recette: { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m, perimetre: { type: 'departement', code: '35' } },
    };
  };

  it('POST : rayon_poi 100 m → 400 avec la valeur, rien écrit', async () => {
    zonePoi(100);
    const r = await poster({ nom: 'Lycées', jeu: jeuZone() });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: TROP_FIN, refus: 'rayon_non_activable' });
    expect(h.ecritures).toEqual([]);
  });

  it('PATCH des plateformes : refusé de même, rien écrit', async () => {
    zonePoi(100);
    const r = await patcher({ plateformes: [{ plateforme: 'dv360', maille: 'cp', seuil: 20 }] });
    expect(r.status).toBe(400);
    expect((await r.json()).refus).toBe('rayon_non_activable');
    expect(h.ecritures).toEqual([]);
  });

  it('POST : rayon_poi 250 m → 201', async () => {
    zonePoi(250);
    expect((await poster({ nom: 'Lycées', jeu: jeuZone() })).status).toBe(201);
  });
});

describe('tour 3 (N-2) : un jeu sur une combinaison qui contient une zone sous 250 m ne s’enregistre pas', () => {
  const FINE = '3f2504e0-4f89-11d3-9a0c-0305e82c33f1';
  const DESSIN = '3f2504e0-4f89-11d3-9a0c-0305e82c33f2';
  it.each(['union', 'intersection', 'difference'])('POST %s → 400 qui nomme la zone et son rayon, rien écrit', async (operation) => {
    h.donnees['custom_geo_zones:select1'] = { id: h.ZONE, name: 'Combinée', recette: { v: 1, type: 'combinaison', operation, zones: [DESSIN, FINE] } };
    h.donnees['custom_geo_zones:select'] = [
      { id: DESSIN, name: 'Dessin', recette: { v: 1, type: 'dessin' } },
      { id: FINE, name: 'Lycées 100 m', recette: { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 100, perimetre: { type: 'departement', code: '35' } } },
    ];
    const r = await poster({ nom: 'Combinée', jeu: jeuZone() });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({
      error: 'La zone « Lycées 100 m » (rayon de 100 m) est trop fine pour être activée (minimum 250 m) : '
        + 'cette combinaison est gardée pour l’analyse uniquement.',
      refus: 'rayon_non_activable',
    });
    expect(h.ecritures).toEqual([]);
    expect(h.lectures.filter((l) => l.startsWith('custom_geo_zones:id in'))).toHaveLength(1);
  });
});
