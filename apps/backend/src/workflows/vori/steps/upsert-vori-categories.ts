import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import {
  createProductCategoriesWorkflow,
  updateProductCategoriesWorkflow,
} from "@medusajs/medusa/core-flows"

import {
  uniqueDepartmentHandles,
  voriDepartmentToMedusa,
  type VoriStoreDepartment,
} from "../../../modules/vori/lib/mapping"

/** Vori department ID to Medusa product category ID. */
export type CategoryIdsByDepartment = Record<string, string>

/** How many categories to hand to one workflow run. */
const CHUNK = 100

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Mirrors Vori departments as product categories.
 *
 * Matching is on the Vori department ID kept in category metadata rather than
 * on the name, so a department a grocer renames moves its products with it
 * instead of orphaning them under a stale category.
 *
 * Handles are a real hazard here. A grocer's department list runs to several
 * hundred entries and the same name appears more than once, while Medusa
 * requires a category handle to be unique across the whole store - so the
 * handles are resolved against both the incoming list and the categories that
 * already exist before anything is created.
 */
export const upsertVoriCategoriesStep = createStep(
  "upsert-vori-categories",
  async (departments: VoriStoreDepartment[], { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

    const { data: existing } = await query.graph({
      entity: "product_category",
      fields: ["id", "handle", "metadata"],
    })

    const byDepartmentId = new Map<string, string>()
    for (const category of existing) {
      const voriId = (category.metadata as Record<string, unknown> | null)?.vori_store_department_id
      if (typeof voriId === "string") byDepartmentId.set(voriId, category.id)
    }

    const toCreate = departments.filter((d) => !byDepartmentId.has(d.id))
    const toUpdate = departments.filter((d) => byDepartmentId.has(d.id))

    // Parents before children, so a child always has a parent ID to point at.
    // A grocer's list is several hundred departments deep and only browsable
    // as a tree, so the nesting is worth carrying across.
    const known = new Set(byDepartmentId.keys())
    const ordered: VoriStoreDepartment[] = []
    let remaining = [...toCreate]

    while (remaining.length) {
      const ready = remaining.filter(
        (d) => !d.parent_department_id || known.has(d.parent_department_id),
      )

      // A parent outside this list, or a cycle: create them as top level
      // rather than dropping the products underneath them on the floor.
      const batch = ready.length ? ready : remaining

      for (const department of batch) {
        ordered.push(department)
        known.add(department.id)
      }

      const taken = new Set(batch.map((d) => d.id))
      remaining = remaining.filter((d) => !taken.has(d.id))
    }

    // Only new categories need a handle; an existing one keeps the handle it
    // was created with, so links to it never move.
    const handles = uniqueDepartmentHandles(
      toCreate,
      existing.map((category) => category.handle as string).filter(Boolean),
    )

    for (const batch of chunk(ordered, CHUNK)) {
      const { result } = await createProductCategoriesWorkflow(container).run({
        input: {
          product_categories: batch.map((department) =>
            voriDepartmentToMedusa(department, {
              handle: handles[department.id],
              parentCategoryId: department.parent_department_id
                ? byDepartmentId.get(department.parent_department_id)
                : undefined,
            }),
          ),
        },
      })

      result.forEach((category, index) => byDepartmentId.set(batch[index].id, category.id))
    }

    // Names are the only thing a refresh changes, so departments that share one
    // are updated together rather than one workflow run each.
    const byName = new Map<string, string[]>()
    for (const department of toUpdate) {
      const ids = byName.get(department.name) ?? []
      ids.push(byDepartmentId.get(department.id)!)
      byName.set(department.name, ids)
    }

    for (const [name, ids] of byName) {
      await updateProductCategoriesWorkflow(container).run({
        input: { selector: { id: ids }, update: { name } },
      })
    }

    const suffixed = Object.entries(handles).filter(([id, handle]) => handle.endsWith(`-${id}`))
    if (suffixed.length) {
      logger.info(
        `vori: ${suffixed.length} departments share a name with another, so their handles carry the department ID`,
      )
    }

    logger.info(`vori: ${toCreate.length} categories created, ${toUpdate.length} refreshed`)

    return new StepResponse<CategoryIdsByDepartment>(Object.fromEntries(byDepartmentId))
  },
)
