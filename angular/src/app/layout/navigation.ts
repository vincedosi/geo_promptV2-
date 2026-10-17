import type { NomIcone } from '../ui/icone/icones';

/**
 * Une entrée de la barre latérale.
 * `cible` : chemin RELATIF d'une route Angular qui existe (contrat AIDA : le
 * préfixe appartient au shell). `null` = écran pas encore porté : l'entrée est
 * rendue à l'identique de React mais INERTE (`aria-disabled`, « Disponible
 * prochainement »). Le jour où l'écran est porté, on renseigne `cible`.
 * `href` : le chemin React d'origine, gardé pour la traçabilité du portage.
 */
export interface EntreeNavigation {
  libelle: string;
  icone: NomIcone;
  href: string;
  cible: string | null;
  badge?: 'Admin' | 'Sys';
  /** Actif seulement sur le chemin exact (l'accueil, sinon actif partout). */
  exact?: boolean;
}

export interface SectionNavigation {
  section: string;
  entrees: EntreeNavigation[];
}

/**
 * Recopie de `navItems` (`components/AppSidebar.tsx:43-82`) : mêmes sections,
 * même ordre, mêmes libellés (orthographe de React comprise : « Systeme »,
 * « Qualite des donnees »), mêmes icônes, mêmes badges.
 * ⚠ React ne filtre AUCUNE entrée par rôle : toutes s'affichent pour tous, le
 * contrôle d'accès vit dans les routes (`requireAdmin`). Les badges « Admin » /
 * « Sys » ne sont que des étiquettes. On garde la même règle — un filtre ici
 * serait une différence de comportement avec React.
 */
export const SECTIONS_NAVIGATION: readonly SectionNavigation[] = [
  {
    section: 'Campagnes',
    entrees: [{ href: '/map?tab=suivi', libelle: 'Gestion campagnes', icone: 'cible', cible: null }],
  },
  {
    section: 'Carte',
    entrees: [
      { href: '/map', libelle: 'Explorer', icone: 'epingle-carte', cible: 'carte' },
      { href: '/map/custom-geo', libelle: 'Zones custom', icone: 'calques', cible: null },
    ],
  },
  {
    section: 'Administration',
    entrees: [
      { href: '/admin/carreaux-import', libelle: 'Import Shapefile', icone: 'televerser', badge: 'Admin', cible: null },
      { href: '/admin/import', libelle: 'Import POI', icone: 'fichier-haut', badge: 'Admin', cible: null },
      { href: '/dashboard/iris-crawler', libelle: 'IRIS Crawler', icone: 'calques', badge: 'Admin', cible: 'admin/donnees/importer/iris' },
      { href: '/admin/radio', libelle: 'Radio FM/DAB+', icone: 'radio', badge: 'Admin', cible: null },
      { href: '/admin/api', libelle: 'Connexions API', icone: 'prise', badge: 'Admin', cible: 'admin/systeme/api' },
    ],
  },
  {
    section: 'Systeme',
    entrees: [
      { href: '/admin/sources', libelle: 'Sources', icone: 'base-de-donnees', cible: null },
      // Accès (« Espaces de travail » du 2026-10-09 au 2026-10-10) : remplace « Users » et
      // « Organisations » — écart VOULU à la parité avec la barre React (spec espaces de travail
      // § 6). `href` garde le chemin React d'où vient la fonction, pour la traçabilité : la page
      // React `/admin/users` est SUPPRIMÉE depuis le 2026-10-10 (comme `/admin/organizations`) ;
      // la barre React renvoie désormais elle-même ici, par NEXT_PUBLIC_URL_ANGULAR.
      { href: '/admin/users', libelle: 'Accès', icone: 'utilisateurs', cible: 'admin/acces' },
      { href: '/admin/imports', libelle: 'Imports', icone: 'televerser', cible: 'admin/donnees/historique' },
      { href: '/admin/health', libelle: 'Health check', icone: 'activite', badge: 'Sys', cible: 'admin/systeme/sante' },
      { href: '/admin/qualite-donnees', libelle: 'Qualite des donnees', icone: 'bouclier-coche', badge: 'Sys', cible: 'admin/donnees/qualite' },
    ],
  },
];

/**
 * Les trois pages à onglets de l'administration Angular (amendement du 2026-10-12, lot 6 T6),
 * rendues EN TÊTE de la section « Administration » à la place des écrans qu'elles regroupent.
 * Sans badge : les badges « Admin » / « Sys » de React étiquetaient des pages qui n'existent plus
 * côté Angular. `href` : la page React d'où vient la première fonction regroupée (traçabilité).
 */
export const PAGES_ADMINISTRATION: readonly EntreeNavigation[] = [
  { href: '/admin/users', libelle: 'Accès', icone: 'utilisateurs', cible: 'admin/acces' },
  { href: '/admin/qualite-donnees', libelle: 'Données', icone: 'base-de-donnees', cible: 'admin/donnees' },
  { href: '/admin/health', libelle: 'Système', icone: 'activite', cible: 'admin/systeme' },
];

/** Sections dont les écrans PORTÉS sont regroupés dans les trois pages ci-dessus. */
const SECTIONS_REGROUPEES = ['Administration', 'Systeme'];

/**
 * La barre telle qu'elle est RENDUE : `SECTIONS_NAVIGATION` (copie de React, inchangée) regroupée.
 * Dans « Administration » et « Systeme », une entrée PORTÉE (`cible` non nulle) n'est plus rendue :
 * son écran est un onglet d'Accès, de Données ou de Système, qui prennent la tête de
 * « Administration ». Les entrées pas encore portées restent à leur place, inchangées (inertes) ;
 * elles disparaîtront une à une quand leur onglet arrivera (il suffit de renseigner leur `cible`).
 * Une section vidée n'est pas rendue. Même principe que le retrait de l'Assistant du rail de la
 * carte : un écart de RENDU, la copie de React reste verbatim.
 */
export function sectionsRendues(sections: readonly SectionNavigation[] = SECTIONS_NAVIGATION): SectionNavigation[] {
  return sections
    .map((s) => {
      if (!SECTIONS_REGROUPEES.includes(s.section)) return s;
      const restantes = s.entrees.filter((e) => e.cible === null);
      return { section: s.section, entrees: s.section === 'Administration' ? [...PAGES_ADMINISTRATION, ...restantes] : restantes };
    })
    .filter((s) => s.entrees.length > 0);
}

/**
 * Liens vers les pages propres à Angular (pas d'équivalent React), affichés
 * SEULEMENT hors production (`MODE_DEVELOPPEMENT`), en icônes dans le pied
 * « Online » : une section de plus dans le `nav` le faisait déborder et
 * apparaître une barre de défilement que React n'a pas (mesuré 1440 × 900).
 * L'accueil y figure parce que React n'a aucune entrée vers `/dashboard` : en
 * production, l'accueil n'est atteint que par la racine de la remote (menu du
 * shell), exactement comme `/dashboard` côté React.
 */
export const LIENS_DEVELOPPEMENT: readonly { libelle: string; icone: NomIcone; cible: string; exact?: boolean }[] = [
  { libelle: 'Accueil', icone: 'hexagone', cible: './', exact: true },
  { libelle: 'Catalogue', icone: 'calques', cible: 'catalogue' },
  // Lot 3 : le module « Population à risque industriel ». Depuis le lot 4 (T13) il est une route ENFANT de la carte
  // (`carte/risques`) et s'ouvre aussi, comme en React, depuis le panneau Calques ; ce lien y mène directement.
  { libelle: 'Module risque', icone: 'cercle-alerte', cible: 'carte/risques' },
];

/**
 * Libellé de l'infobulle d'une entrée inerte (et du bouton « MAGELIAN »).
 *
 * Règle du curseur d'une entrée inerte : c'est celui que React rend pour cet
 * élément (parité), sans harmonisation — `cursor-default` pour une entrée de
 * la barre ou une carte de l'accueil (React ne pose aucun `not-allowed` dessus),
 * `cursor-not-allowed` là où React le pose (lien d'inscription, boutons
 * désactivés). Ne pas « uniformiser » : on copie le rendu mesuré.
 */
export const DISPONIBLE_PROCHAINEMENT = 'Disponible prochainement';
