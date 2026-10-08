# Testing a real background push (closed-app FCM)

**Read this first:** the **Test** button in Settings does **not** test this. It calls
`registration.showNotification()` directly from the open page (`Settings.jsx:114-146`), so it proves
only that permission is granted and the OS can display a notification. It succeeds even on the
previously-broken build, because it never touches FCM, the server, or a background worker.

The real test is a **device-originated alert arriving while the app is fully closed**.

---

## What must be true before you start

| Requirement | How to check |
|---|---|
| A device is **paired to your account** | Dashboard shows 3 ports with real readings (not "Demo") |
| Push is **enabled on this phone** | Settings → Push Notifications reads as enabled |
| A token exists on the server | `pushTokens/<your-uid>` exists in the RTDB console |
| The phone has the **new** worker | Close and reopen the app once before testing (see "Stale worker" below) |
| iOS only | The app must be **added to the Home Screen**; a Safari tab cannot receive this push |

### Timing you are waiting for (defaults)

```
last motion  ──15 min idle──▶  ALERT SENT  ──5 min response window──▶  relays shut off
                               ("...in 60 seconds")        (the text is wrong; it is 5 minutes)
```

So from the moment you stop moving around the room: **~15 minutes to the notification**, then a
further **5 minutes** before anything actually powers down. Nothing is lost during that window — you
can reopen the app and press "Keep On".

---

## Test A — overcurrent (fastest)

The overcurrent trip is the most reliable trigger: it fires the moment current exceeds the limit.

1. **Close the app completely** — swipe it away from the app switcher. Do not leave it backgrounded
   in a recent tab only; on Android, also avoid keeping the PWA visible in another window.
2. Plug a load into a port that draws **more than the limit (default 4.5 A)**, or lower
   `settings/overcurrent_limit_a` to something small (e.g. `1.0`) from the RTDB console and use a
   modest load.
3. **Expect within a few seconds:** one OS notification titled *"⚠️ VoltSense Overcurrent"*, and the
   port's relay switching off (you can hear the click).
4. Open the app. The **Alerts** tab should show the same event, and the badge should have incremented.

The device also prints the trip to Serial at 115200:
`OVERCURRENT TRIP: port N cut at X.XX A (limit Y.YY A).`

## Test B — occupancy shutdown (the natural way; just wait)

1. **Close the app.**
2. Leave the room still. After the inactivity window (default **15 min** from the last motion) the
   device sends *"The room has been empty. Devices will shut down in 60 seconds."*
3. Expect one OS notification at that moment — **while the app is closed**. That is the whole test.
4. **Note on the wording:** the alert text says "60 seconds", but the firmware's actual response
   window is **5 minutes** (`RESPONSE_WINDOW_MS = 300 * 1000UL`, `VoltSense.ino:176`). The message
   text is wrong, not the behaviour. Nothing shuts down 60 seconds after the alert — you have five
   minutes to reopen the app and press "Keep On".
5. No configuration change is needed. (Lowering `settings/inactivity_limit_minutes` only makes it
   faster; there is no UI to set it back, so prefer just waiting.)

---

## If nothing arrives — diagnose in this order

Work down the list; each step rules out one link in the chain.

**1. Did the server even try to send?**
RTDB console → `devices/<YOUR-MAC>/alerts/<newest>`. The newest entry is the alert you just caused.

| `outcome` | Meaning | Fix |
|---|---|---|
| `sent` | FCM accepted it for delivery | The problem is on the phone side — continue to step 3 |
| `partial` | Some tokens worked | A stale token on another device; harmless |
| `failed` | Every send failed | FCM credentials / project mismatch in Vercel |
| `skipped` + `reason: no-owners` | No owner resolved for the MAC | The device is not claimed to your account |
| `skipped` + `reason: no-tokens` | Owners exist, but no token stored | Push was never enabled, or the token was cleared |

If there is **no new entry at all**, the device never reached the server — check the device's Serial
output. `Alert → HTTP 401` means the alert secret does not match; `connection refused`/timeout means
the network or a stale deployment.

**2. Is a token actually stored?**
RTDB console → `pushTokens/<your-uid>`. It should contain a `token` string, plus `platform` and
`updated_at`. If it is missing, re-enable push in Settings and confirm the app reports success.

**3. Is the phone using the NEW worker?** (the most likely cause of a silent failure)
On the phone, open the deployed site and check the worker. In desktop Chrome you can inspect it
directly; on a phone, the practical check is:

- Open `https://voltsense-iot.web.app` in the phone's browser.
- The app should prompt to update (or update on its own). **Close the app fully and reopen it**, so
  the new service worker takes control before you test.
- A worker updated at runtime only takes control of the page on the *next* load; that delay is
  normal and is why the first test after a deploy can fail while a later one succeeds.

To confirm the deployed worker is correct from any computer:

```
curl -s https://voltsense-iot.web.app/sw.js | grep -c 'importScripts("/firebase-messaging-sw.js")'
# must print 1
```

If this prints `1` (it currently does), the *server* is serving the fixed worker — so a failure is
on the device side (steps 1–3), not the deploy.

**4. Notification permission / OS-level suppression.**
- The OS may be silently suppressing notifications: check the **system** notification settings for
  the browser/app, not just the site permission. Android's battery optimisation can also delay or
  drop background pushes — set the browser to "Unrestricted" if you are troubleshooting.
- On iOS, confirm the app is genuinely installed to the Home Screen.

**5. Did it arrive as TWO notifications?**
If you get a duplicate, the duplicate-suppression fix regressed — reopen a bug. One event must
produce exactly one notification.

---

## Note on `successCount`

FCM reporting `sent` means the message was **accepted for delivery**. It is not proof that the OS
displayed anything. That is precisely why this test must be done on a real phone with the app
closed — no build check, curl, or server log can substitute for it.

---

## Cleanup after testing

If you temporarily changed `settings/inactivity_limit_minutes` or
`settings/overcurrent_limit_a` to provoke an alert, **set them back** to the values you want the
device to enforce. Both are read by the firmware at runtime, and there is currently **no UI control
for either** (see `INTEGRATION-AUDIT.md` §4), so a value you forget here persists silently.
