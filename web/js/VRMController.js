// web/js/VRMController.js
// VRM avatar controller with AIRI-inspired natural animations
// FIXED: Proper 70-degree arm rest position and natural movements

import { EventEmitter } from './EventEmitter.js';

export class VRMController extends EventEmitter {
    constructor() {
        super();
        
        this.config = {
            vrmPaths: [
                '/assets/avatar/solmate.vrm',
                'https://raw.githubusercontent.com/DirkDigglerTown/solmate/main/web/assets/avatar/solmate.vrm'
            ],
            loadTimeout: 30000,
            animationSpeed: 1.0,
            breathingSpeed: 2.0,
            blinkInterval: 4000
        };
        
        this.state = {
            initialized: false,
            loaded: false,
            isAnimating: false,
            isTalking: false,
            currentExpression: 'neutral',
            currentMood: 'neutral'
        };
        
        this.three = {
            scene: null,
            camera: null,
            renderer: null,
            clock: null,
            vrm: null,
            mixer: null
        };
        
        this.animation = {
            breathingPhase: 0,
            blinkTimer: 0,
            headTarget: { x: 0, y: 0 },
            armRestPosition: {
                leftUpper: { x: 0, y: 0, z: 1.22 },  // 70 degrees - AIRI standard
                leftLower: { x: 0, y: 0, z: 0.17 },  // Slight elbow bend
                rightUpper: { x: 0, y: 0, z: -1.22 }, // -70 degrees - AIRI standard
                rightLower: { x: 0, y: 0, z: -0.17 }  // Slight elbow bend
            },
            currentGesture: null,
            gestureQueue: []
        };
        
        // Track resources for cleanup
        this.resources = {
            textures: new Set(),
            geometries: new Set(),
            materials: new Set()
        };
    }
    
    async init() {
        try {
            this.emit('init:start');
            
            // Check WebGL support
            if (!this.checkWebGLSupport()) {
                throw new Error('WebGL not supported');
            }
            
            // Initialize Three.js scene
            await this.initializeScene();
            
            // Load VRM model
            await this.loadVRM();
            
            // START THE ANIMATION LOOP
            this.animate();
            console.log('🎮 Animation loop started');
            
            this.state.initialized = true;
            this.emit('init:complete');
            
        } catch (error) {
            this.emit('error', error);
            this.createFallbackAvatar();
        }
    }
    
    checkWebGLSupport() {
        try {
            const canvas = document.createElement('canvas');
            return !!(window.WebGLRenderingContext && 
                (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
        } catch(e) {
            return false;
        }
    }
    
    async initializeScene() {
        // Import Three.js using the import map
        const THREE = await import('three');
        
        // Create scene
        this.three.scene = new THREE.Scene();
        this.three.scene.background = new THREE.Color(0x1a2332);
        this.three.scene.fog = new THREE.Fog(0x1a2332, 5, 15);
        
        // Create camera
        this.three.camera = new THREE.PerspectiveCamera(
            30,
            window.innerWidth / window.innerHeight,
            0.1,
            20
        );
        this.three.camera.position.set(0, 1.6, 5.0);
        this.three.camera.lookAt(0, 1.4, 0);
        
        // Create renderer
        const canvas = document.getElementById('vrmCanvas');
        if (!canvas) {
            throw new Error('Canvas element not found');
        }
        
        this.three.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: false
        });
        this.three.renderer.setSize(window.innerWidth, window.innerHeight);
        this.three.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.three.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.three.renderer.toneMappingExposure = 1.2;
        
        // Ensure canvas is visible
        canvas.style.display = 'block';
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        
        // Add lights
        const directionalLight = new THREE.DirectionalLight(0xffffff, 2.0);
        directionalLight.position.set(1, 2, 2);
        this.three.scene.add(directionalLight);
        
        const fillLight = new THREE.DirectionalLight(0x88aaff, 0.8);
        fillLight.position.set(-1, 1, -1);
        this.three.scene.add(fillLight);
        
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        this.three.scene.add(ambientLight);
        
        const pointLight = new THREE.PointLight(0xffffff, 1, 5);
        pointLight.position.set(0, 1.5, 2);
        this.three.scene.add(pointLight);
        
        // Initialize clock
        this.three.clock = new THREE.Clock();
        
        // Handle window resize
        window.addEventListener('resize', this.handleResize.bind(this));
        
        this.emit('scene:ready');
    }
    
    async loadVRM() {
        this.emit('load:start');
        
        const loadingEl = document.getElementById('loadingStatus');
        if (loadingEl) loadingEl.style.display = 'block';
        
        try {
            // Import loaders using the import map
            const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
            const { VRMLoaderPlugin, VRMUtils } = await import('@pixiv/three-vrm');
            
            // Store VRMUtils for cleanup
            this.VRMUtils = VRMUtils;
            
            const loader = new GLTFLoader();
            loader.register((parser) => new VRMLoaderPlugin(parser));
            
            let loaded = false;
            
            for (const url of this.config.vrmPaths) {
                if (loaded) break;
                
                console.log('Attempting to load VRM from:', url);
                
                try {
                    const gltf = await this.loadWithTimeout(loader, url);
                    const vrm = gltf.userData.vrm;
                    
                    if (vrm) {
                        await this.setupVRM(vrm);
                        loaded = true;
                        console.log('✅ VRM loaded successfully from:', url);
                    }
                } catch (error) {
                    console.warn('Failed to load from', url, error);
                }
            }
            
            if (!loaded) {
                throw new Error('Failed to load VRM from all sources');
            }
            
            if (loadingEl) loadingEl.style.display = 'none';
            
        } catch (error) {
            console.error('VRM loading error:', error);
            if (loadingEl) loadingEl.style.display = 'none';
            throw error;
        }
    }
    
    loadWithTimeout(loader, url) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Load timeout'));
            }, this.config.loadTimeout);
            
            loader.load(
                url,
                (gltf) => {
                    clearTimeout(timeout);
                    resolve(gltf);
                },
                (progress) => {
                    // Progress callback
                },
                (error) => {
                    clearTimeout(timeout);
                    reject(error);
                }
            );
        });
    }
    
    async setupVRM(vrm) {
        // Remove existing VRM if present
        if (this.three.vrm) {
            this.three.scene.remove(this.three.vrm.scene);
            if (this.VRMUtils) {
                this.VRMUtils.deepDispose(this.three.vrm.scene);
            }
        }
        
        this.three.vrm = vrm;
        
        // Store THREE reference globally for debugging
        if (!window.THREE) {
            import('three').then(module => {
                window.THREE = module;
            });
        }
        
        // Position model
        vrm.scene.position.set(0, 0, 0);
        vrm.scene.rotation.y = Math.PI; // Face camera
        
        // Get actual model bounds to verify positioning
        const THREE = window.THREE || await import('three');
        const box = new THREE.Box3().setFromObject(vrm.scene);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        
        console.log('📏 VRM Dimensions:', {
            height: size.y.toFixed(2),
            width: size.x.toFixed(2),
            depth: size.z.toFixed(2),
            center: { x: center.x.toFixed(2), y: center.y.toFixed(2), z: center.z.toFixed(2) }
        });
        
        // Properly center the avatar
        const avatarCenter = center.y;
        const cameraHeight = avatarCenter + 0.2;
        const lookAtHeight = avatarCenter;
        
        console.log(`📷 Camera auto-positioned for centering:
            Position: (0, ${cameraHeight.toFixed(2)}, 5.0)
            Looking at: (0, ${lookAtHeight.toFixed(2)}, 0)`);
        
        // Set camera to properly frame the avatar
        if (this.three.camera) {
            this.three.camera.position.set(0, cameraHeight, 5.0);
            this.three.camera.lookAt(0, lookAtHeight, 0);
        }
        
        // Add to scene
        this.three.scene.add(vrm.scene);
        
        // Setup natural rest pose (AIRI-style)
        this.setupNaturalPose(vrm);
        
        // Setup look-at if available
        if (vrm.lookAt) {
            vrm.lookAt.target = this.three.camera;
        }
        
        // Setup expressions if available
        if (vrm.expressionManager) {
            this.setupExpressions(vrm);
        }
        
        this.state.loaded = true;
        this.emit('load:complete', vrm);
        
        // Play opening sequence after short delay
        setTimeout(() => this.playOpeningSequence(), 1000);
    }
    
    setupNaturalPose(vrm) {
        if (!vrm.humanoid) return;
        
        // Get all bones we'll need
        const bones = {
            leftUpperArm: vrm.humanoid.getNormalizedBoneNode('leftUpperArm'),
            leftLowerArm: vrm.humanoid.getNormalizedBoneNode('leftLowerArm'),
            rightUpperArm: vrm.humanoid.getNormalizedBoneNode('rightUpperArm'),
            rightLowerArm: vrm.humanoid.getNormalizedBoneNode('rightLowerArm'),
            spine: vrm.humanoid.getNormalizedBoneNode('spine'),
            chest: vrm.humanoid.getNormalizedBoneNode('chest'),
            neck: vrm.humanoid.getNormalizedBoneNode('neck'),
            head: vrm.humanoid.getNormalizedBoneNode('head')
        };
        
        // AIRI-style: Arms down at 70-degree angle (1.22 radians)
        // This is the CORRECT natural rest position
        if (bones.leftUpperArm) {
            bones.leftUpperArm.rotation.z = 1.22;  // 70 degrees - AIRI standard
            bones.leftUpperArm.rotation.x = 0.05;  // Slight forward rotation
        }
        if (bones.rightUpperArm) {
            bones.rightUpperArm.rotation.z = -1.22; // -70 degrees - AIRI standard
            bones.rightUpperArm.rotation.x = 0.05;  // Slight forward rotation
        }
        
        // Natural elbow bend
        if (bones.leftLowerArm) {
            bones.leftLowerArm.rotation.z = 0.17;   // Slight bend
            bones.leftLowerArm.rotation.y = -0.1;   // Natural rotation
        }
        if (bones.rightLowerArm) {
            bones.rightLowerArm.rotation.z = -0.17; // Slight bend
            bones.rightLowerArm.rotation.y = 0.1;   // Natural rotation
        }
        
        // Slight spine curve for natural posture
        if (bones.spine) {
            bones.spine.rotation.x = 0.02;
        }
        
        // Save rest positions
        this.animation.armRestPosition = {
            leftUpper: bones.leftUpperArm ? {
                x: bones.leftUpperArm.rotation.x,
                y: bones.leftUpperArm.rotation.y,
                z: bones.leftUpperArm.rotation.z
            } : null,
            leftLower: bones.leftLowerArm ? {
                x: bones.leftLowerArm.rotation.x,
                y: bones.leftLowerArm.rotation.y,
                z: bones.leftLowerArm.rotation.z
            } : null,
            rightUpper: bones.rightUpperArm ? {
                x: bones.rightUpperArm.rotation.x,
                y: bones.rightUpperArm.rotation.y,
                z: bones.rightUpperArm.rotation.z
            } : null,
            rightLower: bones.rightLowerArm ? {
                x: bones.rightLowerArm.rotation.x,
                y: bones.rightLowerArm.rotation.y,
                z: bones.rightLowerArm.rotation.z
            } : null
        };
        
        console.log('✅ AIRI-style natural rest pose set (arms at 70 degrees)');
    }
    
    setupExpressions(vrm) {
        // Test available expressions
        const expressions = ['happy', 'angry', 'sad', 'surprised', 'relaxed', 'neutral'];
        const available = [];
        
        expressions.forEach(expr => {
            try {
                vrm.expressionManager.setValue(expr, 0);
                available.push(expr);
            } catch (e) {
                // Expression not available
            }
        });
        
        console.log('Available expressions:', available);
        this.availableExpressions = available;
    }
    
    animate() {
        // Make sure we're initialized before animating
        if (!this.state.initialized && this.three.renderer && this.three.scene && this.three.camera) {
            this.state.initialized = true;
        }
        
        if (!this.state.initialized) return;
        
        requestAnimationFrame(() => this.animate());
        
        const deltaTime = this.three.clock ? this.three.clock.getDelta() : 0;
        const elapsedTime = this.three.clock ? this.three.clock.getElapsedTime() : 0;
        
        // Update VRM
        if (this.three.vrm) {
            this.three.vrm.update(deltaTime);
            
            // Apply animations
            this.updateBreathing(elapsedTime);
            this.updateBlink(elapsedTime);
            this.updateHeadMovement(deltaTime);
            this.updateGestures(deltaTime);
            this.updateIdleAnimations(elapsedTime);
            
            // Update current animation if playing
            if (this.animation.currentGesture) {
                this.updateCurrentGesture(deltaTime);
            }
        }
        
        // Render scene
        if (this.three.renderer && this.three.scene && this.three.camera) {
            this.three.renderer.render(this.three.scene, this.three.camera);
        }
    }
    
    updateBreathing(time) {
        if (!this.three.vrm || !this.three.vrm.humanoid) return;
        
        // AIRI-style natural breathing with body sway
        const breathPhase = time * 2.4; // Natural breathing rate
        const breath = Math.sin(breathPhase);
        const breathDeep = Math.sin(breathPhase * 0.5); // Occasional deeper breaths
        
        // Get bones
        const chest = this.three.vrm.humanoid.getNormalizedBoneNode('chest');
        const spine = this.three.vrm.humanoid.getNormalizedBoneNode('spine');
        const upperChest = this.three.vrm.humanoid.getNormalizedBoneNode('upperChest');
        const hips = this.three.vrm.humanoid.getNormalizedBoneNode('hips');
        
        // Chest breathing - very subtle expansion
        if (chest) {
            chest.scale.y = 1 + breath * 0.006 + breathDeep * 0.003;
            chest.scale.x = 1 + breath * 0.004;
            chest.rotation.x = breath * 0.003;
        }
        
        // Upper chest follows with slight delay
        if (upperChest) {
            upperChest.rotation.x = Math.sin(breathPhase - 0.2) * 0.002;
        }
        
        // Spine movement for natural posture shifts
        if (spine) {
            spine.rotation.x = 0.02 + breathDeep * 0.002; // Keep base spine curve
            spine.rotation.z = Math.sin(time * 0.3) * 0.001;
        }
        
        // AIRI signature: Subtle weight shifting (body sway)
        if (hips) {
            hips.position.x = Math.sin(time * 0.4) * 0.003;
            hips.position.z = Math.cos(time * 0.4 * 2) * 0.002;
            hips.rotation.y = Math.sin(time * 0.3) * 0.002;
        }
        
        // Shoulder breathing
        const leftShoulder = this.three.vrm.humanoid.getNormalizedBoneNode('leftShoulder');
        const rightShoulder = this.three.vrm.humanoid.getNormalizedBoneNode('rightShoulder');
        
        if (leftShoulder) {
            leftShoulder.rotation.z = breath * 0.002;
            leftShoulder.rotation.x = breathDeep * 0.001;
        }
        if (rightShoulder) {
            rightShoulder.rotation.z = -breath * 0.002;
            rightShoulder.rotation.x = breathDeep * 0.001;
        }
    }
    
    updateIdleAnimations(time) {
        if (!this.three.vrm || !this.three.vrm.humanoid || this.state.isAnimating) return;
        
        // Subtle idle animations for arms to prevent static look
        const leftUpperArm = this.three.vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
        const rightUpperArm = this.three.vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
        const leftLowerArm = this.three.vrm.humanoid.getNormalizedBoneNode('leftLowerArm');
        const rightLowerArm = this.three.vrm.humanoid.getNormalizedBoneNode('rightLowerArm');
        
        // Very subtle arm movement while maintaining rest position
        const idlePhase = time * 0.5;
        const microMovement = 0.02; // Very small movement
        
        if (leftUpperArm && this.animation.armRestPosition.leftUpper) {
            leftUpperArm.rotation.z = this.animation.armRestPosition.leftUpper.z + Math.sin(idlePhase) * microMovement;
            leftUpperArm.rotation.x = this.animation.armRestPosition.leftUpper.x + Math.cos(idlePhase * 1.3) * microMovement * 0.5;
        }
        
        if (rightUpperArm && this.animation.armRestPosition.rightUpper) {
            rightUpperArm.rotation.z = this.animation.armRestPosition.rightUpper.z - Math.sin(idlePhase + 0.5) * microMovement;
            rightUpperArm.rotation.x = this.animation.armRestPosition.rightUpper.x + Math.cos(idlePhase * 1.3 + 0.5) * microMovement * 0.5;
        }
        
        // Subtle lower arm movement
        if (leftLowerArm && this.animation.armRestPosition.leftLower) {
            leftLowerArm.rotation.z = this.animation.armRestPosition.leftLower.z + Math.sin(idlePhase * 1.5) * microMovement * 0.5;
        }
        
        if (rightLowerArm && this.animation.armRestPosition.rightLower) {
            rightLowerArm.rotation.z = this.animation.armRestPosition.rightLower.z - Math.sin(idlePhase * 1.5 + 0.5) * microMovement * 0.5;
        }
    }
    
    updateBlink(time) {
        if (!this.three.vrm || !this.three.vrm.expressionManager) return;
        if (!this.availableExpressions?.includes('blink')) return;
        
        // Natural blinking
        this.animation.blinkTimer += time - (this.animation.lastTime || 0);
        this.animation.lastTime = time;
        
        if (this.animation.blinkTimer > this.config.blinkInterval / 1000) {
            this.performBlink();
            this.animation.blinkTimer = 0;
            
            // Randomize next blink interval
            this.config.blinkInterval = 3000 + Math.random() * 3000;
        }
    }
    
    updateHeadMovement(deltaTime) {
        if (!this.three.vrm || !this.three.vrm.humanoid) return;
        
        const head = this.three.vrm.humanoid.getNormalizedBoneNode('head');
        const neck = this.three.vrm.humanoid.getNormalizedBoneNode('neck');
        
        if (!head) return;
        
        const time = this.three.clock.getElapsedTime();
        
        // AIRI-style subtle idle movements
        // Slow, natural head movements that make the character feel alive
        const idleX = Math.sin(time * 0.5) * 0.02 + Math.sin(time * 1.3) * 0.01;
        const idleY = Math.cos(time * 0.7) * 0.025 + Math.cos(time * 1.7) * 0.01;
        
        // Occasional micro-movements (small random adjustments)
        const microX = Math.sin(time * 3.2) * 0.005;
        const microY = Math.cos(time * 2.8) * 0.005;
        
        // Smooth interpolation towards target
        const lerpSpeed = 2.0;
        const targetX = this.animation.headTarget.x * 0.15 + idleX + microX;
        const targetY = this.animation.headTarget.y * 0.2 + idleY + microY;
        
        head.rotation.x += (targetX - head.rotation.x) * lerpSpeed * deltaTime;
        head.rotation.y += (targetY - head.rotation.y) * lerpSpeed * deltaTime;
        
        // Subtle neck movement (follows head with delay)
        if (neck) {
            neck.rotation.x = head.rotation.x * 0.3;
            neck.rotation.y = head.rotation.y * 0.3;
        }
        
        // AIRI-style occasional micro-expressions
        if (this.three.vrm.expressionManager) {
            const expressionTime = time * 0.3;
            const subtleSmile = (Math.sin(expressionTime) + 1) * 0.05;
            
            try {
                this.three.vrm.expressionManager.setValue('happy', subtleSmile);
            } catch (e) {}
        }
    }
    
    updateGestures(deltaTime) {
        // Process gesture queue
        if (this.animation.gestureQueue.length > 0 && !this.animation.currentGesture) {
            const gesture = this.animation.gestureQueue.shift();
            this.performGesture(gesture);
        }
    }
    
    updateCurrentGesture(deltaTime) {
        const gesture = this.animation.currentGesture;
        if (!gesture) return;
        
        gesture.elapsed += deltaTime;
        const progress = Math.min(gesture.elapsed / gesture.duration, 1);
        
        // Apply gesture animation
        if (gesture.update) {
            gesture.update(progress);
        }
        
        // Complete gesture
        if (progress >= 1) {
            if (gesture.onComplete) {
                gesture.onComplete();
            }
            this.animation.currentGesture = null;
            this.state.isAnimating = false;
            
            // Return to rest pose
            this.returnToRestPose();
        }
    }
    
    // === GESTURE SYSTEM ===
    
    playWave() {
        if (!this.three.vrm || !this.three.vrm.humanoid) return;
        if (this.state.isAnimating) return;
        
        console.log('👋 Playing AIRI-style natural wave animation');
        this.state.isAnimating = true;
        
        const bones = {
            rightUpperArm: this.three.vrm.humanoid.getNormalizedBoneNode('rightUpperArm'),
            rightLowerArm: this.three.vrm.humanoid.getNormalizedBoneNode('rightLowerArm'),
            rightHand: this.three.vrm.humanoid.getNormalizedBoneNode('rightHand')
        };
        
        if (!bones.rightUpperArm) {
            this.state.isAnimating = false;
            return;
        }
        
        // Store initial positions
        const initial = {
            upperArm: bones.rightUpperArm.rotation.clone(),
            lowerArm: bones.rightLowerArm ? bones.rightLowerArm.rotation.clone() : null,
            hand: bones.rightHand ? bones.rightHand.rotation.clone() : null
        };
        
        // AIRI-style wave: smooth, friendly, natural
        this.animation.currentGesture = {
            type: 'wave',
            duration: 2.8,
            elapsed: 0,
            update: (progress) => {
                // Easing function for smooth motion
                const easeInOut = (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
                
                if (progress < 0.25) {
                    // Phase 1: Smoothly raise arm from rest position
                    const p = easeInOut(progress / 0.25);
                    
                    // From 70-degree rest to wave position
                    bones.rightUpperArm.rotation.z = -1.22 + 1.52 * p; // From -70° to about 17°
                    bones.rightUpperArm.rotation.x = 0.05 - 0.4 * p;   // Forward
                    bones.rightUpperArm.rotation.y = -0.2 * p;         // Slight outward
                    
                    if (bones.rightLowerArm) {
                        bones.rightLowerArm.rotation.y = 0.1 - 0.8 * p;  // Bend elbow
                        bones.rightLowerArm.rotation.z = -0.17 - 0.1 * p; // From rest bend
                    }
                } else if (progress < 0.75) {
                    // Phase 2: Wave motion
                    const p = (progress - 0.25) / 0.5;
                    const wave = Math.sin(p * Math.PI * 2.5) * 0.3;
                    
                    bones.rightUpperArm.rotation.z = 0.3; // Hold up
                    bones.rightUpperArm.rotation.x = -0.35;
                    bones.rightUpperArm.rotation.y = -0.2;
                    
                    if (bones.rightLowerArm) {
                        bones.rightLowerArm.rotation.y = -0.7 + wave * 0.15;
                        bones.rightLowerArm.rotation.z = -0.27;
                    }
                    
                    if (bones.rightHand) {
                        bones.rightHand.rotation.z = wave;
                        bones.rightHand.rotation.x = wave * 0.3;
                    }
                } else {
                    // Phase 3: Smoothly lower arm back to rest
                    const p = easeInOut((progress - 0.75) / 0.25);
                    
                    bones.rightUpperArm.rotation.z = 0.3 - 1.52 * p;  // Back to -70°
                    bones.rightUpperArm.rotation.x = -0.35 + 0.4 * p; // Back to slight forward
                    bones.rightUpperArm.rotation.y = -0.2 + 0.2 * p;  // Back to neutral
                    
                    if (bones.rightLowerArm) {
                        bones.rightLowerArm.rotation.y = -0.7 + 0.8 * p;   // Back to slight bend
                        bones.rightLowerArm.rotation.z = -0.27 + 0.1 * p;  // Back to rest bend
                    }
                    
                    if (bones.rightHand) {
                        bones.rightHand.rotation.z = 0;
                        bones.rightHand.rotation.x = 0;
                    }
                }
            },
            onComplete: () => {
                // Return to exact initial positions
                bones.rightUpperArm.rotation.copy(initial.upperArm);
                if (bones.rightLowerArm && initial.lowerArm) {
                    bones.rightLowerArm.rotation.copy(initial.lowerArm);
                }
                if (bones.rightHand && initial.hand) {
                    bones.rightHand.rotation.copy(initial.hand);
                }
            }
        };
        
        this.emit('gesture:wave');
    }
    
    performHeadTilt() {
        if (!this.three.vrm || !this.three.vrm.humanoid) return;
        
        const head = this.three.vrm.humanoid.getNormalizedBoneNode('head');
        if (!head) return;
        
        this.animation.currentGesture = {
            type: 'headTilt',
            duration: 1.0,
            elapsed: 0,
            update: (progress) => {
                const tilt = Math.sin(progress * Math.PI) * 0.2;
                head.rotation.z = tilt;
            }
        };
    }
    
    performNod() {
        if (!this.three.vrm || !this.three.vrm.humanoid) return;
        
        const head = this.three.vrm.humanoid.getNormalizedBoneNode('head');
        if (!head) return;
        
        this.animation.currentGesture = {
            type: 'nod',
            duration: 0.8,
            elapsed: 0,
            update: (progress) => {
                const nod = Math.sin(progress * Math.PI * 2) * 0.15;
                head.rotation.x = nod;
            }
        };
    }
    
    performBlink() {
        if (!this.three.vrm || !this.three.vrm.expressionManager) return;
        
        this.animation.currentGesture = {
            type: 'blink',
            duration: 0.15,
            elapsed: 0,
            update: (progress) => {
                const blinkValue = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
                try {
                    this.three.vrm.expressionManager.setValue('blink', blinkValue);
                } catch (e) {
                    // Blink not available
                }
            }
        };
    }
    
    performWink() {
        if (!this.three.vrm || !this.three.vrm.expressionManager) return;
        
        this.animation.currentGesture = {
            type: 'wink',
            duration: 0.5,
            elapsed: 0,
            update: (progress) => {
                const winkValue = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
                try {
                    this.three.vrm.expressionManager.setValue('blinkLeft', winkValue);
                } catch (e) {
                    try {
                        this.three.vrm.expressionManager.setValue('blink', winkValue * 0.5);
                    } catch (e2) {}
                }
            }
        };
    }
    
    performGesture(type) {
        switch(type) {
            case 'wave': this.playWave(); break;
            case 'nod': this.performNod(); break;
            case 'headTilt': this.performHeadTilt(); break;
            case 'wink': this.performWink(); break;
            case 'blink': this.performBlink(); break;
            default: console.warn('Unknown gesture:', type);
        }
    }
    
    returnToRestPose() {
        if (!this.three.vrm || !this.three.vrm.humanoid) return;
        
        // Smoothly return arms to rest position
        const leftUpperArm = this.three.vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
        const leftLowerArm = this.three.vrm.humanoid.getNormalizedBoneNode('leftLowerArm');
        const rightUpperArm = this.three.vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
        const rightLowerArm = this.three.vrm.humanoid.getNormalizedBoneNode('rightLowerArm');
        
        if (leftUpperArm && this.animation.armRestPosition.leftUpper) {
            leftUpperArm.rotation.x = this.animation.armRestPosition.leftUpper.x;
            leftUpperArm.rotation.y = this.animation.armRestPosition.leftUpper.y;
            leftUpperArm.rotation.z = this.animation.armRestPosition.leftUpper.z;
        }
        if (leftLowerArm && this.animation.armRestPosition.leftLower) {
            leftLowerArm.rotation.x = this.animation.armRestPosition.leftLower.x;
            leftLowerArm.rotation.y = this.animation.armRestPosition.leftLower.y;
            leftLowerArm.rotation.z = this.animation.armRestPosition.leftLower.z;
        }
        if (rightUpperArm && this.animation.armRestPosition.rightUpper) {
            rightUpperArm.rotation.x = this.animation.armRestPosition.rightUpper.x;
            rightUpperArm.rotation.y = this.animation.armRestPosition.rightUpper.y;
            rightUpperArm.rotation.z = this.animation.armRestPosition.rightUpper.z;
        }
        if (rightLowerArm && this.animation.armRestPosition.rightLower) {
            rightLowerArm.rotation.x = this.animation.armRestPosition.rightLower.x;
            rightLowerArm.rotation.y = this.animation.armRestPosition.rightLower.y;
            rightLowerArm.rotation.z = this.animation.armRestPosition.rightLower.z;
        }
    }
    
    // === SPEECH ANIMATIONS ===
    
    startSpeechAnimation(text) {
        this.state.isTalking = true;
        
        // Analyze sentiment for expression
        const sentiment = this.analyzeSentiment(text);
        this.setExpression(sentiment, 0.3);
        
        // Add conversational gestures
        const gestures = this.generateConversationalGestures(text);
        this.animation.gestureQueue = gestures;
        
        this.emit('speech:start', { text, sentiment });
    }
    
    stopSpeechAnimation() {
        this.state.isTalking = false;
        
        // Return to neutral expression
        this.setExpression('neutral', 0);
        
        // Clear gesture queue
        this.animation.gestureQueue = [];
        
        // Return to rest pose
        this.returnToRestPose();
        
        this.emit('speech:end');
    }
    
    analyzeSentiment(text) {
        const lower = text.toLowerCase();
        
        if (lower.includes('happy') || lower.includes('great') || lower.includes('awesome')) {
            return 'happy';
        } else if (lower.includes('sad') || lower.includes('sorry')) {
            return 'sad';
        } else if (lower.includes('surprise') || lower.includes('wow')) {
            return 'surprised';
        } else if (lower.includes('think') || lower.includes('hmm')) {
            return 'thinking';
        }
        
        return 'neutral';
    }
    
    generateConversationalGestures(text) {
        const gestures = [];
        const words = text.split(' ').length;
        
        // Add gestures based on text length
        if (words > 10) {
            gestures.push('nod');
        }
        if (words > 20) {
            gestures.push('headTilt');
        }
        if (text.includes('!')) {
            gestures.push('nod');
        }
        if (text.includes('?')) {
            gestures.push('headTilt');
        }
        
        return gestures;
    }
    
    // === EXPRESSION SYSTEM ===
    
    setExpression(expression, intensity = 1.0, duration = 1000) {
        if (!this.three.vrm || !this.three.vrm.expressionManager) return;
        
        const startTime = Date.now();
        const startExpression = this.state.currentExpression;
        
        const updateExpression = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            try {
                // Fade out old expression
                if (startExpression !== 'neutral') {
                    this.three.vrm.expressionManager.setValue(startExpression, (1 - progress) * intensity);
                }
                
                // Fade in new expression
                if (expression !== 'neutral') {
                    this.three.vrm.expressionManager.setValue(expression, progress * intensity);
                }
                
                if (progress < 1) {
                    requestAnimationFrame(updateExpression);
                } else {
                    this.state.currentExpression = expression;
                }
            } catch (e) {
                // Expression not available
            }
        };
        
        updateExpression();
    }
    
    // === SPECIAL SEQUENCES ===
    
    playOpeningSequence() {
        if (!this.three.vrm) return;
        
        console.log('🎬 Playing opening sequence');
        
        // AIRI-style friendly greeting sequence
        setTimeout(() => this.performNod(), 500);
        setTimeout(() => this.playWave(), 1500);
        setTimeout(() => {
            this.setExpression('happy', 0.3, 2000);
        }, 4500);
        setTimeout(() => {
            this.setExpression('neutral', 0, 1000);
            this.returnToRestPose();
        }, 7000);
        
        this.emit('sequence:opening');
    }
    
    reactToUserInput() {
        // Quick acknowledgment animation
        const reactions = ['nod', 'headTilt', 'blink'];
        const reaction = reactions[Math.floor(Math.random() * reactions.length)];
        this.performGesture(reaction);
    }
    
    reactToUserReturn() {
        // Welcome back animation
        this.setExpression('happy', 0.3, 1000);
        this.performNod();
        setTimeout(() => this.setExpression('neutral', 0, 1000), 2000);
    }
    
    // === UTILITY METHODS ===
    
    updateHeadTarget(x, y) {
        this.animation.headTarget.x = x;
        this.animation.headTarget.y = y;
    }
    
    handleResize() {
        if (!this.three.camera || !this.three.renderer) return;
        
        this.three.camera.aspect = window.innerWidth / window.innerHeight;
        this.three.camera.updateProjectionMatrix();
        this.three.renderer.setSize(window.innerWidth, window.innerHeight);
    }
    
    createFallbackAvatar() {
        console.warn('Creating fallback avatar');
        
        // Show fallback UI
        const fallback = document.querySelector('.webgl-fallback');
        if (fallback) {
            fallback.style.display = 'block';
        }
        
        this.emit('fallback:created');
    }
    
    async reload() {
        console.log('🔄 Reloading VRM...');
        this.state.loaded = false;
        await this.loadVRM();
    }
    
    getStats() {
        return {
            initialized: this.state.initialized,
            loaded: this.state.loaded,
            isAnimating: this.state.isAnimating,
            isTalking: this.state.isTalking,
            currentExpression: this.state.currentExpression,
            gestureQueueLength: this.animation.gestureQueue.length,
            hasVRM: !!this.three.vrm,
            availableExpressions: this.availableExpressions || []
        };
    }
    
    destroy() {
        // Stop animation loop
        this.state.initialized = false;
        
        // Clean up Three.js resources
        if (this.three.renderer) {
            this.three.renderer.dispose();
        }
        
        if (this.three.vrm && this.three.scene) {
            this.three.scene.remove(this.three.vrm.scene);
        }
        
        // Clean up tracked resources
        this.resources.textures.forEach(texture => texture.dispose());
        this.resources.geometries.forEach(geometry => geometry.dispose());
        this.resources.materials.forEach(material => material.dispose());
        
        // Remove event listeners
        window.removeEventListener('resize', this.handleResize);
        this.removeAllListeners();
        
        console.log('🧹 VRMController destroyed');
    }
}
