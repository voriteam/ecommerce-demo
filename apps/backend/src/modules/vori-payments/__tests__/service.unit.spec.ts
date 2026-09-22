import { MedusaError } from "@medusajs/framework/utils"

import type { VoriConfig } from "../../vori/lib/config"
import { VoriApiError } from "../../vori/lib/errors"
import VoriPaymentsProviderService from "../service"

const POST = jest.fn()
const GET = jest.fn()

jest.mock("../../vori/lib/client", () => ({
  ...jest.requireActual("../../vori/lib/client"),
  createVoriClient: () => ({ GET, POST }),
}))

const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }

const config = (overrides: Partial<VoriConfig> = {}): VoriConfig => ({
  apiKey: "sk_test",
  baseUrl: "https://api.vori.test",
  openFoodFactsEnabled: false,
  storeId: "4320",
  syncCron: "* * * * *",
  syncEnabled: false,
  updateShopperFromCheckout: false,
  writeEnabled: true,
  ...overrides,
})

const provider = (overrides: Partial<VoriConfig> = {}) =>
  new VoriPaymentsProviderService({ logger: logger as any }, config(overrides))

const ok = <T>(data: T, status = 201) => ({ data, response: new Response(null, { status }) })

const refused = (status: number, errorCode: string) => ({
  error: { error_code: errorCode },
  response: new Response(null, { status }),
})

const session = {
  amount_cents: 1249,
  card_brand: "VISA",
  cart_id: "cart_01",
  currency_code: "usd",
  last4: "1111",
  session_id: "payses_01",
  token: "DC4:token",
}

const approvedPayment = {
  amount: "12.49",
  id: "pay_01jz8k",
  payment_method: { brand: "visa", masked_account_number: "XXXXXXXXXXXX1111", type: "card" },
  status: "approved",
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe("starting a payment", () => {
  it("keeps the amount in cents beside whatever the storefront sent", async () => {
    const result = await provider().initiatePayment({
      amount: 12.49,
      currency_code: "usd",
      data: { session_id: "payses_01", token: "DC4:token" },
    })

    expect(result).toEqual({
      id: "payses_01",
      data: {
        amount_cents: 1249,
        currency_code: "usd",
        session_id: "payses_01",
        token: "DC4:token",
      },
    })
  })
})

describe("authorizing a payment", () => {
  it("records the request and charges nothing while writes are off", async () => {
    const result = await provider({ writeEnabled: false }).authorizePayment({ data: session })

    expect(POST).not.toHaveBeenCalled()
    expect(result.status).toBe("captured")
    expect(result.data).not.toHaveProperty("token")
    expect(result.data).toMatchObject({
      vori_payment_request: {
        amount: "12.49",
        idempotency_key: "payses_01",
        metadata: { medusa_cart_id: "cart_01" },
        store_id: "4320",
      },
      vori_write_blocked: "VORI_WRITE_ENABLED is false",
    })
    expect((result.data as any).vori_payment_request.token).toBeUndefined()
  })

  it("charges through Vori and keeps the payment, not the token", async () => {
    POST.mockResolvedValue(ok(approvedPayment))

    const result = await provider().authorizePayment({ data: session })

    expect(POST).toHaveBeenCalledWith("/v1/payments", {
      body: {
        amount: "12.49",
        idempotency_key: "payses_01",
        metadata: { medusa_cart_id: "cart_01" },
        store_id: "4320",
        token: "DC4:token",
      },
    })
    expect(result.status).toBe("captured")
    expect(result.data).not.toHaveProperty("token")
    expect(result.data).toMatchObject({
      card_brand: "visa",
      last4: "1111",
      vori_payment_id: "pay_01jz8k",
      vori_payment_status: "approved",
    })
  })

  it("does not charge again for a session already approved", async () => {
    const data = {
      ...session,
      token: undefined,
      vori_payment_id: "pay_01jz8k",
      vori_payment_status: "approved",
    }

    const result = await provider().authorizePayment({ data })

    expect(POST).not.toHaveBeenCalled()
    expect(result.status).toBe("captured")
  })

  it("asks for a card when there is no token", async () => {
    const result = await provider().authorizePayment({ data: { ...session, token: undefined } })

    expect(result.status).toBe("requires_more")
  })

  it("turns a decline into an error the shopper can read", async () => {
    POST.mockResolvedValue(refused(402, "card_declined"))

    const attempt = provider().authorizePayment({ data: session })

    await expect(attempt).rejects.toBeInstanceOf(MedusaError)
    await expect(attempt).rejects.toThrow(/declined/)
  })

  it("passes an unexplained failure through unchanged", async () => {
    POST.mockResolvedValue(refused(500, "internal_error"))

    await expect(provider().authorizePayment({ data: session })).rejects.toBeInstanceOf(
      VoriApiError,
    )
  })
})

describe("refunding a payment", () => {
  const taken = {
    ...session,
    token: undefined,
    vori_payment_id: "pay_01jz8k",
    vori_payment_status: "approved",
  }

  it("refunds through Vori under a key naming the refund's position", async () => {
    POST.mockResolvedValue(ok({ id: "re_01", status: "approved" }))

    const result = await provider().refundPayment({
      amount: { value: "5", precision: 20 } as any,
      context: { idempotency_key: "ref_01" },
      data: taken,
    })

    expect(POST).toHaveBeenCalledWith("/v1/refunds", {
      body: {
        amount: "5.00",
        idempotency_key: "pay_01jz8k:5.00:0",
        metadata: { medusa_refund_id: "ref_01" },
        payment_id: "pay_01jz8k",
        store_id: "4320",
      },
    })
    expect(result.data).toMatchObject({
      vori_refunds: [
        {
          amount_cents: 500,
          idempotency_key: "pay_01jz8k:5.00:0",
          refund_id: "re_01",
          status: "approved",
        },
      ],
    })
  })

  it("retries a failed refund under the same key", async () => {
    POST.mockResolvedValueOnce(refused(503, "service_unavailable"))
    POST.mockResolvedValueOnce(ok({ id: "re_01", status: "approved" }))

    await expect(
      provider().refundPayment({ amount: 5, context: { idempotency_key: "ref_01" }, data: taken }),
    ).rejects.toBeInstanceOf(VoriApiError)
    await provider().refundPayment({
      amount: 5,
      context: { idempotency_key: "ref_02" },
      data: taken,
    })

    expect(POST.mock.calls[0][1].body.idempotency_key).toBe("pay_01jz8k:5.00:0")
    expect(POST.mock.calls[1][1].body.idempotency_key).toBe("pay_01jz8k:5.00:0")
  })

  it("sends nothing for a payment that was never taken through Vori", async () => {
    const result = await provider().refundPayment({
      amount: 12.49,
      data: { ...session, token: undefined, vori_write_blocked: "VORI_WRITE_ENABLED is false" },
    })

    expect(POST).not.toHaveBeenCalled()
    expect(result.data).toMatchObject({
      vori_refunds: [{ amount_cents: 1249, skipped: "no payment was taken through Vori" }],
    })
  })

  it("keeps the refund it would have made while writes are off", async () => {
    const result = await provider({ writeEnabled: false }).refundPayment({
      amount: 12.49,
      data: taken,
    })

    expect(POST).not.toHaveBeenCalled()
    expect(result.data).toMatchObject({
      vori_refunds: [
        {
          amount_cents: 1249,
          idempotency_key: "pay_01jz8k:12.49:0",
          skipped: "VORI_WRITE_ENABLED is false",
        },
      ],
    })
  })

  it("gives back only what is left when a payment is cancelled", async () => {
    POST.mockResolvedValue(ok({ id: "re_02", status: "approved" }))

    await provider().cancelPayment({
      data: {
        ...taken,
        vori_refunds: [
          { amount_cents: 500, idempotency_key: "pay_01jz8k:5.00:0", status: "approved" },
        ],
      },
    })

    expect(POST.mock.calls[0][1].body).toMatchObject({
      amount: "7.49",
      idempotency_key: "pay_01jz8k:7.49:1",
    })
  })

  it("cancels nothing when no payment was taken", async () => {
    await provider().cancelPayment({ data: { ...session, token: undefined } })

    expect(POST).not.toHaveBeenCalled()
  })
})

describe("reading a payment's status", () => {
  it("asks Vori for a payment it took", async () => {
    GET.mockResolvedValue(ok({ ...approvedPayment, status: "declined" }, 200))

    const result = await provider().getPaymentStatus({
      data: { vori_payment_id: "pay_01jz8k", vori_payment_status: "approved" },
    })

    expect(GET).toHaveBeenCalledWith("/v1/payments/{id}", {
      params: { path: { id: "pay_01jz8k" } },
    })
    expect(result.status).toBe("error")
  })

  it("reports a payment held back by writes as done, without asking", async () => {
    const result = await provider({ writeEnabled: false }).getPaymentStatus({
      data: { vori_write_blocked: "VORI_WRITE_ENABLED is false" },
    })

    expect(GET).not.toHaveBeenCalled()
    expect(result.status).toBe("captured")
  })
})
