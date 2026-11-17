"use server"

import { sdk } from "@lib/config"

import { getCacheOptions } from "./cookies"

export type VoriPaymentsSetup = {
  /** Which of the store's processor accounts a card is charged against. */
  mode: "live" | "test" | null
  /** The public key the browser tokenizes with, or null when the store has none. */
  tokenKey: null | string
}

const NOT_AVAILABLE: VoriPaymentsSetup = { mode: null, tokenKey: null }

/**
 * How this store reads a card, as Vori holds it.
 *
 * A store that cannot be reached, or carries no key for the mode, leaves
 * checkout without the Vori Payments option rather than failing: the other
 * payment methods still work.
 */
export async function getVoriPaymentsSetup(): Promise<VoriPaymentsSetup> {
  const next = { ...(await getCacheOptions("vori-payments")) }

  return await sdk.client
    .fetch<{ mode: "live" | "test" | null; token_key: null | string }>(
      "/store/vori/payments",
      {
        method: "GET",
        next,
        cache: "force-cache",
      }
    )
    .then((setup) => ({ mode: setup.mode, tokenKey: setup.token_key }))
    .catch(() => NOT_AVAILABLE)
}
