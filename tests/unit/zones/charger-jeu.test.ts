import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chargerJeu, SANS_CONTROLE_ESPACE } from '@/lib/zones/charger-jeu';
import { JeuZoneSchema, JeuDeZonesSchema, JEU_DEFAUT, MOTIF_CLASSE, TYPES_JEU } from '@/lib/zones/jeu';

/**
 * Le chargeur commun des routes de jeux (lot 5, T6) et le schéma d'un jeu de ZONE.
 *
 * Le chargeur est la seule lecture de `zone_sets` des routes `[id]` : il filtre par l'espace (les routes passent par
 * `createAdminClient`, qui contourne la RLS), et il rend une réponse PRÊTE — 404, 409 ou 500 — que la route renvoie
 * telle quelle.
 */
const ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const JEU = '3f2504e0-4f89-11d3-9a0c-0305e82c3302';

let ligne: { data: unknown; error: unknown };
let filtres: string[];
let lectures: number;

const client = {
  from(table: string) {
    lectures += 1;
    const q = {
      select: () => q,
      eq: (col: string, val: string) => { filtres.push(`${table}.${col}=${val}`); return q; },
      maybeSingle: async () => ligne,
    };
    return q;
  },
} as never;

beforeEach(() => {
  ligne = { data: null, error: null };
  filtres = [];
  lectures = 0;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('chargerJeu', () => {
  it('rend le jeu de l’espace, lu par id ET espace', async () => {
    ligne = { data: { id: JEU, type: 'risque' }, error: null };
    const r = await chargerJeu(client, JEU, ORG, { type: 'risque' });
    expect(r).toEqual({ ok: true, jeu: { id: JEU, type: 'risque' } });
    expect(filtres).toEqual([`zone_sets.id=${JEU}`, `zone_sets.org_id=${ORG}`]);
  });

  it('absent (ou d’un autre espace) : 404 en français', async () => {
    const r = await chargerJeu(client, JEU, ORG, { type: 'risque' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reponse.status).toBe(404);
    expect(await r.reponse.json()).toEqual({ error: 'Jeu de zones introuvable dans cet espace.' });
  });

  it('un identifiant qui n’est pas un UUID : 404 sans requête (Postgres répondrait 22P02, soit un 500)', async () => {
    const r = await chargerJeu(client, 'pas-un-uuid', ORG);
    expect(r.ok || r.reponse.status).toBe(404);
    expect(lectures).toBe(0);
  });

  it('un jeu de l’autre type : 409 qui dit où il se gère', async () => {
    ligne = { data: { id: JEU, type: 'zone' }, error: null };
    const z = await chargerJeu(client, JEU, ORG, { type: 'risque' });
    expect(z.ok || [z.reponse.status, await z.reponse.json()])
      .toEqual([409, { error: "Ce jeu de zones se gère à l'étape ⑤ de la carte." }]);

    ligne = { data: { id: JEU, type: 'risque' }, error: null };
    const r = await chargerJeu(client, JEU, ORG, { type: 'zone' });
    expect(r.ok || [r.reponse.status, await r.reponse.json()])
      .toEqual([409, { error: 'Ce jeu de zones se gère dans le module risque.' }]);
  });

  it('sans type demandé : les deux types passent', async () => {
    for (const type of TYPES_JEU) {
      ligne = { data: { id: JEU, type }, error: null };
      expect((await chargerJeu(client, JEU, ORG)).ok).toBe(true);
    }
  });

  it('erreur de lecture : 500 neutre, détail Postgres au journal seulement', async () => {
    ligne = { data: null, error: { message: 'relation "zone_sets" does not exist' } };
    const r = await chargerJeu(client, JEU, ORG);
    expect(r.ok || [r.reponse.status, await r.reponse.json()]).toEqual([500, { error: 'Jeu de zones illisible.' }]);
    expect(console.error).toHaveBeenCalled();
  });

  it('SANS_CONTROLE_ESPACE : aucun filtre d’espace (propriété prouvée ailleurs, par l’accès à la campagne)', async () => {
    ligne = { data: { id: JEU, type: 'risque' }, error: null };
    await chargerJeu(client, JEU, SANS_CONTROLE_ESPACE, { type: 'risque' });
    expect(filtres).toEqual([`zone_sets.id=${JEU}`]);
  });
});

describe('JeuZoneSchema', () => {
  const valide = {
    type: 'zone', zone_id: JEU, cible: 'ind', mode_plan: 'exclusif',
    plateformes: [
      { plateforme: 'dv360', maille: 'cp', seuil: 20 },
      { plateforme: 'meta', maille: 'cercle', seuil: 30, rayon_m: 10000 },
      { plateforme: 'ttd', maille: 'polygone', seuil: 0 },
      { plateforme: 'tiktok', maille: 'commune', seuil: 20 },
    ],
  };

  it('accepte un jeu de zone à quatre plateformes', () => {
    expect(JeuZoneSchema.safeParse(valide).success).toBe(true);
  });

  it.each([
    ['une plateforme deux fois', { plateformes: [valide.plateformes[0], { ...valide.plateformes[0], maille: 'polygone' }] }],
    ['plus de quatre choix', { plateformes: [...valide.plateformes, valide.plateformes[0]] }],
    ['aucun choix', { plateformes: [] }],
    ['une maille inconnue', { plateformes: [{ plateforme: 'dv360', maille: 'region', seuil: 20 }] }],
    ['une plateforme inconnue', { plateformes: [{ plateforme: 'snap', maille: 'cp', seuil: 20 }] }],
    ['un cercle sans rayon', { plateformes: [{ plateforme: 'meta', maille: 'cercle', seuil: 20 }] }],
    ['un rayon hors cercle', { plateformes: [{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: 5000 }] }],
    ['un seuil hors 0-100', { plateformes: [{ plateforme: 'dv360', maille: 'cp', seuil: 120 }] }],
    ['une zone qui n’est pas un UUID', { zone_id: 'x' }],
    ['le type risque', { type: 'risque' }],
  ])('refuse %s', (_cas, patch) => {
    expect(JeuZoneSchema.safeParse({ ...valide, ...patch }).success).toBe(false);
  });
});

describe('le jeu risque est inchangé', () => {
  it('JEU_DEFAUT passe, un profil reste obligatoire', () => {
    expect(JeuDeZonesSchema.safeParse(JEU_DEFAUT).success).toBe(true);
    const { profil: _profil, ...sansProfil } = JEU_DEFAUT;
    expect(JeuDeZonesSchema.safeParse(sansProfil).success).toBe(false);
  });

  it('MOTIF_CLASSE accepte la classe « zone » d’un jeu de zone, en plus des classes risque', () => {
    for (const c of ['zone', 'hors', 'haut:pprt', 'bas:2', 'autres:4']) expect(MOTIF_CLASSE.test(c), c).toBe(true);
    for (const c of ['zones', 'haut:5', 'zone:1', '']) expect(MOTIF_CLASSE.test(c), c).toBe(false);
  });
});
