// The agent's replies are short Markdown: paragraphs, headings, "- " bullets, "1. " lists, fenced code, **bold** and
// `code`. This renders exactly that subset as React elements (no HTML strings, so nothing in a reply can inject
// markup). Anything else stays plain text.
import { Fragment, useState, type ReactNode } from 'react';

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

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span>{lang || 'text'}</span>
        <button type="button" onClick={() => navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }).catch(() => {})}
          aria-label="Copy code"><i className={`codicon codicon-${copied ? 'check' : 'copy'}`} />{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let ordered = false;
  let para: string[] = [];
  let fence: { lang: string; lines: string[] } | null = null;
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
    if (fence) {
      if (/^\s*```/.test(line)) { blocks.push(<CodeBlock key={`c${blocks.length}`} lang={fence.lang} code={fence.lines.join('\n')} />); fence = null; }
      else fence.lines.push(raw);
      continue;
    }
    const open = /^\s*```\s*([A-Za-z0-9_+-]*)/.exec(line);
    if (open) { flushPara(); flushList(); fence = { lang: open[1], lines: [] }; continue; }
    const head = /^\s*(#{1,4})\s+(.*)$/.exec(line);
    if (head) { flushPara(); flushList(); const k = `h${blocks.length}`; blocks.push(<h4 key={k}>{inline(head[2], k)}</h4>); continue; }
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
  if (fence) blocks.push(<CodeBlock key={`c${blocks.length}`} lang={fence.lang} code={fence.lines.join('\n')} />); // still streaming
  flushPara(); flushList();
  return <Fragment>{blocks}</Fragment>;
}
