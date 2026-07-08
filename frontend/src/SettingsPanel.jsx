import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import './SettingsPanel.css';

// Import Modular Subcomponents
import ProfileSettings from './settings/ProfileSettings';
import NotificationSettings from './settings/NotificationSettings';
import SafetySettings from './settings/SafetySettings';
import CurfewSettings from './settings/CurfewSettings';
import FuelSettings from './settings/FuelSettings';
import BleSettings from './settings/BleSettings';
import MaintenanceSettings from './settings/MaintenanceSettings';
import VehiclesSettings from './settings/VehiclesSettings';
import SupportSettings from './settings/SupportSettings';
import BillingSettings from './settings/BillingSettings';

export default function SettingsPanel({ user, vehicles = [], groups = [], onGroupsChanged = () => {}, onBack, onProfileUpdate }) {
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

    // Notification preferences sync hooks (P2)
    const [notifyEmail, setNotifyEmail] = useState(true);
    const [notifySms, setNotifySms] = useState(true);
    const [notifyPush, setNotifyPush] = useState(true);
    const [alertEmail, setAlertEmail] = useState('');
    const [alertPhone, setAlertPhone] = useState('');
    const [defaultEmail, setDefaultEmail] = useState('');
    const [defaultPhone, setDefaultPhone] = useState('');
    const [pushSubscriptionActive, setPushSubscriptionActive] = useState(false);
    const [pushLoading, setPushLoading] = useState(false);
    const isPushSupported = ('serviceWorker' in navigator) && ('PushManager' in window);

    // Safety Thresholds (Admin only)
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
            await axios.put(`${API_BASE}/api/vehicles/${vehicleId}`, {
                name: editName.trim(),
                plateNumber: editPlateNumber.trim().toUpperCase(),
                driverName: editDriverName.trim(),
                vehicleType: editVehicleType
            });

            setVehicleSuccess('Vehicle details updated successfully!');
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
            await axios.post(`${API_BASE}/api/vehicles/ble-settings`, {
                vehicleId: bleVehicleId,
                bleBeaconId: bleBeaconId.trim(),
                bleBeaconRssiThreshold: parseInt(bleBeaconRssiThreshold)
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
            const res = await axios.get(`${API_BASE}/api/vehicles/fuel-settings`);
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
            await axios.post(`${API_BASE}/api/vehicles/fuel-settings`, {
                vehicleId: vId,
                fuelType,
                fuelPrice: parseFloat(fuelPrice),
                fuelEfficiency: parseFloat(fuelEfficiency)
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
            await axios.post(`${API_BASE}/api/vehicles/fuel-settings`, {
                vehicleIds: selectedFuelVehicles,
                fuelType: bulkFuelType,
                fuelPrice: parseFloat(bulkFuelPrice),
                fuelEfficiency: parseFloat(bulkFuelEfficiency)
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
            fetchBillingStatus();
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

    // Fetch notifications config on mount
    const fetchNotificationPreferences = useCallback(async () => {
        try {
            const res = await axios.get(`${API_BASE}/api/notifications/preferences`);
            setNotifyEmail(res.data.notifyEmail);
            setNotifySms(res.data.notifySms);
            setNotifyPush(res.data.notifyPush);
            setAlertEmail(res.data.alertEmail || '');
            setAlertPhone(res.data.alertPhone || '');
            setDefaultEmail(res.data.defaultEmail || '');
            setDefaultPhone(res.data.defaultPhone || '');
        } catch (err) {
            console.error('Failed to load notification preferences:', err);
        }
    }, [API_BASE]);

    useEffect(() => {
        fetchNotificationPreferences();
    }, [fetchNotificationPreferences]);

    // Check if currently subscribed to push
    const checkPushSubscription = useCallback(async () => {
        if (!isPushSupported) return;
        try {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            setPushSubscriptionActive(!!sub);
        } catch (err) {
            console.error('Failed to check browser push subscription status:', err);
        }
    }, [isPushSupported]);

    useEffect(() => {
        checkPushSubscription();
    }, [checkPushSubscription]);

    // Utility function: Convert Base64 URL to Uint8Array for VAPID key
    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding)
            .replace(/\-/g, '+')
            .replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    const handleEnrollPush = async () => {
        if (!isPushSupported) return;
        setPushLoading(true);
        setStatusMsg({ type: '', text: '' });
        
        try {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                setStatusMsg({ type: 'error', text: 'Browser notification permission denied.' });
                setPushLoading(false);
                return;
            }

            console.log('Registering push service worker...');
            const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
            console.log('Service Worker registered successfully!', reg);

            const keyRes = await axios.get(`${API_BASE}/api/notifications/vapid-public-key`);
            const applicationServerKey = urlBase64ToUint8Array(keyRes.data.publicKey);

            const subscription = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey
            });

            await axios.post(`${API_BASE}/api/notifications/subscribe`, { subscription });
            
            setPushSubscriptionActive(true);
            setStatusMsg({ type: 'success', text: '🔔 Registered for push notifications! Attempting to fire test notification...' });
            
            await axios.post(`${API_BASE}/api/notifications/test-push`);
        } catch (err) {
            console.error('Push registration failure:', err);
            setStatusMsg({ type: 'error', text: 'Push notifications registration failed: ' + (err.response?.data?.error || err.message) });
        } finally {
            setPushLoading(false);
        }
    };

    const handleTestPush = async () => {
        try {
            await axios.post(`${API_BASE}/api/notifications/test-push`);
        } catch (err) {
            console.error('Test push notification trigger failed:', err);
        }
    };

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
            await axios.post(`${API_BASE}/api/profile/update`, {
                userId: user.id,
                email,
                phone,
                companyName: user.role === 'company' ? companyName : undefined,
                currency
            });

            // Update Notification Preferences on Backend
            await axios.post(`${API_BASE}/api/notifications/preferences`, {
                notifyEmail,
                notifySms,
                notifyPush,
                alertEmail,
                alertPhone
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

            // Update Notification Preferences on Backend
            await axios.post(`${API_BASE}/api/notifications/preferences`, {
                notifyEmail,
                notifySms,
                notifyPush,
                alertEmail,
                alertPhone
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

    const estimateDistance = (rssi) => {
        if (!rssi) return null;
        const txPower = -59; // Measured RSSI at 1 meter for Teltonika EYE Beacon
        const n = 2.5; // Path loss exponent
        const distance = Math.pow(10, (txPower - rssi) / (10 * n));
        return parseFloat(distance.toFixed(1));
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
                            className={`sidebar-tab ${activeTab === 'notifications' ? 'active' : ''}`}
                            onClick={() => setActiveTab('notifications')}
                        >
                            🔔 Notifications Preferences
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
                            Based Fuel & Cost
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
                        {activeTab === 'general' && (
                            <ProfileSettings
                                user={user}
                                email={email}
                                setEmail={setEmail}
                                phone={phone}
                                setPhone={setPhone}
                                companyName={companyName}
                                setCompanyName={setCompanyName}
                                currency={currency}
                                setCurrency={setCurrency}
                                password={password}
                                setPassword={setPassword}
                                confirmPassword={confirmPassword}
                                setConfirmPassword={setConfirmPassword}
                                oldPassword={oldPassword}
                                setOldPassword={setOldPassword}
                                showOTPModal={showOTPModal}
                                setShowOTPModal={setShowOTPModal}
                                otpCode={otpCode}
                                setOtpCode={setOtpCode}
                                otpLoading={otpLoading}
                                setOtpLoading={setOtpLoading}
                                otpError={otpError}
                                setOtpError={setOtpError}
                                settingsFallbackCode={settingsFallbackCode}
                                setSettingsFallbackCode={setSettingsFallbackCode}
                                handleSave={handleSave}
                                handleConfirmPasswordChange={handleConfirmPasswordChange}
                                loading={loading}
                                statusMsg={statusMsg}
                            />
                        )}

                        {activeTab === 'notifications' && (
                            <NotificationSettings
                                batteryAlert={batteryAlert}
                                setBatteryAlert={setBatteryAlert}
                                fuelAlert={fuelAlert}
                                setFuelAlert={setFuelAlert}
                                geofenceAlert={geofenceAlert}
                                setGeofenceAlert={setGeofenceAlert}
                                notifyEmail={notifyEmail}
                                setNotifyEmail={setNotifyEmail}
                                notifySms={notifySms}
                                setNotifySms={setNotifySms}
                                notifyPush={notifyPush}
                                setNotifyPush={setNotifyPush}
                                alertEmail={alertEmail}
                                setAlertEmail={setAlertEmail}
                                alertPhone={alertPhone}
                                setAlertPhone={setAlertPhone}
                                defaultEmail={defaultEmail}
                                defaultPhone={defaultPhone}
                                pushSubscriptionActive={pushSubscriptionActive}
                                pushLoading={pushLoading}
                                isPushSupported={isPushSupported}
                                handleEnrollPush={handleEnrollPush}
                                handleTestPush={handleTestPush}
                                handleSave={handleSave}
                                loading={loading}
                                statusMsg={statusMsg}
                                user={user}
                            />
                        )}

                        {activeTab === 'thresholds' && (
                            <>
                                <SafetySettings
                                    speedLimit={speedLimit}
                                    setSpeedLimit={setSpeedLimit}
                                    brakingThreshold={brakingThreshold}
                                    setBrakingThreshold={setBrakingThreshold}
                                    corneringThreshold={corneringThreshold}
                                    setCorneringThreshold={setCorneringThreshold}
                                    handleSave={handleSave}
                                    loading={loading}
                                    user={user}
                                />
                                <CurfewSettings
                                    curfewEnabled={curfewEnabled}
                                    setCurfewEnabled={setCurfewEnabled}
                                    curfewStart={curfewStart}
                                    setCurfewStart={setCurfewStart}
                                    curfewEnd={curfewEnd}
                                    setCurfewEnd={setCurfewEnd}
                                    curfewDays={curfewDays}
                                    setCurfewDays={setCurfewDays}
                                    curfewAllowOverride={curfewAllowOverride}
                                    setCurfewAllowOverride={setCurfewAllowOverride}
                                    curfewHolidayMode={curfewHolidayMode}
                                    setCurfewHolidayMode={setCurfewHolidayMode}
                                    applyTo={applyTo}
                                    setApplyTo={setApplyTo}
                                    selectedCurfewVehicleIds={selectedCurfewVehicleIds}
                                    handleCurfewVehicleToggle={handleCurfewVehicleToggle}
                                    handleSelectAllCurfew={handleSelectAllCurfew}
                                    handleApplyCurfew={handleApplyCurfew}
                                    curfewLoading={curfewLoading}
                                    curfewMsg={curfewMsg}
                                    billingVehicles={billingVehicles}
                                />
                            </>
                        )}

                        {activeTab === 'billing' && (
                            <BillingSettings
                                billingCycle={billingCycle}
                                setBillingCycle={setBillingCycle}
                                billingMsg={billingMsg}
                                billingVehicles={billingVehicles}
                                selectedBillingIds={selectedBillingIds}
                                handleSelectAllBilling={handleSelectAllBilling}
                                handleVehicleToggle={handleVehicleToggle}
                                pricePerVehicle={pricePerVehicle}
                                currency={currency}
                                billingLoading={billingLoading}
                                handleBulkCheckout={handleBulkCheckout}
                                paymentHistory={paymentHistory}
                            />
                        )}

                        {activeTab === 'maintenance' && (
                            <MaintenanceSettings
                                selectedVehicleId={selectedVehicleId}
                                setSelectedVehicleId={setSelectedVehicleId}
                                setEditingReminderId={setEditingReminderId}
                                billingVehicles={billingVehicles}
                                handleSaveMaintenanceReminder={handleSaveMaintenanceReminder}
                                editingReminderId={editingReminderId}
                                reminderType={reminderType}
                                setReminderType={setReminderType}
                                customName={customName}
                                setCustomName={setCustomName}
                                thresholdKm={thresholdKm}
                                setThresholdKm={setThresholdKm}
                                lastServiceKm={lastServiceKm}
                                setLastServiceKm={setLastServiceKm}
                                dueDate={dueDate}
                                setDueDate={setDueDate}
                                notes={notes}
                                setNotes={setNotes}
                                maintenanceLoading={maintenanceLoading}
                                maintenanceReminders={maintenanceReminders}
                                handleToggleReminderStatus={handleToggleReminderStatus}
                                handleStartEditReminder={handleStartEditReminder}
                                handleDeleteMaintenanceReminder={handleDeleteMaintenanceReminder}
                                maintenanceSuccess={maintenanceSuccess}
                                maintenanceError={maintenanceError}
                            />
                        )}

                        {activeTab === 'support' && (
                            <SupportSettings
                                supportCode={supportCode}
                                timeLeft={timeLeft}
                                supportLoading={supportLoading}
                                handleGenerateSupportCode={handleGenerateSupportCode}
                            />
                        )}

                        {activeTab === 'fuel' && (
                            <FuelSettings
                                fuelError={fuelError}
                                fuelSuccess={fuelSuccess}
                                fuelLoading={fuelLoading}
                                fuelSettingsList={fuelSettingsList}
                                selectedFuelVehicles={selectedFuelVehicles}
                                setSelectedFuelVehicles={setSelectedFuelVehicles}
                                bulkFuelType={bulkFuelType}
                                setBulkFuelType={setBulkFuelType}
                                bulkFuelEfficiency={bulkFuelEfficiency}
                                setBulkFuelEfficiency={setBulkFuelEfficiency}
                                bulkFuelPrice={bulkFuelPrice}
                                setBulkFuelPrice={setBulkFuelPrice}
                                handleSaveBulkFuelSettings={handleSaveBulkFuelSettings}
                                editingFuelVehicleId={editingFuelVehicleId}
                                setEditingFuelVehicleId={setEditingFuelVehicleId}
                                fuelType={fuelType}
                                setFuelType={setFuelType}
                                fuelEfficiency={fuelEfficiency}
                                setFuelEfficiency={setFuelEfficiency}
                                fuelPrice={fuelPrice}
                                setFuelPrice={setFuelPrice}
                                handleSaveFuelSetting={handleSaveFuelSetting}
                                currency={currency}
                            />
                        )}

                        {activeTab === 'ble' && (
                            <BleSettings
                                bleSuccess={bleSuccess}
                                bleError={bleError}
                                handleSaveBleSettings={handleSaveBleSettings}
                                bleVehicleId={bleVehicleId}
                                setBleVehicleId={setBleVehicleId}
                                bleBeaconId={bleBeaconId}
                                setBleBeaconId={setBleBeaconId}
                                bleBeaconRssiThreshold={bleBeaconRssiThreshold}
                                setBleBeaconRssiThreshold={setBleBeaconRssiThreshold}
                                bleLoading={bleLoading}
                                vehicles={vehicles}
                                billingVehicles={billingVehicles}
                                estimateDistance={estimateDistance}
                            />
                        )}

                        {activeTab === 'vehicles' && (
                            <VehiclesSettings
                                editingVehicleId={editingVehicleId}
                                setEditingVehicleId={setEditingVehicleId}
                                billingVehicles={billingVehicles}
                                handleStartEditVehicle={handleStartEditVehicle}
                                editName={editName}
                                setEditName={setEditName}
                                editPlateNumber={editPlateNumber}
                                setEditPlateNumber={setEditPlateNumber}
                                editDriverName={editDriverName}
                                setEditDriverName={setEditDriverName}
                                editVehicleType={editVehicleType}
                                setEditVehicleType={setEditVehicleType}
                                vehicleSuccess={vehicleSuccess}
                                vehicleError={vehicleError}
                                vehicleLoading={vehicleLoading}
                                handleSaveVehicleEdit={handleSaveVehicleEdit}
                                groups={groups}
                                onGroupsChanged={onGroupsChanged}
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
