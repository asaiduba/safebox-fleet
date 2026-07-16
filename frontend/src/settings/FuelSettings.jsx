import React from 'react';
import { FuelIcon, CarIcon } from './Icons';

const CURRENCY_SYMBOLS = {
    'NGN': '₦',
    'USD': '$',
    'EUR': '€',
    'GBP': '£',
    'KES': 'KSh',
    'RWF': 'FRw'
};

export default function FuelSettings({
    fuelError,
    fuelSuccess,
    fuelLoading,
    fuelSettingsList = [],
    selectedFuelVehicles = [],
    setSelectedFuelVehicles,
    bulkFuelType,
    setBulkFuelType,
    bulkFuelEfficiency,
    setBulkFuelEfficiency,
    bulkFuelPrice,
    setBulkFuelPrice,
    handleSaveBulkFuelSettings,
    editingFuelVehicleId,
    setEditingFuelVehicleId,
    fuelType,
    setFuelType,
    fuelEfficiency,
    setFuelEfficiency,
    fuelPrice,
    setFuelPrice,
    minVoltage,
    setMinVoltage,
    maxVoltage,
    setMaxVoltage,
    handleSaveFuelSetting,
    currency
}) {
    return (
        <div className="settings-form fuel-settings-tab">
            <div className="form-section">
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <FuelIcon size={20} /> Fuel & Cost Settings
                </h3>
                <p className="section-subtitle">Configure fuel efficiency profile (km/L), fuel type, and price per liter for each vehicle to generate fuel utilization reports.</p>

                {fuelError && <div className="status-alert error">{fuelError}</div>}
                {fuelSuccess && <div className="status-alert success">{fuelSuccess}</div>}

                {/* Bulk Configuration Bar */}
                {!fuelLoading && fuelSettingsList.length > 0 && (
                    <div className="bulk-fuel-control-bar" style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '1rem',
                        alignItems: 'center',
                        padding: '1rem',
                        background: 'rgba(30, 41, 59, 0.4)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '0.5rem',
                        marginTop: '1.25rem',
                        marginBottom: '1rem',
                        backdropFilter: 'blur(8px)'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <input
                                type="checkbox"
                                id="selectAllFuel"
                                checked={fuelSettingsList.length > 0 && selectedFuelVehicles.length === fuelSettingsList.length}
                                onChange={(e) => {
                                    if (e.target.checked) {
                                        setSelectedFuelVehicles(fuelSettingsList.map(item => item.id));
                                    } else {
                                        setSelectedFuelVehicles([]);
                                    }
                                }}
                                style={{ cursor: 'pointer', transform: 'scale(1.2)', accentColor: '#3b82f6' }}
                            />
                            <label htmlFor="selectAllFuel" style={{ fontSize: '0.85rem', color: '#f8fafc', cursor: 'pointer', fontWeight: 'bold', userSelect: 'none' }}>
                                Select All ({selectedFuelVehicles.length} of {fuelSettingsList.length} selected)
                            </label>
                        </div>

                        {selectedFuelVehicles.length > 0 && (
                            <div className="bulk-edit-fields-container" style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: '0.75rem',
                                alignItems: 'center',
                                background: 'rgba(15, 23, 42, 0.5)',
                                padding: '0.5rem 1rem',
                                borderRadius: '0.375rem',
                                border: '1px solid rgba(255, 255, 255, 0.05)',
                                flex: 1,
                                justifyContent: 'flex-end'
                            }}>
                                <span style={{ fontSize: '0.8rem', color: '#3b82f6', fontWeight: 'bold' }}>Bulk Apply:</span>
                                <select
                                    value={bulkFuelType}
                                    onChange={(e) => setBulkFuelType(e.target.value)}
                                    className="settings-input"
                                    style={{ padding: '0.35rem 0.5rem', borderRadius: '0.25rem', background: '#0f172a', border: '1px solid #334155', color: 'white', fontSize: '0.8rem' }}
                                >
                                    <option value="Premium Petrol">Premium Petrol (PMS)</option>
                                    <option value="Diesel">Diesel (AGO)</option>
                                    <option value="CNG">Compressed Natural Gas (CNG)</option>
                                    <option value="Electric">Electric (EV)</option>
                                </select>

                                <input
                                    type="number"
                                    step="0.1"
                                    placeholder={bulkFuelType === 'Electric' ? "Efficiency (km/kWh)" : "Efficiency (km/L)"}
                                    value={bulkFuelEfficiency}
                                    onChange={(e) => setBulkFuelEfficiency(e.target.value)}
                                    className="settings-input"
                                    style={{ width: '130px', padding: '0.35rem 0.5rem', borderRadius: '0.25rem', background: '#0f172a', border: '1px solid #334155', color: 'white', fontSize: '0.8rem' }}
                                />

                                <input
                                    type="number"
                                    step="0.01"
                                    placeholder={bulkFuelType === 'Electric' ? `Price (${CURRENCY_SYMBOLS[currency] || '₦'}/kWh)` : `Price (${CURRENCY_SYMBOLS[currency] || '₦'}/L)`}
                                    value={bulkFuelPrice}
                                    onChange={(e) => setBulkFuelPrice(e.target.value)}
                                    className="settings-input"
                                    style={{ width: '110px', padding: '0.35rem 0.5rem', borderRadius: '0.25rem', background: '#0f172a', border: '1px solid #334155', color: 'white', fontSize: '0.8rem' }}
                                />

                                <button
                                    type="button"
                                    onClick={handleSaveBulkFuelSettings}
                                    style={{
                                        padding: '0.35rem 0.75rem',
                                        background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '0.25rem',
                                        cursor: 'pointer',
                                        fontWeight: 'bold',
                                        fontSize: '0.8rem',
                                        boxShadow: '0 0 10px rgba(34, 197, 94, 0.3)'
                                    }}
                                >
                                    Apply
                                </button>
                            </div>
                        )}
                    </div>
                )}

                <div className="fuel-settings-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
                    {fuelLoading && <div className="loading-spinner">Loading configurations...</div>}
                    {!fuelLoading && fuelSettingsList.length === 0 && (
                        <p className="no-data-msg">No vehicles available to configure.</p>
                    )}

                    {!fuelLoading && fuelSettingsList.map(item => (
                        <div key={item.id} className="fuel-card glass-panel" style={{ padding: '1rem', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.5rem', background: 'rgba(30, 41, 59, 0.5)' }}>
                            <div className="fuel-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <input
                                        type="checkbox"
                                        checked={selectedFuelVehicles.includes(item.id)}
                                        onChange={(e) => {
                                            if (e.target.checked) {
                                                setSelectedFuelVehicles([...selectedFuelVehicles, item.id]);
                                            } else {
                                                setSelectedFuelVehicles(selectedFuelVehicles.filter(id => id !== item.id));
                                            }
                                        }}
                                        style={{ cursor: 'pointer', accentColor: '#3b82f6' }}
                                    />
                                    <h4 style={{ margin: 0, fontSize: '1rem', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                        <CarIcon size={16} /> {item.name}
                                    </h4>
                                </div>
                                <span className="device-id-badge" style={{ fontSize: '0.7rem', padding: '0.1rem 0.35rem', background: '#3b82f6', color: 'white', borderRadius: '0.25rem', fontWeight: 'bold' }}>{item.id}</span>
                            </div>
                            
                            {editingFuelVehicleId === item.id ? (
                                <div className="fuel-edit-form" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    <div className="form-group">
                                        <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Fuel Type</label>
                                        <select 
                                            value={fuelType} 
                                            onChange={(e) => setFuelType(e.target.value)}
                                            className="settings-input"
                                            style={{ width: '100%', padding: '0.4rem', borderRadius: '0.25rem', background: '#1e293b', border: '1px solid #475569', color: 'white', fontSize: '0.85rem' }}
                                        >
                                            <option value="Premium Petrol">Premium Petrol (PMS)</option>
                                            <option value="Diesel">Diesel (AGO)</option>
                                            <option value="CNG">Compressed Natural Gas (CNG)</option>
                                            <option value="Electric">Electric (EV)</option>
                                        </select>
                                    </div>
                                    
                                    <div className="form-row" style={{ display: 'flex', gap: '0.5rem' }}>
                                        <div className="form-group" style={{ flex: 1 }}>
                                            <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{fuelType === 'Electric' ? 'Efficiency (km/kWh)' : 'Efficiency (km/L)'}</label>
                                            <input 
                                                type="number" 
                                                step="0.1"
                                                value={fuelEfficiency}
                                                onChange={(e) => setFuelEfficiency(e.target.value)}
                                                className="settings-input"
                                                placeholder={fuelType === 'Electric' ? 'e.g. 6.5' : 'e.g. 12'}
                                                style={{ width: '100%', padding: '0.4rem', borderRadius: '0.25rem', background: '#1e293b', border: '1px solid #475569', color: 'white', fontSize: '0.85rem' }}
                                            />
                                        </div>
                                        <div className="form-group" style={{ flex: 1 }}>
                                            <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Price per {fuelType === 'Electric' ? 'kWh' : 'Liter'} ({CURRENCY_SYMBOLS[currency] || '₦'})</label>
                                            <input 
                                                type="number" 
                                                step="0.01"
                                                value={fuelPrice}
                                                onChange={(e) => setFuelPrice(e.target.value)}
                                                className="settings-input"
                                                placeholder={fuelType === 'Electric' ? 'e.g. 150' : 'e.g. 1000'}
                                                style={{ width: '100%', padding: '0.4rem', borderRadius: '0.25rem', background: '#1e293b', border: '1px solid #475569', color: 'white', fontSize: '0.85rem' }}
                                            />
                                        </div>
                                    </div>

                                    <div className="form-group-title" style={{ fontSize: '0.8rem', color: '#3b82f6', fontWeight: 'bold', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.5rem', marginTop: '0.25rem' }}>
                                        Analog Fuel Calibration (AIN1)
                                    </div>
                                    <div className="form-row" style={{ display: 'flex', gap: '0.5rem' }}>
                                        <div className="form-group" style={{ flex: 1 }}>
                                            <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Empty Tank (mV)</label>
                                            <input 
                                                type="number" 
                                                value={minVoltage}
                                                onChange={(e) => setMinVoltage(e.target.value)}
                                                className="settings-input"
                                                placeholder="e.g. 8000"
                                                style={{ width: '100%', padding: '0.4rem', borderRadius: '0.25rem', background: '#1e293b', border: '1px solid #475569', color: 'white', fontSize: '0.85rem' }}
                                            />
                                        </div>
                                        <div className="form-group" style={{ flex: 1 }}>
                                            <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Full Tank (mV)</label>
                                            <input 
                                                type="number" 
                                                value={maxVoltage}
                                                onChange={(e) => setMaxVoltage(e.target.value)}
                                                className="settings-input"
                                                placeholder="e.g. 500"
                                                style={{ width: '100%', padding: '0.4rem', borderRadius: '0.25rem', background: '#1e293b', border: '1px solid #475569', color: 'white', fontSize: '0.85rem' }}
                                            />
                                        </div>
                                    </div>

                                    <div className="fuel-actions" style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                        <button 
                                            type="button" 
                                            className="save-btn"
                                            onClick={() => handleSaveFuelSetting(item.id)}
                                            style={{ flex: 1, padding: '0.4rem', background: '#22c55e', color: 'white', border: 'none', borderRadius: '0.25rem', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem' }}
                                        >
                                            Save
                                        </button>
                                        <button 
                                            type="button" 
                                            className="cancel-btn"
                                            onClick={() => setEditingFuelVehicleId(null)}
                                            style={{ flex: 1, padding: '0.4rem', background: '#64748b', color: 'white', border: 'none', borderRadius: '0.25rem', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem' }}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="fuel-card-details" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                    <div className="detail-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                        <span style={{ color: '#94a3b8' }}>Type:</span>
                                        <strong style={{ color: '#f1f5f9' }}>{item.fuel_type || 'Premium Petrol'}</strong>
                                    </div>
                                    <div className="detail-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                        <span style={{ color: '#94a3b8' }}>Efficiency:</span>
                                        <strong style={{ color: '#f1f5f9' }}>{item.fuel_efficiency || 12.0} {item.fuel_type === 'Electric' ? 'km/kWh' : 'km/L'}</strong>
                                    </div>
                                    <div className="detail-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                                        <span style={{ color: '#94a3b8' }}>Price per {item.fuel_type === 'Electric' ? 'kWh' : 'Liter'}:</span>
                                        <strong style={{ color: '#f1f5f9' }}>{CURRENCY_SYMBOLS[currency] || '₦'}{(item.fuel_price || 1000.0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                                    </div>
                                    
                                    {((item.min_voltage !== undefined && item.min_voltage > 0) || (item.max_voltage !== undefined && item.max_voltage > 0)) && (
                                        <div className="detail-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', borderTop: '1px dashed rgba(255,255,255,0.08)', paddingTop: '0.4rem', marginTop: '0.2rem', marginBottom: '0.4rem' }}>
                                            <span style={{ color: '#94a3b8' }}>Calibration (Empty/Full):</span>
                                            <strong style={{ color: '#3b82f6' }}>{item.min_voltage || 0}mV / {item.max_voltage || 0}mV</strong>
                                        </div>
                                    )}

                                    <button 
                                        type="button" 
                                        className="edit-trigger-btn"
                                        onClick={() => {
                                            setEditingFuelVehicleId(item.id);
                                            setFuelType(item.fuel_type || 'Premium Petrol');
                                            setFuelPrice(item.fuel_price || 1000.0);
                                            setFuelEfficiency(item.fuel_efficiency || 12.0);
                                            setMinVoltage(item.min_voltage || 0);
                                            setMaxVoltage(item.max_voltage || 0);
                                        }}
                                        style={{ width: '100%', padding: '0.4rem', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '0.25rem', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem', marginTop: '0.25rem' }}
                                    >
                                        ✏️ Configure Vehicle
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
