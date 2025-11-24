import React from 'react';
import './NotificationsPanel.css';

const NotificationsPanel = ({ notifications, onClose, onMarkRead, onMarkAllRead }) => {
    return (
        <div className="notifications-panel">
            <div className="notifications-header">
                <h3>Notifications</h3>
                <div className="header-actions">
                    <button className="mark-all-btn" onClick={onMarkAllRead}>Mark all read</button>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>
            </div>
            <div className="notifications-list">
                {notifications.length === 0 ? (
                    <div className="no-notifications">No notifications</div>
                ) : (
                    notifications.map(notif => (
                        <div
                            key={notif.id}
                            className={`notification-item ${notif.is_read ? 'read' : 'unread'}`}
                            onClick={() => onMarkRead(notif.id)}
                        >
                            <div className="notif-icon">
                                {notif.type === 'GEOFENCE' && '🛡️'}
                                {notif.type === 'SPEED' && '🚀'}
                                {notif.type === 'FUEL' && '⛽'}
                                {notif.type === 'BATTERY' && '🔋'}
                                {!['GEOFENCE', 'SPEED', 'FUEL', 'BATTERY'].includes(notif.type) && '⚠️'}
                            </div>
                            <div className="notif-content">
                                <p className="notif-message">{notif.message}</p>
                                <span className="notif-time">
                                    {new Date(notif.timestamp).toLocaleTimeString()} - {new Date(notif.timestamp).toLocaleDateString()}
                                </span>
                            </div>
                            {!notif.is_read && <div className="unread-dot"></div>}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default NotificationsPanel;
