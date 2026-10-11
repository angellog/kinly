import type { CategoryId, Profile, RepoRecord } from "../types.js";
import type { UserStar } from "../sources/stars.js";
import { isoNow } from "../util/dates.js";

/**
 * The relevance profile: what "relevant to Angelo's business" means, as data.
 * Built from static interests (Vantik Systems + FeetBit + the content
 * pipeline) and the topic frequencies of the owner's own stars.
 */

export const DEFAULT_CATEGORY_WEIGHTS: Record<CategoryId, number> = {
  "ai-agents": 1.0,
  "mcp-tools": 1.0,
  "llm-infra": 0.75,
  "design-ui": 0.9,
  "content-media": 0.95,
  "automation-workflow": 0.9,
  "social-marketing": 0.95,
  "business-ops": 0.7,
  "data-analytics": 0.55,
  devtools: 0.6,
  "infra-devops": 0.45,
  security: 0.3,
  "learning-reference": 0.35,
  "web-mobile": 0.5,
  "systems-languages": 0.2,
  other: 0.2,
};

export const DEFAULT_KEYWORDS: Record<string, number> = {
  instagram: 3,
  whatsapp: 3,
  carousel: 3,
  reel: 2,
  reels: 2,
  "short video": 2,
  "social media": 2,
  tiktok: 1.5,
  linkedin: 1.5,
  "claude code": 3,
  "claude": 1.5,
  "coding agent": 2,
  agent: 1,
  agents: 1,
  "multi-agent": 2,
  mcp: 2,
  skill: 1.5,
  skills: 1.5,
  "voice agent": 2.5,
  "text to speech": 2,
  tts: 1.5,
  "voice clone": 2,
  "video generation": 2,
  "image generation": 1.5,
  automation: 1.5,
  workflow: 1.5,
  scraping: 1.5,
  crawler: 1,
  "design system": 2,
  "ui": 1,
  tailwind: 1,
  shadcn: 1.5,
  remotion: 2,
  ffmpeg: 1,
  "lead generation": 2,
  crm: 1.5,
  newsletter: 1,
  "email": 1,
  ecommerce: 1.5,
  "e-commerce": 1.5,
  sneaker: 3,
  retail: 1.5,
  "self-hosted": 1,
  "open source": 0.5,
  telegram: 1.5,
  "ai transformation": 3,
  consulting: 1.5,
  advisory: 1.5,
  "knowledge base": 1,
  "second brain": 1.5,
  obsidian: 1.5,
  notion: 1,
  paperclip: 2,
};

export const DEFAULT_BUSINESS_CONTEXT =
  "Angelo (GitHub angellog) is a solo builder. He runs Vantik Systems, an AI transformation advisory selling to US/Canada mid-market decision-makers with an East-Africa SME secondary market, publishing Instagram carousels and reels and operating a Paperclip multi-agent company. He also runs FeetBit, a sneaker retail brand in Uganda selling through Instagram and WhatsApp. He builds content pipelines (carousels, reels, voice, video), Instagram automation, Telegram agents, and small SaaS tools, mostly in TypeScript and Python with Claude Code.";

/** Normalize a star-topic frequency map to 0..1 weights. */
export function starTopicWeights(stars: readonly UserStar[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const s of stars) for (const t of s.topics ?? []) counts.set(t.toLowerCase(), (counts.get(t.toLowerCase()) ?? 0) + 1);
  const max = Math.max(1, ...counts.values());
  const out: Record<string, number> = {};
  for (const [t, c] of counts) if (c >= 2) out[t] = Number((c / max).toFixed(3));
  return out;
}

/**
 * Category weights from what the owner actually stars (review P-M2): each
 * category's share of the stars, scaled so the most-starred category is 1.
 * Blended 50/50 with the defaults so business categories the owner rarely
 * stars (marketing, operations) keep a floor.
 */
export function starCategoryWeights(categories: readonly CategoryId[]): Partial<Record<CategoryId, number>> {
  if (categories.length === 0) return {};
  const counts = new Map<CategoryId, number>();
  for (const c of categories) if (c !== "other") counts.set(c, (counts.get(c) ?? 0) + 1);
  const max = Math.max(1, ...counts.values());
  const out: Partial<Record<CategoryId, number>> = {};
  for (const id of Object.keys(DEFAULT_CATEGORY_WEIGHTS) as CategoryId[]) {
    const derived = (counts.get(id) ?? 0) / max;
    out[id] = Number((0.5 * DEFAULT_CATEGORY_WEIGHTS[id] + 0.5 * derived).toFixed(2));
  }
  return out;
}

export function buildProfile(stars: readonly UserStar[], overrides: Partial<Profile> = {}, starCategories: readonly CategoryId[] = []): Profile {
  return {
    category_weights: { ...DEFAULT_CATEGORY_WEIGHTS, ...starCategoryWeights(starCategories), ...(overrides.category_weights ?? {}) },
    keywords: { ...DEFAULT_KEYWORDS, ...(overrides.keywords ?? {}) },
    star_topics: overrides.star_topics ?? starTopicWeights(stars),
    business_context: overrides.business_context ?? DEFAULT_BUSINESS_CONTEXT,
    generated_at: isoNow(),
  };
}

/**
 * Relevance 0..100: category weight (up to 45) + keyword hits (up to 35) +
 * star-topic overlap (up to 20).
 */
export function relevanceScore(repo: Pick<RepoRecord, "full_name" | "description" | "topics" | "category" | "readme_excerpt">, profile: Profile): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const cw = profile.category_weights[repo.category] ?? 0.3;
  const categoryPart = 45 * cw;
  if (cw >= 0.9) reasons.push(`category ${repo.category} is core`);
  const hay = `${repo.full_name.replace(/[-_/]/g, " ")} ${repo.description ?? ""} ${repo.topics.join(" ")} ${(repo.readme_excerpt ?? "").slice(0, 800)}`.toLowerCase();
  let kw = 0;
  const hits: string[] = [];
  for (const [k, w] of Object.entries(profile.keywords)) {
    const re = new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
    if (re.test(hay)) {
      kw += w;
      hits.push(k);
    }
  }
  const keywordPart = Math.min(35, kw * 5);
  if (hits.length) reasons.push(`keywords: ${hits.slice(0, 5).join(", ")}`);
  let st = 0;
  const topicHits: string[] = [];
  for (const t of repo.topics) {
    const w = profile.star_topics[t.toLowerCase()];
    if (w) {
      st += w;
      topicHits.push(t);
    }
  }
  const starPart = Math.min(20, st * 12);
  if (topicHits.length) reasons.push(`matches your stars: ${topicHits.slice(0, 4).join(", ")}`);
  const score = Math.round(Math.min(100, categoryPart + keywordPart + starPart));
  return { score, reasons };
}
