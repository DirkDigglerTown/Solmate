// web/script.js - Complete Solmate VRM Implementation
// Production-ready with ALL features from past conversations

// ===== CONSTANTS =====
const ASSET_LOAD_TIMEOUT = 30000;
const VRM_MAX_RETRIES = 2;
const VRM_PATH = '/assets/avatar/solmate.vrm';
const HELIUS_WS = 'wss://mainnet.helius-rpc.com/?api-key=9355c09c-5049-4ffa-a0fa-786d2482af6b';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

const SYSTEM_PROMPT = `You are Solmate, a helpful and witty Solana Companion, inspired by Rangiku Matsumoto from Bleach and Lust from Fullmetal Alchemist. Be maximally truthful, helpful, and add a touch of humor when appropriate. You're a Solana companion, so focus on Solana blockchain, crypto, DeFi, NFTs, and web3 topics, but answer any question. Keep responses concise, engaging, and fun. Always remind users: Not financial advice.`;

// ===== GLOBAL STATE =====
let THREE, scene, camera, renderer, mixer, clock;
let currentVRM = null;
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

// ===== LOGGING =====
function log(msg, data = null) {
    const time = new Date().toLocaleTimeString();
    const entry = `[${time}] ${msg}`;
    
    let logData = '';
    if (data !== null) {
        try {
            if (typeof data === 'object' && data !== null) {
                logData = JSON.stringify(data, (key, value) => {
                    if (key === 'parser' || key === 'plugins' || key === 'cache') {
                        return '[Object]';
                    }
                    if (typeof value === 'function') {
                        return '[Function]';
                    }
                    return value;
                }, 2);
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

// ===== LOAD SCRIPT UTILITY =====
function loadScript(src) {
    return new Promise((resolve, reject) => {
        const existingScript = document.querySelector(`script[src="${src}"]`);
        if (existingScript) {
            resolve();
            return;
        }
        
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load: ${src}`));
        document.head.appendChild(script);
    });
}

// ===== VRM INITIALIZATION =====
async function initializeVRMSystem() {
    log('🎭 Initializing VRM system...');
    
    try {
        // Load Three.js
        await loadScript('https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js');
        THREE = window.THREE;
        
        if (!THREE) throw new Error('Three.js failed to load');
        log('✅ Three.js loaded');
        
        // Load GLTFLoader
        await loadScript('https://cdn.jsdelivr.net/npm/three@0.158.0/examples/js/loaders/GLTFLoader.js');
        log('✅ GLTFLoader loaded');
        
        // Load VRM library - try multiple sources
        const vrmSources = [
            'https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@2.0.6/lib/three-vrm.min.js',
            'https://unpkg.com/@pixiv/three-vrm@2.0.6/lib/three-vrm.min.js'
        ];
        
        let vrmLoaded = false;
        for (const source of vrmSources) {
            try {
                await loadScript(source);
                
                // Check multiple possible locations for VRM
                if (window.VRM && window.VRM.VRMLoaderPlugin) {
                    log('✅ VRM found at window.VRM.VRMLoaderPlugin');
                    vrmLoaded = true;
                    break;
                } else if (window.THREE && window.THREE.VRMLoaderPlugin) {
                    window.VRM = { VRMLoaderPlugin: window.THREE.VRMLoaderPlugin };
                    log('✅ VRM found at window.THREE.VRMLoaderPlugin');
                    vrmLoaded = true;
                    break;
                } else if (window.VRMLoaderPlugin) {
                    window.VRM = { VRMLoaderPlugin: window.VRMLoaderPlugin };
                    log('✅ VRM found at window.VRMLoaderPlugin');
                    vrmLoaded = true;
                    break;
                }
                
                // Wait for initialization
                await new Promise(resolve => setTimeout(resolve, 500));
                
                if (window.VRM) {
                    vrmLoaded = true;
                    break;
                }
            } catch (e) {
                continue;
            }
        }
        
        if (!vrmLoaded) {
            createFallbackVRM();
        }
        
        log('✅ VRM system ready');
        return true;
        
    } catch (error) {
        log('❌ VRM init failed:', error.message);
        createFallbackVRM();
        return true;
    }
}

// ===== FALLBACK VRM =====
function createFallbackVRM() {
    if (!window.VRM) {
        window.VRM = {
            VRMLoaderPlugin: class {
                constructor(parser) {
                    this.parser = parser;
                }
                
                afterRoot(gltf) {
                    gltf.userData.vrm = {
                        scene: gltf.scene,
                        humanoid: null,
                        lookAt: null,
                        expressionManager: null,
                        isMinimalVRM: true,
                        update: () => {}
                    };
                }
            }
        };
        log('Fallback VRM created');
    }
}

// ===== SCENE SETUP =====
function setupScene() {
    log('🎬 Setting up scene...');
    
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e17);
    
    camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 20);
    camera.position.set(0, 1.4, 2.5);
    camera.lookAt(0, 1.0, 0);
    
    const canvas = document.getElementById('vrmCanvas');
    if (!canvas) throw new Error('Canvas not found');
    
    renderer = new THREE.WebGLRenderer({ 
        canvas, 
        antialias: true,
        alpha: false,
        premultipliedAlpha: false
    });
    
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(1, 1, 1);
    directionalLight.castShadow = true;
    scene.add(directionalLight);
    
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-1, 0.5, -1);
    scene.add(fillLight);
    
    clock = new THREE.Clock();
    log('✅ Scene ready');
}

// ===== LOAD VRM MODEL =====
async function loadVRMModel(url, retryCount = 0) {
    log(`📦 Loading VRM: ${url}`);
    updateLoadingStatus('Loading avatar...');
    
    try {
        const response = await fetch(url, { method: 'HEAD' });
        if (!response.ok) throw new Error(`File not accessible: ${response.status}`);
        
        const loader = new THREE.GLTFLoader();
        
        if (window.VRM && window.VRM.VRMLoaderPlugin) {
            loader.register((parser) => {
                return new window.VRM.VRMLoaderPlugin(parser);
            });
        }
        
        const gltf = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout')), ASSET_LOAD_TIMEOUT);
            
            loader.load(
                url,
                (loaded) => {
                    clearTimeout(timeout);
                    resolve(loaded);
                },
                (progress) => {
                    if (progress.total > 0) {
                        const percent = Math.round((progress.loaded / progress.total) * 100);
                        updateLoadingStatus(`Loading... ${percent}%`);
                    }
                },
                (error) => {
                    clearTimeout(timeout);
                    reject(error);
                }
            );
        });
        
        const vrm = gltf.userData.vrm || gltf;
        currentVRM = vrm;
        
        setupVRMModel(vrm);
        log('✅ VRM loaded');
        return vrm;
        
    } catch (error) {
        log(`❌ Load failed: ${error.message}`);
        
        if (retryCount < VRM_MAX_RETRIES) {
            await new Promise(r => setTimeout(r, 2000));
            return loadVRMModel(url, retryCount + 1);
        }
        
        createFallbackAvatar();
        throw error;
    }
}

// ===== SETUP VRM MODEL =====
function setupVRMModel(vrm) {
    log('🎭 Setting up VRM...');
    
    const existing = scene.getObjectByName('VRM_Model');
    if (existing) scene.remove(existing);
    
    const vrmScene = vrm.scene || vrm;
    vrmScene.name = 'VRM_Model';
    scene.add(vrmScene);
    
    const box = new THREE.Box3().setFromObject(vrmScene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    
    log('📐 Model dimensions:', {
        size: { x: size.x.toFixed(2), y: size.y.toFixed(2), z: size.z.toFixed(2) },
        center: { x: center.x.toFixed(2), y: center.y.toFixed(2), z: center.z.toFixed(2) }
    });
    
    const targetHeight = 1.7;
    if (size.y > 0) {
        const scale = targetHeight / size.y;
        vrmScene.scale.setScalar(scale);
        log(`Applied scale: ${scale.toFixed(4)}`);
    }
    
    box.setFromObject(vrmScene);
    
    vrmScene.position.y = -box.min.y;
    vrmScene.position.x = -center.x * vrmScene.scale.x;
    vrmScene.position.z = -center.z * vrmScene.scale.z;
    
    // Face camera
    vrmScene.rotation.y = Math.PI;
    log('🔄 Rotated model 180° to face camera');
    
    // Setup camera position
    const cameraDistance = Math.max(size.x, size.y, size.z) * 1.8;
    const lookAtY = center.y + size.y * 0.2;
    camera.position.set(0, lookAtY, cameraDistance);
    camera.lookAt(center.x, lookAtY, center.z);
    
    // Setup features
    setupVRMFeatures(vrm);
    fixMaterials(vrmScene);
    startAnimationLoop(vrm);
    
    log('✅ VRM ready');
}

// ===== SETUP VRM FEATURES =====
function setupVRMFeatures(vrm) {
    log('🎯 Setting up VRM features...');
    
    if (vrm.isMinimalVRM) {
        log('⚠️ Using minimal VRM features');
        return;
    }
    
    if (vrm.lookAt) {
        vrm.lookAt.target = camera;
        log('👀 Look-at enabled');
    }
    
    if (vrm.expressionManager) {
        const expressions = ['happy', 'angry', 'sad', 'surprised', 'relaxed', 'neutral', 'blink'];
        const available = [];
        
        expressions.forEach(expr => {
            try {
                vrm.expressionManager.setValue(expr, 0);
                available.push(expr);
            } catch (e) {
                // Expression not available
            }
        });
        
        if (available.length > 0) {
            log(`😊 Expressions available: ${available.join(', ')}`);
        }
    }
    
    if (vrm.humanoid) {
        log('🤖 Humanoid system available');
        
        // List available bones
        const boneNames = ['head', 'neck', 'chest', 'spine', 'hips', 'leftShoulder', 'rightShoulder', 
                          'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand'];
        const availableBones = [];
        
        boneNames.forEach(boneName => {
            try {
                const bone = vrm.humanoid.getNormalizedBoneNode(boneName);
                if (bone) availableBones.push(boneName);
            } catch (e) {}
        });
        
        if (availableBones.length > 0) {
            log(`Available bones: ${availableBones.join(', ')}`);
        }
    }
}

// ===== FIX MATERIALS =====
function fixMaterials(model) {
    log('🎨 Fixing materials...');
    let materialsFixed = 0;
    
    model.traverse((child) => {
        if (child.isMesh && child.material) {
            const mat = child.material;
            
            if (mat.map) {
                mat.map.flipY = false;
                mat.map.colorSpace = THREE.SRGBColorSpace;
                materialsFixed++;
            }
            
            if (mat.normalMap) {
                mat.normalMap.flipY = false;
            }
            
            if (mat.emissiveMap) {
                mat.emissiveMap.flipY = false;
                mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
            }
            
            // Fix dark materials
            if (mat.color && mat.color.r < 0.1 && mat.color.g < 0.1 && mat.color.b < 0.1) {
                mat.color.setRGB(0.5, 0.5, 0.5);
            }
            
            // Fix MToon materials
            if (mat.isMToonMaterial) {
                log(`🎭 MToon material found: ${child.name}`);
                if (mat.shadeColorFactor) {
                    mat.shadeColorFactor.setRGB(0.8, 0.8, 0.8);
                }
                if (!mat.shadeColorTexture && mat.map) {
                    mat.shadeColorTexture = mat.map;
                }
            }
            
            mat.needsUpdate = true;
        }
    });
    
    log(`✅ Fixed ${materialsFixed} materials`);
}

// ===== ANIMATION LOOP =====
function startAnimationLoop(vrm) {
    log('🎬 Starting animations...');
    let time = 0;
    let blinkTimer = 0;
    let breathingPhase = 0;
    
    function animateVRM() {
        if (!currentVRM) return;
        
        const delta = clock.getDelta();
        time += delta;
        blinkTimer += delta;
        breathingPhase += delta;
        
        // Update VRM if it has update function
        if (vrm.update && typeof vrm.update === 'function') {
            vrm.update(delta);
        }
        
        const model = scene.getObjectByName('VRM_Model');
        if (model) {
            // Breathing
            if (!animationState.isTalking) {
                const breathe = 1 + Math.sin(breathingPhase * 2) * 0.01;
                model.scale.y = model.scale.x * breathe;
            }
            
            // Idle animation
            if (!animationState.isTalking && !animationState.isWaving) {
                // Subtle sway
                model.rotation.y = Math.PI + Math.sin(time * 0.5) * 0.02;
                
                // Head movement if humanoid available
                if (vrm.humanoid) {
                    const head = vrm.humanoid.getNormalizedBoneNode('head');
                    if (head) {
                        head.rotation.x = Math.sin(time * 0.8) * 0.015 + animationState.headTarget.x * 0.2;
                        head.rotation.y = Math.sin(time * 0.6) * 0.02 + animationState.headTarget.y * 0.2;
                        head.rotation.z = Math.sin(time * 0.4) * 0.006;
                    }
                }
            }
        }
        
        // Auto blink
        if (blinkTimer > 3 + Math.random() * 2) {
            performBlink(vrm);
            blinkTimer = 0;
        }
        
        requestAnimationFrame(animateVRM);
    }
    
    animateVRM();
}

// ===== BLINK =====
function performBlink(vrm) {
    if (vrm.expressionManager) {
        try {
            vrm.expressionManager.setValue('blink', 1.0);
            setTimeout(() => {
                if (vrm.expressionManager) {
                    vrm.expressionManager.setValue('blink', 0);
                }
            }, 150);
        } catch (e) {}
    }
}

// ===== WAVE ANIMATION =====
function playWave() {
    if (!currentVRM) {
        log('❌ No VRM for waving');
        return;
    }
    
    log('👋 Playing wave...');
    animationState.isWaving = true;
    
    if (currentVRM.isMinimalVRM) {
        // Simple fallback wave
        const model = scene.getObjectByName('VRM_Model');
        if (model) {
            const originalRotation = model.rotation.y;
            let waveTime = 0;
            
            function animateWave() {
                waveTime += 16;
                if (waveTime >= 2000) {
                    model.rotation.y = originalRotation;
                    animationState.isWaving = false;
                    return;
                }
                const progress = waveTime / 2000;
                model.rotation.y = originalRotation + Math.sin(progress * Math.PI * 6) * 0.2;
                requestAnimationFrame(animateWave);
            }
            animateWave();
        }
    } else if (currentVRM.humanoid) {
        // Real VRM wave
        const rightArm = currentVRM.humanoid.getNormalizedBoneNode('rightUpperArm');
        const rightLowerArm = currentVRM.humanoid.getNormalizedBoneNode('rightLowerArm');
        
        if (rightArm) {
            const originalUpper = rightArm.rotation.clone();
            const originalLower = rightLowerArm ? rightLowerArm.rotation.clone() : null;
            
            const startTime = Date.now();
            
            function animateRealWave() {
                const elapsed = (Date.now() - startTime) / 1000;
                
                if (elapsed >= 2.2) {
                    rightArm.rotation.copy(originalUpper);
                    if (rightLowerArm && originalLower) {
                        rightLowerArm.rotation.copy(originalLower);
                    }
                    animationState.isWaving = false;
                    log('👋 Wave complete');
                    return;
                }
                
                // Wave motion
                const waveIntensity = Math.sin(elapsed * Math.PI * 3);
                rightArm.rotation.x = 0.9 * waveIntensity;
                rightArm.rotation.z = -0.9 + waveIntensity * 0.2;
                
                if (rightLowerArm) {
                    rightLowerArm.rotation.z = -0.8 * Math.abs(waveIntensity);
                }
                
                requestAnimationFrame(animateRealWave);
            }
            animateRealWave();
        }
    }
}

// ===== SPEECH ANIMATION =====
function startSpeechAnimation(text) {
    log('🗣️ Starting speech animation');
    animationState.isTalking = true;
    
    if (currentVRM && currentVRM.humanoid) {
        const speechDuration = text.length * 50;
        let speechTime = 0;
        
        function animateSpeech() {
            if (!animationState.isTalking) return;
            
            speechTime += 16;
            
            const head = currentVRM.humanoid.getNormalizedBoneNode('head');
            if (head) {
                const intensity = 0.03;
                head.rotation.y = Math.sin(speechTime * 0.005) * intensity;
                head.rotation.x = Math.sin(speechTime * 0.003) * intensity * 0.5;
            }
            
            if (speechTime < speechDuration) {
                requestAnimationFrame(animateSpeech);
            } else {
                stopSpeechAnimation();
            }
        }
        
        animateSpeech();
    }
    
    // Set expression
    if (currentVRM && currentVRM.expressionManager) {
        try {
            currentVRM.expressionManager.setValue('happy', 0.3);
        } catch (e) {}
    }
}

function stopSpeechAnimation() {
    log('🔇 Stopping speech animation');
    animationState.isTalking = false;
    
    if (currentVRM && currentVRM.expressionManager) {
        try {
            currentVRM.expressionManager.setValue('happy', 0);
        } catch (e) {}
    }
}

// ===== FALLBACK AVATAR =====
function createFallbackAvatar() {
    log('Creating fallback avatar...');
    
    const group = new THREE.Group();
    group.name = 'VRM_Model';
    
    const headGeo = new THREE.SphereGeometry(0.12, 32, 32);
    const headMat = new THREE.MeshLambertMaterial({ color: 0xffdbac });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.6;
    group.add(head);
    
    const bodyGeo = new THREE.CylinderGeometry(0.15, 0.18, 0.5, 12);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xff6b6b });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.1;
    group.add(body);
    
    const skirtGeo = new THREE.ConeGeometry(0.25, 0.3, 8);
    const skirtMat = new THREE.MeshLambertMaterial({ color: 0x4169E1 });
    const skirt = new THREE.Mesh(skirtGeo, skirtMat);
    skirt.position.y = 0.75;
    group.add(skirt);
    
    scene.add(group);
    currentVRM = { scene: group, isMinimalVRM: true };
    
    startAnimationLoop(currentVRM);
}

// ===== RENDER LOOP =====
function animate() {
    requestAnimationFrame(animate);
    
    if (renderer && scene && camera) {
        renderer.render(scene, camera);
    }
    
    // Update enhanced system if available
    if (window.enhancedSolmate && window.enhancedSolmate.update) {
        const delta = clock ? clock.getDelta() : 0;
        window.enhancedSolmate.update(delta);
    }
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
        if (!tpsUpdateTimer) {
            tpsUpdateTimer = setInterval(fetchTPS, 10000);
        }
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
        const url = `/api/price?ids=${SOL_MINT}`;
        const res = await fetch(url);
        const data = await res.json();
        
        let price = null;
        if (data.data && data.data[SOL_MINT]) {
            price = data.data[SOL_MINT].price;
        } else if (data.price) {
            price = data.price;
        }
        
        const el = document.getElementById('solPrice');
        if (el && price) {
            el.textContent = `SOL — ${price.toFixed(2)}`;
            el.style.color = '#00ff88';
        }
    } catch (err) {
        log('Price fetch failed:', err.message);
    }
}

async function fetchTPS() {
    try {
        const res = await fetch('/api/tps');
        const data = await res.json();
        if (data.tps) updateTPS(data.tps);
    } catch (err) {
        log('TPS fetch failed:', err.message);
    }
}

// ===== CHAT SYSTEM =====
async function sendMessage(text) {
    conversation.push({ role: 'user', content: text });
    
    try {
        // Get enhanced prompt if available
        let systemPrompt = SYSTEM_PROMPT;
        if (window.enhancedSolmate && window.enhancedSolmate.getEnhancedPrompt) {
            systemPrompt = window.enhancedSolmate.getEnhancedPrompt(SYSTEM_PROMPT);
        }
        
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                messages: [
                    { role: 'system', content: systemPrompt }, 
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
        
        // Add to enhanced memory if available
        if (window.enhancedSolmate && window.enhancedSolmate.onChatMessage) {
            window.enhancedSolmate.onChatMessage(text, content);
        }
        
        // Animate talking
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
    
    // Window resize
    window.addEventListener('resize', () => {
        if (camera && renderer) {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        }
    });
    
    // Debug overlay
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'd') {
            e.preventDefault();
            const logs = document.getElementById('debugOverlay');
            if (logs) logs.classList.toggle('hidden');
        }
    });
    
    // Load conversation history
    try {
        const saved = localStorage.getItem('solmateConversation');
        if (saved) {
            conversation = JSON.parse(saved);
            log(`Loaded ${conversation.length} messages`);
        }
    } catch (err) {}
    
    // Enable audio
    document.addEventListener('click', enableAudio, { once: true });
    document.addEventListener('keydown', enableAudio, { once: true });
    
    // Mouse tracking for enhanced features
    document.addEventListener('mousemove', (event) => {
        if (window.enhancedSolmate && window.enhancedSolmate.onMouseMove) {
            window.enhancedSolmate.onMouseMove(event.clientX, event.clientY);
        }
        
        // Basic head tracking
        if (!animationState.isTalking && !animationState.isWaving) {
            const mouseX = (event.clientX / window.innerWidth) * 2 - 1;
            const mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
            animationState.headTarget.x = mouseY * 0.1;
            animationState.headTarget.y = mouseX * 0.2;
        }
    });
    
    document.addEventListener('mouseleave', () => {
        animationState.headTarget = { x: 0, y: 0 };
    });
    
    // Create enhanced UI controls
    createEnhancedUIControls();
}

function enableAudio() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContext.resume();
        log('Audio enabled');
    } catch (e) {}
}

// ===== ENHANCED UI CONTROLS =====
function createEnhancedUIControls() {
    const controlPanel = document.createElement('div');
    controlPanel.id = 'enhancedControls';
    controlPanel.style.cssText = `
        position: fixed;
        top: 70px;
        right: 20px;
        display: flex;
        gap: 8px;
        z-index: 100;
    `;
    
    const buttons = [
        { icon: '📷', mode: 'camera', title: 'Look at camera' },
        { icon: '🖱️', mode: 'mouse', title: 'Track mouse' },
        { icon: '👀', mode: 'idle', title: 'Idle look around' },
        { icon: '❌', mode: 'disabled', title: 'Disable look-at' },
        { icon: '🎤', mode: 'voice', title: 'Toggle voice detection' }
    ];
    
    buttons.forEach(btn => {
        const button = document.createElement('button');
        button.textContent = btn.icon;
        button.title = btn.title;
        button.className = 'icon-btn';
        button.onclick = () => {
            if (btn.mode === 'voice') {
                toggleVoiceDetection();
            } else {
                setLookAtMode(btn.mode);
            }
        };
        controlPanel.appendChild(button);
    });
    
    document.body.appendChild(controlPanel);
}

// ===== LOADING STATUS =====
function updateLoadingStatus(msg) {
    const el = document.getElementById('loadingStatus');
    if (el) {
        el.textContent = msg;
        if (msg.includes('Ready') || msg.includes('✅')) {
            setTimeout(() => { 
                el.style.display = 'none'; 
            }, 2000);
        }
    }
}

// ===== MAIN INIT =====
async function init() {
    log('🚀 Starting Solmate...');
    
    try {
        setupUI();
        
        fetchPrice();
        fetchTPS();
        setInterval(fetchPrice, 30000);
        setInterval(fetchTPS, 60000);
        
        updateLoadingStatus('Initializing...');
        await initializeVRMSystem();
        
        setupScene();
        animate();
        
        updateLoadingStatus('Loading avatar...');
        try {
            await loadVRMModel(VRM_PATH);
        } catch (err) {
            log('Using fallback avatar');
        }
        
        connectWebSocket();
        
        // Initialize enhanced features if available
        initializeEnhancedFeatures();
        
        updateLoadingStatus('✅ Ready!');
        
        setTimeout(() => {
            queueTTS("Hello! I'm Solmate, your Solana companion. Ask me anything!");
            setTimeout(playWave, 1000);
        }, 2000);
        
    } catch (err) {
        log('Init error:', err);
        updateLoadingStatus('Error - Check console');
        
        // Basic fallback
        setupUI();
        fetchPrice();
        fetchTPS();
        
        const fallback = document.createElement('div');
        fallback.style.cssText = `
            position: fixed; top: 50%; left: 50%;
            transform: translate(-50%, -50%); text-align: center;
            color: white; font-family: Arial, sans-serif;
        `;
        fallback.innerHTML = `
            <img src="/assets/logo/solmatelogo.png" style="width: 200px; height: auto;" onerror="this.style.display='none'">
            <h2>Solmate</h2>
            <p>Audio-only mode active</p>
        `;
        document.body.appendChild(fallback);
    }
}

// ===== ENHANCED FEATURES INITIALIZATION =====
function initializeEnhancedFeatures() {
    // This will be overridden by enhanced features if loaded
    log('Enhanced features placeholder initialized');
}

// ===== ENHANCED FEATURE FUNCTIONS =====
function setLookAtMode(mode) {
    if (window.enhancedSolmate && window.enhancedSolmate.setLookAtMode) {
        window.enhancedSolmate.setLookAtMode(mode);
    } else {
        log(`Look-at mode set to: ${mode} (enhanced features not loaded)`);
    }
}

function toggleVoiceDetection() {
    if (window.enhancedSolmate) {
        if (window.enhancedSolmate.voiceDetector && window.enhancedSolmate.voiceDetector.isListening) {
            window.enhancedSolmate.stopVoiceDetection();
            log('Voice detection stopped');
        } else {
            window.enhancedSolmate.startVoiceDetection();
            log('Voice detection started');
        }
    } else {
        log('Voice detection not available (enhanced features not loaded)');
    }
}

// ===== CLEANUP =====
window.addEventListener('beforeunload', () => {
    if (ws) ws.close();
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    if (priceUpdateTimer) clearInterval(priceUpdateTimer);
    if (tpsUpdateTimer) clearInterval(tpsUpdateTimer);
    clearAudioQueue();
    if (renderer) renderer.dispose();
    if (currentVRM && scene) scene.remove(currentVRM.scene);
});

// ===== DEBUG COMMANDS =====
window.debugVRM = function() {
    console.log('=== VRM DEBUG ===');
    console.log('VRM:', !!currentVRM);
    console.log('Scene:', !!scene);
    console.log('Camera:', !!camera);
    console.log('Renderer:', !!renderer);
    if (currentVRM) {
        console.log('Features:', {
            hasLookAt: !!currentVRM.lookAt,
            hasExpressions: !!currentVRM.expressionManager,
            hasHumanoid: !!currentVRM.humanoid,
            isMinimal: !!currentVRM.isMinimalVRM
        });
    }
    return { vrm: currentVRM, scene, camera, animationState };
};

window.testChat = function() {
    return sendMessage("Hello! How are you?");
};

window.testTTS = function() {
    queueTTS("Testing the text to speech system.", 'nova');
};

window.testExpression = function(expr = 'happy') {
    if (currentVRM && currentVRM.expressionManager) {
        try {
            currentVRM.expressionManager.setValue(expr, 0.8);
            setTimeout(() => {
                currentVRM.expressionManager.setValue(expr, 0);
            }, 2000);
            console.log(`Playing expression: ${expr}`);
        } catch (e) {
            console.log(`Expression not available: ${expr}`);
        }
    } else {
        console.log('No expression manager available');
    }
};

window.playWave = playWave;

window.reloadVRM = async function() {
    log('Reloading VRM...');
    const existing = scene?.getObjectByName('VRM_Model');
    if (existing) scene.remove(existing);
    try {
        await loadVRMModel(VRM_PATH);
        return 'VRM reloaded';
    } catch (err) {
        return 'Reload failed: ' + err.message;
    }
};

window.getMemoryStats = function() {
    if (window.enhancedSolmate && window.enhancedSolmate.memorySystem) {
        const memory = window.enhancedSolmate.memorySystem;
        return {
            interactions: memory.interactions.length,
            userProfile: memory.userProfile,
            emotionalState: memory.emotionalState
        };
    }
    return 'Enhanced features not loaded';
};

window.testEnhancedFeatures = function() {
    console.log('Testing enhanced features...');
    setLookAtMode('mouse');
    setTimeout(() => setLookAtMode('camera'), 2000);
    setTimeout(() => testExpression('happy'), 3000);
    setTimeout(() => testExpression('surprised'), 5000);
    setTimeout(() => playWave(), 7000);
    return 'Enhanced feature test started';
};

// Console messages
console.log('🚀 Solmate VRM System Loaded!');
console.log('🛠️ Commands: debugVRM(), testChat(), testTTS(), testExpression("happy"), playWave(), reloadVRM()');
console.log('🎭 Enhanced: testEnhancedFeatures(), setLookAtMode("mouse"), getMemoryStats()');

// ===== START APPLICATION =====
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
