"use client"

import { datacapScriptUrl } from "@lib/constants"
import type { VoriPaymentsSetup } from "@lib/data/vori"
import { datacap } from "@lib/util/datacap"
import Script from "next/script"
import { createContext, useState } from "react"

export type DatacapState = {
  ready: boolean
  tokenKey: null | string
}

export const DatacapContext = createContext<DatacapState>({
  ready: false,
  tokenKey: null,
})

/**
 * Loads Datacap's tokenizer for the whole checkout rather than for one
 * session: the card form shows before a payment session exists, and the
 * review step tokenizes after the form has been hidden.
 *
 * The key and the environment come from the store's own record in Vori, so a
 * key the grocer rotates takes effect without a redeploy.
 */
const VoriPaymentsWrapper = ({
  children,
  setup,
}: {
  children: React.ReactNode
  setup: VoriPaymentsSetup
}) => {
  const [ready, setReady] = useState(() => datacap() !== null)

  if (!setup.tokenKey || !setup.mode) return <>{children}</>

  return (
    <DatacapContext.Provider value={{ ready, tokenKey: setup.tokenKey }}>
      <Script
        src={datacapScriptUrl(setup.mode)}
        onReady={() => setReady(true)}
      />
      {children}
    </DatacapContext.Provider>
  )
}

export default VoriPaymentsWrapper
