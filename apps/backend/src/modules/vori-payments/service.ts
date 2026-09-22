import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  Logger,
  PaymentSessionStatus,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import { AbstractPaymentProvider, MedusaError } from "@medusajs/framework/utils"

import { createVoriClient, unwrap, type VoriClient } from "../vori/lib/client"
import { writeBlockedReason, type VoriConfig, type VoriPaymentsMode } from "../vori/lib/config"
import { VoriApiError } from "../vori/lib/errors"
import {
  amountToCents,
  buildCreatePaymentRequest,
  buildCreateRefundRequest,
  isUnconfirmedPayment,
  paymentRefusalMessage,
  refusalDetails,
  remainingRefundableCents,
  type RecordedRefund,
  type VoriPayment,
  type VoriPaymentStatus,
} from "../vori/lib/payments-api"

type SessionData = {
  amount_cents?: number
  card_brand?: string
  cart_id?: string
  currency_code?: string
  last4?: string
  mode?: VoriPaymentsMode
  session_id?: string
  token?: string
  vori_payment_id?: string
  vori_payment_status?: VoriPaymentStatus
  vori_payment_unconfirmed_at?: string
  vori_refunds?: RecordedRefund[]
  vori_write_blocked?: string
} & Record<string, unknown>

const SESSION_STATUS: Record<VoriPaymentStatus, PaymentSessionStatus> = {
  approved: "captured",
  declined: "error",
  pending: "pending",
}

/**
 * The card is tokenized in the browser and the token arrives as session data.
 * A sale on Vori authorizes and captures in one step, so an approved payment
 * is reported as captured and capture itself does nothing.
 *
 * Writes follow the rest of the integration: while they are held back, the
 * request that would have been sent is kept on the payment, nothing is
 * charged, and checkout still completes.
 */
class VoriPaymentsProviderService extends AbstractPaymentProvider<VoriConfig> {
  static identifier = "vori-payments"

  protected logger_: Logger
  private client_: VoriClient | undefined

  constructor(container: { logger: Logger }, options: VoriConfig) {
    super(container, options)
    this.logger_ = container.logger
  }

  private client(): VoriClient {
    if (!this.client_) {
      this.client_ = createVoriClient({ config: this.config, logger: this.logger_ })
    }
    return this.client_
  }

  private refusal(error: unknown, type: string): unknown {
    if (error instanceof VoriApiError) {
      const message = paymentRefusalMessage(error)
      if (message) return new MedusaError(type, message)
    }
    return error
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const data = (input.data ?? {}) as SessionData

    return {
      id: data.session_id ?? "",
      data: {
        ...data,
        amount_cents: amountToCents(input.amount),
        currency_code: input.currency_code,
      },
    }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    return {
      data: {
        ...input.data,
        amount_cents: amountToCents(input.amount),
        currency_code: input.currency_code,
      },
    }
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const {
      token,
      vori_payment_unconfirmed_at: unconfirmedAt,
      ...data
    } = (input.data ?? {}) as SessionData

    if (data.vori_payment_id && data.vori_payment_status === "approved") {
      return { data, status: "captured" }
    }

    if (!token) return { data, status: "requires_more" }

    const request = buildCreatePaymentRequest({
      amountCents: data.amount_cents ?? 0,
      cartId: data.cart_id,
      currencyCode: data.currency_code ?? "",
      mode: this.config.paymentsMode,
      sessionId: data.session_id ?? input.context?.idempotency_key ?? "",
      storeId: this.config.storeId ?? "",
      token,
    })

    const blocked = writeBlockedReason(this.config)

    if (blocked) {
      this.logger_.info(`vori-payments: nothing charged for session ${data.session_id}, ${blocked}`)

      return {
        data: {
          ...data,
          mode: request.mode,
          vori_payment_request: { ...request, token: undefined },
          vori_write_blocked: blocked,
        },
        status: "captured",
      }
    }

    let payment: VoriPayment
    try {
      payment = unwrap(await this.client().POST("/v1/payments", { body: request }), {
        method: "POST",
        path: "/v1/payments",
      })
    } catch (error) {
      if (!(error instanceof VoriApiError)) throw error

      const { paymentId, processorMessage } = refusalDetails(error)
      const reference = paymentId ? { vori_payment_id: paymentId } : {}

      // Left open rather than failed, with its token, so the next attempt from
      // this cart asks Vori under the same key and learns what happened instead
      // of charging the card a second time.
      if (isUnconfirmedPayment(error)) {
        this.logger_.warn(
          `vori-payments: no answer for ${paymentId ?? data.session_id}, may be charged`,
        )

        return {
          data: {
            ...data,
            ...reference,
            token,
            vori_payment_status: "pending",
            vori_payment_unconfirmed_at: unconfirmedAt ?? new Date().toISOString(),
          },
          status: "requires_more",
        }
      }

      if (error.errorCode === "card_declined") {
        this.logger_.info(
          `vori-payments: ${paymentId ?? data.session_id} declined` +
            (processorMessage ? ` (${processorMessage})` : ""),
        )

        // The answer to an unconfirmed payment is settled on the session, since
        // a throw would leave it marked unconfirmed for good.
        if (unconfirmedAt) {
          return {
            data: { ...data, ...reference, vori_payment_status: "declined" },
            status: "error",
          }
        }
      }

      throw this.refusal(error, MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR)
    }

    const brand = payment.payment_method?.brand ?? data.card_brand
    const last4 = payment.payment_method?.masked_account_number?.slice(-4) ?? data.last4

    return {
      data: {
        ...data,
        ...(brand ? { card_brand: brand } : {}),
        ...(last4 ? { last4 } : {}),
        mode: payment.mode ?? request.mode,
        vori_payment_id: payment.id,
        vori_payment_status: payment.status,
      },
      status: SESSION_STATUS[payment.status],
    }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    return { data: input.data }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const data = (input.data ?? {}) as SessionData

    return {
      data: await this.refund(data, amountToCents(input.amount), input.context?.idempotency_key),
    }
  }

  /**
   * Medusa cancels a payment it has not captured, and one whose authorization
   * it could not record after Vori had already charged. Either way whatever
   * is left on the card goes back.
   */
  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const data = (input.data ?? {}) as SessionData
    if (!data.vori_payment_id || data.vori_payment_status !== "approved") return { data }

    const remaining = remainingRefundableCents(data.amount_cents ?? 0, data.vori_refunds ?? [])
    if (remaining <= 0) return { data }

    return { data: await this.refund(data, remaining, undefined) }
  }

  private async refund(
    data: SessionData,
    amountCents: number,
    medusaRefundId: string | undefined,
  ): Promise<SessionData> {
    const refunds = data.vori_refunds ?? []
    const paymentId = data.vori_payment_id

    if (!paymentId) {
      return {
        ...data,
        vori_refunds: [
          ...refunds,
          { amount_cents: amountCents, skipped: "no payment was taken through Vori" },
        ],
      }
    }

    const request = buildCreateRefundRequest({
      amountCents,
      index: refunds.length,
      medusaRefundId,
      // A refund goes back through the account the payment was taken on.
      mode: data.mode ?? this.config.paymentsMode,
      paymentId,
      storeId: this.config.storeId ?? "",
    })

    const blocked = writeBlockedReason(this.config)

    if (blocked) {
      this.logger_.info(`vori-payments: nothing refunded for ${paymentId}, ${blocked}`)

      return {
        ...data,
        vori_refunds: [
          ...refunds,
          { amount_cents: amountCents, idempotency_key: request.idempotency_key, skipped: blocked },
        ],
      }
    }

    let refund
    try {
      refund = unwrap(await this.client().POST("/v1/refunds", { body: request }), {
        method: "POST",
        path: "/v1/refunds",
      })
    } catch (error) {
      if (!(error instanceof VoriApiError)) throw error

      const { processorMessage, refundId } = refusalDetails(error)
      this.logger_.warn(
        `vori-payments: refund ${refundId ?? request.idempotency_key} of ${paymentId} ` +
          `failed with ${error.errorCode ?? error.status}` +
          (processorMessage ? ` (${processorMessage})` : ""),
      )

      // Nothing is recorded, so a retry comes back with the same position in
      // the list and therefore the same key, and learns what happened.
      if (isUnconfirmedPayment(error)) {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          "The card processor did not answer, so this refund may already have gone through. " +
            "Trying again checks the same refund rather than making a new one.",
        )
      }

      throw this.refusal(error, MedusaError.Types.NOT_ALLOWED)
    }

    return {
      ...data,
      vori_refunds: [
        ...refunds,
        {
          amount_cents: amountCents,
          idempotency_key: request.idempotency_key,
          refund_id: refund.id,
          status: refund.status,
        },
      ],
    }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: input.data }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const data = (input.data ?? {}) as SessionData

    if (data.vori_write_blocked) return { data, status: "captured" }
    if (!data.vori_payment_id) return { data, status: "pending" }

    const payment = await this.fetchPayment(data.vori_payment_id)
    const status = payment?.status ?? data.vori_payment_status ?? "pending"

    return { data: { ...data, vori_payment_status: status }, status: SESSION_STATUS[status] }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const data = (input.data ?? {}) as SessionData
    if (!data.vori_payment_id) return { data }

    const payment = await this.fetchPayment(data.vori_payment_id)
    return { data: payment ? { ...data, vori_payment_status: payment.status } : data }
  }

  /** Null while writes are held back: a read is not needed to report state we never changed. */
  private async fetchPayment(id: string): Promise<null | VoriPayment> {
    if (writeBlockedReason(this.config)) return null

    return unwrap(await this.client().GET("/v1/payments/{id}", { params: { path: { id } } }), {
      method: "GET",
      path: `/v1/payments/${id}`,
    })
  }

  async getWebhookActionAndData(
    _payload: ProviderWebhookPayload["payload"],
  ): Promise<WebhookActionResult> {
    return { action: "not_supported" }
  }
}

export default VoriPaymentsProviderService
