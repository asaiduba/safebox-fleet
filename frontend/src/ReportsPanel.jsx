import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import './ReportsPanel.css';
import {
    BarChartIcon, TargetIcon, CalendarIcon, FolderIcon,
    ZapIcon, DownloadIcon, TrashIcon, MailIcon, ClockIcon,
    SendIcon, SparklesIcon, FileTextIcon, XIcon, BellIcon
} from './settings/Icons';

export default function ReportsPanel({ onClose, vehicles = [] }) {
    const API_BASE = import.meta.env.VITE_API_URL || '';

    // Active tab in reports panel
    const [subTab, setSubTab] = useState('center');

    // Report center filters
    const [reportType, setReportType] = useState('Full Fleet Report');
    const [dateRange, setDateRange] = useState('Last 7 Days');
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
    const [selectedVehicleIds, setSelectedVehicleIds] = useState(new Set(vehicles.map(v => v.id)));
    const [selectedDriver, setSelectedDriver] = useState('all');
    const [outputFormat, setOutputFormat] = useState('PDF');

    // Async generation states
    const [generating, setGenerating] = useState(false);
    const [progress, setProgress] = useState(0);
    const [errorMsg, setErrorMsg] = useState('');
    const [successMsg, setSuccessMsg] = useState('');

    // Preview states
    const [previewData, setPreviewData] = useState(null);
    const [previewLoading, setPreviewLoading] = useState(false);

    // Scheduling States
    const [schedulesList, setSchedulesList] = useState([]);
    const [schedFrequency, setSchedFrequency] = useState('daily');
    const [schedRecipients, setSchedRecipients] = useState('');
    const [schedReportType, setSchedReportType] = useState('Full Fleet Report');
    const [schedDeliveryMethod, setSchedDeliveryMethod] = useState('email');
    const [schedTime, setSchedTime] = useState('08:00');
    const [schedLoading, setSchedLoading] = useState(false);

    // History States
    const [historyList, setHistoryList] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);

    // Load reports history archive
    const loadHistory = useCallback(async () => {
        setHistoryLoading(true);
        try {
            const token = localStorage.getItem('token');
            const res = await axios.get(`${API_BASE}/api/reports/history`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setHistoryList(res.data);
        } catch (err) {
            console.error('Failed to load reports archive:', err);
        } finally {
            setHistoryLoading(false);
        }
    }, [API_BASE]);

    // Load active schedules
    const loadSchedules = useCallback(async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await axios.get(`${API_BASE}/api/reports/schedules`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setSchedulesList(res.data);
        } catch (err) {
            console.error('Failed to load schedules:', err);
        }
    }, [API_BASE]);

    // Live preview loader
    const loadPreview = useCallback(async () => {
        if (selectedVehicleIds.size === 0) return;
        setPreviewLoading(true);
        try {
            const token = localStorage.getItem('token');
            const vIdsParam = Array.from(selectedVehicleIds).join(',');
            const res = await axios.get(`${API_BASE}/api/reports/analytics`, {
                params: {
                    vehicleIds: vIdsParam,
                    range: dateRange,
                    customStart,
                    customEnd
                },
                headers: { Authorization: `Bearer ${token}` }
            });
            setPreviewData(res.data);
        } catch (err) {
            console.error('Failed to fetch preview metrics:', err);
        } finally {
            setPreviewLoading(false);
        }
    }, [API_BASE, dateRange, customStart, customEnd, selectedVehicleIds]);

    useEffect(() => {
        if (subTab === 'center') {
            loadPreview();
        } else if (subTab === 'schedules') {
            loadSchedules();
        } else if (subTab === 'history') {
            loadHistory();
        }
    }, [subTab, loadPreview, loadSchedules, loadHistory]);

    // Trigger preview load when filters change
    useEffect(() => {
        if (subTab === 'center') {
            const delayDebounce = setTimeout(() => {
                loadPreview();
            }, 600);
            return () => clearTimeout(delayDebounce);
        }
    }, [dateRange, customStart, customEnd, selectedVehicleIds, subTab, loadPreview]);

    // Generate Report
    const handleGenerateReport = async () => {
        setGenerating(true);
        setProgress(5);
        setErrorMsg('');
        setSuccessMsg('');
        
        try {
            const token = localStorage.getItem('token');
            const res = await axios.post(`${API_BASE}/api/reports/generate`, {
                reportType,
                vehicleIds: Array.from(selectedVehicleIds),
                driverIds: selectedDriver === 'all' ? [] : [selectedDriver],
                range: dateRange,
                customStart,
                customEnd,
                format: outputFormat
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });

            const { reportId } = res.data;
            setProgress(30);

            // Start polling status
            const intervalId = setInterval(async () => {
                try {
                    const statusRes = await axios.get(`${API_BASE}/api/reports/status/${reportId}`, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    
                    const { status, progress: apiProgress, error } = statusRes.data;
                    
                    if (status === 'COMPLETED') {
                        clearInterval(intervalId);
                        setProgress(100);
                        setGenerating(false);
                        setSuccessMsg('Report compiled successfully! You can find it in the downloads archive tab.');
                        loadHistory(); // Reload history
                    } else if (status === 'FAILED') {
                        clearInterval(intervalId);
                        setGenerating(false);
                        setErrorMsg(`Generation failed: ${error || 'Unknown error'}`);
                    } else {
                        // Incrementally show progress
                        setProgress(Math.max(30, apiProgress));
                    }
                } catch (pollErr) {
                    console.error('Error polling report status:', pollErr);
                    clearInterval(intervalId);
                    setGenerating(false);
                    setErrorMsg('Network error while building report.');
                }
            }, 1000);

        } catch (err) {
            console.error('Failed to trigger report generation:', err);
            setErrorMsg(err.response?.data?.error || 'Failed to initiate report generation');
            setGenerating(false);
        }
    };

    // Save Schedule
    const handleSaveSchedule = async (e) => {
        e.preventDefault();
        setSchedLoading(true);
        try {
            const token = localStorage.getItem('token');
            await axios.post(`${API_BASE}/api/reports/schedules`, {
                frequency: schedFrequency,
                recipients: schedRecipients,
                reportType: schedReportType,
                deliveryMethod: schedDeliveryMethod,
                timeOfDelivery: schedTime
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setSchedRecipients('');
            loadSchedules();
        } catch (err) {
            console.error('Failed to create schedule:', err);
            alert(err.response?.data?.error || 'Failed to establish schedule');
        } finally {
            setSchedLoading(false);
        }
    };

    // Delete Schedule
    const handleDeleteSchedule = async (id) => {
        if (!window.confirm('Are you sure you want to cancel this scheduled report delivery?')) return;
        try {
            const token = localStorage.getItem('token');
            await axios.delete(`${API_BASE}/api/reports/schedules/${id}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            loadSchedules();
        } catch (err) {
            console.error('Failed to delete schedule:', err);
        }
    };

    // Toggle vehicle checklists
    const handleToggleVehicle = (id) => {
        const next = new Set(selectedVehicleIds);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        setSelectedVehicleIds(next);
    };

    return (
        <div className="reports-panel-overlay">
            <div className="reports-panel-container glass-panel animate-fade-in">
                <header className="reports-header">
                    <div className="title-area">
                        <h2><BarChartIcon size={20} /> Reports & Analytics Hub</h2>
                        <p>Generate high-quality operational, financial, and security intelligence audits.</p>
                    </div>
                    <button className="close-btn" onClick={onClose}><XIcon size={16} /></button>
                </header>

                {/* Sub Tab Navigation */}
                <div className="reports-subtabs-row">
                    <button 
                        className={`reports-subtab-btn ${subTab === 'center' ? 'active' : ''}`}
                        onClick={() => setSubTab('center')}
                    >
                        <TargetIcon size={14} /> Report Center
                    </button>
                    <button 
                        className={`reports-subtab-btn ${subTab === 'schedules' ? 'active' : ''}`}
                        onClick={() => setSubTab('schedules')}
                    >
                        <CalendarIcon size={14} /> Automated Schedules
                    </button>
                    <button 
                        className={`reports-subtab-btn ${subTab === 'history' ? 'active' : ''}`}
                        onClick={() => setSubTab('history')}
                    >
                        <FolderIcon size={14} /> Downloads Archive
                    </button>
                </div>

                <div className="reports-panel-content">
                    {/* 1. REPORT CENTER */}
                    {subTab === 'center' && (
                        <div className="report-center-workspace">
                            <div className="workspace-left">
                                <div className="filter-card glass-panel">
                                    <h3>Configure Audit</h3>
                                    
                                    <div className="filter-group">
                                        <label>Report Type</label>
                                        <select value={reportType} onChange={(e) => setReportType(e.target.value)}>
                                            <option value="Full Fleet Report">Full Fleet Report (All details)</option>
                                            <option value="Executive Summary">Executive Summary (KPIs)</option>
                                            <option value="Vehicle Usage">Vehicle Usage Report</option>
                                            <option value="Trip Report">Trip Report</option>
                                            <option value="Driver Performance">Driver Performance Leaderboard</option>
                                            <option value="Security & Alerts">Security & Alerts Log</option>
                                            <option value="Maintenance">Maintenance Health Log</option>
                                            <option value="Fuel & Cost Analysis">Fuel & Cost Analysis</option>
                                        </select>
                                    </div>

                                    <div className="filter-group">
                                        <label>Date Range</label>
                                        <select value={dateRange} onChange={(e) => setDateRange(e.target.value)}>
                                            <option value="Today">Today</option>
                                            <option value="Yesterday">Yesterday</option>
                                            <option value="Last 7 Days">Last 7 Days</option>
                                            <option value="Last 30 Days">Last 30 Days</option>
                                            <option value="Custom Range">Custom Range</option>
                                        </select>
                                    </div>

                                    {dateRange === 'Custom Range' && (
                                        <div className="form-row" style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                                            <div className="filter-group" style={{ flex: 1 }}>
                                                <label>Start Date</label>
                                                <input 
                                                    type="date" 
                                                    value={customStart}
                                                    onChange={(e) => setCustomStart(e.target.value)}
                                                />
                                            </div>
                                            <div className="filter-group" style={{ flex: 1 }}>
                                                <label>End Date</label>
                                                <input 
                                                    type="date" 
                                                    value={customEnd}
                                                    onChange={(e) => setCustomEnd(e.target.value)}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    <div className="filter-group">
                                        <label>Vehicles Included</label>
                                        <div className="vehicle-checklist-box">
                                            {vehicles.map(v => (
                                                <label key={v.id} className="checklist-item">
                                                    <input 
                                                        type="checkbox"
                                                        checked={selectedVehicleIds.has(v.id)}
                                                        onChange={() => handleToggleVehicle(v.id)}
                                                    />
                                                    <span>{v.name} ({v.id})</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="form-row" style={{ display: 'flex', gap: '0.5rem' }}>
                                        <div className="filter-group" style={{ flex: 1 }}>
                                            <label>Driver Filter</label>
                                            <select value={selectedDriver} onChange={(e) => setSelectedDriver(e.target.value)}>
                                                <option value="all">All Drivers</option>
                                                {vehicles.filter(v => v.driver_name).map(v => (
                                                    <option key={v.id} value={v.driver_name}>{v.driver_name}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="filter-group" style={{ flex: 1 }}>
                                            <label>Output Format</label>
                                            <select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)}>
                                                <option value="PDF">PDF Document</option>
                                                <option value="CSV">CSV Spreadsheet</option>
                                            </select>
                                        </div>
                                    </div>

                                    {errorMsg && <div className="status-alert error">{errorMsg}</div>}
                                    {successMsg && <div className="status-alert success">{successMsg}</div>}

                                    {generating ? (
                                        <div className="progress-container">
                                            <div className="progress-label">Compiling data and rendering charts ({progress}%)</div>
                                            <div className="progress-track">
                                                <div className="progress-bar" style={{ width: `${progress}%` }}></div>
                                            </div>
                                        </div>
                                    ) : (
                                        <button 
                                            className="generate-report-btn glowing-button"
                                            onClick={handleGenerateReport}
                                            disabled={selectedVehicleIds.size === 0}
                                        >
                                            <ZapIcon size={14} /> Compile Report
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className="workspace-right">
                                <div className="preview-card glass-panel">
                                    <h3><BarChartIcon size={16} /> Selected Interval Preview</h3>
                                    <p className="preview-sub">Live approximate stats based on your query criteria before downloading file.</p>
                                    
                                    {previewLoading ? (
                                        <div className="preview-loading">Calculating operational indices...</div>
                                    ) : previewData ? (
                                        <div className="preview-kpi-grid">
                                            <div className="preview-kpi-card">
                                                <span className="kpi-label">DISTANCE COVERED</span>
                                                <span className="kpi-val">{previewData.totalDistance} <small>km</small></span>
                                            </div>
                                            <div className="preview-kpi-card">
                                                <span className="kpi-label">FLEET UTILIZATION</span>
                                                <span className="kpi-val">{previewData.utilization}%</span>
                                            </div>
                                            <div className="preview-kpi-card">
                                                <span className="kpi-label">TOTAL IDLE TIME</span>
                                                <span className="kpi-val">{Math.round(previewData.totalIdleTime / 60)} <small>mins</small></span>
                                            </div>
                                            <div className="preview-kpi-card">
                                                <span className="kpi-label">SECURITY INCIDENTS</span>
                                                <span className="kpi-val" style={{ color: previewData.totalAlerts > 0 ? '#ff4d4f' : '#22c55e' }}>{previewData.totalAlerts}</span>
                                            </div>
                                            <div className="preview-kpi-card">
                                                <span className="kpi-label">ACTIVE / TOTAL VEHICLES</span>
                                                <span className="kpi-val">{previewData.onlineVehicles} / {previewData.totalVehicles}</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="preview-placeholder">Select vehicles and date range to display previews.</p>
                                    )}

                                    <div className="ai-insights-block" style={{ marginTop: '1.5rem', background: 'rgba(234, 179, 8, 0.05)', border: '1px dashed #eab308', borderRadius: '0.5rem', padding: '1rem' }}>
                                        <h4 style={{ color: '#eab308', display: 'flex', alignItems: 'center', gap: '0.4rem', margin: '0 0 0.5rem 0' }}><SparklesIcon size={16} /> AI Operational Warnings Preview</h4>
                                        <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.8rem', color: '#e2e8f0', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                            <li>Predictive Maintenance: Brake service probability for SBX-004 is elevated.</li>
                                            <li>Fuel Anomalies: Idle times for Musa indicate potential 12% excess fuel expenditure.</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 2. AUTOMATED SCHEDULES */}
                    {subTab === 'schedules' && (
                        <div className="report-schedules-workspace">
                            <div className="workspace-left">
                                <form onSubmit={handleSaveSchedule} className="schedule-form filter-card glass-panel">
                                    <h3>New Automated Delivery</h3>
                                    
                                    <div className="filter-group">
                                        <label>Report Type</label>
                                        <select value={schedReportType} onChange={(e) => setSchedReportType(e.target.value)}>
                                            <option value="Full Fleet Report">Full Fleet Report</option>
                                            <option value="Executive Summary">Executive Summary</option>
                                            <option value="Vehicle Usage">Vehicle Usage Report</option>
                                            <option value="Driver Performance">Driver Performance</option>
                                            <option value="Security & Alerts">Security & Alerts</option>
                                            <option value="Maintenance">Maintenance Health Log</option>
                                            <option value="Fuel & Cost Analysis">Fuel & Cost Analysis</option>
                                        </select>
                                    </div>

                                    <div className="form-row" style={{ display: 'flex', gap: '0.5rem' }}>
                                        <div className="filter-group" style={{ flex: 1 }}>
                                            <label>Frequency</label>
                                            <select value={schedFrequency} onChange={(e) => setSchedFrequency(e.target.value)}>
                                                <option value="daily">Daily (covers Yesterday)</option>
                                                <option value="weekly">Weekly (covers Last 7 Days)</option>
                                                <option value="biweekly">Bi-weekly (covers Last 14 Days)</option>
                                                <option value="monthly">Monthly (covers Last 30 Days)</option>
                                            </select>
                                        </div>

                                        <div className="filter-group" style={{ flex: 1 }}>
                                            <label>Time of Delivery</label>
                                            <input 
                                                type="time" 
                                                value={schedTime}
                                                onChange={(e) => setSchedTime(e.target.value)}
                                            />
                                        </div>
                                    </div>

                                    <div className="filter-group">
                                        <label>Recipients (Comma-separated emails)</label>
                                        <input 
                                            type="text" 
                                            value={schedRecipients}
                                            onChange={(e) => setSchedRecipients(e.target.value)}
                                            placeholder="manager@company.com, admin@company.com"
                                            required
                                        />
                                    </div>

                                    <div className="filter-group">
                                        <label>Delivery Channels</label>
                                        <select value={schedDeliveryMethod} onChange={(e) => setSchedDeliveryMethod(e.target.value)}>
                                            <option value="email">Email Attachments</option>
                                            <option value="download">Dashboard Only (History Log)</option>
                                            <option value="email,download">Email + Dashboard Log</option>
                                        </select>
                                    </div>

                                    <button type="submit" disabled={schedLoading} className="generate-report-btn glowing-button">
                                        {schedLoading ? 'Establishing...' : <><BellIcon size={14} /> Establish Scheduler</>}
                                    </button>
                                </form>
                            </div>

                            <div className="workspace-right">
                                <div className="schedules-list-container glass-panel">
                                    <h3>Active Delivery Schedules</h3>
                                    {schedulesList.length === 0 ? (
                                        <p className="no-data-msg">No automated report deliveries configured.</p>
                                    ) : (
                                        <div className="schedules-grid">
                                            {schedulesList.map(s => (
                                                <div key={s.id} className="schedule-item-card glass-panel" style={{ padding: '1rem', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.5rem', marginBottom: '0.75rem', position: 'relative' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                        <div>
                                                            <h4 style={{ margin: '0 0 0.25rem 0', fontSize: '0.95rem' }}>{s.report_type}</h4>
                                                            <span style={{ fontSize: '0.75rem', padding: '0.1rem 0.4rem', background: '#3b82f6', color: 'white', borderRadius: '0.2rem', fontWeight: 'bold', textTransform: 'uppercase' }}>
                                                                {s.frequency}
                                                            </span>
                                                        </div>
                                                        <button 
                                                            className="delete-sched-btn"
                                                            onClick={() => handleDeleteSchedule(s.id)}
                                                            style={{ background: 'none', border: 'none', color: '#ff4d4f', cursor: 'pointer', fontSize: '1rem' }}
                                                        >
                                                            <TrashIcon size={14} />
                                                        </button>
                                                    </div>
                                                    <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: '#94a3b8', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                                        <div><MailIcon size={12} /> <strong>Recipients:</strong> {s.recipients}</div>
                                                        <div><ClockIcon size={12} /> <strong>Time:</strong> {s.time_of_delivery}</div>
                                                        <div><SendIcon size={12} /> <strong>Channel:</strong> {s.delivery_method}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 3. DOWNLOADS ARCHIVE */}
                    {subTab === 'history' && (
                        <div className="reports-history-workspace glass-panel">
                            <h3><FolderIcon size={16} /> Generated Reports Archive</h3>
                            {historyLoading ? (
                                <div className="loading-spinner">Loading archive...</div>
                            ) : historyList.length === 0 ? (
                                <p className="no-data-msg">No reports found in history archive.</p>
                            ) : (
                                <div className="history-table-container">
                                    <table className="history-table">
                                        <thead>
                                            <tr>
                                                <th>Report Name</th>
                                                <th>Type</th>
                                                <th>Period</th>
                                                <th>Generated At</th>
                                                <th>Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {historyList.map(h => (
                                                <tr key={h.report_id}>
                                                    <td className="file-name-cell"><FileTextIcon size={14} /> {h.name}</td>
                                                    <td>{h.report_type}</td>
                                                    <td>{h.period}</td>
                                                    <td>{new Date(h.generated_at).toLocaleString()}</td>
                                                    <td>
                                                        <a 
                                                            href={`${API_BASE}${h.file_path}`} 
                                                            download 
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="download-link-btn"
                                                        >
                                                            <DownloadIcon size={14} /> Download
                                                        </a>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
