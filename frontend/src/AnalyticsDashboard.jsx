const API_BASE = import.meta.env.VITE_API_URL || '';
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import './AnalyticsDashboard.css';
import Leaderboard from './Leaderboard';
import { BarChartIcon, TrendingUpIcon } from './settings/Icons';

const AnalyticsDashboard = ({ onBack, onOpenReports }) => {
    const [stats, setStats] = useState(null);
    const [history, setHistory] = useState([]);
    const [vehicles, setVehicles] = useState([]);
    const [selectedVehicleId, setSelectedVehicleId] = useState(null);
    const [timeRange, setTimeRange] = useState('24h');
    const [activeTab, setActiveTab] = useState('insights');

    const fetchStats = useCallback(async () => {
        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const res = await axios.get(`${API_BASE}/api/analytics/stats?userId=${user.id}&role=${user.role}`);
            setStats(res.data);
        } catch (err) {
            console.error("Failed to fetch stats", err);
        }
    }, []);

    const fetchVehicles = useCallback(async () => {
        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const res = await axios.get(`${API_BASE}/api/vehicles?userId=${user.id}&role=${user.role}`);
            setVehicles(res.data);
            if (res.data.length > 0) setSelectedVehicleId(res.data[0].id);
        } catch (err) {
            console.error("Failed to fetch vehicles", err);
        }
    }, []);

    const fetchHistory = useCallback(async (vehicleId) => {
        try {
            const res = await axios.get(`${API_BASE}/api/analytics/history/${vehicleId}?range=${timeRange}`);
            const formattedData = res.data.map(d => ({
                ...d,
                time: new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }));
            setHistory(formattedData);
        } catch (err) {
            console.error("Failed to fetch history", err);
        }
    }, [timeRange]);

    const handleExportCSV = async () => {
        if (!selectedVehicleId) return;
        try {
            const token = localStorage.getItem('token');
            let startTimestamp = 0;
            if (timeRange === '24h') {
                startTimestamp = Date.now() - 24 * 60 * 60 * 1000;
            } else if (timeRange === '7d') {
                startTimestamp = Date.now() - 7 * 24 * 60 * 60 * 1000;
            }

            const response = await axios.get(`${API_BASE}/api/exports/travel-history`, {
                params: {
                    vehicleId: selectedVehicleId,
                    startDate: startTimestamp,
                    endDate: Date.now()
                },
                headers: {
                    Authorization: `Bearer ${token}`
                },
                responseType: 'blob'
            });

            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `travel_history_${selectedVehicleId}_${timeRange}.csv`);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (err) {
            console.error("Failed to export travel history CSV", err);
            alert("Failed to export travel history CSV");
        }
    };

    useEffect(() => {
        Promise.resolve().then(() => {
            fetchStats();
            fetchVehicles();
        });
    }, [fetchStats, fetchVehicles]);

    useEffect(() => {
        if (selectedVehicleId) {
            Promise.resolve().then(() => {
                fetchHistory(selectedVehicleId);
            });
        }
    }, [selectedVehicleId, fetchHistory]);

    if (!stats) return (
        <div className="analytics-container" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', minHeight: '100vh', background: '#0f172a', color: 'white' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="skeleton-card" style={{ width: '250px', height: '40px', padding: '0.5rem', background: 'transparent', border: 'none' }}>
                    <div className="skeleton-title skeleton-shimmer" style={{ width: '80%', height: '24px' }} />
                </div>
                <div className="skeleton-card" style={{ width: '100px', height: '40px', padding: '0.5rem', background: 'transparent', border: 'none' }}>
                    <div className="skeleton-title skeleton-shimmer" style={{ width: '100%', height: '32px', borderRadius: '8px' }} />
                </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="skeleton-card">
                        <div className="skeleton-title skeleton-shimmer" style={{ width: '60%' }} />
                        <div className="skeleton-value skeleton-shimmer" style={{ width: '40%', marginTop: '0.5rem' }} />
                        <div className="skeleton-desc skeleton-shimmer" style={{ width: '80%', marginTop: '0.5rem' }} />
                    </div>
                ))}
            </div>
            <div className="skeleton-card" style={{ height: '320px', width: '100%' }}>
                <div className="skeleton-title skeleton-shimmer" style={{ width: '30%', height: '20px' }} />
                <div className="skeleton-value skeleton-shimmer" style={{ width: '100%', height: '80%', marginTop: '1rem' }} />
            </div>
        </div>
    );

    return (
        <div className="analytics-container">
            <header className="analytics-header">
                <div className="header-title">
                    <h1>Business Analytics</h1>
                    <span className="subtitle">Fleet Performance & Insights</span>
                </div>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    {onOpenReports && (
                        <button
                            className="reports-btn-analytics"
                            onClick={onOpenReports}
                            style={{
                                background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
                                border: 'none',
                                padding: '0.5rem 1rem',
                                borderRadius: '6px',
                                color: 'white',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                fontSize: '0.9rem',
                                transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.boxShadow = '0 0 12px rgba(139, 92, 246, 0.6)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.boxShadow = 'none';
                            }}
                        >
                            <BarChartIcon size={16} /> Reports
                        </button>
                    )}
                    <div className="analytics-tabs" style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.05)', padding: '4px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <button
                            className={`tab-btn ${activeTab === 'insights' ? 'active' : ''}`}
                            onClick={() => setActiveTab('insights')}
                            style={{
                                background: activeTab === 'insights' ? '#3b82f6' : 'transparent',
                                border: 'none',
                                color: 'white',
                                padding: '0.4rem 0.8rem',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                transition: 'all 0.2s ease',
                                fontSize: '0.9rem'
                            }}
                        >
                            <TrendingUpIcon size={16} /> Insights
                        </button>
                        <button
                            className={`tab-btn ${activeTab === 'leaderboard' ? 'active' : ''}`}
                            onClick={() => setActiveTab('leaderboard')}
                            style={{
                                background: activeTab === 'leaderboard' ? '#8b5cf6' : 'transparent',
                                border: 'none',
                                color: 'white',
                                padding: '0.4rem 0.8rem',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                transition: 'all 0.2s ease',
                                fontSize: '0.9rem'
                            }}
                        >
                            🏆 Leaderboard
                        </button>
                    </div>
                    <button className="back-btn" onClick={onBack}>
                        ← Back to Fleet
                    </button>
                </div>
            </header>

            {activeTab === 'insights' ? (
                <>
                    <div className="stats-grid">
                        <div className="stat-card">
                            <h3>Total Fleet</h3>
                            <div className="value">{stats.totalVehicles}</div>
                            <div className="trend">Vehicles Registered</div>
                        </div>
                        <div className="stat-card">
                            <h3>Active Now</h3>
                            <div className="value active">{stats.activeVehicles}</div>
                            <div className="trend">Online & Moving</div>
                        </div>
                        <div className="stat-card">
                            <h3>Critical Alerts</h3>
                            <div className="value alert">{stats.criticalAlerts}</div>
                            <div className="trend">Low Fuel / Battery</div>
                        </div>
                        <div className="stat-card">
                            <h3>Avg. Fuel Level</h3>
                            <div className="value">{stats.avgFuel}%</div>
                            <div className="trend">Fleet Efficiency</div>
                        </div>
                        <div className="stat-card">
                            <h3>Avg. Safety Score</h3>
                            <div className="value" style={{ color: stats.avgSafety >= 80 ? '#10b981' : '#f59e0b' }}>
                                {stats.avgSafety}
                            </div>
                            <div className="trend">Driver Behavior</div>
                        </div>
                    </div>

                    <div className="charts-section">
                        <div className="chart-controls">
                            <select
                                value={selectedVehicleId || ''}
                                onChange={(e) => setSelectedVehicleId(e.target.value)}
                                className="vehicle-select"
                            >
                                {vehicles.map(v => (
                                    <option key={v.id} value={v.id}>{v.name} ({v.id})</option>
                                ))}
                            </select>
                            <div className="range-toggle" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <button
                                    className={timeRange === '24h' ? 'active' : ''}
                                    onClick={() => setTimeRange('24h')}
                                >24 Hours</button>
                                <button
                                    className={timeRange === '7d' ? 'active' : ''}
                                    onClick={() => setTimeRange('7d')}
                                >7 Days</button>

                            </div>
                        </div>

                        <div className="main-chart">
                            <h3>Fuel & Battery Trends</h3>
                            <ResponsiveContainer width="100%" height={350}>
                                <LineChart data={history}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" />
                                    <XAxis dataKey="time" stroke="#aaa" />
                                    <YAxis stroke="#aaa" />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }}
                                        itemStyle={{ color: '#fff' }}
                                    />
                                    <Line type="monotone" dataKey="fuel_level" stroke="#3b82f6" strokeWidth={3} name="Fuel %" dot={false} />
                                    <Line type="monotone" dataKey="battery_level" stroke="#10b981" strokeWidth={3} name="Battery %" dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>

                        <div className="secondary-charts">
                            <div className="chart-card">
                                <h3>Speed Analysis</h3>
                                <ResponsiveContainer width="100%" height={250}>
                                    <LineChart data={history}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" />
                                        <XAxis dataKey="time" stroke="#aaa" hide />
                                        <YAxis stroke="#aaa" />
                                        <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none' }} />
                                        <Line type="step" dataKey="speed" stroke="#f59e0b" strokeWidth={2} name="Speed (km/h)" dot={false} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>
                </>
            ) : (
                <Leaderboard embedMode={true} />
            )}
        </div>
    );
};

export default AnalyticsDashboard;
