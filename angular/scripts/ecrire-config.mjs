/**
 * Écrit public/config.local.json depuis le .env.development.local de la racine.
 *
 * La clé anon ne doit vivre dans AUCUN fichier suivi par git
 * (tests/unit/securite/aucun-secret-en-dur.test.ts). L'application la lit à
 * l'exécution, dans ce fichier généré et ignoré.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const source = new URL('../../.env.development.local', import.meta.url);
// `.env.local` est relu en second, comme Next en développement (`.env.development.local` prime) : la clé Google Maps
// (facultative) y vit sur ce poste. Ses autres variables ne sont PAS recopiées.
const sourceSecours = new URL('../../.env.local', import.meta.url);
const cible = new URL('../public/config.local.json', import.meta.url);

if (!existsSync(source)) {
  console.error('✗ .env.development.local absent à la racine du dépôt.');
  console.error('  Lancer d\'abord : bash scripts/local/04-env-local.sh');
  process.exit(1);
}

const lire = (fichier) => Object.fromEntries(
  readFileSync(fichier, 'utf8')
    .replace(/^﻿/, '') // un BOM a déjà cassé le CLI Supabase sur ce poste
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);
const vars = lire(source);

const manquantes = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'].filter((k) => !vars[k]);
if (manquantes.length) {
  console.error(`✗ Variables absentes de .env.development.local : ${manquantes.join(', ')}`);
  process.exit(1);
}

const config = {
  supabaseUrl: vars.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: vars.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  apiBaseUrl: '',
};
// Clé Street View, facultative (lot 4, T8) : absente ou vide, elle n'est pas écrite et le tiroir d'un panneau le dit.
const cleGoogle = vars.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  || (existsSync(sourceSecours) ? lire(sourceSecours).NEXT_PUBLIC_GOOGLE_MAPS_API_KEY : '');
if (cleGoogle) config.googleMapsKey = cleGoogle;
// Origine de l'application React, facultative (parcours de la carte, étapes ⑥-⑧ ; ⑤ n'a jamais de lien) : la même variable que Next.
const urlReact = vars.NEXT_PUBLIC_APP_URL
  || (existsSync(sourceSecours) ? lire(sourceSecours).NEXT_PUBLIC_APP_URL : '');
if (urlReact) config.urlApplicationReact = urlReact.replace(/\/+$/, '');
writeFileSync(cible, JSON.stringify(config, null, 2) + '\n');
console.log('✓ public/config.local.json écrit');
