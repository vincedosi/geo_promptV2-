import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { DescriptionNonEnregistree, EspacesApi } from './espaces.api';

describe('EspacesApi', () => {
  let api: EspacesApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), EspacesApi,
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    api = TestBed.inject(EspacesApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Une lecture : GET, sans corps, la réponse rendue telle quelle. */
  function lecture(appel: () => { subscribe: (f: (v: unknown) => void) => unknown }, url: string) {
    const corps = { marque: url };
    let lu: unknown;
    appel().subscribe((v) => (lu = v));
    const req = http.expectOne(url);
    expect(req.request.method).toBe('GET');
    expect(req.request.body).toBeNull();
    req.flush(corps);
    expect(lu).toEqual(corps);
  }

  it('lister : GET /api/admin/espaces', () => lecture(() => api.lister(), '/api/admin/espaces'));
  it('lireComptes : GET /api/admin/espaces/comptes', () => lecture(() => api.lireComptes(), '/api/admin/espaces/comptes'));
  it('lireSocle : GET /api/admin/espaces/socle', () => lecture(() => api.lireSocle(), '/api/admin/espaces/socle'));
  it('lireDonnees : GET /api/admin/espaces/:id/donnees', () =>
    lecture(() => api.lireDonnees('org-1'), '/api/admin/espaces/org-1/donnees'));
  it('lireMembres : GET /api/admin/espaces/:id/membres', () =>
    lecture(() => api.lireMembres('org-1'), '/api/admin/espaces/org-1/membres'));
  it('lireApercu : GET /api/admin/espaces/:id/apercu', () =>
    lecture(() => api.lireApercu('org-1'), '/api/admin/espaces/org-1/apercu'));
  it('lireEspace : GET /api/admin/organizations/:id', () =>
    lecture(() => api.lireEspace('org-1'), '/api/admin/organizations/org-1'));
  it('listerComptes : GET /api/admin/users', () => lecture(() => api.listerComptes(), '/api/admin/users'));

  it('creerEspace avec description : POST puis PATCH, dans cet ordre', () => {
    let fini = false;
    api.creerEspace('Nouvel espace', 'Texte').subscribe(() => (fini = true));
    const post = http.expectOne('/api/admin/organizations');
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({ name: 'Nouvel espace' });
    post.flush({ success: true, organization: { id: 'org-9' } });
    const patch = http.expectOne('/api/admin/organizations/org-9');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ description: 'Texte' });
    patch.flush({ success: true, organization: { id: 'org-9' } });
    expect(fini).toBe(true);
  });

  it('creerEspace sans description : un seul POST, la réponse du POST rendue', () => {
    let lu: unknown;
    api.creerEspace('Nouvel espace', null).subscribe((v) => (lu = v));
    const post = http.expectOne('/api/admin/organizations');
    expect(post.request.body).toEqual({ name: 'Nouvel espace' });
    post.flush({ success: true, organization: { id: 'org-9' } });
    expect(lu).toEqual({ success: true, organization: { id: 'org-9' } });
  });

  it('creerEspace : un PATCH en échec fait remonter l\'erreur (l\'espace existe quand même)', () => {
    let erreur: unknown = null;
    api.creerEspace('Nouvel espace', 'Texte').subscribe({ error: (e: unknown) => (erreur = e) });
    http.expectOne('/api/admin/organizations').flush({ success: true, organization: { id: 'org-9' } });
    http.expectOne('/api/admin/organizations/org-9').flush({ error: 'boum' }, { status: 500, statusText: 'Server Error' });
    expect(erreur).toBeInstanceOf(DescriptionNonEnregistree);
    expect((erreur as DescriptionNonEnregistree).id).toBe('org-9');
  });

  it('creerEspace : un POST en échec (409) fait remonter l\'erreur HTTP telle quelle, sans PATCH', () => {
    let erreur: unknown = null;
    api.creerEspace('Nouvel espace', 'Texte').subscribe({ error: (e: unknown) => (erreur = e) });
    http.expectOne('/api/admin/organizations').flush({ error: 'existe' }, { status: 409, statusText: 'Conflict' });
    expect(erreur).toBeInstanceOf(HttpErrorResponse);
    expect((erreur as HttpErrorResponse).status).toBe(409);
  });

  it('modifierEspace : PATCH au corps EXACT', () => {
    api.modifierEspace('org-1', { active: false }).subscribe();
    const req = http.expectOne('/api/admin/organizations/org-1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ active: false });
    req.flush({ success: true });
  });

  it('supprimerEspace : DELETE /api/admin/organizations/:id, sans corps', () => {
    api.supprimerEspace('org-1').subscribe();
    const req = http.expectOne('/api/admin/organizations/org-1');
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toBeNull();
    req.flush({ success: true });
  });

  it('ajouterMembre : POST …/members au corps EXACT { email } — sans rôle (E3)', () => {
    api.ajouterMembre('org-1', 'nom@exemple.fr').subscribe();
    const req = http.expectOne('/api/admin/organizations/org-1/members');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'nom@exemple.fr' });
    req.flush({ success: true });
  });

  it('retirerMembre : DELETE avec corps { userId }', () => {
    api.retirerMembre('org-1', 'u-1').subscribe();
    const req = http.expectOne('/api/admin/organizations/org-1/members');
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toEqual({ userId: 'u-1' });
    req.flush({ success: true });
  });

  it('lienMotDePasse : POST …/members/reset-password au corps EXACT { email }', () => {
    let lu: unknown;
    api.lienMotDePasse('org-1', 'nom@exemple.fr').subscribe((v) => (lu = v));
    const req = http.expectOne('/api/admin/organizations/org-1/members/reset-password');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'nom@exemple.fr' });
    req.flush({ link: 'https://lien' });
    expect(lu).toEqual({ link: 'https://lien' });
  });

  it('partager : POST …/sources/assign au corps EXACT { sourceId }', () => {
    api.partager('org-1', 's-1').subscribe();
    const req = http.expectOne('/api/admin/organizations/org-1/sources/assign');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ sourceId: 's-1' });
    req.flush({ success: true });
  });

  it('retirerPartage : DELETE …/sources/assign au corps EXACT { sourceId }', () => {
    api.retirerPartage('org-1', 's-1').subscribe();
    const req = http.expectOne('/api/admin/organizations/org-1/sources/assign');
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toEqual({ sourceId: 's-1' });
    req.flush({ success: true });
  });

  it('modifierJeu : PATCH admin/sources/:id au corps EXACT', () => {
    api.modifierJeu('s-1', { visibilite: 'socle' }).subscribe();
    const req = http.expectOne('/api/admin/sources/s-1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ visibilite: 'socle' });
    req.flush({ success: true });
  });

  it('creerCompte : POST /api/admin/users au corps EXACT', () => {
    const c = { email: 'nom@exemple.fr', full_name: null, role: 'client' as const, organization_id: 'org-1' };
    let lu: unknown;
    api.creerCompte(c).subscribe((v) => (lu = v));
    const req = http.expectOne('/api/admin/users');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(c);
    req.flush({ id: 'u-1', email: 'nom@exemple.fr', setup_link: null }, { status: 201, statusText: 'Created' });
    expect(lu).toEqual({ id: 'u-1', email: 'nom@exemple.fr', setup_link: null });
  });

  it('modifierCompte : PATCH /api/admin/users/:id au corps EXACT', () => {
    api.modifierCompte('u-1', { role: 'super_admin' }).subscribe();
    const req = http.expectOne('/api/admin/users/u-1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ role: 'super_admin' });
    req.flush({ success: true });
  });

  it('remplacerEspaces : PUT au corps EXACT', () => {
    api.remplacerEspaces('u-1', ['a', 'b'], 'b').subscribe();
    const req = http.expectOne('/api/admin/users/u-1/espaces');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ espaces: ['a', 'b'], espace_actif: 'b' });
    req.flush({ espaces: ['a', 'b'], espace_actif: 'b' });
  });

  it('lienMotDePasseCompte : POST /api/admin/users/:id/lien-mot-de-passe, identifiant encodé', () => {
    let lu: unknown;
    api.lienMotDePasseCompte('u 1').subscribe((v) => (lu = v));
    const req = http.expectOne('/api/admin/users/u%201/lien-mot-de-passe');
    expect(req.request.method).toBe('POST');
    req.flush({ lien: 'https://lien' });
    expect(lu).toEqual({ lien: 'https://lien' });
  });

  it('supprimerCompte : DELETE /api/admin/users/:id, sans corps', () => {
    api.supprimerCompte('u-1').subscribe();
    const req = http.expectOne('/api/admin/users/u-1');
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toBeNull();
    req.flush({ success: true });
  });

  it('un identifiant est encodé dans le chemin', () => {
    api.lireDonnees('a/b').subscribe();
    http.expectOne('/api/admin/espaces/a%2Fb/donnees').flush({});
  });
});
