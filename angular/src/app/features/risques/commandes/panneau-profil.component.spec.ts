import { TestBed } from '@angular/core/testing';
import { PROFIL_DEFAUT, type ProfilRayons } from '../logique/profil';
import { PanneauProfilComponent } from './panneau-profil.component';

async function rendre(profil: ProfilRayons = PROFIL_DEFAUT, parClasse?: Record<string, number>) {
  const f = TestBed.createComponent(PanneauProfilComponent);
  f.componentRef.setInput('profil', profil);
  if (parClasse) f.componentRef.setInput('parClasse', parClasse);
  const profils: ProfilRayons[] = [];
  f.componentInstance.profilChange.subscribe((p) => {
    profils.push(p);
    f.componentRef.setInput('profil', p);
  });
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const niveau = (n: string) => el.querySelector<HTMLElement>(`[data-niveau="${n}"]`)!;
  const saisie = (n: string) => niveau(n).querySelector<HTMLInputElement>('input[type="number"]')!;
  const saisir = async (n: string, valeur: string) => {
    const champ = saisie(n);
    champ.value = valeur;
    champ.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await f.whenStable();
  };
  return { f, el, niveau, saisie, saisir, profils };
}

describe('PanneauProfilComponent', () => {
  it('une ligne par niveau ; « Autres régimes » désactivé AVEC sa raison', async () => {
    const r = await rendre();
    expect(r.el.querySelector('mg-entete-section')?.textContent).toContain('Anneaux par niveau');
    expect(r.niveau('haut').textContent).toContain('Seveso seuil haut');
    const autres = r.niveau('autres');
    expect(autres.classList.contains('opacity-45')).toBe(true);
    expect(autres.textContent?.replace(/\s+/g, ' ')).toContain('Non calculé : 97 825 sites relèvent des autres régimes, contre 1 327 Seveso.');
    expect(autres.querySelector('input')).toBeNull();
  });

  it('saisir 1 500 au seuil bas → `bas = [500, 1000, 1500]`, le champ est vidé', async () => {
    const r = await rendre();
    await r.saisir('bas', '1500');
    expect(r.profils.at(-1)!.bas).toEqual([500, 1000, 1500]);
    expect(r.saisie('bas').value).toBe('');
  });

  it('une saisie hors bornes ou non entière est ignorée et reste dans le champ', async () => {
    const r = await rendre();
    await r.saisir('bas', '50');
    await r.saisir('bas', '12000');
    await r.saisir('bas', '1500.5');
    expect(r.profils).toEqual([]);
    expect(r.saisie('bas').value).toBe('1500.5');
  });

  it('Échap dans la saisie VIDE le champ : la sortie du champ qui suit (tiroir refermé) ne valide rien', async () => {
    const r = await rendre();
    const champ = r.saisie('bas');
    champ.value = '1500';
    champ.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    champ.dispatchEvent(new FocusEvent('blur'));
    await r.f.whenStable();
    expect(r.profils).toEqual([]);
    expect(champ.value).toBe('');
  });

  it('un cinquième anneau est REFUSÉ, avec un message', async () => {
    const r = await rendre({ ...PROFIL_DEFAUT, haut: [1000, 2000, 3000, 5000] });
    await r.saisir('haut', '7000');
    expect(r.profils).toEqual([]);
    expect(r.el.querySelector('[role="alert"]')?.textContent).toContain('Quatre anneaux au maximum par niveau.');
  });

  it('palier usuel ajouté, anneau retiré ; les paliers déjà présents ne sont pas proposés', async () => {
    const r = await rendre();
    const paliers = [...r.niveau('bas').querySelectorAll('button')].map((b) => b.textContent?.trim()).filter((t) => t);
    expect(paliers).toEqual(['2 km', '5 km']);
    [...r.niveau('bas').querySelectorAll('button')].find((b) => b.textContent?.trim() === '2 km')!.click();
    await r.f.whenStable();
    expect(r.profils.at(-1)!.bas).toEqual([500, 1000, 2000]);
    r.niveau('haut').querySelector<HTMLButtonElement>('button[aria-label="Retirer l’anneau de 2 km"]')!.click();
    await r.f.whenStable();
    expect(r.profils.at(-1)!.haut).toEqual([1000, 5000]);
  });

  it('chaque bande porte sa population depuis `parClasse`, formatée fr-FR', async () => {
    const r = await rendre(PROFIL_DEFAUT, { 'haut:1': 526874, 'haut:2': 2337495, 'haut:3': 10482317, 'bas:1': 106419 });
    expect(r.niveau('haut').querySelector('[data-classe="haut:3"]')?.getAttribute('title'))
      .toBe(`Bande 3 : ${(10482317).toLocaleString('fr-FR')} habitants`);
    expect(r.niveau('bas').querySelector('[data-classe="bas:1"]')?.getAttribute('title'))
      .toBe(`Bande 1 : ${(106419).toLocaleString('fr-FR')} habitants`);
    // Sans population connue : aucune infobulle, jamais « undefined habitants ».
    expect(r.niveau('bas').querySelector('[data-classe="bas:2"]')?.hasAttribute('title')).toBe(false);
  });

  it('PPRT décoché : profil `inclurePPRT: false` et texte explicatif mis à jour', async () => {
    const r = await rendre();
    const cb = r.el.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(cb.checked).toBe(true);
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    await r.f.whenStable();
    expect(r.profils.at(-1)!.inclurePPRT).toBe(false);
    expect(r.el.textContent).toContain('Les servitudes publiées ne sont pas distinguées');
  });

  it('cadenas du seuil haut : lie les niveaux', async () => {
    const r = await rendre();
    const b = r.niveau('haut').querySelector<HTMLButtonElement>('button[aria-pressed]')!;
    expect(b.textContent?.trim()).toBe('lier');
    b.click();
    await r.f.whenStable();
    expect(r.profils.at(-1)!.lie).toBe(true);
    expect(b.textContent?.trim()).toBe('liés');
  });
});
