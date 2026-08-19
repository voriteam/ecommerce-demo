/**
 * Guards a module against ever executing in a browser.
 *
 * The React `server-only` package would be the idiomatic marker, but it
 * throws under plain Node — it only resolves to a no-op under the
 * `react-server` condition — and the Vori modules are imported by the Payload
 * job queue and by CLI scripts as well as by server components. This check
 * holds in every one of those places.
 *
 * The credential itself is safe by construction regardless: Next only inlines
 * environment variables prefixed NEXT_PUBLIC_ into the client bundle, and
 * VORI_API_KEY deliberately has no such prefix. This is the second lock.
 */
export const assertServerOnly = (moduleName: string): void => {
  if (typeof window !== 'undefined') {
    throw new Error(
      `${moduleName} must never run in the browser: it carries the Vori API key. ` +
        'Call it from a server component, a route handler, or a Payload job instead.',
    )
  }
}
