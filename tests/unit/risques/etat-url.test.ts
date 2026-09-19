/**
 * L'état unique du module, et son aller-retour avec l'URL.
 *
 * ── POURQUOI L'URL EST LE SUPPORT ─────────────────────────────────────────
 *
 * Le module portait vingt `useState` indépendants et n'écrivait RIEN dans
 * l'adresse de la page (vérifié le 2026-09-19 : l'unique `URLSearchParams` de
 * `AnalysePopulationOverlay.tsx` construisait un appel API, pas une URL).
 * Conséquences concrètes : un média planner ne pouvait pas envoyer sa vue à un
 * collègue, un rechargement perdait vingt minutes de réglages, et le bouton
 * « retour » du navigateur quittait le module au lieu de défaire un filtre.
 *
 * ── DEUX RÈGLES QUE CES TESTS VERROUILLENT ────────────────────────────────
 *
 * **Les valeurs par défaut ne s'écrivent pas.** Sinon l'URL d'un écran qu'on
 * vient d'ouvrir porte douze paramètres, et plus personne ne distingue ce que
 * l'utilisateur a choisi de ce qu'il a subi.
 *
 * **La lecture ne lève jamais.** Une URL arrive de l'extérieur — d'un lien
 * collé, tronqué par un client de messagerie, ou écrit à la main. Une exception
 * ici afficherait un écran blanc là où retomber sur le défaut affiche
 * l'application.
 */
import { describe, it, expect } from 'vitest';
import {
  ETAT_DEFAUT,
  lireEtatUrl,
  ecrireEtatUrl,
  type EtatRisque,
} from '@/lib/risques/etat-url';
import { normaliserProfil } from '@/lib/risques/profil';

/** Fait l'aller-retour complet, comme le ferait la barre d'adresse. */
const allerRetour = (e: EtatRisque): EtatRisque =>
  lireEtatUrl(new URLSearchParams(ecrireEtatUrl(e)));

describe('ecrireEtatUrl', () => {
  it('n ecrit rien pour l etat par defaut', () => {
    expect(ecrireEtatUrl(ETAT_DEFAUT)).toBe('');
  });

  it('n ecrit que ce qui differe du defaut', () => {
    const p = new URLSearchParams(ecrireEtatUrl({ ...ETAT_DEFAUT, cible: 'pop_65_plus' }));
    expect([...p.keys()]).toEqual(['cible']);
  });

  it('ecrit le chemin de fil d Ariane comme une liste', () => {
    const p = new URLSearchParams(ecrireEtatUrl({ ...ETAT_DEFAUT, chemin: ['93', '13'] }));
    expect(p.get('chemin')).toBe('93.13');
  });

  it('ecrit le profil sous sa forme codee', () => {
    const profil = normaliserProfil({ ...ETAT_DEFAUT.profil, haut: [500, 1000] });
    const p = new URLSearchParams(ecrireEtatUrl({ ...ETAT_DEFAUT, profil }));
    expect(p.get('profil')).toBe('h500.1000_b500.1000_a_L0_P1');
  });
});

describe('lireEtatUrl', () => {
  it('rend le defaut sur une URL vide', () => {
    expect(lireEtatUrl(new URLSearchParams())).toEqual(ETAT_DEFAUT);
  });

  it('fait l aller-retour sur un etat complet', () => {
    const etat: EtatRisque = {
      cible: 'pop_65_plus',
      maille: 'commune',
      chemin: ['93', '13'],
      natures: ['Explosibles', 'Déchets'],
      modes: ['pprt'],
      gravites: ['seveso_haut'],
      profil: normaliserProfil({
        haut: [500, 1000, 2000], bas: [300], autres: [], lie: false, inclurePPRT: false,
      }),
      onglet: 'diffusion',
      campagne: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
    };
    expect(allerRetour(etat)).toEqual(etat);
  });

  it('fait l aller-retour sur une nature contenant un point', () => {
    // Le séparateur de liste est le point. Une nature qui en contient — et il
    // en existe — le casserait si l'encodage ne le protégeait pas.
    const etat = { ...ETAT_DEFAUT, natures: ['Chimie (IED)', 'Inflammables (ancienne nomenclature)'] };
    expect(allerRetour(etat).natures).toEqual(etat.natures);
  });

  it('ignore une maille inconnue plutot que de la propager', () => {
    // `?maille=canton` viendrait d'un lien bricolé. Le propager ferait répondre
    // la route en 400 et l'écran afficherait une erreur au lieu d'une carte.
    const e = lireEtatUrl(new URLSearchParams('maille=canton'));
    expect(e.maille).toBe(ETAT_DEFAUT.maille);
  });

  it('ignore un onglet inconnu', () => {
    expect(lireEtatUrl(new URLSearchParams('onglet=inexistant')).onglet).toBe(ETAT_DEFAUT.onglet);
  });

  it('ignore un profil illisible et retombe sur le defaut', () => {
    expect(lireEtatUrl(new URLSearchParams('profil=casse')).profil).toEqual(ETAT_DEFAUT.profil);
  });

  it('ignore un mode inconnu mais garde les modes valides', () => {
    expect(lireEtatUrl(new URLSearchParams('modes=pprt.xxx')).modes).toEqual(['pprt']);
  });

  it('retombe sur tous les modes quand aucun n est reconnu', () => {
    // Zéro mode signifierait « aucun site », donc un écran vide sans message.
    // Le comportement par défaut est plus honnête qu'un résultat nul.
    expect(lireEtatUrl(new URLSearchParams('modes=xxx.yyy')).modes).toEqual(ETAT_DEFAUT.modes);
  });

  it('retombe sur toutes les gravites quand aucune n est reconnue', () => {
    expect(lireEtatUrl(new URLSearchParams('gravites=zzz')).gravites).toEqual(ETAT_DEFAUT.gravites);
  });

  it('refuse un NIVEAU de profil la ou une GRAVITE est attendue', () => {
    // Les deux vocabulaires coexistent et se ressemblent. Passer 'haut' au lieu
    // de 'seveso_haut' ne leve pas cote base : le filtre ne trouve aucun site
    // et l'ecran affiche zero habitant expose — un resultat plausible, donc
    // invisible. Le filtrage ici est ce qui transforme ce piege en retour au
    // comportement par defaut.
    expect(lireEtatUrl(new URLSearchParams('gravites=haut.bas')).gravites)
      .toEqual(ETAT_DEFAUT.gravites);
  });

  it('accepte une gravite hors Seveso', () => {
    expect(lireEtatUrl(new URLSearchParams('gravites=ied.autorisation')).gravites)
      .toEqual(['ied', 'autorisation']);
  });

  it('ignore un identifiant de campagne qui n est pas un uuid', () => {
    // Il part directement dans une requête. Le filtrer ici évite de porter la
    // validation dans chaque appelant.
    expect(lireEtatUrl(new URLSearchParams('campagne=../../etc/passwd')).campagne).toBeNull();
  });

  it('accepte un uuid de campagne', () => {
    const id = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
    expect(lireEtatUrl(new URLSearchParams(`campagne=${id}`)).campagne).toBe(id);
  });
});
