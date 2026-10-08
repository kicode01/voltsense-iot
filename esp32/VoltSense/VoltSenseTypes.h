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

#endif // VOLTSENSE_TYPES_H
