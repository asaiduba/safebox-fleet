import React from 'react';

export default function SafetySettings({
    speedLimit,
    setSpeedLimit,
    brakingThreshold,
    setBrakingThreshold,
    corneringThreshold,
    setCorneringThreshold,
    handleSave,
    loading,
    user
}) {
    if (user.role !== 'company') return null;

    return (
        <form onSubmit={handleSave} style={{ marginBottom: '2rem' }}>
            <div className="form-section admin-section">
                <h3>🛡️ Admin Safety Thresholds</h3>
                <p className="section-subtitle font-admin">Configure dynamic G-Force and speed triggers for safety scoring.</p>

                <div className="slider-group">
                    <div className="slider-item">
                        <div className="slider-header">
                            <span className="slider-title">Speed Limit Threshold</span>
                            <span className="slider-value">{speedLimit} km/h</span>
                        </div>
                        <input 
                            type="range" 
                            min="60" 
                            max="140" 
                            value={speedLimit} 
                            onChange={(e) => setSpeedLimit(Number(e.target.value))} 
                            className="styled-range"
                        />
                    </div>

                    <div className="slider-item">
                        <div className="slider-header">
                            <span className="slider-title">Harsh Braking Sensitivity</span>
                            <span className="slider-value">{brakingThreshold} g</span>
                        </div>
                        <input 
                            type="range" 
                            min="0.20" 
                            max="0.50" 
                            step="0.01" 
                            value={brakingThreshold} 
                            onChange={(e) => setBrakingThreshold(Number(e.target.value))} 
                            className="styled-range"
                        />
                    </div>

                    <div className="slider-item">
                        <div className="slider-header">
                            <span className="slider-title">Harsh Cornering Sensitivity</span>
                            <span className="slider-value">{corneringThreshold} g</span>
                        </div>
                        <input 
                            type="range" 
                            min="0.25" 
                            max="0.50" 
                            step="0.01" 
                            value={corneringThreshold} 
                            onChange={(e) => setCorneringThreshold(Number(e.target.value))} 
                            className="styled-range"
                        />
                    </div>
                </div>
            </div>
            <footer className="settings-footer" style={{ padding: '1rem 0', background: 'transparent', borderTop: '1px solid rgba(255,255,255,0.05)', marginBottom: '2rem' }}>
                <button type="submit" className="save-btn" disabled={loading}>
                    {loading ? 'Saving...' : 'Save Safety Thresholds'}
                </button>
            </footer>
        </form>
    );
}
