import { TestBed } from '@angular/core/testing';
import { ConfigService } from '../../../core/config/config.service';
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
  it('⑥ Plan avec une origine React : un lien vers l’onglet Stratégie, nouvel onglet — et PAS la consigne (dite par l’en-tête du panneau d’étape)', () => {
    const el = rendre('plan', { urlApplicationReact: 'http://localhost:3000' });
    expect(el.querySelector('[data-etape-bientot="plan"]')).not.toBeNull();
    expect(el.textContent).not.toContain(CONSIGNE_ETAPE.plan);
    const a = el.querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('http://localhost:3000/map?tab=strategie');
    expect(a.target).toBe('_blank');
    expect(a.rel).toContain('noopener');
  });
  it('⑤ Jeu de zones, même avec une origine React : aucun lien (rien d’équivalent côté React hors module risque)', () => {
    const el = rendre('jeu', { urlApplicationReact: 'http://localhost:3000' });
    expect(el.querySelector('[data-etape-bientot="jeu"]')).not.toBeNull();
    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent).toContain('Bientôt dans le parcours.');
  });
  it('⑧ → onglet Suivi', () => {
    expect(rendre('live', { urlApplicationReact: 'http://x' }).querySelector('a')!.getAttribute('href')).toBe('http://x/map?tab=suivi');
  });
  it('sans origine (hôte AIDA) : aucun lien, « Bientôt dans le parcours. »', () => {
    const el = rendre('activation', {});
    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent).toContain('Bientôt dans le parcours.');
    expect(el.textContent).not.toContain(CONSIGNE_ETAPE.activation);
  });
  it('configuration pas encore chargée : aucun lien, aucune exception', () => {
    expect(rendre('plan', new Error('pas chargée')).querySelector('a')).toBeNull();
  });
});
