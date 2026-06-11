import React, { useState } from 'react';
import './LandingPage.css';

export default function LandingPage({ onGetStarted, user, onBackToDashboard }) {
    const [fleetSize, setFleetSize] = useState(5);
    const [cycle, setCycle] = useState('monthly');

    const handleLogin = () => {
        // Clear the hash from the URL for a clean login state
        window.history.replaceState(null, '', window.location.pathname);
        onGetStarted();
    };

    return (
        <div className="landing-page">
            {/* Header */}
            <header className="landing-header">
                <div className="logo-container">
                    <img src="/logo.png" alt="SafeBox" className="logo" />
                    <span className="brand-name">SafeBox Fleet</span>
                </div>
                <nav className="landing-nav">
                    <a href="#features">Features</a>
                    <a href="#pricing">Pricing</a>
                    <a href="#about">About Us</a>
                    {user ? (
                        <button className="login-btn" onClick={onBackToDashboard}>
                            Logged in as {user.username}
                        </button>
                    ) : (
                        <button className="login-btn" onClick={handleLogin}>Login</button>
                    )}
                </nav>
            </header>

            {/* Hero Section */}
            <section className="hero-section">
                <div className="hero-content">
                    <h1 className="hero-title">
                        Advanced Fleet <br />
                        <span className="gradient-text">Tracking & Security</span>
                    </h1>
                    <p className="hero-subtitle">
                        Monitor your vehicles in real-time with our state-of-the-art IoT solution.
                        Get insights, alerts, and full control at your fingertips.
                    </p>
                    <div className="hero-cta">
                        {user ? (
                            <button className="cta-btn primary" onClick={onBackToDashboard}>Back to Dashboard</button>
                        ) : (
                            <button className="cta-btn primary" onClick={handleLogin}>Get Started Now</button>
                        )}
                        <button className="cta-btn secondary">View Demo</button>
                    </div>
                </div>
                <div className="hero-image-container">
                    <img
                        src="/hero-dashboard.png"
                        alt="Dashboard Preview"
                        className="hero-image"
                    />
                    <div className="glow-effect"></div>
                </div>
            </section>

            {/* Features Section */}
            <section id="features" className="features-section">
                <h2 className="section-title">Industrial IoT Capabilities</h2>
                <p className="section-subtitle-center">Enterprise-grade fleet intelligence to monitor, protect, and optimize your assets.</p>
                <div className="features-grid">
                    <div className="feature-card">
                        <div className="icon">🛰️</div>
                        <h3>Real-Time GPS Telemetry</h3>
                        <p>Dual-satellite positioning tracking with sub-meter accuracy, streamed instantly over secure MQTT brokers.</p>
                    </div>
                    <div className="feature-card">
                        <div className="icon">🔒</div>
                        <h3>Advanced Remote Cutoff</h3>
                        <p>Remotely disable or enable vehicle engines instantly from your dashboard, complete with anti-tampering notifications.</p>
                    </div>
                    <div className="feature-card">
                        <div className="icon">📈</div>
                        <h3>Fleet Analytics & Health</h3>
                        <p>Track battery health, fuel levels, and telemetry logs over time, stored in atomic SQLite database ledgers.</p>
                    </div>
                    <div className="feature-card">
                        <div className="icon">🏆</div>
                        <h3>Driver Behavior Safety</h3>
                        <p>Improve driver safety scoring by monitoring speed violations, harsh braking, and cornering thresholds with leaderboard tracking.</p>
                    </div>
                </div>
            </section>

            {/* Pricing Section */}
            <section id="pricing" className="pricing-section">
                <h2 className="section-title">Transparent & Scalable Plans</h2>
                <p className="section-subtitle-center">No hidden fees. Pick a plan that fits your logistics operation.</p>
                <div className="pricing-grid">
                    <div className="pricing-card">
                        <h3>Monthly Tracker</h3>
                        <div className="price">₦3,000<span>/mo per vehicle</span></div>
                        <ul>
                            <li>1 Vehicle Tracking</li>
                            <li>Real-Time GPS Telemetry</li>
                            <li>Remote Engine Lock/Unlock</li>
                            <li>Instant Webhook Alerts</li>
                            <li>Cancel Anytime</li>
                        </ul>
                        <button className="pricing-btn" onClick={handleLogin}>Get Started</button>
                    </div>
                    <div className="pricing-card popular">
                        <div className="badge">MOST POPULAR</div>
                        <h3>Annual Fleet Bundle</h3>
                        <div className="price">₦30,000<span>/yr per vehicle</span></div>
                        <div className="savings-label">Save 16% annually! 🎁</div>
                        <ul>
                            <li>Unlimited Fleet Scale</li>
                            <li>Real-Time GPS Telemetry</li>
                            <li>Remote Engine Lock/Unlock</li>
                            <li>90-Day History & Analytics</li>
                            <li>Driver Behavior Leaderboard</li>
                            <li>Priority Support Line</li>
                        </ul>
                        <button className="pricing-btn primary" onClick={handleLogin}>Get Started</button>
                    </div>
                    <div className="pricing-card">
                        <h3>Enterprise IoT Suite</h3>
                        <div className="price">Custom</div>
                        <ul>
                            <li>Unlimited Fleet Capacity</li>
                            <li>Direct Developer API Access</li>
                            <li>Automated SQLite Billing Ledger</li>
                            <li>Custom Telemetry Webhooks</li>
                            <li>Dedicated Account Manager</li>
                        </ul>
                        <a href="mailto:safebox.hq@gmail.com" className="pricing-link-btn">Contact Sales</a>
                    </div>
                </div>

                {/* Interactive Fleet Calculator Section */}
                <div className="calculator-container glass-panel animate-fade-in">
                    <h3>🧮 Live Fleet Cost Estimator</h3>
                    <p className="calculator-subtitle">Estimate your monthly or annual subscription investment based on fleet size.</p>
                    
                    <div className="calc-row">
                        <div className="calc-control-group">
                            <div className="slider-label-row">
                                <span>Fleet Size: <strong>{fleetSize}</strong> {fleetSize === 1 ? 'vehicle' : 'vehicles'}</span>
                            </div>
                            <input 
                                type="range" 
                                min="1" 
                                max="100" 
                                value={fleetSize} 
                                onChange={(e) => setFleetSize(Number(e.target.value))} 
                                className="calc-range-slider"
                            />
                        </div>
                        
                        <div className="calc-cycle-group">
                            <span>Billing Cycle:</span>
                            <div className="calc-cycle-selector">
                                <button 
                                    type="button" 
                                    className={`calc-cycle-pill ${cycle === 'monthly' ? 'active' : ''}`}
                                    onClick={() => setCycle('monthly')}
                                >
                                    Monthly
                                </button>
                                <button 
                                    type="button" 
                                    className={`calc-cycle-pill ${cycle === 'annual' ? 'active' : ''}`}
                                    onClick={() => setCycle('annual')}
                                >
                                    Annual
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <div className="calc-results">
                        <div className="calc-result-item">
                            <span className="label">Rate per Vehicle:</span>
                            <span className="value">₦{(cycle === 'annual' ? 30000 : 3000).toLocaleString()}/{cycle === 'annual' ? 'yr' : 'mo'}</span>
                        </div>
                        <div className="calc-result-item total">
                            <span className="label">Estimated Total Cost:</span>
                            <span className="value highlight">₦{(fleetSize * (cycle === 'annual' ? 30000 : 3000)).toLocaleString()}/{cycle === 'annual' ? 'yr' : 'mo'}</span>
                        </div>
                    </div>
                </div>
            </section>

            {/* About Us Section */}
            <section id="about" className="about-section">
                <div className="about-content">
                    <h2 className="section-title">About Us</h2>
                    <p>
                        SafeBox Fleet was founded with a mission to make vehicle security accessible and smart.
                        We combine cutting-edge IoT hardware with intuitive software to give you peace of mind.
                        Whether you are an individual owner or managing a large fleet, our technology scales with you.
                    </p>
                </div>
            </section>

            {/* Footer */}
            <footer className="landing-footer">
                <div className="footer-content">
                    <div className="footer-col">
                        <h4>SafeBox Fleet</h4>
                        <p>Securing your journey, one mile at a time.</p>
                    </div>
                    <div className="footer-col">
                        <h4>Contact Us</h4>
                        <p>Email: <a href="mailto:safebox.hq@gmail.com" style={{ display: 'inline', color: '#60a5fa' }}>safebox.hq@gmail.com</a></p>
                        <p>Phone: <a href="tel:+2347032101663" style={{ display: 'inline', color: '#60a5fa' }}>+234 703 210 1663</a></p>
                        <p>Address: PEZ Carnegie Mellon University Africa, Kigali Innovation City</p>
                    </div>
                    <div className="footer-col">
                        <h4>Links</h4>
                        <a href="#">Privacy Policy</a>
                        <a href="#">Terms of Service</a>
                        <a href="#">Help Center</a>
                    </div>
                </div>
                <div className="footer-bottom">
                    <p>&copy; 2024 SafeBox Fleet. All rights reserved.</p>
                </div>
            </footer>
        </div>
    );
}
