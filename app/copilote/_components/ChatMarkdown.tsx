'use client';

import { Fragment, type ReactNode } from 'react';

/**
 * Lightweight inline Markdown renderer for the chat panel.
 * Supports: **bold**, *italic*, [links](url), `code`, numbered lists, bullets.
 * No external dependency.
 */

function parseInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Regex: **bold**, *italic*, [text](url), `code`
  const re = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(`([^`]+)`)/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2]) {
      // **bold**
      nodes.push(<strong key={key++} style={{ color: '#fff', fontWeight: 600 }}>{m[2]}</strong>);
    } else if (m[4]) {
      // *italic*
      nodes.push(<em key={key++}>{m[4]}</em>);
    } else if (m[6] && m[7]) {
      // [text](url)
      nodes.push(
        <a key={key++} href={m[7]} target="_blank" rel="noopener noreferrer"
          style={{ color: '#60a5fa', textDecoration: 'underline', textUnderlineOffset: 2 }}>
          {m[6]}
        </a>
      );
    } else if (m[9]) {
      // `code`
      nodes.push(
        <code key={key++} style={{ background: 'rgba(255,255,255,0.1)', padding: '1px 5px', borderRadius: 3, fontSize: '0.92em', fontFamily: 'JetBrains Mono, monospace' }}>
          {m[9]}
        </code>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function ChatMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: ReactNode[] = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Empty line → spacer
    if (!trimmed) {
      elements.push(<div key={key++} style={{ height: 6 }} />);
      continue;
    }

    // Numbered list: "1. ", "2. ", etc.
    const numMatch = trimmed.match(/^(\d+)\.\s+(.+)/);
    if (numMatch) {
      elements.push(
        <div key={key++} style={{ display: 'flex', gap: 8, marginBottom: 3, paddingLeft: 4 }}>
          <span style={{ color: 'rgba(255,255,255,0.35)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, minWidth: 16, textAlign: 'right' }}>{numMatch[1]}.</span>
          <span style={{ flex: 1 }}>{parseInline(numMatch[2])}</span>
        </div>
      );
      continue;
    }

    // Bullet: "- " or "* " or "• "
    const bulletMatch = trimmed.match(/^[-*•]\s+(.+)/);
    if (bulletMatch) {
      // Indented sub-bullet
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      elements.push(
        <div key={key++} style={{ display: 'flex', gap: 6, marginBottom: 2, paddingLeft: indent > 2 ? 20 : 4 }}>
          <span style={{ color: indent > 2 ? '#3dbdb5' : '#4ecdc4', fontSize: 8, marginTop: 5 }}>●</span>
          <span style={{ flex: 1 }}>{parseInline(bulletMatch[1])}</span>
        </div>
      );
      continue;
    }

    // Regular paragraph
    elements.push(
      <div key={key++} style={{ marginBottom: 3 }}>
        {parseInline(trimmed)}
      </div>
    );
  }

  return <Fragment>{elements}</Fragment>;
}
