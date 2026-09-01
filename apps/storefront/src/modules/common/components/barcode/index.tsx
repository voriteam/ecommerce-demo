"use client"

import JsBarcode from "jsbarcode"
import { useEffect, useRef } from "react"

type BarcodeProps = {
  value: string
  className?: string
}

/**
 * A Code 128 barcode, rendered in the browser from a value the demo generated.
 *
 * The whole point of showing it is that the card the shopper just bought carries
 * a real, scannable barcode - the same one sent to the grocer's books - so it is
 * drawn as an actual Code 128 rather than printed as text.
 */
const Barcode = ({ value, className }: BarcodeProps) => {
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!ref.current || !value) {
      return
    }

    JsBarcode(ref.current, value, {
      format: "CODE128",
      displayValue: true,
      fontSize: 14,
      height: 60,
      margin: 0,
      background: "transparent",
    })
  }, [value])

  return <svg ref={ref} className={className} />
}

export default Barcode
