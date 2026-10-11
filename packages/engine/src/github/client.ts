/**
 * A small GitHub API client: REST + GraphQL, rate-limit aware, keyless-capable.
 *
 * - With a token: 5,000 core req/h, GraphQL available.
 * - Without: 60 req/h on REST, no GraphQL. The client never throws on
 *   exhaustion; it waits (bounded) or reports `exhausted` so the caller can
 *   stop early and try again on the next run.
 */

export interface RateState {
  limit: number | null;
  remaining: number | null;
  /** Epoch seconds when the window resets. */
  reset: number | null;
  used: number;
}

export interface GitHubClientOptions {
  token?: string | null;
  fetchImpl?: typeof fetch;
  userAgent?: string;
  /** Stop making requests when `remaining` falls to this number (default 20 with a token, 3 without). */
  reserve?: number;
  /** Longest the client will sleep waiting for a reset, in ms (default 90s). */
  maxWaitMs?: number;
  /** Max retries on 5xx / secondary rate limits (default 2). */
  retries?: number;
  log?: (msg: string) => void;
}

export class GitHubHttpError extends Error {
  override readonly name = "GitHubHttpError";
  constructor(
    readonly status: number,
    readonly path: string,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export class RateLimitExhausted extends Error {
  override readonly name = "RateLimitExhausted";
  constructor(readonly resetAt: number | null) {
    super(`GitHub rate limit exhausted${resetAt ? `; resets at ${new Date(resetAt * 1000).toISOString()}` : ""}`);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class GitHubClient {
  readonly token: string | null;
  readonly authenticated: boolean;
  readonly rate: RateState = { limit: null, remaining: null, reset: null, used: 0 };
  readonly graphqlRate: RateState = { limit: null, remaining: null, reset: null, used: 0 };
  readonly searchRate: RateState = { limit: null, remaining: null, reset: null, used: 0 };
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly reserve: number;
  private readonly maxWaitMs: number;
  private readonly retries: number;
  private readonly log: (msg: string) => void;

  constructor(options: GitHubClientOptions = {}) {
    this.token = options.token?.trim() ? options.token.trim() : null;
    this.authenticated = this.token !== null;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.userAgent = options.userAgent ?? "KinlyBot/0.1 (+https://github.com/angellog/kinly)";
    this.reserve = options.reserve ?? (this.authenticated ? 20 : 3);
    this.maxWaitMs = options.maxWaitMs ?? 90_000;
    this.retries = options.retries ?? 2;
    this.log = options.log ?? (() => undefined);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = {
      accept: "application/vnd.github+json",
      "user-agent": this.userAgent,
      "x-github-api-version": "2022-11-28",
      ...extra,
    };
    if (this.token) h["authorization"] = `Bearer ${this.token}`;
    return h;
  }

  private readRate(res: Response, into: RateState): void {
    const n = (name: string): number | null => {
      const v = res.headers.get(name);
      if (v === null) return null;
      const x = Number.parseInt(v, 10);
      return Number.isFinite(x) ? x : null;
    };
    const limit = n("x-ratelimit-limit");
    const remaining = n("x-ratelimit-remaining");
    const reset = n("x-ratelimit-reset");
    if (limit !== null) into.limit = limit;
    if (remaining !== null) into.remaining = remaining;
    if (reset !== null) into.reset = reset;
    into.used++;
  }

  /** Wait for the window to reset when we are at the reserve, or throw if the wait is too long. */
  private async gate(state: RateState): Promise<void> {
    if (state.remaining === null || state.remaining > this.reserve) return;
    const now = Math.floor(Date.now() / 1000);
    const waitMs = state.reset ? Math.max(0, (state.reset - now) * 1000 + 1000) : this.maxWaitMs + 1;
    if (waitMs > this.maxWaitMs) throw new RateLimitExhausted(state.reset);
    this.log(`rate limit near reserve (${state.remaining}); waiting ${Math.round(waitMs / 1000)}s`);
    await sleep(waitMs);
    state.remaining = null;
  }

  /** Remaining budget above the reserve, or Infinity when unknown. */
  budget(kind: "core" | "graphql" | "search" = "core"): number {
    const s = kind === "graphql" ? this.graphqlRate : kind === "search" ? this.searchRate : this.rate;
    return s.remaining === null ? Number.POSITIVE_INFINITY : Math.max(0, s.remaining - this.reserve);
  }

  /** REST GET returning parsed JSON (or null on 404 when `allow404`). */
  async rest<T = unknown>(
    path: string,
    params: Record<string, string | number | boolean> = {},
    options: { accept?: string; allow404?: boolean } = {},
  ): Promise<T | null> {
    const isSearch = path.startsWith("/search/");
    const state = isSearch ? this.searchRate : this.rate;
    const url = new URL(`https://api.github.com${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      await this.gate(state);
      const res = await this.fetchImpl(url, { headers: this.headers(options.accept ? { accept: options.accept } : {}) });
      this.readRate(res, state);
      if (res.status === 404 && options.allow404) return null;
      if (res.ok) return (await res.json()) as T;
      if ((res.status === 403 || res.status === 429) && attempt < this.retries) {
        const retryAfter = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
        const remaining = res.headers.get("x-ratelimit-remaining");
        if (remaining === "0") {
          state.remaining = 0;
          await res.text();
          continue; // gate() will wait or throw
        }
        const wait = Number.isFinite(retryAfter) ? retryAfter * 1000 : 30_000 * (attempt + 1);
        if (wait > this.maxWaitMs) throw new GitHubHttpError(res.status, path, `secondary rate limit; retry-after ${wait / 1000}s`);
        this.log(`secondary limit on ${path}; waiting ${wait / 1000}s`);
        await res.text();
        await sleep(wait);
        continue;
      }
      if (res.status >= 500 && attempt < this.retries) {
        await res.text();
        await sleep(2000 * (attempt + 1));
        continue;
      }
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      const message = body && typeof body === "object" && "message" in body ? String((body as { message: unknown }).message) : res.statusText;
      throw new GitHubHttpError(res.status, path, `GitHub ${res.status} on ${path}: ${message}`, body);
    }
  }

  /** Paginate a REST list endpoint via Link headers, up to `maxPages`. */
  async *restPages<T = unknown>(
    path: string,
    params: Record<string, string | number | boolean> = {},
    options: { accept?: string; maxPages?: number } = {},
  ): AsyncGenerator<T[], void, void> {
    const maxPages = options.maxPages ?? 50;
    let url: URL | null = new URL(`https://api.github.com${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    if (!url.searchParams.has("per_page")) url.searchParams.set("per_page", "100");
    for (let page = 0; url && page < maxPages; page++) {
      await this.gate(this.rate);
      const res: Response = await this.fetchImpl(url, { headers: this.headers(options.accept ? { accept: options.accept } : {}) });
      this.readRate(res, this.rate);
      if (!res.ok) {
        const text = await res.text();
        throw new GitHubHttpError(res.status, path, `GitHub ${res.status} on ${path}: ${text.slice(0, 200)}`);
      }
      yield (await res.json()) as T[];
      const link = res.headers.get("link") ?? "";
      const next = /<([^>]+)>;\s*rel="next"/.exec(link);
      url = next?.[1] ? new URL(next[1]) : null;
    }
  }

  /** GraphQL query. Requires a token. */
  async graphql<T = unknown>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    if (!this.token) throw new Error("GraphQL requires a GitHub token");
    for (let attempt = 0; ; attempt++) {
      await this.gate(this.graphqlRate);
      const res = await this.fetchImpl("https://api.github.com/graphql", {
        method: "POST",
        headers: this.headers({ "content-type": "application/json" }),
        body: JSON.stringify({ query, variables }),
      });
      this.readRate(res, this.graphqlRate);
      if (res.status >= 500 && attempt < this.retries) {
        await res.text();
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        const text = await res.text();
        throw new GitHubHttpError(res.status, "/graphql", `GitHub GraphQL ${res.status}: ${text.slice(0, 300)}`);
      }
      const json = (await res.json()) as { data?: T; errors?: Array<{ type?: string; message: string; path?: unknown[] }> };
      // Per-node errors (NOT_FOUND for a renamed repo) come back next to partial data; the caller handles nulls.
      if (json.errors && json.errors.length > 0 && !json.data) {
        const fatal = json.errors.find((e) => e.type !== "NOT_FOUND");
        if (fatal) throw new GitHubHttpError(200, "/graphql", `GitHub GraphQL error: ${fatal.message}`, json.errors);
      }
      return (json.data ?? ({} as T)) as T;
    }
  }

  async rateLimit(): Promise<{ core: RateState; graphql: RateState; search: RateState }> {
    const data = await this.rest<{ resources: Record<string, { limit: number; remaining: number; reset: number; used: number }> }>("/rate_limit");
    const pick = (k: string): RateState => {
      const r = data?.resources[k];
      return r ? { limit: r.limit, remaining: r.remaining, reset: r.reset, used: r.used } : { limit: null, remaining: null, reset: null, used: 0 };
    };
    Object.assign(this.rate, { limit: pick("core").limit, remaining: pick("core").remaining, reset: pick("core").reset });
    Object.assign(this.graphqlRate, { limit: pick("graphql").limit, remaining: pick("graphql").remaining, reset: pick("graphql").reset });
    Object.assign(this.searchRate, { limit: pick("search").limit, remaining: pick("search").remaining, reset: pick("search").reset });
    return { core: pick("core"), graphql: pick("graphql"), search: pick("search") };
  }
}
