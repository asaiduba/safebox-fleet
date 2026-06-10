// Haversine formula to calculate distance between two coordinates in km
export function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2)
        ;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; // Distance in km
    return d;
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

// Compile stats from vehicle history logs
export function compileTripStats(logs) {
    if (!logs || logs.length < 2) {
        return {
            totalDistance: 0,
            movingTime: 0,
            idleTime: 0,
            avgSpeed: 0,
            path: []
        };
    }

    let totalDistance = 0;
    let movingTime = 0;
    let idleTime = 0;
    let movingSpeedsSum = 0;
    let movingPointsCount = 0;
    const path = [];

    // Filter valid GPS coordinates
    const validLogs = logs.filter(log => log.lat && log.lng && log.lat !== 0 && log.lng !== 0);

    for (let i = 0; i < validLogs.length; i++) {
        const log = validLogs[i];
        path.push({
            lat: log.lat,
            lng: log.lng,
            speed: log.speed || 0,
            battery: log.battery_level !== undefined ? log.battery_level : 100,
            fuel: log.fuel_level !== undefined ? log.fuel_level : 100,
            timestamp: log.timestamp
        });

        // 1. Calculate Distance
        if (i > 0) {
            const prevLog = validLogs[i - 1];
            const dist = getDistanceFromLatLonInKm(prevLog.lat, prevLog.lng, log.lat, log.lng);
            
            // Filter out gps jumps (e.g. coordinates jumping wildly between consecutive points)
            if (dist < 5.0) { // Max 5km between adjacent logs (2-second interval)
                totalDistance += dist;
            }

            // 2. Calculate Durations
            const timeDiff = log.timestamp - prevLog.timestamp;
            if (timeDiff > 0 && timeDiff < 600000) { // Limit interval to max 10 minutes to prevent massive sleep jumps
                if (log.speed > 2) {
                    movingTime += timeDiff;
                    movingSpeedsSum += log.speed;
                    movingPointsCount++;
                } else {
                    idleTime += timeDiff;
                }
            }
        }
    }

    const avgSpeed = movingPointsCount > 0 ? Math.round(movingSpeedsSum / movingPointsCount) : 0;

    return {
        totalDistance: parseFloat(totalDistance.toFixed(2)),
        movingTime,
        idleTime,
        avgSpeed,
        path
    };
}

// Formats milliseconds into readable "1h 45m" format
export function formatDuration(ms) {
    if (!ms || ms <= 0) return "0m";
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}
