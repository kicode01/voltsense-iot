/**
 * Device ownership: claim (attach) and unpair (release).
 *
 * Ownership is NEVER written from the browser. `users/<uid>/owned_devices/<MAC>` and
 * `devices/<MAC>/owner` are set and cleared by the serverless endpoints using the Admin SDK,
 * because the client cannot be trusted to decide who owns what — and the uid it would claim for
 * itself is exactly the value an attacker would choose. The browser's only job here is to prove it
 * is signed in, and to relay either the code the user read off the device or the MAC to release.
 */
import { auth } from './firebase';

/**
 * An Error that carries the HTTP status, so a caller can distinguish "wrong code" (404/403) from
 * "server is down" (5xx) without re-parsing a message string.
 *
 * Declared as a subclass rather than `err.status = ...` on a plain Error: assigning an undeclared
 * property works at runtime but is invisible to the type checker and to anyone reading the code, so
 * a consumer could only discover `status` by tracing the throw site.
 */
class PairingRequestError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) {
    super(message);
    this.name = 'PairingRequestError';
    /** @type {number} */
    this.status = status;
  }
}

// Where the claim endpoint lives. Same origin in production (Vercel serves both the app and the
// functions), so a relative path is correct and avoids a CORS preflight entirely.
const CLAIM_URL = import.meta.env.VITE_CLAIM_URL || '/api/claim';

/**
 * Ask the server to attach a paired device to the signed-in account.
 *
 * Returns { ok: true, mac } or throws an Error with a message fit to show the user.
 */
export const claimDevice = async (code) => {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('You need to be signed in to add a device.');
  }

  const normalized = String(code || '').trim().toUpperCase().replace(/\s+/g, '');
  if (normalized.length === 0) {
    throw new Error('Enter the code shown on the device.');
  }

  // getIdToken() refreshes automatically when the cached token is close to expiry, so a session
  // left open overnight still claims successfully. `true` would force a network round trip on every
  // claim for no benefit.
  const token = await user.getIdToken();

  let response;
  try {
    response = await fetch(CLAIM_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ code: normalized })
    });
  } catch (error) {
    // Network failure — distinct from a rejection, and worth saying so, because retrying is the
    // right response here and pointless for a rejection.
    console.error('Claim request failed to send:', error);
    throw new Error('Could not reach the server. Check your connection and try again.');
  }

  // The endpoint returns JSON on every path, including errors, but a proxy or a cold-start failure
  // can return HTML — read defensively so the user gets a message rather than a parse crash.
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload && typeof payload.error === 'string'
        ? payload.error
        : `Could not add the device (error ${response.status}).`;
    const error = new PairingRequestError(message, response.status);
    throw error;
  }

  if (!payload || payload.ok !== true || typeof payload.mac !== 'string') {
    throw new Error('The server returned an unexpected response.');
  }

  return { ok: true, mac: payload.mac };
};

/** Normalise what the user typed for display, without validating — the server owns validation. */
export const formatPairingCodeInput = (value) => {
  const cleaned = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
  // Group as XXXX-XXXX for legibility; the server strips separators anyway.
  return cleaned.length > 4 ? `${cleaned.slice(0, 4)}-${cleaned.slice(4)}` : cleaned;
};

const UNPAIR_URL = import.meta.env.VITE_UNPAIR_URL || '/api/unpair';

/**
 * Ask the server to release a device from the signed-in account.
 *
 * This must be a server call, not a browser `remove()`. Ownership is recorded in two places —
 * `users/<uid>/owned_devices/<MAC>` AND `devices/<MAC>/owner` — and only the second one is what
 * the rules and /api/claim.js check. Clearing just the first (which is all the browser can do)
 * leaves the device permanently unclaimable by anyone. See /api/unpair.js.
 *
 * Returns { ok: true, mac, wasOwner } or throws an Error with a message fit to show the user.
 */
export const unpairDevice = async (macAddress) => {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('You need to be signed in to remove a device.');
  }

  const mac = String(macAddress || '').trim().toUpperCase();
  if (!mac) {
    throw new Error('No device specified.');
  }

  const token = await user.getIdToken();

  let response;
  try {
    response = await fetch(UNPAIR_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ mac })
    });
  } catch (error) {
    console.error('Unpair request failed to send:', error);
    throw new Error('Could not reach the server. Check your connection and try again.');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload && typeof payload.error === 'string'
        ? payload.error
        : `Could not remove the device (error ${response.status}).`;
    const error = new PairingRequestError(message, response.status);
    throw error;
  }

  if (!payload || payload.ok !== true) {
    throw new Error('The server returned an unexpected response.');
  }

  return { ok: true, mac: payload.mac || mac, wasOwner: payload.was_owner === true };
};
