import React from 'react';
import './LandingPage.css';

export default function LandingPage({ onGetStarted, user, onBackToDashboard }) {
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
                <h2 className="section-title">Why Choose SafeBox?</h2>
                <div className="features-grid">
                    <div className="feature-card">
                        <div className="icon">📍</div>
                        <h3>Real-Time Tracking</h3>
                        <p>Live GPS updates with 99.9% uptime and precision accuracy.</p>
                    </div>
                    <div className="feature-card">
                        <div className="icon">🔒</div>
                        <h3>Remote Locking</h3>
                        <p>Instantly lock or unlock your vehicle engine from anywhere.</p>
                    </div>
                    <div className="feature-card">
                        <div className="icon">📊</div>
                        <h3>Smart Analytics</h3>
                        <p>Comprehensive reports on fuel, speed, and driver behavior.</p>
                    </div>
                    <div className="feature-card">
                        <div className="icon">⚡</div>
                        <h3>Instant Alerts</h3>
                        <p>Get notified immediately for theft attempts or geofence breaches.</p>
                    </div>
                </div>
            </section>

            {/* Pricing Section */}
            <section id="pricing" className="pricing-section">
                <h2 className="section-title">Simple Pricing</h2>
                <div className="pricing-grid">
                    <div className="pricing-card">
                        <h3>Starter</h3>
                        <div className="price">$9<span>/mo</span></div>
                        <ul>
                            <li>1 Vehicle</li>
                            <li>Real-time Tracking</li>
                            <li>Basic Alerts</li>
                        </ul>
                        <button className="pricing-btn">Choose Starter</button>
                    </div>
                    <div className="pricing-card popular">
                        <div className="badge">MOST POPULAR</div>
                        <h3>Business</h3>
                        <div className="price">$29<span>/mo</span></div>
                        <ul>
                            <li>Up to 10 Vehicles</li>
                            <li>Remote Locking</li>
                            <li>30-Day History</li>
                            <li>Priority Support</li>
                        </ul>
                        <button className="pricing-btn primary">Choose Business</button>
                    </div>
                    <div className="pricing-card">
                        <h3>Enterprise</h3>
                        <div className="price">Custom</div>
                        <ul>
                            <li>Unlimited Vehicles</li>
                            <li>API Access</li>
                            <li>Custom Reports</li>
                            <li>Dedicated Manager</li>
                        </ul>
                        <button className="pricing-btn">Contact Sales</button>
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
                        <h4>Contact</h4>
                        <p>Email: support@safebox.com</p>
                        <p>Phone: +1 (555) 123-4567</p>
                        <p>Address: 123 Tech Park, Innovation City</p>
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
