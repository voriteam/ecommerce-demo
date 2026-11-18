"use client"

import { datacapScriptUrl } from "@lib/constants"
import type { VoriPaymentsSetup } from "@lib/data/vori"
import Script from "next/script"
import { createContext, useState } from "react"

export type DatacapState = {
  mode: "live" | "test" | null
  ready: boolean
  tokenKey: null | string
}

export const DatacapContext = createContext<DatacapState>({
  mode: null,
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
  // Ready only for the mode whose script reported it: a tokenizer left over
  // from the other mode would take a card against the wrong environment.
  // next/script calls onReady from its own effect when the script is already
  // loaded, so readiness must never be reset from this component's effects,
  // which run after it.
  const [readyMode, setReadyMode] = useState<DatacapState["mode"]>(null)

  if (!setup.tokenKey || !setup.mode) return <>{children}</>

  return (
    <DatacapContext.Provider
      value={{
        mode: setup.mode,
        ready: readyMode === setup.mode,
        tokenKey: setup.tokenKey,
      }}
    >
      <Script
        key={setup.mode}
        src={datacapScriptUrl(setup.mode)}
        onReady={() => setReadyMode(setup.mode)}
      />
      {children}
    </DatacapContext.Provider>
  )
}

export default VoriPaymentsWrapper
