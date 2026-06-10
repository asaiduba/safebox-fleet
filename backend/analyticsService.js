const { db } = require('./db');

// Helper: Haversine Distance
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; // Distance in km
    return d;
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

/**
 * Calculates total distance covered by a vehicle in km over a timeframe.
 */
function calculateDistance(vehicleId, startTime, endTime) {
    const history = db.prepare(`
        SELECT lat, lng, speed, timestamp
        FROM vehicle_history
        WHERE vehicle_id = ? AND timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp ASC
    `).all(vehicleId, startTime, endTime);

    let totalDistanceKm = 0;
    for (let i = 1; i < history.length; i++) {
        const prev = history[i - 1];
        const curr = history[i];

        // Accumulate GPS distance (only when moving)
        if (curr.speed > 0 && prev.lat && prev.lng && curr.lat && curr.lng) {
            totalDistanceKm += getDistanceFromLatLonInKm(prev.lat, prev.lng, curr.lat, curr.lng);
        }
    }
    return parseFloat(totalDistanceKm.toFixed(2));
}

/**
 * Calculates total idle time of a vehicle in seconds over a timeframe.
 * Idle is defined as speed === 0 while vehicle is actively reporting (consecutive packets within 15s).
 */
function calculateIdleTime(vehicleId, startTime, endTime) {
    const history = db.prepare(`
        SELECT speed, timestamp
        FROM vehicle_history
        WHERE vehicle_id = ? AND timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp ASC
    `).all(vehicleId, startTime, endTime);

    let idleTimeSeconds = 0;
    for (let i = 1; i < history.length; i++) {
        const prev = history[i - 1];
        const curr = history[i];

        // If speed is 0 and they are close in time (meaning active/engine on but stationary)
        if (curr.speed === 0 && prev.speed === 0) {
            const diff = (curr.timestamp - prev.timestamp) / 1000;
            if (diff > 0 && diff <= 15) { // Cap at 15 seconds to exclude park-and-disconnect
                idleTimeSeconds += diff;
            }
        }
    }
    return Math.round(idleTimeSeconds);
}

/**
 * Computes safety/driver score from 100 with deductions:
 * - Speeding events (-5 points)
 * - Excess Idle (>10m = -10, >30m = -20)
 * - Unauthorized start / Curfew / Geofence (-15 points)
 */
function calculateDriverScore(vehicleId, startTime, endTime) {
    let score = 100;

    // 1. Overspeed/Alert Deductions
    const alerts = db.prepare(`
        SELECT type, COUNT(*) as cnt
        FROM vehicle_alerts
        WHERE vehicle_id = ? AND timestamp >= ? AND timestamp <= ?
        GROUP BY type
    `).all(vehicleId, startTime, endTime);

    const alertMap = {};
    alerts.forEach(a => {
        alertMap[a.type] = a.cnt;
    });

    const speeding = alertMap['SPEEDING'] || 0;
    const curfew = alertMap['CURFEW_VIOLATION'] || 0;
    const startBlocked = alertMap['START_ATTEMPT_BLOCKED'] || alertMap['UNAUTHORIZED_START'] || 0;
    const geofence = alertMap['GEOFENCE_BREACH'] || 0;
    const theft = alertMap['THEFT'] || 0;

    score -= (speeding * 5);
    score -= (curfew * 15);
    score -= (startBlocked * 15);
    score -= (geofence * 10);
    score -= (theft * 20);

    // 2. Excess Idle Deductions
    const idleSeconds = calculateIdleTime(vehicleId, startTime, endTime);
    if (idleSeconds > 1800) { // > 30 minutes
        score -= 20;
    } else if (idleSeconds > 600) { // > 10 minutes
        score -= 10;
    }

    return Math.max(0, Math.min(100, score));
}

/**
 * Calculates fuel used and estimated fuel cost based on vehicle settings or default efficiency.
 */
function calculateFuelUsage(vehicleId, distance) {
    const fuelSetting = db.prepare(`
        SELECT fuel_type, fuel_price, fuel_efficiency
        FROM fuel_settings
        WHERE vehicle_id = ?
    `).get(vehicleId);

    // Default fallbacks based on generic fleet profiles
    const defaultEfficiency = 12.0; // 12 km/L
    const defaultPrice = 1000.0; // 1000 currency units per liter
    const defaultType = 'Premium Petrol';

    const efficiency = fuelSetting && fuelSetting.fuel_efficiency ? fuelSetting.fuel_efficiency : defaultEfficiency;
    const price = fuelSetting && fuelSetting.fuel_price ? fuelSetting.fuel_price : defaultPrice;
    const type = fuelSetting && fuelSetting.fuel_type ? fuelSetting.fuel_type : defaultType;

    const fuelUsed = distance > 0 ? distance / efficiency : 0;
    const fuelCost = fuelUsed * price;

    const isEV = type === 'Electric';
    const unit = isEV ? 'kWh' : 'L';
    const effUnit = isEV ? 'km/kWh' : 'km/L';

    return {
        fuelType: type,
        fuelEfficiency: efficiency,
        fuelPrice: price,
        fuelUsed: parseFloat(fuelUsed.toFixed(2)),
        fuelCost: parseFloat(fuelCost.toFixed(2)),
        costPerKm: distance > 0 ? parseFloat((fuelCost / distance).toFixed(2)) : 0,
        unit,
        effUnit
    };
}

/**
 * Calculates fleet utilization % relative to active reporting hours vs total duration.
 */
function calculateFleetUtilization(vehicleIds, startTime, endTime) {
    if (!vehicleIds || vehicleIds.length === 0) return 0;

    const totalDurationMs = endTime - startTime;
    if (totalDurationMs <= 0) return 0;

    let totalActiveSeconds = 0;
    vehicleIds.forEach(vId => {
        const history = db.prepare(`
            SELECT timestamp
            FROM vehicle_history
            WHERE vehicle_id = ? AND timestamp >= ? AND timestamp <= ?
            ORDER BY timestamp ASC
        `).all(vId, startTime, endTime);

        let vehicleActiveSeconds = 0;
        for (let i = 1; i < history.length; i++) {
            const diff = history[i].timestamp - history[i - 1].timestamp;
            if (diff > 0 && diff <= 15000) { // Active if transmitting within 15 seconds
                vehicleActiveSeconds += (diff / 1000);
            }
        }
        totalActiveSeconds += vehicleActiveSeconds;
    });

    const totalAvailableSeconds = (totalDurationMs / 1000) * vehicleIds.length;
    if (totalAvailableSeconds <= 0) return 0;

    // Cap utilization at 100%
    const utilization = (totalActiveSeconds / totalAvailableSeconds) * 100;
    return parseFloat(Math.min(100, Math.max(0, utilization)).toFixed(1));
}

/**
 * Calculates security risk score from 0 (lowest) to 100 (highest) based on alerts.
 */
function calculateSecurityRiskScore(vehicleId, startTime, endTime) {
    const alerts = db.prepare(`
        SELECT type, COUNT(*) as cnt
        FROM vehicle_alerts
        WHERE vehicle_id = ? AND timestamp >= ? AND timestamp <= ?
        GROUP BY type
    `).all(vehicleId, startTime, endTime);

    let riskScore = 0;
    alerts.forEach(a => {
        const cnt = a.cnt;
        switch (a.type) {
            case 'THEFT':
            case 'TAMPER':
            case 'POWER_DISCONNECT':
                riskScore += cnt * 25;
                break;
            case 'TOW_DETECTION':
            case 'RELAY_BYPASS':
            case 'UNAUTHORIZED_START':
            case 'START_ATTEMPT_BLOCKED':
                riskScore += cnt * 20;
                break;
            case 'CURFEW_VIOLATION':
            case 'GEOFENCE_BREACH':
                riskScore += cnt * 15;
                break;
            default:
                riskScore += cnt * 5;
        }
    });

    return Math.min(100, riskScore);
}

module.exports = {
    getDistanceFromLatLonInKm,
    calculateDistance,
    calculateIdleTime,
    calculateDriverScore,
    calculateFuelUsage,
    calculateFleetUtilization,
    calculateSecurityRiskScore
};
