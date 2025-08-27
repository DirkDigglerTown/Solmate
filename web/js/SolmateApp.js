// web/js/SolmateApp.js
// Fixed main application class based on working version

import { EventEmitter } from './EventEmitter.js';
import { VRMController } from './VRMController.js';
import { AudioManager } from './AudioManager.js';

export class SolmateApp extends EventEmitter {
    constructor() {
        super();
        
        this.config = {
            apiEndpoints: {
                chat: '/api/chat',
                tts: '/api/tts',
                price: '/api/price',
                tps: '/api/tps',
                config: '/api/config'
            },
            maxMessageLength: 500,
            maxConversationSize: 50,
            updateIntervals: {
                price: 30000,
                tps: 60000
            },
            systemPrompt: `You are Solmate, a helpful and witty Solana companion. Be maximally truthful, helpful, and add humor when appropriate. Focus on Solana, crypto, DeFi, NFTs, and web3 topics, but answer any question. Keep responses concise and engaging. Always remind users: Not financial advice.`
        };
        
        this.state = {
            initialized: false,
            conversation: [],
            wsConnection: null,
            wsReconnectAttempts: 0,
            timers: new Map(),
            ui: {
                theme: 'dark',
                debugMode: false
            },
            avatar: {
                ready: false,
                isAnimating: false
            }
        };
        
        this.components = {
            vrmController: null,
            audioManager: null
        };
    }
    
    async init() {
        try {
            this.emit('init:start');
            console.log('🚀 Initializing Solmate...');
            
            // Load configuration first
            await this.loadConfiguration();
            
            // Initialize AudioManager
            this.components.audioManager = new AudioManager();
            console.log('✅ AudioManager initialized');
            
            // Initialize VRMController with error handling
            try {
                this.components.vrmController = new VRMController();
                await this.components.vrmController.init();
                this.state.avatar.ready = true;
                console.log('✅ VRMController initialized');
            } catch (error) {
                console.error('❌ Failed to initialize VRMController:', error);
                // Continue without VRM - audio-only mode
                this.state.avatar.ready = false;
            }
            
            // Setup component event listeners
            this.setupComponentListeners();
            
            // Initialize UI
            this.initializeUI();
            
            // Start data connections
            await this.initializeDataConnections();
            
            // Load saved state
            this.loadSavedState();
            
            this.state.initialized = true;
            this.emit('init:complete');
            console.log('✅ Solmate initialization complete');
            
            // Schedule welcome message
            this.scheduleWelcomeMessage();
            
        } catch (error) {
            console.error('❌ Solmate initialization failed:', error);
            this.emit('error', { context: 'initialization', error });
            throw error;
        }
    }
    
    async loadConfiguration() {
        try {
            console.log('📋 Loading configuration...');
            const response = await fetch(this.config.apiEndpoints.config);
            if (!response.ok) {
                throw new Error(`Config loading failed: ${response.status}`);
            }
            
            const serverConfig = await response.json();
            this.config = { ...this.config, ...serverConfig };
            this.emit('config:loaded', this.config);
            console.log('✅ Configuration loaded from server');
            
        } catch (error) {
            console.warn('⚠️ Using default configuration:', error);
            this.emit('config:default');
        }
    }
    
    setupComponentListeners() {
        console.log('🔗 Setting up component listeners...');
        
        // VRM Controller events (if available)
        if (this.components.vrmController) {
            this.components.vrmController.on('load:start', () => {
                this.updateLoadingStatus('Loading avatar...');
            });
            
            this.components.vrmController.on('load:complete', (vrm) => {
                this.updateLoadingStatus('');
                this.state.avatar.ready = true;
                this.emit('avatar:loaded', vrm);
                console.log('🤖 Avatar loaded and ready');
            });
            
            this.components.vrmController.on('fallback:created', () => {
                this.state.avatar.ready = true;
                this.emit('avatar:fallback');
                console.log('🔧 Using fallback avatar');
            });
            
            this.components.vrmController.on('error', (error) => {
                console.error('❌ VRM error:', error);
                this.emit('error', { context: 'vrm', error });
            });
            
            this.components.vrmController.on('animation:wave:start', () => {
                this.state.avatar.isAnimating = true;
            });
            
            this.components.vrmController.on('animation:wave:end', () => {
                this.state.avatar.isAnimating = false;
            });
            
            this.components.vrmController.on('animation:speech:start', () => {
                this.state.avatar.isAnimating = true;
            });
            
            this.components.vrmController.on('animation:speech:end', () => {
                this.state.avatar.isAnimating = false;
            });
        }
        
        // Audio Manager events
        if (this.components.audioManager) {
            this.components.audioManager.on('play:start', (item) => {
                this.emit('speech:start', item);
                if (this.components.vrmController) {
                    this.components.vrmController.startSpeechAnimation();
                }
            });
            
            this.components.audioManager.on('play:end', () => {
                this.emit('speech:end');
                if (this.components.vrmController) {
                    this.components.vrmController.stopSpeechAnimation();
                }
            });
            
            this.components.audioManager.on('error', (error) => {
                console.error('❌ Audio error:', error);
                this.emit('error', { context: 'audio', error });
            });
            
            this.components.audioManager.on('queue:empty', () => {
                this.state.avatar.isAnimating = false;
            });
        }
        
        console.log('✅ Component listeners setup complete');
    }
    
    initializeUI() {
        console.log('🎨 Initializing UI...');
        
        // Theme toggle
        this.bindElement('#themeToggle', 'click', () => this.toggleTheme());
        
        // Chat form
        this.bindElement('#chatForm', 'submit', (e) => this.handleChatSubmit(e));
        
        // Clear audio
        this.bindElement('#clearBtn', 'click', () => {
            if (this.components.audioManager) {
                this.components.audioManager.clear();
            }
        });
        
        // Debug toggle
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'd') {
                e.preventDefault();
                this.toggleDebugMode();
            }
        });
        
        // Mouse tracking for avatar head movement
        if (this.components.vrmController) {
            document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        }
        
        // Audio enable on interaction
        ['click', 'keydown', 'touchstart'].forEach(event => {
            document.addEventListener(event, () => this.enableAudioContext(), { once: true });
        });
        
        // Handle window resize
        window.addEventListener('resize', () => {
            if (this.components.vrmController) {
                this.components.vrmController.handleResize();
            }
        });
        
        console.log('✅ UI initialized');
    }
    
    bindElement(selector, event, handler) {
        const element = document.querySelector(selector);
        if (element) {
            element.addEventListener(event, handler.bind(this));
        }
    }
    
    async initializeDataConnections() {
        console.log('🌐 Initializing data connections...');
        
        // WebSocket
        if (this.config.wsUrl) {
            this.connectWebSocket();
        }
        
        // Initial data fetch
        await Promise.all([
            this.fetchPrice(),
            this.fetchTPS()
        ]);
        
        // Setup periodic updates
        this.startTimer('price', () => this.fetchPrice(), this.config.updateIntervals.price);
        this.startTimer('tps', () => this.fetchTPS(), this.config.updateIntervals.tps);
        
        console.log('✅ Data connections initialized');
    }
    
    connectWebSocket() {
        if (this.state.wsConnection) {
            this.state.wsConnection.close();
        }
        
        try {
            console.log('🔗 Connecting WebSocket...');
            this.state.wsConnection = new WebSocket(this.config.wsUrl);
            
            this.state.wsConnection.onopen = () => {
                this.state.wsReconnectAttempts = 0;
                this.updateElement('#wsLight', 'WS ON', { color: '#00ff88' });
                this.emit('ws:connected');
                console.log('✅ WebSocket connected');
            };
            
            this.state.wsConnection.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleWebSocketMessage(data);
                } catch (error) {
                    console.error('WebSocket message parse error:', error);
                }
            };
            
            this.state.wsConnection.onclose = () => {
                this.updateElement('#wsLight', 'WS OFF', { color: '#ff6b6b' });
                this.scheduleWebSocketReconnect();
                this.emit('ws:disconnected');
            };
            
            this.state.wsConnection.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
                this.emit('error', { context: 'websocket', error });
            };
            
        } catch (error) {
            console.error('❌ WebSocket connection failed:', error);
            this.emit('error', { context: 'websocket:connect', error });
        }
    }
    
    scheduleWebSocketReconnect() {
        const delay = Math.min(5000 * Math.pow(2, this.state.wsReconnectAttempts), 60000);
        this.state.wsReconnectAttempts++;
        
        console.log(`🔄 WebSocket reconnecting in ${delay}ms (attempt ${this.state.wsReconnectAttempts})`);
        this.startTimer('wsReconnect', () => this.connectWebSocket(), delay, false);
    }
    
    handleWebSocketMessage(data) {
        if (data.tps) {
            this.updateTPS(data.tps);
        }
        this.emit('ws:message', data);
    }
    
    async fetchPrice() {
        try {
            const response = await fetch(`${this.config.apiEndpoints.price}?ids=So11111111111111111111111111111111111111112`);
            if (!response.ok) throw new Error(`Price fetch failed: ${response.status}`);
            
            const data = await response.json();
            const solMint = 'So11111111111111111111111111111111111111112';
            const price = data[solMint]?.usdPrice || data[solMint]?.price;
            
            if (price) {
                this.updateElement('#solPrice', `SOL — $${price.toFixed(2)}`, { color: '#00ff88' });
                this.emit('price:updated', price);
            }
        } catch (error) {
            this.updateElement('#solPrice', 'SOL — Error', { color: '#ff6b6b' });
            this.emit('error', { context: 'price', error });
        }
    }
    
    async fetchTPS() {
        try {
            const response = await fetch(this.config.apiEndpoints.tps);
            const data = await response.json();
            
            if (data.tps) {
                this.updateTPS(data.tps);
            }
        } catch (error) {
            this.emit('error', { context: 'tps', error });
        }
    }
    
    updateTPS(tps) {
        this.updateElement('#networkTPS', `${tps} TPS`, { color: '#00ff88' });
        this.emit('tps:updated', tps);
    }
    
    async handleChatSubmit(event) {
        event.preventDefault();
        
        const input = document.querySelector('#promptInput');
        if (!input) return;
        
        const text = input.value.trim();
        if (!text) return;
        
        if (text.length > this.config.maxMessageLength) {
            this.showError(`Message too long. Maximum ${this.config.maxMessageLength} characters.`);
            return;
        }
        
        input.value = '';
        this.setButtonState('#sendBtn', true, '⏳');
        
        // Show typing indicator
        this.showElement('#typingIndicator');
        
        try {
            await this.sendMessage(text);
        } finally {
            this.setButtonState('#sendBtn', false, '▶');
            this.hideElement('#typingIndicator');
        }
    }
    
    async sendMessage(text) {
        // Sanitize input
        const sanitizedText = this.sanitizeInput(text);
        
        // Add to conversation
        this.state.conversation.push({ role: 'user', content: sanitizedText });
        
        // Limit conversation size
        if (this.state.conversation.length > this.config.maxConversationSize) {
            this.state.conversation = this.state.conversation.slice(-this.config.maxConversationSize);
        }
        
        try {
            const response = await fetch(this.config.apiEndpoints.chat, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [
                        { role: 'system', content: this.config.systemPrompt },
                        ...this.state.conversation
                    ]
                })
            });
            
            if (!response.ok) {
                throw new Error(`Chat request failed: ${response.status}`);
            }
            
            const { content } = await response.json();
            const sanitizedContent = this.sanitizeOutput(content);
            
            this.state.conversation.push({ role: 'assistant', content: sanitizedContent });
            this.saveState();
            
            // Queue audio
            if (this.components.audioManager) {
                this.components.audioManager.queue(sanitizedContent);
            }
            
            this.emit('message:sent', { user: sanitizedText, assistant: sanitizedContent });
            
        } catch (error) {
            console.error('❌ Chat error:', error);
            this.emit('error', { context: 'chat', error });
            
            const errorMsg = "I'm having trouble processing that. Please try again.";
            if (this.components.audioManager) {
                this.components.audioManager.queue(errorMsg);
            }
        }
    }
    
    sanitizeInput(text) {
        return text.replace(/<[^>]*>/g, '').trim();
    }
    
    sanitizeOutput(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    toggleTheme() {
        const html = document.documentElement;
        const isLight = html.classList.toggle('light');
        
        this.state.ui.theme = isLight ? 'light' : 'dark';
        this.updateElement('#themeToggle', isLight ? '☀️' : '🌙');
        this.emit('theme:changed', this.state.ui.theme);
        
        // Save preference
        localStorage.setItem('solmate-theme', this.state.ui.theme);
    }
    
    toggleDebugMode() {
        this.state.ui.debugMode = !this.state.ui.debugMode;
        const debugOverlay = document.querySelector('#debugOverlay');
        if (debugOverlay) {
            debugOverlay.classList.toggle('hidden');
            
            if (!debugOverlay.classList.contains('hidden')) {
                this.updateDebugInfo();
            }
        }
        this.emit('debug:toggled', this.state.ui.debugMode);
    }
    
    updateDebugInfo() {
        const vrmStatus = document.getElementById('vrmStatus');
        const cacheStatus = document.getElementById('cacheStatus');
        
        if (vrmStatus && this.components.vrmController) {
            const state = this.components.vrmController.getState();
            vrmStatus.textContent = state.hasVRM ? 'loaded' : (state.hasFallback ? 'fallback' : 'not loaded');
        }
        
        if (cacheStatus && 'caches' in window) {
            caches.keys().then(names => {
                cacheStatus.textContent = `${names.length} caches`;
            }).catch(() => {
                cacheStatus.textContent = 'unavailable';
            });
        }
    }
    
    handleMouseMove(event) {
        if (!this.components.vrmController || this.state.avatar.isAnimating) return;
        
        const mouseX = (event.clientX / window.innerWidth) * 2 - 1;
        const mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
        
        this.components.vrmController.updateHeadTarget(mouseY * 0.1, mouseX * 0.2);
    }
    
    enableAudioContext() {
        if (this.components.audioManager) {
            this.components.audioManager.enableContext();
        }
    }
    
    scheduleWelcomeMessage() {
        setTimeout(() => {
            if (this.components.audioManager) {
                this.components.audioManager.queue("Hello! I'm Solmate, your Solana companion. Ask me anything!");
                
                // Play wave animation if VRM is ready
                setTimeout(() => {
                    if (this.components.vrmController && this.state.avatar.ready) {
                        this.components.vrmController.playWave();
                    }
                }, 1000);
            } else {
                console.warn('AudioManager not ready for welcome message');
            }
        }, 2000);
    }
    
    // UI UTILITY METHODS
    
    updateElement(selector, content, styles = {}) {
        const element = document.querySelector(selector);
        if (element) {
            if (content !== undefined) element.textContent = content;
            Object.assign(element.style, styles);
        }
    }
    
    updateLoadingStatus(message) {
        const loadingStatus = document.querySelector('#loadingStatus');
        if (loadingStatus) {
            if (message) {
                loadingStatus.textContent = message;
                loadingStatus.style.display = 'block';
            } else {
                loadingStatus.style.display = 'none';
            }
        }
    }
    
    setButtonState(selector, disabled, text) {
        const button = document.querySelector(selector);
        if (button) {
            button.disabled = disabled;
            if (text) button.textContent = text;
            if (disabled) {
                button.classList.add('loading');
            } else {
                button.classList.remove('loading');
            }
        }
    }
    
    showElement(selector) {
        const element = document.querySelector(selector);
        if (element) {
            element.classList.remove('hidden');
        }
    }
    
    hideElement(selector) {
        const element = document.querySelector(selector);
        if (element) {
            element.classList.add('hidden');
        }
    }
    
    showError(message) {
        const container = document.querySelector('#errorContainer');
        if (!container) {
            console.error(message);
            return;
        }
        
        const errorEl = document.createElement('div');
        errorEl.className = 'error-message';
        errorEl.textContent = message;
        errorEl.addEventListener('click', () => errorEl.remove());
        container.appendChild(errorEl);
        
        setTimeout(() => errorEl.remove(), 5000);
        this.emit('error:shown', message);
    }
    
    // TIMER UTILITIES
    
    startTimer(name, callback, interval, repeating = true) {
        this.stopTimer(name);
        
        if (repeating) {
            this.state.timers.set(name, setInterval(callback, interval));
        } else {
            this.state.timers.set(name, setTimeout(() => {
                callback();
                this.state.timers.delete(name);
            }, interval));
        }
    }
    
    stopTimer(name) {
        if (this.state.timers.has(name)) {
            const timer = this.state.timers.get(name);
            clearInterval(timer);
            clearTimeout(timer);
            this.state.timers.delete(name);
        }
    }
    
    // STATE MANAGEMENT
    
    saveState() {
        try {
            const state = {
                conversation: this.state.conversation,
                theme: this.state.ui.theme
            };
            localStorage.setItem('solmate-state', JSON.stringify(state));
        } catch (error) {
            console.error('Failed to save state:', error);
        }
    }
    
    loadSavedState() {
        try {
            // Load theme
            const savedTheme = localStorage.getItem('solmate-theme');
            if (savedTheme) {
                this.state.ui.theme = savedTheme;
                if (savedTheme === 'light') {
                    document.documentElement.classList.add('light');
                    this.updateElement('#themeToggle', '☀️');
                }
            }
            
            // Load conversation
            const savedState = localStorage.getItem('solmate-state');
            if (savedState) {
                const state = JSON.parse(savedState);
                
                if (state.conversation) {
                    this.state.conversation = state.conversation.slice(-this.config.maxConversationSize);
                }
            }
            
            console.log(`Loaded ${this.state.conversation.length} conversation messages`);
        } catch (error) {
            console.error('Failed to load saved state:', error);
        }
    }
    
    getAppState() {
        return {
            initialized: this.state.initialized,
            conversation: this.state.conversation.length,
            avatar: this.state.avatar,
            config: this.config,
            vrmController: this.components.vrmController?.getState?.(),
            audioManager: this.components.audioManager?.getStats?.(),
            timers: Array.from(this.state.timers.keys()),
            wsConnection: this.state.wsConnection?.readyState
        };
    }
    
    // PUBLIC API METHODS FOR DEBUGGING
    
    debugVRM() {
        if (!this.components.vrmController) {
            console.log('❌ VRM Controller not initialized');
            return null;
        }
        
        const state = this.components.vrmController.getState?.();
        console.log('🤖 VRM Debug Report:', state);
        return state;
    }
    
    testChat() {
        return this.sendMessage("Hello Solmate! How are you today?");
    }
    
    testTTS() {
        if (this.components.audioManager) {
            this.components.audioManager.queue("Testing the text to speech system with animations.", 'nova');
            return 'TTS test queued';
        }
        return 'AudioManager not available';
    }
    
    testWave() {
        if (this.components.vrmController && this.state.avatar.ready) {
            this.components.vrmController.playWave?.();
            return 'Wave animation started';
        }
        return 'VRM not ready';
    }
    
    testNod() {
        if (this.components.vrmController && this.state.avatar.ready) {
            this.components.vrmController.playNod?.();
            return 'Nod animation started';
        }
        return 'VRM not ready';
    }
    
    testThink() {
        if (this.components.vrmController && this.state.avatar.ready) {
            this.components.vrmController.playThink?.();
            return 'Think animation started';
        }
        return 'VRM not ready';
    }
    
    testExcited() {
        if (this.components.vrmController && this.state.avatar.ready) {
            this.components.vrmController.playExcited?.();
            return 'Excited animation started';
        }
        return 'VRM not ready';
    }
    
    testExpression(expression = 'happy', intensity = 0.5) {
        if (this.components.vrmController && this.state.avatar.ready) {
            this.components.vrmController.setExpression?.(expression, intensity);
            return `Expression '${expression}' set to ${intensity}`;
        }
        return 'VRM not ready';
    }
    
    testMood(mood = 'happy') {
        if (this.components.vrmController && this.state.avatar.ready) {
            this.components.vrmController.setMood?.(mood);
            return `Mood set to '${mood}'`;
        }
        return 'VRM not ready';
    }
    
    reloadVRM() {
        if (this.components.vrmController) {
            this.components.vrmController.reload?.();
            return 'VRM reload initiated';
        }
        return 'VRM Controller not available';
    }
    
    testPrice() {
        return this.fetchPrice();
    }
    
    testTPS() {
        return this.fetchTPS();
    }
    
    // CLEANUP AND DESTRUCTION
    
    destroy() {
        console.log('🧹 Destroying Solmate app...');
        
        // Stop all timers
        this.state.timers.forEach((timer, name) => this.stopTimer(name));
        
        // Close WebSocket
        if (this.state.wsConnection) {
            this.state.wsConnection.close();
        }
        
        // Destroy components
        if (this.components.vrmController) {
            this.components.vrmController.destroy?.();
        }
        
        if (this.components.audioManager) {
            this.components.audioManager.destroy?.();
        }
        
        // Clear event listeners
        this.removeAllListeners();
        
        // Reset state
        this.state.initialized = false;
        this.state.conversation = [];
        this.state.avatar.ready = false;
        this.state.avatar.isAnimating = false;
        
        this.emit('destroyed');
        console.log('✅ Solmate app destroyed');
    }
}
