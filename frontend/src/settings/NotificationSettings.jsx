import React from 'react';
import { BellIcon, MailIcon, PhoneIcon, CheckIcon, AlertTriangleIcon } from './Icons';

export default function NotificationSettings({
    batteryAlert,
    setBatteryAlert,
    fuelAlert,
    setFuelAlert,
    geofenceAlert,
    setGeofenceAlert,
    maintenanceAlert,
    setMaintenanceAlert,
    notifyEmail,
    setNotifyEmail,
    notifySms,
    setNotifySms,
    notifyPush,
    setNotifyPush,
    alertEmail,
    setAlertEmail,
    alertPhone,
    setAlertPhone,
    defaultEmail,
    defaultPhone,
    pushSubscriptionActive,
    pushLoading,
    isPushSupported,
    handleEnrollPush,
    handleTestPush,
    handleSave,
    loading,
    statusMsg,
    user
}) {
    return (
        <form onSubmit={handleSave} className="settings-form-wrapper">
            {statusMsg.text && (
                <div className={`status-alert ${statusMsg.type}`}>
                    {statusMsg.text}
                </div>
            )}

            {/* SECTION 1: NOTIFICATION TRIGGERS */}
            <div className="form-section">
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <BellIcon size={20} /> Notification Triggers
                </h3>
                <p className="section-subtitle">Toggle real-time alerts shown on your browser dashboard.</p>
                
                <div className="toggle-group">
                    <div className="toggle-item">
                        <div className="toggle-info">
                            <span className="toggle-title">Low Battery Alert</span>
                            <span className="toggle-desc">Notify if vehicle voltage falls below 20%.</span>
                        </div>
                        <label className="switch">
                            <input 
                                type="checkbox" 
                                checked={batteryAlert} 
                                onChange={(e) => setBatteryAlert(e.target.checked)} 
                            />
                            <span className="slider round"></span>
                        </label>
                    </div>

                    <div className="toggle-item">
                        <div className="toggle-info">
                            <span className="toggle-title">Low Fuel Alert</span>
                            <span className="toggle-desc">Notify if fuel tank drops below 15%.</span>
                        </div>
                        <label className="switch">
                            <input 
                                type="checkbox" 
                                checked={fuelAlert} 
                                onChange={(e) => setFuelAlert(e.target.checked)} 
                            />
                            <span className="slider round"></span>
                        </label>
                    </div>

                    <div className="toggle-item">
                        <div className="toggle-info">
                            <span className="toggle-title">Geofence Safe Zone Breach</span>
                            <span className="toggle-desc">Notify instantly if a vehicle leaves safe zones.</span>
                        </div>
                        <label className="switch">
                            <input 
                                type="checkbox" 
                                checked={geofenceAlert} 
                                onChange={(e) => setGeofenceAlert(e.target.checked)} 
                            />
                            <span className="slider round"></span>
                        </label>
                    </div>

                    <div className="toggle-item">
                        <div className="toggle-info">
                            <span className="toggle-title">Maintenance Due Alert</span>
                            <span className="toggle-desc">Notify when a vehicle's scheduled maintenance service is due.</span>
                        </div>
                        <label className="switch">
                            <input 
                                type="checkbox" 
                                checked={maintenanceAlert} 
                                onChange={(e) => setMaintenanceAlert(e.target.checked)} 
                            />
                            <span className="slider round"></span>
                        </label>
                    </div>
                </div>
            </div>

            {/* SECTION 2: ALERT DELIVERY CHANNELS */}
            <div className="form-section">
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <BellIcon size={20} /> Alert Delivery Channels
                </h3>
                <p className="section-subtitle">Choose where and how to receive security, speed, and geofence alerts.</p>
                
                <div className="toggle-group" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    {/* Email Channel */}
                    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '1rem' }}>
                        <div className="toggle-item">
                            <div className="toggle-info">
                                <span className="toggle-title" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: '600' }}>
                                    <MailIcon size={16} /> Email Alerts
                                </span>
                                <span className="toggle-desc">Receive real-time security alerts in your mailbox.</span>
                            </div>
                            <label className="switch">
                                <input 
                                    type="checkbox" 
                                    checked={notifyEmail} 
                                    onChange={(e) => setNotifyEmail(e.target.checked)} 
                                />
                                <span className="slider round"></span>
                            </label>
                        </div>
                        {notifyEmail && (
                            <div className="form-group" style={{ marginLeft: '1rem', marginTop: '0.8rem', paddingLeft: '0.5rem', borderLeft: '2px solid rgba(255,255,255,0.1)' }}>
                                <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Custom Alert Recipient Email</label>
                                <input 
                                    type="email" 
                                    value={alertEmail} 
                                    onChange={(e) => setAlertEmail(e.target.value)} 
                                    placeholder={defaultEmail || "alerts@yourcompany.com"}
                                    style={{ marginTop: '0.25rem' }}
                                />
                                <small className="help-text" style={{ fontSize: '0.7rem', color: '#64748b' }}>
                                    Leave blank to use default account email: <strong>{defaultEmail || user.email}</strong>
                                </small>
                            </div>
                        )}
                    </div>

                    {/* SMS Channel */}
                    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '1rem' }}>
                        <div className="toggle-item">
                            <div className="toggle-info">
                                <span className="toggle-title" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: '600' }}>
                                    <PhoneIcon size={16} /> SMS Text Alerts
                                </span>
                                <span className="toggle-desc">Receive urgent SMS alerts on your phone.</span>
                            </div>
                            <label className="switch">
                                <input 
                                    type="checkbox" 
                                    checked={notifySms} 
                                    onChange={(e) => setNotifySms(e.target.checked)} 
                                />
                                <span className="slider round"></span>
                            </label>
                        </div>
                        {notifySms && (
                            <div className="form-group" style={{ marginLeft: '1rem', marginTop: '0.8rem', paddingLeft: '0.5rem', borderLeft: '2px solid rgba(255,255,255,0.1)' }}>
                                <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Custom Alert Recipient Phone Number</label>
                                <input 
                                    type="tel" 
                                    value={alertPhone} 
                                    onChange={(e) => setAlertPhone(e.target.value)} 
                                    placeholder={defaultPhone || "+234 803 123 4567"}
                                    style={{ marginTop: '0.25rem' }}
                                />
                                <small className="help-text" style={{ fontSize: '0.7rem', color: '#64748b' }}>
                                    Leave blank to use default account phone: <strong>{defaultPhone || user.phone}</strong>
                                </small>
                            </div>
                        )}
                    </div>

                    {/* Push Channel */}
                    <div>
                        <div className="toggle-item">
                            <div className="toggle-info">
                                <span className="toggle-title" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: '600' }}>
                                    <BellIcon size={16} /> Browser Push Notifications
                                </span>
                                <span className="toggle-desc">Receive real-time desktop popups when tracking dashboard is open.</span>
                            </div>
                            <label className="switch">
                                <input 
                                    type="checkbox" 
                                    checked={notifyPush} 
                                    onChange={(e) => setNotifyPush(e.target.checked)} 
                                />
                                <span className="slider round"></span>
                            </label>
                        </div>
                        
                        {notifyPush && isPushSupported && (
                            <div style={{ marginLeft: '1rem', marginTop: '0.8rem', paddingLeft: '0.5rem', borderLeft: '2px solid rgba(255,255,255,0.1)' }}>
                                {pushSubscriptionActive ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#10b981', fontSize: '0.8rem', fontWeight: '600' }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><CheckIcon size={14} /> Browser Push Enrolled Successfully</span>
                                        <button 
                                            type="button"
                                            onClick={handleTestPush}
                                            className="btn-secondary"
                                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem', height: 'auto', background: 'rgba(255,255,255,0.05)', color: '#f8fafc', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', cursor: 'pointer' }}
                                        >
                                            Test Alert
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={handleEnrollPush}
                                        disabled={pushLoading}
                                        className="btn-primary"
                                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem', height: 'auto', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                                    >
                                        {pushLoading ? 'Enrolling...' : 'Register this Browser for Push Alerts'}
                                    </button>
                                )}
                            </div>
                        )}
                        {notifyPush && !isPushSupported && (
                            <div style={{ marginLeft: '1rem', marginTop: '0.5rem', color: '#f59e0b', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                <AlertTriangleIcon size={14} /> Push Notifications not supported by your current browser or protocol connection.
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="form-actions-bar">
                <button type="submit" disabled={loading} className="btn-primary">
                    {loading ? 'Saving Preferences...' : 'Save Preferences'}
                </button>
            </div>
        </form>
    );
}
