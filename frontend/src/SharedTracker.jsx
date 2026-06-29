import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import io from 'socket.io-client';
import axios from 'axios';
import './SharedTracker.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Auto-pan map when marker moves
function MapAutoCenter({ lat, lng }) {
    const map = useMap();
    useEffect(() => {
        if (lat && lng && lat !== 0 && lng !== 0) {
            map.setView([lat, lng], map.getZoom(), { animate: true, duration: 1 });
        }
    }, [lat, lng, map]);
    return null;
}

// Helper to get vehicle emoji based on type
export const getVehicleEmoji = (type) => {
    switch (type?.toLowerCase()) {
        case 'motorcycle': return '🏍️';
        case 'tricycle': return '🛺';
        case 'bus': return '🚌';
        case 'truck': return '🚚';
        case 'van': return '🚐';
        case 'car':
        default: return '🚗';
    }
};

// Custom vehicle marker icon
function createVehicleIcon(type) {
    return new L.DivIcon({
        className: 'shared-vehicle-marker-wrapper',
        html: `
            <div class="shared-vehicle-marker">
                <div class="marker-ripple"></div>
                <div class="marker-core">${getVehicleEmoji(type)}</div>
            </div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
    });
}

export default function SharedTracker({ token }) {
    const [vehicleData, setVehicleData] = useState(null);
    const [error, setError] = useState(null);
    const [expired, setExpired] = useState(false);
    const [loading, setLoading] = useState(true);
    const [countdown, setCountdown] = useState('');
    const [expiringSoon, setExpiringSoon] = useState(false);
    const socketRef = useRef(null);
    const expiresAtRef = useRef(null);

    // Fetch initial vehicle data
    useEffect(() => {
        async function fetchData() {
            try {
                const res = await axios.get(`${API_BASE}/api/shared-track/${token}`);
                setVehicleData(res.data);
                expiresAtRef.current = res.data.expiresAt;
                setLoading(false);
            } catch (err) {
                setLoading(false);
                if (err.response?.status === 410) {
                    setExpired(true);
                    setError('This tracking session has expired.');
                } else if (err.response?.status === 404) {
                    setError('Tracking link not found or has been revoked.');
                } else {
                    setError('Failed to load tracking data. Please try again.');
                }
            }
        }
        fetchData();
    }, [token]);

    // Connect to Socket.io shared-tracking namespace
    useEffect(() => {
        if (!vehicleData) return;

        const socket = io(`${API_BASE}/shared-tracking`, {
            transports: ['websocket', 'polling']
        });

        socket.on('connect', () => {
            console.log('📡 Connected to shared tracking');
            socket.emit('join-shared-track', token);
        });

        socket.on('shared-device-data', (data) => {
            setVehicleData(prev => ({
                ...prev,
                lat: data.lat,
                lng: data.lng,
                speed: data.speed,
                lastSeen: data.timestamp
            }));
        });

        socket.on('shared-track-error', (data) => {
            setExpired(true);
            setError(data.error || 'Link expired or invalid.');
        });

        socketRef.current = socket;

        return () => {
            socket.disconnect();
        };
    }, [vehicleData?.vehicleId, token]);

    // Countdown timer
    useEffect(() => {
        if (!expiresAtRef.current) return;

        const interval = setInterval(() => {
            const now = Date.now();
            const remaining = expiresAtRef.current - now;

            if (remaining <= 0) {
                setExpired(true);
                setError('This tracking session has expired.');
                clearInterval(interval);
                if (socketRef.current) socketRef.current.disconnect();
                return;
            }

            setExpiringSoon(remaining < 5 * 60 * 1000); // Less than 5 mins

            const hours = Math.floor(remaining / (1000 * 60 * 60));
            const mins = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
            const secs = Math.floor((remaining % (1000 * 60)) / 1000);

            if (hours > 0) {
                setCountdown(`${hours}h ${mins}m ${secs}s`);
            } else if (mins > 0) {
                setCountdown(`${mins}m ${secs}s`);
            } else {
                setCountdown(`${secs}s`);
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [vehicleData]);

    // Loading screen
    if (loading) {
        return (
            <div className="shared-tracker-loading">
                <div className="loading-spinner"></div>
                <span className="loading-text">Loading live tracking...</span>
            </div>
        );
    }

    // Error / Expired screen
    if (error || expired) {
        return (
            <div className="shared-tracker-error">
                <div className="error-card">
                    <span className="error-icon">{expired ? '⏰' : '🔗'}</span>
                    <div className="error-title">
                        {expired ? 'Session Expired' : 'Link Unavailable'}
                    </div>
                    <div className="error-message">{error}</div>
                    <div style={{ marginTop: '1.5rem', fontSize: '0.75rem', color: '#64748b' }}>
                        Powered by <span style={{ color: '#8b5cf6', fontWeight: 600 }}>SafeBox Fleet</span>
                    </div>
                </div>
            </div>
        );
    }

    if (!vehicleData) return null;

    const { name, plateNumber, driverName, vehicleType, lat, lng, battery, fuel, lastSeen, speed } = vehicleData;
    const hasLocation = lat && lng && lat !== 0 && lng !== 0;
    const displaySpeed = speed || 0;

    const lastSeenText = lastSeen
        ? new Date(lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : '--';

    return (
        <div className="shared-tracker-container">
            {/* Header */}
            <div className="shared-tracker-header">
                <div className="shared-tracker-brand">
                    <img src="/logo.png" alt="SafeBox" className="shared-tracker-logo" />
                    <span className="shared-tracker-brand-text">SafeBox Fleet</span>
                </div>
                <div className="shared-tracker-live-badge">
                    <span className="live-dot"></span>
                    LIVE TRACKING
                </div>
            </div>

            {/* Map */}
            <div className="shared-tracker-map">
                <MapContainer
                    center={hasLocation ? [lat, lng] : [-1.94, 30.06]}
                    zoom={15}
                    style={{ height: '100%', width: '100%' }}
                    zoomControl={true}
                >
                    <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />

                    {hasLocation && (
                        <>
                            <MapAutoCenter lat={lat} lng={lng} />
                            <Marker
                                position={[lat, lng]}
                                icon={createVehicleIcon(vehicleType)}
                            >
                                <Popup>
                                    <strong>{name}</strong><br />
                                    {plateNumber && <span>Plate: {plateNumber}<br /></span>}
                                    Speed: {displaySpeed} km/h
                                </Popup>
                            </Marker>
                        </>
                    )}
                </MapContainer>

                {/* Bottom Info Card */}
                <div className="shared-tracker-info-card">
                    <div className="info-card-top">
                        <div className="vehicle-label">
                            <span className="vehicle-name">
                                {driverName ? `${driverName} is on the way!` : `${name || 'Vehicle'} is on the way!`}
                            </span>
                            {plateNumber && (
                                <span className="vehicle-plate">{getVehicleEmoji(vehicleType)} {plateNumber}</span>
                            )}
                            {driverName && name && (
                                <span className="driver-name">Vehicle: {name}</span>
                            )}
                        </div>
                        <div className={`countdown-badge ${expiringSoon ? 'expiring-soon' : ''}`}>
                            ⏱️ {countdown}
                        </div>
                    </div>

                    <div className="info-card-stats">
                        <div className="stat-item">
                            <span className="stat-value">{displaySpeed}</span>
                            <span className="stat-label">km/h</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-value">{battery || '--'}%</span>
                            <span className="stat-label">Battery</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-value">{lastSeenText}</span>
                            <span className="stat-label">Last Update</span>
                        </div>
                    </div>

                    <div className="shared-tracker-footer">
                        Powered by <a href="/" target="_blank" rel="noopener noreferrer">SafeBox Fleet</a>
                    </div>
                </div>
            </div>
        </div>
    );
}
