/*
 * VoltSenseTypes.h — types that appear in FUNCTION SIGNATURES.
 *
 * WHY THIS FILE EXISTS
 *
 * The Arduino build generates function prototypes and inserts them near the top of the translated
 * sketch, ABOVE the point where the .ino defines its own types. Any prototype that names a type
 * declared later in the .ino therefore fails:
 *
 *     error: 'ProbeResult' does not name a type
 *     error: 'RelaySwitchResult' does not name a type
 *
 * The insertion point is not fixed — it moves as functions are added or reordered — so "define the
 * type high enough in the .ino" is a fix that silently rots. Types named in a signature live here
 * instead, and are pulled in by an #include at the top of the sketch, which is always above the
 * generated prototypes.
 *
 * This is not theoretical. The sketch previously worked around it by defining
 * `enum RelaySwitchResult` TWICE — once near the forward declarations and once beside the function
 * definition — which trades "does not name a type" for "multiple definition" and does not compile
 * either way.
 *
 * WHAT BELONGS HERE: only types used in a function signature (return type or parameter).
 * Everything else stays in the .ino, next to the code that explains it.
 *
 * Included AFTER the Arduino core headers, so `String` and friends are available.
 */

#ifndef VOLTSENSE_TYPES_H
#define VOLTSENSE_TYPES_H

#include <Arduino.h>

/**
 * Result of an endpoint reachability probe.
 *
 * `tlsFailed` is separate from a transport failure on purpose: a pinned root that has rotated and a
 * plain network outage look identical to the user ("no alerts arrive"), and the whole point of the
 * probe is to name which one happened.
 */
struct ProbeResult {
  bool reachable;   // TLS + HTTP both completed
  bool tlsFailed;   // TCP got there but the handshake did not
  int code;         // HTTPClient code (negative = transport error)
  String detail;    // human-readable reason
};

/**
 * Outcome of a relay transition attempt.
 *
 * `RELAY_SUPPRESSED` means the derating rules refused the change and the relay is UNCHANGED — a
 * caller that already told the cloud otherwise must repair the record. Safety paths pass
 * `force = true` to bypass the rules entirely.
 */
enum RelaySwitchResult { RELAY_SWITCHED, RELAY_NOOP, RELAY_SUPPRESSED };

/**
 * What should happen to a port when the room empties.
 *
 * Stated by the user, per port, because it CANNOT be inferred. The shutdown used to ask "is this
 * port drawing current?", which infers intent from current — and for this device's loads that is
 * backwards. A lamp draws the same current whether or not anyone is in the room, so an
 * incandescent lamp left burning in an empty room was kept ON (the exact waste the product exists
 * to remove) while a phone on a small charger was cut mid-charge. A 40 W lamp and a 40 W charger
 * are electrically identical; the difference is intent, and intent is not an electrical quantity.
 *
 *   POLICY_OCCUPANCY          (default) cut when the room empties — lamps, fans
 *   POLICY_ALWAYS_ON          never cut — a router, a fridge, anything unattended
 *   POLICY_KEEP_WHILE_DRAWING keep while current flows, then cut — chargers
 *
 * The default is OCCUPANCY because cutting power to an empty room is what the device is FOR;
 * "always on" is an exception the user grants deliberately.
 *
 * Declared here, not in the .ino, because it is a function return type — see this file's header.
 */
enum PortPolicy { POLICY_OCCUPANCY, POLICY_ALWAYS_ON, POLICY_KEEP_WHILE_DRAWING };

#endif // VOLTSENSE_TYPES_H
