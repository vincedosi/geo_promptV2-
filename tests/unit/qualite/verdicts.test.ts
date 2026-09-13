/**
 * @file tests/unit/qualite/verdicts.test.ts — verrous de la page « Qualité des
 * données » (2026-09-13, écrits après relecture).
 *
 * **Pourquoi ces tests existent.** La livraison initiale de cette page n'en
 * avait aucun, et une relecture indépendante y a trouvé trois faux négatifs
 * dont un central : les indicateurs `pollen` et `atmo`, dont la source est
 * figée depuis 72 jours, étaient déclarés **« ok »**. Aucune branche du `CASE`
 * ne les atteignait (`m.n_lignes = 0` vaut NULL et non TRUE quand la ligne de
 * journal n'existe pas), donc ils tombaient dans le `ELSE`. La page affichait
 * « les 19 indicateurs actifs pointent vers des données exploitables » juste
 * au-dessus d'un encadré annonçant leur source périmée : elle se contredisait
 * elle-même, et c'est la contradiction rassurante qui s'affichait en premier.
 *
 * C'est le défaut exact que cette page prétend combattre — « un tableau de
 * bord vert qui ne garantit rien fait cesser de chercher ». Un test l'aurait
 * attrapé seul.
 *
 * Ces tests portent sur la LOGIQUE DE VERDICT, reproduite ici à l'identique de
 * `qualite_indicateurs` (sql/152). Ils ne remplacent pas la fonction SQL : ils
 * verrouillent le fait qu'aucune forme d'entrée ne retombe en « ok » par
 * omission — la faute d'origine étant précisément un `ELSE 'ok'` atteint par
 * défaut.
 */
import { describe, it, expect } from 'vitest';
import { verdictIndicateur, type EntreeIndicateur } from '@/lib/qualite/verdict';

const BASE: EntreeIndicateur = {
  dataSource: 'iris_column',
  colonneConnue: true,
  nRenseignes: 49448,
  nTotal: 49448,
  popCouverte: 67760552,
  popTotale: 67760552,
  nCp: 6186,
  nCpReference: 6187,
  journalise: true,
  ageSourceJours: null,
};

describe('verdict d un indicateur de qualite', () => {
  it('rend ok sur un indicateur complet', () => {
    expect(verdictIndicateur(BASE).verdict).toBe('ok');
  });

  it('attrape une colonne absente du schema', () => {
    expect(verdictIndicateur({ ...BASE, colonneConnue: false }).verdict).toBe('colonne_absente');
  });

  it('attrape une source entierement vide', () => {
    expect(verdictIndicateur({ ...BASE, nRenseignes: 0, popCouverte: 0 }).verdict).toBe('source_vide');
  });

  // ── Le defaut d origine, verrouille ────────────────────────────────────
  it('NE declare PAS ok une source quotidienne figee depuis 72 jours', () => {
    const pollen = verdictIndicateur({
      ...BASE, dataSource: 'pollen', colonneConnue: false,
      nRenseignes: null, popCouverte: null, nCp: null, journalise: false,
      ageSourceJours: 72,
    });
    expect(pollen.verdict).toBe('perime');
    expect(pollen.verdict).not.toBe('ok');
  });

  it('NE declare PAS ok un indicateur hors iris jamais calcule', () => {
    const v = verdictIndicateur({
      ...BASE, dataSource: 'abstention', colonneConnue: false,
      nRenseignes: null, popCouverte: null, nCp: null, journalise: false,
      ageSourceJours: null,
    });
    expect(v.verdict).toBe('non_verifie');
    expect(v.verdict).not.toBe('ok');
  });

  it('tolere une source quotidienne fraiche', () => {
    expect(verdictIndicateur({
      ...BASE, dataSource: 'atmo', colonneConnue: false,
      nRenseignes: null, popCouverte: null, ageSourceJours: 1,
    }).verdict).toBe('ok');
  });

  // ── La couverture se mesure en POPULATION, pas en lignes ───────────────
  it('juge la couverture sur la population et non sur le compte de lignes', () => {
    // Cas reel : rev_median couvre 29 % des lignes mais 57 % des habitants.
    const revMedian = verdictIndicateur({
      ...BASE, nRenseignes: 14480, popCouverte: 38730946,
    });
    expect(revMedian.verdict).toBe('partiel');

    // Cas symetrique, celui qu un comptage par lignes RATERAIT : une colonne
    // renseignee sur les 33 044 communes rurales et absente des 16 404 IRIS
    // urbains fait 67 % des lignes — mais 40 % de la population.
    const ruralUniquement = verdictIndicateur({
      ...BASE, nRenseignes: 33044, popCouverte: 27000000,
    });
    expect(ruralUniquement.verdict).toBe('partiel');
  });

  it('n est pas trompe par une couverture de lignes flatteuse', () => {
    // 67 % des lignes : un seuil pose sur les lignes aurait dit « ok ».
    const v = verdictIndicateur({ ...BASE, nRenseignes: 33044, popCouverte: 27000000 });
    expect(v.verdict).not.toBe('ok');
  });

  // ── Le seuil CP se derive du referentiel ───────────────────────────────
  it('juge partielle une materialisation couvrant la moitie des codes postaux', () => {
    // 3 100 CP sur 6 187 : l ancien seuil en dur (3 000) laissait passer.
    expect(verdictIndicateur({ ...BASE, nCp: 3100 }).verdict).toBe('partiel');
  });

  // ── Aucune entree ne doit retomber en « ok » par omission ──────────────
  it('ne rend jamais ok sur une entree entierement inconnue', () => {
    const v = verdictIndicateur({
      dataSource: 'source_inventee', colonneConnue: false,
      nRenseignes: null, nTotal: null, popCouverte: null, popTotale: null,
      nCp: null, nCpReference: null, journalise: false, ageSourceJours: null,
    });
    expect(v.verdict).not.toBe('ok');
  });

  it('classe les verdicts par gravite decroissante', () => {
    const g = (e: Partial<EntreeIndicateur>) => verdictIndicateur({ ...BASE, ...e }).gravite;
    expect(g({ colonneConnue: false })).toBeGreaterThan(g({ nCp: 3100 }));
    expect(g({ nRenseignes: 0, popCouverte: 0 })).toBeGreaterThan(g({}));
    expect(g({})).toBe(0);
  });
});
