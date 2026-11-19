# CONTEXT — P18 Student Carpooling vocabulary

<!-- graffino-agentic:begin v1 -->
> The approved terms for this project. Use each term exactly as defined, in the part
> of speech given. Never swap in a synonym; never use a word on an _Avoid_ line.
<!-- graffino-agentic:end -->

---

## Platform domain terms

**Ride** (noun) — A single trip published by a driver, with an origin, an ordered list of intermediate stops, a destination, a schedule, seat count, and pricing. A ride is either a one-off instance or a materialised instance of a recurring rule.
_Avoid_: trip (as a primary term), journey, course

**Recurring ride** (noun) — A ride defined by a weekly recurrence rule (selected days + optional end date) stored alongside its exceptions. Individual dates are materialised as ride instances on demand when searched.
_Avoid_: repeating trip, scheduled ride, cron ride

**Ride instance** (noun) — A concrete ride row in the database materialised from a recurring ride rule for a specific date. Bookings, stop edits, and chat attach to the instance, not the rule.
_Avoid_: occurrence, event

**Available seats** (noun) — The number of passenger seats offered in the vehicle, strictly excluding the driver (e.g., a car carrying 4 people total has `available_seats = 3`). Used in cost-sharing calculations as `available_seats + 1` total shares.
_Avoid_: total seats, car capacity (when referring to passenger spots)

**Stop** (noun) — An ordered waypoint on a ride (origin, intermediate, or destination), each with a name, geocoded coordinates, and an estimated arrival time.
_Avoid_: waypoint, checkpoint, location (when referring to a stop)

**Segment** (noun) — The portion of a ride between two consecutive stops. Seat availability, pricing, and booking scope are all computed per segment.
_Avoid_: leg, interval, stretch

**Booking** (noun) — A passenger's reservation of a seat on a specific segment range of a ride, with a lifecycle status.
_Avoid_: reservation (as a primary term), ticket, slot

**Booking status** (noun, one of) — `pending` · `confirmed` · `rejected` · `cancelled` · `pending_reconfirmation` · `expired`. Use these exact strings in code, database columns, and documentation.

**Seriousness score** (noun) — A percentage-based reputation metric (0%–100%, start 100%) computed on read from infraction events. Decreased by late cancellations (−5 percentage points for driver, −3 percentage points for passenger) and recovered by +1 percentage point per full 7 days without new infractions. Distinct from the star rating.
_Avoid_: trust score, reliability score, reputation score

**Star rating** (noun) — The 1–5 mutual rating left by a driver and passenger after ride completion. Displayed on profiles as an average with ride count.
_Avoid_: score (when referring to the star rating), review score

**University badge** (noun) — The "university domain" badge (domain-validated, not identity-verified) shown on a profile when the account's email domain matches an approved university domain allowlist. Set at registration; indicates domain format match only, not verified mailbox ownership or physical student identity.
_Avoid_: verified badge, verified student, identity badge

**Women-only ride** (noun) — An optional safety preference ride filter and publishing option based on self-declared private gender (`female` required to publish or book). Documented as lowest priority / cut-first scope under schedule constraints.
_Avoid_: women ride, girls carpool

**Reconfirmation deadline** (noun) — The timestamp by which a passenger in `pending_reconfirmation` status must accept or decline a stop change, after which the booking auto-lapses. Computed as: if modified > 2 h before departure -> `min(now + 6 h, departure − 2 h)`; if modified <= 2 h before departure -> `min(now + 30 min, departure)`.
_Avoid_: timeout, expiry

**Report** (noun) — A moderation record filed by a user against a user, a ride, or a chat message, with a fixed reason and optional free-text detail.
_Avoid_: complaint, flag, ticket

**Moderator** (noun) — A role that can view and resolve/dismiss reports, cancel or remove rides, and suspend/unsuspend accounts.
_Avoid_: admin (when referring specifically to the moderator role)

**Admin** (noun) — A role that has all moderator permissions and can additionally manage user roles (promote/demote moderators) and view platform statistics.
_Avoid_: super-admin, root

**Geocoding cache** (noun) — The `geocoding_cache` MySQL table that stores resolved forward and reverse geocoding results to avoid repeated calls to Nominatim/Photon and persist results across server restarts.
_Avoid_: cache table, geo cache

**Segment price** (noun) — The cost assigned to one segment of a ride, computed proportionally to that segment's distance relative to the total ride distance and the driver's declared trip cost.
_Avoid_: fare, leg price, partial price

---

## Legacy / coursework terms (kept for earlier lab assignments)

**Laborator** (noun) — An individual practical assignment or lab session module.
_Avoid_: homework, tasklet, ticket

**Assignment** (noun) — The specific problem set or coursework requirements issued by the instructor.
_Avoid_: issue, story, epic

**Cerinta** (noun) — A specific requirement or sub-task within a laboratory assignment.
_Avoid_: feature request, change request

**Template** (noun) — A reusable HTML skeleton or markup layout provided for an exercise.
_Avoid_: boilerplate, theme

**Solutie** (noun) — The student's completed code fulfilling the lab assignment requirements.
_Avoid_: delivery, package

**Indrumar** (noun) — The laboratory guide or workbook containing instructions and specifications.
_Avoid_: manual, runbook
