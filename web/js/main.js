// web/js/main.js
// Main entry point for Solmate with proper initialization and debug tools

import { SolmateApp } from './SolmateApp.js';

let app = null;

async function initialize() {
    try {
        console.log('🚀 Initializing Solmate...');
        
        // Create app instance
        app = new SolmateApp();
        
        // Set up global error handling
        window.addEventListener('error', (event) => {
            console.error('Global error:', event.error);
            if (app) {
                app.emit('error', { context: 'global', error: event.error });
            }
        });
        
        window.addEventListener('unhandledrejection', (event) => {
            console.error('Unhandled promise rejection:', event.reason);
            if (app) {
                app.emit('error', { context: 'promise', error: event.reason });
            }
        });
        
        // Initialize the app
        await app.init();
        
        console.log('✅ Solmate initialized successfully');
        
        // Hide loading screen
        const loadingStatus = document.getElementById('loadingStatus');
        if (loadingStatus) {
            setTimeout(() => {
                loadingStatus.style.display = 'none';
            }, 500);
        }
        
        // Expose debug commands
        setupDebugCommands();
        
        // Log available debug commands
        console.log('🎮 Debug commands available:');
        console.log('- debugVRM() - Check VRM status');
        console.log('- testChat() - Test chat system');
        console.log('- testTTS() - Test text-to-speech');
        console.log('- testWave() - Test wave animation');
        console.log('- testNod() - Test nod animation');
        console.log('- testThink() - Test thinking animation'); 
        console.log('- testExcited() - Test excited animation');
        console.log('- testExpression(name, intensity) - Test facial expression');
        console.log('- testMood(mood) - Test mood change');
        console.log('- reloadVRM() - Reload VRM model');
        console.log('- testPrice() - Test price fetch');
        console.log('- testTPS() - Test TPS fetch');
        console.log('- getAppState() - Get app state');
        console.log('💡 Press Ctrl+D for debug overlay');
        
    } catch (error) {
        console.error('Failed to initialize Solmate:', error);
        showInitError(error);
    }
}

function setupDebugCommands() {
    // Expose app instance for debugging
    window.solmateApp = app;
    
    // Expose debug functions globally
    window.debugVRM = () => {
        if (!app) return 'App not initialized';
        const state = app.components.vrmLoader?.state || {};
        const vrm = app.components.vrmLoader?.vrm?.current;
        
        console.log('=== VRM DEBUG INFO ===');
        console.log('Initialized:', state.initialized);
        console.log('Loading:', state.loading);
        console.log('Loaded:', state.loaded);
        console.log('VRM Current:', !!vrm);
        console.log('Is Fallback:', vrm?.isFallback);
        
        if (vrm && !vrm.isFallback) {
            console.log('Features:', {
                humanoid: !!vrm.humanoid,
                expressionManager: !!vrm.expressionManager,
                lookAt: !!vrm.lookAt
            });
        }
        
        return state;
    };
    
    window.testChat = () => {
        if (!app) return 'App not initialized';
        return app.testChat();
    };
    
    window.testTTS = () => {
        if (!app) return 'App not initialized';
        return app.testTTS();
    };
    
    window.testWave = () => {
        if (!app) return 'App not initialized';
        return app.testWave();
    };
    
    window.testNod = () => {
        if (!app || !app.components.vrmLoader) return 'VRM not available';
        // Trigger a subtle nod animation
        const vrm = app.components.vrmLoader.vrm.current;
        if (vrm && vrm.humanoid) {
            const head = vrm.humanoid.getNormalizedBoneNode('head');
            if (head) {
                const originalRotation = head.rotation.clone();
                let progress = 0;
                
                const nodInterval = setInterval(() => {
                    progress += 0.016;
                    if (progress >= 1) {
                        head.rotation.copy(originalRotation);
                        clearInterval(nodInterval);
                        return;
                    }
                    
                    const nodAmount = Math.sin(progress * Math.PI * 2) * 0.2;
                    head.rotation.x = originalRotation.x + nodAmount;
                }, 16);
                
                return 'Nod animation started';
            }
        }
        return 'Head bone not available';
    };
    
    window.testThink = () => {
        if (!app || !app.components.vrmLoader) return 'VRM not available';
        app.components.vrmLoader.setExpression('thinking', 0.6, 3000);
        return 'Thinking expression set';
    };
    
    window.testExcited = () => {
        if (!app || !app.components.vrmLoader) return 'VRM not available';
        app.components.vrmLoader.setExpression('surprised', 0.8, 2000);
        setTimeout(() => {
            app.components.vrmLoader.setExpression('happy', 0.7, 3000);
        }, 500);
        return 'Excited animation started';
    };
    
    window.testExpression = (expression = 'happy', intensity = 0.5) => {
        if (!app) return 'App not initialized';
        return app.testExpression(expression, intensity);
    };
    
    window.testMood = (mood = 'happy') => {
        if (!app || !app.components.vrmLoader) return 'VRM not available';
        
        const moods = {
            happy: { expression: 'happy', intensity: 0.6, message: "I'm feeling great!" },
            sad: { expression: 'sad', intensity: 0.5, message: "Feeling a bit down..." },
            excited: { expression: 'surprised', intensity: 0.8, message: "This is so exciting!" },
            thoughtful: { expression: 'neutral', intensity: 0.3, message: "Let me think about that..." },
            playful: { expression: 'happy', intensity: 0.8, message: "Let's have some fun!" }
        };
        
        const moodData = moods[mood] || moods.happy;
        
        app.components.vrmLoader.setExpression(moodData.expression, moodData.intensity, 4000);
        app.components.audioManager.queue(moodData.message);
        
        return `Mood set to: ${mood}`;
    };
    
    window.reloadVRM = () => {
        if (!app) return 'App not initialized';
        return app.reloadVRM();
    };
    
    window.testPrice = () => {
        if (!app) return 'App not initialized';
        return app.testPrice();
    };
    
    window.testTPS = () => {
        if (!app) return 'App not initialized';
        return app.testTPS();
    };
    
    window.getAppState = () => {
        if (!app) return 'App not initialized';
        return app.getAppState();
    };
    
    // Additional utility functions
    window.clearAudioQueue = () => {
        if (!app || !app.components.audioManager) return 'Audio manager not available';
        app.components.audioManager.clear();
        return 'Audio queue cleared';
    };
    
    window.setVolume = (volume = 0.8) => {
        if (!app || !app.components.audioManager) return 'Audio manager not available';
        app.components.audioManager.setVolume(volume);
        return `Volume set to: ${volume}`;
    };
    
    window.getAudioStats = () => {
        if (!app || !app.components.audioManager) return 'Audio manager not available';
        return app.components.audioManager.getStats();
    };
    
    window.toggleTheme = () => {
        if (!app) return 'App not initialized';
        app.toggleTheme();
        return 'Theme toggled';
    };
}

function showInitError(error) {
    const loadingStatus = document.getElementById('loadingStatus');
    if (loadingStatus) {
        loadingStatus.innerHTML = `
            <div class="loading-content error" style="color: #ff5a7a;">
                <h2>🚨 Initialization Error</h2>
                <p>Failed to start Solmate. Please refresh the page.</p>
                <details style="margin-top: 15px;">
                    <summary style="cursor: pointer;">Error Details</summary>
                    <pre style="margin-top: 10px; padding: 10px; background: rgba(255,255,255,0.1); border-radius: 8px; overflow-x: auto; font-size: 12px;">${error.message || error}</pre>
                </details>
                <button onclick="location.reload()" style="
                    margin-top: 20px;
                    padding: 12px 24px;
                    background: linear-gradient(135deg, #00f0ff, #00ff88);
                    border: none;
                    border-radius: 12px;
                    color: #001014;
                    cursor: pointer;
                    font-weight: bold;
                    font-size: 14px;
                ">🔄 Reload Page</button>
            </div>
        `;
    }
    
    // Also create a fallback notification
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(255, 90, 122, 0.95);
        color: white;
        padding: 20px;
        border-radius: 12px;
        text-align: center;
        z-index: 10000;
        font-family: system-ui, sans-serif;
    `;
    errorDiv.innerHTML = `
        <h3>❌ Solmate failed to load</h3>
        <p>Please refresh the page and try again.</p>
        <button onclick="location.reload()" style="
            margin-top: 10px;
            padding: 8px 16px;
            background: white;
            color: #b4002e;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-weight: bold;
        ">Reload</button>
    `;
    document.body.appendChild(errorDiv);
}

function cleanup() {
    if (app) {
        console.log('🧹 Cleaning up Solmate...');
        app.destroy();
        app = null;
    }
}

// Set up cleanup on page unload
window.addEventListener('beforeunload', cleanup);

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (app) {
        if (document.hidden) {
            // Pause audio when page is hidden
            app.components.audioManager?.pause();
        } else {
            // Resume audio when page becomes visible
            app.components.audioManager?.resume();
        }
    }
});

// Start initialization when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

// Export for testing/debugging
export { app, cleanup };
