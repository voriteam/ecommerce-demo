"use client"

type StockFilterProps = {
  inStockOnly: boolean
  setQueryParams: (name: string, value: string) => void
}

/**
 * Whether to show products the store has none of.
 *
 * On by default: a grocer's catalog carries plenty that is out of stock at any
 * moment, and a shelf you cannot buy from is noise when you are shopping. The
 * toggle is here because seeing them is exactly what you want when you are
 * checking what the sync pulled across.
 */
const StockFilter = ({ inStockOnly, setQueryParams }: StockFilterProps) => {
  return (
    <div className="flex flex-col gap-y-3">
      <span className="txt-compact-small-plus text-ui-fg-muted">
        Availability
      </span>
      <label className="flex items-center gap-x-2 txt-compact-small text-ui-fg-subtle cursor-pointer">
        <input
          type="checkbox"
          checked={inStockOnly}
          onChange={(event) =>
            setQueryParams(
              "inStockOnly",
              event.target.checked ? "true" : "false"
            )
          }
          className="accent-ui-fg-base"
          data-testid="in-stock-only"
        />
        In stock only
      </label>
    </div>
  )
}

export default StockFilter
