import { formaterNombre } from '../../../../core/format/nombre';
import { TestBed } from '@angular/core/testing';
import { carteDe, lotDe, preparerActivation, prevolDe } from '../../testing/activation-factice';
import { CAMPAGNE_A, CAMPAGNE_B } from '../../testing/plan-factice';
import { MESSAGE_SANS_CAMPAGNE, MESSAGE_SANS_PLAN, PanneauActivationComponent } from './panneau-activation.component';

function rendre() {
  const banc = preparerActivation();
  TestBed.configureTestingModule({ providers: banc.fournisseurs });
  const f = TestBed.createComponent(PanneauActivationComponent);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const rafraichir = () => { TestBed.tick(); f.detectChanges(); };
  return { ...banc, el, rafraichir };
}

describe('PanneauActivationComponent — états', () => {
  it('sans ?campagne= : le renvoi vers ⑥, « Aller à ⑥ Plan » choisit l’étape', () => {
    const { el, plan, parcours, rafraichir } = rendre();
    plan.campagne.set(null); rafraichir();
    expect(MESSAGE_SANS_CAMPAGNE).toBe('Choisissez une campagne dans la barre, ou créez-la à l’étape ⑥.');
    expect(el.querySelector('[data-renvoi-plan]')!.textContent!.trim()).toBe(MESSAGE_SANS_CAMPAGNE);
    const bouton = el.querySelector<HTMLButtonElement>('[data-aller-plan]')!;
    expect(bouton.textContent!.trim()).toBe('Aller à ⑥ Plan');
    bouton.click();
    expect(parcours.choisir).toHaveBeenCalledWith('plan');
  });

  it('campagne retirée (autre espace) : le message du plan, puis le renvoi', () => {
    const { el, plan, rafraichir } = rendre();
    plan.campagne.set(null); plan.erreur.set('Campagne introuvable dans cet espace.'); rafraichir();
    expect(el.querySelector('[data-erreur-activation]')!.textContent!.trim()).toBe('Campagne introuvable dans cet espace.');
    expect(el.querySelector('[data-renvoi-plan]')).not.toBeNull();
  });

  it('accès refusé : le message de PlanCampagneService, rien d’autre', () => {
    const { el, plan, rafraichir } = rendre();
    plan.accesRefuse.set(true); plan.erreur.set('Réservé.'); rafraichir();
    expect(el.querySelector('[data-erreur-activation]')!.textContent!.trim()).toBe('Réservé.');
    expect(el.querySelector('[data-prevol]')).toBeNull();
    expect(el.querySelector('[data-renvoi-plan]')).toBeNull();
  });

  it('campagne sans plan : « Cette campagne n’a pas encore de plan : lancez-la à l’étape ⑥. »', () => {
    const { el, activation, rafraichir } = rendre();
    activation.prevol.set(prevolDe({ strategie: null })); rafraichir();
    expect(el.querySelector('[data-renvoi-plan]')!.textContent!.trim()).toBe(MESSAGE_SANS_PLAN);
    expect(MESSAGE_SANS_PLAN).toBe('Cette campagne n’a pas encore de plan : lancez-la à l’étape ⑥.');
  });

  it('pré-vol en cours tant qu’il n’est pas lu', () => {
    const { el, activation, rafraichir } = rendre();
    activation.prevol.set(null); rafraichir();
    expect(el.querySelector('[data-chargement-activation]')!.textContent!.trim()).toBe('Pré-vol en cours…');
  });

  it('erreur de lecture affichée telle quelle', () => {
    const { el, activation, rafraichir } = rendre();
    activation.erreur.set('Campagne introuvable.'); rafraichir();
    expect(el.querySelector('[data-erreur-activation]')!.textContent!.trim()).toBe('Campagne introuvable.');
  });
});

describe('PanneauActivationComponent — contenu', () => {
  it('le pré-vol de React sans la ligne « Stratégie », une carte par plateforme, la poussée dans la carte DV360 au CP seule', () => {
    const { el, activation, rafraichir } = rendre();
    activation.cartes.set([carteDe(), carteDe({ canal: 'meta', plateforme: 'meta', libelle: 'Meta', maille: 'cercle', mode: 'fichier' })]);
    rafraichir();
    const lignes = [...el.querySelectorAll('[data-prevol] > div')].map((d) => d.textContent!.trim());
    expect(lignes).toEqual(['Version publiée : v1', `Codes postaux : ${formaterNombre(1200)}`, 'Canaux connectés : dv360']);
    expect(el.textContent).not.toMatch(/stratégie/i);
    expect([...el.querySelectorAll('[data-carte-plateforme]')].map((c) => c.getAttribute('data-carte-plateforme'))).toEqual(['dv360', 'meta']);
    expect(el.querySelectorAll('mg-poussee-dv360')).toHaveLength(1);
    expect(el.querySelector('[data-carte-plateforme="dv360"] mg-poussee-dv360')).not.toBeNull();
  });

  it('T5 — le bandeau en tête ; chaque carte offre ses fichiers, DV360 au CP en repli de la poussée ; avertissements A-13', () => {
    const { el, activation, rafraichir } = rendre();
    activation.cartes.set([
      carteDe(),
      carteDe({ canal: 'ttd', plateforme: 'ttd', libelle: 'The Trade Desk', maille: 'polygone', mode: 'fichier', formats: ['polygone'], aVerifier: true }),
      carteDe({
        canal: 'meta', plateforme: 'meta', libelle: 'Meta', maille: 'cercle', mode: 'fichier', formats: ['cercles'],
        avertissements: ['Publicité politique interdite chez Meta dans l’Union européenne.', 'Catégorie sensible (emploi, logement, crédit) : pas de code postal, rayon ≥ 15 km.'],
      }),
      carteDe({ canal: 'tiktok', plateforme: 'tiktok', libelle: 'TikTok', maille: 'departement', mode: 'fichier', formats: ['territoires'] }),
    ]);
    rafraichir();
    expect(el.querySelector('mg-bandeau-activation')).not.toBeNull();
    const boutons = (canal: string) => [...el.querySelectorAll(`[data-carte-plateforme="${canal}"] mg-fichiers-extraction button`)].map((b) => b.textContent!.trim());
    expect(boutons('dv360')).toEqual(['Codes postaux', 'SDF DV360']);
    expect(el.querySelector('[data-carte-plateforme="dv360"] mg-poussee-dv360')).not.toBeNull();
    expect(boutons('ttd')).toEqual(['Polygone (GeoJSON)']);
    expect(el.querySelector('[data-carte-plateforme="ttd"] [data-a-verifier]')!.textContent!.trim()).toBe('à vérifier');
    expect(boutons('meta')).toEqual(['Cercles (CSV)']);
    expect(el.querySelector('[data-carte-plateforme="meta"] [data-avertissements]')!.textContent).toContain('Catégorie sensible');
    expect(boutons('tiktok')).toEqual(['Départements (CSV)']);
    expect(el.querySelector('a[href]')).toBeNull();
  });

  it('T5 — aucun fichier sans extraction (plan d’avant le lot 7) ni sans format (Meta d’un jeu risque, ruling 4)', () => {
    const { el, activation, rafraichir } = rendre();
    activation.cartes.set([carteDe({ canal: 'meta', plateforme: 'meta', libelle: 'Meta', maille: 'cp', mode: 'fichier', formats: [], motifs: ['x'] })]);
    rafraichir();
    expect(el.querySelector('mg-fichiers-extraction')).toBeNull();
    activation.cartes.set([carteDe()]);
    activation.prevol.set(prevolDe({ extraction: null })); rafraichir();
    expect(el.querySelector('mg-fichiers-extraction')).toBeNull();
  });

  it('jamais publiée, aucun canal : « jamais publiée », « aucun »', () => {
    const { el, activation, rafraichir } = rendre();
    activation.prevol.set(prevolDe({ version_publiee: null, canaux_connectes: [] })); rafraichir();
    const t = el.querySelector('[data-prevol]')!.textContent!;
    expect(t).toContain('Version publiée : jamais publiée');
    expect(t).toContain('Canaux connectés : aucun');
  });

  it('l’historique est monté avec ses lots ; le flux seulement quand il y en a un', () => {
    const { el, activation, plan, rafraichir } = rendre();
    activation.lots.set([lotDe()]); rafraichir();
    expect(el.querySelector('[data-lot="l1"]')).not.toBeNull();
    expect(el.querySelector('[data-flux-poussee] mg-entete-section')).toBeNull();
    activation.flux.set([{ etape: 'debut', total: 1 }]);
    activation.pousseeEnCours.set({ campagne: CAMPAGNE_A }); rafraichir();
    expect(el.querySelector('[data-flux-poussee]')!.textContent).toContain('Poussée en cours');
    plan.campagne.set(CAMPAGNE_B); rafraichir();
    expect(el.querySelector('[data-flux-poussee]')!.textContent).toContain('Poussée terminée');
  });
});
