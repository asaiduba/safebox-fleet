import React from 'react';

export default function MaintenanceSettings({
    selectedVehicleId,
    setSelectedVehicleId,
    setEditingReminderId,
    billingVehicles = [],
    handleSaveMaintenanceReminder,
    editingReminderId,
    reminderType,
    setReminderType,
    customName,
    setCustomName,
    thresholdKm,
    setThresholdKm,
    lastServiceKm,
    setLastServiceKm,
    dueDate,
    setDueDate,
    notes,
    setNotes,
    maintenanceLoading,
    maintenanceReminders = [],
    handleToggleReminderStatus,
    handleStartEditReminder,
    handleDeleteMaintenanceReminder,
    maintenanceSuccess,
    maintenanceError
}) {
    return (
        <div className="settings-form">
            <div className="form-section">
                <h3>🛠️ Maintenance Alerts Scheduler</h3>
                <p className="section-subtitle">
                    Configure automated distance-based or date-based service reminders. Email notifications will automatically alert you when maintenance is due.
                </p>

                {maintenanceSuccess && <div className="status-alert success">{maintenanceSuccess}</div>}
                {maintenanceError && <div className="status-alert error">{maintenanceError}</div>}

                <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                    <label>Select Vehicle to Manage Reminders</label>
                    <select 
                        value={selectedVehicleId} 
                        onChange={(e) => {
                            setSelectedVehicleId(e.target.value);
                            setEditingReminderId(null);
                        }}
                        className="styled-select"
                    >
                        {billingVehicles.map(v => (
                            <option key={v.id} value={v.id}>
                                {v.name} ({v.id}) {v.plate_number ? `- ${v.plate_number}` : ''}
                            </option>
                        ))}
                    </select>
                </div>

                {/* CREATE/EDIT REMINDER FORM */}
                <form onSubmit={handleSaveMaintenanceReminder} className="reminder-creation-form">
                    <h4>{editingReminderId ? '✏️ Edit Reminder' : '➕ Create Maintenance Reminder'}</h4>
                    
                    <div className="form-group-row">
                        <div className="form-group">
                            <label>Reminder Type</label>
                            <select 
                                value={reminderType}
                                onChange={(e) => setReminderType(e.target.value)}
                                className="styled-select"
                            >
                                <option value="Oil Change">Oil Change 🛢️</option>
                                <option value="Brake Service">Brake Service 🛑</option>
                                <option value="Tire Change">Tire Change 🛞</option>
                                <option value="Insurance">Insurance 📄</option>
                                <option value="Road Worthiness">Road Worthiness 🛣️</option>
                                <option value="Vehicle License">Vehicle License 💳</option>
                                <option value="Custom">Custom ⚙️</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Custom Label / Name (Optional)</label>
                            <input 
                                type="text" 
                                value={customName}
                                onChange={(e) => setCustomName(e.target.value)}
                                placeholder={reminderType === 'Custom' ? 'e.g. Battery replacement' : 'e.g. Front axle brake pads'}
                            />
                        </div>
                    </div>

                    <div className="form-group-row">
                        <div className="form-group">
                            <label>Mileage Threshold (km)</label>
                            <input 
                                type="number" 
                                value={thresholdKm}
                                onChange={(e) => setThresholdKm(e.target.value)}
                                placeholder="e.g. 10000"
                                min="0"
                            />
                        </div>
                        <div className="form-group">
                            <label>Last Service Mileage (km)</label>
                            <input 
                                type="number" 
                                value={lastServiceKm}
                                onChange={(e) => setLastServiceKm(e.target.value)}
                                placeholder="e.g. 5000"
                                min="0"
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <label>Target Due Date</label>
                        <input 
                            type="date" 
                            value={dueDate}
                            onChange={(e) => setDueDate(e.target.value)}
                        />
                    </div>

                    <div className="form-group">
                        <label>Notes & Extra Details</label>
                        <textarea 
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Add instructions, service center info, or part numbers..."
                            className="styled-textarea"
                            rows="3"
                        />
                    </div>

                    <div className="reminder-form-actions">
                        {editingReminderId && (
                            <button 
                                type="button" 
                                className="cancel-reminder-btn"
                                onClick={() => {
                                    setEditingReminderId(null);
                                    setReminderType('Oil Change');
                                    setCustomName('');
                                    setThresholdKm('');
                                    setLastServiceKm('');
                                    setDueDate('');
                                    setNotes('');
                                }}
                            >
                                Cancel
                            </button>
                        )}
                        <button 
                            type="submit" 
                            className="save-reminder-btn"
                            disabled={maintenanceLoading}
                        >
                            {editingReminderId ? 'Update Reminder' : 'Add Reminder'}
                        </button>
                    </div>
                </form>

                {/* ACTIVE REMINDERS LIST */}
                <div className="active-reminders-section" style={{ marginTop: '2rem' }}>
                    <h4>📋 Active Fleet Reminders ({maintenanceReminders.length})</h4>
                    
                    {maintenanceReminders.length === 0 ? (
                        <p className="no-reminders-msg">No active reminders configured for this vehicle.</p>
                    ) : (
                        <div className="reminders-list">
                            {maintenanceReminders.map(rem => (
                                <div key={rem.id} className={`reminder-card ${rem.status.toLowerCase()}`}>
                                    <div className="reminder-card-header">
                                        <div className="reminder-card-title">
                                            <span className="reminder-type-tag">{rem.type}</span>
                                            {rem.custom_name && <strong className="reminder-custom-name">{rem.custom_name}</strong>}
                                        </div>
                                        <span className={`reminder-status-badge ${rem.status.toLowerCase()}`}>
                                            {rem.status}
                                        </span>
                                    </div>

                                    <div className="reminder-card-details">
                                        {rem.threshold_km && (
                                            <div className="reminder-detail-item">
                                                <span>Threshold Mileage:</span>
                                                <strong>{rem.threshold_km.toLocaleString()} km</strong>
                                            </div>
                                        )}
                                        {rem.last_service_km && (
                                            <div className="reminder-detail-item">
                                                <span>Last Service:</span>
                                                <strong>{rem.last_service_km.toLocaleString()} km</strong>
                                            </div>
                                        )}
                                        {rem.due_date && (
                                            <div className="reminder-detail-item">
                                                <span>Due Date:</span>
                                                <strong>{new Date(rem.due_date).toLocaleDateString()}</strong>
                                            </div>
                                        )}
                                        {rem.notes && (
                                            <div className="reminder-card-notes">
                                                <em>Notes:</em> {rem.notes}
                                            </div>
                                        )}
                                    </div>

                                    <div className="reminder-card-footer">
                                        <button 
                                            type="button" 
                                            className="toggle-status-btn"
                                            onClick={() => handleToggleReminderStatus(rem)}
                                        >
                                            {rem.status === 'PENDING' ? '✅ Mark Completed' : '🔄 Mark Pending'}
                                        </button>
                                        <div className="reminder-card-right-actions">
                                            <button 
                                                type="button" 
                                                className="edit-reminder-btn"
                                                onClick={() => handleStartEditReminder(rem)}
                                            >
                                                ✏️ Edit
                                            </button>
                                            <button 
                                                type="button" 
                                                className="delete-reminder-btn"
                                                onClick={() => handleDeleteMaintenanceReminder(rem.id)}
                                            >
                                                🗑️ Delete
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
