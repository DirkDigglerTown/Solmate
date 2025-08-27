// web/js/SolmateApp.js
// Main application class with modular architecture and AIRI-inspired features

import { EventEmitter } from './EventEmitter.js';
import { VRMLoader } from './VRMLoader.js';
import { AudioManager } from './AudioManager.js';

export class SolmateApp extends EventEmitter {
    constructor() {
        super();
        
        console.log('🚀 Initializing Solmate...');
        
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
            systemPrompt: `You are Solmate, a helpful and witty Solana Companion. Be maximally truthful, helpful, and add a touch of humor when appropriate. You're focused on Solana blockchain, crypto, DeFi, NFTs, and web3 topics, but can answer any question. Keep responses concise, engaging, and fun. Always remind users: Not financial advice.`
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
            vrmLoader: null,
            audioManager: null
        };
    }
    
    async init() {
        try {
            this.emit('init:start');
            
            // Load configuration from server
            console.log('📋 Loading configuration...');
            await this.loadConfiguration();
            
            // Initialize AudioManager first (required by other components)
            console.log('🔊 Initializing AudioManager...');
            this.components.audioManager = new AudioManager();
            await this.components.audioManager.init();
            console.log('✅ AudioManager initialized');
            
            // Initialize VRMLoader with AIRI-style animations
            console.log('🎭 Initializing AIRI-style VRM system...');
            this.components.vrmLoader = new VRMLoader();
            await this.components.vrmLoader.init();
            console.log('✅ VRMController initialized');
            
            // Set up component event listeners
            console.log('🔗 Setting up component listeners...');
            this.setupComponentListeners();
            console.log('✅ Component listeners setup complete');
            
            // Initialize UI
            console.log('🎨 Initializing UI...');
            this.initializeUI();
            console.log('✅ UI initialized');
            
            // Start data connections (WebSocket, price updates, etc.)
            console.log('🌐 Initializing data connections...');
            await this.initializeDataConnections();
            console.log('✅ Data connections initialized');
            
            // Load saved state
            this.loadSavedState();
            
            this.state.initialized = true;
            this.emit('init:complete');
            
            console.log('✅ Solmate initialization complete');
            
            // Schedule welcome message
            this.scheduleWelcomeMessage();
            
        } catch (error) {
            console.error('Initialization failed:', error);
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
            
            console.log('✅ Configuration loaded from server');
            this.emit('config:loaded', this.config);
            
        } catch (error) {
            console.warn('Using default configuration:', error);
            this.emit('config:default');
        }
    }
    
    setupComponentListeners() {
        // VRM Loader events
        this.components.vrmLoader.on('load:start', () => {
            this.updateLoadingStatus('Loading avatar...');
        });
        
        this.components.vrmLoader.on('load:complete', (vrm) => {
            this.updateLoadingStatus('');
            this.emit('vrm:loaded', vrm);
        });
        
        this.components.vrmLoader.on('error', (error) => {
            console.error('VRM error:', error);
            this.emit('error', { context: 'vrm', error });
        });
        
        // Audio Manager events
        this.components.audioManager.on('play:start', (item) => {
            this.emit('speech:start', item);
            this.components.vrmLoader.startSpeechAnimation(item.text);
        });
        
        this.components.audioManager.on('play:end', () => {
            this.emit('speech:end');
            this.components.vrmLoader.stopSpeechAnimation();
        });
        
        this.components.audioManager.on('error', (error) => {
            console.error('Audio error:', error);
            this.emit('error', { context: 'audio', error });
        });
        
        // Cross-component communication
        this.on('message:sent', ({ user, assistant }) => {
            // Could trigger additional animations or effects
        });
        
        this.on('price:updated', (price) => {
            // Could trigger price-related animations
        });
        
        this.on('tps:updated', (tps) => {
            // Could trigger network activity animations
        });
    }
    
    initializeUI() {
        // Theme toggle
        this.bindElement('#themeToggle', 'click', () => this.toggleTheme());
        
        // Chat form
        this.bindElement('#chatForm', 'submit', (e) => this.handleChatSubmit(e));
        
        // Clear audio button
        this.bindElement('#clearBtn', 'click', () => {
            this.components.audioManager.clear();
            this.showNotification('Audio stopped', 'info');
        });
        
        // Debug mode toggle
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'd') {
                e.preventDefault();
                this.toggleDebugMode();
            }
        });
        
        // Mouse tracking for head movement
        document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        
        // Audio context enable on first interaction
        ['click', 'keydown', 'touchstart'].forEach(event => {
            document.addEventListener(event, () => {
                this.components.audioManager.enableContext();
            }, { once: true });
        });
        
        // Window resize handler
        window.addEventListener('resize', () => this.handleResize());
        
        // Load saved theme
        const savedTheme = this.loadSetting('theme', 'dark');
        if (savedTheme === 'light') {
            document.documentElement.classList.add('light');
            this.updateElement('#themeToggle', '☀️');
        }
    }
    
    bindElement(selector, event, handler) {
        const element = document.querySelector(selector);
        if (element) {
            element.addEventListener(event, handler.bind(this));
        }
    }
    
    async initializeDataConnections() {
        // Connect WebSocket if available
        if (this.config.wsUrl) {
            console.log('🔗 Connecting WebSocket...');
            this.connectWebSocket();
        }
        
        // Initial data fetch
        await Promise.all([
            this.fetchPrice().catch(e => console.warn('Initial price fetch failed:', e)),
            this.fetchTPS().catch(e => console.warn('Initial TPS fetch failed:', e))
        ]);
        
        // Set up periodic updates
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
                this.updateElement('#wsLight', 'WS ON');
                this.updateElementStyle('#wsLight', { color: '#00ff88' });
                console.log('✅ WebSocket connected');
                this.emit('ws:connected');
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
                this.updateElement('#wsLight', 'WS OFF');
                this.updateElementStyle('#wsLight', { color: '#ff6b6b' });
                this.scheduleWebSocketReconnect();
                this.emit('ws:disconnected');
            };
            
            this.state.wsConnection.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.emit('error', { context: 'websocket', error });
            };
            
        } catch (error) {
            console.error('WebSocket connection failed:', error);
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
            
            if (price && price > 0) {
                this.updateElement('#solPrice', `SOL — $${price.toFixed(2)}`);
                this.updateElementStyle('#solPrice', { color: '#00ff88' });
                this.emit('price:updated', price);
            } else {
                this.updateElement('#solPrice', 'SOL — N/A');
                this.updateElementStyle('#solPrice', { color: '#ff6b6b' });
            }
        } catch (error) {
            console.error('Price fetch failed:', error);
            this.updateElement('#solPrice', 'SOL — Error');
            this.updateElementStyle('#solPrice', { color: '#ff6b6b' });
            this.emit('error', { context: 'price', error });
        }
    }
    
    async fetchTPS() {
        try {
            const response = await fetch(this.config.apiEndpoints.tps);
            if (!response.ok) throw new Error(`TPS fetch failed: ${response.status}`);
            
            const data = await response.json();
            
            if (data.tps) {
                this.updateTPS(data.tps);
            }
        } catch (error) {
            console.error('TPS fetch failed:', error);
            this.updateElement('#networkTPS', 'TPS Error');
            this.updateElementStyle('#networkTPS', { color: '#ff6b6b' });
            this.emit('error', { context: 'tps', error });
        }
    }
    
    updateTPS(tps) {
        this.updateElement('#networkTPS', `${tps} TPS`);
        this.updateElementStyle('#networkTPS', { color: '#00ff88' });
        this.emit('tps:updated', tps);
    }
    
    async handleChatSubmit(event) {
        event.preventDefault();
        
        const input = document.querySelector('#promptInput');
        if (!input) return;
        
        const text = input.value.trim();
        if (!text) return;
        
        // Validate input length
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
        // Add user message to conversation
        this.state.conversation.push({ role: 'user', content: text });
        
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
            
            // Add assistant response to conversation
            this.state.conversation.push({ role: 'assistant', content: sanitizedContent });
            
            // Save conversation state
            this.saveState();
            
            // Queue TTS and trigger animations
            this.components.audioManager.queue(sanitizedContent);
            
            this.emit('message:sent', { user: text, assistant: sanitizedContent });
            
        } catch (error) {
            console.error('Chat failed:', error);
            this.emit('error', { context: 'chat', error });
            
            // Queue error message
            const errorMsg = "I'm having trouble processing that. Please try again.";
            this.components.audioManager.queue(errorMsg);
        }
    }
    
    sanitizeOutput(text) {
        // Basic HTML escaping
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    toggleTheme() {
        const html = document.documentElement;
        const isLight = html.classList.toggle('light');
        
        this.state.ui.theme = isLight ? 'light' : 'dark';
        this.updateElement('#themeToggle', isLight ? '☀️' : '🌙');
        this.saveSetting('theme', this.state.ui.theme);
        this.emit('theme:changed', this.state.ui.theme);
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
        // Update VRM status
        const vrmStatus = document.querySelector('#vrmStatus');
        if (vrmStatus) {
            if (this.components.vrmLoader && this.components.vrmLoader.vrm.current) {
                vrmStatus.textContent = this.components.vrmLoader.vrm.current.isFallback ? 'fallback' : 'loaded';
            } else {
                vrmStatus.textContent = 'not loaded';
            }
        }
        
        // Update cache status
        const cacheStatus = document.querySelector('#cacheStatus');
        if (cacheStatus && 'caches' in window) {
            caches.keys().then(names => {
                cacheStatus.textContent = `${names.length} caches active`;
            }).catch(() => {
                cacheStatus.textContent = 'cache unavailable';
            });
        }
        
        // Update audio stats
        if (this.components.audioManager) {
            const stats = this.components.audioManager.getStats();
            console.log('Audio stats:', stats);
        }
    }
    
    handleMouseMove(event) {
        if (this.components.vrmLoader) {
            const mouseX = (event.clientX / window.innerWidth) * 2 - 1;
            const mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
            
            this.components.vrmLoader.updateHeadTarget(mouseX, mouseY);
        }
    }
    
    handleResize() {
        if (this.components.vrmLoader) {
            this.components.vrmLoader.handleResize();
        }
        this.emit('resize');
    }
    
    scheduleWelcomeMessage() {
        setTimeout(() => {
            this.components.audioManager.queue("Hello! I'm Solmate, your Solana companion. Ask me anything!");
            
            // Schedule wave animation
            setTimeout(() => {
                if (this.components.vrmLoader) {
                    this.components.vrmLoader.playWave();
                }
            }, 1500);
        }, 2000);
    }
    
    // Utility methods
    
    updateElement(selector, content) {
        const element = document.querySelector(selector);
        if (element && content !== undefined) {
            element.textContent = content;
        }
    }
    
    updateElementStyle(selector, styles = {}) {
        const element = document.querySelector(selector);
        if (element) {
            Object.assign(element.style, styles);
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
        }
    }
    
    showError(message) {
        this.showNotification(message, 'error');
    }
    
    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        
        // Style based on type
        const colors = {
            info: { bg: '#4a90e2', fg: '#ffffff' },
            success: { bg: '#00ff88', fg: '#001014' },
            warning: { bg: '#ffaa00', fg: '#001014' },
            error: { bg: '#ff5a7a', fg: '#ffffff' }
        };
        
        const color = colors[type] || colors.info;
        notification.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            padding: 12px 20px;
            bor
