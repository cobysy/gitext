/**
 * Reconcile JSON settings from unknown: dialog bounds and confirmations use the same
 * pattern.
 */

/** True when value is a plain object (not null or array). */
export function isPlainRecord(value: unknown): value is Record<string, unknown>
{
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
