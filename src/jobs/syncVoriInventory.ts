import type { TaskConfig } from 'payload'

import { getVoriConfig } from '@/vori/config'
import { syncVoriInventory } from '@/vori/inventory'

/**
 * Polls Vori for on-hand quantities and mirrors them onto products.
 *
 * Scheduled in-process rather than by an external cron. That is the whole
 * reason this demo is on Fly and not on a serverless host: the poll interval
 * is the demo — someone changes a count on the store floor and the website
 * follows within a couple of minutes — and it cannot be subject to a
 * platform's cron tiering. It does mean the machine has to stay up; see
 * `auto_stop_machines = false` in fly.toml.
 *
 * The schedule enqueues; `jobs.autoRun` in the Payload config is what runs
 * what was enqueued.
 */
export const syncVoriInventoryTask: TaskConfig<'syncVoriInventory'> = {
  slug: 'syncVoriInventory',
  // Overlapping runs would fight over the watermark and could advance it past
  // a window the other one is still writing.
  concurrency: () => 'vori-inventory-sync',
  handler: async ({ req }) => {
    const config = getVoriConfig()

    if (!config.syncEnabled) {
      req.payload.logger.info('vori: inventory sync is disabled (VORI_SYNC_ENABLED=false)')
      return { output: { productsUpdated: 0, recordsSeen: 0, skipped: 'disabled' } }
    }

    if (!config.apiKey || !config.storeId) {
      // Not an error worth retrying: a clone without credentials is a
      // perfectly normal state for this demo to be in.
      req.payload.logger.info(
        'vori: inventory sync skipped — set VORI_API_KEY and VORI_STORE_ID to enable it',
      )
      return { output: { productsUpdated: 0, recordsSeen: 0, skipped: 'no credentials' } }
    }

    const result = await syncVoriInventory({
      config,
      logger: req.payload.logger,
      payload: req.payload,
    })

    return {
      output: {
        productsUpdated: result.productsUpdated,
        recordsSeen: result.recordsSeen,
        skipped: '',
      },
    }
  },
  inputSchema: [],
  label: 'Sync inventory from Vori',
  outputSchema: [
    { name: 'productsUpdated', type: 'number' },
    { name: 'recordsSeen', type: 'number' },
    { name: 'skipped', type: 'text' },
  ],
  // A failed run leaves the watermark untouched, so a retry re-reads the same
  // window rather than skipping it. Retrying is always safe here.
  retries: { attempts: 3, backoff: { type: 'exponential', delay: 10_000 } },
  schedule: [
    {
      cron: process.env.VORI_SYNC_CRON || '*/2 * * * *',
      queue: 'vori',
    },
  ],
}
