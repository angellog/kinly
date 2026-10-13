/** Managed-agent helpers that need no host, so they can be tested directly. */

/**
 * True when the managed agent's stored instructions differ from the ones this build ships. The host's `reconcile`
 * never rewrites existing instructions, so after a plugin upgrade that changed AGENTS.md the agent keeps the old
 * text until a `reset`. Unknown or missing metadata is not stale: only a confirmed difference triggers a reset.
 */
export function instructionsStale(agent: { metadata?: unknown } | null | undefined, shipped: string): boolean {
  const meta = agent?.metadata as { pluginManagedAgent?: { instructions?: { content?: unknown } } } | null | undefined;
  const stored = meta?.pluginManagedAgent?.instructions?.content;
  return typeof stored === "string" && stored !== shipped;
}
