import createClient from "openapi-fetch"

import type { paths } from "./generated/schema"

import { getVoriConfig, type VoriConfig } from "./config"
import { VoriApiError } from "./errors"
import { assertServerOnly } from "./server-only"

/**
 * Typed client for the Vori grocer-facing API.
 *
 * Every request and response shape comes from `generated/schema.d.ts`, which
 * is generated from Vori's published OpenAPI description — see
 * `pnpm generate:client`. Nothing here restates the API's types; this file
 * adds only what a spec cannot express: authentication, rate-limit backoff,
 * cursor pagination, and a request log the demo can put on screen.
 *
 * VORI_API_KEY is a long-lived credential carrying whatever roles it was
 * granted, so the module refuses to run anywhere but a server. See
 * server-only.ts for why that is a runtime check rather than the `server-only`
 * package.
 */

assertServerOnly("modules/vori/lib/client.ts")

export type VoriLogger = {
  error: (message: string) => void
  info: (message: string) => void
  warn: (message: string) => void
}

const consoleLogger: VoriLogger = {
  error: (message) => console.error(message),
  info: (message) => console.info(message),
  warn: (message) => console.warn(message),
}

const MAX_RATE_LIMIT_RETRIES = 5

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Serialises query parameters the way the API documents them: repeated keys
 * for identifier filters that match multiple values, and literal square
 * brackets for range operators. Brackets are left unescaped so the request
 * log reads like the curl examples in the docs.
 */
const querySerializer = (query: Record<string, unknown>): string => {
  const parts: string[] = []

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue

    const encodedKey = encodeURIComponent(key).replace(/%5B/g, "[").replace(/%5D/g, "]")

    // Repeating the key is how the API matches any of several IDs; a comma
    // list is not accepted.
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === undefined || item === null || item === "") continue
      parts.push(`${encodedKey}=${encodeURIComponent(String(item))}`)
    }
  }

  return parts.join("&")
}

/**
 * fetch with rate-limit handling. A 429 carries Retry-After telling us exactly
 * how long to wait, so we wait that long rather than guessing at a backoff
 * curve, and we give up after a bounded number of attempts so a long
 * rate-limited stretch surfaces as an error instead of hanging forever.
 */
const buildFetch =
  (logger: VoriLogger): typeof fetch =>
  async (input, init) => {
    const request = new Request(input as RequestInfo, init)
    const { pathname, search } = new URL(request.url)

    for (let attempt = 1; ; attempt++) {
      const startedAt = Date.now()
      const response = await fetch(request.clone())
      const duration = Date.now() - startedAt

      logger.info(
        `vori: ${request.method} ${pathname}${search} → ${response.status} in ${duration}ms`,
      )

      if (response.status !== 429) return response

      if (attempt >= MAX_RATE_LIMIT_RETRIES) {
        logger.error(`vori: still rate limited after ${MAX_RATE_LIMIT_RETRIES} attempts`)
        return response
      }

      const retryAfter = Number(response.headers.get("retry-after") ?? "5")
      const waitSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 5

      logger.warn(
        `vori: rate limited, waiting ${waitSeconds}s (attempt ${attempt}/${MAX_RATE_LIMIT_RETRIES})`,
      )
      await sleep(waitSeconds * 1000)
    }
  }

export type VoriClient = ReturnType<typeof createVoriClient>

export const createVoriClient = (options?: { config?: VoriConfig; logger?: VoriLogger }) => {
  const config = options?.config ?? getVoriConfig()
  const logger = options?.logger ?? consoleLogger

  if (!config.apiKey) {
    throw new Error("VORI_API_KEY is not set; the Vori client cannot be created without it")
  }

  const client = createClient<paths>({
    baseUrl: config.baseUrl,
    fetch: buildFetch(logger),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    querySerializer,
  })

  return client
}

/**
 * Turns an openapi-fetch result into either data or a thrown VoriApiError, so
 * callers deal in values rather than in `{ data, error }` at every call site.
 */
export const unwrap = <T>(
  result: { data?: T; error?: unknown; response: Response },
  context: { method: string; path: string },
): T => {
  if (result.error !== undefined || !result.response.ok) {
    const retryAfter = Number(result.response.headers.get("retry-after") ?? "")

    throw new VoriApiError({
      body: result.error,
      method: context.method,
      path: context.path,
      retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
      status: result.response.status,
    })
  }

  return result.data as T
}

/**
 * Walks a cursor-paginated list endpoint, yielding one page at a time.
 *
 * Results come back ordered by `id` descending, and `starting_after` takes the
 * `id` of the last record seen. Yielding pages rather than accumulating them
 * keeps memory flat over a large catalog and lets the caller commit each page
 * as it arrives, so an interrupted run keeps the work it already did.
 */
export async function* paginate<T extends { id: string }>(
  fetchPage: (cursor: string | undefined) => Promise<{ data: T[]; has_more: boolean }>,
  startingAfter?: string,
): AsyncGenerator<T[], void, undefined> {
  let cursor = startingAfter

  for (;;) {
    const page = await fetchPage(cursor)

    if (page.data.length > 0) yield page.data
    if (!page.has_more || page.data.length === 0) return

    cursor = page.data[page.data.length - 1]!.id
  }
}
