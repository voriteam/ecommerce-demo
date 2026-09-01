import { MedusaContainer } from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  ModuleRegistrationName,
  Modules,
} from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateProductsWorkflow,
  updateRegionsWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"

const STORE_NAME = "Vori Market"
const REGION_NAME = "United States"
const PICKUP_OPTION_NAME = "Store pickup"

const GIFT_CARD_HANDLE = "vori-gift-card"
const GIFT_CARD_OPTION = "Denomination"
// Dollar face values sold. A gift card is not a Vori product and has no store
// product behind it, so unlike the catalog its price is set here rather than
// mirrored from Vori.
const GIFT_CARD_DENOMINATIONS = [25, 50, 100]
// A designed card image shipped in the storefront's public folder, referenced by
// a root-relative URL so it resolves against the storefront wherever it runs
// rather than baking in a host.
const GIFT_CARD_IMAGE = "/gift-card.png"

/**
 * Bootstraps an empty US grocery store.
 *
 * Deliberately ships no products: the catalog is the grocer's, and it arrives
 * from the Vori API when you run `pnpm seed:catalog`. What is set up here is
 * everything a checkout needs before that catalog can be sold — one sales
 * channel, one USD region, one stock location standing in for the physical
 * store, and a pickup option.
 *
 * Pickup is free on purpose. Every order this demo records is a pickup order,
 * and the transaction it writes to Vori contains only the items on the shelf.
 * A shipping charge would make the amount the shopper paid disagree with the
 * lines in the grocer's books, and the order write refuses to record a
 * transaction that does not reconcile.
 *
 * Every step looks before it creates. A migration script that fails halfway is
 * not marked complete, so the next `db:migrate` runs it again — and a seed
 * that only knew how to create would build a second store on top of the first,
 * leaving a storefront pointed at a sales channel with no stock behind it.
 *
 * Runs as part of `medusa db:migrate`.
 */
export default async function initial_data_seed({ container }: { container: MedusaContainer }) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const fulfillmentModuleService = container.resolve(ModuleRegistrationName.FULFILLMENT)

  const countries = ["us"]

  const first = async <T extends Record<string, any>>(
    entity: string,
    fields: string[],
    match: (row: T) => boolean,
  ): Promise<T | undefined> => {
    const { data } = await query.graph({ entity, fields })
    return (data as T[]).find(match)
  }

  logger.info("Seeding store data...")

  let salesChannel = await first<{ id: string; name: string }>(
    "sales_channel",
    ["id", "name"],
    (row) => row.name === STORE_NAME,
  )
  if (!salesChannel) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: [{ name: STORE_NAME, description: "The demo storefront" }] },
    })
    salesChannel = result[0]
  }

  type PublishableKey = { id: string; token: string }

  let apiKey = await first<{ id: string; revoked_at: null | string; token: string; type: string }>(
    "api_key",
    ["id", "token", "type", "revoked_at"],
    (row) => row.type === "publishable" && !row.revoked_at,
  ).then((row) => row as PublishableKey | undefined)

  if (!apiKey) {
    const { result } = await createApiKeysWorkflow(container).run({
      input: { api_keys: [{ title: "Storefront", type: "publishable", created_by: "" }] },
    })
    apiKey = result[0]
  }

  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: { id: apiKey.id, add: [salesChannel!.id] },
  })

  // Medusa creates a store on its own during migration, so this renames the
  // one that is already there rather than adding a second.
  const store = await first<{ id: string }>("store", ["id"], () => true)
  if (store) {
    await updateStoresWorkflow(container).run({
      input: {
        selector: { id: store.id },
        update: {
          name: STORE_NAME,
          supported_currencies: [{ currency_code: "usd", is_default: true }],
          default_sales_channel_id: salesChannel!.id,
        },
      },
    })
  }

  logger.info("Seeding region data...")
  // Stripe is only registered as a provider when a key is configured, and
  // naming one that is not registered fails outright.
  const paymentProviders = process.env.STRIPE_API_KEY
    ? ["pp_stripe_stripe", "pp_system_default"]
    : ["pp_system_default"]

  let region = await first<{ id: string; name: string }>(
    "region",
    ["id", "name"],
    (row) => row.name === REGION_NAME,
  )
  if (!region) {
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: REGION_NAME,
            currency_code: "usd",
            countries,
            payment_providers: paymentProviders,
          },
        ],
      },
    })
    region = result[0]
  }

  // Reconciled on every run rather than only at creation. A store seeded
  // before a Stripe key was configured would otherwise keep offering nothing
  // but the manual provider at checkout, with nothing on screen to say why -
  // so adding the key and running the seed again is all it takes.
  const { data: regionProviders } = await query.graph({
    entity: "region_payment_provider",
    fields: ["payment_provider_id", "region_id"],
  })
  const alreadyEnabled = regionProviders
    .filter((row) => row.region_id === region!.id)
    .map((row) => row.payment_provider_id as string)
  const missingProviders = paymentProviders.filter((id) => !alreadyEnabled.includes(id))

  if (missingProviders.length) {
    await updateRegionsWorkflow(container).run({
      input: {
        selector: { id: region.id },
        update: { payment_providers: paymentProviders },
      },
    })
    logger.info(`Enabled on ${REGION_NAME}: ${missingProviders.join(", ")}`)
  }

  logger.info("Seeding tax regions...")
  const { data: taxRegions } = await query.graph({ entity: "tax_region", fields: ["country_code"] })
  const missingTaxRegions = countries.filter(
    (code) => !taxRegions.some((row) => row.country_code === code),
  )
  if (missingTaxRegions.length) {
    await createTaxRegionsWorkflow(container).run({
      input: missingTaxRegions.map((country_code) => ({ country_code, provider_id: "tp_system" })),
    })
  }

  logger.info("Seeding stock location data...")
  let stockLocation = await first<{ id: string; name: string }>(
    "stock_location",
    ["id", "name"],
    (row) => row.name === STORE_NAME,
  )
  if (!stockLocation) {
    const { result } = await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          {
            name: STORE_NAME,
            address: { city: "San Francisco", country_code: "US", address_1: "" },
          },
        ],
      },
    })
    stockLocation = result[0]
  }

  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation!.id },
    [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
  })

  logger.info("Seeding fulfillment data...")
  // Core creates a default profile during migration, but not in every context
  // this seed runs in, so it is created here when it is missing.
  const { data: shippingProfiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
  })
  let shippingProfile: { id: string } = shippingProfiles[0]
  if (!shippingProfile) {
    const { result } = await createShippingProfilesWorkflow(container).run({
      input: { data: [{ name: "Default", type: "default" }] },
    })
    shippingProfile = result[0]
  }

  const fulfillmentSetName = `${STORE_NAME} pickup`
  let fulfillmentSet = await first<{ id: string; name: string; service_zones: { id: string }[] }>(
    "fulfillment_set",
    ["id", "name", "service_zones.id"],
    (row) => row.name === fulfillmentSetName,
  )
  if (!fulfillmentSet) {
    fulfillmentSet = (await fulfillmentModuleService.createFulfillmentSets({
      name: fulfillmentSetName,
      type: "shipping",
      service_zones: [{ name: REGION_NAME, geo_zones: [{ country_code: "us", type: "country" }] }],
    })) as unknown as typeof fulfillmentSet
  }

  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation!.id },
    [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet!.id },
  })

  const pickupOption = await first<{ name: string }>(
    "shipping_option",
    ["id", "name"],
    (row) => row.name === PICKUP_OPTION_NAME,
  )
  if (!pickupOption) {
    await createShippingOptionsWorkflow(container).run({
      input: [
        {
          name: PICKUP_OPTION_NAME,
          price_type: "flat",
          provider_id: "manual_manual",
          service_zone_id: fulfillmentSet!.service_zones[0].id,
          shipping_profile_id: shippingProfile.id,
          type: {
            label: "Pickup",
            description: "Collect your order at the store.",
            code: "pickup",
          },
          prices: [
            { currency_code: "usd", amount: 0 },
            { region_id: region!.id, amount: 0 },
          ],
          rules: [
            { attribute: "enabled_in_store", value: "true", operator: "eq" },
            { attribute: "is_return", value: "false", operator: "eq" },
          ],
        },
      ],
    })
  }

  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: { id: stockLocation!.id, add: [salesChannel!.id] },
  })

  // The only product this seed ships: a gift card is not a Vori product, so
  // unlike the catalog there is nothing to mirror and it is created here. The
  // `vori_gift_card` variant flag is what the order write reads to record it as
  // a gift card sale rather than a line item.
  logger.info("Seeding the gift card product...")
  const existingGiftCard = await first<{ handle: string; id: string }>(
    "product",
    ["id", "handle"],
    (row) => row.handle === GIFT_CARD_HANDLE,
  )
  if (!existingGiftCard) {
    await createProductsWorkflow(container).run({
      input: {
        products: [
          {
            title: "Vori Gift Card",
            handle: GIFT_CARD_HANDLE,
            status: "published",
            description:
              "A Vori Market gift card. Choose an amount, and the recipient gets a card they can spend in store.",
            thumbnail: GIFT_CARD_IMAGE,
            images: [{ url: GIFT_CARD_IMAGE }],
            options: [
              {
                title: GIFT_CARD_OPTION,
                values: GIFT_CARD_DENOMINATIONS.map((amount) => `$${amount}`),
              },
            ],
            shipping_profile_id: shippingProfile.id,
            sales_channels: [{ id: salesChannel!.id }],
            variants: GIFT_CARD_DENOMINATIONS.map((amount) => ({
              title: `$${amount}`,
              sku: `VORI-GIFT-CARD-${amount}`,
              // A gift card is issued on demand, not drawn from a shelf, so it
              // never runs out of stock.
              manage_inventory: false,
              options: { [GIFT_CARD_OPTION]: `$${amount}` },
              prices: [{ amount, currency_code: "usd" }],
              metadata: { vori_gift_card: true },
            })),
          },
        ],
      },
    })
  } else {
    // Keep the shipped card image in step with the code on a re-seed.
    await updateProductsWorkflow(container).run({
      input: {
        selector: { id: existingGiftCard.id },
        update: { thumbnail: GIFT_CARD_IMAGE, images: [{ url: GIFT_CARD_IMAGE }] },
      },
    })
  }

  logger.info(`Store ready. Storefront publishable key: ${apiKey.token}`)
  logger.info("Run `pnpm seed:catalog` to fill the shelves from a Vori store.")
}
