import { defineConfig } from "eslint/config"
import medusa from "@medusajs/eslint-plugin"

export default defineConfig([
  ...medusa.configs.recommended,
  {
    // `src/modules/vori/lib` is the Vori API contract: request shaping, money
    // arithmetic and the error taxonomy, with no Medusa imports anywhere in
    // it. That is what lets it be unit tested without booting an application.
    // Its guards are programmer errors that never cross an HTTP boundary — a
    // workflow above always wraps them — so the rule asking for MedusaError,
    // which exists to get HTTP statuses right, does not apply here.
    files: ["src/modules/vori/lib/**/*.ts"],
    rules: { "@medusajs/use-medusa-error-not-generic-error": "off" },
  },
])
