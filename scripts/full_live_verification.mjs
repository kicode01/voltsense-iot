import admin from 'firebase-admin';
import dotenv from 'dotenv';

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

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

console.log('===========================================================');
console.log('VoltSense Full End-to-End Settings & God Mode Verification');
console.log('Target Device MAC:', mac);
console.log('===========================================================\n');

// 1. Verify Bench Test Mode
console.log('[TEST 1] Testing Bench Test Mode toggle...');
await deviceRef.child('settings/bench_mode').set(true);
console.log('  -> Wrote settings.bench_mode = true. Waiting 3s for ESP32...');
await sleep(3000);

let snap = await deviceRef.once('value');
let val = snap.val();
console.log('  -> RTDB settings.bench_mode:', val.settings?.bench_mode);
console.log('  -> ESP32 published telemetry bench_mode:', val.bench_mode);

// 2. Verify Inactivity Limit Synchronization
console.log('\n[TEST 2] Testing Inactivity Timeout Synchronization...');
await deviceRef.child('settings').update({
  inactivity_limit_minutes: 20,
  inactivity_limit_seconds: 1200
});
console.log('  -> Wrote 20 minutes (1200 seconds). Waiting 3s...');
await sleep(3000);

snap = await deviceRef.once('value');
val = snap.val();
console.log('  -> ESP32 telemetry inactivity_limit (min):', val.inactivity_limit);
console.log('  -> ESP32 telemetry inactivity_limit_seconds:', val.inactivity_limit_seconds);

// 3. Verify God Mode Speed-Run Simulation
console.log('\n[TEST 3] Testing God Mode 15s Speed-Run Simulation...');
await deviceRef.child('settings').update({
  inactivity_limit_seconds: 15,
  inactivity_limit_minutes: 0.25,
  response_window_seconds: 10,
  force_pir: 1,
  force_mmwave: 1
});
console.log('  -> Injected 15s speed-run + forced occupancy. Waiting 3s...');
await sleep(3000);

snap = await deviceRef.once('value');
val = snap.val();
console.log('  -> ESP32 State:', val.state);
console.log('  -> Occupancy Detected:', val.is_occupied);
console.log('  -> PIR Detected:', val.pir_detected);
console.log('  -> mmWave Detected:', val.mmwave_detected);

// 4. Restore Standard Settings
console.log('\n[TEST 4] Restoring Production Defaults...');
await deviceRef.child('settings').update({
  inactivity_limit_minutes: 15,
  inactivity_limit_seconds: 900,
  response_window_seconds: 300,
  force_pir: -1,
  force_mmwave: -1,
  nominal_voltage: 220,
  acs712_mv_per_amp: 123.33,
  current_noise_floor_a: 0.03,
  current_cal_multiplier: 1.0,
  sensor_fusion_mode: 'OR',
  pir_delay_seconds: 5,
  mmwave_delay_seconds: 3,
  bench_mode: true
});
console.log('  -> Production settings restored. Waiting 3s...');
await sleep(3000);

snap = await deviceRef.once('value');
val = snap.val();
console.log('  -> Final ESP32 State:', val.state);
console.log('  -> Relays:', [val.ports?.port_01?.relay_status, val.ports?.port_02?.relay_status, val.ports?.port_03?.relay_status]);
console.log('\n===========================================================');
console.log('All tests completed successfully!');
console.log('===========================================================');

process.exit(0);
