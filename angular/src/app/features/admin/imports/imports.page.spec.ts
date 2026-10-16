import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { ImportsApi, type LigneImport } from './data/imports.api';
import { ImportsPage } from './imports.page';

const URL = '/api/admin/imports';

function ligne(p: Partial<LigneImport> & { id: string }): LigneImport {
  return {
    kind: 'source', source: `Source ${p.id}`, started_at: '2026-10-16T12:05:00.000Z', finished_at: null,
    status: 'success', total: 1000, inserted: 900, updated: 0, duplicates: 0, errors: 0, type: 'poi', org_name: null,
    ...p,
  };
}

const LIGNES: LigneImport[] = [
  ligne({ id: 'a', source: 'Lycées de France', total: 4653, inserted: 4653, errors: 0, org_name: 'Espace de test' }),
  ligne({ id: 'b', kind: 'ooh', type: undefined, source: 'arcgis-ancien', status: 'error', total: 120, inserted: 100, updated: 7, errors: 3 }),
  ligne({ id: 'c', type: 'carreaux', status: 'pending', total: 2324577, inserted: 2324000, errors: 577 }),
  ligne({ id: 'd', type: undefined, status: 'brouillon', started_at: '', total: 5, inserted: 5 }),
];

const texte = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
/** `toLocaleString('fr-FR')` sépare les milliers par une espace fine insécable : on compare sans elle. */
const espaces = (s: string) => s.replace(/\s/g, ' ');

describe('ImportsPage — historique des imports (lot 6, T11′)', () => {
  let f: ComponentFixture<ImportsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), ImportsApi,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    f = TestBed.createComponent(ImportsPage);
    http = TestBed.inject(HttpTestingController);
    el = f.nativeElement as HTMLElement;
    f.detectChanges();
  });

  afterEach(() => http.verify());

  async function servir(lignes: LigneImport[] = LIGNES) {
    http.expectOne(URL).flush({ success: true, imports: lignes });
    await f.whenStable();
  }

  async function rafraichir() {
    (el.querySelector('[data-rafraichir]') as HTMLButtonElement).click();
    await f.whenStable();
  }

  const stats = () =>
    [...el.querySelectorAll('[data-stat]')].map((s) => [texte(s.querySelector('[data-libelle]')), espaces(texte(s.querySelector('[data-valeur]')))]);
  const lignesRendues = () => [...el.querySelectorAll('tbody tr')];

  it('UN GET à l’ouverture ; « chargement... » tant qu’il est en vol ; pas de titre de page (remonté dans le cadre)', async () => {
    await f.whenStable();
    expect(texte(el.querySelector('[data-chargement]'))).toBe('chargement...');
    expect(el.querySelector('h1')).toBeNull();
    await servir();
    expect(el.querySelector('[data-chargement]')).toBeNull();
  });

  it('sous-titre SANS « OOH ArcGIS » (import supprimé le 2026-10-16, ruling du 16/10)', async () => {
    await servir();
    const sousTitre = texte(el.querySelector('[data-sous-titre]'));
    expect(sousTitre).toBe('Historique global de tous les imports — sources CSV/Shapefile');
    expect(sousTitre).not.toContain('OOH');
  });

  it('statistiques : runs, enregistrements importés (somme des insérés), erreurs (somme), au format fr-FR', async () => {
    await servir();
    expect(stats()).toEqual([
      ['Runs', '4'],
      ['Enregistrements importés', espaces((4653 + 100 + 2324000 + 5).toLocaleString('fr-FR'))],
      ['Erreurs', espaces((3 + 577).toLocaleString('fr-FR'))],
    ]);
    // Erreurs > 0 → teinte danger ; sinon neutre (page.tsx:110).
    expect(el.querySelector('[data-stat="erreurs"] [data-valeur]')?.getAttribute('data-teinte')).toBe('danger');
    expect(el.querySelector('[data-stat="importes"] [data-valeur]')?.getAttribute('data-teinte')).toBe('succes');
  });

  it('filtres « Tous » et « SOURCE » seulement — plus de « OOH » ; filtrer est LOCAL (aucune requête) et recalcule les stats', async () => {
    await servir();
    const boutons = [...el.querySelectorAll<HTMLButtonElement>('[data-filtre]')];
    expect(boutons.map((b) => texte(b))).toEqual(['Tous', 'SOURCE']);
    expect(boutons[0].getAttribute('aria-pressed')).toBe('true');
    expect(lignesRendues().length).toBe(4);
    boutons[1].click();
    await f.whenStable();
    http.expectNone(URL);
    expect(boutons[1].getAttribute('aria-pressed')).toBe('true');
    expect(boutons[0].getAttribute('aria-pressed')).toBe('false');
    // La ligne `kind: 'ooh'` (un run ArcGIS ancien) reste visible sous « Tous », jamais sous « SOURCE ».
    expect(lignesRendues().length).toBe(3);
    expect(stats()[0]).toEqual(['Runs', '3']);
    boutons[0].click();
    await f.whenStable();
    expect(lignesRendues().length).toBe(4);
  });

  it('tableau : en-têtes de React, type, source, workspace (« global » à défaut), date fr-FR, statut, nombres', async () => {
    await servir();
    expect([...el.querySelectorAll('thead th')].map((t) => texte(t))).toEqual(
      ['Type', 'Source', 'Workspace', 'Démarré le', 'Statut', 'Total', 'Insérés', 'MAJ', 'Erreurs'],
    );
    const cellules = (i: number) => [...lignesRendues()[i].querySelectorAll('td')].map((t) => espaces(texte(t)));
    const date = new Date('2026-10-16T12:05:00.000Z').toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    expect(cellules(0)).toEqual(['POI', 'Lycées de France', 'Espace de test', espaces(date), 'success', '4 653', '4 653', '0', '0']);
    expect(cellules(1)).toEqual(['OOH', 'arcgis-ancien', 'global', espaces(date), 'error', '120', '100', '7', '3']);
    // Type absent → « SOURCE » ; date absente → « — » (page.tsx:57,167).
    expect(cellules(3)[0]).toBe('SOURCE');
    expect(cellules(3)[3]).toBe('—');
    expect(lignesRendues()[0].querySelector('[data-type]')?.getAttribute('data-type')).toBe('source');
    expect(lignesRendues()[1].querySelector('[data-type]')?.getAttribute('data-type')).toBe('ooh');
    // `title` : la source tronquée par l'ellipse reste lisible au survol.
    expect(lignesRendues()[0].querySelector('[data-source]')?.getAttribute('title')).toBe('Lycées de France');
  });

  it('statut et erreurs : teintes de React (success/active/termine, error/deleted, running/pending, autre)', async () => {
    await servir();
    const teintes = lignesRendues().map((l) => l.querySelector('[data-statut]')?.getAttribute('data-teinte'));
    expect(teintes).toEqual(['succes', 'danger', 'avert', 'neutre']);
    const erreurs = lignesRendues().map((l) => l.querySelector('[data-erreurs]')?.getAttribute('data-teinte'));
    expect(erreurs).toEqual(['neutre', 'danger', 'danger', 'neutre']);
  });

  it('liste vide → « Aucun import »', async () => {
    await servir([]);
    expect(texte(el.querySelector('[data-vide]'))).toBe('Aucun import');
    expect(el.querySelector('table')).toBeNull();
  });

  it('« Rafraîchir » relit (UN GET), « chargement... » pendant', async () => {
    await servir();
    await rafraichir();
    expect(texte(el.querySelector('[data-chargement]'))).toBe('chargement...');
    http.expectOne(URL).flush({ success: true, imports: LIGNES.slice(0, 1) });
    await f.whenStable();
    expect(lignesRendues().length).toBe(1);
  });

  it('`success: false` → « ! <error> » ; sans message → « ! Erreur » (page.tsx:80-81)', async () => {
    http.expectOne(URL).flush({ success: false, error: 'Table absente' });
    await f.whenStable();
    expect(texte(el.querySelector('[data-erreur]'))).toBe('! Table absente');
    await rafraichir();
    expect(el.querySelector('[data-erreur]')).toBeNull();
    http.expectOne(URL).flush({ success: false });
    await f.whenStable();
    expect(texte(el.querySelector('[data-erreur]'))).toBe('! Erreur');
  });

  it('réponse non 2xx : le `error` du corps (401 de requireAdmin), sinon « Erreur » ; réseau coupé : le texte de React', async () => {
    http.expectOne(URL).flush({ error: 'Non autorisé' }, { status: 401, statusText: 'Unauthorized' });
    await f.whenStable();
    expect(texte(el.querySelector('[data-erreur]'))).toBe('! Non autorisé');
    await rafraichir();
    http.expectOne(URL).flush('<html>', { status: 500, statusText: 'Server Error' });
    await f.whenStable();
    expect(texte(el.querySelector('[data-erreur]'))).toBe('! Erreur');
    await rafraichir();
    http.expectOne(URL).error(new ProgressEvent('error'));
    await f.whenStable();
    expect(texte(el.querySelector('[data-erreur]'))).toBe('! TypeError: Failed to fetch');
  });

  it('une erreur garde la liste déjà lue (React ne vide pas `imports`)', async () => {
    await servir();
    await rafraichir();
    http.expectOne(URL).flush({ success: false, error: 'x' });
    await f.whenStable();
    expect(lignesRendues().length).toBe(4);
  });

  it('« Rafraîchir » pendant une lecture en vol : la précédente est annulée, une seule réponse fait foi', async () => {
    const premiere = http.expectOne(URL);
    await rafraichir();
    expect(premiere.cancelled).toBe(true);
    http.expectOne(URL).flush({ success: true, imports: LIGNES.slice(0, 2) });
    await f.whenStable();
    expect(lignesRendues().length).toBe(2);
  });

  it('quitter l’écran annule la lecture en vol (lecture seule, rien à mener à terme)', () => {
    const req = http.expectOne(URL);
    f.destroy();
    expect(req.cancelled).toBe(true);
  });
});
