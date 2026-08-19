import { sdk } from "@lib/config"
import { HttpTypes } from "@medusajs/types"
import { getCacheOptions } from "./cookies"

export type Department = {
  count: number
  handle: string
  name: string
}

/**
 * Every department, with how many products sit in it.
 *
 * Only product IDs are asked for, so a catalog of several hundred departments
 * and several thousand products comes back in one small response rather than
 * one request per department.
 */
export const listDepartments = async (): Promise<Department[]> => {
  const next = {
    ...(await getCacheOptions("categories")),
  }

  const { product_categories } = await sdk.client.fetch<{
    product_categories: (HttpTypes.StoreProductCategory & {
      products?: { id: string }[]
    })[]
  }>("/store/product-categories", {
    query: { fields: "id,name,handle,products.id", limit: 1000 },
    next,
    cache: "force-cache",
  })

  return product_categories
    .map((category) => ({
      count: category.products?.length ?? 0,
      handle: category.handle,
      name: category.name,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

export const listCategories = async (query?: Record<string, unknown>) => {
  const next = {
    ...(await getCacheOptions("categories")),
  }

  const limit = query?.limit || 100

  return sdk.client
    .fetch<{ product_categories: HttpTypes.StoreProductCategory[] }>(
      "/store/product-categories",
      {
        query: {
          fields:
            "*category_children, *products, *parent_category, *parent_category.parent_category",
          limit,
          ...query,
        },
        next,
        cache: "force-cache",
      }
    )
    .then(({ product_categories }) => product_categories)
}

export const getCategoryByHandle = async (categoryHandle: string[]) => {
  const handle = `${categoryHandle.join("/")}`

  const next = {
    ...(await getCacheOptions("categories")),
  }

  return sdk.client
    .fetch<HttpTypes.StoreProductCategoryListResponse>(
      `/store/product-categories`,
      {
        query: {
          fields: "*category_children, *products",
          handle,
        },
        next,
        cache: "force-cache",
      }
    )
    .then(({ product_categories }) => product_categories[0])
}
