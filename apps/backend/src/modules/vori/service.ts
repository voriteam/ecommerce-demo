import { MedusaError, MedusaService } from "@medusajs/framework/utils"

import { VoriSyncState } from "./models/vori-sync-state"
import { createVoriClient, paginate, unwrap, type VoriClient, type VoriLogger } from "./lib/client"
import type { VoriConfig } from "./lib/config"
import type {
  VoriStoreDepartment,
  VoriStoreProduct,
  VoriStoreProductInventory,
  VoriTaxRate,
} from "./lib/mapping"
import type { CreateTransactionRequest } from "./lib/transactions"
import type { CreateRefundRequest, VoriTransaction } from "./lib/refunds"
import { normalizePhone } from "./lib/phone"
import {
  missingShopperDetails,
  shopperFromCheckout,
  type CreateShopperRequest,
  type UpdateShopperRequest,
  type VoriShopper,
} from "./lib/shoppers"

const PAGE_SIZE = 100

/** The one sync-state row. There is one Vori store, so there is one row. */
export const SYNC_STATE_ID = "vori-sync-state"

export type VoriModuleOptions = VoriConfig

export type SyncState = {
  cursor: null | string
  last_error: null | string
  last_run_at: Date | null
  last_run_products_updated: number
  last_run_records_seen: number
  next_watermark: null | string
  watermark: null | string
}

/**
 * The Vori integration, as a module.
 *
 * Everything that talks to the grocer-facing API goes through here, so the
 * workflows above stay readable and the credential has exactly one home. The
 * pure request/response shaping lives in `lib/` and is deliberately free of
 * any framework, which is what makes it testable without a database.
 */
class VoriModuleService extends MedusaService({ VoriSyncState }) {
  private client_: undefined | VoriClient
  private readonly logger_: VoriLogger
  readonly options: VoriModuleOptions

  constructor({ logger }: { logger?: VoriLogger }, options: VoriModuleOptions) {
    super(...arguments)

    this.options = options
    this.logger_ = logger ?? console
  }

  /**
   * Built on first use rather than in the constructor: the module is resolved
   * on every boot, including boots that never touch Vori, and a missing key
   * should not stop the application from starting.
   */
  private client(): VoriClient {
    if (!this.client_) {
      this.client_ = createVoriClient({ config: this.options, logger: this.logger_ })
    }
    return this.client_
  }

  private storeId(): string {
    if (!this.options.storeId) {
      throw new MedusaError(MedusaError.Types.INVALID_ARGUMENT, "VORI_STORE_ID is not set")
    }
    return this.options.storeId
  }

  /** Credentials present, so the read endpoints can be called at all. */
  async canRead(): Promise<boolean> {
    return Boolean(this.options.apiKey && this.options.storeId)
  }

  /** Human-readable reason writes are held back, or null when they are not. */
  async writeBlockedReason(): Promise<null | string> {
    if (!this.options.apiKey) return "VORI_API_KEY is not set"
    if (!this.options.storeId) return "VORI_STORE_ID is not set"
    if (!this.options.writeEnabled) return "VORI_WRITE_ENABLED is false"
    return null
  }

  async listDepartments(): Promise<VoriStoreDepartment[]> {
    const storeId = this.storeId()
    const all: VoriStoreDepartment[] = []

    for await (const page of paginate<VoriStoreDepartment>(async (cursor) =>
      unwrap(
        await this.client().GET("/v1/store-departments", {
          params: { query: { limit: PAGE_SIZE, starting_after: cursor, store_id: [storeId] } },
        }),
        { method: "GET", path: "/v1/store-departments" },
      ),
    )) {
      all.push(...page)
    }

    return all
  }

  /**
   * The tax rates configured for the banner.
   *
   * Products carry their own rates, but only in compact form - which leaves
   * out `active`, the flag that says whether a rate is actually charged at the
   * register. This endpoint is the only place that lives, so a rate a grocer
   * has switched off is not applied at checkout.
   *
   * Tax rates are banner-level rather than per-store, so there is no store
   * filter here.
   */
  async listTaxRates(
    options: { activeOnly: boolean } = { activeOnly: true },
  ): Promise<VoriTaxRate[]> {
    const all: VoriTaxRate[] = []

    for await (const page of paginate<VoriTaxRate>(async (cursor) =>
      unwrap(
        await this.client().GET("/v1/tax-rates", {
          params: {
            query: {
              limit: PAGE_SIZE,
              starting_after: cursor,
              ...(options.activeOnly ? { active: true } : {}),
            },
          },
        }),
        { method: "GET", path: "/v1/tax-rates" },
      ),
    )) {
      all.push(...page)
    }

    return all
  }

  /**
   * Every sellable product in the store.
   *
   * `ecommerceOnly` narrows to products the grocer has flagged for online
   * sale. Callers fall back to the full catalog when that returns nothing, so
   * a store that has not set the flag still produces a demo with shelves on it.
   */
  async listProducts(options: { ecommerceOnly: boolean }): Promise<VoriStoreProduct[]> {
    const storeId = this.storeId()
    const all: VoriStoreProduct[] = []

    for await (const page of paginate<VoriStoreProduct>(async (cursor) =>
      unwrap(
        await this.client().GET("/v1/store-products", {
          params: {
            query: {
              active: true,
              include: ["inventory"],
              limit: PAGE_SIZE,
              starting_after: cursor,
              store_id: [storeId],
              ...(options.ecommerceOnly ? { ecommerce_enabled: true } : {}),
            },
          },
        }),
        { method: "GET", path: "/v1/store-products" },
      ),
    )) {
      all.push(...page)
    }

    return all
  }

  /**
   * One page of inventory counts, newest window first.
   *
   * Paging is exposed rather than hidden because the caller commits each page
   * as it arrives — see the sync workflow for why a half-finished run must not
   * advance its watermark.
   */
  async listInventoryPage(options: {
    cursor?: string
    updatedSince?: null | string
  }): Promise<{ data: VoriStoreProductInventory[]; has_more: boolean }> {
    const storeId = this.storeId()

    return unwrap(
      await this.client().GET("/v1/store-product-inventory", {
        params: {
          query: {
            limit: PAGE_SIZE,
            starting_after: options.cursor,
            store_id: [storeId],
            ...(options.updatedSince ? { "updated_at[gte]": options.updatedSince } : {}),
          },
        },
      }),
      { method: "GET", path: "/v1/store-product-inventory" },
    )
  }

  /** Records a transaction against the store. Throws VoriApiError on refusal. */
  async createTransaction(request: CreateTransactionRequest): Promise<unknown> {
    return unwrap(await this.client().POST("/v1/transactions", { body: request }), {
      method: "POST",
      path: "/v1/transactions",
    })
  }

  /**
   * The transaction recorded for one of our orders, or null.
   *
   * Looked up by the order ID we sent as `external_id` rather than kept on our
   * side, so a refund works from what Vori actually holds - including the line
   * and payment IDs a refund has to name, which only exist once Vori has
   * assigned them.
   */
  async findTransactionByExternalId(externalId: string): Promise<VoriTransaction | null> {
    const page = unwrap(
      await this.client().GET("/v1/transactions", {
        params: { query: { external_id: externalId, limit: 2 } },
      }),
      { method: "GET", path: "/v1/transactions" },
    ) as { data: VoriTransaction[] }

    // `external_id` is ours to choose and Vori never enforces uniqueness on
    // it, so more than one match means our own bookkeeping has gone wrong and
    // guessing which to reverse would be worse than refusing.
    if (page.data.length > 1) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `More than one Vori transaction carries external_id ${externalId}`,
      )
    }

    return page.data[0] ?? null
  }

  /** Records a refund against a transaction. Throws VoriApiError on refusal. */
  async refundTransaction(transactionId: string, request: CreateRefundRequest): Promise<unknown> {
    return unwrap(
      await this.client().POST("/v1/transactions/{id}/refunds", {
        params: { path: { id: transactionId } },
        body: request,
      }),
      { method: "POST", path: `/v1/transactions/${transactionId}/refunds` },
    )
  }

  /**
   * The loyalty shopper with this phone number, or null.
   *
   * The number is normalised first, because a shopper who writes it a
   * different way at checkout than they gave at the till is still the same
   * shopper - and looking up the unnormalised form would miss them and enrol a
   * duplicate.
   *
   * `/v1/shoppers` is not in the generated client yet, so this call is made
   * directly. See lib/shoppers.ts for what that assumes.
   */
  async findShopperByPhone(phone: string): Promise<VoriShopper | null> {
    const normalized = normalizePhone(phone)
    if (!normalized) return null

    const list = unwrap(
      await this.client().GET("/v1/shoppers", {
        params: { query: { phone_number: normalized, limit: 1 } },
      }),
      { method: "GET", path: "/v1/shoppers" },
    )

    return list.data[0] ?? null
  }

  /**
   * Fills in details a shopper's record is missing.
   *
   * Takes a partial: nothing on the update request is actually required. The
   * generated type marks `enrolled_in_loyalty_program` as always present only
   * because the schema gives it a default, which is why the body is cast here
   * rather than padded out with a field this has no reason to send.
   */
  async updateShopper(id: string, request: Partial<UpdateShopperRequest>): Promise<VoriShopper> {
    return unwrap(
      await this.client().PATCH("/v1/shoppers/{id}", {
        params: { path: { id } },
        body: request as UpdateShopperRequest,
      }),
      { method: "PATCH", path: `/v1/shoppers/${id}` },
    )
  }

  /** Enrols a shopper. Throws VoriApiError if the API refuses. */
  async createShopper(request: CreateShopperRequest): Promise<VoriShopper> {
    return unwrap(await this.client().POST("/v1/shoppers", { body: request }), {
      method: "POST",
      path: "/v1/shoppers",
    })
  }

  /**
   * The shopper for this phone number, enrolling them if they are new.
   *
   * Looked up first so a returning shopper keeps their points. Two checkouts
   * racing on the same number would both try to enrol, so a create that fails
   * falls back to another lookup rather than to an error: whichever request
   * lost the race still ends up with the shopper the other one made.
   */
  async findOrCreateShopper(details: {
    email?: null | string
    firstName?: null | string
    lastName?: null | string
    phone: string
    postalCode?: null | string
  }): Promise<VoriShopper | null> {
    const normalized = normalizePhone(details.phone)
    if (!normalized) return null

    const existing = await this.findShopperByPhone(normalized)

    if (existing) {
      // A record created at the till often has nothing but a phone number on
      // it. Checkout knows more, so fill the blanks - but only the blanks.
      const update = missingShopperDetails(existing, details)
      if (!update) return existing

      try {
        return await this.updateShopper(existing.id, update)
      } catch (error) {
        // Knowing who the shopper is matters less than crediting their points,
        // so a failed update returns the shopper we already found.
        this.logger_.warn(
          `vori: could not fill in details for shopper ${existing.id} — ` +
            (error instanceof Error ? error.message : String(error)),
        )
        return existing
      }
    }

    try {
      return await this.createShopper(shopperFromCheckout({ ...details, phone: normalized }))
    } catch (error) {
      const raced = await this.findShopperByPhone(normalized)
      if (raced) return raced
      throw error
    }
  }

  async getSyncState(): Promise<SyncState> {
    const existing = await this.listVoriSyncStates({ id: SYNC_STATE_ID })

    if (existing.length) {
      return existing[0] as unknown as SyncState
    }

    const created = await this.createVoriSyncStates({ id: SYNC_STATE_ID })
    return (Array.isArray(created) ? created[0] : created) as unknown as SyncState
  }

  async updateSyncState(data: Partial<Omit<SyncState, "id">>): Promise<void> {
    await this.getSyncState()
    await this.updateVoriSyncStates({ id: SYNC_STATE_ID, ...data })
  }
}

export default VoriModuleService
