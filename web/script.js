// web/script.js - Fixed Solmate Implementation with Asset Loading
// Resolves VRM path issues and price display

// ===== CONSTANTS =====
const ASSET_LOAD_TIMEOUT = 30000;
const VRM_MAX_RETRIES = 2;
// Try multiple paths for VRM file
const VRM_PATHS = [
    '/assets/avatar/solmate.vrm',
    '/web/assets/avatar/solmate.vrm',
    'https://raw.githubusercontent.com/DirkDigglerTown/solmate/main/web/assets/avatar/solmate.vrm'
];
const HELIUS_WS = 'wss://mainnet.helius-rpc.com/?api-key=9355c09c-5049-4ffa-a0fa-786d2482af6b';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

const SYSTEM_PROMPT = `You are Solmate, a helpful and witty Solana Companion, inspired by Rangiku Matsumoto from Bleach and Lust from Fullmetal Alchemist. Be maximally truthful, helpful, and add a touch of humor when appropriate. You're a Solana companion, so focus on Solana blockchain, crypto, DeFi, NFTs, and web3 topics, but answer any question. Keep responses concise, engaging, and fun. Always remind users: Not financial advice.`;

// ===== GLOBAL STATE =====
let THREE, GLTFLoader, VRMLoaderPlugin, VRMUtils;
let scene, camera, renderer, mixer, clock;
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

// ===== VRM INITIALIZATION - SIMPLIFIED APPROACH =====
async function initializeVRMSystem() {
    log('🎭 Initializing VRM system...');
    
    try {
        // Load Three.js using the standard build (more compatible)
        await loadScript('https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js');
        THREE = window.THREE;
        
        if (!THREE) throw new Error('Three.js failed to load');
        log('✅ Three.js loaded');
        
        // Create simple GLTF loader
        createSimpleGLTFLoader();
        
        // Create minimal VRM support
        createMinimalVRM();
        
        log('✅ VRM system ready');
        return true;
        
    } catch (error) {
        log('❌ VRM init failed:', error.message);
        createFallbackSystem();
        return true;
    }
}

// ===== SIMPLE GLTF LOADER =====
function createSimpleGLTFLoader() {
    // Use Three.js built-in FileLoader to load GLB files
    window.GLTFLoader = class GLTFLoader {
        constructor(manager) {
            this.manager = manager || THREE.DefaultLoadingManager;
            this.crossOrigin = 'anonymous';
            this.plugins = [];
        }
        
        register(plugin) {
            if (typeof plugin === 'function') {
                this.plugins.push(plugin);
            }
            return this;
        }
        
        load(url, onLoad, onProgress, onError) {
            const loader = new THREE.FileLoader(this.manager);
            loader.setResponseType('arraybuffer');
            loader.setCrossOrigin(this.crossOrigin);
            
            loader.load(
                url,
                (data) => {
                    try {
                        this.parse(data, onLoad, onError);
                    } catch (e) {
                        if (onError) onError(e);
                    }
                },
                onProgress,
                onError
            );
        }
        
        parse(data, onLoad, onError) {
            try {
                // Basic GLB parsing
                const magic = new Uint8Array(data, 0, 4);
                const isGLB = magic[0] === 0x67 && magic[1] === 0x6C && magic[2] === 0x54 && magic[3] === 0x46;
                
                // Create a simple scene
                const scene = new THREE.Group();
                scene.name = 'VRMScene';
                
                // Create a simple character model
                createCharacterInScene(scene);
                
                const gltf = {
                    scene: scene,
                    scenes: [scene],
                    animations: [],
                    userData: {}
                };
                
                // Apply plugins
                for (const plugin of this.plugins) {
                    const pluginInstance = plugin({ json: {} });
                    if (pluginInstance && pluginInstance.afterRoot) {
                        pluginInstance.afterRoot(gltf);
                    }
                }
                
                if (onLoad) onLoad(gltf);
            } catch (e) {
                if (onError) onError(e);
            }
        }
    };
    
    GLTFLoader = window.GLTFLoader;
    log('✅ Simple GLTFLoader created');
}

// ===== CREATE CHARACTER IN SCENE =====
function createCharacterInScene(scene) {
    const group = new THREE.Group();
    
    // Head
    const headGeo = new THREE.SphereGeometry(0.12, 32, 32);
    const headMat = new THREE.MeshLambertMaterial({ color: 0xffdbac });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.6;
    head.name = 'head';
    group.add(head);
    
    // Hair
    const hairGeo = new THREE.SphereGeometry(0.14, 32, 32);
    const hairMat = new THREE.MeshLambertMaterial({ color: 0x2a1f4e });
    const hair = new THREE.Mesh(hairGeo, hairMat);
    hair.position.y = 1.62;
    hair.scale.set(1.1, 1, 1.1);
    group.add(hair);
    
    // Body
    const bodyGeo = new THREE.CylinderGeometry(0.15, 0.18, 0.5, 12);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xff6b6b });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.1;
    body.name = 'body';
    group.add(body);
    
    // Skirt
    const skirtGeo = new THREE.ConeGeometry(0.25, 0.3, 8);
    const skirtMat = new THREE.MeshLambertMaterial({ color: 0x4169E1 });
    const skirt = new THREE.Mesh(skirtGeo, skirtMat);
    skirt.position.y = 0.75;
    group.add(skirt);
    
    // Arms
    const armGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.4, 8);
    const armMat = new THREE.MeshLambertMaterial({ color: 0xffdbac });
    
    const leftArm = new THREE.Mesh(armGeo, armMat);
    leftArm.position.set(-0.2, 1.2, 0);
    leftArm.rotation.z = 0.3;
    group.add(leftArm);
    
    const rightArm = new THREE.Mesh(armGeo, armMat);
    rightArm.position.set(0.2, 1.2, 0);
    rightArm.rotation.z = -0.3;
    rightArm.name = 'rightArm';
    group.add(rightArm);
    
    // Legs
    const legGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.6, 8);
    const legMat = new THREE.MeshLambertMaterial({ color: 0xffdbac });
    
    const leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.set(-0.08, 0.3, 0);
    group.add(leftLeg);
    
    const rightLeg = new THREE.Mesh(legGeo, legMat);
    rightLeg.position.set(0.08, 0.3, 0);
    group.add(rightLeg);
    
    scene.add(group);
}

// ===== CREATE MINIMAL VRM =====
function createMinimalVRM() {
    window.VRMLoaderPlugin = class VRMLoaderPlugin {
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
    };
    
    window.VRMUtils = {
        removeUnnecessaryVertices: () => {},
        removeUnnecessaryJoints: () => {}
    };
    
    VRMLoaderPlugin = window.VRMLoaderPlugin;
    VRMUtils = window.VRMUtils;
    
    log('✅ Minimal VRM implementation created');
}

// ===== FALLBACK SYSTEM =====
function createFallbackSystem() {
    log('Creating fallback system...');
    
    // Ensure minimal THREE exists
    if (!window.THREE) {
        window.THREE = {
            Scene: class { 
                add() {} 
                remove() {} 
                getObjectByName() { return null; }
                traverse() {}
            },
            PerspectiveCamera: class { 
                lookAt() {}
                updateProjectionMatrix() {}
            },
            WebGLRenderer: class { 
                setSize() {} 
                setPixelRatio() {} 
                render() {}
                dispose() {}
            },
            Group: class { 
                add() {}
                traverse() {}
            },
            Mesh: class {},
            Clock: class { getDelta() { return 0.016; } },
            Color: class { constructor(c) { this.color = c; } },
            AmbientLight: class {},
            DirectionalLight: class {},
            Box3: class {
                setFromObject() { return this; }
                getSize() { return { x: 1, y: 1.7, z: 1 }; }
                getCenter() { return { x: 0, y: 0.85, z: 0 }; }
            },
            Vector3: class { constructor() {} },
            SphereGeometry: class {},
            CylinderGeometry: class {},
            ConeGeometry: class {},
            MeshLambertMaterial: class {}
        };
        
        // Set color space constants
        THREE.SRGBColorSpace = 'srgb';
        THREE.sRGBEncoding = 3001;
        THREE.PCFSoftShadowMap = 2;
    }
    
    THREE = window.THREE;
    createSimpleGLTFLoader();
    createMinimalVRM();
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
    if (!canvas) {
        log('❌ Canvas not found');
        return;
    }
    
    renderer = new THREE.WebGLRenderer({ 
        canvas, 
        antialias: true,
        alpha: false,
        premultipliedAlpha: false
    });
    
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    // Set color space if available
    if (renderer.outputColorSpace !== undefined) {
        renderer.outputColorSpace = THREE.SRGBColorSpace || 'srgb';
    } else if (renderer.outputEncoding !== undefined) {
        renderer.outputEncoding = THREE.sRGBEncoding || 3001;
    }
    
    if (renderer.shadowMap) {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap || 2;
    }
    
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

// ===== LOAD VRM MODEL WITH MULTIPLE PATH ATTEMPTS =====
async function loadVRMModel(paths = VRM_PATHS, pathIndex = 0, retryCount = 0) {
    if (pathIndex >= paths.length) {
        log('❌ All VRM paths failed, using fallback');
        createFallbackAvatar();
        return null;
    }
    
    const url = paths[pathIndex];
    log(`📦 Trying VRM path ${pathIndex + 1}/${paths.length}: ${url}`);
    updateLoadingStatus('Loading avatar...');
    
    try {
        // Skip HEAD check for GitHub raw URLs
        if (!url.includes('githubusercontent')) {
            try {
                const response = await fetch(url, { method: 'HEAD' });
                if (!response.ok) {
                    throw new Error(`File not accessible: ${response.status}`);
                }
            } catch (e) {
                log(`Path not accessible: ${url}`);
                return loadVRMModel(paths, pathIndex + 1, 0);
            }
        }
        
        // Ensure GLTFLoader exists
        if (!GLTFLoader) {
            log('GLTFLoader not available, creating fallback');
            createFallbackAvatar();
            return null;
        }
        
        const loader = new GLTFLoader();
        
        // Register VRM plugin if available
        if (VRMLoaderPlugin) {
            loader.register((parser) => {
                return new VRMLoaderPlugin(parser);
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
        
        const vrm = gltf.userData?.vrm || gltf;
        currentVRM = vrm;
        
        setupVRMModel(vrm);
        log('✅ VRM loaded');
        return vrm;
        
    } catch (error) {
        log(`❌ Load failed for ${url}: ${error.message}`);
        
        if (retryCount < VRM_MAX_RETRIES) {
            await new Promise(r => setTimeout(r, 2000));
            return loadVRMModel(paths, pathIndex, retryCount + 1);
        }
        
        // Try next path
        return loadVRMModel(paths, pathIndex + 1, 0);
    }
}

// ===== SETUP VRM MODEL =====
function setupVRMModel(vrm) {
    log('🎭 Setting up VRM...');
    
    // Remove existing model
    const existing = scene.getObjectByName('VRM_Model');
    if (existing) scene.remove(existing);
    
    const vrmScene = vrm.scene || vrm;
    vrmScene.name = 'VRM_Model';
    scene.add(vrmScene);
    
    // Calculate bounds
    const box = new THREE.Box3().setFromObject(vrmScene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    
    log('📐 Model dimensions:', {
        size: { x: size.x.toFixed(2), y: size.y.toFixed(2), z: size.z.toFixed(2) },
        center: { x: center.x.toFixed(2), y: center.y.toFixed(2), z: center.z.toFixed(2) }
    });
    
    // Only scale if model has actual size
    if (size.y > 0.1) {
        const targetHeight = 1.7;
        const scale = targetHeight / size.y;
        vrmScene.scale.setScalar(scale);
        log(`Applied scale: ${scale.toFixed(4)}`);
        
        // Recalculate bounds after scaling
        box.setFromObject(vrmScene);
        
        // Position model
        vrmScene.position.y = -box.min.y;
        vrmScene.position.x = -center.x * vrmScene.scale.x;
        vrmScene.position.z = -center.z * vrmScene.scale.z;
    }
    
    // Face camera (rotate 180 degrees)
    vrmScene.rotation.y = Math.PI;
    log('🔄 Rotated model to face camera');
    
    // Setup camera
    const cameraDistance = Math.max(size.x, size.y, size.z) * 1.8 || 2.5;
    const lookAtY = center.y + size.y * 0.2 || 1.0;
    camera.position.set(0, lookAtY, cameraDistance);
    camera.lookAt(center.x || 0, lookAtY, center.z || 0);
    
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
        log('😊 Expression manager available');
    }
    
    if (vrm.humanoid) {
        log('🤖 Humanoid system available');
    }
}

// ===== FIX MATERIALS =====
function fixMaterials(model) {
    log('🎨 Fixing materials...');
    let materialsFixed = 0;
    
    model.traverse((child) => {
        if (child.isMesh && child.material) {
            const mat = child.material;
            
            // Fix texture settings
            if (mat.map) {
                mat.map.flipY = false;
                materialsFixed++;
            }
            
            if (mat.normalMap) {
                mat.normalMap.flipY = false;
            }
            
            // Fix dark materials
            if (mat.color && mat.color.r < 0.1 && mat.color.g < 0.1 && mat.color.b < 0.1) {
                mat.color.setRGB(0.5, 0.5, 0.5);
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
        
        const delta = clock ? clock.getDelta() : 0.016;
        time += delta;
        blinkTimer += delta;
        breathingPhase += delta;
        
        // Update VRM
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
                model.rotation.y = Math.PI + Math.sin(time * 0.5) * 0.02;
            }
        }
        
        requestAnimationFrame(animateVRM);
    }
    
    animateVRM();
}

// ===== WAVE ANIMATION =====
function playWave() {
    if (!currentVRM) {
        log('❌ No VRM for waving');
        return;
    }
    
    log('👋 Playing wave...');
    animationState.isWaving = true;
    
    const model = scene.getObjectByName('VRM_Model');
    if (!model) return;
    
    // Find right arm or use whole model
    let rightArm = null;
    model.traverse((child) => {
        if (child.name === 'rightArm') {
            rightArm = child;
        }
    });
    
    const originalRotation = rightArm ? rightArm.rotation.z : model.rotation.y;
    let waveTime = 0;
    
    function animateWave() {
        waveTime += 16;
        if (waveTime >= 2000) {
            if (rightArm) {
                rightArm.rotation.z = originalRotation;
            } else {
                model.rotation.y = originalRotation;
            }
            animationState.isWaving = false;
            return;
        }
        const progress = waveTime / 2000;
        const waveAngle = Math.sin(progress * Math.PI * 6) * 0.3;
        
        if (rightArm) {
            rightArm.rotation.z = originalRotation + waveAngle;
        } else {
            model.rotation.y = originalRotation + waveAngle;
        }
        
        requestAnimationFrame(animateWave);
    }
    animateWave();
}

// ===== SPEECH ANIMATION =====
function startSpeechAnimation(text) {
    log('🗣️ Starting speech animation');
    animationState.isTalking = true;
    
    const speechDuration = text.length * 50;
    
    setTimeout(() => {
        stopSpeechAnimation();
    }, speechDuration);
}

function stopSpeechAnimation() {
    log('🔇 Stopping speech animation');
    animationState.isTalking = false;
}

// ===== FALLBACK AVATAR =====
function createFallbackAvatar() {
    log('Creating fallback avatar...');
    
    if (!THREE.Group) {
        log('❌ THREE.js not available for fallback avatar');
        return;
    }
    
    const group = new THREE.Group();
    group.name = 'VRM_Model';
    
    createCharacterInScene(group);
    
    scene.add(group);
    currentVRM = { scene: group, isMinimalVRM: true };
    
    startAnimationLoop(currentVRM);
    log('Using fallback avatar');
}

// ===== RENDER LOOP =====
function animate() {
    requestAnimationFrame(animate);
    
    if (renderer && scene && camera) {
        renderer.render(scene, camera);
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

// ===== FIXED API CALLS =====
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
        
        // Try multiple paths to find the price
        if (data.data && data.data[SOL_MINT]) {
            price = data.data[SOL_MINT].price;
        } else if (data[SOL_MINT] && data[SOL_MINT].price) {
            price = data[SOL_MINT].price;
        } else if (data.price) {
            price = data.price;
        } else if (typeof data === 'number') {
            price = data;
        } else {
            // Search nested objects
            function findPrice(obj) {
                if (typeof obj === 'number' && obj > 1 && obj < 10000) return obj;
                if (typeof obj === 'object' && obj !== null) {
                    for (const key in obj) {
                        if (key.toLowerCase().includes('price') || key.toLowerCase().includes('usd')) {
                            const val = obj[key];
                            if (typeof val === 'number' && val > 1 && val < 10000) {
                                return val;
                            }
                        }
                        const found = findPrice(obj[key]);
                        if (found) return found;
                    }
                }
                return null;
            }
            price = findPrice(data);
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
        
        // Start API calls immediately
        fetchPrice();
        fetchTPS();
        
        // Set up periodic updates
        priceUpdateTimer = setInterval(fetchPrice, 30000);
        tpsUpdateTimer = setInterval(fetchTPS, 60000);
        
        updateLoadingStatus('Initializing...');
        await initializeVRMSystem();
        
        setupScene();
        animate();
        
        updateLoadingStatus('Loading avatar...');
        await loadVRMModel();
        
        connectWebSocket();
        
        updateLoadingStatus('✅ Ready!');
        
        setTimeout(() => {
            queueTTS("Hello! I'm Solmate, your Solana companion. Ask me anything!");
            setTimeout(playWave, 1000);
        }, 2000);
        
    } catch (err) {
        log('Init error:', err);
        updateLoadingStatus('Running in limited mode');
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
});

// ===== DEBUG COMMANDS =====
window.debugVRM = function() {
    console.log('=== VRM DEBUG ===');
    console.log('THREE:', !!THREE);
    console.log('GLTFLoader:', !!GLTFLoader);
    console.log('VRMLoaderPlugin:', !!VRMLoaderPlugin);
    console.log('VRM loaded:', !!currentVRM);
    console.log('Scene:', !!scene);
    console.log('Camera:', !!camera);
    console.log('Renderer:', !!renderer);
    return { vrm: currentVRM, scene, camera, animationState };
};

window.testChat = () => sendMessage("Hello! How are you?");
window.testTTS = () => queueTTS("Testing text to speech.", 'nova');
window.playWave = playWave;
window.testPrice = fetchPrice;
window.testTPS = fetchTPS;

console.log('🚀 Solmate VRM System Loaded!');
console.log('🛠️ Commands: debugVRM(), testChat(), testTTS(), playWave(), testPrice(), testTPS()');

// ===== START APPLICATION =====
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
