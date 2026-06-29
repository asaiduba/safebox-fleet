import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import './SettingsPanel.css';

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

const CURRENCY_SYMBOLS = {
    'NGN': '₦',
    'USD': '$',
    'EUR': '€',
    'GBP': '£',
    'KES': 'KSh',
    'RWF': 'FRw'
};

const getCurrencyPrice = (nairaAmount, currencyCode) => {
    switch (currencyCode) {
        case 'USD': return (nairaAmount / 1500); // 1 USD = 1500 NGN
        case 'EUR': return (nairaAmount / 1600); // 1 EUR = 1600 NGN
        case 'GBP': return (nairaAmount / 1900); // 1 GBP = 1900 NGN
        case 'KES': return (nairaAmount / 11);   // 1 KES = 11 NGN
        case 'RWF': return (nairaAmount / 1.15); // 1 RWF = 1.15 NGN
        default: return nairaAmount;
    }
};

const formatCurrencyValue = (nairaAmount, currencyCode) => {
    const symbol = CURRENCY_SYMBOLS[currencyCode] || '₦';
    const convertedVal = getCurrencyPrice(nairaAmount, currencyCode);
    return `${symbol}${convertedVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function SettingsPanel({ user, onBack, onProfileUpdate }) {
    const API_BASE = import.meta.env.VITE_API_URL || '';

    // Form States
    const [email, setEmail] = useState(user.email || '');
    const [phone, setPhone] = useState(user.phone || '');
    const [companyName, setCompanyName] = useState(user.company_name || '');
    const [currency, setCurrency] = useState(user.currency || 'NGN');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [oldPassword, setOldPassword] = useState('');
    const [showOTPModal, setShowOTPModal] = useState(false);
    const [otpCode, setOtpCode] = useState('');
    const [otpLoading, setOtpLoading] = useState(false);
    const [otpError, setOtpError] = useState('');
    const [settingsFallbackCode, setSettingsFallbackCode] = useState('');

    // Notification Toggles (saved to localStorage per user)
    const [batteryAlert, setBatteryAlert] = useState(true);
    const [fuelAlert, setFuelAlert] = useState(true);
    const [geofenceAlert, setGeofenceAlert] = useState(true);

    // Safety Thresholds (Admin only - saved to localStorage / simulated telemetry)
    const [speedLimit, setSpeedLimit] = useState(100);
    const [brakingThreshold, setBrakingThreshold] = useState(0.3);
    const [corneringThreshold, setCorneringThreshold] = useState(0.35);

    const [statusMsg, setStatusMsg] = useState({ type: '', text: '' });
    const [loading, setLoading] = useState(false);

    // Fleet Billing States
    const [billingVehicles, setBillingVehicles] = useState([]);
    const [selectedBillingIds, setSelectedBillingIds] = useState(new Set());
    const [paymentHistory, setPaymentHistory] = useState([]);
    const [billingLoading, setBillingLoading] = useState(false);
    const [billingMsg, setBillingMsg] = useState({ type: '', text: '' });
    const [billingCycle, setBillingCycle] = useState('monthly');
    const [pricePerVehicle, setPricePerVehicle] = useState(3000);

    const [activeTab, setActiveTab] = useState(user?.subscription_status === 'SUSPENDED' ? 'billing' : 'general');

    // Maintenance Alerts States
    const [selectedVehicleId, setSelectedVehicleId] = useState('');
    const [maintenanceReminders, setMaintenanceReminders] = useState([]);
    const [reminderType, setReminderType] = useState('Oil Change');
    const [customName, setCustomName] = useState('');
    const [thresholdKm, setThresholdKm] = useState('');
    const [lastServiceKm, setLastServiceKm] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [notes, setNotes] = useState('');
    const [editingReminderId, setEditingReminderId] = useState(null);
    const [maintenanceLoading, setMaintenanceLoading] = useState(false);
    const [maintenanceError, setMaintenanceError] = useState('');
    const [maintenanceSuccess, setMaintenanceSuccess] = useState('');

    // Support Mode States
    const [supportCode, setSupportCode] = useState('');
    const [supportExpiresAt, setSupportExpiresAt] = useState(null);
    const [supportLoading, setSupportLoading] = useState(false);
    const [timeLeft, setTimeLeft] = useState('');

    // Curfew / Vehicle Access Policy Settings States
    const [curfewEnabled, setCurfewEnabled] = useState(false);
    const [curfewStart, setCurfewStart] = useState('06:00');
    const [curfewEnd, setCurfewEnd] = useState('18:00');
    const [curfewDays, setCurfewDays] = useState(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    const [curfewAllowOverride, setCurfewAllowOverride] = useState(true);
    const [curfewHolidayMode, setCurfewHolidayMode] = useState(false);
    const [applyTo, setApplyTo] = useState('selected'); // 'selected' or 'all'
    const [selectedCurfewVehicleIds, setSelectedCurfewVehicleIds] = useState(new Set());
    const [curfewLoading, setCurfewLoading] = useState(false);
    const [curfewMsg, setCurfewMsg] = useState({ type: '', text: '' });

    // Fuel settings states
    const [fuelSettingsList, setFuelSettingsList] = useState([]);
    const [fuelLoading, setFuelLoading] = useState(false);
    const [fuelSuccess, setFuelSuccess] = useState('');
    const [fuelError, setFuelError] = useState('');
    const [editingFuelVehicleId, setEditingFuelVehicleId] = useState(null);
    const [fuelType, setFuelType] = useState('Premium Petrol');
    const [fuelPrice, setFuelPrice] = useState(1000);
    const [fuelEfficiency, setFuelEfficiency] = useState(12);

    // Bulk Fuel settings states
    const [selectedFuelVehicles, setSelectedFuelVehicles] = useState([]);
    const [bulkFuelType, setBulkFuelType] = useState('Premium Petrol');
    const [bulkFuelPrice, setBulkFuelPrice] = useState('');
    const [bulkFuelEfficiency, setBulkFuelEfficiency] = useState('');

    // BLE Keyless Entry States
    const [bleVehicleId, setBleVehicleId] = useState('');
    const [bleBeaconId, setBleBeaconId] = useState('');
    const [bleBeaconRssiThreshold, setBleBeaconRssiThreshold] = useState(-80);
    const [bleLoading, setBleLoading] = useState(false);
    const [bleSuccess, setBleSuccess] = useState('');
    const [bleError, setBleError] = useState('');

    // Manage Vehicles Tab States
    const [editingVehicleId, setEditingVehicleId] = useState(null);
    const [editName, setEditName] = useState('');
    const [editPlateNumber, setEditPlateNumber] = useState('');
    const [editDriverName, setEditDriverName] = useState('');
    const [editVehicleType, setEditVehicleType] = useState('car');
    const [vehicleLoading, setVehicleLoading] = useState(false);
    const [vehicleSuccess, setVehicleSuccess] = useState('');
    const [vehicleError, setVehicleError] = useState('');

    const handleStartEditVehicle = (vehicle) => {
        setEditingVehicleId(vehicle.id);
        setEditName(vehicle.name || '');
        setEditPlateNumber(vehicle.plate_number || '');
        setEditDriverName(vehicle.driver_name || '');
        setEditVehicleType(vehicle.vehicle_type || 'car');
        setVehicleSuccess('');
        setVehicleError('');
    };

    const handleSaveVehicleEdit = async (vehicleId) => {
        setVehicleLoading(true);
        setVehicleSuccess('');
        setVehicleError('');

        try {
            const token = localStorage.getItem('token');
            await axios.put(`${API_BASE}/api/vehicles/${vehicleId}`, {
                name: editName.trim(),
                plateNumber: editPlateNumber.trim().toUpperCase(),
                driverName: editDriverName.trim(),
                vehicleType: editVehicleType
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });

            setVehicleSuccess('Vehicle details updated successfully!');
            setEditingVehicleId(null);
            fetchBillingStatus(); // Refresh vehicles list
        } catch (err) {
            console.error('Failed to update vehicle:', err);
            setVehicleError(err.response?.data?.error || 'Failed to update vehicle.');
        } finally {
            setVehicleLoading(false);
        }
    };

    // Auto-select first vehicle for BLE settings on load
    useEffect(() => {
        if (billingVehicles.length > 0 && !bleVehicleId) {
            setBleVehicleId(billingVehicles[0].id);
        }
    }, [billingVehicles, bleVehicleId]);

    // Load selected vehicle's current BLE configurations
    useEffect(() => {
        if (bleVehicleId && billingVehicles.length > 0) {
            const selectedV = billingVehicles.find(v => v.id === bleVehicleId);
            if (selectedV) {
                setBleBeaconId(selectedV.ble_beacon_id || '');
                setBleBeaconRssiThreshold(selectedV.ble_beacon_rssi_threshold !== undefined && selectedV.ble_beacon_rssi_threshold !== null ? selectedV.ble_beacon_rssi_threshold : -80);
            }
        }
    }, [bleVehicleId, billingVehicles]);

    const handleSaveBleSettings = async (e) => {
        e.preventDefault();
        if (!bleVehicleId) return;

        setBleLoading(true);
        setBleError('');
        setBleSuccess('');

        try {
            const token = localStorage.getItem('token');
            await axios.post(`${API_BASE}/api/vehicles/ble-settings`, {
                vehicleId: bleVehicleId,
                bleBeaconId: bleBeaconId.trim(),
                bleBeaconRssiThreshold: parseInt(bleBeaconRssiThreshold)
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });

            setBleSuccess('BLE Keyless Entry configurations saved successfully!');
            fetchBillingStatus(); // refresh local vehicles data
        } catch (err) {
            console.error('Failed to save BLE settings:', err);
            setBleError(err.response?.data?.error || 'Failed to save BLE settings.');
        } finally {
            setBleLoading(false);
        }
    };

    const loadFuelSettings = useCallback(async () => {
        setFuelLoading(true);
        setFuelError('');
        try {
            const token = localStorage.getItem('token');
            const res = await axios.get(`${API_BASE}/api/vehicles/fuel-settings`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setFuelSettingsList(res.data);
        } catch (err) {
            console.error('Failed to load fuel settings:', err);
            setFuelError(err.response?.data?.error || 'Failed to load fuel settings');
        } finally {
            setFuelLoading(false);
        }
    }, [API_BASE]);

    useEffect(() => {
        if (activeTab === 'fuel') {
            loadFuelSettings();
        }
    }, [activeTab, loadFuelSettings]);

    const handleSaveFuelSetting = async (vId) => {
        setFuelLoading(true);
        setFuelError('');
        setFuelSuccess('');
        try {
            const token = localStorage.getItem('token');
            await axios.post(`${API_BASE}/api/vehicles/fuel-settings`, {
                vehicleId: vId,
                fuelType,
                fuelPrice: parseFloat(fuelPrice),
                fuelEfficiency: parseFloat(fuelEfficiency)
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setFuelSuccess('Fuel settings updated successfully!');
            setEditingFuelVehicleId(null);
            loadFuelSettings();
        } catch (err) {
            console.error('Failed to save fuel setting:', err);
            setFuelError(err.response?.data?.error || 'Failed to save fuel setting');
        } finally {
            setFuelLoading(false);
        }
    };

    const handleSaveBulkFuelSettings = async () => {
        if (selectedFuelVehicles.length === 0) {
            setFuelError('Please select at least one vehicle.');
            return;
        }
        if (!bulkFuelEfficiency || isNaN(parseFloat(bulkFuelEfficiency))) {
            setFuelError('Please enter a valid fuel efficiency.');
            return;
        }
        if (!bulkFuelPrice || isNaN(parseFloat(bulkFuelPrice))) {
            setFuelError('Please enter a valid fuel price.');
            return;
        }

        setFuelLoading(true);
        setFuelError('');
        setFuelSuccess('');
        try {
            const token = localStorage.getItem('token');
            await axios.post(`${API_BASE}/api/vehicles/fuel-settings`, {
                vehicleIds: selectedFuelVehicles,
                fuelType: bulkFuelType,
                fuelPrice: parseFloat(bulkFuelPrice),
                fuelEfficiency: parseFloat(bulkFuelEfficiency)
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setFuelSuccess(`Fuel settings updated successfully for ${selectedFuelVehicles.length} vehicles!`);
            setSelectedFuelVehicles([]);
            setBulkFuelEfficiency('');
            setBulkFuelPrice('');
            loadFuelSettings();
        } catch (err) {
            console.error('Failed to save bulk fuel settings:', err);
            setFuelError(err.response?.data?.error || 'Failed to save bulk fuel settings');
        } finally {
            setFuelLoading(false);
        }
    };

    // Auto-populate curfew input fields based on existing values of vehicles
    useEffect(() => {
        if (billingVehicles.length > 0) {
            const curfewed = billingVehicles.find(v => v.curfew_enabled === 1);
            if (curfewed) {
                setCurfewEnabled(true);
                setCurfewStart(curfewed.curfew_start || '06:00');
                setCurfewEnd(curfewed.curfew_end || '18:00');
                setCurfewAllowOverride(curfewed.curfew_allow_override !== 0);
                setCurfewHolidayMode(curfewed.curfew_holiday_mode === 1);
                
                let days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                if (curfewed.curfew_days) {
                    try {
                        days = JSON.parse(curfewed.curfew_days);
                    } catch (err) {
                        console.error('Failed to parse curfew days', err);
                    }
                }
                setCurfewDays(days);
            } else if (billingVehicles[0]) {
                setCurfewEnabled(false);
                setCurfewStart(billingVehicles[0].curfew_start || '06:00');
                setCurfewEnd(billingVehicles[0].curfew_end || '18:00');
                setCurfewAllowOverride(billingVehicles[0].curfew_allow_override !== 0);
                setCurfewHolidayMode(billingVehicles[0].curfew_holiday_mode === 1);
                
                let days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                if (billingVehicles[0].curfew_days) {
                    try {
                        days = JSON.parse(billingVehicles[0].curfew_days);
                    } catch (err) {
                        console.error('Failed to parse billing vehicle curfew days', err);
                    }
                }
                setCurfewDays(days);
            }
        }
    }, [billingVehicles]);

    const handleCurfewVehicleToggle = (vid) => {
        const next = new Set(selectedCurfewVehicleIds);
        if (next.has(vid)) {
            next.delete(vid);
        } else {
            next.add(vid);
        }
        setSelectedCurfewVehicleIds(next);
    };

    const handleSelectAllCurfew = () => {
        if (selectedCurfewVehicleIds.size === billingVehicles.length) {
            setSelectedCurfewVehicleIds(new Set());
        } else {
            setSelectedCurfewVehicleIds(new Set(billingVehicles.map(v => v.id)));
        }
    };

    const handleApplyCurfew = async () => {
        if (applyTo === 'selected' && selectedCurfewVehicleIds.size === 0) {
            setCurfewMsg({ type: 'error', text: 'Please select at least one vehicle to apply policy settings.' });
            return;
        }

        setCurfewLoading(true);
        setCurfewMsg({ type: '', text: '' });

        try {
            await axios.post(`${API_BASE}/api/vehicles/curfew`, {
                vehicleIds: applyTo === 'all' ? [] : Array.from(selectedCurfewVehicleIds),
                applyTo,
                curfewEnabled,
                curfewStart,
                curfewEnd,
                curfewDays,
                curfewAllowOverride,
                curfewHolidayMode
            });

            setCurfewMsg({ type: 'success', text: '🕒 Operating hours policy applied successfully!' });
            fetchBillingStatus(); // refresh vehicles list to reflect updated curfew settings
        } catch (err) {
            console.error('Failed to apply curfew settings:', err);
            setCurfewMsg({ type: 'error', text: err.response?.data?.error || 'Failed to apply curfew settings.' });
        } finally {
            setCurfewLoading(false);
        }
    };

    // Auto-select first vehicle for maintenance alerts when billing vehicles load
    useEffect(() => {
        if (billingVehicles.length > 0 && !selectedVehicleId) {
            setSelectedVehicleId(billingVehicles[0].id);
        }
    }, [billingVehicles, selectedVehicleId]);

    // Fetch maintenance reminders when vehicle changes (Moved down below fetchMaintenance definition)

    // Cache/Load support code on mount
    useEffect(() => {
        const stored = localStorage.getItem(`support_code_${user.id}`);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (parsed.expiresAt > Date.now()) {
                    setSupportCode(parsed.code);
                    setSupportExpiresAt(parsed.expiresAt);
                } else {
                    localStorage.removeItem(`support_code_${user.id}`);
                }
            } catch (e) {
                console.error("Failed to parse cached support code", e);
            }
        }
    }, [user.id]);

    // Support code expiration timer
    useEffect(() => {
        if (!supportExpiresAt) return;

        const updateTimer = () => {
            const diff = supportExpiresAt - Date.now();
            if (diff <= 0) {
                setTimeLeft('Expired');
                setSupportCode('');
                setSupportExpiresAt(null);
                localStorage.removeItem(`support_code_${user.id}`);
                return;
            }

            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);

            setTimeLeft(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
        };

        updateTimer();
        const interval = setInterval(updateTimer, 1000);
        return () => clearInterval(interval);
    }, [supportExpiresAt, user.id]);

    // Fetch maintenance reminders
    const fetchMaintenance = useCallback(async (vehicleId) => {
        if (!vehicleId) return;
        setMaintenanceLoading(true);
        try {
            const res = await axios.get(`${API_BASE}/api/vehicles/${vehicleId}/maintenance`);
            setMaintenanceReminders(res.data || []);
        } catch (e) {
            console.error("Failed to fetch maintenance reminders", e);
            setMaintenanceError("Failed to fetch maintenance reminders.");
        } finally {
            setMaintenanceLoading(false);
        }
    }, [API_BASE]);

    // Fetch maintenance reminders when vehicle changes
    useEffect(() => {
        if (selectedVehicleId) {
            fetchMaintenance(selectedVehicleId);
        }
    }, [selectedVehicleId, fetchMaintenance]);

    // Add or update maintenance reminder
    const handleSaveMaintenanceReminder = async (e) => {
        e.preventDefault();
        if (!selectedVehicleId) return;

        setMaintenanceLoading(true);
        setMaintenanceError('');
        setMaintenanceSuccess('');

        try {
            const payload = {
                type: reminderType,
                custom_name: customName,
                threshold_km: thresholdKm ? parseFloat(thresholdKm) : null,
                last_service_km: lastServiceKm ? parseFloat(lastServiceKm) : null,
                due_date: dueDate ? new Date(dueDate).getTime() : null,
                notes
            };

            if (editingReminderId) {
                payload.id = editingReminderId;
            }

            await axios.post(`${API_BASE}/api/vehicles/${selectedVehicleId}/maintenance`, payload);

            setMaintenanceSuccess(editingReminderId ? "Reminder updated successfully!" : "Reminder added successfully!");
            
            // Reset fields
            setReminderType('Oil Change');
            setCustomName('');
            setThresholdKm('');
            setLastServiceKm('');
            setDueDate('');
            setNotes('');
            setEditingReminderId(null);

            fetchMaintenance(selectedVehicleId);
        } catch (err) {
            console.error("Failed to save maintenance reminder", err);
            setMaintenanceError(err.response?.data?.error || "Failed to save maintenance reminder.");
        } finally {
            setMaintenanceLoading(false);
        }
    };

    // Start editing reminder
    const handleStartEditReminder = (reminder) => {
        setEditingReminderId(reminder.id);
        setReminderType(reminder.type);
        setCustomName(reminder.custom_name || '');
        setThresholdKm(reminder.threshold_km || '');
        setLastServiceKm(reminder.last_service_km || '');
        setDueDate(reminder.due_date ? new Date(reminder.due_date).toISOString().split('T')[0] : '');
        setNotes(reminder.notes || '');
    };

    // Toggle reminder status PENDING/COMPLETED
    const handleToggleReminderStatus = async (reminder) => {
        setMaintenanceLoading(true);
        setMaintenanceError('');
        setMaintenanceSuccess('');

        try {
            const nextStatus = reminder.status === 'PENDING' ? 'COMPLETED' : 'PENDING';
            const payload = {
                id: reminder.id,
                type: reminder.type,
                custom_name: reminder.custom_name,
                threshold_km: reminder.threshold_km,
                last_service_km: reminder.last_service_km,
                due_date: reminder.due_date,
                notes: reminder.notes,
                status: nextStatus
            };

            await axios.post(`${API_BASE}/api/vehicles/${selectedVehicleId}/maintenance`, payload);
            setMaintenanceSuccess(`Reminder marked as ${nextStatus.toLowerCase()}!`);
            fetchMaintenance(selectedVehicleId);
        } catch (err) {
            console.error("Failed to toggle reminder status", err);
            setMaintenanceError("Failed to update status.");
        } finally {
            setMaintenanceLoading(false);
        }
    };

    // Delete maintenance reminder
    const handleDeleteMaintenanceReminder = async (reminderId) => {
        if (!window.confirm("Are you sure you want to delete this reminder?")) return;

        setMaintenanceLoading(true);
        setMaintenanceError('');
        setMaintenanceSuccess('');

        try {
            await axios.delete(`${API_BASE}/api/vehicles/${selectedVehicleId}/maintenance/${reminderId}`);
            setMaintenanceSuccess("Reminder deleted successfully!");
            fetchMaintenance(selectedVehicleId);
        } catch (err) {
            console.error("Failed to delete maintenance reminder", err);
            setMaintenanceError(err.response?.data?.error || "Failed to delete maintenance reminder.");
        } finally {
            setMaintenanceLoading(false);
        }
    };

    // Generate support mode code
    const handleGenerateSupportCode = async () => {
        setSupportLoading(true);
        try {
            const res = await axios.post(`${API_BASE}/api/support/generate-code`);
            setSupportCode(res.data.code);
            setSupportExpiresAt(res.data.expiresAt);
            localStorage.setItem(`support_code_${user.id}`, JSON.stringify(res.data));
        } catch (err) {
            console.error("Failed to generate support code", err);
        } finally {
            setSupportLoading(false);
        }
    };

    // Fleet Billing info
    const fetchBillingStatus = useCallback(async () => {
        try {
            const res = await axios.get(`${API_BASE}/api/payments/status?userId=${user.id}`);
            setBillingVehicles(res.data.vehicles || []);
            setPaymentHistory(res.data.history || []);
            setPricePerVehicle(res.data.pricePerVehicle || 3000);
            
            // Check all active or grace period vehicles by default
            const initialSelected = new Set();
            res.data.vehicles?.forEach(v => {
                if (v.subscription_status !== 'SUSPENDED' && v.subscription_status !== 'EXPIRED') {
                    initialSelected.add(v.id);
                }
            });
            setSelectedBillingIds(initialSelected);
        } catch (e) {
            console.error("Failed to load billing status", e);
        }
    }, [API_BASE, user.id]);

    useEffect(() => {
        fetchBillingStatus();
    }, [fetchBillingStatus]);

    useEffect(() => {
        setPricePerVehicle(billingCycle === 'annual' ? 30000 : 3000);
    }, [billingCycle]);

    const handleVehicleToggle = (vid) => {
        const next = new Set(selectedBillingIds);
        if (next.has(vid)) {
            next.delete(vid);
        } else {
            next.add(vid);
        }
        setSelectedBillingIds(next);
    };

    const handleSelectAllBilling = () => {
        if (selectedBillingIds.size === billingVehicles.length) {
            setSelectedBillingIds(new Set());
        } else {
            setSelectedBillingIds(new Set(billingVehicles.map(v => v.id)));
        }
    };

    const handleBulkCheckout = async () => {
        if (selectedBillingIds.size === 0) {
            setBillingMsg({ type: 'error', text: 'Please select at least one vehicle to renew.' });
            return;
        }

        setBillingLoading(true);
        setBillingMsg({ type: '', text: '' });

        try {
            const res = await axios.post(`${API_BASE}/api/payments/initialize-bulk`, {
                userId: user.id,
                vehicleIds: Array.from(selectedBillingIds),
                billingCycle
            });

            // Redirect to checkout URL
            if (res.data.authorization_url) {
                window.location.href = res.data.authorization_url;
            } else {
                setBillingMsg({ type: 'error', text: 'Gateway initialization failed.' });
            }
        } catch (err) {
            console.error('Checkout error:', err);
            setBillingMsg({ type: 'error', text: err.response?.data?.error || 'Failed to connect to gateway.' });
        } finally {
            setBillingLoading(false);
        }
    };

    // Load custom settings on mount
    useEffect(() => {
        const stored = localStorage.getItem(`settings_${user.id}`);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                setBatteryAlert(parsed.batteryAlert !== false);
                setFuelAlert(parsed.fuelAlert !== false);
                setGeofenceAlert(parsed.geofenceAlert !== false);
                setSpeedLimit(parsed.speedLimit || 100);
                setBrakingThreshold(parsed.brakingThreshold || 0.3);
                setCorneringThreshold(parsed.corneringThreshold || 0.35);
            } catch (e) {
                console.error("Failed to load custom settings", e);
            }
        }
    }, [user.id]);

    const handleSave = async (e) => {
        e.preventDefault();
        setLoading(true);
        setStatusMsg({ type: '', text: '' });

        const isChangingPassword = !!(password || confirmPassword || oldPassword);

        if (isChangingPassword) {
            if (!oldPassword) {
                setStatusMsg({ type: 'error', text: 'Current password is required to change password.' });
                setLoading(false);
                return;
            }
            if (password !== confirmPassword) {
                setStatusMsg({ type: 'error', text: 'Passwords do not match.' });
                setLoading(false);
                return;
            }
            if (password.length < 6) {
                setStatusMsg({ type: 'error', text: 'Password must be at least 6 characters.' });
                setLoading(false);
                return;
            }

            try {
                // Request OTP code
                const res = await axios.post(`${API_BASE}/api/profile/request-password-change-otp`, {
                    oldPassword
                });
                setShowOTPModal(true);
                setOtpCode('');
                setOtpError('');
                setSettingsFallbackCode(res.data && res.data.devVerificationCode ? res.data.devVerificationCode : '');
            } catch (err) {
                console.error('Failed to request password change OTP:', err);
                setStatusMsg({ type: 'error', text: err.response?.data?.error || 'Failed to request verification code.' });
            } finally {
                setLoading(false);
            }
            return;
        }

        try {
            // Update Database User Info directly (no password change)
            const token = localStorage.getItem('token');
            await axios.post(`${API_BASE}/api/profile/update`, {
                userId: user.id,
                email,
                phone,
                companyName: user.role === 'company' ? companyName : undefined,
                currency
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });

            // Persist Notification and Threshold settings locally
            const customSettings = {
                batteryAlert,
                fuelAlert,
                geofenceAlert,
                speedLimit,
                brakingThreshold,
                corneringThreshold
            };
            localStorage.setItem(`settings_${user.id}`, JSON.stringify(customSettings));

            // Notify parent app
            onProfileUpdate({
                ...user,
                email,
                phone,
                company_name: companyName,
                currency
            });

            setStatusMsg({ type: 'success', text: '⚙️ Settings saved successfully!' });
        } catch (err) {
            setStatusMsg({ type: 'error', text: err.response?.data?.error || 'Failed to save settings.' });
        } finally {
            setLoading(false);
        }
    };

    const handleConfirmPasswordChange = async (e) => {
        e.preventDefault();
        if (!otpCode || otpCode.length !== 6) {
            setOtpError('Please enter a valid 6-digit verification code.');
            return;
        }

        setOtpLoading(true);
        setOtpError('');

        try {
            // Update Database User Info (with password change)
            await axios.post(`${API_BASE}/api/profile/update`, {
                userId: user.id,
                email,
                phone,
                companyName: user.role === 'company' ? companyName : undefined,
                password,
                oldPassword,
                otpCode
            });

            // Persist Notification and Threshold settings locally
            const customSettings = {
                batteryAlert,
                fuelAlert,
                geofenceAlert,
                speedLimit,
                brakingThreshold,
                corneringThreshold
            };
            localStorage.setItem(`settings_${user.id}`, JSON.stringify(customSettings));

            // Notify parent app
            onProfileUpdate({
                ...user,
                email,
                phone,
                company_name: companyName
            });

            // Clear password fields
            setPassword('');
            setConfirmPassword('');
            setOldPassword('');

            setShowOTPModal(false);
            setStatusMsg({ type: 'success', text: '⚙️ Settings and password updated successfully!' });
        } catch (err) {
            console.error('Password change verification failed:', err);
            setOtpError(err.response?.data?.error || 'Failed to verify code.');
        } finally {
            setOtpLoading(false);
        }
    };

    return (
        <div className="settings-overlay">
            <div className="settings-container">
                <header className="settings-header">
                    <h2>⚙️ Settings & Configuration</h2>
                    <button className="close-btn" onClick={onBack}>✕</button>
                </header>

                <div className="settings-layout">
                    <aside className="settings-sidebar">
                        <button 
                            type="button" 
                            className={`sidebar-tab ${activeTab === 'general' ? 'active' : ''}`}
                            onClick={() => setActiveTab('general')}
                        >
                            👤 General Settings
                        </button>
                        <button 
                            type="button" 
                            className={`sidebar-tab ${activeTab === 'thresholds' ? 'active' : ''}`}
                            onClick={() => setActiveTab('thresholds')}
                            disabled={user?.subscription_status === 'SUSPENDED'}
                            style={user?.subscription_status === 'SUSPENDED' ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                        >
                            {user.role === 'company' ? '🛡️ Safety & Curfew' : '🕒 Curfew Settings'}
                        </button>
                        <button 
                            type="button" 
                            className={`sidebar-tab ${activeTab === 'billing' ? 'active' : ''}`}
                            onClick={() => setActiveTab('billing')}
                        >
                            💳 Fleet Billing
                        </button>
                        <button 
                            type="button" 
                            className={`sidebar-tab ${activeTab === 'maintenance' ? 'active' : ''}`}
                            onClick={() => setActiveTab('maintenance')}
                            disabled={user?.subscription_status === 'SUSPENDED'}
                            style={user?.subscription_status === 'SUSPENDED' ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                        >
                            🔧 Maintenance Alerts
                        </button>
                        <button 
                            type="button" 
                            className={`sidebar-tab ${activeTab === 'support' ? 'active' : ''}`}
                            onClick={() => setActiveTab('support')}
                            disabled={user?.subscription_status === 'SUSPENDED'}
                            style={user?.subscription_status === 'SUSPENDED' ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                        >
                            💬 Support Mode
                        </button>
                        <button 
                            type="button" 
                            className={`sidebar-tab ${activeTab === 'fuel' ? 'active' : ''}`}
                            onClick={() => setActiveTab('fuel')}
                            disabled={user?.subscription_status === 'SUSPENDED'}
                            style={user?.subscription_status === 'SUSPENDED' ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                        >
                            ⛽ Fuel & Cost
                        </button>
                        <button 
                            type="button" 
                            className={`sidebar-tab ${activeTab === 'ble' ? 'active' : ''}`}
                            onClick={() => setActiveTab('ble')}
                            disabled={user?.subscription_status === 'SUSPENDED'}
                            style={user?.subscription_status === 'SUSPENDED' ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                        >
                            🔑 BLE Keyless
                        </button>
                        <button 
                            type="button" 
                            className={`sidebar-tab ${activeTab === 'vehicles' ? 'active' : ''}`}
                            onClick={() => setActiveTab('vehicles')}
                            disabled={user?.subscription_status === 'SUSPENDED'}
                            style={user?.subscription_status === 'SUSPENDED' ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                        >
                            🚗 Manage Vehicles
                        </button>
                    </aside>

                    <div className="settings-content-wrapper">
                        {statusMsg.text && (activeTab === 'general' || activeTab === 'thresholds') && (
                            <div className={`status-alert ${statusMsg.type}`}>
                                {statusMsg.text}
                            </div>
                        )}

                        {activeTab === 'general' && (
                            <form onSubmit={handleSave} className="settings-form">
                                {/* SECTION 1: USER ACCOUNT */}
                                <div className="form-section">
                                    <h3>👤 Account Settings</h3>
                                    
                                    <div className="form-group-row">
                                        <div className="form-group">
                                            <label>Username</label>
                                            <input type="text" value={user.username} disabled className="disabled-input" />
                                        </div>
                                        <div className="form-group">
                                            <label>Account Role</label>
                                            <input type="text" value={user.role.toUpperCase()} disabled className="disabled-input" />
                                        </div>
                                    </div>

                                    {user.role === 'company' && (
                                        <div className="form-group">
                                            <label>Company Name</label>
                                            <input 
                                                type="text" 
                                                value={companyName} 
                                                onChange={(e) => setCompanyName(e.target.value)} 
                                                placeholder="Enter your organization name"
                                            />
                                        </div>
                                    )}

                                    <div className="form-group">
                                        <label>Email Address</label>
                                        <input 
                                            type="email" 
                                            value={email} 
                                            onChange={(e) => setEmail(e.target.value)} 
                                            placeholder="name@example.com"
                                        />
                                    </div>

                                    <div className="form-group">
                                        <label>Global Currency Preference</label>
                                        <select
                                            value={currency}
                                            onChange={(e) => setCurrency(e.target.value)}
                                            className="settings-input"
                                            style={{
                                                width: '100%',
                                                padding: '0.55rem 0.75rem',
                                                borderRadius: '0.375rem',
                                                background: '#0f172a',
                                                border: '1px solid #334155',
                                                color: 'white',
                                                fontSize: '0.875rem',
                                                outline: 'none',
                                                transition: 'border-color 0.2s'
                                            }}
                                        >
                                            <option value="NGN">Nigerian Naira (₦ - NGN)</option>
                                            <option value="USD">US Dollar ($ - USD)</option>
                                            <option value="EUR">Euro (€ - EUR)</option>
                                            <option value="GBP">British Pound (£ - GBP)</option>
                                            <option value="KES">Kenyan Shilling (KSh - KES)</option>
                                            <option value="RWF">Rwandan Franc (FRw - RWF)</option>
                                        </select>
                                        <small className="help-text" style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem', display: 'block' }}>
                                            This currency choice will reflect across all fleet billing, pricing options, and generated PDF/CSV reports.
                                        </small>
                                    </div>
                                </div>

                                {/* SECTION 2: TELEMETRY & BACKUP PHONES */}
                                <div className="form-section">
                                    <h3>📱 SMS Backup & Telemetry</h3>
                                    <p className="section-subtitle">Configure emergency command protocols and safety parameters.</p>
                                    
                                    <div className="form-group">
                                        <label>Authorized Backup SMS Phone Number</label>
                                        <input 
                                            type="tel" 
                                            value={phone} 
                                            onChange={(e) => setPhone(e.target.value)} 
                                            placeholder="+250 788 123 456"
                                        />
                                        <small className="help-text">Any SMS emergency cutoff request sent from this number will be authenticated by the SafeBox node.</small>
                                    </div>
                                </div>

                                {/* SECTION 3: NOTIFICATION ALERTS */}
                                <div className="form-section">
                                    <h3>🔔 Notification Triggers</h3>
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
                                    </div>
                                </div>

                                {/* SECTION 5: SECURITY CHANGE PASSWORD */}
                                <div className="form-section">
                                    <h3>🔑 Change Password</h3>
                                    <div className="form-group current-password-group" style={{ marginBottom: '1.25rem' }}>
                                        <label>Current Password</label>
                                        <input 
                                            type="password" 
                                            value={oldPassword} 
                                            onChange={(e) => setOldPassword(e.target.value)} 
                                            placeholder="Enter current password to authorize password change"
                                        />
                                    </div>
                                    <div className="form-group-row">
                                        <div className="form-group">
                                            <label>New Password</label>
                                            <input 
                                                type="password" 
                                                value={password} 
                                                onChange={(e) => setPassword(e.target.value)} 
                                                placeholder="Enter new password"
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label>Confirm Password</label>
                                            <input 
                                                type="password" 
                                                value={confirmPassword} 
                                                onChange={(e) => setConfirmPassword(e.target.value)} 
                                                placeholder="Confirm new password"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <footer className="settings-footer">
                                    <button type="button" className="cancel-btn" onClick={onBack}>Cancel</button>
                                    <button type="submit" className="save-btn" disabled={loading}>
                                        {loading ? 'Saving...' : 'Save Settings'}
                                    </button>
                                </footer>
                            </form>
                        )}

                        {activeTab === 'thresholds' && (
                            <div className="settings-form">
                                {user.role === 'company' && (
                                    <form onSubmit={handleSave} style={{ marginBottom: '2rem' }}>
                                        <div className="form-section admin-section">
                                            <h3>🛡️ Admin Safety Thresholds</h3>
                                            <p className="section-subtitle font-admin">Configure dynamic G-Force and speed triggers for safety scoring.</p>

                                    <div className="slider-group">
                                        <div className="slider-item">
                                            <div className="slider-header">
                                                <span className="slider-title">Speed Limit Threshold</span>
                                                <span className="slider-value">{speedLimit} km/h</span>
                                            </div>
                                            <input 
                                                type="range" 
                                                min="60" 
                                                max="140" 
                                                value={speedLimit} 
                                                onChange={(e) => setSpeedLimit(Number(e.target.value))} 
                                                className="styled-range"
                                            />
                                        </div>

                                        <div className="slider-item">
                                            <div className="slider-header">
                                                <span className="slider-title">Harsh Braking Sensitivity</span>
                                                <span className="slider-value">{brakingThreshold} g</span>
                                            </div>
                                            <input 
                                                type="range" 
                                                min="0.20" 
                                                max="0.50" 
                                                step="0.01" 
                                                value={brakingThreshold} 
                                                onChange={(e) => setBrakingThreshold(Number(e.target.value))} 
                                                className="styled-range"
                                            />
                                        </div>

                                        <div className="slider-item">
                                            <div className="slider-header">
                                                <span className="slider-title">Harsh Cornering Sensitivity</span>
                                                <span className="slider-value">{corneringThreshold} g</span>
                                            </div>
                                            <input 
                                                type="range" 
                                                min="0.25" 
                                                max="0.50" 
                                                step="0.01" 
                                                value={corneringThreshold} 
                                                onChange={(e) => setCorneringThreshold(Number(e.target.value))} 
                                                className="styled-range"
                                            />
                                        </div>
                                    </div>
                                </div>
                                <footer className="settings-footer" style={{ padding: '1rem 0', background: 'transparent', borderTop: '1px solid rgba(255,255,255,0.05)', marginBottom: '2rem' }}>
                                            <button type="submit" className="save-btn" disabled={loading}>
                                                {loading ? 'Saving...' : 'Save Safety Thresholds'}
                                            </button>
                                        </footer>
                                    </form>
                                )}

                                <div className="form-section admin-section curfew-section" style={{ marginTop: user.role === 'company' ? '2rem' : '0' }}>
                                    <h3>🕒 Vehicle Access Policy (Operating Hours)</h3>
                                    <p className="section-subtitle font-admin">Configure fleet operating hours. New engine starts outside allowed times or on unselected days will be blocked, and drivers can request real-time overrides from managers.</p>

                                    {curfewMsg.text && (
                                        <div className={`status-alert ${curfewMsg.type}`} style={{ marginBottom: '1.25rem' }}>
                                            {curfewMsg.text}
                                        </div>
                                    )}

                                    <div className="toggle-group" style={{ marginBottom: '1.5rem' }}>
                                        <div className="toggle-item">
                                            <div className="toggle-info">
                                                <span className="toggle-title">Enable Operating Hours Restriction</span>
                                                <span className="toggle-desc">Immobilize selected vehicles outside allowed times/days.</span>
                                            </div>
                                            <label className="switch">
                                                <input 
                                                    type="checkbox" 
                                                    checked={curfewEnabled} 
                                                    onChange={(e) => setCurfewEnabled(e.target.checked)} 
                                                />
                                                <span className="slider round"></span>
                                            </label>
                                        </div>
                                    </div>

                                    <div className="form-group-row" style={{ marginBottom: '1.5rem' }}>
                                        <div className="form-group">
                                            <label>Allowed Operations Start Time</label>
                                            <input 
                                                type="time" 
                                                value={curfewStart}
                                                onChange={(e) => setCurfewStart(e.target.value)}
                                                className="styled-time-input"
                                                disabled={!curfewEnabled}
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label>Allowed Operations End Time</label>
                                            <input 
                                                type="time" 
                                                value={curfewEnd}
                                                onChange={(e) => setCurfewEnd(e.target.value)}
                                                className="styled-time-input"
                                                disabled={!curfewEnabled}
                                            />
                                        </div>
                                    </div>

                                    <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                                        <label style={{ marginBottom: '0.5rem', display: 'block' }}>Active Policy Days</label>
                                        <div className="days-selector-row" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => {
                                                const isActive = curfewDays.includes(day);
                                                return (
                                                    <button
                                                        type="button"
                                                        key={day}
                                                        className={`day-pill-btn ${isActive ? 'active' : ''}`}
                                                        onClick={() => {
                                                            if (isActive) {
                                                                setCurfewDays(curfewDays.filter(d => d !== day));
                                                            } else {
                                                                setCurfewDays([...curfewDays, day]);
                                                            }
                                                        }}
                                                        disabled={!curfewEnabled}
                                                        style={{
                                                            padding: '0.4rem 1rem',
                                                            border: isActive ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.1)',
                                                            borderRadius: '2rem',
                                                            background: isActive ? 'rgba(59,130,246,0.2)' : 'transparent',
                                                            color: isActive ? '#60a5fa' : '#94a3b8',
                                                            cursor: curfewEnabled ? 'pointer' : 'default',
                                                            fontWeight: 'bold',
                                                            transition: 'all 0.2s ease',
                                                            opacity: curfewEnabled ? 1 : 0.5
                                                        }}
                                                    >
                                                        {day}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className="toggle-group" style={{ marginBottom: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                        <div className="toggle-item" style={{ border: '1px solid rgba(255,255,255,0.05)', padding: '0.75rem', borderRadius: '0.5rem' }}>
                                            <div className="toggle-info">
                                                <span className="toggle-title" style={{ fontSize: '0.9rem' }}>Allow Manager Overrides</span>
                                                <span className="toggle-desc" style={{ fontSize: '0.75rem' }}>Drivers can request start codes.</span>
                                            </div>
                                            <label className="switch">
                                                <input 
                                                    type="checkbox" 
                                                    checked={curfewAllowOverride} 
                                                    onChange={(e) => setCurfewAllowOverride(e.target.checked)} 
                                                    disabled={!curfewEnabled}
                                                />
                                                <span className="slider round"></span>
                                            </label>
                                        </div>
                                        <div className="toggle-item" style={{ border: '1px solid rgba(255,255,255,0.05)', padding: '0.75rem', borderRadius: '0.5rem' }}>
                                            <div className="toggle-info">
                                                <span className="toggle-title" style={{ fontSize: '0.9rem' }}>Holiday Restrict Mode</span>
                                                <span className="toggle-desc" style={{ fontSize: '0.75rem' }}>Block starting on holidays.</span>
                                            </div>
                                            <label className="switch">
                                                <input 
                                                    type="checkbox" 
                                                    checked={curfewHolidayMode} 
                                                    onChange={(e) => setCurfewHolidayMode(e.target.checked)} 
                                                    disabled={!curfewEnabled}
                                                />
                                                <span className="slider round"></span>
                                            </label>
                                        </div>
                                    </div>

                                    <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                                        <label style={{ marginBottom: '0.5rem', display: 'block' }}>Apply Access Policy To</label>
                                        <div style={{ display: 'flex', gap: '2rem', marginTop: '0.25rem' }}>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: curfewEnabled ? 'pointer' : 'default', opacity: curfewEnabled ? 1 : 0.5 }}>
                                                <input 
                                                    type="radio" 
                                                    name="applyTo" 
                                                    value="all" 
                                                    checked={applyTo === 'all'} 
                                                    onChange={() => curfewEnabled && setApplyTo('all')}
                                                    disabled={!curfewEnabled}
                                                />
                                                <span>All Vehicles</span>
                                            </label>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: curfewEnabled ? 'pointer' : 'default', opacity: curfewEnabled ? 1 : 0.5 }}>
                                                <input 
                                                    type="radio" 
                                                    name="applyTo" 
                                                    value="selected" 
                                                    checked={applyTo === 'selected'} 
                                                    onChange={() => curfewEnabled && setApplyTo('selected')}
                                                    disabled={!curfewEnabled}
                                                />
                                                <span>Selected Vehicles</span>
                                            </label>
                                        </div>
                                    </div>

                                    {applyTo === 'selected' && (
                                        <div className="curfew-vehicles-checklist" style={{ animation: 'fadeIn 0.3s ease' }}>
                                            <div className="billing-header-row" style={{ padding: '0 0.5rem 0.5rem 0.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)', marginBottom: '0.75rem' }}>
                                                <button 
                                                    type="button" 
                                                    className="select-all-btn"
                                                    onClick={handleSelectAllCurfew}
                                                    disabled={!curfewEnabled}
                                                >
                                                    {selectedCurfewVehicleIds.size === billingVehicles.length ? 'Deselect All' : 'Select All'}
                                                </button>
                                                <span className="selected-count-label">
                                                    Selected: <strong>{selectedCurfewVehicleIds.size}</strong> / {billingVehicles.length} vehicles
                                                </span>
                                            </div>

                                            {billingVehicles.length === 0 ? (
                                                <p className="no-vehicles-text" style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8' }}>
                                                    No vehicles registered. Register vehicles to manage access policies.
                                                </p>
                                            ) : (
                                                <div className="curfew-vehicles-grid">
                                                    {billingVehicles.map(v => {
                                                        const isChecked = selectedCurfewVehicleIds.has(v.id);
                                                        return (
                                                            <div 
                                                                key={v.id} 
                                                                className={`curfew-vehicle-card ${isChecked ? 'selected' : ''} ${!curfewEnabled ? 'disabled' : ''}`}
                                                                onClick={() => curfewEnabled && handleCurfewVehicleToggle(v.id)}
                                                            >
                                                                <div className="card-left">
                                                                    <input 
                                                                        type="checkbox" 
                                                                        checked={isChecked}
                                                                        disabled={!curfewEnabled}
                                                                        onChange={() => {}} 
                                                                    />
                                                                    <div className="card-meta">
                                                                        <span className="v-name">{v.name}</span>
                                                                        <span className="v-id">{v.id} {v.plate_number ? `• ${v.plate_number}` : ''}</span>
                                                                    </div>
                                                                </div>
                                                                <div className="card-right">
                                                                    {v.curfew_enabled ? (
                                                                        <span className="curfew-badge active">
                                                                            🕒 Active
                                                                        </span>
                                                                    ) : (
                                                                        <span className="curfew-badge inactive">
                                                                            🔓 Off
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <div className="curfew-action-row" style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
                                        <button 
                                            type="button" 
                                            className="apply-curfew-btn"
                                            onClick={handleApplyCurfew}
                                            disabled={curfewLoading}
                                        >
                                            {curfewLoading ? 'Applying...' : 'Apply Access Policy'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'billing' && (
                            <div className="settings-form">
                                <div className="form-section billing-section">
                                    <h3>💳 Fleet Billing Manager</h3>
                                    <p className="section-subtitle">Manage automated payments and selective vehicle tracking suspensions.</p>

                                    <div className="billing-cycle-selector">
                                        <button 
                                            type="button" 
                                            className={`cycle-pill ${billingCycle === 'monthly' ? 'active' : ''}`}
                                            onClick={() => setBillingCycle('monthly')}
                                        >
                                            Monthly Plan
                                        </button>
                                        <button 
                                            type="button" 
                                            className={`cycle-pill ${billingCycle === 'annual' ? 'active' : ''}`}
                                            onClick={() => setBillingCycle('annual')}
                                        >
                                            Annual Plan (Save 16%) 🎁
                                        </button>
                                    </div>

                                    {billingMsg.text && (
                                        <div className={`status-alert ${billingMsg.type}`} style={{ margin: '0.5rem 0' }}>
                                            {billingMsg.text}
                                        </div>
                                    )}

                                    {billingVehicles.length === 0 ? (
                                        <p className="billing-no-vehicles">No vehicles registered yet. Register a vehicle to configure payments.</p>
                                    ) : (
                                        <>
                                            <div className="billing-header-row">
                                                <button 
                                                    type="button" 
                                                    className="select-all-btn"
                                                    onClick={handleSelectAllBilling}
                                                >
                                                    {selectedBillingIds.size === billingVehicles.length ? 'Deselect All' : 'Select All'}
                                                </button>
                                                <span className="selected-count-label">
                                                    Selected: <strong>{selectedBillingIds.size}</strong> / {billingVehicles.length} vehicles
                                                </span>
                                            </div>

                                            <div className="billing-grid">
                                                {billingVehicles.map(v => {
                                                    const isChecked = selectedBillingIds.has(v.id);
                                                    
                                                    let billingLabel = '';
                                                    if (v.subscription_status === 'ACTIVE') {
                                                        if (v.next_billing_date) {
                                                            const days = Math.ceil((v.next_billing_date - Date.now()) / (1000 * 60 * 60 * 24));
                                                            billingLabel = days > 0 ? `${days} days left` : 'Expiring today';
                                                        } else {
                                                            billingLabel = 'Trial Active 🎁';
                                                        }
                                                    } else if (v.subscription_status === 'GRACE_PERIOD' && v.grace_period_expires) {
                                                        const days = Math.ceil((v.grace_period_expires - Date.now()) / (1000 * 60 * 60 * 24));
                                                        billingLabel = `Grace Period: ${days}d left`;
                                                    } else {
                                                        billingLabel = 'Suspended 🚫';
                                                    }

                                                    return (
                                                        <div 
                                                            key={v.id} 
                                                            className={`billing-card-item ${isChecked ? 'selected' : ''}`}
                                                            onClick={() => handleVehicleToggle(v.id)}
                                                        >
                                                            <div className="billing-card-left">
                                                                <input 
                                                                    type="checkbox" 
                                                                    checked={isChecked}
                                                                    onChange={() => {}} 
                                                                />
                                                                <div className="billing-card-meta">
                                                                    <span className="b-name">{v.name}</span>
                                                                    {v.plate_number && <span className="b-plate">{v.plate_number}</span>}
                                                                </div>
                                                            </div>
                                                            <div className="billing-card-right">
                                                                <span className={`billing-badge ${v.subscription_status.toLowerCase()}`}>
                                                                    {v.subscription_status}
                                                                </span>
                                                                <span className="billing-days">{billingLabel}</span>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            <div className="billing-checkout-summary">
                                                <div className="summary-details">
                                                    <span>Plan Rate:</span>
                                                    <strong>{formatCurrencyValue(pricePerVehicle, currency)}/vehicle{billingCycle === 'annual' ? '/year' : '/month'}</strong>
                                                </div>
                                                <div className="summary-details total">
                                                    <span>Total Renewal Amount:</span>
                                                    <strong>{formatCurrencyValue(selectedBillingIds.size * pricePerVehicle, currency)}{billingCycle === 'annual' ? '/year' : '/month'}</strong>
                                                </div>
                                                <button 
                                                    type="button" 
                                                    className="checkout-pay-btn"
                                                    disabled={billingLoading || selectedBillingIds.size === 0}
                                                    onClick={handleBulkCheckout}
                                                >
                                                    {billingLoading ? 'Connecting to Paystack...' : `🔒 SECURE PAY ${formatCurrencyValue(selectedBillingIds.size * pricePerVehicle, currency)}`}
                                                </button>
                                            </div>
                                        </>
                                    )}

                                    {paymentHistory.length > 0 && (
                                        <div className="billing-history-section">
                                            <h4>🧾 Bulk Payment History</h4>
                                            <div className="history-table-wrapper">
                                                <table className="history-table">
                                                    <thead>
                                                        <tr>
                                                            <th>Reference</th>
                                                            <th>Amount Paid</th>
                                                            <th>Date</th>
                                                            <th>Status</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {paymentHistory.map(h => (
                                                            <tr key={h.id}>
                                                                <td className="h-ref">{h.reference}</td>
                                                                <td>{formatCurrencyValue(h.amount, currency)}</td>
                                                                <td>{new Date(h.timestamp).toLocaleDateString()}</td>
                                                                <td>
                                                                    <span className="history-status success">{h.status}</span>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeTab === 'maintenance' && (
                            <div className="settings-form">
                                <div className="form-section">
                                    <h3>🔧 Maintenance Alerts Manager</h3>
                                    <p className="section-subtitle">Set up mileage thresholds, target due dates, and reminders for your fleet.</p>

                                    {/* Success/Error Alerts */}
                                    {maintenanceSuccess && <div className="status-alert success">{maintenanceSuccess}</div>}
                                    {maintenanceError && <div className="status-alert error">{maintenanceError}</div>}

                                    {billingVehicles.length === 0 ? (
                                        <p className="help-text" style={{ textAlign: 'center', padding: '2rem 0' }}>
                                            No vehicles registered. Register a vehicle first to manage maintenance reminders.
                                        </p>
                                    ) : (
                                        <>
                                            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                                                <label>Select Vehicle</label>
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
                                        </>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeTab === 'support' && (
                            <div className="settings-form">
                                <div className="form-section">
                                    <h3>💬 Diagnostic Support Mode</h3>
                                    <p className="section-subtitle">Generate a temporary verification code to grant support agents access to fleet stats, logs, and battery diagnostics.</p>

                                    <div className="support-code-container">
                                        {supportCode ? (
                                            <div className="support-code-display glass-panel animate-fade-in">
                                                <span className="code-label">SUPPORT CODE</span>
                                                <div className="code-value-wrapper">
                                                    <span className="code-value">{supportCode}</span>
                                                    <button 
                                                        type="button" 
                                                        className="copy-code-btn"
                                                        onClick={() => {
                                                            navigator.clipboard.writeText(supportCode);
                                                            alert("Support code copied to clipboard!");
                                                        }}
                                                    >
                                                        📋 Copy
                                                    </button>
                                                </div>
                                                <div className="code-timer">
                                                    <span>Expires in:</span>
                                                    <strong className="timer-countdown">{timeLeft}</strong>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="support-code-generate-placeholder">
                                                <p>No active support code. Click the button below to generate a new 24h diagnostic code.</p>
                                                <button 
                                                    type="button" 
                                                    className="generate-code-btn"
                                                    disabled={supportLoading}
                                                    onClick={handleGenerateSupportCode}
                                                >
                                                    {supportLoading ? 'Generating...' : '🔑 Generate Support Code'}
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    <div className="support-instructions">
                                        <h4>🛡️ Security & Privacy Information</h4>
                                        <ul>
                                            <li>The support code is only valid for **24 hours** from generation.</li>
                                            <li>Support agents can view telemetry, battery history, and geofence locations to troubleshoot problems.</li>
                                            <li>Your account password and billing credentials **are never shared** or exposed.</li>
                                            <li>You can invalidate the code at any time by waiting for it to expire or generating a new one.</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'fuel' && (
                            <div className="settings-form fuel-settings-tab animate-fade-in">
                                <div className="form-section">
                                    <h3>⛽ Fuel & Cost Settings</h3>
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
                                                        <h4 style={{ margin: 0, fontSize: '1rem', color: '#f8fafc' }}>🚗 {item.name}</h4>
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
                                                        
                                                        <button 
                                                            type="button" 
                                                            className="edit-trigger-btn"
                                                            onClick={() => {
                                                                setEditingFuelVehicleId(item.id);
                                                                setFuelType(item.fuel_type || 'Premium Petrol');
                                                                setFuelPrice(item.fuel_price || 1000.0);
                                                                setFuelEfficiency(item.fuel_efficiency || 12.0);
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
                        )}

                        {activeTab === 'ble' && (
                            <div className="settings-form animate-fade-in">
                                <div className="form-section">
                                    <h3>🔑 BLE Keyless Entry (Passive Proximity) Configuration</h3>
                                    <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '1.5rem', lineHeight: '1.4' }}>
                                        Link a driver's wireless BLE Keyfob (beacon) to the vehicle tracker. 
                                        The tracker will automatically unlock the starter circuit when the keyfob is detected nearby (within your set RSSI threshold) and lock it when they walk away. 
                                        Cloud overrides (remote locks and curfew hours) take precedence over the proximity unlock.
                                    </p>

                                    {bleSuccess && <div className="status-alert success">{bleSuccess}</div>}
                                    {bleError && <div className="status-alert error">{bleError}</div>}

                                    <form onSubmit={handleSaveBleSettings}>
                                        <div className="form-group-row">
                                            <div className="form-group">
                                                <label>Select Vehicle to Configure</label>
                                                <select 
                                                    value={bleVehicleId} 
                                                    onChange={(e) => setBleVehicleId(e.target.value)}
                                                    style={{ background: '#1e293b', color: 'white', border: '1px solid #475569', padding: '0.6rem', borderRadius: '0.375rem', width: '100%', outline: 'none' }}
                                                >
                                                    {billingVehicles.map(v => (
                                                        <option key={v.id} value={v.id}>
                                                            {v.name || v.id} ({v.plate_number || 'No Plate'})
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div className="form-group">
                                                <label>BLE Beacon ID / MAC Address</label>
                                                <input 
                                                    type="text" 
                                                    value={bleBeaconId} 
                                                    onChange={(e) => setBleBeaconId(e.target.value)} 
                                                    placeholder="e.g. AA:BB:CC:DD:EE:FF" 
                                                    style={{ background: '#1e293b', color: 'white', border: '1px solid #475569', padding: '0.6rem', borderRadius: '0.375rem', width: '100%', outline: 'none' }}
                                                />
                                            </div>
                                        </div>

                                        <div className="form-group" style={{ marginTop: '1.5rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                                <label>RSSI Proximity Threshold Sensitivity</label>
                                                <span style={{ color: '#3b82f6', fontWeight: 'bold' }}>{bleBeaconRssiThreshold} dBm</span>
                                            </div>
                                            <input 
                                                type="range" 
                                                min="-100" 
                                                max="-50" 
                                                step="1"
                                                value={bleBeaconRssiThreshold} 
                                                onChange={(e) => setBleBeaconRssiThreshold(parseInt(e.target.value))} 
                                                style={{ width: '100%', cursor: 'pointer' }}
                                            />
                                            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                                                <span>-100 dBm (Far Range - approx. 10m)</span>
                                                <span>-80 dBm (Default - approx. 3m)</span>
                                                <span>-50 dBm (Close Proximity - approx. 0.5m)</span>
                                            </div>
                                        </div>

                                        <button 
                                            type="submit" 
                                            disabled={bleLoading}
                                            className="submit-btn"
                                            style={{ marginTop: '2rem', padding: '0.75rem 1.5rem', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '0.375rem', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                                        >
                                            {bleLoading ? 'Saving...' : '💾 Save BLE Configurations'}
                                        </button>
                                    </form>
                                </div>
                            </div>
                        )}

                        {activeTab === 'vehicles' && (
                            <div className="settings-form animate-fade-in">
                                <div className="form-section">
                                    <h3>🚗 Manage Registered Fleet Vehicles</h3>
                                    <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '1.5rem', lineHeight: '1.4' }}>
                                        Update details for your registered vehicle trackers, including changing vehicle names, assigning/updating driver names, changing license plates, or switching the vehicle type icon.
                                    </p>

                                    {vehicleSuccess && <div className="status-alert success">{vehicleSuccess}</div>}
                                    {vehicleError && <div className="status-alert error">{vehicleError}</div>}

                                    <div className="table-responsive" style={{ marginTop: '1rem', overflowX: 'auto' }}>
                                        <table className="settings-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                                            <thead>
                                                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', textAlign: 'left' }}>
                                                    <th style={{ padding: '0.75rem 0.5rem', color: '#94a3b8' }}>Tracker ID/IMEI</th>
                                                    <th style={{ padding: '0.75rem 0.5rem', color: '#94a3b8' }}>Vehicle Name</th>
                                                    <th style={{ padding: '0.75rem 0.5rem', color: '#94a3b8' }}>License Plate</th>
                                                    <th style={{ padding: '0.75rem 0.5rem', color: '#94a3b8' }}>Driver Name</th>
                                                    <th style={{ padding: '0.75rem 0.5rem', color: '#94a3b8' }}>Vehicle Type</th>
                                                    <th style={{ padding: '0.75rem 0.5rem', color: '#94a3b8', textAlign: 'center' }}>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {billingVehicles.length === 0 ? (
                                                    <tr>
                                                        <td colSpan="6" style={{ textAlign: 'center', color: '#64748b', padding: '2rem' }}>
                                                            No registered vehicles found.
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    billingVehicles.map(v => (
                                                        <tr key={v.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                                                            <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'monospace', fontWeight: 'bold' }}>{v.id}</td>
                                                            {editingVehicleId === v.id ? (
                                                                <>
                                                                    <td style={{ padding: '0.75rem 0.5rem' }}>
                                                                        <input 
                                                                            type="text" 
                                                                            value={editName} 
                                                                            onChange={(e) => setEditName(e.target.value)}
                                                                            style={{ background: '#1e293b', color: 'white', border: '1px solid #475569', padding: '0.4rem', borderRadius: '0.25rem', width: '100%', outline: 'none', boxSizing: 'border-box' }}
                                                                        />
                                                                    </td>
                                                                    <td style={{ padding: '0.75rem 0.5rem' }}>
                                                                        <input 
                                                                            type="text" 
                                                                            value={editPlateNumber} 
                                                                            onChange={(e) => setEditPlateNumber(e.target.value)}
                                                                            style={{ background: '#1e293b', color: 'white', border: '1px solid #475569', padding: '0.4rem', borderRadius: '0.25rem', width: '100%', outline: 'none', boxSizing: 'border-box' }}
                                                                        />
                                                                    </td>
                                                                    <td style={{ padding: '0.75rem 0.5rem' }}>
                                                                        <input 
                                                                            type="text" 
                                                                            value={editDriverName} 
                                                                            onChange={(e) => setEditDriverName(e.target.value)}
                                                                            style={{ background: '#1e293b', color: 'white', border: '1px solid #475569', padding: '0.4rem', borderRadius: '0.25rem', width: '100%', outline: 'none', boxSizing: 'border-box' }}
                                                                        />
                                                                    </td>
                                                                    <td style={{ padding: '0.75rem 0.5rem' }}>
                                                                        <select 
                                                                            value={editVehicleType} 
                                                                            onChange={(e) => setEditVehicleType(e.target.value)}
                                                                            style={{ background: '#1e293b', color: 'white', border: '1px solid #475569', padding: '0.4rem', borderRadius: '0.25rem', width: '100%', outline: 'none', boxSizing: 'border-box' }}
                                                                        >
                                                                            <option value="car">🚗 Car</option>
                                                                            <option value="motorcycle">🏍️ Motorcycle</option>
                                                                            <option value="tricycle">🛺 Tricycle</option>
                                                                            <option value="bus">🚌 Bus</option>
                                                                            <option value="truck">🚚 Truck</option>
                                                                            <option value="van">🚐 Van</option>
                                                                        </select>
                                                                    </td>
                                                                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>
                                                                        <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'center' }}>
                                                                            <button 
                                                                                onClick={() => handleSaveVehicleEdit(v.id)}
                                                                                disabled={vehicleLoading}
                                                                                style={{ padding: '0.4rem 0.75rem', background: '#10b981', color: 'white', border: 'none', borderRadius: '0.25rem', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem' }}
                                                                            >
                                                                                {vehicleLoading ? 'Saving...' : '💾 Save'}
                                                                            </button>
                                                                            <button 
                                                                                onClick={() => setEditingVehicleId(null)}
                                                                                style={{ padding: '0.4rem 0.75rem', background: '#64748b', color: 'white', border: 'none', borderRadius: '0.25rem', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem' }}
                                                                            >
                                                                                Cancel
                                                                            </button>
                                                                        </div>
                                                                    </td>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <td style={{ padding: '0.75rem 0.5rem', fontWeight: 'bold' }}>{v.name || v.id}</td>
                                                                    <td style={{ padding: '0.75rem 0.5rem' }}>{v.plate_number || <span style={{ color: '#64748b' }}>--</span>}</td>
                                                                    <td style={{ padding: '0.75rem 0.5rem' }}>{v.driver_name || <span style={{ color: '#64748b' }}>--</span>}</td>
                                                                    <td style={{ padding: '0.75rem 0.5rem', textTransform: 'capitalize' }}>
                                                                        {getVehicleEmoji(v.vehicle_type)} {v.vehicle_type || 'car'}
                                                                    </td>
                                                                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>
                                                                        <button 
                                                                            onClick={() => handleStartEditVehicle(v)}
                                                                            style={{ padding: '0.4rem 0.85rem', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '0.25rem', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem' }}
                                                                        >
                                                                            ✏️ Edit
                                                                        </button>
                                                                    </td>
                                                                </>
                                                            )}
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {showOTPModal && (
                <div className="otp-modal-overlay">
                    <div className="otp-modal-container glass-panel animate-fade-in">
                        <header className="otp-modal-header">
                            <h4>🔑 Password Change OTP Verification</h4>
                            <button 
                                type="button" 
                                className="otp-modal-close" 
                                onClick={() => {
                                    setShowOTPModal(false);
                                    setOtpCode('');
                                    setOtpError('');
                                    setSettingsFallbackCode('');
                                    setLoading(false);
                                }}
                            >
                                ✕
                            </button>
                        </header>
                        
                        <div className="otp-modal-body">
                            <p className="otp-modal-desc">
                                We have sent a 6-digit verification code to your email <strong>{user.email}</strong>. Enter the code below to authorize your password change.
                            </p>
                            
                            {settingsFallbackCode && (
                                <div style={{
                                    background: 'rgba(59, 130, 246, 0.1)',
                                    border: '1px solid rgba(59, 130, 246, 0.3)',
                                    color: '#60a5fa',
                                    padding: '1rem',
                                    borderRadius: '8px',
                                    marginBottom: '1.5rem',
                                    textAlign: 'center',
                                    lineHeight: '1.5',
                                    fontSize: '0.9rem'
                                }}>
                                    📬 <strong>Email Delivery Fallback</strong><br />
                                    We couldn't deliver the verification email. Your code is:<br />
                                    <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#3b82f6', letterSpacing: '2px', display: 'block', margin: '0.5rem 0' }}>
                                        {settingsFallbackCode}
                                    </span>
                                    Enter this code in the field below.
                                </div>
                            )}

                            {otpError && (
                                <div className="status-alert error modal-alert">
                                    {otpError}
                                </div>
                            )}

                            <div className="form-group otp-input-group">
                                <label>6-Digit Verification Code</label>
                                <input 
                                    type="text" 
                                    maxLength="6"
                                    value={otpCode}
                                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                                    placeholder="000000"
                                    className="otp-code-input"
                                    autoFocus
                                />
                            </div>
                        </div>

                        <footer className="otp-modal-footer">
                            <button 
                                type="button" 
                                className="otp-cancel-btn" 
                                onClick={() => {
                                    setShowOTPModal(false);
                                    setOtpCode('');
                                    setOtpError('');
                                    setSettingsFallbackCode('');
                                    setLoading(false);
                                }}
                            >
                                Cancel
                            </button>
                            <button 
                                type="button" 
                                className="otp-confirm-btn"
                                disabled={otpLoading || otpCode.length !== 6}
                                onClick={handleConfirmPasswordChange}
                            >
                                {otpLoading ? 'Verifying...' : 'Confirm Password Change'}
                            </button>
                        </footer>
                    </div>
                </div>
            )}
        </div>
    );
}
