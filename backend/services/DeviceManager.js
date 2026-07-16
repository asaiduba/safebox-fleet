/**
 * DeviceManager -- Device Abstraction Layer
 *
 * Resolves a vehicle ID to its physical tracker socket and routes
 * lock/unlock commands via the correct binary protocol.
 *
 * Tracks the command lifecycle: PENDING -> SENT -> DELIVERED -> CONFIRMED
 */

'use strict';

const { db } = require('../db');

let _activeTcpSockets = null;
let _buildCodec12Frame = null;
let _buildGT06CommandFrame = null;

class DeviceManager {
  static init(activeTcpSockets, buildCodec12Frame, buildGT06CommandFrame) {
    _activeTcpSockets = activeTcpSockets;
    _buildCodec12Frame = buildCodec12Frame;
    _buildGT06CommandFrame = buildGT06CommandFrame;
    console.log('[DeviceManager] Initialized.');
  }

  static registerSocket(imei, socket) {
    if (!_activeTcpSockets) {
      console.error('[DeviceManager] Not initialized. Call DeviceManager.init() first.');
      return;
    }

    // Explicitly destroy the old stale socket if it exists to release descriptors
    if (_activeTcpSockets.has(imei)) {
      const oldSocket = _activeTcpSockets.get(imei);
      try {
        oldSocket.destroy();
        console.log(`[DeviceManager] Cleaned up stale socket connection for IMEI ${imei}`);
      } catch (err) {
        console.error(`[DeviceManager] Failed to destroy stale socket for IMEI ${imei}:`, err.message);
      }
    }

    _activeTcpSockets.set(imei, socket);
    try {
      db.prepare("UPDATE devices SET status = 'ONLINE', last_seen = ? WHERE imei = ?").run(Date.now(), imei);
      console.log('[DeviceManager] Registered socket for IMEI ' + imei + ' -> ONLINE');
    } catch (err) {
      console.warn('[DeviceManager] IMEI ' + imei + ' authenticated but has no devices row yet.');
    }
  }

  static deregisterSocket(imei) {
    if (!imei) return;
    if (_activeTcpSockets) _activeTcpSockets.delete(imei);
    try {
      db.prepare("UPDATE devices SET status = 'OFFLINE', last_seen = ? WHERE imei = ?").run(Date.now(), imei);
      console.log('[DeviceManager] Deregistered socket for IMEI ' + imei + ' -> OFFLINE');
    } catch (err) {
      console.warn('[DeviceManager] Could not mark IMEI ' + imei + ' OFFLINE:', err.message);
    }
  }

  static getDeviceByVehicleId(vehicleId) {
    try {
      return db.prepare('SELECT imei, tracker_type, protocol FROM devices WHERE vehicle_id = ? LIMIT 1').get(vehicleId) || null;
    } catch (err) {
      console.error('[DeviceManager] DB error in getDeviceByVehicleId(' + vehicleId + '):', err.message);
      return null;
    }
  }

  /**
   * Sends a command to the tracker, logging the attempt in `device_commands`.
   * Returns details of the result instead of a simple boolean.
   *
   * @param {string} vehicleId
   * @param {string} command
   * @param {number} [requestedBy]
   * @returns {object} { success: boolean, commandId: number, sentAt: number, error?: string }
   */
  static sendCommand(vehicleId, command, requestedBy = null) {
    let imei = null;
    let tracker_type = 'teltonika';

    const device = DeviceManager.getDeviceByVehicleId(vehicleId);
    if (device) {
      imei = device.imei;
      tracker_type = device.tracker_type;
    } else {
      if (_activeTcpSockets && _activeTcpSockets.has(vehicleId)) {
        imei = vehicleId;
        tracker_type = 'custom';
      }
    }

    const sentAt = Date.now();

    // 1. Insert PENDING record in device_commands
    let commandId = null;
    try {
      const result = db.prepare(`
        INSERT INTO device_commands (vehicle_id, imei, command, requested_by, sent_at, status)
        VALUES (?, ?, ?, ?, ?, 'PENDING')
      `).run(vehicleId, imei || null, command, requestedBy, sentAt);
      commandId = result.lastInsertRowid;
    } catch (err) {
      console.error('[DeviceManager] Failed to insert pending command log:', err.message);
    }

    if (!imei) {
      const errorMsg = 'No device or active socket linked to vehicle ' + vehicleId;
      console.warn('[DeviceManager] ' + errorMsg);
      if (commandId) {
        db.prepare("UPDATE device_commands SET status = 'FAILED', error = ? WHERE id = ?").run(errorMsg, commandId);
      }
      return { success: false, commandId, sentAt, error: errorMsg };
    }

    if (!_activeTcpSockets || !_activeTcpSockets.has(imei)) {
      const errorMsg = 'Device IMEI/ID ' + imei + ' is not connected (OFFLINE).';
      console.warn('[DeviceManager] ' + errorMsg);
      if (commandId) {
        db.prepare("UPDATE device_commands SET status = 'FAILED', error = ? WHERE id = ?").run(errorMsg, commandId);
      }
      return { success: false, commandId, sentAt, error: errorMsg };
    }

    const socket = _activeTcpSockets.get(imei);

    try {
      switch ((tracker_type || 'teltonika').toLowerCase()) {
        case 'teltonika': {
          if (!_buildCodec12Frame) {
            throw new Error('buildCodec12Frame not injected.');
          }
          const frame = _buildCodec12Frame(command);
          socket.write(frame);
          break;
        }
        case 'sinotrack':
        case 'gt06': {
          const cmdStr = command === 'setdigout 1' ? 'RELAY,0#' : 'RELAY,1#';
          if (_buildGT06CommandFrame) {
            const frame = _buildGT06CommandFrame(cmdStr);
            socket.write(frame);
          } else {
            socket.write(Buffer.from(cmdStr, 'ascii'));
          }
          break;
        }
        default: {
          socket.write(command + '\r\n');
          break;
        }
      }

      // 2. Transition status to DELIVERED (successfully written to the network buffer)
      if (commandId) {
        db.prepare("UPDATE device_commands SET status = 'DELIVERED' WHERE id = ?").run(commandId);
      }
      console.log('[DeviceManager] Sent command "' + command + '" to IMEI ' + imei + ' (vehicle: ' + vehicleId + ')');
      return { success: true, commandId, sentAt };

    } catch (err) {
      console.error('[DeviceManager] Failed to write command to socket for IMEI ' + imei + ':', err.message);
      if (commandId) {
        db.prepare("UPDATE device_commands SET status = 'FAILED', error = ? WHERE id = ?").run(err.message, commandId);
      }
      return { success: false, commandId, sentAt, error: err.message };
    }
  }

  /**
   * Resolves a pending command when the tracker responds.
   * Calculates latency, saves tracker response, and transitions status.
   *
   * @param {string} imei
   * @param {boolean} success
   * @param {string} responseText
   * @param {string} [errorMsg]
   */
  static resolvePendingCommand(imei, success, responseText, errorMsg = null) {
    try {
      // Find the most recent DELIVERED or SENT command for this IMEI
      const pendingCmd = db.prepare(`
        SELECT id, sent_at FROM device_commands
        WHERE imei = ? AND status IN ('SENT', 'DELIVERED', 'PENDING')
        ORDER BY sent_at DESC LIMIT 1
      `).get(imei);

      if (!pendingCmd) {
        console.log(`[DeviceManager] No pending command found to resolve for IMEI ${imei}`);
        return;
      }

      const now = Date.now();
      const latencyMs = now - pendingCmd.sent_at;
      const finalStatus = success ? 'DELIVERED' : 'FAILED'; // It transitions to CONFIRMED on standard telemetry confirmation

      db.prepare(`
        UPDATE device_commands
        SET status = ?, ack_at = ?, latency_ms = ?, tracker_response = ?, error = ?
        WHERE id = ?
      `).run(finalStatus, now, latencyMs, responseText || null, errorMsg || null, pendingCmd.id);

      console.log(`[DeviceManager] Resolved command ID ${pendingCmd.id} for IMEI ${imei} as ${finalStatus} (latency: ${latencyMs}ms)`);
    } catch (err) {
      console.error(`[DeviceManager] Failed to resolve pending command for IMEI ${imei}:`, err.message);
    }
  }

  static getStatus(vehicleId) {
    const device = DeviceManager.getDeviceByVehicleId(vehicleId);
    if (!device) return 'UNLINKED';
    if (_activeTcpSockets && _activeTcpSockets.has(device.imei)) return 'ONLINE';
    return 'OFFLINE';
  }
}

module.exports = DeviceManager;
