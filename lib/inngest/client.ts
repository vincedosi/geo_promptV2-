/**
 * MAGELIAN — client Inngest partage.
 *
 * Point d'entree unique pour publier des evenements et declarer des jobs
 * asynchrones. L'`id` doit rester stable : il identifie l'app cote Inngest.
 */
import { Inngest } from 'inngest';

export const inngest = new Inngest({ id: 'genesis-app', name: 'Genesis App' });
