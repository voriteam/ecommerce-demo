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
