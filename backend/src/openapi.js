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
          has_recent_cancellation_badge: { type: 'boolean', description: 'Active for 30 days after a driver_late_cancel ("Anulare recentă", D-016)' },
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
          declared_trip_cost: { type: 'number' },
          luggage_allowed: { type: 'boolean' },
          pets_allowed: { type: 'boolean' },
          smoking_allowed: { type: 'boolean' },
          women_only: { type: 'boolean' },
          driver: { $ref: '#/components/schemas/DriverPublicSummary' },
          pickup_stop: { $ref: '#/components/schemas/Stop' },
          dropoff_stop: { $ref: '#/components/schemas/Stop' },
          stops: { type: 'array', items: { $ref: '#/components/schemas/Stop' } },
          pickup_distance_km: { type: 'number' },
          dropoff_distance_km: { type: 'number' },
          free_seats: { type: 'integer', minimum: 1 },
          price_lei: { type: 'integer' },
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
          exceptions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                rule_id: { type: 'integer' },
                exception_date: { type: 'string', format: 'date' },
                reason: { type: 'string', nullable: true },
                created_at: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
      StopEditInput: {
        allOf: [
          { $ref: '#/components/schemas/StopInput' },
          {
            type: 'object',
            properties: {
              id: {
                type: 'integer',
                description: 'Existing active stop id on this ride (omit when inserting a new stop)',
              },
            },
          },
        ],
      },
      Booking: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          ride_id: { type: 'integer' },
          passenger_id: { type: 'integer' },
          pickup_stop_id: { type: 'integer' },
          dropoff_stop_id: { type: 'integer' },
          pickup_stop_name: { type: 'string' },
          dropoff_stop_name: { type: 'string' },
          pickup_stop_order: { type: 'integer' },
          dropoff_stop_order: { type: 'integer' },
          pickup_stop_removed: { type: 'boolean' },
          dropoff_stop_removed: { type: 'boolean' },
          price_lei: { type: 'integer', description: 'Permanently locked at booking creation time (D-007, D-010)' },
          segment_price_lei: { type: 'integer', description: 'Alias of locked price_lei for passenger display (D-010)' },
          status: {
            type: 'string',
            enum: ['pending', 'confirmed', 'rejected', 'cancelled', 'pending_reconfirmation', 'expired'],
          },
          reconfirm_deadline: { type: 'string', format: 'date-time', nullable: true },
          expires_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'Scheduled departure time while status is pending (D-003); null otherwise',
          },
          cancellation_fee_lei: {
            type: 'integer',
            nullable: true,
            description: '50% of price_lei capped at 20 lei when a confirmed booking is cancelled < 4h before departure (D-016)',
          },
          created_at: { type: 'string', format: 'date-time' },
          passenger: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              full_name: { type: 'string' },
              has_university_badge: { type: 'boolean' },
              university_badge_note: { type: 'string', nullable: true },
            },
          },
          ride: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              driver_id: { type: 'integer' },
              driver_name: { type: 'string' },
              driver_has_university_badge: { type: 'boolean' },
              origin_name: { type: 'string' },
              destination_name: { type: 'string' },
              departure_time: { type: 'string', format: 'date-time' },
              estimated_arrival_time: { type: 'string', format: 'date-time' },
              status: { type: 'string', enum: ['active', 'completed', 'cancelled'] },
              women_only: { type: 'boolean' },
            },
          },
        },
      },
      ChatMessage: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          ride_id: { type: 'integer' },
          sender_id: { type: 'integer' },
          message_text: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
          sender: {
            type: 'object',
            description: 'Safe sender summary; never exposes email, phone, gender or password_hash',
            properties: {
              id: { type: 'integer' },
              full_name: { type: 'string' },
              has_university_badge: { type: 'boolean' },
              university_badge_note: { type: 'string', nullable: true },
            },
          },
        },
      },
      Notification: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          user_id: { type: 'integer' },
          type: { type: 'string' },
          title: { type: 'string' },
          message: { type: 'string' },
          is_read: { type: 'boolean' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Review: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          ride_id: { type: 'integer' },
          reviewer_id: { type: 'integer' },
          reviewed_user_id: { type: 'integer' },
          rating_stars: { type: 'integer', minimum: 1, maximum: 5 },
          comment: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          reviewer: {
            type: 'object',
            description: 'Safe reviewer summary; never exposes email, phone, gender or password_hash',
            properties: {
              id: { type: 'integer' },
              full_name: { type: 'string' },
              has_university_badge: { type: 'boolean' },
              university_badge_note: { type: 'string', nullable: true },
            },
          },
        },
      },
      UserPublicProfileAndReviews: {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            description: 'Public profile & dual reputation summary (D-008, D-016); never exposes email, phone, gender or password_hash',
            properties: {
              id: { type: 'integer' },
              full_name: { type: 'string' },
              has_university_badge: { type: 'boolean' },
              university_badge_note: { type: 'string', nullable: true },
              rating_average: { type: 'number', nullable: true },
              rating_count: { type: 'integer' },
              seriousness_score: { type: 'integer', minimum: 0, maximum: 100 },
              has_recent_cancellation_badge: { type: 'boolean' },
              created_at: { type: 'string', format: 'date-time' },
            },
          },
          reviews: {
            type: 'array',
            items: { $ref: '#/components/schemas/Review' },
          },
        },
      },
      Report: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          reporter_id: { type: 'integer', nullable: true },
          reported_user_id: { type: 'integer', nullable: true },
          ride_id: { type: 'integer', nullable: true },
          message_id: { type: 'integer', nullable: true },
          reason: { type: 'string' },
          details: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['pending', 'resolved', 'dismissed'] },
          resolved_by: { type: 'integer', nullable: true },
          resolved_at: { type: 'string', format: 'date-time', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      AdminUserSummary: {
        type: 'object',
        description: 'Moderation user summary with email and dual reputation metrics; never exposes password_hash',
        properties: {
          id: { type: 'integer' },
          email: { type: 'string', format: 'email' },
          full_name: { type: 'string' },
          phone: { type: 'string', nullable: true },
          university_domain: { type: 'string', nullable: true },
          has_university_badge: { type: 'boolean' },
          university_badge_note: { type: 'string', nullable: true },
          role: { type: 'string', enum: ['user', 'moderator', 'admin'] },
          gender: { type: 'string', enum: ['female', 'male', 'prefer_not_to_say'] },
          is_suspended: { type: 'boolean' },
          rating_average: { type: 'number', nullable: true },
          rating_count: { type: 'integer' },
          seriousness_score: { type: 'integer', minimum: 0, maximum: 100 },
          infraction_count: { type: 'integer' },
          has_recent_cancellation_badge: { type: 'boolean' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      PlatformStats: {
        type: 'object',
        properties: {
          total_users: { type: 'integer' },
          suspended_users: { type: 'integer' },
          university_validated_users: { type: 'integer' },
          total_rides: { type: 'integer' },
          active_rides: { type: 'integer' },
          cancelled_rides: { type: 'integer' },
          total_bookings: { type: 'integer' },
          confirmed_bookings: { type: 'integer' },
          total_reports: { type: 'integer' },
          pending_reports: { type: 'integer' },
          total_reviews: { type: 'integer' },
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
          { name: 'date', in: 'query', required: false, schema: { type: 'string', format: 'date' }, description: 'Optional Europe/Bucharest calendar date (D-020); when omitted, searches all upcoming active rides' },
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
    '/api/rides/me': {
      get: {
        summary: "List the authenticated driver's published rides with batched stops, segments, and non-PII bookings",
        tags: ['Rides'],
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Driver published rides',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    rides: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          ride: { $ref: '#/components/schemas/Ride' },
                          stops: { type: 'array', items: { $ref: '#/components/schemas/Stop' } },
                          segments: { type: 'array', items: { $ref: '#/components/schemas/SegmentAvailability' } },
                          bookings: { type: 'array', items: { $ref: '#/components/schemas/Booking' } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          401: { description: 'Unauthorized' },
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
    '/api/rides/{rideId}/bookings': {
      post: {
        summary: 'Request a 1-seat booking on a ride segment (authenticated passenger)',
        description:
          'Strictly 1 seat per booking (D-019). Validates active future ride, blocks driver self-booking, enforces D-018 women_only eligibility, prevents duplicate non-terminal booking on the same ride, locks price_lei (D-010), sets expires_at to ride departure (D-003), and notifies the driver idempotently (D-011).',
        tags: ['Bookings'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'rideId', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['pickup_stop_id', 'dropoff_stop_id'],
                properties: {
                  pickup_stop_id: { type: 'integer' },
                  dropoff_stop_id: { type: 'integer' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Booking request created in pending status',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { booking: { $ref: '#/components/schemas/Booking' } } },
              },
            },
          },
          400: { description: 'Invalid stop range or ride already departed' },
          401: { description: 'Unauthorized' },
          403: { description: 'SELF_BOOKING_NOT_ALLOWED or WOMEN_ONLY_NOT_ALLOWED' },
          404: { description: 'Ride not found' },
          409: { description: 'RIDE_NOT_ACTIVE, DUPLICATE_ACTIVE_BOOKING, NO_SEATS_AVAILABLE, or TRIP_COST_CAP_EXCEEDED' },
        },
      },
      get: {
        summary: 'List all bookings on a ride after lazy reconciliation (driver only)',
        tags: ['Bookings'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'rideId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          200: {
            description: 'Bookings for the ride',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { bookings: { type: 'array', items: { $ref: '#/components/schemas/Booking' } } },
                },
              },
            },
          },
          401: { description: 'Unauthorized' },
          403: { description: 'Only the ride driver may list ride bookings' },
          404: { description: 'Ride not found' },
        },
      },
    },
    '/api/rides/{rideId}/stops': {
      patch: {
        summary: 'Edit stops/schedule on an active future ride (driver only, D-007)',
        description:
          'Updates, inserts, or soft-removes stops inside a FOR UPDATE transaction. Keeps locked price_lei immutable on existing bookings (D-007, D-010), transitions affected confirmed bookings to pending_reconfirmation with reconfirm_deadline, preserves positive monotonic stop_order on soft-removed stops so capacity stays reserved until response/lapse, and auto-rejects pending requests referencing removed stops.',
        tags: ['Rides'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'rideId', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['stops'],
                properties: {
                  stops: {
                    type: 'array',
                    minItems: 2,
                    maxItems: 20,
                    items: { $ref: '#/components/schemas/StopEditInput' },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Updated ride details', content: { 'application/json': { schema: { $ref: '#/components/schemas/RideDetails' } } } },
          400: { description: 'Validation error, invalid stop order, or departure in the past' },
          401: { description: 'Unauthorized' },
          403: { description: 'Not the ride driver' },
          404: { description: 'Ride not found' },
          409: { description: 'Ride is not active' },
        },
      },
      put: {
        summary: 'Replace/edit stops on an active future ride (alias of PATCH /api/rides/{rideId}/stops, D-007)',
        tags: ['Rides'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'rideId', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['stops'],
                properties: {
                  stops: {
                    type: 'array',
                    minItems: 2,
                    maxItems: 20,
                    items: { $ref: '#/components/schemas/StopEditInput' },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Updated ride details', content: { 'application/json': { schema: { $ref: '#/components/schemas/RideDetails' } } } },
          400: { description: 'Validation error, invalid stop order, or departure in the past' },
          401: { description: 'Unauthorized' },
          403: { description: 'Not the ride driver' },
          404: { description: 'Ride not found' },
          409: { description: 'Ride is not active' },
        },
      },
    },
    '/api/rides/{rideId}/cancel': {
      post: {
        summary: 'Cancel an active future ride (driver only, D-016)',
        description:
          'Cancels the ride and all non-terminal bookings (pending, confirmed, pending_reconfirmation) after lazy reconciliation, notifies affected passengers idempotently, and records a driver_late_cancel infraction (-5 pp, 30-day badge, 7-day publishing ban) if seat-holding passengers exist on the Europe/Bucharest departure day (D-016, D-020).',
        tags: ['Rides'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'rideId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          200: {
            description: 'Ride cancelled',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    cancelled_ride_id: { type: 'integer' },
                    cancelled_bookings: { type: 'integer' },
                    infraction_recorded: { type: 'boolean' },
                  },
                },
              },
            },
          },
          400: { description: 'Ride already departed' },
          401: { description: 'Unauthorized' },
          403: { description: 'Not the ride driver' },
          404: { description: 'Ride not found' },
          409: { description: 'Ride is not active' },
        },
      },
    },
    '/api/rides/{rideId}/complete': {
      post: {
        summary: 'Mark an active ride completed after estimated_arrival_time (driver only, D-008)',
        tags: ['Rides'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'rideId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          200: {
            description: 'Ride marked completed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ride: { $ref: '#/components/schemas/Ride' },
                  },
                },
              },
            },
          },
          401: { description: 'Unauthorized' },
          403: { description: 'Not the ride driver' },
          404: { description: 'Ride not found' },
          409: { description: 'RIDE_NOT_ACTIVE or RIDE_BEFORE_ARRIVAL' },
        },
      },
    },
    '/api/bookings/me': {
      get: {
        summary: "List the authenticated passenger's bookings after lazy reconciliation",
        tags: ['Bookings'],
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Caller passenger bookings',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { bookings: { type: 'array', items: { $ref: '#/components/schemas/Booking' } } },
                },
              },
            },
          },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/api/bookings/{bookingId}/accept': {
      post: {
        summary: 'Accept a pending booking inside a SELECT FOR UPDATE transaction (driver only, D-003, D-005)',
        description:
          'Confirms the booking, selectively auto-rejects competing pending requests ONLY on newly saturated segments, and notifies both the accepted passenger and any auto-rejected passengers idempotently (D-011).',
        tags: ['Bookings'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'bookingId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          200: {
            description: 'Booking confirmed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    booking: { $ref: '#/components/schemas/Booking' },
                    auto_rejected_ids: { type: 'array', items: { type: 'integer' } },
                    kept_pending_ids: { type: 'array', items: { type: 'integer' } },
                  },
                },
              },
            },
          },
          401: { description: 'Unauthorized' },
          403: { description: 'Not the ride driver' },
          404: { description: 'Booking not found' },
          409: { description: 'BOOKING_NOT_PENDING, NO_SEATS_AVAILABLE, STOP_REMOVED, or TRIP_COST_CAP_EXCEEDED' },
        },
      },
    },
    '/api/bookings/{bookingId}/reject': {
      post: {
        summary: 'Reject a pending booking request (driver only, D-011)',
        tags: ['Bookings'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'bookingId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          200: {
            description: 'Booking rejected',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { booking: { $ref: '#/components/schemas/Booking' } } },
              },
            },
          },
          401: { description: 'Unauthorized' },
          403: { description: 'Not the ride driver' },
          404: { description: 'Booking not found' },
          409: { description: 'Booking is not pending' },
        },
      },
    },
    '/api/bookings/{bookingId}/reconfirm': {
      post: {
        summary: 'Reconfirm a pending_reconfirmation booking before reconfirm_deadline (passenger only, D-007)',
        tags: ['Bookings'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'bookingId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          200: {
            description: 'Booking reconfirmed',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { booking: { $ref: '#/components/schemas/Booking' } } },
              },
            },
          },
          401: { description: 'Unauthorized' },
          403: { description: 'Not the booking passenger' },
          404: { description: 'Booking not found' },
          409: { description: 'BOOKING_NOT_PENDING_RECONFIRMATION (or lazily lapsed) or STOP_REMOVED' },
        },
      },
    },
    '/api/bookings/{bookingId}/cancel': {
      post: {
        summary: 'Cancel a booking as the passenger (D-016)',
        description:
          'Frees the seat and notifies the driver idempotently. If the booking was confirmed and cancelled < 4 hours before departure, records a passenger_late_cancel infraction (-3 pp) and a 50% cancellation fee capped at 20 lei (D-016). Cancelling while pending or pending_reconfirmation incurs no penalty.',
        tags: ['Bookings'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'bookingId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          200: {
            description: 'Booking cancelled',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    booking: { $ref: '#/components/schemas/Booking' },
                    infraction_recorded: { type: 'boolean' },
                  },
                },
              },
            },
          },
          400: { description: 'Ride already departed' },
          401: { description: 'Unauthorized' },
          403: { description: 'Not the booking passenger' },
          404: { description: 'Booking not found' },
          409: { description: 'Booking is already in a terminal status' },
        },
      },
    },
    '/api/recurring-rides/me': {
      get: {
        summary: "List the authenticated driver's recurring ride rules with batched stops and exceptions",
        tags: ['Recurring rides'],
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Caller recurring ride rules',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    rules: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/RecurringRule' },
                    },
                  },
                },
              },
            },
          },
          401: { description: 'Unauthorized' },
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
    '/api/rides/{rideId}/messages': {
      get: {
        summary: 'List chat messages for a ride (driver and confirmed / pending_reconfirmation passengers only, D-011)',
        description:
          'Runs lazy reconciliation first so overdue pending_reconfirmation bookings lose access immediately (403). Ordered deterministically by created_at ASC, id ASC.',
        tags: ['Chat'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'rideId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          200: {
            description: 'Ordered ride chat messages',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { messages: { type: 'array', items: { $ref: '#/components/schemas/ChatMessage' } } },
                },
              },
            },
          },
          401: { description: 'Unauthorized' },
          403: { description: 'Not an active chat participant (D-011)' },
          404: { description: 'Ride not found' },
        },
      },
      post: {
        summary: 'Post a chat message to an active ride (driver and confirmed / pending_reconfirmation passengers only, D-011)',
        description:
          'Trims and validates message_text (1..2000 chars), rejects posting to cancelled rides (409), persists the message, and fans out idempotent chat_message notifications to other active chat participants.',
        tags: ['Chat'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'rideId', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['message_text'],
                properties: {
                  message_text: { type: 'string', minLength: 1, maxLength: 2000 },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Message posted',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { message: { $ref: '#/components/schemas/ChatMessage' } } },
              },
            },
          },
          400: { description: 'Validation error' },
          401: { description: 'Unauthorized' },
          403: { description: 'Not an active chat participant (D-011)' },
          404: { description: 'Ride not found' },
          409: { description: 'Ride is cancelled (RIDE_NOT_ACTIVE)' },
        },
      },
    },
    '/api/rides/{rideId}/reviews': {
      post: {
        summary: 'Submit a post-arrival mutual 1–5 star rating (D-008)',
        description:
          'Unlocked strictly after estimated_arrival_time <= now on non-cancelled rides. Mutual between the ride driver and passengers with a confirmed booking on that ride. Enforces 1 review per (ride_id, reviewer_id, reviewed_user_id) pair.',
        tags: ['Reviews'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'rideId', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reviewed_user_id', 'rating_stars'],
                properties: {
                  reviewed_user_id: { type: 'integer' },
                  rating_stars: { type: 'integer', minimum: 1, maximum: 5 },
                  comment: { type: 'string', maxLength: 1000, nullable: true },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Review created',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { review: { $ref: '#/components/schemas/Review' } } },
              },
            },
          },
          400: { description: 'Validation error or self-review (SELF_REVIEW_NOT_ALLOWED)' },
          401: { description: 'Unauthorized' },
          403: { description: 'REVIEW_BEFORE_ARRIVAL or NOT_CONFIRMED_PARTICIPANT (D-008)' },
          404: { description: 'Ride not found' },
          409: { description: 'RIDE_CANCELLED or DUPLICATE_REVIEW' },
        },
      },
    },
    '/api/users/{userId}/reviews': {
      get: {
        summary: 'Public student profile, dual reputation summary, and received reviews (D-008, D-016)',
        description:
          'Returns star rating average & count, event-sourced seriousness score %, domain-validated university badge & disclosure note, 30-day "Anulare recentă" badge, and chronological reviews without exposing PII.',
        tags: ['Reviews'],
        parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          200: {
            description: 'Public user reputation and reviews',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UserPublicProfileAndReviews' } } },
          },
          400: { description: 'Invalid userId' },
          404: { description: 'User not found' },
        },
      },
    },
    '/api/users/{userId}': {
      get: {
        summary: 'Public student profile and dual reputation summary (alias of GET /api/users/{userId}/reviews)',
        tags: ['Reviews'],
        parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          200: {
            description: 'Public user reputation and reviews',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UserPublicProfileAndReviews' } } },
          },
          400: { description: 'Invalid userId' },
          404: { description: 'User not found' },
        },
      },
    },
    '/api/notifications': {
      get: {
        summary: "Poll the authenticated user's in-app notifications (D-011)",
        description:
          'Reconciles lazy expirations/lapses on caller rides first, then returns notifications newest-first with unread_count summary.',
        tags: ['Notifications'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'unreadOnly',
            in: 'query',
            schema: { type: 'boolean', default: false },
            description: 'When true, returns only unread notifications (is_read = false)',
          },
        ],
        responses: {
          200: {
            description: 'Caller notifications and unread count',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    notifications: { type: 'array', items: { $ref: '#/components/schemas/Notification' } },
                    unread_count: { type: 'integer' },
                  },
                },
              },
            },
          },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/api/notifications/{notificationId}/read': {
      patch: {
        summary: 'Mark one notification as read (owner only, D-011)',
        tags: ['Notifications'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'notificationId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          200: {
            description: 'Notification marked read',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    notification: { $ref: '#/components/schemas/Notification' },
                    unread_count: { type: 'integer' },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid notificationId' },
          401: { description: 'Unauthorized' },
          403: { description: 'Not the notification owner' },
          404: { description: 'Notification not found' },
        },
      },
    },
    '/api/notifications/read-all': {
      post: {
        summary: "Mark all of the authenticated user's notifications as read (D-011)",
        tags: ['Notifications'],
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'All notifications marked read',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    marked_read_count: { type: 'integer' },
                    unread_count: { type: 'integer', example: 0 },
                  },
                },
              },
            },
          },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/api/reports': {
      post: {
        summary: 'File a moderation report against a user, ride, or chat message (D-013, CONTEXT.md)',
        description:
          'Requires at least one of reported_user_id, ride_id, or message_id. Verifies referenced entities exist and rejects self-reporting.',
        tags: ['Moderation'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reason'],
                properties: {
                  reported_user_id: { type: 'integer', nullable: true },
                  ride_id: { type: 'integer', nullable: true },
                  message_id: { type: 'integer', nullable: true },
                  reason: { type: 'string', minLength: 1, maxLength: 100 },
                  details: { type: 'string', maxLength: 2000, nullable: true },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Report filed in pending status',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { report: { $ref: '#/components/schemas/Report' } } },
              },
            },
          },
          400: { description: 'Validation error, missing target, or self-report' },
          401: { description: 'Unauthorized' },
          404: { description: 'Referenced user, ride, or message not found' },
        },
      },
    },
    '/api/admin/reports': {
      get: {
        summary: 'List moderation reports (moderator / admin only, D-013)',
        tags: ['Moderation'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'status',
            in: 'query',
            schema: { type: 'string', enum: ['pending', 'resolved', 'dismissed'] },
          },
        ],
        responses: {
          200: {
            description: 'Moderation reports',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { reports: { type: 'array', items: { $ref: '#/components/schemas/Report' } } },
                },
              },
            },
          },
          401: { description: 'Unauthorized' },
          403: { description: 'Requires moderator or admin role' },
        },
      },
    },
    '/api/admin/reports/{reportId}': {
      patch: {
        summary: 'Resolve or dismiss a moderation report (moderator / admin only, D-013)',
        tags: ['Moderation'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'reportId', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: { type: 'string', enum: ['resolved', 'dismissed'] },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Report updated',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { report: { $ref: '#/components/schemas/Report' } } },
              },
            },
          },
          400: { description: 'Validation error' },
          401: { description: 'Unauthorized' },
          403: { description: 'Requires moderator or admin role' },
          404: { description: 'Report not found' },
        },
      },
    },
    '/api/admin/users': {
      get: {
        summary: 'List users with seriousness scores, infraction counts, star ratings, and suspension status (moderator / admin only, D-013, D-016)',
        tags: ['Moderation'],
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Users list for moderation',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { users: { type: 'array', items: { $ref: '#/components/schemas/AdminUserSummary' } } },
                },
              },
            },
          },
          401: { description: 'Unauthorized' },
          403: { description: 'Requires moderator or admin role' },
        },
      },
    },
    '/api/admin/users/{userId}/suspend': {
      post: {
        summary: 'Suspend a user account with transactional cancellation cascade (moderator / admin only, D-013, D-016)',
        description:
          'Sets is_suspended = true, cancels all active future rides published by the user (notifying passengers), cancels all active future passenger bookings held by the user (freeing segment seats and notifying drivers), and assesses zero seriousness score penalties or cancellation fees (D-016). Enforces role hierarchy (moderator -> user only; admin -> user or moderator) and blocks self-suspension.',
        tags: ['Moderation'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  reason: { type: 'string', minLength: 1, maxLength: 255, nullable: true },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'User suspended and future rides/bookings cancelled',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    user: { $ref: '#/components/schemas/AdminUserSummary' },
                    cancelled_rides: { type: 'integer' },
                    cancelled_passenger_bookings: { type: 'integer' },
                  },
                },
              },
            },
          },
          400: { description: 'Self-suspension not allowed or invalid userId/reason' },
          401: { description: 'Unauthorized' },
          403: { description: 'Insufficient role permissions or hierarchy' },
          404: { description: 'User not found' },
        },
      },
    },
    '/api/admin/users/{userId}/unsuspend': {
      post: {
        summary: 'Unsuspend a user account (moderator / admin only, D-013)',
        tags: ['Moderation'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          200: {
            description: 'User unsuspended',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/AdminUserSummary' } } },
              },
            },
          },
          400: { description: 'Self-moderation not allowed' },
          401: { description: 'Unauthorized' },
          403: { description: 'Insufficient role permissions or hierarchy' },
          404: { description: 'User not found' },
        },
      },
    },
    '/api/admin/rides/{rideId}/cancel': {
      post: {
        summary: 'Moderative ride cancellation without driver seriousness penalty (moderator / admin only, D-013, D-016)',
        tags: ['Moderation'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'rideId', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  reason: { type: 'string', minLength: 1, maxLength: 255, nullable: true },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Ride cancelled by moderator',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    cancelled_ride_id: { type: 'integer' },
                    cancelled_bookings: { type: 'integer' },
                    infraction_recorded: { type: 'boolean', example: false },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid rideId or reason' },
          401: { description: 'Unauthorized' },
          403: { description: 'Requires moderator or admin role' },
          404: { description: 'Ride not found' },
          409: { description: 'Ride is not active or has already departed' },
        },
      },
    },
    '/api/admin/users/{userId}/role': {
      patch: {
        summary: 'Promote or demote a user between user and moderator roles (admin only, D-013, CONTEXT.md)',
        tags: ['Moderation'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['role'],
                properties: {
                  role: { type: 'string', enum: ['user', 'moderator'] },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Role updated',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/AdminUserSummary' } } },
              },
            },
          },
          400: { description: 'Validation error or self-moderation' },
          401: { description: 'Unauthorized' },
          403: { description: 'Requires admin role or target is an admin' },
          404: { description: 'User not found' },
        },
      },
    },
    '/api/admin/stats': {
      get: {
        summary: 'Platform statistics summary (admin only, D-013, CONTEXT.md)',
        tags: ['Moderation'],
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Platform statistics',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { stats: { $ref: '#/components/schemas/PlatformStats' } } },
              },
            },
          },
          401: { description: 'Unauthorized' },
          403: { description: 'Requires admin role' },
        },
      },
    },
  },
};
