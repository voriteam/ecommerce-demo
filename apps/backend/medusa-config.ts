import { defineConfig, loadEnv, Modules } from "@medusajs/framework/utils"

import { getVoriConfig } from "./src/modules/vori/lib/config"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

const REDIS_URL = process.env.REDIS_URL

/**
 * Redis backs the event bus, cache, workflow engine and locks.
 *
 * `docker compose up -d` always provides it, so this is not optional in
 * practice. It matters because the order write is a long-running workflow that
 * retries on a delay, and inventory sync takes a lock: with the in-memory
 * defaults both of those would lose their state the moment the server
 * restarts, which during a demo is exactly when someone restarts it.
 */
const redisModules = REDIS_URL
  ? [
      { resolve: "@medusajs/medusa/cache-redis", options: { redisUrl: REDIS_URL } },
      { resolve: "@medusajs/medusa/event-bus-redis", options: { redisUrl: REDIS_URL } },
      {
        resolve: "@medusajs/medusa/workflow-engine-redis",
        options: { redis: { redisUrl: REDIS_URL } },
      },
      {
        resolve: "@medusajs/medusa/locking",
        options: {
          providers: [
            {
              resolve: "@medusajs/medusa/locking-redis",
              id: "locking-redis",
              is_default: true,
              options: { redisUrl: REDIS_URL },
            },
          ],
        },
      },
    ]
  : []

/**
 * Stripe runs in test mode for this demo. Without a key the provider is left
 * unregistered rather than registered broken, so the application still boots
 * and the catalog and inventory halves of the demo still work.
 */
const paymentModule = process.env.STRIPE_API_KEY
  ? [
      {
        resolve: "@medusajs/medusa/payment",
        options: {
          providers: [
            {
              resolve: "@medusajs/medusa/payment-stripe",
              id: "stripe",
              options: {
                apiKey: process.env.STRIPE_API_KEY,
                webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
                capture: true,
              },
            },
          ],
        },
      },
    ]
  : []

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    // Also backs sessions. Without it the framework quietly falls back to an
    // in-memory stand-in and says so on every boot.
    redisUrl: REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    },
  },
  modules: [
    ...redisModules,
    ...paymentModule,
    {
      resolve: "./src/modules/vori",
      options: getVoriConfig(),
    },
  ],
})

// Referenced so the Modules import is not flagged as unused when the optional
// module blocks above are empty.
void Modules
