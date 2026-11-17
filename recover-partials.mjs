// Only revisit sources that were safely deferred, after every source had its turn.
export async function recoverPartials({ pendingIds, getSources, process, deadline, minBudgetMs, now = Date.now }) {
  if (!pendingIds.size || deadline - now() <= minBudgetMs) return;
  // Reload persisted checkpoints; never replay from the first pass's stale snapshot.
  const sources = (await getSources()).filter(source => pendingIds.has(String(source.id)));
  for (const [index, source] of sources.entries()) {
    const budget = Math.floor((deadline - now()) / (sources.length - index));
    if (budget <= minBudgetMs) break;
    await process(source, Math.min(deadline, now() + budget));
  }
}
