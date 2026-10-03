import { TestBed } from '@angular/core/testing';
import { PROFIL_DEFAUT, type ProfilRayons } from '../logique/profil';
import { ResumeProfilComponent } from './resume-profil.component';

async function rendre(profil: ProfilRayons) {
  const f = TestBed.createComponent(ResumeProfilComponent);
  f.componentRef.setInput('profil', profil);
  let ouvertures = 0;
  f.componentInstance.ouvrirAtelier.subscribe(() => { ouvertures += 1; });
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  return { f, el, ouvertures: () => ouvertures };
}

describe('ResumeProfilComponent', () => {
  it('rend le libellé React de PROFIL_DEFAUT', async () => {
    const r = await rendre(PROFIL_DEFAUT);
    const chips = [...r.el.querySelectorAll('button')];
    // Libellé et anneaux sont deux spans séparés par l'écart du flex, comme React : on les relit un à un.
    expect(chips.map((b) => [...b.children].map((c) => c.textContent?.trim()).join(' '))).toEqual([
      'Seveso seuil haut 1 km · 2 km · 5 km',
      'Seveso seuil bas 500 m · 1 km',
    ]);
    expect(chips[0].title).toBe('Régler les anneaux de seveso seuil haut');
    // 2 niveaux × (PPRT + bandes) = (1 + 3) + (1 + 2) = 7 classes, hors-zone exclu.
    expect(r.el.textContent?.replace(/\s+/g, ' ')).toContain('PPRT à part · 7 classes');
    expect(r.el.textContent).not.toContain('liés');
  });

  it('cliquer une chip demande le tiroir des anneaux', async () => {
    const r = await rendre(PROFIL_DEFAUT);
    r.el.querySelector('button')!.click();
    expect(r.ouvertures()).toBe(1);
  });

  // Liés, « Autres régimes » reçoit AUSSI les anneaux du seuil haut (`anneauxDuNiveau`) : 3 niveaux × 3 bandes,
  // sans PPRT = 9 classes, exactement ce que React affiche pour ce profil.
  it('liés, PPRT fondus : « liés » et le compte des classes suivent', async () => {
    const r = await rendre({ ...PROFIL_DEFAUT, lie: true, bas: [1000, 2000, 5000], inclurePPRT: false });
    expect(r.el.textContent).toContain('liés');
    expect(r.el.textContent?.replace(/\s+/g, ' ')).toContain('PPRT fondus · 9 classes');
  });

  it('aucun anneau : un avertissement, aucune chip', async () => {
    const r = await rendre({ ...PROFIL_DEFAUT, haut: [], bas: [] });
    expect(r.el.querySelector('button')).toBeNull();
    expect(r.el.textContent).toContain('Aucun anneau réglé : aucune population n’est classée.');
  });
});
