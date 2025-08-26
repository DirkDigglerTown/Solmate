// web/js/VRMLoader.js
// Dedicated VRM loading module with proper positioning fix

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
            armSwayPhase: 0
        };
        
        this.config = {
            paths: [
                '/assets/avatar/solmate.vrm',
                'https://raw.githubusercontent.com/DirkDigglerTown/solmate/main/web/assets/avatar/solmate.vrm'
            ],
            fallbackEnabled: true,
            // Final positioning - avatar properly centered and visible
            cameraPosition: { x: 0, y: 4.0, z: 5.0 },   // Camera at eye level, back for full view
            lookAtPosition: { x: 0, y: 4.0, z: 0 },     // Look straight at avatar center
            modelPosition: { x: 0, y: 4.0, z: 0 }       // Model at proper height
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
        
        // Create camera with adjusted FOV and position
        this.three.camera = new THREE.PerspectiveCamera(
            50,  // Even wider FOV to capture full height
            window.innerWidth / window.innerHeight,
            0.1,
            20
        );
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
        
        // Setup humanoid - adjust hip position if needed
        if (vrm.humanoid) {
            const hips = vrm.humanoid.getNormalizedBoneNode('hips');
            if (hips) {
                // Keep hips at origin relative to the model
                hips.position.set(0, 0, 0);
            }
            
            // Adjust spine/chest for better framing if available
            const spine = vrm.humanoid.getNormalizedBoneNode('spine');
            const chest = vrm.humanoid.getNormalizedBoneNode('chest');
            if (spine) {
                spine.rotation.x = 0.05; // Slight forward lean
            }
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
        
        // Trigger welcome sequence after VRM loads
        this.adjustCameraForModel(vrm);
        
        // Play welcome animation after a short delay
        setTimeout(() => {
            this.playWelcomeSequence();
        }, 1000);
        
        this.emit('vrm:setup', vrm);
    }
    
    adjustCameraForModel(vrm) {
        const THREE = window.THREE;
        
        // Calculate bounding box of the model
        const box = new THREE.Box3();
        box.setFromObject(vrm.scene);
        
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        
        // For aggressive positioning, don't auto-adjust - use manual settings
        // Just log the dimensions for debugging
        console.log('Model dimensions:', {
            center: center,
            size: size,
            currentPosition: this.config.modelPosition
        });
        
        // Keep the camera looking at the configured position
        this.three.camera.lookAt(
            this.config.lookAtPosition.x,
            this.config.lookAtPosition.y,
            this.config.lookAtPosition.z
        );
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
        mesh.position.y = 1.4; // Position fallback avatar higher
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
        const breathe = 1 + Math.sin(this.animation.breathingPhase * 2) * 0.02;
        if (this.vrm.current.scene) {
            this.vrm.current.scene.scale.y = breathe;
            this.vrm.current.scene.scale.x = 1 + Math.sin(this.animation.breathingPhase * 2 + Math.PI) * 0.005;
        }
        
        // === IDLE ANIMATIONS ===
        if (!this.animation.isTalking && !this.animation.isWaving) {
            // Natural body sway
            this.animation.swayPhase += deltaTime * 0.5;
            if (this.vrm.current.scene) {
                this.vrm.current.scene.rotation.y = Math.PI + Math.sin(this.animation.swayPhase) * 0.03;
                this.vrm.current.scene.position.x = Math.sin(this.animation.swayPhase * 0.7) * 0.02;
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
                    neck.rotation.x = Math.sin(time * 0.7 + 0.5) * 0.01;
                    neck.rotation.y = Math.sin(time * 0.5 + 0.5) * 0.02;
                }
                
                // Natural arm movements
                const leftArm = this.vrm.current.humanoid.getNormalizedBoneNode('leftUpperArm');
                const rightArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightUpperArm');
                
                this.animation.armSwayPhase += deltaTime * 0.8;
                
                if (leftArm) {
                    leftArm.rotation.z = 0.2 + Math.sin(this.animation.armSwayPhase) * 0.05;
                    leftArm.rotation.x = Math.sin(this.animation.armSwayPhase * 1.3) * 0.03;
                }
                
                if (rightArm) {
                    rightArm.rotation.z = -0.2 - Math.sin(this.animation.armSwayPhase + Math.PI) * 0.05;
                    rightArm.rotation.x = Math.sin(this.animation.armSwayPhase * 1.3 + Math.PI) * 0.03;
                }
                
                // Occasional idle gestures
                this.animation.idleTimer += deltaTime;
                if (this.animation.idleTimer > 5 + Math.random() * 5) {
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
            
            // Hand gestures while talking
            const leftArm = this.vrm.current.humanoid.getNormalizedBoneNode('leftUpperArm');
            const rightArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightUpperArm');
            const leftLowerArm = this.vrm.current.humanoid.getNormalizedBoneNode('leftLowerArm');
            const rightLowerArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightLowerArm');
            const leftHand = this.vrm.current.humanoid.getNormalizedBoneNode('leftHand');
            const rightHand = this.vrm.current.humanoid.getNormalizedBoneNode('rightHand');
            
            // Natural conversational gestures
            const gestureIntensity = 0.3 + Math.sin(talkTime * 0.5) * 0.2;
            
            if (leftArm) {
                leftArm.rotation.z = 0.3 + Math.sin(talkTime) * gestureIntensity;
                leftArm.rotation.x = Math.sin(talkTime * 1.3) * 0.2;
                leftArm.rotation.y = Math.sin(talkTime * 0.7) * 0.1;
            }
            
            if (rightArm) {
                rightArm.rotation.z = -0.3 - Math.sin(talkTime + Math.PI * 0.5) * gestureIntensity;
                rightArm.rotation.x = Math.sin(talkTime * 1.3 + Math.PI) * 0.2;
                rightArm.rotation.y = -Math.sin(talkTime * 0.7 + Math.PI) * 0.1;
            }
            
            if (leftLowerArm) {
                leftLowerArm.rotation.y = -0.5 + Math.sin(talkTime * 1.5) * 0.3;
                leftLowerArm.rotation.z = Math.sin(talkTime * 2) * 0.1;
            }
            
            if (rightLowerArm) {
                rightLowerArm.rotation.y = 0.5 - Math.sin(talkTime * 1.5 + Math.PI) * 0.3;
                rightLowerArm.rotation.z = Math.sin(talkTime * 2 + Math.PI) * 0.1;
            }
            
            if (leftHand) {
                leftHand.rotation.z = Math.sin(talkTime * 2.5) * 0.2;
                leftHand.rotation.x = Math.sin(talkTime * 3) * 0.1;
            }
            
            if (rightHand) {
                rightHand.rotation.z = Math.sin(talkTime * 2.5 + Math.PI) * 0.2;
                rightHand.rotation.x = Math.sin(talkTime * 3 + Math.PI) * 0.1;
            }
            
            // Body movement while talking
            if (this.vrm.current.humanoid) {
                const spine = this.vrm.current.humanoid.getNormalizedBoneNode('spine');
                const chest = this.vrm.current.humanoid.getNormalizedBoneNode('chest');
                
                if (spine) {
                    spine.rotation.y = Math.sin(talkTime * 0.8) * 0.02;
                    spine.rotation.x = 0.05 + Math.sin(talkTime * 0.6) * 0.02;
                }
                
                if (chest) {
                    chest.rotation.y = Math.sin(talkTime * 0.9 + 0.5) * 0.02;
                    chest.rotation.x = Math.sin(talkTime * 0.7) * 0.01;
                }
            }
        }
        
        // === EXPRESSION ANIMATIONS ===
        this.updateExpressions(deltaTime);
        
        // === BLINKING ===
        this.animation.blinkTimer += deltaTime;
        const blinkInterval = this.animation.isTalking ? 2 : 3;
        if (this.animation.blinkTimer > blinkInterval + Math.random() * 2) {
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
            () => this.performWink()
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
                head.rotation.z = originalRotation.z + tiltProgress * 0.15;
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
                
                if (shrugTime >= 1) {
                    leftShoulder.rotation.z = 0;
                    rightShoulder.rotation.z = 0;
                    clearInterval(shrugInterval);
                    return;
                }
                
                const shrugProgress = Math.sin(shrugTime * Math.PI);
                leftShoulder.rotation.z = shrugProgress * 0.1;
                rightShoulder.rotation.z = -shrugProgress * 0.1;
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
                hips.position.x = shiftProgress * 0.02;
                hips.rotation.z = shiftProgress * 0.01;
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
        this.setExpression('happy', 0.5);
        
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
        
        const originalUpperRotation = rightArm.rotation.clone();
        const originalLowerRotation = rightLowerArm ? rightLowerArm.rotation.clone() : null;
        const originalHandRotation = rightHand ? rightHand.rotation.clone() : null;
        
        let waveTime = 0;
        
        const waveInterval = setInterval(() => {
            waveTime += 0.016;
            
            if (waveTime >= 3) {
                rightArm.rotation.copy(originalUpperRotation);
                if (rightLowerArm && originalLowerRotation) {
                    rightLowerArm.rotation.copy(originalLowerRotation);
                }
                if (rightHand && originalHandRotation) {
                    rightHand.rotation.copy(originalHandRotation);
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
            
            // Raise arm up and to the side
            rightArm.rotation.z = -1.2 - Math.abs(waveIntensity) * 0.3;
            rightArm.rotation.x = -0.5;
            rightArm.rotation.y = 0.3;
            
            if (rightLowerArm) {
                // Bend elbow naturally
                rightLowerArm.rotation.y = 0.8;
                rightLowerArm.rotation.z = waveIntensity * 0.3;
            }
            
            if (rightHand) {
                // Wave hand side to side
                rightHand.rotation.z = waveIntensity * 0.5;
                rightHand.rotation.y = waveIntensity * 0.3;
                
                // Add finger movement if available
                const fingers = ['thumb', 'index', 'middle', 'ring', 'little'];
                fingers.forEach(finger => {
                    const proximal = this.vrm.current.humanoid.getNormalizedBoneNode(`right${finger.charAt(0).toUpperCase() + finger.slice(1)}Proximal`);
                    if (proximal) {
                        proximal.rotation.z = Math.abs(waveIntensity) * 0.2;
                    }
                });
            }
            
            // Add slight body movement
            if (this.vrm.current.scene) {
                this.vrm.current.scene.rotation.y = Math.PI + Math.sin(waveTime * Math.PI * 2) * 0.05;
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
                leftArm.rotation.z = 0.2;
            }
            if (rightArm) {
                rightArm.rotation.z = -0.2;
            }
        }
        
        this.emit('animation:speech:start');
    }
    
    stopSpeechAnimation() {
        this.animation.isTalking = false;
        
        // Return to neutral expression
        this.setExpression('neutral', 0);
        
        // Reset arm positions smoothly
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
                    clearInterval(returnInterval);
                    return;
                }
                
                const progress = returnTime / 0.5;
                
                if (leftArm) {
                    leftArm.rotation.z = leftArm.rotation.z * (1 - progress) + 0.1 * progress;
                    leftArm.rotation.x = leftArm.rotation.x * (1 - progress);
                }
                if (rightArm) {
                    rightArm.rotation.z = rightArm.rotation.z * (1 - progress) - 0.1 * progress;
                    rightArm.rotation.x = rightArm.rotation.x * (1 - progress);
                }
                if (leftLowerArm) {
                    leftLowerArm.rotation.y = leftLowerArm.rotation.y * (1 - progress);
                }
                if (rightLowerArm) {
                    rightLowerArm.rotation.y = rightLowerArm.rotation.y * (1 - progress);
                }
            }, 16);
        }
        
        this.emit('animation:speech:end');
    }
    
    updateHeadTarget(x, y) {
        this.animation.headTarget.x = x;
        this.animation.headTarget.y = y;
    }
    
    handleResize() {
        if (!this.three.camera || !this.three.renderer) return;
        
        this.three.camera.aspect = window.innerWidth / window.innerHeight;
        this.three.camera.updateProjectionMatrix();
        this.three.renderer.setSize(window.innerWidth, window.innerHeight);
        
        // Optionally adjust camera position on mobile/tablet
        if (window.innerWidth < 768) {
            this.three.camera.position.z = 3; // Move camera back on mobile
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
        
        // Small bow/nod
        setTimeout(() => {
            this.performNod();
        }, 5000);
        
        this.emit('animation:welcome');
    }
    
    // Nodding animation
    performNod() {
        const head = this.vrm.current?.humanoid?.getNormalizedBoneNode('head');
        const neck = this.vrm.current?.humanoid?.getNormalizedBoneNode('neck');
        
        if (head || neck) {
            const target = head || neck;
            const originalRotation = target.rotation.clone();
            let nodTime = 0;
            
            const nodInterval = setInterval(() => {
                nodTime += 0.016;
                
                if (nodTime >= 1) {
                    target.rotation.copy(originalRotation);
                    clearInterval(nodInterval);
                    return;
                }
                
                const nodProgress = Math.sin(nodTime * Math.PI * 2);
                target.rotation.x = originalRotation.x + nodProgress * 0.2;
            }, 16);
        }
    }
    
    // React to user input
    reactToUserInput() {
        // Quick acknowledgment animation
        if (this.vrm.current?.humanoid && !this.vrm.current.isFallback) {
            const head = this.vrm.current.humanoid.getNormalizedBoneNode('head');
            if (head) {
                // Small tilt to show listening
                const originalRotation = head.rotation.clone();
                head.rotation.z = 0.1;
                
                setTimeout(() => {
                    head.rotation.copy(originalRotation);
                }, 300);
            }
            
            // Set attentive expression
            this.setExpression('happy', 0.2);
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
