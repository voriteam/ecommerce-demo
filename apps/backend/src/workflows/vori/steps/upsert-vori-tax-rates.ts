import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { createTaxRatesWorkflow, updateTaxRatesWorkflow } from "@medusajs/medusa/core-flows"

import { VORI_MODULE } from "../../../modules/vori"
import { isChargeableTaxRate, voriTaxRateToMedusa } from "../../../modules/vori/lib/mapping"
import type VoriModuleService from "../../../modules/vori/service"

export type TaxRatesResult = {
  /** Vori tax rate ID to Medusa tax rate ID, for the rates we can charge. */
  medusaRateIds: Record<string, string>
  /** Rates that are live in Vori, chargeable or not. */
  activeRateIds: string[]
  /** Live rates Medusa has no way to express, by name. */
  unrepresentable: string[]
}

/**
 * Mirrors the banner's tax rates as Medusa tax rates.
 *
 * The rates come from `/v1/tax-rates` rather than from the products, because
 * the copy embedded on a product is the compact form and omits `active` - so
 * it cannot tell a rate a grocer charges from one they have switched off.
 *
 * Matching is on the Vori rate ID in metadata, so a rate whose value a grocer
 * changes is updated in place rather than duplicated.
 */
export const upsertVoriTaxRatesStep = createStep(
  "upsert-vori-tax-rates",
  async (_input: Record<string, never>, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    const vori = container.resolve(VORI_MODULE) as VoriModuleService

    const active = await vori.listTaxRates({ activeOnly: true })

    const chargeable = active.filter(isChargeableTaxRate)
    const unrepresentable = active.filter((rate) => !isChargeableTaxRate(rate))

    if (unrepresentable.length) {
      // A fixed amount per unit sold has no equivalent in Medusa's tax model,
      // which is a percentage of the taxable amount and nothing else.
      logger.warn(
        `vori: ${unrepresentable.length} active tax rates charge a fixed amount per unit, which Medusa cannot express, ` +
          `so they will not be charged at checkout: ${unrepresentable.map((r) => r.name).join(", ")}`,
      )
    }

    const { data: taxRegions } = await query.graph({
      entity: "tax_region",
      fields: ["id", "country_code"],
    })
    const taxRegion = taxRegions[0]

    if (!taxRegion) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "This store has no tax region. Run the store seed before seeding the catalog.",
      )
    }

    const { data: existing } = await query.graph({
      entity: "tax_rate",
      fields: ["id", "metadata", "rate", "name"],
    })

    const medusaRateIds: Record<string, string> = {}
    const byVoriId = new Map<string, { id: string; name: string; rate: null | number }>()
    for (const rate of existing) {
      const voriId = (rate.metadata as Record<string, unknown> | null)?.vori_tax_rate_id
      if (typeof voriId === "string") {
        byVoriId.set(voriId, { id: rate.id, name: rate.name, rate: rate.rate })
      }
    }

    const toCreate = chargeable.filter((rate) => !byVoriId.has(rate.id))
    const toUpdate = chargeable.filter((rate) => byVoriId.has(rate.id))

    if (toCreate.length) {
      const { result } = await createTaxRatesWorkflow(container).run({
        input: toCreate.map((rate) => voriTaxRateToMedusa(rate, taxRegion.id)),
      })
      result.forEach((created, index) => {
        medusaRateIds[toCreate[index].id] = created.id
      })
    }

    for (const rate of toUpdate) {
      const current = byVoriId.get(rate.id)!
      medusaRateIds[rate.id] = current.id

      // Only touch a rate whose value or name has actually moved: an update
      // here is a write against every cart that references it.
      if (Number(current.rate) === Number(rate.value) && current.name === rate.name) continue

      await updateTaxRatesWorkflow(container).run({
        input: {
          selector: { id: current.id },
          update: { name: rate.name, rate: Number(rate.value) },
        },
      })
    }

    logger.info(
      `vori: ${toCreate.length} tax rates created, ${toUpdate.length} matched` +
        (unrepresentable.length ? `, ${unrepresentable.length} unrepresentable` : ""),
    )

    return new StepResponse<TaxRatesResult>({
      activeRateIds: active.map((rate) => rate.id),
      medusaRateIds,
      unrepresentable: unrepresentable.map((rate) => rate.name),
    })
  },
)
