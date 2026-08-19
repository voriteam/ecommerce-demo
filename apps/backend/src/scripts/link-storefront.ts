import fs from "node:fs"
import path from "node:path"

import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Points the storefront at this backend.
 *
 * The publishable key is created by the store seed and is the one value the
 * storefront cannot work without, so copying it across by hand is the step
 * everyone forgets. `pnpm setup` runs this so nobody has to.
 */
export default async function linkStorefront({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: keys } = await query.graph({
    entity: "api_key",
    fields: ["id", "token", "type", "revoked_at"],
  })

  const publishable = keys.find((key) => key.type === "publishable" && !key.revoked_at)

  if (!publishable) {
    logger.error("No publishable API key exists. Run the store seed first.")
    process.exit(1)
  }

  const storefront = path.resolve(process.cwd(), "../storefront")
  const envPath = path.join(storefront, ".env.local")

  if (!fs.existsSync(storefront)) {
    logger.info("No storefront in this workspace, so nothing to link.")
    return
  }

  const template = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, "utf8")
    : fs.readFileSync(path.join(storefront, ".env.template"), "utf8")

  const updated = template.replace(
    /^NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=.*$/m,
    `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=${publishable.token}`,
  )

  fs.writeFileSync(envPath, updated)
  logger.info(`Storefront linked to this backend with ${publishable.token}`)
}
