import { describe, it, expect } from 'vitest';
import {
  resoudreLimite,
  resoudrePlancherPopulation,
  libelleIndicateur,
  libellePalier,
  traduireErreurClassement,
  MESSAGE_ERREUR_CLASSEMENT_GENERIQUE,
  PLANCHER_POPULATION_PART_DEFAUT,
  LIMITE_MIN,
  LIMITE_MAX,
  LIMITE_DEFAUT,
} from '@/lib/chat/tools/classementTerritoires';

// ── resoudreLimite ───────────────────────────────────────────────────────────
describe('resoudreLimite — borne Nano (p_limite)', () => {
  it('renvoie le défaut (10) quand rien n\'est fourni', () => {
    expect(resoudreLimite(undefined)).toBe(LIMITE_DEFAUT);
    expect(resoudreLimite(null)).toBe(LIMITE_DEFAUT);
  });

  it('renvoie le défaut sur une valeur non numérique', () => {
    expect(resoudreLimite('dix')).toBe(LIMITE_DEFAUT);
    expect(resoudreLimite({})).toBe(LIMITE_DEFAUT);
    expect(resoudreLimite(NaN)).toBe(LIMITE_DEFAUT);
  });

  it('respecte une valeur valide dans la plage', () => {
    expect(resoudreLimite(25)).toBe(25);
    expect(resoudreLimite('5')).toBe(5);
  });

  it('plafonne à 100 — jamais de liste illimitée sur Nano', () => {
    expect(resoudreLimite(100)).toBe(LIMITE_MAX);
    expect(resoudreLimite(500)).toBe(LIMITE_MAX);
    expect(resoudreLimite(1_000_000)).toBe(LIMITE_MAX);
  });

  it('remonte à 1 sur une valeur nulle ou négative', () => {
    expect(resoudreLimite(0)).toBe(LIMITE_MIN);
    expect(resoudreLimite(-5)).toBe(LIMITE_MIN);
  });

  it('arrondit une valeur décimale', () => {
    expect(resoudreLimite(7.6)).toBe(8);
  });
});

// ── resoudrePlancherPopulation ───────────────────────────────────────────────
describe('resoudrePlancherPopulation — le piège Montferrat (sql/150)', () => {
  it('respecte un plancher fourni et positif, quel que soit le tri', () => {
    expect(resoudrePlancherPopulation('volume', 50_000)).toEqual({
      plancher: 50_000, applique_par_defaut: false,
    });
    expect(resoudrePlancherPopulation('part', 50_000)).toEqual({
      plancher: 50_000, applique_par_defaut: false,
    });
  });

  it('applique le plancher par défaut sur un tri en PART sans seuil fourni', () => {
    expect(resoudrePlancherPopulation('part', undefined)).toEqual({
      plancher: PLANCHER_POPULATION_PART_DEFAUT, applique_par_defaut: true,
    });
  });

  it('traite un plancher à 0 comme absent sur un tri en part — sinon Montferrat repasse devant Lille', () => {
    expect(resoudrePlancherPopulation('part', 0)).toEqual({
      plancher: PLANCHER_POPULATION_PART_DEFAUT, applique_par_defaut: true,
    });
  });

  it("n'impose aucun plancher par défaut sur un tri en VOLUME", () => {
    expect(resoudrePlancherPopulation('volume', undefined)).toEqual({
      plancher: 0, applique_par_defaut: false,
    });
    expect(resoudrePlancherPopulation('volume', 0)).toEqual({
      plancher: 0, applique_par_defaut: false,
    });
  });

  it('ignore une valeur non numérique ou négative comme si elle était absente', () => {
    expect(resoudrePlancherPopulation('part', 'beaucoup')).toEqual({
      plancher: PLANCHER_POPULATION_PART_DEFAUT, applique_par_defaut: true,
    });
    expect(resoudrePlancherPopulation('part', -100)).toEqual({
      plancher: PLANCHER_POPULATION_PART_DEFAUT, applique_par_defaut: true,
    });
  });

  it('arrondit un plancher fourni en décimal', () => {
    expect(resoudrePlancherPopulation('volume', 49_999.6)).toEqual({
      plancher: 50_000, applique_par_defaut: false,
    });
  });
});

// ── libelleIndicateur / libellePalier ────────────────────────────────────────
describe('libelleIndicateur — dictionnaire IRIS_DB_COLUMNS, jamais un label inventé', () => {
  it('traduit une colonne connue', () => {
    expect(libelleIndicateur('pop_15_29')).toBe('Pop 15–29 ans');
    expect(libelleIndicateur('rev_median')).toBe('Revenu médian (€)');
  });

  it('retombe sur la clé brute pour une colonne inconnue du dictionnaire — jamais de label fantaisiste', () => {
    expect(libelleIndicateur('colonne_pas_encore_documentee')).toBe('colonne_pas_encore_documentee');
  });
});

describe('libellePalier', () => {
  it('accorde le palier au pluriel FR', () => {
    expect(libellePalier('commune')).toBe('communes');
    expect(libellePalier('departement')).toBe('départements');
  });
});

// ── traduireErreurClassement ─────────────────────────────────────────────────
describe('traduireErreurClassement — mapping des 3 RAISE EXCEPTION de sql/150', () => {
  it('mappe le tri par part sur un indicateur non-effectif', () => {
    const msg = traduireErreurClassement(
      "tri par part impossible : taux_chomage est de classe proportion et s'exprime deja en valeur relative — trier par volume",
    );
    expect(msg).toContain('ne peut pas se faire en part');
    expect(msg).toContain('volume');
  });

  it('mappe un indicateur inconnu ou non numérique (barrière anti-injection)', () => {
    const msg = traduireErreurClassement(
      "indicateur inconnu ou non numerique au palier commune : population; drop table iris --",
    );
    expect(msg).toContain("n'existe pas ou n'est pas numérique");
    // Le message utilisateur ne doit jamais réexposer le payload d'injection brut.
    expect(msg).not.toContain('drop table');
  });

  it('mappe un palier inconnu', () => {
    expect(traduireErreurClassement('palier inconnu : region (attendu : commune ou departement)'))
      .toContain("'commune' ou 'departement'");
  });

  it('mappe un tri inconnu', () => {
    expect(traduireErreurClassement('tri inconnu : pourcentage (attendu : volume ou part)'))
      .toContain("'volume' ou 'part'");
  });

  it('ne jette jamais et rend le message générique pour une erreur non reconnue — jamais le détail Postgres brut', () => {
    const msg = traduireErreurClassement('connection terminated unexpectedly');
    expect(msg).toBe(MESSAGE_ERREUR_CLASSEMENT_GENERIQUE);
    // Le détail technique ne doit JAMAIS atteindre l'utilisateur : il part en
    // log serveur (voir classementTerritoires.ts, appel à logger.error), pas
    // dans le message affiché.
    expect(msg).not.toContain('connection terminated');
  });

  it('gère un message absent sans planter — même message générique', () => {
    expect(traduireErreurClassement(null)).toBe(MESSAGE_ERREUR_CLASSEMENT_GENERIQUE);
    expect(traduireErreurClassement(undefined)).toBe(MESSAGE_ERREUR_CLASSEMENT_GENERIQUE);
  });
});
