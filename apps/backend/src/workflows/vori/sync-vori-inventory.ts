import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { acquireLockStep, releaseLockStep } from "@medusajs/medusa/core-flows"

import { resolveStoreContextStep } from "./steps/resolve-store-context"
import { syncVoriInventoryStep } from "./steps/sync-vori-inventory"

/**
 * The lock key. One store, one sync, one key.
 *
 * Two runs overlapping would fight over the watermark: the slower one would
 * commit a stale value on completion and silently roll the window backwards.
 * A cron every couple of minutes and a demo operator hitting "sync now" make
 * that overlap likely rather than theoretical.
 */
export const VORI_INVENTORY_LOCK = "vori-inventory-sync"

export const syncVoriInventoryWorkflow = createWorkflow("sync-vori-inventory", () => {
  acquireLockStep({
    key: VORI_INVENTORY_LOCK,
    // Fail fast rather than queue up behind a run already in progress: the
    // next scheduled tick is two minutes away and will pick up the same work.
    timeout: 1,
    ttl: 15 * 60,
  })

  const store = resolveStoreContextStep({})
  const result = syncVoriInventoryStep({ store })

  releaseLockStep({ key: VORI_INVENTORY_LOCK })

  return new WorkflowResponse(result)
})
