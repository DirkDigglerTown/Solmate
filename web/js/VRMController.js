// web/js/VRMController.js
// VRM avatar controller with AIRI-inspired natural animations
// CRITICAL: Arms rest at 70-degree angle (1.22 radians), NOT T-pose!

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
                leftUpper: { x: 0, y: 0, z: 1.22 },  // 70 degrees
                leftLower: { x: 0, y: 0, z: 0.3 },
                rightUpper: { x: 0, y: 0, z: 1.22 }, // 70 degrees
                rightLower: { x: 0, y: 0, z: 0.3 }
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
            
            // Start animation loop
            this.animate();
            
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
        // Change background to a lighter color to see dark models
        this.three.scene.background = new THREE.Color(0x1a2332); // Slightly lighter blue-gray
        
        // Optional: Add fog for depth
        this.three.scene.fog = new THREE.Fog(0x1a2332, 5, 15);
        
        // Create camera - CONFIRMED WORKING POSITION FROM PREVIOUS CHAT
        this.three.camera = new THREE.PerspectiveCamera(
            30,  // FOV
            window.innerWidth / window.innerHeight,
            0.1,
            20
        );
        // THESE VALUES WERE CONFIRMED PERFECT IN PREVIOUS CHAT!
        this.three.camera.position.set(0, 4.0, 5.0); // Camera at eye level with model
        this.three.camera.lookAt(0, 4.0, 0); // Look straight ahead at model center
        
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
        this.three.renderer.toneMappingExposure = 1.2; // Slightly brighter
        
        // Ensure canvas is visible
        canvas.style.display = 'block';
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        
        // Add lights - ENHANCED LIGHTING FOR BETTER VISIBILITY
        const directionalLight = new THREE.DirectionalLight(0xffffff, 2.0); // Increased intensity
        directionalLight.position.set(1, 2, 2);
        directionalLight.castShadow = false; // Disable shadows for performance
        this.three.scene.add(directionalLight);
        
        // Add fill light from the opposite side
        const fillLight = new THREE.DirectionalLight(0x88aaff, 0.8);
        fillLight.position.set(-1, 1, -1);
        this.three.scene.add(fillLight);
        
        // Ambient light for overall brightness
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7); // Increased intensity
        this.three.scene.add(ambientLight);
        
        // Add a point light near the face for better visibility
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
                        // Setup VRM
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
        
        // Position model at the CONFIRMED WORKING HEIGHT
        vrm.scene.position.set(0, 4.0, 0); // Model at y=4.0 - this was confirmed perfect!
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
        
        // DO NOT auto-adjust camera - use the confirmed working values
        console.log(`📷 Camera using confirmed values:
            Position: (0, 4.0, 5.0)
            Looking at: (0, 4.0, 0)`);
        
        // Ensure camera stays at the working position
        if (this.three.camera) {
            this.three.camera.position.set(0, 4.0, 5.0);
            this.three.camera.lookAt(0, 4.0, 0);
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
        
        // CRITICAL: Set arms to natural rest position (70 degrees down)
        // This matches AIRI's natural human-like pose
        
        const leftUpperArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
        const leftLowerArm = vrm.humanoid.getNormalizedBoneNode('leftLowerArm');
        const rightUpperArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
        const rightLowerArm = vrm.humanoid.getNormalizedBoneNode('rightLowerArm');
        
        if (leftUpperArm) {
            leftUpperArm.rotation.z = 1.22; // 70 degrees
        }
        if (leftLowerArm) {
            leftLowerArm.rotation.z = 0.3; // Slight bend
        }
        if (rightUpperArm) {
            rightUpperArm.rotation.z = 1.22; // 70 degrees
        }
        if (rightLowerArm) {
            rightLowerArm.rotation.z = 0.3; // Slight bend
        }
        
        // Save rest positions for returning after animations
        this.animation.armRestPosition = {
            leftUpper: leftUpperArm ? leftUpperArm.rotation.clone() : null,
            leftLower: leftLowerArm ? leftLowerArm.rotation.clone() : null,
            rightUpper: rightUpperArm ? rightUpperArm.rotation.clone() : null,
            rightLower: rightLowerArm ? rightLowerArm.rotation.clone() : null
        };
        
        console.log('✅ Natural rest pose set - arms at 70 degrees');
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
        if (!this.state.initialized) return;
        
        requestAnimationFrame(() => this.animate());
        
        const deltaTime = this.three.clock.getDelta();
        const elapsedTime = this.three.clock.getElapsedTime();
        
        // Debug: Log every 60 frames to confirm animation is running
        if (Math.floor(elapsedTime * 60) % 60 === 0) {
            console.log('🎬 Animation frame:', Math.floor(elapsedTime), 'sec');
        }
        
        // Update VRM
        if (this.three.vrm) {
            this.three.vrm.update(deltaTime);
            
            // Apply animations
            this.updateBreathing(elapsedTime);
            this.updateBlink(elapsedTime);
            this.updateHeadMovement(deltaTime);
            this.updateGestures(deltaTime);
            
            // Update current animation if playing
            if (this.animation.currentGesture) {
                this.updateCurrentGesture(deltaTime);
            }
        }
        
        // Render scene - THIS IS CRITICAL!
        if (this.three.renderer && this.three.scene && this.three.camera) {
            this.three.renderer.render(this.three.scene, this.three.camera);
        } else {
            console.error('❌ Missing renderer, scene, or camera!');
        }
    }
    
    updateBreathing(time) {
        if (!this.three.vrm || !this.three.vrm.humanoid) return;
        
        // Natural breathing animation
        const breathingIntensity = 0.025; // 2.5% scale variation
        const breathingSpeed = this.config.breathingSpeed;
        
        const chest = this.three.vrm.humanoid.getNormalizedBoneNode('chest');
        if (chest) {
            const breathScale = 1 + Math.sin(time * breathingSpeed) * breathingIntensity;
            chest.scale.set(1, breathScale, 1);
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
        if (!head) return;
        
        // Smooth head movement towards target
        const lerpSpeed = 3.0;
        head.rotation.x += (this.animation.headTarget.x - head.rotation.x) * lerpSpeed * deltaTime;
        head.rotation.y += (this.animation.headTarget.y - head.rotation.y) * lerpSpeed * deltaTime;
        
        // Add subtle idle movement
        if (!this.state.isTalking && !this.state.isAnimating) {
            const time = this.three.clock.getElapsedTime();
            head.rotation.x += Math.sin(time * 0.8) * 0.01;
            head.rotation.y += Math.sin(time * 0.6) * 0.015;
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
        
        console.log('👋 Playing natural wave animation');
        this.state.isAnimating = true;
        
        const rightUpperArm = this.three.vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
        const rightLowerArm = this.three.vrm.humanoid.getNormalizedBoneNode('rightLowerArm');
        const rightHand = this.three.vrm.humanoid.getNormalizedBoneNode('rightHand');
        
        if (!rightUpperArm) {
            this.state.isAnimating = false;
            return;
        }
        
        // Multi-phase wave animation
        this.animation.currentGesture = {
            type: 'wave',
            duration: 2.5,
            elapsed: 0,
            update: (progress) => {
                if (progress < 0.3) {
                    // Raise arm
                    const p = progress / 0.3;
                    rightUpperArm.rotation.z = 1.22 - (1.22 + 0.5) * p;
                    rightUpperArm.rotation.x = -0.8 * p;
                    if (rightLowerArm) {
                        rightLowerArm.rotation.z = 0.3 - 0.5 * p;
                    }
                } else if (progress < 0.8) {
                    // Wave motion
                    const p = (progress - 0.3) / 0.5;
                    const waveIntensity = Math.sin(p * Math.PI * 4);
                    if (rightHand) {
                        rightHand.rotation.z = waveIntensity * 0.5;
                    }
                    if (rightLowerArm) {
                        rightLowerArm.rotation.z = -0.2 + waveIntensity * 0.3;
                    }
                } else {
                    // Return to rest
                    const p = (progress - 0.8) / 0.2;
                    rightUpperArm.rotation.z = -0.5 + (1.22 + 0.5) * p;
                    rightUpperArm.rotation.x = -0.8 * (1 - p);
                    if (rightLowerArm) {
                        rightLowerArm.rotation.z = -0.2 + 0.5 * p;
                    }
                    if (rightHand) {
                        rightHand.rotation.z = 0;
                    }
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
                    // Try blink as fallback
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
            leftUpperArm.rotation.copy(this.animation.armRestPosition.leftUpper);
        }
        if (leftLowerArm && this.animation.armRestPosition.leftLower) {
            leftLowerArm.rotation.copy(this.animation.armRestPosition.leftLower);
        }
        if (rightUpperArm && this.animation.armRestPosition.rightUpper) {
            rightUpperArm.rotation.copy(this.animation.armRestPosition.rightUpper);
        }
        if (rightLowerArm && this.animation.armRestPosition.rightLower) {
            rightLowerArm.rotation.copy(this.animation.armRestPosition.rightLower);
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
        
        // 10-second welcome sequence
        setTimeout(() => this.performNod(), 1000);
        setTimeout(() => this.playWave(), 3000);
        setTimeout(() => this.performWink(), 6000);
        setTimeout(() => this.setExpression('happy', 0.5, 2000), 8000);
        setTimeout(() => {
            this.setExpression('neutral', 0, 1000);
            this.returnToRestPose();
        }, 10000);
        
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
    
    debugCameraPosition() {
        if (!this.three.vrm || !this.three.camera) {
            console.log('No VRM or camera loaded');
            return;
        }
        
        // Get Three.js reference
        const Three = window.THREE;
        if (!Three) {
            console.log('THREE.js not available in global scope');
            return;
        }
        
        // Get VRM bounds
        const box = new Three.Box3().setFromObject(this.three.vrm.scene);
        const center = box.getCenter(new Three.Vector3());
        const size = box.getSize(new Three.Vector3());
        
        console.log('🎥 Camera Debug Info:');
        console.log('VRM Position:', this.three.vrm.scene.position);
        console.log('VRM Bounds:', { center, size });
        console.log('VRM Height:', size.y);
        console.log('Camera Position:', this.three.camera.position);
        console.log('Camera FOV:', this.three.camera.fov);
        
        return { center, size, cameraPos: this.three.camera.position };
    }
    
    adjustCamera(x = 0, y = 1.4, z = 3.0, lookY = 1.2) {
        if (!this.three.camera) return;
        
        this.three.camera.position.set(x, y, z);
        this.three.camera.lookAt(0, lookY, 0);
        
        console.log(`Camera adjusted to: pos(${x}, ${y}, ${z}) looking at (0, ${lookY}, 0)`);
    }
    
    // Debug method to check rendering
    debugVisibility() {
        if (!this.three.vrm || !this.three.scene) {
            console.log('No VRM or scene loaded');
            return;
        }
        
        console.log('🔍 Visibility Debug:');
        console.log('Canvas element:', document.getElementById('vrmCanvas'));
        console.log('Canvas size:', {
            width: this.three.renderer?.domElement.width,
            height: this.three.renderer?.domElement.height
        });
        console.log('Renderer size:', this.three.renderer?.getSize(new (window.THREE?.Vector2 || Object)()));
        console.log('Scene children:', this.three.scene.children.length);
        console.log('VRM visible:', this.three.vrm.scene.visible);
        console.log('Scene background:', this.three.scene.background);
        
        // Check if canvas is actually visible on page
        const canvas = document.getElementById('vrmCanvas');
        if (canvas) {
            const rect = canvas.getBoundingClientRect();
            console.log('Canvas position on page:', rect);
            console.log('Canvas computed style:', {
                display: getComputedStyle(canvas).display,
                visibility: getComputedStyle(canvas).visibility,
                opacity: getComputedStyle(canvas).opacity,
                zIndex: getComputedStyle(canvas).zIndex
            });
        }
        
        // Try to make VRM more visible
        if (this.three.vrm?.scene) {
            // Check materials
            this.three.vrm.scene.traverse((child) => {
                if (child.isMesh) {
                    console.log('Mesh found:', child.name, 'visible:', child.visible);
                    if (child.material) {
                        console.log('Material:', child.material.type, 'opacity:', child.material.opacity);
                    }
                }
            });
        }
    }
    
    // Debug method to force render and check scene
    debugRender() {
        console.log('🔍 Debug Render Check:');
        
        if (!this.three.renderer) {
            console.error('❌ No renderer!');
            return;
        }
        
        if (!this.three.scene) {
            console.error('❌ No scene!');
            return;
        }
        
        if (!this.three.camera) {
            console.error('❌ No camera!');
            return;
        }
        
        if (!this.three.vrm) {
            console.error('❌ No VRM!');
            return;
        }
        
        console.log('✅ All components present');
        console.log('Scene children:', this.three.scene.children.length);
        console.log('VRM visible:', this.three.vrm.scene.visible);
        console.log('Canvas size:', {
            width: this.three.renderer.domElement.width,
            height: this.three.renderer.domElement.height
        });
        
        // Force a render
        console.log('Forcing render...');
        this.three.renderer.render(this.three.scene, this.three.camera);
        
        // Check if anything was drawn
        const gl = this.three.renderer.getContext();
        const pixels = new Uint8Array(4);
        gl.readPixels(
            Math.floor(gl.canvas.width / 2),
            Math.floor(gl.canvas.height / 2),
            1, 1,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            pixels
        );
        console.log('Center pixel color:', pixels);
        
        // Try adding a test cube to see if anything renders
        this.addTestCube();
    }
    
    // Add a bright test cube to verify rendering works
    addTestCube() {
        import('three').then(THREE => {
            const geometry = new THREE.BoxGeometry(1, 1, 1);
            const material = new THREE.MeshBasicMaterial({ color: 0xff00ff });
            const cube = new THREE.Mesh(geometry, material);
            cube.position.set(0, 4.0, 0); // Same position as avatar
            cube.name = 'testCube';
            
            // Remove old test cube if exists
            const oldCube = this.three.scene.getObjectByName('testCube');
            if (oldCube) {
                this.three.scene.remove(oldCube);
                console.log('Removed old test cube');
            } else {
                this.three.scene.add(cube);
                console.log('Added bright pink test cube at avatar position');
            }
            
            // Force render
            this.three.renderer.render(this.three.scene, this.three.camera);
        });
    }
    
    // Method to cycle backgrounds for testing
    cycleBackground() {
        if (!this.three.scene) return;
        
        const colors = [
            0x1a2332, // Dark blue-gray
            0x2a3342, // Medium blue-gray  
            0x3a4352, // Lighter blue-gray
            0x4a5362, // Even lighter
            0x888888, // Medium gray
            0xaaaaaa  // Light gray
        ];
        
        const currentColor = this.three.scene.background.getHex();
        const currentIndex = colors.indexOf(currentColor);
        const nextIndex = (currentIndex + 1) % colors.length;
        
        this.three.scene.background = new (window.THREE.Color)(colors[nextIndex]);
        console.log(`Background changed to: #${colors[nextIndex].toString(16).padStart(6, '0')}`);
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
            // VRMUtils.deepDispose would be called here if imported
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
