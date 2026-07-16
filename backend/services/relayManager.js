/**
 * relayManager.js -- Unified Relay State Machine and Persistence Engine
 *
 * Implements the automatic relay state machine rules and persists
 * transient state (BLE grace periods, ignition debounce timers, command cooldowns)
 * in SQLite to prevent false alarms or state loss across server restarts/replays.
 */

'use strict';

const { db } = require('../db');
const { isWithinAllowedHours } = require('../utils/helpers');

let _DeviceManager = null;
let _sendTraccarCommand = null;

class RelayManager {
  /**
   * Initializes RelayManager, creating maps and pre-populating them from SQLite.
   */
  static init(DeviceManager, sendTraccarCommand) {
    _DeviceManager = DeviceManager;
    _sendTraccarCommand = sendTraccarCommand;

    // Ensure global Maps exist
    global.lastBeaconSeen = global.lastBeaconSeen || new Map();
    global.lastMovingTime = global.lastMovingTime || new Map();
    global.ignitionDebounce = global.ignitionDebounce || new Map();
    global.relayCmdCooldown = global.relayCmdCooldown || new Map();

    try {
      // Query SQLite for persisted device states and load them into memory Maps
      const states = db.prepare('SELECT * FROM device_state').all();
      console.log(`[RelayManager] Preloading state cache for ${states.length} devices from DB...`);
      for (const row of states) {
        if (row.last_beacon_seen) global.lastBeaconSeen.set(row.device_id, row.last_beacon_seen);
        if (row.last_moving_time) global.lastMovingTime.set(row.device_id, row.last_moving_time);
        if (row.last_ignition_time) {
          global.ignitionDebounce.set(row.device_id, {
            state: row.last_ignition_state,
            since: row.last_ignition_time
          });
        }
        if (row.last_relay_time) global.relayCmdCooldown.set(`${row.device_id}-relay`, row.last_relay_time);
      }
      console.log('[RelayManager] Initialization complete.');
    } catch (err) {
      console.error('[RelayManager] Failed to pre-populate device state cache:', err.message);
    }
  }

  /**
   * Helper to update database and memory Map for a specific state property.
   */
  static _saveState(deviceId, field, val) {
    try {
      db.prepare(`
        INSERT INTO device_state (device_id, ${field})
        VALUES (?, ?)
        ON CONFLICT(device_id) DO UPDATE SET ${field} = excluded.${field}
      `).run(deviceId, val);
    } catch (err) {
      console.error(`[RelayManager] Failed to persist state for ${deviceId} (${field}):`, err.message);
    }
  }

  /**
   * Main Automatic Relay State Machine
   * Evaluates if the relay state needs to change and sends the setdigout command.
   */
  static evaluateAutomaticRelay(deviceId, ignitionOn, speed, rawBleList, vehicle) {
    if (!vehicle || vehicle.subscription_status === 'SUSPENDED') return;

    const nowMs = Date.now();

    // 1. Curfew Calculation
    const curfewLocked = (() => {
      if (vehicle.curfew_enabled !== 1) return false;
      const now = new Date();
      const isAllowed = isWithinAllowedHours(now, vehicle.curfew_start, vehicle.curfew_end, vehicle.curfew_days, vehicle.curfew_holiday_mode);
      if (isAllowed) return false;
      if (vehicle.override_status === 'APPROVED_MIDNIGHT' || vehicle.override_status === 'APPROVED_ONCE') {
        if (nowMs < vehicle.override_expires) return false;
      }
      return true;
    })();

    const isWebOrCurfewLocked = (vehicle.cloud_locked === 1 || curfewLocked);

    // 2. Parse BLE beacons and track driver presence
    const bleBeacons = [];
    if (rawBleList) {
      rawBleList.split(';').forEach(pair => {
        const [mac, rssi] = pair.split(':');
        if (mac && rssi) {
          bleBeacons.push({ mac: mac.trim(), rssi: parseInt(rssi.trim(), 10) });
        }
      });
    }

    // Keep track of moving time (persisted)
    if (speed > 0) {
      global.lastMovingTime.set(deviceId, nowMs);
      this._saveState(deviceId, 'last_moving_time', nowMs);
    }
    const lastMoving = global.lastMovingTime.get(deviceId) || 0;
    const wasMovingRecently = (nowMs - lastMoving) < 5 * 60 * 1000;

    let driverPresent = !vehicle.ble_beacon_id;
    if (vehicle.ble_beacon_id) {
      const normalizedBeaconId = vehicle.ble_beacon_id.replace(/:/g, '').toUpperCase();
      const matchedTag = bleBeacons.find(b => {
        const cleanMac = b.mac.replace(/:/g, '').toUpperCase().replace(/^0+/, '');
        const cleanDb = normalizedBeaconId.replace(/^0+/, '');
        return cleanMac === cleanDb || cleanMac.endsWith(cleanDb) || cleanDb.endsWith(cleanMac);
      });

      if (matchedTag && matchedTag.rssi >= vehicle.ble_beacon_rssi_threshold) {
        global.lastBeaconSeen.set(deviceId, nowMs);
        this._saveState(deviceId, 'last_beacon_seen', nowMs);
        driverPresent = true;
      }

      // Proximity Grace Period (3 mins)
      const lastSeen = global.lastBeaconSeen.get(deviceId) || 0;
      const beaconSeenRecently = (nowMs - lastSeen) < 3 * 60 * 1000;
      if (!driverPresent && beaconSeenRecently) {
        driverPresent = true;
      }

      // Moving Grace Period (5 mins)
      if (!driverPresent && wasMovingRecently) {
        driverPresent = true;
      }
    }

    // 3. Ignition Debounce Check (3 seconds stable state required)
    if (!global.ignitionDebounce.has(deviceId)) {
      // Seed initial state
      const seedTime = nowMs - 5000;
      global.ignitionDebounce.set(deviceId, { state: ignitionOn, since: seedTime });
      this._saveState(deviceId, 'last_ignition_state', ignitionOn ? 1 : 0);
      this._saveState(deviceId, 'last_ignition_time', seedTime);
    }

    const lastDebounce = global.ignitionDebounce.get(deviceId);
    if (lastDebounce.state !== ignitionOn) {
      global.ignitionDebounce.set(deviceId, { state: ignitionOn, since: nowMs });
      this._saveState(deviceId, 'last_ignition_state', ignitionOn ? 1 : 0);
      this._saveState(deviceId, 'last_ignition_time', nowMs);
    }

    const debounce = global.ignitionDebounce.get(deviceId);
    const ignitionStableMs = nowMs - debounce.since;
    const ignitionStable = ignitionStableMs >= 3000; // 3 seconds stable

    // 4. Calculate Desired Physical Relay State
    let desiredRelay = 0;
    if (ignitionOn) {
      if (isWebOrCurfewLocked) {
        desiredRelay = 0;
      } else if (vehicle.ble_beacon_id && !driverPresent) {
        desiredRelay = speed > 2 ? 1 : 0;
      } else {
        desiredRelay = 1;
      }
    } else {
      desiredRelay = 0;
    }

    const currentRelay = (vehicle.relay_state !== null && vehicle.relay_state !== undefined) ? vehicle.relay_state : 0;

    // 5. Cooldown & Command Dispatch
    if (currentRelay !== desiredRelay && ignitionStable) {
      const cooldownKey = `${deviceId}-relay`;
      const lastSent = global.relayCmdCooldown.get(cooldownKey) || 0;
      const RELAY_COOLDOWN_MS = 15000;

      if (nowMs - lastSent > RELAY_COOLDOWN_MS) {
        const cmdText = `setdigout ${desiredRelay}`;
        console.log(`[RelayManager Auto] ${deviceId}: ignition=${ignitionOn ? 1 : 0} webLocked=${isWebOrCurfewLocked} blePresent=${driverPresent} relay ${currentRelay}→${desiredRelay} → ${cmdText}`);

        // Update DB optimistically
        db.prepare('UPDATE vehicles SET relay_state = ?, relay_updated_at = ? WHERE id = ?')
          .run(desiredRelay, nowMs, deviceId);
        if (global.invalidateMetadataCache) global.invalidateMetadataCache(deviceId);

        // Update Cooldown and persist
        global.relayCmdCooldown.set(cooldownKey, nowMs);
        this._saveState(deviceId, 'last_relay_time', nowMs);

        // Dispatch command via direct socket or Traccar API
        const isDirectSocket = _DeviceManager && _DeviceManager.getStatus(deviceId) === 'ONLINE';
        if (isDirectSocket) {
          _DeviceManager.sendCommand(deviceId, cmdText);
        } else if (_sendTraccarCommand) {
          _sendTraccarCommand(deviceId, cmdText);
        }
      }
    }
  }
}

module.exports = RelayManager;
