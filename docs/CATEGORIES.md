# Categories

Each repository gets exactly one of 16 categories. Rule tables score topics (+3 each) and text patterns (+1 each) in the name, description and the first 1,200 characters of the README. The highest score wins if it reaches 2; otherwise the category is `other`. An LLM pass may refine the category, and the owner's choice always wins. The rules live in `packages/engine/src/classify/rules.ts` and are tested on 58 real repositories, which must agree at least 90% of the time.

| Id | Label | Typical repositories |
|---|---|---|
| `ai-agents` | AI agents & coding assistants | Claude Code, Codex CLI, Gemini CLI, OpenHands, crewAI, browser-use |
| `mcp-tools` | MCP, skills & agent tooling | MCP servers and clients, agent skills, Claude Code plugins, subagents, cursor rules |
| `llm-infra` | LLM infrastructure | vLLM, Ollama, llama.cpp, Unsloth, mem0, RAGFlow |
| `design-ui` | Design, UI & frontend | shadcn/ui, Lucide, Excalidraw, Motion, design-to-code |
| `content-media` | Content, video, image & voice | Remotion, ComfyUI, Whisper, MarkItDown, OCR, TTS, yt-dlp |
| `automation-workflow` | Automation, scraping & workflows | n8n, Firecrawl, Crawl4AI, RPA, browser automation |
| `social-marketing` | Social, marketing & growth | Postiz, Instagram, TikTok and WhatsApp tooling, SEO, newsletters |
| `business-ops` | Business operations | Twenty CRM, Invoice Ninja, Medusa, Chatwoot, booking |
| `data-analytics` | Data, analytics & databases | DuckDB, Metabase, Supabase, ETL, dashboards |
| `devtools` | Developer tools | lazygit, VS Code, Biome, CLIs, SDKs, testing |
| `infra-devops` | Infrastructure, DevOps & self-hosting | Caddy, Coolify, Uptime Kuma, OpenTelemetry, sandboxes |
| `security` | Security | gitleaks, Trivy, SpiderFoot, pentest kits |
| `learning-reference` | Learning, reference & awesome lists | awesome lists, roadmaps, interview prep, courses |
| `web-mobile` | Web & mobile frameworks | Next.js, Flutter, Tauri, React Native |
| `systems-languages` | Systems, languages & low-level | Go, Zig, the Linux kernel, compilers, emulators |
| `other` | Other | Anything below the threshold |

## Owner weights

Each category has a weight from 0 to 1 for how much it matters to the owner. The weight is half the default below and half the share of the owner's GitHub stars in that category, scaled so the most-starred category is 1. The daily report shows only categories weighted 0.5 or more. The weekly report shows all 16.

The default weights are:

| Weight | Categories |
|---|---|
| 1.0 | `ai-agents`, `mcp-tools` |
| 0.95 | `content-media`, `social-marketing` |
| 0.9 | `design-ui`, `automation-workflow` |
| 0.75 | `llm-infra` |
| 0.7 | `business-ops` |
| 0.6 | `devtools` |
| 0.55 | `data-analytics` |
| 0.5 | `web-mobile` |
| 0.45 | `infra-devops` |
| 0.35 | `learning-reference` |
| 0.3 | `security` |
| 0.2 | `systems-languages`, `other` |
