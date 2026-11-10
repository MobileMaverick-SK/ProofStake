/**
 * The address the user's browser used to reach this app, for building links
 * PayPal sends the user back to. Behind a hosting proxy the request itself
 * looks local, so the forwarded headers are preferred.
 */
/** Whether the user reached the app over HTTPS. Decides if cookies are marked Secure. */
export function isHttps(headers: Headers): boolean {
  return publicOrigin(headers).startsWith('https://');
}

export function publicOrigin(headers: Headers, fallbackUrl?: string): string {
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (host) {
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
    const protocol = headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? (local ? 'http' : 'https');
    return `${protocol}://${host}`;
  }
  return fallbackUrl ? new URL(fallbackUrl).origin : 'http://localhost:3000';
}
