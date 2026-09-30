/**
 * The pointer's lock lands a moment after it is asked for, so a cover lifted
 * on the same call as `engage()` finds the controls not yet engaged and shows
 * the pause menu for the frames between. `whenEngaged` is the wait: true once
 * `engaged()` reads so, false after `maxMs` (a lock the browser refused, or a
 * page with no pointer), when the caller carries on regardless.
 */
export const ENGAGE_MAX_MS = 1000;
const POLL_MS = 50;

export function whenEngaged(engaged: () => boolean, maxMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (engaged()) {
      resolve(true);
      return;
    }
    const began = Date.now();
    const check = (): void => {
      if (engaged()) resolve(true);
      else if (Date.now() - began >= maxMs) resolve(false);
      else setTimeout(check, POLL_MS);
    };
    setTimeout(check, POLL_MS);
  });
}
