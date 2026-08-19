import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

export type StoreContext = {
  salesChannelId: string
  shippingProfileId: string
  stockLocationId: string
}

/**
 * The single sales channel, shipping profile and stock location this demo
 * uses. All three come from the store seed, so a missing one means the store
 * was never bootstrapped and there is nothing useful to do next.
 */
export const resolveStoreContextStep = createStep(
  "resolve-store-context",
  async (_input: Record<string, never>, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const [{ data: salesChannels }, { data: shippingProfiles }, { data: stockLocations }] =
      await Promise.all([
        query.graph({ entity: "sales_channel", fields: ["id"] }),
        query.graph({ entity: "shipping_profile", fields: ["id"] }),
        query.graph({ entity: "stock_location", fields: ["id"] }),
      ])

    const missing = [
      salesChannels.length ? null : "sales channel",
      shippingProfiles.length ? null : "shipping profile",
      stockLocations.length ? null : "stock location",
    ].filter(Boolean)

    if (missing.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `This store has no ${missing.join(", no ")}. Run the store seed before seeding the catalog.`,
      )
    }

    return new StepResponse<StoreContext>({
      salesChannelId: salesChannels[0].id,
      shippingProfileId: shippingProfiles[0].id,
      stockLocationId: stockLocations[0].id,
    })
  },
)
