import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './SupportDashboard.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function SupportDashboard({ onBack }) {
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [diagnosticsData, setDiagnosticsData] = useState(null);
    const [activeTab, setActiveTab] = useState('all'); // Filter vehicle grid by status: 'all', 'online', 'offline'
    const terminalEndRef = useRef(null);

    // Auto-formatting the input to SUP-XXXX
    const handleCodeChange = (e) => {
        let val = e.target.value.toUpperCase();
        // Remove non-alphanumeric except dash
        val = val.replace(/[^A-Z0-9-]/g, '');
        
        // Auto-insert dash if user typed SUP and then characters
        if (val.length === 3 && !val.includes('-')) {
            val = val + '-';
        } else if (val.length > 3 && !val.includes('-')) {
            val = val.slice(0, 3) + '-' + val.slice(3);
        }
        
        // Limit to 8 characters: SUP-XXXX
        if (val.length <= 8) {
            setCode(val);
        }
    };

    const handleVerify = async (e) => {
        if (e) e.preventDefault();
        if (!code || code.length < 8) {
            setError('Please enter a valid 8-character support code (e.g. SUP-1234)');
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const response = await axios.get(`${API_BASE}/api/support/verify/${code}`);
            setDiagnosticsData(response.data);
        } catch (err) {
            console.error('Support verification failed:', err);
            setError(err.response?.data?.error || 'Verification failed. Please check the code.');
        } finally {
            setLoading(false);
        }
    };

    // Auto-scroll logs terminal to bottom on data load
    useEffect(() => {
        if (terminalEndRef.current) {
            terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [diagnosticsData]);

    const handleDisconnect = () => {
        setDiagnosticsData(null);
        setCode('');
        setError(null);
    };

    // Helper to calculate voltage from battery %
    const calculateVoltage = (batteryLevel) => {
        const level = batteryLevel !== undefined ? batteryLevel : 100;
        return ((level / 100) * 1.8 + 11.8).toFixed(1);
    };

    // GSM Signal Strength Label
    const getGSMStatus = (dbm) => {
        if (!dbm) return { label: 'Unknown', class: 'neutral', percent: 0 };
        const val = parseInt(dbm);
        if (val >= -85) return { label: 'Excellent', class: 'good', percent: 90 };
        if (val >= -98) return { label: 'Fair', class: 'warning', percent: 60 };
        return { label: 'Poor', class: 'danger', percent: 25 };
    };

    // Sat Lock Count Label
    const getSatLockStatus = (count) => {
        const val = count !== undefined ? parseInt(count) : 0;
        if (val >= 8) return { label: 'Strong Lock', class: 'good' };
        if (val >= 4) return { label: 'Weak Lock', class: 'warning' };
        return { label: 'No Lock', class: 'danger' };
    };

    // Compile a chronological log stream from all vehicles' histories
    const getLogStream = () => {
        if (!diagnosticsData?.system_diagnostics?.vehicles) return [];
        const logs = [];
        diagnosticsData.system_diagnostics.vehicles.forEach(vehicle => {
            if (vehicle.history && Array.isArray(vehicle.history)) {
                vehicle.history.forEach(h => {
                    logs.push({
                        vehicleName: vehicle.name,
                        vehicleId: vehicle.id,
                        plate: vehicle.plate_number || 'No Plate',
                        ...h
                    });
                });
            }
        });
        // Sort newest first or oldest first? In terminal consoles, we display scrolling history.
        // Sorting chronologically (oldest first) so that scrolling down goes forward in time.
        return logs.sort((a, b) => a.timestamp - b.timestamp);
    };

    const isOnline = (lastSeen) => {
        if (!lastSeen) return false;
        const diff = Date.now() - new Date(lastSeen).getTime();
        return diff < 60000; // 1 minute
    };

    return (
        <div className="support-portal-body">
            <div className="portal-grid-overlay"></div>
            
            {/* Header */}
            <header className="support-header">
                <div className="support-header-left">
                    <span className="support-header-badge">OPS PORTAL</span>
                    <h1>SafeBox Diagnostic Console</h1>
                </div>
                <div className="support-header-right">
                    <button className="support-back-btn" onClick={onBack}>
                        ⬅ Exit Portal
                    </button>
                </div>
            </header>

            {!diagnosticsData ? (
                /* CODE INPUT SCREEN */
                <main className="support-auth-container">
                    <div className="support-auth-card glass-panel-support">
                        <div className="card-glowing-dots"></div>
                        <div className="auth-card-header">
                            <span className="auth-lock-icon">🛡️</span>
                            <h2>Diagnostic Access Code</h2>
                            <p>Enter the 24-hour verification code generated by the client to decrypt and review device states, GSM logs, and voltage diagnostics.</p>
                        </div>
                        
                        <form onSubmit={handleVerify} className="auth-form">
                            <div className="input-group-support">
                                <label htmlFor="support-code">Access Token</label>
                                <input
                                    type="text"
                                    id="support-code"
                                    placeholder="SUP-XXXX"
                                    value={code}
                                    onChange={handleCodeChange}
                                    autoComplete="off"
                                    maxLength={8}
                                    required
                                    className="support-code-input"
                                />
                            </div>

                            {error && (
                                <div className="auth-error-banner animate-shake">
                                    ⚠️ {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading || code.length < 8}
                                className="auth-submit-btn"
                            >
                                {loading ? (
                                    <>
                                        <span className="spinner-loader"></span> Verifying Token...
                                    </>
                                ) : (
                                    '🔑 Establish Session Connection'
                                )}
                            </button>
                        </form>

                        <div className="auth-security-disclaimer">
                            <p>🔒 **Authorized Personnel Only.** Every login attempt is audited. Access tokens automatically expire 24 hours after creation.</p>
                        </div>
                    </div>
                </main>
            ) : (
                /* TELEMETRY & DIAGNOSTICS DISPLAY SCREEN */
                <main className="support-dashboard-content">
                    {/* TOP STATS BANNER */}
                    <section className="diagnostics-summary-row">
                        <div className="summary-card glass-panel-support">
                            <span className="summary-label">CLIENT ACCOUNT</span>
                            <span className="summary-value highlight-cyan">
                                {diagnosticsData.generated_for_user.company_name || diagnosticsData.generated_for_user.username}
                            </span>
                            <span className="summary-subtitle">{diagnosticsData.generated_for_user.email}</span>
                        </div>
                        <div className="summary-card glass-panel-support">
                            <span className="summary-label">VERIFIED CODE</span>
                            <span className="summary-value highlight-purple">{diagnosticsData.support_code}</span>
                            <span className="summary-subtitle">Active Security Token</span>
                        </div>
                        <div className="summary-card glass-panel-support">
                            <span className="summary-label">VEHICLES</span>
                            <span className="summary-value">{diagnosticsData.system_diagnostics.vehicle_count}</span>
                            <span className="summary-subtitle">Registered in Fleet</span>
                        </div>
                        <div className="summary-card glass-panel-support">
                            <span className="summary-label">CONSOLE STATUS</span>
                            <span className="summary-value highlight-green">
                                <span className="pulsing-dot-green"></span> SECURE
                            </span>
                            <button className="summary-disconnect-btn" onClick={handleDisconnect}>
                                Terminate Connection
                            </button>
                        </div>
                    </section>

                    <div className="dashboard-columns">
                        {/* LEFT COLUMN: LOGSTREAM & SYSTEM STATE */}
                        <div className="dashboard-column-left">
                            {/* USER PROFILE INFO */}
                            <div className="system-profile-panel glass-panel-support">
                                <h3>Account Information</h3>
                                <div className="profile-grid">
                                    <div className="profile-item">
                                        <span className="label">Username</span>
                                        <span className="val">{diagnosticsData.generated_for_user.username}</span>
                                    </div>
                                    <div className="profile-item">
                                        <span className="label">Account Role</span>
                                        <span className="val text-capitalize">{diagnosticsData.generated_for_user.role}</span>
                                    </div>
                                    <div className="profile-item">
                                        <span className="label">Phone</span>
                                        <span className="val">{diagnosticsData.generated_for_user.phone || 'Not Configured'}</span>
                                    </div>
                                    <div className="profile-item">
                                        <span className="label">Billing Status</span>
                                        <span className={`val badge-${diagnosticsData.generated_for_user.subscription_status.toLowerCase()}`}>
                                            {diagnosticsData.generated_for_user.subscription_status}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* LOG STREAM CONSOLE */}
                            <div className="telemetry-terminal-panel glass-panel-support">
                                <div className="terminal-header">
                                    <div className="terminal-title-container">
                                        <span className="terminal-dot"></span>
                                        <h3>TELEMETRY STREAM LOGGER</h3>
                                    </div>
                                    <div className="terminal-actions">
                                        <span className="telemetry-active-badge">
                                            <span className="pulsing-dot-green"></span> HISTORICAL DUMP
                                        </span>
                                    </div>
                                </div>
                                
                                <div className="terminal-console">
                                    {getLogStream().length === 0 ? (
                                        <div className="terminal-empty-row">
                                            [INFO] No telemetry entries found in historical buffer for this fleet.
                                        </div>
                                    ) : (
                                        getLogStream().map((log, index) => {
                                            const timeString = new Date(log.timestamp).toLocaleString();
                                            return (
                                                <div key={index} className="terminal-row">
                                                    <span className="t-timestamp">[{timeString}]</span>{' '}
                                                    <span className="t-vehicle">&lt;{log.vehicleName}&gt;</span>{' '}
                                                    <span className="t-loc">Pos({log.lat.toFixed(4)}, {log.lng.toFixed(4)})</span>{' '}
                                                    <span className="t-metrics">
                                                        Speed: <span className="text-cyan">{log.speed} km/h</span> |{' '}
                                                        Batt: <span className="text-green">{log.battery_level}%</span> |{' '}
                                                        Fuel: <span className="text-orange">{log.fuel_level}%</span>
                                                    </span>
                                                </div>
                                            );
                                        })
                                    )}
                                    <div ref={terminalEndRef} />
                                </div>
                                <div className="terminal-footer">
                                    Showing last 15 reports per vehicle. Sorted chronologically.
                                </div>
                            </div>
                        </div>

                        {/* RIGHT COLUMN: VEHICLES GRID */}
                        <div className="dashboard-column-right">
                            <div className="vehicles-grid-header">
                                <h3>Fleet Device Nodes ({diagnosticsData.system_diagnostics.vehicles.length})</h3>
                                <div className="filter-tabs">
                                    {['all', 'online', 'offline'].map(tab => (
                                        <button
                                            key={tab}
                                            className={`filter-tab-btn ${activeTab === tab ? 'active' : ''}`}
                                            onClick={() => setActiveTab(tab)}
                                        >
                                            {tab.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="vehicles-grid">
                                {diagnosticsData.system_diagnostics.vehicles
                                    .filter(v => {
                                        const online = isOnline(v.last_seen);
                                        if (activeTab === 'online') return online;
                                        if (activeTab === 'offline') return !online;
                                        return true;
                                    })
                                    .map(v => {
                                        const online = isOnline(v.last_seen);
                                        const gsm = getGSMStatus(v.gsm_signal_dbm);
                                        const sat = getSatLockStatus(v.sat_lock_count);
                                        
                                        return (
                                            <div key={v.id} className="vehicle-diag-card glass-panel-support">
                                                <div className="card-top-row">
                                                    <div className="vehicle-title-info">
                                                        <h4>{v.name}</h4>
                                                        <span className="plate-tag">{v.plate_number || 'NO PLATE'}</span>
                                                    </div>
                                                    <span className={`status-badge-support ${online ? 'online' : 'offline'}`}>
                                                        {online ? 'ONLINE' : 'OFFLINE'}
                                                    </span>
                                                </div>

                                                <div className="driver-row">
                                                    <span>Driver: <strong>{v.driver_name || 'Unassigned'}</strong></span>
                                                    <span className="vehicle-id-mono">ID: {v.id}</span>
                                                </div>

                                                {/* METRIC GRID */}
                                                <div className="metric-diag-grid">
                                                    <div className="metric-diag-item">
                                                        <span className="metric-icon">📶</span>
                                                        <div className="metric-content">
                                                            <span className="m-label">GSM Signal</span>
                                                            <span className={`m-value text-${gsm.class}`}>
                                                                {v.gsm_signal_dbm ? `${v.gsm_signal_dbm} dBm` : '-- dBm'}
                                                            </span>
                                                            <span className="m-subtext">{gsm.label}</span>
                                                        </div>
                                                    </div>

                                                    <div className="metric-diag-item">
                                                        <span className="metric-icon">🛰️</span>
                                                        <div className="metric-content">
                                                            <span className="m-label">GPS Lock</span>
                                                            <span className={`m-value text-${sat.class}`}>
                                                                {v.sat_lock_count || 0} Sats
                                                            </span>
                                                            <span className="m-subtext">{sat.label}</span>
                                                        </div>
                                                    </div>

                                                    <div className="metric-diag-item">
                                                        <span className="metric-icon">⚡</span>
                                                        <div className="metric-content">
                                                            <span className="m-label">Core Voltage</span>
                                                            <span className="m-value text-cyan">
                                                                {calculateVoltage(v.battery_level)} V
                                                            </span>
                                                            <span className="m-subtext">System Bus</span>
                                                        </div>
                                                    </div>

                                                    <div className="metric-diag-item">
                                                        <span className="metric-icon">🔋</span>
                                                        <div className="metric-content">
                                                            <span className="m-label">Backup Battery</span>
                                                            <span className={`m-value ${v.battery_level < 20 ? 'text-danger' : 'text-green'}`}>
                                                                {v.battery_level || 0}%
                                                            </span>
                                                            <span className="m-subtext">Internal Cell</span>
                                                        </div>
                                                    </div>

                                                    <div className="metric-diag-item">
                                                        <span className="metric-icon">🔑</span>
                                                        <div className="metric-content">
                                                            <span className="m-label">Ignition State</span>
                                                            <span className={`m-value ${v.is_locked ? 'text-danger' : 'text-green'}`}>
                                                                {v.is_locked ? 'CUT (OFF)' : 'RUNNING (ON)'}
                                                            </span>
                                                            <span className="m-subtext">Engine Relay</span>
                                                        </div>
                                                    </div>

                                                    <div className="metric-diag-item">
                                                        <span className="metric-icon">🛡️</span>
                                                        <div className="metric-content">
                                                            <span className="m-label">Web Cloud Lock</span>
                                                            <span className={`m-value ${v.cloud_locked ? 'text-danger' : 'text-green'}`}>
                                                                {v.cloud_locked ? 'LOCKED' : 'UNLOCKED'}
                                                            </span>
                                                            <span className="m-subtext">NVM/EEPROM Status</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* GEOFENCES BRIEF */}
                                                <div className="brief-section-diagnostics">
                                                    <h5>SAFE ZONES ({v.geofences ? v.geofences.length : 0})</h5>
                                                    {v.geofences && v.geofences.length > 0 ? (
                                                        <div className="geofence-badges-list">
                                                            {v.geofences.map(g => (
                                                                <span key={g.id} className="diag-badge-item">
                                                                    ⭕ Circle ({g.radius}m)
                                                                </span>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <p className="no-items-text">No active geofence boundaries configured.</p>
                                                    )}
                                                </div>

                                                {/* MAINTENANCE BRIEF */}
                                                <div className="brief-section-diagnostics">
                                                    <h5>MAINTENANCE REMINDERS ({v.maintenance ? v.maintenance.length : 0})</h5>
                                                    {v.maintenance && v.maintenance.length > 0 ? (
                                                        <div className="maintenance-bullets">
                                                            {v.maintenance.map(m => (
                                                                <div key={m.id} className="diag-bullet-row">
                                                                    <span className={`bullet-indicator ${m.status === 'DUE' ? 'due' : 'ok'}`}></span>
                                                                    <span className="bullet-text">
                                                                        {m.type === 'custom' ? m.custom_name : m.type}:{' '}
                                                                        <strong>{m.status}</strong>
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <p className="no-items-text">No pending service alerts.</p>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                            </div>
                        </div>
                    </div>
                </main>
            )}
        </div>
    );
}
