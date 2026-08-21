import type { VoriStoreProduct, VoriTaxRate } from "../mapping"

/**
 * Store products shaped exactly as the API returns them.
 *
 * These are typed as `VoriStoreProduct`, which is generated from the vendored
 * OpenAPI spec, so a field that the API adds, removes or retypes breaks these
 * fixtures at compile time rather than letting the tests keep passing against
 * a shape the API no longer serves.
 *
 * They also make the demo runnable — and the mapping testable — with no API
 * key and no network.
 */
const base: VoriStoreProduct = {
  id: "900001",
  active: true,
  barcode: "0001111041700",
  brand: "Clover",
  country_of_origin: "USA",
  created_at: "2026-01-04T18:02:11.000Z",
  department_id: "5501",
  description: "Whole milk, half gallon",
  ebt_enabled: true,
  ecommerce_enabled: true,
  food_modifier_categories: [],
  images: [],
  inventory: {
    current: "24",
    last_changed_at: "2026-08-18T21:40:00.000Z",
    max_stock: null,
    min_par: null,
  },
  is_blackhawk_gift_card: false,
  is_reloadable_blackhawk_gift_card: false,
  is_tippable: false,
  item_modifiers: [],
  loyalty_points_per_dollar: null,
  manual_item: false,
  maximum_retail_price: null,
  min_customer_age: null,
  minimum_retail_price: null,
  name: "Clover Whole Milk, Half Gallon",
  prompt_for_quantity: false,
  retail_price: "4.99",
  sold_by_weight: false,
  store_id: "12345",
  sync_to_deli_scales: false,
  target_margin: "32",
  tax_rates: [],
  updated_at: "2026-08-18T21:40:00.000Z",
  variable_sale_price: false,
  variable_weights: [],
  wic_enabled: true,
}

export const eachPricedProduct: VoriStoreProduct = base

/** Priced per pound: retail_price is the per-pound price, not a unit price. */
export const weightPricedProduct: VoriStoreProduct = {
  ...base,
  id: "900002",
  barcode: "0000000004011",
  brand: null,
  department_id: "5502",
  description: "Bananas, conventional",
  ebt_enabled: true,
  inventory: {
    current: "112.4",
    last_changed_at: "2026-08-18T21:41:00.000Z",
    max_stock: null,
    min_par: null,
  },
  name: "Bananas",
  retail_price: "0.69",
  sold_by_weight: true,
  wic_enabled: false,
}

/** Age-restricted and taxed, so the mapping carries both through. */
export const taxedProduct: VoriStoreProduct = {
  ...base,
  id: "900003",
  barcode: "0083783375213",
  brand: "Lagunitas",
  department_id: "5503",
  description: "IPA six pack",
  ebt_enabled: false,
  inventory: {
    current: "6",
    last_changed_at: "2026-08-18T21:42:00.000Z",
    max_stock: null,
    min_par: null,
  },
  min_customer_age: 21,
  name: "Lagunitas IPA 6-Pack",
  retail_price: "12.49",
  tax_rates: [
    {
      id: "77",
      category: "sales",
      name: "CA State Sales Tax",
      value: "8.25",
      value_type: "percentage",
    },
  ],
  wic_enabled: false,
}

/** Sales outran the last count, so Vori reports a negative on-hand quantity. */
export const oversoldProduct: VoriStoreProduct = {
  ...base,
  id: "900004",
  inventory: {
    current: "-3",
    last_changed_at: "2026-08-18T21:43:00.000Z",
    max_stock: null,
    min_par: null,
  },
  name: "Sourdough Loaf",
  retail_price: "6.50",
}

/**
 * Never counted. The spec types the embedded `inventory` object as optional
 * with a non-nullable `current`, so an uncounted product omits the object
 * rather than reporting a null quantity — unlike the standalone inventory
 * endpoint, where `current` really is nullable.
 */
export const uncountedProduct: VoriStoreProduct = (() => {
  const { inventory: _omitted, ...rest } = base
  return { ...rest, id: "900005", name: "Bulk Almonds", retail_price: "9.99", sold_by_weight: true }
})()

/** Each of these must be kept out of the storefront, for a different reason. */
export const unsellableProducts: VoriStoreProduct[] = [
  { ...base, id: "900101", is_blackhawk_gift_card: true, name: "Visa Gift Card" },
  { ...base, id: "900102", name: "Deli Counter Item", variable_sale_price: true },
  { ...base, id: "900103", manual_item: true, name: "Manual Grocery" },
  { ...base, id: "900104", name: "Unpriced Item", retail_price: null },
]

/**
 * Three shots from the grocer, with the primary deliberately not first.
 *
 * A store uploads pictures in whatever order it took them, so the flagged
 * lead being second is the ordinary case rather than the awkward one.
 */
export const photographedProduct: VoriStoreProduct = {
  ...base,
  id: "900201",
  images: [
    {
      id: "spi_a",
      is_primary: false,
      thumbnail_url: "https://images.vori.com/a_thumb.webp",
      url: "https://images.vori.com/a.webp",
    },
    {
      id: "spi_b",
      is_primary: true,
      thumbnail_url: "https://images.vori.com/b_thumb.webp",
      url: "https://images.vori.com/b.webp",
    },
    {
      id: "spi_c",
      is_primary: false,
      thumbnail_url: null,
      url: "https://images.vori.com/c.webp",
    },
  ],
  name: "Clover Whole Milk, Half Gallon",
}

/** One shot with no crop rendered yet, so the full-size URL has to stand in. */
export const thumblessPhotoProduct: VoriStoreProduct = {
  ...base,
  id: "900202",
  images: [
    { id: "spi_d", is_primary: true, thumbnail_url: null, url: "https://images.vori.com/d.webp" },
  ],
}

/** Nothing flagged primary - the grocer never chose, so API order stands. */
export const unflaggedPhotosProduct: VoriStoreProduct = {
  ...base,
  id: "900203",
  images: [
    {
      id: "spi_e",
      is_primary: false,
      thumbnail_url: "https://images.vori.com/e_thumb.webp",
      url: "https://images.vori.com/e.webp",
    },
    {
      id: "spi_f",
      is_primary: false,
      thumbnail_url: "https://images.vori.com/f_thumb.webp",
      url: "https://images.vori.com/f.webp",
    },
  ],
}

export const catalogFixture: VoriStoreProduct[] = [
  eachPricedProduct,
  weightPricedProduct,
  taxedProduct,
  oversoldProduct,
  uncountedProduct,
  ...unsellableProducts,
]

/**
 * The banner's tax rates, as `/v1/tax-rates` returns them.
 *
 * `77` is the rate the taxed product carries. The other two exist to pin the
 * two cases the compact copy on a product cannot express: a rate a grocer has
 * switched off, and a rate charged as a fixed amount per unit rather than a
 * percentage, which Medusa has no way to represent.
 */
export const activeTaxRate: VoriTaxRate = {
  id: "77",
  active: true,
  category: "sales",
  created_at: "2026-01-04T18:02:11.000Z",
  name: "CA State Sales Tax",
  updated_at: "2026-01-04T18:02:11.000Z",
  value: "8.25",
  value_type: "percentage",
}

export const inactiveTaxRate: VoriTaxRate = {
  ...activeTaxRate,
  id: "78",
  active: false,
  name: "Retired County Surcharge",
  value: "1.00",
}

export const amountTaxRate: VoriTaxRate = {
  ...activeTaxRate,
  id: "79",
  name: "Bottle Excise",
  value: "0.10",
  value_type: "amount",
}

export const taxRateFixture: VoriTaxRate[] = [activeTaxRate, inactiveTaxRate, amountTaxRate]
