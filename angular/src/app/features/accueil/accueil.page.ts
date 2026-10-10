import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { formaterNombre } from '../../core/format/nombre';
import { versEtat } from '../../core/etat/vers-etat';
import { DISPONIBLE_PROCHAINEMENT } from '../../layout/navigation';
import { EnteteSectionComponent } from '../../ui/entete-section/entete-section.component';
import { EntetePageComponent } from '../../ui/entete-page/entete-page.component';
import { IconeComponent } from '../../ui/icone/icone.component';
import type { NomIcone } from '../../ui/icone/icones';
import { TuileChiffreComponent } from '../../ui/tuile-chiffre/tuile-chiffre.component';
import { SitesRisqueApi, type CompteSites } from '../risques/data/sites-risque.api';

/**
 * Cartes de navigation rapide de `app/dashboard/page.tsx:91-98`. Un écran pas encore porté se rend à
 * l'identique, mais INERTE (`cible: null`, même règle que la barre latérale). « Accès » (2026-10-10)
 * remplace « Organisations » comme côté React, et ouvre la page Angular (`cible` RELATIVE).
 */
const CARTES_NAVIGATION: readonly { icone: NomIcone; libelle: string; sous: string; cible: string | null }[] = [
  { icone: 'epingle-carte', libelle: 'geo.prompt', sous: 'Carte + IA', cible: null },
  { icone: 'ecran', libelle: 'Import OOH', sous: 'Panneaux ArcGIS', cible: null },
  { icone: 'fichier-haut', libelle: 'Import POI', sous: 'CSV / XLSX', cible: null },
  { icone: 'base-de-donnees', libelle: 'Sources', sous: 'Data lake', cible: null },
  { icone: 'utilisateurs', libelle: 'Accès', sous: 'Comptes et espaces', cible: 'admin/acces' },
  { icone: 'calques', libelle: 'IRIS Crawler', sous: 'Données INSEE', cible: null },
];

/**
 * Tableau de bord (`app/dashboard/page.tsx`) : en-tête, rangée de quatre cartes
 * de session, « Navigation rapide ». S'y ajoute, propre à Angular, le compte des
 * sites à risque — la chaîne entière (session, proxy, Bearer, route Next.js,
 * base locale) y est éprouvée — et la tuile ouvre le module risque (`carte/risques`).
 */
@Component({
  selector: 'mg-accueil',
  imports: [RouterLink, EntetePageComponent, EnteteSectionComponent, TuileChiffreComponent, IconeComponent],
  templateUrl: './accueil.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccueilPage {
  private readonly api = inject(SitesRisqueApi);
  private readonly auth = inject(AuthService);

  protected readonly etat = versEtat<CompteSites>(this.api.compter());
  protected readonly prochainement = DISPONIBLE_PROCHAINEMENT;
  protected readonly cartesNavigation = CARTES_NAVIGATION;
  private readonly profil = signal<{ role: string | null; nom: string | null } | null>(null);

  constructor() {
    void this.auth.lireProfil().then((p) => this.profil.set(p));
  }

  protected readonly nomAffiche = computed(() => {
    const u = this.auth.session()?.user;
    const meta = (u?.user_metadata ?? {}) as Record<string, unknown>;
    const nomMeta = (meta['full_name'] as string | undefined) ?? (meta['name'] as string | undefined) ?? null;
    // Comme `{ ...user, ...enrich }` de lib/auth-client.ts:139 : un profil LU l'emporte entièrement, même
    // avec un full_name nul (la clé existe, valeur undefined) — on retombe alors sur l'email, pas sur le jeton.
    const profil = this.profil();
    const nom = profil ? profil.nom : nomMeta;
    return nom || u?.email?.split('@')[0] || '—';
  });

  /** Les quatre cartes de `stats` (`page.tsx:61-88`) ; seule la première est un lien. */
  protected readonly cartesSession = computed(() => {
    const s = this.auth.session();
    const u = s?.user;
    const meta = (u?.user_metadata ?? {}) as Record<string, unknown>;
    const profil = this.profil();
    const role = (profil ? profil.role : (meta['role'] as string | undefined)) ?? 'user';
    const expiration = s?.expires_at
      ? new Date(s.expires_at * 1000).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
      : new Date(Date.now() + 3_600_000).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    return [
      { icone: 'epingle-carte', valeur: 'geo.prompt', libelle: 'Copilote IA', lien: true },
      { icone: 'courrier', valeur: this.nomAffiche(), libelle: u?.email ?? '', lien: false },
      { icone: 'bouclier', valeur: role, libelle: u?.email_confirmed_at ? 'Compte vérifié' : 'Non vérifié', lien: false },
      { icone: 'horloge', valeur: expiration, libelle: 'Expiration session', lien: false },
    ] satisfies { icone: NomIcone; valeur: string; libelle: string; lien: boolean }[];
  });

  protected readonly valeurSites = computed(() => {
    const e = this.etat();
    if (e.statut === 'pret') return formaterNombre(e.valeur.retenus);
    return e.statut === 'echec' ? '—' : '…';
  });

  protected readonly messageEchec = computed(() => {
    const e = this.etat();
    return e.statut === 'echec' ? e.message : '';
  });
}
