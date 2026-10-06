import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { AuthService } from '../core/auth/auth.service';
import { STRATEGIE_AUTONOME, STRATEGIE_SANS_SESSION } from '../core/auth/strategie-sans-session';
import { OrganisationsApi, type ReponseOrganisations } from '../features/session/data/organisations.api';
import { BadgeSessionComponent } from './badge-session.component';

const ORGS = [
  { id: 'o1', name: 'dentsu', slug: 'dentsu', logo_url: null },
  { id: 'o2', name: 'Carat', slug: 'carat', logo_url: null },
];

function authFactice(roleProfil: string | null, metaRole?: string, email = 'vincent.exemple@magelian.test') {
  const session = signal<unknown>({ access_token: 'j', user: { email, user_metadata: metaRole ? { role: metaRole } : {} } });
  return {
    session,
    connecte: computed(() => session() !== null),
    email: computed(() => email),
    lireRole: vi.fn(async (): Promise<string | null> => roleProfil),
    deconnecter: vi.fn(async () => session.set(null)),
    oublierProfil: vi.fn(),
  };
}

interface Options {
  liste?: ReponseOrganisations | Error;
  changer?: () => ReturnType<OrganisationsApi['changer']>;
  strategieAutonome?: boolean;
  roleProfil?: string | null;
  metaRole?: string;
}

async function rendre(o: Options = {}) {
  const auth = authFactice(o.roleProfil === undefined ? 'super_admin' : o.roleProfil, o.metaRole);
  const liste = o.liste ?? { organizations: ORGS, active_org_id: 'o1', is_super_admin: true };
  const api = {
    lister: vi.fn(() => (liste instanceof Error ? throwError(() => liste) : of(liste))),
    changer: vi.fn(o.changer ?? (() => of({ success: true, organization_id: 'o2' }))),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'connexion', children: [] }]),
      { provide: AuthService, useValue: auth },
      { provide: OrganisationsApi, useValue: api },
      ...(o.strategieAutonome ? [{ provide: STRATEGIE_SANS_SESSION, useValue: STRATEGIE_AUTONOME }] : []),
    ],
  });
  const f = TestBed.createComponent(BadgeSessionComponent);
  document.body.appendChild(f.nativeElement);
  const changements: unknown[] = [];
  f.componentInstance.orgChangee.subscribe((v) => changements.push(v));
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const stable = async () => {
    await new Promise((r) => setTimeout(r, 0));
    await f.whenStable();
  };
  return { f, el, api, auth, changements, stable };
}

const texte = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
/** Texte d'un déclencheur, élément par élément (pastille, nom, ▼), séparés d'une espace. */
const morceaux = (b: Element) => [...b.children].map((c) => texte(c)).filter(Boolean).join(' ');
const declencheurOrg = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('[data-declencheur="org"]')!;
const declencheurUtilisateur = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('[data-declencheur="utilisateur"]')!;
const touche = (key: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

describe('BadgeSessionComponent — SessionBadge.tsx porté', () => {
  afterEach(() => document.body.replaceChildren());

  it('affiche l\'organisation active (initiale + nom) après GET /api/user/organizations', async () => {
    const { el, api } = await rendre();
    expect(api.lister).toHaveBeenCalledTimes(1);
    expect(morceaux(declencheurOrg(el))).toBe('D dentsu ▼');
  });

  it('super_admin sur « toutes » : « Toutes » ; organisation active inconnue : « ... »', async () => {
    let r = await rendre({ liste: { organizations: ORGS, active_org_id: null, is_super_admin: true } });
    expect(texte(declencheurOrg(r.el))).toContain('Toutes');
    TestBed.resetTestingModule();
    document.body.replaceChildren();
    r = await rendre({ liste: { organizations: ORGS, active_org_id: 'inconnue', is_super_admin: false } });
    expect(texte(declencheurOrg(r.el))).toContain('...');
  });

  it('une seule organisation et pas super_admin : pas de liste (pas de ▼, clic sans effet)', async () => {
    const { el, stable } = await rendre({ liste: { organizations: [ORGS[0]], active_org_id: 'o1', is_super_admin: false } });
    expect(morceaux(declencheurOrg(el))).toBe('D dentsu');
    declencheurOrg(el).click();
    await stable();
    expect(el.querySelector('[data-menu="org"]')).toBeNull();
  });

  it('la liste échoue : « Organisation », sans liste — comme React, qui se tait', async () => {
    const { el } = await rendre({ liste: new Error('réseau') });
    expect(morceaux(declencheurOrg(el))).toBe('● Organisation');
  });

  it('ouvre la liste : « Toutes les organisations » (super_admin) puis chaque organisation, l\'active marquée', async () => {
    const { el, stable } = await rendre();
    declencheurOrg(el).click();
    await stable();
    const menu = el.querySelector('[data-menu="org"]')!;
    const options = [...menu.querySelectorAll('button')];
    expect(options.map((b) => texte(b))).toEqual(['Toutes les organisations', 'dentsu', 'Carat']);
    expect(options[1].getAttribute('aria-current')).toBe('true');
    expect(declencheurOrg(el).getAttribute('aria-expanded')).toBe('true');
    // Le focus entre dans le menu.
    expect(document.activeElement).toBe(options[0]);
  });

  it('changer d\'organisation : POST, fermeture, relecture de la liste, et `orgChangee` pour rafraîchir la page', async () => {
    const { el, api, auth, changements, stable } = await rendre();
    declencheurOrg(el).click();
    await stable();
    const carat = [...el.querySelectorAll('[data-menu="org"] button')].find((b) => texte(b) === 'Carat') as HTMLButtonElement;
    carat.click();
    await stable();
    expect(api.changer).toHaveBeenCalledWith('o2');
    expect(el.querySelector('[data-menu="org"]')).toBeNull();
    expect(api.lister).toHaveBeenCalledTimes(2);
    expect(changements).toEqual(['o2']);
    // Le profil mémorisé portait l'ANCIENNE organisation active : il est oublié (React recharge la page).
    expect(auth.oublierProfil).toHaveBeenCalledTimes(1);
  });

  it('« Toutes les organisations » envoie `null`', async () => {
    const { el, api, stable } = await rendre();
    declencheurOrg(el).click();
    await stable();
    (el.querySelector('[data-menu="org"] button') as HTMLButtonElement).click();
    await stable();
    expect(api.changer).toHaveBeenCalledWith(null);
  });

  it('pendant le changement, les options sont désactivées', async () => {
    const enCours = new Subject<{ success: boolean; organization_id: string | null }>();
    const { el, stable } = await rendre({ changer: () => enCours });
    declencheurOrg(el).click();
    await stable();
    (el.querySelectorAll('[data-menu="org"] button')[2] as HTMLButtonElement).click();
    await stable();
    expect([...el.querySelectorAll('[data-menu="org"] button')].every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    enCours.next({ success: true, organization_id: 'o2' });
    enCours.complete();
  });

  it('échec du changement : message français dans la liste, qui reste ouverte, rien n\'est rafraîchi', async () => {
    const { el, changements, stable } = await rendre({
      changer: () => throwError(() => new HttpErrorResponse({ status: 403, error: {} })),
    });
    declencheurOrg(el).click();
    await stable();
    (el.querySelectorAll('[data-menu="org"] button')[2] as HTMLButtonElement).click();
    await stable();
    expect(texte(el.querySelector('[data-menu="org"] [role="alert"]'))).toBe('Votre rôle ne permet pas cette action.');
    expect(el.querySelector('[data-menu="org"]')).not.toBeNull();
    expect(changements).toEqual([]);
  });

  it('menu utilisateur : e-mail (tronqué au-delà de 25), puis e-mail complet et rôle dans le menu', async () => {
    const { el, stable } = await rendre();
    // 29 caractères > 25 : les 22 premiers, puis « … » (SessionBadge.tsx:92).
    expect(morceaux(declencheurUtilisateur(el))).toBe('vincent.exemple@mageli… ▼');
    declencheurUtilisateur(el).click();
    await stable();
    const menu = el.querySelector('[data-menu="utilisateur"]')!;
    expect(texte(menu)).toContain('vincent.exemple@magelian.test');
    expect(texte(menu.querySelector('[data-role]'))).toBe('super_admin');
    expect(document.activeElement?.textContent?.trim()).toBe('Deconnexion');
  });

  it('Échap ferme le menu et rend le focus au déclencheur', async () => {
    const { el, stable } = await rendre();
    declencheurUtilisateur(el).click();
    await stable();
    touche('Escape');
    await stable();
    expect(el.querySelector('[data-menu="utilisateur"]')).toBeNull();
    expect(document.activeElement).toBe(declencheurUtilisateur(el));
    expect(declencheurUtilisateur(el).getAttribute('aria-expanded')).toBe('false');
  });

  it('un appui hors du menu le ferme ; un appui dedans, non', async () => {
    const { el, stable } = await rendre();
    declencheurUtilisateur(el).click();
    await stable();
    el.querySelector('[data-menu="utilisateur"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    await stable();
    expect(el.querySelector('[data-menu="utilisateur"]')).not.toBeNull();
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await stable();
    expect(el.querySelector('[data-menu="utilisateur"]')).toBeNull();
  });

  it('ouvrir un menu ferme l\'autre', async () => {
    const { el, stable } = await rendre();
    declencheurOrg(el).click();
    await stable();
    declencheurUtilisateur(el).click();
    await stable();
    expect(el.querySelector('[data-menu="org"]')).toBeNull();
    expect(el.querySelector('[data-menu="utilisateur"]')).not.toBeNull();
  });

  it('« Deconnexion » en autonome : fin de session puis la page de connexion, sans page à reprendre', async () => {
    const { el, auth, stable } = await rendre({ strategieAutonome: true });
    declencheurUtilisateur(el).click();
    await stable();
    (el.querySelector('[data-menu="utilisateur"] button') as HTMLButtonElement).click();
    await stable();
    expect(auth.deconnecter).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(Router).url).toBe('/connexion');
  });

  it('« Deconnexion » dans un hôte : fin de session, AUCUNE navigation', async () => {
    const { el, auth, stable } = await rendre();
    const router = TestBed.inject(Router);
    const avant = router.url;
    declencheurUtilisateur(el).click();
    await stable();
    (el.querySelector('[data-menu="utilisateur"] button') as HTMLButtonElement).click();
    await stable();
    expect(auth.deconnecter).toHaveBeenCalledTimes(1);
    expect(router.url).toBe(avant);
  });

  it('rôle : celui du profil, sinon celui du jeton, sinon « user » (comme useSession)', async () => {
    const lire = async (o: Options) => {
      const r = await rendre(o);
      declencheurUtilisateur(r.el).click();
      await r.stable();
      const role = texte(r.el.querySelector('[data-role]'));
      TestBed.resetTestingModule();
      document.body.replaceChildren();
      return role;
    };
    expect(await lire({ roleProfil: 'admin', metaRole: 'client' })).toBe('admin');
    expect(await lire({ roleProfil: null, metaRole: 'client' })).toBe('client');
    expect(await lire({ roleProfil: null })).toBe('user');
  });
});
