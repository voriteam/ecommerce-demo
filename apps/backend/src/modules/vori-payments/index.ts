import { ModuleProvider, Modules } from "@medusajs/framework/utils"

import VoriPaymentsProviderService from "./service"

export default ModuleProvider(Modules.PAYMENT, { services: [VoriPaymentsProviderService] })
