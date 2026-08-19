"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

/**
 * Free-text search over the catalog.
 *
 * Submits to the store page, which passes the term to the Store API's own `q`
 * parameter - so this is a form and a redirect, with the searching itself done
 * where the products are.
 */
const SearchBox = ({ initial = "" }: { initial?: string }) => {
  const router = useRouter()
  const [term, setTerm] = useState(initial)

  return (
    <form
      action="/store"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = term.trim()
        router.push(
          trimmed ? `/store?q=${encodeURIComponent(trimmed)}` : "/store"
        )
      }}
      className="w-full max-w-xs"
      role="search"
    >
      <label htmlFor="catalog-search" className="sr-only">
        Search products
      </label>
      <input
        id="catalog-search"
        name="q"
        type="search"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Search products"
        autoComplete="off"
        className="w-full bg-ui-bg-field border border-ui-border-base rounded-md px-3 py-1.5 txt-compact-small text-ui-fg-base placeholder:text-ui-fg-muted focus:outline-none focus:border-ui-border-interactive"
        data-testid="search-input"
      />
    </form>
  )
}

export default SearchBox
