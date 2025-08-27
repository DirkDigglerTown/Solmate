// web/js/main.js
// Fixed main entry point with proper error handling and module integration

import { SolmateApp } from './SolmateApp.js';

// Global app instance
let app = null;

// Initialize application when DOM is ready
async function initialize() {
    try {
        console.log('🚀 Initializing Solmate...');
        
        // Check for required elements
        const requiredElements = ['vrmCanvas', 'chatForm', 'promptInput', 'sendBtn'];
        const missingElements = requiredElements.filter(id => !document.getElementById(id));
        
        if (missingElements.length > 0) {
            throw new Error(`Missing required elements: ${missingElements.join(', ')}`);
        }
        
        // Check WebGL support
        if (!isWebGLSupported()) {
            console.warn('⚠️ WebGL not supported, running in audio-only mode');
            showWebGLFallback();
        }
        
        // Create app instance
        app = new SolmateApp();
        
        // Set up global error handling
        setupGlobalErrorHandling();
        
        // Initialize the app
        await app.init();
        
        console.log('✅ Solmate initialized successfully');
        
        // Hide loading screen
        hideLoadingScreen();
        
        // Expose app instance for debugging
        if (import.meta.env?.DEV || window.location.hostname === 'localhost') {
            window.solmateApp = app;
            console.log('🛠️ Development mode: app instance available at window.solmateApp');
        }
        
        // Setup debug commands
        setupDebugCommands();
        
    } catch (error) {
        console.error('❌ Failed to initialize Solmate:', error);
        showInitError(error);
    }
}

// Check WebGL support
function isWebGLSupported() {
    try {
        const canvas = document.createElement('canvas');
        return !!(window.WebGLRenderingContext && 
                 (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
    } catch(e) {
        return false;
    }
}

// Show WebGL fallback UI
function showWebGLFallback() {
    const canvas = document.getElementById('vrmCanvas');
    const fallback = document.querySelector('.webgl-fallback');
    
    if (canvas) canvas.style.display = 'none';
    if (fallback) fallback.style.display = 'block';
    
    document.body.classList.add('no-webgl');
}

// Setup global error handling
function setupGlobalErrorHandling() {
    // Unhandled errors
    window.addEventListener('error', (event) => {
        console.error('🚨 Global error:', event.error);
        if (app) {
            app.emit('error', { 
                context: 'global', 
                error: event.error,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno
            });
        }
    });
    
    // Unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
        console.error('🚨 Unhandled promise rejection:', event.reason);
        if (app) {
            app.emit('error', { 
                context: 'promise', 
                error: event.reason 
            });
        }
        
        // Prevent the default browser behavior
        event.preventDefault();
    });
    
    // Module loading errors
    window.addEventListener('moduleError', (event) => {
        console.error('🚨 Module loading error:', event.detail);
        if (app) {
            app.emit('error', {
                context: 'module',
                error: event.detail.error,
                module: event.detail.module
            });
        }
    });
}

// Hide loading screen
function hideLoadingScreen() {
    const loadingScreen = document.getElementById('loadingStatus');
    if (loadingScreen) {
        loadingScreen.style.opacity = '0';
        setTimeout(() => {
            loadingScreen.style.display = 'none';
        }, 500);
    }
}

// Show initialization error to user
function showInitError(error) {
    console.error('💥 Initialization error details:', error);
    
    const loadingScreen = document.getElementById('loadingStatus');
    if (loadingScreen) {
        loadingScreen.innerHTML = `
            <div class="loading-content error">
                <div style="font-size: 24px; margin-bottom: 16px;">❌</div>
                <h2>Initialization Error</h2>
                <p>Failed to start Solmate. Please refresh the page.</p>
                <details style="margin-top: 16px; text-align: left;">
                    <summary style="cursor: pointer; padding: 8px; background: rgba(255,255,255,0.1); border-radius: 4px;">Error Details</summary>
                    <pre style="margin-top: 8px; padding: 8px; background: rgba(0,0,0,0.3); border-radius: 4px; font-size: 12px; overflow-x: auto;">${error.message || error}
${error.stack || ''}</pre>
                </details>
                <button onclick="location.reload()" style="
                    margin-top: 20px;
                    padding: 12px 24px;
                    background: linear-gradient(135deg, #00f0ff, #00ff88);
                    border: none;
                    border-radius: 8px;
                    color: #001014;
                    cursor: pointer;
                    font-weight: bold;
                    font-size: 14px;
                ">Reload Page</button>
            </div>
        `;
        loadingScreen.style.display = 'block';
        loadingScreen.style.opacity = '1';
    }
    
    // Also try to initialize in audio-only mode
    setTimeout(() => {
        initializeAudioOnlyMode();
    }, 1000);
}

// Initialize in audio-only mode as fallback
async function initializeAudioOnlyMode() {
    try {
        console.log('🎵 Attempting audio-only initialization...');
        
        // Create minimal app without VRM
        const { AudioManager } = await import('./AudioManager.js');
        const audioManager = new AudioManager();
        await audioManager.init();
        
        // Setup basic chat functionality
        setupBasicChat(audioManager);
        
        // Show audio-only message
        showAudioOnlyMode();
        
        console.log('✅ Audio-only mode initialized');
        
    } catch (error) {
        console.error('❌ Audio-only mode failed:', error);
    }
}

// Setup basic chat functionality for audio-only mode
function setupBasicChat(audioManager) {
    const chatForm = document.getElementById('chatForm');
    const promptInput = document.getElementById('promptInput');
    const sendBtn = document.getElementById('sendBtn');
    
    if (!chatForm || !promptInput || !sendBtn) return;
    
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const text = promptInput.value.trim();
        if (!text) return;
        
        promptInput.value = '';
        sendBtn.disabled = true;
        sendBtn.textContent = '⏳';
        
        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [
                        { 
                            role: 'system', 
                            content: 'You are Solmate. Keep responses brief since this is audio-only mode.' 
                        },
                        { role: 'user', content: text }
                    ]
                })
            });
            
            if (response.ok) {
                const { content } = await response.json();
                audioManager.queue(content);
            } else {
                throw new Error(`Chat failed: ${response.status}`);
            }
            
        } catch (error) {
            console.error('Chat error:', error);
            audioManager.queue("Sorry, I'm having trouble responding right now.");
        } finally {
            sendBtn.disabled = false;
            sendBtn.textContent = '▶';
        }
    });
}

// Show audio-only mode message
function showAudioOnlyMode() {
    const canvas = document.getElementById('vrmCanvas');
    if (canvas) {
        const audioOnlyDiv = document.createElement('div');
        audioOnlyDiv.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
            color: white;
            font-family: system-ui, sans-serif;
            background: rgba(10, 14, 23, 0.9);
            padding: 40px;
            border-radius: 20px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(20px);
        `;
        audioOnlyDiv.innerHTML = `
            <div style="font-size: 48px; margin-bottom: 16px;">🎵</div>
            <h2>Audio-Only Mode</h2>
            <p>Chat functionality is available below!</p>
            <p style="margin-top: 16px; opacity: 0.7;">Solmate is ready to chat with you.</p>
        `;
        
        canvas.parentElement.appendChild(audioOnlyDiv);
    }
}

// Setup debug commands
function setupDebugCommands() {
    if (!app) return;
    
    // Expose debug functions globally
    window.debugVRM = () => app.debugVRM();
    window.testChat = () => app.testChat();
    window.testTTS = () => app.testTTS();
    window.testWave = () => app.testWave();
    window.testNod = () => app.testNod();
    window.testThink = () => app.testThink();
    window.testExcited = () => app.testExcited();
    window.testExpression = (expr, intensity) => app.testExpression(expr, intensity);
    window.testMood = (mood) => app.testMood(mood);
    window.reloadVRM = () => app.reloadVRM();
    window.testPrice = () => app.testPrice();
    window.testTPS = () => app.testTPS();
    window.getAppState = () => app.getAppState();
    
    // Log available commands
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

// Cleanup function
function cleanup() {
    if (app) {
        console.log('🧹 Cleaning up Solmate...');
        app.destroy();
        app = null;
    }
    
    // Clear debug functions
    if (window.debugVRM) {
        delete window.debugVRM;
        delete window.testChat;
        delete window.testTTS;
        delete window.testWave;
        delete window.testNod;
        delete window.testThink;
        delete window.testExcited;
        delete window.testExpression;
        delete window.testMood;
        delete window.reloadVRM;
        delete window.testPrice;
        delete window.testTPS;
        delete window.getAppState;
        delete window.solmateApp;
    }
}

// Performance monitoring
function logPerformance() {
    if (performance.getEntriesByType) {
        const navigation = performance.getEntriesByType('navigation')[0];
        if (navigation) {
            console.log('⚡ Performance metrics:');
            console.log(`- Page load: ${Math.round(navigation.loadEventEnd - navigation.loadEventStart)}ms`);
            console.log(`- DOM ready: ${Math.round(navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart)}ms`);
            console.log(`- First paint: ${Math.round(navigation.loadEventEnd)}ms`);
        }
    }
}

// Set up cleanup on page unload
window.addEventListener('beforeunload', cleanup);

// Handle visibility changes
document.addEventListener('visibilitychange', () => {
    if (app) {
        if (document.hidden) {
            // Page is hidden - pause non-critical operations
            app.emit('visibility:hidden');
        } else {
            // Page is visible - resume operations
            app.emit('visibility:visible');
        }
    }
});

// Start initialization when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        // Add slight delay to ensure all resources are ready
        setTimeout(initialize, 100);
    });
} else {
    // DOM already ready
    setTimeout(initialize, 100);
}

// Log performance metrics after everything loads
window.addEventListener('load', () => {
    setTimeout(logPerformance, 1000);
});

// Export for testing
export { app, cleanup, initialize };
