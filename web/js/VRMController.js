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
        this.three.scene.background = new THREE.Color(0x0a0e17);
        
        // Create camera - AIRI-STYLE CLOSER FRAMING
        // AIRI typically uses FOV 20-25 for more intimate framing
        this.three.camera = new THREE.PerspectiveCamera(
            20,  // Lower FOV for less distortion and closer feel (was 35)
            window.innerWidth / window.innerHeight,
            0.1,
            20
        );
        // Closer position for upper body/bust shot like AIRI
        this.three.camera.position.set(0, 1.5, 2.5); // Much closer, chest-level view
        this.three.camera.lookAt(0, 1.3, 0); // Look at chest/neck area
        
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
        
        // Add lights
        const directionalLight = new THREE.DirectionalLight(0xffffff, Math.PI);
        directionalLight.position.set(1, 1, 1);
        this.three.scene.add(directionalLight);
        
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.three.scene.add(ambientLight);
        
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
        
        // Position model - AIRI-STYLE CENTERED POSITION
        vrm.scene.position.y = 0; // Model at origin for proper framing
        vrm.scene.rotation.y = Math.PI; // Face camera
        
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
        
        // Render scene
        this.three.renderer.render(this.three.scene, this.three.camera);
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
