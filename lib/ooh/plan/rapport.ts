/**
 * Rapport du script d'import (spec 2026-10-16-ooh-campagnes § 7) : compteurs par réseau (lus, placés sûrs, à vérifier,
 * non placés) et CSV des emplacements à reprendre, écrit HORS du dépôt (les noms viennent d'un fichier client).
 */
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { formaterDecimal, formaterNombre } from '@/lib/format/nombre';
import type { AdaptateurId, EmplacementNonPlace, EmplacementPlace } from '@/types/campagnes-media';

interface CompteurReseau {
  adaptateur: AdaptateurId;
  lus: number;
  surs: number;
  a_verifier: number;
  non_places: number;
}

/** Un compteur par réseau, triés par identifiant d'adaptateur. */
export function compterParReseau(places: readonly EmplacementPlace[], nonPlaces: readonly EmplacementNonPlace[]): CompteurReseau[] {
  const parReseau = new Map<AdaptateurId, CompteurReseau>();
  const compteur = (a: AdaptateurId): CompteurReseau => {
    let c = parReseau.get(a);
    if (!c) {
      c = { adaptateur: a, lus: 0, surs: 0, a_verifier: 0, non_places: 0 };
      parReseau.set(a, c);
    }
    return c;
  };
  for (const p of places) {
    const c = compteur(p.adaptateur);
    c.lus++;
    if (p.geoloc_qualite === 'sure') c.surs++;
    else c.a_verifier++;
  }
  for (const n of nonPlaces) {
    const c = compteur(n.adaptateur);
    c.lus++;
    c.non_places++;
  }
  return [...parReseau.values()].sort((a, b) => a.adaptateur.localeCompare(b.adaptateur));
}

/** Échappe une valeur CSV (séparateur `;`) : guillemets si `;`, `"` ou retour à la ligne. */
function cellule(v: string | number | null): string {
  if (v === null) return '';
  const t = String(v);
  return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Les emplacements à reprendre : à vérifier, puis non placés. */
export function csvAReprendre(places: readonly EmplacementPlace[], nonPlaces: readonly EmplacementNonPlace[]): string {
  const lignes = ['reseau;nom;etat;raison;methode;score;reconnu;latitude;longitude'];
  for (const p of places) {
    if (p.geoloc_qualite !== 'a_verifier') continue;
    lignes.push([
      p.adaptateur, p.nom_lieu, 'a_verifier', p.geoloc_raison ?? null, p.geoloc_methode, formaterDecimal(p.geoloc_score, 2),
      p.geoloc_libelle, p.lat, p.lng,
    ].map(cellule).join(';'));
  }
  for (const n of nonPlaces) {
    lignes.push([n.adaptateur, n.nom, 'non_place', n.raison, null, null, null, null, null].map(cellule).join(';'));
  }
  return lignes.join('\n');
}

/** Vrai si `dossier` n'est PAS dans le dépôt (ni la racine, ni un de ses sous-dossiers). */
export function cheminRapportAutorise(dossier: string, racineDepot: string): boolean {
  const rel = relative(resolve(racineDepot), resolve(dossier));
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

/** `rapport-ooh-<cle>-<aaaammjj-hhmmss>.csv`, horodatage UTC. */
export function nomRapport(cle: string, date: Date): string {
  const d = date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `rapport-ooh-${cle}-${d}.csv`;
}

/** `[étape] 42 % — 420 / 1 000`. Un total nul vaut 100 %. */
export function ligneProgression(etape: string, fait: number, total: number): string {
  const pct = total === 0 ? 100 : Math.floor((fait * 100) / total);
  return `[${etape}] ${pct} % — ${formaterNombre(fait)} / ${formaterNombre(total)}`;
}
