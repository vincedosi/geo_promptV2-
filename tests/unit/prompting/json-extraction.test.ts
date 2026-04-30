import { describe, expect, it } from 'vitest';
import {
  extractJsonBlock, extractJSON, stripJsonBlock,
} from '@/lib/prompting/json-extraction';
import { JsonExtractionError } from '@/lib/prompting/types';

describe('extractJsonBlock', () => {
  it('parses fenced ```json block', () => {
    const text = 'Voici le résultat.\n\n```json\n{ "a": 1, "b": "x" }\n```\nMerci.';
    const out = extractJsonBlock<{ a: number; b: string }>(text);
    expect(out).toEqual({ a: 1, b: 'x' });
  });

  it('returns null when no fenced block', () => {
    expect(extractJsonBlock('Pas de bloc JSON ici.')).toBeNull();
  });

  it('throws JsonExtractionError on malformed JSON inside fence', () => {
    const text = '```json\n{ a: 1 }\n```';
    expect(() => extractJsonBlock(text)).toThrowError(JsonExtractionError);
  });

  it('handles multiline JSON', () => {
    const text = `prefix\n\n\`\`\`json\n{\n  "list": [1, 2, 3],\n  "nested": { "key": "value" }\n}\n\`\`\``;
    const out = extractJsonBlock<{ list: number[]; nested: { key: string } }>(text);
    expect(out?.list).toEqual([1, 2, 3]);
    expect(out?.nested.key).toBe('value');
  });
});

describe('extractJSON', () => {
  it('falls back to direct parse when no fence and text starts with {', () => {
    expect(extractJSON('{"foo": 42}')).toEqual({ foo: 42 });
  });

  it('falls back to direct parse for arrays', () => {
    expect(extractJSON('[1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('returns null when no JSON shape detectable', () => {
    expect(extractJSON('just plain text')).toBeNull();
  });

  it('prefers fenced block over inline json', () => {
    const text = '{"inline": true}\n```json\n{"fenced": true}\n```';
    expect(extractJSON(text)).toEqual({ fenced: true });
  });
});

describe('stripJsonBlock', () => {
  it('removes ```json … ``` block', () => {
    const text = 'before\n```json\n{"x":1}\n```\nafter';
    expect(stripJsonBlock(text)).toBe('before\n\nafter');
  });

  it('removes multiple blocks', () => {
    const text = '```json\n{}\n```\nmiddle\n```json\n[]\n```';
    expect(stripJsonBlock(text)).toContain('middle');
    expect(stripJsonBlock(text)).not.toContain('json');
  });

  it('returns trimmed text when no block', () => {
    expect(stripJsonBlock('  hello  ')).toBe('hello');
  });
});
