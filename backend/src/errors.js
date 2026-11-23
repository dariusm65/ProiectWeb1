// HTTP-aware error thrown by services; the central errorHandler maps `statusCode` + `code`
// to the JSON response (never leaks stack traces or SQL).
export class ApiError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
