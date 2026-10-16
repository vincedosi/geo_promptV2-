/**
 * Durées et dates d'un plan de régie (spec 2026-10-16-ooh-campagnes § 4.2) : `date_fin` est calculée à partir du
 * départ et de la durée ; le libellé d'origine est gardé à côté (`duree_libelle`).
 */
import { sansDiacritiques } from './texte';

/** Une durée : jours calendaires couverts, et jours de diffusion annoncés. */
interface Duree {
  jours: number;
  jours_diffusion: number;
}

/** Ajoute `n` jours à une date ISO `yyyy-mm-dd`, en UTC (aucun décalage de fuseau). */
export function ajouterJours(iso: string, n: number): string {
  const [annee, mois, jour] = iso.split('-').map(Number);
  return new Date(Date.UTC(annee, mois - 1, jour + n)).toISOString().slice(0, 10);
}

/**
 * « 2 semaines », « 7 jours », « 14 jours », « 2*5 jours » (deux semaines de cinq jours de diffusion : 14 jours
 * couverts, 10 diffusés), « 9 jrs dont 2 offert » (9 jours) ; `null` pour tout autre libellé — jamais deviné.
 */
export function lireDuree(libelle: string | null): Duree | null {
  if (!libelle) return null;
  const t = sansDiacritiques(libelle).toLowerCase().replace(/\s+/g, ' ').trim();
  const semainesDeJours = /^(\d+)\s*[*x]\s*(\d+)\s*(?:jours?|jrs?|j)\b/.exec(t);
  if (semainesDeJours) {
    const semaines = Number(semainesDeJours[1]);
    return { jours: semaines * 7, jours_diffusion: semaines * Number(semainesDeJours[2]) };
  }
  const semaines = /^(\d+)\s*semaines?\b/.exec(t);
  if (semaines) return { jours: Number(semaines[1]) * 7, jours_diffusion: Number(semaines[1]) * 7 };
  const jours = /^(\d+)\s*(?:jours?|jrs?|j)\b/.exec(t);
  if (jours) return { jours: Number(jours[1]), jours_diffusion: Number(jours[1]) };
  return null;
}

/** La date de fin d'une ligne : départ + durée − 1 jour ; `null` si l'un manque ou si la durée est illisible. */
export function dateFinLigne(depart: string | null, libelle: string | null): string | null {
  const duree = lireDuree(libelle);
  return depart !== null && duree !== null ? ajouterJours(depart, duree.jours - 1) : null;
}

/** La période « jj/mm - jj/mm » d'un titre de plan ; l'année est donnée, une fin avant le début passe à l'année suivante. */
export function periodeDuTitre(titre: string, annee: number): { debut: string; fin: string } | null {
  const m = /(\d{1,2})\/(\d{1,2})\s*[-–]\s*(\d{1,2})\/(\d{1,2})/.exec(titre);
  if (!m) return null;
  const [j1, m1, j2, m2] = m.slice(1).map(Number);
  if (m1 < 1 || m1 > 12 || m2 < 1 || m2 > 12 || j1 < 1 || j1 > 31 || j2 < 1 || j2 > 31) return null;
  const iso = (a: number, mois: number, jour: number) => `${a}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
  return { debut: iso(annee, m1, j1), fin: iso(m2 < m1 ? annee + 1 : annee, m2, j2) };
}
