import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './Leaderboard.css';

const API_URL = import.meta.env.VITE_API_URL || '';

const Leaderboard = ({ onBack }) => {
    const [drivers, setDrivers] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchLeaderboard();
    }, []);

    const fetchLeaderboard = async () => {
        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const res = await axios.get(`${API_URL}/api/analytics/leaderboard?userId=${user.id}&role=${user.role}`);
            setDrivers(res.data);
            setLoading(false);
        } catch (err) {
            console.error("Failed to fetch leaderboard", err);
            setLoading(false);
        }
    };

    const getScoreClass = (score) => {
        if (score >= 80) return 'score-high';
        if (score >= 50) return 'score-med';
        return 'score-low';
    };

    if (loading) return (
        <div className="loading-container">
            <span className="loader"></span>
            <p>Loading Leaderboard...</p>
        </div>
    );

    return (
        <div className="leaderboard-container">
            <header className="leaderboard-header">
                <div className="leaderboard-title">
                    <h1>Drivers Leaderboard</h1>
                    <span className="subtitle">Top Performing Vehicles & Safety Scores</span>
                </div>
                <button className="back-btn" onClick={onBack}>
                    ← Back to Dashboard
                </button>
            </header>

            <div className="leaderboard-table-container">
                <table className="leaderboard-table">
                    <thead>
                        <tr>
                            <th>Rank</th>
                            <th>Device ID</th>
                            <th>Status</th>
                            <th>Safety Score</th>
                            <th>Efficiency Score</th>
                        </tr>
                    </thead>
                    <tbody>
                        {drivers.map((driver, index) => (
                            <tr key={driver.id}>
                                <td>
                                    <span className={`rank-badge rank-${index + 1}`}>{index + 1}</span>
                                </td>
                                <td>
                                    <div style={{ fontWeight: 'bold', color: 'white' }}>{driver.id}</div>
                                    <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{driver.name}</div>
                                </td>
                                <td>
                                    <span className={`status-indicator ${driver.status === 'Online' ? 'status-online' : 'status-offline'}`}></span>
                                    {driver.status}
                                </td>
                                <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                        <span style={{ fontWeight: 'bold', minWidth: '30px' }}>{driver.safetyScore}</span>
                                        <div className="score-bar-container">
                                            <div
                                                className={`score-bar ${getScoreClass(driver.safetyScore)}`}
                                                style={{ width: `${driver.safetyScore}%` }}
                                            ></div>
                                        </div>
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
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default Leaderboard;
