/**
 * A non-2xx response from the Vori API.
 *
 * `errorCode` and `errorDetails` mirror the error envelope the spec declares
 * on every endpoint, so callers can branch on a documented code rather than
 * on a message string.
 */
export class VoriApiError extends Error {
  readonly body: unknown
  readonly errorCode: string | undefined
  readonly errorDetails: unknown
  readonly method: string
  readonly path: string
  readonly retryAfterSeconds: number | undefined
  readonly status: number

  constructor(args: {
    body: unknown
    method: string
    path: string
    retryAfterSeconds?: number
    status: number
  }) {
    const body = args.body as { error_code?: string; error_details?: unknown } | null
    const code = body?.error_code

    super(
      `Vori API ${args.method} ${args.path} failed with ${args.status}${code ? ` (${code})` : ""}`,
    )

    this.name = "VoriApiError"
    this.body = args.body
    this.errorCode = code
    this.errorDetails = body?.error_details
    this.method = args.method
    this.path = args.path
    this.retryAfterSeconds = args.retryAfterSeconds
    this.status = args.status
  }

  /**
   * A 409 means the transaction is already recorded under this ID but what we
   * sent disagrees with it. The docs are explicit that this is not transient:
   * retrying the same divergent payload returns 409 forever.
   */
  get isConflict(): boolean {
    return this.status === 409
  }

  /** 5xx and 429 are worth another attempt; other 4xx are our bug to fix. */
  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500
  }
}
