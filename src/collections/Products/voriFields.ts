import type { Field } from 'payload'

/**
 * The Vori side of a product.
 *
 * Payload's catalog has no notion of a department, a barcode, a per-pound
 * price or a tax rate, so the parts of a Vori store product that this demo
 * relies on are carried here alongside it.
 *
 * Everything is read-only in the admin on purpose: Vori is the system of
 * record for all of it. `voriStoreProductId` in particular is the join key
 * the inventory poll upserts on and the ID every transaction line is written
 * with, so editing it by hand would quietly detach a product from the store
 * it came from.
 */
export const voriFields: Field[] = [
  {
    name: 'voriStoreProductId',
    type: 'text',
    admin: {
      description:
        'ID of this product in the Vori catalog. The inventory sync matches on it, and transaction line items are written with it.',
      position: 'sidebar',
      readOnly: true,
    },
    index: true,
    label: 'Vori store product ID',
    unique: true,
  },
  {
    name: 'voriStoreId',
    type: 'text',
    admin: { position: 'sidebar', readOnly: true },
    index: true,
    label: 'Vori store ID',
  },
  {
    name: 'voriBarcode',
    type: 'text',
    admin: {
      description: 'UPC or PLU as scanned at the register.',
      position: 'sidebar',
      readOnly: true,
    },
    label: 'Barcode',
  },
  {
    name: 'voriDepartmentId',
    type: 'text',
    admin: { position: 'sidebar', readOnly: true },
    label: 'Vori department ID',
  },
  {
    name: 'voriInventorySyncedAt',
    type: 'date',
    admin: {
      date: { displayFormat: 'yyyy-MM-dd HH:mm:ss' },
      description: 'When the inventory poll last wrote this product’s on-hand quantity.',
      position: 'sidebar',
      readOnly: true,
    },
    label: 'Inventory synced at',
  },
  {
    type: 'collapsible',
    admin: {
      description: 'Grocery attributes carried over from Vori. Read-only; Vori owns all of it.',
    },
    fields: [
      {
        name: 'soldByWeight',
        type: 'checkbox',
        admin: {
          description:
            'When set, the shelf price is per pound and the cart quantity is a number of pounds. Transaction lines for these products are sent with quantity 1 and an explicit weight, as the API requires.',
          readOnly: true,
        },
        label: 'Sold by weight',
      },
      {
        name: 'ebtEnabled',
        type: 'checkbox',
        admin: { readOnly: true },
        label: 'EBT/SNAP eligible',
      },
      { name: 'wicEnabled', type: 'checkbox', admin: { readOnly: true }, label: 'WIC eligible' },
      {
        name: 'minCustomerAge',
        type: 'number',
        admin: {
          description: 'Minimum age required to buy, when the product is age-restricted.',
          readOnly: true,
        },
        label: 'Minimum customer age',
      },
      {
        name: 'voriTaxRates',
        type: 'json',
        admin: {
          description:
            'Tax rates Vori applies to this product at the register, captured at seed time. Recorded for reference only — see the README on why this demo submits transactions untaxed.',
          readOnly: true,
        },
        label: 'Vori tax rates',
      },
    ],
    label: 'Vori grocery attributes',
  },
]
