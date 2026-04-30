import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, interpolate, formatList } from '@/lib/prompting/system-prompt-builder';

describe('buildSystemPrompt', () => {
  it('renders role only when nothing else provided', () => {
    const out = buildSystemPrompt({ role: 'I am an assistant.' });
    expect(out).toBe('I am an assistant.');
  });

  it('renders sections with ## headings', () => {
    const out = buildSystemPrompt({
      role: 'Role.',
      sections: [
        { title: 'Section A', body: 'body A' },
        { title: 'Section B', body: 'body B' },
      ],
    });
    expect(out).toContain('## Section A\nbody A');
    expect(out).toContain('## Section B\nbody B');
  });

  it('renders instructions as bullets under "## Instructions"', () => {
    const out = buildSystemPrompt({
      role: 'Role.',
      instructions: ['Be concise', 'Cite sources'],
    });
    expect(out).toMatch(/## Instructions\n- Be concise\n- Cite sources/);
  });

  it('renders output_schema under "## Format de sortie"', () => {
    const out = buildSystemPrompt({
      role: 'Role.',
      output_schema: '```json\n{}\n```',
    });
    expect(out).toContain('## Format de sortie');
    expect(out).toContain('```json\n{}\n```');
  });

  it('preserves order: role → sections → instructions → output', () => {
    const out = buildSystemPrompt({
      role: 'R',
      sections: [{ title: 'S', body: 'sb' }],
      instructions: ['I'],
      output_schema: 'O',
    });
    expect(out.indexOf('R')).toBeLessThan(out.indexOf('## S'));
    expect(out.indexOf('## S')).toBeLessThan(out.indexOf('## Instructions'));
    expect(out.indexOf('## Instructions')).toBeLessThan(out.indexOf('## Format de sortie'));
  });
});

describe('interpolate', () => {
  it('replaces {{var}} with string', () => {
    expect(interpolate('Hello {{name}}', { name: 'World' })).toBe('Hello World');
  });

  it('replaces {{var}} with number coerced to string', () => {
    expect(interpolate('Count: {{n}}', { n: 42 })).toBe('Count: 42');
  });

  it('handles dotted paths', () => {
    expect(interpolate('User: {{user.name}}', { user: { name: 'Alice' } })).toBe('User: Alice');
  });

  it('renders null as empty string', () => {
    expect(interpolate('Val: [{{v}}]', { v: null })).toBe('Val: []');
  });

  it('throws on undefined variable', () => {
    expect(() => interpolate('{{missing}}', {})).toThrowError(/missing/);
  });

  it('serializes objects to JSON', () => {
    expect(interpolate('Data: {{x}}', { x: { a: 1 } })).toBe('Data: {"a":1}');
  });
});

describe('formatList', () => {
  it('formats items as indented bullets', () => {
    const out = formatList([1, 2, 3], n => `n=${n}`);
    expect(out).toBe('  - n=1\n  - n=2\n  - n=3');
  });

  it('returns "(aucun)" for empty list by default', () => {
    expect(formatList([], () => '')).toBe('  (aucun)');
  });

  it('uses custom emptyText', () => {
    expect(formatList([], () => '', 'rien')).toBe('  rien');
  });
});
