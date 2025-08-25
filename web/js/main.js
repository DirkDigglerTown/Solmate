// web/js/main.js
// Main entry point for the modular Solmate application

import { SolmateApp } from './SolmateApp.js';

// Global app instance
let app = null;

// Initialize application when DOM is ready
function initialize() {
    try {
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
        app.init().then(() => {
            console.log('Solmate initialized successfully');
            
            // Hide loading screen
            const loadingScreen = document.getElementById('loadingScreen');
            const appContainer = document.getElementById('app');
            
            if (loadingScreen && appContainer) {
                loadingScreen.style.display = 'none';
                appContainer.style.display = '';
            }
        }).catch((error) => {
            console.error('Failed to initialize Solmate:', error);
            showInitError(error);
        });
        
        // Set up cleanup on page unload
        window.addEventListener('beforeunload', cleanup);
        
        // Expose app instance in development mode
        if (import.meta.env.DEV) {
            window.solmateApp = app;
            console.log('Development mode: app instance available at window.solmateApp');
        }
        
    } catch (error) {
        console.error('Failed to create Solmate instance:', error);
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
    const loadingScreen = document.getElementById('loadingScreen');
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

// Start initialization when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

// Export for testing
export { app, cleanup };
