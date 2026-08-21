import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { VORI_CATALOG_LOCK } from "../workflows/vori/seed-vori-catalog"
import { VORI_INVENTORY_LOCK } from "../workflows/vori/sync-vori-inventory"

/**
 * Releases the catalog and inventory sync locks.
 *
 * Both workflows take a lock so a scheduled run and a hand-run one cannot
 * interleave, and both release it on the way out. Kill the server mid-run and
 * that release never happens, so the lock sits there until its TTL expires -
 * fifteen minutes for inventory, thirty for the catalog - and every run in the
 * meantime fails with "Failed to acquire lock".
 *
 * This is the recovery hatch for that. Nothing here can tell a lock left by a
 * dead process from one a live sync is holding right now, so make sure the dev
 * server is stopped before running it.
 *
 * Run with: pnpm clear:locks
 */
export default async function clearVoriLocks({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const locking = container.resolve(Modules.LOCKING)

  // The workflows acquire without an owner, which the provider stores as "*".
  // Releasing with the same default is what lets this reach them at all.
  for (const key of [VORI_CATALOG_LOCK, VORI_INVENTORY_LOCK]) {
    const released = await locking.release([key])
    logger.info(released ? `vori: released ${key}` : `vori: ${key} was not held`)
  }
}
