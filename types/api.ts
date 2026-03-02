/**
 * GENESIS — API types
 *
 * Types pour les appels Mistral AI et les structures
 * communes aux routes API.
 */

// ---------------------------------------------------------------------------
// Mistral AI
// ---------------------------------------------------------------------------

export interface MistralToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface MistralMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: MistralToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface MistralResponse {
  choices: {
    message: MistralMessage;
    finish_reason: 'stop' | 'tool_calls' | 'length';
  }[];
}

