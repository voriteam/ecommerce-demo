import type { VoriLogger } from "./client"

/**
 * Product photography, by barcode, from Open Food Facts.
 *
 * The Vori API carries no images - there is no image, photo or media field on
 * a store product - but it does carry the barcode that was scanned at the
 * register, and that is the same identifier Open Food Facts files its
 * photography under. So the catalog can be illustrated without the grocer
 * uploading anything.
 *
 * Images are linked, never copied: what is stored against a product is a URL
 * on images.openfoodfacts.org. Their photography is contributed by the public
 * under CC BY-SA, so a store showing it should credit them - see the README.
 *
 * Roughly half of a real grocery catalog gets a match. The rest simply has no
 * image, which the storefront already handles.
 */

const SEARCH_URL = "https://world.openfoodfacts.org/api/v2/search"

/** Their guidance is to identify yourself, so a misbehaving client is reachable. */
const USER_AGENT =
  "vori-ecommerce-demo/1.0 (https://github.com/voriteam/ecommerce-demo) - a Vori grocer-facing API demo"

/** Codes per request. The endpoint caps a page at 100. */
const BATCH_SIZE = 100

/** Between batches. Their limit is per minute, and this is a shared service. */
const BATCH_PAUSE_MS = 1_500

const MAX_ATTEMPTS = 3

/**
 * Barcodes are compared without leading zeros.
 *
 * A register writes what the scanner read, so the same product can be a 12, 13
 * or 14 digit string depending on the symbology, while Open Food Facts returns
 * everything zero-padded to 13. Comparing the significant digits is what makes
 * a UPC-A from the till match an EAN-13 in their database.
 */
export const normalizeBarcode = (barcode: string): string => barcode.replace(/^0+/, "")

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type OpenFoodFactsProduct = {
  code?: string
  image_front_url?: string
  product_name?: string
}

const fetchBatch = async (codes: string[], logger: VoriLogger): Promise<OpenFoodFactsProduct[]> => {
  const query = new URLSearchParams({
    code: codes.join(","),
    fields: "code,product_name,image_front_url",
    page_size: String(BATCH_SIZE),
  })

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${SEARCH_URL}?${query}`, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(60_000),
      })

      if (response.ok) {
        const body = (await response.json()) as { products?: OpenFoodFactsProduct[] }
        return body.products ?? []
      }

      // 429 and 503 are what a shared, donated service says when it wants you
      // to slow down. Anything else is not going to improve on a retry.
      if (response.status !== 429 && response.status !== 503) {
        logger.warn(`open food facts: ${response.status} for a batch of ${codes.length}`)
        return []
      }

      if (attempt < MAX_ATTEMPTS) await sleep(BATCH_PAUSE_MS * attempt * 2)
    } catch (error) {
      logger.warn(`open food facts: ${error instanceof Error ? error.message : String(error)}`)
      if (attempt < MAX_ATTEMPTS) await sleep(BATCH_PAUSE_MS * attempt * 2)
    }
  }

  return []
}

/**
 * Front-of-pack image URLs for as many of these barcodes as have one.
 *
 * Never throws: a catalog seed should not fail because a free service is busy.
 * Products with no match are simply absent from the result.
 */
export const findProductImages = async (
  barcodes: string[],
  logger: VoriLogger,
): Promise<Map<string, string>> => {
  const wanted = Array.from(new Set(barcodes.filter((code) => /^\d{8,14}$/.test(code))))
  const images = new Map<string, string>()

  if (wanted.length === 0) return images

  for (let index = 0; index < wanted.length; index += BATCH_SIZE) {
    const batch = wanted.slice(index, index + BATCH_SIZE)

    for (const product of await fetchBatch(batch, logger)) {
      if (product.code && product.image_front_url) {
        images.set(normalizeBarcode(product.code), product.image_front_url)
      }
    }

    if (index + BATCH_SIZE < wanted.length) await sleep(BATCH_PAUSE_MS)
  }

  logger.info(
    `open food facts: ${images.size} of ${wanted.length} barcodes have product photography`,
  )

  return images
}
