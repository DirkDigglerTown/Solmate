// web/js/VRMController.js
// Complete AIRI-inspired natural animation system - replaces current VRMController.js

import { EventEmitter } from './EventEmitter.js';

export class VRMController extends EventEmitter {
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
        
        // ENHANCED: Animation State Machine (AIRI-inspired)
        this.animation = {
            // State management
            currentState: 'idle',
            previousState: 'idle',
            stateTransition: 0,
            
            // Animation sequences
            currentSequence: null,
            sequenceTime: 0,
            sequences: new Map(),
            
            // Bone cache for performance
            bones: {
                hips: null, spine: null, chest: null, upperChest: null,
                neck: null, head: null,
                leftShoulder: null, rightShoulder: null,
                leftUpperArm: null, rightUpperArm: null,
                leftLowerArm: null, rightLowerArm: null,
                leftHand: null, rightHand: null,
                // Finger bones for detailed hand animation
                leftThumbProximal: null, leftIndexProximal: null, leftMiddleProximal: null,
                rightThumbProximal: null, rightIndexProximal: null, rightMiddleProximal: null
            },
            
            // Animation targets (for smooth interpolation)
            targets: {},
            
            // Expression system
            expressions: {
                current: 'neutral',
                target: 'neutral',
                intensity: 0,
                targetIntensity: 0,
                transitionSpeed: 0.05
            },
            
            // Idle behaviors
            isWaving: false,
            isTalking: false,
            headTarget: { x: 0, y: 0 },
            breathing: { phase: 0, intensity: 0.025 },
            blinking: { timer: 0, interval: 3 },
            microMovements: { timer: 0, interval: 8 },
            
            // Conversation context for natural reactions
            conversation: {
                sentiment: 'neutral',
                excitement: 0,
                recentEmotions: []
            }
        };
        
        // Natural rest poses (AIRI standard)
        this.restPoses = {
            leftUpperArm: { x: 0, y: 0, z: 1.22 },    // 70 degrees down
            rightUpperArm: { x: 0, y: 0, z: -1.22 },  // 70 degrees down
            leftLowerArm: { x: 0, y: 0, z: 0.17 },    // 10 degrees bend
            rightLowerArm: { x: 0, y: 0, z: -0.17 },  // 10 degrees bend
            leftHand: { x: 0.05, y: 0, z: 0.1 },      // Natural droop
            rightHand: { x: 0.05, y: 0, z: -0.1 },    // Natural droop
            spine: { x: 0.03, y: 0, z: 0 },           // Slight forward lean
            neck: { x: 0.05, y: 0, z: 0 },            // Natural tilt
            head: { x: 0, y: 0, z: 0 }                 // Neutral
        };
        
        this.config = {
            paths: [
                '/assets/avatar/solmate.vrm',
                'https://raw.githubusercontent.com/DirkDigglerTown/solmate/main/web/assets/avatar/solmate.vrm'
            ],
            fallbackEnabled: true,
            // Camera positioned for closer, more intimate interaction
            cameraPosition: { x: 0, y: 3.8, z: 6.5 },   // Closer camera
            lookAtPosition: { x: 0, y: 3.8, z: 0 },     // Look at face level
            modelPosition: { x: 0, y: 4.5, z: 0 }       // Model position
        };
    }
    
    async init() {
        if (this.state.initialized) {
            console.warn('VRMController already initialized');
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
        if (window.THREE && window.VRMLoaderPlugin) {
            return;
        }
        
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
        
        this.three.scene = new THREE.Scene();
        this.three.scene.background = new THREE.Color(0x0a0e17);
        
        // Closer camera for more intimate interaction
        this.three.camera = new THREE.PerspectiveCamera(
            45,  // Closer FOV for more intimate feel
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
        
        this.setupLighting();
        this.three.clock = new THREE.Clock();
        
        window.addEventListener('resize', () => this.handleResize());
        
        this.emit('scene:created');
    }
    
    setupLighting() {
        const THREE = window.THREE;
        
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.three.scene.add(ambientLight);
        this.three.lights.push(ambientLight);
        
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
        
        this.vrm.current = vrm;
        
        // Rotate to face camera
        vrm.scene.rotation.y = Math.PI;
        
        // Position the model
        vrm.scene.position.set(
            this.config.modelPosition.x,
            this.config.modelPosition.y,
            this.config.modelPosition.z
        );
        
        this.three.scene.add(vrm.scene);
        
        // ENHANCED: Setup AIRI-style animation system
        if (vrm.humanoid) {
            this.cacheBoneReferences(vrm.humanoid);
            this.setNaturalRestPose();
            this.initializeAnimationTargets();
            this.setupAnimationSequences();
        }
        
        if (vrm.lookAt) {
            vrm.lookAt.target = this.three.camera;
        }
        
        if (vrm.expressionManager) {
            this.setupExpressions(vrm.expressionManager);
        }
        
        console.log('🎭 VRM setup complete with AIRI-style natural animation system');
        
        // Enhanced opening sequence
        setTimeout(() => {
            this.playOpeningSequence();
        }, 1000);
        
        this.emit('vrm:setup', vrm);
    }
    
    // ENHANCED: Cache bone references for performance
    cacheBoneReferences(humanoid) {
        Object.keys(this.animation.bones).forEach(boneName => {
            this.animation.bones[boneName] = humanoid.getNormalizedBoneNode(boneName);
        });
        
        console.log('🦴 Cached bone references:', 
            Object.keys(this.animation.bones).filter(key => this.animation.bones[key]).length);
    }
    
    // ENHANCED: Set AIRI-standard natural rest pose
    setNaturalRestPose() {
        Object.keys(this.restPoses).forEach(boneName => {
            const bone = this.animation.bones[boneName];
            if (bone) {
                const pose = this.restPoses[boneName];
                bone.rotation.set(pose.x, pose.y, pose.z);
            }
        });
        
        console.log('✅ AIRI-standard natural rest pose applied');
    }
    
    // ENHANCED: Initialize animation targets for smooth interpolation
    initializeAnimationTargets() {
        Object.keys(this.animation.bones).forEach(boneName => {
            const bone = this.animation.bones[boneName];
            if (bone) {
                this.animation.targets[boneName] = {
                    rotation: bone.rotation.clone(),
                    position: bone.position.clone()
                };
            }
        });
    }
    
    // ENHANCED: Setup natural animation sequences (AIRI-inspired)
    setupAnimationSequences() {
        // NATURAL WAVE ANIMATION - Multi-phase, multi-bone sequence
        this.animation.sequences.set('wave', {
            duration: 4.5,
            keyframes: [
                // Phase 1: Prepare to wave (0.0s - 0.8s)
                {
                    time: 0.0,
                    bones: {
                        rightShoulder: { rotation: { x: 0, y: 0, z: -0.08 } },
                        rightUpperArm: { rotation: { x: 0, y: 0, z: -1.22 } },
                        rightLowerArm: { rotation: { x: 0, y: 0, z: -0.17 } },
                        rightHand: { rotation: { x: 0.05, y: 0, z: -0.1 } }
                    }
                },
                {
                    time: 0.8,
                    bones: {
                        rightShoulder: { rotation: { x: 0, y: 0, z: -0.15 } },
                        rightUpperArm: { rotation: { x: -0.2, y: 0.3, z: -0.8 } },
                        rightLowerArm: { rotation: { x: 0, y: 0.8, z: -0.3 } },
                        rightHand: { rotation: { x: 0, y: 0, z: -0.2 } }
                    }
                },
                // Phase 2: Raise hand to wave position (0.8s - 1.2s)
                {
                    time: 1.2,
                    bones: {
                        rightShoulder: { rotation: { x: 0, y: 0, z: -0.2 } },
                        rightUpperArm: { rotation: { x: -0.4, y: 0.2, z: -1.0 } },
                        rightLowerArm: { rotation: { x: 0, y: 1.0, z: -0.5 } },
                        rightHand: { rotation: { x: 0, y: 0, z: -0.3 } }
                    }
                },
                // Phase 3: Wave motions (1.2s - 3.0s)
                {
                    time: 1.6,
                    bones: {
                        rightShoulder: { rotation: { x: 0, y: 0, z: -0.2 } },
                        rightUpperArm: { rotation: { x: -0.4, y: 0.4, z: -1.0 } },
                        rightLowerArm: { rotation: { x: 0, y: 0.8, z: -0.3 } },
                        rightHand: { rotation: { x: 0, y: 0.3, z: -0.1 } }
                    }
                },
                {
                    time: 2.0,
                    bones: {
                        rightShoulder: { rotation: { x: 0, y: 0, z: -0.2 } },
                        rightUpperArm: { rotation: { x: -0.4, y: 0, z: -1.0 } },
                        rightLowerArm: { rotation: { x: 0, y: 0.8, z: -0.3 } },
                        rightHand: { rotation: { x: 0, y: -0.3, z: -0.1 } }
                    }
                },
                {
                    time: 2.4,
                    bones: {
                        rightShoulder: { rotation: { x: 0, y: 0, z: -0.2 } },
                        rightUpperArm: { rotation: { x: -0.4, y: 0.4, z: -1.0 } },
                        rightLowerArm: { rotation: { x: 0, y: 0.8, z: -0.3 } },
                        rightHand: { rotation: { x: 0, y: 0.3, z: -0.1 } }
                    }
                },
                {
                    time: 2.8,
                    bones: {
                        rightShoulder: { rotation: { x: 0, y: 0, z: -0.2 } },
                        rightUpperArm: { rotation: { x: -0.4, y: 0, z: -1.0 } },
                        rightLowerArm: { rotation: { x: 0, y: 0.8, z: -0.3 } },
                        rightHand: { rotation: { x: 0, y: -0.3, z: -0.1 } }
                    }
                },
                // Phase 4: Return to rest (3.0s - 4.5s)
                {
                    time: 4.5,
                    bones: {
                        rightShoulder: { rotation: { x: 0, y: 0, z: -0.08 } },
                        rightUpperArm: { rotation: this.restPoses.rightUpperArm },
                        rightLowerArm: { rotation: this.restPoses.rightLowerArm },
                        rightHand: { rotation: this.restPoses.rightHand }
                    }
                }
            ],
            expression: { type: 'happy', intensity: 0.6 }
        });
        
        // TALKING ANIMATION - Natural conversational gestures
        this.animation.sequences.set('talking', {
            duration: -1, // Looping
            keyframes: [
                {
                    time: 0,
                    bones: {
                        leftUpperArm: { rotation: { x: 0.1, y: -0.1, z: 1.1 } },
                        rightUpperArm: { rotation: { x: 0.1, y: 0.1, z: -1.1 } },
                        leftLowerArm: { rotation: { x: 0, y: -0.2, z: 0.3 } },
                        rightLowerArm: { rotation: { x: 0, y: 0.2, z: -0.3 } },
                        head: { rotation: { x: 0.02, y: 0, z: 0 } },
                        spine: { rotation: { x: 0.05, y: 0.01, z: 0 } }
                    }
                },
                {
                    time: 2.0,
                    bones: {
                        leftUpperArm: { rotation: { x: 0.15, y: -0.05, z: 1.0 } },
                        rightUpperArm: { rotation: { x: 0.15, y: 0.05, z: -1.0 } },
                        leftLowerArm: { rotation: { x: 0, y: -0.3, z: 0.4 } },
                        rightLowerArm: { rotation: { x: 0, y: 0.3, z: -0.4 } },
                        head: { rotation: { x: 0, y: 0.03, z: 0 } },
                        spine: { rotation: { x: 0.05, y: -0.01, z: 0 } }
                    }
                }
            ],
            expression: { type: 'happy', intensity: 0.3 }
        });
        
        console.log('🎬 Natural animation sequences loaded:', Array.from(this.animation.sequences.keys()));
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
        
        console.log('😊 Available expressions:', available);
    }
    
    createFallbackAvatar() {
        console.log('Creating fallback avatar');
        const THREE = window.THREE;
        
        const group = new THREE.Group();
        group.name = 'FallbackAvatar';
        
        const geometry = new THREE.CapsuleGeometry(0.3, 1, 4, 8);
        const material = new THREE.MeshLambertMaterial({ color: 0xff6b6b });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        group.add(mesh);
        group.position.y = this.config.modelPosition.y;
        this.three.scene.add(group);
        
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
                
                // ENHANCED: Update AIRI-style animations
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
    
    // ENHANCED: AIRI-style animation update system
    updateAnimations(deltaTime) {
        if (!this.vrm.current || this.vrm.current.isFallback) return;
        
        const time = Date.now() / 1000;
        
        // Update current animation sequence
        if (this.animation.currentSequence) {
            this.updateAnimationSequence(deltaTime);
        }
        
        // Update idle behaviors (always running unless overridden)
        this.updateIdleBehaviors(deltaTime, time);
        
        // Update expressions
        this.updateExpressions(deltaTime);
        
        // Apply smooth interpolation to all animation targets
        this.applyAnimationInterpolation(deltaTime);
    }
    
    // ENHANCED: Keyframe-based animation sequence system
    updateAnimationSequence(deltaTime) {
        const sequenceName = this.animation.currentSequence;
        const sequence = this.animation.sequences.get(sequenceName);
        if (!sequence) return;
        
        this.animation.sequenceTime += deltaTime;
        
        // Find current and next keyframes
        let currentFrame = null;
        let nextFrame = null;
        
        for (let i = 0; i < sequence.keyframes.length; i++) {
            const frame = sequence.keyframes[i];
            if (this.animation.sequenceTime >= frame.time) {
                currentFrame = frame;
                nextFrame = sequence.keyframes[i + 1] || null;
            } else {
                break;
            }
        }
        
        if (currentFrame) {
            if (nextFrame) {
                // Interpolate between keyframes
                const progress = (this.animation.sequenceTime - currentFrame.time) / 
                               (nextFrame.time - currentFrame.time);
                this.interpolateKeyframes(currentFrame, nextFrame, progress);
            } else {
                // Use current keyframe
                this.applyKeyframe(currentFrame);
            }
        }
        
        // Check if sequence is complete
        if (sequence.duration > 0 && this.animation.sequenceTime >= sequence.duration) {
            this.stopAnimation();
        }
    }
    
    interpolateKeyframes(frame1, frame2, progress) {
        Object.keys(frame1.bones).forEach(boneName => {
            const bone = this.animation.bones[boneName];
            if (!bone) return;
            
            const rot1 = frame1.bones[boneName].rotation;
            const rot2 = frame2.bones[boneName].rotation;
            
            if (rot1 && rot2) {
                this.animation.targets[boneName].rotation.x = this.lerp(rot1.x, rot2.x, progress);
                this.animation.targets[boneName].rotation.y = this.lerp(rot1.y, rot2.y, progress);
                this.animation.targets[boneName].rotation.z = this.lerp(rot1.z, rot2.z, progress);
            }
        });
    }
    
    applyKeyframe(frame) {
        Object.keys(frame.bones).forEach(boneName => {
            const bone = this.animation.bones[boneName];
            if (!bone) return;
            
            const rotation = frame.bones[boneName].rotation;
            if (rotation) {
                this.animation.targets[boneName].rotation.set(rotation.x, rotation.y, rotation.z);
            }
        });
    }
    
    // ENHANCED: Natural idle behaviors (AIRI-inspired)
    updateIdleBehaviors(deltaTime, time) {
        // Breathing animation
        this.animation.breathing.phase += deltaTime * 2.5;
        const breathIntensity = 1 + Math.sin(this.animation.breathing.phase) * this.animation.breathing.intensity;
        
        const chest = this.animation.bones.chest;
        const upperChest = this.animation.bones.upperChest;
        
        if (chest) {
            chest.scale.set(breathIntensity, breathIntensity, breathIntensity);
        }
        if (upperChest) {
            upperChest.scale.set(breathIntensity, breathIntensity, breathIntensity);
        }
        
        // Natural idle movements (only when not in active animation)
        if (!this.animation.currentSequence) {
            // Subtle body sway
            if (this.vrm.current.scene) {
                this.vrm.current.scene.rotation.y = Math.PI + Math.sin(time * 0.3) * 0.008;
                this.vrm.current.scene.position.x = Math.sin(time * 0.4) * 0.005;
            }
            
            // Head movements with mouse tracking
            const head = this.animation.bones.head;
            const neck = this.animation.bones.neck;
            
            if (head) {
                const idleX = Math.sin(time * 0.6) * 0.01;
                const idleY = Math.sin(time * 0.8) * 0.015;
                const idleZ = Math.sin(time * 0.5) * 0.005;
                
                this.animation.targets.head.rotation.x = idleX + this.animation.headTarget.x * 0.2;
                this.animation.targets.head.rotation.y = idleY + this.animation.headTarget.y * 0.2;
                this.animation.targets.head.rotation.z = idleZ;
            }
            
            if (neck) {
                this.animation.targets.neck.rotation.x = 0.05 + Math.sin(time * 0.7) * 0.005;
                this.animation.targets.neck.rotation.y = Math.sin(time * 0.5) * 0.008;
            }
            
            // Micro-movements timer
            this.animation.microMovements.timer += deltaTime;
            if (this.animation.microMovements.timer > this.animation.microMovements.interval + Math.random() * 4) {
                this.performMicroGesture();
                this.animation.microMovements.timer = 0;
            }
        }
        
        // Blinking
        this.animation.blinking.timer += deltaTime;
        const blinkInterval = this.animation.isTalking ? 2 : this.animation.blinking.interval + Math.random();
        if (this.animation.blinking.timer > blinkInterval) {
            this.performBlink();
            this.animation.blinking.timer = 0;
        }
    }
    
    updateExpressions(deltaTime) {
        if (!this.vrm.current?.expressionManager) return;
        
        // Smooth expression transitions
        const expr = this.animation.expressions;
        
        if (expr.current !== expr.target) {
            expr.intensity -= expr.transitionSpeed;
            
            if (expr.intensity <= 0) {
                expr.current = expr.target;
                expr.intensity = 0;
            }
        } else if (expr.intensity < expr.targetIntensity) {
            expr.intensity = Math.min(
                expr.intensity + expr.transitionSpeed,
                expr.targetIntensity
            );
        }
        
        // Apply expression
        try {
            if (expr.current !== 'neutral') {
                this.vrm.current.expressionManager.setValue(expr.current, expr.intensity);
            }
            
            // Add talking mouth movement
            if (this.animation.isTalking) {
                const mouthValue = Math.abs(Math.sin(Date.now() * 0.01)) * 0.4;
                this.vrm.current.expressionManager.setValue('aa', mouthValue);
            } else {
                this.vrm.current.expressionManager.setValue('aa', 0);
            }
        } catch (e) {
            // Expression not available
        }
    }
    
    // ENHANCED: Smooth interpolation system
    applyAnimationInterpolation(deltaTime) {
        const lerpSpeed = deltaTime * 8; // Adjust for smoothness
        
        Object.keys(this.animation.targets).forEach(boneName => {
            const bone = this.animation.bones[boneName];
            if (!bone) return;
            
            const target = this.animation.targets[boneName];
            
            // Smooth interpolation to target rotations
            bone.rotation.x = this.lerp(bone.rotation.x, target.rotation.x, lerpSpeed);
            bone.rotation.y = this.lerp(bone.rotation.y, target.rotation.y, lerpSpeed);
            bone.rotation.z = this.lerp(bone.rotation.z, target.rotation.z, lerpSpeed);
        });
    }
    
    // ENHANCED: Natural animation control methods
    playAnimation(animationName) {
        if (!this.animation.sequences.has(animationName)) {
            console.warn(`Animation '${animationName}' not found`);
            return;
        }
        
        console.log(`🎬 Playing natural animation: ${animationName}`);
        
        this.animation.currentSequence = animationName;
        this.animation.sequenceTime = 0;
        
        const sequence = this.animation.sequences.get(animationName);
        
        // Set expression if specified
        if (sequence.expression) {
            this.setExpression(sequence.expression.type, sequence.expression.intensity);
        }
        
        this.emit('animation:start', animationName);
    }
    
    stopAnimation() {
        if (this.animation.currentSequence) {
            console.log(`🛑 Stopping animation: ${this.animation.currentSequence}`);
            this.emit('animation:end', this.animation.currentSequence);
            this.animation.currentSequence = null;
            this.animation.sequenceTime = 0;
        }
        
        // Return arms to rest position
        this.returnToRestPose();
    }
    
    returnToRestPose() {
        // Smoothly return all bones to natural rest position
        Object.keys(this.restPoses).forEach(boneName => {
            const bone = this.animation.bones[boneName];
            if (bone) {
                const restPose = this.restPoses[boneName];
                this.animation.targets[boneName].rotation.set(restPose.x, restPose.y, restPose.z);
            }
        });
    }
    
    setExpression(expression, intensity = 0.5, duration = null) {
        this.animation.expressions.target = expression;
        this.animation.expressions.targetIntensity = intensity;
        
        if (duration) {
            setTimeout(() => {
                this.animation.expressions.target = 'neutral';
                this.animation.expressions.targetIntensity = 0;
            }, duration);
        }
        
        this.emit('expression:changed', expression, intensity);
    }
    
    // ENHANCED: Natural gesture methods
    playWave() {
        if (this.animation.isWaving) return;
        
        this.animation.isWaving = true;
        this.playAnimation('wave');
        
        // End wave state when animation completes
        setTimeout(() => {
            this.animation.isWaving = false;
            // Add a cute wink after waving
            setTimeout(() => this.performWink(), 500);
        }, 4500);
    }
    
    startSpeechAnimation(text = '') {
        this.animation.isTalking = true;
        
        // Analyze text for appropriate expression and gestures
        const sentiment = this.analyzeSentiment(text);
        this.animation.conversation.sentiment = sentiment;
        
        // Set expression based on sentiment
        switch (sentiment) {
            case 'happy':
                this.setExpression('happy', 0.4);
                break;
            case 'sad':
                this.setExpression('sad', 0.3);
                break;
            case 'excited':
                this.setExpression('surprised', 0.4);
                setTimeout(() => this.setExpression('happy', 0.5), 1000);
                break;
            default:
                this.setExpression('happy', 0.2);
        }
        
        this.playAnimation('talking');
        this.emit('animation:speech:start');
    }
    
    stopSpeechAnimation() {
        this.animation.isTalking = false;
        this.stopAnimation();
        this.setExpression('neutral', 0);
        this.emit('animation:speech:end');
    }
    
    // ENHANCED: Opening sequence with multiple phases
    playOpeningSequence() {
        console.log('🎭 Playing enhanced opening sequence...');
        
        // Phase 1: Awakening (0-2s) - Subtle blink and smile
        this.setExpression('neutral', 0.1);
        setTimeout(() => this.performBlink(), 500);
        
        // Phase 2: Recognition (2-3s) - Brief surprise then warm smile
        setTimeout(() => {
            this.setExpression('surprised', 0.3);
            setTimeout(() => this.setExpression('happy', 0.4), 500);
        }, 2000);
        
        // Phase 3: Friendly gesture (3-4s) - Head tilt
        setTimeout(() => {
            this.performHeadTilt();
        }, 3000);
        
        // Phase 4: Wave (4-8s) - Natural wave animation
        setTimeout(() => {
            this.playWave();
        }, 4000);
        
        // Phase 5: Settle (8-10s) - Happy idle expression
        setTimeout(() => {
            this.setExpression('happy', 0.3, 3000);
        }, 8000);
        
        this.emit('animation:welcome');
    }
    
    // Enhanced micro-gestures
    performMicroGesture() {
        const gestures = [
            () => this.performHeadTilt(),
            () => this.performShoulderShrug(),
            () => this.performSubtleSmile(),
            () => this.performCuriousLook()
        ];
        
        const gesture = gestures[Math.floor(Math.random() * gestures.length)];
        gesture();
    }
    
    performHeadTilt() {
        const head = this.animation.bones.head;
        if (!head) return;
        
        const currentZ = this.animation.targets.head.rotation.z;
        const tiltAmount = (Math.random() - 0.5) * 0.12;
        
        this.animation.targets.head.rotation.z = currentZ + tiltAmount;
        
        setTimeout(() => {
            this.animation.targets.head.rotation.z = currentZ;
        }, 2000);
    }
    
    performShoulderShrug() {
        const leftShoulder = this.animation.bones.leftShoulder;
        const rightShoulder = this.animation.bones.rightShoulder;
        
        if (leftShoulder) {
            const originalZ = this.animation.targets.leftShoulder.rotation.z;
            this.animation.targets.leftShoulder.rotation.z = originalZ + 0.08;
            setTimeout(() => {
                this.animation.targets.leftShoulder.rotation.z = originalZ;
            }, 1500);
        }
        
        if (rightShoulder) {
            const originalZ = this.animation.targets.rightShoulder.rotation.z;
            this.animation.targets.rightShoulder.rotation.z = originalZ - 0.08;
            setTimeout(() => {
                this.animation.targets.rightShoulder.rotation.z = originalZ;
            }, 1500);
        }
    }
    
    performSubtleSmile() {
        this.setExpression('happy', 0.2, 3000);
    }
    
    performCuriousLook() {
        const head = this.animation.bones.head;
        if (!head) return;
        
        const currentY = this.animation.targets.head.rotation.y;
        const lookDirection = (Math.random() - 0.5) * 0.1;
        
        this.animation.targets.head.rotation.y = currentY + lookDirection;
        
        setTimeout(() => {
            this.animation.targets.head.rotation.y = currentY;
        }, 1500);
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
                // Wink not available, try blink
                this.performBlink();
            }
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
    
    // Sentiment analysis for natural reactions
    analyzeSentiment(text) {
        const lowerText = text.toLowerCase();
        
        if (lowerText.includes('happy') || lowerText.includes('great') || 
            lowerText.includes('awesome') || lowerText.includes('wonderful') ||
            lowerText.includes('love') || lowerText.includes('amazing')) {
            return 'happy';
        } else if (lowerText.includes('sad') || lowerText.includes('sorry') || 
                   lowerText.includes('bad') || lowerText.includes('terrible')) {
            return 'sad';
        } else if (lowerText.includes('wow') || lowerText.includes('really?') || 
                   lowerText.includes('!') || lowerText.includes('incredible')) {
            return 'excited';
        } else {
            return 'neutral';
        }
    }
    
    updateHeadTarget(x, y) {
        this.animation.headTarget.x = x * 0.08;
        this.animation.headTarget.y = y * 0.08;
    }
    
    handleResize() {
        if (!this.three.camera || !this.three.renderer) return;
        
        this.three.camera.aspect = window.innerWidth / window.innerHeight;
        this.three.camera.updateProjectionMatrix();
        this.three.renderer.setSize(window.innerWidth, window.innerHeight);
        
        // Adjust camera for mobile
        if (window.innerWidth < 768) {
            this.three.camera.position.z = this.config.cameraPosition.z - 1;
        } else {
            this.three.camera.position.z = this.config.cameraPosition.z;
        }
        
        this.emit('resize');
    }
    
    // Utility methods
    lerp(a, b, t) {
        return a + (b - a) * Math.min(Math.max(t, 0), 1);
    }
    
    // Debug methods
    getAnimationState() {
        return {
            currentState: this.animation.currentState,
            currentSequence: this.animation.currentSequence,
            sequenceTime: this.animation.sequenceTime,
            isWaving: this.animation.isWaving,
            isTalking: this.animation.isTalking,
            expression: this.animation.expressions.current,
            expressionIntensity: this.animation.expressions.intensity
        };
    }
    
    destroy() {
        // Stop animations
        this.stopAnimation();
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
