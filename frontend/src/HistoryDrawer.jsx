import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { compileTripStats, formatDuration } from './historyMath';
import './HistoryDrawer.css';

export default function HistoryDrawer({ vehicle, onClose, onTraceUpdate, onPlayStart }) {
    const API_BASE = import.meta.env.VITE_API_URL || '';

    // Get today's start and end date/time in local YYYY-MM-DDTHH:MM format
    const getTodayStartString = () => {
        const d = new Date();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}T00:00`;
    };

    const getTodayEndString = () => {
        const d = new Date();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}T23:59`;
    };

    const [startDate, setStartDate] = useState(getTodayStartString());
    const [endDate, setEndDate] = useState(getTodayEndString());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [stats, setStats] = useState({
        totalDistance: 0,
        movingTime: 0,
        idleTime: 0,
        avgSpeed: 0,
        path: []
    });

    const [showPathOnMap, setShowPathOnMap] = useState(true);

    const fetchHistory = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const startTimestamp = new Date(startDate).getTime();
            const endTimestamp = new Date(endDate).getTime();

            if (isNaN(startTimestamp) || isNaN(endTimestamp)) {
                setError('Please select valid start and end dates.');
                setLoading(false);
                return;
            }

            if (startTimestamp > endTimestamp) {
                setError('Start date cannot be after end date.');
                setLoading(false);
                return;
            }

            const res = await axios.get(`${API_BASE}/api/analytics/route/${vehicle.id}?start=${startTimestamp}&end=${endTimestamp}`);
            const compiled = compileTripStats(res.data);
            setStats(compiled);

            if (res.data.length === 0) {
                setError('No travel logs recorded for this period.');
            }
        } catch (err) {
            console.error(err);
            setError('Failed to fetch travel history.');
        } finally {
            setLoading(false);
        }
    }, [API_BASE, vehicle.id, startDate, endDate]);

    // Fetch history logs whenever vehicle or date changes
    useEffect(() => {
        if (!vehicle) return;
        fetchHistory();
    }, [vehicle, fetchHistory]);

    // Update map trace line whenever path or showPathOnMap toggle changes
    useEffect(() => {
        if (showPathOnMap) {
            onTraceUpdate(stats.path);
        } else {
            onTraceUpdate([]);
        }
    }, [stats.path, showPathOnMap, onTraceUpdate]);

    return (
        <div className="history-drawer-container">
            <header className="history-drawer-header">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <h2>🕒 Travel History</h2>
                    <span className="vehicle-subtitle">{vehicle.name} ({vehicle.id})</span>
                </div>
                <button className="close-btn" onClick={() => {
                    onTraceUpdate([]); // Clear trace
                    onClose();
                }}>✕</button>
            </header>

            <div className="history-drawer-content">
                {/* DATE RANGE SELECTOR */}
                <div className="history-section date-section" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.4rem' }}>Start Date & Time</label>
                        <input 
                            type="datetime-local" 
                            value={startDate} 
                            onChange={(e) => setStartDate(e.target.value)} 
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.4rem' }}>End Date & Time</label>
                        <input 
                            type="datetime-local" 
                            value={endDate} 
                            onChange={(e) => setEndDate(e.target.value)} 
                        />
                    </div>
                </div>

                {loading && <div className="loader-box">Loading travel statistics...</div>}
                
                {error && <div className="error-box">{error}</div>}

                {/* TRIP STATISTICS */}
                {!loading && (
                    <div className="history-stats-grid">
                        <div className="stat-card">
                            <span className="stat-label">DISTANCE</span>
                            <span className="stat-value">{stats.totalDistance} km</span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-label">DRIVING TIME</span>
                            <span className="stat-value">{formatDuration(stats.movingTime)}</span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-label">AVG. SPEED</span>
                            <span className="stat-value">{stats.avgSpeed} km/h</span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-label">STOPPED / IDLE</span>
                            <span className="stat-value">{formatDuration(stats.idleTime)}</span>
                        </div>
                    </div>
                )}

                {/* CONTROLS */}
                {!loading && stats.path.length > 0 && (
                    <div className="history-section controls-section">
                        <h3>Map Overlays</h3>
                        
                        <div className="control-item">
                            <div className="control-info">
                                <span className="control-title">Trace Route on Map</span>
                                <span className="control-desc">Draw glowing polyline trace connecting coordinates.</span>
                            </div>
                            <label className="switch">
                                <input 
                                    type="checkbox" 
                                    checked={showPathOnMap} 
                                    onChange={(e) => setShowPathOnMap(e.target.checked)} 
                                />
                                <span className="slider round"></span>
                            </label>
                        </div>

                        <button 
                            className="play-trip-btn"
                            onClick={() => onPlayStart(stats.path)}
                            disabled={stats.path.length < 2}
                        >
                            ▶ Replay Route
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
