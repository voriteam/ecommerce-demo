import type { Payload } from 'payload'

import type { Order, Product } from '@/payload-types'

import { createVoriClient, unwrap, type VoriLogger } from './client'
import { getVoriConfig, writeBlockedReason, type VoriConfig } from './config'
import { VoriApiError } from './errors'
import { assertServerOnly } from './serverOnly'
import { buildTransaction, TransactionBuildError } from './transactions'

assertServerOnly('src/vori/recordTransaction.ts')

export type RecordStatus = 'conflict' | 'failed' | 'recorded' | 'skipped'

export type RecordResult = {
  detail?: string
  /** True when the caller should retry — 429s, 5xx, network faults. */
  retryable: boolean
  status: RecordStatus
}

/**
 * Records a completed order in Vori.
 *
 * Outcomes are deliberately distinct, because they call for different things:
 *
 *   recorded  the transaction is on file. A replay of the same UUIDv7 lands
 *             here too — the API returns the transaction already recorded
 *             rather than creating a second one, which is what makes retrying
 *             safe.
 *   conflict  a transaction already exists under this ID but disagrees with
 *             what we sent. The docs are explicit that this is not transient;
 *             retrying the same divergent payload returns 409 forever. It
 *             means an ID was reused across two different orders, which is a
 *             bug on this side to fix rather than a condition to retry.
 *   failed    a validation error, or a payload we could not even build. Also
 *             not retryable: the same request would fail the same way.
 *   skipped   writes are switched off, or there are no credentials. The
 *             request body is still built and stored, so the payload can be
 *             reviewed before anything is ever sent.
 */
export const recordVoriTransaction = async (args: {
  config?: VoriConfig
  logger: VoriLogger
  orderId: number | string
  payload: Payload
}): Promise<RecordResult> => {
  const config = args.config ?? getVoriConfig()
  const { logger, orderId, payload } = args

  const order = (await payload.findByID({
    id: orderId,
    collection: 'orders',
    depth: 1,
  })) as Order

  if (order.voriSyncStatus === 'recorded') {
    logger.info(`vori: order ${orderId} is already recorded; nothing to do`)
    return { retryable: false, status: 'recorded' }
  }

  if (!order.voriTransactionId) {
    // Without the key minted at creation there is no safe way to send this:
    // generating one now would not protect an earlier attempt we cannot see.
    return finish({
      detail: 'Order has no voriTransactionId; it was created before the Vori hooks existed.',
      logger,
      order,
      payload,
      result: { retryable: false, status: 'failed' },
    })
  }

  // ---------------------------------------------------------------------
  // Build the request, whether or not it will be sent.
  // ---------------------------------------------------------------------
  let request
  try {
    request = buildTransaction({
      ...(await resolvePayment({ order, payload })),
      order,
      productsById: await loadProducts({ order, payload }),
      // Without a store there is nothing to attribute the sale to; the build
      // still runs so the payload is reviewable, with the gap made obvious.
      storeId: config.storeId ?? 'VORI_STORE_ID-not-set',
      transactionId: order.voriTransactionId,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    logger.error(`vori: could not build a transaction for order ${orderId} — ${detail}`)

    return finish({
      detail,
      logger,
      order,
      payload,
      result: {
        // A build failure is a data problem — a product missing its Vori ID,
        // totals that do not reconcile. Retrying changes nothing.
        retryable: !(error instanceof TransactionBuildError),
        status: 'failed',
      },
    })
  }

  const blocked = writeBlockedReason(config)
  if (blocked) {
    logger.info(`vori: not sending transaction for order ${orderId} — ${blocked}`)
    return finish({
      detail: blocked,
      logger,
      order,
      payload,
      request,
      result: { retryable: false, status: 'skipped' },
    })
  }

  // ---------------------------------------------------------------------
  // Send it.
  // ---------------------------------------------------------------------
  try {
    const client = createVoriClient({ config, logger })
    const response = unwrap(
      await client.POST('/v1/transactions', { body: request }),
      { method: 'POST', path: '/v1/transactions' },
    )

    logger.info(`vori: recorded order ${orderId} as transaction ${request.id}`)

    return finish({
      logger,
      order,
      payload,
      request,
      response,
      result: { retryable: false, status: 'recorded' },
    })
  } catch (error) {
    if (error instanceof VoriApiError) {
      const status: RecordStatus = error.isConflict ? 'conflict' : 'failed'

      if (error.isConflict) {
        logger.error(
          `vori: order ${orderId} conflicts with the transaction already recorded under ${request.id}. ` +
            'This means the same ID was used for two different orders; it will not be retried.',
        )
      }

      return finish({
        detail: error.message,
        logger,
        order,
        payload,
        request,
        response: error.body,
        result: { retryable: error.isRetryable, status },
      })
    }

    const detail = error instanceof Error ? error.message : String(error)
    logger.error(`vori: transport failure recording order ${orderId} — ${detail}`)

    return finish({
      detail,
      logger,
      order,
      payload,
      request,
      // A network fault says nothing about whether the request landed, which
      // is precisely the case the idempotency key exists for.
      result: { retryable: true, status: 'failed' },
    })
  }
}

/** Loads every product on the order in one query. */
const loadProducts = async (args: {
  order: Order
  payload: Payload
}): Promise<Map<number | string, Product>> => {
  const ids = (args.order.items ?? [])
    .map((item) => (typeof item.product === 'object' ? item.product?.id : item.product))
    .filter((id): id is number => id !== null && id !== undefined)

  if (ids.length === 0) return new Map()

  const products = await args.payload.find({
    collection: 'products',
    limit: ids.length,
    pagination: false,
    where: { id: { in: ids } },
  })

  return new Map(products.docs.map((product) => [product.id, product as Product]))
}

/**
 * Finds the processor reference for the order.
 *
 * Vori stores this verbatim and never interprets it, so it is prefixed with
 * the processor name — `stripe:pi_...` — to say what the opaque string on the
 * other side actually is.
 */
const resolvePayment = async (args: {
  order: Order
  payload: Payload
}): Promise<{ cardBrand?: null | string; cardLast4?: null | string; paymentReference: string }> => {
  const { order, payload } = args
  const [first] = order.transactions ?? []

  const transaction =
    typeof first === 'object' && first !== null
      ? first
      : first !== undefined
        ? await payload.findByID({ id: first, collection: 'transactions' })
        : undefined

  const paymentIntentId = transaction?.stripe?.paymentIntentID

  if (!paymentIntentId) {
    throw new TransactionBuildError(
      `Order ${order.id} has no Stripe payment intent to reference. ` +
        'A transaction cannot be recorded without a payment reference.',
    )
  }

  return { paymentReference: `stripe:${paymentIntentId}` }
}

/** Writes the outcome back onto the order and returns it. */
const finish = async (args: {
  detail?: string
  logger: VoriLogger
  order: Order
  payload: Payload
  request?: unknown
  response?: unknown
  result: RecordResult
}): Promise<RecordResult> => {
  const { detail, order, payload, request, response, result } = args

  await payload.update({
    id: order.id,
    collection: 'orders',
    // The hooks on this collection only act on create; updating here cannot
    // re-enqueue the job.
    data: {
      voriRequestBody: (request ?? null) as never,
      voriResponseBody: (response ?? null) as never,
      voriSyncError: detail ?? null,
      voriSyncStatus: result.status,
      voriSyncedAt: result.status === 'recorded' ? new Date().toISOString() : null,
    },
  })

  return { ...result, detail }
}
