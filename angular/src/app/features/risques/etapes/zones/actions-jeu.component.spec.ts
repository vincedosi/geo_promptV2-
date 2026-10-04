import { TestBed } from '@angular/core/testing';
import { NEVER } from 'rxjs';
import { ENREGISTRER_FICHIER } from '../../../../core/http/telecharger';
import { ActionsJeuComponent } from './actions-jeu.component';

async function rendre(brouillon: boolean, enregistrer: () => Promise<unknown> = async () => undefined) {
  TestBed.configureTestingModule({ providers: [{ provide: ENREGISTRER_FICHIER, useValue: vi.fn() }] });
  const f = TestBed.createComponent(ActionsJeuComponent);
  f.componentRef.setInput('brouillon', brouillon);
  f.componentRef.setInput('nom', '');
  f.componentRef.setInput('description', '');
  f.componentRef.setInput('enregistrer', enregistrer);
  f.componentRef.setInput('exporter', brouillon ? null : () => NEVER);
  let dupliques = 0;
  f.componentInstance.dupliquer.subscribe(() => { dupliques += 1; });
  await f.whenStable();
  return { f, el: f.nativeElement as HTMLElement, dupliques: () => dupliques };
}

describe('ActionsJeuComponent', () => {
  it('brouillon : « Enregistrer le jeu » désactivé tant qu’aucun nom n’est saisi, puis attendu jusqu’à la réponse', async () => {
    let resoudre!: () => void;
    const enregistrer = vi.fn(() => new Promise<void>((r) => { resoudre = r; }));
    const { f, el } = await rendre(true, enregistrer);
    const bouton = () => el.querySelector<HTMLButtonElement>('[data-role="enregistrer"]')!;
    expect(bouton().disabled).toBe(true);
    const nom = el.querySelector<HTMLInputElement>('input[aria-label="Nom du jeu de zones"]')!;
    nom.value = '  ';
    nom.dispatchEvent(new Event('input'));
    await f.whenStable();
    expect(bouton().disabled).toBe(true);
    nom.value = '[TEST] Jeu';
    nom.dispatchEvent(new Event('input'));
    await f.whenStable();
    expect(f.componentInstance.nom()).toBe('[TEST] Jeu');
    bouton().click();
    await f.whenStable();
    expect(enregistrer).toHaveBeenCalledTimes(1);
    expect(bouton().disabled).toBe(true);
    resoudre();
    await new Promise((r) => setTimeout(r, 0));
    await f.whenStable();
    expect(bouton().disabled).toBe(false);
    expect(el.querySelector('[data-role="dupliquer"]')?.textContent?.trim()).toBe('Reconstruire');
    expect(el.querySelector('mg-bouton-export')).toBeNull();
  });

  it('jeu enregistré : ni champs ni « Enregistrer », « Dupliquer depuis le profil courant » et l’export', async () => {
    const { el, dupliques } = await rendre(false);
    expect(el.querySelector('input')).toBeNull();
    expect(el.querySelector('[data-role="enregistrer"]')).toBeNull();
    const dup = el.querySelector<HTMLButtonElement>('[data-role="dupliquer"]')!;
    expect(dup.textContent?.trim()).toBe('Dupliquer depuis le profil courant');
    dup.click();
    expect(dupliques()).toBe(1);
    expect(el.querySelector('mg-bouton-export')?.textContent).toContain('Exporter (Excel)');
  });
});
