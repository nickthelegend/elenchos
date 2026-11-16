import { useEffect, useMemo, useRef, useState } from 'react';
import { getTargets, investigate, type AgentEvent, type Ready, type Target, type ToolEvent, type Turn } from './api.ts';
import { Code, Diff } from './highlight.tsx';
import { Logo, ToolIcon } from './icons.tsx';
import { Markdown } from './markdown.tsx';

type Finding = { rule: string; severity: 'critical' | 'high' | 'medium'; title: string; function: string; line: number; evidence: string; fix: string };
type Entry =
  | { kind: 'user'; text: string }
  | { kind: 'agent'; text: string }
  | { kind: 'tool'; event: ToolEvent }
  | { kind: 'review'; status: string; text: string };

const PRESETS = [
  'Find every hole, prove the impact, then propose and verify a fix.',
  'Is the verification key pinned? Show me what happens if it is not.',
  'Just scan it and rank the findings.',
];
const READY_LABEL: Record<keyof Ready, string> = { anthropic: 'claude', openai: 'openai review', rpc: 'sepolia rpc', kurier: 'kurier' };

export function App() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [ready, setReady] = useState<Ready | null>(null);
  const [sel, setSel] = useState(0);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [running, setRunning] = useState(false);
  const [input, setInput] = useState('');
  const [tab, setTab] = useState<'evidence' | 'diff'>('evidence');
  const [mtab, setMtab] = useState<'chat' | 'evidence' | 'case'>('chat');
  const [loadError, setLoadError] = useState<string | null>(null);
  const abortRef = useRef<() => void>();
  const bodyRef = useRef<HTMLDivElement>(null);

  const load = () => { setLoadError(null); getTargets().then((d) => { setTargets(d.targets); setReady(d.ready); }).catch((e) => setLoadError(String(e?.message ?? e))); };
  useEffect(load, []);
  const target = targets[sel];
  useEffect(() => { setEntries([]); setTab('evidence'); }, [sel]);
  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' }); }, [entries]);

  const findings = useMemo(() => {
    const last = [...entries].reverse().find((e) => e.kind === 'tool' && e.event.tool === 'scan' && Array.isArray(e.event.detail)) as any;
    return (last?.event.detail ?? []) as Finding[];
  }, [entries]);
  const scanned = entries.some((e) => e.kind === 'tool' && e.event.tool === 'scan' && e.event.status === 'ok');
  const flagged = useMemo(() => new Set(findings.map((f) => f.line)), [findings]);
  const patch = useMemo(() => {
    const last = [...entries].reverse().find((e) => e.kind === 'tool' && e.event.tool === 'patch' && e.event.detail?.patchedSource) as any;
    return last?.event as ToolEvent | undefined;
  }, [entries]);
  useEffect(() => { if (patch?.detail?.patchedSource) setTab('diff'); }, [patch]);

  const steps = useMemo(() => {
    const seen = (t: string) => entries.some((e) => e.kind === 'tool' && e.event.tool === t);
    const okd = (t: string) => entries.some((e) => e.kind === 'tool' && e.event.tool === t && (e.event.status === 'ok' || e.event.status === 'setup'));
    const order = ['scan', 'forge', 'replay', 'patch'];
    const activeIdx = running ? order.findIndex((t) => !okd(t)) : -1;
    return order.map((t, i) => ({ t, done: okd(t), active: i === activeIdx && seen(t) === false && running }));
  }, [entries, running]);

  // The thread so far, as conversation turns: what you asked, and what the agent said and its tools returned.
  function history(): Turn[] {
    const turns: Turn[] = [];
    const add = (role: Turn['role'], text: string) => {
      const last = turns[turns.length - 1];
      if (last?.role === role) last.text += `\n${text}`; else turns.push({ role, text });
    };
    for (const e of entries) {
      if (e.kind === 'user') add('user', e.text);
      else if (e.kind === 'agent') add('assistant', e.text);
      else if (e.kind === 'tool') {
        const found = e.event.tool === 'scan' && Array.isArray(e.event.detail)
          ? (e.event.detail as Finding[]).map((f) => `\n  - ${f.rule} ${f.severity} in ${f.function} at line ${f.line}: ${f.title}`).join('') : '';
        const src = e.event.tool === 'patch' && e.event.detail?.patchedSource
          ? `\nThe exact source submitted to the patch tool:\n\`\`\`solidity\n${e.event.detail.patchedSource}\n\`\`\`` : '';
        add('assistant', `[${e.event.tool} → ${e.event.status}] ${e.event.summary}${found}${src}`);
      }
      else add('assistant', `[second opinion → ${e.status}] ${e.text}`);
    }
    return turns.slice(-20).map((t) => ({ ...t, text: t.text.slice(-16000) }));
  }

  function run(prompt: string) {
    if (!target || running) return;
    const past = history();
    setEntries((e) => [...e, { kind: 'user', text: prompt }]);
    setRunning(true);
    let agentBuf = '';
    const push = (en: Entry) => setEntries((e) => [...e, en]);
    const onEvent = (ev: AgentEvent) => {
      if (ev.type === 'text') { agentBuf += ev.text; setEntries((e) => { const c = [...e]; const last = c[c.length - 1]; if (last?.kind === 'agent') last.text = agentBuf; else c.push({ kind: 'agent', text: agentBuf }); return c; }); }
      else if (ev.type === 'tool') { agentBuf = ''; push({ kind: 'tool', event: ev.event }); }
      else if (ev.type === 'review') { push({ kind: 'review', status: ev.status, text: ev.text }); }
      else if (ev.type === 'error') { agentBuf = ''; push({ kind: 'agent', text: `⚠ ${ev.message}` }); }
    };
    abortRef.current = investigate(target.id, prompt, past, onEvent, () => { abortRef.current = undefined; setRunning(false); });
  }

  function stop() {
    if (!abortRef.current) return;
    abortRef.current();
    setEntries((e) => [...e, { kind: 'agent', text: 'Stopped. Ask again whenever you like.' }]);
  }

  const verdict = patch?.detail?.verified ? { cls: 'safe', label: 'Verdict', big: 'Fix verified' }
    : patch ? { cls: 'vuln', label: 'Patch verdict', big: 'Fix rejected' }
    : findings.some((f) => f.severity === 'critical') ? { cls: 'vuln', big: 'Exploitable', label: `${findings.length} findings` }
    : findings.length ? { cls: 'vuln', big: `${findings.length} findings`, label: 'Review' }
    : scanned ? { cls: 'safe', big: 'No holes found', label: 'Scanner verdict' }
    : { cls: 'pending', big: 'Not yet examined', label: 'Verdict' };

  return (
    <div className="app">
      <header className="header">
        <div className="brand"><Logo /> Elenchos <span className="greek">ἔλεγχος · the cross-examination</span></div>
        <div className="spacer" />
        {targets.length > 0 && (
          <div className="targetsel" role="group" aria-label="target contract">
            {targets.map((t, i) => <button key={t.id} aria-pressed={i === sel} onClick={() => setSel(i)}>{t.title}</button>)}
          </div>
        )}
        <div className="chips">
          {ready && (Object.keys(ready) as (keyof Ready)[]).map((k) => (
            <span key={k} className={`chip${ready[k] ? ' on' : ''}`} title={ready[k] ? 'ready' : 'Setup required'}><span className="dot" />{READY_LABEL[k]}</span>
          ))}
        </div>
      </header>

      <div className="grid">
        {/* CHAT */}
        <section className={`col${mtab === 'chat' ? ' active' : ''}`}>
          <div className="col-head"><h2>Investigation</h2>{running && <span className="chip on"><span className="dot" />live</span>}</div>
          <div className="col-body" ref={bodyRef}>
            <div className="chat">
              {loadError && <div className="empty error" role="alert">{loadError}<br /><button className="retry" onClick={load}>Try again</button></div>}
              {!loadError && entries.length === 0 && <div className="empty">Pick an investigation below.<br />The agent scans, forges a proof, reads the real verifier, and verifies a fix — live.</div>}
              {entries.map((e, i) => <EntryView key={i} e={e} />)}
              {running && entries[entries.length - 1]?.kind === 'agent' && <span className="cursor" />}
            </div>
          </div>
          {entries.length === 0 && <div className="presets">{PRESETS.map((p) => <button key={p} disabled={!target || running} onClick={() => run(p)}>{p}</button>)}</div>}
          <form className="composer" onSubmit={(e) => { e.preventDefault(); if (input.trim()) { run(input.trim()); setInput(''); } }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={running ? 'Investigating…' : 'Ask the agent about this contract…'} disabled={running || !target} />
            {running
              ? <button type="button" className="stop" onClick={stop}>Stop</button>
              : <button type="submit" disabled={!input.trim()}>Send</button>}
          </form>
        </section>

        {/* EVIDENCE */}
        <section className={`col${mtab === 'evidence' ? ' active' : ''}`}>
          <div className="col-head">
            <div className="ev-tabs">
              <button aria-pressed={tab === 'evidence'} onClick={() => setTab('evidence')}>{target?.title ?? 'source'}</button>
              {patch?.detail?.patchedSource && <button aria-pressed={tab === 'diff'} onClick={() => setTab('diff')}>{patch.detail.verified ? 'proposed fix · verified' : 'proposed fix · rejected'}</button>}
            </div>
          </div>
          <div className="col-body">
            {target && tab === 'evidence' && <Code source={target.source} flagged={flagged} />}
            {target && tab === 'diff' && patch?.detail?.patchedSource && <Diff before={target.source} after={patch.detail.patchedSource} />}
          </div>
          <ProofStrip steps={steps} />
        </section>

        {/* CASE FILE */}
        <section className={`col casefile-col${mtab === 'case' ? ' active' : ''}`}>
          <div className="col-head"><h2>Case file</h2></div>
          <div className="col-body">
            <div className="casefile">
              <div className={`verdict ${verdict.cls}`}>
                <div className="v-label">{verdict.label}</div>
                <div className="v-big">{verdict.big}</div>
              </div>
              {findings.length === 0 && <div className="empty">{scanned ? 'The scanner found none of the five receipt-consumer holes (E1, E1b, E3, E4, E6).' : 'No findings yet.'}</div>}
              {findings.map((f, i) => (
                <div key={i} className={`finding ${f.severity}`}>
                  <div className="f-top"><span className="f-rule">{f.rule}</span><span className="f-sev">{f.severity}</span></div>
                  <div className="f-title">{f.title} <span style={{ color: 'var(--ink-faint)', fontFamily: 'var(--mono)', fontSize: 11 }}>·L{f.line}</span></div>
                  <div className="f-fix"><b>fix</b> {f.fix}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <nav className="mobile-tabs">
        {(['chat', 'evidence', 'case'] as const).map((t) => <button key={t} aria-pressed={mtab === t} onClick={() => setMtab(t)}>{t === 'case' ? 'Case file' : t}</button>)}
      </nav>
    </div>
  );
}

function EntryView({ e }: { e: Entry }) {
  if (e.kind === 'user') return <div className="msg user">{e.text}</div>;
  if (e.kind === 'agent') return <div className="msg agent"><Markdown text={e.text} /></div>;
  if (e.kind === 'review') return <div className="review"><b>second opinion {e.status === 'setup' ? '· setup required' : e.status === 'error' ? '· error' : ''}</b>{e.text}</div>;
  const ev = e.event;
  return (
    <div className="toolcard">
      <div className="tc-head">
        <span className="tc-ico"><ToolIcon name={ev.tool} /></span>
        <div style={{ minWidth: 0 }}><div className="tc-name">{ev.tool}</div><div className="tc-sum">{ev.summary}</div></div>
        <span className={`tc-status s-${ev.status}`}>{ev.status === 'setup' ? 'setup' : ev.status}</span>
      </div>
      {ev.tool !== 'scan' && ev.detail && typeof ev.detail === 'object' && !ev.detail.patchedSource && (
        <div className="tc-detail">{JSON.stringify(ev.detail, (k, v) => (k === 'patchedSource' ? undefined : v), 1).slice(0, 600)}</div>
      )}
    </div>
  );
}

function ProofStrip({ steps }: { steps: { t: string; done: boolean; active: boolean }[] }) {
  const LABEL: Record<string, string> = { scan: 'Scan', forge: 'Forge proof', replay: 'Ask zkVerify', patch: 'Verify fix' };
  return (
    <div className="proofstrip">
      <div className="ps-title">Proof strip</div>
      <div className="ps-track">
        {steps.map((s) => (
          <div key={s.t} className={`ps-step${s.done ? ' done' : ''}${s.active ? ' active' : ''}`}>
            <div className="ps-line" />
            <div className="ps-dot">{s.done ? '✓' : '•'}</div>
            <div className="ps-label">{LABEL[s.t]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
