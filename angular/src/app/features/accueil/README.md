# accueil — tableau de bord

**Rôle** : l'écran d'arrivée, portage de `app/dashboard/page.tsx` (titre, carte de session, « Navigation
rapide »). Propre à Angular : la tuile du compte des sites à risque, qui éprouve toute la chaîne (session,
proxy, Bearer, route Next.js, base locale) et ouvre le module risque.

**Route** : `''` sous la coquille (`/app` en autonome, la racine du préfixe dans le shell).

**Fichiers** : `accueil.page.ts` (+ `.html`, `.spec.ts`). Aucun service d'état : la page lit
`AuthService` et `SitesRisqueApi`, fournis par `FOURNISSEURS_DISTANTS`.

**Ajouter une carte de navigation** : une entrée dans `CARTES_NAVIGATION` (`accueil.page.ts`). Un écran pas
encore porté garde `cible: null` — il se rend à l'identique de React, mais inerte.
