// web/js/VRMController.js
// Complete VRM Controller with Three.js scene management and all animation methods

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
            currentMood: 'neutral'
        };
        
        this.config = {
            paths: [
                '/assets/avatar/solmate.vrm',
                'https://raw.githubusercontent.com/DirkDigglerTown/solmate/main/web/assets/avatar/solmate.vrm'
            ],
            fallbackEnabled: true,
            // Camera positioned for full body view
            cameraPosition: { x: 0, y: 1.6, z: 3.5 },
            lookAtPosition: { x: 0, y: 1.4, z: 0 },
            modelPosition: { x: 0, y: 0, z: 0 }
        };
        
        this.loadedPath = null;
    }
    
    async init() {
        if (this.state.initialized) {
            console.warn('VRMController already initialized');
            return;
        }
        
        try {
            this.emit('init:start');
            
            // Load Three.js and VRM modules
            await this.loadModules();
            
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
    
    async loadModules() {
        // Check if modules already exist
        if (window.THREE && window.VRMLoaderPlugin) {
            return;
        }
        
        // Load Three.js
        if (!window.THREE) {
            await this.loadScript('https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.min.js');
        }
        
        // Load GLTFLoader
        if (!window.GLTFLoader) {
            await this.loadScript('https://cdn.jsdelivr.net/npm/three@0.169.0/examples/js/loaders/GLTFLoader.js');
        }
        
        // Load VRM
        if (!window.VRMLoaderPlugin) {
            await this.loadScript('https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.0.0/lib/three-vrm.min.js');
        }
        
        // Wait for all modules to be available
        let attempts = 0;
        while ((!window.THREE || !window.GLTFLoader || !window.VRMLoaderPlugin) && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        if (!window.THREE || !window.GLTFLoader || !window.VRMLoaderPlugin) {
            throw new Error('Failed to load required modules');
        }
    }
    
    loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
    
    async initializeScene() {
        const THREE = window.THREE;
        
        // Create scene
        this.three.scene = new THREE.Scene();
        this.three.scene.background = new THREE.Color(0x0a0e17);
        
        // Create camera
        this.three.camera = new THREE.PerspectiveCamera(
            45, // FOV
            window.innerWidth / window.innerHeight,
            0.1,
            50
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
        this.three.renderer.toneMappingExposure = 1.2;
        
        // Add lights
        this.setupLighting();
        
        // Create clock
        this.three.clock = new THREE.Clock();
        
        // Handle window resize
        window.addEventListener('resize', () => this.handleResize());
        
        this.emit('scene:created');
        console.log('✅ VRMController: Three.js scene initialized');
    }
    
    setupLighting() {
        const THREE = window.THREE;
        
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.three.scene.add(ambientLight);
        this.three.lights.push(ambientLight);
        
        // Main directional light
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
        directionalLight.position.set(2, 4, 2);
        directionalLight.castShadow = true;
        directionalLight.shadow.camera.top = 2;
        directionalLight.shadow.camera.bottom = -2;
        directionalLight.shadow.camera.left = -2;
        directionalLight.shadow.camera.right = 2;
        directionalLight.shadow.mapSize.set(2048, 2048);
        this.three.scene.add(directionalLight);
        this.three.lights.push(directionalLight);
        
        // Fill light
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
        fillLight.position.set(-2, 2, -2);
        this.three.scene.add(fillLight);
        this.three.lights.push(fillLight);
        
        // Rim light
        const rimLight = new THREE.DirectionalLight(0x00f0ff, 0.3);
        rimLight.position.set(0, 2, -4);
        this.three.scene.add(rimLight);
        this.three.lights.push(rimLight);
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
                    this.loadedPath = path;
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
        
        // Setup humanoid pose
        if (vrm.humanoid) {
            this.setupHumanoidPose(vrm.humanoid);
        }
        
        // Setup look-at
        if (vrm.lookAt) {
            vrm.lookAt.target = this.three.camera;
        }
        
        // Setup expressions
        if (vrm.expressionManager) {
            this.setupExpressions(vrm.expressionManager);
        }
        
        console.log('✅ VRM setup complete');
        this.emit('vrm:setup', vrm);
        
        // Welcome animation after a short delay
        setTimeout(() => {
            this.playWelcomeSequence();
        }, 1000);
    }
    
    setupHumanoidPose(humanoid) {
        // Set natural T-pose to rest position
        const leftUpperArm = humanoid.getNormalizedBoneNode('leftUpperArm');
        const rightUpperArm = humanoid.getNormalizedBoneNode('rightUpperArm');
        const leftLowerArm = humanoid.getNormalizedBoneNode('leftLowerArm');
        const rightLowerArm = humanoid.getNormalizedBoneNode('rightLowerArm');
        
        // Arms hanging naturally (70 degrees down from T-pose)
        if (leftUpperArm) leftUpperArm.rotation.z = 1.22; // 70 degrees
        if (rightUpperArm) rightUpperArm.rotation.z = -1.22; // 70 degrees
        
        // Slight bend in elbows
        if (leftLowerArm) leftLowerArm.rotation.z = 0.17; // 10 degrees
        if (rightLowerArm) rightLowerArm.rotation.z = -0.17; // 10 degrees
        
        // Natural spine position
        const spine = humanoid.getNormalizedBoneNode('spine');
        if (spine) spine.rotation.x = 0.02; // Slight forward lean
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
        const geometry = new THREE.CapsuleGeometry(0.3, 1.6, 4, 8);
        const material = new THREE.MeshLambertMaterial({ color: 0xff6b6b });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = 0.8;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        group.add(mesh);
        group.position.copy(this.config.modelPosition);
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
        this.loadedPath = 'fallback';
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
        console.log('✅ VRMController: Animation loop started');
    }
    
    updateAnimations(deltaTime) {
        if (!this.vrm.current || this.vrm.current.isFallback) return;
        
        const time = Date.now() / 1000;
        
        // Breathing animation
        this.animation.breathingPhase += deltaTime * 2;
        const breathIntensity = 1 + Math.sin(this.animation.breathingPhase) * 0.02;
        
        if (this.vrm.current.scene) {
            this.vrm.current.scene.scale.y = breathIntensity;
        }
        
        // Idle animations when not talking or waving
        if (!this.animation.isTalking && !this.animation.isWaving) {
            this.updateIdleAnimations(time, deltaTime);
        }
        
        // Talking animations
        if (this.animation.isTalking) {
            this.updateTalkingAnimations(time);
        }
        
        // Expression animations
        this.updateExpressions(deltaTime);
        
        // Blinking
        this.updateBlinking(deltaTime);
    }
    
    updateIdleAnimations(time, deltaTime) {
        if (!this.vrm.current.humanoid) return;
        
        // Subtle body sway
        this.animation.swayPhase += deltaTime * 0.3;
        if (this.vrm.current.scene) {
            this.vrm.current.scene.rotation.y = Math.PI + Math.sin(this.animation.swayPhase) * 0.01;
        }
        
        // Head movement
        const head = this.vrm.current.humanoid.getNormalizedBoneNode('head');
        if (head) {
            const idleX = Math.sin(time * 0.6) * 0.015;
            const idleY = Math.sin(time * 0.8) * 0.02;
            
            head.rotation.x = idleX + this.animation.headTarget.x * 0.3;
            head.rotation.y = idleY + this.animation.headTarget.y * 0.3;
        }
        
        // Occasional idle gestures
        this.animation.idleTimer += deltaTime;
        if (this.animation.idleTimer > 8 + Math.random() * 4) {
            this.performIdleGesture();
            this.animation.idleTimer = 0;
        }
    }
    
    updateTalkingAnimations(time) {
        if (!this.vrm.current.humanoid) return;
        
        const talkTime = time * 2;
        
        // Head movement during speech
        const head = this.vrm.current.humanoid.getNormalizedBoneNode('head');
        if (head) {
            head.rotation.x = Math.sin(talkTime * 1.2) * 0.025;
            head.rotation.y = Math.sin(talkTime) * 0.035;
            head.rotation.z = Math.sin(talkTime * 0.8) * 0.015;
        }
        
        // Arm gestures during speech
        const leftArm = this.vrm.current.humanoid.getNormalizedBoneNode('leftUpperArm');
        const rightArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightUpperArm');
        
        if (leftArm && rightArm) {
            const gestureIntensity = 0.1 + Math.sin(talkTime * 0.3) * 0.05;
            
            leftArm.rotation.z = 1.22 - gestureIntensity;
            rightArm.rotation.z = -1.22 + gestureIntensity;
        }
    }
    
    updateExpressions(deltaTime) {
        if (!this.vrm.current?.expressionManager) return;
        
        // Smooth expression transitions
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
        
        // Apply expression
        try {
            if (this.animation.currentExpression !== 'neutral') {
                this.vrm.current.expressionManager.setValue(
                    this.animation.currentExpression,
                    this.animation.expressionIntensity
                );
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
    
    performIdleGesture() {
        const gestures = [
            () => this.performHeadTilt(),
            () => this.performShoulderShrug(),
            () => this.setExpression('happy', 0.2, 2000)
        ];
        
        const gesture = gestures[Math.floor(Math.random() * gestures.length)];
        gesture();
    }
    
    performHeadTilt() {
        const head = this.vrm.current.humanoid?.getNormalizedBoneNode('head');
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
                head.rotation.z = originalRotation.z + tiltProgress * 0.1;
            }, 16);
        }
    }
    
    performShoulderShrug() {
        const leftShoulder = this.vrm.current.humanoid?.getNormalizedBoneNode('leftShoulder');
        const rightShoulder = this.vrm.current.humanoid?.getNormalizedBoneNode('rightShoulder');
        
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
    
    // Public API Methods
    
    playWave() {
        if (!this.vrm.current || this.animation.isWaving) return;
        
        this.animation.isWaving = true;
        console.log('🌊 Playing wave animation');
        
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
        
        if (!rightArm) {
            this.playFallbackWave();
            return;
        }
        
        let waveTime = 0;
        
        const waveInterval = setInterval(() => {
            waveTime += 0.016;
            
            if (waveTime >= 3) {
                // Return to rest position
                rightArm.rotation.z = -1.22;
                if (rightLowerArm) rightLowerArm.rotation.z = -0.17;
                
                this.animation.isWaving = false;
                clearInterval(waveInterval);
                return;
            }
            
            const waveIntensity = Math.sin(waveTime * Math.PI * 3);
            
            // Raise arm and wave
            rightArm.rotation.z = -0.8 - Math.abs(waveIntensity) * 0.3;
            rightArm.rotation.x = -0.4;
            
            if (rightLowerArm) {
                rightLowerArm.rotation.z = -0.6 - waveIntensity * 0.3;
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
                return;
            }
            
            if (this.vrm.current?.scene) {
                this.vrm.current.scene.rotation.z = Math.sin(waveTime * Math.PI * 3) * 0.1;
            }
        }, 16);
    }
    
    playNod() {
        const head = this.vrm.current?.humanoid?.getNormalizedBoneNode('head');
        if (!head) return;
        
        console.log('👍 Playing nod animation');
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
            head.rotation.x = originalRotation.x + nodProgress * 0.2;
        }, 16);
    }
    
    playThink() {
        console.log('🤔 Playing think animation');
        this.setExpression('sad', 0.3, 3000); // Thoughtful expression
        this.performHeadTilt();
    }
    
    playExcited() {
        console.log('🎉 Playing excited animation');
        this.setExpression('happy', 0.8, 4000);
        
        // Quick shoulder movement
        if (this.vrm.current?.humanoid) {
            this.performShoulderShrug();
        }
    }
    
    setExpression(expression, intensity = 0.5, duration = 1000) {
        this.animation.targetExpression = expression;
        this.animation.targetIntensity = intensity;
        
        console.log(`😊 Setting expression: ${expression} (${intensity})`);
        
        if (duration) {
            setTimeout(() => {
                this.animation.targetExpression = 'neutral';
                this.animation.targetIntensity = 0;
            }, duration);
        }
    }
    
    setMood(mood) {
        this.animation.currentMood = mood;
        console.log(`🎭 Setting mood: ${mood}`);
        
        switch (mood) {
            case 'happy':
                this.setExpression('happy', 0.4);
                break;
            case 'sad':
                this.setExpression('sad', 0.4);
                break;
            case 'excited':
                this.setExpression('happy', 0.7);
                this.playExcited();
                break;
            case 'thinking':
                this.setExpression('sad', 0.2);
                break;
            default:
                this.setExpression('neutral', 0);
        }
    }
    
    startSpeechAnimation(text) {
        this.animation.isTalking = true;
        console.log('🗣️ Starting speech animation');
        
        // Analyze text for appropriate expression
        const lowerText = text.toLowerCase();
        
        if (lowerText.includes('happy') || lowerText.includes('great')) {
            this.setExpression('happy', 0.4);
        } else if (lowerText.includes('sorry') || lowerText.includes('unfortunately')) {
            this.setExpression('sad', 0.3);
        } else if (lowerText.includes('wow') || lowerText.includes('amazing')) {
            this.setExpression('surprised', 0.4);
        } else {
            this.setExpression('happy', 0.2);
        }
    }
    
    stopSpeechAnimation() {
        this.animation.isTalking = false;
        console.log('🔇 Stopping speech animation');
        
        // Return to neutral expression
        setTimeout(() => {
            this.setExpression('neutral', 0);
        }, 500);
    }
    
    updateHeadTarget(x, y) {
        this.animation.headTarget.x = x * 0.1;
        this.animation.headTarget.y = y * 0.1;
    }
    
    playWelcomeSequence() {
        console.log('👋 Playing welcome sequence');
        
        setTimeout(() => this.playWave(), 500);
        setTimeout(() => this.setExpression('happy', 0.5, 2000), 4000);
        setTimeout(() => this.playNod(), 5500);
    }
    
    // Utility methods
    
    isLoaded() {
        return this.state.loaded;
    }
    
    getLoadedPath() {
        return this.loadedPath;
    }
    
    handleResize() {
        if (!this.three.camera || !this.three.renderer) return;
        
        this.three.camera.aspect = window.innerWidth / window.innerHeight;
        this.three.camera.updateProjectionMatrix();
        this.three.renderer.setSize(window.innerWidth, window.innerHeight);
        
        this.emit('resize');
    }
    
    reload() {
        console.log('🔄 Reloading VRM...');
        this.state.loaded = false;
        this.state.loading = false;
        this.loadedPath = null;
        
        if (this.vrm.current) {
            this.three.scene.remove(this.vrm.current.scene);
            this.vrm.current = null;
        }
        
        return this.loadVRM().then(() => {
            console.log('✅ VRM reloaded successfully');
            return 'VRM reloaded successfully';
        }).catch(error => {
            console.error('❌ VRM reload failed:', error);
            return 'VRM reload failed: ' + error.message;
        });
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
        console.log('🧹 VRMController destroyed');
    }
}
