import { TestBed } from '@angular/core/testing';
import { DilutionComponent } from './dilution.component';

async function rendre(seuil = 20, visee = 800, achetee = 1000) {
  const f = TestBed.createComponent(DilutionComponent);
  f.componentRef.setInput('seuil', seuil);
  f.componentRef.setInput('visee', visee);
  f.componentRef.setInput('achetee', achetee);
  const emis: number[] = [];
  f.componentInstance.seuilChange.subscribe((v) => emis.push(v));
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const curseur = el.querySelector<HTMLInputElement>('input[type="range"]')!;
  return { f, el, curseur, emis };
}

function glisser(curseur: HTMLInputElement, v: number) {
  curseur.value = String(v);
  curseur.dispatchEvent(new Event('input'));
}

describe('DilutionComponent', () => {
  it('le curseur suit le doigt SANS rien émettre ; le relâchement émet une fois la dernière valeur', async () => {
    const { f, el, curseur, emis } = await rendre();
    glisser(curseur, 25);
    glisser(curseur, 30);
    glisser(curseur, 35);
    await f.whenStable();
    expect(emis).toEqual([]);
    expect(el.querySelector('[data-role="seuil"]')?.textContent?.trim()).toBe('seuil 35 %');
    curseur.dispatchEvent(new Event('pointerup'));
    expect(emis).toEqual([35]);
  });

  it('les touches du clavier émettent au relâchement de la touche', async () => {
    const { curseur, emis } = await rendre();
    glisser(curseur, 25);
    curseur.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' }));
    expect(emis).toEqual([25]);
  });

  it('relâché HORS du curseur : `change` émet ; pointerup + change du même geste : UNE émission', async () => {
    const { curseur, emis } = await rendre();
    glisser(curseur, 25);
    curseur.dispatchEvent(new Event('change'));
    expect(emis).toEqual([25]);
    curseur.dispatchEvent(new Event('pointerup'));
    expect(emis).toEqual([25]);
    glisser(curseur, 40);
    curseur.dispatchEvent(new Event('pointerup'));
    curseur.dispatchEvent(new Event('change'));
    expect(emis).toEqual([25, 40]);
  });

  it('après un PATCH REFUSÉ (le seuil du jeu ne bouge pas), relâcher de nouveau au même cran RENVOIE la valeur', async () => {
    const { curseur, emis } = await rendre();
    curseur.dispatchEvent(new Event('pointerdown'));
    glisser(curseur, 30);
    curseur.dispatchEvent(new Event('pointerup'));
    curseur.dispatchEvent(new Event('change'));
    expect(emis).toEqual([30]);
    // Le serveur a refusé : `seuil` reste 20. Un nouveau geste, relâché au même cran, réessaie — une fois.
    curseur.dispatchEvent(new Event('pointerdown'));
    curseur.dispatchEvent(new Event('pointerup'));
    curseur.dispatchEvent(new Event('change'));
    expect(emis).toEqual([30, 30]);
    // Au clavier aussi : la touche enfoncée ouvre un nouveau geste.
    curseur.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    curseur.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }));
    expect(emis).toEqual([30, 30, 30]);
  });

  it('un relâchement sans déplacement n’émet rien', async () => {
    const { curseur, emis } = await rendre();
    curseur.dispatchEvent(new Event('pointerup'));
    expect(emis).toEqual([]);
  });

  it('le curseur se réaligne sur le seuil relu du serveur', async () => {
    const { f, curseur } = await rendre();
    glisser(curseur, 50);
    f.componentRef.setInput('seuil', 35);
    await f.whenStable();
    expect(curseur.value).toBe('35');
  });

  it('chiffre ce qu’on achète hors zone, et se tait quand rien n’est acheté', async () => {
    const { el } = await rendre(20, 750, 1000);
    expect(el.querySelector('[data-role="gaspille"]')?.textContent?.replace(/\s+/g, ' ').trim())
      .toBe('À ce réglage, la campagne achèterait 250 habitants situés hors des zones, soit 25,0 % de ce qu’elle paie.');
    const vide = await rendre(20, 0, 0);
    expect(vide.el.querySelector('[data-role="gaspille"]')).toBeNull();
  });
});
