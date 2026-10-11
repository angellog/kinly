import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { CONFIG_SCHEMA } from "./config.js";
import { AGENTS_MD, SKILL_MD } from "./generated/instructions.js";
import { TOOL_DECLARATIONS } from "./tools.js";

/**
 * vantik.kinly — Project Kinly inside Paperclip, built by Vantik Systems.
 *
 * Installed once on the instance and enabled per company (all four by default).
 * It talks only to the Kinly API (D8). What it may change:
 *   - Kinly's own records (shortlist, ratings, resource pages) through the API,
 *     with the company's API token, which is a secret ref resolved in the worker;
 *   - Paperclip issues: one daily brief per company (opt-in) and the
 *     "Add to workspace" test issue;
 *   - the managed Kinly agent and skill, which are created paused (D9).
 * It never installs a repository, never publishes to social, and never pushes code.
 */
const manifest: PaperclipPluginManifestV1 = {
  id: "vantik.kinly",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Kinly — GitHub trends",
  description:
    "Project Kinly by Vantik Systems. Covers what is trending on GitHub today, this week and over the last 18 months, what each repository does, and whether it is worth testing for Vantik Systems or FeetBit. Includes a console, agent tools, a managed Kinly researcher, a skill, and an optional daily brief.",
  author: "Vantik Systems",
  categories: ["ui", "automation", "connector"],
  capabilities: [
    "ui.page.register",
    "ui.sidebar.register",
    "ui.dashboardWidget.register",
    "ui.action.register",
    "companies.read",
    "agents.read",
    "agents.managed",
    "skills.managed",
    "agent.tools.register",
    "jobs.schedule",
    "issues.read",
    "issues.create",
    "issues.update",
    "secrets.read-ref",
    "plugin.state.read",
    "plugin.state.write",
    "activity.log.write",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  instanceConfigSchema: CONFIG_SCHEMA as unknown as Record<string, unknown>,
  jobs: [
    {
      jobKey: "daily-brief",
      displayName: "Kinly daily brief",
      description: "For each company with the daily brief turned on, upsert one issue per day carrying the Kinly daily report.",
      schedule: "0 7 * * *",
    },
    {
      jobKey: "reconcile",
      displayName: "Kinly agent and skill",
      description: "Make sure the managed Kinly agent and skill exist in every company where Kinly is enabled. The agent is created paused.",
      schedule: "23 */6 * * *",
    },
  ],
  tools: TOOL_DECLARATIONS,
  agents: [
    {
      agentKey: "kinly",
      displayName: "Kinly",
      role: "researcher",
      title: "GitHub researcher",
      icon: "telescope",
      capabilities: "Reads GitHub trend data through the vantik.kinly tools, explains what each repository is for in business terms, and tests shortlisted repositories in a throwaway container before rating them.",
      adapterType: "claude_local",
      adapterPreference: ["claude_local", "codex_local"],
      status: "paused",
      instructions: { entryFile: "AGENTS.md", content: AGENTS_MD },
    },
  ],
  skills: [
    {
      skillKey: "kinly",
      displayName: "Kinly",
      slug: "kinly",
      description: "Use the vantik.kinly tools to answer what is trending on GitHub, what a repository does, and whether to test it for Vantik Systems or FeetBit.",
      markdown: SKILL_MD,
    },
  ],
  ui: {
    slots: [
      { type: "page", id: "kinly-console", displayName: "Kinly", exportName: "KinlyPage", routePath: "kinly" },
      { type: "sidebar", id: "kinly-nav", displayName: "Kinly", exportName: "KinlySidebarLink" },
      { type: "dashboardWidget", id: "kinly-today", displayName: "Kinly — trending today", exportName: "KinlyWidget" },
    ],
  },
};

export default manifest;
