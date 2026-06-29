import React, { useState } from 'react';
import axios from 'axios';
import './AddVehicleModal.css';

export default function AddVehicleModal({ user, onClose, onVehicleAdded }) {
    const API_BASE = import.meta.env.VITE_API_URL || '';

    const [deviceId, setDeviceId] = useState('');
    const [name, setName] = useState('');
    const [plateNumber, setPlateNumber] = useState('');
    const [driverName, setDriverName] = useState('');
    const [vehicleType, setVehicleType] = useState('car');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        const cleanId = deviceId.trim().toUpperCase();
        const cleanName = name.trim();
        const cleanPlate = plateNumber.trim().toUpperCase();
        const cleanDriver = driverName.trim();

        // Client-side format validation
        const idPattern = /^((MOTO|SAFEBOX)_\d{3}|\d{15})$/;
        if (!idPattern.test(cleanId)) {
            setError('Invalid ID Format. Must be MOTO_XXX, SAFEBOX_XXX, or a 15-digit IMEI number.');
            setLoading(false);
            return;
        }

        try {
            await axios.post(`${API_BASE}/api/vehicles`, {
                id: cleanId,
                name: cleanName || `Vehicle ${cleanId}`,
                plateNumber: cleanPlate || null,
                driverName: cleanDriver || null,
                vehicleType,
                ownerId: user.id
            });

            onVehicleAdded(); // Notify main dashboard to refresh list
            onClose(); // Close modal
        } catch (err) {
            console.error("Add vehicle error:", err);
            setError(err.response?.data?.error || 'Failed to register vehicle. ID may already be claimed.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="add-vehicle-overlay">
            <div className="add-vehicle-modal-card">
                <header className="modal-header">
                    <h3>➕ Register New Vehicle</h3>
                    <button className="close-btn" onClick={onClose}>✕</button>
                </header>
 
                {error && <div className="modal-error">{error}</div>}
 
                <form onSubmit={handleSubmit} className="modal-form">
                    <div className="form-group">
                        <label>Device ID <span className="required">*</span></label>
                        <input 
                            type="text" 
                            value={deviceId} 
                            onChange={(e) => setDeviceId(e.target.value)} 
                            placeholder="e.g. MOTO_001, SAFEBOX_001, or 15-digit IMEI"
                            required
                        />
                        <small className="help-text">Must match MOTO_XXX, SAFEBOX_XXX, or a 15-digit IMEI number.</small>
                    </div>

                    <div className="form-group">
                        <label>Vehicle Name</label>
                        <input 
                            type="text" 
                            value={name} 
                            onChange={(e) => setName(e.target.value)} 
                            placeholder="e.g. Delivery Bike 1"
                        />
                    </div>

                    <div className="form-group">
                        <label>License Plate Number</label>
                        <input 
                            type="text" 
                            value={plateNumber} 
                            onChange={(e) => setPlateNumber(e.target.value)} 
                            placeholder="e.g. RAD 124 C"
                        />
                    </div>

                    <div className="form-group">
                        <label>Driver Name</label>
                        <input 
                            type="text" 
                            value={driverName} 
                            onChange={(e) => setDriverName(e.target.value)} 
                            placeholder="e.g. John Doe"
                        />
                    </div>

                    <div className="form-group">
                        <label>Vehicle Type</label>
                        <select 
                            value={vehicleType} 
                            onChange={(e) => setVehicleType(e.target.value)}
                            style={{ 
                                width: '100%', 
                                padding: '0.75rem', 
                                borderRadius: '0.5rem', 
                                background: '#1e293b', 
                                border: '1px solid rgba(255, 255, 255, 0.1)', 
                                color: 'white',
                                outline: 'none'
                            }}
                        >
                            <option value="car">🚗 Car</option>
                            <option value="motorcycle">🏍️ Motorcycle</option>
                            <option value="tricycle">🛺 Tricycle (Keke)</option>
                            <option value="bus">🚌 Bus</option>
                            <option value="truck">🚚 Truck</option>
                            <option value="van">🚐 Van</option>
                        </select>
                    </div>

                    <footer className="modal-footer">
                        <button type="button" className="cancel-btn" onClick={onClose}>Cancel</button>
                        <button type="submit" className="submit-btn" disabled={loading}>
                            {loading ? 'Registering...' : 'Register Vehicle'}
                        </button>
                    </footer>
                </form>
            </div>
        </div>
    );
}
