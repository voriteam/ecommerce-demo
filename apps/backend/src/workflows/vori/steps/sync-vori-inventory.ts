import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { VORI_MODULE } from "../../../modules/vori"
import { inventoryFromVori } from "../../../modules/vori/lib/mapping"
import type VoriModuleService from "../../../modules/vori/service"
import { applyInventoryLevels } from "./apply-inventory-levels"
import type { StoreContext } from "./resolve-store-context"

/**
 * How far behind the clock each run's watermark is set.
 *
 * A quantity is stamped when Vori writes it and becomes readable a moment
 * later, so consecutive windows are made to overlap slightly: a count written
 * while the previous run was in flight is picked up rather than stepped over.
 * Re-reading a product costs nothing because the write is an upsert of a
 * current value. Missing one leaves the shelf wrong until something else moves
 * it.
 */
const WATERMARK_BUFFER_MS = 5 * 60 * 1000

export type SyncInventoryResult = {
  productsUpdated: number
  recordsSeen: number
  /** Null on a full pass, which is what the very first run does. */
  watermark: null | string
}

/**
 * Mirrors on-hand quantities from Vori into this store.
 *
 * Vori is the only writer of stock here, so there is no second source of truth
 * to reconcile and the poll interval is a freshness setting rather than a
 * correctness one.
 *
 * The protocol is the one the API's own sync guide documents:
 *
 *   - the first run has no watermark and pulls the whole catalog;
 *   - every later run asks only for what moved, filtered on `updated_at`;
 *   - the next watermark is captured *before* fetching, not from the highest
 *     `updated_at` seen, because a quantity written mid-run can land behind
 *     that value and would then never be fetched;
 *   - each page is written as it arrives, and the cursor is saved with it, but
 *     the watermark only moves once the whole window is in. Records come back
 *     in `id` order, which says nothing about when each was counted, so a run
 *     that stopped halfway holds an arbitrary slice of the catalog —
 *     advancing the watermark there would skip everything still to come.
 */
export const syncVoriInventoryStep = createStep(
  "sync-vori-inventory",
  async (input: { store: StoreContext }, { container }) => {
    const vori = container.resolve(VORI_MODULE) as VoriModuleService
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

    const state = await vori.getSyncState()

    const watermark = state.watermark || null
    // A resumed run keeps the watermark the interrupted one chose, for the
    // same reason it was captured early in the first place.
    const nextWatermark =
      state.next_watermark || new Date(Date.now() - WATERMARK_BUFFER_MS).toISOString()
    let cursor = state.cursor || undefined

    logger.info(
      `vori: inventory sync starting from ${watermark ?? "the beginning (full pass)"}` +
        (cursor ? `, resuming after ${cursor}` : ""),
    )

    let recordsSeen = 0
    let productsUpdated = 0

    try {
      for (;;) {
        const page = await vori.listInventoryPage({ cursor, updatedSince: watermark })

        if (page.data.length === 0) break

        recordsSeen += page.data.length
        productsUpdated += await applyInventoryLevels(
          {
            counts: page.data.map((record) => ({
              quantity: inventoryFromVori(record.current),
              raw: record.current,
              storeProductId: record.id,
            })),
            stockLocationId: input.store.stockLocationId,
          },
          container,
        )

        cursor = page.data[page.data.length - 1].id

        // Saved after the page is written, and recording the cursor rather
        // than the clock: this window is not finished yet.
        await vori.updateSyncState({ cursor, next_watermark: nextWatermark, watermark })

        if (!page.has_more) break
      }

      // The whole window is in, so the watermark can move and the cursor is no
      // longer needed.
      await vori.updateSyncState({
        cursor: null,
        last_error: null,
        last_run_at: new Date(),
        last_run_products_updated: productsUpdated,
        last_run_records_seen: recordsSeen,
        next_watermark: null,
        watermark: nextWatermark,
      })

      logger.info(
        `vori: inventory sync complete — ${recordsSeen} records seen, ${productsUpdated} levels updated`,
      )

      return new StepResponse<SyncInventoryResult>({ productsUpdated, recordsSeen, watermark })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      // The watermark is deliberately left where it was: the next run retries
      // the same window rather than skipping over it.
      await vori.updateSyncState({ last_error: message, last_run_at: new Date() })

      logger.error(`vori: inventory sync failed — ${message}`)
      throw error
    }
  },
)
