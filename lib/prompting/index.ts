/**
 * Système de prompting partagé GEOMATIK.
 * Extrait dans le chantier A4.5 (BiddingCopilot → lib/prompting/).
 *
 * Patterns exposés :
 *  1. system-prompt-builder : composition de system prompts dynamiques
 *  2. json-extraction : parsing robuste du JSON dans une réponse LLM
 *  3. code-generation/* : sections de prompt + validators DV360/Adform/TTD
 *  4. rate-limiter : wrapper LLM-friendly autour de @/lib/api/rate-limit
 *  5. chat-ui/* : composants React MessageList/MessageInput/CodeTabs/DownloadButton
 *
 * À utiliser depuis l'agent A4.5 et toute future feature LLM.
 */

export * from './types';
export * from './system-prompt-builder';
export * from './json-extraction';
export * from './rate-limiter';
export * as codeGen from './code-generation';
export * as chatUI from './chat-ui';
