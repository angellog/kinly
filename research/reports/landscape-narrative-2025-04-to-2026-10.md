---
title: What trended on GitHub, 2025-04-01 to 2026-10-11
project: Kinly
prepared: 2026-10-12
readers: Angelo — Vantik Systems, FeetBit
claims_file: landscape-narrative.claims.json
---

# What trended on GitHub, April 2025 to October 2026

## Executive summary

I measured 98 repositories with GitHub's own star-history endpoint. The period splits in two. From April to September 2025 the growth was in tools: terminal coding agents from OpenAI, Google and Anthropic, plus the MCP servers that connect them to other software. From October 2025 it moved to what runs on top of those tools: skills packs, always-on personal agents, design rule-sets for agents, and memory layers. OpenClaw gained 200,805 stars in the 30 days from 2026-01-24, the largest burst in the sample, and March 2026 was the sample's busiest month. Local models grew in spikes tied to releases, not as one sustained wave. Security did not trend by stars, though npm and GitHub both changed their rules because of it. Anyone measuring trends should know three things. GitHub closed stargazer lists to outsiders from 2026-06-30. It added a weekly star-history endpoint on 2026-09-04. The Trending page stalled twice in the period and its ranking is not documented.

**Method.** For each repository I called `GET /repos/{owner}/{repo}` and `GET /repos/{owner}/{repo}/stargazers/history` on 2026-10-12. "Busiest 30 days" means the 30-day run with the most new stars between 2025-04-01 and 2026-10-11. All star counts are **as of 2026-10-12**. I chose the sample, so it shows what grew, not the full population. Star counts measure attention, not adoption.

---

## Wave 1 — Terminal coding agents

**Peak window:** April–July 2025 for the launches. opencode peaked later, in January 2026.

**Representative repositories**
- `openai/codex`: created 2025-04-13; its biggest day was 2025-04-16 (9,059 stars); 128,671 stars.
- `google-gemini/gemini-cli`: launched 2025-06-25 under Apache 2.0, with a free tier of 60 requests a minute and 1,000 a day. It took 17,854 stars on launch day and has 107,286.
- `anthropics/claude-code`: 150,230 stars. Its biggest day in the window, 2026-03-31 (9,658), was the day an npm source map exposed the CLI's code. Anthropic called it "a release packaging issue caused by human error".
- `anomalyco/opencode` (the API redirects `sst/opencode` here): 212,731 stars, with 47,528 of them in January 2026.
- `QwenLM/qwen-code` (28,424) · `charmbracelet/crush` (28,598).

**What changed for a business.** One operator can now write a spec and run coding work that used to need a contractor, and the tools are cheap enough to run on a schedule. A client's question moves from "can we build this" to "who reviews what the agent wrote".

**For you.** *Vantik:* the publishing pipeline already runs on Claude Code. Keep opencode (MIT, works with any model) tested as a fallback, so one vendor's outage or price change cannot stop the daily run. *FeetBit:* not for you.

**Licence cautions.** Claude Code is not open source. Its LICENSE.md reads "All rights reserved" under Anthropic's Commercial Terms. Crush uses the Functional Source License 1.1 with an MIT future grant, which is source-available, not open source.

## Wave 2 — Model Context Protocol servers

**Peak window:** April–September 2025.

**Representative repositories**
- `github/github-mcp-server`: busiest 30 days from 2025-04-04 (12,422); 33,523 stars.
- `upstash/context7`: busiest 30 days from 2025-04-20; 62,910 stars.
- `microsoft/playwright-mcp`: 38,032 stars.
- `ChromeDevTools/chrome-devtools-mcp`: created 2025-09-11, then 11,710 stars in the 30 days from 2025-09-23; 53,294 stars.
- `modelcontextprotocol/registry`: busiest 30 days from 2025-09-08.
- `modelcontextprotocol/servers`: 91,150 stars. Its busiest window is the first one in range, so the real peak probably came before April 2025.

On 2025-12-09 Anthropic gave MCP to the new Agentic AI Foundation under the Linux Foundation. OpenAI and Block co-founded it. Anthropic cited more than 10,000 active public MCP servers and 97M+ monthly SDK downloads.

**What changed for a business.** Software vendors began shipping an official way in for agents alongside their API. Integration became a buying question ("does the vendor ship an MCP server?") and a governance question ("who approved this connection?").

**For you.** *Vantik:* add "MCP coverage of your current software" to the SEE-stage readiness assessment. It shows a client quickly where an agent can act today without custom integration. *FeetBit:* not for you.

**Licence cautions.** `modelcontextprotocol/servers` is partway through a move from MIT to Apache-2.0, so older contributions can still be MIT.

## Wave 3 — Skills, harness add-ons and spec-driven methods

**Peak window:** October 2025 to April 2026, busiest in March 2026. Across the eight repositories I grouped here, March 2026 brought 211,574 new stars.

**Representative repositories**
- `anthropics/skills`: created 2025-09-22; 180,509 stars. Agent Skills were announced 2025-10-16 and published as an open standard on 2025-12-18.
- `obra/superpowers`: 297,708 stars, with 66,475 in the 30 days from 2026-03-12.
- `affaan-m/ECC` (formerly everything-claude-code): 277,214 stars, 71,395 of them in March 2026.
- `github/spec-kit`: announced 2025-09-02; 28,578 stars in the next 30 days; 140,842 stars.
- `ComposioHQ/awesome-claude-skills` (76,880) · `mvanhorn/last30days-skill` (63,978).

**What changed for a business.** Method became a file you can hand over. A firm's review checklists, brand rules and research steps can be packaged so any agent follows them, across Claude Code, Codex and others. The company's know-how lives in the skill, not in the model.

**For you.** *Vantik:* package the SEE → DECIDE → BUILD → ADVANCE assessment as a skill and hand it to each client at the end of an engagement. That gives them an asset that keeps working after the advisory ends. *FeetBit:* the existing caption skill should stay the single home of pricing and caption rules.

**Licence cautions.** In `anthropics/skills`, many skills are Apache 2.0, but the docx, pdf, pptx and xlsx skills are "source-available, not open source". The API detects no licence on that repository or on the Composio list. A third-party skill runs with the agent's permissions, so review it like code (see Wave 4).

## Wave 4 — Always-on agents and agent teams

**Peak window:** January–April 2026.

**Representative repositories**
- `openclaw/openclaw`: first released 2025-11-24; renamed to Moltbot on 2026-01-27 and to OpenClaw on 2026-01-30. It has 391,696 stars and took 25,714 on 2026-01-26 alone. Its creator announced on 2026-02-14 that he was joining OpenAI.
- `paperclipai/paperclip`: created 2026-03-02; 44,210 stars in the 30 days from 2026-03-04; 100,353 stars; MIT.
- `HKUDS/nanobot`: created 2026-02-01; 26,953 stars in its first 30 days; 48,961 stars.
- Browser agents belong to the same move. `vercel-labs/agent-browser` was created 2026-01-11 and has 43,822 stars. `browser-use/browser-use` has 117,659. `trycua/cua`'s busiest 30 days began 2026-09-11.

**What changed for a business.** The agent left the code editor and moved into the channels where staff and customers already talk (WhatsApp, Slack, Telegram), and it now runs all the time. That makes it an operations decision with security exposure, not a developer tool.

**For you.** *FeetBit:* OpenClaw's README lists WhatsApp as a channel. A narrow, safe use is an internal assistant on a separate number that drafts replies to stock and price questions for a person to send. Check how it connects to WhatsApp, and whether WhatsApp's terms allow that, before it touches the business number. *Vantik:* Paperclip already runs the operation. The trend makes "agent teams" a client conversation you can show from your own practice.

**Cautions.** On 2026-01-28 Cisco found a third-party OpenClaw skill that exfiltrated data. In March 2026 China restricted state entities from using OpenClaw. An August 2026 review of OpenClaw 2.0 found secrets that are not encrypted at rest and a sandbox that is off by default (all as reported by Wikipedia).

## Wave 5 — Design rules for coding agents

**Peak window:** March–August 2026.

**Representative repositories**
- `VoltAgent/awesome-design-md`: created 2026-03-31; 67,544 stars in its first 30 days; 120,318 stars.
- `nextlevelbuilder/ui-ux-pro-max-skill`: 134,822 stars.
- `pbakaus/impeccable`: 79,872 stars.
- `Leonxlnx/taste-skill`: busiest 30 days from 2026-05-25 (30,443); 94,746 stars.
- `cathrynlavery/diagram-design`: 31,696 stars in the 30 days from 2026-08-11; 50,296 stars.

The earlier design-to-code tool `onlook-dev/onlook` peaked in May–June 2025 and gained only 18,197 stars in the window. The shift was from visual editors to written rules.

**What changed for a business.** People learned to recognise AI-made interfaces as generic, and the fix turned out to be text: a DESIGN.md or skill that writes down a brand's taste. Visual consistency became something you write once and every agent follows.

**For you.** *Vantik:* impeccable, taste, ui-ux-pro-max and diagram-design are already installed in your skill set. The next step is to write the Signal palette and type rules as a DESIGN.md in the awesome-design-md format, so the capture page, Studio and client pages built by agents inherit them. *FeetBit:* do the same for the FeetBit look. It takes little effort.

**Licence cautions.** All five are MIT or Apache-2.0.

## Wave 6 — Workflow automation, then web data for LLMs

**Peak window:** April–October 2025 for n8n; February–August 2026 for scraping and document conversion.

**Representative repositories**
- `n8n-io/n8n`: 207,019 stars; 13,885 gained in April 2025 and 8–14k a month through October 2025.
- `firecrawl/firecrawl`: 190,532 stars; 15–17k a month from June to August 2026.
- `microsoft/markitdown`: 189,574 stars; 25,893 gained in April 2026 and 26,146 in June 2026.
- `D4Vinci/Scrapling`: 86,844 stars; 17,683 gained in May 2026.
- `unclecode/crawl4ai` (85,260) · `langgenius/dify` (158,168).

**What changed for a business.** Turning a website, PDF or spreadsheet into text an agent can use stopped being a project and became a library call. The limit is now permission: what you are allowed to collect.

**For you.** *FeetBit:* run a weekly job that reads the public price and release pages of regional and international sneaker retailers into a sheet, so pricing decisions use current numbers. Check each site's terms first. Scrapling (BSD-3) and crawl4ai (Apache-2.0) carry the fewest strings. *Vantik:* use markitdown (MIT) to take in client documents during the SEE stage.

**Licence cautions.** n8n uses the Sustainable Use License. Files marked `.ee` need an Enterprise licence, and branches other than master are unlicensed. Dify uses a modified Apache 2.0 that bars multi-tenant use without written permission. Firecrawl is AGPL-3.0, so check your obligations before you offer it to clients as a hosted service.

## Wave 7 — Agent memory

**Peak window:** February–June 2026. Earlier memory libraries peaked in spring 2025.

**Representative repositories**
- `thedotmack/claude-mem`: 99,730 stars, with 27,128 in the 30 days from 2026-04-10.
- `volcengine/OpenViking`: created 2026-01-05; 39,677 stars; AGPL-3.0.
- `topoteretes/cognee`: busiest 30 days from 2026-06-20 (10,309).
- `mem0ai/mem0`: busiest 30 days from 2025-05-13; 66,996 stars.
- `getzep/graphiti`: busiest 30 days from 2025-04-24.

Classic RAG engines kept growing without a 2026 spike. GitHub's Octoverse lists `infiniflow/ragflow`, now at 92,003 stars, among 2025's fastest-growing projects by contributors.

**What changed for a business.** Memory is what lets an agent get better at a job over time. The cost is a new store of business data that needs rules about what is kept and for how long.

**For you.** *Vantik:* trial one memory layer on the Paperclip operation, with a written rule for what it may store. *FeetBit:* not for you yet. Customer history belongs in a CRM, not in an agent's memory.

## Wave 8 — Local and open-weight models

**Peak window:** spikes in July, August and October 2025, plus steady growth in the infrastructure underneath.

**Representative repositories**
- `openai/gpt-oss`: Apache-2.0; 6,039 stars on 2025-08-05; 20,457 stars.
- `karpathy/nanochat`: 7,923 stars on its first day, 2025-10-13, and 35,523 in 30 days.
- `MoonshotAI/Kimi-K2`: 7,372 stars in the 30 days from 2025-07-11.
- The steady layer gained this many stars in the window: `ollama/ollama` +52,635 (182,783 total), `ggml-org/llama.cpp` +56,377, `vllm-project/vllm` +51,344, `unslothai/unsloth` +42,661.

Octoverse 2025 ranked vllm, ollama and llama.cpp among the projects with the most contributors.

**What changed for a business.** A capable model can run on a company's own hardware under a permissive licence. Data residency and per-call cost become choices instead of constraints.

**For you.** *Vantik:* this is a real advisory line for Canadian and regulated US clients: show where a local model is good enough. *FeetBit:* not for you.

**Licence cautions.** Kimi-K2 uses a "Modified MIT" licence. The API detects no licence on `QwenLM/Qwen3`, so read the model card before relying on it.

## Wave 9 — AI voice, video and media made from code

**Peak window:** voice from April to September 2025; video made from code from January to August 2026.

**Representative repositories**
- `nari-labs/dia`: created 2025-04-19; 15,670 stars in 30 days.
- `resemble-ai/chatterbox`: busiest 30 days from 2025-05-28; 26,860 stars.
- `microsoft/VibeVoice`: 17,684 stars in the 30 days from 2026-03-29; 54,768 stars.
- `remotion-dev/remotion`: 11,482 stars in the 30 days from 2026-01-20, the day after `remotion-dev/skills` was created.
- `heygen-com/hyperframes`: created 2026-03-10; 60,958 stars; Apache-2.0.
- `harry0703/MoneyPrinterTurbo`: 33,863 stars in the 30 days from 2026-05-25; 129,744 stars.

**What changed for a business.** A pipeline can now produce short video and narration from text and code. The cost of a reel is review time, not production time, and the limits are taste and rights.

**For you.** *Vantik:* the reel stack (HyperFrames, Remotion, Fish voice) sits on this trend line. *FeetBit:* MoneyPrinterTurbo-style tools (MIT) can turn product photos and a caption into short product reels. Keep real photos of the actual pair as the source.

**Licence cautions.** Remotion requires a paid company licence for for-profit organisations above a certain size. `fishaudio/fish-speech` code is under the Fish Audio Research License, and commercial use needs a separate licence; that is a different thing from Fish's paid API. `index-tts` uses the bilibili Model Use License. ComfyUI is GPL-3.0.

## Not a star wave: security and supply chain

The evidence does not support security as a trending wave. `aquasecurity/trivy` gained 13,879 stars in the window and `google/osv-scanner` 4,100, small next to any wave above. It still changed the rules:
- GitHub was told about the self-replicating Shai-Hulud npm worm on 2025-09-14 and removed more than 500 packages.
- On 2025-09-22 GitHub announced that npm publishing would be limited to local publishing with 2FA, granular tokens with a seven-day lifetime, or trusted publishing.
- Agent tools became targets in their own right: the Claude Code source-map leak and the OpenClaw skill exfiltration.

WhatsApp tooling also did not trend: `WhiskeySockets/Baileys` has 11,307 stars and `EvolutionAPI/evolution-api` 9,828.

---

## Platform changes

1. **Stargazer lists closed to outsiders.** GitHub's 2026-06-30 changelog limits `/repos/{owner}/{repo}/stargazers` and `/subscribers` to admins and collaborators. It also restricts the `/stargazers` and `/watchers` web pages because the lists were "misused to collect user data for spam". The docs date the change to July 2026. Users reported 404s from June 30 and the same block on GraphQL from 2026-07-17. On 2026-10-12 `GET /repos/openclaw/openclaw/stargazers` returned 404 to an authenticated non-collaborator. Star History and OSS Insight broke.
2. **Star history endpoint.** On 2026-09-04 GitHub added `GET /repos/{owner}/{repo}/stargazers/history`. It returns weekly buckets (`week`, `total`, `days[7]` starting Sunday), at most 30 per page and 100 pages, newest first. GitHub warns that "Week and day boundaries are not guaranteed to align with UTC". It answered 200 without authentication on 2026-10-12, and Star History reportedly works again on it. For Kinly this replaces stargazer paging and is the method behind this report.
3. **The Trending page.** Both lists froze from 2025-11-13. GitHub staff acknowledged this on 2025-12-03 and reported a fix on 2025-12-04, but users still found sparse lists on 2025-12-28. A 2026-04-13 report of unchanged Go and Java lists got only a bot reply. The ranking is undocumented. The page is not a fixed 25 rows: at 23:59 UTC on 2026-10-11 it showed 8 daily, 12 weekly and 22 monthly rows. GitHub's 2022 plan to retire it was reversed a day later, and it is still listed under Open Source › Repositories. Treat it as one signal that can fail silently, never the only one.
4. **Fake stars.** The CMU/NCSU/Socket StarScout paper, revised 2025-09-06 and now titled "Six Million (Suspected) Fake Stars", finds that fake starring surged in 2024 and lifts a repository for less than two months. A Kinly velocity score needs a quality filter.
5. **Octoverse 2025** (2025-10-28; period 2024-09-01 to 2025-08-31): more than 180M developers, 36M new, and TypeScript the top language by contributors from August 2025.

## What to watch next

- **New this month.** `openai/math` was created 2026-10-06 and has 14,066 stars and no description. `Niko1221/Strata`, a one-click local model runner created 2026-09-24, has 21,571. `CopilotKit/OpenDots` has 4,909. `storytold/photocraft` gained 47,501 stars in 12 days, 9,715 of them on 2026-10-07. Check the quality of those stars before treating it as a signal.
- **Skills and design rules settling into registries and standards.** Agent Skills became an open standard on 2025-12-18. Watch whether a package registry wins.
- **OpenClaw's governance.** A foundation was announced in February 2026. Watch its security fixes before any FeetBit pilot.
- **Further API restrictions.** The June 2026 notice also deprecated `/users/{username}/subscriptions`. Assume more public lists may close, and keep Kinly on the star-history endpoint plus GH Archive.
- **Octoverse 2026.** If it follows 2025's timing (October 28), it will give a contributor-based view to check these star-based waves against.

## Sources

Repository figures (stars, created dates, licences, star history) come from `https://api.github.com/repos/<owner>/<repo>`, `/license` and `/stargazers/history`, pulled 2026-10-12.

- GitHub changelog, 2026-06-30: https://github.blog/changelog/2026-06-30-upcoming-access-restrictions-to-public-api-endpoints-and-ui-views/
- GitHub changelog, 2026-09-04: https://github.blog/changelog/2026-09-04-new-api-endpoint-provides-privacy-safe-star-history-data/
- REST starring docs: https://docs.github.com/en/rest/activity/starring?apiVersion=2026-03-10
- Stargazer restriction thread: https://github.com/orgs/community/discussions/201209
- Trending freeze, 2025: https://github.com/orgs/community/discussions/179946
- Trending report, 2026: https://github.com/orgs/community/discussions/192324
- Trending deprecation thread: https://github.com/orgs/community/discussions/31644
- Trending page: https://github.com/trending
- Gemini CLI launch: https://blog.google/technology/developers/introducing-gemini-cli-open-source-ai-agent/
- Agent Skills: https://claude.com/blog/skills
- MCP to the Agentic AI Foundation: https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation
- Spec Kit: https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/
- npm supply chain: https://github.blog/security/supply-chain-security/our-plan-for-a-more-secure-npm-supply-chain/
- Claude Code leak (heise): https://heise.de/-11242079
- OpenClaw: https://en.wikipedia.org/wiki/OpenClaw
- Octoverse 2025: https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/
- Octoverse fastest-growing tools: https://github.blog/news-insights/octoverse/what-the-fastest-growing-tools-reveal-about-how-software-is-being-built/
- Fake stars paper: https://arxiv.org/abs/2412.13459
- Local API note: `research_notes/Kinly GitHub trending landscape/02-github-apis.md`
