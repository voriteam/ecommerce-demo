import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { recordVoriTransactionWorkflow } from "../workflows/vori/record-vori-transaction"

/**
 * Sends one order to Vori again.
 *
 * For an order whose write was skipped because the gates were closed, or one
 * that failed and needs another attempt after the cause is fixed. Safe to run
 * repeatedly: the order already carries its transaction ID, so Vori sees the
 * same record rather than a second sale.
 *
 * Run with: pnpm record:order <order_id>
 */
export default async function recordVoriOrder({ args, container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const orderId = args[0]

  if (!orderId) {
    logger.error("Pass an order ID: pnpm record:order order_01ABC...")
    process.exit(1)
  }

  const { result } = await recordVoriTransactionWorkflow(container).run({ input: { orderId } })

  logger.info(
    `vori: order ${orderId} is ${result.status}${result.detail ? ` — ${result.detail}` : ""}`,
  )
}
