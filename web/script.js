// web/script.js - Solmate with Proper VRM Loading via ES Modules
// This version actually loads and displays VRM files correctly

// ===== CONSTANTS =====
const ASSET_LOAD_TIMEOUT = 30000;
const VRM_PATHS = [
    '/assets/avatar/solmate.vrm',
    'https://raw.githubusercontent.com/DirkDigglerTown/solmate/main/web/assets/avatar/solmate.vrm',
    // Fallback to a known working VRM for testing
    'https://cdn.jsdelivr.net/gh/pixiv/three-vrm@dev/packages/three-vrm-core/examples/models/VRM1_Constraint_Twist_Sample.vrm'
];
const HELIUS_WS = 'wss://mainnet.helius-rpc.com/?api-key=9355c09c-5049-4ffa-a0fa-786d2482af6b';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

const SYSTEM_PROMPT = `You are Solmate, a helpful and witty Solana Companion, inspired by Rangiku Matsumoto from Bleach and Lust from Fullmetal Alchemist. Be maximally truthful, helpful, and add a touch of humor when appropriate. You're a Solana companion, so focus on Solana blockchain, crypto, DeFi, NFTs, and web3 topics, but answer any question. Keep responses concise, engaging, and fun. Always remind users: Not financial advice.`;

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

// ===== LOGGING =====
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
    
    const logs = document.getElementById('overlayLogs');
    if (logs) {
        const div = document.createElement('div');
        div.textContent = logData ? `${entry} ${logData}` : entry;
        logs.appendChild(div);
        if (logs.children.length > 20) logs.removeChild(logs.firstChild);
    }
}

// ===== INJECT ES MODULE LOADER =====
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
        log('❌ No VRM for waving');
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

// ===== UI SETUP =====
function setupUI() {
    log('Setting up UI...');
    
    const themeBtn = document.getElementById('themeToggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            document.documentElement.classList.toggle('light');
            const isLight = document.documentElement.classList.contains('light');
            themeBtn.textContent = isLight ? '☀️' : '🌙';
        });
    }
    
    const form = document.getElementById('chatForm');
    const input = document.getElementById('promptInput');
    const sendBtn = document.getElementById('sendBtn');
    
    if (form && input) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const text = input.value.trim();
            if (!text) return;
            
            input.value = '';
            if (sendBtn) {
                sendBtn.disabled = true;
                sendBtn.textContent = '⏳';
            }
            
            try {
                await sendMessage(text);
            } finally {
                if (sendBtn) {
                    sendBtn.disabled = false;
                    sendBtn.textContent = '▶';
                }
            }
        });
    }
    
    const clearBtn = document.getElementById('clearBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearAudioQueue);
    }
    
    // Debug overlay
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'd') {
            e.preventDefault();
            const logs = document.getElementById('debugOverlay');
            if (logs) logs.classList.toggle('hidden');
        }
    });
    
    // Enable audio
    document.addEventListener('click', enableAudio, { once: true });
    document.addEventListener('keydown', enableAudio, { once: true });
    
    // Mouse tracking
    document.addEventListener('mousemove', (event) => {
        if (!animationState.isTalking && !animationState.isWaving) {
            const mouseX = (event.clientX / window.innerWidth) * 2 - 1;
            const mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
            animationState.headTarget.x = mouseY * 0.1;
            animationState.headTarget.y = mouseX * 0.2;
        }
    });
}

function enableAudio() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContext.resume();
        log('Audio enabled');
    } catch (e) {}
}

// ===== WEBSOCKET =====
function connectWebSocket() {
    if (ws) ws.close();
    
    try {
        ws = new WebSocket(HELIUS_WS);
        
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
            } catch (err) {}
        };
        
        ws.onclose = () => {
            const wsLight = document.getElementById('wsLight');
            if (wsLight) {
                wsLight.textContent = 'WS OFF';
                wsLight.style.color = '#ff6b6b';
            }
            wsReconnectTimer = setTimeout(connectWebSocket, 5000);
        };
        
    } catch (err) {
        log('WebSocket failed:', err);
    }
}

function updateTPS(tps) {
    const el = document.getElementById('networkTPS');
    if (el) {
        el.textContent = `${tps} TPS`;
        el.style.color = '#00ff88';
    }
}

// ===== API CALLS =====
async function fetchPrice() {
    try {
        log('💰 Fetching SOL price...');
        const res = await fetch(`/api/price?ids=${SOL_MINT}`);
        
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        
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
        
        const el = document.getElementById('solPrice');
        if (el) {
            if (price && price > 0) {
                el.textContent = `SOL — $${price.toFixed(2)}`;
                el.style.color = '#00ff88';
                log(`✅ Price updated: $${price.toFixed(2)}`);
            } else {
                el.textContent = 'SOL — N/A';
                el.style.color = '#ff6b6b';
                log('❌ Price not found in response');
            }
        }
    } catch (err) {
        log('Price fetch failed:', err.message);
        const el = document.getElementById('solPrice');
        if (el) {
            el.textContent = 'SOL — Error';
            el.style.color = '#ff6b6b';
        }
    }
}

async function fetchTPS() {
    try {
        const res = await fetch('/api/tps');
        const data = await res.json();
        if (data.tps) {
            updateTPS(data.tps);
            log(`TPS updated: ${data.tps}`);
        }
    } catch (err) {
        log('TPS fetch failed:', err.message);
    }
}

// ===== CHAT SYSTEM =====
async function sendMessage(text) {
    conversation.push({ role: 'user', content: text });
    
    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT }, 
                    ...conversation
                ] 
            })
        });
        
        if (!res.ok) throw new Error(`Chat failed: ${res.status}`);
        
        const { content } = await res.json();
        conversation.push({ role: 'assistant', content });
        
        // Save conversation
        try {
            localStorage.setItem('solmateConversation', JSON.stringify(conversation));
        } catch (e) {}
        
        // Animate
        startSpeechAnimation(content);
        queueTTS(content);
        
        return content;
    } catch (err) {
        log('Chat error:', err);
        return 'Sorry, I had trouble processing that. Try again!';
    }
}

// ===== TTS SYSTEM =====
function queueTTS(text, voice = 'nova') {
    audioQueue.push({ text, voice });
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
        const res = await fetch('/api/tts', {
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
    } catch (err) {
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

// ===== MAIN INIT =====
async function init() {
    log('🚀 Starting Solmate...');
    
    try {
        setupUI();
        
        // Start API calls
        fetchPrice();
        fetchTPS();
        
        // Set up periodic updates
        priceUpdateTimer = setInterval(fetchPrice, 30000);
        tpsUpdateTimer = setInterval(fetchTPS, 60000);
        
        // Inject VRM module loader
        injectVRMModule();
        
        // Wait for module to initialize
        setTimeout(() => {
            if (window.loadVRMModel) {
                window.loadVRMModel(VRM_PATHS);
            }
        }, 1000);
        
        // Connect WebSocket
        connectWebSocket();
        
        // Load conversation history
        try {
            const saved = localStorage.getItem('solmateConversation');
            if (saved) {
                conversation = JSON.parse(saved);
                log(`Loaded ${conversation.length} messages`);
            }
        } catch (err) {}
        
        // Welcome message
        setTimeout(() => {
            queueTTS("Hello! I'm Solmate, your Solana companion. Ask me anything!");
            setTimeout(playWave, 1000);
        }, 3000);
        
    } catch (err) {
        log('Init error:', err);
    }
}

// ===== CLEANUP =====
window.addEventListener('beforeunload', () => {
    if (ws) ws.close();
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    if (priceUpdateTimer) clearInterval(priceUpdateTimer);
    if (tpsUpdateTimer) clearInterval(tpsUpdateTimer);
    clearAudioQueue();
    
    const state = window.vrmState;
    if (state.renderer) state.renderer.dispose();
});

// ===== DEBUG COMMANDS =====
window.debugVRM = function() {
    const state = window.vrmState;
    console.log('=== VRM DEBUG ===');
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
    return state;
};

window.testChat = () => sendMessage("Hello! How are you?");
window.testTTS = () => queueTTS("Testing text to speech.", 'nova');
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

console.log('🚀 Solmate VRM System Loaded!');
console.log('🛠️ Commands: debugVRM(), testChat(), testTTS(), playWave(), testPrice(), testExpression()');

// ===== START APPLICATION =====
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
