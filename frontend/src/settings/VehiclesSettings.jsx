import React, { useState } from 'react';
import { CarIcon, WrenchIcon, TagIcon } from './Icons';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '';

const getVehicleEmoji = (type) => {
    switch (type?.toLowerCase()) {
        case 'motorcycle': return '🏍️';
        case 'tricycle': return '🛺';
        case 'bus': return '🚌';
        case 'truck': return '🚚';
        case 'van': return '🚐';
        case 'car':
        default: return '🚗';
    }
};

export default function VehiclesSettings({
    editingVehicleId,
    setEditingVehicleId,
    billingVehicles = [],
    handleStartEditVehicle,
    editName,
    setEditName,
    editPlateNumber,
    setEditPlateNumber,
    editDriverName,
    setEditDriverName,
    editVehicleType,
    setEditVehicleType,
    editImei,
    setEditImei,
    editTrackerType,
    setEditTrackerType,
    vehicleSuccess,
    vehicleError,
    vehicleLoading,
    handleSaveVehicleEdit,
    groups = [],
    onGroupsChanged = () => {}
}) {
    // --- Group management local state ---
    const [newGroupName, setNewGroupName] = useState('');
    const [groupsLoading, setGroupsLoading] = useState(false);
    const [groupsError, setGroupsError] = useState('');
    const [groupsSuccess, setGroupsSuccess] = useState('');
    const [renamingGroupId, setRenamingGroupId] = useState(null);
    const [renameValue, setRenameValue] = useState('');
    const [assigningGroupId, setAssigningGroupId] = useState(null);
    const [assignSelections, setAssignSelections] = useState([]);

    const flashGroupSuccess = (msg) => {
        setGroupsSuccess(msg);
        setTimeout(() => setGroupsSuccess(''), 3000);
    };

    const handleCreateGroup = async () => {
        if (!newGroupName.trim()) return;
        setGroupsLoading(true);
        setGroupsError('');
        try {
            await axios.post(`${API_BASE}/api/groups`, { name: newGroupName.trim() });
            setNewGroupName('');
            flashGroupSuccess('Group created successfully.');
            onGroupsChanged();
        } catch (err) {
            setGroupsError(err.response?.data?.error || 'Failed to create group.');
        } finally {
            setGroupsLoading(false);
        }
    };

    const handleRenameGroup = async (groupId) => {
        if (!renameValue.trim()) return;
        setGroupsLoading(true);
        setGroupsError('');
        try {
            await axios.put(`${API_BASE}/api/groups/${groupId}`, { name: renameValue.trim() });
            setRenamingGroupId(null);
            setRenameValue('');
            flashGroupSuccess('Group renamed.');
            onGroupsChanged();
        } catch (err) {
            setGroupsError(err.response?.data?.error || 'Failed to rename group.');
        } finally {
            setGroupsLoading(false);
        }
    };

    const handleDeleteGroup = async (groupId, groupName) => {
        if (!confirm(`Delete group "${groupName}"? Vehicles will be unassigned.`)) return;
        setGroupsLoading(true);
        setGroupsError('');
        try {
            await axios.delete(`${API_BASE}/api/groups/${groupId}`);
            flashGroupSuccess('Group deleted.');
            onGroupsChanged();
        } catch (err) {
            setGroupsError(err.response?.data?.error || 'Failed to delete group.');
        } finally {
            setGroupsLoading(false);
        }
    };

    const handleOpenAssign = (groupId) => {
        const currentVehicles = billingVehicles
            .filter(v => v.group_id === groupId)
            .map(v => v.id);
        setAssignSelections(currentVehicles);
        setAssigningGroupId(groupId);
    };

    const handleAssignSave = async () => {
        setGroupsLoading(true);
        setGroupsError('');
        try {
            await axios.post(`${API_BASE}/api/groups/${assigningGroupId}/assign`, {
                vehicleIds: assignSelections
            });
            setAssigningGroupId(null);
            setAssignSelections([]);
            flashGroupSuccess('Vehicle assignments updated.');
            onGroupsChanged();
        } catch (err) {
            setGroupsError(err.response?.data?.error || 'Failed to save assignments.');
        } finally {
            setGroupsLoading(false);
        }
    };

    const toggleVehicleAssign = (vid) => {
        setAssignSelections(prev =>
            prev.includes(vid) ? prev.filter(id => id !== vid) : [...prev, vid]
        );
    };

    const cardStyle = {
        background: 'rgba(30, 41, 59, 0.4)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '0.75rem',
        padding: '1.25rem 1.5rem',
        marginBottom: '0.75rem',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        flexWrap: 'wrap'
    };

    return (
        <div className="settings-form">
            {/* =================== VEHICLE EDITOR SECTION =================== */}
            <div className="form-section">
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <CarIcon size={20} /> Manage Registered Fleet Vehicles
                </h3>
                <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '1.5rem', lineHeight: '1.4' }}>
                    Select a vehicle from your registered fleet to update its name, license plate, assigned driver, or vehicle type icon.
                </p>

                {/* 1. Selector Dropdown */}
                <div className="form-group" style={{ marginBottom: '2rem' }}>
                    <label style={{ fontSize: '0.95rem', fontWeight: '600', color: '#f8fafc', marginBottom: '0.5rem', display: 'block' }}>
                        Select Vehicle to Customize
                    </label>
                    <select 
                        value={editingVehicleId || ''} 
                        onChange={(e) => {
                            const vId = e.target.value;
                            if (!vId) {
                                setEditingVehicleId(null);
                            } else {
                                const selectedV = billingVehicles.find(v => v.id === vId);
                                if (selectedV) {
                                    handleStartEditVehicle(selectedV);
                                }
                            }
                        }}
                        style={{ 
                            background: '#1e293b', 
                            color: 'white', 
                            border: '1px solid #475569', 
                            padding: '0.75rem', 
                            borderRadius: '0.375rem', 
                            width: '100%', 
                            outline: 'none',
                            fontSize: '1rem',
                            cursor: 'pointer'
                        }}
                    >
                        <option value="">-- Choose a vehicle from your fleet --</option>
                        {billingVehicles.map(v => (
                            <option key={v.id} value={v.id}>
                                {getVehicleEmoji(v.vehicle_type)} {v.name || v.id} ({v.plate_number || 'No Plate'}) — {v.id}
                            </option>
                        ))}
                    </select>
                </div>

                {/* 2. Edit Details Card (Only shown when a vehicle is selected) */}
                {editingVehicleId ? (
                    <div className="glass-panel edit-vehicle-card" style={{
                        background: 'rgba(30, 41, 59, 0.4)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '0.75rem',
                        padding: '1.5rem',
                        marginTop: '1rem',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '0.75rem' }}>
                            <h4 style={{ margin: 0, fontSize: '1.1rem', color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <WrenchIcon size={16} /> Edit Details: {editName || editingVehicleId}
                            </h4>
                            <span style={{ fontSize: '0.8rem', color: '#64748b', fontFamily: 'monospace' }}>
                                IMEI: {editingVehicleId}
                            </span>
                        </div>

                        {vehicleSuccess && <div className="status-alert success" style={{ marginBottom: '1rem' }}>{vehicleSuccess}</div>}
                        {vehicleError && <div className="status-alert error" style={{ marginBottom: '1rem' }}>{vehicleError}</div>}

                        <form onSubmit={(e) => { e.preventDefault(); handleSaveVehicleEdit(editingVehicleId); }}>
                            <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem' }}>
                                
                                {/* Vehicle Name */}
                                <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                    <label style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Vehicle Name / Display Name</label>
                                    <input 
                                        type="text" 
                                        value={editName} 
                                        onChange={(e) => setEditName(e.target.value)}
                                        placeholder="e.g. Delivery Van 01"
                                        style={{ background: '#0f172a', color: 'white', border: '1px solid #334155', padding: '0.65rem 0.75rem', borderRadius: '0.375rem', outline: 'none' }}
                                        required
                                    />
                                </div>

                                {/* License Plate */}
                                <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                    <label style={{ fontSize: '0.85rem', color: '#94a3b8' }}>License Plate Number</label>
                                    <input 
                                        type="text" 
                                        value={editPlateNumber} 
                                        onChange={(e) => setEditPlateNumber(e.target.value)}
                                        placeholder="e.g. LA-123-ENG"
                                        style={{ background: '#0f172a', color: 'white', border: '1px solid #334155', padding: '0.65rem 0.75rem', borderRadius: '0.375rem', outline: 'none' }}
                                    />
                                </div>

                                {/* Driver Name */}
                                <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                    <label style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Assigned Driver Name</label>
                                    <input 
                                        type="text" 
                                        value={editDriverName} 
                                        onChange={(e) => setEditDriverName(e.target.value)}
                                        placeholder="e.g. John Doe"
                                        style={{ background: '#0f172a', color: 'white', border: '1px solid #334155', padding: '0.65rem 0.75rem', borderRadius: '0.375rem', outline: 'none' }}
                                    />
                                </div>

                                {/* Vehicle Type */}
                                <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                    <label style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Vehicle Category / Icon</label>
                                    <select 
                                        value={editVehicleType} 
                                        onChange={(e) => setEditVehicleType(e.target.value)}
                                        style={{ background: '#0f172a', color: 'white', border: '1px solid #334155', padding: '0.65rem 0.75rem', borderRadius: '0.375rem', outline: 'none', cursor: 'pointer' }}
                                    >
                                        <option value="car">🚗 Car</option>
                                        <option value="motorcycle">🏍️ Motorcycle</option>
                                        <option value="tricycle">🛺 Tricycle</option>
                                        <option value="bus">🚌 Bus</option>
                                        <option value="truck">🚚 Truck</option>
                                        <option value="van">🚐 Van</option>
                                    </select>
                                </div>

                                {/* Tracker IMEI */}
                                <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                    <label style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Tracker IMEI (Optional)</label>
                                    <input 
                                        type="text" 
                                        value={editImei} 
                                        onChange={(e) => setEditImei(e.target.value)}
                                        placeholder="e.g. 353742375523461"
                                        style={{ background: '#0f172a', color: 'white', border: '1px solid #334155', padding: '0.65rem 0.75rem', borderRadius: '0.375rem', outline: 'none' }}
                                    />
                                </div>

                                {/* Tracker Type */}
                                <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                    <label style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Tracker Model</label>
                                    <select 
                                        value={editTrackerType} 
                                        onChange={(e) => setEditTrackerType(e.target.value)}
                                        style={{ background: '#0f172a', color: 'white', border: '1px solid #334155', padding: '0.65rem 0.75rem', borderRadius: '0.375rem', outline: 'none', cursor: 'pointer' }}
                                    >
                                        <option value="teltonika">📡 Teltonika (FMB920/etc)</option>
                                        <option value="sinotrack">📡 Sinotrack / GT06</option>
                                        <option value="custom">📡 Simulator / Custom</option>
                                    </select>
                                </div>

                            </div>

                            <div style={{ display: 'flex', gap: '1rem', marginTop: '1.75rem', justifyContent: 'flex-end' }}>
                                <button 
                                    type="button"
                                    onClick={() => setEditingVehicleId(null)}
                                    style={{ padding: '0.65rem 1.25rem', background: '#334155', color: '#f8fafc', border: 'none', borderRadius: '0.375rem', fontWeight: 'bold', cursor: 'pointer' }}
                                >
                                    Cancel
                                </button>
                                <button 
                                    type="submit"
                                    disabled={vehicleLoading}
                                    style={{ 
                                        padding: '0.65rem 1.5rem', 
                                        background: 'linear-gradient(135deg, #3b82f6, #2563eb)', 
                                        color: 'white', 
                                        border: 'none', 
                                        borderRadius: '0.375rem', 
                                        fontWeight: 'bold', 
                                        cursor: 'pointer',
                                        boxShadow: '0 4px 12px rgba(59, 130, 246, 0.2)'
                                    }}
                                >
                                    {vehicleLoading ? 'Saving Changes...' : '💾 Save Configurations'}
                                </button>
                            </div>
                        </form>
                    </div>
                ) : (
                    <div className="glass-panel" style={{
                        background: 'rgba(30, 41, 59, 0.2)',
                        border: '1px dashed rgba(255, 255, 255, 0.1)',
                        borderRadius: '0.75rem',
                        padding: '3rem 1.5rem',
                        textAlign: 'center',
                        color: '#64748b',
                        marginTop: '1rem'
                    }}>
                        <div style={{ marginBottom: '0.5rem', color: '#64748b' }}>
                            <CarIcon size={40} />
                        </div>
                        <p style={{ margin: 0 }}>Please select a vehicle from the dropdown above to edit its settings.</p>
                    </div>
                )}
            </div>

            {/* =================== FLEET GROUPS SECTION =================== */}
            <div className="form-section" style={{ marginTop: '2.5rem', borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '2rem' }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <TagIcon size={20} /> Fleet Groups
                </h3>
                <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '1.5rem', lineHeight: '1.4' }}>
                    Organize your vehicles into named groups (e.g. "Delivery Fleet", "Executive Cars"). Group filters will appear in the sidebar.
                </p>

                {/* Feedback messages */}
                {groupsError && <div className="status-alert error" style={{ marginBottom: '1rem' }}>{groupsError}</div>}
                {groupsSuccess && <div className="status-alert success" style={{ marginBottom: '1rem' }}>{groupsSuccess}</div>}

                {/* Create a new group */}
                <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
                    <input
                        type="text"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
                        placeholder="New group name, e.g. Delivery Fleet"
                        style={{
                            flex: 1,
                            background: '#1e293b',
                            color: 'white',
                            border: '1px solid #475569',
                            padding: '0.65rem 0.75rem',
                            borderRadius: '0.375rem',
                            outline: 'none',
                            fontSize: '0.9rem'
                        }}
                    />
                    <button
                        onClick={handleCreateGroup}
                        disabled={groupsLoading || !newGroupName.trim()}
                        style={{
                            padding: '0.65rem 1.25rem',
                            background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '0.375rem',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap'
                        }}
                    >
                        ＋ Create Group
                    </button>
                </div>

                {/* Groups List */}
                {groups.length === 0 ? (
                    <div style={{
                        background: 'rgba(30, 41, 59, 0.2)',
                        border: '1px dashed rgba(255,255,255,0.1)',
                        borderRadius: '0.75rem',
                        padding: '2.5rem 1.5rem',
                        textAlign: 'center',
                        color: '#64748b'
                    }}>
                        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🏷️</div>
                        <p style={{ margin: 0 }}>No groups yet. Create your first group above.</p>
                    </div>
                ) : (
                    <div>
                        {groups.map(group => (
                            <div key={group.id} style={cardStyle}>
                                {/* Group Name / Rename inline */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    {renamingGroupId === group.id ? (
                                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                            <input
                                                autoFocus
                                                type="text"
                                                value={renameValue}
                                                onChange={(e) => setRenameValue(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && handleRenameGroup(group.id)}
                                                style={{
                                                    background: '#0f172a',
                                                    color: 'white',
                                                    border: '1px solid #3b82f6',
                                                    padding: '0.4rem 0.6rem',
                                                    borderRadius: '0.375rem',
                                                    outline: 'none',
                                                    fontSize: '0.9rem',
                                                    flex: 1
                                                }}
                                            />
                                            <button
                                                onClick={() => handleRenameGroup(group.id)}
                                                disabled={groupsLoading}
                                                style={{ padding: '0.4rem 0.75rem', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', fontSize: '0.8rem' }}
                                            >
                                                Save
                                            </button>
                                            <button
                                                onClick={() => { setRenamingGroupId(null); setRenameValue(''); }}
                                                style={{ padding: '0.4rem 0.75rem', background: '#334155', color: 'white', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', fontSize: '0.8rem' }}
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    ) : (
                                        <div>
                                            <span style={{ fontWeight: '600', color: '#f1f5f9' }}>{group.name}</span>
                                            <span style={{ marginLeft: '0.75rem', fontSize: '0.8rem', color: '#64748b' }}>
                                                {billingVehicles.filter(v => v.group_id === group.id).length} vehicle(s)
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* Action buttons */}
                                <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                                    <button
                                        onClick={() => handleOpenAssign(group.id)}
                                        style={{ padding: '0.4rem 0.75rem', background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '0.375rem', cursor: 'pointer', fontSize: '0.8rem' }}
                                    >
                                        🚗 Assign
                                    </button>
                                    <button
                                        onClick={() => { setRenamingGroupId(group.id); setRenameValue(group.name); }}
                                        style={{ padding: '0.4rem 0.75rem', background: 'rgba(234,179,8,0.15)', color: '#facc15', border: '1px solid rgba(234,179,8,0.3)', borderRadius: '0.375rem', cursor: 'pointer', fontSize: '0.8rem' }}
                                    >
                                        ✏️ Rename
                                    </button>
                                    <button
                                        onClick={() => handleDeleteGroup(group.id, group.name)}
                                        disabled={groupsLoading}
                                        style={{ padding: '0.4rem 0.75rem', background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '0.375rem', cursor: 'pointer', fontSize: '0.8rem' }}
                                    >
                                        🗑️ Delete
                                    </button>
                                </div>

                                {/* Vehicle assignment panel */}
                                {assigningGroupId === group.id && (
                                    <div style={{ width: '100%', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                                        <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
                                            Select vehicles to assign to <strong style={{ color: '#60a5fa' }}>{group.name}</strong>:
                                        </p>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem', marginBottom: '0.75rem' }}>
                                            {billingVehicles.map(v => (
                                                <label key={v.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', padding: '0.4rem 0.6rem', background: assignSelections.includes(v.id) ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.03)', borderRadius: '0.375rem', border: `1px solid ${assignSelections.includes(v.id) ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.06)'}` }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={assignSelections.includes(v.id)}
                                                        onChange={() => toggleVehicleAssign(v.id)}
                                                        style={{ accentColor: '#3b82f6' }}
                                                    />
                                                    <span style={{ fontSize: '0.85rem', color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {getVehicleEmoji(v.vehicle_type)} {v.name || v.id}
                                                    </span>
                                                </label>
                                            ))}
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <button
                                                onClick={handleAssignSave}
                                                disabled={groupsLoading}
                                                style={{ padding: '0.5rem 1rem', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', color: 'white', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}
                                            >
                                                💾 Save Assignments
                                            </button>
                                            <button
                                                onClick={() => setAssigningGroupId(null)}
                                                style={{ padding: '0.5rem 1rem', background: '#334155', color: 'white', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', fontSize: '0.85rem' }}
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

        </div>
    );
}
