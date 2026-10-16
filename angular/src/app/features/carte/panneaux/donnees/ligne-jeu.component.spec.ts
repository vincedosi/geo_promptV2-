import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { JeuAffichable } from '../../logique/rangement-jeux';
import { LigneJeuComponent } from './ligne-jeu.component';

const TMJA: JeuAffichable = { cle: 'tmja:comptages', nom: 'Flux routier (TMJA)', nature: 'ligne', maille: 'tronçon', origine: 'commune' };

@Component({
  selector: 'mg-hote-ligne',
  imports: [LigneJeuComponent],
  template: `<mg-ligne-jeu [jeu]="jeu" [affiche]="affiche()" [mode]="mode()" [coche]="coche()" [deplie]="deplie()"
    (cocher)="cochages = cochages + 1" (basculer)="bascules = bascules + 1"><p data-projete>réglages</p></mg-ligne-jeu>`,
})
class HoteLigne {
  jeu = TMJA;
  readonly affiche = signal(false);
  readonly mode = signal<'case' | 'reglages'>('reglages');
  readonly coche = signal(false);
  readonly deplie = signal(false);
  cochages = 0;
  bascules = 0;
}

async function monter() {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(HoteLigne);
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  await rendre();
  return { el, rendre, hote: fixture.componentInstance };
}

describe('LigneJeuComponent', () => {
  it('nom, « nature · maille », clé sur l’hôte ; pastille « affiché » seulement si affiché', async () => {
    const { el, rendre, hote } = await monter();
    expect(el.querySelector('mg-ligne-jeu')!.getAttribute('data-jeu')).toBe('tmja:comptages');
    expect(el.textContent).toContain('Flux routier (TMJA)');
    expect(el.textContent).toContain('Ligne · tronçon');
    expect(el.querySelector('[data-affiche]')).toBeNull();
    hote.affiche.set(true);
    await rendre();
    expect(el.querySelector('[data-affiche]')).not.toBeNull();
  });

  it('mode case : une case « Choisir <nom> », cochée selon l’entrée, change émet cocher ; pas de chevron', async () => {
    const { el, rendre, hote } = await monter();
    hote.mode.set('case');
    hote.coche.set(true);
    await rendre();
    const c = el.querySelector('input[type=checkbox]') as HTMLInputElement;
    expect(c.getAttribute('aria-label')).toBe('Choisir Flux routier (TMJA)');
    expect(c.checked).toBe(true);
    c.click();
    expect(hote.cochages).toBe(1);
    expect(el.querySelector('button[aria-expanded]')).toBeNull();
    expect(el.querySelector('[data-projete]')).toBeNull();
  });

  it('mode réglages : bouton aria-expanded, clic émet basculer ; contenu projeté rendu seulement déplié', async () => {
    const { el, rendre, hote } = await monter();
    const b = el.querySelector('button[aria-expanded]') as HTMLButtonElement;
    expect(b.getAttribute('aria-expanded')).toBe('false');
    expect(b.getAttribute('aria-label')).toBe('Régler Flux routier (TMJA)');
    expect(el.querySelector('input[type=checkbox]')).toBeNull();
    expect(el.querySelector('[data-projete]')).toBeNull();
    b.click();
    expect(hote.bascules).toBe(1);
    hote.deplie.set(true);
    await rendre();
    expect(b.getAttribute('aria-expanded')).toBe('true');
    expect(b.getAttribute('aria-label')).toBe('Replier Flux routier (TMJA)');
    expect(el.querySelector('[data-reglages] [data-projete]')).not.toBeNull();
  });

  it('la case reflète TOUJOURS `coche` : un geste que le parent refuse ne la laisse pas cochée (relecture T12, m1)', async () => {
    const { el, rendre, hote } = await monter();
    hote.mode.set('case');
    await rendre();
    const c = el.querySelector('input[type=checkbox]') as HTMLInputElement;
    c.click();
    await rendre();
    expect(hote.cochages).toBe(1);
    expect(c.checked).toBe(false);
    // Le parent accepte le geste suivant : la case suit.
    c.click();
    hote.coche.set(true);
    await rendre();
    expect(c.checked).toBe(true);
  });

  it('le chevron offre une cible d’au moins 24 × 24 px (WCAG 2.5.8, relecture T12, m2)', async () => {
    const { el } = await monter();
    const b = el.querySelector('button[aria-expanded]') as HTMLButtonElement;
    expect(b.classList).toContain('min-h-6');
    expect(b.classList).toContain('min-w-6');
  });
});
