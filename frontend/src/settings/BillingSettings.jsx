import React from 'react';

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

export default function BillingSettings({
    billingCycle,
    setBillingCycle,
    billingMsg,
    billingVehicles = [],
    selectedBillingIds = new Set(),
    handleSelectAllBilling,
    handleVehicleToggle,
    pricePerVehicle,
    currency,
    billingLoading,
    handleBulkCheckout,
    paymentHistory = []
}) {
    return (
        <div className="settings-form">
            <div className="form-section">
                <h3>💳 Fleet Billing Manager</h3>
                <p className="section-subtitle">Renew telemetry subscriptions, manage licenses, and review payment history.</p>

                <div className="billing-cycle-selector" style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', marginTop: '1rem' }}>
                    <button 
                        type="button" 
                        className={`cycle-pill ${billingCycle === 'monthly' ? 'active' : ''}`}
                        onClick={() => setBillingCycle('monthly')}
                    >
                        Monthly Plan (₦3,000 / vehicle)
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
    );
}
