import { model } from "@medusajs/framework/utils"

/**
 * Where inventory sync got to.
 *
 * Exactly one row exists, under a fixed ID, because there is exactly one Vori
 * store behind this demo. It is a table rather than a config value because the
 * watermark has to survive a restart: losing it turns every run into a full
 * catalog pass, and advancing it wrongly silently skips a window of counts.
 */
export const VoriSyncState = model.define("vori_sync_state", {
  id: model.id().primaryKey(),
  /** Where the *next* run should start. Null means never completed a run. */
  watermark: model.text().nullable(),
  /** The watermark an in-flight run has claimed but not yet committed. */
  next_watermark: model.text().nullable(),
  /** Last record ID written by an in-flight run, so a resume skips it. */
  cursor: model.text().nullable(),
  last_error: model.text().nullable(),
  last_run_at: model.dateTime().nullable(),
  last_run_products_updated: model.number().default(0),
  last_run_records_seen: model.number().default(0),
})
