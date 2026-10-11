import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import type { Store } from "../store/store.js";
import { CATEGORY_IDS, type CategoryId, type Profile, type RepoRecord } from "../types.js";
import { isoDate } from "../util/dates.js";
import { sha256, squash, truncate } from "../util/text.js";

/**
 * The LLM layer: one place that talks to Claude. Everything degrades: when
 * there is no key, `available` is false and callers use heuristics.
 *
 * - Model: KINLY_LLM_MODEL (default claude-opus-5-5). Low effort for the
 *   short, structured write-ups; high effort for "ask".
 * - Budget: a per-UTC-day token cap recorded in the store (meta key
 *   `llm_tokens_<date>`), so an unattended run can never run away.
 * - Cache: summaries are keyed by the README hash; the caller re-summarizes
 *   only when `summary_hash != readme_hash`.
 */

export const DEFAULT_LLM_MODEL = "claude-opus-5-5";

const RepoSummarySchema = z.object({
  summary: z.string().describe("One or two plain sentences on what the repository does and for whom. No hype words, no exclamation marks."),
  business_use: z.string().describe("Two to four sentences on how this specific owner could use it in his business, naming the concrete workflow it would improve or replace. If it is not useful to him, say so plainly."),
  category: z.enum(CATEGORY_IDS).describe("The single best Kinly category."),
  caveats: z.string().describe("One sentence on licence, maturity or lock-in risk, or 'none'."),
});

export type RepoSummary = z.infer<typeof RepoSummarySchema>;

const AskSchema = z.object({
  answer: z.string().describe("The answer in plain prose, 80-250 words, naming repositories by owner/name."),
  repos: z.array(z.string()).describe("owner/name of every repository the answer relies on, from the context only."),
});

export interface LlmOptions {
  apiKey?: string | null;
  model?: string;
  dailyCapTokens?: number;
  store?: Store | null;
  client?: Anthropic | null;
  log?: (msg: string) => void;
}

export class Llm {
  readonly available: boolean;
  readonly model: string;
  readonly dailyCap: number;
  private readonly client: Anthropic | null;
  private readonly store: Store | null;
  private readonly log: (msg: string) => void;

  constructor(options: LlmOptions = {}) {
    const key = options.apiKey ?? process.env["ANTHROPIC_API_KEY"] ?? null;
    this.model = options.model ?? process.env["KINLY_LLM_MODEL"] ?? DEFAULT_LLM_MODEL;
    this.dailyCap = options.dailyCapTokens ?? Number.parseInt(process.env["KINLY_LLM_DAILY_CAP"] ?? "400000", 10);
    this.store = options.store ?? null;
    this.log = options.log ?? (() => undefined);
    if (options.client) {
      this.client = options.client;
      this.available = true;
    } else if (key && key.trim()) {
      this.client = new Anthropic({ apiKey: key.trim() });
      this.available = true;
    } else {
      this.client = null;
      this.available = false;
    }
  }

  private capKey(): string {
    return `llm_tokens_${isoDate()}`;
  }

  tokensUsedToday(): number {
    if (!this.store) return 0;
    return Number.parseInt(this.store.getMeta(this.capKey()) ?? "0", 10) || 0;
  }

  capReached(): boolean {
    return this.tokensUsedToday() >= this.dailyCap;
  }

  private record(usage: { input_tokens: number; output_tokens: number } | undefined): void {
    if (!this.store || !usage) return;
    const used = this.tokensUsedToday() + usage.input_tokens + usage.output_tokens;
    this.store.setMeta(this.capKey(), String(used));
  }

  /** Summarize one repo for the owner. Returns null when unavailable or capped. */
  async summarizeRepo(repo: RepoRecord, profile: Profile): Promise<RepoSummary | null> {
    if (!this.client || this.capReached()) return null;
    const context = [
      `Repository: ${repo.full_name}`,
      `Description: ${repo.description ?? "(none)"}`,
      `Language: ${repo.language ?? "(unknown)"} · Stars: ${repo.stars ?? "?"} · Licence: ${repo.license_spdx ?? repo.license_class}${repo.open_core ? " (open-core)" : ""}`,
      `Topics: ${repo.topics.join(", ") || "(none)"}`,
      `Created: ${repo.created_at ?? "?"} · Last push: ${repo.pushed_at ?? "?"}`,
      "",
      "README (excerpt):",
      truncate(repo.readme_excerpt ?? "", 3500) || "(no README)",
    ].join("\n");
    try {
      const response = await this.client.messages.parse({
        model: this.model,
        max_tokens: 1200,
        output_config: { effort: "low", format: zodOutputFormat(RepoSummarySchema) },
        system:
          "You are Kinly, a GitHub researcher for a specific business owner. You write in calm, concrete, commercially grounded prose. " +
          "Never use hype (no 'unlock', 'revolutionize', 'supercharge', 'cutting-edge', 'game-changing'). Lead with what changes for the business, not what the technology does. " +
          "If a repository is not useful to this owner, say so; a clear 'not for you' is more valuable than a stretched use case.\n\n" +
          `Owner context: ${profile.business_context}`,
        messages: [{ role: "user", content: `Summarize this repository for the owner.\n\n${context}` }],
      });
      this.record(response.usage);
      if (response.stop_reason === "refusal") {
        this.log(`llm refused summary for ${repo.full_name}`);
        return null;
      }
      return response.parsed_output ?? null;
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) this.log(`llm rate limited on ${repo.full_name}`);
      else if (err instanceof Anthropic.AuthenticationError) this.log("llm authentication failed: check ANTHROPIC_API_KEY");
      else if (err instanceof Anthropic.APIError) this.log(`llm api error ${err.status} on ${repo.full_name}: ${err.message}`);
      else this.log(`llm error on ${repo.full_name}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /** Answer a question using only the supplied context (repo cards). */
  async ask(question: string, contextCards: readonly string[], profile: Profile): Promise<{ answer: string; repos: string[] } | null> {
    if (!this.client || this.capReached()) return null;
    const context = contextCards.join("\n\n---\n\n");
    try {
      const response = await this.client.messages.parse({
        model: this.model,
        max_tokens: 2000,
        output_config: { effort: "medium", format: zodOutputFormat(AskSchema) },
        system:
          "You are Kinly, a GitHub researcher for a specific business owner. Answer from the context only; if the context does not contain the answer, say what is missing. " +
          "Calm, concrete, commercially grounded. No hype.\n\n" +
          `Owner context: ${profile.business_context}`,
        messages: [{ role: "user", content: `Question: ${squash(question)}\n\nContext (repository cards from the Kinly database):\n\n${truncate(context, 60_000)}` }],
      });
      this.record(response.usage);
      if (response.stop_reason === "refusal") return null;
      return response.parsed_output ?? null;
    } catch (err) {
      this.log(`llm ask error: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}

/** Keyless summary: the description, else the README's first sentence; business use from a category template. */
export function heuristicSummary(repo: RepoRecord): { summary: string; business_use: string; hash: string } {
  const readmeFirst = squash((repo.readme_excerpt ?? "").split(/(?<=[.!?])\s+/)[0] ?? "");
  const summary = squash(repo.description ?? "") || truncate(readmeFirst, 200) || `${repo.full_name} (no description yet).`;
  const templates: Record<CategoryId, string> = {
    "ai-agents": "Candidate for the Paperclip agent operation or a client-facing agent pilot; test whether it shortens a workflow you already run.",
    "mcp-tools": "Could plug straight into Claude Code or the Paperclip agents as a tool or skill; check what it gives an agent that it did not have.",
    "llm-infra": "Infrastructure for the agents and pipelines; relevant if it lowers cost, latency or lock-in for something already running.",
    "design-ui": "Could raise the visual bar of carousels, capture pages or the Paperclip plugin UI; test it on one real slide or page.",
    "content-media": "Candidate for the carousel, reel, voice or video pipeline; test it on one real asset.",
    "automation-workflow": "Could replace a manual step in the content or posting pipeline, or a scraping job; measure the minutes saved.",
    "social-marketing": "Touches Instagram, WhatsApp, Telegram or growth directly; relevant to both Vantik Systems and FeetBit.",
    "business-ops": "Back-office candidate (CRM, email, invoicing, knowledge); worth it only if it replaces a paid tool or a spreadsheet.",
    "data-analytics": "Useful for the KPI dashboard or content analytics; test it on the engagement ledger.",
    devtools: "Developer-experience gain; relevant if it speeds up the daily build loop.",
    "infra-devops": "Hosting and operations; relevant if it simplifies the Railway or self-hosted footprint.",
    security: "Security hygiene; relevant for the client-facing services and stored tokens.",
    "learning-reference": "Reference material; mine it for carousel topics and client talking points rather than installing anything.",
    "web-mobile": "Framework or app layer; relevant for the capture page, Carousel Maker or a client prototype.",
    "systems-languages": "Low-level tooling; probably not a direct business fit, but may be a performance win for a pipeline step.",
    other: "No obvious fit yet; read the README before spending time on it.",
  };
  return { summary, business_use: templates[repo.category], hash: repo.readme_hash ?? sha256(summary) };
}
