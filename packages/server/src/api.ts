import { timingSafeEqual, createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  CATEGORY_IDS,
  CATEGORY_LABELS,
  LIST_KINDS,
  SHORTLIST_STATUSES,
  dates,
  isFullName,
  jobs,
  rankedList,
  repoView,
  type CategoryId,
  type JobContext,
  type ListKind,
  type Profile,
  type ShortlistStatus,
  type Verdict,
} from "@kinly/engine";
import { TokenBucket } from "./ratelimit.js";
import type { Scheduler } from "./scheduler.js";

/**
 * The Kinly JSON API (PLAN §3.8). GET routes are public, cached for five
 * minutes and rate-limited per IP; every POST and `/api/export` needs the
 * bearer token, compared in constant time. Bodies are JSON, at most 64 KB.
 */

export interface ApiDeps {
  ctx: JobContext;
  scheduler?: Scheduler | null;
  /** Wraps a job so it cannot overlap the scheduler's runs. */
  runExclusive?: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  bucket?: TokenBucket;
  /** False while a fresh store is still being rebuilt; jobs answer 503 until then. */
  isReady?: () => boolean;
  version?: string;
  startedAt?: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const MAX_BODY = 64 * 1024;
const VERDICTS: readonly Verdict[] = ["BUILD", "WATCH", "SKIP"];
const JOBS = ["daily", "weekly", "collect", "enrich", "score", "star-history", "export", "publish", "import"] as const;

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const json = JSON.stringify(body);
  const head = res.req?.method === "HEAD";
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-length": Buffer.byteLength(json),
    ...headers,
  });
  res.end(head ? undefined : json);
}

function intParam(url: URL, key: string, def: number, min: number, max: number): number {
  const raw = url.searchParams.get(key);
  if (raw === null || raw === "") return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new HttpError(400, `${key} must be an integer`);
  return Math.max(min, Math.min(max, n));
}

function categoryParam(url: URL): CategoryId | undefined {
  const c = url.searchParams.get("category");
  if (!c) return undefined;
  if (!(CATEGORY_IDS as readonly string[]).includes(c)) throw new HttpError(400, `unknown category "${c}"`);
  return c as CategoryId;
}

function dateParam(url: URL, key = "date"): string | undefined {
  const d = url.searchParams.get(key);
  if (!d) return undefined;
  if (!dates.isIsoDate(d)) throw new HttpError(400, `${key} must be YYYY-MM-DD`);
  return d;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "body too large");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "body must be a JSON object");
  }
}

function digest(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

/** Constant-time bearer check. With no token configured, writes are refused outright. */
export function authorized(req: IncomingMessage, token: string | null): boolean {
  if (!token) return false;
  const header = req.headers["authorization"] ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(Array.isArray(header) ? (header[0] ?? "") : header);
  if (!m?.[1]) return false;
  return timingSafeEqual(digest(m[1].trim()), digest(token));
}

/**
 * The client address for rate limiting. Railway's proxy appends the address it saw to
 * X-Forwarded-For, so the last hop is the one a client cannot forge; the first is whatever
 * the client sent (review G1-sec5).
 */
export function clientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  const hops = (Array.isArray(fwd) ? fwd.join(",") : (fwd ?? "")).split(",").map((h) => h.trim()).filter(Boolean);
  return hops.at(-1) || req.socket.remoteAddress || "unknown";
}

function str(body: Record<string, unknown>, key: string, max: number): string | null {
  const v = body[key];
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") throw new HttpError(400, `${key} must be a string`);
  return v.slice(0, max);
}

export function createApi(deps: ApiDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { ctx } = deps;
  const bucket = deps.bucket ?? new TokenBucket(120, 60);
  const exclusive = deps.runExclusive ?? (<T>(_n: string, fn: () => Promise<T>) => fn());
  const profile = (): Profile => jobs.loadProfile(ctx);
  const startedAt = deps.startedAt ?? new Date().toISOString();
  let credentialCache: { at: number; value: Record<string, string> } | null = null;
  const credentials = async (): Promise<Record<string, string>> => {
    if (credentialCache && Date.now() - credentialCache.at < 10 * 60_000) return credentialCache.value;
    const value = await jobs.credentialStates(ctx);
    credentialCache = { at: Date.now(), value };
    return value;
  };

  // A short in-process cache for the heavier list routes, cleared by any write (review G1-ops5).
  const responseCache = new Map<string, { at: number; body: unknown }>();
  const cached = (key: string, compute: () => unknown): unknown => {
    const hit = responseCache.get(key);
    if (hit && Date.now() - hit.at < 120_000) return hit.body;
    const body = compute();
    if (responseCache.size >= 300) responseCache.clear();
    responseCache.set(key, { at: Date.now(), body });
    return body;
  };

  const repoFromPath = (owner: string, name: string) => {
    const full = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
    if (!isFullName(full)) throw new HttpError(400, "not an owner/name");
    return ctx.store.resolveAlias(full);
  };

  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://kinly.local");
    const isHead = req.method === "HEAD";
    const method = isHead ? "GET" : (req.method ?? "GET");
    const p = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (method === "OPTIONS") {
        res.writeHead(204, { allow: "GET, HEAD, POST, OPTIONS" });
        res.end();
        return;
      }
      if (p === "/api/health") return send(res, 200, { ok: true, service: "kinly", version: deps.version ?? "0.1.0", started_at: startedAt });
      if (method === "GET" && !bucket.take(clientIp(req))) return send(res, 429, { error: "rate limited" }, { "retry-after": "30" });

      const cache = { "cache-control": "public, max-age=300" };
      const noStore = { "cache-control": "no-store" };

      if (method === "GET") {
        if (p === "/" || p === "/api") {
          return send(res, 200, { service: "Project Kinly by Vantik Systems", docs: "https://github.com/angellog/kinly/blob/main/docs/API.md", data: `https://github.com/${ctx.config.dataRepo}` }, cache);
        }
        if (p === "/api/status") {
          // Public: whether it is up and fresh. Credentials, spend and error text only with the token (review G1-sec9).
          if (!authorized(req, ctx.config.apiToken)) {
            const sched = deps.scheduler?.status() as Record<string, unknown> | undefined;
            return send(res, 200, { ok: true, started_at: startedAt, last_daily_ok: sched?.["last_daily_ok"] ?? null, last_weekly_ok: sched?.["last_weekly_ok"] ?? null, stats: ctx.store.stats() }, noStore);
          }
          return send(
            res,
            200,
            {
              ok: true,
              started_at: startedAt,
              credentials: await credentials(),
              github_token_source: ctx.config.githubTokenSource,
              data_repo: ctx.config.dataRepo,
              owner_state_synced: ctx.github.authenticated && ctx.config.githubTokenSource === "env",
              llm: { available: ctx.llm.available, model: ctx.llm.model, tokens_today: ctx.llm.tokensUsedToday(), daily_cap: ctx.llm.dailyCap },
              scheduler: deps.scheduler?.status() ?? null,
              stats: ctx.store.stats(),
              recent_runs: ctx.store.recentRuns(15),
            },
            noStore,
          );
        }
        if (p === "/api/categories") {
          const counts = new Map(ctx.store.categoryCounts().map((c) => [c.category, c] as const));
          return send(res, 200, { categories: CATEGORY_IDS.map((id) => ({ id, label: CATEGORY_LABELS[id], repos: counts.get(id)?.count ?? 0, build: counts.get(id)?.build ?? 0, weight: profile().category_weights[id] ?? 0.3 })) }, cache);
        }
        if (p === "/api/trending") {
          const raw = url.searchParams.get("window") ?? "today";
          const kind = (raw === "daily" ? "today" : raw === "weekly" ? "week" : raw === "monthly" ? "month" : raw) as ListKind;
          if (!LIST_KINDS.includes(kind)) throw new HttpError(400, `window must be one of ${LIST_KINDS.join(", ")}`);
          const category = categoryParam(url);
          const date = dateParam(url);
          const minRel = url.searchParams.get("min_relevance");
          const limit = intParam(url, "limit", 15, 1, 100);
          const body = cached(`trending|${kind}|${category ?? ""}|${date ?? ""}|${minRel ?? ""}|${limit}`, () => {
            const views = rankedList(ctx.store, kind, profile(), {
              limit,
              ...(category ? { category } : {}),
              ...(date ? { date } : {}),
              ...(minRel ? { min_relevance: intParam(url, "min_relevance", 0, 0, 100) } : {}),
            });
            return { window: kind, date: date ?? ctx.store.latestListDate("daily"), count: views.length, items: views };
          });
          return send(res, 200, body, cache);
        }
        if (p === "/api/repos") {
          const category = categoryParam(url);
          const verdict = url.searchParams.get("verdict");
          if (verdict && !VERDICTS.includes(verdict as Verdict)) throw new HttpError(400, "verdict must be BUILD, WATCH or SKIP");
          const sort = url.searchParams.get("sort");
          if (sort && !["score", "relevance", "stars", "recent", "name"].includes(sort)) throw new HttpError(400, "sort must be score, relevance, stars, recent or name");
          const q = url.searchParams.get("q");
          const { rows, total } = ctx.store.listRepos({
            ...(q ? { q } : {}),
            ...(category ? { category } : {}),
            ...(verdict ? { verdict: verdict as Verdict } : {}),
            ...(sort ? { sort: sort as "score" } : {}),
            ...(url.searchParams.get("starred") === "true" ? { starred: true } : {}),
            ...(url.searchParams.get("shortlisted") === "true" ? { shortlisted: true } : {}),
            limit: intParam(url, "limit", 25, 1, 100),
            offset: intParam(url, "offset", 0, 0, 100_000),
          });
          const pr = profile();
          return send(res, 200, cached(`repos|${url.search}`, () => ({ total, items: rows.map((r) => repoView(ctx.store, r, pr)) })), cache);
        }
        let m = /^\/api\/repos\/([^/]+)\/([^/]+)$/.exec(p);
        if (m) {
          const name = repoFromPath(m[1] ?? "", m[2] ?? "");
          const repo = ctx.store.getRepo(name);
          if (!repo) throw new HttpError(404, `unknown repo ${name}`);
          const resource = ctx.store.getResource(name);
          return send(res, 200, { ...repoView(ctx.store, repo, profile()), appearances: ctx.store.appearancesFor(name, 60), star_weeks: ctx.store.starWeeks(name, 26), resource: resource ? { generated_at: resource.generated_at, markdown: resource.markdown } : null }, cache);
        }
        if (p === "/api/stars") {
          const pr = profile();
          const stars = ctx.store.userStars();
          const items = stars.slice(0, intParam(url, "limit", 100, 1, 300)).map((s) => {
            const r = ctx.store.getRepo(s.full_name);
            return { full_name: s.full_name, starred_at: s.starred_at, view: r ? repoView(ctx.store, r, pr) : null };
          });
          return send(res, 200, { total: stars.length, items, star_topics: pr.star_topics, category_weights: pr.category_weights }, cache);
        }
        if (p === "/api/reports") {
          const kind = url.searchParams.get("kind") ?? undefined;
          return send(res, 200, { items: ctx.store.listReports(kind, intParam(url, "limit", 60, 1, 100)) }, cache);
        }
        if (p === "/api/reports/latest") {
          const kind = url.searchParams.get("kind") ?? "daily";
          const r = ctx.store.latestReport(kind);
          if (!r) throw new HttpError(404, `no ${kind} report yet`);
          return send(res, 200, r, cache);
        }
        m = /^\/api\/reports\/([a-z]+)\/([A-Za-z0-9._-]+)$/.exec(p);
        if (m) {
          const r = ctx.store.getReport(m[1] ?? "", m[2] ?? "");
          if (!r) throw new HttpError(404, "no such report");
          return send(res, 200, r, cache);
        }
        if (p === "/api/shortlist") {
          const pr = profile();
          const items = ctx.store.listShortlist(url.searchParams.get("include_dropped") === "true").map((s) => {
            const r = ctx.store.getRepo(s.full_name);
            return { ...s, view: r ? repoView(ctx.store, r, pr) : null };
          });
          return send(res, 200, { items, wip: items.filter((i) => i.status === "shortlisted" || i.status === "testing").length, wip_limit: 5 }, noStore);
        }
        if (p === "/api/resources") return send(res, 200, { items: ctx.store.listResources() }, cache);
        if (p === "/api/export") {
          if (!authorized(req, ctx.config.apiToken)) throw new HttpError(401, "bearer token required");
          // Default: owner state and pages (what `kinly pull` needs). ?full=1 for the whole store, without README text (review G1-ops4).
          if (url.searchParams.get("full") !== "1") return send(res, 200, ctx.store.ownerBundle(), noStore);
          const bundle = ctx.store.exportBundle();
          return send(res, 200, { ...bundle, repos: bundle.repos.map((r) => ({ ...r, readme_excerpt: null })) }, noStore);
        }
        throw new HttpError(404, "not found");
      }

      if (method === "POST") {
        if (!authorized(req, ctx.config.apiToken)) throw new HttpError(ctx.config.apiToken ? 401 : 503, ctx.config.apiToken ? "bearer token required" : "writes are disabled: KINLY_API_TOKEN is not set");
        const body = await readJson(req);
        responseCache.clear();
        let m = /^\/api\/repos\/([^/]+)\/([^/]+)\/(shortlist|rating|agent-rating|resource)$/.exec(p);
        if (m) {
          const name = repoFromPath(m[1] ?? "", m[2] ?? "");
          const action = m[3];
          if (action === "shortlist") {
            const status = (str(body, "status", 20) ?? "shortlisted") as ShortlistStatus;
            if (!SHORTLIST_STATUSES.includes(status)) throw new HttpError(400, `status must be one of ${SHORTLIST_STATUSES.join(", ")}`);
            return send(res, 200, ctx.store.setShortlist(name, status, str(body, "note", 1000)), noStore);
          }
          const rating = typeof body["rating"] === "number" ? body["rating"] : Number.NaN;
          if (action === "rating") {
            if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, "rating must be an integer 1..5");
            const vo = str(body, "verdict_override", 5);
            if (vo && !VERDICTS.includes(vo as Verdict)) throw new HttpError(400, "verdict_override must be BUILD, WATCH or SKIP");
            return send(res, 200, ctx.store.setRating(name, { rating, notes: str(body, "notes", 2000), verdict_override: (vo as Verdict | null) ?? null }), noStore);
          }
          if (action === "agent-rating") {
            if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, "rating must be an integer 1..5");
            return send(res, 200, ctx.store.setAgentRating(name, { rating, notes: str(body, "notes", 2000), test_log: str(body, "test_log", 20_000), agent: str(body, "agent", 80) }), noStore);
          }
          // resource
          if (!ctx.store.getRepo(name)) throw new HttpError(404, `unknown repo ${name}`);
          const out = jobs.writeResource(ctx, profile(), name, { testLog: str(body, "test_log", 20_000) });
          const sl = ctx.store.getShortlist(name);
          if (sl && sl.status === "rated") ctx.store.setShortlist(name, "resourced", sl.note);
          return send(res, 200, { full_name: name, markdown: out.markdown }, noStore);
        }
        if (p === "/api/ask") {
          const q = str(body, "question", 1000);
          if (!q) throw new HttpError(400, "question is required");
          return send(res, 200, await exclusive("ask", () => jobs.ask(ctx, profile(), q)), noStore);
        }
        if (p === "/api/research") {
          const topic = str(body, "topic", 200);
          const cat = str(body, "category", 40);
          if (cat && !(CATEGORY_IDS as readonly string[]).includes(cat)) throw new HttpError(400, `unknown category "${cat}"`);
          if (!topic && !cat) throw new HttpError(400, "topic or category is required");
          return send(res, 200, await exclusive("research", () => jobs.research(ctx, profile(), { ...(topic ? { topic } : {}), ...(cat ? { category: cat as CategoryId } : {}) })), noStore);
        }
        if (p === "/api/jobs/run") {
          const job = str(body, "job", 30);
          if (!job || !(JOBS as readonly string[]).includes(job)) throw new HttpError(400, `job must be one of ${JOBS.join(", ")}`);
          if (deps.isReady && !deps.isReady()) throw new HttpError(503, "the store is still being rebuilt from the data repo; try again in a few minutes");
          if (deps.scheduler?.running) throw new HttpError(409, `busy: ${deps.scheduler.running} is running`);
          const today = dates.isoDate();
          const date = typeof body["date"] === "string" && dates.isIsoDate(body["date"]) ? body["date"] : today;
          // Collect scrapes the live page: stamping today's lists with another date would corrupt that day's archive (review G1-cor6).
          if ((job === "daily" || job === "collect") && date !== today) throw new HttpError(400, `${job} only runs for today (${today}); the live trending page has no history`);
          // Long jobs run in the background; the outcome lands in /api/status recent_runs (review G1-ops10).
          const work = exclusive(job, async () => {
            switch (job) {
              case "daily":
                return jobs.runDaily(ctx, { date });
              case "weekly":
                return jobs.runWeekly(ctx, { date });
              case "collect":
                return jobs.collectLive(ctx, { date });
              case "enrich":
                return jobs.enrichPending(ctx, {});
              case "score":
                return jobs.scoreAll(ctx, profile());
              case "star-history":
                return jobs.fetchStarHistories(ctx, ctx.store.list("today", { date, limit: 150 }).map((r) => r.full_name));
              case "export":
                return { ...jobs.exportData(ctx), manifest: jobs.writeDataManifest(ctx) };
              case "import": {
                // Re-sync from the data repo: idempotent, newer-wins for repos, aliases merge split histories.
                const fetched = await jobs.fetchDataFromRepo(ctx);
                const imported = jobs.importData(ctx);
                return { fetched, imported, scored: jobs.scoreAll(ctx, jobs.loadProfile(ctx)) };
              }
              default:
                return jobs.publishToRepo(ctx, { message: `kinly: manual publish ${date}` });
            }
          });
          void work.then(
            () => ctx.log(`api job ${job} done`),
            (err) => ctx.log(`api job ${job} failed: ${err instanceof Error ? err.message : String(err)}`),
          );
          responseCache.clear();
          return send(res, 202, { job, date, accepted: true, status: "/api/status" }, noStore);
        }
        throw new HttpError(404, "not found");
      }
      throw new HttpError(405, "method not allowed");
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      ctx.log(`api ${method} ${p}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      return send(res, 500, { error: "internal error" });
    }
  };
}
