// OpenAPI 3.0 specification for StudRide REST API (D-002).

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'StudRide API (P18 Student Carpooling)',
    version: '0.1.0',
    description:
      'REST API for StudRide student carpooling with segment matching. University domain badges are strictly domain-validated (not identity-verified) per D-004.',
  },
  servers: [{ url: '/', description: 'Current host' }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      SafeUser: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          email: { type: 'string', format: 'email' },
          full_name: { type: 'string' },
          phone: { type: 'string', nullable: true },
          university_domain: { type: 'string', nullable: true },
          has_university_badge: { type: 'boolean' },
          university_badge_note: {
            type: 'string',
            example: 'domain-validated (not identity-verified)',
          },
          role: { type: 'string', enum: ['user', 'moderator', 'admin'] },
          gender: { type: 'string', enum: ['female', 'male', 'prefer_not_to_say'] },
          is_suspended: { type: 'boolean' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      AuthResponse: {
        type: 'object',
        properties: {
          token: { type: 'string' },
          user: { $ref: '#/components/schemas/SafeUser' },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
  },
  paths: {
    '/api/health': {
      get: {
        summary: 'API and MySQL database health check',
        tags: ['System'],
        responses: {
          200: { description: 'Service and DB are healthy' },
          503: { description: 'Database unreachable' },
        },
      },
    },
    '/api/auth/register': {
      post: {
        summary: 'Register a new student account (open to any valid email; domain-validated badge for Romanian universities)',
        tags: ['Auth'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password', 'full_name'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                  full_name: { type: 'string', minLength: 2 },
                  phone: { type: 'string', nullable: true },
                  gender: { type: 'string', enum: ['female', 'male', 'prefer_not_to_say'] },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Account created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } },
          },
          400: { description: 'Validation error' },
          409: { description: 'Email already registered' },
        },
      },
    },
    '/api/auth/login': {
      post: {
        summary: 'Authenticate with email and password',
        tags: ['Auth'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Authenticated',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } },
          },
          401: { description: 'Invalid credentials' },
          403: { description: 'Account suspended' },
        },
      },
    },
    '/api/auth/me': {
      get: {
        summary: 'Return current authenticated user profile (verified live against DB)',
        tags: ['Auth'],
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Current user',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/SafeUser' } } },
              },
            },
          },
          401: { description: 'Unauthorized' },
          403: { description: 'Account suspended' },
        },
      },
    },
  },
};
