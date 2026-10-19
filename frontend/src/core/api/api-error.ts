export class ApiError extends Error {
  constructor(message: string, public status = 0, public body: unknown = null, public code = 'http') {
    super(message);
    this.name = 'ApiError';
  }
}
