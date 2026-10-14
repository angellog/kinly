/**
 * A small client for the Kinly API (PLAN §3.8). Plain fetch: the API is a
 * public https service and the plugin talks to nothing else (D8).
 */

export class KinlyApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "KinlyApiError";
  }
}

export interface KinlyApiOptions {
  baseUrl: string;
  token?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Pause before the one retry of a failed read (default 1.5 s). */
  retryDelayMs?: number;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export class KinlyApi {
  readonly baseUrl: string;
  private readonly token: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;

  constructor(options: KinlyApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token ?? null;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retryDelayMs = options.retryDelayMs ?? 1_500;
  }

  get canWrite(): boolean {
    return this.token !== null;
  }

  private async call<T>(method: "GET" | "POST", path: string, query: Query = {}, body?: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { accept: "application/json", "user-agent": "vantik.kinly-paperclip/0.2" };
    if (method === "POST") {
      if (!this.token) throw new KinlyApiError(401, "No Kinly API token is configured for this company (plugin settings → Kinly API token).");
      headers["authorization"] = `Bearer ${this.token}`;
      headers["content-type"] = "application/json";
    }
    // A read that fails before any response (a cold start, a dropped connection) is retried once after a short
    // pause; a single failure is not evidence the service is down (H15). Writes and timeouts are never retried:
    // a lost response to a POST may mean it was applied.
    let res: Response | null = null;
    for (let attempt = 1; res === null; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        res = await this.fetchImpl(url, { method, headers, signal: ac.signal, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      } catch (err) {
        const timedOut = ac.signal.aborted;
        if (method === "GET" && !timedOut && attempt < 2) {
          await new Promise((r) => setTimeout(r, this.retryDelayMs));
          continue;
        }
        const tries = attempt > 1 ? ` after ${attempt} attempts` : "";
        throw new KinlyApiError(0, `Kinly API unreachable at ${this.baseUrl}${tries}: ${timedOut ? `no answer within ${timeoutMs / 1000} s` : err instanceof Error ? err.message : String(err)}`);
      } finally {
        clearTimeout(timer);
      }
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const msg = json && typeof json === "object" && "error" in json ? String((json as { error: unknown }).error) : `HTTP ${res.status}`;
      throw new KinlyApiError(res.status, msg);
    }
    return json as T;
  }

  health() {
    return this.call<{ ok: boolean; version: string }>("GET", "/api/health", {}, undefined, 8_000);
  }
  status() {
    return this.call<Record<string, unknown>>("GET", "/api/status");
  }
  trending(q: { window?: string; category?: string; limit?: number; min_relevance?: number; date?: string }) {
    return this.call<{ window: string; date: string | null; count: number; items: RepoView[] }>("GET", "/api/trending", q);
  }
  repos(q: { q?: string; category?: string; verdict?: string; sort?: string; limit?: number; offset?: number; starred?: boolean; shortlisted?: boolean }) {
    return this.call<{ total: number; items: RepoView[] }>("GET", "/api/repos", q);
  }
  repo(fullName: string) {
    const [o, n] = fullName.split("/");
    return this.call<RepoView & { appearances: unknown[]; star_weeks: Array<{ week_start: string; total: number }>; resource: { markdown: string; generated_at: string } | null }>("GET", `/api/repos/${encodeURIComponent(o ?? "")}/${encodeURIComponent(n ?? "")}`);
  }
  categories() {
    return this.call<{ categories: Array<{ id: string; label: string; repos: number; build: number; weight: number }> }>("GET", "/api/categories");
  }
  stars(limit = 100) {
    return this.call<{ total: number; items: Array<{ full_name: string; starred_at: string; view: RepoView | null }> }>("GET", "/api/stars", { limit });
  }
  shortlist() {
    return this.call<{ items: Array<{ full_name: string; status: string; note: string | null; updated_at: string; view: RepoView | null }>; wip: number; wip_limit: number }>("GET", "/api/shortlist");
  }
  reports(kind?: string, limit = 60) {
    return this.call<{ items: Array<{ kind: string; id: string; generated_at: string; bytes: number }> }>("GET", "/api/reports", { kind, limit });
  }
  report(kind: string, id: string) {
    return this.call<{ kind: string; id: string; generated_at: string; markdown: string }>("GET", `/api/reports/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`);
  }
  latestReport(kind: string) {
    return this.call<{ kind: string; id: string; generated_at: string; markdown: string }>("GET", "/api/reports/latest", { kind });
  }
  setShortlist(fullName: string, status: string, note?: string | null) {
    return this.call<Record<string, unknown>>("POST", `${repoPath(fullName)}/shortlist`, {}, { status, note: note ?? null });
  }
  ownerRate(fullName: string, rating: number, notes?: string | null, verdictOverride?: string | null) {
    return this.call<Record<string, unknown>>("POST", `${repoPath(fullName)}/rating`, {}, { rating, notes: notes ?? null, verdict_override: verdictOverride ?? null });
  }
  agentRate(fullName: string, rating: number, notes: string | null, testLog: string | null, agent: string | null) {
    return this.call<Record<string, unknown>>("POST", `${repoPath(fullName)}/agent-rating`, {}, { rating, notes, test_log: testLog, agent });
  }
  resource(fullName: string, testLog?: string | null) {
    return this.call<{ full_name: string; markdown: string }>("POST", `${repoPath(fullName)}/resource`, {}, testLog ? { test_log: testLog } : {});
  }
  ask(question: string) {
    return this.call<{ answer: string | null; repos: string[]; llm: boolean; reason?: string }>("POST", "/api/ask", {}, { question }, 120_000);
  }
  research(input: { topic?: string; category?: string }) {
    return this.call<{ title: string; repos: Array<{ full_name: string; score: number; verdict: string; relevance: number; summary: string | null }>; synthesis: string | null; llm: boolean }>("POST", "/api/research", {}, input, 120_000);
  }
}

function repoPath(fullName: string): string {
  const [o, n] = fullName.split("/");
  return `/api/repos/${encodeURIComponent(o ?? "")}/${encodeURIComponent(n ?? "")}`;
}

/** The subset of the engine's RepoView the plugin reads. */
export interface RepoView {
  repo: {
    full_name: string;
    description: string | null;
    summary: string | null;
    business_use: string | null;
    language: string | null;
    topics: string[];
    stars: number | null;
    forks: number | null;
    license_spdx: string | null;
    license_class: string;
    open_core: boolean;
    archived: boolean;
    homepage: string | null;
    category: string;
    created_at: string | null;
    pushed_at: string | null;
  };
  signals: { distinct_days: number; distinct_weeks: number; first_seen: string | null; last_seen: string | null; peak_stars_period: number | null; stars_7d: number | null; peak_week_stars: number | null };
  score: { total: number; verdict: "BUILD" | "WATCH" | "SKIP"; reasons: string[]; adoption: number; maintenance: number; persistence: number; license: number; relevance: number };
  relevance: number;
  shortlist: { status: string; note: string | null; updated_at: string } | null;
  rating: { rating: number; notes: string | null; verdict_override: string | null } | null;
  agent_rating: { rating: number; notes: string | null; test_log: string | null } | null;
  starred: boolean;
  rank?: number;
  metric_label?: string;
}

export const FULL_NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/;
