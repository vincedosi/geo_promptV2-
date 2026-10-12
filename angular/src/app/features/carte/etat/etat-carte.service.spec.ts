import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AnnonceService } from './annonce.service';
import { EtatCarteService } from './etat-carte.service';
import type { EntreeId } from '../logique/navigation';

function monter() {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), EtatCarteService, AnnonceService],
  });
  return { etat: TestBed.inject(EtatCarteService), annonces: TestBed.inject(AnnonceService) };
}

describe('EtatCarteService', () => {
  afterEach(() => vi.useRealTimers());

  it('(a) choisir deux fois la même entrée la referme', () => {
    const { etat } = monter();
    etat.choisirEntree('filtre');
    expect(etat.entreeActive()).toBe('filtre');
    etat.choisirEntree('filtre');
    expect(etat.entreeActive()).toBeNull();
  });

  it("choisir une autre entrée bascule de l'une à l'autre, fermerEntree ferme", () => {
    const { etat } = monter();
    etat.choisirEntree('filtre');
    etat.choisirEntree('calques');
    expect(etat.entreeActive()).toBe('calques');
    etat.fermerEntree();
    expect(etat.entreeActive()).toBeNull();
  });

  it("(b) Campagne (overlay plein écran, lot 5) ne devient jamais l'entrée active", () => {
    const { etat } = monter();
    etat.choisirEntree('calques');
    etat.choisirEntree('campagne');
    expect(etat.entreeActive()).toBe('calques');
  });

  it("un id hors de la navigation (l'ancien « assistant », retiré le 2026-10-12) ne devient jamais l'entrée active", () => {
    const { etat } = monter();
    etat.choisirEntree('assistant' as EntreeId);
    expect(etat.entreeActive()).toBeNull();
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
