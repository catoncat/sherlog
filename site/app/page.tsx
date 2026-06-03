const installCommand = "npm i -g @act0r/cxs";

const quickStart = [
  {
    command: "cxs status --cwd /Users/you/work/project --json",
    label: "check coverage",
  },
  {
    command: "cxs sync --cwd /Users/you/work/project",
    label: "index only when needed",
  },
  {
    command: 'cxs find "that bug from last week" --sort ended',
    label: "recall the right session",
  },
  {
    command: "cxs read-range <sessionUuid> --seq <matchSeq>",
    label: "open the useful slice",
  },
];

const proofPoints = [
  "Local-first SQLite index",
  "Manual sync, no daemon",
  "Progressive read ranges",
  "macOS + Linux, Node 22+",
];

const commands = [
  ["status", "see source inventory, index state, and coverage"],
  ["sync", "refresh the selected Codex session slice"],
  ["find", "rank likely sessions without dumping transcripts"],
  ["read-range", "open a focused message window around a hit"],
  ["read-page", "page through a session when the match is session-level"],
  ["list", "scan recent indexed sessions by project or root"],
];

export default function Home() {
  return (
    <main className="site-shell">
      <section className="hero">
        <nav className="topbar" aria-label="CXS">
          <a className="brand" href="#top" aria-label="CXS home">
            <span className="brand-mark">cxs</span>
            <span className="brand-copy">Codex session search</span>
          </a>
          <div className="nav-actions">
            <a href="https://github.com/catoncat/cxs">GitHub</a>
            <a href="https://www.npmjs.com/package/@act0r/cxs">npm</a>
          </div>
        </nav>

        <div className="hero-grid" id="top">
          <div className="hero-copy">
            <p className="eyebrow">local Codex recall in one CLI</p>
            <h1>CXS：让 Codex 历史可搜索。</h1>
            <p className="lede">
              CXS 读取你本机的 Codex session 日志，建立本地 SQLite
              索引。先找到对的会话，再只读相关片段，不用翻整段历史。
            </p>

            <div className="install-strip" aria-label="Install CXS">
              <code>{installCommand}</code>
              <a href="#quick-start">马上用</a>
            </div>

            <div className="hero-actions">
              <a className="primary-link" href="https://www.npmjs.com/package/@act0r/cxs">
                安装最新版
              </a>
              <a className="secondary-link" href="https://github.com/catoncat/cxs#quick-start">
                看 2 分钟上手
              </a>
            </div>
          </div>

          <div className="terminal-card" aria-label="CXS terminal preview">
            <div className="terminal-chrome">
              <span />
              <span />
              <span />
              <p>~/work/project</p>
            </div>
            <div className="terminal-body">
              <p>
                <span>$</span> {installCommand}
              </p>
              <p className="muted">added @act0r/cxs</p>
              <p>
                <span>$</span> cxs status --cwd . --json
              </p>
              <pre>{`{
  "requestedCoverage": {
    "recommendedAction": "sync"
  }
}`}</pre>
              <p>
                <span>$</span> cxs sync --cwd .
              </p>
              <p className="muted">indexed Codex sessions for this project</p>
              <p>
                <span>$</span> cxs find &quot;release rollback&quot; --sort ended
              </p>
              <p className="result">found 5 sessions. read-range suggested.</p>
            </div>
          </div>
        </div>

        <div className="proof-strip" aria-label="Product boundaries">
          {proofPoints.map((point) => (
            <span key={point}>{point}</span>
          ))}
        </div>
      </section>

      <section className="workflow" id="quick-start">
        <div className="section-heading">
          <p className="eyebrow">the actual workflow</p>
          <h2>不是再开一个聊天记录 GUI。CXS 是 agent 能直接调用的检索底座。</h2>
        </div>

        <div className="steps">
          {quickStart.map((step, index) => (
            <article className="step" key={step.command}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <p>{step.label}</p>
              <code>{step.command}</code>
            </article>
          ))}
        </div>
      </section>

      <section className="command-band" aria-label="CXS command surface">
        <div className="section-heading">
          <p className="eyebrow">small command surface</p>
          <h2>命令面故意很窄：同步、查找、渐进阅读。</h2>
        </div>

        <div className="command-grid">
          {commands.map(([name, description]) => (
            <article className="command" key={name}>
              <code>{name}</code>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="install-band" aria-label="Install CXS">
        <div>
          <p className="eyebrow">install now</p>
          <h2>先装上，下一次找历史决策时就不用猜。</h2>
        </div>
        <div className="install-box">
          <code>{installCommand}</code>
          <code>cxs --help</code>
        </div>
      </section>
    </main>
  );
}
