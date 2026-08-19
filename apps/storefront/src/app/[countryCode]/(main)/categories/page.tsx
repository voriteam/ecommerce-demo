import { Metadata } from "next"

import { listDepartments } from "@lib/data/categories"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

export const metadata: Metadata = {
  title: "Departments",
  description: "Every department in the store.",
}

/**
 * Every department the store carries.
 *
 * A grocer's list runs to several hundred, so this is a page rather than a
 * menu. The ones with something on the shelf come first, because those are the
 * only ones worth clicking; the rest are listed after, so the shape of the
 * grocer's actual catalog is still visible.
 */
export default async function DepartmentsPage() {
  const departments = await listDepartments()
  const stocked = departments.filter((d) => d.count > 0)
  const empty = departments
    .filter((d) => d.count === 0)
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="content-container py-12">
      <h1 className="text-2xl-semi mb-2" data-testid="departments-page-title">
        Departments
      </h1>
      <p className="text-base-regular text-ui-fg-subtle mb-10">
        {departments.length} departments, {stocked.length} of them stocked for
        online ordering.
      </p>

      <ul
        className="grid grid-cols-1 small:grid-cols-2 medium:grid-cols-3 gap-x-8 gap-y-3 mb-16"
        data-testid="stocked-departments"
      >
        {stocked.map((department) => (
          <li key={department.handle}>
            <LocalizedClientLink
              href={`/store?department=${department.handle}`}
              className="text-base-regular hover:text-ui-fg-base text-ui-fg-subtle"
            >
              {department.name}{" "}
              <span className="text-ui-fg-muted">({department.count})</span>
            </LocalizedClientLink>
          </li>
        ))}
      </ul>

      {empty.length > 0 && (
        <>
          <h2 className="text-large-semi mb-2">Nothing online yet</h2>
          <p className="text-base-regular text-ui-fg-subtle mb-6">
            These departments exist in the store but have no products flagged
            for online ordering.
          </p>
          <ul className="grid grid-cols-2 small:grid-cols-3 medium:grid-cols-4 gap-x-8 gap-y-2">
            {empty.map((department) => (
              <li
                key={department.handle}
                className="txt-compact-small text-ui-fg-muted"
              >
                {department.name}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
