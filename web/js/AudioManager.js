// web/js/SolmateApp.js
// Enhanced application with natural reactions, conversation memory, and user input detection

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
            // Enhanced conversation state
            userContext: {
                isTyping: false,
                lastInteraction: 0,
                interactionCount: 0,
                favoriteTopics: new Set(),
                recentEmotions: [],
                relationshipLevel: 'new' // new, familiar, friendly, close
            }
        };
        
        this.components = {
            vrmController: null,
            audioManager: null
        };
        
        // Real-time user input detection
        this.inputDetection = {
            typingTimer: null,
            focusTimer: null,
            lastInputTime: 0,
            currentInputValue: '',
            inputElement: null
        };
    }
    
    async init() {
        try {
            this.emit('init:start');
            console.log('🚀 Initializing Enhanced Solmate with AIRI-inspired features...');
            
            // Load configuration
            await this.loadConfiguration();
            
            // Initialize components
            this.components.vrmController = new VRMController();
            this.components.audioManager = new AudioManager();
            
            // Setup component event listeners
            this.setupComponentListeners();
            
            // Initialize UI with enhanced features
            this.initializeUI();
            
            // Start data connections
            await this.initializeDataConnections();
            
            // Load saved state and user context
            this.loadSavedState();
            
            // Initialize VRM
            await this.components.vrmController.init();
            
            // Setup enhanced user input detection
            this.setupInputDetection();
            
            this.state.initialized = true;
            this.emit('init:complete');
            
            // Enhanced welcome message based on relationship level
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
        // VRM Controller events
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
        
        // Audio Manager events with enhanced reactions
        this.components.audioManager.on('play:start', (item) => {
            this.emit('speech:start', item);
            
            // Enhanced speech animation with sentiment
            this.components.vrmController.startSpeechAnimation(item.text, item.sentiment);
            
            // Update relationship context
            this.updateUserContext('speech_start', item);
        });
        
        this.components.audioManager.on('play:end', () => {
            this.emit('speech:end');
            this.components.vrmController.stopSpeechAnimation();
            
            // Trigger natural post-speech reactions
            this.triggerPostSpeechReaction();
        });
        
        this.components.audioManager.on('error', (error) => {
            this.emit('error', { context: 'audio', error });
        });
        
        // VRM animation events
        this.components.vrmController.on('animation:start', (animationName) => {
            console.log(`🎭 Animation started: ${animationName}`);
        });
        
        this.components.vrmController.on('expression:changed', (expression, intensity) => {
            console.log(`😊 Expression: ${expression} (${intensity})`);
        });
    }
    
    initializeUI() {
        // Theme toggle
        this.bindElement('#themeToggle', 'click', () => this.toggleTheme());
        
        // Enhanced chat form with real-time detection
        this.bindElement('#chatForm', 'submit', (e) => this.handleChatSubmit(e));
        
        // Clear audio
        this.bindElement('#clearBtn', 'click', () => {
            this.components.audioManager.clear();
            this.components.vrmController.stopAnimation();
            
            // React to interruption
            setTimeout(() => {
                this.components.vrmController.setExpression('neutral', 0.2);
            }, 500);
        });
        
        // Debug toggle
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'd') {
                e.preventDefault();
                this.toggleDebugMode();
            }
        });
        
        // Enhanced mouse tracking for natural head movement
        document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        
        // Audio enable on interaction
        ['click', 'keydown'].forEach(event => {
            document.addEventListener(event, () => this.enableAudioContext(), { once: true });
        });
        
        // Window focus/blur detection for attention system
        window.addEventListener('focus', () => this.handleWindowFocus(true));
        window.addEventListener('blur', () => this.handleWindowFocus(false));
    }
    
    // Enhanced input detection system
    setupInputDetection() {
        this.inputDetection.inputElement = document.querySelector('#promptInput');
        if (!this.inputDetection.inputElement) return;
        
        const input = this.inputDetection.inputElement;
        
        // Real-time typing detection
        input.addEventListener('input', (e) => this.handleTyping(e));
        input.addEventListener('focus', () => this.handleInputFocus());
        input.addEventListener('blur', () => this.handleInputBlur());
        
        // Preview user input for reactions
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                this.handleInputSubmit();
            } else {
                this.previewUserInput(input.value);
            }
        });
        
        console.log('👀 Enhanced input detection system active');
    }
    
    handleTyping(e) {
        const input = e.target;
        this.state.userContext.isTyping = true;
        this.inputDetection.lastInputTime = Date.now();
        this.inputDetection.currentInputValue = input.value;
        
        // Clear existing typing timer
        if (this.inputDetection.typingTimer) {
            clearTimeout(this.inputDetection.typingTimer);
        }
        
        // React to typing start
        if (input.value.length === 1) {
            this.components.vrmController.startListening();
        }
        
        // Set timer to detect typing stop
        this.inputDetection.typingTimer = setTimeout(() => {
            this.state.userContext.isTyping = false;
            this.components.vrmController.stopAnimation();
        }, 1500);
        
        // Preview reactions to input content
        if (input.value.length > 10) {
            this.previewUserInput(input.value);
        }
    }
    
    handleInputFocus() {
        this.components.vrmController.setExpression('happy', 0.15);
        this.components.vrmController.startListening();
        
        console.log('👀 User focused on input');
    }
    
    handleInputBlur() {
        if (!this.state.userContext.isTyping) {
            this.components.vrmController.setExpression('neutral', 0);
            this.components.vrmController.stopAnimation();
        }
    }
    
    handleInputSubmit() {
        this.state.userContext.isTyping = false;
        this.components.vrmController.setExpression('happy', 0.3, 1000);
    }
    
    // Preview user input for anticipatory reactions
    previewUserInput(text) {
        if (!text || text.length < 5) return;
        
        const lowerText = text.toLowerCase();
        
        // React to emotional words being typed
        if (lowerText.includes('sad') || lowerText.includes('bad')) {
            this.components.vrmController.setExpression('sad', 0.2, 2000);
        } else if (lowerText.includes('happy') || lowerText.includes('great')) {
            this.components.vrmController.setExpression('happy', 0.3, 2000);
        } else if (lowerText.includes('?')) {
            this.components.vrmController.setExpression('surprised', 0.2, 2000);
        } else if (lowerText.includes('solana') || lowerText.includes('crypto')) {
            this.components.vrmController.setExpression('happy', 0.4, 3000);
            // Special Solana enthusiasm reaction
            setTimeout(() => {
                this.components.vrmController.performCoinFlipGesture?.();
            }, 1000);
        }
    }
    
    handleWindowFocus(focused) {
        if (focused) {
            // User returned - subtle acknowledgment
            setTimeout(() => {
                this.components.vrmController.performSubtleSmile();
            }, 500);
        } else {
            // User left - neutral expression
            this.components.vrmController.setExpression('neutral', 0);
        }
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
        this.updateUserContext('message_sent', { text });
        
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
            // Enhanced system prompt with user context
            const systemPrompt = this.getEnhancedSystemPrompt();
            
            const response = await fetch(this.config.apiEndpoints.chat, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [
                        { role: 'system', content: systemPrompt },
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
            
            // Enhanced audio queueing with sentiment
            this.components.audioManager.queue(sanitizedContent);
            
            // Update user context with response
            this.updateUserContext('response_received', { content: sanitizedContent });
            
            this.emit('message:sent', { user: sanitizedText, assistant: sanitizedContent });
            
        } catch (error) {
            this.emit('error', { context: 'chat', error });
            
            // Enhanced error response with appropriate expression
            this.components.vrmController.setExpression('sad', 0.3, 3000);
            this.components.audioManager.queue("I'm having trouble processing that. Please try again!");
        }
    }
    
    // Enhanced system prompt with user context
    getEnhancedSystemPrompt() {
        const basePrompt = `You are Solmate, a helpful and witty Solana Companion. Be concise, engaging, and helpful. Focus on Solana, crypto, DeFi, NFTs, and web3 topics, but answer any question. Always remind users: Not financial advice. Keep responses under 150 words.`;
        
        const contextPrompt = this.buildContextPrompt();
        
        return `${basePrompt}${contextPrompt}`;
    }
    
    buildContextPrompt() {
        const ctx = this.state.userContext;
        let contextPrompt = '';
        
        // Relationship level context
        switch (ctx.relationshipLevel) {
            case 'new':
                contextPrompt += ' This is a new user, be welcoming and introduce yourself warmly.';
                break;
            case 'familiar':
                contextPrompt += ' This user has chatted before, be friendly and reference previous conversations naturally.';
                break;
            case 'friendly':
                contextPrompt += ' You have a good relationship with this user, be more casual and playful.';
                break;
            case 'close':
                contextPrompt += ' This is a close companion relationship, be warm, caring, and personable.';
                break;
        }
        
        // Recent emotional context
        if (ctx.recentEmotions.length > 0) {
            const lastEmotion = ctx.recentEmotions[ctx.recentEmotions.length - 1];
            contextPrompt += ` The user's recent emotional state has been ${lastEmotion}, respond appropriately.`;
        }
        
        // Favorite topics
        if (ctx.favoriteTopics.size > 0) {
            const topics = Array.from(ctx.favoriteTopics).slice(-3).join(', ');
            contextPrompt += ` The user has shown interest in: ${topics}.`;
        }
        
        return contextPrompt;
    }
    
    // User context management
    updateUserContext(action, data = {}) {
        const ctx = this.state.userContext;
        
        switch (action) {
            case 'message_sent':
                ctx.lastInteraction = Date.now();
                ctx.interactionCount++;
                
                // Update relationship level based on interactions
                if (ctx.interactionCount > 10 && ctx.relationshipLevel === 'new') {
                    ctx.relationshipLevel = 'familiar';
                } else if (ctx.interactionCount > 25 && ctx.relationshipLevel === 'familiar') {
                    ctx.relationshipLevel = 'friendly';
                } else if (ctx.interactionCount > 50 && ctx.relationshipLevel === 'friendly') {
                    ctx.relationshipLevel = 'close';
                }
                
                // Extract topics from user message
                this.extractTopics(data.text);
                break;
                
            case 'response_received':
                this.extractEmotionFromResponse(data.content);
                break;
                
            case 'speech_start':
                if (data.sentiment && data.sentiment !== 'neutral') {
                    ctx.recentEmotions.push(data.sentiment);
                    if (ctx.recentEmotions.length > 5) {
                        ctx.recentEmotions.shift();
                    }
                }
                break;
        }
        
        console.log(`👤 User context updated: ${ctx.relationshipLevel} (${ctx.interactionCount} interactions)`);
    }
    
    extractTopics(text) {
        const topics = ['solana', 'crypto', 'blockchain', 'defi', 'nft', 'programming', 'art', 'music', 'gaming'];
        const lowerText = text.toLowerCase();
        
        topics.forEach(topic => {
            if (lowerText.includes(topic)) {
                this.state.userContext.favoriteTopics.add(topic);
            }
        });
    }
    
    extractEmotionFromResponse(text) {
        // Simple emotion extraction from response
        const lowerText = text.toLowerCase();
        
        if (lowerText.includes('sorry') || lowerText.includes('unfortunately')) {
            this.state.userContext.recentEmotions.push('apologetic');
        } else if (lowerText.includes('exciting') || lowerText.includes('amazing')) {
            this.state.userContext.recentEmotions.push('enthusiastic');
        }
    }
    
    // Post-speech natural reactions
    triggerPostSpeechReaction() {
        const reactions = [
            () => {
                // Subtle smile after speaking
                setTimeout(() => {
                    this.components.vrmController.setExpression('happy', 0.15, 2000);
                }, 500);
            },
            () => {
                // Head tilt (curious/attentive)
                setTimeout(() => {
                    this.components.vrmController.performHeadTilt();
                }, 800);
            },
            () => {
                // Blink and subtle expression
                setTimeout(() => {
                    this.components.vrmController.performBlink();
                    setTimeout(() => {
                        this.components.vrmController.setExpression('happy', 0.1, 1500);
                    }, 200);
                }, 300);
            },
            () => {
                // Just return to neutral naturally
                setTimeout(() => {
                    this.components.vrmController.setExpression('neutral', 0);
                }, 1000);
            }
        ];
        
        // Randomly choose a reaction
        const reaction = reactions[Math.floor(Math.random() * reactions.length)];
        reaction();
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
        
        // Avatar reacts to theme change
        setTimeout(() => {
            this.components.vrmController.performWink();
        }, 500);
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
        
        // Enhanced head tracking with natural limits
        this.components.vrmController.updateHeadTarget(mouseX * 0.08, mouseY * 0.08);
    }
    
    enableAudioContext() {
        this.components.audioManager.enableContext();
    }
    
    // Enhanced welcome message based on user relationship
    scheduleWelcomeMessage() {
        setTimeout(() => {
            const ctx = this.state.userContext;
            let welcomeMessage;
            
            switch (ctx.relationshipLevel) {
                case 'familiar':
                    welcomeMessage = "Welcome back! I'm excited to continue our conversations!";
                    break;
                case 'friendly':
                    welcomeMessage = "Hey there! Great to see you again. What's on your mind today?";
                    break;
                case 'close':
                    welcomeMessage = "Hi there! I've missed our chats. How have you been?";
                    break;
                default:
                    welcomeMessage = "Hello! I'm Solmate, your Solana companion. Ask me anything about crypto, DeFi, or just chat!";
            }
            
            this.components.audioManager.queue(welcomeMessage);
            
            // Trigger wave after audio starts
            setTimeout(() => {
                this.components.vrmController.playWave();
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
        const statusEl = document.getElementById('loadingStatus');
        if (statusEl) {
            if (message) {
                statusEl.style.display = 'block';
                statusEl.textContent = message;
            } else {
                setTimeout(() => {
                    statusEl.style.display = 'none';
                }, 500);
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
            const stateToSave = {
                conversation: this.state.conversation,
                theme: this.state.ui.theme,
                userContext: {
                    interactionCount: this.state.userContext.interactionCount,
                    relationshipLevel: this.state.userContext.relationshipLevel,
                    favoriteTopics: Array.from(this.state.userContext.favoriteTopics),
                    recentEmotions: this.state.userContext.recentEmotions
                }
            };
            
            localStorage.setItem('solmateState', JSON.stringify(stateToSave));
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
                
                // Load user context
                if (state.userContext) {
                    const ctx = state.userContext;
                    this.state.userContext.interactionCount = ctx.interactionCount || 0;
                    this.state.userContext.relationshipLevel = ctx.relationshipLevel || 'new';
                    this.state.userContext.favoriteTopics = new Set(ctx.favoriteTopics || []);
                    this.state.userContext.recentEmotions = ctx.recentEmotions || [];
                }
                
                console.log(`👤 Loaded user context: ${this.state.userContext.relationshipLevel} relationship, ${this.state.userContext.interactionCount} interactions`);
            }
        } catch (error) {
            console.error('Failed to load saved state:', error);
        }
    }
    
    // Debug methods
    getUserContext() {
        return this.state.userContext;
    }
    
    getAppStats() {
        return {
            initialized: this.state.initialized,
            conversationLength: this.state.conversation.length,
            userContext: this.state.userContext,
            audioStats: this.components.audioManager?.getStats(),
            vrmStats: this.components.vrmController?.getAnimationState()
        };
    }
    
    destroy() {
        // Stop all timers
        this.state.timers.forEach((timer, name) => this.stopTimer(name));
        
        // Clear input detection
        if (this.inputDetection.typingTimer) {
            clearTimeout(this.inputDetection.typingTimer);
        }
        
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
        console.log('🚀 SolmateApp destroyed');
    }
}
