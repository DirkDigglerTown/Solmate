// web/script.js - Complete Solmate with Service Worker, Utils, and ES Module VRM Loading
// Features: Service worker, offline support, enhanced error handling, proper VRM via ES modules

// ===== SERVICE WORKER REGISTRATION =====
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then(registration => {
                console.log('✅ Service Worker registered:', registration.scope);
                
                // Update UI
                const swStatus = document.getElementById('swStatus');
                if (swStatus) swStatus.textContent = 'active';
                
                // Handle updates
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            // New service worker available
                            if (window.Utils) {
                                Utils.showNotification('Update available! Refresh to get the latest version.', 'info', 10000);
                            }
                        }
                    });
                });
                
                // Check for updates periodically
                setInterval(() => {
                    registration.update();
                }, 60000); // Check every minute
            })
            .catch(error => {
                console.warn('Service Worker registration failed:', error);
                const swStatus = document.getElementById('swStatus');
                if (swStatus) swStatus.textContent = 'failed';
            });
    });
    
    // Handle offline/online events
    window.addEventListener('online', () => {
        document.body.classList.remove('offline');
        if (window.Utils) {
            Utils.showNotification('Back online!', 'success', 3000);
        }
        // Reconnect WebSocket if needed
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            connectWebSocket();
        }
    });
    
    window.addEventListener('offline', () => {
        document.body.classList.add('offline');
        if (window.Utils) {
            Utils.showNotification('You are offline. Some features may be limited.', 'warning', 5000);
        }
    });
} else {
    console.warn('Service Workers not supported');
    const swStatus = document.getElementById('swStatus');
    if (swStatus) swStatus.textContent = 'unsupported';
}

// ===== CONSTANTS =====
const ASSET_LOAD_TIMEOUT = 30ewan;
const VRM_PATHS = [
    '/assets/avatar/solmate.vrm',
    'https://raw.githubusercontent.com/DirkDigglerTown/solmate/main/web/assets/avatar/solmate.vrm'
];
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Configuration loaded from server
let CONFIG = {
    wsUrl: null,
    apiEndpoints: {
        chat: '/api/chat',
        tts: '/api/tts',
        price: '/api/price',
        tps: '/api/tps',
        health: '/api/health',
        config: '/api/config'
    },
    maxMessageLength: 500,
    maxConversationSize: 50,
    maxAudioQueueSize: 10,
    priceUpdateInterval: 30000,
    tpsUpdateInterval: 60000,
    systemPrompt: `You are Solmate, a helpful and witty Solana Companion, inspired by Rangiku Matsumoto from Bleach and Lust from Fullmetal Alchemist. Be maximally truthful, helpful, and add a touch of humor when appropriate. You're a Solana companion, so focus on Solana blockchain, crypto, DeFi, NFTs, and web3 topics, but answer any question. Keep responses concise, engaging, and fun. Always remind users: Not financial advice.`
};

// ===== GLOBAL STATE =====
let audioQueue = [];
let isPlaying = false;
let ws = null;
let wsReconnectTimer = null;
let priceUpdateTimer = null;
let tpsUpdateTimer = null;
let conversation = [];

// Animation state
let animationState = {
    isWaving: false,
    isIdle: true,
    isTalking: false,
    headTarget: { x: 0, y: 0 },
    breathingPhase: 0,
    blinkTimer: 0
};

// VRM Module state - will be set by ES module
window.vrmState = {
    scene: null,
    camera: null,
    renderer: null,
    currentVRM: null,
    clock: null,
    initialized: false
};

// ===== LOAD CONFIGURATION =====
async function loadConfiguration() {
    try {
        const response = await fetch(CONFIG.apiEndpoints.config);
        if (!response.ok) {
            throw new Error(`Config loading failed: ${response.status}`);
        }
        
        const serverConfig = await response.json();
        
        // Merge server config with defaults
        CONFIG = { ...CONFIG, ...serverConfig };
        
        // Update system prompt if provided
        if (serverConfig.models && serverConfig.models.chat) {
            log(`Using chat model: ${serverConfig.models.chat}`);
        }
        
        log('✅ Configuration loaded from server');
        return true;
    } catch (error) {
        log('⚠️ Using default configuration:', error);
        return false;
    }
}

// ===== ENHANCED LOGGING WITH UTILS =====
function log(msg, data = null) {
    const time = new Date().toLocaleTimeString();
    const entry = `[${time}] ${msg}`;
    
    let logData = '';
    if (data !== null) {
        try {
            if (typeof data === 'object' && data !== null) {
                logData = JSON.stringify(data, null, 2);
            } else {
                logData = String(data);
            }
        } catch (e) {
            logData = '[Complex Object]';
        }
    }
    
    console.log(entry, logData || '');
    
    // Update debug overlay if available
    const logs = document.getElementById('overlayLogs');
    if (logs) {
        const div = document.createElement('div');
        div.textContent = logData ? `${entry} ${logData}` : entry;
        logs.appendChild(div);
        if (logs.children.length > 20) logs.removeChild(logs.firstChild);
    }
    
    // Track performance metrics if Utils is available
    if (window.Utils && msg.includes('✅')) {
        Utils.performance.mark(msg);
    }
}

// ===== INJECT ES MODULE LOADER FOR VRM =====
function injectVRMModule() {
    log('🎭 Injecting VRM ES module loader...');
    
    // Add import map
    const importMap = document.createElement('script');
    importMap.type = 'importmap';
    importMap.textContent = JSON.stringify({
        imports: {
            "three": "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js",
            "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/",
            "@pixiv/three-vrm": "https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.0.0/lib/three-vrm.module.js"
        }
    });
    document.head.appendChild(importMap);
    
    // Add ES module script
    const moduleScript = document.createElement('script');
    moduleScript.type = 'module';
    moduleScript.textContent = `
        import * as THREE from 'three';
        import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
        import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
        
        // Initialize Three.js scene
        function initScene() {
            const state = window.vrmState;
            
            // Scene
            state.scene = new THREE.Scene();
            state.scene.background = new THREE.Color(0x0a0e17);
            
            // Camera
            state.camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 20);
            state.camera.position.set(0, 1.4, 3);
            
            // Renderer
            const canvas = document.getElementById('vrmCanvas');
            if (!canvas) {
                console.error('Canvas not found');
                return;
            }
            
            state.renderer = new THREE.WebGLRenderer({ 
                canvas, 
                antialias: true,
                alpha: false
            });
            state.renderer.setSize(window.innerWidth, window.innerHeight);
            state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            
            // Lights
            const directionalLight = new THREE.DirectionalLight(0xffffff, Math.PI);
            directionalLight.position.set(1, 1, 1);
            state.scene.add(directionalLight);
            
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
            state.scene.add(ambientLight);
            
            // Clock for animations
            state.clock = new THREE.Clock();
            
            // Handle resize
            window.addEventListener('resize', () => {
                if (!state.camera || !state.renderer) return;
                state.camera.aspect = window.innerWidth / window.innerHeight;
                state.camera.updateProjectionMatrix();
                state.renderer.setSize(window.innerWidth, window.innerHeight);
            });
            
            state.initialized = true;
            console.log('✅ VRM scene initialized');
            
            // Start animation loop
            animate();
        }
        
        // Load VRM model
        async function loadVRM(urls) {
            const state = window.vrmState;
            if (!state.initialized) {
                console.error('Scene not initialized');
                return;
            }
            
            const loadingEl = document.getElementById('loadingStatus');
            if (loadingEl) loadingEl.style.display = 'block';
            
            // Remove existing VRM
            if (state.currentVRM) {
                state.scene.remove(state.currentVRM.scene);
                VRMUtils.deepDispose(state.currentVRM.scene);
                state.currentVRM = null;
            }
            
            const loader = new GLTFLoader();
            loader.register((parser) => {
                return new VRMLoaderPlugin(parser);
            });
            
            let loaded = false;
            
            for (const url of urls) {
                if (loaded) break;
                
                console.log('Trying to load VRM from:', url);
                
                try {
                    const gltf = await loader.loadAsync(url);
                    const vrm = gltf.userData.vrm;
                    
                    if (vrm) {
                        // Rotate model 180 degrees to face camera
                        vrm.scene.rotation.y = Math.PI;
                        
                        // Add to scene
                        state.scene.add(vrm.scene);
                        state.currentVRM = vrm;
                        
                        // Setup VRM
                        if (vrm.humanoid) {
                            const hips = vrm.humanoid.getNormalizedBoneNode('hips');
                            if (hips) hips.position.set(0, 0, 0);
                        }
                        
                        // Camera look at model
                        state.camera.lookAt(0, 1, 0);
                        
                        console.log('✅ VRM loaded successfully from:', url);
                        if (loadingEl) loadingEl.style.display = 'none';
                        loaded = true;
                        
                        // Update status
                        const vrmStatus = document.getElementById('vrmStatus');
                        if (vrmStatus) vrmStatus.textContent = 'loaded';
                        
                        // Trigger ready callback
                        if (window.onVRMReady) window.onVRMReady(vrm);
                    }
                } catch (error) {
                    console.error('Failed to load from ' + url + ':', error);
                }
            }
            
            if (!loaded) {
                console.error('Failed to load VRM from all sources');
                if (loadingEl) {
                    loadingEl.textContent = 'Using fallback avatar';
                    setTimeout(() => {
                        if (loadingEl) loadingEl.style.display = 'none';
                    }, 2000);
                }
                
                // Update status
                const vrmStatus = document.getElementById('vrmStatus');
                if (vrmStatus) vrmStatus.textContent = 'fallback';
                
                // Create fallback
                const geometry = new THREE.BoxGeometry(0.5, 1, 0.3);
                const material = new THREE.MeshLambertMaterial({ color: 0xff6b6b });
                const fallback = new THREE.Mesh(geometry, material);
                fallback.position.y = 1;
                fallback.name = 'fallback';
                state.scene.add(fallback);
                
                // Create fake VRM object
                state.currentVRM = {
                    scene: fallback,
                    update: () => {},
                    isFallback: true
                };
                
                // Notify user if Utils available
                if (window.Utils) {
                    Utils.showNotification('Using fallback avatar', 'warning', 3000);
                }
            }
        }
        
        // Animation loop
        function animate() {
            requestAnimationFrame(animate);
            
            const state = window.vrmState;
            if (!state.renderer || !state.scene || !state.camera) return;
            
            const deltaTime = state.clock ? state.clock.getDelta() : 0.016;
            
            // Update VRM
            if (state.currentVRM) {
                if (state.currentVRM.update) {
                    state.currentVRM.update(deltaTime);
                }
                
                // Apply animations from main script
                if (window.applyVRMAnimations) {
                    window.applyVRMAnimations(state.currentVRM, deltaTime);
                }
            }
            
            state.renderer.render(state.scene, state.camera);
        }
        
        // Expose functions globally
        window.initVRMScene = initScene;
        window.loadVRMModel = loadVRM;
        
        // Auto-initialize
        initScene();
    `;
    
    document.head.appendChild(moduleScript);
}

// ===== VRM ANIMATION HANDLER =====
window.applyVRMAnimations = function(vrm, deltaTime) {
    if (!vrm) return;
    
    const time = Date.now() / 1000;
    
    // Simple idle animation
    if (!animationState.isTalking && !animationState.isWaving) {
        if (vrm.scene) {
            vrm.scene.rotation.y = Math.PI + Math.sin(time * 0.5) * 0.02;
        }
        
        // Head movement if humanoid available
        if (vrm.humanoid && !vrm.isFallback) {
            const head = vrm.humanoid.getNormalizedBoneNode('head');
            if (head) {
                head.rotation.x = Math.sin(time * 0.8) * 0.015 + animationState.headTarget.x * 0.2;
                head.rotation.y = Math.sin(time * 0.6) * 0.02 + animationState.headTarget.y * 0.2;
            }
        }
    }
    
    // Breathing
    if (vrm.scene && !animationState.isTalking) {
        const breathe = 1 + Math.sin(time * 2) * 0.01;
        vrm.scene.scale.y = breathe;
    }
};

// ===== VRM READY CALLBACK =====
window.onVRMReady = function(vrm) {
    log('✅ VRM ready, setting up features...');
    
    if (vrm.expressionManager) {
        log('😊 Expression manager available');
        
        // Test expressions
        const expressions = ['happy', 'angry', 'sad', 'surprised', 'blink'];
        const available = [];
        
        expressions.forEach(expr => {
            try {
                vrm.expressionManager.setValue(expr, 0);
                available.push(expr);
            } catch (e) {}
        });
        
        if (available.length > 0) {
            log(`Available expressions: ${available.join(', ')}`);
        }
    }
    
    if (vrm.humanoid) {
        log('🤖 Humanoid system available');
    }
    
    if (vrm.lookAt) {
        vrm.lookAt.target = window.vrmState.camera;
        log('👀 Look-at enabled');
    }
};

// ===== WAVE ANIMATION =====
function playWave() {
    if (!window.vrmState.currentVRM) {
        log('⌛ No VRM for waving');
        return;
    }
    
    log('👋 Playing wave...');
    animationState.isWaving = true;
    
    const vrm = window.vrmState.currentVRM;
    
    if (vrm.humanoid && !vrm.isFallback) {
        // Real VRM wave
        const rightArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
        const rightLowerArm = vrm.humanoid.getNormalizedBoneNode('rightLowerArm');
        
        if (rightArm) {
            const originalUpper = rightArm.rotation.clone();
            const originalLower = rightLowerArm ? rightLowerArm.rotation.clone() : null;
            
            let waveTime = 0;
            const waveAnimation = setInterval(() => {
                waveTime += 0.016;
                
                if (waveTime >= 2) {
                    rightArm.rotation.copy(originalUpper);
                    if (rightLowerArm && originalLower) {
                        rightLowerArm.rotation.copy(originalLower);
                    }
                    animationState.isWaving = false;
                    clearInterval(waveAnimation);
                    return;
                }
                
                const waveIntensity = Math.sin(waveTime * Math.PI * 3);
                rightArm.rotation.z = -0.5 - waveIntensity * 0.5;
                
                if (rightLowerArm) {
                    rightLowerArm.rotation.z = -0.3 - Math.abs(waveIntensity) * 0.3;
                }
            }, 16);
        }
    } else {
        // Fallback wave
        let waveTime = 0;
        const waveAnimation = setInterval(() => {
            waveTime += 0.016;
            
            if (waveTime >= 2) {
                animationState.isWaving = false;
                clearInterval(waveAnimation);
                return;
            }
            
            if (vrm.scene) {
                vrm.scene.rotation.z = Math.sin(waveTime * Math.PI * 3) * 0.1;
            }
        }, 16);
    }
}

// ===== SPEECH ANIMATION =====
function startSpeechAnimation(text) {
    log('🗣️ Starting speech animation');
    animationState.isTalking = true;
    
    const vrm = window.vrmState.currentVRM;
    if (vrm && vrm.expressionManager) {
        try {
            vrm.expressionManager.setValue('happy', 0.3);
        } catch (e) {}
    }
    
    const speechDuration = Math.min(text.length * 50, 10000);
    setTimeout(() => {
        stopSpeechAnimation();
    }, speechDuration);
}

function stopSpeechAnimation() {
    log('🔇 Stopping speech animation');
    animationState.isTalking = false;
    
    const vrm = window.vrmState.currentVRM;
    if (vrm && vrm.expressionManager) {
        try {
            vrm.expressionManager.setValue('happy', 0);
        } catch (e) {}
    }
}

// ===== ENHANCED UI SETUP =====
function setupUI() {
    log('Setting up UI...');
    
    // Check WebGL support
    if (window.Utils && !Utils.webgl.isSupported()) {
        log('WebGL not supported, showing fallback');
        const canvas = document.getElementById('vrmCanvas');
        const fallback = document.querySelector('.webgl-fallback');
        if (canvas) canvas.style.display = 'none';
        if (fallback) fallback.style.display = 'block';
        document.body.classList.add('no-webgl');
    }
    
    const themeBtn = document.getElementById('themeToggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            document.documentElement.classList.toggle('light');
            const isLight = document.documentElement.classList.contains('light');
            themeBtn.innerHTML = isLight 
                ? '<span aria-hidden="true">☀️</span>' 
                : '<span aria-hidden="true">🌙</span>';
            
            // Save preference
            if (window.Utils) {
                Utils.storage.set('theme', isLight ? 'light' : 'dark');
            }
        });
        
        // Load saved theme
        if (window.Utils) {
            const savedTheme = Utils.storage.get('theme');
            if (savedTheme === 'light') {
                document.documentElement.classList.add('light');
                themeBtn.innerHTML = '<span aria-hidden="true">☀️</span>';
            }
        }
    }
    
    const chatForm = document.getElementById('chatForm');
    const promptInput = document.getElementById('promptInput');
    const sendBtn = document.getElementById('sendBtn');
    
    if (chatForm && promptInput && sendBtn) {
        // Debounce input validation with Utils
        if (window.Utils) {
            const validateInput = Utils.debounce(() => {
                const text = promptInput.value.trim();
                if (text.length > CONFIG.maxMessageLength) {
                    promptInput.classList.add('error');
                    Utils.showNotification(`Message too long (max ${CONFIG.maxMessageLength} chars)`, 'warning', 3000);
                } else {
                    promptInput.classList.remove('error');
                }
            }, 300);
            
            promptInput.addEventListener('input', validateInput);
        }
        
        chatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const text = promptInput.value.trim();
            if (!text) return;
            
            // Validate input length
            if (text.length > CONFIG.maxMessageLength) {
                if (window.Utils) {
                    Utils.showNotification('Message too long. Please shorten it.', 'error');
                }
                return;
            }
            
            promptInput.value = '';
            sendBtn.disabled = true;
            sendBtn.innerHTML = '<span aria-hidden="true">🤔</span>';
            sendBtn.classList.add('loading');
            
            try {
                if (window.Utils) Utils.performance.mark('chat-start');
                await sendMessage(text);
                if (window.Utils) {
                    Utils.performance.mark('chat-end');
                    Utils.performance.measure('chat-response', 'chat-start', 'chat-end');
                }
            } finally {
                sendBtn.disabled = false;
                sendBtn.innerHTML = '<span aria-hidden="true">▶</span>';
                sendBtn.classList.remove('loading');
            }
        });
    }
    
    const clearBtn = document.getElementById('clearBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            clearAudioQueue();
            if (window.Utils) {
                Utils.showNotification('Audio stopped', 'info', 2000);
            }
        });
    }
    
    // Window resize handler with throttling
    const handleResize = window.Utils 
        ? Utils.throttle(() => {
            const state = window.vrmState;
            if (state.camera && state.renderer) {
                state.camera.aspect = window.innerWidth / window.innerHeight;
                state.camera.updateProjectionMatrix();
                state.renderer.setSize(window.innerWidth, window.innerHeight);
            }
        }, 100)
        : () => {
            const state = window.vrmState;
            if (state.camera && state.renderer) {
                state.camera.aspect = window.innerWidth / window.innerHeight;
                state.camera.updateProjectionMatrix();
                state.renderer.setSize(window.innerWidth, window.innerHeight);
            }
        };
    
    window.addEventListener('resize', handleResize);
    
    // Debug overlay toggle
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'd') {
            e.preventDefault();
            const logs = document.getElementById('debugOverlay');
            if (logs) {
                logs.classList.toggle('hidden');
                if (!logs.classList.contains('hidden')) {
                    updateDebugInfo();
                }
            }
        }
    });
    
    // Load conversation history
    if (window.Utils) {
        conversation = Utils.storage.get('solmateConversation', []);
        log(`Loaded ${conversation.length} conversation messages`);
    } else {
        try {
            const saved = localStorage.getItem('solmateConversation');
            if (saved) {
                conversation = JSON.parse(saved);
                log(`Loaded ${conversation.length} messages`);
            }
        } catch (err) {
            log('Failed to load conversation history:', err);
        }
    }
    
    // Limit conversation size
    if (conversation.length > CONFIG.maxConversationSize) {
        conversation = conversation.slice(-CONFIG.maxConversationSize);
    }
    
    // Enable audio context on user interaction
    document.addEventListener('click', enableAudio, { once: true });
    document.addEventListener('keydown', enableAudio, { once: true });
    
    // Mouse tracking for head movement with throttling
    const handleMouseMove = window.Utils
        ? Utils.throttle((event) => {
            if (!animationState.isTalking && !animationState.isWaving) {
                const mouseX = (event.clientX / window.innerWidth) * 2 - 1;
                const mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
                animationState.headTarget.x = mouseY * 0.1;
                animationState.headTarget.y = mouseX * 0.2;
            }
        }, 50)
        : (event) => {
            if (!animationState.isTalking && !animationState.isWaving) {
                const mouseX = (event.clientX / window.innerWidth) * 2 - 1;
                const mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
                animationState.headTarget.x = mouseY * 0.1;
                animationState.headTarget.y = mouseX * 0.2;
            }
        };
    
    document.addEventListener('mousemove', handleMouseMove);
    
    document.addEventListener('mouseleave', () => {
        if (!animationState.isTalking) {
            animationState.headTarget = { x: 0, y: 0 };
        }
    });
    
    // Update API status
    const apiStatus = document.getElementById('apiStatus');
    if (apiStatus) {
        fetch(CONFIG.apiEndpoints.health)
            .then(res => res.ok ? 'online' : 'offline')
            .catch(() => 'offline')
            .then(status => {
                apiStatus.textContent = status;
                apiStatus.style.color = status === 'online' ? '#00ff88' : '#ff6b6b';
            });
    }
    
    log('UI setup complete');
}

// Update debug info
function updateDebugInfo() {
    const vrmStatus = document.getElementById('vrmStatus');
    const cacheStatus = document.getElementById('cacheStatus');
    
    if (vrmStatus) {
        const state = window.vrmState;
        if (state.currentVRM) {
            vrmStatus.textContent = state.currentVRM.isFallback ? 'fallback' : 'loaded';
        } else {
            vrmStatus.textContent = 'not loaded';
        }
    }
    
    if (cacheStatus && 'caches' in window) {
        caches.keys().then(names => {
            cacheStatus.textContent = `${names.length} caches active`;
        });
    }
}

function enableAudio() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContext.resume();
        log('Audio enabled');
    } catch (e) {
        log('Audio enable failed:', e);
    }
}

// ===== WEBSOCKET SYSTEM =====
function connectWebSocket() {
    if (!CONFIG.wsUrl) {
        log('WebSocket URL not configured');
        return;
    }
    
    if (ws) ws.close();
    
    try {
        ws = new WebSocket(CONFIG.wsUrl);
        
        ws.onopen = () => {
            log('WebSocket connected');
            const wsLight = document.getElementById('wsLight');
            if (wsLight) {
                wsLight.textContent = 'WS ON';
                wsLight.style.color = '#00ff88';
            }
        };
        
        ws.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                if (data.tps) updateTPS(data.tps);
            } catch (err) {
                log('WebSocket message error', err);
            }
        };
        
        ws.onclose = () => {
            log('WebSocket closed, reconnecting...');
            const wsLight = document.getElementById('wsLight');
            if (wsLight) {
                wsLight.textContent = 'WS OFF';
                wsLight.style.color = '#ff6b6b';
            }
            
            if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
            wsReconnectTimer = setTimeout(connectWebSocket, 5000);
        };
        
        ws.onerror = (err) => log('WebSocket error', err);
        
    } catch (err) {
        log('WebSocket connection failed', err);
        if (!tpsUpdateTimer) {
            tpsUpdateTimer = setInterval(() => {
                fetchTPS().catch(e => log('TPS polling error:', e));
            }, CONFIG.tpsUpdateInterval);
        }
    }
}

function updateTPS(tps) {
    const networkTPS = document.getElementById('networkTPS');
    if (networkTPS) {
        networkTPS.textContent = `${tps} TPS`;
        networkTPS.style.color = '#00ff88';
    }
}

// ===== ENHANCED API CALLS WITH UTILS =====
async function fetchPrice() {
    try {
        log('💰 Fetching SOL price...');
        const url = `${CONFIG.apiEndpoints.price}?ids=${SOL_MINT}`;
        
        // Use Utils enhanced fetch if available
        const res = window.Utils 
            ? await Utils.fetchWithRetry(url, { method: 'GET' }, 2)
            : await fetch(url);
        
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        
        const data = await res.json();
        log('Price data received:', data);
        
        let price = null;
        
        // Jupiter API v3 response structure
        if (data[SOL_MINT] && data[SOL_MINT].usdPrice) {
            price = data[SOL_MINT].usdPrice;
        } else if (data[SOL_MINT] && data[SOL_MINT].price) {
            price = data[SOL_MINT].price;
        } else if (data.data && data.data[SOL_MINT]) {
            price = data.data[SOL_MINT].price || data.data[SOL_MINT].usdPrice;
        }
        
        const solPrice = document.getElementById('solPrice');
        if (solPrice) {
            if (price && price > 0) {
                solPrice.textContent = window.Utils 
                    ? `SOL — ${Utils.formatCurrency(price)}` 
                    : `SOL — $${price.toFixed(2)}`;
                solPrice.style.color = '#00ff88';
                log(`✅ Price updated: $${price.toFixed(2)}`);
            } else {
                solPrice.textContent = 'SOL — N/A';
                solPrice.style.color = '#ff6b6b';
                log('⌛ Price not found in response');
            }
        }
    } catch (err) {
        log('Price fetch failed:', err);
        if (window.Utils) {
            Utils.handleError(Utils.createError(Utils.ErrorTypes.API, 'Price fetch failed', err), false);
        }
        const solPrice = document.getElementById('solPrice');
        if (solPrice) {
            solPrice.textContent = 'SOL — Offline';
            solPrice.style.color = '#ffaa00';
        }
    }
}

async function fetchTPS() {
    try {
        const res = window.Utils
            ? await Utils.fetchWithRetry(CONFIG.apiEndpoints.tps, { method: 'GET' }, 2)
            : await fetch(CONFIG.apiEndpoints.tps);
        
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const data = await res.json();
        
        if (data.tps) {
            updateTPS(data.tps);
            log(`TPS updated: ${data.tps}`);
        }
    } catch (err) {
        log('TPS fetch failed:', err);
        if (window.Utils) {
            Utils.handleError(Utils.createError(Utils.ErrorTypes.API, 'TPS fetch failed', err), false);
        }
        const networkTPS = document.getElementById('networkTPS');
        if (networkTPS) {
            networkTPS.textContent = 'TPS Offline';
            networkTPS.style.color = '#ffaa00';
        }
    }
}

// ===== ENHANCED CHAT SYSTEM =====
async function sendMessage(text) {
    // Show typing indicator
    const typingIndicator = document.getElementById('typingIndicator');
    if (typingIndicator) typingIndicator.classList.remove('hidden');
    
    conversation.push({ role: 'user', content: text });
    
    // Limit conversation size
    if (conversation.length > CONFIG.maxConversationSize) {
        conversation = conversation.slice(-CONFIG.maxConversationSize);
    }
    
    try {
        const res = window.Utils
            ? await Utils.fetchWithRetry(CONFIG.apiEndpoints.chat, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    messages: [
                        { role: 'system', content: CONFIG.systemPrompt || CONFIG.models?.systemPrompt }, 
                        ...conversation
                    ] 
                })
            }, 2)
            : await fetch(CONFIG.apiEndpoints.chat, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    messages: [
                        { role: 'system', content: CONFIG.systemPrompt || CONFIG.models?.systemPrompt }, 
                        ...conversation
                    ] 
                })
            });
        
        if (!res.ok) throw new Error(`Chat API failed: ${res.status}`);
        
        const { content } = await res.json();
        conversation.push({ role: 'assistant', content });
        
        // Save conversation with Utils storage wrapper
        if (window.Utils) {
            Utils.storage.set('solmateConversation', conversation);
        } else {
            try {
                localStorage.setItem('solmateConversation', JSON.stringify(conversation));
            } catch (storageErr) {
                log('Failed to save conversation', storageErr);
            }
        }
        
        // Hide typing indicator
        if (typingIndicator) typingIndicator.classList.add('hidden');
        
        // Start speech animation and queue TTS
        startSpeechAnimation(content);
        queueTTS(content);
        
        return content;
    } catch (err) {
        log('Chat failed:', err);
        
        // Hide typing indicator
        if (typingIndicator) typingIndicator.classList.add('hidden');
        
        if (window.Utils) {
            Utils.handleError(Utils.createError(Utils.ErrorTypes.API, 'Chat service unavailable', err));
        }
        
        const errorMsg = 'Sorry, chat is temporarily unavailable. Please try again!';
        return errorMsg;
    }
}

// ===== TTS SYSTEM =====
function queueTTS(text, voice = 'nova') {
    audioQueue.push({ text, voice });
    if (audioQueue.length > CONFIG.maxAudioQueueSize) {
        audioQueue = audioQueue.slice(-CONFIG.maxAudioQueueSize);
    }
    if (!isPlaying) playNextAudio();
}

async function playNextAudio() {
    if (audioQueue.length === 0) {
        isPlaying = false;
        stopSpeechAnimation();
        return;
    }
    
    isPlaying = true;
    const { text, voice } = audioQueue.shift();
    
    try {
        const res = await fetch(CONFIG.apiEndpoints.tts, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, voice })
        });
        
        if (!res.ok || res.headers.get('X-Solmate-TTS-Fallback') === 'browser') {
            fallbackTTS(text, voice);
            return;
        }
        
        const blob = await res.blob();
        const audio = new Audio(URL.createObjectURL(blob));
        
        audio.onended = () => {
            isPlaying = false;
            stopSpeechAnimation();
            playNextAudio();
        };
        
        audio.onerror = () => {
            isPlaying = false;
            stopSpeechAnimation();
            fallbackTTS(text, voice);
        };
        
        audio.play();
    } catch (err) {
        log('TTS error:', err);
        fallbackTTS(text, voice);
    }
}

function fallbackTTS(text, voice) {
    try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.9;
        utterance.pitch = 1.1;
        utterance.volume = 0.8;
        
        const voices = speechSynthesis.getVoices();
        const selectedVoice = voices.find(v => 
            v.name.toLowerCase().includes(voice.toLowerCase())
        ) || voices[0];
        if (selectedVoice) utterance.voice = selectedVoice;
        
        utterance.onend = () => {
            isPlaying = false;
            stopSpeechAnimation();
            playNextAudio();
        };
        
        utterance.onerror = () => {
            isPlaying = false;
            stopSpeechAnimation();
            playNextAudio();
        };
        
        speechSynthesis.speak(utterance);
        isPlaying = true;
        log('Browser TTS playing');
    } catch (err) {
        log('Fallback TTS failed:', err);
        isPlaying = false;
        stopSpeechAnimation();
        playNextAudio();
    }
}

function clearAudioQueue() {
    audioQueue = [];
    speechSynthesis.cancel();
    isPlaying = false;
    stopSpeechAnimation();
    log('Audio cleared');
}

// ===== ENHANCED MAIN INITIALIZATION =====
async function init() {
    log('🚀 Initializing Enhanced Solmate with VRM ES Modules...');
    
    // Mark performance start
    if (window.Utils) {
        Utils.performance.mark('init-start');
    }
    
    try {
        // Load configuration from server first
        await loadConfiguration();
        
        // Setup UI
        setupUI();
        
        // Check device capabilities
        if (window.Utils) {
            log('Device info:', {
                mobile: Utils.device.isMobile(),
                touch: Utils.device.isTouchDevice(),
                webgl: Utils.webgl.isSupported(),
                webglVersion: Utils.webgl.getVersion()
            });
        }
        
        // Start API calls with better error handling
        try {
            await Promise.all([
                fetchPrice().catch(err => log('Initial price fetch failed:', err)),
                fetchTPS().catch(err => log('Initial TPS fetch failed:', err))
            ]);
        } catch (apiErr) {
            log('Initial API calls failed:', apiErr);
        }
        
        // Start periodic updates
        priceUpdateTimer = setInterval(() => {
            fetchPrice().catch(err => log('Price update failed:', err));
        }, CONFIG.priceUpdateInterval);
        
        tpsUpdateTimer = setInterval(() => {
            fetchTPS().catch(err => log('TPS update failed:', err));
        }, CONFIG.tpsUpdateInterval);
        
        // Check WebGL support before initializing 3D
        if (window.Utils && !Utils.webgl.isSupported()) {
            log('WebGL not supported, using audio-only mode');
            document.getElementById('loadingStatus').style.display = 'none';
            
            // Still connect WebSocket for data
            if (CONFIG.wsUrl) {
                connectWebSocket();
            }
            
            // Welcome message for audio-only mode
            setTimeout(() => {
                if (window.Utils) {
                    Utils.showNotification('Welcome to Solmate! Using audio-only mode.', 'info');
                }
                queueTTS("Hello! I'm Solmate. WebGL isn't available, but I can still chat with you!");
            }, 2000);
            
            return;
        }
        
        // Inject VRM ES module loader
        injectVRMModule();
        
        // Wait for module to initialize then load VRM
        setTimeout(() => {
            if (window.loadVRMModel) {
                window.loadVRMModel(VRM_PATHS);
            } else {
                log('VRM module not ready, retrying...');
                setTimeout(() => {
                    if (window.loadVRMModel) {
                        window.loadVRMModel(VRM_PATHS);
                    }
                }, 2000);
            }
        }, 1000);
        
        // Connect WebSocket
        if (CONFIG.wsUrl) {
            connectWebSocket();
        }
        
        // Mark performance end
        if (window.Utils) {
            Utils.performance.mark('init-end');
            Utils.performance.measure('initialization', 'init-start', 'init-end');
        }
        
        log('✅ Solmate initialization complete!');
        
        // Welcome message with better timing
        setTimeout(() => {
            if (window.Utils) {
                Utils.showNotification('Welcome to Solmate!', 'success', 3000);
            }
            queueTTS("Hello! I'm Solmate, your Solana companion. Ask me anything!");
            setTimeout(playWave, 1000);
        }, 3000);
        
    } catch (err) {
        log('⌛ Initialization failed:', err);
        
        if (window.Utils) {
            Utils.handleError(
                Utils.createError(Utils.ErrorTypes.UNKNOWN, 'Initialization failed', err)
            );
        }
        
        // Fallback initialization
        setupUI();
        
        try {
            await Promise.all([
                fetchPrice().catch(e => log('Fallback price error:', e)),
                fetchTPS().catch(e => log('Fallback TPS error:', e))
            ]);
            
            priceUpdateTimer = setInterval(() => {
                fetchPrice().catch(e => log('Price error:', e));
            }, CONFIG.priceUpdateInterval);
            
            tpsUpdateTimer = setInterval(() => {
                fetchTPS().catch(e => log('TPS error:', e));
            }, CONFIG.tpsUpdateInterval);
        } catch (apiError) {
            log('API initialization failed:', apiError);
        }
        
        // Create simple fallback UI
        const fallback = document.createElement('div');
        fallback.style.cssText = `
            position: fixed; top: 50%; left: 50%;
            transform: translate(-50%, -50%); text-align: center;
            color: white; font-family: Arial, sans-serif;
        `;
        fallback.innerHTML = `
            <img src="/assets/logo/solmatelogo.png" style="width: 200px; height: auto;" onerror="this.style.display='none'">
            <div style="margin-top: 20px;">
                <h2>Solmate</h2>
                <p>Audio-only mode active</p>
            </div>
        `;
        document.body.appendChild(fallback);
        
        // Hide loading status
        const loadingStatus = document.getElementById('loadingStatus');
        if (loadingStatus) loadingStatus.style.display = 'none';
    }
}

// ===== ENHANCED CLEANUP =====
window.addEventListener('beforeunload', () => {
    // Close WebSocket
    if (ws) ws.close();
    
    // Clear timers
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    if (priceUpdateTimer) clearInterval(priceUpdateTimer);
    if (tpsUpdateTimer) clearInterval(tpsUpdateTimer);
    
    // Clear audio
    clearAudioQueue();
    
    // Clean up Three.js resources
    const state = window.vrmState;
    if (state.renderer) state.renderer.dispose();
    if (state.currentVRM && state.scene) {
        state.scene.remove(state.currentVRM.scene);
    }
    
    // Clear performance marks
    if (window.Utils) {
        Utils.performance.clearMarks();
    }
    
    // Notify service worker
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            type: 'CLIENT_UNLOAD'
        });
    }
});

// ===== DEBUG COMMANDS =====
window.debugVRM = function() {
    const state = window.vrmState;
    console.log('=== VRM DEBUG REPORT ===');
    console.log('Scene initialized:', state.initialized);
    console.log('VRM loaded:', !!state.currentVRM);
    console.log('Is fallback:', state.currentVRM?.isFallback);
    
    if (state.currentVRM && !state.currentVRM.isFallback) {
        console.log('VRM Features:', {
            hasHumanoid: !!state.currentVRM.humanoid,
            hasExpressionManager: !!state.currentVRM.expressionManager,
            hasLookAt: !!state.currentVRM.lookAt
        });
    }
    
    if (state.scene) {
        console.log('Scene children:', state.scene.children.length);
    }
    
    console.log('Configuration:', CONFIG);
    
    return state;
};

window.testChat = () => sendMessage("Hello Solmate! How are you today?");
window.testTTS = () => queueTTS("Testing the enhanced text to speech system with animations.", 'nova');
window.playWave = playWave;
window.testPrice = fetchPrice;
window.testTPS = fetchTPS;

window.testExpression = function(expr = 'happy') {
    const vrm = window.vrmState.currentVRM;
    if (vrm && vrm.expressionManager) {
        try {
            vrm.expressionManager.setValue(expr, 1.0);
            setTimeout(() => {
                vrm.expressionManager.setValue(expr, 0);
            }, 2000);
            console.log(`Playing expression: ${expr}`);
        } catch (e) {
            console.log(`Expression not available: ${expr}`);
        }
    } else {
        console.log('No expression manager available');
    }
};

window.reloadVRM = function() {
    if (window.loadVRMModel) {
        console.log('🔄 Reloading VRM...');
        window.loadVRMModel(VRM_PATHS);
        return 'VRM reload initiated';
    }
    return 'VRM loader not ready';
};

window.reloadConfig = function() {
    console.log('🔄 Reloading configuration...');
    loadConfiguration().then(() => {
        console.log('Configuration reloaded:', CONFIG);
    });
};

console.log('🚀 Enhanced Solmate VRM System Loaded!');
console.log('🛠️ Debug commands: debugVRM(), testChat(), testTTS(), playWave(), testPrice(), testExpression(), reloadVRM(), reloadConfig()');
console.log('📊 Features: Service Worker, Utils integration, ES Module VRM loading, Dynamic Config');
console.log('💡 Press Ctrl+D for debug overlay');

// ===== START APPLICATION =====
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
