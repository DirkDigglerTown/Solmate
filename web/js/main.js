// web/js/main.js
// Restored main entry point based on working version

import { SolmateApp } from './SolmateApp.js';

// Global app instance
let app = null;

// Initialize application when DOM is ready
async function initialize() {
    try {
        console.log('🚀 Initializing Solmate...');
        
        // Create app instance
        app = new SolmateApp();
        
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
        
        // Hide loading screen
        const loadingScreen = document.getElementById('loadingStatus');
        if (loadingScreen) {
            loadingScreen.style.display = 'none';
        }
        
        // Set up cleanup on page unload
        window.addEventListener('beforeunload', cleanup);
        
        // Expose app instance in development mode
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            window.solmateApp = app;
            console.log('Development mode: app instance available at window.solmateApp');
        }
        
        // Setup debug commands
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
    const loadingScreen = document.getElementById('loadingStatus');
    if (loadingScreen) {
        loadingScreen.innerHTML = `
            <div class="loading-content error">
                <h2>Initialization Error</h2>
                <p>Failed to start Solmate. Please refresh the page.</p>
                <details>
                    <summary>Error Details</summary>
                    <pre>${error.message || error}</pre>
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

// Start initialization when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

// Export for testing
export { app, cleanup };
