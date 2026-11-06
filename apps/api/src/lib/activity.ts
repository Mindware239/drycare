/** When someone last changed something on this PC, so an automatic update waits for a quiet moment. */
let lastWork = 0;
export const noteWork = () => { lastWork = Date.now(); };
export const secondsSinceWork = () => (lastWork ? Math.round((Date.now() - lastWork) / 1000) : Number.MAX_SAFE_INTEGER);
