/**
 * Guards a module against ever executing in a browser.
 *
 * The React `server-only` package would be the idiomatic marker, but it throws
 * under plain Node — it only resolves to a no-op under the `react-server`
 * condition — and these modules are imported by scheduled jobs, subscribers
 * and CLI scripts as well as by request handlers. This check holds in every
 * one of those places.
 *
 * The credential is safe by construction regardless: VORI_API_KEY is read only
 * on the backend and never crosses into the storefront bundle. This is the
 * second lock.
 */
export const assertServerOnly = (moduleName: string): void => {
  if (typeof window !== "undefined") {
    throw new Error(
      `${moduleName} must never run in the browser: it carries the Vori API key. ` +
        "Call it from a workflow, a subscriber, an API route, or a CLI script instead.",
    )
  }
}
