/**
 * The Lookbook week row. A throw or a rejection resolves to null so the page
 * can clear the skeleton instead of leaving it up.
 */
export function settleWeek<T>(dress: () => T | Promise<T>): Promise<T | null> {
  return Promise.resolve()
    .then(() => dress())
    .then((value) => value)
    .catch(() => null);
}
