import { getConfig } from "./env";
import { isLockEnabled, isValidSession } from "./lock";

/** True when the app lock is off, or the request carries a valid session. */
export function isAuthorized(req: Request): boolean {
  const cfg = getConfig();
  if (!isLockEnabled(cfg)) return true;
  return isValidSession(req.headers.get("cookie"), cfg);
}
