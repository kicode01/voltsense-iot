import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, onValue, update } from "firebase/database";
import { getAuth, signInAnonymously } from "firebase/auth";
import * as dotenv from 'dotenv';

// Load variables from .env
dotenv.config();

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.VITE_FIREBASE_DATABASE_URL,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
};

console.log("Initializing ESP32 Simulator for:", firebaseConfig.projectId);

const REQUIRED_KEYS = ['apiKey', 'databaseURL', 'projectId'];
const missing = REQUIRED_KEYS.filter((k) => !firebaseConfig[k]);
if (missing.length > 0) {
  console.error(`Missing Firebase config in .env: ${missing.join(', ')}`);
  process.exit(1);
}

const MAC_ADDRESS = 'AA:BB:CC:DD:EE:FF';

// ---------------------------------------------------------------------------
// Safety gate.
// This script does not just read — it OVERWRITES devices/<MAC> in whatever project .env points at,
// which for this repo is the live production database. Previously it ran unconditionally, so a
// stray `node simulator.js` would wipe a real device node. It now requires an explicit opt-in.
// ---------------------------------------------------------------------------
if (process.env.SIMULATOR_CONFIRM !== 'yes') {
  console.error(`
================================================================================
 REFUSING TO START — this script WRITES to a live Firebase database.

   Project : ${firebaseConfig.projectId}
   Node    : devices/${MAC_ADDRESS}   (fully overwritten)

 If that is really what you want, re-run with:

   SIMULATOR_CONFIRM=yes node simulator.js

 Consider pointing .env at a separate dev/staging project first.
================================================================================`);
  process.exit(1);
}

console.log(`Confirmed. Seeding devices/${MAC_ADDRESS} in "${firebaseConfig.projectId}"...`);

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

const deviceRef = ref(db, `devices/${MAC_ADDRESS}`);

// Initial Structure
const initialData = {
  is_occupied: true,
  state: 'OCCUPIED',
  countdown_remaining_seconds: 0,
  override: false,
  inactivity_limit: 15,
  night_mode_active: false,
  settings: {
    night_mode_enabled: true,
    night_mode_start: '22:00',
    night_mode_end: '06:00'
  },
  ports: {
    port_01: { name: "Desktop PC", relay_status: true, current_amps: 0.8, power_watts: 184.0, energy_kwh: 0.0, voltage: 230.0 },
    port_02: { name: "Mini Fridge", relay_status: true, current_amps: 0.5, power_watts: 115.0, energy_kwh: 0.0, voltage: 230.0 },
    port_03: { name: "Desk Lamp", relay_status: false, current_amps: 0.0, power_watts: 0.0, energy_kwh: 0.0, voltage: 230.0 }
  }
};

async function startSimulator() {
  try {
    console.log("Authenticating anonymously...");
    await signInAnonymously(auth);
    console.log("✅ Authenticated!");

    console.log(`Seeding database at devices/${MAC_ADDRESS} and starting listeners...`);
    await set(deviceRef, initialData);
    console.log("✅ Database successfully seeded. MAC Address for pairing: AA:BB:CC:DD:EE:FF");

    // Simulator State
    let currentState = 'OCCUPIED';
    let secondsInState = 0;
    const SIMULATION_SPEED_MULTIPLIER = 10; // Speed up time 10x for testing

    // Listen for Overrides from Web App
    onValue(ref(db, `devices/${MAC_ADDRESS}/override`), (snapshot) => {
      const overrideActive = snapshot.val();
      if (overrideActive) {
        console.log("[Hardware] Override requested. Resetting to OCCUPIED and turning on all relays.");
        currentState = 'OCCUPIED';
        secondsInState = 0;
        
        const updates = {
          [`devices/${MAC_ADDRESS}/override`]: false,
          [`devices/${MAC_ADDRESS}/state`]: 'OCCUPIED',
          [`devices/${MAC_ADDRESS}/is_occupied`]: true,
          [`devices/${MAC_ADDRESS}/ports/port_01/relay_status`]: true,
          [`devices/${MAC_ADDRESS}/ports/port_02/relay_status`]: true,
          [`devices/${MAC_ADDRESS}/ports/port_03/relay_status`]: true,
        };
        update(ref(db), updates);
      }
    });

    // Main Loop: 1 tick = 1 simulated second
    setInterval(() => {
      secondsInState += SIMULATION_SPEED_MULTIPLIER;
      
      if (currentState === 'OCCUPIED' && secondsInState > 30) {
        currentState = 'IDLE_COUNTDOWN';
        secondsInState = 0;
        console.log("[Hardware] Room Vacant. Starting 15-minute idle countdown...");
      } else if (currentState === 'IDLE_COUNTDOWN' && secondsInState > (15 * 60)) {
        currentState = 'RESPONSE_WINDOW';
        secondsInState = 0;
        console.log("[Hardware] 15 minutes expired. Entering 5-minute Response Window!");
      } else if (currentState === 'RESPONSE_WINDOW' && secondsInState > (5 * 60)) {
        currentState = 'SHUTDOWN';
        secondsInState = 0;
        console.log("[Hardware] 5 minute window expired! Executing Smart Selective Shutdown.");
        
        update(ref(db), {
          [`devices/${MAC_ADDRESS}/ports/port_03/relay_status`]: false,
        });
        console.log("[Hardware] Port 3 drawing < 0.05A. Turned OFF.");
        console.log("[Hardware] Port 1 and 2 have legitimate loads. Kept ON.");
      }

      // Calculate remaining
      let remaining = 0;
      if (currentState === 'IDLE_COUNTDOWN') remaining = Math.max(0, (15 * 60) - secondsInState); 
      if (currentState === 'RESPONSE_WINDOW') remaining = Math.max(0, (5 * 60) - secondsInState);

      update(ref(db), {
        [`devices/${MAC_ADDRESS}/state`]: currentState,
        [`devices/${MAC_ADDRESS}/countdown_remaining_seconds`]: remaining,
        [`devices/${MAC_ADDRESS}/is_occupied`]: currentState === 'OCCUPIED'
      });
      
      if (secondsInState % 10 === 0) {
          console.log(`[Sim] State: ${currentState} | Timer: ${remaining}s`);
      }

    }, 1000); // Run every 1 real second

  } catch (error) {
    console.error("Simulator failed:", error);
  }
}

startSimulator();


