/**
 * A6 (sql/311, Q15 = A) — la population d'un cercle est celle de son DISQUE, pas celle de sa cellule hexagonale ;
 * le bilan (`achetee`, `hors_zone`, `couverte`) reste calculé sur l'UNION dédoublonnée des disques retenus.
 *
 * Ce que ce fichier prouve, sur une zone pavée par 7 cellules (disque de 3 km au centre de Lyon, cercles de 2 km,
 * seuil 0) :
 *   - la somme des `pop_totale` des 7 cercles DÉPASSE la diffusion achetée du bilan (les disques voisins se
 *     chevauchent) — avant correctif, c'était l'inverse : 589 515 < 622 710, les cellules forment une partition ;
 *   - `couverte + hors_zone = achetee` ; `somme_disques` = la somme des lignes ; `chevauchement` = somme − achetee ;
 *   - la `pop_totale` de chaque cercle est celle des carreaux à ≤ r (géodésique) de son centre, recomptée en SQL ;
 *   - `p_pop_min` filtre sur la population du disque.
 *
 * L'espace de test (et ses zones) est supprimé en cascade en fin de fichier.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerClientTest } from './_client';
import { psql } from './_psql';

const admin = creerClientTest();
const LONG = 120_000;
const RAYON = 2000;

interface Cercle { lon: number; lat: number; pop_en_zone: number; pop_totale: number; part: number }
interface Resultat {
  refus?: string; n_cercles: number; n_candidates: number; cercles: Cercle[];
  population: number; couverte: number; manques: number; hors_zone: number; achetee: number; taux_utile: number | null;
  somme_disques: number; chevauchement: number;
}

let org = '';
let zone = '';

async function paver(params: Record<string, unknown> = {}): Promise<Resultat> {
  const { data, error } = await admin.rpc('paver_cercles', {
    p_zone_id: zone, p_org_id: org, p_cible: 'ind', p_rayon_m: RAYON, p_seuil: 0, ...params,
  });
  if (error) throw new Error(`${error.code} ${error.message}`);
  return data as Resultat;
}

beforeAll(async () => {
  const { data, error } = await admin.from('organizations')
    .insert({ name: '[ESSAI A6] population du disque', slug: `essai-a6-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  org = data.id as string;
  zone = psql(`select public.creer_zone_recette('Lyon 3 km (A6)', '${org}', null, '{"v":1,"type":"dessin"}',
                 ST_AsGeoJSON(ST_Buffer(ST_SetSRID(ST_MakePoint(4.835, 45.76), 4326)::geography, 3000)::geometry))->>'id';`);
  if (!zone) throw new Error('zone de test non créée');
}, LONG);

afterAll(async () => {
  if (!org) return;
  const { error } = await admin.from('organizations').delete().eq('id', org);
  if (error) throw new Error(`nettoyage : ${error.message}`);
});

describe('paver_cercles — population du disque (A6)', () => {
  it('7 cellules : somme des disques > diffusion achetée ; couverte + hors zone = achetée', async () => {
    const r = await paver();
    expect(r.refus).toBeUndefined();
    expect(r.n_cercles).toBe(7);
    const somme = r.cercles.reduce((s, c) => s + c.pop_totale, 0);
    expect(somme).toBeGreaterThan(r.achetee);
    expect(Math.abs(r.couverte + r.hors_zone - r.achetee)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.couverte + r.manques - r.population)).toBeLessThanOrEqual(1);
    expect(r.somme_disques).toBe(somme);
    expect(r.chevauchement).toBe(somme - r.achetee);
    for (const c of r.cercles) {
      expect(c.pop_en_zone).toBeLessThanOrEqual(c.pop_totale);
      expect(c.part).toBeLessThanOrEqual(100);
    }
  }, LONG);

  it('la pop_totale de chaque cercle est celle des carreaux à ≤ r de son centre', async () => {
    const r = await paver();
    const centres = r.cercles.map((c) => `(${c.lon}, ${c.lat}, ${c.pop_totale})`).join(',');
    // Le centre rendu est arrondi au millionième de degré (≈ 0,1 m) : un carreau pile sur le bord peut basculer.
    const ecartMax = Number(psql(`
      select coalesce(max(abs(v.pop - d.pop)), 0)
        from (values ${centres}) v(lon, lat, pop)
        cross join lateral (
          select coalesce(sum(cc.pops[(select rang_pop from public.cibles_exposition where code = 'ind')]), 0) as pop
            from public.carreau_couverture cc
           where cc.centroide_3857 && ST_Expand(ST_Transform(ST_SetSRID(ST_MakePoint(v.lon, v.lat), 4326), 3857), ${RAYON * 2})
             and ST_DWithin(ST_Transform(cc.centroide_3857, 4326)::geography,
                            ST_SetSRID(ST_MakePoint(v.lon, v.lat), 4326)::geography, ${RAYON})) d;`));
    expect(ecartMax).toBeLessThanOrEqual(50);
  }, LONG);

  it('p_pop_min filtre sur la population du DISQUE', async () => {
    const base = await paver();
    const tri = base.cercles.map((c) => c.pop_totale).sort((a, b) => a - b);
    // Entre deux populations voisines (les lignes sont arrondies à l'entier, le filtre lit la valeur exacte).
    const m = Math.floor(tri.length / 2);
    const seuil = Math.floor((tri[m - 1] + tri[m]) / 2);
    expect(tri[m] - tri[m - 1]).toBeGreaterThan(2);
    const r = await paver({ p_pop_min: seuil });
    expect(r.cercles.every((c) => c.pop_totale >= seuil)).toBe(true);
    expect(r.n_cercles).toBe(base.cercles.filter((c) => c.pop_totale >= seuil).length);
  }, LONG);
});
