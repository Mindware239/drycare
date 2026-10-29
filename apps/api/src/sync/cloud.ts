/**
 * PC-side cloud configuration and the device credential.
 *
 * The credential is held by a pluggable store. In the Windows app the Electron main process provides one backed
 * by `safeStorage` (Windows DPAPI, readable only by the same Windows user); it is never sent to the web screens.
 * Tests use an in-memory store. Without a store, linking is unavailable.
 */
import { env } from "../env";

export interface StoredCredential {
  cloudUrl: string;
  deviceId: string;
  credential: string; // "<deviceId>.<secret>"
  credentialExpiresAt: string;
  organizationId: string;
  branchId: string;
  linkedAt: string;
  /** Cloud account that approved the link (shown on the PC so an unexpected approval is noticed). */
  linkedBy?: string | null;
}

export interface CredentialStore {
  load(): Promise<StoredCredential | null>;
  save(c: StoredCredential): Promise<void>;
  clear(): Promise<void>;
}

let store: CredentialStore | null = null;
export const setCredentialStore = (s: CredentialStore | null) => { store = s; };
export const credentialStore = () => store;

export function memoryCredentialStore(): CredentialStore {
  let c: StoredCredential | null = null;
  return { load: async () => c, save: async (v) => { c = v; }, clear: async () => { c = null; } };
}

let urlOverride: string | null | undefined;
/** Tests and the desktop shell can set the URL at runtime (e.g. from config.json). */
export const setCloudUrl = (u: string | null | undefined) => { urlOverride = u; };

/** Validated cloud base URL, or null when cloud sync is not configured. HTTPS only (except local tests). */
export function cloudBaseUrl(): string | null {
  const raw = urlOverride !== undefined ? urlOverride : env.DRYCARE_CLOUD_URL ?? null;
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local && env.DRYCARE_CLOUD_ALLOW_INSECURE)) return null;
  return u.origin;
}
