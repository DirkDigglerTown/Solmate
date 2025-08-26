// web/js/VRMLoader.js
// Dedicated VRM loading module with natural animations and proper arm positioning

import { EventEmitter } from './EventEmitter.js';

export class VRMLoader extends EventEmitter {
    constructor() {
        super();
        
        this.state = {
            initialized: false,
            loading: false,
            loaded: false,
            error: null
        };
        
        this.three = {
            scene: null,
            camera: null,
            renderer: null,
            clock: null,
            lights: []
        };
        
        this.vrm = {
            current: null,
            mixer: null,
            animations: new Map()
        };
        
        this.animation = {
            isWaving: false,
            isTalking: false,
            headTarget: { x: 0, y: 0 },
            blinkTimer: 0,
            breathingPhase: 0,
            idleTimer: 0,
            gestureTimer: 0,
            currentExpression: 'neutral',
            expressionIntensity: 0,
            targetExpression: 'neutral',
            targetIntensity: 0,
            transitionSpeed: 0.05,
            lastGestureTime: 0,
            swayPhase: 0,
            armSwayPhase: 0,
            microMovementTimer: 0,
            shoulderRelaxTimer: 0
        };
        
        this.config = {
            paths: [
                '/assets/avatar/solmate.vrm',
                'https://raw.githubusercontent.com/DirkDigglerTown/solmate/main/web/assets/avatar/solmate.vrm'
            ],
            fallbackEnabled: true,
            // Adjusted positioning - model higher, camera backed up more
            cameraPosition: { x: 0, y: 4.2, z: 7.5 },   // Camera backed up to 7.5, slightly higher
            lookAtPosition: { x: 0, y: 4.2, z: 0 },     // Look at chest level
            modelPosition: { x: 0, y: 4.8, z: 0 }       // Model raised to 4.8
        };
    }
    
    async init() {
        if (this.state.initialized) {
            console.warn('VRMLoader already initialized');
            return;
        }
        
        try {
            this.emit('init:start');
            
            // Inject Three.js and VRM modules
            await this.injectModules();
            
            // Wait for modules to load
            await this.waitForModules();
            
            // Initialize Three.js scene
            await this.initializeScene();
            
            // Load VRM model
            await this.loadVRM();
            
            // Start animation loop
            this.startAnimationLoop();
            
            this.state.initialized = true;
            this.emit('init:complete');
            
        } catch (error) {
            this.state.error = error;
            this.emit('error', error);
            
            if (this.config.fallbackEnabled) {
                this.createFallbackAvatar();
            }
            
            throw error;
        }
    }
    
    async injectModules() {
        // Check if modules already exist
        if (window.THREE && window.VRMLoaderPlugin) {
            return;
        }
        
        // Inject import map
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
        
        // Create module loader
        const moduleScript = document.createElement('script');
        moduleScript.type = 'module';
        moduleScript.id = 'vrm-module-loader';
        moduleScript.textContent = `
            import * as THREE from 'three';
            import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
            import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
            
            window.THREE = THREE;
            window.GLTFLoader = GLTFLoader;
            window.VRMLoaderPlugin = VRMLoaderPlugin;
            window.VRMUtils = VRMUtils;
            window.VRM_MODULES_LOADED = true;
        `;
        document.head.appendChild(moduleScript);
    }
    
    async waitForModules(maxAttempts = 50) {
        for (let i = 0; i < maxAttempts; i++) {
            if (window.VRM_MODULES_LOADED) {
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('Failed to load Three.js/VRM modules');
    }
    
    async initializeScene() {
        const THREE = window.THREE;
        
        // Create scene
        this.three.scene = new THREE.Scene();
        this.three.scene.background = new THREE.Color(0x0a0e17);
        
        // Create camera with proper positioning
        this.three.camera = new THREE.PerspectiveCamera(
            50,  // Wide FOV to capture full height
            window.innerWidth / window.innerHeight,
            0.1,
            20
        );
        // Set camera to proper position immediately
        this.three.camera.position.set(
            this.config.cameraPosition.x,
            this.config.cameraPosition.y,
            this.config.cameraPosition.z
        );
        this.three.camera.lookAt(
            this.config.lookAtPosition.x,
            this.config.lookAtPosition.y,
            this.config.lookAtPosition.z
        );
        
        // Create renderer
        const canvas = document.getElementById('vrmCanvas');
        if (!canvas) {
            throw new Error('Canvas element not found');
        }
        
        this.three.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance'
        });
        
        this.three.renderer.setSize(window.innerWidth, window.innerHeight);
        this.three.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.three.renderer.shadowMap.enabled = true;
        this.three.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.three.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.three.renderer.toneMappingExposure = 1;
        
        // Add lights
        this.setupLighting();
        
        // Create clock
        this.three.clock = new THREE.Clock();
        
        // Handle window resize
        window.addEventListener('resize', () => this.handleResize());
        
        this.emit('scene:created');
    }
    
    setupLighting() {
        const THREE = window.THREE;
        
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.three.scene.add(ambientLight);
        this.three.lights.push(ambientLight);
        
        // Main directional light
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(1, 1, 1);
        directionalLight.castShadow = true;
        directionalLight.shadow.camera.top = 2;
        directionalLight.shadow.camera.bottom = -2;
        directionalLight.shadow.camera.left = -2;
        directionalLight.shadow.camera.right = 2;
        directionalLight.shadow.mapSize.set(2048, 2048);
        this.three.scene.add(directionalLight);
        this.three.lights.push(directionalLight);
        
        // Fill light
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
        fillLight.position.set(-1, 0.5, -1);
        this.three.scene.add(fillLight);
        this.three.lights.push(fillLight);
    }
    
    async loadVRM() {
        if (this.state.loading) {
            console.warn('VRM already loading');
            return;
        }
        
        this.state.loading = true;
        this.emit('load:start');
        
        const GLTFLoader = window.GLTFLoader;
        const VRMLoaderPlugin = window.VRMLoaderPlugin;
        
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));
        
        let loaded = false;
        let lastError = null;
        
        for (const path of this.config.paths) {
            if (loaded) break;
            
            try {
                console.log(`Attempting to load VRM from: ${path}`);
                const gltf = await this.loadWithTimeout(loader, path, 30000);
                
                if (gltf.userData.vrm) {
                    await this.setupVRM(gltf.userData.vrm);
                    loaded = true;
                    this.state.loaded = true;
                    this.emit('load:complete', this.vrm.current);
                    console.log(`Successfully loaded VRM from: ${path}`);
                }
            } catch (error) {
                console.error(`Failed to load VRM from ${path}:`, error);
                lastError = error;
            }
        }
        
        this.state.loading = false;
        
        if (!loaded) {
            this.state.error = lastError;
            this.emit('error', lastError);
            
            if (this.config.fallbackEnabled) {
                this.createFallbackAvatar();
            } else {
                throw lastError;
            }
        }
    }
    
    loadWithTimeout(loader, url, timeout) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error(`Loading timeout for ${url}`));
            }, timeout);
            
            loader.load(
                url,
                (gltf) => {
                    clearTimeout(timeoutId);
                    resolve(gltf);
                },
                (progress) => {
                    this.emit('load:progress', {
                        url,
                        loaded: progress.loaded,
                        total: progress.total
                    });
                },
                (error) => {
                    clearTimeout(timeoutId);
                    reject(error);
                }
            );
        });
    }
    
    async setupVRM(vrm) {
        // Remove existing VRM
        if (this.vrm.current) {
            this.three.scene.remove(this.vrm.current.scene);
            if (window.VRMUtils) {
                window.VRMUtils.deepDispose(this.vrm.current.scene);
            }
        }
        
        // Setup new VRM
        this.vrm.current = vrm;
        
        // Rotate to face camera
        vrm.scene.rotation.y = Math.PI;
        
        // Position the model higher on screen
        vrm.scene.position.set(
            this.config.modelPosition.x,
            this.config.modelPosition.y,
            this.config.modelPosition.z
        );
        
        // Add to scene
        this.three.scene.add(vrm.scene);
        
        // Setup humanoid with PROPER NATURAL POSE
        if (vrm.humanoid) {
            const hips = vrm.humanoid.getNormalizedBoneNode('hips');
            if (hips) {
                hips.position.set(0, 0, 0);
            }
            
            // === CRITICAL FIX: Natural relaxed arm position ===
            const leftUpperArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
            const rightUpperArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
            const leftLowerArm = vrm.humanoid.getNormalizedBoneNode('leftLowerArm');
            const rightLowerArm = vrm.humanoid.getNormalizedBoneNode('rightLowerArm');
            const leftHand = vrm.humanoid.getNormalizedBoneNode('leftHand');
            const rightHand = vrm.humanoid.getNormalizedBoneNode('rightHand');
            
            // Natural relaxed arm position - arms at sides, not straight out
            if (leftUpperArm) {
                leftUpperArm.rotation.z = 0.7;  // Arm down at side (was 0.6)
                leftUpperArm.rotation.x = 0.15;  // Slightly forward
                leftUpperArm.rotation.y = 0.05;  // Very slight outward angle
            }
            if (rightUpperArm) {
                rightUpperArm.rotation.z = -0.7;  // Arm down at side
                rightUpperArm.rotation.x = 0.15;   // Slightly forward
                rightUpperArm.rotation.y = -0.05; // Very slight outward angle
            }
            
            // Natural elbow bend
            if (leftLowerArm) {
                leftLowerArm.rotation.y = -0.3;  // More natural elbow bend
                leftLowerArm.rotation.x = 0.1;   // Slight forward angle
            }
            if (rightLowerArm) {
                rightLowerArm.rotation.y = 0.3;  // More natural elbow bend
                rightLowerArm.rotation.x = 0.1;  // Slight forward angle
            }
            
            // Relax hands
            if (leftHand) {
                leftHand.rotation.z = 0.1;  // Slight inward rotation
                leftHand.rotation.x = 0.05; // Natural droop
            }
            if (rightHand) {
                rightHand.rotation.z = -0.1; // Slight inward rotation
                rightHand.rotation.x = 0.05; // Natural droop
            }
            
            // Relax shoulders
            const leftShoulder = vrm.humanoid.getNormalizedBoneNode('leftShoulder');
            const rightShoulder = vrm.humanoid.getNormalizedBoneNode('rightShoulder');
            if (leftShoulder) {
                leftShoulder.rotation.z = 0.08;  // Slightly dropped
                leftShoulder.rotation.y = 0.02;  // Slight forward roll
            }
            if (rightShoulder) {
                rightShoulder.rotation.z = -0.08; // Slightly dropped
                rightShoulder.rotation.y = -0.02; // Slight forward roll
            }
            
            // Natural spine position
            const spine = vrm.humanoid.getNormalizedBoneNode('spine');
            const chest = vrm.humanoid.getNormalizedBoneNode('chest');
            const upperChest = vrm.humanoid.getNormalizedBoneNode('upperChest');
            
            if (spine) {
                spine.rotation.x = 0.03; // Very slight forward lean
                spine.rotation.y = 0;    // No rotation
                spine.rotation.z = 0;    // No side lean
            }
            if (chest) {
                chest.rotation.x = 0.02; // Natural chest position
            }
            if (upperChest) {
                upperChest.rotation.x = 0.01; // Slight upper chest position
            }
            
            // Natural head position
            const neck = vrm.humanoid.getNormalizedBoneNode('neck');
            const head = vrm.humanoid.getNormalizedBoneNode('head');
            
            if (neck) {
                neck.rotation.x = 0.05;  // Slight forward tilt
            }
            if (head) {
                head.rotation.x = 0;     // Looking straight ahead
                head.rotation.y = 0;
                head.rotation.z = 0;
            }
            
            // Store initial positions for animation reference
            this.animation.initialPose = {
                leftUpperArm: leftUpperArm ? leftUpperArm.rotation.clone() : null,
                rightUpperArm: rightUpperArm ? rightUpperArm.rotation.clone() : null,
                leftLowerArm: leftLowerArm ? leftLowerArm.rotation.clone() : null,
                rightLowerArm: rightLowerArm ? rightLowerArm.rotation.clone() : null,
                spine: spine ? spine.rotation.clone() : null,
                chest: chest ? chest.rotation.clone() : null,
                neck: neck ? neck.rotation.clone() : null,
                head: head ? head.rotation.clone() : null
            };
        }
        
        // Setup look-at
        if (vrm.lookAt) {
            vrm.lookAt.target = this.three.camera;
        }
        
        // Setup expressions
        if (vrm.expressionManager) {
            this.setupExpressions(vrm.expressionManager);
        }
        
        // Setup physics
        if (vrm.springBoneManager) {
            // Spring bones will be updated in animation loop
        }
        
        console.log('VRM setup complete with natural pose');
        
        // Play welcome animation after a short delay
        setTimeout(() => {
            this.playWelcomeSequence();
        }, 1000);
        
        this.emit('vrm:setup', vrm);
    }
    
    setupExpressions(expressionManager) {
        const expressions = ['happy', 'angry', 'sad', 'surprised', 'blink', 'neutral'];
        const available = [];
        
        expressions.forEach(expr => {
            try {
                expressionManager.setValue(expr, 0);
                available.push(expr);
            } catch (e) {
                // Expression not available
            }
        });
        
        console.log('Available expressions:', available);
    }
    
    createFallbackAvatar() {
        console.log('Creating fallback avatar');
        const THREE = window.THREE;
        
        const group = new THREE.Group();
        group.name = 'FallbackAvatar';
        
        // Create simple character positioned higher
        const geometry = new THREE.CapsuleGeometry(0.3, 1, 4, 8);
        const material = new THREE.MeshLambertMaterial({ color: 0xff6b6b });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = 0; 
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        group.add(mesh);
        group.position.y = this.config.modelPosition.y;
        this.three.scene.add(group);
        
        // Create minimal VRM interface
        this.vrm.current = {
            scene: group,
            isFallback: true,
            update: () => {},
            humanoid: null,
            lookAt: null,
            expressionManager: null
        };
        
        this.state.loaded = true;
        this.emit('fallback:created');
    }
    
    startAnimationLoop() {
        const animate = () => {
            requestAnimationFrame(animate);
            
            if (!this.three.renderer || !this.three.scene || !this.three.camera) {
                return;
            }
            
            const deltaTime = this.three.clock.getDelta();
            
            // Update VRM
            if (this.vrm.current) {
                if (this.vrm.current.update) {
                    this.vrm.current.update(deltaTime);
                }
                
                this.updateAnimations(deltaTime);
            }
            
            // Update mixer if exists
            if (this.vrm.mixer) {
                this.vrm.mixer.update(deltaTime);
            }
            
            // Render
            this.three.renderer.render(this.three.scene, this.three.camera);
            
            this.emit('frame', deltaTime);
        };
        
        animate();
    }
    
    updateAnimations(deltaTime) {
        if (!this.vrm.current) return;
        
        const time = Date.now() / 1000;
        
        // === BREATHING ANIMATION ===
        this.animation.breathingPhase += deltaTime;
        const breathe = 1 + Math.sin(this.animation.breathingPhase * 2) * 0.015;
        if (this.vrm.current.scene) {
            this.vrm.current.scene.scale.y = breathe;
            this.vrm.current.scene.scale.x = 1 + Math.sin(this.animation.breathingPhase * 2 + Math.PI) * 0.003;
        }
        
        // === IDLE ANIMATIONS ===
        if (!this.animation.isTalking && !this.animation.isWaving) {
            // Very subtle body sway (reduced from 0.03 to 0.02)
            this.animation.swayPhase += deltaTime * 0.5;
            if (this.vrm.current.scene) {
                this.vrm.current.scene.rotation.y = Math.PI + Math.sin(this.animation.swayPhase) * 0.02;
                this.vrm.current.scene.position.x = Math.sin(this.animation.swayPhase * 0.7) * 0.015;
            }
            
            // Idle head movement
            if (this.vrm.current.humanoid && !this.vrm.current.isFallback) {
                const head = this.vrm.current.humanoid.getNormalizedBoneNode('head');
                const neck = this.vrm.current.humanoid.getNormalizedBoneNode('neck');
                
                if (head) {
                    head.rotation.x = Math.sin(time * 0.8) * 0.02 + this.animation.headTarget.x;
                    head.rotation.y = Math.sin(time * 0.6) * 0.03 + this.animation.headTarget.y;
                    head.rotation.z = Math.sin(time * 0.9) * 0.01;
                }
                
                if (neck) {
                    neck.rotation.x = 0.05 + Math.sin(time * 0.7 + 0.5) * 0.01;
                    neck.rotation.y = Math.sin(time * 0.5 + 0.5) * 0.02;
                }
                
                // Natural RELAXED micro-movements for arms
                const leftArm = this.vrm.current.humanoid.getNormalizedBoneNode('leftUpperArm');
                const rightArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightUpperArm');
                const leftLowerArm = this.vrm.current.humanoid.getNormalizedBoneNode('leftLowerArm');
                const rightLowerArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightLowerArm');
                
                this.animation.armSwayPhase += deltaTime * 0.8;
                
                // Keep arms naturally at sides with very subtle movement
                if (leftArm) {
                    leftArm.rotation.z = 0.7 + Math.sin(this.animation.armSwayPhase) * 0.015;  
                    leftArm.rotation.x = 0.15 + Math.sin(this.animation.armSwayPhase * 1.3) * 0.01;
                    leftArm.rotation.y = 0.05 + Math.sin(this.animation.armSwayPhase * 0.7) * 0.005;
                }
                
                if (rightArm) {
                    rightArm.rotation.z = -0.7 - Math.sin(this.animation.armSwayPhase + Math.PI) * 0.015;
                    rightArm.rotation.x = 0.15 + Math.sin(this.animation.armSwayPhase * 1.3 + Math.PI) * 0.01;
                    rightArm.rotation.y = -0.05 - Math.sin(this.animation.armSwayPhase * 0.7 + Math.PI) * 0.005;
                }
                
                // Subtle elbow movement
                if (leftLowerArm) {
                    leftLowerArm.rotation.y = -0.3 + Math.sin(this.animation.armSwayPhase * 1.5) * 0.03;
                }
                if (rightLowerArm) {
                    rightLowerArm.rotation.y = 0.3 - Math.sin(this.animation.armSwayPhase * 1.5) * 0.03;
                }
                
                // Occasional idle gestures
                this.animation.idleTimer += deltaTime;
                if (this.animation.idleTimer > 8 + Math.random() * 4) {
                    this.performIdleGesture();
                    this.animation.idleTimer = 0;
                }
            }
        }
        
        // === TALKING ANIMATIONS ===
        if (this.animation.isTalking && this.vrm.current.humanoid && !this.vrm.current.isFallback) {
            // Animated talking gestures
            const talkTime = time * 3;
            
            // Head movements during speech
            const head = this.vrm.current.humanoid.getNormalizedBoneNode('head');
            if (head) {
                head.rotation.x = Math.sin(talkTime * 1.2) * 0.03;
                head.rotation.y = Math.sin(talkTime) * 0.04;
                head.rotation.z = Math.sin(talkTime * 0.8) * 0.02;
            }
            
            // Natural conversational hand gestures
            const leftArm = this.vrm.current.humanoid.getNormalizedBoneNode('leftUpperArm');
            const rightArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightUpperArm');
            const leftLowerArm = this.vrm.current.humanoid.getNormalizedBoneNode('leftLowerArm');
            const rightLowerArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightLowerArm');
            const leftHand = this.vrm.current.humanoid.getNormalizedBoneNode('leftHand');
            const rightHand = this.vrm.current.humanoid.getNormalizedBoneNode('rightHand');
            
            // Natural conversational gestures - hands move but stay relatively low
            const gestureIntensity = 0.2 + Math.sin(talkTime * 0.5) * 0.1;
            
            if (leftArm) {
                leftArm.rotation.z = 0.5 + Math.sin(talkTime) * gestureIntensity;
                leftArm.rotation.x = 0.2 + Math.sin(talkTime * 1.3) * 0.15;
                leftArm.rotation.y = Math.sin(talkTime * 0.7) * 0.08;
            }
            
            if (rightArm) {
                rightArm.rotation.z = -0.5 - Math.sin(talkTime + Math.PI * 0.5) * gestureIntensity;
                rightArm.rotation.x = 0.2 + Math.sin(talkTime * 1.3 + Math.PI) * 0.15;
                rightArm.rotation.y = -Math.sin(talkTime * 0.7 + Math.PI) * 0.08;
            }
            
            if (leftLowerArm) {
                leftLowerArm.rotation.y = -0.4 + Math.sin(talkTime * 1.5) * 0.2;
                leftLowerArm.rotation.z = Math.sin(talkTime * 2) * 0.08;
            }
            
            if (rightLowerArm) {
                rightLowerArm.rotation.y = 0.4 - Math.sin(talkTime * 1.5 + Math.PI) * 0.2;
                rightLowerArm.rotation.z = Math.sin(talkTime * 2 + Math.PI) * 0.08;
            }
            
            if (leftHand) {
                leftHand.rotation.z = Math.sin(talkTime * 2.5) * 0.15;
                leftHand.rotation.x = Math.sin(talkTime * 3) * 0.08;
            }
            
            if (rightHand) {
                rightHand.rotation.z = Math.sin(talkTime * 2.5 + Math.PI) * 0.15;
                rightHand.rotation.x = Math.sin(talkTime * 3 + Math.PI) * 0.08;
            }
            
            // Body movement while talking
            if (this.vrm.current.humanoid) {
                const spine = this.vrm.current.humanoid.getNormalizedBoneNode('spine');
                const chest = this.vrm.current.humanoid.getNormalizedBoneNode('chest');
                
                if (spine) {
                    spine.rotation.y = Math.sin(talkTime * 0.8) * 0.02;
                    spine.rotation.x = 0.03 + Math.sin(talkTime * 0.6) * 0.015;
                }
                
                if (chest) {
                    chest.rotation.y = Math.sin(talkTime * 0.9 + 0.5) * 0.015;
                    chest.rotation.x = 0.02 + Math.sin(talkTime * 0.7) * 0.01;
                }
            }
        }
        
        // === EXPRESSION ANIMATIONS ===
        this.updateExpressions(deltaTime);
        
        // === BLINKING ===
        this.animation.blinkTimer += deltaTime;
        const blinkInterval = this.animation.isTalking ? 2 : 3 + Math.random();
        if (this.animation.blinkTimer > blinkInterval) {
            this.performBlink();
            this.animation.blinkTimer = 0;
        }
    }
    
    updateExpressions(deltaTime) {
        if (!this.vrm.current?.expressionManager) return;
        
        // Smooth transition between expressions
        if (this.animation.currentExpression !== this.animation.targetExpression) {
            this.animation.expressionIntensity -= this.animation.transitionSpeed;
            
            if (this.animation.expressionIntensity <= 0) {
                this.animation.currentExpression = this.animation.targetExpression;
                this.animation.expressionIntensity = 0;
            }
        } else if (this.animation.expressionIntensity < this.animation.targetIntensity) {
            this.animation.expressionIntensity = Math.min(
                this.animation.expressionIntensity + this.animation.transitionSpeed,
                this.animation.targetIntensity
            );
        }
        
        // Apply current expression
        try {
            if (this.animation.currentExpression !== 'neutral') {
                this.vrm.current.expressionManager.setValue(
                    this.animation.currentExpression,
                    this.animation.expressionIntensity
                );
            }
            
            // Add subtle mouth movement when talking
            if (this.animation.isTalking) {
                const mouthValue = Math.abs(Math.sin(Date.now() * 0.01)) * 0.3;
                this.vrm.current.expressionManager.setValue('aa', mouthValue);
            } else {
                this.vrm.current.expressionManager.setValue('aa', 0);
            }
        } catch (e) {
            // Expression not available
        }
    }
    
    performIdleGesture() {
        if (!this.vrm.current.humanoid || this.vrm.current.isFallback) return;
        
        const gestures = [
            () => this.performHeadTilt(),
            () => this.performShoulderShrug(),
            () => this.performWeightShift(),
            () => this.setExpression('happy', 0.3, 2000),
            () => this.performWink(),
            () => this.performSmallNod()
        ];
        
        const gesture = gestures[Math.floor(Math.random() * gestures.length)];
        gesture();
    }
    
    performHeadTilt() {
        const head = this.vrm.current.humanoid.getNormalizedBoneNode('head');
        if (head) {
            const originalRotation = head.rotation.clone();
            let tiltTime = 0;
            
            const tiltInterval = setInterval(() => {
                tiltTime += 0.016;
                
                if (tiltTime >= 1) {
                    head.rotation.copy(originalRotation);
                    clearInterval(tiltInterval);
                    return;
                }
                
                const tiltProgress = Math.sin(tiltTime * Math.PI);
                head.rotation.z = originalRotation.z + tiltProgress * 0.12;
            }, 16);
        }
    }
    
    performShoulderShrug() {
        const leftShoulder = this.vrm.current.humanoid.getNormalizedBoneNode('leftShoulder');
        const rightShoulder = this.vrm.current.humanoid.getNormalizedBoneNode('rightShoulder');
        
        if (leftShoulder && rightShoulder) {
            let shrugTime = 0;
            
            const shrugInterval = setInterval(() => {
                shrugTime += 0.016;
                
                if (shrugTime >= 1.5) {
                    leftShoulder.rotation.z = 0.08;
                    rightShoulder.rotation.z = -0.08;
                    clearInterval(shrugInterval);
                    return;
                }
                
                const shrugProgress = Math.sin(shrugTime * Math.PI / 1.5);
                leftShoulder.rotation.z = 0.08 + shrugProgress * 0.08;
                rightShoulder.rotation.z = -0.08 - shrugProgress * 0.08;
            }, 16);
        }
    }
    
    performWeightShift() {
        const hips = this.vrm.current.humanoid.getNormalizedBoneNode('hips');
        if (hips) {
            let shiftTime = 0;
            
            const shiftInterval = setInterval(() => {
                shiftTime += 0.016;
                
                if (shiftTime >= 2) {
                    hips.position.x = 0;
                    hips.rotation.z = 0;
                    clearInterval(shiftInterval);
                    return;
                }
                
                const shiftProgress = Math.sin(shiftTime * Math.PI);
                hips.position.x = shiftProgress * 0.015;
                hips.rotation.z = shiftProgress * 0.008;
            }, 16);
        }
    }
    
    performWink() {
        if (this.vrm.current?.expressionManager) {
            try {
                this.vrm.current.expressionManager.setValue('winkLeft', 1.0);
                setTimeout(() => {
                    if (this.vrm.current?.expressionManager) {
                        this.vrm.current.expressionManager.setValue('winkLeft', 0);
                    }
                }, 200);
            } catch (e) {
                // Wink not available, try blink instead
                this.performBlink();
            }
        }
    }
    
    performSmallNod() {
        const head = this.vrm.current?.humanoid?.getNormalizedBoneNode('head');
        if (head) {
            const originalRotation = head.rotation.clone();
            let nodTime = 0;
            
            const nodInterval = setInterval(() => {
                nodTime += 0.016;
                
                if (nodTime >= 1) {
                    head.rotation.copy(originalRotation);
                    clearInterval(nodInterval);
                    return;
                }
                
                const nodProgress = Math.sin(nodTime * Math.PI * 2);
                head.rotation.x = originalRotation.x + nodProgress * 0.15;
            }, 16);
        }
    }
    
    setExpression(expression, intensity = 0.5, duration = 1000) {
        this.animation.targetExpression = expression;
        this.animation.targetIntensity = intensity;
        
        if (duration) {
            setTimeout(() => {
                this.animation.targetExpression = 'neutral';
                this.animation.targetIntensity = 0;
            }, duration);
        }
    }
    
    performBlink() {
        if (this.vrm.current?.expressionManager) {
            try {
                this.vrm.current.expressionManager.setValue('blink', 1.0);
                setTimeout(() => {
                    if (this.vrm.current?.expressionManager) {
                        this.vrm.current.expressionManager.setValue('blink', 0);
                    }
                }, 150);
            } catch (e) {
                // Blink not available
            }
        }
    }
    
    playWave() {
        if (!this.vrm.current || this.animation.isWaving) return;
        
        this.animation.isWaving = true;
        this.emit('animation:wave:start');
        
        // Set happy expression during wave
        this.setExpression('happy', 0.6, 4000);
        
        if (this.vrm.current.humanoid && !this.vrm.current.isFallback) {
            this.playHumanoidWave();
        } else {
            this.playFallbackWave();
        }
    }
    
    playHumanoidWave() {
        const rightArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightUpperArm');
        const rightLowerArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightLowerArm');
        const rightHand = this.vrm.current.humanoid.getNormalizedBoneNode('rightHand');
        
        if (!rightArm) {
            this.playFallbackWave();
            return;
        }
        
        // Store original positions
        const originalUpperRotation = rightArm.rotation.clone();
        const originalLowerRotation = rightLowerArm ? rightLowerArm.rotation.clone() : null;
        const originalHandRotation = rightHand ? rightHand.rotation.clone() : null;
        
        let waveTime = 0;
        
        const waveInterval = setInterval(() => {
            waveTime += 0.016;
            
            if (waveTime >= 3) {
                // Return to natural rest position
                rightArm.rotation.z = -0.7;
                rightArm.rotation.x = 0.15;
                rightArm.rotation.y = -0.05;
                
                if (rightLowerArm) {
                    rightLowerArm.rotation.y = 0.3;
                    rightLowerArm.rotation.x = 0.1;
                }
                if (rightHand) {
                    rightHand.rotation.z = -0.1;
                    rightHand.rotation.x = 0.05;
                }
                
                this.animation.isWaving = false;
                this.setExpression('neutral', 0);
                
                // Perform a wink after waving
                setTimeout(() => this.performWink(), 500);
                
                clearInterval(waveInterval);
                this.emit('animation:wave:end');
                return;
            }
            
            // More natural wave animation
            const waveIntensity = Math.sin(waveTime * Math.PI * 4);
            
            // Raise arm up and to the side naturally
            rightArm.rotation.z = -1.0 - Math.abs(waveIntensity) * 0.2;
            rightArm.rotation.x = -0.4;
            rightArm.rotation.y = 0.2;
            
            if (rightLowerArm) {
                // Natural elbow bend during wave
                rightLowerArm.rotation.y = 0.6;
                rightLowerArm.rotation.z = waveIntensity * 0.25;
            }
            
            if (rightHand) {
                // Wave hand side to side
                rightHand.rotation.z = waveIntensity * 0.4;
                rightHand.rotation.y = waveIntensity * 0.2;
                
                // Add finger movement if available
                const fingers = ['thumb', 'index', 'middle', 'ring', 'little'];
                fingers.forEach(finger => {
                    const proximal = this.vrm.current.humanoid.getNormalizedBoneNode(`right${finger.charAt(0).toUpperCase() + finger.slice(1)}Proximal`);
                    if (proximal) {
                        proximal.rotation.z = Math.abs(waveIntensity) * 0.15;
                    }
                });
            }
            
            // Add slight body movement during wave
            if (this.vrm.current.scene) {
                this.vrm.current.scene.rotation.y = Math.PI + Math.sin(waveTime * Math.PI * 2) * 0.04;
            }
        }, 16);
    }
    
    playFallbackWave() {
        let waveTime = 0;
        
        const waveInterval = setInterval(() => {
            waveTime += 0.016;
            
            if (waveTime >= 2) {
                if (this.vrm.current?.scene) {
                    this.vrm.current.scene.rotation.z = 0;
                }
                this.animation.isWaving = false;
                clearInterval(waveInterval);
                this.emit('animation:wave:end');
                return;
            }
            
            if (this.vrm.current?.scene) {
                this.vrm.current.scene.rotation.z = Math.sin(waveTime * Math.PI * 3) * 0.1;
            }
        }, 16);
    }
    
    startSpeechAnimation(text) {
        this.animation.isTalking = true;
        
        // Analyze text sentiment for appropriate expression
        const lowerText = text ? text.toLowerCase() : '';
        
        if (this.vrm.current?.expressionManager) {
            try {
                // Choose expression based on content
                if (lowerText.includes('happy') || lowerText.includes('great') || lowerText.includes('awesome')) {
                    this.setExpression('happy', 0.4);
                } else if (lowerText.includes('sorry') || lowerText.includes('unfortunately')) {
                    this.setExpression('sad', 0.3);
                } else if (lowerText.includes('wow') || lowerText.includes('amazing') || lowerText.includes('!')) {
                    this.setExpression('surprised', 0.3);
                    // Quick eyebrow raise
                    setTimeout(() => this.setExpression('happy', 0.2), 1000);
                } else {
                    // Default pleasant expression
                    this.setExpression('happy', 0.2);
                }
            } catch (e) {}
        }
        
        // Reset arm positions for talking gestures
        if (this.vrm.current.humanoid && !this.vrm.current.isFallback) {
            const leftArm = this.vrm.current.humanoid.getNormalizedBoneNode('leftUpperArm');
            const rightArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightUpperArm');
            
            if (leftArm) {
                leftArm.rotation.z = 0.5;  // Slightly raised for gestures
            }
            if (rightArm) {
                rightArm.rotation.z = -0.5;  // Slightly raised for gestures
            }
        }
        
        this.emit('animation:speech:start');
    }
    
    stopSpeechAnimation() {
        this.animation.isTalking = false;
        
        // Return to neutral expression
        this.setExpression('neutral', 0);
        
        // Reset arm positions smoothly back to natural rest
        if (this.vrm.current.humanoid && !this.vrm.current.isFallback) {
            const leftArm = this.vrm.current.humanoid.getNormalizedBoneNode('leftUpperArm');
            const rightArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightUpperArm');
            const leftLowerArm = this.vrm.current.humanoid.getNormalizedBoneNode('leftLowerArm');
            const rightLowerArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightLowerArm');
            
            // Smooth return to rest position
            let returnTime = 0;
            const returnInterval = setInterval(() => {
                returnTime += 0.016;
                
                if (returnTime >= 0.5) {
                    // Final rest position
                    if (leftArm) {
                        leftArm.rotation.z = 0.7;
                        leftArm.rotation.x = 0.15;
                        leftArm.rotation.y = 0.05;
                    }
                    if (rightArm) {
                        rightArm.rotation.z = -0.7;
                        rightArm.rotation.x = 0.15;
                        rightArm.rotation.y = -0.05;
                    }
                    if (leftLowerArm) {
                        leftLowerArm.rotation.y = -0.3;
                        leftLowerArm.rotation.x = 0.1;
                    }
                    if (rightLowerArm) {
                        rightLowerArm.rotation.y = 0.3;
                        rightLowerArm.rotation.x = 0.1;
                    }
                    
                    clearInterval(returnInterval);
                    return;
                }
                
                const progress = returnTime / 0.5;
                const smoothProgress = progress * progress * (3 - 2 * progress); // Smooth step
                
                if (leftArm) {
                    leftArm.rotation.z = leftArm.rotation.z * (1 - smoothProgress) + 0.7 * smoothProgress;
                    leftArm.rotation.x = leftArm.rotation.x * (1 - smoothProgress) + 0.15 * smoothProgress;
                }
                if (rightArm) {
                    rightArm.rotation.z = rightArm.rotation.z * (1 - smoothProgress) + (-0.7) * smoothProgress;
                    rightArm.rotation.x = rightArm.rotation.x * (1 - smoothProgress) + 0.15 * smoothProgress;
                }
            }, 16);
        }
        
        this.emit('animation:speech:end');
    }
    
    updateHeadTarget(x, y) {
        this.animation.headTarget.x = x * 0.1;
        this.animation.headTarget.y = y * 0.1;
    }
    
    handleResize() {
        if (!this.three.camera || !this.three.renderer) return;
        
        this.three.camera.aspect = window.innerWidth / window.innerHeight;
        this.three.camera.updateProjectionMatrix();
        this.three.renderer.setSize(window.innerWidth, window.innerHeight);
        
        // Optionally adjust camera position on mobile/tablet
        if (window.innerWidth < 768) {
            this.three.camera.position.z = 8.5; // Move camera back more on mobile
        } else {
            this.three.camera.position.z = this.config.cameraPosition.z;
        }
        
        this.emit('resize');
    }
    
    // Method to manually adjust model position if needed
    setModelPosition(x, y, z) {
        if (this.vrm.current && this.vrm.current.scene) {
            this.vrm.current.scene.position.set(x, y, z);
            this.config.modelPosition = { x, y, z };
            console.log('Model position updated:', { x, y, z });
        }
    }
    
    // Method to manually adjust camera position if needed
    setCameraPosition(x, y, z) {
        if (this.three.camera) {
            this.three.camera.position.set(x, y, z);
            this.config.cameraPosition = { x, y, z };
            console.log('Camera position updated:', { x, y, z });
        }
    }
    
    // Play welcome animation sequence
    playWelcomeSequence() {
        if (!this.vrm.current || this.vrm.current.isFallback) return;
        
        console.log('Playing welcome animation sequence');
        
        // Start with a wave
        this.playWave();
        
        // Schedule wink
        setTimeout(() => {
            this.performWink();
        }, 3500);
        
        // Add a happy expression
        setTimeout(() => {
            this.setExpression('happy', 0.4, 2000);
        }, 4000);
        
        // Small nod
        setTimeout(() => {
            this.performSmallNod();
        }, 5000);
        
        this.emit('animation:welcome');
    }
    
    // React to user input
    reactToUserInput() {
        // Quick acknowledgment animation
        if (this.vrm.current?.humanoid && !this.vrm.current.isFallback) {
            const head = this.vrm.current.humanoid.getNormalizedBoneNode('head');
            if (head) {
                // Small tilt to show listening
                const originalRotation = head.rotation.clone();
                head.rotation.z = 0.08;
                
                setTimeout(() => {
                    head.rotation.copy(originalRotation);
                }, 300);
            }
            
            // Set attentive expression
            this.setExpression('happy', 0.15);
        }
        
        this.emit('animation:listening');
    }
    
    destroy() {
        // Stop animations
        this.animation.isWaving = false;
        this.animation.isTalking = false;
        
        // Dispose VRM
        if (this.vrm.current) {
            this.three.scene.remove(this.vrm.current.scene);
            if (window.VRMUtils) {
                window.VRMUtils.deepDispose(this.vrm.current.scene);
            }
        }
        
        // Dispose Three.js resources
        if (this.three.renderer) {
            this.three.renderer.dispose();
        }
        
        // Remove lights
        this.three.lights.forEach(light => {
            this.three.scene.remove(light);
        });
        
        // Clear references
        this.vrm.current = null;
        this.three.scene = null;
        this.three.camera = null;
        this.three.renderer = null;
        
        // Remove event listeners
        this.removeAllListeners();
        
        this.emit('destroyed');
    }
}
