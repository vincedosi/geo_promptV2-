/**
 * A8 (amendement E5) : la part prévue du suivi, découplée du multiplicateur. part prévue(u) = part × volume × classe ÷ Σ,
 * volume = population totale (Q9 = A), HORS_ZONE comprise, sommée PAR UNITÉ CP (groupe), répartie à parts égales entre
 * les codes d'un groupe. Avant A8, le suivi prenait `bid_multiplier ÷ Σ bid_multiplier` par code (sql/113:61).
 */
import { describe, it, expect } from 'vitest';
import { planCpDeZone, type VolumesAttendus } from '@/lib/zones/plan-jeu-zone';
import { partsPrevues, poidsPrevu, REPARTITION_GROUPE, universDeZone, VOLUME_ATTENDU } from '@/lib/zones/part-prevue';
import { FACTEUR_HORS_ZONE_NATIONAL } from '@/lib/zones/plan';
import type { LigneCouverture } from '@/lib/zones/couverture';

const cp = (code: string, pop_en_zone: number, pop_totale: number | null, part: number | null, membres?: string[]): LigneCouverture =>
  ({ code, nom: null, commune: null, n_carreaux: 1, pop_en_zone, pop_totale, part, part_brute: part, ...(membres ? { membres } : {}) });

/** Volumes = populations totales des lignes, référentiel de `total` habitants. */
const volumesDe = (lignes: LigneCouverture[], total: number): VolumesAttendus =>
  ({ total, par_code: new Map(lignes.filter((l) => l.pop_totale !== null).map((l) => [l.code, l.pop_totale as number])) });

/** L'ancienne part du suivi (sql/113:61) : m ÷ Σ m, par CODE. */
const ancienne = (lignes: { code_postal: string; multiplicateur: number }[]) => {
  const somme = lignes.reduce((t, l) => t + l.multiplicateur, 0);
  return Object.fromEntries(lignes.filter((l) => l.multiplicateur > 0).map((l) => [l.code_postal, l.multiplicateur / somme]));
};
const parts = (lignes: { code_postal: string; part_prevue: number | null }[]) =>
  Object.fromEntries(lignes.filter((l) => l.part_prevue !== null).map((l) => [l.code_postal, l.part_prevue as number]));

// L'exemple du document de relecture (§ 2.7) : A 18 000 sur 20 000 (90 %), B 9 000 sur 30 000 (30 %), C 3 000 sur 25 000 (12 %).
const EXEMPLE = [cp('75001', 18_000, 20_000, 90), cp('75002', 9_000, 30_000, 30), cp('75003', 3_000, 25_000, 12)];
const VOL = volumesDe(EXEMPLE, 1_000_000);

describe('A8 — la part prévue E5 (le test du brief : 90 / 30 / 12 %, seuil 20 %)', () => {
  it('exclusif : 18 000 ÷ 27 000 = 66,7 % et 9 000 ÷ 27 000 = 33,3 % ; le CP non retenu et HORS_ZONE à 0', () => {
    const { lignes, resume } = planCpDeZone(EXEMPLE, 20, 'exclusif', new Map(), undefined, {}, VOL);
    const p = parts(lignes);
    expect(Object.keys(p)).toEqual(['75001', '75002']);
    expect(p['75001']).toBeCloseTo(18_000 / 27_000, 12);
    expect(p['75002']).toBeCloseTo(9_000 / 27_000, 12);
    expect(lignes.find((l) => l.code_postal === '75003')!.part_prevue).toBeNull();
    expect(resume.multiplicateur.hors_zone).toMatchObject({ mode: 'strict', classe: 0, volume: 1_000_000 - 50_000, part_prevue: 0 });
    expect(resume.part_prevue).toEqual({
      volume_attendu: VOLUME_ATTENDU, unite_de_somme: 'unite_cp', repartition_groupe: REPARTITION_GROUPE, hors_zone: 0, unites_sans_part: 0,
    });
    // Le défaut corrigé : l'ancienne part (m ÷ Σ m, multiplicateurs 1,5 / 0,5) disait 75 % / 25 %.
    expect(ancienne(lignes)).toEqual({ 75001: 0.75, 75002: 0.25 });
  });

  it('INCHANGÉE si les multiplicateurs sont écrêtés (plage 0,9 à 1,1) — l’ancienne part, elle, changeait', () => {
    const libre = planCpDeZone(EXEMPLE, 20, 'exclusif', new Map(), undefined, {}, VOL);
    const ecrete = planCpDeZone(EXEMPLE, 20, 'exclusif', new Map(), undefined, { bornes: { min: 0.9, max: 1.1 } }, VOL);
    expect(ecrete.lignes.filter((l) => l.multiplicateur > 0).map((l) => l.multiplicateur)).toEqual([1.1, 0.9]);
    expect(ecrete.resume.multiplicateur.n_ecretes).toBe(2);
    expect(parts(ecrete.lignes)).toEqual(parts(libre.lignes));
    expect(ancienne(ecrete.lignes)['75001']).toBeCloseTo(0.55, 12);
  });

  it('pondéré (national) : HORS_ZONE entre dans Σ — classe 0,8 × le plus petit brut retenu, volume = référentiel − retenus', () => {
    const { lignes, resume } = planCpDeZone(EXEMPLE, 20, 'pondere', new Map(), undefined, {}, VOL);
    const classe = FACTEUR_HORS_ZONE_NATIONAL * 0.3;
    const volumeHz = 1_000_000 - 20_000 - 30_000;
    const somme = 18_000 + 9_000 + classe * volumeHz;
    const p = parts(lignes);
    expect(p['75001']).toBeCloseTo(18_000 / somme, 12);
    expect(p['75002']).toBeCloseTo(9_000 / somme, 12);
    expect(resume.multiplicateur.hors_zone.classe).toBeCloseTo(classe, 12);
    expect(resume.multiplicateur.hors_zone.volume).toBe(volumeHz);
    expect(resume.multiplicateur.hors_zone.part_prevue).toBeCloseTo((classe * volumeHz) / somme, 12);
    // Σ des parts (CP + HORS_ZONE) = 1 ; et l'écrêtage n'y change rien non plus.
    expect(p['75001'] + p['75002'] + (resume.multiplicateur.hors_zone.part_prevue as number)).toBeCloseTo(1, 12);
    const ecrete = planCpDeZone(EXEMPLE, 20, 'pondere', new Map(), undefined, { bornes: { min: 0.9, max: 1.1 } }, VOL);
    expect(parts(ecrete.lignes)).toEqual(p);
    expect(ecrete.resume.multiplicateur.hors_zone.part_prevue).toBe(resume.multiplicateur.hors_zone.part_prevue);
  });
});

describe('A8 — la somme se fait par UNITÉ CP (groupe), puis se répartit à parts égales (ruling 1)', () => {
  // Saint-Denis : trois codes, une géométrie, la population portée par le canonique (sql/228) ; Lyon 1 : un code.
  const LIGNES = [cp('93200', 30_000, 100_000, 30, ['93200', '93210', '93380']), cp('69001', 9_000, 10_000, 90, ['69001'])];
  const vol = volumesDe(LIGNES, 1_000_000);

  it('la part du groupe = 30 000 ÷ 39 000, un tiers par membre ; Σ des membres = la part du groupe', () => {
    const { lignes } = planCpDeZone(LIGNES, 20, 'exclusif', new Map(), undefined, {}, vol);
    const p = parts(lignes);
    const groupe = 30_000 / 39_000;
    for (const c of ['93200', '93210', '93380']) expect(p[c]).toBeCloseTo(groupe / 3, 12);
    expect(p['93200'] + p['93210'] + p['93380']).toBeCloseTo(groupe, 12);
    expect(p['69001']).toBeCloseTo(9_000 / 39_000, 12);
    // Le défaut de la relecture A2 (I-1) : par code, le groupe au même multiplicateur pesait 3 fois.
    const a = ancienne(lignes);
    expect(a['93200'] + a['93210'] + a['93380']).toBeCloseTo((3 * 0.5) / (3 * 0.5 + 1.5), 12);
  });

  it('règle `divise` du registre : multiplicateurs partagés, part prévue identique (elle ne dépend pas du multiplicateur)', () => {
    const meme = planCpDeZone(LIGNES, 20, 'exclusif', new Map(), undefined, {}, vol);
    const divise = planCpDeZone(LIGNES, 20, 'exclusif', new Map(), undefined, { poids_groupe_cp: 'divise' }, vol);
    expect(parts(divise.lignes)).toEqual(parts(meme.lignes));
  });
});

describe('D35 — le volume HORS_ZONE est restreint à l’univers de la zone (métropole ou France entière)', () => {
  it('universDeZone : une zone qui ne touche aucun DROM est en métropole ; un code en 97 la met en France entière', () => {
    expect(universDeZone(['31000', '31100', '20000'], null)).toBe('METRO');
    expect(universDeZone(['75001', '97200'], null)).toBe('FR');
    expect(universDeZone(['97133'], null)).toBe('FR');
    // Aucune unité connue (couverture vide) : la métropole, l’univers d’un ciblage sans DROM.
    expect(universDeZone([], null)).toBe('METRO');
  });

  it('universDeZone : une zone PAYS dit elle-même son univers, quelles que soient ses unités', () => {
    expect(universDeZone(['75001'], { v: 1, type: 'pays', code: 'FR' })).toBe('FR');
    expect(universDeZone(['75001'], { v: 1, type: 'pays', code: 'METRO' })).toBe('METRO');
    expect(universDeZone(['31000'], { v: 1, type: 'rayon_point', lon: 1.44, lat: 43.6, rayon_m: 6000 })).toBe('METRO');
  });

  it('planCpDeZone fige l’univers du volume sur la ligne HORS_ZONE ; sans volumes (tests), `null`', () => {
    const avec = planCpDeZone(EXEMPLE, 20, 'pondere', new Map(), undefined, {}, { ...VOL, univers: 'METRO' });
    expect(avec.resume.multiplicateur.hors_zone).toMatchObject({ mode: 'national', univers: 'METRO', volume: 1_000_000 - 50_000 });
    const sans = planCpDeZone(EXEMPLE, 20, 'pondere', new Map());
    expect(sans.resume.multiplicateur.hors_zone).toMatchObject({ univers: null, volume: null });
  });

  it('strict : poids 0 et part prévue 0, même avec le volume de l’univers ; national : part prévue > 0 avec ce volume', () => {
    const strict = planCpDeZone(EXEMPLE, 20, 'exclusif', new Map(), undefined, {}, { ...VOL, univers: 'METRO' });
    expect(strict.resume.multiplicateur.hors_zone).toMatchObject({ mode: 'strict', multiplicateur: 0, classe: 0, part_prevue: 0, univers: 'METRO' });
    const national = planCpDeZone(EXEMPLE, 20, 'pondere', new Map(), undefined, {}, { ...VOL, univers: 'METRO' });
    expect(national.resume.multiplicateur.hors_zone.multiplicateur).toBeGreaterThan(0);
    expect(national.resume.multiplicateur.hors_zone.part_prevue).toBeGreaterThan(0);
  });
});

describe('A8 — volume inconnu : `null`, jamais 0 ni une part inventée', () => {
  it('liste exacte, code sans carreau (ARB-3) : retenu au multiplicateur neutre, part prévue `null`, hors de Σ, compté', () => {
    const lignes = [cp('75001', 18_000, 20_000, 90)];
    const { lignes: plan, resume } = planCpDeZone(lignes, 99, 'exclusif', new Map(), ['75001', '97133'], {}, volumesDe(lignes, 1_000_000));
    expect(plan.find((l) => l.code_postal === '97133')).toMatchObject({ retenu: true, part_prevue: null });
    expect(plan.find((l) => l.code_postal === '75001')!.part_prevue).toBeCloseTo(1, 12);
    expect(resume.part_prevue.unites_sans_part).toBe(1);
  });

  it('national sans volume de HORS_ZONE : toutes les parts `null` (la somme serait fausse pour toutes les unités)', () => {
    const r = partsPrevues([{ code: 'A', membres: ['A'], part: 0.9, volume: 20_000, classe: 1 }], { part: 1, volume: null, classe: 0.24 });
    expect([...r.par_code.values()]).toEqual([null]);
    expect(r).toMatchObject({ hors_zone: null, somme: null });
  });

  it('strict : HORS_ZONE de classe 0 pèse 0 même sans volume', () => {
    const r = partsPrevues([{ code: 'A', membres: ['A'], part: 0.5, volume: 10, classe: 1 }], { part: 1, volume: null, classe: 0 });
    expect(r.par_code.get('A')).toBe(1);
    expect(r.hors_zone).toBe(0);
  });

  it('poidsPrevu : part, volume et classe se multiplient ; volume nul ou absent → null', () => {
    expect(poidsPrevu(0.9, 20_000, 1)).toBeCloseTo(18_000, 9);
    expect(poidsPrevu(0.9, 20_000, 2)).toBeCloseTo(36_000, 9);
    expect(poidsPrevu(null, 20_000, 1)).toBeNull();
    expect(poidsPrevu(0.9, 0, 1)).toBeNull();
    expect(poidsPrevu(0.9, null, 1)).toBeNull();
  });
});
