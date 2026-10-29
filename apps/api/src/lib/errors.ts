export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details: unknown[] = [],
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new AppError(404, "NOT_FOUND", `${what} not found`);
export const forbidden = (message = "You do not have permission to perform this action") => new AppError(403, "FORBIDDEN", message);
export const unauthorized = () => new AppError(401, "UNAUTHENTICATED", "Please sign in");
export const conflict = (message: string, code = "CONFLICT") => new AppError(409, code, message);
export const badRequest = (message: string, code = "BAD_REQUEST") => new AppError(400, code, message);
export const unprocessable = (message: string, code = "BUSINESS_RULE") => new AppError(422, code, message);
