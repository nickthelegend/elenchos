// Elenchos Studio v2: an online auditor for contracts that trust zkVerify proofs. AlgoCraft IDE's layout (activity
// bar, explorer, Monaco with tabs, terminal underneath, status bar) with the agent chat as the big right-hand panel and
// the audit panel beside the terminal. Files come from the demo targets, your browser, a GitHub file, or a whole public
// GitHub project connected on the server.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor, { DiffEditor, type Monaco } from '@monaco-editor/react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { askZkVerify, runAttack, createReport, getReport, connectDeployed, connectProject, fetchGithubFile, forgeExploit, getTargets, investigate, scanFile, scanProject, verifyFix,
  type AgentEvent, type Finding, type ProjectInfo, type Ready, type Subject, type ToolEvent, type Turn } from '../api.ts';
import { Mark } from '../icons.tsx';
import { defineTheme } from './theme.ts';
import { HOLES_REF, NEW_FILE_TEMPLATE } from './content.ts';
import { Chat, type Command, type Entry } from './Chat.tsx';
import { AuditPanel, type Verdict } from './AuditPanel.tsx';

type File = { key: string; label: string; folder: string; source: string; original: string; kind: 'builtin' | 'local' | 'project'; targetId?: string; projectId?: string; rel?: string; blurb?: string; from?: string };
type Line = { t: number; kind: 'cmd' | 'out' | 'ok' | 'err' | 'warn' | 'dim'; text: string };
type Audit = { findings?: Finding[]; scannedSource?: string; ms?: number; error?: string; entries: Entry[]; patch?: ToolEvent; forge?: ToolEvent; replay?: ToolEvent; attack?: ToolEvent; leaf?: string };
type Section = 'explorer' | 'github' | 'holes' | 'connections';
type Busy = null | 'scan' | 'agent' | 'tool';

const STORE = 'elenchos.studio.files.v2';
const REPO = 'https://github.com/nickthelegend/elenchos';
const READY_LABEL: Record<keyof Ready, string> = { anthropic: 'Claude agent', openai: 'Second opinion', rpc: 'Sepolia RPC', kurier: 'Kurier' };
const READY_HINT: Record<keyof Ready, string> = {
  anthropic: 'Drives the chat agent. Needs ANTHROPIC_API_KEY on the server.',
  openai: 'Optional independent review of each patch. Needs OPENAI_API_KEY.',
  rpc: 'Reads zkVerify’s verifier on Sepolia through public nodes.',
  kurier: 'Submits proofs to zkVerify for the fork tests. Needs KURIER_API_KEY.',
};
const TOOL_NAME: Record<string, string> = { scan: 'Scan', forge: 'Forge exploit', replay: 'Ask zkVerify', patch: 'Verify fix', attack: 'Exploit test' };
const SEV = { critical: 0, high: 1, medium: 2 } as const;
const AGENT_PROMPT: Record<string, string> = {
  '/investigate': 'Find every hole, prove the impact, then propose and verify a fix.',
  '/fix': 'Propose the smallest fix for every finding, then verify it with the patch tool. Do not delete or rename anything to hide a finding.',
  '/explain': 'Explain each finding in plain words: what the hole is, how an attacker would use it, and the fix. Run the scan first if there are no findings yet.',
};

function loadLocal(): File[] {
  try { const raw = localStorage.getItem(STORE); return raw ? (JSON.parse(raw) as File[]).filter((f) => f && f.kind === 'local' && typeof f.source === 'string') : []; } catch { return []; }
}
function saveLocal(files: File[]) { try { localStorage.setItem(STORE, JSON.stringify(files.filter((f) => f.kind === 'local'))); } catch { /* storage unavailable: this visit only */ } }
const base = (p: string) => p.split('/').pop() ?? p;

export function Studio() {
  const [files, setFiles] = useState<File[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [ready, setReady] = useState<Ready | null>(null);
  const [model, setModel] = useState('claude-sonnet-5-5');
  const [runsPerHour, setRunsPerHour] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [audits, setAudits] = useState<Record<string, Audit>>({});
  const [term, setTerm] = useState<Line[]>([{ t: Date.now(), kind: 'dim', text: 'Elenchos Studio · scan, forge, ask zkVerify, verify the fix. Every line below is a real run.' }]);
  const [section, setSection] = useState<Section>('explorer');
  const [showSide, setShowSide] = useState(true);
  const [showChat, setShowChat] = useState(true);
  const [bottomTab, setBottomTab] = useState<'terminal' | 'problems'>('terminal');
  const [view, setView] = useState<'source' | 'diff'>('source');
  const [busy, setBusy] = useState<Busy>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [cursor, setCursor] = useState({ ln: 1, col: 1 });
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches);
  const [mpane, setMpane] = useState<'files' | 'editor' | 'chat' | 'terminal' | 'audit'>('editor');
  const [ghUrl, setGhUrl] = useState('');
  const [ghFile, setGhFile] = useState('');
  const [connecting, setConnecting] = useState<{ url: string; since: number } | null>(null);
  const [ghError, setGhError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [edTick, setEdTick] = useState(0);
  const abortRef = useRef<() => void>();
  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<any>(null);
  const decoRef = useRef<any>(null);
  const termRef = useRef<HTMLDivElement>(null);

  useEffect(() => { document.title = 'Studio · Elenchos'; }, []);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on); return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => { if (!connecting) return; const t = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(t); }, [connecting]);

  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [chains, setChains] = useState<{ id: string; name: string }[]>([]);
  const [deployChain, setDeployChain] = useState('sepolia');
  const [deployAddr, setDeployAddr] = useState('');
  const load = useCallback(() => {
    setLoading(true); setLoadError(null);
    getTargets().then((d) => {
      const builtins: File[] = d.targets.map((t) => ({ key: `demo/${t.title}`, label: t.title, folder: 'demo', source: t.source, original: t.source, kind: 'builtin', targetId: t.id, blurb: t.blurb }));
      const local = loadLocal();
      setFiles((fs) => [...builtins, ...local, ...fs.filter((f) => f.kind === 'project')]);
      setReady(d.ready); if (d.chains) setChains(d.chains); if (d.model) setModel(d.model); setRunsPerHour(d.agentRunsPerHour ?? null);
      const first = builtins[0]?.key ?? local[0]?.key ?? null;
      setOpen((o) => (o.length ? o : first ? [first] : []));
      setActive((a) => a ?? first);
    }).catch((e) => setLoadError(String(e?.message ?? e))).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);
  // #/app?report=<id>: open a shared report's source as a file of yours.
  useEffect(() => {
    if (loading || loadError) return;
    const id = /[?&]report=([A-Za-z0-9_-]{8})/.exec(window.location.hash)?.[1];
    if (!id) return;
    window.history.replaceState(null, '', '#/app');
    getReport(id).then((r) => { const name = base(r.title).replace(/[^A-Za-z0-9_.]/g, '_'); if (addLocal(name, r.source, `report ${id}`)) log('ok', `opened ${name} from report ${id}`); }, (e) => log('err', `report ${id}: ${String(e.message ?? e)}`));
  }, [loading, loadError]); // eslint-disable-line react-hooks/exhaustive-deps

  const file = files.find((f) => f.key === active) ?? null;
  const audit: Audit = (active && audits[active]) || { entries: [] };
  const findings = useMemo(() => [...(audit.findings ?? [])].sort((a, b) => SEV[a.severity] - SEV[b.severity] || a.line - b.line), [audit.findings]);
  const stale = Boolean(file && audit.scannedSource !== undefined && audit.scannedSource !== file.source);
  const allProblems = useMemo(() => Object.entries(audits).flatMap(([k, a]) => (a.scannedSource !== undefined && files.find((f) => f.key === k)?.source !== a.scannedSource ? [] : (a.findings ?? []).map((f) => ({ key: k, f })))), [audits, files]);

  const log = (kind: Line['kind'], text: string) => setTerm((t) => [...t.slice(-500), { t: Date.now(), kind, text }]);
  const patchAudit = (key: string, fn: (a: Audit) => Audit) => setAudits((m) => ({ ...m, [key]: fn(m[key] ?? { entries: [] }) }));
  const push = (key: string, e: Entry) => patchAudit(key, (a) => ({ ...a, entries: [...a.entries, e] }));
  useEffect(() => { termRef.current?.scrollTo({ top: termRef.current.scrollHeight }); }, [term, bottomTab]);
  useEffect(() => { setView('source'); }, [active]);

  // Findings → Monaco markers + whole-line and gutter decorations.
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
      options: { isWholeLine: true, className: `ln-${f.severity}`, glyphMarginClassName: `codicon codicon-${f.severity === 'medium' ? 'warning' : 'error'} gl-${f.severity}`, glyphMarginHoverMessage: { value: `**${f.rule} · ${f.severity}** ${f.title}` },
        after: { content: `  ${f.rule} · ${f.title}`, inlineClassName: `ln-note ln-note-${f.severity}` } },
    })));
  }, [findings, stale, view, active, edTick]);

  const projectOf = (f: File) => projects.find((p) => p.id === f.projectId);
  const editsFor = (projectId: string) => Object.fromEntries(files.filter((x) => x.projectId === projectId && x.source !== x.original).map((x) => [x.rel!, x.source]));
  function subjectOf(f: File): Subject {
    if (f.kind === 'project') return { projectId: f.projectId!, path: f.rel!, edits: editsFor(f.projectId!) };
    if (f.kind === 'builtin' && f.source === f.original && f.targetId) return { targetId: f.targetId };
    return { name: f.label, source: f.source };
  }

  function openFile(key: string) { setOpen((o) => (o.includes(key) ? o : [...o, key])); setActive(key); if (narrow) setMpane('editor'); }
  function closeTab(key: string) { setOpen((o) => { const n = o.filter((p) => p !== key); if (active === key) setActive(n[n.length - 1] ?? null); return n; }); }
  function edit(source: string) {
    if (!file) return;
    setFiles((fs) => { const n = fs.map((f) => (f.key === file.key ? { ...f, source } : f)); saveLocal(n); return n; });
  }
  function addLocal(name: string, source: string, from?: string) {
    const label = name.endsWith('.sol') ? name : `${name}.sol`;
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,47}\.sol$/.test(label)) { log('err', `Can't create "${name}": use letters, digits and underscores, like MyConsumer.sol`); return null; }
    const key = `my/${label}`;
    setFiles((fs) => { const n = [...fs.filter((f) => f.key !== key), { key, label, folder: 'my', source, original: source, kind: 'local' as const, from }]; saveLocal(n); return n; });
    setAudits((m) => { const n = { ...m }; delete n[key]; return n; });
    openFile(key); return key;
  }
  function createFile(raw: string) { const name = raw.trim().replace(/\.sol$/i, ''); if (!name) { setCreating(null); return; } if (addLocal(`${name}.sol`, NEW_FILE_TEMPLATE(name))) { setCreating(null); log('dim', `created my/${name}.sol`); } }
  function deleteFile(key: string) {
    setFiles((fs) => { const n = fs.filter((f) => f.key !== key); saveLocal(n); return n; });
    closeTab(key); setAudits((m) => { const n = { ...m }; delete n[key]; return n; });
  }

  async function importGithubFile() {
    setGhError(null);
    try {
      const r = await fetchGithubFile(ghFile);
      addLocal(r.name, r.source, r.from); setGhFile('');
      log('ok', `imported ${r.name} from ${r.from}`);
      setSection('explorer');
    } catch (e) { setGhError(String((e as Error).message ?? e)); }
  }
  function addProject(p: ProjectInfo) {
    const old = projects.filter((x) => x.repo === p.repo).map((x) => x.id);
    setProjects((ps) => [...ps.filter((x) => x.repo !== p.repo), p]);
    const pf: File[] = p.files.map((f) => ({ key: `gh/${p.id}/${f.path}`, label: base(f.path), folder: p.repo, source: f.source, original: f.source, kind: 'project', projectId: p.id, rel: f.path }));
    setFiles((fs) => [...fs.filter((f) => !(f.kind === 'project' && old.includes(f.projectId!))), ...pf]);
    setSection('explorer');
    if (pf[0]) openFile(pf[0].key);
  }
  async function loadDeployed(addr = deployAddr, chain = deployChain) {
    if (!addr.trim() || connecting) return;
    setGhError(null); setConnecting({ url: addr, since: Date.now() });
    log('cmd', `elenchos fetch --chain ${chain} ${addr.trim()}`);
    try {
      const p = await connectDeployed(chain, addr.trim());
      addProject(p);
      log('ok', `loaded ${p.repo} · ${p.files.length} contract file${p.files.length === 1 ? '' : 's'} · ${p.deps} · ${(p.ms / 1000).toFixed(1)} s`);
      if (p.implementation) log('warn', `${addr.trim().slice(0, 10)}… is a proxy. Its logic lives at ${p.implementation.address}${p.implementation.name ? ` (${p.implementation.name})` : ''}: load that address to audit it.`);
      setDeployAddr('');
    } catch (e) { const msg = String((e as Error).message ?? e); setGhError(msg); log('err', msg); }
    finally { setConnecting(null); }
  }
  async function connect(url = ghUrl) {
    if (!url.trim() || connecting) return;
    setGhError(null); setConnecting({ url, since: Date.now() });
    log('cmd', `elenchos connect ${url.trim()}`);
    try {
      const p = await connectProject(url.trim());
      addProject(p);
      log('ok', `connected ${p.repo} @ ${p.sha.slice(0, 7)} · ${p.kind} · ${p.files.length} contracts · ${p.deps} · ${(p.ms / 1000).toFixed(1)} s`);
      setGhUrl('');
    } catch (e) { const msg = String((e as Error).message ?? e); setGhError(msg); log('err', msg); }
    finally { setConnecting(null); }
  }

  async function runScan(fromChat = false) {
    if (!file || busy) return;
    const f = file; setBusy('scan'); setRunning('scan'); setBottomTab('terminal');
    if (fromChat) push(f.key, { kind: 'user', text: '/audit' });
    log('cmd', `elenchos scan ${f.kind === 'project' ? `${projectOf(f)?.repo}/${f.rel}` : f.key}`);
    try {
      const r = await scanFile(subjectOf(f));
      const crit = r.findings.filter((x) => x.severity === 'critical').length;
      const ev: ToolEvent = { tool: 'scan', status: 'ok', summary: r.findings.length ? `${r.findings.length} finding${r.findings.length === 1 ? '' : 's'}, ${crit} critical · ${r.ms} ms` : `no findings · ${r.ms} ms`, detail: r.findings };
      patchAudit(f.key, (a) => ({ ...a, findings: r.findings, scannedSource: f.source, ms: r.ms, error: undefined, patch: undefined, entries: fromChat ? [...a.entries, { kind: 'tool', event: ev, direct: true }] : a.entries }));
      for (const x of r.findings) log(x.severity === 'medium' ? 'warn' : 'err', `[${x.rule.padEnd(3)} ${x.severity.padEnd(8)}] ${x.contract}.${x.function.split('(')[0]}(…)  ${f.label}:${x.line}  ${x.title}`);
      log(r.findings.length ? 'out' : 'ok', `${r.findings.length} finding${r.findings.length === 1 ? '' : 's'} · ${r.ms} ms · Slither + 5 Elenchos detectors`);
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      patchAudit(f.key, (a) => ({ ...a, error: msg, findings: undefined, scannedSource: undefined, entries: fromChat ? [...a.entries, { kind: 'error', text: msg }] : a.entries }));
      log('err', msg);
      if (f.kind === 'local' && /not found|File not found/.test(msg)) log('warn', 'Its imports do not resolve on their own. Connect the whole repository in the GitHub view so remapped imports work.');
    } finally { setBusy(null); setRunning(null); }
  }

  async function auditProject(p: ProjectInfo) {
    if (busy) return;
    setBusy('scan'); setRunning('scan'); setBottomTab('terminal');
    log('cmd', `elenchos scan ${p.repo} (whole project)`);
    try {
      const r = await scanProject(p.id, editsFor(p.id));
      const byFile = new Map<string, Finding[]>();
      for (const x of r.findings) byFile.set(x.file, [...(byFile.get(x.file) ?? []), x]);
      setAudits((m) => {
        const n = { ...m };
        for (const f of files.filter((x) => x.projectId === p.id)) n[f.key] = { ...(n[f.key] ?? { entries: [] }), findings: byFile.get(f.rel!) ?? [], scannedSource: f.source, ms: r.ms, error: undefined };
        return n;
      });
      for (const x of r.findings) log(x.severity === 'medium' ? 'warn' : 'err', `[${x.rule.padEnd(3)} ${x.severity.padEnd(8)}] ${x.contract}.${x.function.split('(')[0]}(…)  ${x.file}:${x.line}  ${x.title}`);
      log(r.findings.length ? 'out' : 'ok', `${p.repo}: ${r.findings.length} finding${r.findings.length === 1 ? '' : 's'} in ${byFile.size} file${byFile.size === 1 ? '' : 's'} · ${r.ms} ms`);
      if (r.findings.length) { setBottomTab('problems'); const first = files.find((f) => f.projectId === p.id && f.rel === r.findings[0].file); if (first) openFile(first.key); }
    } catch (e) { log('err', String((e as Error).message ?? e)); }
    finally { setBusy(null); setRunning(null); }
  }

  // A pipeline step run directly (no model): the result lands in the terminal, the chat thread and the audit panel.
  async function step(kind: 'forge' | 'replay' | 'verify' | 'attack', fromChat = false) {
    if (!file || busy) return;
    const f = file; setBusy('tool'); setBottomTab('terminal');
    if (fromChat) push(f.key, { kind: 'user', text: kind === 'forge' ? '/forge' : kind === 'replay' ? '/zkverify' : kind === 'attack' ? '/attack' : '/verify' });
    const record = (t: ToolEvent, extra: Partial<Audit> = {}) => {
      log(t.status === 'ok' ? 'ok' : t.status === 'error' ? 'err' : 'warn', `› ${TOOL_NAME[t.tool] ?? t.tool}: ${t.summary}`);
      patchAudit(f.key, (a) => ({ ...a, ...extra, entries: [...a.entries, { kind: 'tool', event: t, direct: true }] }));
    };
    try {
      if (kind === 'attack') {
        setRunning('attack'); log('cmd', `elenchos attack ${f.label}  (forge test on a local EVM, real forged proof)`);
        const r = await runAttack(subjectOf(f));
        for (const t of r.tests) {
          log(t.worked ? 'err' : 'ok', `${t.worked ? '[ATTACK WORKED] ' : '[BLOCKED]       '}${t.name}${t.reason ? `  · ${t.reason}` : ''}${t.gas ? `  (gas ${t.gas})` : ''}`);
          for (const l of t.logs) log('dim', `    ${l}`);
        }
        if (r.compileError) log('err', r.compileError);
        const ev: ToolEvent = { tool: 'attack', status: r.status === 'error' ? 'error' : 'ok', summary: `${r.summary} · ${r.ms} ms`, detail: r };
        record(ev, { attack: ev });
        return;
      }
      if (kind === 'forge' || (kind === 'replay' && !audits[f.key]?.leaf)) {
        setRunning('forge'); log('cmd', 'elenchos forge --attacker-circuit --mint 1000000');
        const r = await forgeExploit();
        record(r.event, { forge: r.event, leaf: r.leaf ?? undefined });
        if (kind === 'replay') {
          if (!r.leaf) throw new Error('The forge step returned no leaf, so there is nothing to ask zkVerify about.');
          setRunning('replay'); log('cmd', `elenchos replay ${r.leaf.slice(0, 12)}… --verifier sepolia`);
          const q = await askZkVerify(r.leaf); record(q.event, { replay: q.event });
        }
      } else if (kind === 'replay') {
        const leaf = audits[f.key]!.leaf!;
        setRunning('replay'); log('cmd', `elenchos replay ${leaf.slice(0, 12)}… --verifier sepolia`);
        const q = await askZkVerify(leaf); record(q.event, { replay: q.event });
      } else {
        if (f.source === f.original) {
          const msg = 'Verify checks your edited file against the original. Edit the contract (or run /fix) first.';
          log('warn', msg); if (fromChat) push(f.key, { kind: 'error', text: msg }); return;
        }
        setRunning('patch'); log('cmd', `elenchos verify ${f.label}  (compile + re-scan + anti-cheat)`);
        const r = await verifyFix(subjectOf(f), f.original, f.source);
        const ev = { ...r.event, detail: { ...r.event.detail, patchedSource: f.source } };
        record(ev, { patch: ev });
      }
    } catch (e) { const msg = String((e as Error).message ?? e); log('err', msg); push(f.key, { kind: 'error', text: msg }); }
    finally { setBusy(null); setRunning(null); }
  }

  // Share: the server re-runs the scan, the exploit test and the fix check on this source, stores the result and
  // returns a link. The browser sends only source code.
  async function share() {
    if (!file || busy) return;
    const f = file; const a = audits[f.key];
    const patchedApplied = Boolean(a?.patch?.detail?.verified && a.patch.detail.patchedSource === f.source);
    let subject: Subject; let patched: string | null = null;
    if (f.kind === 'project') { const e = editsFor(f.projectId!); delete e[f.rel!]; subject = { projectId: f.projectId!, path: f.rel!, edits: e }; if (f.source !== f.original) patched = f.source; }
    else if (f.kind === 'builtin' && f.targetId) { subject = { targetId: f.targetId }; if (f.source !== f.original) patched = f.source; }
    else if (patchedApplied && f.original !== f.source) { subject = { name: f.label, source: f.original }; patched = f.source; }
    else subject = { name: f.label, source: f.source };
    const custom = a?.attack?.detail && a.attack.detail.template === null && a.attack.detail.testSource ? a.attack.detail.testSource as string : null;
    setBusy('tool'); setBottomTab('terminal');
    log('cmd', `elenchos report ${f.label}${patched ? ' --with-fix' : ''}  (the server re-runs scan, exploit test${patched ? ' and fix check' : ''})`);
    try {
      const r = await createReport(subject, patched, custom);
      const url = `${window.location.origin}${window.location.pathname}#/r/${r.id}`;
      log('ok', `report ready in ${r.ms} ms: ${url}`);
      push(f.key, { kind: 'agent', text: `**Report ready.** [Open the shareable report](${url}): findings, the exploit test${patched ? ' on the original and on your fix' : ''}, a README badge, and Markdown or SARIF export.`, done: true });
      setShareUrl(url);
      try { await navigator.clipboard.writeText(url); log('dim', 'link copied to the clipboard'); } catch { /* clipboard unavailable */ }
    } catch (e) { const msg = String((e as Error).message ?? e); log('err', msg); push(f.key, { kind: 'error', text: msg }); }
    finally { setBusy(null); }
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
      } else if (e.kind === 'review') add('assistant', `[second opinion → ${e.status}] ${e.text}`);
      else add('assistant', `[error] ${e.text}`);
    }
    if (turns[0]?.role === 'assistant') turns.unshift({ role: 'user', text: '(earlier commands)' });
    if (turns[turns.length - 1]?.role === 'user') turns.pop();
    return turns.slice(-20).map((t) => ({ ...t, text: t.text.slice(-16000) }));
  }

  function ask(prompt: string, shown = prompt) {
    if (!file || busy || !prompt.trim()) return;
    if (ready && !ready.anthropic) { push(file.key, { kind: 'error', text: 'Setup required: the agent needs ANTHROPIC_API_KEY on the server. The no-model commands still work.' }); return; }
    const f = file; const past = history(audits[f.key] ?? { entries: [] });
    push(f.key, { kind: 'user', text: shown });
    setBusy('agent'); if (narrow) setMpane('chat');
    log('cmd', `elenchos agent "${shown.length > 70 ? `${shown.slice(0, 70)}…` : shown}"  (${f.label})`);
    let buf = '';
    const onEvent = (ev: AgentEvent) => {
      if (ev.type === 'text') {
        buf += ev.text;
        patchAudit(f.key, (a) => { const en = [...a.entries]; const l = en[en.length - 1]; if (l?.kind === 'agent') en[en.length - 1] = { kind: 'agent', text: buf }; else en.push({ kind: 'agent', text: buf }); return { ...a, entries: en }; });
      } else if (ev.type === 'tool') {
        buf = ''; const t = ev.event;
        log(t.status === 'ok' ? 'ok' : t.status === 'error' ? 'err' : t.status === 'setup' ? 'warn' : 'out', `› ${TOOL_NAME[t.tool] ?? t.tool}: ${t.summary}`);
        patchAudit(f.key, (a) => ({
          ...a, entries: [...a.entries, { kind: 'tool', event: t }],
          ...(t.tool === 'scan' && Array.isArray(t.detail) ? { findings: t.detail as Finding[], scannedSource: f.source } : {}),
          ...(t.tool === 'patch' && t.detail?.patchedSource ? { patch: t } : {}),
          ...(t.tool === 'forge' ? { forge: t, leaf: t.detail?.leaf ?? a.leaf } : {}),
          ...(t.tool === 'replay' ? { replay: t } : {}),
          ...(t.tool === 'attack' ? { attack: t } : {}),
        }));
      } else if (ev.type === 'review') push(f.key, { kind: 'review', status: ev.status, text: ev.text });
      else if (ev.type === 'error') { buf = ''; log('err', ev.message); push(f.key, { kind: 'error', text: ev.message }); }
    };
    abortRef.current = investigate(subjectOf(f), prompt, past, onEvent, () => { abortRef.current = undefined; setBusy(null); setRunning(null); log('dim', 'agent finished'); });
  }
  function command(c: Command) {
    if (c.cmd === '/audit') return runScan(true);
    if (c.cmd === '/forge') return step('forge', true);
    if (c.cmd === '/zkverify') return step('replay', true);
    if (c.cmd === '/verify') return step('verify', true);
    if (c.cmd === '/attack') return step('attack', true);
    ask(AGENT_PROMPT[c.cmd], c.cmd);
  }
  function stop() { if (!abortRef.current) return; abortRef.current(); log('warn', 'stopped by you'); }
  function reveal(key: string, line: number) {
    openFile(key); setView('source');
    setTimeout(() => { const ed = editorRef.current; if (!ed) return; ed.revealLineInCenter(line); ed.setPosition({ lineNumber: line, column: 1 }); ed.focus(); }, 80);
  }
  function applyPatch() {
    const src = audit.patch?.detail?.patchedSource; if (!src || !file) return;
    edit(src); setView('source'); log('ok', `applied the fix to ${file.label}; run the audit again to confirm`);
  }

  const verdict: Verdict = audit.patch?.detail?.verified ? { cls: 'safe', icon: 'verified-filled', big: 'Fix verified', sub: 'It compiles, the re-scan is clean, and the receipt check is still there.' }
    : audit.patch ? { cls: 'vuln', icon: 'error', big: 'Fix rejected', sub: audit.patch.summary }
    : audit.error ? { cls: 'warn', icon: 'warning', big: 'Audit failed', sub: audit.error }
    : stale ? { cls: 'pending', icon: 'history', big: 'Edited since the audit', sub: 'Run the audit again to refresh the findings.' }
    : audit.attack?.detail?.status === 'exploitable' && audit.attack.detail.testSource && !stale ? { cls: 'vuln', icon: 'error', big: 'Exploit proven', sub: 'The exploit test paid the attacker on a local EVM, with a real forged proof.' }
    : findings.some((f) => f.severity === 'critical') ? { cls: 'vuln', icon: 'error', big: 'Exploitable', sub: 'A critical hole lets an attacker’s proof through.' }
    : findings.length ? { cls: 'warn', icon: 'warning', big: `${findings.length} to fix`, sub: 'No critical hole, but these need a fix.' }
    : audit.findings ? { cls: 'safe', icon: 'pass-filled', big: 'No holes found', sub: 'None of E1, E1b, E3, E4, E6.' }
    : { cls: 'pending', icon: 'circle-large', big: 'Not audited yet', sub: 'Run audit, type /audit in the chat, or ask Elenchos.' };
  const steps = ['scan', 'forge', 'replay', 'attack', 'patch'].map((t) => {
    const ev = [...audit.entries].reverse().find((e) => e.kind === 'tool' && e.event.tool === t) as { event: ToolEvent } | undefined;
    return { t, st: t === 'scan' && audit.findings ? 'ok' as const : t === 'patch' && audit.patch ? audit.patch.status : t === 'forge' && audit.forge ? audit.forge.status : t === 'replay' && audit.replay ? audit.replay.status : t === 'attack' && audit.attack ? audit.attack.status : ev?.event.status };
  });

  if (loadError) return <Offline message={loadError} onRetry={load} />;

  /* ---------- pieces ---------- */
  const actionsDisabled = !file || Boolean(busy);
  const toolbar = (
    <header className="sd-toolbar">
      <a className="sd-brand" href="#/" aria-label="Elenchos home"><Mark size={22} /><span>Elenchos</span><em>Studio</em></a>
      <div className="sd-actions">
        <button className="sd-btn primary" onClick={() => runScan()} disabled={actionsDisabled} title="Slither + the five Elenchos detectors. No model."><i className={`codicon codicon-${busy === 'scan' ? 'loading codicon-modifier-spin' : 'play'}`} /><span>Run audit</span></button>
        <button className="sd-btn" onClick={() => step('forge')} disabled={actionsDisabled} title="A real Groth16 proof from an attacker circuit, with its zkVerify leaf. No model."><i className="codicon codicon-key" /><span>Forge exploit</span></button>
        <button className="sd-btn hide-md" onClick={() => step('replay')} disabled={actionsDisabled} title="Reads zkVerify's real verifier on Sepolia for the forged leaf. No model."><i className="codicon codicon-type-hierarchy" /><span>Ask zkVerify</span></button>
        <button className="sd-btn" onClick={() => step('attack')} disabled={actionsDisabled} title="Runs a real Foundry exploit test against this file on a local EVM, with a real forged proof. No model."><i className="codicon codicon-debug-alt" /><span>Run exploit test</span></button>
        <button className="sd-btn hide-md" onClick={() => step('verify')} disabled={actionsDisabled} title="Compiles your edited file, re-scans it and rejects fixes that cheat. No model."><i className="codicon codicon-tools" /><span>Verify fix</span></button>
        {busy && <span className="sd-busy"><span className="pulse" />{busy === 'scan' ? 'Scanning…' : busy === 'tool' ? 'Running…' : 'Agent working…'}</span>}
      </div>
      <div className="sd-right">
        {shareUrl && <a className="sd-link hide-md" href={shareUrl} target="_blank" rel="noreferrer"><i className="codicon codicon-link-external" />Open report</a>}
        <button className="sd-btn" onClick={share} disabled={actionsDisabled} title="The server re-runs the audit, the exploit test and your fix, and gives you a link with a README badge."><i className="codicon codicon-export" /><span>Share report</span></button>
        <button className="sd-link hide-md" onClick={() => { setSection('github'); setShowSide(true); if (narrow) setMpane('files'); }}><i className="codicon codicon-github" />Connect repo</button>
        <a className="sd-link hide-md" href={REPO} target="_blank" rel="noreferrer"><i className="codicon codicon-link-external" />Source</a>
        {!narrow && <button className={`ic${showChat ? ' on' : ''}`} aria-label="Toggle chat" title="Toggle chat" onClick={() => setShowChat(!showChat)}><i className="codicon codicon-layout-sidebar-right" /></button>}
      </div>
    </header>
  );

  const activity = (
    <nav className="sd-activity" aria-label="Views">
      {([['explorer', 'files', 'Explorer'], ['github', 'github', 'GitHub'], ['holes', 'book', 'The five holes'], ['connections', 'plug', 'Connections']] as const).map(([id, ic, label]) => (
        <button key={id} className={section === id && showSide ? 'on' : ''} aria-label={label} title={label}
          onClick={() => { if (section === id) setShowSide(!showSide); else { setSection(id); setShowSide(true); } }}>
          <i className={`codicon codicon-${ic}`} />
          {id === 'explorer' && allProblems.length > 0 && <span className="badge">{allProblems.length}</span>}
        </button>
      ))}
    </nav>
  );

  const projectFolders = projects.map((p) => ({ p, tree: buildTree(files.filter((f) => f.projectId === p.id)) }));

  const sidebar = (
    <div className="sd-side">
      {narrow && (
        <div className="sd-msect" role="tablist">
          {([['explorer', 'Files'], ['github', 'GitHub'], ['holes', 'Holes'], ['connections', 'Setup']] as const).map(([id, l]) => <button key={id} role="tab" aria-selected={section === id} onClick={() => setSection(id)}>{l}</button>)}
        </div>
      )}
      {section === 'explorer' && (
        <>
          <div className="sd-head"><span>Explorer</span>
            <span className="acts">
              <button className="ic" aria-label="New file" title="New file" onClick={() => setCreating('')}><i className="codicon codicon-new-file" /></button>
              <button className="ic" aria-label="Import from GitHub" title="Import from GitHub" onClick={() => setSection('github')}><i className="codicon codicon-repo-clone" /></button>
            </span>
          </div>
          <div className="sd-tree">
            <Folder name="demo" hint="built-in targets">
              {files.filter((f) => f.kind === 'builtin').map((f) => <FileRow key={f.key} f={f} active={active === f.key} audit={audits[f.key]} onOpen={() => openFile(f.key)} />)}
            </Folder>
            <Folder name="my" hint="saved in this browser">
              {files.filter((f) => f.kind === 'local').map((f) => <FileRow key={f.key} f={f} active={active === f.key} audit={audits[f.key]} onOpen={() => openFile(f.key)} onDelete={() => deleteFile(f.key)} />)}
              {creating !== null
                ? <form className="sd-new" onSubmit={(e) => { e.preventDefault(); createFile(creating); }}>
                    <input autoFocus value={creating} onChange={(e) => setCreating(e.target.value)} placeholder="MyConsumer.sol" aria-label="New file name" onBlur={() => !creating && setCreating(null)} onKeyDown={(e) => e.key === 'Escape' && setCreating(null)} />
                  </form>
                : !files.some((f) => f.kind === 'local') && <button className="sd-empty-new" onClick={() => setCreating('')}><i className="codicon codicon-add" />New file, or paste your contract</button>}
            </Folder>
            {projectFolders.map(({ p, tree }) => (
              <Folder key={p.id} name={p.repo} hint={p.explorer ? `deployed · ${p.deps}` : `${p.sha.slice(0, 7)} · ${p.kind}`} icon={p.explorer ? 'globe' : 'repo'} action={<button className="ic" title={`Audit all of ${p.repo}`} aria-label={`Audit all of ${p.repo}`} onClick={() => auditProject(p)} disabled={Boolean(busy)}><i className="codicon codicon-run-all" /></button>}>
                <Tree node={tree} depth={0} active={active} audits={audits} onOpen={openFile} />
              </Folder>
            ))}
            {!projects.length && <button className="sd-empty-new gh" onClick={() => setSection('github')}><i className="codicon codicon-github" />Connect a GitHub repository</button>}
          </div>
          {file?.blurb && <div className="sd-blurb"><b>{file.label}</b>{file.blurb}</div>}
          {file?.kind === 'project' && <div className="sd-blurb"><b>{projectOf(file)?.repo}</b>{file.rel} · {projectOf(file)?.explorer ? 'verified source of the deployed contract' : `cloned at ${projectOf(file)?.sha.slice(0, 7)}`}. Edits stay in this browser; audits run on a fresh copy.</div>}
        </>
      )}
      {section === 'github' && (
        <>
          <div className="sd-head"><span>Import</span></div>
          <div className="sd-list">
            <form className="gh-card" onSubmit={(e) => { e.preventDefault(); connect(); }}>
              <b><i className="codicon codicon-repo" />Connect a repository</b>
              <p>Clones a public repo on the server with its submodules, lists its contracts and audits them with imports resolved.</p>
              <input value={ghUrl} onChange={(e) => setGhUrl(e.target.value)} placeholder="github.com/owner/repo or owner/repo" aria-label="Repository URL" disabled={Boolean(connecting)} />
              <button className="sd-btn primary" disabled={!ghUrl.trim() || Boolean(connecting)}>{connecting ? <><i className="codicon codicon-loading codicon-modifier-spin" />Cloning… {Math.round((Date.now() - connecting.since) / 1000)} s</> : <><i className="codicon codicon-plug" />Connect</>}</button>
              {connecting && <p className="gh-wait">Big repos with OpenZeppelin submodules take a minute or two.</p>}
              <div className="gh-try">Try: {['nickthelegend/elenchos/tree/main/contracts'].map((u) => <button type="button" key={u} onClick={() => { setGhUrl(u); connect(`https://github.com/${u}`); }} disabled={Boolean(connecting)}>{u}</button>)}</div>
            </form>
            <form className="gh-card" onSubmit={(e) => { e.preventDefault(); importGithubFile(); }}>
              <b><i className="codicon codicon-file-code" />Import one file</b>
              <p>Paste the GitHub link of a single <code>.sol</code> file. Your browser fetches it into <code>my/</code>.</p>
              <input value={ghFile} onChange={(e) => setGhFile(e.target.value)} placeholder="github.com/owner/repo/blob/main/src/X.sol" aria-label="File URL" />
              <button className="sd-btn" disabled={!ghFile.trim()}><i className="codicon codicon-cloud-download" />Import</button>
            </form>
            <form className="gh-card" onSubmit={(e) => { e.preventDefault(); loadDeployed(); }}>
              <b><i className="codicon codicon-globe" />Audit a deployed contract</b>
              <p>Loads its verified source from Sourcify (or Blockscout) with the exact compiler it was deployed with.</p>
              <div className="gh-row">
                <select value={deployChain} onChange={(e) => setDeployChain(e.target.value)} aria-label="Chain" disabled={Boolean(connecting) || !chains.length}>
                  {chains.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input value={deployAddr} onChange={(e) => setDeployAddr(e.target.value)} placeholder="0x… contract address" aria-label="Contract address" disabled={Boolean(connecting)} spellCheck={false} />
              </div>
              <button className="sd-btn" disabled={!/^0x[0-9a-fA-F]{40}$/.test(deployAddr.trim()) || Boolean(connecting)}>{connecting && connecting.url === deployAddr ? <><i className="codicon codicon-loading codicon-modifier-spin" />Fetching…</> : <><i className="codicon codicon-cloud-download" />Load contract</>}</button>
              <div className="gh-try">Try: <button type="button" onClick={() => { setDeployChain('sepolia'); setDeployAddr('0x5a3c35CCC5c05fDeFe5Ecafc15F4B1aC8eF71481'); loadDeployed('0x5a3c35CCC5c05fDeFe5Ecafc15F4B1aC8eF71481', 'sepolia'); }} disabled={Boolean(connecting)}>zkVerify’s aggregation contract (Sepolia)</button></div>
            </form>
            {ghError && <p className="gh-err" role="alert"><i className="codicon codicon-error" />{ghError}</p>}
            {projects.map((p) => (
              <div key={p.id} className="gh-proj">
                <div className="hh"><i className={`codicon codicon-${p.explorer ? 'globe' : 'repo'}`} /><b>{p.repo}</b>{!p.explorer && <em>{p.sha.slice(0, 7)}</em>}</div>
                {p.explorer && <a className="gh-link" href={p.explorer} target="_blank" rel="noreferrer"><i className="codicon codicon-link-external" />View on explorer</a>}
                <p>{p.explorer ? 'deployed' : p.kind} · {p.files.length} contracts · {p.deps} · expires {new Date(p.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                <button className="sd-btn sm" onClick={() => auditProject(p)} disabled={Boolean(busy)}><i className="codicon codicon-run-all" />Audit whole project</button>
              </div>
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
                <div className="hh"><i className={`codicon codicon-${h.sev === 'medium' ? 'warning' : 'error'} sv-${h.sev}`} /><b>{h.r}</b><span className={`sev ${h.sev}`}>{h.sev}</span></div>
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
                <div className="hh"><i className={`codicon codicon-${ready[k] ? 'pass-filled' : 'warning'}`} /><b>{READY_LABEL[k]}</b><em>{ready[k] ? 'ready' : 'Setup required'}</em></div>
                <p>{READY_HINT[k]}</p>
              </div>
            ))}
            <p className="sd-note">The scanner, the compiler, the prover and the verifier read need no key. Only the chat agent uses a model.</p>
          </div>
        </>
      )}
    </div>
  );

  const tabs = (
    <div className="sd-tabs" role="tablist">
      {open.map((k) => {
        const f = files.find((x) => x.key === k); if (!f) return null; const dirty = f.source !== f.original;
        return (
          <div key={k} className={`sd-tab${k === active ? ' on' : ''}`} role="tab" aria-selected={k === active}>
            <button className="tab-name" onClick={() => setActive(k)}><i className="codicon codicon-file-code" />{f.label}{dirty && <span className="dirty" title="edited" />}</button>
            <button className="tab-x" aria-label={`Close ${f.label}`} onClick={() => closeTab(k)}><i className="codicon codicon-close" /></button>
          </div>
        );
      })}
      <div className="grow" />
      {file && audit.patch?.detail?.patchedSource && (
        <div className="sd-viewsw">
          <button className={view === 'source' ? 'on' : ''} onClick={() => setView('source')}>Source</button>
          <button className={view === 'diff' ? 'on' : ''} onClick={() => setView('diff')}><i className={`codicon codicon-${audit.patch.detail.verified ? 'verified-filled' : 'error'}`} />Fix · {audit.patch.detail.verified ? 'verified' : 'rejected'}</button>
        </div>
      )}
    </div>
  );

  const crumbs = file ? (file.kind === 'project' ? [projectOf(file)?.repo ?? 'project', ...file.rel!.split('/')] : [file.folder, file.label]) : [];
  const editor = (
    <div className="sd-editor">
      {tabs}
      <div className="sd-crumbs">
        {file ? crumbs.map((c, i) => <span key={i} className={i === crumbs.length - 1 ? 'last' : ''}>{i > 0 && <i className="codicon codicon-chevron-right" />}{c}</span>) : <span>No file open</span>}
        {file && file.source !== file.original && <button className="sd-reset" onClick={() => edit(file.original)}><i className="codicon codicon-discard" />Revert</button>}
      </div>
      <div className="sd-monaco">
        {loading && <div className="sd-loading"><span className="spin" />Loading the workspace…</div>}
        {!loading && !file && <div className="sd-welcome"><Mark size={56} /><h2>Open a contract to audit</h2><p>Pick a demo target, create a file, or connect a GitHub repository.</p></div>}
        {file && view === 'source' && (
          <Editor key={file.key} path={file.key} language="sol" theme="elenchos" value={file.source}
            onChange={(v) => edit(v ?? '')} beforeMount={defineTheme}
            onMount={(ed, m) => { editorRef.current = ed; monacoRef.current = m; ed.onDidChangeCursorPosition((e: any) => setCursor({ ln: e.position.lineNumber, col: e.position.column })); setCursor({ ln: 1, col: 1 }); setEdTick((x) => x + 1); }}
            loading={<div className="sd-loading"><span className="spin" />Loading the editor…</div>}
            options={{ fontFamily: '"Commit Mono", ui-monospace, Menlo, monospace', fontSize: 13.5, lineHeight: 22, minimap: { enabled: !narrow, scale: 1 }, glyphMargin: true, scrollBeyondLastLine: false, smoothScrolling: true, cursorBlinking: 'smooth', renderLineHighlight: 'all', padding: { top: 10 }, automaticLayout: true, wordWrap: narrow ? 'on' : 'off', fixedOverflowWidgets: true }} />
        )}
        {file && view === 'diff' && audit.patch?.detail?.patchedSource && (
          <div className="sd-diffwrap">
            <div className={`sd-diffbar ${audit.patch.detail.verified ? 'ok' : 'bad'}`}>
              <i className={`codicon codicon-${audit.patch.detail.verified ? 'verified-filled' : 'error'}`} />
              <span><b>{audit.patch.detail.verified ? 'Fix verified' : 'Fix rejected'}</b> · {audit.patch.summary}</span>
              {audit.patch.detail.verified && audit.patch.detail.patchedSource !== file.source && <button className="sd-btn primary sm" onClick={applyPatch}><i className="codicon codicon-check" />Apply to {file.label}</button>}
            </div>
            <DiffEditor original={file.original} modified={audit.patch.detail.patchedSource} language="sol" theme="elenchos" beforeMount={defineTheme}
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
        <button role="tab" aria-selected={bottomTab === 'problems'} onClick={() => setBottomTab('problems')}>Problems {allProblems.length > 0 && <span className="badge">{allProblems.length}</span>}</button>
        <div className="grow" />
        {bottomTab === 'terminal' && <button className="ic" aria-label="Clear terminal output" title="Clear" onClick={() => setTerm([])}><i className="codicon codicon-clear-all" /></button>}
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
          {!allProblems.length && <div className="sd-none">No problems found yet. Run the audit on a file, or audit a whole connected project.</div>}
          {allProblems.map(({ key, f }, i) => (
            <button key={i} className="sd-prob row" onClick={() => reveal(key, f.line)}>
              <i className={`codicon codicon-${f.severity === 'medium' ? 'warning' : 'error'} sv-${f.severity}`} /><b>{f.rule}</b><span className="pr-t">{f.title}</span><em>{f.function.split('(')[0]} · {files.find((x) => x.key === key)?.label}:{f.line}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const auditPanel = <AuditPanel fileName={file?.label ?? null} verdict={verdict} steps={steps} findings={findings} stale={stale} ms={audit.ms} forge={audit.forge} replay={audit.replay} attack={audit.attack} running={running} onReveal={(f) => active && reveal(active, f.line)} />;
  const chat = (
    <Chat fileName={file?.label ?? null} entries={audit.entries} busy={busy} ready={Boolean(ready?.anthropic)} model={model} runsPerHour={runsPerHour}
      findingCount={audit.findings && !stale ? findings.length : null} onSend={(t) => ask(t)} onCommand={command} onStop={stop}
      onClear={() => file && patchAudit(file.key, (a) => ({ ...a, entries: [] }))} onOpenDiff={() => { setView('diff'); if (narrow) setMpane('editor'); }} onApply={applyPatch}
      canApply={Boolean(audit.patch?.detail?.verified && file && audit.patch.detail.patchedSource !== file.source)} />
  );

  const status = (
    <footer className="sd-status">
      <span className="st-brand"><i className="codicon codicon-shield" />Elenchos</span>
      {ready && (Object.keys(ready) as (keyof Ready)[]).map((k) => <span key={k} className={`st-item hide-sm${ready[k] ? '' : ' off'}`} title={READY_HINT[k]}><i className={`codicon codicon-${ready[k] ? 'pass' : 'warning'}`} />{READY_LABEL[k]}</span>)}
      <span className="grow" />
      {file && <span className="st-item"><i className={`codicon codicon-${stale ? 'history' : audit.findings ? (findings.length ? 'error' : 'pass') : 'circle-large'}`} />{stale ? 'edited · re-run audit' : audit.findings ? `${findings.length} problem${findings.length === 1 ? '' : 's'}` : 'not audited'}</span>}
      <span className="st-item hide-md">Ln {cursor.ln}, Col {cursor.col}</span>
      <span className="st-item hide-md">Solidity</span>
    </footer>
  );

  if (narrow) {
    return (
      <div className="sd sd-narrow">
        {toolbar}
        <main className="sd-mmain">
          {mpane === 'files' && sidebar}
          {mpane === 'editor' && editor}
          {mpane === 'chat' && chat}
          {mpane === 'terminal' && terminal}
          {mpane === 'audit' && auditPanel}
        </main>
        <nav className="sd-mtabs" aria-label="Panels">
          {([['files', 'files', 'Files'], ['editor', 'code', 'Code'], ['chat', 'sparkle', 'Chat'], ['terminal', 'terminal', 'Terminal'], ['audit', 'shield', 'Audit']] as const).map(([p, ic, l]) => (
            <button key={p} aria-pressed={mpane === p} onClick={() => setMpane(p)}><i className={`codicon codicon-${ic}`} /><span>{l}</span>{p === 'audit' && findings.length > 0 && !stale && <span className="badge">{findings.length}</span>}</button>
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
        <PanelGroup direction="horizontal" autoSaveId="elenchos-studio-v2-h">
          {showSide && <><Panel id="side" order={1} defaultSize={16} minSize={11} maxSize={30}>{sidebar}</Panel><PanelResizeHandle className="rh v" /></>}
          <Panel id="main" order={2} minSize={35}>
            <PanelGroup direction="vertical" autoSaveId="elenchos-studio-v2-v">
              <Panel defaultSize={62} minSize={25}>{editor}</Panel>
              <PanelResizeHandle className="rh h" />
              <Panel defaultSize={38} minSize={14}>
                <PanelGroup direction="horizontal" autoSaveId="elenchos-studio-v2-b">
                  <Panel defaultSize={52} minSize={25}>{terminal}</Panel>
                  <PanelResizeHandle className="rh v" />
                  <Panel defaultSize={48} minSize={25}>{auditPanel}</Panel>
                </PanelGroup>
              </Panel>
            </PanelGroup>
          </Panel>
          {showChat && <><PanelResizeHandle className="rh v" /><Panel id="chat" order={3} defaultSize={30} minSize={22} maxSize={45}>{chat}</Panel></>}
        </PanelGroup>
      </div>
      {status}
    </div>
  );
}

/* ---------- explorer ---------- */
type TreeNode = { dirs: Map<string, TreeNode>; files: File[] };
function buildTree(fs: File[]): TreeNode {
  const root: TreeNode = { dirs: new Map(), files: [] };
  for (const f of fs) {
    const parts = f.rel!.split('/'); let n = root;
    for (const d of parts.slice(0, -1)) { if (!n.dirs.has(d)) n.dirs.set(d, { dirs: new Map(), files: [] }); n = n.dirs.get(d)!; }
    n.files.push(f);
  }
  return root;
}
function Tree({ node, depth, active, audits, onOpen }: { node: TreeNode; depth: number; active: string | null; audits: Record<string, Audit>; onOpen: (k: string) => void }) {
  return (
    <>
      {[...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, n]) => (
        <SubFolder key={name} name={name} depth={depth}><Tree node={n} depth={depth + 1} active={active} audits={audits} onOpen={onOpen} /></SubFolder>
      ))}
      {[...node.files].sort((a, b) => a.label.localeCompare(b.label)).map((f) => <FileRow key={f.key} f={f} depth={depth} active={active === f.key} audit={audits[f.key]} onOpen={() => onOpen(f.key)} />)}
    </>
  );
}
function SubFolder({ name, depth, children }: { name: string; depth: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(depth < 2);
  return (
    <div>
      <button className="fo sub" style={{ paddingLeft: 22 + depth * 12 }} onClick={() => setOpen(!open)} aria-expanded={open}><i className={`codicon codicon-chevron-${open ? 'down' : 'right'}`} /><i className={`codicon codicon-folder${open ? '-opened' : ''}`} /><span>{name}</span></button>
      {open && children}
    </div>
  );
}
function Folder({ name, hint, icon = 'folder', action, children }: { name: string; hint: string; icon?: string; action?: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="sd-folder">
      <div className="fo-row">
        <button className="fo" onClick={() => setOpen(!open)} aria-expanded={open}><i className={`codicon codicon-chevron-${open ? 'down' : 'right'}`} /><i className={`codicon codicon-${icon === 'folder' && open ? 'folder-opened' : icon}`} /><span>{name}</span><em>{hint}</em></button>
        {action}
      </div>
      {open && <div className="fo-kids">{children}</div>}
    </div>
  );
}
function FileRow({ f, active, audit, onOpen, onDelete, depth = 0 }: { f: File; active: boolean; audit?: Audit; onOpen: () => void; onDelete?: () => void; depth?: number }) {
  const n = audit?.findings?.length ?? 0; const crit = audit?.findings?.some((x) => x.severity === 'critical');
  const stale = audit?.scannedSource !== undefined && audit.scannedSource !== f.source;
  return (
    <div className={`sd-file${active ? ' on' : ''}`}>
      <button className="fn" onClick={onOpen} style={{ paddingLeft: 34 + depth * 12 }} title={f.from ?? f.label}><i className="codicon codicon-file-code" />{f.label}{f.source !== f.original && <span className="dirty" />}</button>
      {audit?.findings && (stale ? <span className="fcount" title="edited since the audit"><i className="codicon codicon-history" /></span> : <span className={`fcount ${n ? (crit ? 'crit' : 'warn') : 'ok'}`}>{n || <i className="codicon codicon-check" />}</span>)}
      {onDelete && <button className="fdel" aria-label={`Delete ${f.label}`} title="Delete" onClick={onDelete}><i className="codicon codicon-trash" /></button>}
    </div>
  );
}

function Offline({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="setup">
      <a className="cr-brand" href="#/"><Mark size={28} /><span>Elenchos</span><em>/ studio</em></a>
      <div className="setup-card">
        <img src="/art/empty.webp" alt="The scanner orb, resting" width={170} height={170} />
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
