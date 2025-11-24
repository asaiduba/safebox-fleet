import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import './AnalyticsDashboard.css';
import Leaderboard from './Leaderboard';

const AnalyticsDashboard = ({ onBack }) => {
    const [stats, setStats] = useState(null);
    const [history, setHistory] = useState([]);
    const [vehicles, setVehicles] = useState([]);
    const [selectedVehicleId, setSelectedVehicleId] = useState(null);
    const [timeRange, setTimeRange] = useState('24h');
    const [showLeaderboard, setShowLeaderboard] = useState(false);

    useEffect(() => {
        fetchStats();
        fetchVehicles();
    }, []);

    useEffect(() => {
        if (selectedVehicleId) {
            fetchHistory(selectedVehicleId);
        }
    }, [selectedVehicleId, timeRange]);

    const fetchStats = async () => {
        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const res = await axios.get(`http://localhost:3000/api/analytics/stats?userId=${user.id}&role=${user.role}`);
            setStats(res.data);
        } catch (err) {
            console.error("Failed to fetch stats", err);
        }
    };

    const fetchVehicles = async () => {
        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const res = await axios.get(`http://localhost:3000/api/vehicles?userId=${user.id}&role=${user.role}`);
            setVehicles(res.data);
            if (res.data.length > 0) setSelectedVehicleId(res.data[0].id);
        } catch (err) {
            console.error("Failed to fetch vehicles", err);
        }
    };

    const fetchHistory = async (vehicleId) => {
        try {
            const res = await axios.get(`http://localhost:3000/api/analytics/history/${vehicleId}?range=${timeRange}`);
            const formattedData = res.data.map(d => ({
                ...d,
                time: new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }));
            setHistory(formattedData);
        } catch (err) {
            console.error("Failed to fetch history", err);
        }
    };

    if (showLeaderboard) {
        return <Leaderboard onBack={() => setShowLeaderboard(false)} />;
    }

    if (!stats) return <div className="loading">Loading Analytics...</div>;

    return (
        <div className="analytics-container">
            <header className="analytics-header">
                <div className="header-title">
                    <h1>Business Analytics</h1>
                    <span className="subtitle">Fleet Performance & Insights</span>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button
                        className="back-btn"
                        onClick={() => setShowLeaderboard(true)}
                        style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none' }}
                    >
                        🏆 Leaderboard
                    </button>
                    <button className="back-btn" onClick={onBack}>
                        ← Back to Fleet
                    </button>
                </div>
            </header>

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
                    <div className="range-toggle">
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
        </div>
    );
};

export default AnalyticsDashboard;
