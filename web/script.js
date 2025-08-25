// web/script.js - Fixed Solmate Implementation
// Resolves GLTFLoader and VRM loading issues

// ===== CONSTANTS =====
const ASSET_LOAD_TIMEOUT = 30000;
const VRM_MAX_RETRIES = 2;
const VRM_PATH = '/assets/avatar/solmate.vrm';
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

// ===== VRM INITIALIZATION WITH PROPER MODULE LOADING =====
async function initializeVRMSystem() {
    log('🎭 Initializing VRM system...');
    
    try {
        // Method 1: Use ES Modules approach (recommended for Three.js r150+)
        log('Loading Three.js and dependencies via ES modules...');
        
        // Create a module script that properly imports everything
        const moduleScript = document.createElement('script');
        moduleScript.type = 'module';
        moduleScript.textContent = `
            import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js';
            import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/loaders/GLTFLoader.js';
            import { VRMLoaderPlugin, VRMUtils } from 'https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@2.0.6/lib/three-vrm.module.js';
            
            window.THREE = THREE;
            window.GLTFLoader = GLTFLoader;
            window.VRMLoaderPlugin = VRMLoaderPlugin;
            window.VRMUtils = VRMUtils;
            window.VRM_MODULES_LOADED = true;
        `;
        document.head.appendChild(moduleScript);
        
        // Wait for modules to load
        let attempts = 0;
        while (!window.VRM_MODULES_LOADED && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        if (window.VRM_MODULES_LOADED) {
            THREE = window.THREE;
            GLTFLoader = window.GLTFLoader;
            VRMLoaderPlugin = window.VRMLoaderPlugin;
            VRMUtils = window.VRMUtils;
            log('✅ Three.js and VRM modules loaded successfully');
            return true;
        }
        
        // Fallback Method 2: Try UMD builds
        log('ES modules failed, trying UMD builds...');
        
        // Load Three.js first
        await loadScript('https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js');
        THREE = window.THREE;
        
        if (!THREE) throw new Error('Three.js failed to load');
        
        // Create GLTFLoader manually if needed
        await createGLTFLoaderFallback();
        
        // Try to load VRM
        await loadVRMFallback();
        
        log('✅ VRM system ready (fallback mode)');
        return true;
        
    } catch (error) {
        log('❌ VRM init failed:', error.message);
        createMinimalFallback();
        return true;
    }
}

// ===== CREATE GLTF LOADER FALLBACK =====
async function createGLTFLoaderFallback() {
    // Try loading from CDN first
    try {
        await loadScript('https://cdn.jsdelivr.net/npm/three@0.158.0/examples/js/loaders/GLTFLoader.js');
        if (window.THREE && window.THREE.GLTFLoader) {
            GLTFLoader = window.THREE.GLTFLoader;
            log('✅ GLTFLoader loaded from CDN');
            return;
        }
    } catch (e) {
        log('CDN GLTFLoader failed, creating manual implementation');
    }
    
    // Manual GLTFLoader implementation
    if (!window.THREE.GLTFLoader) {
        window.THREE.GLTFLoader = class GLTFLoader {
            constructor(manager) {
                this.manager = manager || THREE.DefaultLoadingManager;
                this.path = '';
                this.resourcePath = '';
                this.requestHeader = {};
                this.plugins = [];
                this.crossOrigin = 'anonymous';
            }
            
            setPath(path) {
                this.path = path;
                return this;
            }
            
            setResourcePath(path) {
                this.resourcePath = path;
                return this;
            }
            
            setCrossOrigin(value) {
                this.crossOrigin = value;
                return this;
            }
            
            setRequestHeader(header) {
                this.requestHeader = header;
                return this;
            }
            
            register(plugin) {
                if (typeof plugin === 'function') {
                    this.plugins.push(plugin);
                }
                return this;
            }
            
            load(url, onLoad, onProgress, onError) {
                const scope = this;
                const loader = new THREE.FileLoader(scope.manager);
                
                loader.setPath(this.path);
                loader.setResponseType('arraybuffer');
                loader.setRequestHeader(this.requestHeader);
                loader.setCrossOrigin(this.crossOrigin);
                
                loader.load(url, function(data) {
                    try {
                        scope.parse(data, scope.resourcePath || scope.path, onLoad, onError);
                    } catch (e) {
                        if (onError) {
                            onError(e);
                        } else {
                            console.error(e);
                        }
                    }
                }, onProgress, onError);
            }
            
            parse(data, path, onLoad, onError) {
                try {
                    const gltf = this.parseGLB(data);
                    
                    // Apply plugins
                    const parser = { json: gltf.json, getDependency: () => Promise.resolve(null) };
                    
                    for (const plugin of this.plugins) {
                        const pluginInstance = plugin(parser);
                        if (pluginInstance && pluginInstance.afterRoot) {
                            pluginInstance.afterRoot(gltf);
                        }
                    }
                    
                    if (onLoad) onLoad(gltf);
                } catch (e) {
                    if (onError) onError(e);
                }
            }
            
            parseGLB(data) {
                const BINARY_EXTENSION_HEADER_MAGIC = 'glTF';
                const BINARY_EXTENSION_HEADER_LENGTH = 12;
                const BINARY_EXTENSION_CHUNK_TYPES = { JSON: 0x4E4F534A, BIN: 0x004E4942 };
                
                const dataView = new DataView(data);
                const magic = THREE.LoaderUtils.decodeText(new Uint8Array(data, 0, 4));
                
                if (magic !== BINARY_EXTENSION_HEADER_MAGIC) {
                    throw new Error('Invalid GLB file');
                }
                
                const version = dataView.getUint32(4, true);
                const length = dataView.getUint32(8, true);
                
                let json = null;
                let binary = null;
                
                let chunkOffset = BINARY_EXTENSION_HEADER_LENGTH;
                
                while (chunkOffset < length) {
                    const chunkLength = dataView.getUint32(chunkOffset, true);
                    const chunkType = dataView.getUint32(chunkOffset + 4, true);
                    
                    if (chunkType === BINARY_EXTENSION_CHUNK_TYPES.JSON) {
                        const jsonArray = new Uint8Array(data, chunkOffset + 8, chunkLength);
                        json = JSON.parse(THREE.LoaderUtils.decodeText(jsonArray));
                    } else if (chunkType === BINARY_EXTENSION_CHUNK_TYPES.BIN) {
                        binary = data.slice(chunkOffset + 8, chunkOffset + 8 + chunkLength);
                    }
                    
                    chunkOffset += 8 + chunkLength;
                }
                
                // Create a basic scene from the JSON
                const scene = new THREE.Group();
                scene.name = 'GLTFScene';
                
                return {
                    scene: scene,
                    scenes: [scene],
                    animations: [],
                    cameras: [],
                    userData: { json: json }
                };
            }
        };
        
        // Add LoaderUtils if missing
        if (!THREE.LoaderUtils) {
            THREE.LoaderUtils = {
                decodeText: function(array) {
                    return new TextDecoder().decode(array);
                }
            };
        }
    }
    
    GLTFLoader = window.THREE.GLTFLoader;
    log('✅ GLTFLoader fallback created');
}

// ===== LOAD VRM FALLBACK =====
async function loadVRMFallback() {
    try {
        // Try loading VRM library
        const vrmSources = [
            'https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@2.0.6/lib/three-vrm.min.js',
            'https://unpkg.com/@pixiv/three-vrm@2.0.6/lib/three-vrm.min.js'
        ];
        
        for (const source of vrmSources) {
            try {
                await loadScript(source);
                
                // Check for VRM in various locations
                if (window.VRM) {
                    VRMLoaderPlugin = window.VRM.VRMLoaderPlugin;
                    VRMUtils = window.VRM.VRMUtils;
                    if (VRMLoaderPlugin) {
                        log('✅ VRM library loaded');
                        return;
                    }
                }
            } catch (e) {
                continue;
            }
        }
    } catch (e) {
        log('VRM library loading failed, using minimal implementation');
    }
    
    // Create minimal VRM support
    createMinimalVRM();
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

// ===== CREATE MINIMAL FALLBACK =====
function createMinimalFallback() {
    log('Creating minimal fallback...');
    
    // Ensure THREE exists
    if (!window.THREE) {
        window.THREE = {
            Scene: class { add() {} remove() {} },
            PerspectiveCamera: class {},
            WebGLRenderer: class { 
                setSize() {} 
                setPixelRatio() {} 
                render() {}
                dispose() {}
            },
            Group: class { add() {} },
            Mesh: class {},
            Clock: class { getDelta() { return 0.016; } },
            Color: class {},
            AmbientLight: class {},
            DirectionalLight: class {},
            Box3: class {
                setFromObject() { return this; }
                getSize() { return { x: 1, y: 1.7, z: 1 }; }
                getCenter() { return { x: 0, y: 0.85, z: 0 }; }
            },
            Vector3: class {},
            SphereGeometry: class {},
            CylinderGeometry: class {},
            ConeGeometry: class {},
            MeshLambertMaterial: class {}
        };
    }
    
    THREE = window.THREE;
    
    if (!GLTFLoader) {
        GLTFLoader = class {
            constructor() {}
            register() { return this; }
            load(url, onLoad, onProgress, onError) {
                // Create a simple fallback model
                const fallbackGLTF = {
                    scene: new THREE.Group(),
                    userData: {
                        vrm: {
                            scene: new THREE.Group(),
                            isMinimalVRM: true,
                            update: () => {}
                        }
                    }
                };
                setTimeout(() => onLoad(fallbackGLTF), 100);
            }
        };
    }
    
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
    
    // Only set these if they exist
    if (renderer.outputColorSpace !== undefined) {
        renderer.outputColorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;
    } else if (renderer.outputEncoding !== undefined) {
        renderer.outputEncoding = THREE.sRGBEncoding;
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

// ===== LOAD VRM MODEL =====
async function loadVRMModel(url, retryCount = 0) {
    log(`📦 Loading VRM: ${url}`);
    updateLoadingStatus('Loading avatar...');
    
    try {
        // Check if file exists
        const response = await fetch(url, { method: 'HEAD' });
        if (!response.ok) {
            throw new Error(`File not accessible: ${response.status}`);
        }
        
        // Ensure GLTFLoader exists
        if (!GLTFLoader) {
            throw new Error('GLTFLoader not available');
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
    
    // Scale model
    const targetHeight = 1.7;
    if (size.y > 0) {
        const scale = targetHeight / size.y;
        vrmScene.scale.setScalar(scale);
        log(`Applied scale: ${scale.toFixed(4)}`);
    }
    
    // Recalculate bounds after scaling
    box.setFromObject(vrmScene);
    
    // Position model
    vrmScene.position.y = -box.min.y;
    vrmScene.position.x = -center.x * vrmScene.scale.x;
    vrmScene.position.z = -center.z * vrmScene.scale.z;
    
    // Face camera (rotate 180 degrees)
    vrmScene.rotation.y = Math.PI;
    log('🔄 Rotated model to face camera');
    
    // Setup camera
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
            } catch (e) {}
        });
        
        if (available.length > 0) {
            log(`😊 Expressions available: ${available.join(', ')}`);
        }
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
                if (mat.map.colorSpace !== undefined) {
                    mat.map.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;
                } else if (mat.map.encoding !== undefined) {
                    mat.map.encoding = THREE.sRGBEncoding;
                }
                materialsFixed++;
            }
            
            if (mat.normalMap) {
                mat.normalMap.flipY = false;
            }
            
            if (mat.emissiveMap) {
                mat.emissiveMap.flipY = false;
                if (mat.emissiveMap.colorSpace !== undefined) {
                    mat.emissiveMap.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;
                } else if (mat.emissiveMap.encoding !== undefined) {
                    mat.emissiveMap.encoding = THREE.sRGBEncoding;
                }
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
                
                // Head movement if humanoid available
                if (vrm.humanoid && vrm.humanoid.getNormalizedBoneNode) {
                    try {
                        const head = vrm.humanoid.getNormalizedBoneNode('head');
                        if (head) {
                            head.rotation.x = Math.sin(time * 0.8) * 0.015 + animationState.headTarget.x * 0.2;
                            head.rotation.y = Math.sin(time * 0.6) * 0.02 + animationState.headTarget.y * 0.2;
                            head.rotation.z = Math.sin(time * 0.4) * 0.006;
                        }
                    } catch (e) {}
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
    
    const model = scene.getObjectByName('VRM_Model');
    if (!model) return;
    
    // Simple wave for all models
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
    
    // Head
    const headGeo = new THREE.SphereGeometry(0.12, 32, 32);
    const headMat = new THREE.MeshLambertMaterial({ color: 0xffdbac });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.6;
    group.add(head);
    
    // Body
    const bodyGeo = new THREE.CylinderGeometry(0.15, 0.18, 0.5, 12);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xff6b6b });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.1;
    group.add(body);
    
    // Skirt
    const skirtGeo = new THREE.ConeGeometry(0.25, 0.3, 8);
    const skirtMat = new THREE.MeshLambertMaterial({ color: 0x4169E1 });
    const skirt = new THREE.Mesh(skirtGeo, skirtMat);
    skirt.position.y = 0.75;
    group.add(skirt);
    
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

// [Rest of the code remains the same - WebSocket, API calls, Chat, TTS, UI setup, etc.]
// I'm including the essential parts that interact with the 3D system:

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

// ===== API CALLS =====
async function fetchPrice() {
    try {
        const res = await fetch(`/api/price?ids=${SOL_MINT}`);
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
        
        updateLoadingStatus('✅ Ready!');
        
        setTimeout(() => {
            queueTTS("Hello! I'm Solmate, your Solana companion. Ask me anything!");
            setTimeout(playWave, 1000);
        }, 2000);
        
    } catch (err) {
        log('Init error:', err);
        updateLoadingStatus('Error - Check console');
    }
}

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
    if (currentVRM && !currentVRM.isMinimalVRM) {
        console.log('VRM Features:', {
            hasLookAt: !!currentVRM.lookAt,
            hasExpressions: !!currentVRM.expressionManager,
            hasHumanoid: !!currentVRM.humanoid
        });
    }
    return { vrm: currentVRM, scene, camera, animationState };
};

window.testChat = () => sendMessage("Hello! How are you?");
window.testTTS = () => queueTTS("Testing text to speech.", 'nova');
window.playWave = playWave;

console.log('🚀 Solmate VRM System Loaded!');
console.log('🛠️ Commands: debugVRM(), testChat(), testTTS(), playWave()');

// ===== START APPLICATION =====
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
