/**
 * La logique de l'administration copiée dans angular/ (P6) rend la MÊME chose que sa source
 * React. Les modules copiés servent aussi l'API et ne sont pas gelés : ce test est ce qui
 * oblige la copie à suivre (feuille de route, lot 6).
 */
import { describe, expect, it } from 'vitest';
import * as Rr from '@/lib/auth/roles';
import * as Ar from '../../../angular/src/app/features/admin/logique/roles';
import * as Rv from '@/lib/version';
import * as Av from '../../../angular/src/app/features/admin/logique/version';
import * as Rf from '@/app/admin/carreaux-import/_components/shared';
import * as Af from '../../../angular/src/app/features/admin/logique/formats';
import type * as RtA from '@/types/admin';
import type * as AtA from '../../../angular/src/app/features/admin/logique/types/admin';
import type * as RtD from '@/types/dsp';
import type * as AtD from '../../../angular/src/app/features/admin/logique/types/dsp';
import type * as RtC from '@/types/campaign';
import type * as AtC from '../../../angular/src/app/features/admin/logique/types/campagne-import';
import type * as RtI from '@/lib/import/types';
import type * as AtI from '../../../angular/src/app/features/admin/logique/types/import-poi';
import type * as RtF from '@/lib/donnees/registre-fraicheur';
import type * as AtF from '../../../angular/src/app/features/admin/logique/types/fraicheur';

// Assignabilité mutuelle, vérifiée par `npx tsc --noEmit` à la racine (Vitest ne type-vérifie pas).
// Liste = chaque type que l'admin React importe de ces modules (grep du 2026-10-06), plus `UserRole`.
type Egal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _verif: [
  Egal<RtA.HealthResponse, AtA.HealthResponse>,
  Egal<RtA.Check, AtA.Check>,
  Egal<RtA.Organization, AtA.Organization>,
  Egal<RtA.DataSource, AtA.DataSource>,
  Egal<RtA.UserRole, AtA.UserRole>,
  Egal<RtA.UserRole, Ar.UserRole>,
  Egal<RtD.DspProvider, AtD.DspProvider>,
  Egal<RtD.DspConnectionPublic, AtD.DspConnectionPublic>,
  Egal<RtD.DspApiLogRow, AtD.DspApiLogRow>,
  Egal<RtC.CampaignListItem, AtC.CampaignListItem>,
  Egal<RtC.CampaignImportEvent, AtC.CampaignImportEvent>,
  Egal<RtC.CampaignImportReport, AtC.CampaignImportReport>,
  Egal<RtI.ParseResult, AtI.ParseResult>,
  Egal<RtI.ImportProgress, AtI.ImportProgress>,
  Egal<RtI.ImportReport, AtI.ImportReport>,
  Egal<RtI.DryRunResult, AtI.DryRunResult>,
  Egal<RtI.GeocodeDetailedResult, AtI.GeocodeDetailedResult>,
  Egal<RtI.FieldMapping, AtI.FieldMapping>,
  Egal<RtI.GeoMode, AtI.GeoMode>,
  Egal<RtI.GeoConfig, AtI.GeoConfig>,
  Egal<RtF.NatureSource, AtF.NatureSource>,
  Egal<RtF.EtatFraicheur, AtF.EtatFraicheur>,
] = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];
void _verif;

describe("logique de l'administration : Angular = React", () => {
  it('rôles', () => {
    expect(Ar.ROLE_LEVELS).toEqual(Rr.ROLE_LEVELS);
    expect(Ar.ROLE_LABELS).toEqual(Rr.ROLE_LABELS);
    expect(Ar.ROLES).toEqual(Rr.ROLES);
    expect(Ar.ROLES_MEMBRE).toEqual(Rr.ROLES_MEMBRE);
  });
  it('version affichée par le Health check', () => {
    expect(Av.APP_VERSION).toBe(Rv.APP_VERSION);
    expect(Av.BUILD_DATE).toBe(Rv.BUILD_DATE);
  });
  it('formats de taille et de durée', () => {
    for (const b of [0, 1, 1023, 1024, 1_048_575, 1_048_576, 5_368_709_120]) expect(Af.fmtBytes(b)).toBe(Rf.fmtBytes(b));
    for (const s of [0, 59, 60, 61, 3599, 3600, 86_400]) expect(Af.fmtTime(s)).toBe(Rf.fmtTime(s));
  });
});
