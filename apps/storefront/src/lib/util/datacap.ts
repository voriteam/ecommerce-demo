/**
 * Datacap's WebToken client, loaded from Datacap by VoriPaymentsWrapper.
 *
 * It reads the card straight out of the inputs marked with `data-token` and
 * returns a one-time token. The card number and CVV never pass through this
 * code: only the token, the brand and the last four go on to the server.
 */

export type DatacapToken = {
  Bin?: string
  Brand: string
  ExpirationMonth?: string
  ExpirationYear?: string
  Last4: string
  Token: string
}

type DatacapResponse = DatacapToken | { Errors: string[] } | { Error: string }

type DatacapWebToken = {
  requestToken: (
    tokenKey: string,
    formId: string,
    callback: (response: DatacapResponse) => void
  ) => void
  validateCardNumber: (cardNumber: string) => boolean
  validateCVV: (cvv: string) => boolean
  validateExpirationDate: (month: string, year: string) => boolean
}

declare global {
  interface Window {
    DatacapWebToken?: DatacapWebToken
  }
}

export const datacap = (): DatacapWebToken | null =>
  typeof window === "undefined" ? null : window.DatacapWebToken ?? null

export class DatacapTokenError extends Error {}

export const requestDatacapToken = (
  tokenKey: string,
  formId: string
): Promise<DatacapToken> =>
  new Promise((resolve, reject) => {
    const client = datacap()

    if (!client) {
      reject(new DatacapTokenError("The card form has not finished loading."))
      return
    }

    client.requestToken(tokenKey, formId, (response) => {
      // Current responses carry a list of errors; older ones a single string.
      if ("Errors" in response && response.Errors?.length) {
        reject(new DatacapTokenError(response.Errors.join(" ")))
      } else if ("Error" in response && response.Error) {
        reject(new DatacapTokenError(response.Error))
      } else if ("Token" in response && response.Token) {
        resolve(response)
      } else {
        reject(new DatacapTokenError("The card could not be read."))
      }
    })
  })
