import React, { useEffect, useRef } from 'react';
import Matter from 'matter-js';

const GravityBackground = () => {
    const sceneRef = useRef(null);
    const engineRef = useRef(null);

    useEffect(() => {
        // Module aliases
        const Engine = Matter.Engine,
            Render = Matter.Render,
            Runner = Matter.Runner,
            Bodies = Matter.Bodies,
            Composite = Matter.Composite,
            Mouse = Matter.Mouse,
            MouseConstraint = Matter.MouseConstraint,
            Events = Matter.Events;

        // Create engine
        const engine = Engine.create();
        engine.world.gravity.y = 0; // Zero gravity for floating effect
        engineRef.current = engine;

        // Create renderer
        const render = Render.create({
            element: sceneRef.current,
            engine: engine,
            options: {
                width: window.innerWidth,
                height: window.innerHeight,
                wireframes: false,
                background: 'transparent',
                pixelRatio: window.devicePixelRatio
            }
        });

        // Create bodies (balls)
        const balls = [];
        const color = '#60a5fa'; // Light Blue

        for (let i = 0; i < 400; i++) { // 400 balls
            const radius = 3;
            const x = Math.random() * window.innerWidth;
            const y = Math.random() * window.innerHeight;

            const ball = Bodies.circle(x, y, radius, {
                restitution: 0.9,
                friction: 0,
                frictionAir: 0.05, // High friction for quick slowdown (recovery)
                render: {
                    fillStyle: color,
                    opacity: 0.8
                }
            });

            // Give them a random initial push (Slow motion)
            Matter.Body.setVelocity(ball, {
                x: (Math.random() - 0.5) * 0.5,
                y: (Math.random() - 0.5) * 0.5
            });

            balls.push(ball);
        }

        // Add walls to keep balls inside
        const wallOptions = {
            isStatic: true,
            render: { visible: false },
            restitution: 0.9
        };
        const walls = [
            Bodies.rectangle(window.innerWidth / 2, -50, window.innerWidth, 100, wallOptions), // Top
            Bodies.rectangle(window.innerWidth / 2, window.innerHeight + 50, window.innerWidth, 100, wallOptions), // Bottom
            Bodies.rectangle(window.innerWidth + 50, window.innerHeight / 2, 100, window.innerHeight, wallOptions), // Right
            Bodies.rectangle(-50, window.innerHeight / 2, 100, window.innerHeight, wallOptions) // Left
        ];

        Composite.add(engine.world, [...balls, ...walls]);

        // Add mouse control
        const mouse = Mouse.create(render.canvas);
        const mouseConstraint = MouseConstraint.create(engine, {
            mouse: mouse,
            constraint: {
                stiffness: 0.2,
                render: {
                    visible: false
                }
            }
        });

        Composite.add(engine.world, mouseConstraint);

        // Keep the mouse in sync with rendering
        render.mouse = mouse;

        // Add "Anti-Gravity" hover effect
        Events.on(engine, 'beforeUpdate', function () {
            const mousePosition = mouse.position;

            balls.forEach(ball => {
                // Keep them moving gently (Slow motion state)
                if (ball.speed < 0.2) {
                    Matter.Body.applyForce(ball, ball.position, {
                        x: (Math.random() - 0.5) * 0.00001,
                        y: (Math.random() - 0.5) * 0.00001
                    });
                }

                // Repel from mouse (Fast repulsion)
                const dx = ball.position.x - mousePosition.x;
                const dy = ball.position.y - mousePosition.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < 120) {
                    const forceMagnitude = 0.0002 * (120 - distance); // Stronger force
                    Matter.Body.applyForce(ball, ball.position, {
                        x: (dx / distance) * forceMagnitude,
                        y: (dy / distance) * forceMagnitude
                    });
                }
            });
        });

        // Run the engine
        Render.run(render);
        const runner = Runner.create();
        Runner.run(runner, engine);

        // Handle resize
        const handleResize = () => {
            render.canvas.width = window.innerWidth;
            render.canvas.height = window.innerHeight;
        };

        window.addEventListener('resize', handleResize);

        return () => {
            Render.stop(render);
            Runner.stop(runner);
            window.removeEventListener('resize', handleResize);
            if (render.canvas) render.canvas.remove();
        };
    }, []);

    return (
        <div
            ref={sceneRef}
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                zIndex: -1,
                background: '#0f172a' // Dark background
            }}
        />
    );
};

export default GravityBackground;
