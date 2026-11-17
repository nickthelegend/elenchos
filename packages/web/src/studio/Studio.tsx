// Elenchos Studio: an online auditor for contracts that trust zkVerify proofs. The layout follows AlgoCraft IDE
// (activity bar, explorer, Monaco with tabs, terminal + agent chat underneath, a build-style panel on the right),
// with the audit pipeline in place of build/deploy: scan → forge → ask zkVerify → verify the fix.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor, { DiffEditor, type Monaco } from '@monaco-editor/react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { getTargets, investigate, scanSource, type AgentEvent, type Finding, type Ready, type ToolEvent, type Turn } from '../api.ts';
import { Mark } from '../icons.tsx';
import { Markdown } from '../markdown.tsx';
import { defineTheme } from './theme.ts';
import { HOLES_REF, NEW_FILE_TEMPLATE } from './content.ts';

type File = { path: string; source: string; original: string; builtin: boolean; targetId?: string; blurb?: string };
type Line = { t: number; kind: 'cmd' | 'out' | 'ok' | 'err' | 'warn' | 'dim'; text: string };
type Entry = { kind: 'user' | 'agent'; text: string } | { kind: 'tool'; event: ToolEvent } | { kind: 'review'; status: string; text: string };
type Audit = { findings?: Finding[]; scannedSource?: string; ms?: number; error?: string; entries: Entry[]; patch?: ToolEvent; forge?: ToolEvent; replay?: ToolEvent };
type Section = 'explorer' | 'audit' | 'holes' | 'connections';

const art = (n: string) => `/art/${n}.webp`;
const STORE = 'elenchos.studio.files.v1';
const REPO = 'https://github.com/nickthelegend/elenchos';
const READY_LABEL: Record<keyof Ready, string> = { anthropic: 'Claude agent', openai: 'Second opinion', rpc: 'Sepolia RPC', kurier: 'Kurier' };
const READY_HINT: Record<keyof Ready, string> = {
  anthropic: 'Drives the investigation. Needs ANTHROPIC_API_KEY on the server.',
  openai: 'Optional independent review of each patch. Needs OPENAI_API_KEY.',
  rpc: 'Reads zkVerify’s verifier on Sepolia. Public node built in.',
  kurier: 'Submits proofs to zkVerify for the fork tests. Needs KURIER_API_KEY.',
};
const TOOL_ART: Record<string, string> = { scan: 'scanner', forge: 'forged-key', replay: 'merkle', patch: 'wrench' };
const TOOL_NAME: Record<string, string> = { scan: 'Scan', forge: 'Forge exploit', replay: 'Ask zkVerify', patch: 'Verify fix' };
const SEV_ORDER = { critical: 0, high: 1, medium: 2 } as const;

function loadUserFiles(): File[] {
  try { const raw = localStorage.getItem(STORE); return raw ? (JSON.parse(raw) as File[]).filter((f) => f && typeof f.path === 'string' && typeof f.source === 'string') : []; } catch { return []; }
}
function saveUserFiles(files: File[]) {
  try { localStorage.setItem(STORE, JSON.stringify(files.filter((f) => !f.builtin))); } catch { /* storage unavailable: files live for this visit only */ }
}
const base = (p: string) => p.split('/').pop() ?? p;
const short = (h: unknown) => (typeof h === 'string' && h.length > 20 ? `${h.slice(0, 10)}…${h.slice(-6)}` : String(h));

export function Studio() {
  const [files, setFiles] = useState<File[]>([]);
  const [ready, setReady] = useState<Ready | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [audits, setAudits] = useState<Record<string, Audit>>({});
  const [term, setTerm] = useState<Line[]>([{ t: Date.now(), kind: 'dim', text: 'Elenchos Studio · scan, forge, ask zkVerify, verify the fix. Every result below is a real run.' }]);
  const [section, setSection] = useState<Section>('explorer');
  const [showSide, setShowSide] = useState(true);
  const [showAudit, setShowAudit] = useState(true);
  const [bottomTab, setBottomTab] = useState<'terminal' | 'problems'>('terminal');
  const [view, setView] = useState<'source' | 'diff'>('source');
  const [busy, setBusy] = useState<null | 'scan' | 'agent'>(null);
  const [input, setInput] = useState('');
  const [creating, setCreating] = useState<string | null>(null);
  const [cursor, setCursor] = useState({ ln: 1, col: 1 });
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches);
  const [mpane, setMpane] = useState<'editor' | 'chat' | 'terminal' | 'audit'>('editor');
  const abortRef = useRef<() => void>();
  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<any>(null);
  const decoRef = useRef<any>(null);
  const termRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => { document.title = 'Studio · Elenchos'; }, []);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on); return () => mq.removeEventListener('change', on);
  }, []);

  const load = useCallback(() => {
    setLoading(true); setLoadError(null);
    getTargets().then((d) => {
      const builtins: File[] = d.targets.map((t) => ({ path: `demo/${t.title}`, source: t.source, original: t.source, builtin: true, targetId: t.id, blurb: t.blurb }));
      const user = loadUserFiles();
      setFiles([...builtins, ...user]);
      setReady(d.ready);
      const first = builtins[0]?.path ?? user[0]?.path ?? null;
      setOpen((o) => (o.length ? o : first ? [first] : []));
      setActive((a) => a ?? first);
    }).catch((e) => setLoadError(String(e?.message ?? e))).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const file = files.find((f) => f.path === active) ?? null;
  const audit: Audit = (active && audits[active]) || { entries: [] };
  const findings = useMemo(() => [...(audit.findings ?? [])].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.line - b.line), [audit.findings]);
  const stale = Boolean(file && audit.scannedSource !== undefined && audit.scannedSource !== file.source);
  const allProblems = useMemo(() => Object.entries(audits).flatMap(([p, a]) => (a.findings ?? []).map((f) => ({ path: p, f }))), [audits]);

  const log = (kind: Line['kind'], text: string) => setTerm((t) => [...t.slice(-400), { t: Date.now(), kind, text }]);
  const patchAudit = (path: string, fn: (a: Audit) => Audit) => setAudits((m) => ({ ...m, [path]: fn(m[path] ?? { entries: [] }) }));

  useEffect(() => { termRef.current?.scrollTo({ top: termRef.current.scrollHeight }); }, [term]);
  useEffect(() => { if (audit.entries.length) chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' }); }, [audit.entries.length, audit.entries[audit.entries.length - 1]]);
  useEffect(() => { setView(audit.patch?.detail?.patchedSource ? 'diff' : 'source'); }, [active, audit.patch]);

  // Findings → Monaco markers (Problems-style squiggles) + whole-line and gutter decorations.
  useEffect(() => {
    const m = monacoRef.current; const ed = editorRef.current;
    if (!m || !ed || view !== 'source') return;
    const model = ed.getModel(); if (!model) return;
    const list = stale ? [] : findings;
    m.editor.setModelMarkers(model, 'elenchos', list.map((f) => ({
      startLineNumber: f.line, endLineNumber: f.line, startColumn: 1, endColumn: model.getLineMaxColumn(Math.min(f.line, model.getLineCount())),
      severity: f.severity === 'medium' ? m.MarkerSeverity.Warning : m.MarkerSeverity.Error,
      message: `${f.rule} (${f.severity}): ${f.title}\n${f.evidence}\nFix: ${f.fix}`, source: 'elenchos',
    })));
    decoRef.current?.clear();
    decoRef.current = ed.createDecorationsCollection(list.map((f) => ({
      range: new m.Range(f.line, 1, f.line, 1),
      options: { isWholeLine: true, className: `ln-${f.severity}`, glyphMarginClassName: `gl-${f.severity}`, glyphMarginHoverMessage: { value: `**${f.rule} · ${f.severity}** ${f.title}` },
        after: { content: `  ${f.rule} · ${f.title}`, inlineClassName: `ln-note ln-note-${f.severity}` } },
    })));
  }, [findings, stale, view, active]);

  function openFile(path: string) { setOpen((o) => (o.includes(path) ? o : [...o, path])); setActive(path); if (narrow) setMpane('editor'); }
  function closeTab(path: string) {
    setOpen((o) => { const n = o.filter((p) => p !== path); if (active === path) setActive(n[n.length - 1] ?? null); return n; });
  }
  function edit(source: string) {
    if (!file) return;
    setFiles((fs) => { const n = fs.map((f) => (f.path === file.path ? { ...f, source } : f)); saveUserFiles(n); return n; });
  }
  function createFile(raw: string) {
    const name = raw.trim().replace(/\.sol$/i, '') + '.sol';
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,47}\.sol$/.test(name)) { log('err', `Can't create "${raw}": use letters, digits and underscores, like MyConsumer.sol`); return; }
    const path = `my/${name}`;
    if (files.some((f) => f.path === path)) { openFile(path); setCreating(null); return; }
    const src = NEW_FILE_TEMPLATE(name.replace(/\.sol$/, ''));
    setFiles((fs) => { const n = [...fs, { path, source: src, original: src, builtin: false }]; saveUserFiles(n); return n; });
    setCreating(null); openFile(path); log('dim', `created ${path}`);
  }
  function deleteFile(path: string) {
    setFiles((fs) => { const n = fs.filter((f) => f.path !== path); saveUserFiles(n); return n; });
    closeTab(path); setAudits((m) => { const n = { ...m }; delete n[path]; return n; });
  }
  function resetFile() { if (file) edit(file.original); }

  async function runScan() {
    if (!file || busy) return;
    const f = file; setBusy('scan'); setBottomTab('terminal');
    log('cmd', `elenchos scan ${f.path}`);
    try {
      const r = await scanSource(base(f.path), f.source);
      patchAudit(f.path, (a) => ({ ...a, findings: r.findings, scannedSource: f.source, ms: r.ms, error: undefined, patch: undefined }));
      for (const x of r.findings) log(x.severity === 'medium' ? 'warn' : 'err', `[${x.rule.padEnd(3)} ${x.severity.padEnd(8)}] ${x.contract}.${x.function.split('(')[0]}(…)  ${base(f.path)}:${x.line}  ${x.title}`);
      log(r.findings.length ? 'out' : 'ok', `${r.findings.length} finding${r.findings.length === 1 ? '' : 's'} · ${r.ms} ms · Slither + 5 Elenchos detectors`);
      if (r.findings.length) setBottomTab('problems');
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      patchAudit(f.path, (a) => ({ ...a, error: msg, findings: undefined, scannedSource: undefined }));
      log('err', msg);
    } finally { setBusy(null); }
  }

  function history(a: Audit): Turn[] {
    const turns: Turn[] = [];
    const add = (role: Turn['role'], text: string) => { const l = turns[turns.length - 1]; if (l?.role === role) l.text += `\n${text}`; else turns.push({ role, text }); };
    for (const e of a.entries) {
      if (e.kind === 'user') add('user', e.text);
      else if (e.kind === 'agent') add('assistant', e.text);
      else if (e.kind === 'tool') {
        const found = e.event.tool === 'scan' && Array.isArray(e.event.detail) ? (e.event.detail as Finding[]).map((f) => `\n  - ${f.rule} ${f.severity} in ${f.function} at line ${f.line}: ${f.title}`).join('') : '';
        const src = e.event.tool === 'patch' && e.event.detail?.patchedSource ? `\nThe exact source submitted to the patch tool:\n\`\`\`solidity\n${e.event.detail.patchedSource}\n\`\`\`` : '';
        add('assistant', `[${e.event.tool} → ${e.event.status}] ${e.event.summary}${found}${src}`);
      } else add('assistant', `[second opinion → ${e.status}] ${e.text}`);
    }
    return turns.slice(-20).map((t) => ({ ...t, text: t.text.slice(-16000) }));
  }

  function ask(prompt: string) {
    if (!file || busy || !prompt.trim()) return;
    if (ready && !ready.anthropic) { log('warn', 'Setup required: the agent needs ANTHROPIC_API_KEY on the server. The scan button still works without it.'); return; }
    const f = file; const past = history(audits[f.path] ?? { entries: [] });
    const subject = f.builtin && f.source === f.original && f.targetId ? { targetId: f.targetId } : { name: base(f.path), source: f.source };
    patchAudit(f.path, (a) => ({ ...a, entries: [...a.entries, { kind: 'user', text: prompt }] }));
    setBusy('agent'); if (narrow) setMpane('chat');
    log('cmd', `elenchos agent "${prompt.length > 70 ? `${prompt.slice(0, 70)}…` : prompt}"  (${f.path})`);
    let buf = '';
    const onEvent = (ev: AgentEvent) => {
      if (ev.type === 'text') {
        buf += ev.text;
        patchAudit(f.path, (a) => { const en = [...a.entries]; const l = en[en.length - 1]; if (l?.kind === 'agent') en[en.length - 1] = { kind: 'agent', text: buf }; else en.push({ kind: 'agent', text: buf }); return { ...a, entries: en }; });
      } else if (ev.type === 'tool') {
        buf = '';
        const t = ev.event;
        log(t.status === 'ok' ? 'ok' : t.status === 'error' ? 'err' : t.status === 'setup' ? 'warn' : 'out', `› ${TOOL_NAME[t.tool] ?? t.tool}: ${t.summary}`);
        patchAudit(f.path, (a) => ({
          ...a, entries: [...a.entries, { kind: 'tool', event: t }],
          ...(t.tool === 'scan' && Array.isArray(t.detail) ? { findings: t.detail as Finding[], scannedSource: f.source } : {}),
          ...(t.tool === 'patch' && t.detail?.patchedSource ? { patch: t } : {}),
          ...(t.tool === 'forge' ? { forge: t } : {}),
          ...(t.tool === 'replay' ? { replay: t } : {}),
        }));
      } else if (ev.type === 'review') {
        patchAudit(f.path, (a) => ({ ...a, entries: [...a.entries, { kind: 'review', status: ev.status, text: ev.text }] }));
      } else if (ev.type === 'error') {
        buf = ''; log('err', ev.message);
        patchAudit(f.path, (a) => ({ ...a, entries: [...a.entries, { kind: 'agent', text: `⚠ ${ev.message}` }] }));
      }
    };
    abortRef.current = investigate(subject, prompt, past, onEvent, () => { abortRef.current = undefined; setBusy(null); log('dim', 'agent finished'); });
  }
  function stop() {
    if (!abortRef.current || !file) return;
    abortRef.current(); log('warn', 'stopped by you');
  }
  function reveal(path: string, line: number) {
    openFile(path); setView('source');
    setTimeout(() => { const ed = editorRef.current; if (!ed) return; ed.revealLineInCenter(line); ed.setPosition({ lineNumber: line, column: 1 }); ed.focus(); }, 60);
  }
  function applyPatch() {
    const src = audit.patch?.detail?.patchedSource; if (!src || !file) return;
    edit(src); setView('source'); log('ok', `applied the verified fix to ${file.path}; run the scan again to confirm`);
  }

  const verdict = audit.patch?.detail?.verified ? { cls: 'safe', obj: 'seal', big: 'Fix verified', sub: 'Compiles, the re-scan is clean, and the receipt check is still there.' }
    : audit.patch ? { cls: 'vuln', obj: 'cracked', big: 'Fix rejected', sub: audit.patch.summary }
    : audit.error ? { cls: 'warn', obj: 'cracked', big: 'Scan failed', sub: audit.error }
    : stale ? { cls: 'pending', obj: 'scanner', big: 'Edited since the scan', sub: 'Run the audit again to refresh the findings.' }
    : findings.some((f) => f.severity === 'critical') ? { cls: 'vuln', obj: 'forged-key', big: 'Exploitable', sub: 'A critical hole lets an attacker’s proof through.' }
    : findings.length ? { cls: 'warn', obj: 'receipt', big: `${findings.length} to fix`, sub: 'No critical hole, but these need a fix.' }
    : audit.findings ? { cls: 'safe', obj: 'shield', big: 'No holes found', sub: 'None of E1, E1b, E3, E4, E6.' }
    : { cls: 'pending', obj: 'empty', big: 'Not audited yet', sub: 'Press Run audit, or ask the agent.' };
  const counts = { critical: findings.filter((f) => f.severity === 'critical').length, high: findings.filter((f) => f.severity === 'high').length, medium: findings.filter((f) => f.severity === 'medium').length };
  const steps = ['scan', 'forge', 'replay', 'patch'].map((t) => {
    const ev = [...audit.entries].reverse().find((e) => e.kind === 'tool' && e.event.tool === t) as { event: ToolEvent } | undefined;
    const st = t === 'scan' && !ev && audit.findings ? 'ok' : ev?.event.status;
    return { t, st };
  });

  if (loadError) return <Offline message={loadError} onRetry={load} />;

  /* ---------- pieces ---------- */
  const toolbar = (
    <header className="sd-toolbar">
      <a className="sd-brand" href="#/" aria-label="Elenchos home"><Mark size={24} /><span>Elenchos</span><em>Studio</em></a>
      {narrow && (
        <select className="sd-filesel" value={active ?? ''} onChange={(e) => openFile(e.target.value)} aria-label="File">
          {files.map((f) => <option key={f.path} value={f.path}>{f.path}</option>)}
        </select>
      )}
      <div className="sd-actions">
        <button className="sd-btn primary" onClick={runScan} disabled={!file || Boolean(busy)} title="Slither + the five Elenchos detectors. Deterministic, no model.">
          {busy === 'scan' ? <span className="spin" /> : <Ico n="play" />}<span>Run audit</span>
        </button>
        <button className="sd-btn" onClick={() => ask('Forge a real Groth16 proof that exploits the worst hole in this contract and show me its zkVerify leaf.')} disabled={!file || Boolean(busy)}><Ico n="key" /><span>Forge exploit</span></button>
        <button className="sd-btn hide-md" onClick={() => ask('Ask zkVerify’s real verifier on Sepolia whether the forged leaf is in its latest aggregation, and explain what that means for this contract.')} disabled={!file || Boolean(busy)}><Ico n="tree" /><span>Ask zkVerify</span></button>
        <button className="sd-btn hide-md" onClick={() => ask('Propose the smallest fix for every finding, then verify it (it must compile, the re-scan must be clean, and nothing may be deleted to hide a finding).')} disabled={!file || Boolean(busy)}><Ico n="wrench" /><span>Verify fix</span></button>
        {busy === 'agent' && <button className="sd-btn danger" onClick={stop}><Ico n="stop" /><span>Stop</span></button>}
        {busy && <span className="sd-busy"><span className="pulse" />{busy === 'scan' ? 'Scanning…' : 'Agent working…'}</span>}
      </div>
      <div className="sd-right">
        <a className="sd-link hide-md" href={REPO} target="_blank" rel="noreferrer">GitHub</a>
      </div>
    </header>
  );

  const activity = (
    <nav className="sd-activity" aria-label="Views">
      {([['explorer', 'files', 'Explorer'], ['audit', 'shield', 'Audit'], ['holes', 'book', 'The five holes'], ['connections', 'plug', 'Connections']] as const).map(([id, ic, label]) => (
        <button key={id} className={section === id && showSide ? 'on' : ''} aria-label={label} title={label}
          onClick={() => { if (section === id) setShowSide(!showSide); else { setSection(id); setShowSide(true); } }}>
          <Ico n={ic} size={22} />
          {id === 'audit' && allProblems.length > 0 && <span className="badge">{allProblems.length}</span>}
        </button>
      ))}
      <div className="grow" />
      <button className={showAudit ? 'on' : ''} aria-label="Toggle audit panel" title="Audit panel" onClick={() => setShowAudit(!showAudit)}><Ico n="panel" size={22} /></button>
    </nav>
  );

  const sidebar = (
    <div className="sd-side">
      {section === 'explorer' && (
        <>
          <div className="sd-head"><span>Explorer</span><button className="ic" aria-label="New file" title="New file" onClick={() => setCreating('')}><Ico n="plus" /></button></div>
          <div className="sd-tree">
            <Folder name="demo" hint="built-in targets">
              {files.filter((f) => f.builtin).map((f) => <FileRow key={f.path} f={f} active={active === f.path} audit={audits[f.path]} onOpen={() => openFile(f.path)} />)}
            </Folder>
            <Folder name="my" hint="saved in this browser">
              {files.filter((f) => !f.builtin).map((f) => <FileRow key={f.path} f={f} active={active === f.path} audit={audits[f.path]} onOpen={() => openFile(f.path)} onDelete={() => deleteFile(f.path)} />)}
              {creating !== null
                ? <form className="sd-new" onSubmit={(e) => { e.preventDefault(); createFile(creating); }}>
                    <input autoFocus value={creating} onChange={(e) => setCreating(e.target.value)} placeholder="MyConsumer.sol" aria-label="New file name" onBlur={() => !creating && setCreating(null)} onKeyDown={(e) => e.key === 'Escape' && setCreating(null)} />
                  </form>
                : files.every((f) => f.builtin) && <button className="sd-empty-new" onClick={() => setCreating('')}><Ico n="plus" />New file, or paste your contract</button>}
            </Folder>
          </div>
          {file?.blurb && <div className="sd-blurb"><b>{base(file.path)}</b>{file.blurb}</div>}
        </>
      )}
      {section === 'audit' && (
        <>
          <div className="sd-head"><span>Audit · all files</span></div>
          <div className="sd-list">
            {allProblems.length === 0 && <div className="sd-none"><img src={art('empty')} alt="" width={72} height={72} />No findings yet. Open a file and press <b>Run audit</b>.</div>}
            {allProblems.map(({ path, f }, i) => (
              <button key={i} className="sd-prob" onClick={() => reveal(path, f.line)}>
                <span className={`sev-dot ${f.severity}`} /><span className="pr-main"><b>{f.rule}</b> {f.title}<em>{base(path)}:{f.line}</em></span>
              </button>
            ))}
          </div>
        </>
      )}
      {section === 'holes' && (
        <>
          <div className="sd-head"><span>The five holes</span></div>
          <div className="sd-list">
            {HOLES_REF.map((h) => (
              <div key={h.r} className="sd-hole">
                <div className="hh"><img src={art(h.obj)} alt="" width={34} height={34} /><b>{h.r}</b><span className={`sev ${h.sev}`}>{h.sev}</span></div>
                <p>{h.t}</p><p className="fx"><b>Fix</b> {h.f}</p>
              </div>
            ))}
          </div>
        </>
      )}
      {section === 'connections' && (
        <>
          <div className="sd-head"><span>Connections</span></div>
          <div className="sd-list">
            {ready && (Object.keys(ready) as (keyof Ready)[]).map((k) => (
              <div key={k} className={`sd-conn${ready[k] ? ' on' : ''}`}>
                <div className="hh"><span className="dot" /><b>{READY_LABEL[k]}</b><em>{ready[k] ? 'ready' : 'Setup required'}</em></div>
                <p>{READY_HINT[k]}</p>
              </div>
            ))}
            <p className="sd-note">The scanner, the compiler and the zkVerify verifier read need no key. Only the chat agent uses a model.</p>
          </div>
        </>
      )}
    </div>
  );

  const tabs = (
    <div className="sd-tabs" role="tablist">
      {open.map((p) => {
        const f = files.find((x) => x.path === p); const dirty = f && f.source !== f.original;
        return (
          <div key={p} className={`sd-tab${p === active ? ' on' : ''}`} role="tab" aria-selected={p === active}>
            <button className="tab-name" onClick={() => setActive(p)}><SolIcon />{base(p)}{dirty && <span className="dirty" title="edited" />}</button>
            <button className="tab-x" aria-label={`Close ${base(p)}`} onClick={() => closeTab(p)}>×</button>
          </div>
        );
      })}
      <div className="grow" />
      {file && audit.patch?.detail?.patchedSource && (
        <div className="sd-viewsw">
          <button className={view === 'source' ? 'on' : ''} onClick={() => setView('source')}>Source</button>
          <button className={view === 'diff' ? 'on' : ''} onClick={() => setView('diff')}>Fix · {audit.patch.detail.verified ? 'verified' : 'rejected'}</button>
        </div>
      )}
    </div>
  );

  const editor = (
    <div className="sd-editor">
      {!narrow && tabs}
      <div className="sd-crumbs">
        {file ? <><span>{file.path.split('/')[0]}</span><Ico n="chev" size={12} /><b>{base(file.path)}</b>{file.builtin && file.source !== file.original && <button className="sd-reset" onClick={resetFile}>Revert to original</button>}</> : <span>No file open</span>}
      </div>
      <div className="sd-monaco">
        {loading && <div className="sd-loading"><span className="spin" />Loading the workspace…</div>}
        {!loading && !file && <div className="sd-welcome"><img src={art('logo')} alt="" width={120} height={120} /><h2>Open a contract to audit</h2><p>Pick a demo target in the Explorer, or create a file and paste your own zkVerify consumer.</p></div>}
        {file && view === 'source' && (
          <Editor key={file.path} path={file.path} language="sol" theme="elenchos" value={file.source}
            onChange={(v) => edit(v ?? '')} beforeMount={defineTheme}
            onMount={(ed, m) => { editorRef.current = ed; monacoRef.current = m; ed.onDidChangeCursorPosition((e: any) => setCursor({ ln: e.position.lineNumber, col: e.position.column })); setCursor({ ln: 1, col: 1 }); setAudits((x) => ({ ...x })); }}
            loading={<div className="sd-loading"><span className="spin" />Loading the editor…</div>}
            options={{ fontFamily: '"Commit Mono", ui-monospace, Menlo, monospace', fontSize: 13.5, lineHeight: 22, minimap: { enabled: !narrow, scale: 1 }, glyphMargin: true, scrollBeyondLastLine: false, smoothScrolling: true, cursorBlinking: 'smooth', renderLineHighlight: 'all', padding: { top: 12 }, automaticLayout: true, wordWrap: narrow ? 'on' : 'off', fixedOverflowWidgets: true }} />
        )}
        {file && view === 'diff' && audit.patch?.detail?.patchedSource && (
          <div className="sd-diffwrap">
            <div className={`sd-diffbar ${audit.patch.detail.verified ? 'ok' : 'bad'}`}>
              <img src={art(audit.patch.detail.verified ? 'seal' : 'cracked')} alt="" width={28} height={28} />
              <span><b>{audit.patch.detail.verified ? 'Fix verified' : 'Fix rejected'}</b> · {audit.patch.summary}</span>
              {audit.patch.detail.verified && <button className="sd-btn primary sm" onClick={applyPatch}>Apply to {base(file.path)}</button>}
            </div>
            <DiffEditor original={file.source} modified={audit.patch.detail.patchedSource} language="sol" theme="elenchos" beforeMount={defineTheme}
              options={{ readOnly: true, renderSideBySide: !narrow, fontFamily: '"Commit Mono", ui-monospace, Menlo, monospace', fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false, automaticLayout: true }} />
          </div>
        )}
      </div>
    </div>
  );

  const terminal = (
    <div className="sd-bottom">
      <div className="sd-ptabs" role="tablist">
        <button role="tab" aria-selected={bottomTab === 'terminal'} onClick={() => setBottomTab('terminal')}>Terminal</button>
        <button role="tab" aria-selected={bottomTab === 'problems'} onClick={() => setBottomTab('problems')}>Problems {findings.length > 0 && !stale && <span className="badge">{findings.length}</span>}</button>
        <div className="grow" />
        {bottomTab === 'terminal' && <button className="ic" aria-label="Clear terminal" title="Clear" onClick={() => setTerm([])}><Ico n="trash" /></button>}
      </div>
      {bottomTab === 'terminal' ? (
        <div className="sd-term" ref={termRef} role="log" aria-live="polite">
          {term.map((l, i) => (
            <div key={i} className={`tl tl-${l.kind}`}><span className="tt">{new Date(l.t).toLocaleTimeString([], { hour12: false })}</span>{l.kind === 'cmd' && <span className="pr">$</span>}<span className="tx">{l.text}</span></div>
          ))}
          {busy && <div className="tl tl-dim"><span className="tt" /><span className="caret" /></div>}
        </div>
      ) : (
        <div className="sd-problems">
          {(!audit.findings || stale) && <div className="sd-none">{stale ? 'The file changed since the last scan. Run the audit again.' : 'No problems yet. Run the audit to check this file.'}</div>}
          {!stale && findings.map((f, i) => (
            <button key={i} className="sd-prob row" onClick={() => reveal(active!, f.line)}>
              <span className={`sev-dot ${f.severity}`} /><b>{f.rule}</b><span className="pr-t">{f.title}</span><em>{f.function.split('(')[0]} · {base(active!)}:{f.line}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const chat = (
    <div className="sd-chat">
      <div className="sd-head"><span><img src={art('scanner')} alt="" width={18} height={18} />Elenchos agent</span>{ready && <em className={ready.anthropic ? 'ok' : 'warn'}>{ready.anthropic ? 'Claude · 4 tools' : 'Setup required'}</em>}</div>
      <div className="sd-chatbody" ref={chatRef}>
        {audit.entries.length === 0 && (
          <div className="sd-chatempty">
            <p>Ask in plain words. The agent picks its tools (scan, forge, ask zkVerify, verify fix) and every call shows up here and in the terminal.</p>
            {['Find every hole, prove the impact, then propose and verify a fix.', 'Is the verification key pinned? Show me what happens if it is not.', 'Explain the worst finding like I’m new to zkVerify.'].map((p) => (
              <button key={p} disabled={!file || Boolean(busy)} onClick={() => ask(p)}>{p}</button>
            ))}
          </div>
        )}
        {audit.entries.map((e, i) => <ChatEntry key={i} e={e} />)}
        {busy === 'agent' && audit.entries[audit.entries.length - 1]?.kind !== 'agent' && <div className="typing"><span /><span /><span /></div>}
      </div>
      <form className="sd-composer" onSubmit={(e) => { e.preventDefault(); ask(input); setInput(''); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={file ? `Ask about ${base(file.path)}…` : 'Open a file first'} disabled={!file || Boolean(busy)} aria-label="Ask the agent" />
        {busy === 'agent'
          ? <button type="button" className="send stop" onClick={stop} aria-label="Stop"><span className="sq" /></button>
          : <button type="submit" className="send" disabled={!input.trim() || !file || Boolean(busy)} aria-label="Send"><Ico n="up" /></button>}
      </form>
    </div>
  );

  const auditPanel = (
    <div className="sd-auditp">
      <div className="sd-head"><span>Audit</span>{audit.ms != null && !stale && <em>{audit.ms} ms</em>}</div>
      <div className="sd-auditbody">
        <div className={`sd-verdict v-${verdict.cls}`}>
          <img src={art(verdict.obj)} alt="" width={76} height={76} />
          <div><div className="vl">{file ? base(file.path) : 'Verdict'}</div><div className="vb">{verdict.big}</div><p>{verdict.sub}</p></div>
        </div>
        <ol className="sd-steps">
          {steps.map((s) => (
            <li key={s.t} className={`s-${s.st ?? 'idle'}`}><img src={art(TOOL_ART[s.t])} alt="" width={26} height={26} /><span>{TOOL_NAME[s.t]}</span>
              <em>{s.st === 'ok' ? (s.t === 'patch' ? 'verified' : 'done') : s.st === 'error' ? (s.t === 'patch' ? 'rejected' : 'error') : s.st === 'setup' ? 'setup' : s.st === 'running' ? 'running' : '—'}</em></li>
          ))}
        </ol>
        {audit.findings && !stale && (
          <div className="sd-counts">
            <div className="c-critical"><b>{counts.critical}</b>critical</div><div className="c-high"><b>{counts.high}</b>high</div><div className="c-medium"><b>{counts.medium}</b>medium</div>
          </div>
        )}
        {(audit.forge || audit.replay) && (
          <div className="sd-facts">
            <div className="fh">Evidence</div>
            {audit.forge?.detail?.ms != null && <Fact k="Forged proof" v={`${audit.forge.detail.ms} ms · ${audit.forge.detail.verifiedLocally ? 'verified locally' : 'unverified'}`} tone="coral" />}
            {audit.forge?.detail?.attackerVkHash && <Fact k="Attacker vkHash" v={short(audit.forge.detail.attackerVkHash)} />}
            {audit.forge?.detail?.leaf && <Fact k="Forged leaf" v={short(audit.forge.detail.leaf)} />}
            {audit.replay?.detail?.aggregationId != null && <Fact k="Real aggregation" v={`#${audit.replay.detail.aggregationId} · block ${audit.replay.detail.block}`} />}
            {audit.replay?.detail && 'accepted' in audit.replay.detail && <Fact k="zkVerify says" v={audit.replay.detail.accepted ? 'leaf accepted' : 'leaf not in aggregation'} tone={audit.replay.detail.accepted ? 'coral' : 'mint'} />}
          </div>
        )}
        {!stale && findings.map((f, i) => (
          <button key={i} className={`sd-finding f-${f.severity}`} onClick={() => reveal(active!, f.line)}>
            <div className="ft"><b>{f.rule}</b><span className={`sev ${f.severity}`}>{f.severity}</span><em>line {f.line}</em></div>
            <div className="fti">{f.title}</div>
            <div className="ffx"><b>Fix</b> {f.fix}</div>
          </button>
        ))}
      </div>
    </div>
  );

  const status = (
    <footer className="sd-status">
      <span className="st-brand"><Ico n="shield" size={13} />Elenchos</span>
      {ready && (Object.keys(ready) as (keyof Ready)[]).map((k) => <span key={k} className={`st-item${ready[k] ? '' : ' off'}`} title={READY_HINT[k]}><span className="d" />{READY_LABEL[k]}</span>)}
      <span className="grow" />
      {file && <span className="st-item">{stale ? 'edited · re-run audit' : audit.findings ? `${findings.length} problem${findings.length === 1 ? '' : 's'}` : 'not audited'}</span>}
      <span className="st-item hide-md">Ln {cursor.ln}, Col {cursor.col}</span>
      <span className="st-item hide-md">Solidity</span>
    </footer>
  );

  if (narrow) {
    return (
      <div className="sd sd-narrow">
        {toolbar}
        <main className="sd-mmain">
          {mpane === 'editor' && editor}
          {mpane === 'chat' && chat}
          {mpane === 'terminal' && terminal}
          {mpane === 'audit' && auditPanel}
        </main>
        <nav className="sd-mtabs" aria-label="Panels">
          {(['editor', 'chat', 'terminal', 'audit'] as const).map((p) => (
            <button key={p} aria-pressed={mpane === p} onClick={() => setMpane(p)}>{p === 'editor' ? 'Code' : p[0].toUpperCase() + p.slice(1)}{p === 'audit' && findings.length > 0 && !stale && <span className="badge">{findings.length}</span>}</button>
          ))}
        </nav>
      </div>
    );
  }

  return (
    <div className="sd">
      {toolbar}
      <div className="sd-body">
        {activity}
        <PanelGroup direction="horizontal" autoSaveId="elenchos-studio-h">
          {showSide && <><Panel id="side" order={1} defaultSize={17} minSize={12} maxSize={30}>{sidebar}</Panel><PanelResizeHandle className="rh v" /></>}
          <Panel id="main" order={2} minSize={35}>
            <PanelGroup direction="vertical" autoSaveId="elenchos-studio-v">
              <Panel defaultSize={64} minSize={25}>{editor}</Panel>
              <PanelResizeHandle className="rh h" />
              <Panel defaultSize={36} minSize={14}>
                <PanelGroup direction="horizontal" autoSaveId="elenchos-studio-b">
                  <Panel defaultSize={52} minSize={25}>{terminal}</Panel>
                  <PanelResizeHandle className="rh v" />
                  <Panel defaultSize={48} minSize={25}>{chat}</Panel>
                </PanelGroup>
              </Panel>
            </PanelGroup>
          </Panel>
          {showAudit && <><PanelResizeHandle className="rh v" /><Panel id="audit" order={3} defaultSize={22} minSize={16} maxSize={34}>{auditPanel}</Panel></>}
        </PanelGroup>
      </div>
      {status}
    </div>
  );
}

function Folder({ name, hint, children }: { name: string; hint: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="sd-folder">
      <button className="fo" onClick={() => setOpen(!open)} aria-expanded={open}><Ico n={open ? 'chevd' : 'chev'} size={14} /><Ico n="folder" size={15} /><span>{name}</span><em>{hint}</em></button>
      {open && <div className="fo-kids">{children}</div>}
    </div>
  );
}
function FileRow({ f, active, audit, onOpen, onDelete }: { f: File; active: boolean; audit?: Audit; onOpen: () => void; onDelete?: () => void }) {
  const n = audit?.findings?.length ?? 0; const crit = audit?.findings?.some((x) => x.severity === 'critical');
  return (
    <div className={`sd-file${active ? ' on' : ''}`}>
      <button className="fn" onClick={onOpen}><SolIcon />{base(f.path)}{f.source !== f.original && <span className="dirty" />}</button>
      {audit?.findings && <span className={`fcount ${n ? (crit ? 'crit' : 'warn') : 'ok'}`}>{n || '✓'}</span>}
      {onDelete && <button className="fdel" aria-label={`Delete ${base(f.path)}`} title="Delete" onClick={onDelete}><Ico n="trash" size={13} /></button>}
    </div>
  );
}
function ChatEntry({ e }: { e: Entry }) {
  if (e.kind === 'user') return <div className="cm user"><div>{e.text}</div></div>;
  if (e.kind === 'agent') return <div className="cm agent"><img src={art('scanner')} alt="" width={22} height={22} /><div className="md"><Markdown text={e.text} /></div></div>;
  if (e.kind === 'review') return <div className="cm review"><b>Second opinion{e.status === 'setup' ? ' · Setup required' : ''}</b>{e.text}</div>;
  const ev = e.event;
  return (
    <div className={`cm tool t-${ev.status}`}>
      <img src={art(TOOL_ART[ev.tool] ?? 'scanner')} alt="" width={30} height={30} />
      <div><div className="th"><b>{TOOL_NAME[ev.tool] ?? ev.tool}</b><span className={`pill p-${ev.status}`}>{ev.status === 'ok' ? (ev.tool === 'patch' ? 'verified' : 'done') : ev.status === 'error' ? (ev.tool === 'patch' ? 'rejected' : 'error') : ev.status}</span></div><p>{ev.summary}</p></div>
    </div>
  );
}
function Fact({ k, v, tone }: { k: string; v: string; tone?: 'coral' | 'mint' }) { return <div className="fact"><span>{k}</span><code className={tone ?? ''}>{v}</code></div>; }

function Offline({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="setup">
      <a className="cr-brand" href="#/"><Mark size={28} /><span>Elenchos</span><em>/ studio</em></a>
      <div className="setup-card">
        <img src={art('empty')} alt="The scanner orb, resting" width={170} height={170} />
        <span className="eyebrow">Setup required</span>
        <h1>The studio runs next to Foundry and Slither.</h1>
        <p>It compiles and scans for real, so it needs the Elenchos server. This page couldn’t reach it.</p>
        <p className="setup-err" role="alert">{message}</p>
        <div className="cmd setup-cmd"><code>docker build -t elenchos . && docker run -p 8787:8787 -e ANTHROPIC_API_KEY elenchos</code></div>
        <div className="hero-cta">
          <button className="btn primary" onClick={onRetry}>Try again</button>
          <a className="btn ghost" href="https://github.com/nickthelegend/elenchos/releases/tag/v0.1.0">Watch a real run</a>
          <a className="btn ghost" href={REPO}>Source on GitHub</a>
        </div>
      </div>
    </div>
  );
}

const SolIcon = () => <svg className="sol" width="14" height="14" viewBox="0 0 24 24" aria-hidden><path d="M8 2 12 8 8 14 4 8z" fill="#8ea4ff" opacity=".9" /><path d="M16 10 20 16 16 22 12 16z" fill="#5b7cff" /><path d="M12 8 16 10 12 16 8 14z" fill="#a9b8ff" opacity=".55" /></svg>;
const P: Record<string, string> = {
  play: 'M7 5v14l11-7z', key: 'M14 7a4 4 0 1 1-3.9 5H8v2H6v2H3v-3l6.1-6.1A4 4 0 0 1 14 7zM15.5 9.5h.01', tree: 'M12 3v4M6 11h12M6 11v3M18 11v3M12 7v4M4 14h4v4H4zM16 14h4v4h-4zM10 3h4v4h-4z',
  wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3.6 17.4a1.4 1.4 0 0 0 2 2l5.7-5.7a4 4 0 0 0 5.4-5.4l-2.5 2.5-2-.5-.5-2z', stop: 'M7 7h10v10H7z',
  files: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5', shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6zM12 9v4M12 16h.01',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7', plug: 'M9 7V3M15 7V3M6 7h12v4a6 6 0 0 1-12 0zM12 17v4', panel: 'M3 4h18v16H3zM15 4v16',
  plus: 'M12 5v14M5 12h14', chev: 'm9 6 6 6-6 6', chevd: 'm6 9 6 6 6-6', folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3', up: 'M12 19V5M5 12l7-7 7 7',
};
function Ico({ n, size = 16 }: { n: string; size?: number }) {
  const fill = n === 'play' || n === 'stop';
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={P[n]} /></svg>;
}
