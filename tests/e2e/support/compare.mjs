/**
 * Node-side comparison helpers shared by the damage suites (hoisted from their per-suite
 * copies — 3rd duplication flagged by the Phase-5 review). All inputs are plain JSON that
 * crossed the CDP boundary; NO Foundry Documents here.
 */

/** Exact JSON structural equality (stringify order-sensitivity is DELIBERATE for recap maps). */
export function deepEqualJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Order-independent entry comparison for FLAT maps of scalars — stats baselines and flat flag
 * maps (Phase-3 review-5 B4 rule). Values compared strictly (`===`): NEVER feed nested objects,
 * cross-CDP copies of equal objects are reference-unequal (see flagNamespacesEqual for that).
 */
export function entriesEqual(actual, expected) {
  const e = Object.entries(expected ?? {});
  const a = Object.entries(actual ?? {});
  return a.length === e.length && e.every(([key, value]) => a.some(([k, v]) => k === key && v === value));
}

/**
 * Deep, key-ORDER-tolerant equality for NESTED maps of numbers (actor flag NAMESPACES like
 * flags['knight-damage'] = {energie: {Actor_x: 12}}) — entriesEqual's strict value compare
 * false-fails on object values across two CDP round-trips (Phase-5 review finding 1).
 */
export function flagNamespacesEqual(actual, expected) {
  const sortDeep = (value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortDeep(value[key]);
    return out;
  };
  return JSON.stringify(sortDeep(actual ?? {})) === JSON.stringify(sortDeep(expected ?? {}));
}

/**
 * Recap flag maps are compared KEY-ORDER-SENSITIVELY: the exact repartition map (keys in the
 * order calculate() inserts them) is part of the module contract the recap HTML lines follow.
 */
export function recapMapMatches(actual, expected) {
  if (actual === undefined || actual === null) return false;
  return (
    JSON.stringify(Object.keys(actual)) === JSON.stringify(Object.keys(expected)) && deepEqualJson(actual, expected)
  );
}
