const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');
const net = require('net');

// Configuration
const MQTT_BROKER = process.env.MQTT_BROKER_URL || process.env.MQTT_BROKER || 'mqtt://broker.emqx.io';
const MQTT_USER = process.env.MQTT_BROKER_USER || null;
const MQTT_PASS = process.env.MQTT_BROKER_PASS || null;

const TCP_HOST = process.env.TCP_HOST || 'localhost';
const TCP_PORT = parseInt(process.env.TCP_PORT || process.env.PORT_TCP || '5000', 10);

const DEVICE_PREFIX = 'MOTO_';
const DEVICE_COUNT = 50; // 50 Devices
const LOCK_FILE = path.join(__dirname, 'simulator.lock');

// Prevent multiple instances
if (fs.existsSync(LOCK_FILE)) {
    console.error("ERROR: Another simulator instance is already running.");
    console.error("If you are sure it is not running, delete 'simulator.lock' and try again.");
    process.exit(1);
}
fs.writeFileSync(LOCK_FILE, process.pid.toString());

process.on('exit', () => {
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
});
process.on('SIGINT', () => process.exit());
process.on('SIGTERM', () => process.exit());

const STATE_FILE = path.join(__dirname, 'simulator_state.json');

// Load state from file or generate new
let devices = [];
if (fs.existsSync(STATE_FILE)) {
    try {
        const data = fs.readFileSync(STATE_FILE, 'utf8');
        if (data.trim().length === 0) {
            console.log("State file is empty, regenerating...");
            generateDevices();
        } else {
            devices = JSON.parse(data);
            if (!Array.isArray(devices) || devices.length === 0) {
                console.log("State file contains no devices, regenerating...");
                generateDevices();
            } else {
                // Randomize location slightly on startup to simulate time passed
                devices.forEach(d => {
                    if (typeof d.lat !== 'number' || isNaN(d.lat)) d.lat = -1.9441;
                    if (typeof d.lng !== 'number' || isNaN(d.lng)) d.lng = 30.0619;
                    if (d.fuel === undefined) d.fuel = Math.floor(Math.random() * 50) + 50; 
                    d.isOnline = true; 
                    if (d.speed > 0) {
                        d.locked = false;
                        d.cloudLocked = false;
                    } else {
                        if (d.locked === undefined) d.locked = true;
                        if (d.cloudLocked === undefined) d.cloudLocked = false;
                    }
                });
                // Ensure SAFEBOX devices exist in state
                for (let i = 3; i <= 7; i++) {
                    const id = `SAFEBOX_00${i}`;
                    if (!devices.some(d => d.id === id)) {
                        devices.push({
                            id,
                            lat: -1.9441 + (Math.random() * 0.06 - 0.01),
                            lng: 30.0619 + (Math.random() * 0.07 - 0.01),
                            speed: 0,
                            locked: true,
                            cloudLocked: false,
                            direction: Math.random() * 360,
                            isOnline: true,
                            battery: Math.floor(Math.random() * 20) + 80,
                            fuel: Math.floor(Math.random() * 40) + 60,
                            isTcp: true,
                            bleBeaconId: `TAG_00${i}`,
                            bleBeaconRssiThreshold: -80,
                            driverNear: true
                        });
                    }
                }
                console.log(`Loaded ${devices.length} devices from persistence (including COTS TCP trackers).`);
            }
        }
    } catch (e) {
        console.error("Error loading state", e);
        generateDevices();
    }
} else {
    generateDevices();
}

function generateDevices() {
    console.log('Generating new random devices...');
    devices = Array.from({ length: DEVICE_COUNT }, (_, i) => {
        const id = `${DEVICE_PREFIX}${String(i + 1).padStart(3, '0')}`; // e.g., MOTO_001
        return {
            id,
            lat: -1.9441 + (Math.random() * 0.06 - 0.01),
            lng: 30.0619 + (Math.random() * 0.07 - 0.01),
            speed: 0,
            locked: false,
            cloudLocked: false,
            direction: Math.random() * 360,
            isOnline: true, // Force online for demo
            battery: Math.floor(Math.random() * 100),
            fuel: Math.floor(Math.random() * 50) + 50 // Fuel Level %
        };
    });

    // Register SAFEBOX_003 to SAFEBOX_007 as TCP trackers
    for (let i = 3; i <= 7; i++) {
        const id = `SAFEBOX_00${i}`;
        devices.push({
            id,
            lat: -1.9441 + (Math.random() * 0.06 - 0.01),
            lng: 30.0619 + (Math.random() * 0.07 - 0.01),
            speed: 0,
            locked: true,
            cloudLocked: false,
            direction: Math.random() * 360,
            isOnline: true,
            battery: Math.floor(Math.random() * 20) + 80,
            fuel: Math.floor(Math.random() * 40) + 60,
            isTcp: true,
            bleBeaconId: `TAG_00${i}`,
            bleBeaconRssiThreshold: -80,
            driverNear: true
        });
    }
    saveState();
}

function saveState() {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(devices, null, 2), 'utf8');
    } catch (e) {
        console.error("Error saving state", e);
    }
}

// TCP Simulator Connections Manager
const tcpConnections = new Map();

function connectTcpDevice(device) {
    const socket = new net.Socket();
    
    socket.connect(TCP_PORT, TCP_HOST, () => {
        console.log(`[TCP Simulator] Connected tracker ${device.id} to TCP server at ${TCP_HOST}:${TCP_PORT}`);
        socket.write(`$$LOGIN,${device.id},123456\r\n`);
    });

    socket.on('data', (data) => {
        const cmdStr = data.toString().trim();
        console.log(`[TCP Simulator] Device ${device.id} received command payload: ${cmdStr}`);
        
        const lines = cmdStr.split('\n');
        for (let line of lines) {
            line = line.trim();
            if (line.startsWith('$$CMD,')) {
                const parts = line.substring(6).split(',');
                const devId = parts[0];
                const cmdType = parts[1];
                const cmdVal = parts[2];
                
                if (devId === device.id) {
                    if (cmdType === 'SET_CLOUDLOCKED') {
                        device.cloudLocked = parseInt(cmdVal) === 1;
                        if (device.cloudLocked) {
                            device.locked = true;
                            device.speed = 0;
                        }
                        console.log(`[TCP Simulator] Device ${device.id} cloudLocked state set to: ${device.cloudLocked}`);
                    } else if (cmdType === 'SET_BLE_BEACON') {
                        device.bleBeaconId = cmdVal;
                        device.bleBeaconRssiThreshold = parseInt(parts[3] || '-80');
                        console.log(`[TCP Simulator] Device ${device.id} BLE configuration updated: whitelist=${device.bleBeaconId}, threshold=${device.bleBeaconRssiThreshold} dBm`);
                    }
                }
            }
        }
    });

    socket.on('close', () => {
        console.log(`[TCP Simulator] Socket closed for device ${device.id}. Reconnecting in 5s...`);
        tcpConnections.delete(device.id);
        setTimeout(() => {
            if (devices.some(d => d.id === device.id)) {
                connectTcpDevice(device);
            }
        }, 5000);
    });

    socket.on('error', (err) => {
        console.error(`[TCP Simulator] Connection error on ${device.id}:`, err.message);
    });

    tcpConnections.set(device.id, socket);
}

function initTcpSimulators() {
    devices.forEach(d => {
        if (d.isTcp) {
            connectTcpDevice(d);
        }
    });
}

const mqttOptions = MQTT_USER ? {
    username: MQTT_USER,
    password: MQTT_PASS
} : {};
const client = mqtt.connect(MQTT_BROKER, mqttOptions);

client.on('connect', () => {
    console.log('Connected to MQTT broker');
    client.subscribe('/device/+/command'); 
    
    // Start TCP Simulators
    initTcpSimulators();

    setInterval(() => {
        try {
            simulateFleet();
        } catch (err) {
            console.error("Simulation Loop Error:", err);
        }
    }, 3000); 
    setInterval(saveState, 10000); 
});

client.on('message', (topic, message) => {
    // console.log(`Received message on ${topic}: ${message.toString()}`);
    const parts = topic.split('/');
    const deviceId = parts[2];
    const command = parts[3]; // This is usually 'command' literal, payload has the actual command

    const device = devices.find(d => d.id === deviceId);
    if (!device) return;

    try {
        const payload = JSON.parse(message.toString());
        // Check payload.command
        if (payload.command === 'LOCK') {
            device.locked = true;
            device.cloudLocked = true;
            device.startBlocked = true;
            console.log(`Device ${deviceId} locked.`);
        } else if (payload.command === 'UNLOCK') {
            device.locked = false;
            device.cloudLocked = false;
            device.startBlocked = false;
            console.log(`Device ${deviceId} unlocked.`);
        } else if (payload.command === 'BLOCK_START') {
            device.startBlocked = true;
            device.locked = true;
            console.log(`Device ${deviceId} start blocked.`);
        } else if (payload.command === 'ALLOW_START') {
            device.startBlocked = false;
            device.locked = false;
            console.log(`Device ${deviceId} start allowed.`);
        }
        publishStatus(device); // Publish updated status
    } catch (e) {
        console.error(`Error parsing message: ${e}`);
    }
});

function simulateFleet() {
    devices.forEach((device, i) => { setTimeout(() => {
        // FUEL LOGIC
        if (device.fuel <= 0) {
            // Out of fuel: Force stop
            device.speed = 0;

            if (!device.emptySince) device.emptySince = Date.now();

            // Refuel after 30 seconds
            if (Date.now() - device.emptySince > 30000) {
                device.fuel = 100;
                device.emptySince = null;
                console.log(`[${device.id}] ⛽ Refueled to 100%`);
            }
        } else {
            // Has fuel
            if (device.speed > 0) {
                if (device.cloudLocked || device.locked) {
                    // Manual cutoff or locked: cut engine immediately
                    device.speed = 0;
                    device.battery = Math.max(0, device.battery - 0.001);
                    console.log(`[${device.id}] Engine FORCE CUT because vehicle is locked.`);
                } else {
                    // Normal run: consume fuel and move
                    device.speed = Math.floor(Math.random() * 40) + 20; // Maintain speed between 20 and 60
                    device.lat += (Math.random() * 0.0003 - 0.00015);
                    device.lng += (Math.random() * 0.0003 - 0.00015);
                    device.fuel = Math.max(0, device.fuel - 0.05);
                    device.battery = Math.max(0, device.battery - 0.02);

                    // HARSH DRIVING EVENTS (0.2% chance per tick while driving)
                    if (Math.random() < 0.002) {
                        const nowMs = Date.now();
                        if (!device.lastHarshEventTime || (nowMs - device.lastHarshEventTime > 60000)) { // 1 min cooldown
                            device.lastHarshEventTime = nowMs;
                            const isAccel = Math.random() < 0.5;
                            const eventType = isAccel ? 'HARSH_ACCEL' : 'HARSH_BRAKE';
                            if (isAccel) {
                                device.speed = Math.min(120, device.speed + Math.floor(Math.random() * 30) + 20);
                            } else {
                                device.speed = Math.max(0, device.speed - Math.floor(Math.random() * 30) - 15);
                            }
                            console.log(`[${device.id}] ⚠️ ${eventType} detected! Speed: ${device.speed} km/h`);
                            client.publish(`/device/${device.id}/alert`, JSON.stringify({
                                type: eventType,
                                speed: device.speed,
                                timestamp: nowMs
                            }));
                        }
                    }

                    // Randomly turn off engine (arrive at destination) - 3% chance
                    if (Math.random() < 0.03) {
                        device.speed = 0;
                        console.log(`[${device.id}] Driver arrived at destination, turned off engine.`);
                    }
                }
            } else {
                // Stopped (speed === 0)
                device.battery = Math.max(0, device.battery - 0.001);

                // Driver attempts to start the engine (1.5% chance)
                if (Math.random() < 0.015) {
                    console.log(`[${device.id}] Driver attempts to start engine...`);
                    
                    if (device.cloudLocked || device.startBlocked || device.locked) {
                        const nowMs = Date.now();
                        // Only publish alert once every 5 minutes (300,000 ms) per device
                        if (!device.lastStartAttemptBlockedTime || (nowMs - device.lastStartAttemptBlockedTime > 300000)) {
                            device.lastStartAttemptBlockedTime = nowMs;
                            console.log(`[${device.id}] Start attempt BLOCKED! (Locked: ${device.locked}, Cloud Locked: ${device.cloudLocked}, Start Blocked: ${device.startBlocked})`);
                            // Send start blocked alert to backend
                            client.publish(`/device/${device.id}/alert`, JSON.stringify({
                                type: 'START_ATTEMPT_BLOCKED',
                                timestamp: nowMs
                            }));
                        }
                    } else {
                        // Start successful!
                        device.speed = Math.floor(Math.random() * 40) + 20;
                        device.locked = false;
                        console.log(`[${device.id}] Engine started successfully.`);
                    }
                }
            }
        }

        // Battery Logic (Independent of fuel)
        if (device.battery <= 0) {
            if (!device.deadSince) device.deadSince = Date.now();
            if (Date.now() - device.deadSince > 30000) {
                device.battery = 100;
                device.deadSince = null;
                console.log(`[${device.id}] 🔋 Battery Recharged`);
            }
        }

        // FUEL THEFT SIMULATION (0.05% chance while stopped with fuel > 20%)
        if (device.speed === 0 && device.fuel > 20 && Math.random() < 0.0005) {
            const fuelBefore = device.fuel;
            device.fuel = Math.max(0, device.fuel - 15); // Drop by 15%
            console.log(`[${device.id}] ⚠️  FUEL THEFT DETECTED! ${Math.round(fuelBefore)}% → ${Math.round(device.fuel)}%`);
            client.publish(`/device/${device.id}/alert`, JSON.stringify({
                type: 'FUEL_THEFT',
                fuelBefore: Math.round(fuelBefore),
                fuelAfter: Math.round(device.fuel),
                timestamp: Date.now()
            }));
        }

        // UNAUTHORIZED START SIMULATION (Only if locked and randomly) - DISABLED
        /*
        if (device.locked && Math.random() < 0.015) {
            console.log(`[${device.id}] ⚠️  UNAUTHORIZED START DETECTED!`);
            client.publish(`/device/${device.id}/alert`, JSON.stringify({
                type: 'UNAUTHORIZED_START',
                timestamp: Date.now()
            }));
        }
        */

        // DEVICE TAMPERING SIMULATION (Randomly) - DISABLED
        /*
        if (Math.random() < 0.01) {
            console.log(`[${device.id}] ⚠️  DEVICE TAMPERING DETECTED!`);
            client.publish(`/device/${device.id}/alert`, JSON.stringify({
                type: 'DEVICE_TAMPERING',
                timestamp: Date.now()
            }));
        }
        */

        // Remote lock/unlock logic (Simulate user pressing remote)
        if (Math.random() < 0.01) {
            if (!device.cloudLocked) {
                // device.locked = !device.locked; // User toggles lock
            }
        }

        // TCP Proximity Toggling (Toggle presence state randomly to test PKE lock/unlock)
        if (device.isTcp && Math.random() < 0.05) {
            device.driverNear = !device.driverNear;
            console.log(`[TCP Simulator] Driver BLE keyfob is now ${device.driverNear ? 'IN PROXIMITY' : 'OUT OF RANGE'} for ${device.id}`);
        }

        publishStatus(device); }, i * 50); }); }

function publishStatus(device) {
    if (device.isTcp) {
        if (tcpConnections.has(device.id)) {
            const socket = tcpConnections.get(device.id);
            const rawBleScanList = device.driverNear 
                ? `${device.bleBeaconId || `TAG_003`}:-70` 
                : `${device.bleBeaconId || `TAG_003`}:-95`;
            const frame = `$$DATA,${device.id},${device.lat.toFixed(6)},${device.lng.toFixed(6)},${device.speed.toFixed(1)},${Math.round(device.battery)},${Math.round(device.fuel)},${device.speed > 0 ? 1 : 0},${rawBleScanList}\n`;
            socket.write(frame);
            console.log(`[TCP Simulator] Sent telematics data frame for ${device.id}: ${frame.trim()}`);
        }
        return;
    }

    const topic = `/device/${device.id}/status`;
    const status = {
        deviceId: device.id,
        lat: device.lat,
        lng: device.lng,
        speed: device.speed,
        locked: device.locked,
        cloudLocked: device.cloudLocked,
        battery: Math.round(device.battery),
        fuel: Math.round(device.fuel),
        timestamp: Date.now()
    };
    const payload = JSON.stringify(status);
    client.publish(topic, payload);
    console.log(`Published to ${topic}: ${payload}`);
}
