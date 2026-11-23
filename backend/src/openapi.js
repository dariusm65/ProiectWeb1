// OpenAPI 3.0 specification for StudRide REST API (D-002).

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'StudRide API (P18 Student Carpooling)',
    version: '0.1.0',
    description:
      'REST API for StudRide student carpooling with segment matching. University domain badges are strictly domain-validated (not identity-verified; mailbox ownership unverified) per D-004.',
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
            nullable: true,
            example: 'domain-validated (not identity-verified; mailbox ownership unverified)',
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
      GeocodeResult: {
        type: 'object',
        properties: {
          lat: { type: 'number' },
          lng: { type: 'number' },
          display_name: { type: 'string' },
          source: { type: 'string', enum: ['cache', 'known_places', 'nominatim'] },
        },
      },
      Stop: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          stop_order: { type: 'integer', description: 'Server-assigned in steps of 10' },
          city_name: { type: 'string' },
          location_name: { type: 'string' },
          latitude: { type: 'number' },
          longitude: { type: 'number' },
          distance_from_origin_km: { type: 'integer' },
          estimated_arrival_time: { type: 'string', format: 'date-time' },
        },
      },
      StopInput: {
        type: 'object',
        required: ['city_name', 'location_name', 'latitude', 'longitude', 'distance_from_origin_km', 'estimated_arrival_time'],
        properties: {
          city_name: { type: 'string' },
          location_name: { type: 'string' },
          latitude: { type: 'number', minimum: -90, maximum: 90 },
          longitude: { type: 'number', minimum: -180, maximum: 180 },
          distance_from_origin_km: { type: 'integer', minimum: 0, description: 'First stop 0, strictly increasing' },
          estimated_arrival_time: { type: 'string', format: 'date-time', description: 'ISO-8601 with offset, strictly increasing' },
        },
      },
      RuleStopInput: {
        type: 'object',
        required: ['city_name', 'location_name', 'latitude', 'longitude', 'distance_from_origin_km', 'estimated_offset_minutes'],
        properties: {
          city_name: { type: 'string' },
          location_name: { type: 'string' },
          latitude: { type: 'number', minimum: -90, maximum: 90 },
          longitude: { type: 'number', minimum: -180, maximum: 180 },
          distance_from_origin_km: { type: 'integer', minimum: 0 },
          estimated_offset_minutes: { type: 'integer', minimum: 0, description: 'Minutes after departure; first stop 0, strictly increasing' },
        },
      },
      RuleStop: {
        allOf: [
          {
            type: 'object',
            properties: {
              stop_order: { type: 'integer', description: 'Server-assigned in steps of 10' },
            },
          },
          { $ref: '#/components/schemas/RuleStopInput' },
        ],
      },
      RideOptions: {
        type: 'object',
        required: ['available_seats', 'declared_trip_cost'],
        properties: {
          available_seats: { type: 'integer', minimum: 1, maximum: 8, description: 'Passenger seats excluding the driver' },
          declared_trip_cost: { type: 'number', minimum: 0, description: 'At most 2 decimals' },
          luggage_allowed: { type: 'boolean', default: true },
          pets_allowed: { type: 'boolean', default: false },
          smoking_allowed: { type: 'boolean', default: false },
          women_only: { type: 'boolean', default: false, description: 'Requires gender = female (D-018)' },
        },
      },
      Ride: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          driver_id: { type: 'integer' },
          recurring_rule_id: { type: 'integer', nullable: true },
          origin_name: { type: 'string' },
          destination_name: { type: 'string' },
          departure_time: { type: 'string', format: 'date-time' },
          estimated_arrival_time: { type: 'string', format: 'date-time' },
          available_seats: { type: 'integer' },
          declared_trip_cost: { type: 'number' },
          luggage_allowed: { type: 'boolean' },
          pets_allowed: { type: 'boolean' },
          smoking_allowed: { type: 'boolean' },
          women_only: { type: 'boolean' },
          status: { type: 'string', enum: ['active', 'completed', 'cancelled'] },
        },
      },
      SegmentAvailability: {
        type: 'object',
        properties: {
          from_stop_id: { type: 'integer' },
          to_stop_id: { type: 'integer' },
          distance_km: { type: 'integer' },
          occupied_seats: { type: 'integer' },
          free_seats: { type: 'integer' },
          price_lei: { type: 'integer', description: 'Proportional segment price in whole lei (D-010)' },
        },
      },
      DriverPublicSummary: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          full_name: { type: 'string' },
          has_university_badge: { type: 'boolean' },
          university_badge_note: { type: 'string', nullable: true, example: 'domain-validated (not identity-verified; mailbox ownership unverified)' },
          rating_average: { type: 'number', nullable: true },
          rating_count: { type: 'integer' },
          seriousness_score: { type: 'integer', minimum: 0, maximum: 100, description: 'Computed on read from infractions (D-016)' },
        },
      },
      PublicPassenger: {
        type: 'object',
        description: 'Confirmed passenger; never exposes email, phone or gender',
        properties: {
          full_name: { type: 'string' },
          has_university_badge: { type: 'boolean' },
          university_badge_note: { type: 'string', nullable: true },
          pickup_stop_name: { type: 'string' },
          dropoff_stop_name: { type: 'string' },
        },
      },
      RideDetails: {
        type: 'object',
        properties: {
          ride: { $ref: '#/components/schemas/Ride' },
          stops: { type: 'array', items: { $ref: '#/components/schemas/Stop' } },
          segments: { type: 'array', items: { $ref: '#/components/schemas/SegmentAvailability' } },
          driver: { $ref: '#/components/schemas/DriverPublicSummary' },
          passengers: { type: 'array', items: { $ref: '#/components/schemas/PublicPassenger' } },
        },
      },
      RideSearchResult: {
        type: 'object',
        properties: {
          ride_id: { type: 'integer' },
          recurring_rule_id: { type: 'integer', nullable: true },
          origin_name: { type: 'string' },
          destination_name: { type: 'string' },
          departure_time: { type: 'string', format: 'date-time' },
          estimated_arrival_time: { type: 'string', format: 'date-time' },
          available_seats: { type: 'integer' },
          luggage_allowed: { type: 'boolean' },
          pets_allowed: { type: 'boolean' },
          smoking_allowed: { type: 'boolean' },
          women_only: { type: 'boolean' },
          driver: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              full_name: { type: 'string' },
              has_university_badge: { type: 'boolean' },
              university_badge_note: { type: 'string', nullable: true },
            },
          },
          pickup_stop: { $ref: '#/components/schemas/Stop' },
          dropoff_stop: { $ref: '#/components/schemas/Stop' },
          pickup_distance_km: { type: 'number' },
          dropoff_distance_km: { type: 'number' },
          free_seats: { type: 'integer', minimum: 1 },
          segment_price_lei: { type: 'integer' },
        },
      },
      RecurringRule: {
        type: 'object',
        properties: {
          rule: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              driver_id: { type: 'integer' },
              origin_name: { type: 'string' },
              destination_name: { type: 'string' },
              departure_time: { type: 'string', example: '18:00:00' },
              start_date: { type: 'string', format: 'date' },
              end_date: { type: 'string', format: 'date', nullable: true },
              days_of_week: { type: 'array', items: { type: 'string' } },
              available_seats: { type: 'integer' },
              declared_trip_cost: { type: 'number' },
              luggage_allowed: { type: 'boolean' },
              pets_allowed: { type: 'boolean' },
              smoking_allowed: { type: 'boolean' },
              women_only: { type: 'boolean' },
            },
          },
          stops: { type: 'array', items: { $ref: '#/components/schemas/RuleStop' } },
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
    '/api/geocoding/search': {
      get: {
        summary: 'Forward geocoding (typed autocomplete): MySQL cache -> known_places -> Nominatim (D-009)',
        description:
          'Returns one best result. Cache hits and known_places never call Nominatim; real Nominatim calls are throttled to <= 1 request/second (C-001).',
        tags: ['Geocoding'],
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2, maxLength: 200 } },
        ],
        responses: {
          200: { description: 'Resolved place', content: { 'application/json': { schema: { $ref: '#/components/schemas/GeocodeResult' } } } },
          400: { description: 'Validation error' },
          404: { description: 'No place found (not cached)' },
          502: { description: 'Geocoding provider unavailable (not cached)' },
        },
      },
    },
    '/api/geocoding/reverse': {
      get: {
        summary: 'Reverse geocoding (map click); coordinates rounded to 4 decimals for the cache key (D-009)',
        tags: ['Geocoding'],
        parameters: [
          { name: 'lat', in: 'query', required: true, schema: { type: 'number', minimum: -90, maximum: 90 } },
          { name: 'lng', in: 'query', required: true, schema: { type: 'number', minimum: -180, maximum: 180 } },
        ],
        responses: {
          200: { description: 'Resolved place', content: { 'application/json': { schema: { $ref: '#/components/schemas/GeocodeResult' } } } },
          400: { description: 'Validation error' },
          404: { description: 'No place found (not cached)' },
          502: { description: 'Geocoding provider unavailable (not cached)' },
        },
      },
    },
    '/api/rides': {
      post: {
        summary: 'Publish a single ride with ordered stops',
        description:
          'Needs >= 2 stops; distances and arrival times strictly increase; stop_order is assigned by the server (10, 20, 30...). women_only requires gender = female (D-018); blocked for 7 days after a driver_late_cancel (D-016).',
        tags: ['Rides'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/RideOptions' },
                  {
                    type: 'object',
                    required: ['stops'],
                    properties: { stops: { type: 'array', minItems: 2, maxItems: 20, items: { $ref: '#/components/schemas/StopInput' } } },
                  },
                ],
              },
            },
          },
        },
        responses: {
          201: { description: 'Ride published', content: { 'application/json': { schema: { $ref: '#/components/schemas/RideDetails' } } } },
          400: { description: 'Validation error or departure in the past' },
          401: { description: 'Unauthorized' },
          403: { description: 'WOMEN_ONLY_NOT_ALLOWED or PUBLISHING_BANNED' },
        },
      },
      get: {
        summary: 'Search rides by pickup/drop-off proximity on a date (public)',
        description:
          'Matches rides with an active pickup stop within radiusKm of the origin and a later active drop-off stop within radiusKm of the destination (Haversine). Segments with 0 free seats are excluded. Recurring rules matching the date are materialised on demand (D-006). Boolean filters: when given, the ride flag must equal the value; when omitted, no filter. women_only rides stay visible and are flagged.',
        tags: ['Rides'],
        parameters: [
          { name: 'originLat', in: 'query', required: true, schema: { type: 'number' } },
          { name: 'originLng', in: 'query', required: true, schema: { type: 'number' } },
          { name: 'destLat', in: 'query', required: true, schema: { type: 'number' } },
          { name: 'destLng', in: 'query', required: true, schema: { type: 'number' } },
          { name: 'date', in: 'query', required: true, schema: { type: 'string', format: 'date' }, description: 'Europe/Bucharest calendar date (D-020)' },
          { name: 'radiusKm', in: 'query', schema: { type: 'number', default: 1, maximum: 5, exclusiveMinimum: 0 }, description: 'D-017: default 1 km, max 5 km' },
          { name: 'universityOnly', in: 'query', schema: { type: 'boolean' }, description: 'Only domain-validated university drivers (D-004)' },
          { name: 'womenOnly', in: 'query', schema: { type: 'boolean' } },
          { name: 'luggageAllowed', in: 'query', schema: { type: 'boolean' } },
          { name: 'petsAllowed', in: 'query', schema: { type: 'boolean' } },
          { name: 'smokingAllowed', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: {
          200: {
            description: 'Matching rides with the matched segment price and free seats',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { rides: { type: 'array', items: { $ref: '#/components/schemas/RideSearchResult' } } } },
              },
            },
          },
          400: { description: 'Validation error (e.g. radiusKm > 5)' },
        },
      },
    },
    '/api/rides/{rideId}': {
      get: {
        summary: 'Ride details (public): stops, per-segment availability and price, driver summary, confirmed passengers',
        tags: ['Rides'],
        parameters: [{ name: 'rideId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          200: { description: 'Ride details', content: { 'application/json': { schema: { $ref: '#/components/schemas/RideDetails' } } } },
          400: { description: 'Invalid ride id' },
          404: { description: 'Ride not found' },
        },
      },
    },
    '/api/recurring-rides': {
      post: {
        summary: 'Create a recurring ride rule (weekly days, optional end date) with template stops',
        description: 'departure_time is Europe/Bucharest wall-clock (D-020). Same women_only and 7-day ban guards as POST /api/rides.',
        tags: ['Recurring rides'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/RideOptions' },
                  {
                    type: 'object',
                    required: ['departure_time', 'start_date', 'days_of_week', 'stops'],
                    properties: {
                      departure_time: { type: 'string', example: '18:00' },
                      start_date: { type: 'string', format: 'date' },
                      end_date: { type: 'string', format: 'date', nullable: true },
                      days_of_week: {
                        type: 'array',
                        minItems: 1,
                        items: { type: 'string', enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] },
                      },
                      stops: { type: 'array', minItems: 2, maxItems: 20, items: { $ref: '#/components/schemas/RuleStopInput' } },
                    },
                  },
                ],
              },
            },
          },
        },
        responses: {
          201: { description: 'Rule created', content: { 'application/json': { schema: { $ref: '#/components/schemas/RecurringRule' } } } },
          400: { description: 'Validation error' },
          401: { description: 'Unauthorized' },
          403: { description: 'WOMEN_ONLY_NOT_ALLOWED or PUBLISHING_BANNED' },
        },
      },
    },
    '/api/recurring-rides/{ruleId}/exceptions': {
      post: {
        summary: 'Skip one date of a recurring rule (driver only)',
        description:
          'Cancels an already-materialised instance together with all pending, confirmed and pending_reconfirmation bookings and notifies the passengers. A same-day exception with seat-holding passengers records a driver_late_cancel infraction (D-016).',
        tags: ['Recurring rides'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'ruleId', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['exception_date'],
                properties: {
                  exception_date: { type: 'string', format: 'date' },
                  reason: { type: 'string', maxLength: 255, nullable: true },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Exception recorded',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    exception: { type: 'object' },
                    cancelled_ride_id: { type: 'integer', nullable: true },
                    cancelled_bookings: { type: 'integer' },
                    infraction_recorded: { type: 'boolean' },
                  },
                },
              },
            },
          },
          400: { description: 'Validation error, date not in rule, or occurrence already departed' },
          401: { description: 'Unauthorized' },
          403: { description: 'Not the rule owner' },
          404: { description: 'Rule not found' },
          409: { description: 'Exception already exists for this date' },
        },
      },
    },
  },
};
