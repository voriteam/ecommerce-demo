import type { CollectionOverride } from '@payloadcms/plugin-ecommerce/types'

import { v7 as uuidv7 } from 'uuid'

import { voriOrderFields } from './voriFields'

/**
 * Orders, extended with the Vori write path.
 *
 * Two hooks, and the order of them matters:
 *
 *   beforeChange mints the UUIDv7 idempotency key and stores it *with* the
 *   order, in the same write. It has to exist before the first attempt to
 *   send, because the API can only recognise a replay if the replay carries
 *   the key the original attempt did.
 *
 *   afterChange enqueues the send rather than performing it. The ticket asked
 *   for a hook that POSTs; going through the job queue is the same trigger
 *   with retries and backoff for free, and it keeps a checkout from hanging —
 *   or worse, failing — because an upstream API was briefly slow. The shopper
 *   has already paid at this point; recording the sale is our problem, not
 *   theirs.
 */
export const OrdersCollection: CollectionOverride = ({ defaultCollection }) => ({
  ...defaultCollection,
  admin: {
    ...defaultCollection?.admin,
    defaultColumns: ['createdAt', 'customerEmail', 'amount', 'voriSyncStatus'],
  },
  fields: [
    ...defaultCollection.fields,
    {
      name: 'accessToken',
      type: 'text',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
      hooks: {
        beforeValidate: [
          ({ operation, value }) => {
            if (operation === 'create' || !value) {
              return crypto.randomUUID()
            }
            return value
          },
        ],
      },
      index: true,
      unique: true,
    },
    ...voriOrderFields,
  ],
  hooks: {
    ...defaultCollection?.hooks,
    afterChange: [
      ...(defaultCollection?.hooks?.afterChange ?? []),
      async ({ doc, operation, req }) => {
        if (operation !== 'create') return doc

        await req.payload.jobs.queue({
          input: { orderId: String(doc.id) },
          queue: 'vori',
          task: 'recordVoriTransaction',
        })

        req.payload.logger.info(`vori: queued transaction write for order ${doc.id}`)

        return doc
      },
    ],
    beforeChange: [
      ...(defaultCollection?.hooks?.beforeChange ?? []),
      ({ data, operation }) => {
        if (operation === 'create' && !data.voriTransactionId) {
          // Minted here, not at send time. A fresh ID per attempt would turn
          // a dropped response into a duplicate transaction.
          data.voriTransactionId = uuidv7()
          data.voriSyncStatus = 'pending'
        }
        return data
      },
    ],
  },
})
