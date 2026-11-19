export class APIError extends Error {
  readonly status: number | undefined
  readonly headers: Headers | Record<string, string> | undefined
  readonly error: unknown
  readonly requestID?: string | null

  constructor(
    status: number | undefined,
    error: unknown,
    message: string | undefined,
    headers: Headers | Record<string, string> | undefined,
  ) {
    super(
      message ??
        (typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : status !== undefined
            ? `${status} API error`
            : 'API error'),
    )
    this.name = 'APIError'
    this.status = status
    this.error = error
    this.headers = headers
    if (headers && typeof (headers as Headers).get === 'function') {
      this.requestID = (headers as Headers).get('x-request-id') ?? (headers as Headers).get('request-id')
    }
  }
}

export class APIConnectionError extends APIError {
  constructor({
    message,
    cause,
  }: { message?: string | null; cause?: unknown } = {}) {
    super(undefined, undefined, message ?? 'Connection error.', undefined)
    this.name = 'APIConnectionError'
    if (cause !== undefined) {
      ;(this as { cause?: unknown }).cause = cause
    }
  }
}

export class APIConnectionTimeoutError extends APIConnectionError {
  constructor({ message }: { message?: string | null } = {}) {
    super({ message: message ?? 'Request timed out.' })
    this.name = 'APIConnectionTimeoutError'
  }
}

export class APIUserAbortError extends APIError {
  constructor({ message }: { message?: string | null } = {}) {
    super(undefined, undefined, message ?? 'Request was aborted.', undefined)
    this.name = 'APIUserAbortError'
  }
}
