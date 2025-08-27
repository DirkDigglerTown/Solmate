// web/js/main.js
// Enhanced entry point with comprehensive debug tools and error handling
// USES VRMController.js CONSISTENTLY (not VRMLoader.js)

import { SolmateApp } from './SolmateApp.js';

// Global app instance
let app = null;
let initializationStartTime = performance.now();

// Enhanced initialization function
async function initialize() {
    try {
        console.log('🚀 Starting Enhanced Solmate initialization...');
        
        // Create app instance
        app = new SolmateApp();
        
        // Set up comprehensive error handling
        setupErrorHandling();
        
        // Set up performance monitoring
        setupPerformanceMonitoring();
        
        // Initialize the app
        await app.init();
        
        const initTime = performance.now() - initializationStartTime;
        console.log(`✅ Solmate initialized successfully in ${initTime.toFixed(2)}ms`);
        
        // Hide loading screen with animation
        hideLoadingScreen();
        
        // Setup debug tools
        setupDebugTools();
        
        // Setup automatic state saving
        setupStatePersistence();
        
    } catch (error) {
        console.error('❌ Failed to initialize Solmate:', error);
        showInitError(error);
    }
}

// Comprehensive error handling setup
function setupErrorHandling() {
    // Global JavaScript errors
    window.addEventListener('error', (event) => {
        console.error('🔥 Global error:', event.error);
        app?.emit('error', { 
            context: 'global', 
            error: event.error,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno
        });
        
        // Show user-friendly error message
        showUserError('A system error occurred. The app may not function properly.');
    });
    
    // Unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
        console.error('🔥 Unhandled promise rejection:', event.reason);
        app?.emit('error', { 
            context: 'promise', 
            error: event.reason 
        });
        
        showUserError('A background operation failed. Some features may be affected.');
    });
    
    // Resource loading errors
    window.addEventListener('error', (event) => {
        if (event.target !== window && event.target.tagName) {
            console.error(`🔥 Resource failed to load: ${event.target.tagName} - ${event.target.src || event.target.href}`);
        }
    }, true);
    
    console.log('🛡️ Error handling systems active');
}

// Performance monitoring setup
function setupPerformanceMonitoring() {
    // Mark key performance milestones
    performance.mark('solmate-init-start');
    
    // Monitor key metrics
    const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
            if (entry.name.includes('solmate')) {
                console.log(`⚡ Performance: ${entry.name} - ${entry.duration.toFixed(2)}ms`);
            }
        }
    });
    
    observer.observe({ entryTypes: ['measure', 'mark'] });
    
    // Memory monitoring (if available)
    if (performance.memory) {
        const checkMemory = () => {
            const memory = performance.memory;
            console.log(`🧠 Memory: ${Math.round(memory.usedJSHeapSize / 1024 / 1024)}MB used, ${Math.round(memory.totalJSHeapSize / 1024 / 1024)}MB total`);
        };
        
        // Check memory every 30 seconds
        setInterval(checkMemory, 30000);
        checkMemory(); // Initial check
    }
    
    console.log('📊 Performance monitoring active');
}

// Enhanced loading screen management
function hideLoadingScreen() {
    const loadingScreen = document.getElementById('loadingStatus');
    const appContainer = document.getElementById('app');
    
    if (loadingScreen) {
        // Fade out animation
        loadingScreen.style.opacity = '0';
        loadingScreen.style.transition = 'opacity 0.5s ease-out';
        
        setTimeout(() => {
            loadingScreen.style.display = 'none';
        }, 500);
    }
    
    if (appContainer) {
        appContainer.style.opacity = '0';
        appContainer.style.display = 'block';
        appContainer.style.transition = 'opacity 0.5s ease-in';
        
        requestAnimationFrame(() => {
            appContainer.style.opacity = '1';
        });
    }
    
    // Mark initialization complete
    performance.mark('solmate-init-complete');
    performance.measure('solmate-total-init', 'solmate-init-start', 'solmate-init-complete');
}

// Comprehensive debug tools
function setupDebugTools() {
    // Expose app instance for debugging
    if (typeof window !== 'undefined') {
        window.solmateApp = app;
        window.solmateDebug = createDebugAPI();
        
        console.log('🔧 Debug tools loaded. Try these commands:');
        console.log('  • solmateDebug.stats() - Get app statistics');
        console.log('  • solmateDebug.testWave() - Test wave animation');
        console.log('  • solmateDebug.testChat() - Send test message');
        console.log('  • solmateDebug.testTTS() - Test text-to-speech');
        console.log('  • solmateDebug.testExpressions() - Cycle through expressions');
        console.log('  • solmateDebug.resetUser() - Reset user context');
        console.log('  • solmateDebug.clearCache() - Clear all caches');
    }
}

// Create comprehensive debug API
function createDebugAPI() {
    return {
        // Get comprehensive app statistics
        stats() {
            console.table({
                'App Initialized': app?.state?.initialized || false,
                'Conversation Length': app?.state?.conversation?.length || 0,
                'User Relationship': app?.state?.userContext?.relationshipLevel || 'unknown',
                'Interaction Count': app?.state?.userContext?.interactionCount || 0,
                'VRM Loaded': app?.components?.vrmController?.state?.loaded || false,
                'Audio Queue': app?.components?.audioManager?.getQueueLength() || 0,
                'Is Playing': app?.components?.audioManager?.isPlaying() || false,
                'Theme': app?.state?.ui?.theme || 'dark'
            });
            
            return app?.getAppStats();
        },
        
        // Test natural wave animation
        testWave() {
            console.log('🌊 Testing natural wave animation...');
            app?.components?.vrmController?.playWave();
            return 'Wave animation started - should see natural multi-phase movement';
        },
        
        // Test chat system
        async testChat(message = "Hello Solmate! How are you today?") {
            console.log('💬 Testing chat system...');
            try {
                await app?.sendMessage(message);
                return 'Chat test completed';
            } catch (error) {
                console.error('Chat test failed:', error);
                return `Chat test failed: ${error.message}`;
            }
        },
        
        // Test TTS system
        testTTS(text = "Hello! I'm testing the enhanced text to speech system with sentiment analysis.", sentiment = 'happy') {
            console.log('🎵 Testing TTS system...');
            app?.components?.audioManager?.queue(text, { sentiment });
            return 'TTS test queued - should hear enhanced voice with emotion';
        },
        
        // Test all expressions
        testExpressions() {
            console.log('😊 Testing expression system...');
            const expressions = ['neutral', 'happy', 'sad', 'surprised', 'angry'];
            let index = 0;
            
            const cycleExpression = () => {
                if (index < expressions.length) {
                    const expr = expressions[index];
                    console.log(`Setting expression: ${expr}`);
                    app?.components?.vrmController?.setExpression(expr, 0.8, 2000);
                    index++;
                    setTimeout(cycleExpression, 2500);
                } else {
                    console.log('Expression test complete');
                    app?.components?.vrmController?.setExpression('neutral', 0);
                }
            };
            
            cycleExpression();
            return 'Expression test started - cycling through all emotions';
        },
        
        // Test micro-gestures
        testGestures() {
            console.log('🎭 Testing micro-gestures...');
            const gestures = [
                () => app?.components?.vrmController?.performHeadTilt(),
                () => app?.components?.vrmController?.performShoulderShrug(),
                () => app?.components?.vrmController?.performWink(),
                () => app?.components?.vrmController?.performBlink()
            ];
            
            gestures.forEach((gesture, i) => {
                setTimeout(gesture, i * 1500);
            });
            
            return 'Gesture test started - watch for natural micro-movements';
        },
        
        // Test opening sequence
        testOpening() {
            console.log('🎬 Testing opening sequence...');
            app?.components?.vrmController?.playOpeningSequence();
            return 'Opening sequence started - should see 10+ second welcome animation';
        },
        
        // Reset user context
        resetUser() {
            console.log('👤 Resetting user context...');
            if (app?.state?.userContext) {
                app.state.userContext = {
                    isTyping: false,
                    lastInteraction: null,
                    relationshipLevel: 'new',
                    interactionCount: 0,
                    preferences: {},
                    conversationTone: 'friendly',
                    topics: [],
                    mood: 'neutral'
                };
                
                app.saveState();
                console.log('User context reset to defaults');
            }
            return 'User context has been reset';
        },
        
        // Clear all caches
        async clearCache() {
            console.log('🧹 Clearing all caches...');
            
            // Clear localStorage
            try {
                localStorage.clear();
                console.log('✅ LocalStorage cleared');
            } catch (e) {
                console.warn('⚠️ LocalStorage clear failed:', e);
            }
            
            // Clear service worker caches
            if ('caches' in window) {
                try {
                    const cacheNames = await caches.keys();
                    await Promise.all(
                        cacheNames.map(name => caches.delete(name))
                    );
                    console.log(`✅ Cleared ${cacheNames.length} service worker caches`);
                } catch (e) {
                    console.warn('⚠️ Cache clearing failed:', e);
                }
            }
            
            // Clear audio manager cache
            app?.components?.audioManager?.clearCache();
            console.log('✅ Audio cache cleared');
            
            return 'All caches cleared - refresh page to see changes';
        },
        
        // Force VRM reload
        async reloadVRM() {
            console.log('🔄 Forcing VRM reload...');
            try {
                await app?.components?.vrmController?.reload();
                return 'VRM reloaded successfully';
            } catch (error) {
                console.error('VRM reload failed:', error);
                return `VRM reload failed: ${error.message}`;
            }
        },
        
        // Test API endpoints
        async testAPI() {
            console.log('🌐 Testing API endpoints...');
            const results = {};
            
            const endpoints = [
                { name: 'Config', url: '/api/config' },
                { name: 'Health', url: '/api/health' },
                { name: 'Price', url: '/api/price?ids=So11111111111111111111111111111111111111112' },
                { name: 'TPS', url: '/api/tps' }
            ];
            
            for (const endpoint of endpoints) {
                try {
                    const response = await fetch(endpoint.url);
                    results[endpoint.name] = {
                        status: response.status,
                        ok: response.ok,
                        timestamp: new Date().toISOString()
                    };
                    console.log(`✅ ${endpoint.name}: ${response.status}`);
                } catch (error) {
                    results[endpoint.name] = {
                        status: 'ERROR',
                        error: error.message,
                        timestamp: new Date().toISOString()
                    };
                    console.log(`❌ ${endpoint.name}: ${error.message}`);
                }
            }
            
            console.table(results);
            return results;
        },
        
        // Get detailed memory usage
        getMemoryInfo() {
            if (!performance.memory) {
                return 'Memory API not available';
            }
            
            const memory = performance.memory;
            const info = {
                'Used (MB)': Math.round(memory.usedJSHeapSize / 1024 / 1024),
                'Total (MB)': Math.round(memory.totalJSHeapSize / 1024 / 1024),
                'Limit (MB)': Math.round(memory.jsHeapSizeLimit / 1024 / 1024),
                'Usage %': Math.round((memory.usedJSHeapSize / memory.totalJSHeapSize) * 100)
            };
            
            console.table(info);
            return info;
        }
    };
}

// State persistence setup
function setupStatePersistence() {
    // Save state periodically
    setInterval(() => {
        app?.saveState();
    }, 30000); // Every 30 seconds
    
    // Save on page unload
    window.addEventListener('beforeunload', () => {
        app?.saveState();
    });
    
    console.log('💾 State persistence active');
}

// Show initialization error to user
function showInitError(error) {
    const loadingScreen = document.getElementById('loadingStatus');
    if (loadingScreen) {
        loadingScreen.innerHTML = `
            <div class="loading-content error">
                <h2>🚨 Initialization Error</h2>
                <p>Solmate failed to start properly. Please try refreshing the page.</p>
                <details style="margin-top: 15px; text-align: left;">
                    <summary>Error Details</summary>
                    <pre style="font-size: 12px; margin-top: 10px; padding: 10px; background: rgba(0,0,0,0.3); border-radius: 4px; overflow-x: auto;">${error.stack || error.message || error}</pre>
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
                ">🔄 Reload Page</button>
                <div style="margin-top: 15px; font-size: 12px; opacity: 0.7;">
                    If this persists, check browser console for details
                </div>
            </div>
        `;
    }
}

// Show user-friendly error messages
function showUserError(message, duration = 5000) {
    const errorContainer = document.getElementById('errorContainer');
    if (!errorContainer) return;
    
    const errorEl = document.createElement('div');
    errorEl.className = 'error-message';
    errorEl.textContent = message;
    errorContainer.appendChild(errorEl);
    
    // Auto-remove after duration
    setTimeout(() => {
        errorEl.remove();
    }, duration);
    
    // Click to dismiss
    errorEl.addEventListener('click', () => {
        errorEl.remove();
    });
}

// Cleanup function
function cleanup() {
    if (app) {
        console.log('🧹 Cleaning up Solmate...');
        app.destroy();
        app = null;
    }
}

// Enhanced page visibility handling
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // Page hidden - pause non-critical operations
        app?.components?.audioManager?.pause();
    } else {
        // Page visible - resume operations
        app?.components?.audioManager?.resume();
        
        // Check for updates
        if (app?.components?.vrmController) {
            app.components.vrmController.reactToUserReturn();
        }
    }
});

// Handle online/offline status
window.addEventListener('online', () => {
    console.log('🌐 Back online');
    app?.handleOnlineStatus(true);
});

window.addEventListener('offline', () => {
    console.log('📡 Gone offline');
    app?.handleOnlineStatus(false);
});

// Set up cleanup on page unload
window.addEventListener('beforeunload', cleanup);

// Keyboard shortcuts for debugging
document.addEventListener('keydown', (event) => {
    // Ctrl/Cmd + Alt + D for debug panel
    if ((event.ctrlKey || event.metaKey) && event.altKey && event.key === 'd') {
        event.preventDefault();
        const debugPanel = document.getElementById('debugOverlay');
        if (debugPanel) {
            debugPanel.classList.toggle('hidden');
        }
    }
    
    // Ctrl/Cmd + Alt + R for VRM reload
    if ((event.ctrlKey || event.metaKey) && event.altKey && event.key === 'r') {
        event.preventDefault();
        window.solmateDebug?.reloadVRM();
    }
    
    // Ctrl/Cmd + Alt + W for wave test
    if ((event.ctrlKey || event.metaKey) && event.altKey && event.key === 'w') {
        event.preventDefault();
        window.solmateDebug?.testWave();
    }
});

// Development mode enhancements
if (import.meta.env?.DEV || window.location.hostname === 'localhost') {
    console.log('🛠️ Development mode active');
    
    // Hot reload support
    if (import.meta.hot) {
        import.meta.hot.accept('./SolmateApp.js', (newModule) => {
            console.log('🔥 Hot reloading SolmateApp...');
            // Could implement hot reload logic here
        });
    }
}

// Start initialization when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

// Export for testing purposes
export { app, cleanup, initialize };
