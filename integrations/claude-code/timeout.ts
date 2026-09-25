/** Hooks run on every session or turn, so a slow or unreachable server must not hold Claude up. */
export const withTimeout = <T>(p: Promise<T>, ms = 1500) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
