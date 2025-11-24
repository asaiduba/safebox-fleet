const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Health check server for Andasy
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Simulator Running');
});
server.listen(8080, () => console.log('Health check running on port 8080'));


// Configuration
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const DEVICE_PREFIX = 'MOTO_';
const DEVICE_COUNT = 50; // 50 Devices
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
                    d.lat += (Math.random() * 0.005 - 0.0025);
                    d.lng += (Math.random() * 0.005 - 0.0025);
                    if (d.cloudLocked === undefined) d.cloudLocked = d.locked;
                    if (d.fuel === undefined) d.fuel = Math.floor(Math.random() * 50) + 50; // Initial fuel 50-100%
                    d.isOnline = true; // Force online on load
                });
                console.log(`Loaded ${devices.length} devices from persistence.`);
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
            locked: true,
            cloudLocked: true,
            direction: Math.random() * 360,
            isOnline: true, // Force online for demo
            battery: Math.floor(Math.random() * 100),
            fuel: Math.floor(Math.random() * 50) + 50 // Fuel Level %
        };
    });
    saveState();
}

function saveState() {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(devices, null, 2), 'utf8');
    } catch (e) {
        console.error("Error saving state", e);
    }
}

const client = mqtt.connect(MQTT_BROKER);

console.log(`🔌 Connecting to MQTT Broker: ${MQTT_BROKER}`);

client.on('connect', () => {
    console.log('✅ Connected to MQTT broker');
    client.subscribe('/device/+/command'); // Subscribe to commands for all devices
    setInterval(simulateFleet, 3000); // Simulate every 3 seconds
    setInterval(saveState, 10000); // Save state every 10 seconds
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
            console.log(`Device ${deviceId} locked.`);
        } else if (payload.command === 'UNLOCK') {
            device.locked = false;
            device.cloudLocked = false;
            console.log(`Device ${deviceId} unlocked.`);
        }
        publishStatus(device); // Publish updated status
    } catch (e) {
        console.error(`Error parsing message: ${e}`);
    }
});

function simulateFleet() {
    devices.forEach(device => {
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
            if (!device.locked) {
                // UNLOCKED: Move and consume fuel
                device.speed = Math.floor(Math.random() * 60) + 10;
                // Smoother movement (approx 20m jumps max)
                device.lat += (Math.random() * 0.0002 - 0.0001);
                device.lng += (Math.random() * 0.0002 - 0.0001);

                // Consumption
                device.fuel = Math.max(0, device.fuel - 0.2); // Consume fuel
                device.battery = Math.max(0, device.battery - 0.1);
            } else {
                // LOCKED: Stop
                device.speed = 0;
                // Idle consumption
                device.battery = Math.max(0, device.battery - 0.01);
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

        // FUEL THEFT SIMULATION (Only if stopped and has fuel)
        if (device.speed === 0 && device.fuel > 10 && Math.random() < 0.005) {
            console.log(`[${device.id}] ⚠️  FUEL THEFT DETECTED!`);
            device.fuel = Math.max(0, device.fuel - 10);
            client.publish(`/device/${device.id}/alert`, JSON.stringify({
                type: 'FUEL_THEFT',
                value: device.fuel,
                timestamp: Date.now()
            }));
        }

        // Remote lock/unlock logic (Simulate user pressing remote)
        if (Math.random() < 0.01) {
            if (!device.cloudLocked) {
                // device.locked = !device.locked; // User toggles lock
            }
        }

        publishStatus(device);
    });
}

function publishStatus(device) {
    const topic = `/device/${device.id}/status`;
    const payload = JSON.stringify({
        deviceId: device.id,
        lat: device.lat,
        lng: device.lng,
        speed: device.speed,
        locked: device.locked,
        battery: Math.floor(device.battery),
        fuel: Math.floor(device.fuel), // Add Fuel to telemetry
        timestamp: Date.now()
    });
    client.publish(topic, payload);
}
