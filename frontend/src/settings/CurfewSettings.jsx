import React from 'react';
import { ClockIcon, LockIcon } from './Icons';

export default function CurfewSettings({
    curfewEnabled,
    setCurfewEnabled,
    curfewStart,
    setCurfewStart,
    curfewEnd,
    setCurfewEnd,
    curfewDays,
    setCurfewDays,
    curfewAllowOverride,
    setCurfewAllowOverride,
    curfewHolidayMode,
    setCurfewHolidayMode,
    applyTo,
    setApplyTo,
    selectedCurfewVehicleIds,
    handleCurfewVehicleToggle,
    handleSelectAllCurfew,
    handleApplyCurfew,
    curfewLoading,
    curfewMsg,
    billingVehicles = []
}) {
    return (
        <div className="form-section admin-section curfew-section">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ClockIcon size={20} /> Vehicle Access Policy (Operating Hours)
            </h3>
            <p className="section-subtitle font-admin">
                Configure fleet operating hours. New engine starts outside allowed times or on unselected days will be blocked, and drivers can request real-time overrides from managers.
            </p>

            {curfewMsg.text && (
                <div className={`status-alert ${curfewMsg.type}`} style={{ marginBottom: '1.25rem' }}>
                    {curfewMsg.text}
                </div>
            )}

            <div className="toggle-group" style={{ marginBottom: '1.5rem' }}>
                <div className="toggle-item">
                    <div className="toggle-info">
                        <span className="toggle-title">Enable Operating Hours Restriction</span>
                        <span className="toggle-desc">Immobilize selected vehicles outside allowed times/days.</span>
                    </div>
                    <label className="switch">
                        <input 
                            type="checkbox" 
                            checked={curfewEnabled} 
                            onChange={(e) => setCurfewEnabled(e.target.checked)} 
                        />
                        <span className="slider round"></span>
                    </label>
                </div>
            </div>

            <div className="form-group-row" style={{ marginBottom: '1.5rem' }}>
                <div className="form-group">
                    <label>Allowed Operations Start Time</label>
                    <input 
                        type="time" 
                        value={curfewStart}
                        onChange={(e) => setCurfewStart(e.target.value)}
                        className="styled-time-input"
                        disabled={!curfewEnabled}
                    />
                </div>
                <div className="form-group">
                    <label>Allowed Operations End Time</label>
                    <input 
                        type="time" 
                        value={curfewEnd}
                        onChange={(e) => setCurfewEnd(e.target.value)}
                        className="styled-time-input"
                        disabled={!curfewEnabled}
                    />
                </div>
            </div>

            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label style={{ marginBottom: '0.5rem', display: 'block' }}>Active Policy Days</label>
                <div className="days-selector-row" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => {
                        const isActive = curfewDays.includes(day);
                        return (
                            <button
                                type="button"
                                key={day}
                                className={`day-pill-btn ${isActive ? 'active' : ''}`}
                                onClick={() => {
                                    if (isActive) {
                                        setCurfewDays(curfewDays.filter(d => d !== day));
                                    } else {
                                        setCurfewDays([...curfewDays, day]);
                                    }
                                }}
                                disabled={!curfewEnabled}
                                style={{
                                    padding: '0.4rem 1rem',
                                    border: isActive ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: '2rem',
                                    background: isActive ? 'rgba(59,130,246,0.2)' : 'transparent',
                                    color: isActive ? '#60a5fa' : '#94a3b8',
                                    cursor: curfewEnabled ? 'pointer' : 'default',
                                    fontWeight: 'bold',
                                    transition: 'all 0.2s ease',
                                    opacity: curfewEnabled ? 1 : 0.5
                                }}
                            >
                                {day}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="toggle-group" style={{ marginBottom: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="toggle-item" style={{ border: '1px solid rgba(255,255,255,0.05)', padding: '0.75rem', borderRadius: '0.5rem' }}>
                    <div className="toggle-info">
                        <span className="toggle-title" style={{ fontSize: '0.9rem' }}>Allow Manager Overrides</span>
                        <span className="toggle-desc" style={{ fontSize: '0.75rem' }}>Drivers can request start codes.</span>
                    </div>
                    <label className="switch">
                        <input 
                            type="checkbox" 
                            checked={curfewAllowOverride} 
                            onChange={(e) => setCurfewAllowOverride(e.target.checked)} 
                            disabled={!curfewEnabled}
                        />
                        <span className="slider round"></span>
                    </label>
                </div>
                <div className="toggle-item" style={{ border: '1px solid rgba(255,255,255,0.05)', padding: '0.75rem', borderRadius: '0.5rem' }}>
                    <div className="toggle-info">
                        <span className="toggle-title" style={{ fontSize: '0.9rem' }}>Holiday Restrict Mode</span>
                        <span className="toggle-desc" style={{ fontSize: '0.75rem' }}>Block starting on holidays.</span>
                    </div>
                    <label className="switch">
                        <input 
                            type="checkbox" 
                            checked={curfewHolidayMode} 
                            onChange={(e) => setCurfewHolidayMode(e.target.checked)} 
                            disabled={!curfewEnabled}
                        />
                        <span className="slider round"></span>
                    </label>
                </div>
            </div>

            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label style={{ marginBottom: '0.5rem', display: 'block' }}>Apply Access Policy To</label>
                <div style={{ display: 'flex', gap: '2rem', marginTop: '0.25rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: curfewEnabled ? 'pointer' : 'default', opacity: curfewEnabled ? 1 : 0.5 }}>
                        <input 
                            type="radio" 
                            name="applyTo" 
                            value="all" 
                            checked={applyTo === 'all'} 
                            onChange={() => curfewEnabled && setApplyTo('all')}
                            disabled={!curfewEnabled}
                        />
                        <span>All Vehicles</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: curfewEnabled ? 'pointer' : 'default', opacity: curfewEnabled ? 1 : 0.5 }}>
                        <input 
                            type="radio" 
                            name="applyTo" 
                            value="selected" 
                            checked={applyTo === 'selected'} 
                            onChange={() => curfewEnabled && setApplyTo('selected')}
                            disabled={!curfewEnabled}
                        />
                        <span>Selected Vehicles</span>
                    </label>
                </div>
            </div>

            {applyTo === 'selected' && (
                <div className="curfew-vehicles-checklist" style={{ animation: 'fadeIn 0.3s ease' }}>
                    <div className="billing-header-row" style={{ padding: '0 0.5rem 0.5rem 0.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)', marginBottom: '0.75rem' }}>
                        <button 
                            type="button" 
                            className="select-all-btn"
                            onClick={handleSelectAllCurfew}
                            disabled={!curfewEnabled}
                        >
                            {selectedCurfewVehicleIds.size === billingVehicles.length ? 'Deselect All' : 'Select All'}
                        </button>
                        <span className="selected-count-label">
                            Selected: <strong>{selectedCurfewVehicleIds.size}</strong> / {billingVehicles.length} vehicles
                        </span>
                    </div>

                    {billingVehicles.length === 0 ? (
                        <p className="no-vehicles-text" style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8' }}>
                            No vehicles registered. Register vehicles to manage access policies.
                        </p>
                    ) : (
                        <div className="curfew-vehicles-grid">
                            {billingVehicles.map(v => {
                                const isChecked = selectedCurfewVehicleIds.has(v.id);
                                return (
                                    <div 
                                        key={v.id} 
                                        className={`curfew-vehicle-card ${isChecked ? 'selected' : ''} ${!curfewEnabled ? 'disabled' : ''}`}
                                        onClick={() => curfewEnabled && handleCurfewVehicleToggle(v.id)}
                                    >
                                        <div className="card-left">
                                            <input 
                                                type="checkbox" 
                                                checked={isChecked}
                                                disabled={!curfewEnabled}
                                                onChange={() => {}} 
                                            />
                                            <div className="card-meta">
                                                <span className="v-name">{v.name}</span>
                                                <span className="v-id">{v.id} {v.plate_number ? `• ${v.plate_number}` : ''}</span>
                                            </div>
                                        </div>
                                        <div className="card-right">
                                            {v.curfew_enabled ? (
                                                <span className="curfew-badge active" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                    <ClockIcon size={12} /> Active
                                                </span>
                                            ) : (
                                                <span className="curfew-badge inactive" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                    <LockIcon size={12} /> Off
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            <div className="curfew-action-row" style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
                <button 
                    type="button" 
                    className="btn-primary"
                    onClick={handleApplyCurfew}
                    disabled={curfewLoading}
                >
                    {curfewLoading ? 'Applying...' : 'Apply Access Policy'}
                </button>
            </div>
        </div>
    );
}
