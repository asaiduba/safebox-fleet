import React from 'react';

export default function SupportSettings({
    supportCode,
    timeLeft,
    supportLoading,
    handleGenerateSupportCode
}) {
    return (
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
    );
}
