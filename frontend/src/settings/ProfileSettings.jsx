import React from 'react';
import { UserIcon, PhoneIcon, KeyIcon } from './Icons';

export default function ProfileSettings({
    user,
    email,
    setEmail,
    phone,
    setPhone,
    companyName,
    setCompanyName,
    currency,
    setCurrency,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    oldPassword,
    setOldPassword,
    showOTPModal,
    setShowOTPModal,
    otpCode,
    setOtpCode,
    otpLoading,
    setOtpLoading,
    otpError,
    setOtpError,
    settingsFallbackCode,
    setSettingsFallbackCode,
    handleSave,
    handleConfirmPasswordChange,
    loading,
    statusMsg
}) {
    return (
        <form onSubmit={handleSave} className="settings-form-wrapper">
            {statusMsg.text && (
                <div className={`status-alert ${statusMsg.type}`}>
                    {statusMsg.text}
                </div>
            )}

            {/* SECTION 1: PROFILE DETAILS */}
            <div className="form-section">
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <UserIcon size={20} /> Profile Details
                </h3>
                <p className="section-subtitle">Manage your account information and contact configurations.</p>
                
                <div className="form-grid">
                    <div className="form-group">
                        <label>Username</label>
                        <input type="text" value={user.username} disabled className="disabled-input" />
                        <small className="help-text">Username cannot be changed.</small>
                    </div>

                    <div className="form-group">
                        <label>Account Role</label>
                        <input type="text" value={user.role?.toUpperCase()} disabled className="disabled-input" />
                        <small className="help-text">Your permissions are locked to your plan.</small>
                    </div>

                    <div className="form-group">
                        <label>Email Address</label>
                        <input 
                            type="email" 
                            value={email} 
                            onChange={(e) => setEmail(e.target.value)} 
                            required 
                            placeholder="manager@fleetcompany.com"
                        />
                    </div>

                    {user.role === 'company' && (
                        <div className="form-group">
                            <label>Company Name</label>
                            <input 
                                type="text" 
                                value={companyName} 
                                onChange={(e) => setCompanyName(e.target.value)} 
                                required 
                                placeholder="Fleet Logistics Ltd"
                            />
                        </div>
                    )}

                    <div className="form-group">
                        <label>Preferred Currency</label>
                        <select 
                            value={currency} 
                            onChange={(e) => setCurrency(e.target.value)}
                        >
                            <option value="NGN">NGN (₦) - Nigerian Naira</option>
                            <option value="USD">USD ($) - US Dollar</option>
                            <option value="EUR">EUR (€) - Euro</option>
                            <option value="GBP">GBP (£) - British Pound</option>
                            <option value="KES">KES (KSh) - Kenyan Shilling</option>
                            <option value="RWF">RWF (FRw) - Rwandan Franc</option>
                        </select>
                        <small className="help-text" style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem', display: 'block' }}>
                            This currency choice will reflect across all fleet billing, pricing options, and generated PDF/CSV reports.
                        </small>
                    </div>
                </div>
            </div>

            {/* SECTION 2: SMS BACKUP & TELEMETRY */}
            <div className="form-section">
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <PhoneIcon size={20} /> SMS Backup & Telemetry
                </h3>
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

            {/* SECTION 3: SECURITY CHANGE PASSWORD */}
            <div className="form-section">
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <KeyIcon size={20} /> Change Password
                </h3>
                <div className="form-group current-password-group" style={{ marginBottom: '1.25rem' }}>
                    <label>Current Password</label>
                    <input 
                        type="password" 
                        value={oldPassword} 
                        onChange={(e) => setOldPassword(e.target.value)} 
                        placeholder="••••••••"
                        autoComplete="current-password"
                    />
                    <small className="help-text">Required to change password.</small>
                </div>

                <div className="form-grid">
                    <div className="form-group">
                        <label>New Password</label>
                        <input 
                            type="password" 
                            value={password} 
                            onChange={(e) => setPassword(e.target.value)} 
                            placeholder="••••••••"
                            autoComplete="new-password"
                        />
                    </div>

                    <div className="form-group">
                        <label>Confirm New Password</label>
                        <input 
                            type="password" 
                            value={confirmPassword} 
                            onChange={(e) => setConfirmPassword(e.target.value)} 
                            placeholder="••••••••"
                            autoComplete="new-password"
                        />
                    </div>
                </div>
            </div>

            <div className="form-actions-bar">
                <button type="submit" disabled={loading} className="btn-primary">
                    {loading ? 'Saving Settings...' : 'Save Settings'}
                </button>
            </div>

            {showOTPModal && (
                <div className="otp-modal-overlay">
                    <div className="otp-modal-container glass-panel animate-fade-in">
                        <header className="otp-modal-header">
                            <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <KeyIcon size={18} /> Password Change OTP Verification
                            </h4>
                            <button 
                                type="button" 
                                className="otp-modal-close" 
                                onClick={() => {
                                    setShowOTPModal(false);
                                    setOtpCode('');
                                    setOtpError('');
                                    setSettingsFallbackCode('');
                                    setOldPassword('');
                                    setPassword('');
                                    setConfirmPassword('');
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
                                }}
                            >
                                Cancel
                            </button>
                            <button 
                                type="button" 
                                className="btn-primary" 
                                onClick={handleConfirmPasswordChange}
                                disabled={otpLoading}
                            >
                                {otpLoading ? 'Verifying...' : 'Change Password'}
                            </button>
                        </footer>
                    </div>
                </div>
            )}
        </form>
    );
}
