import React, { useState, useEffect, useCallback, useRef } from 'react';
import io from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';
import './App.css';
import Auth from './Auth';
import LandingPage from './LandingPage';
import AnalyticsDashboard from './AnalyticsDashboard';
import NotificationsPanel from './NotificationsPanel';

// Fix default marker icon issue with Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// API Configuration
const API_URL = import.meta.env.VITE_API_URL || '';
const socket = io(API_URL);

// Helper component for map click handling in Leaflet
function MapClickHandler({ onClick }) {
    const map = useMap();
    useEffect(() => {
        const handleClick = (e) => {
            onClick(e);
        };
        map.on('click', handleClick);
        return () => {
            map.off('click', handleClick);
        };
    }, [map, onClick]);
    return null;
}

// Error Boundary Component
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error("Frontend Error:", error, errorInfo);
        this.setState({ error, errorInfo });
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: '2rem', color: 'white', background: '#1a1a1a', height: '100vh', overflow: 'auto' }}>
                    <h1>Something went wrong.</h1>
                    <details style={{ whiteSpace: 'pre-wrap', marginBottom: '1rem' }}>
                        {this.state.error && this.state.error.toString()}
                        <br />
                        {this.state.errorInfo && this.state.errorInfo.componentStack}
                    </details>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            padding: '0.5rem 1rem',
                            background: '#3b82f6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '0.25rem',
                            cursor: 'pointer'
                        }}
                    >
                        Reload Application
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

function App() {
    // Initialize user from localStorage if available
    const [user, setUser] = useState(() => {
        const savedUser = localStorage.getItem('user');
        return savedUser ? JSON.parse(savedUser) : null;
    });

    const [vehicles, setVehicles] = useState([]);
    const [selectedVehicleId, setSelectedVehicleId] = useState(null);
    const [newVehicleId, setNewVehicleId] = useState('');
    const [newVehicleName, setNewVehicleName] = useState('');
    const [showAuth, setShowAuth] = useState(false);
    const [showLanding, setShowLanding] = useState(!user);
    const [showAnalytics, setShowAnalytics] = useState(false);
    const [geofences, setGeofences] = useState([]);
    const [geofenceMode, setGeofenceMode] = useState(false);
    const [newGeofenceRadius, setNewGeofenceRadius] = useState(500); // Default 500m
    const [alerts, setAlerts] = useState([]);
    const [showNotifications, setShowNotifications] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const mapRef = useRef(null);

    // Derive selected vehicle from vehicles array
    const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId) || null;

    // Helper to check if device is online (seen in last 5 minutes)
    const isOnline = (lastUpdate) => {
        if (!lastUpdate) return false;
        const diff = new Date() - new Date(lastUpdate);
        return diff < 300000; // 5 minutes
    };


    // Pan to selected vehicle
    useEffect(() => {
        if (selectedVehicle && mapRef.current) {
            mapRef.current.panTo({ lat: selectedVehicle.lat, lng: selectedVehicle.lng });
            mapRef.current.setZoom(16);
        }
    }, [selectedVehicleId]);

    useEffect(() => {
        if (!user) return;

        fetchVehicles();
        fetchNotifications();

        socket.on('connect', () => {
            console.log('Connected to backend');
        });

        socket.on('device-data', (data) => {
            setVehicles(prev => {
                const index = prev.findIndex(v => v.id === data.payload.deviceId);
                if (index > -1) {
                    const newVehicles = [...prev];
                    newVehicles[index] = {
                        ...newVehicles[index],
                        ...data.payload,
                        lastUpdate: new Date()
                    };
                    return newVehicles;
                }
                return prev;
            });
        });

        socket.on('geofence-alert', (data) => {
            setAlerts(prev => [...prev, data]);
            // Add to notifications list
            const newNotif = {
                id: Date.now(), // Temp ID until refresh
                vehicle_id: data.vehicleId,
                message: data.message,
                timestamp: data.timestamp,
                type: data.type || 'GEOFENCE',
                is_read: 0
            };
            setNotifications(prev => [newNotif, ...prev]);
            setUnreadCount(prev => prev + 1);

            setTimeout(() => {
                setAlerts(prev => prev.filter(a => a !== data));
            }, 5000);
        });

        return () => {
            socket.off('device-data');
            socket.off('geofence-alert');
        };
    }, [user]);

    useEffect(() => {
        if (selectedVehicleId) {
            fetchGeofences(selectedVehicleId);
        } else {
            setGeofences([]);
            setGeofenceMode(false);
        }
    }, [selectedVehicleId]);

    const fetchGeofences = async (vehicleId) => {
        try {
            const res = await axios.get(`${API_URL}/api/geofences?vehicleId=${vehicleId}`);
            setGeofences(res.data);
        } catch (err) {
            console.error("Failed to fetch geofences");
        }
    };

    const fetchNotifications = async () => {
        try {
            const res = await axios.get(`${API_URL}/api/notifications?userId=${user.id}&role=${user.role}`);
            setNotifications(res.data);
            setUnreadCount(res.data.filter(n => !n.is_read).length);
        } catch (err) {
            console.error("Failed to fetch notifications");
        }
    };

    const handleMarkRead = async (id) => {
        try {
            await axios.put(`${API_URL}/api/notifications/${id}/read`);
            setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n));
            setUnreadCount(prev => Math.max(0, prev - 1));
        } catch (err) {
            console.error("Failed to mark read");
        }
    };

    const handleMarkAllRead = async () => {
        try {
            await axios.put(`${API_URL}/api/notifications/read-all`, { userId: user.id });
            setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
            setUnreadCount(0);
        } catch (err) {
            console.error("Failed to mark all read");
        }
    };

    const fetchVehicles = async () => {
        try {
            const res = await axios.get(`${API_URL}/api/vehicles?userId=${user.id}&role=${user.role}`);
            setVehicles(res.data.map(v => ({
                ...v,
                lat: v.lat || -1.9441,
                lng: v.lng || 30.0619,
                speed: v.speed || 0,
                locked: v.is_locked === 1,
                battery: v.battery_level || 100,
                fuel: v.fuel_level || 100,
                lastUpdate: v.last_seen ? new Date(v.last_seen) : null
            })));
        } catch (err) {
            console.error("Failed to fetch vehicles", err);
        }
    };

    const handleDeleteVehicle = async (vehicleId) => {
        if (!confirm('Are you sure you want to remove this vehicle?')) return;
        try {
            await axios.delete(`${API_URL}/api/vehicles/${vehicleId}`);
            fetchVehicles();
            if (selectedVehicleId === vehicleId) setSelectedVehicleId(null);
        } catch (err) {
            alert('Failed to delete vehicle');
        }
    };

    const toggleLock = (vehicleId, currentStatus) => {
        const command = currentStatus ? 'UNLOCK' : 'LOCK';
        socket.emit('send-command', { deviceId: vehicleId, command });

        setVehicles(prev => prev.map(v =>
            v.id === vehicleId ? { ...v, locked: !currentStatus } : v
        ));
    };

    const handleLogin = (userData) => {
        localStorage.setItem('user', JSON.stringify(userData));
        setUser(userData);
        setShowLanding(false);
    };

    const handleLogout = () => {
        localStorage.removeItem('user');
        setUser(null);
        setVehicles([]);
        setShowLanding(true);
        setShowAnalytics(false);
    };

    const handleAddVehicle = async (e) => {
        e.preventDefault();
        try {
            await axios.post(`${API_URL}/api/vehicles`, {
                id: newVehicleId,
                name: newVehicleName || `Vehicle ${newVehicleId}`,
                ownerId: user.id
            });
            setNewVehicleId('');
            setNewVehicleName('');
            fetchVehicles();
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to add vehicle');
        }
    };

    const handleVehicleSelect = (vehicle) => {
        setSelectedVehicleId(vehicle.id);
    };

    const sendCommand = (deviceId, command) => {
        socket.emit('send-command', { deviceId, command });
        setVehicles(prev => prev.map(v =>
            v.id === deviceId ? { ...v, locked: command === 'LOCK' } : v
        ));
    };

    const handleMapClick = async (e) => {
        if (geofenceMode && selectedVehicleId) {
            // Prevent multiple clicks
            setGeofenceMode(false);

            const lat = e.latLng.lat();
            const lng = e.latLng.lng();
            const radius = (newGeofenceRadius && !isNaN(newGeofenceRadius) && newGeofenceRadius > 0) ? newGeofenceRadius : 500;

            try {
                await axios.post(`${API_URL}/api/geofences`, {
                    vehicleId: selectedVehicleId,
                    lat,
                    lng,
                    radius
                });
                fetchGeofences(selectedVehicleId);
            } catch (err) {
                alert('Failed to create geofence');
                setGeofenceMode(true); // Re-enable on error
            }
        }
    };

    const handleGeofenceUpdate = useCallback(async (id, newLat, newLng, newRadius) => {
        // Optimistic update
        setGeofences(prev => prev.map(g =>
            g.id === id ? { ...g, lat: newLat, lng: newLng, radius: newRadius } : g
        ));

        try {
            await axios.put(`${API_URL}/api/geofences/${id}`, {
                lat: newLat,
                lng: newLng,
                radius: newRadius
            });
        } catch (err) {
            console.error("Failed to update geofence", err);
            // Revert on failure (optional, but good practice)
            fetchGeofences(selectedVehicleId);
        }
    }, [selectedVehicleId]);

    const handleDeleteGeofence = async (id) => {
        // Optimistic update
        const previousGeofences = [...geofences];
        setGeofences(prev => prev.filter(g => g.id !== id));

        try {
            await axios.delete(`${API_URL}/api/geofences/${id}`);
        } catch (err) {
            alert('Failed to delete geofence');
            setGeofences(previousGeofences); // Revert
        }
    };
    return (
        <ErrorBoundary>
            {/* Landing Page */}
            {showLanding && (
                <LandingPage
                    onGetStarted={() => {
                        setShowLanding(false);
                        setShowAuth(true);
                    }}
                    user={user}
                    onBackToDashboard={() => setShowLanding(false)}
                />
            )}

            {/* Auth Screen */}
            {!user && showAuth && !showLanding && (
                <Auth
                    onLogin={handleLogin}
                    onBack={() => {
                        setShowAuth(false);
                        setShowLanding(true);
                    }}
                />
            )}

            {/* Analytics Dashboard Overlay */}
            {user && showAnalytics && (
                <AnalyticsDashboard onBack={() => setShowAnalytics(false)} />
            )}

            {/* Main Dashboard */}
            {user && !showAnalytics && (
                <div className="app-container">
                    {/* Alerts Container */}
                    <div className="alerts-container">
                        {alerts.map((alert, idx) => (
                            <div key={idx} className="alert-toast">
                                🚨 {alert.message}
                            </div>
                        ))}
                    </div>

                    {/* Header */}
                    <header className="app-header">
                        <div className="header-left" onClick={() => setShowLanding(true)} style={{ cursor: 'pointer' }}>
                            <img src="/logo.png" alt="SafeBox Logo" className="header-logo" />
                            <h1>SafeBox Fleet</h1>
                        </div>
                        <div className="user-info">
                            {user.role === 'company' && (
                                <button
                                    className="analytics-btn"
                                    onClick={() => setShowAnalytics(true)}
                                    style={{
                                        marginRight: '1rem',
                                        background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                                        border: 'none',
                                        padding: '0.5rem 1rem',
                                        borderRadius: '0.5rem',
                                        color: 'white',
                                        cursor: 'pointer',
                                        fontWeight: 'bold',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem'
                                    }}
                                >
                                    Analytics 📊
                                </button>
                            )}
                            <span>{user.username} ({user.role})</span>

                            {/* Notification Bell */}
                            <div style={{ position: 'relative', cursor: 'pointer', marginRight: '1rem' }} onClick={() => setShowNotifications(!showNotifications)}>
                                <span style={{ fontSize: '1.5rem' }}>🔔</span>
                                {unreadCount > 0 && (
                                    <span style={{
                                        position: 'absolute',
                                        top: '-5px',
                                        right: '-5px',
                                        background: '#ef4444',
                                        color: 'white',
                                        borderRadius: '50%',
                                        width: '18px',
                                        height: '18px',
                                        fontSize: '0.7rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontWeight: 'bold'
                                    }}>
                                        {unreadCount > 9 ? '9+' : unreadCount}
                                    </span>
                                )}
                            </div>

                            <button onClick={handleLogout} className="logout-btn">Logout</button>
                        </div>
                    </header>

                    {/* Notifications Panel */}
                    {showNotifications && (
                        <NotificationsPanel
                            notifications={notifications}
                            onClose={() => setShowNotifications(false)}
                            onMarkRead={handleMarkRead}
                            onMarkAllRead={handleMarkAllRead}
                        />
                    )}

                    {/* Sidebar - Vehicle List */}
                    <div className="sidebar">
                        <h3>Your Fleet</h3>
                        <div className="vehicle-list">
                            {vehicles.map(v => (
                                <div
                                    key={v.id}
                                    className={`vehicle-card ${selectedVehicleId === v.id ? 'selected' : ''}`}
                                    onClick={() => handleVehicleSelect(v)}
                                >
                                    <div className="vehicle-info">
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span className="vehicle-name">{v.name}</span>
                                            <span title={v.locked ? "Locked" : "Unlocked"}>
                                                {v.locked ? '🔒' : '🔓'}
                                            </span>
                                        </div>
                                        <span className={`status-badge ${isOnline(v.lastUpdate) ? 'online' : 'offline'}`}>
                                            {isOnline(v.lastUpdate) ? 'ONLINE' : 'OFFLINE'}
                                        </span>
                                    </div>
                                    <div className="vehicle-details-mini">
                                        <span>🔋 {v.battery}%</span>
                                        <span>⛽ {v.fuel || '--'}%</span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Add Vehicle Form */}
                        <div className="add-vehicle-form">
                            <h4>Add Vehicle</h4>
                            <input
                                type="text"
                                placeholder="Device ID (e.g. MOTO_001)"
                                value={newVehicleId}
                                onChange={(e) => setNewVehicleId(e.target.value)}
                            />
                            <input
                                type="text"
                                placeholder="Name (Optional)"
                                value={newVehicleName}
                                onChange={(e) => setNewVehicleName(e.target.value)}
                            />
                            <button onClick={handleAddVehicle}>Add Vehicle</button>
                        </div>
                    </div>

                    {/* Map Area */}
                    <div className="map-container">
                        <MapContainer
                            center={[-1.9441, 30.0619]}
                            zoom={14}
                            style={{ width: '100%', height: '100%' }}
                            ref={mapRef}
                        >
                            <TileLayer
                                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            />

                            {/* Geofence Circles */}
                            {geofences.map(geo => (
                                <Circle
                                    key={geo.id}
                                    center={[geo.lat, geo.lng]}
                                    radius={geo.radius}
                                    pathOptions={{
                                        fillColor: '#22c55e',
                                        fillOpacity: 0.2,
                                        color: '#22c55e',
                                        opacity: 0.8,
                                        weight: 2
                                    }}
                                />
                            ))}

                            {/* Vehicle Markers */}
                            {vehicles.map(v => (
                                <Marker
                                    key={v.id}
                                    position={[v.lat, v.lng]}
                                    eventHandlers={{
                                        click: () => handleVehicleSelect(v)
                                    }}
                                >
                                    {selectedVehicle && selectedVehicle.id === v.id && (
                                        <Popup open onClose={() => setSelectedVehicleId(null)}>
                                            <div className="info-window">
                                                <h3>{selectedVehicle.name}</h3>
                                                <p>Status: {selectedVehicle.locked ? 'LOCKED 🔒' : 'UNLOCKED 🔓'}</p>
                                                <p>Speed: {selectedVehicle.speed} km/h</p>
                                                <p>Battery: {selectedVehicle.battery}%</p>
                                                <p>Fuel: {selectedVehicle.fuel || '--'}%</p>
                                                <div className="controls">
                                                    <button
                                                        className="lock-btn"
                                                        onClick={() => sendCommand(selectedVehicle.id, 'LOCK')}
                                                        disabled={selectedVehicle.locked}
                                                    >
                                                        LOCK
                                                    </button>
                                                    <button
                                                        className="unlock-btn"
                                                        onClick={() => sendCommand(selectedVehicle.id, 'UNLOCK')}
                                                        disabled={!selectedVehicle.locked}
                                                    >
                                                        UNLOCK
                                                    </button>
                                                </div>
                                                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                                    <button
                                                        className="track-btn"
                                                        onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${selectedVehicle.lat},${selectedVehicle.lng}`, '_blank')}
                                                        style={{ flex: 1, backgroundColor: '#3b82f6', color: 'white', border: 'none', padding: '0.4rem', borderRadius: '0.25rem', cursor: 'pointer', fontWeight: 'bold' }}
                                                    >
                                                        TRACK 📍
                                                    </button>
                                                    <button
                                                        className="delete-btn"
                                                        onClick={() => handleDeleteVehicle(selectedVehicle.id)}
                                                        style={{ flex: 1, backgroundColor: '#ff4444', color: 'white', border: 'none', padding: '0.4rem', borderRadius: '0.25rem', cursor: 'pointer', fontWeight: 'bold' }}
                                                    >
                                                        REMOVE 🗑️
                                                    </button>
                                                </div>

                                                <div style={{ marginTop: '0.5rem', borderTop: '1px solid #e2e8f0', paddingTop: '0.5rem' }}>
                                                    <h4>Safe Zones</h4>
                                                    {geofences.length === 0 ? (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                            {geofenceMode && (
                                                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                                    <input
                                                                        type="number"
                                                                        value={newGeofenceRadius}
                                                                        onChange={(e) => setNewGeofenceRadius(Number(e.target.value))}
                                                                        placeholder="Radius (m)"
                                                                        style={{ width: '80px', padding: '0.3rem', borderRadius: '0.25rem', border: '1px solid #ccc' }}
                                                                    />
                                                                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>meters</span>
                                                                </div>
                                                            )}
                                                            <button
                                                                onClick={() => setGeofenceMode(!geofenceMode)}
                                                                style={{ width: '100%', padding: '0.4rem', background: geofenceMode ? '#64748b' : '#8b5cf6', color: 'white', border: 'none', borderRadius: '0.25rem', cursor: 'pointer' }}
                                                            >
                                                                {geofenceMode ? 'Cancel Selection' : 'Add Safe Zone (Click Map)'}
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                                            {geofences.map(g => (
                                                                <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem' }}>
                                                                    <span>Zone ({g.radius || 500}m)</span>
                                                                    <button
                                                                        onClick={() => handleDeleteGeofence(g.id)}
                                                                        style={{ background: '#ef4444', color: 'white', border: 'none', padding: '0.1rem 0.3rem', borderRadius: '0.2rem', cursor: 'pointer' }}
                                                                    >
                                                                        ×
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </Popup>
                                    )}
                                </Marker>
                            ))}

                            {/* Map Click Handler for Geofence */}
                            {geofenceMode && <MapClickHandler onClick={handleMapClick} />}
                        </MapContainer>
                    </div>
                </div>
            )}
        </ErrorBoundary>
    );
}

export default function AppWrapper() {
    return (
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    );
}
