import { TestBed } from '@angular/core/testing';
import { ConfigService } from '../../../core/config/config.service';
import { EtapeBientotComponent } from './etape-bientot.component';

function rendre(etape: string, valeur: unknown) {
  TestBed.configureTestingModule({ providers: [{ provide: ConfigService, useValue: { get valeur() { if (valeur instanceof Error) throw valeur; return valeur; } } }] });
  const f = TestBed.createComponent(EtapeBientotComponent);
  f.componentRef.setInput('etape', etape);
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}

describe('EtapeBientotComponent', () => {
  it('⑤ avec une origine React : la consigne et un lien vers l’onglet Stratégie, nouvel onglet', () => {
    const el = rendre('plan', { urlApplicationReact: 'http://localhost:3000' });
    expect(el.querySelector('[data-etape-bientot="plan"]')).not.toBeNull();
    const a = el.querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('http://localhost:3000/map?tab=strategie');
    expect(a.target).toBe('_blank');
    expect(a.rel).toContain('noopener');
  });
  it('⑦ → onglet Suivi', () => {
    expect(rendre('live', { urlApplicationReact: 'http://x' }).querySelector('a')!.getAttribute('href')).toBe('http://x/map?tab=suivi');
  });
  it('sans origine (hôte AIDA) : aucun lien, « Bientôt dans le parcours. »', () => {
    const el = rendre('activation', {});
    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent).toContain('Bientôt dans le parcours.');
  });
  it('configuration pas encore chargée : aucun lien, aucune exception', () => {
    expect(rendre('plan', new Error('pas chargée')).querySelector('a')).toBeNull();
  });
});
