// The agent's replies are short Markdown: paragraphs, "- " bullets, "1. " numbered lists, **bold** and `code`. This renders exactly that
// subset as React elements (no HTML strings, so nothing in a reply can inject markup). Anything else stays plain text.
import { Fragment, type ReactNode } from 'react';

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*(?:(?!\*\*)[^\n])+\*\*|`[^`\n]+`)/g;
  let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${key}-${i++}`;
    out.push(tok.startsWith('**') ? <strong key={k}>{inline(tok.slice(2, -2), k)}</strong> : <code key={k}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let ordered = false;
  let para: string[] = [];
  const flushPara = () => { if (para.length) { const k = `p${blocks.length}`; blocks.push(<p key={k}>{inline(para.join(' '), k)}</p>); para = []; } };
  const flushList = () => {
    if (!list.length) return;
    const k = `l${blocks.length}`;
    const items = list.map((li, j) => <li key={j}>{inline(li, `${k}-${j}`)}</li>);
    blocks.push(ordered ? <ol key={k}>{items}</ol> : <ul key={k}>{items}</ul>);
    list = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || num) {
      flushPara();
      if (list.length && ordered !== Boolean(num)) flushList();
      ordered = Boolean(num);
      list.push((bullet ?? num)![1]);
    }
    else if (!line.trim()) { flushPara(); flushList(); }
    else { flushList(); para.push(line.trim()); }
  }
  flushPara(); flushList();
  return <Fragment>{blocks}</Fragment>;
}
