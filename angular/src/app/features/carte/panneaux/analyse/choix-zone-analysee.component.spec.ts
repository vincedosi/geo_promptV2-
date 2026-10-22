import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { ZonesCustomApi, type ZoneCustomResume } from '../../data/zones-custom.api';
import { ChoixZoneAnalyseeComponent } from './choix-zone-analysee.component';

const Z1 = '0f8fad5b-d9cb-469f-a165-70867728950e';
const zone = (id: string, name: string, recette: ZoneCustomResume['recette'] = null) => ({ id, name, recette } as ZoneCustomResume);
const attendre = () => new Promise((r) => setTimeout(r, 0));

function monter(zoneId: string | null = null, org: string | null = 'o1') {
  const reponses: Array<Subject<{ zones: ZoneCustomResume[] }>> = [];
  const lister = vi.fn((_p: URLSearchParams) => { const s = new Subject<{ zones: ZoneCustomResume[] }>(); reponses.push(s); return s; });
  TestBed.configureTestingModule({
    providers: [
      { provide: ZonesCustomApi, useValue: { lister } },
      { provide: AuthService, useValue: { lireProfil: vi.fn(async () => ({ role: 'admin', nom: 'A', organisation: org })) } },
    ],
  });
  const f = TestBed.createComponent(ChoixZoneAnalyseeComponent);
  f.componentRef.setInput('zoneId', zoneId);
  const choisies: Array<string | null> = [];
  f.componentInstance.choisie.subscribe((v) => choisies.push(v));
  const el = f.nativeElement as HTMLElement;
  const stable = async () => { await attendre(); await f.whenStable(); };
  const cliquer = async (sel: string) => { await stable(); (el.querySelector(sel) as HTMLElement).click(); await stable(); };
  return { f, el, lister, reponses, choisies, stable, cliquer };
}

describe('mg-choix-zone-analysee', () => {
  it('aucune requête avant le premier clic ; une seule ensuite, même rouvert', async () => {
    const { lister, reponses, stable, cliquer, el } = monter();
    await stable();
    expect(lister).not.toHaveBeenCalled();
    await cliquer('[data-ouvrir]');
    expect(lister).toHaveBeenCalledTimes(1);
    expect(lister.mock.calls[0][0].get('org_id')).toBe('o1');
    reponses[0].next({ zones: [zone(Z1, 'Lycées à 5 km'), zone('b', 'Aix')] });
    await stable();
    expect(el.querySelectorAll('[data-zone]')).toHaveLength(2);
    await cliquer('[data-fermer]');
    await cliquer('[data-ouvrir]');
    expect(lister).toHaveBeenCalledTimes(1);
  });
  it('filtre par nom, sans casse ni accents ; choisir émet l’id et referme', async () => {
    const { reponses, stable, cliquer, el, f, choisies } = monter();
    await cliquer('[data-ouvrir]');
    reponses[0].next({ zones: [zone(Z1, 'Écoles de Lyon'), zone('b', 'Aix')] });
    await stable();
    const champ = el.querySelector('input') as HTMLInputElement;
    champ.value = 'ecoles';
    champ.dispatchEvent(new Event('input'));
    await stable();
    expect([...el.querySelectorAll('[data-zone]')].map((b) => b.getAttribute('data-zone'))).toEqual([Z1]);
    await cliquer(`[data-zone="${Z1}"]`);
    expect(choisies).toEqual([Z1]);
    f.componentRef.setInput('zoneId', Z1);
    await stable();
    expect(el.querySelector('[data-zone-choisie]')?.textContent).toContain('Écoles de Lyon');
  });
  it('zone choisie : nom, libellé de recette, « Changer », « Retirer » (émet null)', async () => {
    const { reponses, stable, el, cliquer, choisies, lister } = monter(Z1);
    await stable();
    // Une zone déjà choisie (lien) : la liste est lue une fois pour dire son nom.
    expect(lister).toHaveBeenCalledTimes(1);
    reponses[0].next({ zones: [zone(Z1, 'Rayon', { v: 1, type: 'rayon_point', lon: 5, lat: 43, rayon_m: 5000 } as ZoneCustomResume['recette'])] });
    await stable();
    const carte = el.querySelector('[data-zone-choisie]')?.textContent ?? '';
    expect(carte).toContain('Rayon');
    expect(carte).toContain('autour d’un point');
    await cliquer('[data-retirer]');
    expect(choisies).toEqual([null]);
    await cliquer('[data-changer]');
    expect(el.querySelector('[data-liste-zones]')).not.toBeNull();
    expect(lister).toHaveBeenCalledTimes(1);
  });
  it('sans espace : un message, aucune requête', async () => {
    const { lister, cliquer, el } = monter(null, null);
    await cliquer('[data-ouvrir]');
    expect(lister).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Aucun espace actif');
  });
  it('liste vide : le dit', async () => {
    const { reponses, stable, cliquer, el } = monter();
    await cliquer('[data-ouvrir]');
    reponses[0].next({ zones: [] });
    await stable();
    expect(el.textContent).toContain('Aucune zone enregistrée dans cet espace.');
  });
});
