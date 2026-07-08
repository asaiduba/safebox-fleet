import React from 'react';
import { KeyIcon, SignalIcon } from './Icons';

export default function BleSettings({
    bleSuccess,
    bleError,
    handleSaveBleSettings,
    bleVehicleId,
    setBleVehicleId,
    bleBeaconId,
    setBleBeaconId,
    bleBeaconRssiThreshold,
    setBleBeaconRssiThreshold,
    bleLoading,
    vehicles = [],
    billingVehicles = [],
    estimateDistance
}) {
    return (
        <div className="settings-form">
            <div className="form-section">
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <KeyIcon size={20} /> BLE Keyless Entry (Passive Proximity) Configuration
                </h3>
                <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '1.5rem', lineHeight: '1.4' }}>
                    Link a driver's wireless BLE Keyfob (beacon) to the vehicle tracker. 
                    The tracker will automatically unlock the starter circuit when the keyfob is detected nearby (within your set RSSI threshold) and lock it when they walk away. 
                    Cloud overrides (remote locks and curfew hours) take precedence over the proximity unlock.
                </p>

                {bleSuccess && <div className="status-alert success">{bleSuccess}</div>}
                {bleError && <div className="status-alert error">{bleError}</div>}

                <form onSubmit={handleSaveBleSettings}>
                    <div className="form-group-row">
                        <div className="form-group">
                            <label>Select Vehicle to Configure</label>
                            <select 
                                value={bleVehicleId} 
                                onChange={(e) => setBleVehicleId(e.target.value)}
                                style={{ background: '#1e293b', color: 'white', border: '1px solid #475569', padding: '0.6rem', borderRadius: '0.375rem', width: '100%', outline: 'none' }}
                            >
                                {billingVehicles.map(v => (
                                    <option key={v.id} value={v.id}>
                                        {v.name || v.id} ({v.plate_number || 'No Plate'})
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group">
                            <label>BLE Beacon ID / MAC Address</label>
                            <input 
                                type="text" 
                                value={bleBeaconId} 
                                onChange={(e) => setBleBeaconId(e.target.value)} 
                                placeholder="e.g. AA:BB:CC:DD:EE:FF" 
                                style={{ background: '#1e293b', color: 'white', border: '1px solid #475569', padding: '0.6rem', borderRadius: '0.375rem', width: '100%', outline: 'none' }}
                            />
                        </div>
                    </div>

                    <div className="form-group" style={{ marginTop: '1.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                            <label>RSSI Proximity Threshold Sensitivity</label>
                            <span style={{ color: '#3b82f6', fontWeight: 'bold' }}>{bleBeaconRssiThreshold} dBm</span>
                        </div>
                        <input 
                            type="range" 
                            min="-100" 
                            max="-50" 
                            step="1"
                            value={bleBeaconRssiThreshold} 
                            onChange={(e) => setBleBeaconRssiThreshold(parseInt(e.target.value))} 
                            style={{ width: '100%', cursor: 'pointer' }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                            <span>-100 dBm (Far Range - approx. 10m)</span>
                            <span>-80 dBm (Default - approx. 3m)</span>
                            <span>-50 dBm (Close Proximity - approx. 0.5m)</span>
                        </div>
                    </div>

                    {bleBeaconId && bleBeaconId.trim().length > 0 && (() => {
                        const liveVehicle = vehicles.find(v => v.id === bleVehicleId);
                        const liveRssi = liveVehicle?.beaconRssi;
                        const distanceMeters = liveRssi ? estimateDistance(liveRssi) : null;
                        return (
                            <div style={{
                                marginTop: '1.5rem',
                                background: '#0f172a',
                                padding: '1.25rem',
                                borderRadius: '0.5rem',
                                border: '1px solid #334155',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.75rem'
                            }}>
                                <h4 style={{ color: '#f8fafc', margin: 0, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <SignalIcon size={16} /> Live Beacon Proximity Status
                                 </h4>
                                 <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                     <div style={{ background: '#1e293b', padding: '0.75rem', borderRadius: '0.375rem', border: '1px solid #475569' }}>
                                         <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginBottom: '0.25rem' }}>SIGNAL STRENGTH</span>
                                         <span style={{ fontSize: '1.1rem', fontWeight: 'bold', color: liveRssi ? '#3b82f6' : '#94a3b8' }}>
                                             {liveRssi ? `${liveRssi} dBm` : 'No Signal / Offline'}
                                         </span>
                                     </div>
                                     <div style={{ background: '#1e293b', padding: '0.75rem', borderRadius: '0.375rem', border: '1px solid #475569' }}>
                                         <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginBottom: '0.25rem' }}>ESTIMATED DISTANCE</span>
                                         <span style={{ fontSize: '1.1rem', fontWeight: 'bold', color: distanceMeters ? '#10b981' : '#94a3b8' }}>
                                             {distanceMeters !== null ? `~${distanceMeters} meters` : 'Unknown'}
                                         </span>
                                     </div>
                                 </div>

                                 <div style={{
                                     display: 'flex',
                                     alignItems: 'center',
                                     gap: '0.5rem',
                                     background: liveRssi ? (liveRssi >= bleBeaconRssiThreshold ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)') : 'rgba(148, 163, 184, 0.1)',
                                     padding: '0.75rem',
                                     borderRadius: '0.375rem',
                                     border: liveRssi ? (liveRssi >= bleBeaconRssiThreshold ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)') : '1px solid rgba(148, 163, 184, 0.3)',
                                     marginTop: '0.25rem'
                                 }}>
                                     <div style={{
                                         width: '10px',
                                         height: '10px',
                                         borderRadius: '50%',
                                         background: liveRssi ? (liveRssi >= bleBeaconRssiThreshold ? '#10b981' : '#ef4444') : '#94a3b8',
                                         boxShadow: liveRssi && liveRssi >= bleBeaconRssiThreshold ? '0 0 8px #10b981' : 'none'
                                     }} />
                                     <span style={{ fontSize: '0.85rem', fontWeight: '600', color: liveRssi ? (liveRssi >= bleBeaconRssiThreshold ? '#10b981' : '#ef4444') : '#94a3b8' }}>
                                         {liveRssi ? (
                                             liveRssi >= bleBeaconRssiThreshold ? 'KEYFOB DETECTED (Engine Unlocked / DOUT1 Active)' : 'KEYFOB OUT OF RANGE (Engine Immobilized / DOUT1 Inactive)'
                                         ) : (
                                             'Waiting for beacon signal update...'
                                         )}
                                     </span>
                                 </div>
                             </div>
                        );
                    })()}

                    <button 
                        type="submit" 
                        disabled={bleLoading}
                        className="btn-primary"
                        style={{ marginTop: '2rem' }}
                    >
                        {bleLoading ? 'Saving...' : '💾 Save BLE Configurations'}
                    </button>
                </form>
            </div>
        </div>
    );
}
