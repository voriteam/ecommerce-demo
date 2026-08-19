import { Module } from "@medusajs/framework/utils"

import VoriModuleService from "./service"

export const VORI_MODULE = "vori"

export default Module(VORI_MODULE, { service: VoriModuleService })
