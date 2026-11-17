import type { VoriPaymentsMode } from "./config"
import { VoriApiError } from "./errors"
import type { components } from "./generated/schema"
import { centsToDecimal, decimalToCentsRounded, sumCents } from "./money"

/**
 * A card is tokenized in the shopper's browser, and only that one-time token
 * reaches this server. Vori turns it into a sale with the store's processor and
 * later voids or returns it, so no card number or CVV is ever handled here.
 */

/**
 * Payments and refunds are described here rather than in the generated client
 * because Vori serves them only to banners the API is turned on for and leaves
 * them out of its published description. Everything they share with the rest of
 * the API, such as card brands and the mode, still comes from the generated
 * client, so a change there reaches these shapes too.
 */

type ErrorBody = { error_code: string; error_details?: Record<string, unknown> }

type JsonResponse<T> = { headers: { [name: string]: unknown }; content: { "application/json": T } }

/** `captured` once the money moved, `authorized` while the processor only holds it. */
export type VoriPaymentStatus = "authorized" | "captured" | "failed"

export type VoriPaymentMethod = {
  brand: components["schemas"]["CardBrand"] | null
  last4: null | string
  type: components["schemas"]["OnlinePaymentMethodType"]
}

export type VoriPayment = {
  amount: string
  created_at: string
  id: string
  idempotency_key: string
  metadata: null | Record<string, string>
  mode: VoriPaymentsMode
  payment_method: VoriPaymentMethod
  processor: "datacap"
  status: VoriPaymentStatus
  store_id: string
  updated_at: string
}

export type CreateVoriPaymentRequest = {
  amount: string
  idempotency_key: string
  metadata?: Record<string, string>
  mode: VoriPaymentsMode
  store_id: string
  token: string
}

export type VoriPaymentRefund = {
  amount: string
  created_at: string
  id: string
  idempotency_key: string
  metadata: null | Record<string, string>
  mode: VoriPaymentsMode
  payment_id: string
  processor: "datacap"
  /** Never `authorized`: a refund either moved the money or did not. */
  status: VoriPaymentStatus
  store_id: string
  type: "return" | "void"
  updated_at: string
}

export type CreateVoriPaymentRefundRequest = {
  amount: string
  idempotency_key: string
  metadata?: Record<string, string>
  mode: VoriPaymentsMode
  payment_id: string
  store_id: string
}

type NoParameters = { query?: never; header?: never; path?: never; cookie?: never }
type IdParameter = { query?: never; header?: never; path: { id: string }; cookie?: never }

type CreateOperation<TBody, TResult> = {
  parameters: NoParameters
  requestBody: { content: { "application/json": TBody } }
  responses: { 201: JsonResponse<TResult>; default: JsonResponse<ErrorBody> }
}

type GetOperation<TResult> = {
  parameters: IdParameter
  requestBody?: never
  responses: { 200: JsonResponse<TResult>; default: JsonResponse<ErrorBody> }
}

type Unused = {
  put?: never
  delete?: never
  options?: never
  head?: never
  patch?: never
  trace?: never
}

export type VoriPaymentsPaths = {
  "/v1/payments": Unused & {
    parameters: NoParameters
    get?: never
    post: CreateOperation<CreateVoriPaymentRequest, VoriPayment>
  }
  "/v1/payments/{id}": Unused & {
    parameters: NoParameters
    get: GetOperation<VoriPayment>
    post?: never
  }
  "/v1/refunds": Unused & {
    parameters: NoParameters
    get?: never
    post: CreateOperation<CreateVoriPaymentRefundRequest, VoriPaymentRefund>
  }
  "/v1/refunds/{id}": Unused & {
    parameters: NoParameters
    get: GetOperation<VoriPaymentRefund>
    post?: never
  }
}

export type VoriStore = components["schemas"]["Store"]

/**
 * The key the browser tokenizes with in this mode, or null when the store has
 * none. A store without an e-commerce merchant account carries no `live` key,
 * and a key from the wrong mode cannot be charged in this one.
 */
export const tokenizationKeyFor = (store: VoriStore, mode: VoriPaymentsMode): null | string =>
  store.ecommerce_credentials.find((credential) => credential.mode === mode)?.public_key ?? null

export class PaymentBuildError extends Error {}

const MAX_IDEMPOTENCY_KEY_LENGTH = 255

const assertKeyFits = (key: string): string => {
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new PaymentBuildError(
      `Idempotency key "${key}" is ${key.length} characters, and Vori accepts ${MAX_IDEMPOTENCY_KEY_LENGTH}.`,
    )
  }
  return key
}

export type RecordedRefund = {
  amount_cents: number
  /** Absent when there was no Vori payment to refund. */
  idempotency_key?: string
  refund_id?: string
  /** Why nothing was sent, when writes were held back. */
  skipped?: string
  status?: VoriPaymentStatus
}

/**
 * The payment session's ID is the idempotency key: it is minted before the
 * card is charged and reused on every retry of the same authorization, so a
 * retry returns the payment already taken instead of charging again. A new
 * card entry opens a new session, and with it a new key.
 */
export const buildCreatePaymentRequest = (args: {
  amountCents: number
  cartId?: null | string
  currencyCode: string
  mode: VoriPaymentsMode
  sessionId: string
  storeId: string
  token: string
}): CreateVoriPaymentRequest => {
  if (args.currencyCode.toLowerCase() !== "usd") {
    throw new PaymentBuildError(
      `Vori Payments charges in US dollars, and this payment is in ${args.currencyCode}.`,
    )
  }

  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
    throw new PaymentBuildError(
      `A payment of ${args.amountCents} cents is not a positive whole number of cents.`,
    )
  }

  return {
    amount: centsToDecimal(args.amountCents),
    idempotency_key: assertKeyFits(args.sessionId),
    ...(args.cartId ? { metadata: { medusa_cart_id: args.cartId } } : {}),
    mode: args.mode,
    store_id: args.storeId,
    token: args.token,
  }
}

/**
 * Keyed on the refund's position rather than on anything Medusa mints: a
 * refund that failed is thrown away and retried under a new Medusa ID, but its
 * position among this payment's refunds is the same, so a retry of a refund
 * Vori did make returns it instead of refunding twice.
 */
export const refundIdempotencyKey = (paymentId: string, amountCents: number, index: number) =>
  assertKeyFits(`${paymentId}:${centsToDecimal(amountCents)}:${index}`)

export const buildCreateRefundRequest = (args: {
  amountCents: number
  index: number
  medusaRefundId?: null | string
  mode: VoriPaymentsMode
  paymentId: string
  storeId: string
}): CreateVoriPaymentRefundRequest => {
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
    throw new PaymentBuildError(
      `A refund of ${args.amountCents} cents is not a positive whole number of cents.`,
    )
  }

  return {
    amount: centsToDecimal(args.amountCents),
    idempotency_key: refundIdempotencyKey(args.paymentId, args.amountCents, args.index),
    ...(args.medusaRefundId ? { metadata: { medusa_refund_id: args.medusaRefundId } } : {}),
    mode: args.mode,
    payment_id: args.paymentId,
    store_id: args.storeId,
  }
}

/**
 * A failed or skipped refund gave nothing back. One Vori could not answer for
 * goes on holding its part of the payment, so it counts against what is left.
 */
export const remainingRefundableCents = (amountCents: number, refunds: RecordedRefund[]) =>
  amountCents -
  sumCents(
    refunds
      .filter((refund) => refund.status !== "failed" && !refund.skipped)
      .map((refund) => refund.amount_cents),
  )

/**
 * A Medusa amount in cents: a number, a decimal string, a BigNumber, or the
 * `{ value }` raw form a refund arrives in.
 */
export const amountToCents = (amount: unknown): number => {
  let value = amount
  if (typeof amount === "object" && amount !== null) {
    value =
      "numeric" in amount
        ? (amount as { numeric: unknown }).numeric
        : (amount as { value?: unknown }).value
  }
  const cents = decimalToCentsRounded(value as number | string)

  if (cents === null) throw new PaymentBuildError(`${String(amount)} is not an amount of money.`)
  return cents
}

/**
 * The processor did not answer in time, so the card may or may not have been
 * charged. Only another request under the same idempotency key can say which.
 */
export const isUnconfirmedPayment = (error: unknown): boolean =>
  error instanceof VoriApiError && error.errorCode === "payment_processor_timeout"

/** The Vori payment or refund a refusal is about, and what the processor said, when it names them. */
export const refusalDetails = (
  error: VoriApiError,
): { paymentId: null | string; processorMessage: null | string; refundId: null | string } => {
  const details = (error.errorDetails ?? {}) as Record<string, unknown>
  const text = (value: unknown) => (typeof value === "string" ? value : null)

  return {
    paymentId: text(details.payment_id),
    processorMessage: text(details.processor_message),
    refundId: text(details.refund_id),
  }
}

/**
 * What to tell the shopper when Vori refuses, or null when the refusal is ours
 * to fix rather than theirs to act on.
 */
export const paymentRefusalMessage = (error: VoriApiError): null | string => {
  switch (error.errorCode) {
    case "card_declined":
      return "Your card was declined. Check the details or try another card."
    case "refund_declined":
      return "The card processor declined the refund."
    case "payment_in_progress":
      return "This payment is still being processed. Wait a moment and try again."
    case "refund_in_progress":
      return "This refund is still being processed. Wait a moment and try again."
    default:
      return null
  }
}
