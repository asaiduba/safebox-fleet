const API_BASE = import.meta.env.VITE_API_URL || '';
import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import io from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, Circle, Polygon, Polyline, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import './App.css';
import Auth from './Auth';
import LandingPage from './LandingPage';
import HistoryDrawer from './HistoryDrawer';
import AddVehicleModal from './AddVehicleModal';
import NotificationsPanel from './NotificationsPanel';
import SharedTracker from './SharedTracker';

// Lazy load heavy overlays/sub-dashboards
const AnalyticsDashboard = lazy(() => import('./AnalyticsDashboard'));
const SettingsPanel = lazy(() => import('./SettingsPanel'));
const ReportsPanel = lazy(() => import('./ReportsPanel'));
const SupportDashboard = lazy(() => import('./SupportDashboard'));
const AdminDashboard = lazy(() => import('./AdminDashboard'));

const LoadingOverlay = ({ message = "Loading component..." }) => (
    <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        background: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 9999,
        color: 'white',
        fontFamily: 'system-ui, sans-serif'
    }}>
        <div style={{
            width: '50px',
            height: '50px',
            border: '3px solid rgba(255, 255, 255, 0.1)',
            borderTop: '3px solid #3b82f6',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            marginBottom: '1.25rem'
        }} />
        <h2 style={{ fontSize: '1.2rem', fontWeight: '600', letterSpacing: '0.02em', margin: 0 }}>{message}</h2>
        <style>{`
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `}</style>
    </div>
);
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import {
    TrendingUpIcon,
    SettingsIcon,
    BellIcon,
    PlusIcon,
    LockIcon,
    UnlockIcon,
    PowerIcon,
    ZapIcon,
    UserIcon,
    BatteryIcon,
    FuelIcon,
    MapPinIcon,
    ShareIcon,
    HistoryIcon,
    TrashIcon,
    LogOutIcon,
    ShieldIcon,
    XIcon,
    CheckIcon,
    InfoIcon,
    AlertTriangleIcon
} from './settings/Icons';

// Fix Leaflet default icon issue
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
});

// Helper component for map tile loading states
function MapTileLoader({ onStart, onEnd }) {
    const map = useMap();
    React.useEffect(() => {
        if (!map) return;

        let activeTiles = 0;

        const handleStart = () => {
            if (activeTiles === 0) onStart();
            activeTiles++;
        };

        const handleEnd = () => {
            activeTiles = Math.max(0, activeTiles - 1);
            if (activeTiles === 0) onEnd();
        };

        map.on('tileloadstart', handleStart);
        map.on('tileload', handleEnd);
        map.on('tileunload', handleEnd);
        map.on('load', onEnd);

        const timeout = setTimeout(() => {
            onEnd();
        }, 5000);

        return () => {
            map.off('tileloadstart', handleStart);
            map.off('tileload', handleEnd);
            map.off('tileunload', handleEnd);
            map.off('load', onEnd);
            clearTimeout(timeout);
        };
    }, [map, onStart, onEnd]);

    return null;
}

// Helper component for map click events
function MapClickHandler({ onClick }) {
    useMapEvents({
        click: onClick,
    });
    return null;
}

let socket = null;

const defaultCenter = {
    lat: -1.9441,
    lng: 30.0619
};

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

const getVehicleEmoji = (type) => {
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

function App() {
    // Initialize user from localStorage if available
    const [user, setUser] = useState(() => {
        const savedUser = localStorage.getItem('user');
        return savedUser ? JSON.parse(savedUser) : null;
    });

    const [vehicles, setVehicles] = useState(() => {
        try {
            const savedUser = localStorage.getItem('user');
            if (savedUser) {
                const u = JSON.parse(savedUser);
                const cached = localStorage.getItem(`cached_vehicles_${u.id}`);
                return cached ? JSON.parse(cached) : [];
            }
        } catch (_) {}
        return [];
    });
    const [selectedVehicleId, setSelectedVehicleId] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState('all');
    const [showAddVehicle, setShowAddVehicle] = useState(false);
    const [showAuth, setShowAuth] = useState(false);
    const [showLanding, setShowLanding] = useState(!user);
    const [isSupportRoute, setIsSupportRoute] = useState(window.location.pathname === '/support');
    const [isAdminRoute, setIsAdminRoute] = useState(window.location.pathname === '/admin');

    // Live Location Sharing: detect /track/:token route
    const [sharedTrackToken] = useState(() => {
        const path = window.location.pathname;
        if (path.startsWith('/track/')) {
            return path.split('/track/')[1];
        }
        return null;
    });
    const [showShareModal, setShowShareModal] = useState(false);
    const [shareTargetVehicle, setShareTargetVehicle] = useState(null);

    useEffect(() => {
        const handlePopState = () => {
            setIsSupportRoute(window.location.pathname === '/support');
            setIsAdminRoute(window.location.pathname === '/admin');
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    // Secure Super Admin path access
    useEffect(() => {
        if (isAdminRoute) {
            if (!user || user.role !== 'admin') {
                // Not authorized: redirect to root and show auth gate
                window.history.pushState({}, '', '/');
                setIsAdminRoute(false);
                setShowLanding(true);
                setShowAuth(true);
            }
        }
    }, [isAdminRoute, user]);

    const [showAnalytics, setShowAnalytics] = useState(false);
    const [showReports, setShowReports] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [showNotifications, setShowNotifications] = useState(false);
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const [notifications, setNotifications] = useState(() => {
        const savedUser = localStorage.getItem('user');
        if (savedUser) {
            try {
                const u = JSON.parse(savedUser);
                const saved = localStorage.getItem(`notifications_${u.id}`);
                return saved ? JSON.parse(saved) : [];
            } catch (e) {
                return [];
            }
        }
        return [];
    });
    const [tracePath, setTracePath] = useState([]);
    const [playIndex, setPlayIndex] = useState(-1);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const [playbackPath, setPlaybackPath] = useState([]);
    const playIntervalRef = useRef(null);
    const [geofences, setGeofences] = useState([]);
    const [geofenceMode, setGeofenceMode] = useState(false);
    const [newGeofenceRadius, setNewGeofenceRadius] = useState(500); // Default 500m
    const [geofenceType, setGeofenceType] = useState('circle'); // 'circle' or 'polygon'
    const [polygonPoints, setPolygonPoints] = useState([]);
    const [alerts, setAlerts] = useState([]);
    const [sandboxData, setSandboxData] = useState(null);
    const [pendingOverrides, setPendingOverrides] = useState([]);
    const [socketConnected, setSocketConnected] = useState(true);
    const [theme, setTheme] = useState(() => {
        return localStorage.getItem('theme') || 'dark';
    });

    useEffect(() => {
        document.body.classList.toggle('light-theme', theme === 'light');
        localStorage.setItem('theme', theme);
    }, [theme]);

    const toggleTheme = useCallback(() => {
        setTheme(prev => prev === 'dark' ? 'light' : 'dark');
    }, []);
    const mapRef = useRef(null);

    // Vehicle Groups state
    const [groups, setGroups] = useState(() => {
        try {
            const savedUser = localStorage.getItem('user');
            if (savedUser) {
                const u = JSON.parse(savedUser);
                const cached = localStorage.getItem(`cached_groups_${u.id}`);
                return cached ? JSON.parse(cached) : [];
            }
        } catch (_) {}
        return [];
    });

    const [isAppOffline, setIsAppOffline] = useState(!navigator.onLine);
    const [activeGroupFilter, setActiveGroupFilter] = useState('all'); // 'all' or group id

    // Map tile loading state
    const [mapTilesLoading, setMapTilesLoading] = useState(true);
    const handleMapTileStart = useCallback(() => setMapTilesLoading(true), []);
    const handleMapTileEnd = useCallback(() => setMapTilesLoading(false), []);

    // Toast notifications state
    const [toasts, setToasts] = useState([]);

    const addToast = useCallback((message, type = 'info') => {
        const id = Date.now() + Math.random();
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 4000);
    }, []);

    useEffect(() => {
        const handleToastEvent = (e) => {
            if (e.detail && e.detail.message) {
                addToast(e.detail.message, e.detail.type || 'info');
            }
        };
        window.addEventListener('show-toast', handleToastEvent);
        window.showToast = (message, type = 'info') => {
            window.dispatchEvent(new CustomEvent('show-toast', { detail: { message, type } }));
        };
        return () => {
            window.removeEventListener('show-toast', handleToastEvent);
            delete window.showToast;
        };
    }, [addToast]);

    // Derive selected vehicle from vehicles array
    const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId) || null;

    // Derive filtered vehicles by active group
    const filteredVehicles = activeGroupFilter === 'all'
        ? vehicles
        : vehicles.filter(v => v.group_id === activeGroupFilter);

    // Leaflet doesn't need API loading

    // Helper to check if device is online (seen in last 60 seconds)
    const isOnline = (lastUpdate) => {
        if (!lastUpdate) return false;
        const diff = new Date() - new Date(lastUpdate);
        return diff < 300000; // 5 minutes
    };

    // Helper to format last seen timestamp cleanly
    const formatLastSeen = (lastUpdate) => {
        if (!lastUpdate) return 'Never';
        const diffMs = new Date() - new Date(lastUpdate);
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        return new Date(lastUpdate).toLocaleString();
    };

    // Helper to fetch, logout, login, resolve override, and delete vehicles
    const fetchGeofences = useCallback(async (vehicleId) => {
        try {
            const res = await axios.get(`${API_BASE}/api/geofences?vehicleId=${vehicleId}`);
            setGeofences(res.data);
        } catch (err) {
            console.error("Failed to fetch geofences", err);
        }
    }, []);

    const fetchVehicles = useCallback(async () => {
        try {
            const res = await axios.get(`${API_BASE}/api/vehicles?userId=${user.id}&role=${user.role}`);
            const mapped = res.data.map(v => ({
                ...v,
                lat: v.lat || -1.9441,
                lng: v.lng || 30.0619,
                locked: v.is_locked === 1,
                cloudLocked: v.cloud_locked === 1,
                battery: v.battery_level || 100,
                fuel: v.fuel_level || 100,
                subscription_status: v.subscription_status || 'ACTIVE',
                grace_period_expires: v.grace_period_expires || null,
                next_billing_date: v.next_billing_date || null,
                lastUpdate: v.last_seen ? new Date(v.last_seen) : null,
                // Persist the last known beacon state from the DB so the BLE card
                // shows signal immediately on load without waiting for a Socket.IO packet.
                beaconRssi: v.beacon_rssi ?? v.beaconRssi ?? null,
                driverPresent: v.driver_present !== undefined ? v.driver_present !== 0 : true
            }));
            setVehicles(mapped);
            localStorage.setItem(`cached_vehicles_${user.id}`, JSON.stringify(mapped));
        } catch (err) {
            console.error("Failed to fetch vehicles", err);
            const cached = localStorage.getItem(`cached_vehicles_${user.id}`);
            if (cached) {
                setVehicles(JSON.parse(cached));
                window.showToast?.("Offline Mode: Displaying cached vehicle coordinates.", "warning");
            }
        }
    }, [user]);

    const fetchGroups = useCallback(async () => {
        if (!user) return;
        try {
            const res = await axios.get(`${API_BASE}/api/groups`);
            setGroups(res.data);
            localStorage.setItem(`cached_groups_${user.id}`, JSON.stringify(res.data));
        } catch (err) {
            console.error("Failed to fetch groups", err);
            const cached = localStorage.getItem(`cached_groups_${user.id}`);
            if (cached) {
                setGroups(JSON.parse(cached));
            }
        }
    }, [user]);

    const fetchPendingOverrides = useCallback(async () => {
        if (!user || user.role !== 'company') return;
        try {
            const res = await axios.get(`${API_BASE}/api/override/pending`);
            setPendingOverrides(res.data);
        } catch (err) {
            console.error("Failed to fetch pending overrides", err);
        }
    }, [user]);

    useEffect(() => {
        const goOnline = () => {
            setIsAppOffline(false);
            window.showToast?.("Network connection restored. Syncing fleet status...", "success");
            fetchVehicles();
            fetchGroups();
        };
        const goOffline = () => {
            setIsAppOffline(true);
            window.showToast?.("Working offline. Showing cached fleet coordinates.", "warning");
        };
        window.addEventListener('online', goOnline);
        window.addEventListener('offline', goOffline);
        return () => {
            window.removeEventListener('online', goOnline);
            window.removeEventListener('offline', goOffline);
        };
    }, [fetchVehicles, fetchGroups]);

    const handleResolveOverride = useCallback(async (requestId, status) => {
        try {
            await axios.post(`${API_BASE}/api/override/resolve`, { requestId, status });
            setPendingOverrides(prev => prev.filter(r => r.id !== requestId));
            fetchVehicles();
        } catch (err) {
            window.showToast(err.response?.data?.error || 'Failed to resolve override request', 'error');
        }
    }, [fetchVehicles]);

    const handleDeleteVehicle = useCallback(async (vehicleId) => {
        if (!confirm('Are you sure you want to remove this vehicle?')) return;
        try {
            await axios.delete(`${API_BASE}/api/vehicles/${vehicleId}`);
            fetchVehicles();
            if (selectedVehicleId === vehicleId) setSelectedVehicleId(null);
        } catch (err) {
            console.error('Failed to delete vehicle', err);
            window.showToast('Failed to delete vehicle', 'error');
        }
    }, [fetchVehicles, selectedVehicleId]);

    const handleLogin = useCallback((userData) => {
        localStorage.setItem('user', JSON.stringify(userData));
        setUser(userData);
        const saved = localStorage.getItem(`notifications_${userData.id}`);
        setNotifications(saved ? JSON.parse(saved) : []);
        setShowLanding(false);
        if (userData.role === 'admin') {
            window.history.pushState({}, '', '/admin');
            setIsAdminRoute(true);
        }
    }, []);

    const handleImpersonate = useCallback((tenant) => {
        const adminSession = {
            id: user.id,
            username: user.username,
            role: user.role,
            token: user.token
        };
        localStorage.setItem('admin_session', JSON.stringify(adminSession));

        const impersonatedUser = {
            id: tenant.id,
            username: tenant.username,
            role: 'company',
            company_name: tenant.company_name,
            token: user.token,
            impersonating: true
        };
        localStorage.setItem('user', JSON.stringify(impersonatedUser));
        setUser(impersonatedUser);

        window.history.pushState({}, '', '/');
        setIsAdminRoute(false);
        setShowLanding(false);
        setShowAnalytics(false);
        setShowReports(false);
        setShowSettings(false);
        setSelectedVehicleId(null);
        setNotifications([]);
    }, [user]);

    const handleStopImpersonation = useCallback(() => {
        const adminSessionStr = localStorage.getItem('admin_session');
        if (adminSessionStr) {
            const adminSession = JSON.parse(adminSessionStr);
            localStorage.setItem('user', JSON.stringify(adminSession));
            localStorage.removeItem('admin_session');
            setUser(adminSession);

            window.history.pushState({}, '', '/admin');
            setIsAdminRoute(true);
            setShowLanding(false);
        }
    }, []);

    const handleLogout = useCallback(() => {
        localStorage.removeItem('user');
        localStorage.removeItem('admin_session');
        setUser(null);
        setVehicles([]);
        setNotifications([]);
        setShowLanding(true);
        setShowAnalytics(false);
        window.history.pushState({}, '', '/');
        setIsAdminRoute(false);
    }, []);

    const triggerBrowserNotification = useCallback((title, body) => {
        if (!("Notification" in window)) return;
        if (Notification.permission === "granted") {
            try {
                new Notification(title, {
                    body,
                    icon: '/logo.png'
                });
            } catch (err) {
                console.error("Failed to show browser notification:", err);
            }
        }
    }, []);

    useEffect(() => {
        if (user && "Notification" in window && Notification.permission === "default") {
            Notification.requestPermission().then(permission => {
                console.log("Notification permission state:", permission);
            });
        }
    }, [user]);

    const handleVehicleSelect = useCallback((vehicle) => {
        setSelectedVehicleId(vehicle.id);
        setMobileSidebarOpen(false);
    }, []);

    const sendCommand = useCallback((deviceId, command) => {
        if (socket) {
            socket.emit('send-command', { deviceId, command });
        }
        setVehicles(prev => prev.map(v =>
            v.id === deviceId ? {
                ...v,
                cloudLocked: command === 'LOCK',
                locked: command === 'LOCK' ? true : v.locked
            } : v
        ));
    }, []);

    const handleDeleteGeofence = useCallback(async (id) => {
        const previousGeofences = [...geofences];
        setGeofences(prev => prev.filter(g => g.id !== id));
        try {
            await axios.delete(`${API_BASE}/api/geofences/${id}`);
        } catch (err) {
            console.error('Failed to delete geofence', err);
            window.showToast('Failed to delete geofence', 'error');
            setGeofences(previousGeofences);
        }
    }, [geofences]);

    // Force re-render every 5 seconds to update online/offline status
    const [, setTick] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => setTick(t => t + 1), 5000);
        return () => clearInterval(timer);
    }, []);

    // Persist notifications list to localStorage (namespaced by user.id)
    const lastSavedUserRef = useRef(user?.id);
    useEffect(() => {
        if (user) {
            if (lastSavedUserRef.current === user.id) {
                localStorage.setItem(`notifications_${user.id}`, JSON.stringify(notifications));
            } else {
                lastSavedUserRef.current = user.id;
            }
        } else {
            lastSavedUserRef.current = null;
        }
    }, [notifications, user]);

    // Advanced state-driven playback timer loop
    useEffect(() => {
        if (!isPlaying || playIndex === -1 || playbackPath.length === 0) {
            if (playIntervalRef.current) clearInterval(playIntervalRef.current);
            return;
        }

        // Base step interval: 800ms
        // Speeds: 1x = 800ms, 2x = 400ms, 4x = 200ms, 8x = 100ms
        const baseInterval = 800;
        const intervalTime = Math.max(50, baseInterval / playbackSpeed);

        playIntervalRef.current = setInterval(() => {
            setPlayIndex(prev => {
                if (prev >= playbackPath.length - 1) {
                    setIsPlaying(false);
                    clearInterval(playIntervalRef.current);
                    return prev;
                }
                const nextIdx = prev + 1;
                const nextPoint = playbackPath[nextIdx];
                if (nextPoint && mapRef.current) {
                    mapRef.current.setView([nextPoint.lat, nextPoint.lng]);
                }
                return nextIdx;
            });
        }, intervalTime);

        return () => {
            if (playIntervalRef.current) clearInterval(playIntervalRef.current);
        };
    }, [isPlaying, playbackSpeed, playbackPath, playIndex]);

    // Animate route playback playhead (Starts playback)
    const handlePlayStart = (path) => {
        if (!path || path.length < 2) return;
        setPlaybackPath(path);
        setPlayIndex(0);
        setIsPlaying(true);
        setPlaybackSpeed(1); // Reset to 1x
        if (mapRef.current && path[0]) {
            mapRef.current.setView([path[0].lat, path[0].lng]);
        }
    };

    // Notification Handlers
    const handleMarkRead = (id) => {
        setNotifications(prev =>
            prev.map(n => n.id === id ? { ...n, is_read: true } : n)
        );
    };

    const handleMarkAllRead = () => {
        setNotifications(prev =>
            prev.map(n => ({ ...n, is_read: true }))
        );
    };

    const handleExportAlerts = async () => {
        try {
            const token = localStorage.getItem('token');
            const response = await axios.get(`${API_BASE}/api/exports/alerts`, {
                headers: {
                    Authorization: `Bearer ${token}`
                },
                responseType: 'blob'
            });

            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `alerts_${Date.now()}.csv`);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (err) {
            console.error("Failed to export alerts CSV", err);
            window.showToast("Failed to export alerts CSV", "error");
        }
    };

    // Clean up playback timers on unmount, vehicle toggle, or history drawer close
    useEffect(() => {
        return () => {
            if (playIntervalRef.current) clearInterval(playIntervalRef.current);
        };
    }, [selectedVehicleId, showHistory]);

    // Pan to selected vehicle (Leaflet)
    useEffect(() => {
        if (selectedVehicle && mapRef.current) {
            mapRef.current.setView([selectedVehicle.lat, selectedVehicle.lng], 16);
        }
    }, [selectedVehicleId, selectedVehicle]);

    // Paystack Sandbox & Production Checkout Callback Handler
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        // Paystack redirects back with 'reference' parameter. Mock checkout uses 'ref'.
        const reference = params.get('reference') || params.get('ref');

        if (reference) {
            if (!user) {
                console.log('Payment reference detected, but user session is not initialized. Postponing verification...');
                return;
            }

            const isMock = reference.startsWith('ref_mock_') || params.get('mock_checkout') === 'true';

            if (isMock) {
                // Sandbox Mode
                const userId = params.get('userId');
                const vehiclesList = params.get('vehicles');
                const cycle = params.get('cycle') || 'monthly';

                Promise.resolve().then(() => {
                    setSandboxData({
                        reference,
                        userId,
                        vehicles: vehiclesList,
                        cycle
                    });
                });
            } else {
                // Real Production/Test Paystack Mode (Server-to-Server Handoff Verification)
                axios.get(`${API_BASE}/api/payments/verify/${reference}`)
                    .then(() => {
                        window.showToast('Paystack Checkout Verified! Your fleet subscription has been successfully activated.', 'success');
                        fetchVehicles();
                        window.history.replaceState({}, document.title, "/"); // Clean URL parameters
                    })
                    .catch(err => {
                        console.error('Real Paystack verification failed:', err);
                        window.showToast('Failed to verify payment transaction with Paystack.', 'error');
                    });
            }
        }
    }, [user, fetchVehicles]);

    useEffect(() => {
        if (!user) {
            if (socket) {
                socket.disconnect();
                socket = null;
            }
            return;
        }

        if (socket) {
            socket.disconnect();
        }

        socket = io(API_BASE, {
            auth: { token: user.token }
        });

        socket.connect();

        Promise.resolve().then(() => {
            fetchVehicles();
            fetchGroups();
            if (user.role === 'company') {
                fetchPendingOverrides();
            }
        });

        socket.on('connect', () => {
            console.log('Connected to backend');
            setSocketConnected(true);
        });

        socket.on('disconnect', () => {
            console.log('Disconnected from backend');
            setSocketConnected(false);
        });

        socket.on('connect_error', (err) => {
            console.error('Socket connection error:', err.message);
            setSocketConnected(false);
            if (err.message.includes('Authentication error')) {
                handleLogout();
            }
        });

        socket.on('device-data', (data) => {
            setVehicles(prev => {
                const index = prev.findIndex(v => v.id === data.payload.deviceId);
                if (index > -1) {
                    const newVehicles = [...prev];
                    // Preserve cloudLocked unless it is explicitly sent in the socket payload (e.g. from lock/unlock commands)
                    const { cloudLocked, ...telemetry } = data.payload;
                    const existingVehicle = newVehicles[index];
                    const updatedCloudLocked = cloudLocked !== undefined ? cloudLocked : existingVehicle.cloudLocked;

                    // Preserve beaconRssi and driverPresent — most telemetry packets have NO beacon
                    // data and carry beaconRssi=null. We must not let those null values erase a
                    // valid signal that arrived in a recent beacon-bearing packet.
                    if (telemetry.beaconRssi === null || telemetry.beaconRssi === undefined) {
                        delete telemetry.beaconRssi;
                    }
                    if (telemetry.driverPresent === null || telemetry.driverPresent === undefined) {
                        delete telemetry.driverPresent;
                    }

                    newVehicles[index] = {
                        ...existingVehicle,
                        ...telemetry,
                        cloudLocked: updatedCloudLocked,
                        lastUpdate: new Date()
                    };
                    return newVehicles;
                }
                return prev;
            });
        });

        socket.on('geofence-alert', (data) => {
            setAlerts(prev => [...prev, data]);
            setTimeout(() => {
                setAlerts(prev => prev.filter(a => a !== data));
            }, 5000);
        });

        socket.on('notification', (data) => {
            setNotifications(prev => [data, ...prev]);

            // Trigger browser push notification based on user preferences
            let prefs = { batteryAlert: true, fuelAlert: true, geofenceAlert: true };
            try {
                const saved = localStorage.getItem(`settings_${user.id}`);
                if (saved) prefs = JSON.parse(saved);
            } catch (_) {}

            let shouldAlert = false;
            if (data.type === 'BATTERY' && prefs.batteryAlert) shouldAlert = true;
            if ((data.type === 'FUEL' || data.type === 'FUEL_THEFT') && prefs.fuelAlert) shouldAlert = true;
            if (data.type === 'GEOFENCE' && prefs.geofenceAlert) shouldAlert = true;

            if (shouldAlert) {
                triggerBrowserNotification(`SafeBox Alert - ${data.type}`, data.message);
            }
        });

        socket.on('device-tampering', (data) => {
            const newNotif = {
                id: Date.now() + Math.random(),
                type: 'TAMPERING',
                message: data.message || `Critical: Device tampering detected!`,
                timestamp: data.timestamp || Date.now(),
                is_read: false
            };
            setAlerts(prev => [...prev, { vehicleId: data.vehicleId, message: newNotif.message, timestamp: newNotif.timestamp }]);
            setTimeout(() => {
                setAlerts(prev => prev.filter(a => a.message !== newNotif.message));
            }, 5000);
        });

        socket.on('device-alert', (data) => {
            setAlerts(prev => [...prev, { vehicleId: data.vehicleId, message: data.message, timestamp: data.timestamp }]);
            setTimeout(() => {
                setAlerts(prev => prev.filter(a => a.message !== data.message));
            }, 5000);
        });

        socket.on('billing-updated', (data) => {
            console.log('Billing status updated:', data);
            fetchVehicles(); // Refetch vehicles to apply active/suspended billing status
        });

        socket.on('sync-data', (data) => {
            console.log('[Socket] Sync request received:', data);
            if (data.type === 'vehicles' || data.type === 'profile' || data.type === 'settings') {
                fetchVehicles();
            } else if (data.type === 'groups') {
                fetchGroups();
            } else if (data.type === 'geofences') {
                fetchVehicles();
                if (selectedVehicleId) {
                    fetchGeofences(selectedVehicleId);
                }
            }
        });

        socket.on('override-request', (data) => {
            setPendingOverrides(prev => {
                if (prev.some(r => r.id === data.id)) return prev;
                return [...prev, data];
            });
        });

        socket.on('override-resolved', (data) => {
            setPendingOverrides(prev => prev.filter(r => r.id !== data.requestId));
            fetchVehicles();
        });

        return () => {
            if (socket) {
                socket.off('connect');
                socket.off('connect_error');
                socket.off('device-data');
                socket.off('geofence-alert');
                socket.off('notification');
                socket.off('device-tampering');
                socket.off('device-alert');
                socket.off('billing-updated');
                socket.off('sync-data');
                socket.off('override-request');
                socket.off('override-resolved');
                socket.disconnect();
                socket = null;
            }
        };
    }, [user, fetchVehicles, fetchGroups, fetchPendingOverrides, handleLogout]);

    useEffect(() => {
        if (selectedVehicleId) {
            Promise.resolve().then(() => {
                fetchGeofences(selectedVehicleId);
            });
        } else {
            Promise.resolve().then(() => {
                setGeofences([]);
                setGeofenceMode(false);
            });
        }
    }, [selectedVehicleId, fetchGeofences]);

    // Deleted duplicate helpers to avoid TDZ and unused functions



    // Public shared tracking page — bypass all auth and dashboard rendering
    if (sharedTrackToken) {
        return <SharedTracker token={sharedTrackToken} />;
    }

    if (isAdminRoute && user && user.role === 'admin') {
        return (
            <ErrorBoundary>
                <Suspense fallback={<LoadingOverlay message="Loading Admin Dashboard..." />}>
                    <AdminDashboard
                        user={user}
                        onLogout={handleLogout}
                        onBackToClient={() => {
                            window.history.pushState({}, '', '/');
                            setIsAdminRoute(false);
                        }}
                        onImpersonate={handleImpersonate}
                    />
                </Suspense>
            </ErrorBoundary>
        );
    }

    if (isSupportRoute) {
        return (
            <ErrorBoundary>
                <Suspense fallback={<LoadingOverlay message="Loading Support Panel..." />}>
                    <SupportDashboard
                        onBack={() => {
                            window.history.pushState({}, '', '/');
                            setIsSupportRoute(false);
                        }}
                    />
                </Suspense>
            </ErrorBoundary>
        );
    }

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
            {user && showAnalytics && user.subscription_status !== 'SUSPENDED' && (
                <Suspense fallback={<LoadingOverlay message="Loading Analytics Engine..." />}>
                    <AnalyticsDashboard
                        onBack={() => setShowAnalytics(false)}
                        onOpenReports={() => setShowReports(true)}
                    />
                </Suspense>
            )}

            {/* Settings Overlay */}
            {user && showSettings && (
                <Suspense fallback={<LoadingOverlay message="Loading Settings Panels..." />}>
                    <SettingsPanel
                        user={user}
                        vehicles={vehicles}
                        groups={groups}
                        onGroupsChanged={fetchGroups}
                        onBack={() => setShowSettings(false)}
                        onProfileUpdate={(updatedUser) => {
                            setUser(updatedUser);
                            localStorage.setItem('user', JSON.stringify(updatedUser));
                        }}
                        onLogout={handleLogout}
                        theme={theme}
                        onThemeToggle={toggleTheme}
                    />
                </Suspense>
            )}

            {/* Reports Overlay */}
            {user && showReports && user.subscription_status !== 'SUSPENDED' && (
                <Suspense fallback={<LoadingOverlay message="Loading Reports Center..." />}>
                    <ReportsPanel
                        vehicles={vehicles}
                        onClose={() => setShowReports(false)}
                    />
                </Suspense>
            )}



            {/* History Overlay */}
            {user && showHistory && selectedVehicle && (
                <HistoryDrawer
                    vehicle={selectedVehicle}
                    onClose={() => {
                        setShowHistory(false);
                        setTracePath([]);
                        setPlayIndex(-1);
                    }}
                    onTraceUpdate={(path) => setTracePath(path)}
                    onPlayStart={handlePlayStart}
                />
            )}

            {/* Add Vehicle Overlay Card Modal */}
            {user && showAddVehicle && (
                <AddVehicleModal
                    user={user}
                    groups={groups}
                    onClose={() => setShowAddVehicle(false)}
                    onVehicleAdded={fetchVehicles}
                />
            )}

            {/* Sandbox Checkout Simulator Modal Overlay */}
            {sandboxData && (
                <div className="sandbox-modal-overlay">
                    <div className="sandbox-modal-container">
                        <div className="sandbox-modal-header">
                            <h2>💳 SafeBox Payment Gateway (Sandbox)</h2>
                            <span className="sandbox-badge">SIMULATOR</span>
                        </div>
                        <div className="sandbox-modal-body">
                            <p className="sandbox-desc">
                                You have been redirected to the SafeBox test sandbox environment. Please review your transaction details below:
                            </p>

                            <div className="sandbox-details-card">
                                <div className="detail-row">
                                    <span className="detail-label">Reference ID</span>
                                    <span className="detail-value text-mono">{sandboxData.reference}</span>
                                </div>
                                <div className="detail-row">
                                    <span className="detail-label">Billing Cycle</span>
                                    <span className="detail-value text-capitalize">{sandboxData.cycle}</span>
                                </div>
                                <div className="detail-row">
                                    <span className="detail-label">Vehicles to Renew</span>
                                    <span className="detail-value">{sandboxData.vehicles}</span>
                                </div>
                                <div className="detail-row">
                                    <span className="detail-label">Total Amount</span>
                                    <span className="detail-value highlight-currency">
                                        ₦{(sandboxData.vehicles.split(',').length * (sandboxData.cycle === 'annual' ? 30000 : 3000)).toLocaleString()}/period
                                    </span>
                                </div>
                            </div>

                            <p className="sandbox-warning">
                                ⚠️ This is a simulated checkout screen. No real money is processed. Select one of the outcomes below to verify your system's billing flow.
                            </p>
                        </div>

                        <div className="sandbox-modal-actions">
                            <button
                                className="sandbox-btn-success"
                                onClick={async () => {
                                    try {
                                        await axios.get(`${API_BASE}/api/payments/verify/${sandboxData.reference}?userId=${sandboxData.userId}&vehicles=${sandboxData.vehicles}&cycle=${sandboxData.cycle}`);
                                        window.showToast('Secure Sandbox Checkout Complete! Your fleet subscription has been activated.', 'success');
                                        fetchVehicles();
                                        setSandboxData(null);
                                        window.history.replaceState({}, document.title, "/"); // Clean URL parameters
                                    } catch (err) {
                                        console.error('Mock verification failed:', err);
                                        window.showToast('Failed to verify payment reference', 'error');
                                    }
                                }}
                            >
                                Simulate Successful Payment
                            </button>
                            <button
                                className="sandbox-btn-failed"
                                onClick={() => {
                                    window.showToast('Sandbox Checkout: Payment simulation failed or was declined. Subscription not activated.', 'error');
                                    setSandboxData(null);
                                    window.history.replaceState({}, document.title, "/"); // Clean URL parameters
                                }}
                            >
                                Simulate Failed Payment
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Dashboard */}
            {user && !showLanding && !showAnalytics && (
                <div className={`app-container ${user.impersonating ? 'impersonating-active' : ''}`}>
                    <style>{`
                        @keyframes sb-pulse {
                            0% { opacity: 0.3; }
                            50% { opacity: 1; }
                            100% { opacity: 0.3; }
                        }
                    `}</style>
                    {!socketConnected && (
                        <div style={{
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            right: 0,
                            backgroundColor: 'rgba(239, 68, 68, 0.93)',
                            backdropFilter: 'blur(4px)',
                            color: 'white',
                            padding: '0.6rem 1rem',
                            textAlign: 'center',
                            fontWeight: 'bold',
                            fontSize: '0.85rem',
                            zIndex: 99999,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.6rem',
                            boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
                            letterSpacing: '0.025em'
                        }}>
                            <span style={{
                                display: 'inline-block',
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                backgroundColor: 'white',
                                animation: 'sb-pulse 1.2s infinite ease-in-out'
                            }} />
                            Connection lost. Attempting to reconnect to live telemetry engine...
                        </div>
                    )}
                    {user.impersonating && (
                        <div className="impersonation-warning-banner">
                            <div className="banner-text">
                                <span className="banner-icon">🕵️</span>
                                <span>Impersonating <strong>{user.company_name || user.username}</strong> (ID: {user.id})</span>
                            </div>
                            <button className="banner-stop-btn" onClick={handleStopImpersonation}>
                                Return to Super Admin Console
                            </button>
                        </div>
                    )}
                    {vehicles.filter(v => v.subscription_status === 'GRACE_PERIOD').length > 0 && (
                        <div
                            className="grace-period-banner"
                            onClick={() => setShowSettings(true)}
                        >
                            ⚠️ ACTION REQUIRED: Automated monthly billing failed for {vehicles.filter(v => v.subscription_status === 'GRACE_PERIOD').length} of your vehicles. They are in a 5-day Grace Period. Click here to open the Billing Manager.
                        </div>
                    )}

                    {/* Alerts Container */}
                    <div className="alerts-container">
                        {alerts.map((alert, idx) => (
                            <div key={idx} className="alert-toast">
                                🚨 {alert.message}
                            </div>
                        ))}
                    </div>

                    {/* Override Requests Queue */}
                    {pendingOverrides.length > 0 && (
                        <div className="override-requests-queue">
                            <div className="queue-header">
                                <h3>🔑 Start Overrides Pending ({pendingOverrides.length})</h3>
                            </div>
                            <div className="queue-list">
                                {pendingOverrides.map(req => (
                                    <div key={req.id} className="override-request-card">
                                        <div className="request-meta">
                                            <div className="req-vehicle">🚗 <strong>{req.vehicle_name}</strong> ({req.vehicle_id})</div>
                                            <div className="req-driver">👤 Driver: {req.driver_name}</div>
                                            <div className="req-time">🕒 Requested: {new Date(req.requested_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                        </div>
                                        <div className="override-actions">
                                            <button
                                                className="btn-approve-once"
                                                onClick={() => handleResolveOverride(req.id, 'APPROVED_ONCE')}
                                            >
                                                Approve Once
                                            </button>
                                            <button
                                                className="btn-approve-midnight"
                                                onClick={() => handleResolveOverride(req.id, 'APPROVED_MIDNIGHT')}
                                            >
                                                Until Midnight
                                            </button>
                                            <button
                                                className="btn-deny"
                                                onClick={() => handleResolveOverride(req.id, 'DENIED')}
                                            >
                                                Deny
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Header */}
                    <header className="app-header">
                        <button
                            className={`mobile-sidebar-toggle-btn ${mobileSidebarOpen ? 'open' : ''}`}
                            onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
                        >
                            ☰ Fleet
                        </button>
                        <div className="header-left" onClick={() => setShowLanding(true)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <img src="/logo.png" alt="SafeBox Logo" className="header-logo" />
                            <h1 style={{ margin: 0 }}>SafeBox Fleet</h1>
                            <div
                                style={{
                                    width: '10px',
                                    height: '10px',
                                    borderRadius: '50%',
                                    backgroundColor: (socketConnected && !isAppOffline) ? '#10b981' : '#ef4444',
                                    boxShadow: (socketConnected && !isAppOffline) ? '0 0 8px #10b981' : '0 0 8px #ef4444',
                                    transition: 'all 0.3s ease',
                                    marginLeft: '0.25rem'
                                }}
                                title={(socketConnected && !isAppOffline) ? "Telemetry stream: Connected" : "Telemetry stream: Offline"}
                            />
                            {isAppOffline && (
                                <span style={{
                                    fontSize: '0.65rem',
                                    background: 'rgba(239, 68, 68, 0.2)',
                                    color: '#ef4444',
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    border: '1px solid rgba(239, 68, 68, 0.4)',
                                    fontWeight: 'bold',
                                    letterSpacing: '0.05em'
                                }}>
                                    OFFLINE
                                </span>
                            )}
                        </div>
                        <div className="user-info">
                            {user.role === 'company' && user.subscription_status !== 'SUSPENDED' && (
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
                                        gap: '0.4rem'
                                    }}
                                >
                                    <TrendingUpIcon size={16} /> <span className="btn-text">Analytics</span>
                                </button>
                            )}

                            <button
                                className="notifications-bell-btn"
                                onClick={() => setShowNotifications(!showNotifications)}
                                style={{
                                    marginRight: '1rem',
                                    background: 'linear-gradient(135deg, #1e293b, #0f172a)',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    padding: '0.5rem',
                                    borderRadius: '0.5rem',
                                    color: 'white',
                                    cursor: 'pointer',
                                    position: 'relative',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '38px',
                                    height: '38px'
                                }}
                                title="Notifications"
                            >
                                <BellIcon size={18} />
                                {notifications.filter(n => !n.is_read).length > 0 && (
                                    <span
                                        style={{
                                            position: 'absolute',
                                            top: '-4px',
                                            right: '-4px',
                                            background: '#ef4444',
                                            color: 'white',
                                            borderRadius: '50%',
                                            padding: '0.1rem 0.35rem',
                                            fontSize: '0.65rem',
                                            fontWeight: 'bold',
                                            border: '2px solid #0f172a',
                                            boxShadow: '0 0 8px rgba(239, 68, 68, 0.6)'
                                        }}
                                    >
                                        {notifications.filter(n => !n.is_read).length}
                                    </span>
                                )}
                            </button>
                            <button
                                className="settings-btn"
                                onClick={() => setShowSettings(true)}
                                style={{
                                    marginRight: '1rem',
                                    background: 'linear-gradient(135deg, #4b5563, #374151)',
                                    border: 'none',
                                    padding: '0.5rem 1rem',
                                    borderRadius: '0.5rem',
                                    color: 'white',
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.4rem'
                                }}
                             >
                                <SettingsIcon size={16} /> <span className="btn-text">Settings</span>
                            </button>
                        </div>
                    </header>

                    {showNotifications && (
                        <NotificationsPanel
                            notifications={notifications}
                            onClose={() => setShowNotifications(false)}
                            onMarkRead={handleMarkRead}
                            onMarkAllRead={handleMarkAllRead}
                            onExportAlerts={handleExportAlerts}
                        />
                    )}

                    {/* Sidebar - Vehicle List */}
                    <div className={`sidebar ${mobileSidebarOpen ? 'open' : ''}`}>
                        <div className="sidebar-header-row">
                            <h3>Your Fleet</h3>
                            <button
                                className="add-vehicle-trigger-btn"
                                onClick={() => setShowAddVehicle(true)}
                                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                            >
                                <PlusIcon size={14} /> REGISTER
                            </button>
                        </div>

                        {/* Search Bar */}
                        <div className="sidebar-search">
                            <input
                                type="text"
                                placeholder="🔍 Search name, plate, ID..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>

                        {/* Filter Pills */}
                        <div className="sidebar-filters">
                            {['all', 'online', 'offline', 'alert', 'locked', 'moving'].map(filter => (
                                <button
                                    key={filter}
                                    className={`filter-pill ${activeFilter === filter ? 'active' : ''}`}
                                    onClick={() => setActiveFilter(filter)}
                                >
                                    {filter.toUpperCase()}
                                </button>
                            ))}
                        </div>

                        {/* Group Filter Dropdown — only shown if groups exist */}
                        {groups.length > 0 && (
                            <div style={{ padding: '0 1rem 0.5rem' }}>
                                <select
                                    value={activeGroupFilter}
                                    onChange={(e) => setActiveGroupFilter(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                                    className="group-select"
                                >
                                    <option value="all">🚘 All Groups</option>
                                    {groups.map(g => (
                                        <option key={g.id} value={g.id}>{g.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Vehicle List */}
                        <div className="vehicle-list">
                            {filteredVehicles.filter(v => {
                                const matchesSearch =
                                    v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                    v.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                    (v.plate_number && v.plate_number.toLowerCase().includes(searchQuery.toLowerCase())) ||
                                    (v.driver_name && v.driver_name.toLowerCase().includes(searchQuery.toLowerCase()));

                                if (!matchesSearch) return false;

                                const online = isOnline(v.lastUpdate);
                                if (activeFilter === 'online') return online;
                                if (activeFilter === 'offline') return !online;
                                if (activeFilter === 'alert') return (v.battery < 20 || v.fuel < 15);
                                if (activeFilter === 'locked') return v.cloudLocked;
                                if (activeFilter === 'moving') return (!v.locked && v.speed > 0 && online);

                                return true;
                            }).map(v => {
                                const online = isOnline(v.lastUpdate);
                                const isAlert = v.battery < 20 || v.fuel < 15;
                                const isArmed = v.cloudLocked || v.locked;

                                let statusClass = 'offline';
                                let statusText = 'OFFLINE';
                                if (isAlert) {
                                    statusClass = 'alert';
                                    statusText = 'ALERT';
                                } else if (isArmed) {
                                    statusClass = 'armed';
                                    statusText = 'ARMED';
                                } else if (online) {
                                    statusClass = 'online';
                                    statusText = 'ONLINE';
                                }

                                return (
                                    <div
                                        key={v.id}
                                        className={`vehicle-card ${selectedVehicleId === v.id ? 'selected' : ''}`}
                                        onClick={() => handleVehicleSelect(v)}
                                    >
                                        <div className="vehicle-info">
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                    <span className="vehicle-name">{v.name}</span>
                                                    <span title={v.cloudLocked ? "Web Locked" : "Web Unlocked"} style={{ display: 'flex', alignItems: 'center' }}>
                                                        {v.cloudLocked ? <LockIcon size={14} style={{ color: '#ef4444' }} /> : <UnlockIcon size={14} style={{ color: '#10b981' }} />}
                                                    </span>
                                                    <span title={v.locked ? "Engine Cut" : "Engine Running"} style={{ display: 'flex', alignItems: 'center' }}>
                                                        {v.locked ? <PowerIcon size={14} style={{ color: '#ef4444' }} /> : <ZapIcon size={14} style={{ color: '#10b981' }} />}
                                                    </span>
                                                </div>
                                                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.1rem' }}>
                                                    {v.plate_number && <span className="plate-badge">{getVehicleEmoji(v.vehicle_type)} {v.plate_number}</span>}
                                                    {v.driver_name && <span className="driver-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}><UserIcon size={12} /> {v.driver_name}</span>}
                                                </div>
                                            </div>

                                            <span className={`status-badge ${statusClass}`}>
                                                {statusText}
                                            </span>
                                        </div>

                                        <div className="vehicle-details-mini" style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                            <div style={{ display: 'flex', gap: '0.75rem' }}>
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', color: '#22c55e' }}><BatteryIcon size={12} /> {v.battery}%</span>
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', color: '#e67e22' }}><FuelIcon size={12} /> {v.fuel || '--'}%</span>
                                                {v.speed > 0 && online && <span style={{ color: '#22c55e', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}><ZapIcon size={12} /> {v.speed} km/h</span>}
                                            </div>
                                            <span className="last-seen-text" style={{ color: '#94a3b8', fontSize: '0.7rem' }}>Seen: {formatLastSeen(v.lastUpdate)}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Mobile Sidebar Overlay */}
                    {mobileSidebarOpen && (
                        <div className="sidebar-mobile-overlay" onClick={() => setMobileSidebarOpen(false)} />
                    )}

                    {/* Map Area */}
                    <div className="map-container">
                        {/* Map tile loading overlay */}
                        {mapTilesLoading && (
                            <div className="map-loading-overlay">
                                <div className="map-spinner" />
                                <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>Loading map tiles...</span>
                            </div>
                        )}
                        <MapContainer
                            center={[defaultCenter.lat, defaultCenter.lng]}
                            zoom={14}
                            ref={mapRef}
                            style={{ height: '100%', width: '100%', cursor: geofenceMode ? 'crosshair' : 'grab' }}
                        >
                            <MapTileLoader onStart={handleMapTileStart} onEnd={handleMapTileEnd} />
                            <TileLayer
                                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            />

                            {/* Route Trace Drawing */}
                            {tracePath.length > 0 && (
                                <Polyline
                                    positions={tracePath.map(p => [p.lat, p.lng])}
                                    pathOptions={{
                                        color: '#8b5cf6', // Premium Purple
                                        weight: 5,
                                        opacity: 0.8,
                                        lineCap: 'round',
                                        lineJoin: 'round'
                                    }}
                                />
                            )}

                            {/* Start and End Pins */}
                            {tracePath.length > 0 && (
                                <>
                                    <Marker
                                        position={[tracePath[0].lat, tracePath[0].lng]}
                                        icon={new L.DivIcon({
                                            html: '<div style="font-size: 1.6rem; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5))">🏁</div>',
                                            iconSize: [25, 25],
                                            iconAnchor: [12, 25],
                                            className: ''
                                        })}
                                    >
                                        <Popup>
                                            <strong>🏁 Trip Start</strong><br />
                                            Time: {new Date(tracePath[0].timestamp).toLocaleTimeString()}
                                        </Popup>
                                    </Marker>
                                    <Marker
                                        position={[tracePath[tracePath.length - 1].lat, tracePath[tracePath.length - 1].lng]}
                                        icon={new L.DivIcon({
                                            html: '<div style="font-size: 1.6rem; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5))">🛑</div>',
                                            iconSize: [25, 25],
                                            iconAnchor: [12, 25],
                                            className: ''
                                        })}
                                    >
                                        <Popup>
                                            <strong>🛑 Trip End</strong><br />
                                            Time: {new Date(tracePath[tracePath.length - 1].timestamp).toLocaleTimeString()}
                                        </Popup>
                                    </Marker>
                                </>
                            )}

                            {/* Animated Trip Playhead Marker */}
                            {playIndex !== -1 && playbackPath[playIndex] && (() => {
                                const selVeh = vehicles.find(v => v.id === selectedVehicleId);
                                const vehType = (selVeh?.vehicle_type || 'car').toLowerCase();
                                let emoji = '🚗';
                                if (vehType.includes('bike') || vehType.includes('motorcycle') || vehType.includes('scooter')) {
                                    emoji = '🏍️';
                                } else if (vehType.includes('van') || vehType.includes('truck') || vehType.includes('cargo')) {
                                    emoji = '🚐';
                                }
                                return (
                                    <Marker
                                        position={[playbackPath[playIndex].lat, playbackPath[playIndex].lng]}
                                        icon={new L.DivIcon({
                                            html: `<div class="playback-marker">${emoji}</div>`,
                                            iconSize: [30, 30],
                                            iconAnchor: [15, 15],
                                            className: ''
                                        })}
                                    >
                                        <Popup>
                                            <strong>Active Playback</strong><br />
                                            Speed: {playbackPath[playIndex].speed} km/h<br />
                                            Battery: {playbackPath[playIndex].battery}%<br />
                                            Fuel: {playbackPath[playIndex].fuel || '--'}%<br />
                                            Time: {new Date(playbackPath[playIndex].timestamp).toLocaleTimeString()}
                                        </Popup>
                                    </Marker>
                                );
                            })()}

                            <MapClickHandler onClick={(e) => {
                                if (geofenceMode && selectedVehicleId) {
                                    const lat = e.latlng.lat;
                                    const lng = e.latlng.lng;

                                    if (geofenceType === 'polygon') {
                                        // Polygon mode: collect points
                                        setPolygonPoints(prev => [...prev, { lat, lng }]);
                                    } else {
                                        // Circle mode: place immediately
                                        setGeofenceMode(false);
                                        const radius = (newGeofenceRadius && !isNaN(newGeofenceRadius) && newGeofenceRadius > 0) ? newGeofenceRadius : 500;
                                        axios.post(`${API_BASE}/api/geofences`, {
                                            vehicleId: selectedVehicleId,
                                            lat,
                                            lng,
                                            radius,
                                            type: 'circle'
                                        }).then(() => {
                                            fetchGeofences(selectedVehicleId);
                                        }).catch(() => {
                                             window.showToast('Failed to create geofence', 'error');
                                            setGeofenceMode(true);
                                        });
                                    }
                                }
                            }} />

                            {/* Render saved geofences (circles and polygons) */}
                            {geofences.map(geo => {
                                if (geo.type === 'polygon' && geo.coordinates) {
                                    try {
                                        const coords = typeof geo.coordinates === 'string' ? JSON.parse(geo.coordinates) : geo.coordinates;
                                        return (
                                            <Polygon
                                                key={geo.id}
                                                positions={coords.map(c => [c.lat, c.lng])}
                                                pathOptions={{
                                                    fillColor: '#3b82f6',
                                                    fillOpacity: 0.15,
                                                    color: '#3b82f6',
                                                    weight: 2,
                                                    dashArray: '6 4'
                                                }}
                                            />
                                        );
                                    } catch { return null; }
                                }
                                return (
                                    <Circle
                                        key={geo.id}
                                        center={[geo.lat, geo.lng]}
                                        radius={geo.radius}
                                        pathOptions={{
                                            fillColor: '#22c55e',
                                            fillOpacity: 0.2,
                                            color: '#22c55e',
                                            weight: 2
                                        }}
                                    />
                                );
                            })}

                            {/* Render in-progress polygon drawing */}
                            {geofenceMode && geofenceType === 'polygon' && polygonPoints.length > 0 && (
                                <>
                                    <Polyline
                                        positions={polygonPoints.map(p => [p.lat, p.lng])}
                                        pathOptions={{ color: '#f59e0b', weight: 2, dashArray: '5 5' }}
                                    />
                                    {polygonPoints.map((pt, idx) => (
                                        <Circle
                                            key={`poly-pt-${idx}`}
                                            center={[pt.lat, pt.lng]}
                                            radius={15}
                                            pathOptions={{ fillColor: '#f59e0b', fillOpacity: 0.8, color: '#f59e0b', weight: 1 }}
                                        />
                                    ))}
                                </>
                            )}

                            {filteredVehicles.map(v => {
                                const online = isOnline(v.lastUpdate);
                                const isAlert = v.battery < 20 || v.fuel < 15;
                                const isArmed = v.cloudLocked || v.locked;
                                const isSelected = selectedVehicleId === v.id;

                                let markerClass = 'offline';
                                if (isAlert) markerClass = 'alert';
                                else if (isArmed) markerClass = 'armed';
                                else if (online) markerClass = 'online';

                                const customIcon = new L.DivIcon({
                                    className: 'custom-vehicle-marker-wrapper',
                                    html: `
                                        <div class="vehicle-marker-glowing ${markerClass} ${isSelected ? 'selected' : ''}">
                                            <div class="marker-ripple"></div>
                                            <div class="marker-core">${getVehicleEmoji(v.vehicle_type)}</div>
                                        </div>
                                    `,
                                    iconSize: [36, 36],
                                    iconAnchor: [18, 18]
                                });

                                return (
                                    <Marker
                                        key={v.id}
                                        position={[v.lat, v.lng]}
                                        icon={customIcon}
                                        eventHandlers={{
                                            click: () => handleVehicleSelect(v)
                                        }}
                                    >
                                        {selectedVehicle && selectedVehicle.id === v.id && (
                                            <Popup open onClose={() => setSelectedVehicleId(null)}>
                                                <div className="info-window" style={{ position: 'relative' }}>
                                                    {selectedVehicle.subscription_status === 'SUSPENDED' || selectedVehicle.subscription_status === 'EXPIRED' || user?.subscription_status === 'SUSPENDED' ? (
                                                        <div className="suspended-popup-overlay">
                                                            <span className="lock-icon" style={{ color: '#ef4444' }}><LockIcon size={24} /></span>
                                                            <span className="suspension-title">SUSPENDED</span>
                                                            <span className="suspension-desc">Reactivate this vehicle's subscription to enable remote control commands and GPS tracking.</span>
                                                            <button
                                                                className="reactivate-btn"
                                                                onClick={() => {
                                                                    setSelectedVehicleId(null);
                                                                    setShowSettings(true);
                                                                }}
                                                            >
                                                                Open Billing Manager
                                                            </button>
                                                        </div>
                                                    ) : null}
                                                    <h3>{selectedVehicle.name}</h3>
                                                    <p>
                                                        Security: {selectedVehicle.cloudLocked ?
                                                            <span style={{ color: '#ff4444' }}>WEB LOCKED</span> :
                                                            <span style={{ color: '#22c55e' }}>WEB UNLOCKED (WAITING FOR RF)</span>}
                                                    </p>
                                                    <p>
                                                        Engine: {selectedVehicle.locked ?
                                                            <span style={{ color: '#ff4444' }}>CUT</span> :
                                                            <span style={{ color: '#22c55e' }}>RUNNING</span>}
                                                    </p>
                                                    <p>Speed: {selectedVehicle.speed} km/h</p>
                                                    <p>Battery: {selectedVehicle.battery}%</p>
                                                    <p>Fuel: {selectedVehicle.fuel || '--'}%</p>
                                                    <p>Last Seen: {formatLastSeen(selectedVehicle.lastUpdate)}</p>
                                                    <div className="controls">
                                                        <button
                                                            className="lock-btn"
                                                            onClick={() => sendCommand(selectedVehicle.id, 'LOCK')}
                                                            style={{ opacity: selectedVehicle.cloudLocked ? 0.5 : 1, flex: 1, minWidth: 0 }}
                                                            title={selectedVehicle.cloudLocked ? 'Already Web Locked' : 'Lock via Web'}
                                                        >
                                                            LOCK (WEB)
                                                        </button>
                                                        <button
                                                            className="unlock-btn"
                                                            onClick={() => sendCommand(selectedVehicle.id, 'UNLOCK')}
                                                            style={{ opacity: !selectedVehicle.cloudLocked ? 0.5 : 1, flex: 1, minWidth: 0 }}
                                                            title={!selectedVehicle.cloudLocked ? 'Already Web Unlocked (waiting for RF)' : 'Grant Web Permission'}
                                                        >
                                                            UNLOCK (WEB)
                                                        </button>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
                                                        <button
                                                            className="track-btn"
                                                            onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${selectedVehicle.lat},${selectedVehicle.lng}`, '_blank')}
                                                            style={{ flex: 1, backgroundColor: '#2088f0ff', color: 'white', border: 'none', padding: '0.4rem', borderRadius: '0.25rem', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}
                                                        >
                                                            <MapPinIcon size={12} /> TRACK
                                                        </button>
                                                        <button
                                                            className="share-btn"
                                                            onClick={() => { setShareTargetVehicle(selectedVehicle); setShowShareModal(true); }}
                                                            style={{ flex: 1, backgroundColor: '#8b5cf6', color: 'white', border: 'none', padding: '0.4rem', borderRadius: '0.25rem', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}
                                                        >
                                                            <ShareIcon size={12} /> SHARE
                                                        </button>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem' }}>
                                                        <button
                                                            className="history-btn"
                                                            onClick={() => setShowHistory(true)}
                                                            style={{ flex: 1, backgroundColor: '#8b5cf6', color: 'white', border: 'none', padding: '0.4rem', borderRadius: '0.25rem', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}
                                                        >
                                                            <HistoryIcon size={12} /> HISTORY
                                                        </button>
                                                        <button
                                                            className="delete-btn"
                                                            onClick={() => handleDeleteVehicle(selectedVehicle.id)}
                                                            style={{ flex: 1, backgroundColor: '#ff4444', color: 'white', border: 'none', padding: '0.4rem', borderRadius: '0.25rem', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}
                                                        >
                                                            <TrashIcon size={12} /> REMOVE
                                                        </button>
                                                    </div>

                                                    <div style={{ marginTop: '0.5rem', borderTop: '1px solid #e2e8f0', paddingTop: '0.5rem' }}>
                                                        <h4>Safe Zones</h4>
                                                        {geofences.length === 0 ? (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                                {/* Type Toggle */}
                                                                {geofenceMode && (
                                                                    <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.25rem' }}>
                                                                        <button
                                                                            onClick={() => { setGeofenceType('circle'); setPolygonPoints([]); }}
                                                                            style={{
                                                                                flex: 1, padding: '0.3rem', borderRadius: '0.25rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem',
                                                                                background: geofenceType === 'circle' ? '#8b5cf6' : '#e2e8f0',
                                                                                color: geofenceType === 'circle' ? 'white' : '#475569',
                                                                                border: 'none'
                                                                            }}
                                                                        >Circle</button>
                                                                        <button
                                                                            onClick={() => { setGeofenceType('polygon'); setPolygonPoints([]); }}
                                                                            style={{
                                                                                flex: 1, padding: '0.3rem', borderRadius: '0.25rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem',
                                                                                background: geofenceType === 'polygon' ? '#3b82f6' : '#e2e8f0',
                                                                                color: geofenceType === 'polygon' ? 'white' : '#475569',
                                                                                border: 'none'
                                                                            }}
                                                                        >Polygon</button>
                                                                    </div>
                                                                )}
                                                                {geofenceMode && geofenceType === 'circle' && (
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
                                                                {geofenceMode && geofenceType === 'polygon' && (
                                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                                                        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                                                            Click map to add vertices ({polygonPoints.length} points)
                                                                        </span>
                                                                        {polygonPoints.length >= 3 && (
                                                                            <button
                                                                                onClick={() => {
                                                                                    setGeofenceMode(false);
                                                                                    axios.post(`${API_BASE}/api/geofences`, {
                                                                                        vehicleId: selectedVehicleId,
                                                                                        type: 'polygon',
                                                                                        coordinates: polygonPoints
                                                                                    }).then(() => {
                                                                                        fetchGeofences(selectedVehicleId);
                                                                                        setPolygonPoints([]);
                                                                                    }).catch(() => {
                                                                                        window.showToast('Failed to create polygon geofence', 'error');
                                                                                        setGeofenceMode(true);
                                                                                    });
                                                                                }}
                                                                                style={{ width: '100%', padding: '0.4rem', background: '#22c55e', color: 'white', border: 'none', borderRadius: '0.25rem', cursor: 'pointer', fontWeight: 'bold' }}
                                                                            >
                                                                                ✓ Complete Polygon ({polygonPoints.length} pts)
                                                                            </button>
                                                                        )}
                                                                        {polygonPoints.length > 0 && (
                                                                            <button
                                                                                onClick={() => setPolygonPoints(prev => prev.slice(0, -1))}
                                                                                style={{ width: '100%', padding: '0.3rem', background: '#f59e0b', color: 'white', border: 'none', borderRadius: '0.25rem', cursor: 'pointer', fontSize: '0.8rem' }}
                                                                            >
                                                                                ↩ Undo Last Point
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                )}
                                                                <button
                                                                    onClick={() => { setGeofenceMode(!geofenceMode); setPolygonPoints([]); }}
                                                                    style={{
                                                                        width: '100%', padding: '0.4rem', background: geofenceMode ? '#64748b' : '#22c55e', color: 'white', border: 'none', borderRadius: '0.25rem', cursor: 'pointer'
                                                                    }}
                                                                >
                                                                    {geofenceMode ? 'Cancel Selection' : 'Add Safe Zone (Click Map)'}
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                                                {geofences.map(g => (
                                                                    <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem' }}>
                                                                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                                            <ShieldIcon size={12} /> {g.type === 'polygon' ? 'Polygon' : `Circle (${g.radius || 500}m)`}
                                                                        </span>
                                                                        <button
                                                                            onClick={() => handleDeleteGeofence(g.id)}
                                                                            style={{ background: '#ef4444', color: 'white', border: 'none', padding: '0.2rem', borderRadius: '0.2rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                                        >
                                                                            <XIcon size={10} />
                                                                        </button>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </Popup>
                                        )
                                        }
                                    </Marker>
                                );
                            })}
                        </MapContainer>

                        {/* PLAYBACK TIMELINE DRAWER PANEL */}
                        {playIndex !== -1 && playbackPath.length > 0 && (
                            <div className="playback-timeline-panel">
                                <div className="timeline-hud-row">
                                    <div className="hud-metric">
                                        <span className="hud-label">RECORDED AT</span>
                                        <span className="hud-value">
                                            {new Date(playbackPath[playIndex].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                        </span>
                                    </div>
                                    <div className="hud-metric">
                                        <span className="hud-label">SPEED</span>
                                        <span className="hud-value neon-blue">{playbackPath[playIndex].speed} <span className="hud-unit">km/h</span></span>
                                    </div>
                                    <div className="hud-metric">
                                        <span className="hud-label">BATTERY</span>
                                        <span className={`hud-value ${playbackPath[playIndex].battery < 20 ? 'neon-red' : 'neon-green'}`}>
                                            🔋 {playbackPath[playIndex].battery}%
                                        </span>
                                    </div>
                                    <div className="hud-metric">
                                        <span className="hud-label">FUEL</span>
                                        <span className="hud-value neon-orange">⛽ {playbackPath[playIndex].fuel}%</span>
                                    </div>
                                </div>

                                <div className="timeline-scrubber-row">
                                    <button
                                        className="timeline-play-pause-btn"
                                        onClick={() => setIsPlaying(!isPlaying)}
                                    >
                                        {isPlaying ? '⏸' : '▶'}
                                    </button>

                                    <div className="scrubber-slider-container">
                                        <input
                                            type="range"
                                            min="0"
                                            max={playbackPath.length - 1}
                                            value={playIndex}
                                            onChange={(e) => {
                                                const idx = parseInt(e.target.value);
                                                setPlayIndex(idx);
                                                const pt = playbackPath[idx];
                                                if (pt && mapRef.current) {
                                                    mapRef.current.setView([pt.lat, pt.lng]);
                                                }
                                            }}
                                            className="timeline-range-slider"
                                        />
                                        <div className="timeline-progress-labels">
                                            <span>Start</span>
                                            <span>Point {playIndex + 1} of {playbackPath.length}</span>
                                            <span>End</span>
                                        </div>
                                    </div>

                                    <div className="timeline-speed-controls">
                                        {[1, 2, 4, 8].map(spd => (
                                            <button
                                                key={spd}
                                                className={`speed-pill-btn ${playbackSpeed === spd ? 'active' : ''}`}
                                                onClick={() => setPlaybackSpeed(spd)}
                                            >
                                                {spd}x
                                            </button>
                                        ))}
                                    </div>

                                    <button
                                        className="timeline-close-btn"
                                        onClick={() => {
                                            setPlayIndex(-1);
                                            setIsPlaying(false);
                                            setPlaybackPath([]);
                                        }}
                                        title="Exit Playback"
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )
            }

            {/* Share Link Modal */}
            {
                showShareModal && shareTargetVehicle && (
                    <ShareLinkModal
                        vehicle={shareTargetVehicle}
                        onClose={() => { setShowShareModal(false); setShareTargetVehicle(null); }}
                    />
                )
            }

            {/* Toast Container */}
            <div style={{
                position: 'fixed',
                top: '20px',
                right: '20px',
                zIndex: 99999,
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                pointerEvents: 'none'
            }}>
                {toasts.map(t => (
                    <div key={t.id} style={{
                        pointerEvents: 'auto',
                        background: t.type === 'success' ? 'linear-gradient(135deg, #059669, #10b981)' :
                                    t.type === 'error' ? 'linear-gradient(135deg, #dc2626, #ef4444)' :
                                    t.type === 'warning' ? 'linear-gradient(135deg, #d97706, #f59e0b)' :
                                    'linear-gradient(135deg, #1e293b, #334155)',
                        color: 'white',
                        padding: '0.75rem 1.25rem',
                        borderRadius: '8px',
                        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        minWidth: '250px',
                        maxWidth: '400px',
                        animation: 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                        border: '1px solid rgba(255, 255, 255, 0.1)'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {t.type === 'success' && <CheckIcon size={18} />}
                            {t.type === 'error' && <AlertTriangleIcon size={18} />}
                            {t.type === 'warning' && <AlertTriangleIcon size={18} />}
                            {t.type === 'info' && <InfoIcon size={18} />}
                        </div>
                        <div style={{ flex: 1, fontSize: '0.85rem', fontWeight: '500', lineHeight: '1.25' }}>
                            {t.message}
                        </div>
                    </div>
                ))}
            </div>
        </ErrorBoundary>
    );
}

// ShareLinkModal Component
function ShareLinkModal({ vehicle, onClose }) {
    const [selectedDuration, setSelectedDuration] = useState(30);
    const [generatedLink, setGeneratedLink] = useState('');
    const [generating, setGenerating] = useState(false);
    const [copied, setCopied] = useState(false);

    const durations = [
        { label: '30 min', value: 30 },
        { label: '1 hour', value: 60 },
        { label: '2 hours', value: 120 },
        { label: '4 hours', value: 240 },
        { label: '8 hours', value: 480 },
        { label: '24 hours', value: 1440 }
    ];

    const handleGenerate = async () => {
        setGenerating(true);
        try {
            const res = await axios.post(`${API_BASE}/api/vehicles/${vehicle.id}/share`, {
                durationMinutes: selectedDuration
            });
            const baseUrl = window.location.origin;
            setGeneratedLink(`${baseUrl}/track/${res.data.token}`);
        } catch (err) {
            window.showToast(err.response?.data?.error || 'Failed to generate share link', 'error');
        }
        setGenerating(false);
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(generatedLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="share-link-modal-overlay" onClick={onClose}>
            <div className="share-link-modal" onClick={e => e.stopPropagation()}>
                <button className="share-link-modal-close-icon" onClick={onClose} aria-label="Close">
                    <XIcon size={16} />
                </button>
                <h3>🔗 Share Live Location</h3>
                <div className="modal-subtitle">
                    Share a temporary live tracking link for <strong>{vehicle.name}</strong>
                    {vehicle.plate_number && ` (${vehicle.plate_number})`}.
                    The recipient can view location without logging in.
                </div>

                <div className="duration-options">
                    {durations.map(d => (
                        <button
                            key={d.value}
                            className={`duration-btn ${selectedDuration === d.value ? 'selected' : ''}`}
                            onClick={() => { setSelectedDuration(d.value); setGeneratedLink(''); }}
                        >
                            {d.label}
                        </button>
                    ))}
                </div>

                {!generatedLink && (
                    <button
                        className="generate-btn"
                        onClick={handleGenerate}
                        disabled={generating}
                    >
                        {generating ? 'Generating...' : `Generate Link (${durations.find(d => d.value === selectedDuration)?.label})`}
                    </button>
                )}

                {generatedLink && (
                    <div className="generated-link-box">
                        <div className="link-label">✅ Link Generated — Share via WhatsApp or SMS</div>
                        <div className="link-url">
                            <input type="text" value={generatedLink} readOnly />
                            <button className="copy-btn" onClick={handleCopy}>
                                {copied ? '✓ Copied!' : 'Copy'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function AppWrapper() {
    return (
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    );
}
