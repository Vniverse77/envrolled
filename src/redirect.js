// The server only ever redirects to ONE configured URL, never to anything taken
// from a request. We still validate that URL so a typo (or a hostile config)
// cannot turn the trap into a javascript:/data: redirect.
export const DEFAULT_REDIRECT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

/** Returns the normalised URL string, or throws. Only absolute http(s) allowed. */
export function validateRedirect(value) {
  let u;
  try {
    u = new URL(String(value));
  } catch {
    throw new Error(`Invalid redirect URL (must be absolute http/https): ${value}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Invalid redirect URL (only http/https allowed): ${value}`);
  }
  return u.toString();
}
