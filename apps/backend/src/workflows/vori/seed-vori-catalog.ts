import { createWorkflow, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { acquireLockStep, releaseLockStep } from "@medusajs/medusa/core-flows"

import { inventoryFromVori } from "../../modules/vori/lib/mapping"
import { applyInventoryLevelsStep } from "./steps/apply-inventory-levels"
import { applyVoriTaxRulesStep } from "./steps/apply-vori-tax-rules"
import { deactivateWithdrawnProductsStep } from "./steps/deactivate-withdrawn-products"
import { fetchVoriCatalogStep } from "./steps/fetch-vori-catalog"
import { fetchProductImagesStep } from "./steps/fetch-product-images"
import { resolveStoreContextStep } from "./steps/resolve-store-context"
import { upsertVoriCategoriesStep } from "./steps/upsert-vori-categories"
import { upsertVoriProductsStep } from "./steps/upsert-vori-products"
import { upsertVoriTaxRatesStep } from "./steps/upsert-vori-tax-rates"

export type SeedCatalogResult = {
  categories: number
  productsDeactivated: number
  imagesFound: number
  imagesFromVori: number
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
/**
 * One catalog sync at a time.
 *
 * The scheduled run and a hand-run `pnpm seed:catalog` do the same work, and
 * two of them interleaving would have both deciding what to create from
 * different snapshots of the store.
 */
export const VORI_CATALOG_LOCK = "vori-catalog-sync"

export const seedVoriCatalogWorkflow = createWorkflow("seed-vori-catalog", () => {
  acquireLockStep({
    key: VORI_CATALOG_LOCK,
    // Fail rather than queue: the next scheduled run covers the same ground.
    timeout: 1,
    ttl: 30 * 60,
  })

  const catalog = fetchVoriCatalogStep({})
  const store = resolveStoreContextStep({})
  const taxRates = upsertVoriTaxRatesStep({})

  const departments = transform({ catalog }, (data) => data.catalog.departments)
  const categoryIds = upsertVoriCategoriesStep(departments)

  // The grocer's own photography comes down with the catalog and is preferred.
  // Anything they have no picture of is matched on the barcode that scans at
  // the register, and a product with no match either way is sold without a
  // picture rather than not sold.
  const photography = fetchProductImagesStep(
    transform({ catalog }, (data) => data.catalog.products),
  )

  const products = upsertVoriProductsStep(
    transform({ catalog, categoryIds, photography, store }, (data) => ({
      categoryIds: data.categoryIds,
      photography: data.photography,
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

  // After the upsert, so a product that came back on sale has already been
  // published again and is not taken straight back down.
  const withdrawn = deactivateWithdrawnProductsStep(
    transform({ catalog, products }, (data) => {
      void data.products
      return data.catalog.products
    }),
  )

  releaseLockStep({ key: VORI_CATALOG_LOCK })

  return new WorkflowResponse(
    transform(
      { catalog, categoryIds, levelsSet, photography, products, taxRates, taxed, withdrawn },
      (data): SeedCatalogResult => ({
        categories: Object.keys(data.categoryIds).length,
        imagesFound: Object.keys(data.photography).length,
        imagesFromVori: Object.values(data.photography).filter((p) => p.source === "vori").length,
        levelsSet: data.levelsSet,
        productsCreated: data.products.created,
        productsDeactivated: data.withdrawn.deactivated,
        productsTaxed: data.taxed.productsTaxed,
        productsUpdated: data.products.updated,
        skipped: data.catalog.skipped,
        taxRatesUnrepresentable: data.taxRates.unrepresentable,
      }),
    ),
  )
})
