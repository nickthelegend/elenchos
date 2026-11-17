// The agent chat, modelled on VS Code's chat view: a thread per file, tool calls as collapsible rows, fenced code with
// copy, a verified-fix card with Open diff / Apply, and a composer with the file as context and slash commands.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AttackResult, ToolEvent } from '../api.ts';
import { Markdown } from '../markdown.tsx';
import { Mark } from '../icons.tsx';

export type Entry =
  | { kind: 'user'; text: string }
  | { kind: 'agent'; text: string; done?: boolean }
  | { kind: 'tool'; event: ToolEvent; direct?: boolean }
  | { kind: 'review'; status: string; text: string }
  | { kind: 'error'; text: string };

export type Command = { cmd: string; icon: string; label: string; desc: string; model: boolean };
export const COMMANDS: Command[] = [
  { cmd: '/audit', icon: 'search', label: 'Run audit', desc: 'Slither and the five detectors on this file', model: false },
  { cmd: '/forge', icon: 'key', label: 'Forge exploit', desc: 'A real Groth16 proof from an attacker circuit', model: false },
  { cmd: '/zkverify', icon: 'type-hierarchy', label: 'Ask zkVerify', desc: 'Read the real verifier on Sepolia', model: false },
  { cmd: '/attack', icon: 'debug-alt', label: 'Run exploit test', desc: 'A real Foundry exploit test on a local EVM: does the attacker get paid?', model: false },
  { cmd: '/verify', icon: 'tools', label: 'Verify my edit', desc: 'Compile, re-scan and anti-cheat your edited file', model: false },
  { cmd: '/investigate', icon: 'sparkle', label: 'Investigate', desc: 'The agent finds, proves and fixes every hole', model: true },
  { cmd: '/fix', icon: 'lightbulb', label: 'Fix it', desc: 'The agent writes the smallest fix and verifies it', model: true },
  { cmd: '/explain', icon: 'book', label: 'Explain', desc: 'Each finding in plain words, with the attack', model: true },
];
const TOOL: Record<string, { icon: string; name: string }> = {
  scan: { icon: 'search', name: 'Scan' }, forge: { icon: 'key', name: 'Forge exploit' },
  replay: { icon: 'type-hierarchy', name: 'Ask zkVerify' }, patch: { icon: 'tools', name: 'Verify fix' }, attack: { icon: 'debug-alt', name: 'Exploit test' },
};

type Props = {
  fileName: string | null; entries: Entry[]; busy: null | 'scan' | 'agent' | 'tool'; ready: boolean; model: string; runsPerHour: number | null;
  findingCount: number | null; onSend: (text: string) => void; onCommand: (c: Command) => void; onStop: () => void; onClear: () => void;
  onOpenDiff: () => void; onApply: () => void; canApply: boolean;
};

export function Chat(p: Props) {
  const [text, setText] = useState('');
  const [sel, setSel] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const last = p.entries[p.entries.length - 1];
  useEffect(() => { if (p.entries.length) bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' }); }, [p.entries.length, last]);
  useEffect(() => { const t = taRef.current; if (!t) return; t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, 180)}px`; }, [text]);

  const slash = text.startsWith('/') && !text.includes(' ');
  const matches = useMemo(() => (slash ? COMMANDS.filter((c) => c.cmd.startsWith(text.toLowerCase())) : []), [slash, text]);
  useEffect(() => setSel(0), [text]);
  const disabled = !p.fileName || Boolean(p.busy);

  function submit() {
    const t = text.trim(); if (!t || disabled) return;
    const c = COMMANDS.find((x) => x.cmd === t.toLowerCase().split(/\s/)[0]);
    setText('');
    if (c) p.onCommand(c); else p.onSend(t);
  }
  function key(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % matches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); const c = matches[sel]; setText(''); if (!disabled) p.onCommand(c); return; }
      if (e.key === 'Escape') { setText(''); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  }

  return (
    <section className="ch" aria-label="Elenchos agent">
      <header className="ch-head">
        <span className="ch-title"><i className="codicon codicon-sparkle" />Elenchos</span>
        <span className={`ch-model${p.ready ? '' : ' off'}`} title={p.ready ? 'The agent model' : 'Setup required: ANTHROPIC_API_KEY on the server'}>{p.ready ? p.model : 'agent: setup required'}</span>
        <span className="grow" />
        <button className="ic" title="New chat for this file" aria-label="New chat" onClick={p.onClear} disabled={!p.entries.length || Boolean(p.busy)}><i className="codicon codicon-add" /></button>
      </header>

      <div className="ch-body" ref={bodyRef}>
        {!p.entries.length ? (
          <div className="ch-empty">
            <div className="ch-hello"><Mark size={40} /><div><h3>Ask Elenchos</h3><p>{p.fileName ? <>About <code>{p.fileName}</code>. Type <kbd>/</kbd> for commands, or ask in plain words.</> : 'Open a contract to start.'}</p></div></div>
            <div className="ch-cmds" role="list">
              {COMMANDS.map((c) => (
                <button key={c.cmd} role="listitem" className="ch-cmd" disabled={disabled} onClick={() => p.onCommand(c)}>
                  <i className={`codicon codicon-${c.icon}`} /><b>{c.cmd}</b><span>{c.desc}</span>{c.model ? <em>agent</em> : <em className="det">no model</em>}
                </button>
              ))}
            </div>
            <p className="ch-note"><i className="codicon codicon-info" /><span>Commands marked <b>no model</b> run real code directly: Slither, snarkjs, the Sepolia verifier, Foundry.</span></p>
          </div>
        ) : (
          <div className="ch-thread">
            {p.entries.map((e, i) => <Turn key={i} e={e} running={Boolean(p.busy) && i === p.entries.length - 1} onOpenDiff={p.onOpenDiff} onApply={p.onApply} canApply={p.canApply} />)}
            {p.busy && last?.kind !== 'agent' && <div className="ch-working"><span className="spin sm" />{p.busy === 'agent' ? 'Elenchos is working…' : 'Running…'}</div>}
          </div>
        )}
      </div>

      <form className="ch-composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {matches.length > 0 && (
          <div className="ch-pop" role="listbox" aria-label="Commands">
            {matches.map((c, i) => (
              <button type="button" key={c.cmd} role="option" aria-selected={i === sel} className={i === sel ? 'on' : ''} onMouseEnter={() => setSel(i)} onClick={() => { setText(''); if (!disabled) p.onCommand(c); }}>
                <i className={`codicon codicon-${c.icon}`} /><b>{c.cmd}</b><span>{c.label}</span>{!c.model && <em>no model</em>}
              </button>
            ))}
          </div>
        )}
        <div className="ch-ctx">
          {p.fileName ? <span className="chip"><i className="codicon codicon-file-code" />{p.fileName}</span> : <span className="chip off">no file</span>}
          {p.findingCount != null && <span className={`chip ${p.findingCount ? 'bad' : 'ok'}`}><i className={`codicon codicon-${p.findingCount ? 'error' : 'pass'}`} />{p.findingCount ? `${p.findingCount} finding${p.findingCount === 1 ? '' : 's'}` : 'clean'}</span>}
        </div>
        <textarea ref={taRef} rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={key}
          placeholder={p.fileName ? 'Ask Elenchos, or type / for commands' : 'Open a file first'} disabled={!p.fileName} aria-label="Message Elenchos" />
        <div className="ch-foot">
          <span className="ch-hint">{p.runsPerHour ? `${p.runsPerHour} agent runs an hour here · commands are unlimited` : 'Enter to send · Shift+Enter for a new line'}</span>
          {p.busy === 'agent'
            ? <button type="button" className="ch-send stop" onClick={p.onStop} aria-label="Stop"><i className="codicon codicon-debug-stop" /></button>
            : <button type="submit" className="ch-send" disabled={!text.trim() || disabled} aria-label="Send"><i className="codicon codicon-arrow-up" /></button>}
        </div>
      </form>
    </section>
  );
}

function Turn({ e, running, onOpenDiff, onApply, canApply }: { e: Entry; running: boolean; onOpenDiff: () => void; onApply: () => void; canApply: boolean }) {
  if (e.kind === 'user') return <div className="t-user"><div className="who"><i className="codicon codicon-account" />You</div><div className="t-utext">{e.text}</div></div>;
  if (e.kind === 'agent') return (
    <div className="t-agent"><div className="who"><i className="codicon codicon-sparkle" />Elenchos</div>
      <div className="md">{e.text ? <Markdown text={e.text} /> : null}{running && <span className="caret-inline" />}</div></div>
  );
  if (e.kind === 'error') return <div className="t-err"><i className="codicon codicon-error" /><span>{e.text}</span></div>;
  if (e.kind === 'review') return <div className="t-note"><i className="codicon codicon-comment-discussion" /><span><b>Second opinion{e.status === 'setup' ? ' · setup required' : ''}.</b> {e.text}</span></div>;
  return <ToolRow ev={e.event} direct={e.direct} onOpenDiff={onOpenDiff} onApply={onApply} canApply={canApply} />;
}

function ToolRow({ ev, direct, onOpenDiff, onApply, canApply }: { ev: ToolEvent; direct?: boolean; onOpenDiff: () => void; onApply: () => void; canApply: boolean }) {
  const [open, setOpen] = useState(false);
  const t = TOOL[ev.tool] ?? { icon: 'symbol-event', name: ev.tool };
  const exploited = ev.tool === 'attack' && ev.status === 'ok' && (ev.detail as AttackResult | undefined)?.status === 'exploitable';
  const icon = exploited ? 'bug' : ev.status === 'running' ? 'loading codicon-modifier-spin' : ev.status === 'ok' ? 'pass-filled' : ev.status === 'error' ? 'error' : 'warning';
  const verb = ev.tool === 'attack' && ev.status === 'ok' ? (ev.detail?.status === 'exploitable' ? 'attack worked' : 'attack blocked') : ev.status === 'ok' ? (ev.tool === 'patch' ? 'verified' : 'done') : ev.status === 'error' ? (ev.tool === 'patch' ? 'rejected' : 'failed') : ev.status === 'setup' ? 'setup required' : 'running';
  const d = ev.detail && typeof ev.detail === 'object' ? ev.detail : null;
  const rows = ev.tool === 'attack' ? [] : Array.isArray(d)
    ? (d as { rule: string; severity: string; line: number; title: string }[]).map((f) => [`${f.rule} · line ${f.line}`, `${f.severity}: ${f.title}`])
    : d ? Object.entries(d).filter(([k, v]) => k !== 'patchedSource' && k !== 'publicSignals' && (typeof v !== 'object' || Array.isArray(v)))
      .map(([k, v]) => [k, Array.isArray(v) ? (v.length ? v.join(', ') : 'none') : String(v)]) : [];
  const isFix = ev.tool === 'patch' && d && 'patchedSource' in d;
  return (
    <div className={`t-tool s-${ev.status}${ev.tool === 'attack' && d ? ` a-${(d as AttackResult).status}` : ''}`}>
      <button className="tr" onClick={() => setOpen(!open)} aria-expanded={open}>
        <i className={`codicon codicon-${icon} st`} /><i className={`codicon codicon-${t.icon}`} /><b>{t.name}</b><span className="verb">{verb}</span>
        {direct && <span className="tag">no model</span>}<span className="grow" /><i className={`codicon codicon-chevron-${open ? 'down' : 'right'}`} />
      </button>
      <p className="ts">{ev.summary}</p>
      {ev.tool === 'attack' && d && <AttackTests r={d as AttackResult} open={open} />}
      {open && rows.length > 0 && <dl className="tkv">{rows.slice(0, 12).map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
      {isFix && (
        <div className="tfix">
          <button className="sd-btn sm" onClick={onOpenDiff}><i className="codicon codicon-diff" />Open diff</button>
          {d.verified && canApply && <button className="sd-btn primary sm" onClick={onApply}><i className="codicon codicon-check" />Apply to file</button>}
        </div>
      )}
    </div>
  );
}

/** Each test of an exploit run: worked (the attacker got paid) or blocked (with the revert reason), plus its logs. */
export function AttackTests({ r, open }: { r: AttackResult; open: boolean }) {
  if (r.compileError) return <pre className="ta-err">{r.compileError}</pre>;
  return (
    <ul className="ta">
      {r.tests.filter((t) => t.name.startsWith('test_attack')).map((t) => (
        <li key={t.name} className={t.worked ? 'w' : 'b'}>
          <i className={`codicon codicon-${t.worked ? 'error' : 'shield'}`} />
          <span className="tn">{t.name.replace('test_attack_', '').replace(/_/g, ' ')}</span>
          <span className="tv">{t.worked ? 'worked' : `blocked · ${t.reason}`}</span>
          {open && t.logs.length > 0 && <code className="tl">{t.logs.join('\n')}</code>}
        </li>
      ))}
    </ul>
  );
}
