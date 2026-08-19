import type { Field } from 'payload'

/**
 * The Vori side of an order.
 *
 * `voriTransactionId` is the important one. It is a UUIDv7 minted once, when
 * the order is created, and it is the idempotency key for the write: sending
 * the same ID again returns the transaction already on file instead of
 * recording a second one. Minting a fresh ID per attempt would turn a dropped
 * response into a duplicate sale in the store's books, which is why it is
 * persisted with the order rather than generated at send time.
 *
 * The request and response bodies are stored verbatim. That is partly for
 * debugging, but mostly because being able to put the exact JSON on screen
 * next to the order is most of what makes this a useful sales demo.
 */
export const voriOrderFields: Field[] = [
  {
    name: 'voriTransactionId',
    type: 'text',
    admin: {
      description:
        'UUIDv7 idempotency key for the Vori transaction. Generated once when the order is created and reused on every retry.',
      position: 'sidebar',
      readOnly: true,
    },
    index: true,
    label: 'Vori transaction ID',
    unique: true,
  },
  {
    name: 'voriSyncStatus',
    type: 'select',
    admin: {
      description: 'Whether this order has been recorded in Vori.',
      position: 'sidebar',
      readOnly: true,
    },
    defaultValue: 'pending',
    index: true,
    label: 'Vori status',
    options: [
      { label: 'Pending', value: 'pending' },
      { label: 'Recorded', value: 'recorded' },
      { label: 'Conflict', value: 'conflict' },
      { label: 'Failed', value: 'failed' },
      { label: 'Not sent', value: 'skipped' },
    ],
  },
  {
    name: 'voriSyncedAt',
    type: 'date',
    admin: {
      date: { displayFormat: 'yyyy-MM-dd HH:mm:ss' },
      position: 'sidebar',
      readOnly: true,
    },
    label: 'Recorded in Vori at',
  },
  {
    type: 'collapsible',
    admin: {
      description:
        'Exactly what was sent to POST /v1/transactions and exactly what came back. Present even when the transaction was not sent, so the payload can be reviewed before writes are switched on.',
    },
    fields: [
      {
        name: 'voriSyncError',
        type: 'textarea',
        admin: { readOnly: true },
        label: 'Error',
      },
      {
        name: 'voriRequestBody',
        type: 'json',
        admin: { readOnly: true },
        label: 'Request body',
      },
      {
        name: 'voriResponseBody',
        type: 'json',
        admin: { readOnly: true },
        label: 'Response body',
      },
    ],
    label: 'Vori transaction payload',
  },
]
