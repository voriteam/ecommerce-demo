import type { RequiredDataFromCollectionSlug } from 'payload'

import type { components } from './generated/schema'

import { decimalToCents } from './money'

export type VoriStoreProduct = components['schemas']['StoreProduct']
export type VoriStoreProductInventory = components['schemas']['StoreProductInventory']
export type VoriStoreDepartment = components['schemas']['StoreDepartment']

/** Why a Vori product was left out of the storefront catalog. */
export type SkipReason =
  | 'gift card'
  | 'manual item'
  | 'no retail price'
  | 'variable sale price'

/**
 * Products this demo cannot sell online, and why.
 *
 * Each of these needs something a website cannot supply: a price typed in at
 * the register, a card balance chosen at the till, or an item that only
 * exists as a cashier button. Selling them here would produce a transaction
 * Vori is right to reject.
 */
export const skipReasonFor = (product: VoriStoreProduct): SkipReason | null => {
  if (product.is_blackhawk_gift_card || product.is_reloadable_blackhawk_gift_card) {
    return 'gift card'
  }
  if (product.variable_sale_price) return 'variable sale price'
  if (product.manual_item) return 'manual item'
  if (decimalToCents(product.retail_price) === null) return 'no retail price'
  return null
}

/**
 * Slug for a product page.
 *
 * The Vori ID is appended rather than relying on the name alone: a grocery
 * catalog is full of products that differ only by size or flavour, and two
 * "Whole Milk" entries must not collide on one URL.
 */
export const productSlug = (product: VoriStoreProduct): string => {
  const base = product.name
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')

  return base ? `${base}-${product.id}` : `product-${product.id}`
}

/**
 * On-hand quantity as Payload stores it.
 *
 * The plugin's inventory field is a non-negative integer, while Vori reports a
 * decimal that goes negative when sales outrun the last count. A negative
 * count means the shelf is empty as far as a shopper is concerned, and a
 * fractional one (a partially sold case, a weighed item) rounds down so the
 * site never offers more than the store can actually put in a bag.
 */
export const inventoryFromVori = (current: null | string | undefined): null | number => {
  if (current === null || current === undefined || current === '') return null

  const parsed = Number(current)
  if (!Number.isFinite(parsed)) return null

  return Math.max(0, Math.floor(parsed))
}

const richTextParagraph = (text: string) => ({
  root: {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [{ type: 'text', detail: 0, format: 0, mode: 'normal', style: '', text, version: 1 }],
        direction: 'ltr' as const,
        format: '' as const,
        indent: 0,
        textFormat: 0,
        version: 1,
      },
    ],
    direction: 'ltr' as const,
    format: '' as const,
    indent: 0,
    version: 1,
  },
})

/**
 * A Vori store product as a Payload product document.
 *
 * Prices become integer minor units because that is what the ecommerce plugin
 * stores and what it hands to Stripe. For an item sold by weight, the price
 * is per pound and the storefront sells it in whole pounds — see the order
 * hook, which converts a quantity of pounds into the quantity/weight pair the
 * transactions API expects.
 */
export const voriProductToPayload = (
  product: VoriStoreProduct,
  options: { categoryId?: number | string } = {},
): Partial<RequiredDataFromCollectionSlug<'products'>> => {
  const priceInUSD = decimalToCents(product.retail_price)

  const descriptionParts = [
    product.brand,
    product.description,
    product.sold_by_weight ? 'Sold by weight — priced per pound.' : null,
  ].filter(Boolean)

  return {
    _status: 'published',
    categories: options.categoryId ? [options.categoryId as number] : undefined,
    description: descriptionParts.length
      ? (richTextParagraph(descriptionParts.join(' · ')) as never)
      : undefined,
    ebtEnabled: product.ebt_enabled,
    enableVariants: false,
    gallery: [],
    inventory: inventoryFromVori(product.inventory?.current) ?? 0,
    layout: [],
    minCustomerAge: product.min_customer_age ?? undefined,
    priceInUSD: priceInUSD ?? 0,
    slug: productSlug(product),
    soldByWeight: product.sold_by_weight,
    title: product.name,
    voriBarcode: product.barcode,
    voriDepartmentId: product.department_id,
    voriStoreId: product.store_id,
    voriStoreProductId: product.id,
    voriTaxRates: product.tax_rates as never,
    wicEnabled: product.wic_enabled,
  }
}

/** A Vori department as a Payload category. */
export const voriDepartmentToPayload = (
  department: VoriStoreDepartment,
): Partial<RequiredDataFromCollectionSlug<'categories'>> => ({
  slug: department.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, ''),
  title: department.name,
})
