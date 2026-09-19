/**
 * La règle d'affectation unique : un carreau INSEE de 200 m, une seule classe.
 *
 * ── LE DÉFAUT QU'ELLE RÉPARE ──────────────────────────────────────────────
 *
 * Les chiffres du module ne s'additionnaient pas, et ce n'était pas une
 * imprécision de calcul : c'était structurel. `couverture_rayon_risque`
 * (sql/198) porte une distribution MARGINALE — une ligne par gravité, chacune
 * exacte pour sa propre question, mais le même carreau compte dans plusieurs.
 *
 * Mesuré le 2026-09-19 sur la base locale, carreaux à moins de 10 km d'un site :
 *
 *     seveso_haut    586 248
 *     seveso_bas     655 977      somme 1 242 225
 *     réel ('*')     914 154      minimum par carreau
 *
 * **328 071 carreaux sont à portée des DEUX niveaux**, soit 35,9 % des carreaux
 * exposés. L'écran affichait donc deux nombres dont la somme dépassait le total,
 * sans qu'aucun des deux ne soit faux pris isolément.
 *
 * En attribuant chaque carreau à UN niveau et UNE bande, toutes les sommes
 * redeviennent additives — par niveau, par bande, par territoire — et le cumul
 * se déduit par simple addition. C'est ce qui permet au tableau, à la carte et
 * au classeur de montrer le même nombre.
 *
 * ── POURQUOI ELLE EST PURE, ET POURQUOI ELLE EST ICI ──────────────────────
 *
 * Elle s'applique à ~914 000 carreaux côté base et à quelques dizaines dans une
 * infobulle côté client. Les deux DOIVENT classer identiquement, sinon la carte
 * contredit le tableau qu'elle illustre. sql/203 transcrit cette fonction en
 * SQL ; la transcription est verrouillée par un test dédié, pas par la bonne
 * volonté.
 */
import { anneauxDuNiveau, NIVEAUX, type Niveau, type ProfilRayons } from '@/lib/risques/profil';

/**
 * Les distances d'un carreau aux sites les plus proches, par niveau.
 *
 * ⚠ C'est un couple JOINT et c'est tout l'intérêt : `couverture_rayon_risque`
 * sait dire « combien d'habitants à tel palier du plus proche Seveso haut »,
 * mais pas « pour CE carreau, quelle distance au haut ET quelle distance au
 * bas ». Sans les deux ensemble, la priorité entre niveaux est indécidable.
 *
 * `null` signifie « au-delà du plafond du pré-calcul » (10 km), pas « inconnu ».
 */
export interface DistancesCarreau {
  /** Mètres jusqu'au Seveso seuil haut le plus proche, ou `null` au-delà de 10 km. */
  haut: number | null;
  /** Mètres jusqu'au Seveso seuil bas le plus proche. */
  bas: number | null;
  /** Mètres jusqu'au site des autres régimes le plus proche. Non alimenté à ce jour. */
  autres: number | null;
  /**
   * Le niveau du site générateur du périmètre PPRT qui couvre ce carreau.
   *
   * Un niveau et non un booléen : un PPRT est une servitude générée par un
   * établissement, et c'est le niveau de CET établissement qui décide dans
   * quelle famille le carreau se range. Un booléen global aurait forcé à
   * choisir arbitrairement, ou à ranger un PPRT de site seuil bas parmi les
   * chiffres du seuil haut.
   */
  pprt: Niveau | null;
}

/** La classe d'un carreau : un niveau, et une bande ou le périmètre publié. */
interface ClasseZone {
  niveau: Niveau;
  /** Numéro de bande à partir de 1, ou `'pprt'` pour la servitude opposable. */
  bande: number | 'pprt';
}

/** Le carreau n'appartient à aucune classe du profil courant. */
export const HORS_ZONE = 'hors' as const;

export type Classe = ClasseZone | typeof HORS_ZONE;

/**
 * Classe un carreau, une fois pour toutes.
 *
 * La règle, dans cet ordre exact :
 *
 * 1. **Le niveau d'abord.** On essaie `haut`, puis `bas`, puis `autres`. Le
 *    premier niveau qui « retient » le carreau l'emporte — un carreau proche
 *    d'un seuil haut ne se range jamais sous le seuil bas, même s'il est plus
 *    près de ce dernier. C'est un classement par gravité, pas par distance.
 * 2. **Dans le niveau, le PPRT prime.** Si `inclurePPRT` est actif et qu'un
 *    périmètre de CE niveau couvre le carreau, la classe est `'pprt'`, quelle
 *    que soit la distance — y compris au-delà du dernier anneau. Une servitude
 *    opposable ne disparaît pas parce qu'un curseur est réglé trop bas.
 * 3. **Sinon, la bande.** Bandes exclusives `[0, r1)`, `[r1, r2)`, … La borne
 *    appartient à la bande SUPÉRIEURE. Au-delà du dernier anneau, le niveau ne
 *    retient pas le carreau et on passe au suivant.
 *
 * @param d - Les distances jointes du carreau.
 * @param profil - Le profil d'anneaux, déjà normalisé.
 * @returns La classe unique du carreau, ou `HORS_ZONE`.
 *
 * @example
 * // Un carreau à 1,5 km d'un seuil haut et 200 m d'un seuil bas :
 * classerCarreau({ haut: 1500, bas: 200, autres: null, pprt: null }, profil)
 * // → { niveau: 'haut', bande: 2 }  — jamais compté aussi dans « bas »
 */
export function classerCarreau(d: DistancesCarreau, profil: ProfilRayons): Classe {
  for (const niveau of NIVEAUX) {
    const anneaux = anneauxDuNiveau(profil, niveau);
    // Un niveau sans anneau n'a aucune bande définie : il ne peut rien retenir.
    // Le traiter autrement ferait apparaître dans la légende une classe à zéro
    // habitant, qui se lit « personne n'habite là » et non « non calculé ».
    if (anneaux.length === 0) continue;

    if (profil.inclurePPRT && d.pprt === niveau) return { niveau, bande: 'pprt' };

    const distance = d[niveau];
    if (distance === null) continue;

    const bande = anneaux.findIndex((r) => distance < r);
    if (bande !== -1) return { niveau, bande: bande + 1 };
  }
  return HORS_ZONE;
}

/**
 * L'identifiant textuel d'une classe — la forme qui voyage.
 *
 * Employée comme clé de groupement en base, comme propriété de feature MVT et
 * comme clé de légende. Une seule fonction pour les trois, sinon un `haut:1`
 * côté carte et un `haut_1` côté tableau ne se rejoindraient jamais.
 *
 * @param c - La classe à nommer.
 * @returns `'hors'`, ou `'<niveau>:<bande>'` (par exemple `'haut:pprt'`, `'bas:2'`).
 */
export function idClasse(c: Classe): string {
  return c === HORS_ZONE ? HORS_ZONE : `${c.niveau}:${c.bande}`;
}

/**
 * Toutes les classes qu'un profil peut produire, dans l'ordre de lecture.
 *
 * Sert la légende, l'ordre des barres de l'onglet Diffusion et les colonnes du
 * classeur. L'invariant qui compte : **toute classe rendue par
 * `classerCarreau` figure ici**. Sans lui, une population pourrait peser dans
 * le total sans apparaître nulle part — invisible et pourtant comptée.
 *
 * L'ordre va du plus grave au moins grave, du cœur vers l'extérieur, et finit
 * par le hors-zone : c'est l'ordre dans lequel on lit une carte de risque.
 *
 * @param profil - Le profil normalisé.
 * @returns Les classes, hors-zone compris, en dernier.
 */
export function classesDuProfil(profil: ProfilRayons): Classe[] {
  const classes: Classe[] = [];
  for (const niveau of NIVEAUX) {
    const anneaux = anneauxDuNiveau(profil, niveau);
    if (anneaux.length === 0) continue;
    if (profil.inclurePPRT) classes.push({ niveau, bande: 'pprt' });
    for (let i = 1; i <= anneaux.length; i += 1) classes.push({ niveau, bande: i });
  }
  classes.push(HORS_ZONE);
  return classes;
}
