import { describe, it, expect } from 'vitest';
import { composerFiche, type ContexteFiche, type SourceLue } from '@/lib/carte/fiche-jeu';

/**
 * La fiche d'un jeu de ② (lot « Catalogue et groupes », A-8) : composition pure, les lectures sont faites par la route
 * `GET /api/map/catalogue/fiche` qui ne lui passe que ce que l'espace actif voit.
 */
const BERCY = 'org-bercy';
const BMW = 'org-bmw';
const INTERNE = 'org-interne';

function source(p: Partial<SourceLue> & { id: string }): SourceLue {
  return {
    name: p.id, type: 'poi', category: 'lycee', visibilite: 'socle', organization_id: INTERNE, shared_with: [],
    valid_count: 10, import_date: '2026-02-25T18:57:00Z', ...p,
  };
}

function ctx(p: Partial<ContexteFiche> = {}): ContexteFiche {
  return {
    espaceActif: BERCY, sources: [], indicateursVisibles: new Set(),
    nomsEspaces: new Map([[BERCY, 'Bercy'], [BMW, 'BMW GROUP'], [INTERNE, 'dentsu.explore (interne)']]),
    ...p,
  };
}

describe('composerFiche', () => {
  it('type de POI au socle : propriétaire, niveau socle, effectif valid_count, date d import', () => {
    const fiche = composerFiche('poi:lycee', ctx({ sources: [source({ id: 's1', name: 'LYCEEE', valid_count: 5584 })] }));
    expect(fiche).toEqual({
      cle: 'poi:lycee', referentiel: false,
      sources: [{ nom: 'LYCEEE', proprietaire: 'dentsu.explore (interne)', niveau: 'socle', effectif: 5584, importe_le: '2026-02-25T18:57:00Z' }],
    });
  });

  it('privé à l espace actif, partagé avec lui par un autre : le niveau se lit DEPUIS l espace actif', () => {
    const sources = [
      source({ id: 'propre', category: 'bmw', visibilite: 'privee', organization_id: BERCY }),
      source({ id: 'recu', category: 'bmw', visibilite: 'privee', organization_id: BMW, shared_with: [BERCY] }),
    ];
    const fiche = composerFiche('poi:bmw', ctx({ sources }));
    expect(fiche?.sources.map((s) => [s.nom, s.proprietaire, s.niveau])).toEqual([
      ['propre', 'Bercy', 'prive'], ['recu', 'BMW GROUP', 'partage'],
    ]);
    // Vu de BMW, la même source est la sienne.
    expect(composerFiche('poi:bmw', ctx({ sources, espaceActif: BMW }))?.sources[1].niveau).toBe('prive');
  });

  it('ne garde que les sources POI de LA catégorie ; aucune visible → null (404)', () => {
    const sources = [source({ id: 'l' }), source({ id: 'c', category: 'cirfa' }), source({ id: 'p', type: 'panneaux', category: 'lycee' })];
    expect(composerFiche('poi:lycee', ctx({ sources }))?.sources.map((s) => s.nom)).toEqual(['l']);
    expect(composerFiche('poi:cirfa', ctx({ sources: [] }))).toBeNull();
  });

  it('référentiel sans source : « référentiel système », aucune source', () => {
    expect(composerFiche('carreaux:filosofi', ctx())).toEqual({ cle: 'carreaux:filosofi', referentiel: true, sources: [] });
  });

  it('référentiel lié à un indicateur visible : ses sources ; invisible : null (404)', () => {
    const abstention = source({ id: 'abs', name: 'Taux d’abstention', type: 'indicateur', category: 'abstention_pres_2022', visibilite: 'privee', organization_id: BERCY, valid_count: 6186 });
    const visible = composerFiche('civique:indicateurs-cp', ctx({ sources: [abstention], indicateursVisibles: new Set(['abstention_pres_2022']) }));
    expect(visible).toEqual({
      cle: 'civique:indicateurs-cp', referentiel: true,
      sources: [{ nom: 'Taux d’abstention', proprietaire: 'Bercy', niveau: 'prive', effectif: 6186, importe_le: '2026-02-25T18:57:00Z' }],
    });
    expect(composerFiche('civique:indicateurs-cp', ctx({ espaceActif: BMW, indicateursVisibles: new Set(['taux_pauvrete']) }))).toBeNull();
  });

  it('clé inconnue, clé hors forme, catégorie rangée ailleurs, jeu d « Autres » : null', () => {
    for (const cle of ['iris:inconnu', 'pas une cle', 'poi:risque_industriel', 'ooh:panneaux']) {
      expect(composerFiche(cle, ctx({ sources: [source({ id: 'x', category: 'risque_industriel' })] })), cle).toBeNull();
    }
  });

  it('propriétaire disparu : « Espace supprimé », jamais un identifiant', () => {
    const fiche = composerFiche('poi:lycee', ctx({ sources: [source({ id: 's', organization_id: 'org-disparu' })] }));
    expect(fiche?.sources[0].proprietaire).toBe('Espace supprimé');
  });
});
