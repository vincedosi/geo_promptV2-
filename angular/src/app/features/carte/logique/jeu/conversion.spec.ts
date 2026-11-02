import { MESSAGES_MAILLE_SANS_OBJET, appliquerSeuil, estRetenue, exactitude, mailleSansObjet, resumeExact, verifierLimites } from './conversion';
import { mailleParDefaut } from './conversion-defaut';
import type { PlateformeGeo } from './plateformes';

/**
 * La copie Angular de la conversion (lot 5, T9). Le comportement complet est éprouvé côté serveur
 * (`tests/unit/zones/conversion.test.ts`) et l'égalité des deux copies par `conversion-paritaire.test.ts` ; ici, les
 * deux égalités de la perte (Review Focus 1) et les cas qu'utilise l'écran de ⑤, dans le projet Angular lui-même.
 */
const ligne = (p: Partial<PlateformeGeo> & Pick<PlateformeGeo, 'plateforme' | 'maille'>): PlateformeGeo => ({
  libelle: 'x', natif: true, disponible: true, limites: {}, doc_url: null, releve_le: '2026-10-14', a_verifier: false,
  note: null, ordre: 0, ...p,
});

describe('conversion (copie Angular)', () => {
  const lignes = [
    { pop_en_zone: 80, pop_totale: 100, part: 80, part_brute: 80 }, { pop_en_zone: 10, pop_totale: 100, part: 10, part_brute: 10 },
    { pop_en_zone: 5, pop_totale: null, part: null, part_brute: null },
  ];
  it('manques + couverte = population ; hors_zone + couverte = achetée, à tout seuil', () => {
    for (const seuil of [0, 10, 50, 100]) {
      const r = appliquerSeuil(lignes, 95, seuil);
      expect(r.manques + r.couverte).toBe(95);
      expect(r.hors_zone + r.couverte).toBe(r.achetee);
    }
    expect(appliquerSeuil(lignes, 95, 50)).toMatchObject({ n_unites: 1, n_touchees: 3, couverte: 80, achetee: 100, taux_utile: 80 });
  });
  it('B11 : le seuil compare la part NON arrondie ; à seuil 0, une part nulle n’est pas retenue', () => {
    expect(estRetenue({ part_brute: 19.96 }, 20)).toBe(false);
    expect(estRetenue({ part_brute: 0.02 }, 0)).toBe(true);
    expect(estRetenue({ part_brute: 0 }, 0)).toBe(false);
  });
  it('une maille exacte : aucune perte, aucun calcul', () => {
    expect(resumeExact(1234, 5.5)).toMatchObject({ exacte: true, manques: 0, hors_zone: 0, taux_utile: 100, n_unites: 1 });
  });
  it('le rayon choisi décide de l’exactitude d’un cercle autour d’un point', () => {
    const r = { v: 1, type: 'rayon_point', lon: 5, lat: 43, rayon_m: 20_000, part_retenue: 1 } as const;
    expect(exactitude(r, 'cercle', ligne({ plateforme: 'meta', maille: 'cercle' }))).toBe('exacte');
    expect(exactitude(r, 'cercle', ligne({ plateforme: 'meta', maille: 'cercle' }), 5_000)).toBe('calculee');
    // A3 : un disque qui déborde du territoire (Strasbourg 20 km, 65,86 % en France) n'est jamais exact.
    expect(exactitude({ ...r, part_retenue: 0.6586 }, 'cercle', ligne({ plateforme: 'meta', maille: 'cercle' }))).toBe('calculee');
  });
  it('maille par défaut : « à vérifier » écartée d’abord ; avertissement de plafond lu dans la ligne', () => {
    const regles = [ligne({ plateforme: 'meta', maille: 'cp', a_verifier: true }), ligne({ plateforme: 'meta', maille: 'cercle' })];
    expect(mailleParDefaut(regles, 'meta', { v: 1, type: 'dessin' })).toBe('cercle');
    expect(verifierLimites(resumeExact(10, 1, 4), ligne({ plateforme: 'meta', maille: 'cp', limites: { max_unites: 3 } })))
      .toEqual([{ code: 'max_unites', limite: 3, valeur: 4 }]);
  });
});

describe('conversion (copie Angular) — la zone pays (⑤ finitions, T4)', () => {
  const metro = { v: 1, type: 'pays', code: 'METRO' } as const;
  const dessin = { v: 1, type: 'dessin' } as const;
  it('mailleSansObjet : cercles, communes et IRIS grisés sur une zone pays ; le pays sans objet ailleurs (Q-4)', () => {
    expect(mailleSansObjet(metro, 'cercle')).toBe(MESSAGES_MAILLE_SANS_OBJET.cercles_pays);
    expect(mailleSansObjet(metro, 'commune')).toBe(MESSAGES_MAILLE_SANS_OBJET.decoupage_pays);
    expect(mailleSansObjet(metro, 'iris')).toBe(MESSAGES_MAILLE_SANS_OBJET.decoupage_pays);
    for (const m of ['pays', 'cp', 'departement', 'polygone'] as const) expect(mailleSansObjet(metro, m)).toBeNull();
    expect(mailleSansObjet(dessin, 'pays')).toBe(MESSAGES_MAILLE_SANS_OBJET.pays_hors_zone_nationale);
    expect(mailleSansObjet(null, 'pays')).toBe(MESSAGES_MAILLE_SANS_OBJET.pays_hors_zone_nationale);
    expect(mailleSansObjet(dessin, 'cercle')).toBeNull();
  });
  it('exactitude : le pays est exact pour une zone pays, calculé sinon', () => {
    expect(exactitude(metro, 'pays')).toBe('exacte');
    expect(exactitude(dessin, 'pays')).toBe('calculee');
  });
  it('FINESSE : le pays d’office sur une zone pays (même devant un polygone « à vérifier ») ; jamais ailleurs', () => {
    const regles = [
      ligne({ plateforme: 'ttd', maille: 'polygone', a_verifier: true }), ligne({ plateforme: 'ttd', maille: 'pays', a_verifier: true }),
      ligne({ plateforme: 'meta', maille: 'cercle' }), ligne({ plateforme: 'meta', maille: 'pays' }),
    ];
    expect(mailleParDefaut(regles, 'ttd', metro)).toBe('pays');
    expect(mailleParDefaut(regles, 'meta', metro)).toBe('pays');
    expect(mailleParDefaut(regles, 'ttd', dessin)).toBe('polygone');
    expect(mailleParDefaut(regles, 'meta', dessin)).toBe('cercle');
  });
});
