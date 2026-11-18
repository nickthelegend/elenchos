// Proof of audit on the report page: the report's sha256 and verdict, proven with the auditor's key, verified by
// zkVerify and aggregated to its verifier contract on Ethereum Sepolia. "Check" recomputes the sha256 in this browser
// from the exact bytes the server anchored, and asks the server to rebuild the leaf and call the Sepolia verifier.
import { useState } from 'react';
import { anchorReport, canonicalReport, checkAnchor, type Anchor, type AnchorCheck } from '../api.ts';

const short = (h: string) => (h.length > 22 ? `${h.slice(0, 10)}…${h.slice(-8)}` : h);
const STEPS: [string, string][] = [['proving', 'Proving the audit'], ['Submitted', 'Sent to zkVerify'], ['IncludedInBlock', 'Verified in a zkVerify block'],
  ['AggregationPending', 'Waiting for aggregation'], ['Aggregated', 'Aggregated'], ['aggregated', 'Readable on Ethereum Sepolia']];

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function ProofOfAudit({ id, anchor, onChange }: { id: string; anchor: Anchor | undefined; onChange: () => void }) {
  const [check, setCheck] = useState<(AnchorCheck & { browserDigest: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const start = async () => { setBusy(true); setErr(null); try { await anchorReport(id); onChange(); } catch (e) { setErr(String((e as Error).message ?? e)); } finally { setBusy(false); } };
  const run = async () => {
    setBusy(true); setErr(null); setCheck(null);
    try {
      const [c, text] = await Promise.all([checkAnchor(id), canonicalReport(id)]);
      setCheck({ ...c, browserDigest: await sha256Hex(text) });
    } catch (e) { setErr(String((e as Error).message ?? e)); } finally { setBusy(false); }
  };

  if (!anchor) return (
    <div className="pa pa-none">
      <p>This report was made before proof of audit existed, so it is not anchored yet.</p>
      <button className="rp-b primary" onClick={start} disabled={busy}><i className="codicon codicon-zap" /><span>{busy ? 'Starting…' : 'Anchor on zkVerify'}</span></button>
      {err && <p className="rp-note bad"><i className="codicon codicon-error" />{err}</p>}
    </div>
  );

  const seen = new Set([anchor.status, ...anchor.statuses.map((s) => s.status)]);
  if (anchor.status === 'aggregated') seen.add('Aggregated');
  if (anchor.status !== 'proving') seen.add('proving');
  if (seen.has('IncludedInBlock') || seen.has('AggregationPending') || seen.has('Aggregated')) seen.add('Submitted');
  const live = anchor.status === 'proving' || anchor.status === 'submitted';
  const done = anchor.status === 'aggregated';
  const tx = anchor.txHash ? `https://zkverify-testnet.subscan.io/extrinsic/${anchor.txHash}` : null;
  const verifier = `https://sepolia.etherscan.io/address/${anchor.verifier}#readProxyContract`;
  const browserOk = check ? check.browserDigest === anchor.digest : null;

  return (
    <div className={`pa ${done ? 'pa-done' : anchor.status === 'failed' ? 'pa-fail' : 'pa-live'}`}>
      <ol className="pa-steps" aria-label="Anchoring progress">
        {STEPS.map(([k, label], i) => {
          const on = seen.has(k); const next = !on && (i === 0 || seen.has(STEPS[i - 1][0]));
          return <li key={k} className={on ? 'on' : next && live ? 'now' : ''}><i className={`codicon codicon-${on ? 'pass-filled' : next && live ? 'loading codicon-modifier-spin' : 'circle-large'}`} /><span>{label}</span></li>;
        })}
      </ol>
      {anchor.status === 'failed' && <p className="rp-note bad"><i className="codicon codicon-error" />Anchoring failed: {anchor.error}<button className="rp-b" onClick={start} disabled={busy}><span>Try again</span></button></p>}
      <dl className="rp-kv pa-kv">
        <div><dt>Verdict proven</dt><dd>{anchor.verdictLabel}</dd></div>
        <div><dt>Report sha256</dt><dd title={anchor.digest}>{short(anchor.digest)}</dd></div>
        <div><dt>Auditor id</dt><dd title={anchor.auditor}>{short(anchor.auditor)}</dd></div>
        <div><dt>zkVerify tx</dt><dd>{tx ? <a href={tx} target="_blank" rel="noreferrer">{short(anchor.txHash!)}</a> : '…'}</dd></div>
        <div><dt>Aggregation</dt><dd>{anchor.aggregationId !== null ? `#${anchor.aggregationId} · domain ${anchor.domainId} · leaf ${anchor.index !== null ? anchor.index + 1 : '?'} of ${anchor.leafCount ?? '?'}` : '…'}</dd></div>
        <div><dt>Verifier</dt><dd><a href={verifier} target="_blank" rel="noreferrer">Sepolia {short(anchor.verifier)}</a></dd></div>
      </dl>
      {done && (
        <div className="pa-check">
          <button className="rp-b primary" onClick={run} disabled={busy}><i className={`codicon codicon-${busy ? 'loading codicon-modifier-spin' : 'shield'}`} /><span>{busy ? 'Checking…' : 'Check it on Sepolia'}</span></button>
          {check && (
            <ul className="pa-res">
              <li className={browserOk ? 'ok' : 'bad'}><i className={`codicon codicon-${browserOk ? 'pass-filled' : 'error'}`} /><span>sha256 recomputed in your browser from the report’s canonical JSON: <code>{short(check.browserDigest)}</code> {browserOk ? 'matches' : 'does NOT match'}</span></li>
              <li className={check.leafMatches ? 'ok' : 'bad'}><i className={`codicon codicon-${check.leafMatches ? 'pass-filled' : 'error'}`} /><span>Statement leaf rebuilt from it: <code>{short(check.leaf)}</code></span></li>
              <li className={check.accepted ? 'ok' : 'bad'}><i className={`codicon codicon-${check.accepted ? 'pass-filled' : 'error'}`} /><span>zkVerify’s verifier on Sepolia, <code>verifyProofAggregation</code>(domain {check.domainId}, aggregation {check.aggregationId}, leaf): <b>{check.accepted ? 'true' : 'false'}</b></span></li>
            </ul>
          )}
        </div>
      )}
      {err && <p className="rp-note bad"><i className="codicon codicon-error" />{err}</p>}
    </div>
  );
}
