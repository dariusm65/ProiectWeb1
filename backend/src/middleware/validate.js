// Centralized Zod schema validation middleware (D-014).

function formatIssues(issues) {
  return issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

function makeValidator(source, schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Invalid request payload',
        details: formatIssues(result.error.issues),
      });
    }
    if (source === 'query') {
      Object.defineProperty(req, 'query', {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } else {
      req[source] = result.data;
    }
    return next();
  };
}

export const validateBody = (schema) => makeValidator('body', schema);
export const validateQuery = (schema) => makeValidator('query', schema);
export const validateParams = (schema) => makeValidator('params', schema);
