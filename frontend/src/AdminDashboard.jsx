import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, BarChart, Bar } from 'recharts';
import './AdminDashboard.css';
import SupportDashboard from './SupportDashboard';

const API_BASE = import.meta.env.VITE_API_URL || '';

const AdminDashboard = ({ user, onLogout, onBackToClient, onImpersonate }) => {
    const [activeTab, setActiveTab] = useState('overview');
    const [metrics, setMetrics] = useState(null);
    const [tenants, setTenants] = useState([]);
    const [devices, setDevices] = useState([]);
    const [payments, setPayments] = useState([]);
    const [alerts, setAlerts] = useState([]);
    const terminalEndRef = useRef(null);

    useEffect(() => {
        if (terminalEndRef.current) {
            terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [alerts, activeTab]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Whitelist Form State
    const [whitelistInput, setWhitelistInput] = useState('');
    const [whitelistLoading, setWhitelistLoading] = useState(false);
    const [whitelistSuccess, setWhitelistSuccess] = useState('');
    const [whitelistError, setWhitelistError] = useState('');

    // Filters & Search State
    const [tenantSearch, setTenantSearch] = useState('');
    const [deviceSearch, setDeviceSearch] = useState('');
    const [deviceFilter, setDeviceFilter] = useState('all'); // 'all', 'available', 'claimed'

    // Fetch dashboard data
    const refreshData = useCallback(async (isInitial = false) => {
        if (isInitial) setLoading(true);
        setError('');
        try {
            const [metricsRes, tenantsRes, devicesRes, paymentsRes, alertsRes] = await Promise.all([
                axios.get(`${API_BASE}/api/admin/metrics`),
                axios.get(`${API_BASE}/api/admin/tenants`),
                axios.get(`${API_BASE}/api/admin/devices`),
                axios.get(`${API_BASE}/api/admin/payments`),
                axios.get(`${API_BASE}/api/admin/alerts`)
            ]);

            setMetrics(metricsRes.data);
            setTenants(tenantsRes.data);
            setDevices(devicesRes.data);
            setPayments(paymentsRes.data);
            setAlerts(alertsRes.data);
        } catch (err) {
            console.error('Error fetching admin data:', err);
            setError(err.response?.data?.error || 'Failed to load administrative data.');
        } finally {
            if (isInitial) setLoading(false);
        }
    }, []);

    useEffect(() => {
        refreshData(true);
        const timer = setInterval(() => {
            refreshData(false);
        }, 10000);
        return () => clearInterval(timer);
    }, [refreshData]);

    // Toggle Tenant Status (Suspend/Activate)
    const handleToggleTenantStatus = async (tenantId) => {
        try {
            const res = await axios.post(`${API_BASE}/api/admin/tenants/${tenantId}/toggle-status`);
            const { newStatus } = res.data;
            
            // Update local state
            setTenants(prev => prev.map(t => 
                t.id === tenantId ? { ...t, subscription_status: newStatus } : t
            ));
            
            // Refresh metrics as active count might change
            const metricsRes = await axios.get(`${API_BASE}/api/admin/metrics`);
            setMetrics(metricsRes.data);
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to update tenant status');
        }
    };

    // Delete Tenant Account and Fleet Data
    const handleDeleteTenant = async (tenantId, username) => {
        if (!window.confirm(`⚠️ WARNING: Are you absolutely sure you want to permanently delete the account "${username}"?\n\nThis will permanently delete:\n- This user account\n- All of their vehicles\n- All GPS travel history & speed analytics\n- All geofence boundaries\n- All maintenance logs & schedules\n- All payment logs\n\nThis action CANNOT BE UNDONE. Proceed?`)) {
            return;
        }

        try {
            await axios.delete(`${API_BASE}/api/admin/tenants/${tenantId}`);
            
            // Update local state
            setTenants(prev => prev.filter(t => t.id !== tenantId));
            
            // Refresh metrics
            const metricsRes = await axios.get(`${API_BASE}/api/admin/metrics`);
            setMetrics(metricsRes.data);
            alert(`Account "${username}" and all related fleet data have been successfully deleted.`);
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to delete tenant');
        }
    };

    // Bulk Whitelist Devices
    const handleBulkWhitelist = async (e) => {
        e.preventDefault();
        setWhitelistLoading(true);
        setWhitelistSuccess('');
        setWhitelistError('');

        // Parse comma-separated or line-separated inputs
        const ids = whitelistInput
            .split(/[\n,]+/)
            .map(id => id.trim())
            .filter(id => id.length > 0);

        if (ids.length === 0) {
            setWhitelistError('Please enter at least one device ID/IMEI.');
            setWhitelistLoading(false);
            return;
        }

        try {
            const res = await axios.post(`${API_BASE}/api/admin/devices/whitelist`, { ids });
            setWhitelistSuccess(res.data.message);
            setWhitelistInput('');
            // Refresh devices list & metrics
            const [devRes, metRes] = await Promise.all([
                axios.get(`${API_BASE}/api/admin/devices`),
                axios.get(`${API_BASE}/api/admin/metrics`)
            ]);
            setDevices(devRes.data);
            setMetrics(metRes.data);
        } catch (err) {
            setWhitelistError(err.response?.data?.error || 'Failed to whitelist devices.');
        } finally {
            setWhitelistLoading(false);
        }
    };

    // Filter tenants based on search
    const filteredTenants = tenants.filter(t => 
        (t.company_name && t.company_name.toLowerCase().includes(tenantSearch.toLowerCase())) ||
        (t.username && t.username.toLowerCase().includes(tenantSearch.toLowerCase())) ||
        (t.email && t.email.toLowerCase().includes(tenantSearch.toLowerCase()))
    );

    // Filter devices based on search and status
    const filteredDevices = devices.filter(d => {
        const matchesSearch = d.id.toLowerCase().includes(deviceSearch.toLowerCase()) ||
            (d.owner_username && d.owner_username.toLowerCase().includes(deviceSearch.toLowerCase())) ||
            (d.company_name && d.company_name.toLowerCase().includes(deviceSearch.toLowerCase()));

        if (deviceFilter === 'claimed') {
            return matchesSearch && d.owner_username;
        } else if (deviceFilter === 'available') {
            return matchesSearch && !d.owner_username;
        }
        return matchesSearch;
    });

    // Process payments for Recharts trend (Aggregate by month/day)
    const getPaymentTrendData = () => {
        const monthlyData = {};
        payments.forEach(p => {
            if (p.status !== 'SUCCESS') return;
            const date = new Date(p.timestamp);
            const monthStr = date.toLocaleString('default', { month: 'short' }) + ' ' + date.getFullYear().toString().slice(-2);
            monthlyData[monthStr] = (monthlyData[monthStr] || 0) + p.amount;
        });

        return Object.keys(monthlyData).map(month => ({
            name: month,
            Revenue: monthlyData[month]
        })).reverse();
    };

    // Plan distribution count
    const getPlanDistribution = () => {
        const counts = { FREE: 0, BASIC: 0, PREMIUM: 0, ENTERPRISE: 0 };
        tenants.forEach(t => {
            const plan = (t.plan_id || 'FREE').toUpperCase();
            if (plan in counts) {
                counts[plan]++;
            }
        });
        return Object.keys(counts).map(plan => ({
            name: plan,
            Count: counts[plan]
        }));
    };

    return (
        <div className="admin-layout">
            {/* Sidebar Navigation */}
            <aside className="admin-sidebar">
                <div className="sidebar-logo">
                    <img src="/logo.png" alt="SafeBox Logo" />
                    <span>SafeBox Admin</span>
                </div>
                <div className="admin-profile">
                    <div className="profile-avatar">🛡️</div>
                    <div className="profile-info">
                        <span className="info-name">{user.username}</span>
                        <span className="info-role">Super Administrator</span>
                    </div>
                </div>
                <nav className="sidebar-nav">
                    <button 
                        className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
                        onClick={() => setActiveTab('overview')}
                    >
                        📊 Overview Dashboard
                    </button>
                    <button 
                        className={`nav-item ${activeTab === 'tenants' ? 'active' : ''}`}
                        onClick={() => setActiveTab('tenants')}
                    >
                        🏢 Tenant Management
                    </button>
                    <button 
                        className={`nav-item ${activeTab === 'devices' ? 'active' : ''}`}
                        onClick={() => setActiveTab('devices')}
                    >
                        📟 Device Inventory
                    </button>
                    <button 
                        className={`nav-item ${activeTab === 'payments' ? 'active' : ''}`}
                        onClick={() => setActiveTab('payments')}
                    >
                        💳 Payments Ledger
                    </button>
                    <button 
                        className={`nav-item ${activeTab === 'support' ? 'active' : ''}`}
                        onClick={() => setActiveTab('support')}
                    >
                        🔧 Support Diagnostics
                    </button>
                </nav>
                <div className="sidebar-footer">
                    <button className="client-dash-btn" onClick={onBackToClient}>
                        Client Dashboard
                    </button>
                    <button className="logout-btn" onClick={onLogout}>
                        Sign Out
                    </button>
                </div>
            </aside>

            {/* Main Content Area */}
            <main className="admin-main">
                <header className="admin-header">
                    <h2>Super Admin Operating Console</h2>
                    <button className="refresh-btn" onClick={() => refreshData(true)} disabled={loading}>
                        🔄 Refresh Data
                    </button>
                </header>

                {error && <div className="admin-error-banner">{error}</div>}

                {loading ? (
                    <div className="admin-loading-screen">
                        <div className="loader"></div>
                        <p>Aggregated telemetry insights compiling...</p>
                    </div>
                ) : (
                    <div className="admin-tab-content">
                        {/* 1. OVERVIEW TAB */}
                        {activeTab === 'overview' && metrics && (
                            <div className="overview-container">
                                {/* Top KPI Matrix Grid */}
                                <div className="kpi-grid">
                                    <div className="kpi-card">
                                        <div className="kpi-header">
                                            <span className="kpi-title">Monthly Recurring Revenue</span>
                                            <span className="kpi-icon">💰</span>
                                        </div>
                                        <div className="kpi-value">
                                            ₦{(metrics.totalRevenue || 0).toLocaleString()}
                                        </div>
                                        <div className="kpi-sub">Total collected revenue</div>
                                    </div>
                                    <div className="kpi-card">
                                        <div className="kpi-header">
                                            <span className="kpi-title">Registered Fleet Companies</span>
                                            <span className="kpi-icon">🏢</span>
                                        </div>
                                        <div className="kpi-value">{metrics.totalTenants}</div>
                                        <div className="kpi-sub">Active multi-tenant structures</div>
                                    </div>
                                    <div className="kpi-card">
                                        <div className="kpi-header">
                                            <span className="kpi-title">Tracked Fleet Vehicles</span>
                                            <span className="kpi-icon">🚗</span>
                                        </div>
                                        <div className="kpi-value">
                                            {metrics.activeVehicles} <span className="kpi-slash">/ {metrics.totalVehicles}</span>
                                        </div>
                                        <div className="kpi-sub">Active vs Total registrations</div>
                                    </div>
                                    <div className="kpi-card">
                                        <div className="kpi-header">
                                            <span className="kpi-title">Unprovisioned Hardware</span>
                                            <span className="kpi-icon">📟</span>
                                        </div>
                                        <div className="kpi-value">{metrics.availableTrackers}</div>
                                        <div className="kpi-sub">Whitelisted available in inventory</div>
                                    </div>
                                </div>

                                {/* Financial Trends & Distributions */}
                                <div className="chart-grid">
                                    <div className="chart-card">
                                        <h3>Financial Billing Transactions</h3>
                                        <div className="chart-wrapper">
                                            {payments.length === 0 ? (
                                                <p className="no-chart-data">No successful transactions logged.</p>
                                            ) : (
                                                <ResponsiveContainer width="100%" height={260}>
                                                    <AreaChart data={getPaymentTrendData()}>
                                                        <defs>
                                                            <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                                                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.4}/>
                                                                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                                            </linearGradient>
                                                        </defs>
                                                        <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                                                        <YAxis stroke="#94a3b8" fontSize={11} />
                                                        <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '6px', color: '#fff' }} />
                                                        <Area type="monotone" dataKey="Revenue" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorRev)" />
                                                    </AreaChart>
                                                </ResponsiveContainer>
                                            )}
                                        </div>
                                    </div>

                                    <div className="chart-card">
                                        <h3>Subscription Plan Distributions</h3>
                                        <div className="chart-wrapper">
                                            <ResponsiveContainer width="100%" height={260}>
                                                <BarChart data={getPlanDistribution()}>
                                                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                                                    <YAxis stroke="#94a3b8" fontSize={11} allowDecimals={false} />
                                                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '6px', color: '#fff' }} />
                                                    <Bar dataKey="Count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>
                                </div>

                                {/* System Diagnostics */}
                                <div className="diagnostics-card">
                                    <h3>⚙️ Fleet Server Infrastructure Telemetry</h3>
                                    <div className="diag-grid">
                                        <div className="diag-item">
                                            <span className="diag-label">Active Websocket Clients</span>
                                            <span className="diag-value value-green">{metrics.activeClients} connections</span>
                                        </div>
                                        <div className="diag-item">
                                            <span className="diag-label">Database File Footprint</span>
                                            <span className="diag-value">{metrics.databaseSize}</span>
                                        </div>
                                        <div className="diag-item">
                                            <span className="diag-label">MQTT Processor Status</span>
                                            <span className="diag-value value-green">Online (Listening)</span>
                                        </div>
                                        <div className="diag-item">
                                            <span className="diag-label">Global Curfew Engine</span>
                                            <span className="diag-value value-green">Active (60s checks)</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Live System Activity Log */}
                                <div className="terminal-card">
                                    <div className="terminal-header">
                                        <h3>📟 Live Operations Activity Feed</h3>
                                        <div className="terminal-header-right">
                                            <span className="terminal-pulse"></span>
                                            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Live</span>
                                        </div>
                                    </div>
                                    <div className="terminal-screen">
                                        {alerts.length === 0 ? (
                                            <div className="terminal-line">
                                                <span className="terminal-timestamp">[{new Date().toLocaleTimeString()}]</span>
                                                <span className="terminal-text info">System status: Normal. Listening for incoming telemetry logs...</span>
                                            </div>
                                        ) : (
                                            alerts.map((a, idx) => {
                                                let typeClass = 'info';
                                                const msg = a.message.toLowerCase();
                                                if (msg.includes('tamper')) typeClass = 'tampering';
                                                else if (msg.includes('speed') || msg.includes('over')) typeClass = 'speeding';
                                                else if (msg.includes('geofence') || msg.includes('zone')) typeClass = 'geofence';
                                                else if (msg.includes('curfew')) typeClass = 'curfew';

                                                return (
                                                    <div key={a.id || idx} className="terminal-line">
                                                        <span className="terminal-timestamp">
                                                            [{new Date(a.timestamp).toLocaleTimeString()}]
                                                        </span>
                                                        <span className={`terminal-text ${typeClass}`}>
                                                            <strong>[{a.company_name || 'Individual'}]</strong> Vehicle {a.vehicle_name}: {a.message}
                                                        </span>
                                                    </div>
                                                );
                                            })
                                        )}
                                        <div ref={terminalEndRef} />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 2. TENANTS TAB */}
                        {activeTab === 'tenants' && (
                            <div className="panel-container">
                                <div className="panel-bar">
                                    <input 
                                        type="text" 
                                        placeholder="🔍 Search company name, owner username, or email..." 
                                        value={tenantSearch}
                                        onChange={(e) => setTenantSearch(e.target.value)}
                                        className="search-input"
                                    />
                                </div>

                                <div className="table-responsive">
                                    <table className="admin-table">
                                        <thead>
                                            <tr>
                                                <th>Company / Client</th>
                                                <th>Owner Contact</th>
                                                <th>Tier Plan</th>
                                                <th>Fleet Size</th>
                                                <th>Payments</th>
                                                <th>License State</th>
                                                <th style={{ textAlign: 'center' }}>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredTenants.length === 0 ? (
                                                <tr>
                                                    <td colSpan="7" style={{ textAlign: 'center', color: '#64748b', padding: '2rem' }}>
                                                        No tenant structures match search criteria.
                                                    </td>
                                                </tr>
                                            ) : (
                                                filteredTenants.map(t => (
                                                    <tr key={t.id}>
                                                        <td>
                                                            <div className="td-company">{t.company_name || 'Individual Client'}</div>
                                                            <div className="td-sub font-mono">@{t.username}</div>
                                                        </td>
                                                        <td>
                                                            <div>{t.email}</div>
                                                            <div className="td-sub" style={{ color: '#60a5fa', fontWeight: 'bold', fontSize: '0.85rem', marginTop: '4px' }}>
                                                                📞 {t.phone || 'No phone'}
                                                            </div>
                                                        </td>
                                                        <td>
                                                            <span className={`badge-plan ${t.plan_id?.toLowerCase()}`}>
                                                                {t.plan_id || 'FREE'}
                                                            </span>
                                                        </td>
                                                        <td style={{ fontWeight: 'bold' }}>{t.vehiclesCount} cars</td>
                                                        <td>
                                                            <div>₦{(t.totalPaid || 0).toLocaleString()}</div>
                                                            <div className="td-sub">{t.paymentsCount} invoices processed</div>
                                                        </td>
                                                        <td>
                                                            <span className={`badge-status ${t.subscription_status?.toLowerCase()}`}>
                                                                {t.subscription_status || 'ACTIVE'}
                                                            </span>
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            <button 
                                                                className={`btn-action-toggle ${t.subscription_status === 'ACTIVE' ? 'suspend' : 'activate'}`}
                                                                onClick={() => handleToggleTenantStatus(t.id)}
                                                            >
                                                                {t.subscription_status === 'ACTIVE' ? '🚫 Suspend' : '✔️ Activate'}
                                                            </button>
                                                            <button 
                                                                className="btn-action-toggle impersonate"
                                                                onClick={() => onImpersonate(t)}
                                                            >
                                                                🔑 Impersonate
                                                            </button>
                                                            <button 
                                                                className="btn-action-toggle delete"
                                                                onClick={() => handleDeleteTenant(t.id, t.username)}
                                                            >
                                                                🗑️ Delete
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* 3. DEVICES WHITELIST TAB */}
                        {activeTab === 'devices' && (
                            <div className="panel-grid-split">
                                {/* Whitelist Provision Form */}
                                <div className="split-form-card">
                                    <h3>📟 Provision New Fleet Hardware</h3>
                                    <p className="form-help">
                                        Register tracker IMEI numbers into the system database. Standard client accounts will be rejected if they attempt to pair a tracker that is not whitelisted here.
                                    </p>
                                    
                                    {whitelistSuccess && <div className="banner-success">{whitelistSuccess}</div>}
                                    {whitelistError && <div className="banner-error">{whitelistError}</div>}

                                    <form onSubmit={handleBulkWhitelist}>
                                        <div className="form-group-admin">
                                            <label>Enter Hardware Device IDs / IMEIs</label>
                                            <textarea 
                                                placeholder="e.g. SAFEBOX_101, SAFEBOX_102, 866344050048896&#10;(Separate multiple IDs using commas or new lines)"
                                                rows="5"
                                                value={whitelistInput}
                                                onChange={(e) => setWhitelistInput(e.target.value)}
                                                required
                                            ></textarea>
                                        </div>
                                        <button 
                                            type="submit" 
                                            className="admin-submit-btn" 
                                            disabled={whitelistLoading}
                                        >
                                            {whitelistLoading ? 'Authorizing Devices...' : '🛡️ Whitelist Hardware'}
                                        </button>
                                    </form>
                                </div>

                                {/* Whitelisted Trackers Grid */}
                                <div className="split-list-card">
                                    <div className="card-header-split">
                                        <h3>Global Tracker Inventory</h3>
                                        <div className="split-filter-group">
                                            <select 
                                                value={deviceFilter} 
                                                onChange={(e) => setDeviceFilter(e.target.value)}
                                                className="admin-select"
                                            >
                                                <option value="all">All Inventory</option>
                                                <option value="available">Available (Unclaimed)</option>
                                                <option value="claimed">Claimed (Claimed by Vehicle)</option>
                                            </select>
                                            <input 
                                                type="text" 
                                                placeholder="Search IMEI..."
                                                value={deviceSearch}
                                                onChange={(e) => setDeviceSearch(e.target.value)}
                                                className="search-input-small"
                                            />
                                        </div>
                                    </div>

                                    <div className="table-responsive-split">
                                        <table className="admin-table text-small">
                                            <thead>
                                                <tr>
                                                    <th>Device IMEI / ID</th>
                                                    <th>Authorized Date</th>
                                                    <th>Status</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filteredDevices.length === 0 ? (
                                                    <tr>
                                                        <td colSpan="3" style={{ textAlign: 'center', color: '#64748b', padding: '1rem' }}>
                                                            No devices match filters.
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    filteredDevices.map(d => (
                                                        <tr key={d.id}>
                                                            <td className="font-mono" style={{ fontWeight: 'bold' }}>{d.id}</td>
                                                            <td>
                                                                {d.created_at ? new Date(d.created_at * 1000).toLocaleDateString() : 'System Seed'}
                                                            </td>
                                                            <td>
                                                                {d.owner_username ? (
                                                                    <span className="claimed-chip" title={`Claimed by ${d.company_name || d.owner_username}`}>
                                                                        🚗 Claimed (by {d.owner_username})
                                                                    </span>
                                                                ) : (
                                                                    <span className="available-chip">
                                                                        ✔️ Available
                                                                    </span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 4. PAYMENTS LEDGER TAB */}
                        {activeTab === 'payments' && (
                            <div className="panel-container">
                                <div className="table-responsive">
                                    <table className="admin-table">
                                        <thead>
                                            <tr>
                                                <th>Invoice Reference</th>
                                                <th>Company / Client</th>
                                                <th>Timestamp</th>
                                                <th>Amount</th>
                                                <th>Payment Gateway State</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {payments.length === 0 ? (
                                                <tr>
                                                    <td colSpan="5" style={{ textAlign: 'center', color: '#64748b', padding: '2rem' }}>
                                                        No payment transactions recorded.
                                                    </td>
                                                </tr>
                                            ) : (
                                                payments.map(p => (
                                                    <tr key={p.id}>
                                                        <td className="font-mono" style={{ fontWeight: 'bold' }}>
                                                            {p.reference}
                                                        </td>
                                                        <td>
                                                            <div>{p.company_name || 'Individual User'}</div>
                                                            <div className="td-sub font-mono">@{p.username}</div>
                                                        </td>
                                                        <td>
                                                            {new Date(p.timestamp).toLocaleString()}
                                                        </td>
                                                        <td style={{ fontWeight: 'bold', color: p.status === 'SUCCESS' ? '#10b981' : '#ef4444' }}>
                                                            ₦{p.amount.toLocaleString()}
                                                        </td>
                                                        <td>
                                                            <span className={`badge-payment ${p.status?.toLowerCase()}`}>
                                                                {p.status}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* 5. SUPPORT DIAGNOSTICS TAB */}
                        {activeTab === 'support' && (
                            <div className="panel-container">
                                <SupportDashboard onBack={() => setActiveTab('overview')} />
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
};

export default AdminDashboard;
