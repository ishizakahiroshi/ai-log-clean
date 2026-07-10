/**
 * Parse and select capacity-budget cleanup candidates.
 * Budget values use binary units to match formatSize (1 KB = 1024 bytes).
 */

const BYTE_UNITS = {
  B: 1,
  K: 1024,
  KB: 1024,
  M: 1024 ** 2,
  MB: 1024 ** 2,
  G: 1024 ** 3,
  GB: 1024 ** 3,
};

/** @param {string | number} input */
export function parseByteSize(input) {
  if (typeof input === "number") {
    if (Number.isSafeInteger(input) && input >= 0) return input;
    throw new Error("byte size must be a non-negative safe integer");
  }

  const match = String(input).trim().match(/^(\d+)\s*(B|K|KB|M|MB|G|GB)?$/i);
  if (!match) {
    throw new Error('byte size must be an integer or use B, KB, MB, or GB (for example "2GB")');
  }

  const amount = Number(match[1]);
  const unit = (match[2] || "B").toUpperCase();
  const bytes = amount * BYTE_UNITS[unit];
  if (!Number.isSafeInteger(bytes)) throw new Error("byte size is too large");
  return bytes;
}

/**
 * Keep retention candidates, then add the oldest remaining candidates until
 * the virtual post-cleanup total is within budget.
 *
 * @param {Array<{ provider: string, candidate: { path: string, size: number, lastWriteTime: Date } }>} allCandidates
 * @param {Set<string>} retentionKeys
 * @param {number | null | undefined} budgetBytes
 */
export function selectBudgetCandidates(allCandidates, retentionKeys, budgetBytes) {
  if (budgetBytes == null) {
    return { selectedKeys: new Set(retentionKeys), addedKeys: new Set(), totalBytes: null, afterBytes: null };
  }

  const totalBytes = allCandidates.reduce((total, entry) => total + entry.candidate.size, 0);
  const selectedKeys = new Set(retentionKeys);
  let afterBytes = totalBytes;
  for (const entry of allCandidates) {
    if (selectedKeys.has(budgetCandidateKey(entry.provider, entry.candidate))) afterBytes -= entry.candidate.size;
  }

  const addedKeys = new Set();
  const remaining = allCandidates
    .filter((entry) => !selectedKeys.has(budgetCandidateKey(entry.provider, entry.candidate)))
    .sort((a, b) => {
      const byAge = a.candidate.lastWriteTime.getTime() - b.candidate.lastWriteTime.getTime();
      if (byAge !== 0) return byAge;
      return budgetCandidateKey(a.provider, a.candidate).localeCompare(budgetCandidateKey(b.provider, b.candidate));
    });

  for (const entry of remaining) {
    if (afterBytes <= budgetBytes) break;
    const key = budgetCandidateKey(entry.provider, entry.candidate);
    selectedKeys.add(key);
    addedKeys.add(key);
    afterBytes -= entry.candidate.size;
  }

  return { selectedKeys, addedKeys, totalBytes, afterBytes };
}

export function budgetCandidateKey(provider, candidate) {
  return `${provider}\u0000${candidate.path}`;
}
