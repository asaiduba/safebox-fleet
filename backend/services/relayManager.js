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
   * Evaluate and send relay commands based on web lock + curfew ONLY.
   * ACC/Ignition and BLE do NOT influence the relay — they are reporting/alert only.
   * This method is only called for devices NOT connected via direct TCP.
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

    // 2. Relay controlled ONLY by Web Dashboard (cloud_locked) + Curfew
    const isWebOrCurfewLocked = (vehicle.cloud_locked === 1 || curfewLocked);
    const desiredRelay = isWebOrCurfewLocked ? 0 : 1;
    const currentRelay = (vehicle.relay_state !== null && vehicle.relay_state !== undefined) ? vehicle.relay_state : 0;

    // 3. Cooldown & Command Dispatch (2s anti-chatter)
    if (currentRelay !== desiredRelay) {
      const cooldownKey = `${deviceId}-relay`;
      const lastSent = global.relayCmdCooldown.get(cooldownKey) || 0;
      const RELAY_COOLDOWN_MS = 2000;

      if (nowMs - lastSent > RELAY_COOLDOWN_MS) {
        const cmdText = `setdigout ${desiredRelay}`;
        console.log(`[RelayManager Auto] ${deviceId}: webLocked=${isWebOrCurfewLocked} relay ${currentRelay}→${desiredRelay} → ${cmdText}`);

        // Update DB optimistically
        db.prepare('UPDATE vehicles SET relay_state = ?, relay_updated_at = ? WHERE id = ?')
          .run(desiredRelay, nowMs, deviceId);
        if (global.invalidateMetadataCache) global.invalidateMetadataCache(deviceId);

        // Update Cooldown
        global.relayCmdCooldown.set(cooldownKey, nowMs);

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
