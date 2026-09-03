import { defineMiddlewares, validateAndTransformBody } from "@medusajs/framework/http"

import {
  ApplyGiftCardSchema,
  RemoveGiftCardSchema,
} from "./store/carts/[id]/gift-cards/validators"

export default defineMiddlewares({
  routes: [
    {
      matcher: "/store/carts/:id/gift-cards",
      method: "POST",
      middlewares: [validateAndTransformBody(ApplyGiftCardSchema)],
    },
    {
      matcher: "/store/carts/:id/gift-cards",
      method: "DELETE",
      middlewares: [validateAndTransformBody(RemoveGiftCardSchema)],
    },
  ],
})
