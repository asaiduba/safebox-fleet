import React from 'react';

const GravityBackground = () => {
    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            zIndex: -1,
            background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #020617 100%)',
            overflow: 'hidden'
        }}>
            {/* Ambient Glowing Orbs (CSS animated, GPU accelerated) */}
            <div style={{
                position: 'absolute',
                top: '20%',
                left: '20%',
                width: '480px',
                height: '480px',
                background: 'radial-gradient(circle, rgba(59, 130, 246, 0.28) 0%, rgba(0,0,0,0) 70%)',
                borderRadius: '50%',
                filter: 'blur(80px)',
                animation: 'floatOrb 15s ease-in-out infinite alternate'
            }} />
            <div style={{
                position: 'absolute',
                bottom: '15%',
                right: '15%',
                width: '580px',
                height: '580px',
                background: 'radial-gradient(circle, rgba(99, 102, 241, 0.28) 0%, rgba(0,0,0,0) 70%)',
                borderRadius: '50%',
                filter: 'blur(90px)',
                animation: 'floatOrb2 20s ease-in-out infinite alternate'
            }} />
            <div style={{
                position: 'absolute',
                top: '50%',
                left: '70%',
                width: '380px',
                height: '380px',
                background: 'radial-gradient(circle, rgba(236, 72, 153, 0.16) 0%, rgba(0,0,0,0) 70%)',
                borderRadius: '50%',
                filter: 'blur(60px)',
                animation: 'floatOrb 25s ease-in-out infinite alternate'
            }} />

            {/* Subtle animated stars */}
            <div className="stars-container" style={{
                position: 'absolute',
                width: '100%',
                height: '100%',
                opacity: 0.4
            }}>
                {Array.from({ length: 30 }).map((_, i) => {
                    const size = Math.random() * 2 + 1.5;
                    const top = Math.random() * 100;
                    const left = Math.random() * 100;
                    const duration = Math.random() * 8 + 4;
                    const delay = Math.random() * 5;
                    return (
                        <div
                            key={i}
                            style={{
                                position: 'absolute',
                                width: `${size}px`,
                                height: `${size}px`,
                                background: '#60a5fa',
                                borderRadius: '50%',
                                top: `${top}%`,
                                left: `${left}%`,
                                filter: 'drop-shadow(0 0 4px #60a5fa)',
                                animation: `blinkStar ${duration}s ease-in-out infinite alternate`,
                                animationDelay: `${delay}s`
                            }}
                        />
                    );
                })}
            </div>

            {/* Embed CSS animations inside style tags */}
            <style>{`
                @keyframes floatOrb {
                    0% { transform: translate(0, 0) scale(1); }
                    100% { transform: translate(60px, -40px) scale(1.1); }
                }
                @keyframes floatOrb2 {
                    0% { transform: translate(0, 0) scale(1); }
                    100% { transform: translate(-80px, 50px) scale(1.15); }
                }
                @keyframes blinkStar {
                    0% { opacity: 0.2; transform: scale(0.8); }
                    50% { opacity: 0.8; transform: scale(1.2); }
                    100% { opacity: 0.3; transform: scale(0.9); }
                }
            `}</style>
        </div>
    );
};

export default GravityBackground;
