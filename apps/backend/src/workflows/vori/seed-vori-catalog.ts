import { createWorkflow, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import { inventoryFromVori } from "../../modules/vori/lib/mapping"
import { applyInventoryLevelsStep } from "./steps/apply-inventory-levels"
import { applyVoriTaxRulesStep } from "./steps/apply-vori-tax-rules"
import { fetchVoriCatalogStep } from "./steps/fetch-vori-catalog"
import { resolveStoreContextStep } from "./steps/resolve-store-context"
import { upsertVoriCategoriesStep } from "./steps/upsert-vori-categories"
import { upsertVoriProductsStep } from "./steps/upsert-vori-products"
import { upsertVoriTaxRatesStep } from "./steps/upsert-vori-tax-rates"

export type SeedCatalogResult = {
  categories: number
  levelsSet: number
  productsCreated: number
  productsTaxed: number
  productsUpdated: number
  skipped: Record<string, number>
  taxRatesUnrepresentable: string[]
}

/**
 * Builds the storefront's catalog from a Vori store.
 *
 * Safe to run repeatedly: products are matched on their Vori identifier, so a
 * second run refreshes names, prices and stock rather than duplicating the
 * shelves. Opening stock comes from the same payload as the products, so the
 * store has believable quantities before the sync job has ever run.
 */
export const seedVoriCatalogWorkflow = createWorkflow("seed-vori-catalog", () => {
  const catalog = fetchVoriCatalogStep({})
  const store = resolveStoreContextStep({})
  const taxRates = upsertVoriTaxRatesStep({})

  const departments = transform({ catalog }, (data) => data.catalog.departments)
  const categoryIds = upsertVoriCategoriesStep(departments)

  const products = upsertVoriProductsStep(
    transform({ catalog, categoryIds, store }, (data) => ({
      categoryIds: data.categoryIds,
      products: data.catalog.products,
      store: data.store,
    })),
  )

  // After the products exist, because a rule joins a rate to a product ID.
  const taxed = applyVoriTaxRulesStep(
    transform({ catalog, products, taxRates }, (data) => ({
      products: data.catalog.products,
      taxRates: data.taxRates,
    })),
  )

  const levelsSet = applyInventoryLevelsStep(
    transform({ catalog, store }, (data) => ({
      counts: data.catalog.products.map((product) => ({
        quantity: inventoryFromVori(product.inventory?.current),
        raw: product.inventory?.current ?? null,
        storeProductId: product.id,
      })),
      stockLocationId: data.store.stockLocationId,
    })),
  )

  return new WorkflowResponse(
    transform(
      { catalog, categoryIds, levelsSet, products, taxRates, taxed },
      (data): SeedCatalogResult => ({
        categories: Object.keys(data.categoryIds).length,
        levelsSet: data.levelsSet,
        productsCreated: data.products.created,
        productsTaxed: data.taxed.productsTaxed,
        productsUpdated: data.products.updated,
        skipped: data.catalog.skipped,
        taxRatesUnrepresentable: data.taxRates.unrepresentable,
      }),
    ),
  )
})
