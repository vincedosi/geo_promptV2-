import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { NotificationsService } from '../../../../ui/notifications/notifications.service';
import { SourcesAdminApi, type StatsSources } from '../data/sources-admin.api';
import type { LignePoi } from '../data/panneaux.types';
import { PoiComponent } from './poi.component';

const STATS: StatsSources = {
  success: true,
  ooh: { total: 1253 },
  poi: {
    total: 105014,
    by_category: [
      { nb: 99152, categorie: 'risque_industriel' }, { nb: 5584, categorie: 'lycee' },
      { nb: 177, categorie: 'bmw' }, { nb: 101, categorie: 'cirfa' },
    ],
  },
  transport: { total: 285015, bus: 276390, train: 8258, tram: 142, metro: 225 },
  flux: { total: 1100, cerema: 1100, osm: 0 },
  carreaux: { total: 2324604 },
  iris: { total: 49448, enrichis: 49133 },
};

function ligne(i: number, p: Partial<LignePoi> = {}): LignePoi {
  return {
    id: `p${i}`, nom: `Lycée ${i}`, categorie: 'lycee', sous_categorie: null, lat: 48.85661234, lng: 2.35221234,
    adresse: null, ville: 'Paris', departement: '75', code_postal: '75001', source: 'data.gouv', ...p,
  };
}
const PAGE = (debut: number, n: number) => Array.from({ length: n }, (_, k) => ligne(debut + k));

const texte = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const espaces = (s: string) => s.replace(/\s/g, ' ');
/** Les nœuds texte d'un élément, joints par une espace (Angular retire les blancs ENTRE éléments). */
function mots(e: Element | null | undefined): string {
  if (!e) return '';
  const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
  const l: string[] = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) { const t = n.textContent?.replace(/\s+/g, ' ').trim(); if (t) l.push(t); }
  return l.join(' ');
}

function doublerDialog() {
  const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  proto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
}

const echantillons = (r: { url: string }) => r.url === '/api/admin/poi-samples';
const gestion = (methode: string) => (r: { url: string; method: string }) => r.url === '/api/admin/poi-manage' && r.method === methode;

describe('PoiComponent — POI par catégorie, échantillons paginés, création / édition / suppressions (lot 6, T19)', () => {
  let f: ComponentFixture<PoiComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;
  let modifs: number;

  beforeEach(async () => {
    doublerDialog();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), SourcesAdminApi, NotificationsService,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    f = TestBed.createComponent(PoiComponent);
    f.componentRef.setInput('stats', STATS);
    modifs = 0;
    f.componentInstance.modifie.subscribe(() => modifs++);
    http = TestBed.inject(HttpTestingController);
    el = f.nativeElement as HTMLElement;
    await f.whenStable();
  });

  afterEach(() => http.verify());
  const stable = () => f.whenStable();
  const carte = (cat: string) => el.querySelector<HTMLElement>(`[data-categorie="${cat}"]`)!;
  const dans = (racine: Element, sel: string) => racine.querySelector<HTMLButtonElement>(sel)!;
  const lignes = () => [...el.querySelectorAll<HTMLElement>('[data-poi]')];
  const notifications = () => TestBed.inject(NotificationsService).notifications().map((n) => [n.variante, n.titre, n.message ?? '']);
  const dialogue = () => el.querySelector('mg-dialogue-poi dialog');

  async function voir(cat = 'lycee', page = PAGE(0, 50), total = 5584) {
    dans(carte(cat), '[data-voir]').click();
    await stable();
    const r = http.expectOne(echantillons);
    r.flush({ success: true, samples: page, total, offset: 0, limit: 50 });
    await stable();
    return r;
  }

  it('création : AUCUNE lecture (les catégories viennent des statistiques du parent) ; en-tête et cartes aux textes de React', async () => {
    http.expectNone(() => true);
    expect(texte(el.querySelector('[data-titre]'))).toBe("Points d'intérêt (hors transport)");
    expect(texte(el.querySelector('[data-categories]'))).toBe('Catégories: risque_industriel, lycee, bmw, cirfa');
    expect(espaces(texte(el.querySelector('[data-total]')))).toBe('105 014');
    const cartes = [...el.querySelectorAll('[data-categorie]')];
    expect(cartes.map((c) => c.getAttribute('data-categorie'))).toEqual(['risque_industriel', 'lycee', 'bmw', 'cirfa']);
    expect(espaces(texte(carte('lycee').querySelector('[data-libelle]')))).toBe('Lycées');
    expect(espaces(texte(carte('lycee').querySelector('[data-pct]')))).toBe('5%');
    expect(espaces(mots(carte('lycee').querySelector('[data-nb]')))).toBe('5 584 POI');
    expect(texte(carte('lycee').querySelector('[data-description]'))).toBe('Établissements scolaires du second degré');
    // Catégorie inconnue de `POI_META` : libellé capitalisé, `_` → espace, description « Catégorie : … ».
    expect(texte(carte('risque_industriel').querySelector('[data-libelle]'))).toBe('Risque industriel');
    expect(texte(carte('risque_industriel').querySelector('[data-description]'))).toBe('Catégorie : risque_industriel');
    expect(texte(carte('risque_industriel').querySelector('[data-pct]'))).toBe('94%');
  });

  it('« + voir » : GET `cat`, `limit=50`, `offset=0` ; « Charger + » : page 2 à `offset=50` ; « ✕ fermer » vide sans requête', async () => {
    const r = await voir();
    expect(r.request.urlWithParams).toBe('/api/admin/poi-samples?cat=lycee&limit=50&offset=0');
    expect(espaces(texte(el.querySelector('[data-entete-echantillons]')))).toContain('lycee — 50 / 5 584 POI');
    expect(lignes().length).toBe(50);
    expect([...lignes()[0].querySelectorAll('td')].slice(0, 7).map(texte)).toEqual(['Lycée 0', 'Paris', '—', '—', '48.8566', '2.3522', 'data.gouv']);
    expect(espaces(texte(el.querySelector('[data-charger-plus]')))).toBe('Charger + (5 534 restants)');
    el.querySelector<HTMLButtonElement>('[data-charger-plus]')!.click();
    await stable();
    const page2 = http.expectOne(echantillons);
    expect(page2.request.urlWithParams).toBe('/api/admin/poi-samples?cat=lycee&limit=50&offset=50');
    page2.flush({ success: true, samples: PAGE(50, 50), total: 5584 });
    await stable();
    expect(lignes().length).toBe(100);
    expect(texte(dans(carte('lycee'), '[data-voir]'))).toBe('✕ fermer');
    dans(carte('lycee'), '[data-voir]').click();
    await stable();
    expect(el.querySelector('[data-echantillons]')).toBeNull();
    http.expectNone(() => true);
  });

  it('création : la modale (`<dialog>`) s’ouvre catégorie préremplie pour lycee / cirfa seulement ; POST au corps EXACT ; puis relecture page 1 et `modifie`', async () => {
    await voir();
    dans(carte('bmw'), '[data-nouveau]').click();
    await stable();
    expect(el.querySelector<HTMLInputElement>('mg-dialogue-poi [data-champ="categorie"]')!.value).toBe('');
    el.querySelector<HTMLButtonElement>('mg-dialogue-poi [data-annuler]')!.click();
    await stable();
    expect(dialogue()).toBeNull();
    dans(carte('lycee'), '[data-nouveau]').click();
    await stable();
    expect(texte(el.querySelector('mg-dialogue-poi [data-titre]'))).toBe('+ Nouveau POI');
    const remplir = (champ: string, v: string) => {
      const i = el.querySelector<HTMLInputElement>(`mg-dialogue-poi [data-champ="${champ}"]`)!;
      i.value = v;
      i.dispatchEvent(new Event('input'));
    };
    expect(el.querySelector<HTMLInputElement>('mg-dialogue-poi [data-champ="categorie"]')!.value).toBe('lycee');
    remplir('nom', '[ESSAI lot 6] POI');
    remplir('lat', '48.85');
    remplir('lng', '2.35');
    remplir('ville', 'Paris');
    await stable();
    el.querySelector<HTMLButtonElement>('mg-dialogue-poi [data-enregistrer]')!.click();
    await stable();
    const post = http.expectOne(gestion('POST'));
    expect(post.request.body).toEqual({
      nom: '[ESSAI lot 6] POI', categorie: 'lycee', sous_categorie: '', lat: '48.85', lng: '2.35',
      adresse: '', ville: 'Paris', departement: '', code_postal: '', source: '',
    });
    expect(Object.keys(post.request.body as object)).toEqual(
      ['nom', 'categorie', 'sous_categorie', 'lat', 'lng', 'adresse', 'ville', 'departement', 'code_postal', 'source'],
    );
    post.flush({ success: true, poi: ligne(999) });
    await stable();
    expect(dialogue()).toBeNull();
    expect(http.expectOne(echantillons).request.params.get('offset')).toBe('0');
    expect(modifs).toBe(1);
  });

  it('création refusée : l’`error` de la route DANS la modale, qui reste ouverte ; aucun `modifie`', async () => {
    dans(carte('cirfa'), '[data-nouveau]').click();
    await stable();
    el.querySelector<HTMLButtonElement>('mg-dialogue-poi [data-enregistrer]')!.click();
    await stable();
    http.expectOne(gestion('POST')).flush({ error: 'lat: Expected number, received nan' }, { status: 400, statusText: 'Bad Request' });
    await stable();
    expect(dialogue()).not.toBeNull();
    expect(texte(el.querySelector('mg-dialogue-poi [data-erreur]'))).toBe('lat: Expected number, received nan');
    expect(modifs).toBe(0);
  });

  it('édition : « éditer » ouvre la modale remplie (lat / lng en texte) ; PUT avec `id` en tête', async () => {
    await voir('lycee', [ligne(1, { sous_categorie: 'public', adresse: '1 rue A' })], 1);
    dans(lignes()[0], '[data-editer]').click();
    await stable();
    expect(texte(el.querySelector('mg-dialogue-poi [data-titre]'))).toBe('Éditer POI');
    expect(texte(el.querySelector('mg-dialogue-poi [data-enregistrer]'))).toBe('Enregistrer');
    const i = el.querySelector<HTMLInputElement>('mg-dialogue-poi [data-champ="nom"]')!;
    i.value = 'Lycée 1 renommé';
    i.dispatchEvent(new Event('input'));
    el.querySelector<HTMLButtonElement>('mg-dialogue-poi [data-enregistrer]')!.click();
    await stable();
    const put = http.expectOne(gestion('PUT'));
    expect(Object.keys(put.request.body as object)[0]).toBe('id');
    expect(put.request.body).toEqual({
      id: 'p1', nom: 'Lycée 1 renommé', categorie: 'lycee', sous_categorie: 'public', lat: '48.85661234', lng: '2.35221234',
      adresse: '1 rue A', ville: 'Paris', departement: '75', code_postal: '75001', source: 'data.gouv',
    });
    put.flush({ success: true });
    await stable();
    http.expectOne(echantillons).flush({ success: true, samples: [ligne(1, { nom: 'Lycée 1 renommé' })], total: 1 });
    await stable();
    expect(texte(lignes()[0].querySelector('td'))).toBe('Lycée 1 renommé');
  });

  it('suppression unitaire : DELETE `?id=` ; succès → ligne retirée, total −1, `modifie`', async () => {
    await voir('lycee', PAGE(0, 3), 3);
    dans(lignes()[1], '[data-supprimer]').click();
    await stable();
    const d = http.expectOne(gestion('DELETE'));
    expect(d.request.urlWithParams).toBe('/api/admin/poi-manage?id=p1');
    d.flush({ success: true, deleted: 'single', id: 'p1' });
    await stable();
    expect(lignes().map((l) => l.getAttribute('data-poi'))).toEqual(['p0', 'p2']);
    expect(espaces(texte(el.querySelector('[data-entete-echantillons]')))).toContain('lycee — 2 / 2 POI');
    expect(modifs).toBe(1);
  });

  it('suppression unitaire refusée (500) : notification au message de la route, la ligne RESTE (React la retirait sans lire la réponse)', async () => {
    await voir('lycee', PAGE(0, 3), 3);
    dans(lignes()[1], '[data-supprimer]').click();
    await stable();
    http.expectOne(gestion('DELETE')).flush({ error: 'update or delete violates foreign key' }, { status: 500, statusText: 'Server Error' });
    await stable();
    expect(lignes().length).toBe(3);
    expect(notifications()).toEqual([['error', 'Suppression échouée', 'update or delete violates foreign key']]);
    expect(modifs).toBe(0);
  });

  it('purge d’une catégorie : bandeau de React d’abord (aucune requête), puis DELETE `?cat=` ; la sélection de cette catégorie est vidée', async () => {
    await voir('cirfa', [ligne(1, { categorie: 'cirfa' })], 1);
    dans(carte('cirfa'), '[data-purger]').click();
    await stable();
    http.expectNone(() => true);
    expect(texte(el.querySelector('[data-purge] [data-phrase]'))).toBe('Supprimer TOUS les POI de catégorie cirfa ? Cette action est irréversible.');
    expect(texte(el.querySelector('[data-purge] [data-confirmer]'))).toBe('Confirmer');
    el.querySelector<HTMLButtonElement>('[data-purge] [data-confirmer]')!.click();
    await stable();
    const d = http.expectOne(gestion('DELETE'));
    expect(d.request.urlWithParams).toBe('/api/admin/poi-manage?cat=cirfa');
    d.flush({ success: true, deleted: 'bulk', cat: 'cirfa', count: 1 });
    await stable();
    expect(el.querySelector('[data-purge]')).toBeNull();
    expect(el.querySelector('[data-echantillons]')).toBeNull();
    expect(modifs).toBe(1);
  });

  it('purge refusée : notification, bandeau fermé, sélection gardée ; « Annuler » ne fait rien partir', async () => {
    dans(carte('lycee'), '[data-purger]').click();
    await stable();
    el.querySelector<HTMLButtonElement>('[data-purge] [data-annuler]')!.click();
    await stable();
    expect(el.querySelector('[data-purge]')).toBeNull();
    http.expectNone(() => true);
    dans(carte('lycee'), '[data-purger]').click();
    await stable();
    el.querySelector<HTMLButtonElement>('[data-purge] [data-confirmer]')!.click();
    await stable();
    http.expectOne(gestion('DELETE')).flush({ error: 'Suppression des arrêts transport non autorisée ici' }, { status: 400, statusText: 'Bad Request' });
    await stable();
    expect(notifications()).toEqual([['error', 'Suppression échouée', 'Suppression des arrêts transport non autorisée ici']]);
    expect(modifs).toBe(0);
  });

  it('sans statistiques : « Chargement... » / « Aucune donnée. » (textes de React)', async () => {
    f.componentRef.setInput('stats', null);
    f.componentRef.setInput('chargement', true);
    await stable();
    expect(texte(el.querySelector('[data-chargement]'))).toBe('Chargement...');
    f.componentRef.setInput('chargement', false);
    await stable();
    expect(texte(el.querySelector('[data-vide]'))).toBe('Aucune donnée.');
  });
});
