import type { GlobalConfig } from 'payload'

import { adminOnly } from '@/access/adminOnly'

/**
 * State for the incremental inventory poll.
 *
 * This lives in a global rather than a file on disk for two reasons. It has
 * to survive a Fly machine restart, and — more usefully for a demo — it is
 * visible in the admin panel, so "when did we last hear from Vori, and how
 * many products moved?" is a screen someone can point at rather than a log
 * line someone has to grep for.
 *
 * Everything here is written by the sync task. It is read-only in the admin
 * because editing the watermark by hand would silently skip a window of
 * inventory changes.
 */
export const VoriSync: GlobalConfig = {
  slug: 'voriSync',
  access: {
    read: adminOnly,
    update: adminOnly,
  },
  admin: {
    description:
      'Status of the incremental inventory poll against the Vori API. Written by the sync task.',
    group: 'Vori',
  },
  fields: [
    {
      name: 'watermark',
      type: 'text',
      admin: {
        description:
          'Lower bound for the next poll: only products whose on-hand quantity was written at or after this time are fetched. Empty means the next run does a full pass over the catalog.',
        readOnly: true,
      },
      label: 'Watermark',
    },
    {
      name: 'nextWatermark',
      type: 'text',
      admin: {
        description:
          'Where the run in progress will leave the watermark. Captured before fetching, and five minutes behind the clock, so a quantity written mid-run is picked up next time rather than stepped over.',
        readOnly: true,
      },
      label: 'Next watermark',
    },
    {
      name: 'cursor',
      type: 'text',
      admin: {
        description:
          'Page cursor for a run that stopped partway. Present only while a window is half-written; the watermark does not move until the whole window is in.',
        readOnly: true,
      },
      label: 'Resume cursor',
    },
    {
      name: 'lastRunAt',
      type: 'date',
      admin: { date: { displayFormat: 'yyyy-MM-dd HH:mm:ss' }, readOnly: true },
      label: 'Last run at',
    },
    {
      name: 'lastRunProductsUpdated',
      type: 'number',
      admin: {
        description: 'Products whose on-hand quantity changed in the most recent run.',
        readOnly: true,
      },
      label: 'Products updated',
    },
    {
      name: 'lastRunRecordsSeen',
      type: 'number',
      admin: {
        description:
          'Inventory records returned by Vori in the most recent run, including products this storefront does not carry.',
        readOnly: true,
      },
      label: 'Records seen',
    },
    {
      name: 'lastError',
      type: 'textarea',
      admin: {
        description: 'Cleared on the next successful run.',
        readOnly: true,
      },
      label: 'Last error',
    },
  ],
  label: 'Vori sync status',
}
