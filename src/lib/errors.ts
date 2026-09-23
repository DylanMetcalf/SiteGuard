export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = 'bad_request') => new HttpError(400, code, message);
export const unauthorized = (message = 'Sign in to continue.') => new HttpError(401, 'unauthorized', message);
export const paymentRequired = (message: string) => new HttpError(402, 'payment_required', message);
export const forbidden = (message = "You don't have permission to do that.") => new HttpError(403, 'forbidden', message);
/** Used for anything outside the caller's tenant, so existence is never leaked. */
export const notFound = (message = 'Not found.') => new HttpError(404, 'not_found', message);
export const conflict = (message: string) => new HttpError(409, 'conflict', message);
export const unavailable = (message: string) => new HttpError(503, 'unavailable', message);
