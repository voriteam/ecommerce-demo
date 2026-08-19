import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { setTaxRateRulesWorkflow } from "@medusajs/medusa/core-flows"

import { chargeableRatesFor, type VoriStoreProduct } from "../../../modules/vori/lib/mapping"
import type { TaxRatesResult } from "./upsert-vori-tax-rates"

export type ApplyTaxRulesInput = {
  products: VoriStoreProduct[]
  taxRates: TaxRatesResult
}

/**
 * Points each Medusa tax rate at the products that carry it.
 *
 * Medusa charges a rate on a product when a rule joins the two, so this is
 * what turns a mirrored rate into tax on a receipt. The rules for a rate are
 * set wholesale rather than added to, which is what makes a re-seed correct:
 * a product a grocer has made exempt loses its rule instead of keeping it
 * forever.
 *
 * A product with no chargeable rate simply gets no rule and is sold untaxed,
 * which is the right answer for most of a grocery catalog.
 */
export const applyVoriTaxRulesStep = createStep(
  "apply-vori-tax-rules",
  async (input: ApplyTaxRulesInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

    const { products, taxRates } = input
    const medusaRateIds = Object.keys(taxRates.medusaRateIds)

    if (medusaRateIds.length === 0) {
      logger.info("vori: no chargeable tax rates, so every product is sold untaxed")
      return new StepResponse({ productsTaxed: 0, rules: 0 })
    }

    const { data: medusaProducts } = await query.graph({
      entity: "product",
      fields: ["id", "external_id"],
      filters: { external_id: products.map((p) => p.id) },
    })

    const productIdByExternalId = new Map(
      medusaProducts.filter((p) => p.external_id).map((p) => [p.external_id as string, p.id]),
    )

    const activeRateIds = new Set(taxRates.activeRateIds)

    // One list of product IDs per Vori rate.
    const productIdsByVoriRate = new Map<string, string[]>()
    const taxedProducts = new Set<string>()

    for (const product of products) {
      const productId = productIdByExternalId.get(product.id)
      if (!productId) continue

      for (const rate of chargeableRatesFor(product, activeRateIds)) {
        if (!taxRates.medusaRateIds[rate.id]) continue

        const ids = productIdsByVoriRate.get(rate.id) ?? []
        ids.push(productId)
        productIdsByVoriRate.set(rate.id, ids)
        taxedProducts.add(productId)
      }
    }

    let rules = 0

    for (const [voriRateId, medusaRateId] of Object.entries(taxRates.medusaRateIds)) {
      const productIds = productIdsByVoriRate.get(voriRateId) ?? []

      await setTaxRateRulesWorkflow(container).run({
        input: {
          tax_rate_ids: [medusaRateId],
          rules: productIds.map((id) => ({ reference: "product", reference_id: id })),
        },
      })

      rules += productIds.length
    }

    logger.info(
      `vori: ${taxedProducts.size} products are taxable, across ${rules} product-to-rate rules`,
    )

    return new StepResponse({ productsTaxed: taxedProducts.size, rules })
  },
)
