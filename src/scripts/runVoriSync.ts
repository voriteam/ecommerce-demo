/**
 * Runs the inventory poll once, from the command line.
 *
 *   pnpm sync:inventory
 *
 * Same code path the scheduled task uses, including the watermark, so running
 * it by hand and letting the schedule run it are interchangeable. Reads only.
 */
import 'dotenv/config'

import config from '@payload-config'
import { getPayload } from 'payload'

import { getVoriConfig } from '../vori/config'
import { syncVoriInventory } from '../vori/inventory'

const main = async () => {
  const voriConfig = getVoriConfig()

  if (!voriConfig.apiKey || !voriConfig.storeId) {
    console.error(
      'vori: VORI_API_KEY and VORI_STORE_ID must both be set. Copy .env.example to .env and fill them in.',
    )
    process.exit(1)
  }

  const payload = await getPayload({ config })

  const result = await syncVoriInventory({
    config: voriConfig,
    logger: {
      error: (message) => console.error(message),
      info: (message) => console.info(message),
      warn: (message) => console.warn(message),
    },
    payload,
  })

  console.info(
    `vori: ${result.recordsSeen} inventory records seen, ${result.productsUpdated} products updated`,
  )
  process.exit(0)
}

void main()
