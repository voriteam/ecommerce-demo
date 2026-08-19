import type { Endpoint } from 'payload'

import { getVoriConfig } from '@/vori/config'
import { syncVoriInventory } from '@/vori/inventory'

/**
 * Runs the inventory poll immediately instead of waiting for the schedule.
 *
 * This exists for demos. Waiting out a cron interval in front of an audience
 * is dead air, so someone can change a count in Vori, hit this, and refresh
 * the storefront while the change is still the thing being talked about.
 *
 * Admin-only: it is a live call against the Vori API with the store's
 * credentials, and it moves the watermark.
 */
export const voriSyncEndpoint: Endpoint = {
  handler: async (req) => {
    if (!req.user || !req.user.roles?.includes('admin')) {
      return Response.json({ error: 'Admins only' }, { status: 403 })
    }

    const config = getVoriConfig()

    if (!config.apiKey || !config.storeId) {
      return Response.json(
        { error: 'VORI_API_KEY and VORI_STORE_ID must both be set', ok: false },
        { status: 400 },
      )
    }

    try {
      const result = await syncVoriInventory({
        config,
        logger: req.payload.logger,
        payload: req.payload,
      })

      return Response.json({ ok: true, ...result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return Response.json({ error: message, ok: false }, { status: 502 })
    }
  },
  method: 'post',
  path: '/vori/sync-inventory',
}
