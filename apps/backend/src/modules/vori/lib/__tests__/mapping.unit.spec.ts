import {
  activeTaxRate,
  amountTaxRate,
  catalogFixture,
  eachPricedProduct,
  oversoldProduct,
  taxedProduct,
  uncountedProduct,
  inactiveTaxRate,
  unsellableProducts,
  weightPricedProduct,
} from "../fixtures/store-products"
import {
  chargeableRatesFor,
  FORMAT_EACH,
  FORMAT_PER_POUND,
  inventoryFromVori,
  isChargeableTaxRate,
  productSlug,
  skipReasonFor,
  uniqueDepartmentHandles,
  voriDepartmentToMedusa,
  voriProductToMedusa,
  voriTaxRateToMedusa,
  type VoriStoreDepartment,
} from "../mapping"

const department = (id: string, name: string): VoriStoreDepartment => ({
  id,
  deactivated_at: null,
  exclude_from_sales_reporting: false,
  name,
  parent_department_id: null,
})

describe("which products reach the storefront", () => {
  it("keeps what a website can sell and rejects what needs a register", () => {
    for (const product of [eachPricedProduct, weightPricedProduct, taxedProduct, oversoldProduct]) {
      expect(skipReasonFor(product)).toBeNull()
    }

    expect(unsellableProducts.map(skipReasonFor)).toEqual([
      "gift card",
      "variable sale price",
      "manual item",
      "no retail price",
    ])
  })
})

describe("on-hand quantity", () => {
  it("floors fractional counts and clamps negatives, but keeps null distinct", () => {
    expect(inventoryFromVori("24")).toBe(24)
    // Never offer more than the shelf can actually hold.
    expect(inventoryFromVori("112.4")).toBe(112)
    // Oversold still reads as an empty shelf to a shopper.
    expect(inventoryFromVori("-3")).toBe(0)
    // Never counted is not the same as none in stock.
    expect(inventoryFromVori(null)).toBeNull()
    expect(inventoryFromVori(undefined)).toBeNull()
  })
})

describe("product handles", () => {
  it("are the Vori ID, so same-named groceries cannot collide", () => {
    expect(productSlug(eachPricedProduct)).toBe("900001")
    expect(productSlug(weightPricedProduct)).toBe("900002")
  })

  it("ignore the name entirely, however awkward it is", () => {
    // A grocery catalog is full of products differing only by size or flavour,
    // and names full of punctuation. None of it reaches the URL.
    const awkward = { ...eachPricedProduct, id: "42", name: "Trader Joe's 2% Milk — 1/2 gal." }
    expect(productSlug(awkward)).toBe("42")
  })

  it("do not move when a grocer renames a product", () => {
    const renamed = { ...eachPricedProduct, name: "Clover Organic Whole Milk" }
    expect(productSlug(renamed)).toBe(productSlug(eachPricedProduct))
  })

  it("are unique across the whole catalog", () => {
    const handles = catalogFixture.filter((p) => !skipReasonFor(p)).map(productSlug)
    expect(new Set(handles).size).toBe(handles.length)
  })
})

describe("mapping a Vori product onto a Medusa one", () => {
  it("prices in whole currency units, exactly, with no float residue", () => {
    expect(voriProductToMedusa(eachPricedProduct).variants[0].prices).toEqual([
      { amount: 4.99, currency_code: "usd" },
    ])
    // For a weight item this is the per-pound price.
    expect(voriProductToMedusa(weightPricedProduct).variants[0].prices[0].amount).toBe(0.69)
  })

  it("carries the identifiers the rest of the integration joins on", () => {
    const product = voriProductToMedusa(eachPricedProduct)

    expect(product.external_id).toBe("900001")
    expect(product.variants[0].sku).toBe("VORI-900001")
    expect(product.metadata).toMatchObject({
      vori_barcode: "0001111041700",
      vori_department_id: "5501",
      vori_store_id: "12345",
      vori_store_product_id: "900001",
    })
    // Inventory sync resolves a variant, not a product, so the ID is on both.
    expect(product.variants[0].metadata).toMatchObject({ vori_store_product_id: "900001" })
  })

  it("flags per-pound products, since their line items are sent differently", () => {
    const weighed = voriProductToMedusa(weightPricedProduct)
    const counted = voriProductToMedusa(eachPricedProduct)

    expect(weighed.variants[0].metadata.vori_sold_by_weight).toBe(true)
    expect(weighed.variants[0].options).toEqual({ Format: FORMAT_PER_POUND })
    expect(counted.variants[0].metadata.vori_sold_by_weight).toBe(false)
    expect(counted.variants[0].options).toEqual({ Format: FORMAT_EACH })
  })

  it("preserves the grocery attributes Medusa has no column for", () => {
    expect(voriProductToMedusa(taxedProduct).metadata).toMatchObject({
      vori_ebt_enabled: false,
      vori_min_customer_age: 21,
      vori_tax_rates: taxedProduct.tax_rates,
      vori_wic_enabled: false,
    })
  })

  it("stocks every variant, so Vori has an inventory level to write into", () => {
    expect(voriProductToMedusa(uncountedProduct).variants[0].manage_inventory).toBe(true)
  })

  it("assigns a category only when the department maps to one", () => {
    expect(
      voriProductToMedusa(eachPricedProduct, { categoryIds: ["pcat_1"] }).category_ids,
    ).toEqual(["pcat_1"])
    expect(voriProductToMedusa(eachPricedProduct).category_ids).toBeUndefined()
  })

  it("refuses to shape a product with no price, rather than selling it for nothing", () => {
    const unpriced = { ...eachPricedProduct, retail_price: null }
    expect(() => voriProductToMedusa(unpriced)).toThrow(/no retail price/)
  })
})

describe("department handles", () => {
  it("gives each department a clean handle when the names are all distinct", () => {
    expect(
      uniqueDepartmentHandles([department("1", "Dairy"), department("2", "Beer & Wine")]),
    ).toEqual({ "1": "dairy", "2": "beer-wine" })
  })

  it("disambiguates departments that share a name", () => {
    // A real grocer's list runs several hundred deep and holds "Formula" under
    // Baby and again under Pharmacy. Medusa handles are unique store-wide, so
    // one of them has to give.
    const handles = uniqueDepartmentHandles([
      department("5501", "Formula"),
      department("7702", "Formula"),
      department("9903", "Formula"),
    ])

    expect(handles).toEqual({
      "5501": "formula",
      "7702": "formula-7702",
      "9903": "formula-9903",
    })
    expect(new Set(Object.values(handles)).size).toBe(3)
  })

  it("gives way to handles the store already holds", () => {
    expect(uniqueDepartmentHandles([department("5501", "Formula")], ["formula"])).toEqual({
      "5501": "formula-5501",
    })
    // Even when the suffixed handle is taken too.
    expect(
      uniqueDepartmentHandles([department("5501", "Formula")], ["formula", "formula-5501"]),
    ).toEqual({ "5501": "formula-5501-2" })
  })

  it("reaches the same answer whatever order the departments arrive in", () => {
    const forwards = uniqueDepartmentHandles([
      department("5501", "Formula"),
      department("7702", "Formula"),
    ])
    const backwards = uniqueDepartmentHandles([
      department("7702", "Formula"),
      department("5501", "Formula"),
    ])

    expect(forwards).toEqual(backwards)
  })

  it("falls back to the ID for a name that slugifies to nothing", () => {
    expect(uniqueDepartmentHandles([department("5501", "***")])).toEqual({
      "5501": "department-5501",
    })
  })

  it("keeps the department ID, so a rename moves its products with it", () => {
    expect(voriDepartmentToMedusa(department("5501", "Dairy & Eggs"))).toEqual({
      handle: "dairy-eggs",
      is_active: true,
      metadata: {
        vori_parent_department_id: null,
        vori_store_department_id: "5501",
      },
      name: "Dairy & Eggs",
    })
  })
})

describe("tax rates", () => {
  it("charges a percentage rate and refuses a per-unit amount", () => {
    // Medusa expresses a tax line as a percentage of the taxable amount and
    // has no way to describe a fixed amount of currency per unit sold.
    expect(isChargeableTaxRate(activeTaxRate)).toBe(true)
    expect(isChargeableTaxRate(amountTaxRate)).toBe(false)
  })

  it("only applies rates the tax-rate endpoint says are live", () => {
    // A product carries its rates in compact form, which omits `active`, so a
    // rate the grocer switched off would otherwise be charged forever.
    expect(chargeableRatesFor(taxedProduct, new Set(["77"])).map((r) => r.id)).toEqual(["77"])
    expect(chargeableRatesFor(taxedProduct, new Set([inactiveTaxRate.id]))).toEqual([])
    expect(chargeableRatesFor(taxedProduct, new Set())).toEqual([])
  })

  it("leaves an untaxed product untaxed", () => {
    expect(chargeableRatesFor(eachPricedProduct, new Set(["77"]))).toEqual([])
  })

  it("maps a Vori rate onto a Medusa one, keeping the ID to match on later", () => {
    expect(voriTaxRateToMedusa(activeTaxRate, "txreg_1")).toEqual({
      code: "VORI-77",
      metadata: { vori_tax_rate_category: "sales", vori_tax_rate_id: "77" },
      name: "CA State Sales Tax",
      rate: 8.25,
      tax_region_id: "txreg_1",
    })
  })
})
