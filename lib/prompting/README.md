# lib/prompting — Système de prompting partagé GEOMATIK

Extraite du chantier A4.5 (BiddingCopilot → lib partagée). Concentre les
patterns réutilisables pour toute feature LLM : agent superviseur, chat
copilote, futures intégrations.

## Modules

### 1. `system-prompt-builder`
Composition déclarative de system prompts. Sépare la structure (sections,
instructions, output schema) des données (variables interpolables).

```ts
import { buildSystemPrompt, formatList } from '@/lib/prompting';

const prompt = buildSystemPrompt({
  role: "Tu es l'agent IA superviseur de GEOMATIK...",
  sections: [
    { title: 'Contexte campagne', body: `Nom: ${campaign.name}\n...` },
    { title: 'Top sur-servis', body: formatList(top, fmtRow) },
  ],
  instructions: ['Sois concis', 'Utilise toujours les vrais noms'],
  output_schema: '```json\n{ "summary": "..." }\n```',
});
```

### 2. `json-extraction`
Extraction JSON depuis une réponse LLM mixte (texte + bloc fenced).

```ts
import { extractJSON, stripJsonBlock, JsonExtractionError } from '@/lib/prompting';

try {
  const parsed = extractJSON<MyOutput>(llmText);
  const cleanText = stripJsonBlock(llmText); // pour l'UI chat
} catch (e) {
  if (e instanceof JsonExtractionError) {
    console.error('JSON invalide :', e.raw, e.cause);
  }
}
```

### 3. `code-generation/*`
Sections de prompt + validators pour les 3 DSP cibles.

```ts
import {
  DV360_PROMPT_SECTION, validateDV360Code,
  ADFORM_PROMPT_SECTION, validateAdformJSON,
  TTD_PROMPT_SECTION, validateTTDJSON,
} from '@/lib/prompting/code-generation';

// Inclure DV360_PROMPT_SECTION dans le system prompt LLM…
// Puis valider la sortie :
const { ok, missing } = validateDV360Code(generatedCode);
```

### 4. `rate-limiter`
Wrapper LLM-friendly autour de `@/lib/api/rate-limit`.

```ts
import { createLLMRateLimiter, enforceLLMRateLimit } from '@/lib/prompting';

const limiter = createLLMRateLimiter({ prefix: 'agent:chat' });

export async function POST(req: NextRequest) {
  const profile = await requireAuth(req);
  if (!profile) return authUnauthorized();

  const blocked = await enforceLLMRateLimit(limiter, profile.id, req);
  if (blocked) return blocked;

  // …
}
```

### 5. `chat-ui/*`
Composants React partagés pour les UIs chat (MessageList, MessageInput,
CodeTabs, DownloadButton).

```tsx
import { MessageList, MessageInput, CodeTabs } from '@/lib/prompting/chat-ui';

<MessageList messages={messages} loading={loading} assistantLabel="A" />
<MessageInput onSend={handleSend} loading={loading} />
<CodeTabs tabs={[
  { id: 'dv360', label: 'DV360', code: codeDv360, filename: 'bid.py' },
  { id: 'adform', label: 'Adform', code: codeAdform, filename: 'bid.json' },
]} />
```

## Tests

```bash
pnpm test lib/prompting/
```

Couvrent : `interpolate`, `extractJSON`, `stripJsonBlock`, validators DV360/Adform/TTD.

## Historique

- A4.5 phase 1 : extraction depuis `BiddingCopilot` (cancellé en phase 2)
- A4.5 phase 4 : utilisé par `lib/agent/`
