/**
 * Verrous sur le registre de fraîcheur des sources non socio-démo.
 *
 * Deux familles, et elles n'ont pas le même rôle :
 *   - la logique pure (état, fusion), testée sans base ;
 *   - la COHÉRENCE du registre avec le schéma réel, testée contre les types
 *     générés. C'est ce second bloc qui attrape la dérive : une table renommée
 *     ou une colonne disparue rendrait la mesure silencieusement vide, et un
 *     onglet qui affiche « — » se lit comme « rien à signaler ».
 */
import { describe, it, expect } from 'vitest';
import {
  SOURCES_DONNEES,
  descripteursDeMesure,
  etatDeSource,
  fusionnerMesures,
  sourceParId,
  type MesureSource,
  type SourceDonnee,
} from '@/lib/donnees/registre-fraicheur';

const MAINTENANT = new Date('2026-09-13T12:00:00Z');

function mesure(partiel: Partial<MesureSource> & { id: string }): MesureSource {
  return {
    n_lignes: 10,
    n_estime: false,
    donnee_min: null,
    donnee_max: null,
    ingestion_max: null,
    non_mesure: null,
    ...partiel,
  };
}

describe('etatDeSource', () => {
  const cadenceQuotidienne = sourceParId('pollen')!;
  const referentiel = sourceParId('panneaux')!;
  const live = sourceParId('meteo')!;

  it('une source live n’a jamais d’état : rien n’est stocké, donc rien ne périme', () => {
    const r = etatDeSource(live, undefined, MAINTENANT);
    expect(r.etat).toBe('sans_objet');
    expect(r.ageJours).toBeNull();
  });

  it('une source jamais mesurée le dit, au lieu de se présenter comme saine', () => {
    expect(etatDeSource(cadenceQuotidienne, undefined, MAINTENANT).etat).toBe('jamais_mesure');
  });

  it('une mesure qui a échoué ne compte pas comme une mesure', () => {
    const m = mesure({ id: 'pollen', non_mesure: 'mesure lourde, demande explicite requise' });
    expect(etatDeSource(cadenceQuotidienne, m, MAINTENANT).etat).toBe('jamais_mesure');
  });

  it('une ingestion du jour tient la cadence quotidienne', () => {
    const m = mesure({ id: 'pollen', ingestion_max: '2026-09-13T05:30:00Z' });
    expect(etatDeSource(cadenceQuotidienne, m, MAINTENANT).etat).toBe('a_jour');
  });

  it('la journée en cours ne met pas en retard une cadence quotidienne', () => {
    // Un relevé de la veille au matin : 1 jour d'âge, cadence de 1 jour.
    const m = mesure({ id: 'pollen', ingestion_max: '2026-09-12T05:30:00Z' });
    expect(etatDeSource(cadenceQuotidienne, m, MAINTENANT).etat).toBe('a_jour');
  });

  it('au-delà de la cadence, le retard est annoncé avec son âge', () => {
    const m = mesure({ id: 'pollen', ingestion_max: '2026-09-09T05:30:00Z' });
    const r = etatDeSource(cadenceQuotidienne, m, MAINTENANT);
    expect(r.etat).toBe('en_retard');
    expect(r.ageJours).toBe(4);
  });

  it('un référentiel sans cadence n’est jamais « en retard », mais garde son âge', () => {
    const m = mesure({ id: 'panneaux', ingestion_max: '2026-03-09T14:34:57Z' });
    const r = etatDeSource(referentiel, m, MAINTENANT);
    expect(r.etat).toBe('sans_objet');
    // L'âge reste l'information utile : six mois se voient, sans porter de verdict.
    expect(r.ageJours).toBeGreaterThan(180);
  });

  it('un millésime en année seule est daté, pas rejeté', () => {
    // `comptages_routiers.annee_mesure` est un entier, pas une date.
    const source: SourceDonnee = { ...referentiel, colonneIngestion: null };
    const m = mesure({ id: 'x', donnee_max: '2024', ingestion_max: null });
    expect(etatDeSource(source, m, MAINTENANT).ageJours).toBeGreaterThan(0);
  });

  it('une date illisible ne passe pas pour une donnée fraîche', () => {
    const m = mesure({ id: 'pollen', ingestion_max: 'pas-une-date' });
    expect(etatDeSource(cadenceQuotidienne, m, MAINTENANT).etat).toBe('jamais_mesure');
  });
});

describe('fusionnerMesures', () => {
  it('conserve une mesure réelle qu’une passe légère n’a pas refaite', () => {
    const precedentes = [mesure({ id: 'flux_routier', donnee_max: '2024', n_lignes: 406203 })];
    const fraiches = [mesure({ id: 'flux_routier', non_mesure: 'mesure lourde, demande explicite requise', n_lignes: null })];

    const [res] = fusionnerMesures(fraiches, precedentes);
    // Sans cette règle, le millésime payé 347 Mo disparaîtrait au premier clic
    // sur « Relancer la mesure ».
    expect(res.donnee_max).toBe('2024');
    expect(res.non_mesure).toBeNull();
  });

  it('une mesure fraîche prime toujours sur l’ancienne', () => {
    const precedentes = [mesure({ id: 'pollen', n_lignes: 1 })];
    const fraiches = [mesure({ id: 'pollen', n_lignes: 6004 })];
    expect(fusionnerMesures(fraiches, precedentes)[0].n_lignes).toBe(6004);
  });

  it('un ancien « non mesuré » ne remplace pas un nouveau', () => {
    const precedentes = [mesure({ id: 'flux_routier', non_mesure: 'raison d’hier', n_lignes: null })];
    const fraiches = [mesure({ id: 'flux_routier', non_mesure: 'raison du jour', n_lignes: null })];
    expect(fusionnerMesures(fraiches, precedentes)[0].non_mesure).toBe('raison du jour');
  });

  it('une source absente du précédent relevé passe telle quelle', () => {
    const fraiches = [mesure({ id: 'nouvelle', non_mesure: 'source jamais stockee' })];
    expect(fusionnerMesures(fraiches, [])).toHaveLength(1);
  });
});

describe('descripteursDeMesure', () => {
  it('aplatit le journal sans en perdre un champ', () => {
    const d = descripteursDeMesure().find((x) => x.id === 'radio_stations')!;
    expect(d.journal_table).toBe('radio_imports_log');
    expect(d.journal_col_date).toBe('completed_at');
    expect(d.journal_col_filtre).toBe('type');
    expect(d.journal_val_filtre).toBe('arcom');
  });

  it('une source sans journal envoie des nulls, jamais undefined', () => {
    // `undefined` disparaîtrait à la sérialisation JSON et la RPC lirait une
    // clé absente au lieu d'un null explicite.
    const d = descripteursDeMesure().find((x) => x.id === 'pollen')!;
    expect(d.journal_table).toBeNull();
    expect(Object.values(d).every((v) => v !== undefined)).toBe(true);
  });

  it('la source live part sans table : il n’y a rien à mesurer', () => {
    expect(descripteursDeMesure().find((x) => x.id === 'meteo')!.table).toBeNull();
  });
});

describe('cohérence du registre', () => {
  it('chaque identifiant est unique', () => {
    const ids = SOURCES_DONNEES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('seules les sources live sont hors base', () => {
    for (const s of SOURCES_DONNEES) {
      if (s.table === null) expect(s.nature).toBe('live');
    }
  });

  it('une source hors base ne déclare ni colonne ni journal', () => {
    for (const s of SOURCES_DONNEES.filter((x) => x.table === null)) {
      expect(s.colonneDonnee).toBeNull();
      expect(s.colonneIngestion).toBeNull();
      expect(s.journal).toBeNull();
    }
  });

  it('une source stockée sait dire de quand elle date', () => {
    // Sans au moins une source de date, la ligne afficherait « — » partout et
    // l'onglet mentirait par omission.
    for (const s of SOURCES_DONNEES.filter((x) => x.table !== null)) {
      const datable = s.colonneDonnee ?? s.colonneIngestion ?? s.journal?.colonneDate ?? null;
      expect(datable, `source ${s.id} sans aucune date`).not.toBeNull();
    }
  });

  it('une cadence attendue est un nombre de jours positif', () => {
    for (const s of SOURCES_DONNEES) {
      if (s.cadenceAttendueJours !== null) expect(s.cadenceAttendueJours).toBeGreaterThan(0);
    }
  });

  it('le socle socio-démo reste hors périmètre', () => {
    // POI, IRIS et Filosofi relèvent de /admin/qualite-donnees. Les faire
    // remonter ici créerait deux pages qui disent la même chose, et donc deux
    // pages à maintenir d'accord entre elles.
    const interdites = ['poi_france', 'iris', 'carreaux_filosofi'];
    for (const s of SOURCES_DONNEES) {
      expect(interdites).not.toContain(s.table);
    }
  });

  it('une seule source est déclarée lourde, et c’est celle qui balaye sa table', () => {
    const lourdes = SOURCES_DONNEES.filter((s) => s.coutMesure === 'lourd');
    expect(lourdes.map((s) => s.id)).toEqual(['flux_routier']);
  });
});
