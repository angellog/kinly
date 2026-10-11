import { useState } from "react";
import {
  MarkdownBlock,
  Spinner,
  useHostContext,
  useHostLocation,
  useHostNavigation,
  usePluginAction,
  usePluginData,
  usePluginToast,
  type PluginPageProps,
  type PluginSidebarProps,
  type PluginWidgetProps,
} from "@paperclipai/plugin-sdk/ui";
import type { RepoView } from "../client.js";
import { B, Chip, Pill, SectionHeader, button, input, mono, verdictColor } from "./brand.js";

/**
 * The Kinly console. Every piece of repository text is rendered as a React
 * text node (never as HTML), and reports go through the host's markdown
 * renderer (D15). Writes go through worker actions; the API token never
 * reaches the browser (R4).
 */

const ROUTE = "kinly";
const FALLBACK_PREFIX = "VAN";
const SIZES = [5, 10, 15] as const;

const CATEGORIES: Array<[string, string]> = [
  ["ai-agents", "AI agents & coding assistants"],
  ["mcp-tools", "MCP, skills & agent tooling"],
  ["llm-infra", "LLM infrastructure"],
  ["design-ui", "Design, UI & frontend"],
  ["content-media", "Content, video, image & voice"],
  ["automation-workflow", "Automation & workflows"],
  ["social-marketing", "Social, marketing & growth"],
  ["business-ops", "Business operations"],
  ["data-analytics", "Data & analytics"],
  ["devtools", "Developer tools"],
  ["infra-devops", "Infrastructure & DevOps"],
  ["security", "Security"],
  ["learning-reference", "Learning & reference"],
  ["web-mobile", "Web & mobile"],
  ["systems-languages", "Systems & languages"],
  ["other", "Other"],
];
const categoryLabel = (id: string): string => CATEGORIES.find(([k]) => k === id)?.[1] ?? id;

const LICENCE: Record<string, string> = {
  permissive: "permissive",
  "weak-copyleft": "weak copyleft",
  "strong-copyleft": "strong copyleft",
  "source-available": "source-available",
  none: "no licence",
  unknown: "licence ?",
};

type Tab = "today" | "week" | "categories" | "persistent" | "stars" | "shortlist" | "reports" | "ask";
const TABS: Array<[Tab, string]> = [
  ["today", "Today"],
  ["week", "This Week"],
  ["categories", "Categories"],
  ["persistent", "Persistent"],
  ["stars", "My Stars"],
  ["shortlist", "Shortlist"],
  ["reports", "Reports"],
  ["ask", "Ask Kinly"],
];

interface Settings {
  enabled: boolean;
  apiUrl: string;
  canWrite: boolean;
  dailyBrief: boolean;
  focus: string;
  health: { ok: boolean; version?: string; error?: string };
}

function useCompany(): string | null {
  return useHostContext().companyId;
}

// The sidebar can render without a company prefix; always emit "/<PREFIX>/kinly".
function useRouteHref() {
  const { companyPrefix } = useHostContext();
  const { pathname } = useHostLocation();
  const nav = useHostNavigation();
  const fromPath = pathname.split("/").filter(Boolean)[0];
  const known = new Set([ROUTE, "plugins", "company"]);
  const prefix = companyPrefix ?? (fromPath && !known.has(fromPath.toLowerCase()) ? fromPath : FALLBACK_PREFIX);
  return () => nav.linkProps(`/${prefix}/${ROUTE}`);
}

function errText(e: unknown): string {
  if (!e) return "";
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

function fmt(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toLocaleString("en-US");
}

// ─── page ────────────────────────────────────────────────────────────────────

export function KinlyPage(_props: PluginPageProps) {
  const companyId = useCompany();
  const [tab, setTab] = useState<Tab>("today");
  const [openRepo, setOpenRepo] = useState<string | null>(null);
  const settings = usePluginData<Settings>("settings", companyId ? { companyId } : undefined);

  if (!companyId) return <div style={{ padding: "1.5rem" }}>Open Kinly from inside a company.</div>;
  const s = settings.data;

  return (
    <div style={{ padding: "1.25rem 1.5rem 3rem", maxWidth: 1180, margin: "0 auto", fontSize: "0.9rem" }}>
      <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", borderBottom: `2px solid ${B.red}`, paddingBottom: "0.6rem" }}>
        <div>
          <div style={{ fontSize: "0.68rem", letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.6 }}>Project Kinly · Vantik Systems</div>
          <h1 style={{ margin: "0.15rem 0 0", fontSize: "1.6rem", fontWeight: 700 }}>What is trending on GitHub, and what it is for</h1>
        </div>
        <div style={{ fontSize: "0.75rem", fontFamily: mono, opacity: 0.75, textAlign: "right" }}>
          {settings.loading ? "checking the service…" : s ? (
            <>
              <span style={{ color: s.health.ok ? B.green : B.red }}>●</span> {s.health.ok ? `API up · ${s.health.version ?? ""}` : `API unreachable: ${s.health.error ?? ""}`}
              <br />
              {s.canWrite ? "writes on" : "read-only: set the API token secret in plugin settings"}
            </>
          ) : (
            errText(settings.error)
          )}
        </div>
      </header>

      {s && !s.enabled && <Banner tone="warn">Kinly is turned off for this company. Turn it on in the plugin settings.</Banner>}

      <nav style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap", margin: "0.9rem 0 0.4rem" }} role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
              setOpenRepo(null);
            }}
            style={{ ...button(tab === id ? "primary" : "plain"), padding: "0.38rem 0.75rem" }}
          >
            {label}
          </button>
        ))}
      </nav>

      {openRepo ? (
        <RepoDetail companyId={companyId} fullName={openRepo} canWrite={!!s?.canWrite} onBack={() => setOpenRepo(null)} />
      ) : (
        <>
          {tab === "today" && <TrendTab companyId={companyId} windows={[["today", "Trending today"], ["new", "New entrants"]]} onOpen={setOpenRepo} />}
          {tab === "week" && <TrendTab companyId={companyId} windows={[["week", "Trending this week"], ["month", "This month"], ["rising", "Rising (star velocity)"]]} onOpen={setOpenRepo} />}
          {tab === "categories" && <CategoriesTab companyId={companyId} onOpen={setOpenRepo} />}
          {tab === "persistent" && <TrendTab companyId={companyId} windows={[["persistent", "Kept trending (18 months)"]]} onOpen={setOpenRepo} defaultSize={15} />}
          {tab === "stars" && <StarsTab companyId={companyId} onOpen={setOpenRepo} />}
          {tab === "shortlist" && <ShortlistTab companyId={companyId} canWrite={!!s?.canWrite} onOpen={setOpenRepo} />}
          {tab === "reports" && <ReportsTab companyId={companyId} />}
          {tab === "ask" && <AskTab companyId={companyId} canWrite={!!s?.canWrite} onOpen={setOpenRepo} />}
        </>
      )}
    </div>
  );
}

function Banner({ tone, children }: { tone: "warn" | "info"; children: React.ReactNode }) {
  return <div style={{ margin: "0.8rem 0", padding: "0.6rem 0.8rem", borderLeft: `3px solid ${tone === "warn" ? B.red : B.slate}`, background: tone === "warn" ? B.redTint : "transparent", fontSize: "0.85rem" }}>{children}</div>;
}

// ─── lists ───────────────────────────────────────────────────────────────────

function SizeAndCategory({ size, setSize, category, setCategory }: { size: number; setSize: (n: number) => void; category: string; setCategory: (c: string) => void }) {
  return (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: "0.75rem", opacity: 0.6 }}>Top</span>
      {SIZES.map((n) => (
        <button key={n} onClick={() => setSize(n)} style={{ ...button(size === n ? "primary" : "plain"), padding: "0.2rem 0.55rem" }}>
          {n}
        </button>
      ))}
      <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...input, padding: "0.3rem 0.5rem" }} aria-label="Category">
        <option value="">All categories</option>
        {CATEGORIES.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

function TrendTab({ companyId, windows, onOpen, defaultSize = 10 }: { companyId: string; windows: Array<[string, string]>; onOpen: (n: string) => void; defaultSize?: number }) {
  const [size, setSize] = useState<number>(defaultSize);
  const [category, setCategory] = useState("");
  return (
    <div>
      <div style={{ margin: "0.8rem 0" }}>
        <SizeAndCategory size={size} setSize={setSize} category={category} setCategory={setCategory} />
      </div>
      {windows.map(([w, label]) => (
        <TrendList key={w} companyId={companyId} window={w} label={label} size={size} category={category} onOpen={onOpen} />
      ))}
    </div>
  );
}

function TrendList({ companyId, window, label, size, category, onOpen }: { companyId: string; window: string; label: string; size: number; category: string; onOpen: (n: string) => void }) {
  const res = usePluginData<{ date: string | null; items: RepoView[] }>("trending", { companyId, window, limit: size, ...(category ? { category } : {}) });
  return (
    <section>
      <SectionHeader label={label} sub={res.data?.date ? `as of ${res.data.date}` : undefined} />
      {res.loading && <Spinner />}
      {res.error && <Banner tone="warn">{errText(res.error)}</Banner>}
      {res.data && res.data.items.length === 0 && <div style={{ opacity: 0.6 }}>Nothing on this list{category ? ` in ${categoryLabel(category)}` : ""} yet.</div>}
      {res.data?.items.map((v, i) => <RepoRow key={v.repo.full_name} v={v} rank={v.rank ?? i + 1} onOpen={onOpen} />)}
    </section>
  );
}

function RepoRow({ v, rank, onOpen }: { v: RepoView; rank: number; onOpen: (n: string) => void }) {
  const r = v.repo;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "2.2rem 1fr auto", gap: "0.75rem", padding: "0.7rem 0", borderBottom: `1px solid ${B.hairDark}` }}>
      <div style={{ fontFamily: mono, fontSize: "1rem", opacity: 0.5, textAlign: "right" }}>{rank}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => onOpen(r.full_name)} style={{ all: "unset", cursor: "pointer", fontWeight: 700, fontSize: "0.95rem" }} title="Open the Kinly card">
            {r.full_name}
          </button>
          {v.starred && <Chip title="You starred this">★ starred</Chip>}
          {v.shortlist && v.shortlist.status !== "discovered" && <Chip>{v.shortlist.status}</Chip>}
          {v.rating && <Chip>rated {v.rating.rating}/5</Chip>}
        </div>
        <div style={{ marginTop: "0.2rem", opacity: 0.88 }}>{r.summary ?? r.description ?? "No description."}</div>
        {r.business_use && <div style={{ marginTop: "0.25rem", fontSize: "0.82rem", opacity: 0.7 }}>Use: {r.business_use}</div>}
        <div style={{ marginTop: "0.35rem", fontSize: "0.72rem", opacity: 0.7 }}>
          <Chip>{categoryLabel(r.category)}</Chip>
          <Chip title={r.license_spdx ?? ""}>{LICENCE[r.license_class] ?? r.license_class}{r.open_core ? " · open-core" : ""}</Chip>
          {r.language && <Chip>{r.language}</Chip>}
          <Chip>★ {fmt(r.stars)}</Chip>
          {v.metric_label && <Chip>{v.metric_label}</Chip>}
        </div>
      </div>
      <div style={{ textAlign: "right", display: "grid", gap: "0.3rem", alignContent: "start", justifyItems: "end" }}>
        <Pill label={v.score.verdict} color={verdictColor(v.score.verdict)} title={v.score.reasons.join(" · ")} />
        <div style={{ fontFamily: mono, fontSize: "0.75rem", opacity: 0.75 }}>score {v.score.total}</div>
        <div style={{ fontFamily: mono, fontSize: "0.75rem", opacity: 0.75 }}>fit {v.relevance}</div>
      </div>
    </div>
  );
}

// ─── categories ──────────────────────────────────────────────────────────────

function CategoriesTab({ companyId, onOpen }: { companyId: string; onOpen: (n: string) => void }) {
  const cats = usePluginData<{ categories: Array<{ id: string; label: string; repos: number; build: number; weight: number }> }>("categories", { companyId });
  const [picked, setPicked] = useState<string>("mcp-tools");
  const [size, setSize] = useState<number>(10);
  return (
    <div>
      <SectionHeader label="Categories" sub="weight = how much it matters to you, from your stars" />
      {cats.loading && <Spinner />}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: "0.5rem" }}>
        {cats.data?.categories.map((c) => (
          <button key={c.id} onClick={() => setPicked(c.id)} style={{ ...button(picked === c.id ? "primary" : "plain"), textAlign: "left", display: "grid", gap: "0.15rem" }}>
            <span>{c.label}</span>
            <span style={{ fontFamily: mono, fontSize: "0.7rem", opacity: 0.8 }}>
              {fmt(c.repos)} repos · {c.build} BUILD · weight {c.weight.toFixed(2)}
            </span>
          </button>
        ))}
      </div>
      <div style={{ margin: "0.8rem 0" }}>
        <SizeAndCategory size={size} setSize={setSize} category={picked} setCategory={(c) => setPicked(c || "mcp-tools")} />
      </div>
      <TrendList companyId={companyId} window="week" label={`${categoryLabel(picked)} — this week`} size={size} category={picked} onOpen={onOpen} />
      <TrendList companyId={companyId} window="persistent" label={`${categoryLabel(picked)} — kept trending`} size={size} category={picked} onOpen={onOpen} />
    </div>
  );
}

// ─── stars ───────────────────────────────────────────────────────────────────

function StarsTab({ companyId, onOpen }: { companyId: string; onOpen: (n: string) => void }) {
  const res = usePluginData<{ total: number; items: Array<{ full_name: string; starred_at: string; view: RepoView | null }>; star_topics: Record<string, number> }>("stars", { companyId });
  const topics = res.data ? Object.entries(res.data.star_topics).sort((a, b) => b[1] - a[1]).slice(0, 24) : [];
  return (
    <div>
      <SectionHeader label="Your stars" sub={res.data ? `${res.data.total} starred repositories shape what Kinly calls relevant` : undefined} />
      {res.loading && <Spinner />}
      {res.error && <Banner tone="warn">{errText(res.error)}</Banner>}
      {topics.length > 0 && (
        <div style={{ margin: "0.4rem 0 0.8rem", fontSize: "0.75rem" }}>
          {topics.map(([t, w]) => (
            <Chip key={t} title={`weight ${w}`}>
              {t}
            </Chip>
          ))}
        </div>
      )}
      {res.data?.items.map((s, i) =>
        s.view ? (
          <RepoRow key={s.full_name} v={s.view} rank={i + 1} onOpen={onOpen} />
        ) : (
          <div key={s.full_name} style={{ padding: "0.5rem 0", borderBottom: `1px solid ${B.hairDark}`, fontFamily: mono, fontSize: "0.8rem" }}>
            {s.full_name} <span style={{ opacity: 0.6 }}>starred {s.starred_at.slice(0, 10)} · not on any trending list yet</span>
          </div>
        ),
      )}
    </div>
  );
}

// ─── shortlist ───────────────────────────────────────────────────────────────

interface ShortlistData {
  items: Array<{ full_name: string; status: string; note: string | null; updated_at: string; view: RepoView | null }>;
  wip: number;
  wip_limit: number;
}

function ShortlistTab({ companyId, canWrite, onOpen }: { companyId: string; canWrite: boolean; onOpen: (n: string) => void }) {
  const res = usePluginData<ShortlistData>("shortlist", { companyId });
  const groups = ["shortlisted", "testing", "rated", "resourced", "discovered"];
  return (
    <div>
      <SectionHeader label="Testing bench" sub={res.data ? `${res.data.wip} of ${res.data.wip_limit} slots in use` : undefined} />
      {!canWrite && <Banner tone="info">Read-only: set the Kinly API token secret in plugin settings to shortlist, rate and publish.</Banner>}
      {res.loading && <Spinner />}
      {res.error && <Banner tone="warn">{errText(res.error)}</Banner>}
      {res.data && res.data.items.length === 0 && <div style={{ opacity: 0.6 }}>Nothing shortlisted yet. Open a repository from any list and press Shortlist or Add to workspace.</div>}
      {groups.map((g) => {
        const items = res.data?.items.filter((i) => i.status === g) ?? [];
        if (items.length === 0) return null;
        return (
          <div key={g}>
            <SectionHeader label={g} sub={`${items.length}`} />
            {items.map((i) =>
              i.view ? (
                <RepoRow key={i.full_name} v={i.view} rank={0} onOpen={onOpen} />
              ) : (
                <div key={i.full_name} style={{ padding: "0.4rem 0" }}>
                  {i.full_name}
                </div>
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── repo detail + decisions ─────────────────────────────────────────────────

type RepoDetailData = RepoView & { star_weeks: Array<{ week_start: string; total: number }>; resource: { markdown: string; generated_at: string } | null };

function RepoDetail({ companyId, fullName, canWrite, onBack }: { companyId: string; fullName: string; canWrite: boolean; onBack: () => void }) {
  const res = usePluginData<RepoDetailData>("repo", { companyId, fullName });
  const toast = usePluginToast();
  const shortlist = usePluginAction("shortlist");
  const rate = usePluginAction("rate");
  const resource = usePluginAction("resource");
  const addToWorkspace = usePluginAction("add-to-workspace");
  const [busy, setBusy] = useState<string | null>(null);
  const [stars, setStars] = useState<number>(0);
  const [notes, setNotes] = useState("");

  const run = async (label: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(label);
    try {
      await fn();
      toast({ title: done, tone: "success" });
      res.refresh();
    } catch (err) {
      toast({ title: `${label} failed`, body: errText(err), tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const v = res.data;
  return (
    <div>
      <button onClick={onBack} style={{ ...button("plain"), margin: "0.6rem 0" }}>
        ← Back
      </button>
      {res.loading && <Spinner />}
      {res.error && <Banner tone="warn">{errText(res.error)}</Banner>}
      {v && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: "1.5rem" }}>
          <div>
            <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: "1.35rem" }}>{v.repo.full_name}</h2>
              <Pill label={v.score.verdict} color={verdictColor(v.score.verdict)} />
              <a href={`https://github.com/${v.repo.full_name}`} target="_blank" rel="noopener noreferrer nofollow" style={{ fontSize: "0.8rem", color: B.red }}>
                GitHub ↗
              </a>
            </div>
            <p style={{ fontSize: "1rem", lineHeight: 1.5 }}>{v.repo.summary ?? v.repo.description ?? "No description."}</p>
            <SectionHeader label="Use for Vantik / FeetBit" />
            <p style={{ lineHeight: 1.5 }}>{v.repo.business_use ?? "Not written yet."}</p>
            <SectionHeader label="Why this score" />
            <ul style={{ margin: 0, paddingLeft: "1.1rem", lineHeight: 1.6 }}>
              {v.score.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <SectionHeader label="Trending history" />
            <div style={{ fontFamily: mono, fontSize: "0.8rem", lineHeight: 1.7 }}>
              {v.signals.distinct_weeks} week(s), {v.signals.distinct_days} day(s) on trending · first {v.signals.first_seen ?? "—"} · last {v.signals.last_seen ?? "—"}
              {v.signals.peak_stars_period !== null && <> · best day +{fmt(v.signals.peak_stars_period)}</>}
              {v.signals.stars_7d !== null && <> · last 7 days +{fmt(v.signals.stars_7d)}</>}
            </div>
            {v.star_weeks.length > 0 && <StarBars weeks={v.star_weeks} />}
            {v.resource && (
              <>
                <SectionHeader label="Resource page" sub={`written ${v.resource.generated_at.slice(0, 10)}`} />
                <MarkdownBlock content={v.resource.markdown} />
              </>
            )}
          </div>
          <aside style={{ display: "grid", gap: "0.8rem", alignContent: "start" }}>
            <div style={{ fontFamily: mono, fontSize: "0.78rem", lineHeight: 1.8, border: `1px solid ${B.hairDark}`, borderRadius: 6, padding: "0.7rem" }}>
              score {v.score.total}/100 · fit {v.relevance}
              <br />★ {fmt(v.repo.stars)} · forks {fmt(v.repo.forks)}
              <br />
              {v.repo.license_spdx ?? ""} {LICENCE[v.repo.license_class] ?? v.repo.license_class}
              {v.repo.open_core && <><br />open-core: paid features in ee/</>}
              <br />
              {categoryLabel(v.repo.category)} · {v.repo.language ?? "—"}
              <br />
              pushed {v.repo.pushed_at?.slice(0, 10) ?? "—"}
              {v.shortlist && <><br />bench: {v.shortlist.status}</>}
              {v.agent_rating && <><br />agent test: {v.agent_rating.rating}/5</>}
              {v.rating && <><br />your rating: {v.rating.rating}/5</>}
            </div>
            {!canWrite && <Banner tone="info">Read-only until the API token secret is set.</Banner>}
            <button disabled={!canWrite || !!busy} style={button("primary", !canWrite || !!busy)} onClick={() => run("Add to workspace", () => addToWorkspace({ companyId, fullName }), "Shortlisted, and an issue was created for the Kinly agent")}>
              Add to workspace (test)
            </button>
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
              <button disabled={!canWrite || !!busy} style={button("plain", !canWrite || !!busy)} onClick={() => run("Shortlist", () => shortlist({ companyId, fullName, status: "shortlisted" }), "Shortlisted")}>
                Shortlist
              </button>
              <button disabled={!canWrite || !!busy} style={button("danger", !canWrite || !!busy)} onClick={() => run("Drop", () => shortlist({ companyId, fullName, status: "dropped", note: notes || "dropped from the console" }), "Dropped")}>
                Drop
              </button>
            </div>
            <div style={{ border: `1px solid ${B.hairDark}`, borderRadius: 6, padding: "0.7rem", display: "grid", gap: "0.5rem" }}>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: B.red }}>Your rating</div>
              <div role="radiogroup" aria-label="Rating" style={{ display: "flex", gap: "0.25rem" }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} role="radio" aria-checked={stars === n} onClick={() => setStars(n)} style={{ ...button(stars >= n ? "primary" : "plain"), padding: "0.25rem 0.55rem" }}>
                    {n}
                  </button>
                ))}
              </div>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What it replaced or enabled, in one line" rows={3} style={{ ...input, resize: "vertical" }} />
              <button disabled={!canWrite || !!busy || stars === 0} style={button("primary", !canWrite || !!busy || stars === 0)} onClick={() => run("Rate", () => rate({ companyId, fullName, rating: stars, notes }), `Rated ${stars}/5`)}>
                Save rating
              </button>
            </div>
            <button disabled={!canWrite || !!busy} style={button("plain", !canWrite || !!busy)} onClick={() => run("Resource page", () => resource({ companyId, fullName }), "Resource page written")}>
              {v.resource ? "Refresh resource page" : "Make resource page"}
            </button>
            {busy && <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>{busy}…</div>}
          </aside>
        </div>
      )}
    </div>
  );
}

function StarBars({ weeks }: { weeks: Array<{ week_start: string; total: number }> }) {
  const ordered = [...weeks].reverse().slice(-26);
  const max = Math.max(1, ...ordered.map((w) => w.total));
  return (
    <div aria-label="Stars per week" style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 64, marginTop: "0.6rem" }}>
      {ordered.map((w) => (
        <div key={w.week_start} title={`week of ${w.week_start}: +${w.total}`} style={{ flex: 1, height: `${Math.max(2, (w.total / max) * 100)}%`, background: B.red, opacity: 0.75 }} />
      ))}
    </div>
  );
}

// ─── reports ─────────────────────────────────────────────────────────────────

function ReportsTab({ companyId }: { companyId: string }) {
  const [kind, setKind] = useState("daily");
  const [id, setId] = useState<string | null>(null);
  const list = usePluginData<{ items: Array<{ kind: string; id: string; generated_at: string }> }>("reports", { companyId, kind });
  const report = usePluginData<{ kind: string; id: string; markdown: string; generated_at: string }>("report", { companyId, kind, ...(id ? { id } : {}) });
  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", gap: "1.25rem" }}>
      <div>
        <div style={{ display: "flex", gap: "0.3rem", margin: "0.8rem 0" }}>
          {["daily", "weekly", "landscape"].map((k) => (
            <button
              key={k}
              onClick={() => {
                setKind(k);
                setId(null);
              }}
              style={{ ...button(kind === k ? "primary" : "plain"), padding: "0.25rem 0.55rem" }}
            >
              {k}
            </button>
          ))}
        </div>
        {list.loading && <Spinner />}
        <div style={{ display: "grid", gap: "0.15rem", fontFamily: mono, fontSize: "0.78rem" }}>
          {list.data?.items.map((r) => (
            <button key={r.id} onClick={() => setId(r.id)} style={{ all: "unset", cursor: "pointer", padding: "0.25rem 0.3rem", background: (id ?? report.data?.id) === r.id ? B.redTint : "transparent" }}>
              {r.id}
            </button>
          ))}
        </div>
      </div>
      <div>
        {report.loading && <Spinner />}
        {report.error && <Banner tone="info">{errText(report.error)}</Banner>}
        {report.data && <MarkdownBlock content={report.data.markdown} />}
      </div>
    </div>
  );
}

// ─── ask + research ──────────────────────────────────────────────────────────

function AskTab({ companyId, canWrite, onOpen }: { companyId: string; canWrite: boolean; onOpen: (n: string) => void }) {
  const ask = usePluginAction("ask");
  const research = usePluginAction("research");
  const [q, setQ] = useState("");
  const [topic, setTopic] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ answer: string | null; repos: string[]; llm: boolean; reason?: string } | null>(null);
  const [brief, setBrief] = useState<{ title: string; synthesis: string | null; repos: Array<{ full_name: string; score: number; verdict: string; relevance: number; summary: string | null }> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "1.5rem" }}>
      <div>
        <SectionHeader label="Ask Kinly" sub="answers come from the Kinly database only" />
        {!canWrite && <Banner tone="info">Asking needs the API token secret (it spends LLM tokens under the service's daily cap).</Banner>}
        <textarea value={q} onChange={(e) => setQ(e.target.value)} rows={4} placeholder="Which trending repos could automate Instagram carousel publishing for FeetBit?" style={{ ...input, width: "100%", boxSizing: "border-box" }} />
        <button disabled={!canWrite || busy || !q.trim()} style={{ ...button("primary", !canWrite || busy || !q.trim()), marginTop: "0.5rem" }} onClick={() => go(async () => setAnswer((await ask({ companyId, question: q })) as typeof answer))}>
          Ask
        </button>
        {answer && (
          <div style={{ marginTop: "0.8rem", lineHeight: 1.55 }}>
            {answer.answer ? <p style={{ whiteSpace: "pre-wrap" }}>{answer.answer}</p> : <Banner tone="info">{answer.reason ?? "No written answer."}</Banner>}
            <div>
              {answer.repos.map((n) => (
                <button key={n} onClick={() => onOpen(n)} style={{ ...button("plain"), margin: "0 0.3rem 0.3rem 0", padding: "0.2rem 0.5rem", fontFamily: mono, fontSize: "0.75rem" }}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div>
        <SectionHeader label="Research brief" sub="a topic or a category" />
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="voice agents, Instagram automation, design-to-code…" style={{ ...input, width: "100%", boxSizing: "border-box" }} />
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...input, marginTop: "0.5rem", width: "100%" }} aria-label="Category">
          <option value="">Any category</option>
          {CATEGORIES.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <button disabled={!canWrite || busy || (!topic.trim() && !category)} style={{ ...button("primary", !canWrite || busy || (!topic.trim() && !category)), marginTop: "0.5rem" }} onClick={() => go(async () => setBrief((await research({ companyId, ...(topic.trim() ? { topic } : {}), ...(category ? { category } : {}) })) as typeof brief))}>
          Research
        </button>
        {brief && (
          <div style={{ marginTop: "0.8rem" }}>
            <div style={{ fontWeight: 700 }}>{brief.title}</div>
            {brief.synthesis && <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{brief.synthesis}</p>}
            {brief.repos.map((r, i) => (
              <div key={r.full_name} style={{ padding: "0.4rem 0", borderBottom: `1px solid ${B.hairDark}` }}>
                <button onClick={() => onOpen(r.full_name)} style={{ all: "unset", cursor: "pointer", fontWeight: 700 }}>
                  {i + 1}. {r.full_name}
                </button>{" "}
                <Pill label={r.verdict} color={verdictColor(r.verdict)} /> <span style={{ fontFamily: mono, fontSize: "0.75rem", opacity: 0.7 }}>score {r.score} · fit {r.relevance}</span>
                <div style={{ fontSize: "0.82rem", opacity: 0.8 }}>{r.summary ?? ""}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      {busy && <Spinner />}
      {error && <Banner tone="warn">{error}</Banner>}
    </div>
  );
}

// ─── sidebar + widget ────────────────────────────────────────────────────────

export function KinlySidebarLink(_props: PluginSidebarProps) {
  const href = useRouteHref();
  return (
    <a {...href()} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.35rem 0.75rem", fontSize: "0.85rem", color: "inherit", textDecoration: "none" }}>
      <span aria-hidden style={{ color: B.red, fontWeight: 800 }}>◆</span> Kinly
    </a>
  );
}

export function KinlyWidget(_props: PluginWidgetProps) {
  const companyId = useCompany();
  const href = useRouteHref();
  const res = usePluginData<{ date: string | null; items: RepoView[] }>("trending", companyId ? { companyId, window: "today", limit: 3 } : undefined);
  return (
    <div style={{ fontSize: "0.85rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: B.red }}>Trending today</span>
        <a {...href()} style={{ fontSize: "0.75rem", color: "inherit", opacity: 0.7 }}>
          Open Kinly →
        </a>
      </div>
      {res.loading && <Spinner />}
      {res.error && <div style={{ opacity: 0.7 }}>{errText(res.error)}</div>}
      {res.data?.items.map((v, i) => (
        <div key={v.repo.full_name} style={{ padding: "0.45rem 0", borderBottom: `1px solid ${B.hairDark}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
            <span style={{ fontWeight: 700 }}>
              {i + 1}. {v.repo.full_name}
            </span>
            <Pill label={v.score.verdict} color={verdictColor(v.score.verdict)} />
          </div>
          <div style={{ fontSize: "0.78rem", opacity: 0.75 }}>{v.repo.summary ?? v.repo.description ?? ""}</div>
        </div>
      ))}
      {res.data && <div style={{ fontSize: "0.72rem", opacity: 0.55, marginTop: "0.3rem" }}>{res.data.date ? `as of ${res.data.date}` : ""}</div>}
    </div>
  );
}
