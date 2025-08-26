// web/js/VRMController.js
// Fixed VRM controller with proper module loading and camera positioning

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
            expressionTimer: 0,
            currentExpression: 'neutral',
            expressionIntensity: 0
        };
        
        this.config = {
            paths: [
                '/assets/avatar/solmate.vrm',
                'https://raw.githubusercontent.com/DirkDigglerTown/solmate/main/web/assets/avatar/solmate.vrm'
            ],
            // FIXED: Better camera positioning for full avatar visibility
            camera: {
                position: { x: 0, y: 1.2, z: 3.5 },  // Moved back and up slightly
                lookAt: { x: 0, y: 1.0, z: 0 },      // Look at chest level
                fov: 45,                               // Wider field of view
                near: 0.1,
                far: 100
            },
            // FIXED: Proper model positioning
            model: {
                position: { x: 0, y: 0, z: 0 },      // Center the model
                rotation: { x: 0, y: Math.PI, z: 0 }, // Face camera
                scale: { x: 1, y: 1, z: 1 }           // Normal scale
            },
            fallbackEnabled: true,
            animationsEnabled: true,
            expressionsEnabled: true
        };
    }
    
    async init() {
        if (this.state.initialized) {
            console.warn('VRMController already initialized');
            return;
        }
        
        try {
            this.emit('init:start');
            console.log('🎭 Initializing VRM system...');
            
            // FIXED: Better module loading with error handling
            await this.loadModules();
            
            // Initialize Three.js scene
            await this.initializeScene();
            
            // Load VRM model
            await this.loadVRM();
            
            // Start animation loop
            this.startAnimationLoop();
            
            this.state.initialized = true;
            this.emit('init:complete');
            console.log('✅ VRM system initialized successfully');
            
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
        console.log('📦 Loading VRM modules...');
        
        try {
            // FIXED: Use dynamic imports with proper error handling
            const [
                THREE_MODULE,
                GLTF_MODULE, 
                VRM_MODULE
            ] = await Promise.all([
                import('https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js'),
                import('https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/loaders/GLTFLoader.js'),
                import('https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.0.0/lib/three-vrm.module.js')
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
        
        // Create scene with proper background
        this.three.scene = new THREE.Scene();
        this.three.scene.background = new THREE.Color(0x0a0e17);
        
        // FIXED: Create camera with proper positioning for full avatar view
        this.three.camera = new THREE.PerspectiveCamera(
            this.config.camera.fov,
            window.innerWidth / window.innerHeight,
            this.config.camera.near,
            this.config.camera.far
        );
        
        // Set camera position to see full avatar
        this.three.camera.position.set(
            this.config.camera.position.x,
            this.config.camera.position.y,
            this.config.camera.position.z
        );
        
        // Look at the avatar's chest level
        this.three.camera.lookAt(
            this.config.camera.lookAt.x,
            this.config.camera.lookAt.y,
            this.config.camera.lookAt.z
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
        
        // FIXED: Proper renderer setup
        this.three.renderer.setSize(window.innerWidth, window.innerHeight);
        this.three.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.three.renderer.shadowMap.enabled = true;
        this.three.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.three.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.three.renderer.toneMappingExposure = 1.2;
        this.three.renderer.outputColorSpace = THREE.SRGBColorSpace;
        
        // Setup lighting for avatar visibility
        this.setupLighting();
        
        // Create animation clock
        this.three.clock = new THREE.Clock();
        
        // Handle window resize
        window.addEventListener('resize', () => this.handleResize());
        
        console.log('✅ Three.js scene initialized');
        this.emit('scene:created');
    }
    
    setupLighting() {
        const THREE = this.state.modules.THREE;
        
        // Clear existing lights
        this.three.lights.forEach(light => {
            this.three.scene.remove(light);
        });
        this.three.lights = [];
        
        // FIXED: Better lighting setup for avatar visibility
        
        // Main key light (from front-right)
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
        
        console.log('✅ Lighting setup complete');
    }
    
    async loadVRM() {
        if (this.state.loading) {
            console.warn('VRM already loading');
            return;
        }
        
        this.state.loading = true;
        this.emit('load:start');
        console.log('🤖 Loading VRM model...');
        
        try {
            const GLTFLoader = this.state.modules.GLTFLoader;
            const VRMLoaderPlugin = this.state.modules.VRMLoaderPlugin;
            
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
                        console.log(`✅ VRM loaded successfully from: ${path}`);
                        break;
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
        console.log('⚙️ Setting up VRM...');
        
        // Remove existing VRM if any
        if (this.vrm.current) {
            this.three.scene.remove(this.vrm.current.scene);
            if (this.state.modules.VRMUtils) {
                this.state.modules.VRMUtils.deepDispose(this.vrm.current.scene);
            }
        }
        
        // Store VRM reference
        this.vrm.current = vrm;
        
        // FIXED: Proper model positioning and rotation
        vrm.scene.position.set(
            this.config.model.position.x,
            this.config.model.position.y,
            this.config.model.position.z
        );
        
        vrm.scene.rotation.set(
            this.config.model.rotation.x,
            this.config.model.rotation.y,
            this.config.model.rotation.z
        );
        
        vrm.scene.scale.set(
            this.config.model.scale.x,
            this.config.model.scale.y,
            this.config.model.scale.z
        );
        
        // Add to scene
        this.three.scene.add(vrm.scene);
        
        // Setup VRM systems
        if (vrm.humanoid) {
            this.setupHumanoidPose(vrm.humanoid);
        }
        
        if (vrm.lookAt) {
            vrm.lookAt.target = this.three.camera;
        }
        
        if (vrm.expressionManager && this.config.expressionsEnabled) {
            this.setupExpressions(vrm.expressionManager);
        }
        
        // Test camera framing
        this.adjustCameraForAvatar();
        
        console.log('✅ VRM setup complete');
        this.emit('vrm:setup', vrm);
    }
    
    setupHumanoidPose(humanoid) {
        // Set natural standing pose
        try {
            // Center hips
            const hips = humanoid.getNormalizedBoneNode('hips');
            if (hips) {
                hips.position.set(0, 0, 0);
                hips.rotation.set(0, 0, 0);
            }
            
            // Natural arm positions (slightly lowered from T-pose)
            const leftUpperArm = humanoid.getNormalizedBoneNode('leftUpperArm');
            const rightUpperArm = humanoid.getNormalizedBoneNode('rightUpperArm');
            const leftLowerArm = humanoid.getNormalizedBoneNode('leftLowerArm');
            const rightLowerArm = humanoid.getNormalizedBoneNode('rightLowerArm');
            
            if (leftUpperArm) {
                leftUpperArm.rotation.set(0, 0, 0.3); // 17 degrees down
            }
            if (rightUpperArm) {
                rightUpperArm.rotation.set(0, 0, -0.3); // 17 degrees down
            }
            if (leftLowerArm) {
                leftLowerArm.rotation.set(0, 0, 0.2); // Slight bend
            }
            if (rightLowerArm) {
                rightLowerArm.rotation.set(0, 0, -0.2); // Slight bend
            }
            
            // Relax spine and head
            const spine = humanoid.getNormalizedBoneNode('spine');
            const neck = humanoid.getNormalizedBoneNode('neck');
            const head = humanoid.getNormalizedBoneNode('head');
            
            if (spine) {
                spine.rotation.set(0, 0, 0);
            }
            if (neck) {
                neck.rotation.set(0, 0, 0);
            }
            if (head) {
                head.rotation.set(0, 0, 0);
            }
            
            console.log('✅ Humanoid pose configured');
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
    
    adjustCameraForAvatar() {
        // FIXED: Ensure camera can see the full avatar
        if (!this.vrm.current) return;
        
        const bbox = new (this.state.modules.THREE.Box3)().setFromObject(this.vrm.current.scene);
        const center = bbox.getCenter(new (this.state.modules.THREE.Vector3)());
        const size = bbox.getSize(new (this.state.modules.THREE.Vector3)());
        
        console.log('Avatar bounds:', {
            center: center.toArray(),
            size: size.toArray(),
            min: bbox.min.toArray(),
            max: bbox.max.toArray()
        });
        
        // Adjust camera position if needed
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this.three.camera.fov * (Math.PI / 180);
        const cameraDistance = Math.abs(maxDim / 2 / Math.tan(fov / 2));
        
        // Position camera to see full avatar with some padding
        const targetDistance = cameraDistance * 1.5;
        
        console.log('Camera adjustment:', {
            avatarHeight: size.y,
            recommendedDistance: targetDistance,
            currentDistance: this.three.camera.position.z
        });
        
        // Only adjust if current position seems wrong
        if (this.three.camera.position.z < targetDistance * 0.8) {
            this.three.camera.position.z = targetDistance;
            this.three.camera.lookAt(center);
            console.log('📹 Camera position adjusted for better avatar framing');
        }
    }
    
    createFallbackAvatar() {
        console.log('🔧 Creating fallback avatar...');
        
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
        
        // Arms
        const armGeometry = new THREE.CapsuleGeometry(0.1, 0.8, 4, 8);
        const armMaterial = new THREE.MeshLambertMaterial({ color: 0x4a90e2 });
        
        const leftArm = new THREE.Mesh(armGeometry, armMaterial);
        leftArm.position.set(-0.5, 0.8, 0);
        leftArm.rotation.z = 0.3;
        group.add(leftArm);
        
        const rightArm = new THREE.Mesh(armGeometry, armMaterial);
        rightArm.position.set(0.5, 0.8, 0);
        rightArm.rotation.z = -0.3;
        group.add(rightArm);
        
        // Position fallback avatar
        group.position.set(
            this.config.model.position.x,
            this.config.model.position.y,
            this.config.model.position.z
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
        console.log('✅ Fallback avatar created');
    }
    
    startAnimationLoop() {
        console.log('🔄 Starting animation loop...');
        
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
            
            // Apply custom animations
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
        
        // Breathing animation
        this.animation.breathingPhase += deltaTime * 2;
        const breathe = 1 + Math.sin(this.animation.breathingPhase) * 0.02;
        
        if (this.vrm.current.scene) {
            this.vrm.current.scene.scale.y = breathe;
        }
        
        // Idle sway
        this.animation.idlePhase += deltaTime * 0.5;
        if (!this.animation.isTalking && !this.animation.isWaving) {
            if (this.vrm.current.scene) {
                this.vrm.current.scene.rotation.y = Math.PI + Math.sin(this.animation.idlePhase) * 0.02;
            }
        }
        
        // Head tracking
        if (this.vrm.current.humanoid && !this.vrm.current.isFallback) {
            const head = this.vrm.current.humanoid.getNormalizedBoneNode('head');
            if (head && !this.animation.isTalking) {
                head.rotation.x = this.animation.headTarget.x * 0.3;
                head.rotation.y = this.animation.headTarget.y * 0.3;
            }
        }
        
        // Blinking
        this.animation.blinkTimer += deltaTime;
        if (this.animation.blinkTimer > 3 + Math.random() * 2) {
            this.blink();
            this.animation.blinkTimer = 0;
        }
        
        // Expression updates
        this.updateExpressions(deltaTime);
    }
    
    updateExpressions(deltaTime) {
        if (!this.vrm.current?.expressionManager) return;
        
        // Handle current expression
        if (this.animation.currentExpression !== 'neutral') {
            this.animation.expressionTimer += deltaTime;
            
            // Auto-return to neutral after some time
            if (this.animation.expressionTimer > 3) {
                this.setExpression('neutral', 0);
            }
        }
    }
    
    // ANIMATION METHODS
    
    playWave() {
        if (!this.vrm.current || this.animation.isWaving) return;
        
        console.log('🌊 Playing wave animation');
        this.animation.isWaving = true;
        this.emit('animation:wave:start');
        
        if (this.vrm.current.humanoid && !this.vrm.current.isFallback) {
            this.playHumanoidWave();
        } else {
            this.playFallbackWave();
        }
    }
    
    playHumanoidWave() {
        const rightArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightUpperArm');
        const rightLowerArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightLowerArm');
        
        if (!rightArm) {
            this.playFallbackWave();
            return;
        }
        
        let waveTime = 0;
        const originalRotation = rightArm.rotation.clone();
        const originalLowerRotation = rightLowerArm ? rightLowerArm.rotation.clone() : null;
        
        const waveInterval = setInterval(() => {
            waveTime += 0.016;
            
            if (waveTime >= 3) {
                rightArm.rotation.copy(originalRotation);
                if (rightLowerArm && originalLowerRotation) {
                    rightLowerArm.rotation.copy(originalLowerRotation);
                }
                
                this.animation.isWaving = false;
                this.emit('animation:wave:end');
                clearInterval(waveInterval);
                return;
            }
            
            // Wave motion
            const waveIntensity = Math.sin(waveTime * Math.PI * 3);
            rightArm.rotation.z = -0.8 + waveIntensity * 0.3;
            rightArm.rotation.x = -0.3;
            
            if (rightLowerArm) {
                rightLowerArm.rotation.z = -0.5 + Math.abs(waveIntensity) * 0.4;
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
        console.log('🗣️ Starting speech animation');
        this.animation.isTalking = true;
        this.setExpression('happy', 0.3);
        this.emit('animation:speech:start');
    }
    
    stopSpeechAnimation() {
        console.log('🔇 Stopping speech animation');
        this.animation.isTalking = false;
        this.setExpression('neutral', 0);
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
        console.log('🔄 Reloading VRM...');
        
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
        console.log('🧹 Destroying VRM controller...');
        
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
