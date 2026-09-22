"use client"

import { datacapScriptUrl, datacapTokenKey } from "@lib/constants"
import { datacap } from "@lib/util/datacap"
import Script from "next/script"
import { createContext, useState } from "react"

export const DatacapContext = createContext(false)

/**
 * Loads Datacap's tokenizer for the whole checkout rather than for one
 * session: the card form shows before a payment session exists, and the
 * review step tokenizes after the form has been hidden.
 */
const VoriPaymentsWrapper = ({ children }: { children: React.ReactNode }) => {
  const [ready, setReady] = useState(() => datacap() !== null)

  if (!datacapTokenKey) return <>{children}</>

  return (
    <DatacapContext.Provider value={ready}>
      <Script src={datacapScriptUrl} onReady={() => setReady(true)} />
      {children}
    </DatacapContext.Provider>
  )
}

export default VoriPaymentsWrapper
