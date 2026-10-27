import admin from 'firebase-admin';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const databaseURL = process.env.FIREBASE_DATABASE_URL || 'https://voltsense-iot-default-rtdb.asia-southeast1.firebasedatabase.app';

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL
});

const db = admin.database();
const mac = '58:2A:BD:D4:8F:98';
const deviceRef = db.ref(`devices/${mac}`);
const logPath = 'C:\\Users\\PC\\.gemini\\antigravity\\brain\\b173a88e-87b1-4226-921f-e83880dc52d4\\.system_generated\\tasks\\task-1630.log';

function getRecentLogs(lines = 25) {
  try {
    const content = fs.readFileSync(logPath, 'utf8');
    const allLines = content.split('\n');
    return allLines.slice(-lines).join('\n');
  } catch (err) {
    return 'Could not read log file: ' + err.message;
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

console.log('====================================================');
console.log('VoltSense Live Settings & God Mode Verification');
console.log('Target Device MAC:', mac);
console.log('====================================================\n');

// TEST 1: Database Reachability & Initial Snapshot
console.log('[STEP 1] Testing Firebase RTDB Connection...');
const initSnap = await deviceRef.once('value');
if (!initSnap.exists()) {
  console.error('FAIL: Device does not exist in RTDB');
  process.exit(1);
}
console.log('  -> PASS: Database connection verified. Telemetry active.\n');

// TEST 2: Testing Settings Update (Bench Mode & Nominal Voltage & Delays)
console.log('[STEP 2] Testing Settings Page Integration...');
const testSettings = {
  nominal_voltage: 220.0,
  bench_mode: true,
  acs712_mv_per_amp: 123.33,
  current_noise_floor_a: 0.03,
  pir_delay_seconds: 4,
  mmwave_delay_seconds: 2,
  sensor_fusion_mode: 'OR'
};

console.log('  -> Writing settings to RTDB:', testSettings);
await deviceRef.child('settings').update(testSettings);
console.log('  -> Waiting 2.5s for ESP32 to poll and execute remote change...');
await sleep(2500);

console.log('\n--- ESP32 SERIAL MONITOR LOG OUTPUT ---');
console.log(getRecentLogs(15));
console.log('----------------------------------------\n');

// TEST 3: Testing God Mode Simulation (Speed-Run & Force PIR / mmWave)
console.log('[STEP 3] Testing God Mode Simulation Controls...');
const godModeSimulation = {
  inactivity_limit_seconds: 15,
  inactivity_limit_minutes: 0.25,
  response_window_seconds: 10,
  force_pir: 1,      // Simulate occupancy detected by PIR
  force_mmwave: 1    // Simulate occupancy detected by radar
};

console.log('  -> Writing God Mode simulation overrides:', godModeSimulation);
await deviceRef.child('settings').update(godModeSimulation);
console.log('  -> Waiting 2.5s for ESP32 to receive overrides...');
await sleep(2500);

console.log('\n--- ESP32 SERIAL MONITOR LOG OUTPUT ---');
console.log(getRecentLogs(15));
console.log('----------------------------------------\n');

// TEST 4: Restoring Production Settings (God Mode Reset)
console.log('[STEP 4] Restoring Normal Production Settings...');
const restoredSettings = {
  inactivity_limit_seconds: 900,
  inactivity_limit_minutes: 15,
  response_window_seconds: 300,
  force_pir: -1,     // Remove simulation override
  force_mmwave: -1   // Remove simulation override
};

await deviceRef.child('settings').update(restoredSettings);
console.log('  -> God Mode overrides cleared.');
await sleep(2500);

console.log('\n--- ESP32 SERIAL MONITOR LOG OUTPUT ---');
console.log(getRecentLogs(15));
console.log('----------------------------------------\n');

// Final Telemetry Check
const finalSnap = await deviceRef.once('value');
const val = finalSnap.val();
console.log('====================================================');
console.log('VERIFICATION SUMMARY:');
console.log('  ESP32 State:', val.state);
console.log('  Bench Mode Telemetry:', val.bench_mode);
console.log('  Inactivity Limit Seconds:', val.inactivity_limit_seconds);
console.log('  Total Power Watts:', val.total_power_watts);
console.log('  Relay Status:', [val.ports?.port_01?.relay_status, val.ports?.port_02?.relay_status, val.ports?.port_03?.relay_status]);
console.log('====================================================');

process.exit(0);
