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

// Calculate perpendicular distance from a point to a line segment
function getPerpendicularDistance(point, lineStart, lineEnd) {
    const doubleArea = Math.abs(
        (lineEnd.lat - lineStart.lat) * (lineStart.lng - point.lng) -
        (lineStart.lat - point.lat) * (lineEnd.lng - lineStart.lng)
    );
    const lineLength = Math.sqrt(
        Math.pow(lineEnd.lat - lineStart.lat, 2) +
        Math.pow(lineEnd.lng - lineStart.lng, 2)
    );
    if (lineLength === 0) {
        return Math.sqrt(
            Math.pow(point.lat - lineStart.lat, 2) +
            Math.pow(point.lng - lineStart.lng, 2)
        );
    }
    return doubleArea / lineLength;
}

// Ramer-Douglas-Peucker path simplification
export function simplifyPath(points, epsilon = 0.00012) { // ~12 meters deviation limit
    if (points.length < 3) return points;

    let maxDist = 0;
    let index = 0;
    const end = points.length - 1;

    for (let i = 1; i < end; i++) {
        const dist = getPerpendicularDistance(points[i], points[0], points[end]);
        if (dist > maxDist) {
            index = i;
            maxDist = dist;
        }
    }

    if (maxDist > epsilon) {
        const results1 = simplifyPath(points.slice(0, index + 1), epsilon);
        const results2 = simplifyPath(points.slice(index), epsilon);
        return results1.slice(0, results1.length - 1).concat(results2);
    } else {
        return [points[0], points[end]];
    }
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

    let lastAdded = null;

    for (let i = 0; i < validLogs.length; i++) {
        const log = validLogs[i];
        const currentPoint = {
            lat: log.lat,
            lng: log.lng,
            speed: log.speed || 0,
            battery: log.battery_level !== undefined ? log.battery_level : 100,
            fuel: log.fuel_level !== undefined ? log.fuel_level : 100,
            timestamp: log.timestamp
        };

        // Filter out stationary GPS drift (if within 10 meters and not moving, skip point unless it's first or last)
        let shouldAdd = true;
        if (lastAdded) {
            const distFromLast = getDistanceFromLatLonInKm(lastAdded.lat, lastAdded.lng, currentPoint.lat, currentPoint.lng);
            if (distFromLast < 0.01 && currentPoint.speed <= 2 && lastAdded.speed <= 2 && i < validLogs.length - 1) {
                shouldAdd = false;
            }
        }

        if (shouldAdd) {
            path.push(currentPoint);
            lastAdded = currentPoint;
        }

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

    // Apply Ramer-Douglas-Peucker path simplification to smooth out line spikes
    const smoothedPath = path.length > 2 ? simplifyPath(path, 0.00012) : path;

    return {
        totalDistance: parseFloat(totalDistance.toFixed(2)),
        movingTime,
        idleTime,
        avgSpeed,
        path: smoothedPath
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
