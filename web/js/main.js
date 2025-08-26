// web/js/main.js
// Main entry point for the modular Solmate application

import { SolmateApp } from './SolmateApp.js';
import { VRMController } from './VRMController.js';

// Global app instance
let app = null;

// Initialize application when DOM is ready
async function initialize() {
    try {
        console.log('🚀 Initializing Solmate...');
        
        // Hide loading status initially
        const loadingStatus = document.getElementById('loadingStatus');
        if (loadingStatus) {
            loadingStatus.style.display = 'block';
        }
        
        // Create app instance
        app = new SolmateApp();
        
        // Make app available globally for debugging
        window.solmateApp = app;
        
        // Set up global error handling
        window.addEventListener('error', (event) => {
            console.error('Global error:', event.error);
            app?.emit('error', { context: 'global', error: event.error });
        });
        
        window.addEventListener('unhandledrejection', (event) => {
            console.error('Unhandled promise rejection:', event.reason);
            app?.emit('error', { context: 'promise', error: event.reason });
        });
        
        // Initialize the app
        await app.init();
        
        console.log('✅ Solmate initialized successfully');
        
        // Hide loading screen after a short delay
        setTimeout(() => {
            if (loadingStatus) {
                loadingStatus.style.display = 'none';
            }
        }, 1000);
        
        // Set up cleanup on page unload
        window.addEventListener('beforeunload', cleanup);
        
        // Expose debug functions
        setupDebugCommands();
        
    } catch (error) {
        console.error('Failed to initialize Solmate:', error);
        showInitError(error);
    }
}

// Cleanup function
function cleanup() {
    if (app) {
        console.log('Cleaning up Solmate...');
        app.destroy();
        app = null;
    }
}

// Show initialization error to user
function showInitError(error) {
    const loadingStatus = document.getElementById('loadingStatus');
    if (loadingStatus) {
        loadingStatus.innerHTML = `
            <div class="loading-content error" style="text-align: center; color: white;">
                <h2>Initialization Error</h2>
                <p>Failed to start Solmate. Please refresh the page.</p>
                <details style="margin-top: 20px;">
                    <summary style="cursor: pointer;">Error Details</summary>
                    <pre style="text-align: left; background: rgba(255,255,255,0.1); padding: 10px; border-radius: 5px; margin-top: 10px;">${error.message || error}</pre>
                </details>
                <button onclick="location.reload()" style="
                    margin-top: 20px;
                    padding: 10px 20px;
                    background: #00ff88;
                    border: none;
                    border-radius: 8px;
                    color: #0a0e17;
                    cursor: pointer;
                    font-weight: bold;
                ">Reload Page</button>
            </div>
        `;
    }
}

// Setup debug commands
function setupDebugCommands() {
    // Debug VRM status
    window.debugVRM = function() {
        const controller = app?.components?.vrmController;
        if (!controller) {
            console.log('VRM controller not initialized');
            return null;
        }
        
        console.log('=== VRM DEBUG REPORT ===');
        console.log('Controller initialized:', controller.state.initialized);
        console.log('VRM loaded:', controller.state.loaded);
        console.log('Current animation:', controller.state.currentAnimation);
        console.log('Current emotion:', controller.emotion.current);
        
        if (controller.vrm) {
            console.log('VRM Features:', {
                hasHumanoid: !!controller.vrm.humanoid,
                hasExpressions: !!controller.vrm.expressionManager,
                hasLookAt: !!controller.vrm.lookAt,
                hasSpringBones: !!controller.vrm.springBoneManager
            });
            console.log('Available bones:', Object.keys(controller.bones));
            console.log('Available expressions:', Object.keys(controller.expressions));
        }
        
        return controller;
    };
    
    // Test chat
    window.testChat = async function(message = "Hello! How are you today?") {
        if (!app) {
            console.error('App not initialized');
            return;
        }
        return app.sendMessage(message);
    };
    
    // Test TTS
    window.testTTS = function(text = "Testing the text to speech system.", voice = 'nova') {
        if (!app?.components?.audioManager) {
            console.error('Audio manager not initialized');
            return;
        }
        app.components.audioManager.queue(text, voice);
    };
    
    // Test animations
    window.testWave = function() {
        const controller = app?.components?.vrmController;
        if (!controller) {
            console.error('VRM controller not initialized');
            return;
        }
        controller.wave();
    };
    
    window.testNod = function() {
        const controller = app?.components?.vrmController;
        if (!controller) {
            console.error('VRM controller not initialized');
            return;
        }
        controller.nod();
    };
    
    window.testThink = function() {
        const controller = app?.components?.vrmController;
        if (!controller) {
            console.error('VRM controller not initialized');
            return;
        }
        controller.think();
    };
    
    window.testExcited = function() {
        const controller = app?.components?.vrmController;
        if (!controller) {
            console.error('VRM controller not initialized');
            return;
        }
        controller.excited();
    };
    
    // Test expressions
    window.testExpression = function(expression = 'happy', intensity = 1) {
        const controller = app?.components?.vrmController;
        if (!controller) {
            console.error('VRM controller not initialized');
            return;
        }
        controller.setExpression(expression, intensity, 2000);
    };
    
    // Test mood
    window.testMood = function(mood = 'happy') {
        const controller = app?.components?.vrmController;
        if (!controller) {
            console.error('VRM controller not initialized');
            return;
        }
        controller.setMood(mood);
    };
    
    // Reload VRM
    window.reloadVRM = async function() {
        const controller = app?.components?.vrmController;
        if (!controller) {
            console.error('VRM controller not initialized');
            return;
        }
        
        console.log('🔄 Reloading VRM...');
        try {
            await controller.loadVRM('/assets/avatar/solmate.vrm');
            console.log('✅ VRM reloaded successfully');
            return 'VRM reloaded';
        } catch (error) {
            console.error('Failed to reload VRM:', error);
            return 'Reload failed: ' + error.message;
        }
    };
    
    // Test price fetch
    window.testPrice = async function() {
        if (!app) {
            console.error('App not initialized');
            return;
        }
        return app.fetchPrice();
    };
    
    // Test TPS fetch
    window.testTPS = async function() {
        if (!app) {
            console.error('App not initialized');
            return;
        }
        return app.fetchTPS();
    };
    
    // Get app state
    window.getAppState = function() {
        if (!app) {
            console.error('App not initialized');
            return null;
        }
        return {
            initialized: app.state.initialized,
            conversation: app.state.conversation,
            wsConnected: app.state.wsConnection?.readyState === WebSocket.OPEN,
            theme: app.state.ui.theme,
            debugMode: app.state.ui.debugMode,
            components: {
                vrmController: !!app.components.vrmController,
                audioManager: !!app.components.audioManager
            }
        };
    };
    
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
}

// Handle service worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then(registration => {
                console.log('✅ Service Worker registered:', registration.scope);
                
                // Update UI
                const swStatus = document.getElementById('swStatus');
                if (swStatus) swStatus.textContent = 'active';
                
                // Handle updates
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            // New service worker available
                            if (window.Utils) {
                                window.Utils.showNotification('Update available! Refresh to get the latest version.', 'info', 10000);
                            }
                        }
                    });
                });
                
                // Check for updates periodically
                setInterval(() => {
                    registration.update();
                }, 60000); // Check every minute
            })
            .catch(error => {
                console.warn('Service Worker registration failed:', error);
                const swStatus = document.getElementById('swStatus');
                if (swStatus) swStatus.textContent = 'failed';
            });
    });
    
    // Handle offline/online events
    window.addEventListener('online', () => {
        document.body.classList.remove('offline');
        if (window.Utils) {
            window.Utils.showNotification('Back online!', 'success', 3000);
        }
        // Reconnect WebSocket if needed
        if (app && !app.state.wsConnection) {
            app.connectWebSocket();
        }
    });
    
    window.addEventListener('offline', () => {
        document.body.classList.add('offline');
        if (window.Utils) {
            window.Utils.showNotification('You are offline. Some features may be limited.', 'warning', 5000);
        }
    });
} else {
    console.warn('Service Workers not supported');
    const swStatus = document.getElementById('swStatus');
    if (swStatus) swStatus.textContent = 'unsupported';
}

// Start initialization when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

// Export for testing
export { app, cleanup };
