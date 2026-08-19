"use client"

import LocalizedClientLink from "@modules/common/components/localized-client-link"

export type Department = {
  count: number
  handle: string
  name: string
}

type DepartmentPickerProps = {
  departments: Department[]
  selected?: string
}

/**
 * Departments that actually have something on the shelf.
 *
 * A grocer's list runs to several hundred, most of them empty as far as online
 * ordering is concerned, so a menu of all of them would be unusable. This shows
 * the ones worth clicking and sends the rest to the full index.
 */
const DepartmentPicker = ({ departments, selected }: DepartmentPickerProps) => {
  return (
    <div className="flex flex-col gap-y-3">
      <span className="txt-compact-small-plus text-ui-fg-muted">
        Department
      </span>
      <ul className="flex flex-col gap-y-2 max-h-[420px] overflow-y-auto pr-2">
        <li>
          <LocalizedClientLink
            href="/store"
            className={
              selected
                ? "txt-compact-small text-ui-fg-subtle hover:text-ui-fg-base"
                : "txt-compact-small-plus text-ui-fg-base"
            }
          >
            All departments
          </LocalizedClientLink>
        </li>
        {departments.map((department) => (
          <li key={department.handle}>
            <LocalizedClientLink
              href={`/store?department=${department.handle}`}
              className={
                selected === department.handle
                  ? "txt-compact-small-plus text-ui-fg-base"
                  : "txt-compact-small text-ui-fg-subtle hover:text-ui-fg-base"
              }
              data-testid="department-link"
            >
              {department.name}{" "}
              <span className="text-ui-fg-muted">({department.count})</span>
            </LocalizedClientLink>
          </li>
        ))}
      </ul>
      <LocalizedClientLink
        href="/categories"
        className="txt-compact-small text-ui-fg-subtle hover:text-ui-fg-base underline"
      >
        Browse every department
      </LocalizedClientLink>
    </div>
  )
}

export default DepartmentPicker
