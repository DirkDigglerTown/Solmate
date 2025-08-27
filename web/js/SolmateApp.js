// web/js/SolmateApp.js
// Main application class with event-driven architecture
// USES VRMController consistently (not VRMLoader)

import { EventEmitter } from './EventEmitter.js';
import { VRMController } from './VRMController.js';  // CORRECT: VRMController
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
            },
            userContext: {
                isTyping: false,
                lastInteraction: null,
                relationshipLevel: 'new',
                interactionCount: 0,
                preferences: {},
                conversationTone: 'friendly',
                topics: [],
                mood: 'neutral'
            }
        };
        
        this.components = {
            vrmController: null,  // CORRECT: vrmController
            audioManager: null
        };
    }
    
    async init() {
        try {
            this.emit('init:start');
            
            // Load configuration
            await this.loadConfiguration();
            
            // Initialize components PROPERLY
            this.components.vrmController = new VRMController();
            this.components.audioManager = new AudioManager();
            
            // CRITICAL FIX: Initialize AudioManager properly
            await this.components.audioManager.init();
            
            // Setup component event listeners
            this.setupComponentListeners();
            
            // Initialize UI
            this.initializeUI();
            
            // Start data connections
            await this.initializeDataConnections();
            
            // Load saved state
            this.loadSavedState();
            
            // Initialize VRM Controller
            await this.components.vrmController.init();
            
            this.state.initialized = true;
            this.emit('init:complete');
            
            // Welcome message - with safety check
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
            
        } catch (error) {
            console.warn('Using default configuration:', error);
            this.emit('config:default');
        }
    }
    
    setupComponentListeners() {
        // VRM Controller events (CORRECTED)
        this.components.vrmController.on('load:start', () => {
            this.updateLoadingStatus('Loading avatar...');
        });
        
        this.components.vrmController.on('load:complete', (vrm) => {
            this.updateLoadingStatus('');
            this.emit('vrm:loaded', vrm);
        });
        
        this.components.vrmController.on('error', (error) => {
            this.emit('error', { context: 'vrm', error });
        });
        
        // Audio Manager events
        this.components.audioManager.on('play:start', (item) => {
            this.emit('speech:start', item);
            this.components.vrmController.startSpeechAnimation(item.text);  // CORRECT
        });
        
        this.components.audioManager.on('play:end', () => {
            this.emit('speech:end');
            this.components.vrmController.stopSpeechAnimation();  // CORRECT
        });
        
        this.components.audioManager.on('error', (error) => {
            this.emit('error', { context: 'audio', error });
        });
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
        
        // Update user context
        this.state.userContext.isTyping = false;
        this.state.userContext.lastInteraction = Date.now();
        this.state.userContext.interactionCount++;
        
        // React to user input (if VRM is ready)
        if (this.components.vrmController && this.components.vrmController.state.loaded) {
            this.components.vrmController.reactToUserInput?.();
        }
        
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
            
            // Queue audio and trigger animations
            this.components.audioManager.queue(sanitizedContent);
            
            // Update user relationship based on conversation
            this.updateUserRelationship(sanitizedText, sanitizedContent);
            
            this.emit('message:sent', { user: sanitizedText, assistant: sanitizedContent });
            
        } catch (error) {
            this.emit('error', { context: 'chat', error });
            const errorResponse = "I'm having trouble processing that. Please try again.";
            this.components.audioManager.queue(errorResponse);
        }
    }
    
    getSystemPrompt() {
        const basePrompt = `You are Solmate, a helpful and witty Solana Companion. Be concise, engaging, and helpful. Focus on Solana, crypto, DeFi, NFTs, and web3 topics, but answer any question. Always remind users: Not financial advice. Keep responses under 150 words.`;
        
        // Add context based on user relationship
        const relationshipContext = this.getUserRelationshipContext();
        
        return basePrompt + relationshipContext;
    }
    
    getUserRelationshipContext() {
        const { relationshipLevel, interactionCount, conversationTone } = this.state.userContext;
        
        if (relationshipLevel === 'new' && interactionCount === 0) {
            return ' This is your first interaction with this user - be welcoming and introduce yourself naturally.';
        } else if (relationshipLevel === 'familiar' && interactionCount > 5) {
            return ` You have chatted ${interactionCount} times with this user. Be friendly and reference shared context when appropriate.`;
        } else if (relationshipLevel === 'close' && interactionCount > 20) {
            return ` You are close friends with this user (${interactionCount} interactions). Be warm, personal, and remember their preferences.`;
        }
        
        return '';
    }
    
    updateUserRelationship(userMessage, botResponse) {
        const ctx = this.state.userContext;
        
        // Update relationship level based on interaction count
        if (ctx.interactionCount > 20) {
            ctx.relationshipLevel = 'close';
        } else if (ctx.interactionCount > 5) {
            ctx.relationshipLevel = 'familiar';
        } else {
            ctx.relationshipLevel = 'new';
        }
        
        // Analyze conversation tone
        const userLower = userMessage.toLowerCase();
        if (userLower.includes('thank') || userLower.includes('awesome') || userLower.includes('great')) {
            ctx.mood = 'positive';
        } else if (userLower.includes('help') || userLower.includes('problem') || userLower.includes('issue')) {
            ctx.mood = 'helpful';
        }
        
        // Extract topics
        const solanaKeywords = ['solana', 'sol', 'defi', 'nft', 'crypto', 'blockchain', 'token'];
        const foundKeywords = solanaKeywords.filter(keyword => userLower.includes(keyword));
        if (foundKeywords.length > 0) {
            ctx.topics = [...new Set([...ctx.topics, ...foundKeywords])].slice(-10); // Keep last 10 topics
        }
        
        this.saveState();
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
        if (!this.components.vrmController) return;
        
        const mouseX = (event.clientX / window.innerWidth) * 2 - 1;
        const mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
        
        this.components.vrmController.updateHeadTarget(mouseX * 0.1, mouseY * 0.1);  // CORRECT
    }
    
    enableAudioContext() {
        this.components.audioManager.enableContext();
    }
    
    scheduleWelcomeMessage() {
        setTimeout(() => {
            // Queue the welcome message - will play after user interaction due to Chrome autoplay policy
            if (this.components.audioManager && typeof this.components.audioManager.queue === 'function') {
                this.components.audioManager.queue("Hello! I'm Solmate, your Solana companion. Ask me anything!");
                console.log('🎙️ Welcome message queued (waiting for user click to play audio)');
                
                // Show notification to user about clicking for audio
                const notification = document.createElement('div');
                notification.style.cssText = `
                    position: fixed;
                    top: 80px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: linear-gradient(135deg, #00f0ff, #00ff88);
                    color: #001014;
                    padding: 12px 24px;
                    border-radius: 8px;
                    font-weight: 600;
                    cursor: pointer;
                    z-index: 10000;
                    animation: pulse 2s infinite;
                `;
                notification.textContent = '🔊 Click anywhere to enable audio';
                document.body.appendChild(notification);
                
                // Remove notification on click
                const removeNotification = () => {
                    notification.remove();
                    document.removeEventListener('click', removeNotification);
                };
                document.addEventListener('click', removeNotification);
                
                // Auto-remove after 10 seconds
                setTimeout(() => notification.remove(), 10000);
            }
            
            // Wave animation can play immediately
            setTimeout(() => {
                if (this.components.vrmController && typeof this.components.vrmController.playWave === 'function') {
                    this.components.vrmController.playWave();
                }
            }, 1000);
        }, 2000);
    }
    
    handleOnlineStatus(isOnline) {
        if (isOnline) {
            document.body.classList.remove('offline');
            // Reconnect WebSocket if needed
            if (!this.state.wsConnection || this.state.wsConnection.readyState !== WebSocket.OPEN) {
                this.connectWebSocket();
            }
        } else {
            document.body.classList.add('offline');
        }
        
        this.emit('online:changed', isOnline);
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
                theme: this.state.ui.theme,
                userContext: this.state.userContext
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
                
                if (state.userContext) {
                    this.state.userContext = { ...this.state.userContext, ...state.userContext };
                }
            }
        } catch (error) {
            console.error('Failed to load saved state:', error);
        }
    }
    
    getAppStats() {
        return {
            initialized: this.state.initialized,
            conversationLength: this.state.conversation.length,
            userInteractions: this.state.userContext.interactionCount,
            relationshipLevel: this.state.userContext.relationshipLevel,
            vrmStats: this.components.vrmController?.getStats() || null,  // CORRECT
            audioStats: this.components.audioManager?.getStats() || null,
            wsConnected: this.state.wsConnection?.readyState === WebSocket.OPEN,
            activeTimers: this.state.timers.size,
            theme: this.state.ui.theme
        };
    }
    
    destroy() {
        // Stop all timers
        this.state.timers.forEach((timer, name) => this.stopTimer(name));
        
        // Close WebSocket
        if (this.state.wsConnection) {
            this.state.wsConnection.close();
        }
        
        // Destroy components
        this.components.vrmController?.destroy();  // CORRECT
        this.components.audioManager?.destroy();
        
        // Clear event listeners
        this.removeAllListeners();
        
        this.emit('destroyed');
        console.log('🧹 SolmateApp destroyed and cleaned up');
    }
}
