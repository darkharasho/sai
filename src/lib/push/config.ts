// Where the desktop sends sealed pushes (relay/README.md). Shared so the phone
// (registration) and the desktop (sends) agree on one relay.

/** The deployed Cloudflare relay Worker. */
export const PUSH_RELAY_URL = 'https://sai-push-relay.project96.workers.dev';

/**
 * The relay base URL, without a trailing slash. `SAI_PUSH_RELAY_URL` overrides
 * it (tests and dev); only http(s) URLs are accepted.
 */
export function pushRelayUrl(
  env: Record<string, string | undefined> = typeof process !== 'undefined' && process.env ? process.env : {},
): string {
  const override = env.SAI_PUSH_RELAY_URL;
  const url = override && /^https?:\/\/[^\s]+$/i.test(override) ? override : PUSH_RELAY_URL;
  return url.replace(/\/+$/, '');
}
