/**
 * Format a duration in seconds into a clean human-readable phrase.
 * Examples:
 *   15  -> "15 seconds"
 *   1   -> "1 second"
 *   60  -> "1 minute"
 *   120 -> "2 minutes"
 *   300 -> "5 minutes"
 *   90  -> "1m 30s"
 *
 * @param {number|string} totalSec
 * @returns {string}
 */
export const formatDurationPhrase = (totalSec) => {
  const s = Math.round(Number(totalSec) || 0);
  if (s <= 0) return '0 seconds';
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  const mins = Math.floor(s / 60);
  const remSec = s % 60;
  if (remSec === 0) return `${mins} minute${mins === 1 ? '' : 's'}`;
  return `${mins}m ${remSec}s`;
};
