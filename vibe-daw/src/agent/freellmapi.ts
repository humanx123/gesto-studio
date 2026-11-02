// Connecting to the user's own FreeLLMAPI gateway the way the `ia` CLI does.
//
// The CLI never asks anyone to paste a key: it finds the server, authenticates
// as the dashboard user, and writes FREELLMAPI_API_KEY into the tool configs
// itself. The browser has no config file to write, so this module does the same
// three steps live and hands the key to settings, which persists it:
//
//   1. GET  {origin}/api/ping                 → find the server (no auth)
//   2. POST {origin}/api/auth/login           → {email, password} → session token
//   3. GET  {origin}/api/settings/api-key     → the unified /v1 key
//
// The session token and the password are used for that one exchange and never
// stored: only the unified key is kept, exactly what the CLI puts in a config.
// The gateway must list this site in DASHBOARD_ORIGINS for the browser to be
// allowed to call it at all (it already does for gesto-studio).

/** Ports a local FreeLLMAPI listens on: the default, then lab.ia's. */
const KNOWN_PORTS = [31415, 8790];
const HOSTS = ['127.0.0.1', 'localhost'];
const PING_TIMEOUT_MS = 1500;
const CALL_TIMEOUT_MS = 10000;

/** The /v1 base URL for a server origin, which is what settings stores. */
export function v1UrlFor(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/v1`;
}

/** The server origin behind a /v1 base URL (the inverse of v1UrlFor). */
export function originOf(v1Url: string): string {
  return v1Url.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: abort.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Is a FreeLLMAPI answering on this origin? /api/ping needs no auth. */
export async function isServerUp(origin: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${origin}/api/ping`, { method: 'GET', mode: 'cors' }, PING_TIMEOUT_MS);
    if (!res.ok) return false;
    const body = (await res.json()) as { status?: string };
    return body?.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * Find a running gateway, preferring one the user already configured. Returns
 * the server origin (no /v1), or null when nothing answers.
 */
export async function detectServer(configuredV1Url?: string): Promise<string | null> {
  const candidates: string[] = [];
  if (configuredV1Url?.trim()) candidates.push(originOf(configuredV1Url));
  for (const port of KNOWN_PORTS) {
    for (const host of HOSTS) {
      const origin = `http://${host}:${port}`;
      if (!candidates.includes(origin)) candidates.push(origin);
    }
  }
  // Sequential on purpose: the first hit is almost always the configured one or
  // the default port, and firing a dozen parallel requests at a phone's
  // loopback to save a few hundred milliseconds is not worth the noise.
  for (const origin of candidates) {
    if (await isServerUp(origin)) return origin;
  }
  return null;
}

function errorFrom(body: unknown, fallback: string): string {
  const message = (body as { error?: { message?: string } })?.error?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

/** Log in as the dashboard user. The token is for this exchange only. */
async function login(origin: string, email: string, password: string): Promise<string> {
  const res = await fetchWithTimeout(
    `${origin}/api/auth/login`,
    {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    },
    CALL_TIMEOUT_MS,
  );
  const body = await res.json().catch(() => null);
  if (res.status === 401) throw new Error('That email or password was not accepted by your gateway.');
  if (res.status === 429) throw new Error(errorFrom(body, 'Too many attempts. Wait 15 minutes or restart the gateway.'));
  if (!res.ok) throw new Error(errorFrom(body, `The gateway refused the login (HTTP ${res.status}).`));
  const token = (body as { token?: string })?.token;
  if (!token) throw new Error('The gateway logged in but returned no session.');
  return token;
}

/** Read the unified /v1 key — the same value the CLI writes to its configs. */
async function fetchUnifiedKey(origin: string, token: string): Promise<string> {
  const res = await fetchWithTimeout(
    `${origin}/api/settings/api-key`,
    { method: 'GET', mode: 'cors', headers: { Authorization: `Bearer ${token}` } },
    CALL_TIMEOUT_MS,
  );
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(errorFrom(body, `Could not read the API key (HTTP ${res.status}).`));
  const apiKey = (body as { apiKey?: string })?.apiKey;
  if (!apiKey) throw new Error('Your gateway has no unified API key yet. Open its dashboard and generate one.');
  return apiKey;
}

/** Hand the session back so the caller can close it; failure is not worth surfacing. */
async function logout(origin: string, token: string): Promise<void> {
  try {
    await fetchWithTimeout(
      `${origin}/api/auth/logout`,
      { method: 'POST', mode: 'cors', headers: { Authorization: `Bearer ${token}` } },
      CALL_TIMEOUT_MS,
    );
  } catch {
    // The session expires on its own; nothing to do.
  }
}

export interface FreellmapiConnection {
  /** The /v1 base URL to store in settings. */
  url: string;
  /** The unified API key to store in settings. */
  key: string;
}

/**
 * The whole handshake: find the gateway, sign in as its user, come back with
 * the URL and key for settings. The password is never stored or logged.
 */
export async function connectWithUser(email: string, password: string, configuredV1Url?: string): Promise<FreellmapiConnection> {
  const origin = await detectServer(configuredV1Url);
  if (!origin) {
    throw new Error(
      'No FreeLLMAPI found on this device. Start it with the `ia` menu, then try again. '
      + 'If it runs on another port, set the address by hand first.',
    );
  }
  const token = await login(origin, email, password);
  try {
    const key = await fetchUnifiedKey(origin, token);
    return { url: v1UrlFor(origin), key };
  } finally {
    void logout(origin, token);
  }
}

/** Has the gateway had its first user created? Tells the UI what to ask for. */
export async function needsSetup(origin: string): Promise<boolean | null> {
  try {
    const res = await fetchWithTimeout(`${origin}/api/auth/status`, { method: 'GET', mode: 'cors' }, PING_TIMEOUT_MS);
    if (!res.ok) return null;
    const body = (await res.json()) as { configured?: boolean; setupRequired?: boolean };
    if (typeof body?.setupRequired === 'boolean') return body.setupRequired;
    if (typeof body?.configured === 'boolean') return !body.configured;
    return null;
  } catch {
    return null;
  }
}
