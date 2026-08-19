import { Suspense } from "react"

import { OptionValueIds } from "@lib/util/product-option-filters"
import { getCategoryByHandle, listDepartments } from "@lib/data/categories"
import SkeletonProductGrid from "@modules/skeletons/templates/skeleton-product-grid"
import RefinementList from "@modules/store/components/refinement-list"
import { SortOptions } from "@modules/store/components/refinement-list/sort-products"

import PaginatedProducts from "./paginated-products"

const StoreTemplate = async ({
  sortBy,
  page,
  countryCode,
  optionValueIds,
  q,
  department,
  inStockOnly = true,
}: {
  sortBy?: SortOptions
  page?: string
  countryCode: string
  optionValueIds?: OptionValueIds
  q?: string
  department?: string
  inStockOnly?: boolean
}) => {
  const pageNumber = page ? parseInt(page) : 1
  const sort = sortBy || "created_at"

  // The department arrives as a handle so the URL stays readable and
  // shareable; the Store API filters on the category ID.
  const [category, allDepartments] = await Promise.all([
    department ? getCategoryByHandle([department]) : undefined,
    listDepartments(),
  ])

  // Empty departments are left out of the sidebar rather than offered as
  // filters that lead nowhere. The full list is one click away.
  const departments = allDepartments.filter((d) => d.count > 0)

  const heading = q
    ? `Results for "${q}"`
    : category
    ? category.name
    : "All products"

  return (
    <div
      className="flex flex-col small:flex-row small:items-start py-6 content-container"
      data-testid="category-container"
    >
      <RefinementList
        sortBy={sort}
        department={department}
        departments={departments}
        inStockOnly={inStockOnly}
      />
      <div className="w-full">
        <div className="mb-8 text-2xl-semi">
          <h1 data-testid="store-page-title">{heading}</h1>
        </div>
        <Suspense fallback={<SkeletonProductGrid />}>
          <PaginatedProducts
            sortBy={sort}
            page={pageNumber}
            countryCode={countryCode}
            optionValueIds={optionValueIds}
            q={q}
            categoryId={category?.id}
            inStockOnly={inStockOnly}
          />
        </Suspense>
      </div>
    </div>
  )
}

export default StoreTemplate
