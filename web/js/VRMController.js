// web/js/VRMLoader.js
// AIRI-inspired VRM loading and animation system with natural pose

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
            mixer: null
        };
        
        // AIRI-style natural animation state
        this.animation = {
            isWaving: false,
            isTalking: false,
            idlePhase: 0,
            breathingPhase: 0,
            blinkTimer: 0,
            swayPhase: 0,
            headTarget: { x: 0, y: 0 },
            gestureTimer: 0,
            shoulderRelaxTimer: 0,
            microMovementTimer: 0,
            lastGestureTime: 0,
            currentExpression: 'neutral',
            expressionIntensity: 0,
            targetExpression: 'neutral',
            targetIntensity: 0
        };
        
        this.config = {
            paths: [
                '/assets/avatar/solmate.vrm',
                'https://raw.githubusercontent.com/DirkDigglerTown/solmate/main/web/assets/avatar/solmate.vrm'
            ],
            fallbackEnabled: true,
            // Perfect positioning from previous sessions
            cameraPosition: { x: 0, y: 3.5, z: 9.0 },   // Backed up for full body view  
            lookAtPosition: { x: 0, y: 3.5, z: 0 },     // Look at mid-torso
            modelPosition: { x: 0, y: 4.8, z: 0 }       // Model raised properly
        };
    }
    
    async init() {
        if (this.state.initialized) {
            console.warn('VRMLoader already initialized');
            return;
        }
        
        try {
            this.emit('init:start');
            
            // Load Three.js and VRM modules
            await this.loadModules();
            
            // Initialize Three.js scene with perfect positioning
            await this.initializeScene();
            
            // Load VRM model with AIRI-style setup
            await this.loadVRM();
            
            // Start AIRI-style animation loop
            this.startAnimationLoop();
            
            this.state.initialized = true;
            this.emit('init:complete');
            
            console.log('✅ AIRI-style VRM system initialized successfully');
            
        } catch (error) {
            this.state.error = error;
            this.emit('error', error);
            
            if (this.config.fallbackEnabled) {
                this.createFallbackAvatar();
            }
            
            throw error;
        }
    }
    
    async loadModules() {
        console.log('📦 Loading VRM modules with import map...');
        
        // Check if already loaded
        if (window.THREE && window.VRMLoaderPlugin) {
            console.log('✅ VRM modules already available');
            return;
        }
        
        // Inject import map for ES modules
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
        
        // Create module loader script
        const moduleScript = document.createElement('script');
        moduleScript.type = 'module';
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
        
        // Wait for modules to load
        let attempts = 0;
        while (!window.VRM_MODULES_LOADED && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        if (!window.VRM_MODULES_LOADED) {
            throw new Error('Failed to load VRM modules');
        }
        
        console.log('✅ All VRM modules loaded successfully');
    }
    
    async initializeScene() {
        console.log('🎬 Setting up Three.js scene...');
        const THREE = window.THREE;
        
        // Create scene
        this.three.scene = new THREE.Scene();
        this.three.scene.background = new THREE.Color(0x0a0e17);
        
        // Create camera with PERFECT positioning from previous successful sessions
        this.three.camera = new THREE.PerspectiveCamera(
            50,  // Wide FOV for full body view
            window.innerWidth / window.innerHeight,
            0.1,
            20
        );
        
        // Set camera to proven working position
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
        
        // AIRI-style lighting setup
        this.setupAIRILighting();
        
        // Create clock for animations
        this.three.clock = new THREE.Clock();
        
        // Handle window resize
        window.addEventListener('resize', () => this.handleResize());
        
        console.log('✅ Three.js scene initialized with AIRI-style setup');
        this.emit('scene:created');
    }
    
    setupAIRILighting() {
        const THREE = window.THREE;
        
        // AIRI uses soft, ambient lighting for natural appearance
        
        // Main ambient light (soft overall illumination)
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.three.scene.add(ambientLight);
        this.three.lights.push(ambientLight);
        
        // Key directional light (main lighting)
        const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
        keyLight.position.set(2, 3, 2);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.setScalar(2048);
        keyLight.shadow.camera.near = 0.1;
        keyLight.shadow.camera.far = 20;
        keyLight.shadow.camera.top = 3;
        keyLight.shadow.camera.bottom = -3;
        keyLight.shadow.camera.left = -3;
        keyLight.shadow.camera.right = 3;
        this.three.scene.add(keyLight);
        this.three.lights.push(keyLight);
        
        // Fill light (softer, opposite side)
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
        fillLight.position.set(-1, 1, -1);
        this.three.scene.add(fillLight);
        this.three.lights.push(fillLight);
        
        // Rim light (subtle edge lighting)
        const rimLight = new THREE.DirectionalLight(0xffffff, 0.2);
        rimLight.position.set(0, 2, -2);
        this.three.scene.add(rimLight);
        this.three.lights.push(rimLight);
        
        console.log('✅ AIRI-style lighting setup complete');
    }
    
    async loadVRM() {
        if (this.state.loading) return;
        
        this.state.loading = true;
        this.emit('load:start');
        console.log('🤖 Loading VRM model with proper VRM support...');
        
        const GLTFLoader = window.GLTFLoader;
        const VRMLoaderPlugin = window.VRMLoaderPlugin;
        
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));
        
        let loaded = false;
        let lastError = null;
        
        // Try each VRM path until one works
        for (const path of this.config.paths) {
            if (loaded) break;
            
            try {
                console.log(`Attempting to load VRM from: ${path}`);
                
                const gltf = await new Promise((resolve, reject) => {
                    loader.load(
                        path,
                        resolve,
                        (progress) => {
                            this.emit('load:progress', {
                                url: path,
                                loaded: progress.loaded,
                                total: progress.total
                            });
                        },
                        reject
                    );
                });
                
                if (gltf.userData.vrm) {
                    console.log('✅ VRM data found - setting up natural pose...');
                    await this.setupVRM(gltf.userData.vrm);
                    loaded = true;
                    this.state.loaded = true;
                    this.emit('load:complete', this.vrm.current);
                    console.log(`✅ VRM loaded successfully from: ${path}`);
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
    
    async setupVRM(vrm) {
        console.log('⚙️ Setting up VRM with AIRI-style natural pose...');
        
        // Remove existing VRM if any
        if (this.vrm.current) {
            this.three.scene.remove(this.vrm.current.scene);
            if (window.VRMUtils) {
                window.VRMUtils.deepDispose(this.vrm.current.scene);
            }
        }
        
        // Store VRM reference
        this.vrm.current = vrm;
        
        // Rotate to face camera (180 degrees)
        vrm.scene.rotation.y = Math.PI;
        
        // Position model at proven working height
        vrm.scene.position.set(
            this.config.modelPosition.x,
            this.config.modelPosition.y,
            this.config.modelPosition.z
        );
        
        // Add to scene
        this.three.scene.add(vrm.scene);
        
        // Setup AIRI-style natural humanoid pose
        if (vrm.humanoid) {
            this.setupAIRINaturalPose(vrm.humanoid);
        }
        
        // Setup expression system
        if (vrm.expressionManager) {
            this.setupExpressions(vrm.expressionManager);
        }
        
        // Setup look-at system
        if (vrm.lookAt) {
            vrm.lookAt.target = this.three.camera;
        }
        
        console.log('✅ VRM setup complete with AIRI-style natural pose');
        
        // Schedule welcome animation sequence
        setTimeout(() => {
            this.playWelcomeSequence();
        }, 1000);
        
        this.emit('vrm:setup', vrm);
    }
    
    setupAIRINaturalPose(humanoid) {
        console.log('🦴 Setting up AIRI-style natural humanoid pose...');
        
        // Get bone references
        const hips = humanoid.getNormalizedBoneNode('hips');
        const spine = humanoid.getNormalizedBoneNode('spine');
        const chest = humanoid.getNormalizedBoneNode('chest');
        const upperChest = humanoid.getNormalizedBoneNode('upperChest');
        const neck = humanoid.getNormalizedBoneNode('neck');
        const head = humanoid.getNormalizedBoneNode('head');
        
        // CRITICAL: AIRI-style 70-degree natural arm rest position
        const leftUpperArm = humanoid.getNormalizedBoneNode('leftUpperArm');
        const rightUpperArm = humanoid.getNormalizedBoneNode('rightUpperArm');
        const leftLowerArm = humanoid.getNormalizedBoneNode('leftLowerArm');
        const rightLowerArm = humanoid.getNormalizedBoneNode('rightLowerArm');
        const leftHand = humanoid.getNormalizedBoneNode('leftHand');
        const rightHand = humanoid.getNormalizedBoneNode('rightHand');
        const leftShoulder = humanoid.getNormalizedBoneNode('leftShoulder');
        const rightShoulder = humanoid.getNormalizedBoneNode('rightShoulder');
        
        // Natural hip positioning
        if (hips) {
            hips.position.set(0, 0, 0);
        }
        
        // === AIRI-STYLE ARM POSITIONING ===
        // This is the KEY to natural pose - arms hang naturally at ~70 degrees from T-pose
        
        if (leftUpperArm) {
            // Left arm: 70 degrees down from horizontal T-pose (1.22 radians)
            leftUpperArm.rotation.z = 1.22;  // 70 degrees down from T-pose
            leftUpperArm.rotation.x = 0.05;  // Slight forward angle for natural hang
            leftUpperArm.rotation.y = 0.02;  // Tiny inward rotation
            console.log('✅ Left upper arm positioned at 70 degrees');
        }
        
        if (rightUpperArm) {
            // Right arm: mirror of left (negative Z rotation)
            rightUpperArm.rotation.z = -1.22; // 70 degrees down from T-pose
            rightUpperArm.rotation.x = 0.05;  // Slight forward angle for natural hang
            rightUpperArm.rotation.y = -0.02; // Tiny inward rotation
            console.log('✅ Right upper arm positioned at 70 degrees');
        }
        
        if (leftLowerArm) {
            // Natural elbow bend - arms hang straight but not stiff
            leftLowerArm.rotation.z = 0.1;   // 6 degrees natural bend
            leftLowerArm.rotation.x = 0.02;  // Slight forward
            leftLowerArm.rotation.y = 0.01;  // Natural twist
        }
        
        if (rightLowerArm) {
            // Mirror for right arm
            rightLowerArm.rotation.z = -0.1;  // 6 degrees natural bend
            rightLowerArm.rotation.x = 0.02;  // Slight forward
            rightLowerArm.rotation.y = -0.01; // Natural twist
        }
        
        // Natural hand positioning
        if (leftHand) {
            leftHand.rotation.z = 0.05;  // Slight inward curl
            leftHand.rotation.x = 0.03;  // Natural droop
            leftHand.rotation.y = 0.01;  // Slight rotation
        }
        
        if (rightHand) {
            rightHand.rotation.z = -0.05; // Slight inward curl
            rightHand.rotation.x = 0.03;  // Natural droop  
            rightHand.rotation.y = -0.01; // Slight rotation
        }
        
        // Relaxed shoulder positioning
        if (leftShoulder) {
            leftShoulder.rotation.z = 0.06;  // Slightly dropped
            leftShoulder.rotation.y = 0.02;  // Forward roll
            leftShoulder.rotation.x = 0;
        }
        
        if (rightShoulder) {
            rightShoulder.rotation.z = -0.06; // Slightly dropped
            rightShoulder.rotation.y = -0.02; // Forward roll
            rightShoulder.rotation.x = 0;
        }
        
        // Natural spine positioning
        if (spine) {
            spine.rotation.x = 0.02;  // Very slight forward lean
            spine.rotation.y = 0;     // No side bend
            spine.rotation.z = 0;     // No twist
        }
        
        if (chest) {
            chest.rotation.x = 0.01;  // Natural chest position
            chest.rotation.y = 0;
            chest.rotation.z = 0;
        }
        
        if (upperChest) {
            upperChest.rotation.x = 0.005; // Minimal upper chest adjustment
            upperChest.rotation.y = 0;
            upperChest.rotation.z = 0;
        }
        
        // Natural neck and head positioning
        if (neck) {
            neck.rotation.x = 0.03;  // Slight forward tilt
            neck.rotation.y = 0;     // Looking straight
            neck.rotation.z = 0;     // No head tilt
        }
        
        if (head) {
            head.rotation.x = 0;     // Looking straight ahead
            head.rotation.y = 0;     // No head turn
            head.rotation.z = 0;     // No head tilt
        }
        
        // Store initial pose for animation reference
        this.animation.initialPose = {
            leftUpperArm: leftUpperArm ? leftUpperArm.rotation.clone() : null,
            rightUpperArm: rightUpperArm ? rightUpperArm.rotation.clone() : null,
            leftLowerArm: leftLowerArm ? leftLowerArm.rotation.clone() : null,
            rightLowerArm: rightLowerArm ? rightLowerArm.rotation.clone() : null,
            leftShoulder: leftShoulder ? leftShoulder.rotation.clone() : null,
            rightShoulder: rightShoulder ? rightShoulder.rotation.clone() : null,
            spine: spine ? spine.rotation.clone() : null,
            chest: chest ? chest.rotation.clone() : null,
            neck: neck ? neck.rotation.clone() : null,
            head: head ? head.rotation.clone() : null
        };
        
        console.log('✅ AIRI-style natural humanoid pose configured successfully');
    }
    
    setupExpressions(expressionManager) {
        console.log('😊 Setting up expressions...');
        
        const expressions = ['happy', 'sad', 'angry', 'surprised', 'blink', 'neutral'];
        const available = [];
        
        expressions.forEach(expr => {
            try {
                expressionManager.setValue(expr, 0);
                available.push(expr);
            } catch (e) {
                // Expression not available in this VRM
            }
        });
        
        if (available.length > 0) {
            console.log('Available expressions:', available.join(', '));
        } else {
            console.log('No expressions available in this VRM model');
        }
        
        this.emit('expressions:setup', available);
    }
    
    createFallbackAvatar() {
        console.log('Creating fallback avatar with natural positioning');
        
        if (!window.THREE) {
            console.error('Three.js not available for fallback');
            return;
        }
        
        const THREE = window.THREE;
        const group = new THREE.Group();
        group.name = 'FallbackAvatar';
        
        // Create simple character
        const geometry = new THREE.CapsuleGeometry(0.3, 1.2, 4, 8);
        const material = new THREE.MeshLambertMaterial({ color: 0x00f0ff });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        group.add(mesh);
        
        // Position at same height as real VRM would be
        group.position.set(
            this.config.modelPosition.x,
            this.config.modelPosition.y,
            this.config.modelPosition.z
        );
        
        this.three.scene.add(group);
        
        // Create minimal VRM interface for compatibility
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
        console.log('✅ Fallback avatar created');
    }
    
    startAnimationLoop() {
        console.log('🔄 Starting AIRI-style animation loop...');
        
        const animate = () => {
            requestAnimationFrame(animate);
            
            if (!this.three.renderer || !this.three.scene || !this.three.camera) {
                return;
            }
            
            const deltaTime = this.three.clock.getDelta();
            const time = Date.now() / 1000;
            
            // Update VRM
            if (this.vrm.current) {
                if (this.vrm.current.update) {
                    this.vrm.current.update(deltaTime);
                }
                
                // Apply AIRI-style animations
                this.updateAIRIAnimations(deltaTime, time);
            }
            
            // Render scene
            this.three.renderer.render(this.three.scene, this.three.camera);
            
            this.emit('frame', deltaTime);
        };
        
        animate();
    }
    
    updateAIRIAnimations(deltaTime, time) {
        if (!this.vrm.current || this.vrm.current.isFallback) return;
        
        // === BREATHING ANIMATION ===
        // AIRI uses subtle chest scaling for natural breathing
        this.animation.breathingPhase += deltaTime * 2.2; // Natural breathing rate
        const breathScale = 1 + Math.sin(this.animation.breathingPhase) * 0.015; // 1.5% variation
        
        if (this.vrm.current.humanoid) {
            const chest = this.vrm.current.humanoid.getNormalizedBoneNode('chest');
            const upperChest = this.vrm.current.humanoid.getNormalizedBoneNode('upperChest');
            
            if (chest) {
                chest.scale.setScalar(breathScale);
            }
            if (upperChest) {
                upperChest.scale.setScalar(breathScale);
            }
        }
        
        // === IDLE ANIMATIONS ===
        if (!this.animation.isTalking && !this.animation.isWaving) {
            this.updateIdleAnimations(deltaTime, time);
        }
        
        // === SPEECH ANIMATIONS ===
        if (this.animation.isTalking) {
            this.updateSpeechAnimations(deltaTime, time);
        }
        
        // === EXPRESSION ANIMATIONS ===
        this.updateExpressionAnimations(deltaTime);
        
        // === BLINKING ===
        this.updateBlinking(deltaTime);
        
        // === WAVE ANIMATION ===
        if (this.animation.isWaving) {
            // Wave animation is handled separately in playWave()
        }
    }
    
    updateIdleAnimations(deltaTime, time) {
        if (!this.vrm.current.humanoid) return;
        
        // Subtle body sway
        this.animation.swayPhase += deltaTime * 0.3;
        
        if (this.vrm.current.scene) {
            // Very gentle rotation sway around Y axis
            this.vrm.current.scene.rotation.y = Math.PI + Math.sin(this.animation.swayPhase) * 0.008;
            
            // Subtle weight shift (side to side)
            this.vrm.current.scene.position.x = Math.sin(this.animation.swayPhase * 0.7) * 0.008;
        }
        
        // Natural idle head movement combined with mouse tracking
        const head = this.vrm.current.humanoid.getNormalizedBoneNode('head');
        const neck = this.vrm.current.humanoid.getNormalizedBoneNode('neck');
        
        if (head) {
            // Combine idle movement with head target from mouse tracking
            const idleX = Math.sin(time * 0.6) * 0.012;
            const idleY = Math.sin(time * 0.8) * 0.018;
            const idleZ = Math.sin(time * 0.5) * 0.004;
            
            head.rotation.x = idleX + this.animation.headTarget.x * 0.25;
            head.rotation.y = idleY + this.animation.headTarget.y * 0.25;
            head.rotation.z = idleZ;
        }
        
        if (neck) {
            neck.rotation.x = Math.sin(time * 0.7) * 0.006;
            neck.rotation.y = Math.sin(time * 0.5) * 0.008;
        }
        
        // Keep arms in natural rest position with micro-movements
        const leftArm = this.vrm.current.humanoid.getNormalizedBoneNode('leftUpperArm');
        const rightArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightUpperArm');
        
        if (leftArm && this.animation.initialPose.leftUpperArm) {
            // Stay close to 70-degree rest position with tiny variation
            leftArm.rotation.z = 1.22 + Math.sin(time * 0.4) * 0.015;
            leftArm.rotation.x = 0.05 + Math.sin(time * 0.3) * 0.008;
        }
        
        if (rightArm && this.animation.initialPose.rightUpperArm) {
            rightArm.rotation.z = -1.22 - Math.sin(time * 0.4 + Math.PI) * 0.015;
            rightArm.rotation.x = 0.05 + Math.sin(time * 0.3 + Math.PI) * 0.008;
        }
        
        // Occasional subtle idle gestures
        this.animation.gestureTimer += deltaTime;
        if (this.animation.gestureTimer > 8 + Math.random() * 12) {
            this.performSubtleIdleGesture();
            this.animation.gestureTimer = 0;
        }
    }
    
    updateSpeechAnimations(deltaTime, time) {
        if (!this.vrm.current.humanoid) return;
        
        const talkTime = time * 2.0;
        
        // More animated head movement during speech
        const head = this.vrm.current.humanoid.getNormalizedBoneNode('head');
        if (head) {
            head.rotation.x = Math.sin(talkTime * 1.1) * 0.03 + this.animation.headTarget.x * 0.3;
            head.rotation.y = Math.sin(talkTime * 0.9) * 0.04 + this.animation.headTarget.y * 0.3;
            head.rotation.z = Math.sin(talkTime * 0.7) * 0.02;
        }
        
        // Conversational gestures - arms move from rest position
        const leftArm = this.vrm.current.humanoid.getNormalizedBoneNode('leftUpperArm');
        const rightArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightUpperArm');
        const leftLowerArm = this.vrm.current.humanoid.getNormalizedBoneNode('leftLowerArm');
        const rightLowerArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightLowerArm');
        
        // Natural conversational gestures
        const gestureIntensity = 0.2 + Math.sin(talkTime * 0.4) * 0.15;
        
        if (leftArm) {
            // Raise left arm from rest position for gestures
            leftArm.rotation.z = 1.22 - gestureIntensity * 0.6; // Raise up from rest
            leftArm.rotation.x = 0.05 + Math.sin(talkTime * 0.8) * 0.12;
            leftArm.rotation.y = 0.02 + Math.sin(talkTime * 0.6) * 0.08;
        }
        
        if (rightArm) {
            // Mirror movement with slight delay for natural look
            rightArm.rotation.z = -1.22 + gestureIntensity * 0.7;
            rightArm.rotation.x = 0.05 + Math.sin(talkTime * 0.8 + 0.5) * 0.12;
            rightArm.rotation.y = -0.02 - Math.sin(talkTime * 0.6 + 0.5) * 0.08;
        }
        
        // Natural elbow movement during gestures
        if (leftLowerArm) {
            leftLowerArm.rotation.z = 0.1 + Math.sin(talkTime * 1.3) * 0.18;
            leftLowerArm.rotation.y = 0.01 - Math.sin(talkTime * 1.5) * 0.15;
        }
        
        if (rightLowerArm) {
            rightLowerArm.rotation.z = -0.1 - Math.sin(talkTime * 1.3 + Math.PI) * 0.18;
            rightLowerArm.rotation.y = -0.01 + Math.sin(talkTime * 1.5 + Math.PI) * 0.15;
        }
        
        // Body involvement in conversation
        const spine = this.vrm.current.humanoid.getNormalizedBoneNode('spine');
        const chest = this.vrm.current.humanoid.getNormalizedBoneNode('chest');
        
        if (spine) {
            spine.rotation.y = Math.sin(talkTime * 0.5) * 0.012;
            spine.rotation.x = 0.02 + Math.sin(talkTime * 0.4) * 0.008;
        }
        
        if (chest) {
            chest.rotation.y = Math.sin(talkTime * 0.6 + 0.5) * 0.008;
        }
    }
    
    updateExpressionAnimations(deltaTime) {
        if (!this.vrm.current?.expressionManager) return;
        
        // Smooth expression transitions
        if (this.animation.currentExpression !== this.animation.targetExpression) {
            this.animation.expressionIntensity -= 0.05; // Transition speed
            
            if (this.animation.expressionIntensity <= 0) {
                this.animation.currentExpression = this.animation.targetExpression;
                this.animation.expressionIntensity = 0;
            }
        } else if (this.animation.expressionIntensity < this.animation.targetIntensity) {
            this.animation.expressionIntensity = Math.min(
                this.animation.expressionIntensity + 0.05,
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
            
            // Mouth movement during speech
            if (this.animation.isTalking) {
                const mouthValue = Math.abs(Math.sin(Date.now() * 0.012)) * 0.4;
                this.vrm.current.expressionManager.setValue('aa', mouthValue);
            } else {
                this.vrm.current.expressionManager.setValue('aa', 0);
            }
        } catch (e) {
            // Expression not available
        }
    }
    
    updateBlinking(deltaTime) {
        if (!this.vrm.current?.expressionManager) return;
        
        this.animation.blinkTimer += deltaTime;
        const blinkInterval = this.animation.isTalking ? 2.5 : 3.5 + Math.random() * 2;
        
        if (this.animation.blinkTimer > blinkInterval) {
            this.performBlink();
            this.animation.blinkTimer = 0;
        }
    }
    
    performBlink() {
        if (!this.vrm.current?.expressionManager) return;
        
        try {
            this.vrm.current.expressionManager.setValue('blink', 1.0);
            setTimeout(() => {
                if (this.vrm.current?.expressionManager) {
                    this.vrm.current.expressionManager.setValue('blink', 0);
                }
            }, 120);
        } catch (e) {
            // Blink expression not available
        }
    }
    
    performSubtleIdleGesture() {
        if (!this.vrm.current.humanoid) return;
        
        const gestures = [
            () => this.subtleHeadTilt(),
            () => this.subtleShoulderRoll(),
            () => this.subtleWeightShift()
        ];
        
        const gesture = gestures[Math.floor(Math.random() * gestures.length)];
        gesture();
    }
    
    subtleHeadTilt() {
        const head = this.vrm.current.humanoid.getNormalizedBoneNode('head');
        if (!head) return;
        
        const originalZ = head.rotation.z;
        const tiltAmount = (Math.random() - 0.5) * 0.15;
        
        let progress = 0;
        const duration = 1.5;
        
        const tiltInterval = setInterval(() => {
            progress += 0.016;
            
            if (progress >= duration) {
                head.rotation.z = originalZ;
                clearInterval(tiltInterval);
                return;
            }
            
            const curve = Math.sin((progress / duration) * Math.PI);
            head.rotation.z = originalZ + tiltAmount * curve;
        }, 16);
    }
    
    subtleShoulderRoll() {
        const leftShoulder = this.vrm.current.humanoid.getNormalizedBoneNode('leftShoulder');
        const rightShoulder = this.vrm.current.humanoid.getNormalizedBoneNode('rightShoulder');
        
        if (!leftShoulder || !rightShoulder) return;
        
        let progress = 0;
        const duration = 2.0;
        
        const rollInterval = setInterval(() => {
            progress += 0.016;
            
            if (progress >= duration) {
                leftShoulder.rotation.z = 0.06;
                rightShoulder.rotation.z = -0.06;
                clearInterval(rollInterval);
                return;
            }
            
            const wave = Math.sin((progress / duration) * Math.PI * 2);
            leftShoulder.rotation.z = 0.06 + wave * 0.04;
            rightShoulder.rotation.z = -0.06 - wave * 0.04;
        }, 16);
    }
    
    subtleWeightShift() {
        if (!this.vrm.current.scene) return;
        
        const originalX = this.vrm.current.scene.position.x;
        const shiftAmount = (Math.random() - 0.5) * 0.02;
        
        let progress = 0;
        const duration = 3.0;
        
        const shiftInterval = setInterval(() => {
            progress += 0.016;
            
            if (progress >= duration) {
                this.vrm.current.scene.position.x = originalX;
                clearInterval(shiftInterval);
                return;
            }
            
            const curve = Math.sin((progress / duration) * Math.PI);
            this.vrm.current.scene.position.x = originalX + shiftAmount * curve;
        }, 16);
    }
    
    // Public animation methods
    
    playWave() {
        if (!this.vrm.current || this.animation.isWaving) return;
        
        console.log('🌊 Playing AIRI-style wave animation');
        this.animation.isWaving = true;
        
        // Set happy expression during wave
        this.setExpression('happy', 0.6, 4000);
        
        if (this.vrm.current.humanoid && !this.vrm.current.isFallback) {
            this.playHumanoidWave();
        } else {
            this.playFallbackWave();
        }
        
        this.emit('animation:wave:start');
    }
    
    playHumanoidWave() {
        const rightArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightUpperArm');
        const rightLowerArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightLowerArm');
        const rightHand = this.vrm.current.humanoid.getNormalizedBoneNode('rightHand');
        
        if (!rightArm) {
            this.playFallbackWave();
            return;
        }
        
        let waveTime = 0;
        const waveDuration = 3.0;
        
        const waveInterval = setInterval(() => {
            waveTime += 0.016;
            
            if (waveTime >= waveDuration) {
                // Return to natural rest position (70 degrees down)
                rightArm.rotation.z = -1.22;
                rightArm.rotation.x = 0.05;
                rightArm.rotation.y = -0.02;
                
                if (rightLowerArm) {
                    rightLowerArm.rotation.z = -0.1;
                    rightLowerArm.rotation.y = -0.01;
                }
                
                if (rightHand) {
                    rightHand.rotation.z = -0.05;
                    rightHand.rotation.x = 0.03;
                }
                
                this.animation.isWaving = false;
                this.setExpression('neutral', 0);
                
                clearInterval(waveInterval);
                this.emit('animation:wave:end');
                return;
            }
            
            // Natural wave motion
            const wavePhase = (waveTime / waveDuration) * Math.PI * 6; // Multiple waves
            const waveIntensity = Math.sin(wavePhase);
            const envelopeStart = Math.min(waveTime * 4, 1); // Quick ramp up
            const envelopeEnd = Math.max(0, 1 - Math.pow((waveTime - waveDuration + 0.5) / 0.5, 2)); // Smooth end
            const envelope = envelopeStart * envelopeEnd;
            
            // Raise arm up and to the side for waving
            rightArm.rotation.z = -1.22 + envelope * (-0.5); // Raise from rest position
            rightArm.rotation.x = 0.05 + envelope * (-0.3); // Move slightly back
            rightArm.rotation.y = -0.02 + envelope * 0.15; // Out to the side
            
            if (rightLowerArm) {
                rightLowerArm.rotation.z = -0.1 + envelope * (-0.4); // Bend elbow more
                rightLowerArm.rotation.y = -0.01 + envelope * 0.3; // Natural elbow position
            }
            
            if (rightHand) {
                // Wave hand side to side
                rightHand.rotation.z = -0.05 + waveIntensity * envelope * 0.3;
                rightHand.rotation.y = waveIntensity * envelope * 0.2;
            }
            
            // Add subtle body movement
            if (this.vrm.current.scene) {
                this.vrm.current.scene.rotation.y = Math.PI + Math.sin(wavePhase * 0.5) * envelope * 0.03;
            }
        }, 16);
    }
    
    playFallbackWave() {
        if (!this.vrm.current?.scene) return;
        
        let waveTime = 0;
        const waveDuration = 2.0;
        
        const waveInterval = setInterval(() => {
            waveTime += 0.016;
            
            if (waveTime >= waveDuration) {
                this.vrm.current.scene.rotation.z = 0;
                this.animation.isWaving = false;
                clearInterval(waveInterval);
                this.emit('animation:wave:end');
                return;
            }
            
            const wavePhase = (waveTime / waveDuration) * Math.PI * 4;
            const envelope = Math.sin((waveTime / waveDuration) * Math.PI);
            
            this.vrm.current.scene.rotation.z = Math.sin(wavePhase) * envelope * 0.15;
        }, 16);
    }
    
    startSpeechAnimation(text) {
        console.log('🗣️ Starting AIRI-style speech animation');
        this.animation.isTalking = true;
        
        // Set appropriate expression based on text sentiment
        if (text) {
            const lowerText = text.toLowerCase();
            
            if (lowerText.includes('happy') || lowerText.includes('great') || lowerText.includes('awesome')) {
                this.setExpression('happy', 0.4);
            } else if (lowerText.includes('wow') || lowerText.includes('amazing') || lowerText.includes('!')) {
                this.setExpression('surprised', 0.35);
                setTimeout(() => this.setExpression('happy', 0.25), 800);
            } else {
                this.setExpression('happy', 0.25); // Default pleasant expression
            }
        }
        
        this.emit('animation:speech:start');
    }
    
    stopSpeechAnimation() {
        console.log('🔇 Stopping speech animation');
        this.animation.isTalking = false;
        
        // Return to neutral expression
        this.setExpression('neutral', 0);
        
        // Smoothly return arms to rest position
        if (this.vrm.current.humanoid && !this.vrm.current.isFallback) {
            const leftArm = this.vrm.current.humanoid.getNormalizedBoneNode('leftUpperArm');
            const rightArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightUpperArm');
            
            if (leftArm && rightArm) {
                let returnTime = 0;
                const returnDuration = 0.8;
                
                const returnInterval = setInterval(() => {
                    returnTime += 0.016;
                    
                    if (returnTime >= returnDuration) {
                        // Final rest position
                        leftArm.rotation.z = 1.22;
                        rightArm.rotation.z = -1.22;
                        clearInterval(returnInterval);
                        return;
                    }
                    
                    const progress = returnTime / returnDuration;
                    const smoothProgress = progress * progress * (3 - 2 * progress); // Smooth step
                    
                    // Interpolate back to rest position
                    leftArm.rotation.z = leftArm.rotation.z * (1 - smoothProgress) + 1.22 * smoothProgress;
                    rightArm.rotation.z = rightArm.rotation.z * (1 - smoothProgress) + (-1.22) * smoothProgress;
                }, 16);
            }
        }
        
        this.emit('animation:speech:end');
    }
    
    setExpression(expression, intensity = 0.5, duration = 1000) {
        this.animation.targetExpression = expression;
        this.animation.targetIntensity = intensity;
        
        console.log(`😊 Expression set: ${expression} (${intensity})`);
        
        if (duration > 0) {
            setTimeout(() => {
                this.animation.targetExpression = 'neutral';
                this.animation.targetIntensity = 0;
            }, duration);
        }
        
        this.emit('expression:set', { expression, intensity, duration });
    }
    
    updateHeadTarget(x, y) {
        // Convert mouse coordinates to head target angles
        this.animation.headTarget.x = y * 0.15; // Up/down
        this.animation.headTarget.y = x * 0.2;  // Left/right
    }
    
    playWelcomeSequence() {
        if (!this.vrm.current || this.vrm.current.isFallback) return;
        
        console.log('🎉 Playing welcome animation sequence');
        
        // Start with happy expression
        this.setExpression('happy', 0.4, 1500);
        
        // Play wave animation
        setTimeout(() => {
            this.playWave();
        }, 500);
        
        // Add a wink after wave
        setTimeout(() => {
            this.performWink();
        }, 3800);
        
        // Final smile
        setTimeout(() => {
            this.setExpression('happy', 0.3, 2000);
        }, 4500);
        
        this.emit('animation:welcome');
    }
    
    performWink() {
        if (!this.vrm.current?.expressionManager) return;
        
        try {
            this.vrm.current.expressionManager.setValue('winkLeft', 1.0);
            setTimeout(() => {
                if (this.vrm.current?.expressionManager) {
                    this.vrm.current.expressionManager.setValue('winkLeft', 0);
                }
            }, 200);
        } catch (e) {
            // Wink not available, do a blink instead
            this.performBlink();
        }
    }
    
    handleResize() {
        if (!this.three.camera || !this.three.renderer) return;
        
        this.three.camera.aspect = window.innerWidth / window.innerHeight;
        this.three.camera.updateProjectionMatrix();
        this.three.renderer.setSize(window.innerWidth, window.innerHeight);
        
        this.emit('resize');
    }
    
    destroy() {
        // Stop all animations
        this.animation.isWaving = false;
        this.animation.isTalking = false;
        
        // Dispose VRM
        if (this.vrm.current) {
            this.three.scene.remove(this.vrm.current.scene);
            if (window.VRMUtils) {
                window.VRMUtils.deepDispose(this.vrm.current.scene);
            }
        }
        
        // Dispose renderer
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
