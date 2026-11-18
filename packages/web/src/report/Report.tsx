// A shareable Elenchos report: #/r/<id>. Everything shown here was produced by the Elenchos server on this exact source
// (scan, exploit test, fix verification); the page only renders it and offers Markdown, SARIF and JSON exports.
import { useEffect, useMemo, useState } from 'react';
import '@vscode/codicons/dist/codicon.css';
import { API_BASE, getReport, type Report as R, type AttackResult } from '../api.ts';
import { Mark } from '../icons.tsx';
import { ProofOfAudit } from './Anchor.tsx';
import './report.css';

function headline(r: R): { cls: 'bad' | 'ok' | 'warn' | 'dim'; icon: string; big: string; sub: string } {
  const crit = r.findings.filter((f) => f.severity === 'critical').length;
  if (r.fix?.verified && r.fix.attack?.status !== 'exploitable') return { cls: 'ok', icon: 'verified-filled', big: 'Fix verified', sub: `${r.findings.length} finding${r.findings.length === 1 ? '' : 's'} in the original; the fix compiles, scans clean${r.fix.attack?.status === 'blocked' ? ', and every attack now reverts' : ''}.` };
  if (r.attack?.status === 'exploitable') return { cls: 'bad', icon: 'error', big: 'Exploit proven', sub: r.attack.network?.kind === 'sepolia-fork' ? 'The exploit test paid the attacker on a Sepolia fork, against zkVerify’s real verifier, with a receipt zkVerify really aggregated.' : 'The exploit test paid the attacker on a local EVM, with a real forged proof.' };
  if (crit) return { cls: 'bad', icon: 'error', big: `${crit} critical`, sub: 'A critical hole lets an attacker’s proof through.' };
  if (r.findings.length) return { cls: 'warn', icon: 'warning', big: `${r.findings.length} to fix`, sub: 'No critical hole, but these need a fix.' };
  if (r.compileError) return { cls: 'dim', icon: 'warning', big: 'Does not compile', sub: r.compileError };
  return { cls: 'ok', icon: 'pass-filled', big: 'No holes found', sub: 'None of E1, E1b, E3, E4, E6, and no stock attack worked.' };
}

const short = (h: string) => (h.length > 22 ? `${h.slice(0, 10)}…${h.slice(-8)}` : h);
const pretty = (n: string) => n.replace('test_attack_', '').replace(/_/g, ' ');
function download(name: string, type: string, text: string) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.appendChild(a); a.click(); a.remove();
}

/** A line diff (LCS) of the original against the fix. */
function diff(a: string, b: string): { t: ' ' | '-' | '+'; s: string }[] {
  const x = a.split('\n'); const y = b.split('\n'); const n = x.length; const m = y.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: { t: ' ' | '-' | '+'; s: string }[] = []; let i = 0; let j = 0;
  while (i < n && j < m) { if (x[i] === y[j]) { out.push({ t: ' ', s: x[i] }); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: '-', s: x[i++] }); else out.push({ t: '+', s: y[j++] }); }
  while (i < n) out.push({ t: '-', s: x[i++] }); while (j < m) out.push({ t: '+', s: y[j++] });
  return out;
}
/** Only the changed lines, with two lines of context around each change. */
function hunks(d: ReturnType<typeof diff>) {
  const keep = d.map((l, i) => l.t !== ' ' || d.slice(Math.max(0, i - 2), i + 3).some((k) => k.t !== ' '));
  const out: ({ t: ' ' | '-' | '+'; s: string } | null)[] = [];
  d.forEach((l, i) => { if (keep[i]) out.push(l); else if (out[out.length - 1] !== null) out.push(null); });
  return out;
}

function markdown(r: R, link: string): string {
  const h = headline(r);
  const lines = [`# Elenchos report: ${r.title}`, '', `**${h.big}.** ${h.sub}`, '', `- Report: ${link}`, `- Created: ${r.createdAt}`, `- Source sha256: \`${r.sha256}\``];
  if (r.repo) lines.push(r.repo.explorer ? `- Deployed contract: ${r.repo.repo} (${r.repo.explorer}), \`${r.repo.path}\`` : `- Repository: https://github.com/${r.repo.repo} @ \`${r.repo.sha.slice(0, 12)}\`, \`${r.repo.path}\``);
  lines.push(`- Engine: ${r.engine}`, '', '## Findings', '');
  if (!r.findings.length) lines.push('None.');
  else { lines.push('| Rule | Severity | Where | Finding | Fix |', '|---|---|---|---|---|'); for (const f of r.findings) lines.push(`| ${f.rule} | ${f.severity} | \`${f.function.split('(')[0]}\` line ${f.line} | ${f.title} | ${f.fix} |`); }
  const att = (a: AttackResult | null, label: string) => { if (!a) return; lines.push('', `## Exploit test (${label})`, '', a.summary, ''); for (const t of a.tests.filter((t) => t.name.startsWith('test_attack'))) lines.push(`- ${t.worked ? 'WORKED' : 'blocked'}: ${pretty(t.name)}${t.reason ? ` (${t.reason})` : ''}${t.logs.length ? ` · ${t.logs.join('; ')}` : ''}`); };
  att(r.attack, 'original');
  if (r.fix) { lines.push('', '## Fix', '', `${r.fix.verified ? 'Verified' : 'Rejected'}: ${r.fix.reason}`, `- Fix sha256: \`${r.fix.sha256}\``); att(r.fix.attack, 'with the fix'); }
  if (r.forgery) lines.push('', '## Forged proof used', '', `- Attacker vk hash (from a zkVerify node): \`${r.forgery.vkHash}\``, `- zkVerify leaf: \`${r.forgery.leaf}\``, `- Public inputs: ${r.forgery.inputs.join(', ')}`);
  const a = r.anchor;
  if (a?.status === 'aggregated') lines.push('', '## Proof of audit (zkVerify)', '', `- Verdict proven: ${a.verdictLabel}`, `- Report sha256 (canonical JSON): \`${a.digest}\``, `- Auditor id: \`${a.auditor}\``,
    `- zkVerify tx: https://zkverify-testnet.subscan.io/extrinsic/${a.txHash}`, `- Aggregation #${a.aggregationId}, domain ${a.domainId}, leaf \`${a.leaf}\``, `- Check: \`verifyProofAggregation\` on Sepolia ${a.verifier}`);
  lines.push('', '---', `Every result above was produced by the Elenchos server on the source with this sha256. ${link}`);
  return lines.join('\n');
}

function sarif(r: R): string {
  const uri = r.repo?.path ?? r.title;
  return JSON.stringify({
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json', version: '2.1.0',
    runs: [{ tool: { driver: { name: 'Elenchos', informationUri: 'https://github.com/nickthelegend/elenchos', rules: [...new Set(r.findings.map((f) => f.rule))].map((id) => ({ id, shortDescription: { text: r.findings.find((f) => f.rule === id)!.title } })) } },
      results: r.findings.map((f) => ({ ruleId: f.rule, level: f.severity === 'medium' ? 'warning' : 'error', message: { text: `${f.title}. ${f.evidence} Fix: ${f.fix}` },
        locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine: f.line } } }] })) }],
  }, null, 2);
}

export function ReportPage({ id }: { id: string }) {
  const [r, setR] = useState<R | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showSrc, setShowSrc] = useState(false);
  const load = () => getReport(id).then(setR, (e) => setErr(String(e.message ?? e)));
  useEffect(() => { document.title = 'Report · Elenchos'; load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  // While the report is being anchored on zkVerify, follow its progress.
  const anchoring = r?.anchor?.status === 'proving' || r?.anchor?.status === 'submitted';
  useEffect(() => { if (!anchoring) return; const t = setInterval(load, 4000); return () => clearInterval(t); }, [anchoring, id]); // eslint-disable-line react-hooks/exhaustive-deps
  const link = `${window.location.origin}${window.location.pathname}#/r/${id}`;
  const badgeUrl = `${API_BASE || window.location.origin}/api/badge/${id}.svg`;
  const badgeMd = `[![Elenchos](${badgeUrl})](${link})`;
  const d = useMemo(() => (r?.fix ? hunks(diff(r.source, r.fix.source)) : []), [r]);
  const copy = (k: string, t: string) => navigator.clipboard.writeText(t).then(() => { setCopied(k); setTimeout(() => setCopied(null), 1600); }, () => setCopied(null));

  const top = (
    <header className="rp-top">
      <a href="#/" className="rp-brand"><Mark size={22} /><span>Elenchos</span><em>Report</em></a>
      <span className="grow" />
      {r && <>
        <button className="rp-b" onClick={() => copy('link', link)}><i className={`codicon codicon-${copied === 'link' ? 'check' : 'link'}`} /><span>{copied === 'link' ? 'Copied' : 'Copy link'}</span></button>
        <button className="rp-b hide-s" onClick={() => download(`elenchos-${id}.md`, 'text/markdown', markdown(r, link))}><i className="codicon codicon-markdown" /><span>Markdown</span></button>
        <button className="rp-b hide-s" onClick={() => download(`elenchos-${id}.sarif`, 'application/json', sarif(r))}><i className="codicon codicon-json" /><span>SARIF</span></button>
        <a className="rp-b primary" href={`#/app?report=${id}`}><i className="codicon codicon-code" /><span>Open in studio</span></a>
      </>}
    </header>
  );
  if (err) return <div className="rp">{top}<main className="rp-in"><div className="rp-empty"><i className="codicon codicon-error" /><h1>Report unavailable</h1><p>{err}</p><a className="rp-b primary" href="#/app">Open the studio</a></div></main></div>;
  if (!r) return <div className="rp">{top}<main className="rp-in"><div className="rp-empty"><span className="rp-spin" /><p>Loading the report…</p></div></main></div>;

  const h = headline(r);
  const counts = (['critical', 'high', 'medium'] as const).map((s) => [s, r.findings.filter((f) => f.severity === s).length] as const);
  return (
    <div className="rp">
      {top}
      <main className="rp-in">
        <section className={`rp-hero v-${h.cls}`}>
          <div className="rp-verdict"><i className={`codicon codicon-${h.icon}`} /><div><b>{h.big}</b><p>{h.sub}</p></div></div>
          <h1>{r.title}</h1>
          <dl className="rp-meta">
            <div><dt>Created</dt><dd>{new Date(r.createdAt).toLocaleString()}</dd></div>
            <div><dt>Source sha256</dt><dd title={r.sha256}>{short(r.sha256)}</dd></div>
            {r.repo && (r.repo.explorer
              ? <div><dt>Deployed at</dt><dd><a href={r.repo.explorer} target="_blank" rel="noreferrer">{r.repo.repo}</a></dd></div>
              : <div><dt>Repository</dt><dd><a href={`https://github.com/${r.repo.repo}/blob/${r.repo.sha}/${r.repo.path}`} target="_blank" rel="noreferrer">{r.repo.repo}@{r.repo.sha.slice(0, 7)}</a></dd></div>)}
            <div><dt>Report id</dt><dd>{r.id}</dd></div>
          </dl>
        </section>

        <section className="rp-cards">
          <div className="rp-card"><span>Findings</span><b>{r.findings.length}</b><em className="sev">{counts.map(([s, n]) => <i key={s} className={`s-${s}`}>{n} {s}</i>)}</em></div>
          <div className={`rp-card ${r.attack?.status === 'exploitable' ? 'bad' : r.attack?.status === 'blocked' ? 'ok' : ''}`}><span>Exploit test · original</span><b>{r.attack ? (r.attack.status === 'exploitable' ? 'Attacker paid' : r.attack.status === 'blocked' ? 'Blocked' : 'Not run') : 'Not run'}</b><em>{r.attack?.tests.length ? `${r.attack.tests.filter((t) => t.worked).length} of ${r.attack.tests.length} attacks worked` : r.attack?.summary ?? 'does not compile'}</em></div>
          <div className={`rp-card ${r.fix ? (r.fix.verified ? 'ok' : 'bad') : ''}`}><span>Fix</span><b>{r.fix ? (r.fix.verified ? 'Verified' : 'Rejected') : 'None attached'}</b><em>{r.fix ? (r.fix.attack ? (r.fix.attack.status === 'blocked' ? 'every attack reverts' : r.fix.attack.status === 'exploitable' ? 'an attack still works' : 'exploit test did not run') : r.fix.reason) : 'Apply a verified fix in the studio, then share again'}</em></div>
        </section>

        <section className="rp-sec">
          <h2><i className="codicon codicon-search" />Findings</h2>
          {r.compileError && <p className="rp-note bad">{r.compileError}</p>}
          {!r.findings.length && !r.compileError && <p className="rp-note ok">No findings: none of the five holes (E1, E1b, E3, E4, E6) and nothing Slither flags as critical.</p>}
          <ol className="rp-findings">
            {r.findings.map((f, i) => (
              <li key={i} className={`f-${f.severity}`}>
                <div className="fh"><span className="rule">{f.rule}</span><span className="sev">{f.severity}</span><b>{f.title}</b><code>{f.function.split('(')[0]} · line {f.line}</code></div>
                <p>{f.evidence}</p>
                <p className="fix"><i className="codicon codicon-lightbulb" />{f.fix}</p>
              </li>
            ))}
          </ol>
        </section>

        {(r.attack || r.fix?.attack) && (
          <section className="rp-sec">
            <h2><i className="codicon codicon-debug-alt" />Exploit test</h2>
            {r.attack?.network?.kind === 'sepolia-fork'
              ? <p className="rp-lead">A Foundry test on a fork of Ethereum Sepolia, against <a href={`https://sepolia.etherscan.io/address/${r.attack.network.verifier}`} target="_blank" rel="noreferrer">zkVerify’s real verifier contract</a>. The attacker’s receipt is real: zkVerify verified a Groth16 proof of the attacker’s own circuit and aggregated it to Sepolia (aggregation #{r.attack.network.aggregationId}{r.attack.network.forgedTx && <>, <a href={`https://zkverify-testnet.subscan.io/extrinsic/${r.attack.network.forgedTx}`} target="_blank" rel="noreferrer">zkVerify tx</a></>}). Each attack asserts that the attacker got paid.</p>
              : <p className="rp-lead">A Foundry test on a local EVM. The forged receipt is real: a Groth16 proof from an attacker circuit, with its vk hash read from a zkVerify node. A stand-in aggregation vouches only for leaves that were really aggregated. Each attack asserts that the attacker got paid.{r.attack?.forkError && ` ${r.attack.forkError}`}</p>}
            <div className={`rp-att${r.fix?.attack ? ' two' : ''}`}>
              {[['Original', r.attack], ...(r.fix?.attack ? [['With the fix', r.fix.attack]] : [])].map(([label, a]) => a && typeof a !== 'string' && (
                <div key={label as string} className={`rp-attcol a-${a.status}`}>
                  <h3>{label as string}<em>{a.status === 'exploitable' ? 'attacker paid' : a.status === 'blocked' ? 'all reverted' : 'did not run'}</em></h3>
                  {a.compileError && <pre className="rp-err">{a.compileError}</pre>}
                  {!a.tests.length && !a.compileError && <p className="rp-note">{a.summary}</p>}
                  <ul>
                    {a.tests.filter((t) => t.name.startsWith('test_attack')).map((t) => (
                      <li key={t.name} className={t.worked ? 'w' : 'b'}>
                        <i className={`codicon codicon-${t.worked ? 'error' : 'shield'}`} />
                        <div><b>{pretty(t.name)}</b><span>{t.worked ? 'worked' : `reverted · ${t.reason}`}</span>{t.logs.map((l, k) => <code key={k}>{l}</code>)}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            {r.forgery && (
              <dl className="rp-kv">
                <div><dt>Attacker vk hash</dt><dd title={r.forgery.vkHash}>{short(r.forgery.vkHash)}</dd></div>
                <div><dt>zkVerify leaf</dt><dd title={r.forgery.leaf}>{short(r.forgery.leaf)}</dd></div>
                <div><dt>Public inputs</dt><dd>{r.forgery.inputs.map((x) => short(x)).join(' · ')}</dd></div>
              </dl>
            )}
            {r.attack?.testSource && <details className="rp-src"><summary>Exploit test source</summary><pre>{r.attack.testSource}</pre></details>}
          </section>
        )}

        {r.fix && (
          <section className="rp-sec">
            <h2><i className="codicon codicon-tools" />Fix</h2>
            <p className={`rp-note ${r.fix.verified ? 'ok' : 'bad'}`}><i className={`codicon codicon-${r.fix.verified ? 'pass-filled' : 'error'}`} />{r.fix.verified ? 'Verified' : 'Rejected'}: {r.fix.reason}</p>
            <pre className="rp-diff">{d.map((l, i) => (l === null ? <span key={i} className="gap">⋯</span> : <span key={i} className={l.t === '+' ? 'add' : l.t === '-' ? 'del' : ''}>{l.t} {l.s}{'\n'}</span>))}</pre>
          </section>
        )}

        <section className="rp-sec">
          <h2><i className="codicon codicon-zap" />Proof of audit on zkVerify</h2>
          <p className="rp-lead">The Elenchos auditor proves this report’s sha256 and verdict in a zero-knowledge proof. zkVerify verifies it and aggregates it to its verifier contract on Ethereum Sepolia, so anyone can check that this exact report was published by this auditor, unchanged, at this time.</p>
          <ProofOfAudit id={r.id} anchor={r.anchor} onChange={load} />
        </section>

        <section className="rp-sec">
          <h2><i className="codicon codicon-verified" />Badge</h2>
          <p className="rp-lead">Put this in your README. It links back here and always shows this report’s result.</p>
          <div className="rp-badge"><img src={badgeUrl} alt={`Elenchos: ${h.big}`} height={20} /><code>{badgeMd}</code><button className="rp-b" onClick={() => copy('badge', badgeMd)}><i className={`codicon codicon-${copied === 'badge' ? 'check' : 'copy'}`} /><span>{copied === 'badge' ? 'Copied' : 'Copy'}</span></button></div>
        </section>

        <section className="rp-sec">
          <button className="rp-b" onClick={() => setShowSrc(!showSrc)} aria-expanded={showSrc}><i className={`codicon codicon-chevron-${showSrc ? 'down' : 'right'}`} /><span>Audited source ({r.source.split('\n').length} lines)</span></button>
          {showSrc && <pre className="rp-code">{r.source}</pre>}
        </section>

        <footer className="rp-foot"><i className="codicon codicon-shield" /><span>Every result on this page was produced by the Elenchos server on the source with sha256 <code>{short(r.sha256)}</code>. Nothing was entered by hand. Engine: {r.engine}.</span></footer>
      </main>
    </div>
  );
}
