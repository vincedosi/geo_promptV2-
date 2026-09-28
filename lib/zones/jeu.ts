/**
 * `JeuDeZones` — ce qu'une campagne reçoit comme plan géographique.
 *
 * ── CE QUE CET OBJET DÉCIDE ───────────────────────────────────────────────
 *
 * Un `ProfilRayons` décrit ce qu'on REGARDE. Un jeu de zones décrit ce qu'on
 * ACHÈTE : il devient la part de plan de chaque code postal, donc la
 * répartition réelle du budget d'une campagne. Une erreur ici ne fait pas
 * afficher un mauvais chiffre — elle fait dépenser au mauvais endroit.
 *
 * ── LES DEUX MODES DE PLAN ────────────────────────────────────────────────
 *
 * `'exclusif'` : hors zone, la part de plan est NULLE. Le budget se répartit
 * entre les seuls codes postaux retenus. C'est un ciblage strict, et il coupe
 * une campagne nationale du jour au lendemain.
 *
 * `'pondere'` : tous les codes postaux reçoivent une part, pondérée par la
 * classe de leur population. Hors zone, le poids vaut 1 — la neutralité.
 *
 * Le défaut est `'pondere'` parce que c'est celui qui ne surprend pas : on
 * module une campagne existante avant de la restreindre.
 *
 * ── LE SEUIL DE COUVERTURE, ET POURQUOI IL EXISTE ────────────────────────
 *
 * Le DSP achète au CODE POSTAL. Un anneau de 1 km est très inférieur à un code
 * postal : retenir un code postal dont 2 % de la population est en zone, c'est
 * acheter 98 % de hors-cible. Le seuil est la part minimale de population en
 * zone pour qu'un code postal soit retenu.
 *
 * C'est un POURCENTAGE, pas une fraction. `0,2` et `20` ne veulent pas dire la
 * même chose, et l'un des deux vide le plan de son tranchant.
 */
import { z } from 'zod';
import { normaliserProfil, profilDesGravites, ProfilRayonsSchema } from '@/lib/risques/profil';
import { codeProfil, profilDepuisCode, encStrict } from '@/lib/risques/code-profil';
import { classesDuProfil, idClasse, HORS_ZONE } from '@/lib/risques/affectation';

/** Les deux façons de traduire un jeu de zones en plan de campagne. */
export const MODES_PLAN = ['pondere', 'exclusif'] as const;

type ModePlan = (typeof MODES_PLAN)[number];

/** Multiplicateur d'enchère minimal. Zéro = la classe ne reçoit rien. */
export const POIDS_MIN = 0;

/**
 * Multiplicateur d'enchère maximal.
 *
 * Cinq, comme `dsp_campaigns.overpressure_weight` dont la contrainte CHECK
 * borne déjà à 5. Un multiplicateur part vers un DSP et coûte de l'argent
 * réel : la borne n'est pas une précaution d'interface.
 */
export const POIDS_MAX = 5;

/**
 * Une clé de classe telle que `idClasse` l'écrit : `haut:pprt`, `bas:2`, ou
 * `hors`. Le motif est vérifié pour qu'une clé fantaisiste ne survive pas à
 * l'enregistrement.
 */
export const MOTIF_CLASSE = /^(haut|bas|autres):(pprt|[1-4])$|^hors$/;

export const JeuDeZonesSchema = z.object({
  profil: ProfilRayonsSchema,
  /** Code de la cible comptée, validé contre `cibles_exposition` côté serveur. */
  cible: z.string().regex(/^[a-z0-9_]{1,40}$/),
  /** Gravités retenues, telles que `poi_france.sous_categorie` les écrit. */
  gravites: z.array(z.string().max(40)).max(10),
  /** Natures de risque retenues. Vide = toutes. */
  natures: z.array(z.string().max(120)).max(30),
  /** Origine de la zone retenue autour d'un site. */
  modes: z.array(z.enum(['pprt', 'buffer'])).max(2),
  /** Code de département, ou `null` pour la France entière. */
  territoire: z.string().regex(/^(2A|2B|\d{2,3})$/).nullable(),
  mode_plan: z.enum(MODES_PLAN),
  seuil_couverture_cp: z.number().min(0).max(100),
  /** Multiplicateur d'enchère par classe. Absent = 1. */
  poids: z.record(
    z.string().regex(MOTIF_CLASSE, 'Clé de classe inconnue.'),
    z.number().min(POIDS_MIN).max(POIDS_MAX),
  ),
});

export type JeuDeZones = z.infer<typeof JeuDeZonesSchema>;

/**
 * Le jeu ouvert par défaut.
 *
 * `seuil_couverture_cp` à 20 : en dessous, on achète surtout du hors-cible ;
 * au-dessus, le plan se vide sur les zones rurales où un site isolé ne couvre
 * jamais un cinquième de son code postal.
 */
export const JEU_DEFAUT: JeuDeZones = {
  profil: { haut: [1000, 2000, 5000], bas: [500, 1000], autres: [], lie: false, inclurePPRT: true },
  cible: 'ind',
  gravites: ['seveso_bas', 'seveso_haut'],
  natures: [],
  modes: ['buffer', 'pprt'],
  territoire: null,
  mode_plan: 'pondere',
  seuil_couverture_cp: 20,
  poids: {},
};

/**
 * Le multiplicateur d'enchère d'une classe.
 *
 * ⚠ En mode `'exclusif'`, le hors-zone vaut TOUJOURS zéro, même si un poids y
 * a été déclaré. Sinon le mode ne garantirait plus rien : « exclusif » veut
 * dire zéro impression hors zone, pas « zéro sauf si quelqu'un a réglé
 * autrement ».
 *
 * @param jeu - Le jeu de zones.
 * @param classe - L'identifiant de classe (`idClasse`).
 * @returns Le multiplicateur, entre {@link POIDS_MIN} et {@link POIDS_MAX}.
 */
export function poidsDeClasse(jeu: JeuDeZones, classe: string): number {
  if (classe === HORS_ZONE) return jeu.mode_plan === 'exclusif' ? 0 : (jeu.poids[classe] ?? 1);
  return jeu.poids[classe] ?? 1;
}

/**
 * Rend un jeu canonique : profil normalisé, listes triées et dédoublonnées,
 * poids restreints aux classes que le profil peut réellement produire.
 *
 * ⚠ Le dernier point n'est pas cosmétique. Un poids sur `haut:4` alors que le
 * niveau haut n'a que trois anneaux n'a aucun effet AUJOURD'HUI, mais il
 * survivrait à l'enregistrement et reprendrait vie le jour où un quatrième
 * anneau serait ajouté — avec une valeur que personne n'a choisie pour lui.
 *
 * @param brut - Un jeu éventuellement désordonné, venu d'une saisie ou de l'URL.
 * @returns Le jeu canonique.
 * @throws {z.ZodError} Si une borne est franchie.
 */
export function normaliserJeu(brut: unknown): JeuDeZones {
  const j = JeuDeZonesSchema.parse(brut);
  /*
   * ⚠ Le filtre de gravité s'applique AU PROFIL, ici et côté serveur
   * (2026-09-28). La géométrie (`construire_zones_risque`) et les codes
   * postaux (`remplir_zone_set_cp`) ne lisent que le profil : un jeu enregistré
   * avec « Seveso seuil haut » seul achetait pourtant les codes postaux des
   * anneaux du seuil bas. `gravites` ne servait qu'au choix des sites des
   * bassins (sql/224-225).
   */
  const profil = profilDesGravites(normaliserProfil(j.profil), j.gravites);

  const connues = new Set(classesDuProfil(profil).map(idClasse));
  const poids: Record<string, number> = {};
  for (const [cle, valeur] of Object.entries(j.poids)) {
    if (connues.has(cle)) poids[cle] = valeur;
  }

  const unique = (xs: string[]) => [...new Set(xs)].sort();

  return {
    ...j,
    profil,
    gravites: unique(j.gravites),
    natures: unique(j.natures),
    modes: [...new Set(j.modes)].sort() as JeuDeZones['modes'],
    poids,
  };
}

/** Sépare les champs du code. Absent des valeurs encodées, donc sans ambiguïté. */
const SEP = '~';

/**
 * Le code canonique d'un jeu — sa clé de cache de GÉOMÉTRIE et de population.
 *
 * ── CE QU'IL COUVRE, ET CE QU'IL NE COUVRE PAS ───────────────────────────
 *
 * Il couvre tout ce qui change la géométrie ou la population comptée : le
 * profil, la cible, les gravités, les natures, les modes, le territoire, et le
 * seuil de couverture — ce dernier décidant quels codes postaux sont retenus.
 *
 * Il ne couvre **ni les poids ni le mode de plan**, et c'est délibéré : ils
 * n'interviennent qu'au moment de fabriquer le plan, à partir d'une géométrie
 * déjà calculée. Les inclure invaliderait des minutes de calcul géométrique à
 * chaque curseur déplacé, pour un résultat rigoureusement identique.
 *
 * ⚠ Le code de profil seul ne suffirait PAS. Deux jeux de mêmes rayons mais de
 * gravités différentes ne décrivent pas la même population ; les confondre
 * servirait le cache de l'un pour l'autre — le défaut que sql/196 a dû
 * corriger sur `exposition_cache`.
 *
 * @param j - Le jeu, normalisé ou non.
 * @returns Un code sûr dans une URL et dans un nom de fichier.
 */
export function codeJeu(j: JeuDeZones): string {
  const c = normaliserJeu(j);
  return [
    codeProfil(c.profil),
    `c${c.cible}`,
    `g${c.gravites.join('.')}`,
    // Les natures portent des espaces et des parenthèses : on encode.
    `n${c.natures.map(encStrict).join('.')}`,
    `m${c.modes.join('.')}`,
    `t${c.territoire ?? ''}`,
    `s${c.seuil_couverture_cp}`,
  ].join(SEP);
}

/**
 * Relit un code produit par {@link codeJeu}.
 *
 * ⚠ **Ne lève jamais.** Le code vient de l'URL, donc de l'extérieur : un lien
 * tronqué par un client de messagerie casserait la page.
 *
 * Les champs absents du code — poids et mode de plan — reprennent leur valeur
 * par défaut. Un jeu relu depuis un code n'est donc pas forcément le jeu
 * ENREGISTRÉ du même nom : c'est sa part géométrique.
 *
 * @param code - Le code à relire.
 * @returns Le jeu normalisé, ou `null` si le code est illisible ou invalide.
 */
export function jeuDepuisCode(code: string): JeuDeZones | null {
  const m = code.split(SEP);
  if (m.length !== 7) return null;

  const profil = profilDepuisCode(m[0]);
  if (!profil) return null;

  const lettre = (s: string, l: string) => (s.startsWith(l) ? s.slice(1) : null);
  const cible = lettre(m[1], 'c');
  const gravites = lettre(m[2], 'g');
  const natures = lettre(m[3], 'n');
  const modes = lettre(m[4], 'm');
  const territoire = lettre(m[5], 't');
  const seuil = lettre(m[6], 's');
  if (cible === null || gravites === null || natures === null
      || modes === null || territoire === null || seuil === null) return null;

  const liste = (s: string) => (s === '' ? [] : s.split('.'));

  try {
    return normaliserJeu({
      profil,
      cible,
      gravites: liste(gravites),
      natures: liste(natures).map((x) => {
        try { return decodeURIComponent(x); } catch { return x; }
      }),
      modes: liste(modes),
      territoire: territoire === '' ? null : territoire,
      mode_plan: JEU_DEFAUT.mode_plan,
      seuil_couverture_cp: Number(seuil),
      poids: {},
    });
  } catch {
    return null;
  }
}
