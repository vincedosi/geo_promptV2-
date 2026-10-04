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
