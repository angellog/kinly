import type { CategoryId, RepoRecord } from "../types.js";

/**
 * Rule-based classification. Each rule is a weighted pattern over a text
 * built from the repo's name, description, topics and the first lines of the
 * README. Topics count more than prose (a topic is the author's own label).
 * The winning category needs a minimum score; otherwise "other".
 */

export interface CategoryRule {
  category: CategoryId;
  /** Patterns matched against topics (exact topic slug match, weight x3). */
  topics: string[];
  /** Regexes matched against name + description + readme head (weight x1 each hit). */
  text: RegExp[];
  weight?: number;
}

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  "ai-agents": "AI agents & coding assistants",
  "mcp-tools": "MCP, skills & agent tooling",
  "llm-infra": "LLM infrastructure (inference, RAG, memory)",
  "design-ui": "Design, UI & frontend",
  "content-media": "Content, video, image & voice",
  "automation-workflow": "Automation, scraping & workflows",
  "social-marketing": "Social, marketing & growth",
  "business-ops": "Business operations (CRM, finance, email, commerce)",
  "data-analytics": "Data, analytics & databases",
  devtools: "Developer tools",
  "infra-devops": "Infrastructure, DevOps & self-hosting",
  security: "Security",
  "learning-reference": "Learning, reference & awesome lists",
  "web-mobile": "Web & mobile frameworks",
  "systems-languages": "Systems, languages & low-level",
  other: "Other",
};

export const RULES: CategoryRule[] = [
  {
    category: "mcp-tools",
    topics: ["mcp", "mcp-server", "mcp-servers", "model-context-protocol", "agent-skills", "claude-code", "claude-skills", "skills", "cursor-rules", "codex", "claude-code-plugin", "claude-code-skills", "subagents", "agentic-coding-skills"],
    text: [/\bmcp\b/i, /model context protocol/i, /\bskills?\b.*\b(agent|claude|codex|cursor)/i, /\b(claude|codex|cursor|copilot|gemini[- ]cli)\b.*\b(skill|plugin|rule|hook|subagent|command)s?\b/i, /\.agents?\b directory/i, /\bagent skills?\b/i, /\bskills? for (ai )?(coding )?agents?\b/i],
    weight: 1.2,
  },
  {
    category: "ai-agents",
    topics: ["ai-agents", "ai-agent", "agents", "agent", "agentic-ai", "llm-agent", "autonomous-agents", "multi-agent", "coding-agent", "ai-coding", "computer-use", "browser-agent", "agent-framework", "openclaw", "claude", "anthropic", "openai", "gemini", "copilot", "agentic"],
    text: [/\bagents?\b/i, /agentic/i, /\bcod(e|ing) (assistant|agent|tool)s?\b/i, /\b(ai|agentic) coding\b/i, /autonomous/i, /computer[- ]use/i, /multi-?agent/i, /orchestrat/i, /\bharness\b/i, /ai (pair|software) engineer/i],
  },
  {
    category: "llm-infra",
    topics: ["llm", "llms", "inference", "rag", "vector-database", "embeddings", "fine-tuning", "llama", "local-llm", "ollama", "transformers", "model-serving", "llm-inference", "retrieval-augmented-generation", "memory", "knowledge-graph", "llmops", "prompt-engineering", "deep-learning", "machine-learning", "pytorch", "diffusion"],
    text: [/\bllms?\b/i, /inference (engine|server)/i, /\brag\b/i, /retrieval[- ]augmented/i, /embedding/i, /vector (db|database|store|search)/i, /fine-?tun/i, /quantiz/i, /run (llms?|models) locally/i, /large language model/i, /\bgguf\b/i, /context (window|engineering)/i, /persistent (memory|context)/i],
  },
  {
    category: "design-ui",
    topics: ["ui", "ux", "design", "design-system", "components", "component-library", "react-components", "tailwind", "tailwindcss", "shadcn", "shadcn-ui", "figma", "icons", "animation", "motion", "css", "frontend", "ui-components", "design-to-code", "ui-design", "landing-page", "template", "templates", "diagram", "svg", "typography", "fonts"],
    text: [/\bui\b/i, /\bux\b/i, /design system/i, /component(s| library)/i, /tailwind/i, /shadcn/i, /figma/i, /icon (set|pack|library)/i, /animation/i, /landing page/i, /design(?:ed|er)? (tool|agent|skill)/i, /diagram/i, /wireframe|mockup|prototype/i, /\bfonts?\b/i, /beautiful|pixel-perfect|aesthetic/i],
  },
  {
    category: "content-media",
    topics: ["video", "video-generation", "video-editing", "image-generation", "text-to-speech", "tts", "speech", "voice", "voice-cloning", "audio", "music", "stable-diffusion", "comfyui", "ffmpeg", "podcast", "subtitles", "transcription", "whisper", "image", "photo", "remotion", "slides", "presentation", "pdf", "ocr", "document-processing", "markdown"],
    text: [/\bvideo\b/i, /text[- ]to[- ](speech|video|image|3d)/i, /\btts\b/i, /voice (clon|assistant|agent|chat)/i, /image (gen|edit|upscal)/i, /\b(audio|music|podcast)\b/i, /transcri/i, /subtitle|caption/i, /\bocr\b/i, /pdf/i, /slides?|presentation|carousel/i, /document (convert|parsing|processing|extraction)/i, /\bffmpeg\b/i],
  },
  {
    category: "automation-workflow",
    topics: ["automation", "workflow", "workflow-automation", "n8n", "zapier", "scraping", "web-scraping", "scraper", "crawler", "crawling", "browser-automation", "playwright", "puppeteer", "selenium", "rpa", "no-code", "low-code", "bot", "cron", "task-automation"],
    text: [/workflow/i, /automat/i, /\b(scrap|crawl)(e|er|ing)\b/i, /browser automation/i, /headless/i, /\brpa\b/i, /no-?code|low-?code/i, /zapier|n8n|make\.com/i, /pipeline/i],
  },
  {
    category: "social-marketing",
    topics: ["instagram", "tiktok", "twitter", "x", "linkedin", "youtube", "social-media", "marketing", "seo", "growth", "newsletter", "telegram", "whatsapp", "discord", "whatsapp-bot", "telegram-bot", "content-creation", "influencer", "ads", "advertising", "creator"],
    text: [/instagram|tiktok|linkedin|youtube|twitter|threads\b/i, /social media/i, /\bseo\b/i, /marketing/i, /newsletter/i, /whatsapp|telegram|discord/i, /creator (economy|tool)/i, /influencer/i, /\bads?\b.*(campaign|manager)/i, /schedul(e|ing) posts?/i],
  },
  {
    category: "business-ops",
    topics: ["crm", "erp", "ecommerce", "e-commerce", "shop", "payments", "invoice", "invoicing", "accounting", "finance", "email", "email-marketing", "customer-support", "helpdesk", "booking", "scheduling", "saas", "startup", "hr", "project-management", "notion", "knowledge-base", "wiki", "notes", "note-taking", "productivity", "calendar"],
    text: [/\bcrm\b/i, /\berp\b/i, /e-?commerce|storefront|shopify/i, /invoice|accounting|bookkeeping|payroll/i, /payment/i, /customer (support|service|success)/i, /help ?desk|ticketing/i, /\bemail\b/i, /knowledge (base|management)/i, /note[- ]taking|second brain/i, /project management|kanban/i, /\bsaas\b/i, /booking|appointment/i],
  },
  {
    category: "data-analytics",
    topics: ["data", "analytics", "database", "sql", "postgres", "postgresql", "sqlite", "duckdb", "spreadsheet", "dashboard", "bi", "business-intelligence", "etl", "data-engineering", "data-science", "jupyter", "pandas", "visualization", "charts", "observability-data", "warehouse", "lakehouse", "dataframe"],
    text: [/analytics/i, /\bdatabase\b/i, /\bsql\b/i, /postgres|sqlite|duckdb|clickhouse/i, /spreadsheet/i, /dashboard/i, /\betl\b|data pipeline|data engineering/i, /data science/i, /visuali[sz]ation|charts?\b/i, /dataframe|pandas|polars/i, /business intelligence/i],
  },
  {
    category: "devtools",
    topics: ["cli", "developer-tools", "devtools", "terminal", "editor", "vscode", "neovim", "git", "testing", "linter", "formatter", "build-tool", "bundler", "package-manager", "debugger", "api", "sdk", "typescript", "code-review", "documentation", "shell", "zsh", "tui", "ide"],
    text: [/\bcli\b/i, /command[- ]line/i, /terminal/i, /\beditor\b/i, /\bide\b/i, /vscode|neovim|vim\b/i, /\bgit\b/i, /test(ing)? framework|e2e|end-to-end/i, /linter|formatter/i, /bundler|build (tool|system)/i, /package manager/i, /debugger/i, /\bsdk\b/i, /\bapi (client|gateway|toolkit)\b/i, /code review/i, /developer (tool|experience|productivity)/i],
  },
  {
    category: "infra-devops",
    topics: ["devops", "kubernetes", "docker", "self-hosted", "selfhosted", "self-hosting", "homelab", "deployment", "paas", "serverless", "cloud", "infrastructure", "iac", "terraform", "monitoring", "observability", "logging", "proxy", "reverse-proxy", "networking", "vpn", "nginx", "caddy", "ci-cd", "github-actions", "backup", "sandbox", "containers"],
    text: [/kubernetes|k8s/i, /\bdocker\b|container/i, /self-?host/i, /homelab/i, /deploy(ment)? (platform|tool)/i, /\bpaas\b/i, /serverless/i, /infrastructure/i, /terraform|pulumi|ansible/i, /monitoring|observability|telemetry|metrics/i, /reverse proxy|load balanc/i, /\bvpn\b|tunnel|wireguard/i, /ci\/cd|github actions/i, /sandbox/i, /\bvm\b|virtual machine|hypervisor/i],
  },
  {
    category: "security",
    topics: ["security", "cybersecurity", "pentesting", "penetration-testing", "osint", "vulnerability", "secrets", "authentication", "auth", "oauth", "sso", "encryption", "privacy", "malware", "ctf", "hacking", "red-team", "blue-team", "sast", "scanner", "firewall", "zero-trust"],
    text: [/securit/i, /pentest|penetration test/i, /\bosint\b/i, /vulnerab/i, /secret(s)? (scan|detect|manage)/i, /authenticat|authoriz|\boauth\b|\bsso\b/i, /encrypt/i, /privacy/i, /malware|exploit|threat (intel|detect)/i, /\bctf\b/i, /hack(ing|er)\b/i, /red team|blue team/i, /firewall|zero[- ]trust|waf\b/i, /audit/i],
  },
  {
    category: "learning-reference",
    topics: ["awesome", "awesome-list", "list", "lists", "curated", "resources", "tutorial", "tutorials", "course", "courses", "learning", "education", "interview", "interview-preparation", "roadmap", "cheatsheet", "book", "books", "guide", "handbook", "system-design", "algorithms", "leetcode", "papers", "research"],
    text: [/\bawesome\b/i, /curated (list|collection)/i, /\blist of\b/i, /tutorial/i, /\bcourse\b/i, /learn(ing)? (path|resource|guide)/i, /interview/i, /roadmap/i, /cheat ?sheet/i, /\bbook\b|handbook/i, /system design/i, /algorithms?\b|leetcode/i, /\bpapers?\b/i, /collection of/i, /everything you need to know/i],
  },
  {
    category: "web-mobile",
    topics: ["react", "nextjs", "next", "vue", "nuxt", "svelte", "sveltekit", "angular", "astro", "remix", "solid", "web-framework", "framework", "mobile", "ios", "android", "flutter", "react-native", "expo", "swift", "swiftui", "kotlin", "pwa", "electron", "tauri", "desktop", "webapp", "web"],
    text: [/\breact\b|next\.?js|vue|nuxt|svelte|angular|astro\b/i, /web framework/i, /\bmobile\b|ios\b|android\b/i, /flutter|react native|expo\b/i, /swiftui|\bswift\b/i, /\bpwa\b/i, /electron|tauri/i, /desktop app/i, /full-?stack/i, /\bssr\b|server components/i],
  },
  {
    category: "systems-languages",
    topics: ["rust", "go", "golang", "c", "cpp", "c-plus-plus", "zig", "compiler", "programming-language", "language", "interpreter", "runtime", "os", "operating-system", "kernel", "embedded", "wasm", "webassembly", "gpu", "cuda", "performance", "low-level", "emulator", "virtualization", "game-engine", "gamedev", "graphics", "3d"],
    text: [/compiler|interpreter/i, /programming language/i, /runtime/i, /operating system|\bkernel\b/i, /embedded|firmware|microcontroller/i, /webassembly|\bwasm\b/i, /\bgpu\b|cuda|shader/i, /blazing(ly)? fast|high[- ]performance|zero[- ]cost/i, /emulator|port(ing)? (to|of)/i, /game (engine|dev)/i, /3d (engine|render)/i, /\bdebugger\b/i, /written in (rust|zig|c\+\+|c\b)/i],
    weight: 0.9,
  },
];

export interface Classification {
  category: CategoryId;
  score: number;
  runner_up: CategoryId | null;
  runner_up_score: number;
}

export function classifyRepo(repo: Pick<RepoRecord, "full_name" | "description" | "topics" | "readme_excerpt" | "language">): Classification {
  const topics = new Set(repo.topics.map((t) => t.toLowerCase()));
  const text = [repo.full_name.replace(/[-_/]/g, " "), repo.description ?? "", (repo.readme_excerpt ?? "").slice(0, 1200)].join("\n");
  const scores = new Map<CategoryId, number>();
  for (const rule of RULES) {
    let s = 0;
    for (const t of rule.topics) if (topics.has(t)) s += 3;
    for (const re of rule.text) if (re.test(text)) s += 1;
    s *= rule.weight ?? 1;
    scores.set(rule.category, s);
  }
  // Language hints for systems categories when nothing else speaks.
  const lang = (repo.language ?? "").toLowerCase();
  if (["rust", "c", "c++", "zig", "go", "assembly"].includes(lang)) scores.set("systems-languages", (scores.get("systems-languages") ?? 0) + 0.5);
  if (["swift", "kotlin", "dart", "objective-c"].includes(lang)) scores.set("web-mobile", (scores.get("web-mobile") ?? 0) + 1);
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const second = ranked[1];
  if (!top || top[1] < 2) return { category: "other", score: top?.[1] ?? 0, runner_up: null, runner_up_score: 0 };
  return { category: top[0], score: top[1], runner_up: second?.[0] ?? null, runner_up_score: second?.[1] ?? 0 };
}
