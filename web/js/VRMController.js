// web/js/VRMController.js
// AIRI-inspired VRM controller with natural human-like animations

import { EventEmitter } from './EventEmitter.js';

export class VRMController extends EventEmitter {
    constructor() {
        super();
        
        this.state = {
            initialized: false,
            loading: false,
            loaded: false,
            error: null,
            modules: {
                THREE: null,
                GLTFLoader: null,
                VRMLoaderPlugin: null,
                VRMUtils: null
            }
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
            fallback: null
        };
        
        this.animation = {
            isWaving: false,
            isTalking: false,
            isNodding: false,
            isThinking: false,
            isExcited: false,
            mood: 'neutral',
            headTarget: { x: 0, y: 0, z: 0 },
            blinkTimer: 0,
            breathingPhase: 0,
            idlePhase: 0,
            microMovementTimer: 0,
            shoulderRelaxTimer: 0,
            armSwayPhase: 0,
            expressionTimer: 0,
            currentExpression: 'neutral',
            expressionIntensity: 0,
            lastGestureTime: 0
        };
        
        this.config = {
            paths: [
                '/assets/avatar/solmate.vrm',
                'https://raw.githubusercontent.com/DirkDigglerTown/solmate/main/web/assets/avatar/solmate.vrm'
            ],
            fallbackEnabled: true,
            // RESTORED: Working camera positioning from previous chats
            cameraPosition: { x: 0, y: 4.0, z: 5.0 },
            lookAtPosition: { x: 0, y: 4.0, z: 0 },
            modelPosition: { x: 0, y: 4.0, z: 0 }
        };
    }
    
    async init() {
        if (this.state.initialized) {
            console.warn('VRMController already initialized');
            return;
        }
        
        try {
            this.emit('init:start');
            console.log('🎭 Initializing AIRI-style VRM system...');
            
            // Load modules with import map
            await this.loadModules();
            
            // Initialize Three.js scene
            await this.initializeScene();
            
            // Load VRM model
            await this.loadVRM();
            
            // Start animation loop
            this.startAnimationLoop();
            
            this.state.initialized = true;
            this.emit('init:complete');
            console.log('✅ AIRI-style VRM system initialized successfully');
            
        } catch (error) {
            console.error('❌ VRM initialization failed:', error);
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
        
        try {
            // Inject import map if not present
            if (!document.querySelector('script[type="importmap"]')) {
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
                
                // Wait for import map to be processed
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            // Dynamic imports using the import map
            const [
                THREE_MODULE,
                GLTF_MODULE, 
                VRM_MODULE
            ] = await Promise.all([
                import('three'),
                import('three/addons/loaders/GLTFLoader.js'),
                import('@pixiv/three-vrm')
            ]);
            
            // Store modules
            this.state.modules.THREE = THREE_MODULE;
            this.state.modules.GLTFLoader = GLTF_MODULE.GLTFLoader;
            this.state.modules.VRMLoaderPlugin = VRM_MODULE.VRMLoaderPlugin;
            this.state.modules.VRMUtils = VRM_MODULE.VRMUtils;
            
            // Expose globally for debugging
            window.THREE = THREE_MODULE;
            
            console.log('✅ All VRM modules loaded successfully');
            this.emit('modules:loaded');
            
        } catch (error) {
            console.error('❌ Failed to load VRM modules:', error);
            throw new Error(`Module loading failed: ${error.message}`);
        }
    }
    
    async initializeScene() {
        console.log('🎬 Setting up Three.js scene...');
        
        const THREE = this.state.modules.THREE;
        
        // Create scene
        this.three.scene = new THREE.Scene();
        this.three.scene.background = new THREE.Color(0x0a0e17);
        
        // Create camera with RESTORED working positioning
        this.three.camera = new THREE.PerspectiveCamera(
            45,
            window.innerWidth / window.innerHeight,
            0.1,
            100
        );
        
        // Set camera position (RESTORED from working version)
        this.three.camera.position.set(
            this.config.cameraPosition.x,
            this.config.cameraPosition.y,
            this.config.cameraPosition.z
        );
        
        // Look at the avatar (RESTORED from working version)
        this.three.camera.lookAt(
            this.config.lookAtPosition.x,
            this.config.lookAtPosition.y,
            this.config.lookAtPosition.z
        );
        
        // Get canvas and setup renderer
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
        this.three.renderer.toneMappingExposure = 1.2;
        this.three.renderer.outputColorSpace = THREE.SRGBColorSpace;
        
        // Setup AIRI-style lighting
        this.setupLighting();
        
        // Create animation clock
        this.three.clock = new THREE.Clock();
        
        // Handle window resize
        window.addEventListener('resize', () => this.handleResize());
        
        console.log('✅ Three.js scene initialized with AIRI-style setup');
        this.emit('scene:created');
    }
    
    setupLighting() {
        const THREE = this.state.modules.THREE;
        
        // Clear existing lights
        this.three.lights.forEach(light => {
            this.three.scene.remove(light);
        });
        this.three.lights = [];
        
        // AIRI-style lighting setup for natural avatar appearance
        
        // Main key light (from front-right, slightly above)
        const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
        keyLight.position.set(2, 3, 3);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.setScalar(2048);
        keyLight.shadow.camera.top = 2;
        keyLight.shadow.camera.bottom = -2;
        keyLight.shadow.camera.left = -2;
        keyLight.shadow.camera.right = 2;
        keyLight.shadow.camera.near = 0.1;
        keyLight.shadow.camera.far = 10;
        keyLight.shadow.bias = -0.0001;
        this.three.scene.add(keyLight);
        this.three.lights.push(keyLight);
        
        // Fill light (from front-left, softer)
        const fillLight = new THREE.DirectionalLight(0xffffff, 1.2);
        fillLight.position.set(-1, 2, 2);
        this.three.scene.add(fillLight);
        this.three.lights.push(fillLight);
        
        // Back rim light for depth
        const rimLight = new THREE.DirectionalLight(0x4a90e2, 0.8);
        rimLight.position.set(0, 1, -2);
        this.three.scene.add(rimLight);
        this.three.lights.push(rimLight);
        
        // Ambient light for overall illumination
        const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
        this.three.scene.add(ambientLight);
        this.three.lights.push(ambientLight);
        
        console.log('✅ AIRI-style lighting setup complete');
    }
    
    async loadVRM() {
        if (this.state.loading) {
            console.warn('VRM already loading');
            return;
        }
        
        this.state.loading = true;
        this.emit('load:start');
        console.log('🤖 Loading VRM model with proper VRM support...');
        
        try {
            const GLTFLoader = this.state.modules.GLTFLoader;
            const VRMLoaderPlugin = this.state.modules.VRMLoaderPlugin;
            
            const loader = new GLTFLoader();
            
            // CRITICAL: Proper VRM plugin registration
            loader.register((parser) => {
                return new VRMLoaderPlugin(parser);
            });
            
            let loaded = false;
            let lastError = null;
            
            for (const path of this.config.paths) {
                if (loaded) break;
                
                try {
                    console.log(`Attempting to load VRM from: ${path}`);
                    const gltf = await this.loadWithTimeout(loader, path, 30000);
                    
                    if (gltf.userData.vrm) {
                        console.log('✅ VRM data found - setting up natural pose...');
                        await this.setupVRM(gltf.userData.vrm);
                        loaded = true;
                        this.state.loaded = true;
                        this.emit('load:complete', this.vrm.current);
                        console.log(`✅ VRM loaded successfully from: ${path}`);
                        break;
                    } else {
                        console.warn('⚠️ No VRM data found, treating as standard GLTF');
                    }
                } catch (error) {
                    console.error(`Failed to load VRM from ${path}:`, error);
                    lastError = error;
                }
            }
            
            if (!loaded) {
                throw lastError || new Error('Failed to load VRM from all sources');
            }
            
        } catch (error) {
            console.error('❌ VRM loading failed:', error);
            this.state.error = error;
            this.emit('error', error);
            
            if (this.config.fallbackEnabled) {
                this.createFallbackAvatar();
            }
        } finally {
            this.state.loading = false;
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
                        total: progress.total,
                        progress: progress.total > 0 ? progress.loaded / progress.total : 0
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
        console.log('⚙️ Setting up VRM with AIRI-style natural pose...');
        
        // Remove existing VRM if any
        if (this.vrm.current) {
            this.three.scene.remove(this.vrm.current.scene);
            if (this.state.modules.VRMUtils) {
                this.state.modules.VRMUtils.deepDispose(this.vrm.current.scene);
            }
        }
        
        // Store VRM reference
        this.vrm.current = vrm;
        
        // Set model position and rotation (RESTORED from working version)
        vrm.scene.position.set(
            this.config.modelPosition.x,
            this.config.modelPosition.y,
            this.config.modelPosition.z
        );
        
        // Face camera (180 degree rotation)
        vrm.scene.rotation.y = Math.PI;
        
        // Add to scene
        this.three.scene.add(vrm.scene);
        
        // Setup VRM systems
        if (vrm.humanoid) {
            this.setupHumanoidPose(vrm.humanoid);
        }
        
        if (vrm.lookAt) {
            vrm.lookAt.target = this.three.camera;
        }
        
        if (vrm.expressionManager) {
            this.setupExpressions(vrm.expressionManager);
        }
        
        console.log('✅ VRM setup complete with AIRI-style natural pose');
        this.emit('vrm:setup', vrm);
    }
    
    setupHumanoidPose(humanoid) {
        console.log('🦴 Setting up AIRI-style natural humanoid pose...');
        
        try {
            // Center hips
            const hips = humanoid.getNormalizedBoneNode('hips');
            if (hips) {
                hips.position.set(0, 0, 0);
                hips.rotation.set(0, 0, 0);
            }
            
            // === CRITICAL FIX: Natural relaxed arm position (AIRI-style) ===
            const leftUpperArm = humanoid.getNormalizedBoneNode('leftUpperArm');
            const rightUpperArm = humanoid.getNormalizedBoneNode('rightUpperArm');
            const leftLowerArm = humanoid.getNormalizedBoneNode('leftLowerArm');
            const rightLowerArm = humanoid.getNormalizedBoneNode('rightLowerArm');
            const leftHand = humanoid.getNormalizedBoneNode('leftHand');
            const rightHand = humanoid.getNormalizedBoneNode('rightHand');
            
            // CRITICAL: Proper T-pose to rest position (AIRI standard - 70 degree rotation)
            if (leftUpperArm) {
                // 70 degrees = 1.22 radians (AIRI and VRoid Hub standard)
                leftUpperArm.rotation.z = 1.22;  // 70 degrees down from T-pose
                leftUpperArm.rotation.x = 0;     // No forward/back tilt initially
                leftUpperArm.rotation.y = 0;     // No twist initially
                console.log('✅ Left upper arm positioned at 70 degrees');
            }
            if (rightUpperArm) {
                rightUpperArm.rotation.z = -1.22; // 70 degrees down from T-pose (mirror)
                rightUpperArm.rotation.x = 0;     // No forward/back tilt initially
                rightUpperArm.rotation.y = 0;     // No twist initially
                console.log('✅ Right upper arm positioned at 70 degrees');
            }
            
            // Lower arms hang naturally with slight bend (AIRI standard)
            if (leftLowerArm) {
                leftLowerArm.rotation.z = 0.17;  // 10 degrees additional bend
                leftLowerArm.rotation.y = 0;     // No twist
                leftLowerArm.rotation.x = 0;     // Straight down
            }
            if (rightLowerArm) {
                rightLowerArm.rotation.z = -0.17; // 10 degrees additional bend (mirror)
                rightLowerArm.rotation.y = 0;      // No twist
                rightLowerArm.rotation.x = 0;      // Straight down
            }
            
            // Relax hands (AIRI-style natural hand position)
            if (leftHand) {
                leftHand.rotation.z = 0.1;  // Slight inward curve
                leftHand.rotation.x = 0.05; // Natural droop
            }
            if (rightHand) {
                rightHand.rotation.z = -0.1; // Slight inward curve
                rightHand.rotation.x = 0.05; // Natural droop
            }
            
            // Natural shoulder position (AIRI-style relaxed shoulders)
            const leftShoulder = humanoid.getNormalizedBoneNode('leftShoulder');
            const rightShoulder = humanoid.getNormalizedBoneNode('rightShoulder');
            if (leftShoulder) {
                leftShoulder.rotation.z = 0.08;  // Slightly dropped
                leftShoulder.rotation.y = 0.02;  // Slight forward roll
            }
            if (rightShoulder) {
                rightShoulder.rotation.z = -0.08; // Slightly dropped
                rightShoulder.rotation.y = -0.02; // Slight forward roll
            }
            
            // Natural spine position (AIRI-style natural posture)
            const spine = humanoid.getNormalizedBoneNode('spine');
            const chest = humanoid.getNormalizedBoneNode('chest');
            const upperChest = humanoid.getNormalizedBoneNode('upperChest');
            
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
            
            // Natural head position (AIRI-style alert but relaxed head)
            const neck = humanoid.getNormalizedBoneNode('neck');
            const head = humanoid.getNormalizedBoneNode('head');
            
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
            
            console.log('✅ AIRI-style natural humanoid pose configured successfully');
        } catch (error) {
            console.warn('⚠️ Could not setup humanoid pose:', error);
        }
    }
    
    setupExpressions(expressionManager) {
        console.log('😊 Setting up expressions...');
        
        const testExpressions = ['happy', 'sad', 'angry', 'surprised', 'blink', 'neutral'];
        const available = [];
        
        testExpressions.forEach(expr => {
            try {
                expressionManager.setValue(expr, 0);
                available.push(expr);
            } catch (e) {
                // Expression not available
            }
        });
        
        console.log(`Available expressions: ${available.join(', ')}`);
        this.emit('expressions:available', available);
    }
    
    createFallbackAvatar() {
        console.log('🔧 Creating AIRI-style fallback avatar...');
        
        // Check if THREE modules are loaded
        if (!this.state.modules.THREE) {
            console.warn('THREE modules not loaded, cannot create fallback avatar');
            return;
        }
        
        const THREE = this.state.modules.THREE;
        
        // Create simple humanoid-like shape
        const group = new THREE.Group();
        group.name = 'FallbackAvatar';
        
        // Body
        const bodyGeometry = new THREE.CapsuleGeometry(0.3, 1.2, 4, 8);
        const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0x4a90e2 });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 0.6;
        group.add(body);
        
        // Head
        const headGeometry = new THREE.SphereGeometry(0.2, 16, 16);
        const headMaterial = new THREE.MeshLambertMaterial({ color: 0xffd700 });
        const head = new THREE.Mesh(headGeometry, headMaterial);
        head.position.y = 1.5;
        group.add(head);
        
        // Arms positioned naturally (not T-pose)
        const armGeometry = new THREE.CapsuleGeometry(0.1, 0.8, 4, 8);
        const armMaterial = new THREE.MeshLambertMaterial({ color: 0x4a90e2 });
        
        const leftArm = new THREE.Mesh(armGeometry, armMaterial);
        leftArm.position.set(-0.4, 0.6, 0);
        leftArm.rotation.z = 0.3; // Arms hang naturally
        group.add(leftArm);
        
        const rightArm = new THREE.Mesh(armGeometry, armMaterial);
        rightArm.position.set(0.4, 0.6, 0);
        rightArm.rotation.z = -0.3; // Arms hang naturally
        group.add(rightArm);
        
        // Position fallback avatar
        group.position.set(
            this.config.modelPosition.x,
            this.config.modelPosition.y,
            this.config.modelPosition.z
        );
        
        this.three.scene.add(group);
        
        // Create minimal VRM interface
        this.vrm.fallback = group;
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
        console.log('✅ AIRI-style fallback avatar created');
    }
    
    startAnimationLoop() {
        console.log('🔄 Starting AIRI-style animation loop...');
        
        const animate = () => {
            requestAnimationFrame(animate);
            
            if (!this.three.renderer || !this.three.scene || !this.three.camera) {
                return;
            }
            
            const deltaTime = this.three.clock.getDelta();
            
            // Update VRM
            if (this.vrm.current && this.vrm.current.update) {
                this.vrm.current.update(deltaTime);
            }
            
            // Apply AIRI-style animations
            this.updateAnimations(deltaTime);
            
            // Render frame
            this.three.renderer.render(this.three.scene, this.three.camera);
        };
        
        animate();
        this.emit('animation:started');
    }
    
    updateAnimations(deltaTime) {
        if (!this.vrm.current) return;
        
        const time = Date.now() / 1000;
        
        // === AIRI-STYLE BREATHING ANIMATION ===
        this.animation.breathingPhase += deltaTime * 2.5; // Breathing rate
        const breathIntensity = 1 + Math.sin(this.animation.breathingPhase) * 0.025; // 2.5% scale variation
        
        if (this.vrm.current.humanoid && !this.vrm.current.isFallback) {
            const chest = this.vrm.current.humanoid.getNormalizedBoneNode('chest');
            const upperChest = this.vrm.current.humanoid.getNormalizedBoneNode('upperChest');
            
            // Apply breathing to chest bones (uniform scaling like AIRI)
            if (chest) {
                chest.scale.set(breathIntensity, breathIntensity, breathIntensity);
            }
            if (upperChest) {
                upperChest.scale.set(breathIntensity, breathIntensity, breathIntensity);
            }
        }
        
        // === PROCEDURAL IDLE ANIMATIONS ===
        if (!this.animation.isTalking && !this.animation.isWaving) {
            // Subtle body sway (reduced for more natural look)
            this.animation.idlePhase += deltaTime * 0.3;
            if (this.vrm.current.scene) {
                // Very subtle rotation sway
                this.vrm.current.scene.rotation.y = Math.PI + Math.sin(this.animation.idlePhase) * 0.01;
                
                // Subtle weight shift (side to side)
                this.vrm.current.scene.position.x = Math.sin(this.animation.idlePhase * 0.7) * 0.01;
            }
            
            if (this.vrm.current.humanoid && !this.vrm.current.isFallback) {
                const head = this.vrm.current.humanoid.getNormalizedBoneNode('head');
                const neck = this.vrm.current.humanoid.getNormalizedBoneNode('neck');
                const spine = this.vrm.current.humanoid.getNormalizedBoneNode('spine');
                
                // Natural idle head movement
                if (head) {
                    // Combine look-at with idle movement
                    const idleX = Math.sin(time * 0.6) * 0.015;
                    const idleY = Math.sin(time * 0.8) * 0.02;
                    const idleZ = Math.sin(time * 0.5) * 0.005;
                    
                    head.rotation.x = idleX + this.animation.headTarget.x * 0.3;
                    head.rotation.y = idleY + this.animation.headTarget.y * 0.3;
                    head.rotation.z = idleZ;
                }
                
                if (neck) {
                    // Subtle neck movement
                    neck.rotation.x = Math.sin(time * 0.7 + 0.5) * 0.008;
                    neck.rotation.y = Math.sin(time * 0.5 + 0.5) * 0.01;
                }
                
                // Spine micro-movements for natural stance
                if (spine) {
                    spine.rotation.x = 0.02 + Math.sin(time * 0.4) * 0.005;
                    spine.rotation.y = Math.sin(time * 0.3) * 0.003;
                }
                
                // Arms stay in natural position with very minimal movement
                const leftArm = this.vrm.current.humanoid.getNormalizedBoneNode('leftUpperArm');
                const rightArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightUpperArm');
                
                // Keep arms at 70 degree rest position with tiny variations
                if (leftArm) {
                    leftArm.rotation.z = 1.22 + Math.sin(time * 0.4) * 0.02; // Tiny movement around rest
                }
                if (rightArm) {
                    rightArm.rotation.z = -1.22 - Math.sin(time * 0.4 + Math.PI) * 0.02;
                }
                
                // Occasional idle gestures every 8-12 seconds
                this.animation.microMovementTimer += deltaTime;
                if (this.animation.microMovementTimer > 8 + Math.random() * 4) {
                    this.performIdleGesture();
                    this.animation.microMovementTimer = 0;
                }
            }
        }
        
        // === TALKING ANIMATIONS (AIRI-STYLE) ===
        if (this.animation.isTalking && this.vrm.current.humanoid && !this.vrm.current.isFallback) {
            const talkTime = time * 2.5;
            
            // Animated head movement during speech
            const head = this.vrm.current.humanoid.getNormalizedBoneNode('head');
            if (head) {
                head.rotation.x = Math.sin(talkTime * 1.2) * 0.025;
                head.rotation.y = Math.sin(talkTime) * 0.035;
                head.rotation.z = Math.sin(talkTime * 0.8) * 0.015;
            }
            
            // Natural conversational gestures - arms move up from rest position but not too high
            const leftArm = this.vrm.current.humanoid.getNormalizedBoneNode('leftUpperArm');
            const rightArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightUpperArm');
            const leftLowerArm = this.vrm.current.humanoid.getNormalizedBoneNode('leftLowerArm');
            const rightLowerArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightLowerArm');
            
            const gestureIntensity = 0.15 + Math.sin(talkTime * 0.3) * 0.1;
            
            if (leftArm) {
                // Start from rest (1.22) and move slightly up for gestures
                leftArm.rotation.z = 1.22 - gestureIntensity * 0.8;
                leftArm.rotation.x = Math.sin(talkTime * 0.8) * 0.15;
                leftArm.rotation.y = Math.sin(talkTime * 0.6) * 0.1;
            }
            
            if (rightArm) {
                // Mirror movement with slight delay
                rightArm.rotation.z = -1.22 + gestureIntensity * 0.8;
                rightArm.rotation.x = Math.sin(talkTime * 0.8 + Math.PI * 0.5) * 0.15;
                rightArm.rotation.y = -Math.sin(talkTime * 0.6 + Math.PI * 0.5) * 0.1;
            }
            
            // Natural elbow movement during gestures
            if (leftLowerArm) {
                leftLowerArm.rotation.z = 0.17 + Math.sin(talkTime * 1.2) * 0.2;
                leftLowerArm.rotation.y = -Math.sin(talkTime * 1.5) * 0.2;
            }
            
            if (rightLowerArm) {
                rightLowerArm.rotation.z = -0.17 - Math.sin(talkTime * 1.2 + Math.PI) * 0.2;
                rightLowerArm.rotation.y = Math.sin(talkTime * 1.5 + Math.PI) * 0.2;
            }
        }
        
        // === BLINKING ===
        this.animation.blinkTimer += deltaTime;
        const blinkInterval = this.animation.isTalking ? 2 : 3 + Math.random();
        if (this.animation.blinkTimer > blinkInterval) {
            this.blink();
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
                this.blink();
            }
        }
    }
    
    // ANIMATION METHODS
    
    playWave() {
        if (!this.vrm.current || this.animation.isWaving) return;
        
        console.log('🌊 Playing AIRI-style wave animation');
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
        
        let waveTime = 0;
        
        const waveInterval = setInterval(() => {
            waveTime += 0.016;
            
            if (waveTime >= 3) {
                // Return to natural rest position (70 degrees down)
                rightArm.rotation.z = -1.22;
                rightArm.rotation.x = 0;
                rightArm.rotation.y = 0;
                
                if (rightLowerArm) {
                    rightLowerArm.rotation.z = -0.17;
                    rightLowerArm.rotation.y = 0;
                    rightLowerArm.rotation.x = 0;
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
            }
            
            // Add slight body movement during wave
            if (this.vrm.current.scene) {
                this.vrm.current.scene.rotation.y = Math.PI + Math.sin(waveTime * Math.PI * 2) * 0.04;
            }
        }, 16);
    }
    
    playFallbackWave() {
        if (!this.vrm.fallback) return;
        
        let waveTime = 0;
        
        const waveInterval = setInterval(() => {
            waveTime += 0.016;
            
            if (waveTime >= 2) {
                this.vrm.fallback.rotation.z = 0;
                this.animation.isWaving = false;
                this.emit('animation:wave:end');
                clearInterval(waveInterval);
                return;
            }
            
            this.vrm.fallback.rotation.z = Math.sin(waveTime * Math.PI * 3) * 0.1;
        }, 16);
    }
    
    startSpeechAnimation() {
        console.log('🗣️ Starting AIRI-style speech animation');
        this.animation.isTalking = true;
        this.setExpression('happy', 0.3);
        this.emit('animation:speech:start');
    }
    
    stopSpeechAnimation() {
        console.log('🔇 Stopping speech animation');
        this.animation.isTalking = false;
        
        // Return to neutral expression
        this.setExpression('neutral', 0);
        
        // Smoothly return arms to natural rest position (70 degree down position)
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
                    // Final rest position (70 degrees down)
                    if (leftArm) {
                        leftArm.rotation.z = 1.22;  // 70 degrees
                        leftArm.rotation.x = 0;
                        leftArm.rotation.y = 0;
                    }
                    if (rightArm) {
                        rightArm.rotation.z = -1.22; // 70 degrees
                        rightArm.rotation.x = 0;
                        rightArm.rotation.y = 0;
                    }
                    if (leftLowerArm) {
                        leftLowerArm.rotation.z = 0.17;  // 10 degrees
                        leftLowerArm.rotation.y = 0;
                        leftLowerArm.rotation.x = 0;
                    }
                    if (rightLowerArm) {
                        rightLowerArm.rotation.z = -0.17; // 10 degrees
                        rightLowerArm.rotation.y = 0;
                        rightLowerArm.rotation.x = 0;
                    }
                    
                    clearInterval(returnInterval);
                    return;
                }
                
                const progress = returnTime / 0.5;
                const smoothProgress = progress * progress * (3 - 2 * progress); // Smooth step
                
                // Interpolate to rest position
                if (leftArm) {
                    leftArm.rotation.z = leftArm.rotation.z * (1 - smoothProgress) + 1.22 * smoothProgress;
                    leftArm.rotation.x = leftArm.rotation.x * (1 - smoothProgress);
                    leftArm.rotation.y = leftArm.rotation.y * (1 - smoothProgress);
                }
                if (rightArm) {
                    rightArm.rotation.z = rightArm.rotation.z * (1 - smoothProgress) + (-1.22) * smoothProgress;
                    rightArm.rotation.x = rightArm.rotation.x * (1 - smoothProgress);
                    rightArm.rotation.y = rightArm.rotation.y * (1 - smoothProgress);
                }
                if (leftLowerArm) {
                    leftLowerArm.rotation.z = leftLowerArm.rotation.z * (1 - smoothProgress) + 0.17 * smoothProgress;
                    leftLowerArm.rotation.y = leftLowerArm.rotation.y * (1 - smoothProgress);
                }
                if (rightLowerArm) {
                    rightLowerArm.rotation.z = rightLowerArm.rotation.z * (1 - smoothProgress) + (-0.17) * smoothProgress;
                    rightLowerArm.rotation.y = rightLowerArm.rotation.y * (1 - smoothProgress);
                }
            }, 16);
        }
        
        this.emit('animation:speech:end');
    }
    
    playNod() {
        console.log('👍 Playing nod animation');
        this.animation.isNodding = true;
        this.emit('animation:nod:start');
        
        if (this.vrm.current?.humanoid && !this.vrm.current.isFallback) {
            const head = this.vrm.current.humanoid.getNormalizedBoneNode('head');
            if (head) {
                let nodTime = 0;
                const originalRotation = head.rotation.clone();
                
                const nodInterval = setInterval(() => {
                    nodTime += 0.016;
                    
                    if (nodTime >= 1) {
                        head.rotation.copy(originalRotation);
                        this.animation.isNodding = false;
                        this.emit('animation:nod:end');
                        clearInterval(nodInterval);
                        return;
                    }
                    
                    const nodIntensity = Math.sin(nodTime * Math.PI * 3);
                    head.rotation.x = originalRotation.x + nodIntensity * 0.3;
                }, 16);
            }
        }
        
        setTimeout(() => {
            this.animation.isNodding = false;
        }, 1000);
    }
    
    playThink() {
        console.log('🤔 Playing thinking animation');
        this.animation.isThinking = true;
        this.emit('animation:think:start');
        
        this.setExpression('neutral', 0.8);
        
        if (this.vrm.current?.humanoid && !this.vrm.current.isFallback) {
            const head = this.vrm.current.humanoid.getNormalizedBoneNode('head');
            if (head) {
                let thinkTime = 0;
                const originalRotation = head.rotation.clone();
                
                const thinkInterval = setInterval(() => {
                    thinkTime += 0.016;
                    
                    if (thinkTime >= 2) {
                        head.rotation.copy(originalRotation);
                        this.animation.isThinking = false;
                        this.setExpression('neutral', 0);
                        this.emit('animation:think:end');
                        clearInterval(thinkInterval);
                        return;
                    }
                    
                    // Head tilt with subtle movement
                    head.rotation.z = originalRotation.z + Math.sin(thinkTime) * 0.1;
                    head.rotation.x = originalRotation.x + 0.1;
                }, 16);
            }
        }
        
        setTimeout(() => {
            this.animation.isThinking = false;
            this.setExpression('neutral', 0);
        }, 2000);
    }
    
    playExcited() {
        console.log('🎉 Playing excited animation');
        this.animation.isExcited = true;
        this.emit('animation:excited:start');
        
        this.setExpression('happy', 0.8);
        
        if (this.vrm.current?.scene) {
            let excitedTime = 0;
            const originalY = this.vrm.current.scene.position.y;
            
            const excitedInterval = setInterval(() => {
                excitedTime += 0.016;
                
                if (excitedTime >= 2) {
                    this.vrm.current.scene.position.y = originalY;
                    this.animation.isExcited = false;
                    this.setExpression('happy', 0.2);
                    this.emit('animation:excited:end');
                    clearInterval(excitedInterval);
                    return;
                }
                
                // Bouncing motion
                const bounce = Math.abs(Math.sin(excitedTime * Math.PI * 6)) * 0.1;
                this.vrm.current.scene.position.y = originalY + bounce;
            }, 16);
        }
        
        setTimeout(() => {
            this.animation.isExcited = false;
            this.setExpression('happy', 0.2);
        }, 2000);
    }
    
    setExpression(expression, intensity = 0.5) {
        if (!this.vrm.current?.expressionManager) return;
        
        try {
            // Clear previous expressions
            if (this.animation.currentExpression !== 'neutral' && this.animation.currentExpression !== expression) {
                this.vrm.current.expressionManager.setValue(this.animation.currentExpression, 0);
            }
            
            // Set new expression
            this.vrm.current.expressionManager.setValue(expression, intensity);
            this.animation.currentExpression = expression;
            this.animation.expressionIntensity = intensity;
            this.animation.expressionTimer = 0;
            
            console.log(`😊 Expression set: ${expression} (${intensity})`);
            this.emit('expression:changed', { expression, intensity });
        } catch (error) {
            console.warn(`⚠️ Expression '${expression}' not available:`, error);
        }
    }
    
    setMood(mood) {
        console.log(`😌 Setting mood: ${mood}`);
        this.animation.mood = mood;
        
        const moodExpressions = {
            happy: { expression: 'happy', intensity: 0.4 },
            sad: { expression: 'sad', intensity: 0.4 },
            excited: { expression: 'happy', intensity: 0.8 },
            calm: { expression: 'neutral', intensity: 0.2 },
            surprised: { expression: 'surprised', intensity: 0.6 },
            angry: { expression: 'angry', intensity: 0.5 },
            neutral: { expression: 'neutral', intensity: 0 }
        };
        
        const moodConfig = moodExpressions[mood] || moodExpressions.neutral;
        this.setExpression(moodConfig.expression, moodConfig.intensity);
        
        this.emit('mood:changed', mood);
    }
    
    blink() {
        if (!this.vrm.current?.expressionManager) return;
        
        try {
            this.vrm.current.expressionManager.setValue('blink', 1.0);
            setTimeout(() => {
                if (this.vrm.current?.expressionManager) {
                    this.vrm.current.expressionManager.setValue('blink', 0);
                }
            }, 150);
        } catch (error) {
            // Blink expression not available
        }
    }
    
    updateHeadTarget(x, y, z = 0) {
        this.animation.headTarget = { x, y, z };
    }
    
    handleResize() {
        if (!this.three.camera || !this.three.renderer) return;
        
        this.three.camera.aspect = window.innerWidth / window.innerHeight;
        this.three.camera.updateProjectionMatrix();
        this.three.renderer.setSize(window.innerWidth, window.innerHeight);
        
        this.emit('resize');
    }
    
    // UTILITY METHODS
    
    getState() {
        return {
            initialized: this.state.initialized,
            loaded: this.state.loaded,
            hasVRM: !!this.vrm.current && !this.vrm.current.isFallback,
            hasFallback: !!this.vrm.fallback,
            isAnimating: this.animation.isWaving || this.animation.isTalking || this.animation.isNodding,
            currentExpression: this.animation.currentExpression,
            mood: this.animation.mood,
            cameraPosition: this.three.camera?.position.toArray(),
            avatarBounds: this.getAvatarBounds()
        };
    }
    
    getAvatarBounds() {
        if (!this.vrm.current?.scene || !this.state.modules.THREE) return null;
        
        const bbox = new (this.state.modules.THREE.Box3)().setFromObject(this.vrm.current.scene);
        return {
            min: bbox.min.toArray(),
            max: bbox.max.toArray(),
            center: bbox.getCenter(new (this.state.modules.THREE.Vector3)()).toArray(),
            size: bbox.getSize(new (this.state.modules.THREE.Vector3)()).toArray()
        };
    }
    
    reload() {
        console.log('🔄 Reloading VRM with AIRI-style setup...');
        
        // Stop current animations
        this.animation.isWaving = false;
        this.animation.isTalking = false;
        this.animation.isNodding = false;
        this.animation.isThinking = false;
        this.animation.isExcited = false;
        
        // Remove current VRM
        if (this.vrm.current) {
            this.three.scene.remove(this.vrm.current.scene);
            if (this.state.modules.VRMUtils) {
                this.state.modules.VRMUtils.deepDispose(this.vrm.current.scene);
            }
            this.vrm.current = null;
        }
        
        // Remove fallback
        if (this.vrm.fallback) {
            this.three.scene.remove(this.vrm.fallback);
            this.vrm.fallback = null;
        }
        
        // Reload
        this.loadVRM();
    }
    
    destroy() {
        console.log('🧹 Destroying AIRI-style VRM controller...');
        
        // Stop animations
        this.animation.isWaving = false;
        this.animation.isTalking = false;
        this.animation.isNodding = false;
        this.animation.isThinking = false;
        this.animation.isExcited = false;
        
        // Dispose VRM
        if (this.vrm.current) {
            this.three.scene.remove(this.vrm.current.scene);
            if (this.state.modules.VRMUtils) {
                this.state.modules.VRMUtils.deepDispose(this.vrm.current.scene);
            }
        }
        
        // Dispose fallback
        if (this.vrm.fallback) {
            this.three.scene.remove(this.vrm.fallback);
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
        this.vrm.fallback = null;
        this.three.scene = null;
        this.three.camera = null;
        this.three.renderer = null;
        this.three.clock = null;
        this.three.lights = [];
        
        // Remove event listeners
        this.removeAllListeners();
        
        this.state.initialized = false;
        this.emit('destroyed');
    }
}
