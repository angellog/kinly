import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { buildBrief, testIssue, upsertBrief, type BriefIssues } from "./brief.js";
import { FULL_NAME_RE, KinlyApi, KinlyApiError } from "./client.js";
import { parseConfig, tokenAllowedFor, type KinlyCompanyConfig } from "./config.js";
import { repoCard } from "./format.js";
import { runTool, TOOL_DECLARATIONS } from "./tools.js";

/**
 * vantik.kinly worker.
 *
 * Reads go to the Kinly API without a token. Writes (shortlist, ratings,
 * resource pages, ask, research) resolve the company's token from its secret
 * reference on every call: secrets are never cached or logged (R4). The token
 * never reaches the browser, because the UI only talks to this worker.
 */

const WRITE_TOOLS = new Set(["shortlist", "rate", "resource", "research"]);

const plugin = definePlugin({
  async setup(ctx) {
    const configFor = async (companyId: string): Promise<KinlyCompanyConfig> => parseConfig((await ctx.config.get(companyId)) ?? {});

    const apiFor = async (companyId: string, write: boolean): Promise<{ api: KinlyApi; config: KinlyCompanyConfig }> => {
      const config = await configFor(companyId);
      if (!config.enabled) throw new KinlyApiError(403, "Kinly is turned off for this company (plugin settings → Enabled).");
      let token: string | null = null;
      if (write) {
        if (!config.apiTokenRef) throw new KinlyApiError(401, "No Kinly API token is configured for this company (plugin settings → Kinly API token).");
        if (!tokenAllowedFor(config.apiUrl)) throw new KinlyApiError(403, `The API token is only sent to the Kinly service; ${config.apiUrl} is not it.`);
        token = await ctx.secrets.resolve(config.apiTokenRef, { companyId, configPath: "apiTokenRef" });
      }
      return { api: new KinlyApi({ baseUrl: config.apiUrl, token }), config };
    };

    const requireCompany = (params: Record<string, unknown>, actionCompany?: string | null): string => {
      const companyId = actionCompany ?? params["companyId"];
      if (typeof companyId !== "string" || companyId.length === 0) throw new Error("No active company for this request");
      return companyId;
    };

    const requireName = (params: Record<string, unknown>): string => {
      const n = typeof params["fullName"] === "string" ? params["fullName"].trim() : "";
      if (!FULL_NAME_RE.test(n)) throw new Error("fullName must be owner/name");
      return n;
    };

    const str = (params: Record<string, unknown>, key: string): string | undefined => (typeof params[key] === "string" && (params[key] as string).trim() ? (params[key] as string).trim() : undefined);

    // ─── managed agent + skill (D9: the agent starts paused) ─────────────────
    const reconcileCompany = async (companyId: string): Promise<Record<string, string>> => {
      const config = await configFor(companyId);
      if (!config.enabled) return { agent: "skipped (disabled)", skill: "skipped (disabled)" };
      const out: Record<string, string> = {};
      try {
        const current = await ctx.agents.managed.get("kinly", companyId);
        // A company that requires board approval for new agents holds the hire until a human approves it.
        if ((current.agent?.status as string | undefined) === "pending_approval") out["agent"] = "pending board approval";
        else out["agent"] = (await ctx.agents.managed.reconcile("kinly", companyId)).status;
      } catch (err) {
        out["agent"] = `error: ${err instanceof Error ? err.message : String(err)}`;
      }
      try {
        out["skill"] = (await ctx.skills.managed.reconcile("kinly", companyId)).status;
      } catch (err) {
        out["skill"] = `error: ${err instanceof Error ? err.message : String(err)}`;
      }
      return out;
    };

    // The host lets background work act only for companies with a saved Kinly config; others are skipped, not fatal.
    const reconcileAll = async (): Promise<Record<string, Record<string, string>>> => {
      const result: Record<string, Record<string, string>> = {};
      for (const company of await ctx.companies.list({ limit: 100 })) {
        try {
          result[company.id] = await reconcileCompany(company.id);
        } catch (err) {
          result[company.id] = { skipped: err instanceof Error ? err.message : String(err) };
        }
      }
      ctx.logger.info("kinly: reconciled managed agent and skill", { result });
      return result;
    };

    // ─── data (reads) ────────────────────────────────────────────────────────
    ctx.data.register("settings", async (params) => {
      const companyId = requireCompany(params);
      const config = await configFor(companyId);
      let health: { ok: boolean; version?: string; error?: string } = { ok: false };
      try {
        const h = await new KinlyApi({ baseUrl: config.apiUrl }).health();
        health = { ok: h.ok, version: h.version };
      } catch (err) {
        health = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      return { enabled: config.enabled, apiUrl: config.apiUrl, canWrite: config.apiTokenRef !== null, dailyBrief: config.dailyBrief, focus: config.focus, health };
    });

    ctx.data.register("status", async (params) => (await apiFor(requireCompany(params), false)).api.status());

    ctx.data.register("trending", async (params) => {
      const { api } = await apiFor(requireCompany(params), false);
      const limit = typeof params["limit"] === "number" ? params["limit"] : 15;
      return api.trending({ window: str(params, "window") ?? "today", category: str(params, "category"), limit, ...(typeof params["minRelevance"] === "number" ? { min_relevance: params["minRelevance"] } : {}) });
    });

    ctx.data.register("search", async (params) => {
      const { api } = await apiFor(requireCompany(params), false);
      return api.repos({ q: str(params, "q"), category: str(params, "category"), verdict: str(params, "verdict"), sort: str(params, "sort") ?? "score", limit: typeof params["limit"] === "number" ? params["limit"] : 25 });
    });

    ctx.data.register("repo", async (params) => (await apiFor(requireCompany(params), false)).api.repo(requireName(params)));
    ctx.data.register("categories", async (params) => (await apiFor(requireCompany(params), false)).api.categories());
    ctx.data.register("stars", async (params) => (await apiFor(requireCompany(params), false)).api.stars(150));
    ctx.data.register("shortlist", async (params) => (await apiFor(requireCompany(params), false)).api.shortlist());
    ctx.data.register("reports", async (params) => (await apiFor(requireCompany(params), false)).api.reports(str(params, "kind"), 60));
    ctx.data.register("report", async (params) => {
      const { api } = await apiFor(requireCompany(params), false);
      const kind = str(params, "kind") ?? "daily";
      const id = str(params, "id");
      return id ? api.report(kind, id) : api.latestReport(kind);
    });

    // ─── actions (writes, from the console; the actor is the board user) ─────
    ctx.actions.register("shortlist", async (params, context) => {
      const companyId = requireCompany(params, context.companyId);
      const { api } = await apiFor(companyId, true);
      const status = str(params, "status") ?? "shortlisted";
      return api.setShortlist(requireName(params), status, str(params, "note") ?? null);
    });

    ctx.actions.register("rate", async (params, context) => {
      const companyId = requireCompany(params, context.companyId);
      const { api } = await apiFor(companyId, true);
      const rating = typeof params["rating"] === "number" ? params["rating"] : Number.NaN;
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("rating must be an integer 1..5");
      const name = requireName(params);
      const res = await api.ownerRate(name, rating, str(params, "notes") ?? null, str(params, "verdictOverride") ?? null);
      await ctx.activity.log({ companyId, message: `Kinly: rated ${name} ${rating}/5`, metadata: { fullName: name, rating } });
      return res;
    });

    ctx.actions.register("resource", async (params, context) => {
      const companyId = requireCompany(params, context.companyId);
      const { api } = await apiFor(companyId, true);
      return api.resource(requireName(params));
    });

    ctx.actions.register("ask", async (params, context) => {
      const { api } = await apiFor(requireCompany(params, context.companyId), true);
      const q = str(params, "question");
      if (!q) throw new Error("Ask a question first.");
      return api.ask(q.slice(0, 1000));
    });

    ctx.actions.register("research", async (params, context) => {
      const { api } = await apiFor(requireCompany(params, context.companyId), true);
      const topic = str(params, "topic");
      const category = str(params, "category");
      if (!topic && !category) throw new Error("Give a topic or pick a category.");
      return api.research({ ...(topic ? { topic } : {}), ...(category ? { category } : {}) });
    });

    // "Add to workspace": shortlist it, and give the Kinly agent an issue with the container-only test protocol (D16).
    ctx.actions.register("add-to-workspace", async (params, context) => {
      const companyId = requireCompany(params, context.companyId);
      const name = requireName(params);
      const { api } = await apiFor(companyId, true);
      const bench = await api.shortlist();
      const already = bench.items.find((i) => i.full_name === name);
      if (!already || (already.status !== "shortlisted" && already.status !== "testing")) {
        if (bench.wip >= bench.wip_limit) throw new Error(`The testing bench is full (${bench.wip}/${bench.wip_limit}). Rate or drop one first.`);
        await api.setShortlist(name, "shortlisted", "added to a workspace from the Kinly console");
      }
      const card = await api.repo(name);
      const agent = await ctx.agents.managed.reconcile("kinly", companyId);
      const issue = testIssue(name, repoCard(card));
      const created = await ctx.issues.create({
        companyId,
        title: issue.title,
        description: issue.description,
        status: "todo",
        originKind: "plugin:vantik.kinly:test",
        originId: `test-${name}`,
        ...(agent.agentId ? { assigneeAgentId: agent.agentId } : {}),
      });
      await ctx.activity.log({ companyId, message: `Kinly: ${name} added to the testing bench`, entityType: "issue", entityId: created.id, metadata: { fullName: name } });
      return { issueId: created.id, identifier: (created as { identifier?: string }).identifier ?? null, agentId: agent.agentId, agentStatus: agent.agent?.status ?? agent.status };
    });

    ctx.actions.register("reconcile", async (params, context) => reconcileCompany(requireCompany(params, context.companyId)));

    // ─── agent tools ─────────────────────────────────────────────────────────
    for (const decl of TOOL_DECLARATIONS) {
      ctx.tools.register(decl.name, { displayName: decl.displayName, description: decl.description, parametersSchema: decl.parametersSchema }, async (params, run) => {
        try {
          const { api } = await apiFor(run.companyId, WRITE_TOOLS.has(decl.name));
          return await runTool(decl.name, params, api, { agentId: run.agentId });
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      });
    }

    // ─── jobs ────────────────────────────────────────────────────────────────
    ctx.jobs.register("daily-brief", async (job) => {
      const companies = await ctx.companies.list({ limit: 100 });
      for (const company of companies) {
        try {
          const config = await configFor(company.id);
          if (!config.enabled || !config.dailyBrief) continue;
          const api = new KinlyApi({ baseUrl: config.apiUrl });
          const report = await api.latestReport("daily");
          const content = buildBrief({ date: report.id, reportId: report.id, markdown: report.markdown, focus: config.focus, apiUrl: config.apiUrl });
          const res = await upsertBrief(ctx.issues as unknown as BriefIssues, company.id, report.id, content, config.briefAssigneeAgentId);
          ctx.logger.info("kinly: brief", { companyId: company.id, date: report.id, ...res, trigger: job.trigger });
        } catch (err) {
          ctx.logger.warn("kinly: brief failed", { companyId: company.id, error: err instanceof Error ? err.message : String(err) });
        }
      }
    });

    ctx.jobs.register("reconcile", async () => {
      await reconcileAll();
    });

    // Reconcile at start, without holding up setup.
    void reconcileAll().catch((err) => ctx.logger.warn("kinly: reconcile at start failed", { error: String(err) }));
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
