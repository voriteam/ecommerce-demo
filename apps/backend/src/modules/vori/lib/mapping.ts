import type { components } from "./generated/schema"

import { centsToDecimal, decimalToCents } from "./money"

export type VoriStoreProduct = components["schemas"]["StoreProduct"]
export type VoriStoreProductInventory = components["schemas"]["StoreProductInventory"]
export type VoriStoreDepartment = components["schemas"]["StoreDepartment"]
export type VoriTaxRate = components["schemas"]["TaxRate"]
export type VoriCompactTaxRate = components["schemas"]["CompactTaxRate"]

/**
 * The one product option every seeded product carries.
 *
 * Medusa requires at least one option and one variant per product. A grocery
 * item has no size or colour to choose from, so the option says how the item
 * is priced instead — which is the one thing a shopper does need to know
 * before adding it to a cart.
 */
export const FORMAT_OPTION = "Format"
export const FORMAT_EACH = "Each"
export const FORMAT_PER_POUND = "Per pound"

/** Why a Vori product was left out of the storefront catalog. */
export type SkipReason = "gift card" | "manual item" | "no retail price" | "variable sale price"

/**
 * Products this demo cannot sell online, and why.
 *
 * Each of these needs something a website cannot supply: a price typed in at
 * the register, a card balance chosen at the till, or an item that only exists
 * as a cashier button. Selling them here would produce a transaction Vori is
 * right to reject.
 */
export const skipReasonFor = (product: VoriStoreProduct): SkipReason | null => {
  if (product.is_blackhawk_gift_card || product.is_reloadable_blackhawk_gift_card) {
    return "gift card"
  }
  if (product.variable_sale_price) return "variable sale price"
  if (product.manual_item) return "manual item"
  if (decimalToCents(product.retail_price) === null) return "no retail price"
  return null
}

/**
 * Handle for a product page: the Vori store product ID, and nothing else.
 *
 * A grocery catalog is full of products that differ only by size or flavour,
 * and a name-derived handle would collide constantly - the store this is built
 * against carries several thousand. The ID is unique by construction, stable
 * for the life of the product, and makes a URL something you can paste
 * straight into an API call to see the same record.
 */
export const productSlug = (product: VoriStoreProduct): string => product.id

/**
 * On-hand quantity as an inventory level.
 *
 * A stocked quantity is a non-negative integer, while Vori reports a decimal
 * that goes negative when sales outrun the last count. A negative count means
 * the shelf is empty as far as a shopper is concerned, and a fractional one
 * (a partially sold case, a weighed item) rounds down so the site never offers
 * more than the store can actually put in a bag.
 *
 * Null is not zero. It means the product has never been counted, and callers
 * are expected to leave the last known figure alone rather than empty the
 * shelf on the website.
 */
export const inventoryFromVori = (current: null | string | undefined): null | number => {
  if (current === null || current === undefined || current === "") return null

  const parsed = Number(current)
  if (!Number.isFinite(parsed)) return null

  return Math.max(0, Math.floor(parsed))
}

/** The grocery attributes Medusa has no column for, kept on metadata. */
export const voriProductMetadata = (product: VoriStoreProduct): Record<string, unknown> => ({
  vori_barcode: product.barcode ?? null,
  vori_department_id: product.department_id ?? null,
  vori_ebt_enabled: product.ebt_enabled ?? false,
  vori_min_customer_age: product.min_customer_age ?? null,
  vori_sold_by_weight: product.sold_by_weight ?? false,
  vori_store_id: product.store_id,
  vori_store_product_id: product.id,
  vori_tax_rates: product.tax_rates ?? [],
  vori_wic_enabled: product.wic_enabled ?? false,
})

export type MedusaProductInput = {
  category_ids?: string[]
  description?: string
  external_id: string
  handle: string
  metadata: Record<string, unknown>
  options: { title: string; values: string[] }[]
  sales_channels?: { id: string }[]
  shipping_profile_id?: string
  status: "published"
  title: string
  variants: {
    manage_inventory: boolean
    metadata: Record<string, unknown>
    options: Record<string, string>
    prices: { amount: number; currency_code: string }[]
    sku: string
    title: string
  }[]
}

/**
 * A Vori store product as a Medusa product.
 *
 * Every product gets exactly one variant, because a Vori store product is
 * already the thing that scans at the register — there is nothing below it to
 * pick. The Vori identifier is carried in three places on purpose:
 * `external_id` so the seed can tell a create from an update, and the metadata
 * on both product and variant so inventory sync and the order write can each
 * resolve back to Vori from whichever record they happen to be holding.
 *
 * For an item sold by weight the shelf price is per pound and the storefront
 * sells it in whole pounds. The order write converts that quantity of pounds
 * into the quantity/weight pair the transactions API expects.
 */
export const voriProductToMedusa = (
  product: VoriStoreProduct,
  options: {
    categoryIds?: string[]
    salesChannelIds?: string[]
    shippingProfileId?: string
  } = {},
): MedusaProductInput => {
  const priceCents = decimalToCents(product.retail_price)

  if (priceCents === null) {
    throw new Error(
      `Vori store product ${product.id} has no retail price and cannot be sold online`,
    )
  }

  const soldByWeight = Boolean(product.sold_by_weight)
  const format = soldByWeight ? FORMAT_PER_POUND : FORMAT_EACH

  const descriptionParts = [
    product.brand,
    product.description,
    soldByWeight ? "Sold by weight — priced per pound." : null,
  ].filter(Boolean)

  return {
    category_ids: options.categoryIds?.length ? options.categoryIds : undefined,
    description: descriptionParts.length ? descriptionParts.join(" · ") : undefined,
    external_id: product.id,
    handle: productSlug(product),
    metadata: voriProductMetadata(product),
    options: [{ title: FORMAT_OPTION, values: [format] }],
    sales_channels: options.salesChannelIds?.map((id) => ({ id })),
    shipping_profile_id: options.shippingProfileId,
    status: "published",
    title: product.name,
    variants: [
      {
        manage_inventory: true,
        metadata: {
          vori_sold_by_weight: soldByWeight,
          vori_store_product_id: product.id,
        },
        options: { [FORMAT_OPTION]: format },
        // Medusa prices are decimal amounts in the main currency unit, so the
        // cents this was parsed into are formatted back rather than divided:
        // 499 is "4.99", never 4.989999999999999.
        prices: [{ amount: Number(centsToDecimal(priceCents)), currency_code: "usd" }],
        sku: `VORI-${product.id}`,
        title: format,
      },
    ],
  }
}

/**
 * The handle a department would like to have.
 *
 * Not guaranteed unique: a grocer's department list runs a few hundred entries
 * deep and readily holds the same name twice - "Formula" under Baby and again
 * under Pharmacy - while Medusa requires category handles to be unique across
 * the whole store. Resolving that is `uniqueDepartmentHandles`, below.
 */
export const departmentSlug = (department: VoriStoreDepartment): string => {
  const base = department.name
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return base || `department-${department.id}`
}

/**
 * Unique handles for a whole department list, given what the store already
 * holds.
 *
 * A department keeps the clean handle when it is free and takes its Vori ID as
 * a suffix when it is not, which is the same trick product handles use and for
 * the same reason. Departments are considered in ID order so two runs over the
 * same data reach the same answer.
 */
export const uniqueDepartmentHandles = (
  departments: VoriStoreDepartment[],
  taken: Iterable<string> = [],
): Record<string, string> => {
  const claimed = new Set(taken)
  const handles: Record<string, string> = {}

  for (const department of [...departments].sort((a, b) => a.id.localeCompare(b.id))) {
    const base = departmentSlug(department)
    let handle = claimed.has(base) ? `${base}-${department.id}` : base

    // Belt and braces: the store could already hold that suffixed handle too.
    let attempt = 2
    while (claimed.has(handle)) {
      handle = `${base}-${department.id}-${attempt++}`
    }

    claimed.add(handle)
    handles[department.id] = handle
  }

  return handles
}

/**
 * A Vori department as a Medusa product category.
 *
 * `handle` is passed in rather than derived, because uniqueness can only be
 * decided against every other department and every category the store already
 * holds. Matching is on the department ID in metadata, never on the name, so a
 * department a grocer renames takes its products with it.
 */
export const voriDepartmentToMedusa = (
  department: VoriStoreDepartment,
  options: { handle?: string; parentCategoryId?: string } = {},
): {
  handle: string
  is_active: true
  metadata: Record<string, unknown>
  name: string
  parent_category_id?: string
} => ({
  handle: options.handle ?? departmentSlug(department),
  is_active: true,
  metadata: {
    vori_parent_department_id: department.parent_department_id ?? null,
    vori_store_department_id: department.id,
  },
  name: department.name,
  ...(options.parentCategoryId ? { parent_category_id: options.parentCategoryId } : {}),
})

/**
 * Whether a rate is one Medusa can charge.
 *
 * Medusa expresses a tax line as a percentage of the taxable amount and has no
 * way to describe a fixed amount of currency per unit sold, so a rate with
 * `value_type: "amount"` cannot be represented. Those are reported by the seed
 * rather than silently applied at the wrong value or silently dropped.
 */
export const isChargeableTaxRate = (rate: VoriCompactTaxRate | VoriTaxRate): boolean =>
  rate.value_type === "percentage" && Number.isFinite(Number(rate.value))

/**
 * The Vori tax rates that should actually be charged on a product.
 *
 * A product's own rates are the compact form, which omits `active`, so they
 * are intersected with the rates the tax-rate endpoint says are live. A rate a
 * grocer has switched off stays configured on the product and is not charged -
 * which is exactly what the register does.
 */
export const chargeableRatesFor = (
  product: VoriStoreProduct,
  activeRateIds: ReadonlySet<string>,
): VoriCompactTaxRate[] =>
  (product.tax_rates ?? []).filter(
    (rate) => activeRateIds.has(rate.id) && isChargeableTaxRate(rate),
  )

/** A Vori tax rate as a Medusa tax rate. */
export const voriTaxRateToMedusa = (
  rate: VoriTaxRate,
  taxRegionId: string,
): {
  code: string
  metadata: Record<string, unknown>
  name: string
  rate: number
  tax_region_id: string
} => ({
  // Medusa matches nothing on `code`; it is here so a rate is recognisable in
  // the admin as one that came from Vori rather than one typed in by hand.
  code: `VORI-${rate.id}`,
  metadata: { vori_tax_rate_category: rate.category, vori_tax_rate_id: rate.id },
  name: rate.name,
  rate: Number(rate.value),
  tax_region_id: taxRegionId,
})
