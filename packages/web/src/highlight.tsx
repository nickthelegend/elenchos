// A small, safe Solidity highlighter for the read-only evidence pane. It escapes everything and only wraps known
// token classes — no innerHTML from untrusted source. Returns React nodes per line so we can highlight a line.
import { Fragment, type ReactNode } from 'react';

const KEYWORDS = /\b(pragma|solidity|contract|abstract|interface|library|is|function|constructor|modifier|event|error|struct|enum|mapping|returns|return|public|external|internal|private|view|pure|payable|immutable|constant|memory|storage|calldata|indexed|emit|require|revert|if|else|for|while|new|using|override|virtual|import|from|assembly|unchecked)\b/;
const TYPES = /\b(address|bool|string|bytes\d*|uint\d*|int\d*)\b/;
const NUM = /\b(0x[0-9a-fA-F]+|\d+)\b/;

type Tok = { cls: string; text: string };

function tokenizeLine(line: string): Tok[] {
  const out: Tok[] = [];
  const ci = line.indexOf('//');
  let code = line, comment = '';
  if (ci >= 0) { code = line.slice(0, ci); comment = line.slice(ci); }
  const re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_]\w*|0x[0-9a-fA-F]+|\d+|\s+|[^\w\s])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const t = m[0];
    if (/^\s+$/.test(t)) out.push({ cls: 'ws', text: t });
    else if (/^["']/.test(t)) out.push({ cls: 'str', text: t });
    else if (KEYWORDS.test(t)) out.push({ cls: 'kw', text: t });
    else if (TYPES.test(t)) out.push({ cls: 'ty', text: t });
    else if (NUM.test(t)) out.push({ cls: 'num', text: t });
    else if (/^[A-Za-z_]\w*$/.test(t)) out.push({ cls: 'id', text: t });
    else out.push({ cls: 'punct', text: t });
  }
  if (comment) out.push({ cls: 'cm', text: comment });
  return out;
}

export function Code({ source, flagged = new Set<number>() }: { source: string; flagged?: Set<number> }): ReactNode {
  const lines = source.replace(/\n$/, '').split('\n');
  return (
    <div className="code" role="group" aria-label="contract source">
      {lines.map((ln, i) => (
        <div key={i} className={`code-line${flagged.has(i + 1) ? ' flagged' : ''}`}>
          <span className="ln">{i + 1}</span>
          <span className="lc">{tokenizeLine(ln).map((t, j) => <span key={j} className={`t-${t.cls}`}>{t.text}</span>)}</span>
        </div>
      ))}
    </div>
  );
}

// A minimal line diff (LCS) for the patch view: marks added / removed lines.
export function Diff({ before, after }: { before: string; after: string }): ReactNode {
  const a = before.replace(/\n$/, '').split('\n');
  const b = after.replace(/\n$/, '').split('\n');
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const rows: { sign: ' ' | '-' | '+'; text: string }[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { rows.push({ sign: ' ', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ sign: '-', text: a[i] }); i++; }
    else { rows.push({ sign: '+', text: b[j] }); j++; }
  }
  while (i < n) rows.push({ sign: '-', text: a[i++] });
  while (j < m) rows.push({ sign: '+', text: b[j++] });
  return (
    <div className="code diff" role="group" aria-label="proposed patch diff">
      {rows.map((r, k) => (
        <div key={k} className={`code-line d-${r.sign === '+' ? 'add' : r.sign === '-' ? 'del' : 'ctx'}`}>
          <span className="ln">{r.sign}</span>
          <span className="lc">{tokenizeLine(r.text).map((t, x) => <span key={x} className={`t-${t.cls}`}>{t.text}</span>)}</span>
        </div>
      ))}
    </div>
  );
}
