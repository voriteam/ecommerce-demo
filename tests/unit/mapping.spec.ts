import { describe, expect, it } from 'vitest'

import {
  catalogFixture,
  eachPricedProduct,
  oversoldProduct,
  taxedProduct,
  uncountedProduct,
  unsellableProducts,
  weightPricedProduct,
} from '@/vori/fixtures/storeProducts'
import { inventoryFromVori, productSlug, skipReasonFor, voriProductToPayload } from '@/vori/mapping'

describe('which products reach the storefront', () => {
  it('keeps what a website can sell and rejects what needs a register', () => {
    for (const product of [eachPricedProduct, weightPricedProduct, taxedProduct, oversoldProduct]) {
      expect(skipReasonFor(product)).toBeNull()
    }

    expect(unsellableProducts.map(skipReasonFor)).toEqual([
      'gift card',
      'variable sale price',
      'manual item',
      'no retail price',
    ])
  })
})

describe('on-hand quantity', () => {
  it('floors fractional counts and clamps negatives, but keeps null distinct', () => {
    expect(inventoryFromVori('24')).toBe(24)
    // Never offer more than the shelf can actually hold.
    expect(inventoryFromVori('112.4')).toBe(112)
    // Oversold still reads as an empty shelf to a shopper.
    expect(inventoryFromVori('-3')).toBe(0)
    // Never counted is not the same as none in stock.
    expect(inventoryFromVori(null)).toBeNull()
    expect(inventoryFromVori(undefined)).toBeNull()
  })
})

describe('product slugs', () => {
  it('end in the Vori ID, so same-named groceries cannot collide', () => {
    expect(productSlug(eachPricedProduct)).toBe('clover-whole-milk-half-gallon-900001')
    expect(productSlug({ ...eachPricedProduct, id: '900999' })).not.toBe(
      productSlug(eachPricedProduct),
    )
  })

  it('survive a name full of punctuation', () => {
    const awkward = { ...eachPricedProduct, id: '42', name: "Trader Joe's 2% Milk — 1/2 gal." }
    expect(productSlug(awkward)).toBe('trader-joes-2-milk-1-2-gal-42')
  })

  it('are unique across the whole catalog', () => {
    const slugs = catalogFixture.filter((p) => !skipReasonFor(p)).map(productSlug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })
})

describe('mapping a Vori product onto a Payload one', () => {
  it('converts the shelf price to the integer minor units Payload stores', () => {
    expect(voriProductToPayload(eachPricedProduct).priceInUSD).toBe(499)
    // For a weight item this is the per-pound price.
    expect(voriProductToPayload(weightPricedProduct).priceInUSD).toBe(69)
  })

  it('carries the identifiers the rest of the integration joins on', () => {
    expect(voriProductToPayload(eachPricedProduct)).toMatchObject({
      voriBarcode: '0001111041700',
      voriDepartmentId: '5501',
      voriStoreId: '12345',
      voriStoreProductId: '900001',
    })
  })

  it('flags per-pound products, since their line items are sent differently', () => {
    expect(voriProductToPayload(weightPricedProduct).soldByWeight).toBe(true)
    expect(voriProductToPayload(eachPricedProduct).soldByWeight).toBe(false)
  })

  it('preserves the grocery attributes Payload has no field for', () => {
    expect(voriProductToPayload(taxedProduct)).toMatchObject({
      ebtEnabled: false,
      minCustomerAge: 21,
      voriTaxRates: taxedProduct.tax_rates,
      wicEnabled: false,
    })
  })

  it('never emits a negative or absent stock level', () => {
    expect(voriProductToPayload(oversoldProduct).inventory).toBe(0)
    expect(voriProductToPayload(uncountedProduct).inventory).toBe(0)
  })

  it('assigns a category only when the department maps to one', () => {
    expect(voriProductToPayload(eachPricedProduct, { categoryId: 7 }).categories).toEqual([7])
    expect(voriProductToPayload(eachPricedProduct).categories).toBeUndefined()
  })
})
