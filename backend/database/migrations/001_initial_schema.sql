-- 1. Schema Migrations Table (D-003)
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  version VARCHAR(255) NOT NULL UNIQUE,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2. Users Table (D-004, D-013, D-018)
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  phone VARCHAR(50) NULL,
  university_domain VARCHAR(100) NULL, -- extracted domain for allowlist matching
  role ENUM('user', 'moderator', 'admin') NOT NULL DEFAULT 'user',
  gender ENUM('female', 'male', 'prefer_not_to_say') NOT NULL DEFAULT 'prefer_not_to_say',
  is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_users_email (email),
  INDEX idx_users_domain (university_domain),
  INDEX idx_users_role (role)
) ENGINE=InnoDB;

-- 3. Known Places Table (Seed Suggestions & Geocoding Autocomplete)
CREATE TABLE IF NOT EXISTS known_places (
  id INT AUTO_INCREMENT PRIMARY KEY,
  city VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  -- NULL until filled from a real Nominatim query; coordinates are never written from memory.
  latitude DECIMAL(10, 7) NULL,
  longitude DECIMAL(10, 7) NULL,
  source VARCHAR(100) NOT NULL DEFAULT 'TODO-fill-from-Nominatim',
  source_query VARCHAR(255) NULL, -- exact Nominatim query that produced the coordinates
  queried_on DATE NULL,           -- date of that query
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_known_place (city, name),
  INDEX idx_known_places_city (city)
) ENGINE=InnoDB;

-- 4. Recurring Ride Rules (Master Template) (D-006)
CREATE TABLE IF NOT EXISTS recurring_ride_rules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  driver_id INT NOT NULL,
  origin_name VARCHAR(150) NOT NULL,
  destination_name VARCHAR(150) NOT NULL,
  departure_time TIME NOT NULL, -- fixed naming
  start_date DATE NOT NULL,
  end_date DATE NULL,
  days_of_week JSON NOT NULL, -- e.g. ["friday"]
  available_seats INT NOT NULL, -- passenger seats excluding driver (CONTEXT.md)
  declared_trip_cost DECIMAL(10, 2) NOT NULL,
  luggage_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  pets_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  smoking_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  women_only BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (driver_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 5. Recurring Rule Stops (Template Waypoints) (D-006)
CREATE TABLE IF NOT EXISTS recurring_rule_stops (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rule_id INT NOT NULL,
  stop_order INT NOT NULL, -- in steps of 10: 10, 20, 30...
  city_name VARCHAR(100) NOT NULL,
  location_name VARCHAR(255) NOT NULL,
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  distance_from_origin_km INT NOT NULL DEFAULT 0,
  estimated_offset_minutes INT NOT NULL DEFAULT 0,
  FOREIGN KEY (rule_id) REFERENCES recurring_ride_rules(id) ON DELETE CASCADE,
  INDEX idx_rule_stops_order (rule_id, stop_order)
) ENGINE=InnoDB;

-- 6. Recurring Ride Exceptions (D-006)
CREATE TABLE IF NOT EXISTS recurring_ride_exceptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rule_id INT NOT NULL,
  exception_date DATE NOT NULL,
  reason VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rule_exception (rule_id, exception_date),
  FOREIGN KEY (rule_id) REFERENCES recurring_ride_rules(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 7. Rides Table (Materialized Instances & Single Rides) (D-003, D-006, D-010, D-018)
CREATE TABLE IF NOT EXISTS rides (
  id INT AUTO_INCREMENT PRIMARY KEY,
  driver_id INT NOT NULL,
  recurring_rule_id INT NULL,
  instance_date DATE NULL, -- date of materialized occurrence
  origin_name VARCHAR(150) NOT NULL,
  destination_name VARCHAR(150) NOT NULL,
  departure_time DATETIME NOT NULL,
  estimated_arrival_time DATETIME NOT NULL,
  available_seats INT NOT NULL, -- passenger seats excluding driver (CONTEXT.md)
  declared_trip_cost DECIMAL(10, 2) NOT NULL,
  luggage_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  pets_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  smoking_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  women_only BOOLEAN NOT NULL DEFAULT FALSE,
  status ENUM('active', 'completed', 'cancelled') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rule_instance (recurring_rule_id, instance_date),
  FOREIGN KEY (driver_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (recurring_rule_id) REFERENCES recurring_ride_rules(id) ON DELETE SET NULL,
  INDEX idx_rides_departure (departure_time),
  INDEX idx_rides_status (status)
) ENGINE=InnoDB;

-- 8. Ride Stops Table (Ordered Waypoints with Soft Removal) (D-005, D-007, D-010)
CREATE TABLE IF NOT EXISTS ride_stops (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ride_id INT NOT NULL,
  stop_order INT NOT NULL, -- steps of 10: 10, 20, 30... allows intermediate insertions
  city_name VARCHAR(100) NOT NULL,
  location_name VARCHAR(255) NOT NULL,
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  distance_from_origin_km INT NOT NULL DEFAULT 0,
  estimated_arrival_time DATETIME NOT NULL,
  removed_at DATETIME NULL, -- soft removal: bookings keep valid FK references
  FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE,
  INDEX idx_ride_stops_order (ride_id, stop_order),
  INDEX idx_stops_city (city_name),
  INDEX idx_stops_coords (latitude, longitude)
) ENGINE=InnoDB;

-- 9. Bookings Table (Single Seat per Booking) (D-003, D-005, D-007, D-010, D-019)
CREATE TABLE IF NOT EXISTS bookings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ride_id INT NOT NULL,
  passenger_id INT NOT NULL,
  pickup_stop_id INT NOT NULL,
  dropoff_stop_id INT NOT NULL,
  price_lei INT NOT NULL, -- permanently locked at booking creation time (D-010)
  status ENUM('pending', 'confirmed', 'rejected', 'cancelled', 'pending_reconfirmation', 'expired') NOT NULL DEFAULT 'pending',
  reconfirm_deadline DATETIME NULL,
  cancellation_fee_lei INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE,
  FOREIGN KEY (passenger_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (pickup_stop_id) REFERENCES ride_stops(id),
  FOREIGN KEY (dropoff_stop_id) REFERENCES ride_stops(id),
  INDEX idx_bookings_status (status),
  INDEX idx_bookings_passenger (passenger_id)
) ENGINE=InnoDB;

-- 10. Chat Messages Table (D-011)
CREATE TABLE IF NOT EXISTS chat_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ride_id INT NOT NULL,
  sender_id INT NOT NULL,
  message_text TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_chat_ride (ride_id, created_at)
) ENGINE=InnoDB;

-- 11. In-App Notifications Table (D-007, D-011)
CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(150) NOT NULL,
  message TEXT NOT NULL,
  idempotency_key VARCHAR(100) NULL UNIQUE, -- ensures lazy on-read alerts are generated once per event
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notif_user (user_id, is_read)
) ENGINE=InnoDB;

-- 12. Reviews Table (D-008)
CREATE TABLE IF NOT EXISTS reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ride_id INT NOT NULL,
  reviewer_id INT NOT NULL,
  reviewed_user_id INT NOT NULL,
  rating_stars TINYINT NOT NULL CHECK (rating_stars BETWEEN 1 AND 5),
  comment TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ride_review (ride_id, reviewer_id, reviewed_user_id),
  FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 13. User Infractions Table (D-016)
CREATE TABLE IF NOT EXISTS user_infractions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  ride_id INT NULL,
  infraction_type ENUM('driver_late_cancel', 'passenger_late_cancel') NOT NULL,
  penalty_percentage_points INT NOT NULL, -- 5 for driver, 3 for passenger
  occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE SET NULL,
  INDEX idx_infractions_user (user_id, occurred_at)
) ENGINE=InnoDB;

-- 14. Moderation Reports Table (D-013, CONTEXT.md)
CREATE TABLE IF NOT EXISTS reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reporter_id INT NOT NULL,
  reported_user_id INT NULL,
  ride_id INT NULL,
  message_id INT NULL,
  reason VARCHAR(100) NOT NULL,
  details TEXT NULL,
  status ENUM('pending', 'resolved', 'dismissed') NOT NULL DEFAULT 'pending',
  resolved_by INT NULL,
  resolved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reported_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE SET NULL,
  FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE SET NULL,
  FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_reports_status (status)
) ENGINE=InnoDB;

-- 15. Geocoding Cache Table (D-009)
CREATE TABLE IF NOT EXISTS geocoding_cache (
  query_hash VARCHAR(64) PRIMARY KEY, -- SHA256 of normalized query or rounded coords
  query_text VARCHAR(255) NOT NULL,
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  cached_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
