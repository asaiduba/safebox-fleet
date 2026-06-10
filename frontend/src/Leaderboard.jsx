const API_BASE = import.meta.env.VITE_API_URL || '';
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './Leaderboard.css';

const Leaderboard = ({ onBack, embedMode = false }) => {
    const [drivers, setDrivers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedRow, setExpandedRow] = useState(null);

    const fetchLeaderboard = async () => {
        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const res = await axios.get(`${API_BASE}/api/analytics/leaderboard?userId=${user.id}&role=${user.role}`);
            setDrivers(res.data);
            setLoading(false);
        } catch (err) {
            console.error("Failed to fetch leaderboard", err);
            setLoading(false);
        }
    };

    useEffect(() => {
        Promise.resolve().then(() => {
            fetchLeaderboard();
        });
    }, []);

    const getScoreClass = (score) => {
        if (score >= 80) return 'score-high';
        if (score >= 50) return 'score-med';
        return 'score-low';
    };

    const getAlertIcon = (type) => {
        switch (type) {
            case 'speeding': return '🏎️';
            case 'harshAccel': return '⚡';
            case 'harshBrake': return '🛑';
            case 'startBlocked': return '🔒';
            case 'geofenceBreach': return '📍';
            case 'fuelTheft': return '⛽';
            case 'curfewViolation': return '🕐';
            default: return '⚠️';
        }
    };

    const getAlertLabel = (type) => {
        switch (type) {
            case 'speeding': return 'Speeding';
            case 'harshAccel': return 'Hard Accel';
            case 'harshBrake': return 'Hard Brake';
            case 'startBlocked': return 'Blocked Start';
            case 'geofenceBreach': return 'Geofence';
            case 'fuelTheft': return 'Fuel Theft';
            case 'curfewViolation': return 'Curfew';
            default: return type;
        }
    };

    const getAlertColorClass = (type) => {
        switch (type) {
            case 'speeding': return 'alert-pill-orange';
            case 'harshAccel':
            case 'harshBrake': return 'alert-pill-red';
            case 'startBlocked':
            case 'curfewViolation': return 'alert-pill-purple';
            case 'geofenceBreach': return 'alert-pill-blue';
            case 'fuelTheft': return 'alert-pill-crimson';
            default: return 'alert-pill-gray';
        }
    };

    const getTotalAlerts = (breakdown) => {
        if (!breakdown) return 0;
        return Object.values(breakdown).reduce((sum, v) => sum + v, 0);
    };

    if (loading) return (
        <div className="loading-container">
            <span className="loader"></span>
            <p>Loading Leaderboard...</p>
        </div>
    );

    return (
        <div className={`leaderboard-container ${embedMode ? 'embedded' : ''}`}>
            {!embedMode && (
                <header className="leaderboard-header">
                    <div className="leaderboard-title">
                        <h1>Drivers Leaderboard</h1>
                        <span className="subtitle">Safety Scores & Alert Breakdown (7-Day Window)</span>
                    </div>
                    <button className="back-btn" onClick={onBack}>
                        ← Back to Dashboard
                    </button>
                </header>
            )}

            <div className="leaderboard-table-container">
                <table className="leaderboard-table">
                    <thead>
                        <tr>
                            <th>Rank</th>
                            <th>Vehicle</th>
                            <th>Status</th>
                            <th>Safety Score</th>
                            <th>Alerts (7d)</th>
                            <th>Efficiency</th>
                        </tr>
                    </thead>
                    <tbody>
                        {drivers.map((driver, index) => (
                            <React.Fragment key={driver.id}>
                                <tr
                                    className={expandedRow === driver.id ? 'row-expanded' : ''}
                                    onClick={() => setExpandedRow(expandedRow === driver.id ? null : driver.id)}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <td>
                                        <span className={`rank-badge rank-${index + 1}`}>{index + 1}</span>
                                    </td>
                                    <td>
                                        <div style={{ fontWeight: 'bold', color: 'white' }}>{driver.id}</div>
                                        <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                                            {driver.driverName || driver.name}
                                        </div>
                                    </td>
                                    <td>
                                        <span className={`status-indicator ${driver.status === 'Online' ? 'status-online' : 'status-offline'}`}></span>
                                        {driver.status}
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                            <span style={{ fontWeight: 'bold', minWidth: '30px', fontSize: '1.1rem' }}>
                                                {driver.safetyScore}
                                            </span>
                                            <div className="score-bar-container">
                                                <div
                                                    className={`score-bar ${getScoreClass(driver.safetyScore)}`}
                                                    style={{ width: `${driver.safetyScore}%` }}
                                                ></div>
                                            </div>
                                        </div>
                                    </td>
                                    <td>
                                        <div className="alerts-summary">
                                            {getTotalAlerts(driver.breakdown) === 0 ? (
                                                <span className="alert-pill alert-pill-clean">✓ Clean</span>
                                            ) : (
                                                <div className="alert-pills-row">
                                                    {driver.breakdown && Object.entries(driver.breakdown)
                                                        .filter(([, count]) => count > 0)
                                                        .slice(0, 3)
                                                        .map(([type, count]) => (
                                                            <span key={type} className={`alert-pill ${getAlertColorClass(type)}`}>
                                                                {getAlertIcon(type)} {count}
                                                            </span>
                                                        ))
                                                    }
                                                    {driver.breakdown && Object.entries(driver.breakdown).filter(([, c]) => c > 0).length > 3 && (
                                                        <span className="alert-pill alert-pill-gray">
                                                            +{Object.entries(driver.breakdown).filter(([, c]) => c > 0).length - 3}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                            <span style={{ fontWeight: 'bold', minWidth: '30px' }}>{driver.efficiencyScore}</span>
                                            <div className="score-bar-container">
                                                <div
                                                    className={`score-bar ${getScoreClass(driver.efficiencyScore)}`}
                                                    style={{ width: `${driver.efficiencyScore}%` }}
                                                ></div>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                                {expandedRow === driver.id && driver.breakdown && (
                                    <tr className="breakdown-row">
                                        <td colSpan="6">
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                                {/* Safety Breakdown */}
                                                <div>
                                                    <div className="breakdown-section-label">Safety Alerts (7 Days)</div>
                                                    <div className="breakdown-grid">
                                                        {Object.entries(driver.breakdown).map(([type, count]) => (
                                                            <div key={type} className={`breakdown-card ${count > 0 ? 'has-alerts' : ''}`}>
                                                                <span className="breakdown-icon">{getAlertIcon(type)}</span>
                                                                <span className="breakdown-label">{getAlertLabel(type)}</span>
                                                                <span className={`breakdown-count ${count > 0 ? 'count-active' : ''}`}>
                                                                    {count}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>

                                                {/* Efficiency Breakdown */}
                                                {driver.efficiencyBreakdown && (
                                                    <div>
                                                        <div className="breakdown-section-label">Efficiency Metrics</div>
                                                        <div className="breakdown-grid efficiency-grid">
                                                            <div className={`breakdown-card efficiency-card ${driver.efficiencyBreakdown.idleRatio > 40 ? 'eff-poor' : driver.efficiencyBreakdown.idleRatio > 30 ? 'eff-warn' : 'eff-good'}`}>
                                                                <span className="breakdown-icon">⏸️</span>
                                                                <span className="breakdown-label">Idle Time</span>
                                                                <span className="breakdown-count eff-value">
                                                                    {driver.efficiencyBreakdown.idleRatio}%
                                                                </span>
                                                                <span className="eff-hint">lower is better</span>
                                                            </div>
                                                            <div className={`breakdown-card efficiency-card ${driver.efficiencyBreakdown.optimalSpeedRatio >= 75 ? 'eff-good' : driver.efficiencyBreakdown.optimalSpeedRatio >= 60 ? 'eff-warn' : 'eff-poor'}`}>
                                                                <span className="breakdown-icon">🎯</span>
                                                                <span className="breakdown-label">Optimal Speed</span>
                                                                <span className="breakdown-count eff-value">
                                                                    {driver.efficiencyBreakdown.optimalSpeedRatio}%
                                                                </span>
                                                                <span className="eff-hint">20-80 km/h range</span>
                                                            </div>
                                                            <div className={`breakdown-card efficiency-card ${driver.efficiencyBreakdown.kmPerLiter >= 8.0 ? 'eff-good' : driver.efficiencyBreakdown.kmPerLiter >= 5.0 ? 'eff-warn' : 'eff-poor'}`}>
                                                                <span className="breakdown-icon">⛽</span>
                                                                <span className="breakdown-label">Fuel Economy</span>
                                                                <span className="breakdown-count eff-value">
                                                                    {driver.efficiencyBreakdown.kmPerLiter} <span className="eff-unit" style={{ fontSize: '0.65rem', color: '#64748b' }}>km/L</span>
                                                                </span>
                                                                <span className="eff-hint">higher is better</span>
                                                            </div>
                                                            <div className="breakdown-card efficiency-card eff-neutral">
                                                                <span className="breakdown-icon">📊</span>
                                                                <span className="breakdown-label">Data Points</span>
                                                                <span className="breakdown-count eff-value">
                                                                    {driver.efficiencyBreakdown.dataPoints}
                                                                </span>
                                                                <span className="eff-hint">telemetry entries</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default Leaderboard;
