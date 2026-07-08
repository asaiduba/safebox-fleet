import React from 'react';
import './NotificationsPanel.css';

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

    // Warning (Orange): Insurance Expiring, Maintenance Due, Weak Signal, Geofence Breach
    if (
        msg.includes('expire') || 
        msg.includes('maintenance') || 
        msg.includes('due') || 
        msg.includes('signal') || 
        msg.includes('breach') || 
        msg.includes('left') || 
        type.includes('geofence') || 
        type.includes('battery') || 
        type.includes('fuel') || 
        type.includes('speed')
    ) {
        return 'warning';
    }

    // Info (Blue): Trip Completed, Service Recorded
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
                    <button className="close-btn" onClick={onClose}>×</button>
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
                                <div className={`notif-icon icon-${severity}`}>
                                    {notif.type === 'GEOFENCE' && '🛡️'}
                                    {notif.type === 'SPEED' && '🚀'}
                                    {notif.type === 'FUEL' && '⛽'}
                                    {notif.type === 'BATTERY' && '🔋'}
                                    {severity === 'critical' && '🚨'}
                                    {!['GEOFENCE', 'SPEED', 'FUEL', 'BATTERY'].includes(notif.type) && severity !== 'critical' && '⚠️'}
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
