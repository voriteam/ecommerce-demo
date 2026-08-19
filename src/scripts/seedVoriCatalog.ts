/**
 * Mirrors the Vori catalog into this storefront.
 *
 *   pnpm seed:catalog
 *
 * Safe to re-run: products are upserted on their Vori store product ID, so a
 * second run picks up renames, price changes and new items without creating
 * duplicates. Reads only — it never writes to Vori.
 */
import 'dotenv/config'

import config from '@payload-config'
import { getPayload } from 'payload'

import { seedVoriCatalog } from '../vori/catalog'
import { getVoriConfig } from '../vori/config'

const main = async () => {
  const voriConfig = getVoriConfig()

  if (!voriConfig.apiKey || !voriConfig.storeId) {
    console.error(
      'vori: VORI_API_KEY and VORI_STORE_ID must both be set. Copy .env.example to .env and fill them in.',
    )
    process.exit(1)
  }

  const payload = await getPayload({ config })

  console.info(`vori: seeding catalog from store ${voriConfig.storeId} at ${voriConfig.baseUrl}`)

  await seedVoriCatalog({
    config: voriConfig,
    logger: {
      error: (message) => console.error(message),
      info: (message) => console.info(message),
      warn: (message) => console.warn(message),
    },
    payload,
  })

  process.exit(0)
}

void main()
