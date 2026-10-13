import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AnnonceService } from './annonce.service';
import { EtatCarteService } from './etat-carte.service';

function monter() {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), EtatCarteService, AnnonceService],
  });
  return { etat: TestBed.inject(EtatCarteService), annonces: TestBed.inject(AnnonceService) };
}

describe('EtatCarteService', () => {
  afterEach(() => vi.useRealTimers());

  it('le mode immersif est éteint à l’ouverture et se bascule', () => {
    const { etat } = monter();
    expect(etat.immersif()).toBe(false);
    etat.immersif.set(true);
    expect(etat.immersif()).toBe(true);
  });

  it("(c) carreaux actif, IRIS allumé : carreaux est évincé, son abonné appelé une fois, l'annonce le nomme", () => {
    const { etat, annonces } = monter();
    const eteindreCarreaux = vi.fn();
    const eteindreIris = vi.fn();
    etat.surEviction('carreaux', eteindreCarreaux);
    etat.surEviction('iris', eteindreIris);
    expect(etat.basculerDegrade('carreaux', true)).toBeNull();
    expect(annonces.annonces()).toEqual([]);
    expect(etat.basculerDegrade('iris', true)).toBe('carreaux');
    expect(etat.degradeActif()).toBe('iris');
    expect(eteindreCarreaux).toHaveBeenCalledTimes(1);
    expect(eteindreIris).not.toHaveBeenCalled();
    expect(annonces.annonces().map((a) => a.texte)).toEqual([
      'Carreaux Filosofi a été masqué — un seul dégradé de couleur à la fois',
    ]);
  });

  it('(d) éteindre IRIS alors que carreaux est actif : aucune éviction, aucune annonce', () => {
    const { etat, annonces } = monter();
    const eteindreCarreaux = vi.fn();
    etat.surEviction('carreaux', eteindreCarreaux);
    etat.basculerDegrade('carreaux', true);
    expect(etat.basculerDegrade('iris', false)).toBeNull();
    expect(etat.degradeActif()).toBe('carreaux');
    expect(eteindreCarreaux).not.toHaveBeenCalled();
    expect(annonces.annonces()).toEqual([]);
  });

  it('éteindre le dégradé actif le retire, sans annonce', () => {
    const { etat, annonces } = monter();
    etat.basculerDegrade('carreaux', true);
    expect(etat.basculerDegrade('carreaux', false)).toBeNull();
    expect(etat.degradeActif()).toBeNull();
    expect(annonces.annonces()).toEqual([]);
  });

  it('(e) reinitialiserDegrade remet à zéro sans annonce ni éviction', () => {
    const { etat, annonces } = monter();
    const eteindre = vi.fn();
    etat.surEviction('carreaux', eteindre);
    etat.basculerDegrade('carreaux', true);
    etat.reinitialiserDegrade();
    expect(etat.degradeActif()).toBeNull();
    expect(eteindre).not.toHaveBeenCalled();
    expect(annonces.annonces()).toEqual([]);
  });

  it("l'annonce disparaît après 4 s ; trois au plus restent à l'écran", () => {
    vi.useFakeTimers();
    const { etat, annonces } = monter();
    etat.basculerDegrade('carreaux', true);
    etat.basculerDegrade('iris', true);
    etat.basculerDegrade('meteo', true);
    etat.basculerDegrade('score', true);
    etat.basculerDegrade('carreaux', true);
    expect(annonces.annonces().map((a) => a.texte.split(' a été')[0])).toEqual(['IRIS', 'Météo', 'Score composite']);
    vi.advanceTimersByTime(4000);
    expect(annonces.annonces()).toEqual([]);
  });
});
