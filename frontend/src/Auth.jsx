const API_BASE = import.meta.env.VITE_API_URL || '';
import React, { useState } from 'react';
import axios from 'axios';
import './Auth.css';
import GravityBackground from './GravityBackground';

const Auth = ({ onLogin, onBack }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        username: '',
        password: '',
        confirmPassword: '',
        role: 'individual',
        companyName: '',
        email: '',
        phone: ''
    });
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    
    // Email Verification State
    const [verifyingEmail, setVerifyingEmail] = useState('');
    const [verificationCode, setVerificationCode] = useState('');
    const [resendCooldown, setResendCooldown] = useState(0);
    const [fallbackCode, setFallbackCode] = useState('');

    // Forgot Password State
    const [isForgotPassword, setIsForgotPassword] = useState(false);
    const [resetEmailSent, setResetEmailSent] = useState('');
    const [resetFormData, setResetFormData] = useState({
        code: '',
        newPassword: '',
        confirmNewPassword: ''
    });

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleResetChange = (e) => {
        setResetFormData({ ...resetFormData, [e.target.name]: e.target.value });
    };

    const handleForgotPasswordRequest = async (e) => {
        e.preventDefault();
        setError('');
        setSuccessMessage('');
        setFallbackCode('');
        setLoading(true);

        try {
            const res = await axios.post(`${API_BASE}/api/forgot-password`, { email: formData.email });
            setResetEmailSent(formData.email);
            setSuccessMessage('Verification code sent to your email.');
            if (res.data && res.data.devVerificationCode) {
                setFallbackCode(res.data.devVerificationCode);
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to request reset code.');
        } finally {
            setLoading(false);
        }
    };

    const handleResetPasswordSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccessMessage('');

        if (resetFormData.newPassword !== resetFormData.confirmNewPassword) {
            setError('Passwords do not match.');
            return;
        }

        setLoading(true);
        try {
            const res = await axios.post(`${API_BASE}/api/reset-password`, {
                email: resetEmailSent,
                code: resetFormData.code,
                newPassword: resetFormData.newPassword
            });
            setSuccessMessage(res.data.message || 'Password reset successfully! Redirecting...');
            setTimeout(() => {
                setIsForgotPassword(false);
                setResetEmailSent('');
                setIsLogin(true);
                setFormData({ ...formData, password: '', email: '' });
                setResetFormData({ code: '', newPassword: '', confirmNewPassword: '' });
                setSuccessMessage('');
                setFallbackCode('');
            }, 3000);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to reset password.');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!isLogin && formData.password !== formData.confirmPassword) {
            setError('Passwords do not match.');
            return;
        }

        setLoading(true);

        if (verifyingEmail) {
            // Handle code verification submission
            try {
                const res = await axios.post(`${API_BASE}/api/verify-email`, {
                    email: verifyingEmail,
                    code: verificationCode
                });
                onLogin(res.data);
            } catch (err) {
                setError(err.response?.data?.error || 'Verification failed. Please check the code and try again.');
            } finally {
                setLoading(false);
            }
            return;
        }

        const endpoint = isLogin ? '/api/login' : '/api/register';
        try {
            const res = await axios.post(`${API_BASE}${endpoint}`, formData);
            if (res.data.needsVerification) {
                setVerifyingEmail(res.data.email);
                if (res.data.devVerificationCode) {
                    setFallbackCode(res.data.devVerificationCode);
                }
            } else {
                onLogin(res.data);
            }
        } catch (err) {
            if (err.response?.data?.needsVerification) {
                setVerifyingEmail(err.response.data.email);
                setError(err.response.data.error || 'Please enter the verification code sent to your email.');
                if (err.response.data.devVerificationCode) {
                    setFallbackCode(err.response.data.devVerificationCode);
                }
            } else {
                setError(err.response?.data?.error || 'An error occurred. Please try again.');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleResendCode = async () => {
        if (resendCooldown > 0) return;
        setError('');
        setFallbackCode('');
        try {
            const res = await axios.post(`${API_BASE}/api/resend-verification`, { email: verifyingEmail });
            setResendCooldown(60); // 60 seconds cooldown
            if (res.data && res.data.devVerificationCode) {
                setFallbackCode(res.data.devVerificationCode);
            }
            const timer = setInterval(() => {
                setResendCooldown(prev => {
                    if (prev <= 1) {
                        clearInterval(timer);
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to resend verification code.');
        }
    };

    return (
        <div className="auth-container">
            <GravityBackground />
            <div
                className="auth-logo"
                onClick={onBack}
                style={{
                    position: 'absolute',
                    top: '20px',
                    left: '20px',
                    zIndex: 100,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px',
                    background: 'rgba(0, 0, 0, 0)',
                    borderRadius: '8px',
                    backdropFilter: 'blur(4px)'
                }}
                title="Back to Home"
            >
                <img src="/logo.png" alt="SafeBox Logo" style={{ height: '40px' }} />
                <span style={{ color: 'white', fontWeight: 'bold', fontSize: '1rem' }}>Safe Box Fleet</span>
            </div>
            
            {verifyingEmail ? (
                <div className="auth-card">
                    <h2>Verify Your Email</h2>
                    <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginBottom: '1.5rem', textAlign: 'center', lineHeight: '1.5' }}>
                        We've sent a 6-digit verification code to <strong>{verifyingEmail}</strong>.<br />
                        Please enter it below to activate your account.
                    </p>

                    {fallbackCode && (
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
                                {fallbackCode}
                            </span>
                            Enter this code in the field below.
                        </div>
                    )}

                    {error && <div className="error-msg" style={{ marginBottom: '1rem' }}>{error}</div>}

                    <form onSubmit={handleSubmit}>
                        <div className="form-group" style={{ textAlign: 'center' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', textAlign: 'center' }}>Verification Code</label>
                            <input
                                type="text"
                                value={verificationCode}
                                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                placeholder="000000"
                                maxLength="6"
                                style={{
                                    letterSpacing: '0.4em',
                                    textAlign: 'center',
                                    fontSize: '1.5rem',
                                    fontWeight: 'bold',
                                    padding: '12px',
                                    width: '80%',
                                    margin: 'auto',
                                    background: 'rgba(255, 255, 255, 0.05)',
                                    border: '1px solid rgba(255, 255, 255, 0.2)',
                                    borderRadius: '6px',
                                    color: '#3b82f6',
                                    outline: 'none'
                                }}
                                required
                            />
                        </div>

                        <button 
                            type="submit" 
                            className="auth-btn" 
                            style={{ marginTop: '1.5rem' }} 
                            disabled={loading || verificationCode.length !== 6}
                        >
                            {loading ? 'Verifying...' : 'Verify & Log In'}
                        </button>
                    </form>

                    <p className="toggle-text" style={{ marginTop: '1.5rem' }}>
                        Didn't receive the code?{' '}
                        {resendCooldown > 0 ? (
                            <span style={{ color: '#64748b', cursor: 'default' }}>Resend in {resendCooldown}s</span>
                        ) : (
                            <span onClick={handleResendCode} style={{ textDecoration: 'underline', color: '#3b82f6', cursor: 'pointer' }}>
                                Resend Code
                            </span>
                        )}
                    </p>
                    <p className="toggle-text">
                        <span 
                            onClick={() => { setVerifyingEmail(''); setError(''); setVerificationCode(''); }} 
                            style={{ textDecoration: 'underline', color: '#94a3b8', cursor: 'pointer' }}
                        >
                            Back to Register / Log In
                        </span>
                    </p>
                </div>
            ) : isForgotPassword && !resetEmailSent ? (
                <div className="auth-card">
                    <h2>Reset Password</h2>
                    <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginBottom: '1.5rem', textAlign: 'center', lineHeight: '1.5' }}>
                        Enter your registered email address. We will send you a 6-digit OTP code to reset your password.
                    </p>

                    {error && <div className="error-msg">{error}</div>}
                    {successMessage && <div className="success-msg" style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '1.5rem', textAlign: 'center', border: '1px solid rgba(34, 197, 94, 0.2)' }}>{successMessage}</div>}

                    <form onSubmit={handleForgotPasswordRequest}>
                        <div className="form-group">
                            <label>Email Address</label>
                            <input
                                type="email"
                                name="email"
                                value={formData.email}
                                onChange={handleChange}
                                placeholder="name@company.com"
                                required
                            />
                        </div>

                        <button type="submit" className="auth-btn" disabled={loading}>
                            {loading ? 'Sending Code...' : 'Send Reset Code'}
                        </button>
                    </form>

                    <p className="toggle-text">
                        <span onClick={() => { setIsForgotPassword(false); setError(''); setSuccessMessage(''); }} style={{ textDecoration: 'underline', color: '#3b82f6', cursor: 'pointer' }}>
                            Back to Login
                        </span>
                    </p>
                </div>
            ) : isForgotPassword && resetEmailSent ? (
                <div className="auth-card">
                    <h2>Enter Reset Code</h2>
                    <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginBottom: '1.5rem', textAlign: 'center', lineHeight: '1.5' }}>
                        We sent a 6-digit verification code to <strong>{resetEmailSent}</strong>. Enter the code and your new password.
                    </p>

                    {fallbackCode && (
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
                                {fallbackCode}
                            </span>
                            Enter this code in the field below.
                        </div>
                    )}

                    {error && <div className="error-msg">{error}</div>}
                    {successMessage && <div className="success-msg" style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '1.5rem', textAlign: 'center', border: '1px solid rgba(34, 197, 94, 0.2)' }}>{successMessage}</div>}

                    <form onSubmit={handleResetPasswordSubmit}>
                        <div className="form-group">
                            <label>Verification Code</label>
                            <input
                                type="text"
                                name="code"
                                value={resetFormData.code}
                                onChange={handleResetChange}
                                placeholder="000000"
                                maxLength="6"
                                required
                            />
                        </div>

                        <div className="form-group password-group">
                            <label>New Password</label>
                            <div className="password-input-wrapper">
                                <input
                                    type={showPassword ? "text" : "password"}
                                    name="newPassword"
                                    value={resetFormData.newPassword}
                                    onChange={handleResetChange}
                                    required
                                />
                                <span
                                    className="toggle-password"
                                    onClick={() => setShowPassword(!showPassword)}
                                >
                                    {showPassword ? '👁' : '👁‍🗨'}
                                </span>
                            </div>
                        </div>

                        <div className="form-group">
                            <label>Confirm New Password</label>
                            <input
                                type={showPassword ? "text" : "password"}
                                name="confirmNewPassword"
                                value={resetFormData.confirmNewPassword}
                                onChange={handleResetChange}
                                required
                            />
                        </div>

                        <button type="submit" className="auth-btn" disabled={loading}>
                            {loading ? 'Resetting Password...' : 'Reset Password'}
                        </button>
                    </form>

                    <p className="toggle-text">
                        Didn't receive the code?{' '}
                        <span onClick={handleForgotPasswordRequest} style={{ textDecoration: 'underline', color: '#3b82f6', cursor: 'pointer' }}>
                            Resend Code
                        </span>
                    </p>
                    <p className="toggle-text">
                        <span onClick={() => { setIsForgotPassword(false); setResetEmailSent(''); setError(''); setSuccessMessage(''); }} style={{ textDecoration: 'underline', color: '#3b82f6', cursor: 'pointer' }}>
                            Back to Login
                        </span>
                    </p>
                </div>
            ) : (
                <div className="auth-card">
                    <h2>{isLogin ? 'Welcome Back' : 'Create Account'}</h2>
                    {error && <div className="error-msg">{error}</div>}
                    {successMessage && <div className="success-msg" style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '1.5rem', textAlign: 'center', border: '1px solid rgba(34, 197, 94, 0.2)' }}>{successMessage}</div>}

                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label>Username</label>
                            <input
                                type="text"
                                name="username"
                                value={formData.username}
                                onChange={handleChange}
                                required
                            />
                        </div>

                        <div className="form-group password-group">
                            <label>Password</label>
                            <div className="password-input-wrapper">
                                <input
                                    type={showPassword ? "text" : "password"}
                                    name="password"
                                    value={formData.password}
                                    onChange={handleChange}
                                    required
                                />
                                <span
                                    className="toggle-password"
                                    onClick={() => setShowPassword(!showPassword)}
                                >
                                    {showPassword ? '👁' : '👁‍🗨'}
                                </span>
                            </div>
                            {isLogin && (
                                <div style={{ textAlign: 'right', marginTop: '0.5rem' }}>
                                    <span 
                                        onClick={() => { setIsForgotPassword(true); setError(''); setSuccessMessage(''); setFormData({ ...formData, email: '' }); }}
                                        style={{ color: '#3b82f6', fontSize: '0.85rem', cursor: 'pointer', textDecoration: 'underline' }}
                                    >
                                        Forgot Password?
                                    </span>
                                </div>
                            )}
                        </div>

                        {!isLogin && (
                            <div className="form-group password-group">
                                <label>Confirm Password</label>
                                <div className="password-input-wrapper">
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        name="confirmPassword"
                                        value={formData.confirmPassword}
                                        onChange={handleChange}
                                        required
                                    />
                                </div>
                            </div>
                        )}

                        {!isLogin && (
                            <>
                                <div className="form-group">
                                    <label>Account Type</label>
                                    <select name="role" value={formData.role} onChange={handleChange}>
                                        <option value="individual">Individual Owner</option>
                                        <option value="company">Logistics Company</option>
                                    </select>
                                </div>

                                {formData.role === 'company' && (
                                    <div className="form-group">
                                        <label>Company Name</label>
                                        <input
                                            type="text"
                                            name="companyName"
                                            value={formData.companyName}
                                            onChange={handleChange}
                                            required
                                        />
                                    </div>
                                )}

                                <div className="form-group">
                                    <label>Email Address</label>
                                    <input
                                        type="email"
                                        name="email"
                                        value={formData.email}
                                        onChange={handleChange}
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Phone Number</label>
                                    <input
                                        type="tel"
                                        name="phone"
                                        value={formData.phone}
                                        onChange={handleChange}
                                        placeholder="e.g. +234..."
                                        required
                                    />
                                </div>
                            </>
                        )}

                        <button type="submit" className="auth-btn" disabled={loading}>
                            {loading ? 'Processing...' : (isLogin ? 'Login' : 'Register')}
                        </button>
                    </form>

                    <p className="toggle-text">
                        {isLogin ? "Don't have an account? " : "Already have an account? "}
                        <span onClick={() => { setIsLogin(!isLogin); setError(''); }}>
                            {isLogin ? 'Sign Up' : 'Login'}
                        </span>
                    </p>
                </div>
            )}
        </div>
    );
};

export default Auth;
