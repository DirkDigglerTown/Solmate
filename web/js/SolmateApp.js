// web/js/SolmateApp.js
// Updated to use VRMController instead of VRMLoader

import { EventEmitter } from './EventEmitter.js';
import { VRMController } from './VRMController.js';  // Changed from VRMLoader
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
            }
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
            vrmController: null,  // Changed from vrmLoader
            audioManager: null
        };
    }
    
    async init() {
        try {
            this.emit('init:start');
            
            // Load configuration
            await this.loadConfiguration();
            
            // Initialize components
            await this.initializeVRM();  // Updated method
            this.components.audioManager = new AudioManager();
            
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
            
            // Welcome message with proper animation
            this.scheduleWelcomeMessage();
            
        } catch (error) {
            this.emit('error', { context: 'initialization', error });
            throw error;
        }
    }
    
    async initializeVRM() {
        try {
            // Get canvas element
            const canvas = document.getElementById('vrmCanvas');
            if (!canvas) {
                throw new Error('Canvas element not found');
            }
            
            // Create and initialize VRM controller
            this.components.vrmController = new VRMController(canvas);
            await this.components.vrmController.init();
            
            // Load VRM model
            const vrmPaths = [
                '/assets/avatar/solmate.vrm',
                'https://raw.githubusercontent.com/DirkDigglerTown/solmate/main/web/assets/avatar/solmate.vrm'
            ];
            
            let loaded = false;
            for (const path of vrmPaths) {
                try {
                    await this.components.vrmController.loadVRM(path);
                    loaded = true;
                    console.log('✅ VRM loaded from:', path);
                    break;
                } catch (error) {
                    console.warn('Failed to load VRM from:', path, error);
                }
            }
            
            if (!loaded) {
                console.error('Failed to load VRM from all sources');
                this.emit('error', { context: 'vrm', error: new Error('VRM load failed') });
            }
            
        } catch (error) {
            console.error('VRM initialization failed:', error);
            this.emit('error', { context: 'vrm:init', error });
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
            
        } catch (error) {
            console.warn('Using default configuration:', error);
            this.emit('config:default');
        }
    }
    
    setupComponentListeners() {
        // Audio Manager events
        this.components.audioManager.on('play:start', (item) => {
            this.emit('speech:start', item);
            // Use new VRM controller to start speaking animation
            if (this.components.vrmController) {
                const sentiment = this.analyzeSentiment(item.text);
                this.components.vrmController.startSpeaking(item.text, sentiment);
            }
        });
        
        this.components.audioManager.on('play:end', () => {
            this.emit('speech:end');
            // Stop speaking animation
            if (this.components.vrmController) {
                this.components.vrmController.stopSpeaking();
            }
        });
        
        this.components.audioManager.on('error', (error) => {
            this.emit('error', { context: 'audio', error });
        });
    }
    
    analyzeSentiment(text) {
        const lower = text.toLowerCase();
        
        // Analyze sentiment for emotion
        if (lower.includes('happy') || lower.includes('great') || lower.includes('awesome') || lower.includes('good')) {
            return 'positive';
        } else if (lower.includes('sorry') || lower.includes('unfortunately') || lower.includes('bad')) {
            return 'negative';
        } else if (lower.includes('wow') || lower.includes('amazing') || lower.includes('!')) {
            return 'excited';
        } else if (lower.includes('hmm') || lower.includes('maybe') || lower.includes('?')) {
            return 'confused';
        } else if (lower.includes('think') || lower.includes('consider') || lower.includes('perhaps')) {
            return 'thoughtful';
        }
        
        return 'neutral';
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
        
        // Mouse tracking for VRM look-at
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
        
        // React to user input with VRM
        if (this.components.vrmController) {
            this.components.vrmController.nod();  // Acknowledge input
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
            
            // Analyze sentiment and update VRM mood
            const sentiment = this.analyzeSentiment(sanitizedContent);
            if (this.components.vrmController) {
                this.components.vrmController.setMood(sentiment);
            }
            
            // Queue audio and trigger animations
            this.components.audioManager.queue(sanitizedContent);
            
            this.emit('message:sent', { user: sanitizedText, assistant: sanitizedContent });
            
        } catch (error) {
            this.emit('error', { context: 'chat', error });
            
            // Show confused expression on error
            if (this.components.vrmController) {
                this.components.vrmController.setMood('confused');
            }
            
            this.components.audioManager.queue("I'm having trouble processing that. Please try again.");
        }
    }
    
    getSystemPrompt() {
        return `You are Solmate, a helpful and witty Solana Companion. Be concise, engaging, and helpful. Focus on Solana, crypto, DeFi, NFTs, and web3 topics, but answer any question. Always remind users: Not financial advice. Keep responses under 150 words.`;
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
        // Update VRM look-at target based on mouse position
        if (this.components.vrmController) {
            const mouseX = (event.clientX / window.innerWidth) * 2 - 1;
            const mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
            
            // Create a target position for the VRM to look at
            const target = new THREE.Vector3(mouseX * 2, mouseY * 2, 5);
            this.components.vrmController.lookAt(target);
        }
    }
    
    enableAudioContext() {
        this.components.audioManager.enableContext();
    }
    
    scheduleWelcomeMessage() {
        setTimeout(() => {
            // Play welcome animation sequence
            if (this.components.vrmController) {
                this.components.vrmController.wave();
                this.components.vrmController.setMood('happy');
            }
            
            // Queue welcome audio
            this.components.audioManager.queue("Hello! I'm Solmate, your Solana companion. Ask me anything!");
            
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
        this.updateElement('#loadingStatus', message);
        if (!message) {
            setTimeout(() => {
                const element = document.querySelector('#loadingScreen');
                if (element) element.style.display = 'none';
            }, 500);
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
    
    destroy() {
        // Stop all timers
        this.state.timers.forEach((timer, name) => this.stopTimer(name));
        
        // Close WebSocket
        if (this.state.wsConnection) {
            this.state.wsConnection.close();
        }
        
        // Destroy components
        if (this.components.vrmController) {
            this.components.vrmController.dispose();
        }
        this.components.audioManager?.destroy();
        
        // Clear event listeners
        this.removeAllListeners();
        
        this.emit('destroyed');
    }
}
