import type { KeyMatchStatus } from "../types";

export interface KeyCheckSummary {
  matches: number;
  mismatches: number;
  plain: number;
  unknown: number;
}

/**
 * Aggregate per-key check results (from a session cache) for the given keys.
 * Keys not yet in the cache are simply skipped — the summary reflects what we
 * already know. Returns `null` when nothing is known yet, so the UI can stay
 * quiet instead of flashing a misleading "all clear".
 */
export function summarizeKeyChecks(
  keys: string[],
  cache: Map<string, KeyMatchStatus>,
): KeyCheckSummary | null {
  const summary: KeyCheckSummary = {
    matches: 0,
    mismatches: 0,
    plain: 0,
    unknown: 0,
  };
  let known = 0;
  for (const key of keys) {
    const status = cache.get(key);
    if (status === undefined) continue;
    known++;
    if (status === "match") summary.matches++;
    else if (status === "mismatch") summary.mismatches++;
    else if (status === "plain") summary.plain++;
    else summary.unknown++;
  }
  return known > 0 ? summary : null;
}
