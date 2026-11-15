/**
 * Freezes `new Date()` and `Date.now()` when REVIEW_CLOCK=YYYY-MM-DD.
 * Explicit dates still construct. Used by the pinned-clock test runs.
 */
const clock = process.env.REVIEW_CLOCK;
if (clock && /^\d{4}-\d{2}-\d{2}$/.test(clock)) {
  const fixed = Date.parse(`${clock}T16:00:00.000Z`);
  const Original = Date;
  function PatchedDate(...args) {
    if (!new.target) return new Original(fixed).toString();
    if (args.length === 0) return new Original(fixed);
    return new Original(...args);
  }
  PatchedDate.now = () => fixed;
  PatchedDate.parse = Original.parse.bind(Original);
  PatchedDate.UTC = Original.UTC.bind(Original);
  PatchedDate.prototype = Original.prototype;
  Object.setPrototypeOf(PatchedDate, Original);
  globalThis.Date = PatchedDate;
}
