import { useEffect, useState } from 'react';
import { Mark } from './icons.tsx';

const REPO = 'https://github.com/nickthelegend/elenchos';
const FILM = 'https://github.com/nickthelegend/elenchos/releases/tag/v0.1.0';
const ARTICLE = `${REPO}/blob/main/docs/zkverify-verified-both.md`;
const RECAP = `${REPO}/blob/main/docs/agent-games-four-tracks.md`;
const VERIFIER = '0xEA0A0f1EfB1088F4ff0Def03741Cb2C64F89361E';

const art = (n: string) => `/art/${n}.webp`;

function Obj({ name, alt, size = 160, className = '' }: { name: string; alt: string; size?: number; className?: string }) {
  return (
    <div className={`obj ${className}`} style={{ width: size, height: size }}>
      <span className="obj-glow" aria-hidden />
      <img src={art(name)} alt={alt} width={size} height={size} loading="lazy" decoding="async" />
    </div>
  );
}

function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on(); window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const links = [['#studio', 'Studio'], ['#how', 'How it works'], ['#holes', 'The five holes'], ['#fix', 'The fix'], ['#arena', 'Arena'], [ARTICLE, 'Write-up']];
  return (
    <header className={`l-nav${scrolled ? ' scrolled' : ''}`}>
      <div className="l-wrap l-nav-in">
        <a className="l-brand" href="#top" aria-label="Elenchos home"><Mark size={30} /><span>Elenchos</span></a>
        <nav className={`l-links${open ? ' open' : ''}`} aria-label="Main">
          {links.map(([h, t]) => <a key={h} href={h} onClick={() => setOpen(false)}>{t}</a>)}
          <a className="l-links-cta" href="#/app">Open the studio</a>
        </nav>
        <div className="l-nav-right">
          <a className="btn ghost sm hide-sm" href={REPO}><GitHub /> GitHub</a>
          <a className="btn primary sm hide-sm" href="#/app">Open the studio <Arrow /></a>
          <button className="l-burger" aria-expanded={open} aria-label="Menu" onClick={() => setOpen(!open)}><span /><span /></button>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="hero" id="top">
      <div className="l-wrap">
        <a className="pill" href={RECAP}><span className="pill-dot" />Built for the zkVerify Agent Games · all four tracks entered <Arrow /></a>
        <div className="hero-grid">
          <h1 className="hero-h">A valid proof can still back <em>the wrong claim.</em></h1>
          <div className="hero-side">
            <p>Elenchos is a red-team agent for smart contracts that trust zkVerify. It finds the hole, forges the proof that
              exploits it, asks the real verifier, then writes the fix and refuses to cheat.</p>
            <div className="hero-cta">
              <a className="btn primary" href="#/app">Open the studio <Arrow /></a>
              <a className="btn ghost" href={FILM}><Play /> Watch the film</a>
            </div>
          </div>
        </div>
      </div>
      <div className="l-wrap">
        <div className="hero-stage">
          <img className="hero-img" src={art('hero')} alt="A cobalt glass lens examining a glowing proof crystal on a dark circuit pedestal" width={1536} height={1024} fetchPriority="high" />
          <div className="hero-grain" aria-hidden />
          <div className="hero-card glass">
            <div className="hc-head"><span className="eyebrow">A real run · Sepolia · Nov 16</span><span className="tag coral">forgery rejected by zkVerify</span></div>
            <div className="hc-steps">
              <Step n="01" t="Scan" v="E1 · line 25" d="caller picks the key" />
              <Step n="02" t="Forge" v="132 ms" d="Groth16, verified locally" tone="coral" />
              <Step n="03" t="Ask zkVerify" v="#270047" d="leaf not in aggregation" />
              <Step n="04" t="Verify fix" v="compiles · clean" d="re-scan finds nothing" tone="mint" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Step({ n, t, v, d, tone }: { n: string; t: string; v: string; d: string; tone?: 'coral' | 'mint' }) {
  return (
    <div className={`hc-step${tone ? ` ${tone}` : ''}`}>
      <div className="hc-n">{n}</div>
      <div className="hc-t">{t}</div>
      <div className="hc-v">{v}</div>
      <div className="hc-d">{d}</div>
    </div>
  );
}

function Stack() {
  const items = [
    ['zkVerify node', 'vk_hash_groth16 RPC'],
    ['zkVerify verifier', 'Sepolia · 0xEA0A…361E'],
    ['Groth16', 'snarkjs proofs'],
    ['Slither', 'data-dependency scan'],
    ['Foundry', 'compile + attack tests'],
    ['GitHub', 'code scanning (SARIF)'],
  ];
  return (
    <section className="stack" aria-label="What it runs against">
      <div className="l-wrap">
        <p className="stack-h">No mocks. Every step runs against the real thing.</p>
        <div className="stack-row">
          {items.map(([a, b]) => <div key={a} className="stack-item"><b>{a}</b><span>{b}</span></div>)}
        </div>
      </div>
    </section>
  );
}

function StudioShowcase() {
  return (
    <section className="sec showcase" id="studio">
      <div className="l-wrap">
        <div className="sec-head center">
          <span className="eyebrow">Elenchos Studio</span>
          <h2>An online auditor for ZK contracts. Paste, press Run, watch it prove.</h2>
          <p>An editor, a terminal and the agent side by side. Bring your own zkVerify consumer, or start from a demo target.</p>
        </div>
        <a className="shot" href="#/app" aria-label="Open the studio">
          <img src="/shots/studio.webp" alt="Elenchos Studio after a real investigation: the verified fix as a diff, the terminal log of scan, forge, zkVerify and verify, and the audit panel with the evidence" width={1440} height={900} loading="lazy" />
        </a>
        <div className="show-points">
          <div><b>Run audit</b><span>Slither and five detectors on any pasted contract, in about half a second. No model, no key.</span></div>
          <div><b>Run exploit test</b><span>A real Foundry test on a Sepolia fork, against zkVerify’s real verifier, with an attacker proof zkVerify really aggregated. Then on the fix: it reverts.</span></div>
          <div><b>Ask the agent</b><span>It scans, forges a real Groth16 exploit, asks zkVerify on Sepolia, writes the fix and proves it holds.</span></div>
          <div><b>Apply the fix</b><span>Only a patch that compiles, scans clean and keeps the receipt check is marked verified.</span></div>
          <div><b>Share the report</b><span>The server re-runs everything, anchors the report on zkVerify, and gives you a link anyone can check on Sepolia, plus a badge.</span></div>
          <div><b>Bring any contract</b><span>Paste it, connect a GitHub repo, or load a deployed contract by address on ten chains.</span></div>
        </div>
      </div>
    </section>
  );
}

function Problem() {
  return (
    <section className="sec" id="problem">
      <div className="l-wrap problem">
        <div className="problem-copy">
          <span className="eyebrow">The problem</span>
          <h2>zkVerify checks the proof. Your contract has to check the claim.</h2>
          <p>A zkVerify receipt proves that <i>some</i> statement was aggregated. It never says the statement came from the
            circuit you meant to trust. If your contract lets the caller choose the verification key, an attacker writes
            their own circuit, proves “mint me a million”, and your contract pays.</p>
          <div className="keys">
            <div className="key ok"><span>honest circuit key</span><code>0x42d82915…47d19f3c</code></div>
            <div className="key bad"><span>attacker circuit key</span><code>0xb8e09b08…bdd48a2b</code></div>
            <p className="keys-note">Both are real Groth16 keys, hashed by a zkVerify node. Both proofs verify. Only one is the claim you meant.</p>
          </div>
        </div>
        <div className="problem-art">
          <Obj name="pinned-key" alt="A cobalt glass key locked into a padlock" size={230} className="float a" />
          <Obj name="forged-key" alt="A coral enamel key with crooked teeth" size={210} className="float b" />
          <span className="vs">vs</span>
        </div>
      </div>
    </section>
  );
}

const STAGES = [
  {
    id: 'scan', obj: 'scanner', title: 'Scan', h: 'Find the line the attacker controls',
    p: 'A Slither-based detector follows every argument of verifyProofAggregation back to where it comes from, and reports the five receipt-consumer holes on the exact line.',
    out: ['$ elenchos scan contracts/src/demo', '[E1  critical] VulnerableMint.claim(...)  :25  vkHash from caller', '[E3  high    ] VulnerableMint.claim(...)  :24  receipt never recorded', '[E6  medium  ] VulnerableMint.claim(...)  :26  domainId from caller', '3 findings'],
  },
  {
    id: 'forge', obj: 'forged-key', title: 'Forge', h: 'Prove the impact with a real proof',
    p: 'The agent compiles an attacker circuit that claims “mint 1,000,000”, proves it with Groth16, verifies it locally, and gets its real zkVerify leaf from a zkVerify node.',
    out: ['forge  attacker circuit · mint 1,000,000', 'proof  groth16 · verified locally in 132 ms', 'vkHash 0xb8e09b08…bdd48a2b   (zkVerify node)', 'leaf   0x90c6646e…ff1db32d1', 'status the contract would accept this'],
  },
  {
    id: 'replay', obj: 'merkle', title: 'Ask zkVerify', h: 'zkVerify itself is never fooled',
    p: 'The replay step asks zkVerify’s real verifier on Sepolia whether the forged leaf is in its latest real aggregation. It is not: the hole is in the consumer, not in zkVerify.',
    out: [`verifier ${VERIFIER.slice(0, 10)}…${VERIFIER.slice(-4)} · Sepolia`, 'domain   0', 'aggregation #270047 · block 12133598', 'root     0xd3e828a1…1cba4db', 'result   verifyProofAggregation → false'],
  },
  {
    id: 'patch', obj: 'wrench', title: 'Verify fix', h: 'A fix only counts if it compiles and the scan comes back clean',
    p: 'The model proposes a patch. Foundry compiles it, the scanner re-runs, and an anti-cheat check rejects any “fix” that deletes or renames the function or rips out the receipt check.',
    out: ['patch   pin vkHash + domainId as immutables', 'forge build ✓  compiles', 'rescan  0 findings', 'evasion none (function kept, receipt check kept)', 'verdict FIX VERIFIED'],
  },
] as const;

function HowItWorks() {
  const [i, setI] = useState(0);
  const s = STAGES[i];
  return (
    <section className="sec" id="how">
      <div className="l-wrap">
        <div className="sec-head center">
          <span className="eyebrow">How it works</span>
          <h2>One conversation. Four steps. Real evidence at each one.</h2>
          <p>Ask in plain words. The agent decides which tools to run, and you watch every call land.</p>
        </div>
        <div className="tabs" role="tablist" aria-label="Investigation steps">
          {STAGES.map((st, k) => (
            <button key={st.id} role="tab" id={`tab-${st.id}`} aria-selected={k === i} aria-controls="stage-panel" onClick={() => setI(k)}>
              <span className="tab-n">0{k + 1}</span>{st.title}
            </button>
          ))}
        </div>
        <div className="stage" id="stage-panel" role="tabpanel" aria-labelledby={`tab-${s.id}`} key={s.id}>
          <div className="stage-copy">
            <Obj name={s.obj} alt="" size={150} />
            <h3>{s.h}</h3>
            <p>{s.p}</p>
          </div>
          <div className="term">
            <div className="term-bar"><span /><span /><span /><em>{s.title.toLowerCase()} · real output</em></div>
            <pre>{s.out.map((l, k) => <div key={k} className={l.includes('false') || l.includes('VERIFIED') || l.includes('0 findings') ? 'hl-ok' : l.includes('critical') || l.includes('accept') ? 'hl-bad' : ''}>{l}</div>)}</pre>
          </div>
        </div>
      </div>
    </section>
  );
}

const HOLES = [
  { r: 'E1', sev: 'critical', obj: 'forged-key', t: 'The caller picks the verification key', x: 'Prove anything with your own circuit.', f: 'Pin vkHash as an immutable set at deploy.' },
  { r: 'E1b', sev: 'critical', obj: 'merkle', t: 'The caller hands over the leaf', x: 'Replay any leaf anyone ever got aggregated.', f: 'Rebuild the leaf on-chain from the pinned key and the values you act on.' },
  { r: 'E3', sev: 'high', obj: 'receipt', t: 'The receipt is never recorded', x: 'Claim twice with one receipt.', f: 'Store the statement hash; reject it the second time.' },
  { r: 'E4', sev: 'critical', obj: 'cracked', t: 'Value moves with no receipt at all', x: 'Just call the function.', f: 'Gate every value move on a receipt checked in the same call.' },
  { r: 'E6', sev: 'medium', obj: 'gate', t: 'The caller picks the zkVerify domain', x: 'Use a receipt from a domain you control.', f: 'Pin the domain id.' },
];

function Holes() {
  return (
    <section className="sec alt" id="holes">
      <div className="l-wrap">
        <div className="sec-head">
          <span className="eyebrow">What it hunts</span>
          <h2>Five ways a contract trusts the wrong proof.</h2>
          <p>Each one is a detector, a line number in your code, an exploit you can run and a one-line fix.</p>
        </div>
        <div className="holes">
          {HOLES.map((h) => (
            <article key={h.r} className={`hole sev-${h.sev}`}>
              <div className="hole-top"><span className="hole-r">{h.r}</span><span className={`sev ${h.sev}`}>{h.sev}</span></div>
              <Obj name={h.obj} alt="" size={112} />
              <h3>{h.t}</h3>
              <p className="hole-x"><b>Exploit</b>{h.x}</p>
              <p className="hole-f"><b>Fix</b>{h.f}</p>
            </article>
          ))}
          <article className="hole hole-cta">
            <Obj name="scanner" alt="" size={112} />
            <h3>Run all five on your repo</h3>
            <p>The same scanner ships as a GitHub Action that drops findings into code scanning on the right line.</p>
            <a className="btn ghost sm" href={`${REPO}/tree/main/action`}>See the Action <Arrow /></a>
          </article>
        </div>
      </div>
    </section>
  );
}

function AntiCheat() {
  return (
    <section className="sec">
      <div className="l-wrap split">
        <div className="split-art"><Obj name="cracked" alt="A proof crystal split by a glowing coral crack" size={300} className="float a" /></div>
        <div>
          <span className="eyebrow coral">Anti-cheat</span>
          <h2>The easiest “fix” is to delete the function. Elenchos rejects it.</h2>
          <p>A model asked to make a scanner quiet will happily remove the code it complains about. So the verdict never
            comes from the model: the patch must compile, the re-scan must be clean, and the vulnerable function and its
            receipt check must still be there.</p>
          <ul className="checks">
            <li className="no">Deletes or renames the vulnerable function: <b>rejected</b></li>
            <li className="no">Removes the verifyProofAggregation call: <b>rejected</b></li>
            <li className="no">Doesn’t compile under Foundry: <b>rejected</b></li>
            <li className="yes">Pins the key and domain, records the statement: <b>verified</b></li>
          </ul>
        </div>
      </div>
    </section>
  );
}

const CODE = `abstract contract PinnedZkVerifyConsumer {
    IVerifyProofAggregation public immutable zkVerify;
    bytes32 public immutable vkHash;     // E1: pinned at deploy
    uint256 public immutable domainId;   // E6: pinned at deploy
    mapping(bytes32 => bool) public consumed;  // E3

    function _consume(uint256[] memory inputs, ...) internal {
        bytes32 s = ZkVerifyStatement.groth16(vkHash, inputs); // E1b
        if (consumed[s]) revert StatementAlreadyUsed(s);
        if (!zkVerify.verifyProofAggregation(domainId, ...))
            revert InvalidReceipt();
        consumed[s] = true;
    }
}`;

function TheFix() {
  return (
    <section className="sec alt" id="fix">
      <div className="l-wrap">
        <div className="sec-head">
          <span className="eyebrow">It ships the fix, not just the finding</span>
          <h2>One base contract closes all five holes.</h2>
        </div>
        <div className="fix-grid">
          <div className="code-card">
            <div className="term-bar"><span /><span /><span /><em>contracts/src/PinnedZkVerifyConsumer.sol · abridged</em></div>
            <pre className="lcode">{CODE.split('\n').map((l, k) => <div key={k}><i>{String(k + 1).padStart(2, ' ')}</i>{colour(l)}</div>)}</pre>
          </div>
          <div className="fix-side">
            <div className="fix-card">
              <Obj name="shield" alt="" size={96} />
              <div><h3>The attack holds, then fails</h3><p>A Foundry test proves the forgery <b>mints</b> on the vulnerable contract and <b>reverts</b> on the fixed one, with no value moved.</p></div>
            </div>
            <div className="fix-card">
              <Obj name="gear" alt="" size={96} />
              <div><h3>Runs on every pull request</h3><p>A GitHub Action scans your contracts and posts each finding to code scanning, on the right line.</p></div>
            </div>
            <div className="fix-card">
              <Obj name="seal" alt="" size={96} />
              <div><h3>73 tests pass</h3><p>Real proofs, a real zkVerify node, and real receipts zkVerify aggregated to Sepolia, replayed on a Sepolia fork against its real verifier.</p></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function colour(l: string) {
  const parts = l.split(/(\/\/.*$)/);
  return parts.map((p, i) => p.startsWith('//')
    ? <span key={i} className="c-com">{p}</span>
    : <span key={i} dangerouslySetInnerHTML={{ __html: p
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/\b(abstract|contract|public|immutable|function|internal|if|revert|memory|mapping)\b/g, '<span class="c-kw">$1</span>')
      .replace(/\b(bytes32|uint256|bool|IVerifyProofAggregation)\b/g, '<span class="c-ty">$1</span>') }} />);
}

// Only anon-claim is named (its author was told first). The other three teams are kept anonymous while we disclose
// privately: no owner, repo, avatar, file name or link, and the action lines are elided so they can't be searched for.
type Wild = { tag: string; owner?: string; name: string; what: string; x: string; file?: string; url?: string;
  code: readonly (readonly [number, string, string, string])[] };
const WILD: readonly Wild[] = [
  { tag: 'A', owner: 'smilewithkhushi', name: 'anon-claim', what: 'Anonymous ETH reward claims',
    x: 'Anyone drains the reward pool to their own address.', file: 'AnonClaim.sol',
    url: 'https://github.com/smilewithkhushi/anon-claim/blob/f61296e596558a0a23a8769e7407ef162308c0e8/contracts/src/AnonClaim.sol#L135',
    code: [[135, 'verifyProofAggregation(…, ', '_leaf', ', …)'], [142, 'recipient.call{value: rewardAmount}("");', '', '']] },
  { tag: 'B', name: 'Project B', what: 'Credential-gated access NFTs',
    x: 'Anyone mints an access NFT with no credential.',
    code: [[0, 'verifyProofAggregation(…, ', 'leaf', ', …)'], [0, '….mint(msg.sender, …);', '', '']] },
  { tag: 'C', name: 'Project C', what: 'Identity layer for undercollateralized loans',
    x: 'Anyone links any identity to any wallet.',
    code: [[0, 'verifyProofAggregation(…, ', 'leaf', ', …)'], [0, '…[identity] = wallet;', '', '']] },
  { tag: 'D', name: 'Project D', what: 'ZK email affiliation attestations',
    x: 'Anyone records a false attestation for any tx.',
    code: [[0, 'verifyProofAggregation(…, ', 'leaf', ', …)'], [0, '…[leaf] = txHash;', '', '']] },
];

function FoundInWild() {
  return (
    <section className="sec wild" id="wild">
      <div className="l-wrap">
        <div className="wild-top">
          <div className="sec-head">
            <span className="eyebrow coral">Found in the wild</span>
            <h2>Four live zkVerify apps. One move breaks all of them.</h2>
            <p>We pointed Elenchos at the public zkVerify ecosystem. Each of these contracts checks a proof
              <code>leaf</code> that the caller hands it, then acts. Any proof zkVerify ever aggregated passes.</p>
          </div>
          <dl className="wild-stats">
            <div><dt>4</dt><dd>live contracts</dd></div>
            <div><dt>1</dt><dd>shared bug</dd></div>
            <div><dt>0</dt><dd>valid proofs needed</dd></div>
          </dl>
        </div>
        <div className="wild-grid">
          {WILD.map((w) => {
            const body = (<>
              <div className="wcase-head">
                {w.owner
                  ? <img src={`https://github.com/${w.owner}.png?size=80`} alt="" width={36} height={36} loading="lazy" />
                  : <span className="wcase-anon" aria-hidden="true">{w.tag}</span>}
                <div className="wcase-id"><b>{w.owner ? `${w.owner}/${w.name}` : w.name}</b><span>{w.what}</span></div>
                <span className="wcase-sev">Critical</span>
              </div>
              <p className="wcase-x">{w.x}</p>
              <pre className="wcase-code">{w.code.map(([n, a, hot, b], k) => (
                <span key={k} className="wl"><i>{n || '··'}</i>{a}{hot && <mark>{hot}</mark>}{b}{hot && <em>  ← from the caller</em>}{'\n'}</span>
              ))}</pre>
              <div className="wcase-foot">{w.url
                ? <><span>{w.file} · line {w.code[0][0]}</span><span>View on GitHub <Arrow /></span></>
                : <><span>Repo withheld</span><span>Disclosing privately</span></>}</div>
            </>);
            return w.url
              ? <a key={w.tag} className="wcase" href={w.url} target="_blank" rel="noreferrer">{body}</a>
              : <div key={w.tag} className="wcase is-anon">{body}</div>;
          })}
        </div>
        <p className="wild-note">Reproduced on a fork of Ethereum Sepolia against zkVerify’s real verifier, with a proof
          zkVerify actually aggregated. Testnet apps, no funds at risk. One is named; three stay anonymous while we tell their teams. Fix included.{' '}
          <a href={`${REPO}/blob/main/docs/FINDINGS.md`}>Full write-up <Arrow /></a></p>
      </div>
    </section>
  );
}

function Numbers() {
  const n = [
    ['73', 'tests passing', 'real proofs, Sepolia fork, node and verifier'],
    ['5', 'holes detected', 'E1 · E1b · E3 · E4 · E6'],
    ['1,000,000', 'minted by the exploit test', 'on a Sepolia fork; reverted on the fix'],
    ['#270049', 'the attacker’s proof, aggregated', 'zkVerify’s Sepolia verifier says true'],
  ];
  return (
    <section className="sec numbers-sec">
      <div className="l-wrap">
        <div className="sec-head"><span className="eyebrow">No buzzwords</span><h2>Real numbers from real runs.</h2></div>
        <div className="numbers">
          {n.map(([a, b, c]) => <div key={b} className="num"><div className="num-v">{a}</div><div className="num-l">{b}</div><div className="num-d">{c}</div></div>)}
        </div>
      </div>
    </section>
  );
}

function Arena() {
  return (
    <section className="sec" id="arena">
      <div className="l-wrap">
        <div className="sec-head center">
          <span className="eyebrow">The same discipline, in live games</span>
          <h2>One agent endpoint plays both zkVerify arenas.</h2>
          <p>Every move and every decision carries a Groth16 proof from the organisers’ circuit. No model decides anything that scores points.</p>
        </div>
        <div className="arena">
          <article className="arena-card">
            <Obj name="duel" alt="A cobalt and a coral game piece facing each other" size={170} />
            <span className="eyebrow">Steal the VFY</span>
            <h3>180 – 2</h3>
            <p>Searched all 87,120 strategies the circuit allows. Extract 10 every turn never loses a turn. Ranked #4, unbeaten.</p>
          </article>
          <article className="arena-card">
            <Obj name="gate" alt="A glass toll gate with a raised barrier" size={170} />
            <span className="eyebrow">Proof Gatekeeper</span>
            <h3>17 / 17</h3>
            <p>Practice verdicts correct across all seven trap types. Five integer checks, a proof of every decision, and a durable replay store.</p>
          </article>
          <article className="arena-card">
            <Obj name="trophy" alt="A cobalt glass trophy" size={170} />
            <span className="eyebrow">All four tracks</span>
            <h3>4 / 4</h3>
            <p>Steal the VFY, Proof Gatekeeper, Wildcard and Creator, entered with one repo and one rule: let proofs decide.</p>
            <a className="btn ghost sm" href={RECAP}>Read the recap <Arrow /></a>
          </article>
        </div>
      </div>
    </section>
  );
}

function RunIt() {
  const [copied, setCopied] = useState(false);
  const cmd = 'git clone https://github.com/nickthelegend/elenchos && cd elenchos && docker build -t elenchos . && docker run -p 8787:8787 -e ANTHROPIC_API_KEY elenchos';
  const mcp = 'claude mcp add --transport http elenchos https://elenchos.201-18-198-162.sslip.io/mcp';
  const [mcpCopied, setMcpCopied] = useState(false);
  return (
    <section className="sec">
      <div className="l-wrap">
        <div className="cta">
          <div className="cta-copy">
            <span className="eyebrow">Run it yourself</span>
            <h2>Put your contract on the stand.</h2>
            <p>One Docker image bundles Foundry, Slither and the agent. Pass your Anthropic key as <code>ANTHROPIC_API_KEY</code>; without it the
              studio says “Setup required” instead of pretending.</p>
            <div className="cmd">
              <code>{cmd}</code>
              <button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(cmd).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(() => {}); }}>{copied ? 'Copied' : 'Copy'}</button>
            </div>
            <p>Or audit from your own agent: Elenchos is an MCP server with eight tools for Claude Code, Cursor and any MCP client.</p>
            <div className="cmd">
              <code>{mcp}</code>
              <button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(mcp).then(() => { setMcpCopied(true); setTimeout(() => setMcpCopied(false), 1600); }).catch(() => {}); }}>{mcpCopied ? 'Copied' : 'Copy'}</button>
            </div>
            <div className="hero-cta">
              <a className="btn primary" href="#/app">Open the studio <Arrow /></a>
              <a className="btn ghost" href={REPO}><GitHub /> Star on GitHub</a>
            </div>
          </div>
          <Obj name="logo" alt="The Elenchos lens mark" size={260} className="float a cta-art" />
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="l-foot">
      <div className="l-wrap l-foot-in">
        <div className="l-foot-brand"><a className="l-brand" href="#top"><Mark size={26} /><span>Elenchos</span></a>
          <p>ἔλεγχος — the cross-examination. The red team for code that trusts zkVerify proofs.</p></div>
        <div className="l-foot-cols">
          <div><h4>Product</h4><a href="#/app">Studio</a><a href="#how">How it works</a><a href="#holes">The five holes</a><a href={`${REPO}/tree/main/action`}>GitHub Action</a></div>
          <div><h4>Read</h4><a href={ARTICLE}>The deep write-up</a><a href={RECAP}>Four tracks recap</a><a href={`${REPO}/blob/main/docs/TEST-PLAN.md`}>Test plan</a><a href={FILM}>The film</a></div>
          <div><h4>Code</h4><a href={REPO}>elenchos</a><a href="https://github.com/nickthelegend/elenchos-duel">elenchos-duel</a><a href={`https://sepolia.etherscan.io/address/${VERIFIER}`}>zkVerify verifier</a></div>
        </div>
      </div>
      <div className="l-wrap l-foot-base"><span>MIT · © 2026 Nivesh Gajengi</span><span>3D art generated with ChatGPT</span></div>
    </footer>
  );
}

export function Landing() {
  useEffect(() => { document.title = 'Elenchos — cross-examine the proof'; }, []);
  return (
    <div className="landing">
      <Nav />
      <main>
        <Hero />
        <Stack />
        <StudioShowcase />
        <FoundInWild />
        <Problem />
        <HowItWorks />
        <Holes />
        <AntiCheat />
        <TheFix />
        <Numbers />
        <Arena />
        <RunIt />
      </main>
      <Footer />
    </div>
  );
}

export const Arrow = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
const Play = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>;
export const GitHub = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.1c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.8.1-.7.1-.7 1.2.1 1.9 1.2 1.9 1.2 1.1 1.8 2.9 1.3 3.6 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.6 18.3 5 18.3 5c.7 1.7.3 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5z" /></svg>;
