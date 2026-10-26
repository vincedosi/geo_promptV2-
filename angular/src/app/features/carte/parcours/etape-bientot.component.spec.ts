import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfigService } from '../../../core/config/config.service';
import { PlanCampagneService } from '../etat/plan-campagne.service';
import { CONSIGNE_ETAPE } from '../logique/parcours';
import { EtapeBientotComponent } from './etape-bientot.component';

function rendre(etape: string, valeur: unknown) {
  TestBed.configureTestingModule({ providers: [{ provide: ConfigService, useValue: { get valeur() { if (valeur instanceof Error) throw valeur; return valeur; } } }] });
  const f = TestBed.createComponent(EtapeBientotComponent);
  f.componentRef.setInput('etape', etape);
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}

describe('EtapeBientotComponent', () => {
  it('⑧ Live avec une origine React : un lien vers l’onglet Suivi, nouvel onglet — et PAS la consigne (dite par l’en-tête du panneau d’étape)', () => {
    const el = rendre('live', { urlApplicationReact: 'http://localhost:3000' });
    expect(el.querySelector('[data-etape-bientot="live"]')).not.toBeNull();
    expect(el.textContent).not.toContain(CONSIGNE_ETAPE.live);
    const a = el.querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('http://localhost:3000/map?tab=suivi');
    expect(a.target).toBe('_blank');
    expect(a.rel).toContain('noopener');
  });
  it('⑤ Jeu de zones, même avec une origine React : aucun lien (rien d’équivalent côté React hors module risque)', () => {
    const el = rendre('jeu', { urlApplicationReact: 'http://localhost:3000' });
    expect(el.querySelector('[data-etape-bientot="jeu"]')).not.toBeNull();
    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent).toContain('Bientôt dans le parcours.');
  });
  it('⑧ avec une campagne courante (⑥) : le lien la porte en `campaign`, que le deep-link React lit (revue finale, m5)', () => {
    TestBed.configureTestingModule({ providers: [
      { provide: ConfigService, useValue: { valeur: { urlApplicationReact: 'http://x' } } },
      { provide: PlanCampagneService, useValue: { campagne: signal('0f8fad5b-d9cb-469f-a165-70867728950e') } },
    ] });
    const f = TestBed.createComponent(EtapeBientotComponent);
    f.componentRef.setInput('etape', 'live');
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('a')!.getAttribute('href'))
      .toBe('http://x/map?tab=suivi&campaign=0f8fad5b-d9cb-469f-a165-70867728950e');
  });
  it('⑧ → onglet Suivi', () => {
    expect(rendre('live', { urlApplicationReact: 'http://x' }).querySelector('a')!.getAttribute('href')).toBe('http://x/map?tab=suivi');
  });
  it('sans origine (hôte AIDA) : aucun lien, « Bientôt dans le parcours. »', () => {
    const el = rendre('live', {});
    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent).toContain('Bientôt dans le parcours.');
    expect(el.textContent).not.toContain(CONSIGNE_ETAPE.live);
  });
  it('configuration pas encore chargée : aucun lien, aucune exception', () => {
    expect(rendre('live', new Error('pas chargée')).querySelector('a')).toBeNull();
  });
});
