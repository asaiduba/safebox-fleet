/**
 * DeviceManager -- Device Abstraction Layer
 *
 * Resolves a vehicle ID to its physical tracker socket and routes
 * lock/unlock commands via the correct binary protocol.
 *
 * Supported protocols:
 *   - teltonika  -> Codec 12 binary frame (setdigout 0 / setdigout 1)
 *   - sinotrack  -> GT06 text command (future)
 *   - concox     -> Concox format (future)
 *   - custom     -> Raw ASCII write (for simulator / MOKO custom firmware)
 */

'use strict';

const { db } = require('../db');

let _activeTcpSockets = null;
let _buildCodec12Frame = null;

class DeviceManager {
  static init(activeTcpSockets, buildCodec12Frame) {
    _activeTcpSockets = activeTcpSockets;
    _buildCodec12Frame = buildCodec12Frame;
    console.log('[DeviceManager] Initialized.');
  }

  static registerSocket(imei, socket) {
    if (!_activeTcpSockets) {
      console.error('[DeviceManager] Not initialized. Call DeviceManager.init() first.');
      return;
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

  static sendCommand(vehicleId, command) {
    let imei = null;
    let tracker_type = 'teltonika';

    const device = DeviceManager.getDeviceByVehicleId(vehicleId);
    if (device) {
      imei = device.imei;
      tracker_type = device.tracker_type;
    } else {
      // Fallback for simulated/custom devices where the socket is registered directly by vehicleId
      if (_activeTcpSockets && _activeTcpSockets.has(vehicleId)) {
        imei = vehicleId;
        tracker_type = 'custom';
      }
    }

    if (!imei) {
      console.warn('[DeviceManager] No device or active socket linked to vehicle ' + vehicleId);
      return false;
    }

    if (!_activeTcpSockets || !_activeTcpSockets.has(imei)) {
      console.warn('[DeviceManager] Device IMEI/ID ' + imei + ' (' + vehicleId + ') is not connected (OFFLINE).');
      return false;
    }

    const socket = _activeTcpSockets.get(imei);

    try {
      switch ((tracker_type || 'teltonika').toLowerCase()) {
        case 'teltonika': {
          if (!_buildCodec12Frame) {
            console.error('[DeviceManager] buildCodec12Frame not injected.');
            return false;
          }
          const frame = _buildCodec12Frame(command);
          socket.write(frame);
          console.log('[DeviceManager] Sent Codec 12 command "' + command + '" to IMEI ' + imei + ' (vehicle: ' + vehicleId + ')');
          return true;
        }
        case 'sinotrack':
        case 'gt06': {
          const cmd = command === 'setdigout 1' ? 'RELAY,1#' : 'RELAY,0#';
          socket.write(Buffer.from(cmd, 'ascii'));
          console.log('[DeviceManager] Sent GT06 command "' + cmd + '" to IMEI ' + imei);
          return true;
        }
        default: {
          socket.write(command + '\r\n');
          console.log('[DeviceManager] Sent raw command "' + command + '" to IMEI ' + imei);
          return true;
        }
      }
    } catch (err) {
      console.error('[DeviceManager] Failed to write command to socket for IMEI ' + imei + ':', err.message);
      return false;
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
