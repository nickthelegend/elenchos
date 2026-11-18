// The audit panel (bottom right): the verdict for the open file, the four pipeline steps, the evidence the steps
// produced, and the findings. Codicons only, so it reads as part of the editor.
import type { Finding, ToolEvent } from '../api.ts';

export type Verdict = { cls: 'safe' | 'vuln' | 'warn' | 'pending'; icon: string; big: string; sub: string };
type Step = { t: string; st?: ToolEvent['status'] };
const STEP: Record<string, { icon: string; name: string }> = {
  scan: { icon: 'search', name: 'Scan' }, forge: { icon: 'key', name: 'Forge exploit' }, replay: { icon: 'type-hierarchy', name: 'Ask zkVerify' }, attack: { icon: 'debug-alt', name: 'Exploit test' }, patch: { icon: 'tools', name: 'Verify fix' },
};
const short = (h: unknown) => (typeof h === 'string' && h.length > 20 ? `${h.slice(0, 10)}…${h.slice(-6)}` : String(h));

export function AuditPanel({ fileName, verdict, steps, findings, stale, ms, forge, replay, attack, onReveal, running }: {
  fileName: string | null; verdict: Verdict; steps: Step[]; findings: Finding[]; stale: boolean; ms?: number; forge?: ToolEvent; replay?: ToolEvent; attack?: ToolEvent; onReveal: (f: Finding) => void; running: string | null;
}) {
  const counts = { critical: findings.filter((f) => f.severity === 'critical').length, high: findings.filter((f) => f.severity === 'high').length, medium: findings.filter((f) => f.severity === 'medium').length };
  return (
    <section className="ap" aria-label="Audit">
      <header className="sd-head"><span><i className="codicon codicon-shield" />Audit{fileName ? ` · ${fileName}` : ''}</span>{ms != null && !stale && <em>{ms} ms</em>}</header>
      <div className="ap-body">
        <div className={`ap-verdict v-${verdict.cls}`}>
          <i className={`codicon codicon-${verdict.icon} vi`} />
          <div className="vt"><b>{verdict.big}</b><span>{verdict.sub}</span></div>
          {!stale && findings.length > 0 && (
            <div className="ap-counts">
              <span className="c-critical" title="critical"><b>{counts.critical}</b>crit</span>
              <span className="c-high" title="high"><b>{counts.high}</b>high</span>
              <span className="c-medium" title="medium"><b>{counts.medium}</b>med</span>
            </div>
          )}
        </div>
        <ol className="ap-steps" aria-label="Pipeline">
          {steps.map((s, i) => {
            const st = s.t === running ? 'running' : s.st;
            return (
              <li key={s.t} className={`s-${st ?? 'idle'}`}>
                <span className="n">{i + 1}</span><i className={`codicon codicon-${STEP[s.t].icon}`} /><span className="nm">{STEP[s.t].name}</span>
                <i className={`codicon codicon-${st === 'ok' ? 'pass-filled' : st === 'error' ? 'error' : st === 'setup' ? 'warning' : st === 'running' ? 'loading codicon-modifier-spin' : 'circle-large'} si`} />
              </li>
            );
          })}
        </ol>
        {(forge || replay || attack?.detail?.tests) && (
          <dl className="ap-ev">
            {forge?.detail?.ms != null && <div><dt>Forged proof</dt><dd className="bad">{forge.detail.ms} ms · {forge.detail.verifiedLocally ? 'verified locally' : 'unverified'}</dd></div>}
            {forge?.detail?.attackerVkHash && <div><dt>Attacker vkHash</dt><dd>{short(forge.detail.attackerVkHash)}</dd></div>}
            {forge?.detail?.leaf && <div><dt>Forged leaf</dt><dd>{short(forge.detail.leaf)}</dd></div>}
            {replay?.detail?.aggregationId != null && <div><dt>Real aggregation</dt><dd>#{replay.detail.aggregationId} · block {replay.detail.block}</dd></div>}
            {replay?.detail && 'accepted' in replay.detail && <div><dt>{replay.detail.realReceipt ? 'Fresh forged leaf' : 'zkVerify says'}</dt><dd className={replay.detail.accepted ? 'bad' : 'ok'}>{replay.detail.accepted ? 'leaf accepted' : 'leaf not in aggregation'}</dd></div>}
            {replay?.detail?.realReceipt && <div><dt>Attacker’s submitted proof</dt><dd className={replay.detail.realReceipt.accepted ? 'bad' : 'ok'}>{replay.detail.realReceipt.accepted ? `aggregated · #${replay.detail.realReceipt.aggregationId} · verifier says true` : 'not confirmed'}</dd></div>}
            {attack?.detail?.tests && <div><dt>Exploit test</dt><dd className={attack.detail.status === 'exploitable' ? 'bad' : attack.detail.status === 'blocked' ? 'ok' : ''}>{attack.detail.status === 'exploitable' ? `${attack.detail.tests.filter((t: { worked: boolean }) => t.worked).length} attack(s) worked on ${attack.detail.contract}` : attack.detail.status === 'blocked' ? `every attack reverted on ${attack.detail.contract}` : 'did not run'}</dd></div>}
          </dl>
        )}
        {stale && <p className="ap-stale"><i className="codicon codicon-history" />The file changed since this audit. Run it again to refresh.</p>}
        {!stale && findings.length > 0 && (
          <ul className="ap-list">
            {findings.map((f, i) => (
              <li key={i}>
                <button onClick={() => onReveal(f)} className={`f-${f.severity}`}>
                  <i className={`codicon codicon-${f.severity === 'medium' ? 'warning' : 'error'}`} />
                  <span className="r">{f.rule}</span>
                  <span className="t">{f.title}<em>{f.fix}</em></span>
                  <span className="l">L{f.line}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
