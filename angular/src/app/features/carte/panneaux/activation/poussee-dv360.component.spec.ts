import { TestBed } from '@angular/core/testing';
import { preparerActivation, prevolDe } from '../../testing/activation-factice';
import { CAMPAGNE_A, CAMPAGNE_B } from '../../testing/plan-factice';
import { AVERTISSEMENT_ADDITIF, PousseeDv360Component } from './poussee-dv360.component';

function rendre() {
  const banc = preparerActivation();
  TestBed.configureTestingModule({ providers: banc.fournisseurs });
  const f = TestBed.createComponent(PousseeDv360Component);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const rafraichir = () => { TestBed.tick(); f.detectChanges(); };
  const saisir = (sel: string, v: string) => {
    const champ = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(sel)!;
    champ.value = v;
    champ.dispatchEvent(new Event('input'));
    rafraichir();
  };
  const bouton = () => el.querySelector<HTMLButtonElement>('[data-pousser]')!;
  return { ...banc, el, rafraichir, saisir, bouton };
}

describe('PousseeDv360Component', () => {
  it('activable : « Prêt à activer », annonceur PRÉREMPLI de la liaison de ⑥, line items à saisir', () => {
    const { el, bouton } = rendre();
    expect(el.querySelector('[data-pret]')!.textContent!.trim()).toBe('Prêt à activer — v1 sur 63 codes postaux bruts.');
    expect(el.querySelector<HTMLInputElement>('[data-annonceur]')!.value).toBe('4242');
    expect(el.querySelector<HTMLInputElement>('[data-annonceur]')!.placeholder).toBe('Identifiant annonceur DV360');
    expect(el.querySelector<HTMLTextAreaElement>('[data-line-items]')!.placeholder)
      .toBe('Identifiants de line items, séparés par des virgules ou des retours à la ligne');
    expect(bouton().textContent!.trim()).toBe('Pousser le ciblage vers DV360');
    expect(bouton().disabled).toBe(true);
  });

  it('avertissement additif de React, mot pour mot', () => {
    const { el } = rendre();
    expect(el.querySelector('[data-additif]')!.textContent!.trim()).toBe(AVERTISSEMENT_ADDITIF);
    expect(AVERTISSEMENT_ADDITIF).toBe('La poussée ajoute le ciblage aux line items ; elle n’efface rien de ce qui s’y trouve déjà, et ne peut pas être défaite depuis dentsu.explore.');
  });

  it('pousser : l’annonceur et la saisie partent au service', () => {
    const { activation, saisir, bouton } = rendre();
    saisir('[data-line-items]', '11, 12');
    expect(bouton().disabled).toBe(false);
    bouton().click();
    expect(activation.pousser).toHaveBeenCalledWith('4242', '11, 12');
  });

  it('annonceur vidé : bouton désactivé', () => {
    const { saisir, bouton } = rendre();
    saisir('[data-line-items]', '11');
    saisir('[data-annonceur]', '  ');
    expect(bouton().disabled).toBe(true);
  });

  it('simulé : « Simuler la poussée vers DV360 » et « Mode démo : rien ne part chez Google. »', () => {
    const { el, activation, rafraichir, bouton } = rendre();
    activation.prevol.set(prevolDe({ mode_dv360: 'simule' })); rafraichir();
    expect(bouton().textContent!.trim()).toBe('Simuler la poussée vers DV360');
    expect(el.querySelector('[data-mode-demo]')!.textContent!.trim()).toBe('Mode démo : rien ne part chez Google.');
  });

  it('poussée en cours ici : « Poussée en cours… » ; ailleurs : désactivé et dit (A-10)', () => {
    const { el, activation, plan, rafraichir, saisir, bouton } = rendre();
    saisir('[data-line-items]', '11');
    activation.pousseeEnCours.set({ campagne: CAMPAGNE_A }); rafraichir();
    expect(bouton().textContent!.trim()).toBe('Poussée en cours…');
    expect(bouton().disabled).toBe(true);
    expect(el.querySelector('[data-poussee-ailleurs]')).toBeNull();
    plan.campagne.set(CAMPAGNE_B); rafraichir();
    expect(el.querySelector('[data-poussee-ailleurs]')!.textContent!.trim()).toBe('Une poussée est en cours sur une autre campagne.');
    expect(bouton().disabled).toBe(true);
  });

  it('Review Focus 4 — jamais publié : « Publier le plan » à côté du motif, pas de saisie', () => {
    const { el, activation, rafraichir } = rendre();
    activation.prevol.set(prevolDe({ version_publiee: null, activable: false, motifs: [{ code: 'jamais_publiee', message: 'm' }] }));
    rafraichir();
    const publier = el.querySelector<HTMLButtonElement>('[data-publier]')!;
    expect(publier.textContent!.trim()).toBe('Publier le plan');
    expect(el.querySelector('[data-annonceur]')).toBeNull();
    publier.click();
    expect(activation.publier).toHaveBeenCalled();
  });

  it('dérivé : « Republier (v1 → v2) » ; publication en cours : « Publication… », désactivé', () => {
    const { el, activation, rafraichir } = rendre();
    activation.prevol.set(prevolDe({ activable: false, motifs: [{ code: 'derive', message: 'm', version: 1 }] }));
    rafraichir();
    expect(el.querySelector('[data-publier]')!.textContent!.trim()).toBe('Republier (v1 → v2)');
    activation.publication.set(true); rafraichir();
    expect(el.querySelector('[data-publier]')!.textContent!.trim()).toBe('Publication…');
    expect(el.querySelector<HTMLButtonElement>('[data-publier]')!.disabled).toBe(true);
  });

  it('aucun motif de publication (connexion absente) : pas de bouton Publier', () => {
    const { el, activation, rafraichir } = rendre();
    activation.prevol.set(prevolDe({ activable: false, mode_dv360: 'indisponible', motifs: [{ code: 'aucune_connexion', message: 'm' }] }));
    rafraichir();
    expect(el.querySelector('[data-publier]')).toBeNull();
    expect(el.querySelector('[data-pousser]')).toBeNull();
  });
});
