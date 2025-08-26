// web/js/SolmateApp.js
// Main application class with event-driven architecture

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
            systemPrompt: `You are Solmate, a helpful and witty Solana Companion. Be helpful and add humor when appropriate. Focus on Solana, crypto, DeFi, NFTs, and web3 topics, but answer any question. Keep responses concise and engaging. Always remind users: Not financial advice.`
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
            
            // Load configuration
            await this.loadConfiguration();
            
            // Initialize components with proper error handling
            try {
                this.components.vrmController = new VRMController();
                console.log('✅ VRMController initialized');
            } catch (error) {
                console.error('Failed to initialize VRMController:', error);
                this.emit('error', { context: 'vrm-init', error });
            }
            
            try {
                this.components.audioManager = new AudioManager();
                console.log('✅ AudioManager initialized');
            } catch (error) {
                console.error('Failed to initialize AudioManager:', error);
                this.emit('error', { context: 'audio-init', error });
            }
            
            // Setup component event listeners only if components exist
            this.setupComponentListeners();
            
            // Initialize UI
            this.initializeUI();
            
            // Start data connections
            await this.initializeDataConnections();
            
            // Load saved state
            this.loadSavedState();
            
            // Initialize VRM only if controller exists
            if (this.components.vrmController) {
                await this.components.vrmController.init();
            }
            
            this.state.initialized = true;
            this.emit('init:complete');
            
            // Welcome message with better timing
            this.scheduleWelcomeMessage();
            
        } catch (error) {
            this.emit('error', { context: 'initialization', error });
            throw error;
        }
    }
    
    async loadConfiguration() {
        try {
            const response = await fetch(this.config.apiEndpoints.config);
            if (!response.ok) {
                throw new Error(`Config loading failed: ${response.status}`);
            }
            
            const serverConfig = await response.json();
            this.config = { ...this.config, ...serverConfig };
            this.emit('config:loaded', this.config);
            console.log('✅ Configuration loaded from server');
            
        } catch (error) {
            console.warn('Using default configuration:', error);
            this.emit('config:default');
        }
    }
    
    setupComponentListeners() {
        // VRM Controller events - check if it has EventEmitter capabilities
        if (this.components.vrmController && typeof this.components.vrmController.on === 'function') {
            this.components.vrmController.on('load:start', () => {
                this.updateLoadingStatus('Loading avatar...');
            });
            
            this.components.vrmController.on('load:complete', (vrm) => {
                this.updateLoadingStatus('');
                this.emit('vrm:loaded', vrm);
                if (typeof this.components.vrmController.getLoadedPath === 'function') {
                    console.log('✅ VRM loaded from:', this.components.vrmController.getLoadedPath());
                }
            });
            
            this.components.vrmController.on('error', (error) => {
                this.emit('error', { context: 'vrm', error });
            });
        } else if (this.components.vrmController) {
            // VRMController exists but doesn't extend EventEmitter
            // Set up alternative event handling or polling if needed
            console.log('✅ VRMController initialized (no EventEmitter support)');
        }
        
        // Audio Manager events - only if component exists and has EventEmitter capabilities
        if (this.components.audioManager && typeof this.components.audioManager.on === 'function') {
            this.components.audioManager.on('play:start', (item) => {
                this.emit('speech:start', item);
                if (this.components.vrmController && 
                    typeof this.components.vrmController.startSpeechAnimation === 'function') {
                    this.components.vrmController.startSpeechAnimation(item.text);
                }
            });
            
            this.components.audioManager.on('play:end', () => {
                this.emit('speech:end');
                if (this.components.vrmController && 
                    typeof this.components.vrmController.stopSpeechAnimation === 'function') {
                    this.components.vrmController.stopSpeechAnimation();
                }
            });
            
            this.components.audioManager.on('error', (error) => {
                this.emit('error', { context: 'audio', error });
            });
        } else if (this.components.audioManager) {
            console.log('✅ AudioManager initialized (no EventEmitter support)');
        }
    }
    
    initializeUI() {
        // Theme toggle
        this.bindElement('#themeToggle', 'click', () => this.toggleTheme());
        
        // Chat form
        this.bindElement('#chatForm', 'submit', (e) => this.handleChatSubmit(e));
        
        // Clear audio
        this.bindElement('#clearBtn', 'click', () => this.components.audioManager.clear());
        
        // Debug toggle
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'd') {
                e.preventDefault();
                this.toggleDebugMode();
            }
        });
        
        // Mouse tracking for animations
        document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        
        // Audio enable on interaction
        ['click', 'keydown'].forEach(event => {
            document.addEventListener(event, () => this.enableAudioContext(), { once: true });
        });
    }
    
    bindElement(selector, event, handler) {
        const element = document.querySelector(selector);
        if (element) {
            element.addEventListener(event, handler.bind(this));
        }
    }
    
    async initializeDataConnections() {
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
    }
    
    connectWebSocket() {
        if (this.state.wsConnection) {
            this.state.wsConnection.close();
        }
        
        try {
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
                this.emit('error', { context: 'websocket', error });
            };
            
        } catch (error) {
            this.emit('error', { context: 'websocket:connect', error });
        }
    }
    
    scheduleWebSocketReconnect() {
        const delay = Math.min(5000 * Math.pow(2, this.state.wsReconnectAttempts), 60000);
        this.state.wsReconnectAttempts++;
        
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
        
        try {
            await this.sendMessage(text);
        } finally {
            this.setButtonState('#sendBtn', false, '▶');
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
                        { role: 'system', content: this.getSystemPrompt() },
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
            
            // Queue audio and trigger animations - with safety checks
            if (this.components.audioManager && 
                typeof this.components.audioManager.queue === 'function') {
                this.components.audioManager.queue(sanitizedContent);
            } else {
                console.warn('AudioManager not available for TTS');
            }
            
            this.emit('message:sent', { user: sanitizedText, assistant: sanitizedContent });
            
        } catch (error) {
            this.emit('error', { context: 'chat', error });
            // Fallback error message with safety check
            const errorMsg = "I'm having trouble processing that. Please try again.";
            if (this.components.audioManager && 
                typeof this.components.audioManager.queue === 'function') {
                this.components.audioManager.queue(errorMsg);
            } else {
                console.warn('Cannot play error message - AudioManager not available');
            }
        }
    }
    
    getSystemPrompt() {
        return this.config.systemPrompt || `You are Solmate, a helpful and witty Solana Companion. Be concise, engaging, and helpful. Focus on Solana, crypto, DeFi, NFTs, and web3 topics, but answer any question. Always remind users: Not financial advice. Keep responses under 150 words.`;
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
    }
    
    toggleDebugMode() {
        this.state.ui.debugMode = !this.state.ui.debugMode;
        const debugOverlay = document.querySelector('#debugOverlay');
        if (debugOverlay) {
            debugOverlay.classList.toggle('hidden');
        }
        this.emit('debug:toggled', this.state.ui.debugMode);
    }
    
    handleMouseMove(event) {
        const mouseX = (event.clientX / window.innerWidth) * 2 - 1;
        const mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
        
        if (this.components.vrmController && 
            typeof this.components.vrmController.updateHeadTarget === 'function') {
            this.components.vrmController.updateHeadTarget(mouseX * 0.1, mouseY * 0.1);
        }
    }
    
    enableAudioContext() {
        this.components.audioManager.enableContext();
    }
    
    scheduleWelcomeMessage() {
        setTimeout(() => {
            // Ensure AudioManager is properly initialized before calling queue
            if (this.components.audioManager && 
                typeof this.components.audioManager.queue === 'function') {
                this.components.audioManager.queue("Hello! I'm Solmate, your Solana companion. Ask me anything!");
            } else {
                console.warn('AudioManager not ready for welcome message');
            }
            
            // Ensure VRMController is ready before calling playWave
            setTimeout(() => {
                if (this.components.vrmController && 
                    typeof this.components.vrmController.playWave === 'function') {
                    this.components.vrmController.playWave();
                } else {
                    console.warn('VRMController.playWave not available');
                }
            }, 1000);
        }, 2000);
    }
    
    // Utility methods
    updateElement(selector, content, styles = {}) {
        const element = document.querySelector(selector);
        if (element) {
            if (content !== undefined) element.textContent = content;
            Object.assign(element.style, styles);
        }
    }
    
    updateLoadingStatus(message) {
        this.updateElement('#loadingStatus span', message);
        const loadingEl = document.querySelector('#loadingStatus');
        if (!message && loadingEl) {
            setTimeout(() => {
                loadingEl.style.display = 'none';
            }, 500);
        }
    }
    
    setButtonState(selector, disabled, text) {
        const button = document.querySelector(selector);
        if (button) {
            button.disabled = disabled;
            if (text) button.innerHTML = `<span aria-hidden="true">${text}</span>`;
        }
    }
    
    showError(message) {
        const container = document.querySelector('#errorContainer');
        if (!container) return;
        
        const errorEl = document.createElement('div');
        errorEl.className = 'error-message';
        errorEl.textContent = message;
        container.appendChild(errorEl);
        
        setTimeout(() => errorEl.remove(), 5000);
        this.emit('error:shown', message);
    }
    
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
    
    saveState() {
        try {
            localStorage.setItem('solmateState', JSON.stringify({
                conversation: this.state.conversation,
                theme: this.state.ui.theme
            }));
        } catch (error) {
            console.error('Failed to save state:', error);
        }
    }
    
    loadSavedState() {
        try {
            const saved = localStorage.getItem('solmateState');
            if (saved) {
                const state = JSON.parse(saved);
                
                if (state.conversation) {
                    this.state.conversation = state.conversation.slice(-this.config.maxConversationSize);
                }
                
                if (state.theme) {
                    this.state.ui.theme = state.theme;
                    if (state.theme === 'light') {
                        document.documentElement.classList.add('light');
                        this.updateElement('#themeToggle', '☀️');
                    }
                }
            }
        } catch (error) {
            console.error('Failed to load saved state:', error);
        }
    }
    
    // Debug methods
    getAppState() {
        return {
            initialized: this.state.initialized,
            conversationLength: this.state.conversation.length,
            vrmLoaded: this.components.vrmController && 
                      typeof this.components.vrmController.isLoaded === 'function' ? 
                      this.components.vrmController.isLoaded() : 'unknown',
            audioQueueLength: this.components.audioManager && 
                            typeof this.components.audioManager.getQueueLength === 'function' ? 
                            this.components.audioManager.getQueueLength() : 'unknown',
            wsConnected: this.state.wsConnection?.readyState === WebSocket.OPEN,
            timersActive: this.state.timers.size,
            componentsStatus: {
                vrmController: {
                    exists: !!this.components.vrmController,
                    hasEventEmitter: !!(this.components.vrmController && 
                                      typeof this.components.vrmController.on === 'function'),
                    methods: this.components.vrmController ? Object.getOwnPropertyNames(Object.getPrototypeOf(this.components.vrmController)) : []
                },
                audioManager: {
                    exists: !!this.components.audioManager,
                    hasEventEmitter: !!(this.components.audioManager && 
                                      typeof this.components.audioManager.on === 'function'),
                    methods: this.components.audioManager ? Object.getOwnPropertyNames(Object.getPrototypeOf(this.components.audioManager)) : []
                }
            },
            config: this.config
        };
    }
    
    // Test methods
    testChat() {
        return this.sendMessage("Hello! How are you today?");
    }
    
    testTTS() {
        if (this.components.audioManager && 
            typeof this.components.audioManager.queue === 'function') {
            this.components.audioManager.queue("Testing the text to speech system with Solmate!");
        } else {
            console.warn('AudioManager.queue not available');
        }
    }
    
    testWave() {
        if (this.components.vrmController && 
            typeof this.components.vrmController.playWave === 'function') {
            this.components.vrmController.playWave();
        } else {
            console.warn('VRMController.playWave not available');
        }
    }
    
    testNod() {
        if (this.components.vrmController && 
            typeof this.components.vrmController.playNod === 'function') {
            this.components.vrmController.playNod();
        } else {
            console.warn('VRMController.playNod not available');
        }
    }
    
    testThink() {
        if (this.components.vrmController && 
            typeof this.components.vrmController.playThink === 'function') {
            this.components.vrmController.playThink();
        } else {
            console.warn('VRMController.playThink not available');
        }
    }
    
    testExcited() {
        if (this.components.vrmController && 
            typeof this.components.vrmController.playExcited === 'function') {
            this.components.vrmController.playExcited();
        } else {
            console.warn('VRMController.playExcited not available');
        }
    }
    
    testExpression(name = 'happy', intensity = 0.8) {
        if (this.components.vrmController && 
            typeof this.components.vrmController.setExpression === 'function') {
            this.components.vrmController.setExpression(name, intensity);
        } else {
            console.warn('VRMController.setExpression not available');
        }
    }
    
    testMood(mood = 'happy') {
        if (this.components.vrmController && 
            typeof this.components.vrmController.setMood === 'function') {
            this.components.vrmController.setMood(mood);
        } else {
            console.warn('VRMController.setMood not available');
        }
    }
    
    reloadVRM() {
        if (this.components.vrmController && 
            typeof this.components.vrmController.reload === 'function') {
            return this.components.vrmController.reload();
        } else {
            console.warn('VRMController.reload not available');
            return 'VRMController.reload not available';
        }
    }
    
    destroy() {
        // Stop all timers
        this.state.timers.forEach((timer, name) => this.stopTimer(name));
        
        // Close WebSocket
        if (this.state.wsConnection) {
            this.state.wsConnection.close();
        }
        
        // Destroy components
        this.components.vrmController?.destroy();
        this.components.audioManager?.destroy();
        
        // Clear event listeners
        this.removeAllListeners();
        
        this.emit('destroyed');
    }
}
