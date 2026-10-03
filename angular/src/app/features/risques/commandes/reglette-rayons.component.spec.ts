import { TestBed } from '@angular/core/testing';
import { PROFIL_DEFAUT, type ProfilRayons } from '../logique/profil';
import { type ApercuRayon, RegletteRayonsComponent } from './reglette-rayons.component';

async function rendre(profil: ProfilRayons = PROFIL_DEFAUT) {
  const f = TestBed.createComponent(RegletteRayonsComponent);
  f.componentRef.setInput('profil', profil);
  const apercus: (ApercuRayon | null)[] = [];
  const profils: ProfilRayons[] = [];
  f.componentInstance.apercu.subscribe((a) => apercus.push(a));
  f.componentInstance.changerProfil.subscribe((p) => profils.push(p));
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const curseurs = () => [...el.querySelectorAll<HTMLInputElement>('input[type="range"]')];
  const cadenas = () => el.querySelector<HTMLButtonElement>('button[aria-pressed]')!;
  return { f, el, curseurs, cadenas, apercus, profils };
}

describe('RegletteRayonsComponent', () => {
  it("20 positions : 20 aperçus, AUCUN profil ; le relâchement à 3 km émet UN profil, puis éteint l'aperçu", async () => {
    const r = await rendre();
    const haut = r.curseurs()[0];
    for (let i = 0; i < 20; i += 1) {
      haut.value = String(5000 - i * 100);
      haut.dispatchEvent(new Event('input'));
    }
    await r.f.whenStable();
    expect(r.apercus).toHaveLength(20);
    expect(r.apercus.every((a) => a?.niveau === 'haut')).toBe(true);
    expect(r.profils).toEqual([]);

    haut.value = '3000';
    haut.dispatchEvent(new Event('input'));
    haut.dispatchEvent(new Event('pointerup'));
    await r.f.whenStable();
    expect(r.profils).toHaveLength(1);
    expect(r.profils[0].haut).toEqual([1000, 2000, 3000]);
    expect(r.profils[0].bas).toEqual([500, 1000]);
    expect(r.apercus).toHaveLength(22);
    expect(r.apercus[20]).toEqual({ niveau: 'haut', rayonM: 3000 });
    expect(r.apercus[21]).toBeNull();
  });

  it("le bord ne descend pas sous le dernier anneau intérieur (garde de `poserRayonExterieur`)", async () => {
    const r = await rendre();
    const bas = r.curseurs()[1];
    bas.value = '100';
    bas.dispatchEvent(new Event('input'));
    bas.dispatchEvent(new Event('pointerup'));
    await r.f.whenStable();
    expect(r.profils[0].bas).toEqual([500, 600]);
  });

  it('délié : une réglette par niveau réglable (pas « Autres régimes »), anneaux intérieurs rappelés en gris', async () => {
    const r = await rendre();
    expect(r.curseurs()).toHaveLength(2);
    const lignes = [...r.el.querySelectorAll('mg-reglette')].map((m) =>
      [...m.querySelectorAll('span')].map((s) => s.textContent?.trim()).join(' '));
    expect(lignes).toEqual(['Seveso seuil haut 1 km · 2 km · 5 km', 'Seveso seuil bas 500 m · 1 km']);
    expect(r.el.textContent).not.toContain('Autres régimes');
    expect(r.curseurs()[0].getAttribute('aria-label')).toBe('Bord de la zone — Seveso seuil haut, de 100 à 10000 mètres');
    expect(r.el.querySelector('[title^="Anneaux intérieurs"]')?.getAttribute('title'))
      .toBe('Anneaux intérieurs — réglables dans l’atelier, la réglette ne déplace que le bord.');
    expect(r.cadenas().textContent?.trim()).toBe('lier les niveaux');
    expect(r.cadenas().title).toBe('Donner à tous les niveaux les anneaux du seuil haut, pour comparer à périmètre égal. ⚠ Les anneaux propres du seuil bas sont alors écrasés, et les délier ne les restaure pas.');
  });

  it('cadenas : un clic émet `lie: true` ; lié, UNE réglette « Tous les niveaux » et un aperçu sans niveau', async () => {
    const r = await rendre();
    r.cadenas().click();
    await r.f.whenStable();
    expect(r.profils).toHaveLength(1);
    expect(r.profils[0].lie).toBe(true);

    r.f.componentRef.setInput('profil', r.profils[0]);
    await r.f.whenStable();
    expect(r.curseurs()).toHaveLength(1);
    expect(r.el.textContent).toContain('Tous les niveaux');
    expect(r.cadenas().textContent?.trim()).toBe('niveaux liés');
    expect(r.cadenas().getAttribute('aria-pressed')).toBe('true');
    expect(r.cadenas().title).toBe('Les niveaux partagent les mêmes anneaux. Cliquez pour leur en donner de propres — c’est ce qui permet le bidding différencié.');
    const c = r.curseurs()[0];
    c.value = '4000';
    c.dispatchEvent(new Event('input'));
    expect(r.apercus.at(-1)).toEqual({ niveau: null, rayonM: 4000 });
  });
});
