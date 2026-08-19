/**
 * Environment-driven configuration for the Vori integration.
 *
 * Reads are cheap and harmless, so they are enabled by default. Writes are
 * not: this demo talks to the real Vori API, and a misconfigured clone must
 * not record transactions in a grocer's books by accident. There is one
 * switch for that, defaulting to off, and it has to be turned on
 * deliberately.
 */

export type VoriConfig = {
  apiKey: string | undefined
  baseUrl: string
  storeId: string | undefined
  syncCron: string
  syncEnabled: boolean
  /** When false, build the transaction request but never send it. */
  writeEnabled: boolean
}

const bool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === "") return fallback
  return value === "true" || value === "1"
}

export const getVoriConfig = (): VoriConfig => ({
  apiKey: process.env.VORI_API_KEY || undefined,
  baseUrl: process.env.VORI_API_BASE_URL || "https://api.vori.com",
  storeId: process.env.VORI_STORE_ID || undefined,
  syncCron: process.env.VORI_SYNC_CRON || "*/2 * * * *",
  syncEnabled: bool(process.env.VORI_SYNC_ENABLED, true),
  writeEnabled: bool(process.env.VORI_WRITE_ENABLED, false),
})

/** Credentials present, so the read endpoints can be called at all. */
export const canRead = (config: VoriConfig = getVoriConfig()): boolean =>
  Boolean(config.apiKey && config.storeId)

/**
 * Credentials present and writing turned on. Anything short of this and an
 * order is fully built and stored without being sent.
 */
export const canWrite = (config: VoriConfig = getVoriConfig()): boolean =>
  canRead(config) && config.writeEnabled

/** Human-readable reason writes are held back, or null when they are not. */
export const writeBlockedReason = (config: VoriConfig = getVoriConfig()): null | string => {
  if (!config.apiKey) return "VORI_API_KEY is not set"
  if (!config.storeId) return "VORI_STORE_ID is not set"
  if (!config.writeEnabled) return "VORI_WRITE_ENABLED is false"
  return null
}
