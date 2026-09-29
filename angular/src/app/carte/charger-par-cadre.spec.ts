import { Subject, throwError } from 'rxjs';
import type { Bbox } from './bbox';
import { chargerParCadre } from './charger-par-cadre';
import { CarteFactice } from './testing/carte-factice';

describe('chargerParCadre', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('charge une fois au départ, puis une seule fois après un panoramique rapide', () => {
    const carte = new CarteFactice();
    const demandes: Bbox[] = [];
    const reponses: Subject<string>[] = [];
    const appliques: string[] = [];
    chargerParCadre(carte as never, (b) => { demandes.push(b); const s = new Subject<string>(); reponses.push(s); return s; }, (v) => appliques.push(v));
    vi.advanceTimersByTime(350);
    expect(demandes.length).toBe(1);
    for (let i = 0; i < 10; i++) { carte.emettre('moveend'); vi.advanceTimersByTime(50); }
    expect(demandes.length).toBe(1);
    vi.advanceTimersByTime(350);
    expect(demandes.length).toBe(2);
  });

  it('une réponse périmée n\'écrase jamais la plus récente', () => {
    const carte = new CarteFactice();
    const reponses: Subject<string>[] = [];
    const appliques: string[] = [];
    chargerParCadre(carte as never, () => { const s = new Subject<string>(); reponses.push(s); return s; }, (v) => appliques.push(v));
    vi.advanceTimersByTime(350);
    carte.emettre('moveend');
    vi.advanceTimersByTime(350);
    reponses[0].next('ancienne');
    reponses[1].next('récente');
    expect(appliques).toEqual(['récente']);
  });

  it('un échec est signalé et n\'arrête pas les chargements suivants', () => {
    const carte = new CarteFactice();
    const echecs: unknown[] = [];
    let n = 0;
    chargerParCadre(carte as never, () => (n++ === 0 ? throwError(() => new Error('panne')) : new Subject<string>()), () => undefined, { surEchec: (e) => echecs.push(e) });
    vi.advanceTimersByTime(350);
    carte.emettre('moveend');
    vi.advanceTimersByTime(350);
    expect(echecs.length).toBe(1);
    expect(n).toBe(2);
  });

  it('arrêter débranche l\'écoute et abandonne la requête en cours', () => {
    const carte = new CarteFactice();
    const reponse = new Subject<string>();
    const appliques: string[] = [];
    const arreter = chargerParCadre(carte as never, () => reponse, (v) => appliques.push(v));
    vi.advanceTimersByTime(350);
    arreter();
    reponse.next('trop tard');
    expect(appliques).toEqual([]);
    expect(carte.nombreEcouteurs('moveend')).toBe(0);
  });
});
