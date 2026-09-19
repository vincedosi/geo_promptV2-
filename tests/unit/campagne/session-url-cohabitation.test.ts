/**
 * La cohabitation des écrans dans la chaîne de requête de `/map`.
 *
 * ── LE DÉFAUT QUE CE TEST FERME ───────────────────────────────────────────
 *
 * `/map` est une page PARTAGÉE. La session de campagne y écrit `campagne=`,
 * `maille=`, `parent=`, `unite=` ; l'analyse de population à risque y écrit
 * `risque=` ; d'autres écrans en écriront demain.
 *
 * La persistance de session reconstruisait la chaîne ENTIÈRE à partir d'elle
 * seule — `router.replace('/map?' + qs)` — et faisait donc disparaître les
 * paramètres des voisins à la première bascule de vue.
 *
 * Constaté le 2026-09-19 : ouvrir
 * `/map?risque=onglet%3Ddiffusion%26campagne%3D…` aboutissait à
 * `/map?campagne=…&maille=cp&parent=13&unite=13104`. Le lien partagé perdait
 * exactement ce qu'il transportait, sans erreur ni trace — et un utilisateur
 * n'a aucun moyen de deviner que son lien a été réécrit sous ses yeux.
 */
import { describe, it, expect } from 'vitest';
import {
  CLES_SESSION, SESSION_DEFAUT, fusionnerUrlSession, sessionVersUrl, urlVersSession,
} from '@/lib/campagne/session-url';

/**
 * ⚠ La maille de la SESSION DE CAMPAGNE vaut `region` | `departement` | `cp`,
 * jamais `commune` — contrairement à celle du module risque. Deux écrans, deux
 * nomenclatures, et un `commune` écrit ici serait silencieusement REJETÉ par
 * `urlVersSession` (première version de ce test, corrigée).
 */
const session = {
  ...SESSION_DEFAUT,
  campaignId: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
  maille: 'cp' as const,
  parent: '13',
};

describe('fusionnerUrlSession', () => {
  it('conserve un parametre etranger', () => {
    const r = fusionnerUrlSession(session, new URLSearchParams('risque=onglet%3Drayons'));
    expect(r.get('risque')).toBe('onglet=rayons');
    expect(r.get('campagne')).toBe(session.campaignId);
  });

  it('conserve PLUSIEURS parametres etrangers', () => {
    const r = fusionnerUrlSession(session, new URLSearchParams('risque=abc&customZone=42&x=1'));
    expect(r.get('risque')).toBe('abc');
    expect(r.get('customZone')).toBe('42');
    expect(r.get('x')).toBe('1');
  });

  it('remplace ses PROPRES cles, sans en laisser de perimee', () => {
    // Une valeur de session obsolète qui survivrait serait pire qu'absente :
    // elle serait relue au rechargement et ramènerait l'utilisateur à une vue
    // qu'il a quittée.
    const r = fusionnerUrlSession(session, new URLSearchParams('parent=99&unite=99999&tri=pire'));
    expect(r.get('parent')).toBe('13');
    expect(r.get('unite')).toBeNull();
  });

  it('retire une cle de session devenue vide', () => {
    // `unite` n'est plus sélectionnée : elle doit DISPARAÎTRE de l'URL, pas y
    // rester avec son ancienne valeur.
    const sansUnite = { ...session, uniteSelectionnee: null };
    const r = fusionnerUrlSession(sansUnite, new URLSearchParams('unite=13104&risque=abc'));
    expect(r.get('unite')).toBeNull();
    expect(r.get('risque')).toBe('abc');
  });

  it('rend exactement les parametres de session quand l URL est vide', () => {
    const r = fusionnerUrlSession(session, new URLSearchParams());
    expect(r.toString()).toBe(sessionVersUrl(session).toString());
  });

  it('CLES_SESSION couvre tout ce que sessionVersUrl peut emettre', () => {
    /*
     * L'invariant qui fait tenir la fusion. Une clé émise par
     * `sessionVersUrl` mais absente de `CLES_SESSION` ne serait jamais
     * NETTOYÉE : sa valeur périmée survivrait indéfiniment dans l'URL, et
     * serait relue au rechargement.
     */
    const complete = {
      ...SESSION_DEFAUT,
      // ⚠ `vue` vaut 'suivi' | 'carte', et `onglet` est celui de l'overlay
      // MAGELIAN. Une valeur hors liste ne lève pas au runtime — `urlVersSession`
      // l'ignore — mais elle fait échouer `tsc`, et c'est ce qui a rattrapé une
      // première version de ce test où `vue: 'apercu'` passait tous les asserts.
      campaignId: 'x', vue: 'carte' as const, onglet: 'strategie' as const,
      maille: 'cp' as const, parent: '13', uniteSelectionnee: '13104',
      tri: 'meilleur' as const, acteurs: ['dv360'],
    };
    for (const cle of sessionVersUrl(complete).keys()) {
      expect(
        CLES_SESSION as readonly string[],
        `La clé « ${cle} » est émise dans l'URL mais absente de CLES_SESSION : `
        + `elle ne serait jamais nettoyée et sa valeur périmée survivrait.`,
      ).toContain(cle);
    }
  });

  it('l aller-retour d une session survit a la presence d un voisin', () => {
    const r = fusionnerUrlSession(session, new URLSearchParams('risque=onglet%3Ddiffusion'));
    const relue = urlVersSession(r);
    expect(relue.campaignId).toBe(session.campaignId);
    expect(relue.maille).toBe('cp');
    expect(relue.parent).toBe('13');
  });
});
