// web/js/VRMLoader.js
// Fixed VRM loading module with proper rest pose and natural animations

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
            shoulderRelaxTimer: 0,
            // Smooth transition states
            currentArmPositions: {
                leftUpper: { x: 0, y: 0, z: 0 },
                rightUpper: { x: 0, y: 0, z: 0 },
                leftLower: { x: 0, y: 0, z: 0 },
                rightLower: { x: 0, y: 0, z: 0 }
            },
            targetArmPositions: {
                leftUpper: { x: 0, y: 0, z: 0 },
                rightUpper: { x: 0, y: 0, z: 0 },
                leftLower: { x: 0, y: 0, z: 0 },
                rightLower: { x: 0, y: 0, z: 0 }
            }
        };
        
        this.config = {
            paths: [
                '/assets/avatar/solmate.vrm',
                'https://raw.githubusercontent.com/DirkDigglerTown/solmate/main/web/assets/avatar/solmate.vrm'
            ],
            fallbackEnabled: true,
            // Updated camera positions as requested
            cameraPosition: { x: 0, y: 0.5, z: 9.0 },  // Using y: 0.5 as requested
            lookAtPosition: { x: 0, y: 0.5, z: 0 },    // Looking at chest level
            modelPosition: { x: 0, y: 0, z: 0 }        // Model at ground level
        };
        
        // Natural rest pose angles (in radians)
        this.restPose = {
            upperArmAngle: 1.22,  // 70 degrees - standard VRM rest pose
            lowerArmAngle: 0.17,  // 10 degrees - natural elbow bend
            shoulderDrop: 0.08,   // Slight shoulder drop
            handRotation: 0.1     // Natural hand rotation
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
        
        // Create camera with requested positioning
        this.three.camera = new THREE.PerspectiveCamera(
            35,  // Adjusted FOV for better framing
            window.innerWidth / window.innerHeight,
            0.1,
            20
        );
        // Set camera to proper position
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
        
        // Position the model
        vrm.scene.position.set(
            this.config.modelPosition.x,
            this.config.modelPosition.y,
            this.config.modelPosition.z
        );
        
        // Add to scene
        this.three.scene.add(vrm.scene);
        
        // Setup humanoid with FIXED NATURAL POSE
        if (vrm.humanoid) {
            // Apply rest pose immediately
            this.applyRestPose(vrm.humanoid);
            
            // Store initial positions for smooth animations
            this.storeInitialPose(vrm.humanoid);
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
    
    applyRestPose(humanoid) {
        const THREE = window.THREE;
        
        // Get all bones
        const bones = {
            hips: humanoid.getNormalizedBoneNode('hips'),
            spine: humanoid.getNormalizedBoneNode('spine'),
            chest: humanoid.getNormalizedBoneNode('chest'),
            upperChest: humanoid.getNormalizedBoneNode('upperChest'),
            neck: humanoid.getNormalizedBoneNode('neck'),
            head: humanoid.getNormalizedBoneNode('head'),
            leftShoulder: humanoid.getNormalizedBoneNode('leftShoulder'),
            rightShoulder: humanoid.getNormalizedBoneNode('rightShoulder'),
            leftUpperArm: humanoid.getNormalizedBoneNode('leftUpperArm'),
            rightUpperArm: humanoid.getNormalizedBoneNode('rightUpperArm'),
            leftLowerArm: humanoid.getNormalizedBoneNode('leftLowerArm'),
            rightLowerArm: humanoid.getNormalizedBoneNode('rightLowerArm'),
            leftHand: humanoid.getNormalizedBoneNode('leftHand'),
            rightHand: humanoid.getNormalizedBoneNode('rightHand')
        };
        
        // Reset all rotations first
        Object.values(bones).forEach(bone => {
            if (bone) {
                bone.rotation.set(0, 0, 0);
            }
        });
        
        // Apply natural rest pose for arms (70 degrees down from T-pose)
        if (bones.leftUpperArm) {
            bones.leftUpperArm.rotation.z = this.restPose.upperArmAngle;
            bones.leftUpperArm.rotation.x = 0.05;  // Slight forward angle
        }
        if (bones.rightUpperArm) {
            bones.rightUpperArm.rotation.z = -this.restPose.upperArmAngle;
            bones.rightUpperArm.rotation.x = 0.05;  // Slight forward angle
        }
        
        // Natural elbow bend (10 degrees additional)
        if (bones.leftLowerArm) {
            bones.leftLowerArm.rotation.z = this.restPose.lowerArmAngle;
        }
        if (bones.rightLowerArm) {
            bones.rightLowerArm.rotation.z = -this.restPose.lowerArmAngle;
        }
        
        // Relax shoulders
        if (bones.leftShoulder) {
            bones.leftShoulder.rotation.z = this.restPose.shoulderDrop;
            bones.leftShoulder.rotation.y = 0.02;
        }
        if (bones.rightShoulder) {
            bones.rightShoulder.rotation.z = -this.restPose.shoulderDrop;
            bones.rightShoulder.rotation.y = -0.02;
        }
        
        // Natural hand position
        if (bones.leftHand) {
            bones.leftHand.rotation.z = this.restPose.handRotation;
            bones.leftHand.rotation.x = 0.05;
        }
        if (bones.rightHand) {
            bones.rightHand.rotation.z = -this.restPose.handRotation;
            bones.rightHand.rotation.x = 0.05;
        }
        
        // Natural spine curve
        if (bones.spine) {
            bones.spine.rotation.x = 0.03;
        }
        if (bones.chest) {
            bones.chest.rotation.x = 0.02;
        }
        if (bones.upperChest) {
            bones.upperChest.rotation.x = 0.01;
        }
        
        // Natural neck angle
        if (bones.neck) {
            bones.neck.rotation.x = 0.05;
        }
        
        // Update the VRM if needed
        if (humanoid.update) {
            humanoid.update(0);
        }
        
        console.log('Rest pose applied - arms should be down at sides');
    }
    
    storeInitialPose(humanoid) {
        const leftUpperArm = humanoid.getNormalizedBoneNode('leftUpperArm');
        const rightUpperArm = humanoid.getNormalizedBoneNode('rightUpperArm');
        const leftLowerArm = humanoid.getNormalizedBoneNode('leftLowerArm');
        const rightLowerArm = humanoid.getNormalizedBoneNode('rightLowerArm');
        
        if (leftUpperArm) {
            this.animation.currentArmPositions.leftUpper = {
                x: leftUpperArm.rotation.x,
                y: leftUpperArm.rotation.y,
                z: leftUpperArm.rotation.z
            };
            this.animation.targetArmPositions.leftUpper = { ...this.animation.currentArmPositions.leftUpper };
        }
        
        if (rightUpperArm) {
            this.animation.currentArmPositions.rightUpper = {
                x: rightUpperArm.rotation.x,
                y: rightUpperArm.rotation.y,
                z: rightUpperArm.rotation.z
            };
            this.animation.targetArmPositions.rightUpper = { ...this.animation.currentArmPositions.rightUpper };
        }
        
        if (leftLowerArm) {
            this.animation.currentArmPositions.leftLower = {
                x: leftLowerArm.rotation.x,
                y: leftLowerArm.rotation.y,
                z: leftLowerArm.rotation.z
            };
            this.animation.targetArmPositions.leftLower = { ...this.animation.currentArmPositions.leftLower };
        }
        
        if (rightLowerArm) {
            this.animation.currentArmPositions.rightLower = {
                x: rightLowerArm.rotation.x,
                y: rightLowerArm.rotation.y,
                z: rightLowerArm.rotation.z
            };
            this.animation.targetArmPositions.rightLower = { ...this.animation.currentArmPositions.rightLower };
        }
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
        
        // Create simple character
        const geometry = new THREE.CapsuleGeometry(0.3, 1, 4, 8);
        const material = new THREE.MeshLambertMaterial({ color: 0xff6b6b });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = 0.5; 
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        group.add(mesh);
        group.position.set(
            this.config.modelPosition.x,
            this.config.modelPosition.y,
            this.config.modelPosition.z
        );
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
        
        // Smooth arm position transitions
        this.updateArmTransitions(deltaTime);
        
        // Breathing animation
        this.updateBreathing(deltaTime);
        
        // Idle animations
        if (!this.animation.isTalking && !this.animation.isWaving) {
            this.updateIdleAnimations(deltaTime, time);
        }
        
        // Talking animations
        if (this.animation.isTalking) {
            this.updateTalkingAnimations(deltaTime, time);
        }
        
        // Expression animations
        this.updateExpressions(deltaTime);
        
        // Blinking
        this.updateBlinking(deltaTime);
    }
    
    updateArmTransitions(deltaTime) {
        if (!this.vrm.current.humanoid || this.vrm.current.isFallback) return;
        
        const smoothingFactor = 5.0; // Speed of transition
        const t = 1 - Math.exp(-smoothingFactor * deltaTime);
        
        // Smoothly transition arm positions
        const leftUpperArm = this.vrm.current.humanoid.getNormalizedBoneNode('leftUpperArm');
        const rightUpperArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightUpperArm');
        const leftLowerArm = this.vrm.current.humanoid.getNormalizedBoneNode('leftLowerArm');
        const rightLowerArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightLowerArm');
        
        // Lerp function
        const lerp = (a, b, t) => a + (b - a) * t;
        
        if (leftUpperArm) {
            this.animation.currentArmPositions.leftUpper.x = lerp(
                this.animation.currentArmPositions.leftUpper.x,
                this.animation.targetArmPositions.leftUpper.x,
                t
            );
            this.animation.currentArmPositions.leftUpper.y = lerp(
                this.animation.currentArmPositions.leftUpper.y,
                this.animation.targetArmPositions.leftUpper.y,
                t
            );
            this.animation.currentArmPositions.leftUpper.z = lerp(
                this.animation.currentArmPositions.leftUpper.z,
                this.animation.targetArmPositions.leftUpper.z,
                t
            );
            
            leftUpperArm.rotation.x = this.animation.currentArmPositions.leftUpper.x;
            leftUpperArm.rotation.y = this.animation.currentArmPositions.leftUpper.y;
            leftUpperArm.rotation.z = this.animation.currentArmPositions.leftUpper.z;
        }
        
        if (rightUpperArm) {
            this.animation.currentArmPositions.rightUpper.x = lerp(
                this.animation.currentArmPositions.rightUpper.x,
                this.animation.targetArmPositions.rightUpper.x,
                t
            );
            this.animation.currentArmPositions.rightUpper.y = lerp(
                this.animation.currentArmPositions.rightUpper.y,
                this.animation.targetArmPositions.rightUpper.y,
                t
            );
            this.animation.currentArmPositions.rightUpper.z = lerp(
                this.animation.currentArmPositions.rightUpper.z,
                this.animation.targetArmPositions.rightUpper.z,
                t
            );
            
            rightUpperArm.rotation.x = this.animation.currentArmPositions.rightUpper.x;
            rightUpperArm.rotation.y = this.animation.currentArmPositions.rightUpper.y;
            rightUpperArm.rotation.z = this.animation.currentArmPositions.rightUpper.z;
        }
        
        if (leftLowerArm) {
            this.animation.currentArmPositions.leftLower.x = lerp(
                this.animation.currentArmPositions.leftLower.x,
                this.animation.targetArmPositions.leftLower.x,
                t
            );
            this.animation.currentArmPositions.leftLower.y = lerp(
                this.animation.currentArmPositions.leftLower.y,
                this.animation.targetArmPositions.leftLower.y,
                t
            );
            this.animation.currentArmPositions.leftLower.z = lerp(
                this.animation.currentArmPositions.leftLower.z,
                this.animation.targetArmPositions.leftLower.z,
                t
            );
            
            leftLowerArm.rotation.x = this.animation.currentArmPositions.leftLower.x;
            leftLowerArm.rotation.y = this.animation.currentArmPositions.leftLower.y;
            leftLowerArm.rotation.z = this.animation.currentArmPositions.leftLower.z;
        }
        
        if (rightLowerArm) {
            this.animation.currentArmPositions.rightLower.x = lerp(
                this.animation.currentArmPositions.rightLower.x,
                this.animation.targetArmPositions.rightLower.x,
                t
            );
            this.animation.currentArmPositions.rightLower.y = lerp(
                this.animation.currentArmPositions.rightLower.y,
                this.animation.targetArmPositions.rightLower.y,
                t
            );
            this.animation.currentArmPositions.rightLower.z = lerp(
                this.animation.currentArmPositions.rightLower.z,
                this.animation.targetArmPositions.rightLower.z,
                t
            );
            
            rightLowerArm.rotation.x = this.animation.currentArmPositions.rightLower.x;
            rightLowerArm.rotation.y = this.animation.currentArmPositions.rightLower.y;
            rightLowerArm.rotation.z = this.animation.currentArmPositions.rightLower.z;
        }
    }
    
    updateBreathing(deltaTime) {
        this.animation.breathingPhase += deltaTime * 2.5;
        const breathIntensity = 1 + Math.sin(this.animation.breathingPhase) * 0.025;
        
        if (this.vrm.current.humanoid && !this.vrm.current.isFallback) {
            const chest = this.vrm.current.humanoid.getNormalizedBoneNode('chest');
            const upperChest = this.vrm.current.humanoid.getNormalizedBoneNode('upperChest');
            
            if (chest) {
                chest.scale.set(breathIntensity, breathIntensity, breathIntensity);
            }
            if (upperChest) {
                upperChest.scale.set(breathIntensity, breathIntensity, breathIntensity);
            }
        }
    }
    
    updateIdleAnimations(deltaTime, time) {
        // Subtle body sway
        this.animation.swayPhase += deltaTime * 0.3;
        if (this.vrm.current.scene) {
            this.vrm.current.scene.rotation.y = Math.PI + Math.sin(this.animation.swayPhase) * 0.01;
            this.vrm.current.scene.position.x = Math.sin(this.animation.swayPhase * 0.7) * 0.01;
        }
        
        if (this.vrm.current.humanoid && !this.vrm.current.isFallback) {
            const head = this.vrm.current.humanoid.getNormalizedBoneNode('head');
            const neck = this.vrm.current.humanoid.getNormalizedBoneNode('neck');
            const spine = this.vrm.current.humanoid.getNormalizedBoneNode('spine');
            
            // Natural idle head movement
            if (head) {
                const idleX = Math.sin(time * 0.6) * 0.015;
                const idleY = Math.sin(time * 0.8) * 0.02;
                const idleZ = Math.sin(time * 0.5) * 0.005;
                
                head.rotation.x = idleX + this.animation.headTarget.x * 0.3;
                head.rotation.y = idleY + this.animation.headTarget.y * 0.3;
                head.rotation.z = idleZ;
            }
            
            if (neck) {
                neck.rotation.x = 0.05 + Math.sin(time * 0.7 + 0.5) * 0.008;
                neck.rotation.y = Math.sin(time * 0.5 + 0.5) * 0.01;
            }
            
            if (spine) {
                spine.rotation.x = 0.03 + Math.sin(time * 0.4) * 0.005;
                spine.rotation.y = Math.sin(time * 0.3) * 0.003;
            }
            
            // Subtle arm sway in idle (maintaining rest position)
            const armSwayAmount = 0.02;
            this.animation.targetArmPositions.leftUpper.z = this.restPose.upperArmAngle + Math.sin(time * 0.4) * armSwayAmount;
            this.animation.targetArmPositions.rightUpper.z = -this.restPose.upperArmAngle - Math.sin(time * 0.4 + Math.PI) * armSwayAmount;
            
            // Occasional idle gestures
            this.animation.idleTimer += deltaTime;
            if (this.animation.idleTimer > 5 + Math.random() * 5) {
                this.performIdleGesture();
                this.animation.idleTimer = 0;
            }
        }
    }
    
    updateTalkingAnimations(deltaTime, time) {
        const talkTime = time * 2.5;
        
        if (this.vrm.current.humanoid && !this.vrm.current.isFallback) {
            // Animated head movement during speech
            const head = this.vrm.current.humanoid.getNormalizedBoneNode('head');
            if (head) {
                head.rotation.x = Math.sin(talkTime * 1.2) * 0.025;
                head.rotation.y = Math.sin(talkTime) * 0.035;
                head.rotation.z = Math.sin(talkTime * 0.8) * 0.015;
            }
            
            // Natural conversational gestures
            const gestureIntensity = 0.15 + Math.sin(talkTime * 0.3) * 0.1;
            
            // Raise arms slightly for gestures
            this.animation.targetArmPositions.leftUpper.z = this.restPose.upperArmAngle - gestureIntensity * 0.5;
            this.animation.targetArmPositions.leftUpper.x = Math.sin(talkTime * 0.8) * 0.15;
            this.animation.targetArmPositions.leftUpper.y = Math.sin(talkTime * 0.6) * 0.1;
            
            this.animation.targetArmPositions.rightUpper.z = -this.restPose.upperArmAngle + gestureIntensity * 0.5;
            this.animation.targetArmPositions.rightUpper.x = Math.sin(talkTime * 0.8 + Math.PI * 0.5) * 0.15;
            this.animation.targetArmPositions.rightUpper.y = -Math.sin(talkTime * 0.6 + Math.PI * 0.5) * 0.1;
            
            // Natural elbow movement
            this.animation.targetArmPositions.leftLower.z = this.restPose.lowerArmAngle + Math.sin(talkTime * 1.2) * 0.2;
            this.animation.targetArmPositions.leftLower.y = -Math.sin(talkTime * 1.5) * 0.2;
            
            this.animation.targetArmPositions.rightLower.z = -this.restPose.lowerArmAngle - Math.sin(talkTime * 1.2 + Math.PI) * 0.2;
            this.animation.targetArmPositions.rightLower.y = Math.sin(talkTime * 1.5 + Math.PI) * 0.2;
            
            // Hand movements
            const leftHand = this.vrm.current.humanoid.getNormalizedBoneNode('leftHand');
            const rightHand = this.vrm.current.humanoid.getNormalizedBoneNode('rightHand');
            
            if (leftHand) {
                leftHand.rotation.z = Math.sin(talkTime * 2) * 0.1;
                leftHand.rotation.x = Math.sin(talkTime * 2.5) * 0.05;
            }
            
            if (rightHand) {
                rightHand.rotation.z = Math.sin(talkTime * 2 + Math.PI) * 0.1;
                rightHand.rotation.x = Math.sin(talkTime * 2.5 + Math.PI) * 0.05;
            }
            
            // Body movement while talking
            const spine = this.vrm.current.humanoid.getNormalizedBoneNode('spine');
            const chest = this.vrm.current.humanoid.getNormalizedBoneNode('chest');
            
            if (spine) {
                spine.rotation.y = Math.sin(talkTime * 0.6) * 0.015;
                spine.rotation.x = 0.03 + Math.sin(talkTime * 0.5) * 0.01;
            }
            
            if (chest) {
                chest.rotation.y = Math.sin(talkTime * 0.7 + 0.5) * 0.01;
            }
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
    
    updateBlinking(deltaTime) {
        this.animation.blinkTimer += deltaTime;
        const blinkInterval = this.animation.isTalking ? 2 : 3 + Math.random();
        if (this.animation.blinkTimer > blinkInterval) {
            this.performBlink();
            this.animation.blinkTimer = 0;
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
            const originalLeft = leftShoulder.rotation.z;
            const originalRight = rightShoulder.rotation.z;
            
            const shrugInterval = setInterval(() => {
                shrugTime += 0.016;
                
                if (shrugTime >= 1.5) {
                    leftShoulder.rotation.z = originalLeft;
                    rightShoulder.rotation.z = originalRight;
                    clearInterval(shrugInterval);
                    return;
                }
                
                const shrugProgress = Math.sin(shrugTime * Math.PI / 1.5);
                leftShoulder.rotation.z = originalLeft + shrugProgress * 0.15;
                rightShoulder.rotation.z = originalRight - shrugProgress * 0.15;
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
        // Store current arm positions
        const currentLeftUpper = { ...this.animation.targetArmPositions.leftUpper };
        const currentRightUpper = { ...this.animation.targetArmPositions.rightUpper };
        const currentRightLower = { ...this.animation.targetArmPositions.rightLower };
        
        let waveTime = 0;
        
        const waveInterval = setInterval(() => {
            waveTime += 0.016;
            
            if (waveTime >= 3) {
                // Return to rest position smoothly
                this.animation.targetArmPositions.rightUpper.z = -this.restPose.upperArmAngle;
                this.animation.targetArmPositions.rightUpper.x = 0.05;
                this.animation.targetArmPositions.rightUpper.y = 0;
                this.animation.targetArmPositions.rightLower.z = -this.restPose.lowerArmAngle;
                this.animation.targetArmPositions.rightLower.y = 0;
                
                this.animation.isWaving = false;
                this.setExpression('neutral', 0);
                
                // Perform a wink after waving
                setTimeout(() => this.performWink(), 500);
                
                clearInterval(waveInterval);
                this.emit('animation:wave:end');
                return;
            }
            
            // Wave animation
            const waveIntensity = Math.sin(waveTime * Math.PI * 4);
            
            // Raise right arm for wave
            this.animation.targetArmPositions.rightUpper.z = -0.3;  // Arm raised up
            this.animation.targetArmPositions.rightUpper.x = -0.4;  // Arm forward
            this.animation.targetArmPositions.rightUpper.y = 0.2;   // Slight outward
            
            // Wave motion in forearm
            this.animation.targetArmPositions.rightLower.y = 0.6;
            this.animation.targetArmPositions.rightLower.z = waveIntensity * 0.25;
            
            // Add hand wave if available
            const rightHand = this.vrm.current.humanoid.getNormalizedBoneNode('rightHand');
            if (rightHand) {
                rightHand.rotation.z = waveIntensity * 0.4;
                rightHand.rotation.y = waveIntensity * 0.2;
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
                if (lowerText.includes('happy') || lowerText.includes('great') || lowerText.includes('awesome')) {
                    this.setExpression('happy', 0.4);
                } else if (lowerText.includes('sorry') || lowerText.includes('unfortunately')) {
                    this.setExpression('sad', 0.3);
                } else if (lowerText.includes('wow') || lowerText.includes('amazing') || lowerText.includes('!')) {
                    this.setExpression('surprised', 0.3);
                    setTimeout(() => this.setExpression('happy', 0.2), 1000);
                } else {
                    this.setExpression('happy', 0.2);
                }
            } catch (e) {}
        }
        
        this.emit('animation:speech:start');
    }
    
    stopSpeechAnimation() {
        this.animation.isTalking = false;
        
        // Return to neutral expression
        this.setExpression('neutral', 0);
        
        // Smoothly return arms to rest position
        this.animation.targetArmPositions.leftUpper.z = this.restPose.upperArmAngle;
        this.animation.targetArmPositions.leftUpper.x = 0.05;
        this.animation.targetArmPositions.leftUpper.y = 0;
        
        this.animation.targetArmPositions.rightUpper.z = -this.restPose.upperArmAngle;
        this.animation.targetArmPositions.rightUpper.x = 0.05;
        this.animation.targetArmPositions.rightUpper.y = 0;
        
        this.animation.targetArmPositions.leftLower.z = this.restPose.lowerArmAngle;
        this.animation.targetArmPositions.leftLower.y = 0;
        
        this.animation.targetArmPositions.rightLower.z = -this.restPose.lowerArmAngle;
        this.animation.targetArmPositions.rightLower.y = 0;
        
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
        
        // Adjust camera position on mobile/tablet
        if (window.innerWidth < 768) {
            this.three.camera.position.z = 10;  // Move camera back more on mobile
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
