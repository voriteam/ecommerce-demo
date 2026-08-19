import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { VORI_MODULE } from "../../../modules/vori"
import type VoriModuleService from "../../../modules/vori/service"
import {
  skipReasonFor,
  type SkipReason,
  type VoriStoreDepartment,
  type VoriStoreProduct,
} from "../../../modules/vori/lib/mapping"

export type FetchedCatalog = {
  departments: VoriStoreDepartment[]
  products: VoriStoreProduct[]
  skipped: Record<string, number>
}

/**
 * Pulls the store's departments and sellable products.
 *
 * The `ecommerce_enabled` flag is how a grocer says "this belongs online", but
 * plenty of stores have never set it. Rather than hand back an empty catalog
 * and an empty demo, this falls back to everything active and says so.
 */
export const fetchVoriCatalogStep = createStep(
  "fetch-vori-catalog",
  async (_input: Record<string, never>, { container }) => {
    const vori = container.resolve(VORI_MODULE) as VoriModuleService
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

    const departments = (await vori.listDepartments()).filter((d) => !d.deactivated_at)

    let products = await vori.listProducts({ ecommerceOnly: true })

    if (products.length === 0) {
      logger.warn(
        "vori: no products are flagged ecommerce_enabled in this store, falling back to the full active catalog",
      )
      products = await vori.listProducts({ ecommerceOnly: false })
    }

    const skipped: Record<string, number> = {}
    const sellable: VoriStoreProduct[] = []

    for (const product of products) {
      const reason: null | SkipReason = skipReasonFor(product)
      if (reason) {
        skipped[reason] = (skipped[reason] ?? 0) + 1
        continue
      }
      sellable.push(product)
    }

    logger.info(
      `vori: ${departments.length} departments, ${sellable.length} sellable products, ` +
        `${products.length - sellable.length} skipped`,
    )

    return new StepResponse<FetchedCatalog>({ departments, products: sellable, skipped })
  },
)
