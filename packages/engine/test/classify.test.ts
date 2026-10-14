import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CATEGORY_LABELS, classifyRepo } from "../src/classify/rules.js";
import { CATEGORY_IDS, type CategoryId } from "../src/types.js";

/**
 * Real repositories with their GitHub description, topics and language as
 * published, and the category a human reader would file them under. The
 * classifier must agree on at least 90% of them; the list also pins a set
 * of must-pass cases where a wrong answer would mislead a report.
 */
interface Case {
  name: string;
  description: string;
  topics?: string[];
  language?: string;
  expect: CategoryId;
  mustPass?: boolean;
}

const CASES: Case[] = [
  { name: "modelcontextprotocol/servers", description: "Model Context Protocol Servers", topics: ["mcp"], language: "TypeScript", expect: "mcp-tools", mustPass: true },
  { name: "anthropics/skills", description: "Public repository for Agent Skills", topics: ["agent-skills", "claude"], expect: "mcp-tools", mustPass: true },
  { name: "github/github-mcp-server", description: "GitHub's official MCP Server", topics: ["mcp", "mcp-server"], language: "Go", expect: "mcp-tools", mustPass: true },
  { name: "microsoft/playwright-mcp", description: "Playwright MCP server", topics: ["mcp", "playwright"], language: "TypeScript", expect: "mcp-tools" },
  { name: "anthropics/claude-code", description: "Claude Code is an agentic coding tool that lives in your terminal, understands your codebase, and helps you code faster", language: "Shell", expect: "ai-agents", mustPass: true },
  { name: "openai/codex", description: "Lightweight coding agent that runs in your terminal", language: "Rust", expect: "ai-agents", mustPass: true },
  { name: "google-gemini/gemini-cli", description: "An open-source AI agent that brings the power of Gemini directly into your terminal.", topics: ["gemini", "ai-agents"], language: "TypeScript", expect: "ai-agents" },
  { name: "browser-use/browser-use", description: "Make websites accessible for AI agents. Automate tasks online with ease.", topics: ["ai-agents", "browser-automation", "playwright"], language: "Python", expect: "ai-agents" },
  { name: "crewAIInc/crewAI", description: "Framework for orchestrating role-playing, autonomous AI agents.", topics: ["agents", "ai-agents", "multi-agent"], language: "Python", expect: "ai-agents", mustPass: true },
  { name: "All-Hands-AI/OpenHands", description: "OpenHands: Code Less, Make More", topics: ["agent", "ai-coding", "coding-agent"], language: "Python", expect: "ai-agents" },
  { name: "vllm-project/vllm", description: "A high-throughput and memory-efficient inference and serving engine for LLMs", topics: ["inference", "llm", "model-serving"], language: "Python", expect: "llm-infra", mustPass: true },
  { name: "ollama/ollama", description: "Get up and running with Kimi, GLM, MiniMax, DeepSeek, gpt-oss, Qwen, Gemma and other models.", topics: ["llm", "llama", "ollama", "local-llm"], language: "Go", expect: "llm-infra", mustPass: true },
  { name: "ggml-org/llama.cpp", description: "LLM inference in C/C++", topics: ["llama", "gguf", "inference"], language: "C++", expect: "llm-infra" },
  { name: "unslothai/unsloth", description: "Fine-tuning & Reinforcement Learning for LLMs. Train OpenAI gpt-oss, DeepSeek, Qwen, Llama, Gemma 2x faster with 70% less VRAM.", topics: ["fine-tuning", "llm"], language: "Python", expect: "llm-infra" },
  { name: "mem0ai/mem0", description: "Universal memory layer for AI Agents", topics: ["memory", "rag", "llm"], language: "Python", expect: "llm-infra" },
  { name: "infiniflow/ragflow", description: "RAGFlow is a leading open-source Retrieval-Augmented Generation (RAG) engine", topics: ["rag", "retrieval-augmented-generation", "llm"], language: "Python", expect: "llm-infra" },
  { name: "shadcn-ui/ui", description: "A set of beautifully-designed, accessible components and a code distribution platform.", topics: ["components", "tailwindcss", "ui", "shadcn"], language: "TypeScript", expect: "design-ui", mustPass: true },
  { name: "lucide-icons/lucide", description: "Beautiful & consistent icon toolkit made by the community.", topics: ["icons", "svg"], language: "TypeScript", expect: "design-ui" },
  { name: "excalidraw/excalidraw", description: "Virtual whiteboard for sketching hand-drawn like diagrams", topics: ["diagram", "whiteboard"], language: "TypeScript", expect: "design-ui" },
  { name: "motiondivision/motion", description: "A modern animation library for React and JavaScript", topics: ["animation", "motion", "react"], language: "TypeScript", expect: "design-ui" },
  { name: "remotion-dev/remotion", description: "Make videos programmatically with React", topics: ["video", "remotion", "react"], language: "TypeScript", expect: "content-media", mustPass: true },
  { name: "microsoft/markitdown", description: "Python tool for converting files and office documents to Markdown.", topics: ["markdown", "pdf"], language: "Python", expect: "content-media" },
  { name: "allenai/olmocr", description: "Toolkit for linearizing PDFs for LLM datasets/training", topics: ["ocr", "pdf"], language: "Python", expect: "content-media" },
  { name: "comfyanonymous/ComfyUI", description: "The most powerful and modular diffusion model GUI, api and backend with a graph/nodes interface.", topics: ["stable-diffusion", "comfyui"], language: "Python", expect: "content-media" },
  { name: "openai/whisper", description: "Robust Speech Recognition via Large-Scale Weak Supervision", topics: ["speech", "whisper"], language: "Python", expect: "content-media" },
  { name: "n8n-io/n8n", description: "Fair-code workflow automation platform with native AI capabilities.", topics: ["automation", "workflow", "n8n", "low-code"], language: "TypeScript", expect: "automation-workflow", mustPass: true },
  { name: "unclecode/crawl4ai", description: "Open-source LLM Friendly Web Crawler & Scraper.", topics: ["crawler", "scraper", "web-scraping"], language: "Python", expect: "automation-workflow" },
  { name: "mendableai/firecrawl", description: "Turn entire websites into LLM-ready markdown or structured data. Scrape, crawl and extract with a single API.", topics: ["scraping", "crawler", "web-scraping"], language: "TypeScript", expect: "automation-workflow" },
  { name: "gitroomhq/postiz-app", description: "The ultimate social media scheduling tool, with a bunch of AI", topics: ["social-media", "instagram", "linkedin", "marketing"], language: "TypeScript", expect: "social-marketing", mustPass: true },
  { name: "yt-dlp/yt-dlp", description: "A feature-rich command-line audio/video downloader", topics: ["youtube", "video", "downloader"], language: "Python", expect: "content-media" },
  { name: "twentyhq/twenty", description: "Building a modern alternative to Salesforce, powered by the community.", topics: ["crm", "open-source"], language: "TypeScript", expect: "business-ops", mustPass: true },
  { name: "invoiceninja/invoiceninja", description: "Invoices, Expenses and Tasks built with Laravel", topics: ["invoice", "invoicing", "accounting"], language: "PHP", expect: "business-ops" },
  { name: "medusajs/medusa", description: "The world's most flexible commerce platform.", topics: ["ecommerce", "e-commerce"], language: "TypeScript", expect: "business-ops" },
  { name: "chatwoot/chatwoot", description: "Open-source live-chat, email support, omni-channel desk. An alternative to Intercom, Zendesk, Salesforce Service Cloud etc.", topics: ["customer-support", "helpdesk", "crm"], language: "Ruby", expect: "business-ops" },
  { name: "duckdb/duckdb", description: "DuckDB is an analytical in-process SQL database management system", topics: ["database", "sql", "analytics"], language: "C++", expect: "data-analytics", mustPass: true },
  { name: "metabase/metabase", description: "The easy-to-use open source Business Intelligence and Embedded Analytics tool that lets everyone work with data", topics: ["analytics", "business-intelligence", "dashboard"], language: "Clojure", expect: "data-analytics" },
  { name: "supabase/supabase", description: "The Postgres development platform. Supabase gives you a dedicated Postgres database to build your web, mobile, and AI applications.", topics: ["postgres", "database"], language: "TypeScript", expect: "data-analytics" },
  { name: "jesseduffield/lazygit", description: "simple terminal UI for git commands", topics: ["git", "terminal", "cli", "tui"], language: "Go", expect: "devtools", mustPass: true },
  { name: "spf13/cobra", description: "A Commander for modern Go CLI interactions", topics: ["cli", "go"], language: "Go", expect: "devtools" },
  { name: "microsoft/vscode", description: "Visual Studio Code", topics: ["editor", "vscode", "ide"], language: "TypeScript", expect: "devtools" },
  { name: "biomejs/biome", description: "A toolchain for web projects, aimed to provide functionalities to maintain them. Biome offers formatter and linter, usable via CLI and LSP.", topics: ["formatter", "linter"], language: "Rust", expect: "devtools" },
  { name: "caddyserver/caddy", description: "Fast and extensible multi-platform HTTP/1-2-3 web server with automatic HTTPS", topics: ["reverse-proxy", "caddy"], language: "Go", expect: "infra-devops", mustPass: true },
  { name: "coollabsio/coolify", description: "An open-source & self-hostable Heroku / Netlify / Vercel alternative.", topics: ["self-hosted", "paas", "docker", "deployment"], language: "PHP", expect: "infra-devops" },
  { name: "louislam/uptime-kuma", description: "A fancy self-hosted monitoring tool", topics: ["monitoring", "self-hosted", "docker"], language: "JavaScript", expect: "infra-devops" },
  { name: "open-telemetry/opentelemetry-collector-contrib", description: "Contrib repository for the OpenTelemetry Collector", topics: ["observability", "telemetry"], language: "Go", expect: "infra-devops" },
  { name: "gitleaks/gitleaks", description: "Find secrets with Gitleaks", topics: ["security", "secrets", "scanner"], language: "Go", expect: "security", mustPass: true },
  { name: "aquasecurity/trivy", description: "Find vulnerabilities, misconfigurations, secrets, SBOM in containers, Kubernetes, code repositories, clouds and more", topics: ["security", "vulnerability", "scanner"], language: "Go", expect: "security" },
  { name: "smicallef/spiderfoot", description: "SpiderFoot automates OSINT for threat intelligence and mapping your attack surface.", topics: ["osint", "security"], language: "Python", expect: "security", mustPass: true },
  // H13: a geospatial globe tagged `osint` is a map, not a security tool (Kinly misfiled it, VAN-66).
  { name: "bilawalsidhu/gods-eye-view", description: "A spy satellite simulator in your browser, except the data is real. Live open source spatial intelligence on a photorealistic 3D globe.", topics: ["3d-globe", "cesium", "flight-tracking", "geospatial", "geospatial-intelligence", "gis", "osint", "photogrammetry", "satellite-tracking", "spatial-intelligence", "webgl", "worldview"], language: "JavaScript", expect: "data-analytics", mustPass: true },
  { name: "Z4nzu/hackingtool", description: "ALL IN ONE Hacking Tool For Hackers", topics: ["hacking", "pentesting"], language: "Python", expect: "security" },
  { name: "sindresorhus/awesome", description: "Awesome lists about all kinds of interesting topics", topics: ["awesome", "awesome-list", "lists"], expect: "learning-reference", mustPass: true },
  { name: "donnemartin/system-design-primer", description: "Learn how to design large-scale systems. Prep for the system design interview.", topics: ["system-design", "interview"], language: "Python", expect: "learning-reference" },
  { name: "kamranahmedse/developer-roadmap", description: "Interactive roadmaps, guides and other educational content to help developers grow in their careers.", topics: ["roadmap", "learning"], language: "TypeScript", expect: "learning-reference" },
  { name: "vercel/next.js", description: "The React Framework", topics: ["react", "nextjs", "framework"], language: "JavaScript", expect: "web-mobile", mustPass: true },
  { name: "flutter/flutter", description: "Flutter makes it easy and fast to build beautiful apps for mobile and beyond", topics: ["flutter", "mobile", "android", "ios"], language: "Dart", expect: "web-mobile" },
  { name: "tauri-apps/tauri", description: "Build smaller, faster, and more secure desktop and mobile applications with a web frontend.", topics: ["tauri", "desktop", "rust"], language: "Rust", expect: "web-mobile" },
  { name: "golang/go", description: "The Go programming language", topics: ["go", "golang", "programming-language"], language: "Go", expect: "systems-languages", mustPass: true },
  { name: "ziglang/zig", description: "General-purpose programming language and toolchain for maintaining robust, optimal, and reusable software.", topics: ["zig", "compiler", "programming-language"], language: "Zig", expect: "systems-languages" },
  { name: "torvalds/linux", description: "Linux kernel source tree", topics: [], language: "C", expect: "systems-languages" },
  // Regressions found in the 2026-10-12 hand check of the top 100 (C3).
  { name: "WhiskeySockets/Baileys", description: "Socket-based TS/JavaScript API for WhatsApp Web", topics: ["whatsapp", "api", "typescript"], language: "TypeScript", expect: "social-marketing", mustPass: true },
  { name: "astral-sh/uv", description: "An extremely fast Python package and project manager, written in Rust.", topics: ["packaging", "python", "resolver", "uv"], language: "Rust", expect: "devtools" },
  { name: "google/googletest", description: "GoogleTest - Google Testing and Mocking Framework", topics: [], language: "C++", expect: "devtools" },
  { name: "envoyproxy/envoy", description: "Cloud-native high-performance edge/middle/service proxy", topics: ["cncf"], language: "C++", expect: "infra-devops" },
];

describe("classifier", () => {
  it(`has at least 40 labelled real repos (has ${CASES.length})`, () => {
    assert.ok(CASES.length >= 40);
  });

  it("covers every category except 'other'", () => {
    const covered = new Set(CASES.map((c) => c.expect));
    for (const id of CATEGORY_IDS) if (id !== "other") assert.ok(covered.has(id), `no case for ${id}`);
    for (const id of CATEGORY_IDS) assert.ok(CATEGORY_LABELS[id], `no label for ${id}`);
  });

  const results = CASES.map((c) => {
    const got = classifyRepo({ full_name: c.name, description: c.description, topics: c.topics ?? [], readme_excerpt: null, language: c.language ?? null });
    return { ...c, got: got.category };
  });

  for (const r of results.filter((x) => x.mustPass)) {
    it(`${r.name} → ${r.expect}`, () => assert.equal(r.got, r.expect));
  }

  it("agrees with the human label on at least 90% of cases", () => {
    const wrong = results.filter((r) => r.got !== r.expect);
    const rate = 1 - wrong.length / results.length;
    assert.ok(rate >= 0.9, `agreement ${(rate * 100).toFixed(1)}%; misses:\n${wrong.map((w) => `  ${w.name}: expected ${w.expect}, got ${w.got}`).join("\n")}`);
  });

  it("files a repo with no signal under 'other'", () => {
    assert.equal(classifyRepo({ full_name: "someone/thing", description: "my stuff", topics: [], readme_excerpt: null, language: null }).category, "other");
  });
});
