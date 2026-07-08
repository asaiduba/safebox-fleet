import React from 'react';
import './NotificationsPanel.css';
import { ShieldIcon, ZapIcon, FuelIcon, BatteryIcon, AlertTriangleIcon, XIcon } from './settings/Icons';

const getSeverity = (notif) => {
    if (notif.severity) return notif.severity;

    const msg = (notif.message || '').toLowerCase();
    const type = (notif.type || '').toLowerCase();

    // Critical (Red): Vehicle Stolen, Unauthorized Start, Device Tampering
    if (
        msg.includes('stolen') || 
        msg.includes('unauthorized') || 
        msg.includes('tamper') || 
        type.includes('stolen') || 
        type.includes('tamper') || 
        type.includes('unauthorized')
    ) {
        return 'critical';
    }

    // Warning (Orange): Speeding, Curfew Breach, Low Battery/Fuel
    if (
        msg.includes('speed') || 
        msg.includes('curfew') || 
        msg.includes('low') || 
        type.includes('speed') || 
        type.includes('curfew') || 
        type.includes('low')
    ) {
        return 'warning';
    }

    return 'info';
};

const NotificationsPanel = ({ notifications, onClose, onMarkRead, onMarkAllRead, onExportAlerts }) => {
    return (
        <div className="notifications-panel">
            <div className="notifications-header">
                <h3>Notifications</h3>
                <div className="header-actions" style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    {notifications.some(n => !n.is_read) && (
                        <button className="mark-all-btn" onClick={onMarkAllRead}>Mark all read</button>
                    )}
                    <button className="close-btn" onClick={onClose} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><XIcon size={16} /></button>
                </div>
            </div>
            <div className="notifications-list">
                {notifications.length === 0 ? (
                    <div className="no-notifications">No notifications</div>
                ) : (
                    notifications.map(notif => {
                        const severity = getSeverity(notif);
                        return (
                            <div
                                key={notif.id}
                                className={`notification-item ${notif.is_read ? 'read' : 'unread'} severity-${severity}`}
                                onClick={() => onMarkRead(notif.id)}
                            >
                                <div className={`notif-icon icon-${severity}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {notif.type === 'GEOFENCE' && <ShieldIcon size={14} />}
                                    {notif.type === 'SPEED' && <ZapIcon size={14} />}
                                    {notif.type === 'FUEL' && <FuelIcon size={14} />}
                                    {notif.type === 'BATTERY' && <BatteryIcon size={14} />}
                                    {severity === 'critical' && !['GEOFENCE', 'SPEED', 'FUEL', 'BATTERY'].includes(notif.type) && <AlertTriangleIcon size={14} />}
                                    {!['GEOFENCE', 'SPEED', 'FUEL', 'BATTERY'].includes(notif.type) && severity !== 'critical' && <AlertTriangleIcon size={14} />}
                                </div>
                                <div className="notif-content">
                                    <p className="notif-message">{notif.message}</p>
                                    <span className="notif-time">
                                        {new Date(notif.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(notif.timestamp).toLocaleDateString()}
                                    </span>
                                </div>
                                {!notif.is_read && <div className={`unread-dot dot-${severity}`}></div>}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};

export default NotificationsPanel;
