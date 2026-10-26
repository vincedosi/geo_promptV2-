import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { ReferentielApi } from '../../../risques/data/referentiel.api';
import { ZonesCustomApi, type ZoneCustomResume } from '../../data/zones-custom.api';
import { AnnonceService } from '../../etat/annonce.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { ReferentielGeoService } from '../../etat/referentiel-geo.service';
import type { FiltreActif } from '../../logique/filtre';
import { FILTRE_FRANCE_ENTIERE, FILTRE_METROPOLE } from '../../logique/perimetre-national';
import { ANTI_REBOND_RECHERCHE_MS, PanneauFiltreComponent } from './panneau-filtre.component';

const REF = {
  regions: [
    { code_region: '93', nom_region: "Provence-Alpes-Côte d'Azur", depts: [{ code_dept: '13', nom_dept: 'Bouches-du-Rhône' }, { code_dept: '06', nom_dept: 'Alpes-Maritimes' }] },
    { code_region: '11', nom_region: 'Île-de-France', depts: [{ code_dept: '75', nom_dept: 'Paris' }] },
  ],
};

const ZONE: ZoneCustomResume = {
  id: 'z1', name: 'Zone essai', description: null, source_type: 'rayon', source_metadata: {},
  feature_count_iris: 12, feature_count_cp: 4, bbox: [5, 43, 6, 44], created_at: '2026-10-01', created_by: null,
};

interface Options {
  filtre?: FiltreActif | null;
  org?: string | null;
  zones?: ZoneCustomResume[] | Error;
  refEchec?: boolean;
}

function preparer(o: Options = {}) {
  const lister = vi.fn(() => (o.zones instanceof Error ? throwError(() => ({ status: 500 })) : of({ zones: o.zones ?? [ZONE] })));
  const geo = vi.fn(() => (o.refEchec ? throwError(() => new Error('x')) : of(REF)));
  const lireProfil = vi.fn(async () => ({ role: 'admin', nom: 'A', organisation: o.org === undefined ? 'o1' : o.org }));
  TestBed.configureTestingModule({
    providers: [
      EtatCarteService, AnnonceService, ReferentielGeoService,
      { provide: ReferentielApi, useValue: { geo } },
      { provide: ZonesCustomApi, useValue: { lister } },
      { provide: AuthService, useValue: { lireProfil } },
    ],
  });
  const etat = TestBed.inject(EtatCarteService);
  if (o.filtre !== undefined) etat.filtre.set(o.filtre);
  return { etat, lister, geo, lireProfil };
}

async function monter() {
  const f = TestBed.createComponent(PanneauFiltreComponent);
  f.autoDetectChanges();
  await f.whenStable();
  await new Promise((r) => setTimeout(r, 0));
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const stable = async () => { await new Promise((r) => setTimeout(r, 0)); await f.whenStable(); };
  return { f, el, stable };
}

const liste = (el: HTMLElement, nom: 'regions' | 'departements') =>
  el.querySelector<HTMLElement>(`mg-liste-multiple[data-liste="${nom}"]`)!;

async function choisirDansListe(el: HTMLElement, nom: 'regions' | 'departements', code: string, stable: () => Promise<void>) {
  const l = liste(el, nom);
  if (!l.querySelector('[data-deroulant]')) {
    l.querySelector<HTMLButtonElement>('[data-declencheur]')!.click();
    await stable();
  }
  l.querySelector<HTMLButtonElement>(`[data-element="${code}"]`)!.click();
  await stable();
}

function taper(champ: HTMLInputElement, valeur: string) {
  champ.value = valeur;
  champ.dispatchEvent(new Event('input'));
}

describe('PanneauFiltreComponent', () => {
  afterEach(() => vi.useRealTimers());

  it('choisir la région 93 pose { type: region, code: 93 } (libellé du référentiel) ; la re-choisir retire le filtre', async () => {
    const { etat } = preparer();
    const { el, stable } = await monter();
    await choisirDansListe(el, 'regions', '93', stable);
    expect(etat.filtre()).toEqual({ type: 'region', code: '93', label: "Provence-Alpes-Côte d'Azur" });
    // La liste des départements suit la cascade : ceux de la région seulement.
    liste(el, 'departements').querySelector<HTMLButtonElement>('[data-declencheur]')!.click();
    await stable();
    const depts = [...liste(el, 'departements').querySelectorAll('[data-element]')].map((b) => b.getAttribute('data-element'));
    expect(depts).toEqual(['13', '06']);
    await choisirDansListe(el, 'regions', '93', stable);
    expect(etat.filtre()).toBeNull();
  });

  it('choisir le département 13 après la région REMPLACE le filtre région', async () => {
    const { etat } = preparer();
    const { el, stable } = await monter();
    await choisirDansListe(el, 'regions', '93', stable);
    await choisirDansListe(el, 'departements', '13', stable);
    expect(etat.filtre()).toEqual({ type: 'departement', code: '13', label: '13 — Bouches-du-Rhône' });
  });

  it('une deuxième région choisie REMPLACE la première (sélection simple émulée)', async () => {
    const { etat } = preparer();
    const { el, stable } = await monter();
    await choisirDansListe(el, 'regions', '93', stable);
    await choisirDansListe(el, 'regions', '11', stable);
    expect(etat.filtre()?.code).toBe('11');
    expect(liste(el, 'regions').querySelector('[data-declencheur]')!.textContent).toContain('Île-de-France');
  });

  it('pastille « France + DROM » avec un filtre département : le filtre France entière le remplace, perimetreScope = all', async () => {
    const { etat } = preparer({ filtre: { type: 'departement', code: '13', label: '13 — Bouches-du-Rhône' } });
    const { el, stable } = await monter();
    el.querySelector<HTMLButtonElement>('[data-scope="all"]')!.click();
    await stable();
    expect(etat.filtre()).toEqual(FILTRE_FRANCE_ENTIERE);
    expect(etat.perimetreScope()).toBe('all');
    expect(el.querySelector('[data-territoire]')!.textContent).toContain('de France entière');
    // Re-cliquer la même pastille la lève, filtre compris.
    el.querySelector<HTMLButtonElement>('[data-scope="all"]')!.click();
    await stable();
    expect(etat.filtre()).toBeNull();
    expect(etat.perimetreScope()).toBeNull();
  });

  it('filtre zone + pastille : la pastille REMPLACE la zone, comme tout filtre (A-3, écart voulu à React)', async () => {
    const zone: FiltreActif = { type: 'zone', code: 'z1', label: 'Zone essai', bbox: [5, 43, 6, 44] };
    const { etat } = preparer({ filtre: zone });
    const { el, stable } = await monter();
    el.querySelector<HTMLButtonElement>('[data-scope="metro"]')!.click();
    await stable();
    expect(etat.filtre()).toEqual(FILTRE_METROPOLE);
    expect(etat.perimetreScope()).toBe('metro');
  });

  it('pastille Métro : FILTRE_METROPOLE + metro ; re-cliquée : null/null ; puis Métro, puis une région la remplace (Review Focus 1)', async () => {
    const { etat } = preparer();
    const { el, stable } = await monter();
    const metro = () => el.querySelector<HTMLButtonElement>('[data-scope="metro"]')!;
    metro().click();
    await stable();
    expect(etat.filtre()).toEqual(FILTRE_METROPOLE);
    expect(etat.perimetreScope()).toBe('metro');
    expect(metro().getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('[data-territoire]')!.textContent).toContain('de France métropolitaine');
    metro().click();
    await stable();
    expect(etat.filtre()).toBeNull();
    expect(etat.perimetreScope()).toBeNull();
    metro().click();
    await stable();
    await choisirDansListe(el, 'regions', '93', stable);
    expect(etat.filtre()).toEqual({ type: 'region', code: '93', label: "Provence-Alpes-Côte d'Azur" });
    expect(etat.perimetreScope()).toBeNull();
    expect(metro().getAttribute('aria-pressed')).toBe('false');
    metro().click();
    await stable();
    expect(etat.filtre()).toEqual(FILTRE_METROPOLE);
    // « + DROM » remplace la métropole (même type, autre code).
    el.querySelector<HTMLButtonElement>('[data-scope="all"]')!.click();
    await stable();
    expect(etat.filtre()).toEqual(FILTRE_FRANCE_ENTIERE);
    expect(etat.perimetreScope()).toBe('all');
  });

  it('pastille Métro puis « ✕ Réinitialiser » : filtre et pastille retirés', async () => {
    const { etat } = preparer();
    const { el, stable } = await monter();
    el.querySelector<HTMLButtonElement>('[data-scope="metro"]')!.click();
    await stable();
    el.querySelector<HTMLButtonElement>('[data-reinitialiser]')!.click();
    await stable();
    expect(etat.filtre()).toBeNull();
    expect(etat.perimetreScope()).toBeNull();
  });

  it('la pastille affichée suit le filtre, pas un perimetreScope hérité (ex. après « Tout effacer »)', async () => {
    const { etat } = preparer({ filtre: FILTRE_METROPOLE });
    const { el } = await monter();
    expect(etat.perimetreScope()).toBeNull();
    expect(el.querySelector('[data-scope="metro"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('saisie « 13001 » : filtre cp après l\'anti-rebond, UNE seule écriture pour cinq frappes', async () => {
    const { etat } = preparer();
    const { el, stable } = await monter();
    // La recherche locale est REPLIÉE à l'ouverture, comme React en mode overlay.
    expect(el.querySelector('[data-champ="cp"]')).toBeNull();
    const entetes = [...el.querySelectorAll<HTMLElement>('mg-entete-filtre')];
    entetes.find((e) => e.textContent?.includes('Recherche locale'))!.click();
    await stable();
    const ecritures: (FiltreActif | null)[] = [];
    const set = etat.filtre.set.bind(etat.filtre);
    etat.filtre.set = (v) => { ecritures.push(v); set(v); };
    vi.useFakeTimers();
    const champ = el.querySelector<HTMLInputElement>('[data-champ="cp"]')!;
    for (const v of ['1', '13', '130', '1300', '13001']) {
      taper(champ, v);
      vi.advanceTimersByTime(100);
    }
    expect(ecritures).toEqual([]);
    vi.advanceTimersByTime(ANTI_REBOND_RECHERCHE_MS);
    expect(ecritures).toEqual([{ type: 'cp', code: '13001', label: 'CP 13001' }]);
    expect(etat.filtre()).toEqual({ type: 'cp', code: '13001', label: 'CP 13001' });
  });

  it('saisie ville : filtre commune après 400 ms ; vider le champ le retire sans attendre', async () => {
    const { etat } = preparer();
    const { el, stable } = await monter();
    [...el.querySelectorAll<HTMLElement>('mg-entete-filtre')].find((e) => e.textContent?.includes('Recherche locale'))!.click();
    await stable();
    vi.useFakeTimers();
    const champ = el.querySelector<HTMLInputElement>('[data-champ="ville"]')!;
    taper(champ, 'Brest');
    vi.advanceTimersByTime(ANTI_REBOND_RECHERCHE_MS);
    expect(etat.filtre()).toEqual({ type: 'commune', code: 'brest', label: 'Brest' });
    taper(champ, '');
    vi.advanceTimersByTime(0);
    expect(etat.filtre()).toBeNull();
  });

  it('fermer le panneau abandonne une saisie en suspens', async () => {
    const { etat } = preparer();
    const { f, el, stable } = await monter();
    [...el.querySelectorAll<HTMLElement>('mg-entete-filtre')].find((e) => e.textContent?.includes('Recherche locale'))!.click();
    await stable();
    vi.useFakeTimers();
    taper(el.querySelector<HTMLInputElement>('[data-champ="cp"]')!, '13001');
    f.destroy();
    vi.advanceTimersByTime(ANTI_REBOND_RECHERCHE_MS * 2);
    expect(etat.filtre()).toBeNull();
  });

  it('le bouton « France entière » est retiré (Vincent, 26/10, Q-2) : la pastille « France + DROM » suffit', async () => {
    preparer();
    const { el } = await monter();
    expect(el.querySelector('[data-france]')).toBeNull();
    expect(el.textContent).not.toContain('Périmètre national');
  });

  it('zones enregistrées : UN appel par instance, paramètres org_id + _t ; une zone pose un filtre AVEC sa bbox', async () => {
    const { etat, lister } = preparer();
    const { el, stable } = await monter();
    expect(lister).toHaveBeenCalledTimes(1);
    const params = (lister.mock.calls[0] as unknown as [URLSearchParams])[0];
    expect([...params.keys()]).toEqual(['org_id', '_t']);
    expect(params.get('org_id')).toBe('o1');
    const bouton = el.querySelector<HTMLButtonElement>('[data-zone="z1"]')!;
    expect(bouton.textContent).toContain('4 CP · 12 IRIS');
    bouton.click();
    await stable();
    expect(etat.filtre()).toEqual({ type: 'zone', code: 'z1', label: 'Zone essai', bbox: [5, 43, 6, 44] });
    // Replier puis déplier la section dans la MÊME instance : aucun nouvel appel.
    const entete = [...el.querySelectorAll<HTMLElement>('mg-entete-filtre')].find((e) => e.textContent?.includes('zone enregistrée'))!;
    entete.click();
    await stable();
    entete.click();
    await stable();
    expect(lister).toHaveBeenCalledTimes(1);
  });

  it('fermer puis rouvrir (nouvelle instance) : un nouvel appel, comme React', async () => {
    const { lister } = preparer();
    const premier = await monter();
    premier.f.destroy();
    await monter();
    expect(lister).toHaveBeenCalledTimes(2);
  });

  it('sans organisation active : aucun appel, « Aucune zone enregistrée pour cette organisation. »', async () => {
    const { lister } = preparer({ org: null });
    const { el } = await monter();
    expect(lister).not.toHaveBeenCalled();
    expect(el.querySelector('[data-zones]')!.textContent).toContain('Aucune zone enregistrée pour cette organisation.');
  });

  it('liste des zones en échec : « HTTP 500 »', async () => {
    preparer({ zones: new Error('x') });
    const { el } = await monter();
    expect(el.querySelector('[data-zones]')!.textContent).toContain('HTTP 500');
  });

  it('semis à l\'ouverture : un filtre région présélectionne la région, un filtre cp remplit le champ — sans écrire le filtre', async () => {
    const region: FiltreActif = { type: 'region', code: '93', label: 'PACA' };
    const { etat } = preparer({ filtre: region });
    const { el } = await monter();
    expect(liste(el, 'regions').querySelector('[data-declencheur]')!.textContent).toContain("Provence-Alpes-Côte d'Azur");
    expect(etat.filtre()).toBe(region);
  });

  it('référentiel lu UNE fois par écran : deux ouvertures du panneau, un seul appel', async () => {
    const { geo } = preparer();
    const a = await monter();
    a.f.destroy();
    await monter();
    expect(geo).toHaveBeenCalledTimes(1);
  });

  it('référentiel en échec : la liste le DIT (« Référentiel indisponible ») au lieu de « Chargement… » sans fin', async () => {
    preparer({ refEchec: true });
    const { el } = await monter();
    expect(liste(el, 'regions').textContent).toContain('Référentiel indisponible');
  });
});
