/**
 * Environment-driven configuration for the Vori integration.
 *
 * Reads are cheap and harmless, so they are enabled by default. Writes are
 * not: this demo talks to the real Vori API, and a misconfigured clone must
 * not be one environment variable away from recording transactions in a
 * grocer's books. Both write switches therefore default to the safe setting
 * and have to be turned on deliberately.
 */

export type VoriConfig = {
  apiKey: string | undefined
  baseUrl: string
  /** When true, build the transaction payload but never POST it. */
  dryRun: boolean
  storeId: string | undefined
  syncCron: string
  syncEnabled: boolean
  writeEnabled: boolean
}

const bool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === '') return fallback
  return value === 'true' || value === '1'
}

export const getVoriConfig = (): VoriConfig => ({
  apiKey: process.env.VORI_API_KEY || undefined,
  baseUrl: process.env.VORI_API_BASE_URL || 'https://api.vori.com',
  dryRun: bool(process.env.VORI_DRY_RUN, true),
  storeId: process.env.VORI_STORE_ID || undefined,
  syncCron: process.env.VORI_SYNC_CRON || '*/2 * * * *',
  syncEnabled: bool(process.env.VORI_SYNC_ENABLED, true),
  writeEnabled: bool(process.env.VORI_WRITE_ENABLED, false),
})

/** Credentials present, so the read endpoints can be called at all. */
export const canRead = (config: VoriConfig = getVoriConfig()): boolean =>
  Boolean(config.apiKey && config.storeId)

/**
 * Every gate open: credentials present, writes enabled, dry-run off. Anything
 * short of this and the order hook records the payload without sending it.
 */
export const canWrite = (config: VoriConfig = getVoriConfig()): boolean =>
  canRead(config) && config.writeEnabled && !config.dryRun

/** Human-readable reason writes are held back, or null when they are not. */
export const writeBlockedReason = (config: VoriConfig = getVoriConfig()): null | string => {
  if (!config.apiKey) return 'VORI_API_KEY is not set'
  if (!config.storeId) return 'VORI_STORE_ID is not set'
  if (!config.writeEnabled) return 'VORI_WRITE_ENABLED is false'
  if (config.dryRun) return 'VORI_DRY_RUN is true'
  return null
}
