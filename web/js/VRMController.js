// web/js/VRMController.js
// Complete VRM animation system with proper module loading

export class VRMController {
    constructor(canvas) {
        this.canvas = canvas;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.vrm = null;
        this.mixer = null;
        this.clock = null;
        
        // Will be populated after modules load
        this.THREE = null;
        this.GLTFLoader = null;
        this.VRMLoaderPlugin = null;
        this.VRMExpressionPresetName = null;
        this.VRMHumanBoneName = null;
        
        // Animation states
        this.state = {
            currentAnimation: 'idle',
            previousAnimation: null,
            transitionProgress: 0,
            isTransitioning: false
        };
        
        // Emotion system
        this.emotion = {
            current: 'neutral',
            intensity: 0,
            targetEmotion: 'neutral',
            targetIntensity: 0,
            transitionSpeed: 0.05,
            moodHistory: [],
            emotionalState: 0.5
        };
        
        // Animation timers
        this.timers = {
            blink: 0,
            breath: 0,
            idle: 0,
            gesture: 0,
            sway: 0,
            microMovement: 0
        };
        
        // Physics parameters
        this.physics = {
            springStrength: 0.001,
            damping: 0.9,
            gravity: -0.0001,
            wind: { x: 0, y: 0, z: 0 },
            velocities: new Map()
        };
        
        // Conversation context
        this.context = {
            isSpeaking: false,
            isListening: false,
            lastSpeechTime: 0,
            speechIntensity: 0,
            attentionTarget: { x: 0, y: 0, z: 5 },
            eyeContact: true
        };
        
        // Natural idle movements
        this.idleMotions = {
            breathingDepth: 0.015,
            breathingRate: 0.15,
            swayAmount: 0.02,
            swaySpeed: 0.3,
            blinkInterval: { min: 2, max: 6 },
            microMovements: true
        };
        
        this.bones = {};
        this.expressions = {};
    }
    
    async init() {
        try {
            // Load Three.js modules first
            await this.loadModules();
            
            // Initialize Three.js components
            this.clock = new this.THREE.Clock();
            this.setupScene();
            this.setupLighting();
            this.setupCamera();
            this.setupRenderer();
            
            // Start render loop
            this.animate();
            
            console.log('✅ VRMController: Scene initialized');
        } catch (error) {
            console.error('Failed to initialize VRMController:', error);
            throw error;
        }
    }
    
    async loadModules() {
        // Load Three.js core
        if (!window.THREE) {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.min.js';
            document.head.appendChild(script);
            
            await new Promise((resolve, reject) => {
                script.onload = resolve;
                script.onerror = reject;
            });
        }
        
        this.THREE = window.THREE;
        
        // Load GLTFLoader
        if (!window.GLTFLoader) {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/js/loaders/GLTFLoader.js';
            document.head.appendChild(script);
            
            await new Promise((resolve, reject) => {
                script.onload = resolve;
                script.onerror = reject;
            });
        }
        
        this.GLTFLoader = window.GLTFLoader;
        
        // Load VRM
        if (!window.VRMLoaderPlugin) {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.0.0/lib/three-vrm.min.js';
            document.head.appendChild(script);
            
            await new Promise((resolve, reject) => {
                script.onload = resolve;
                script.onerror = reject;
            });
        }
        
        this.VRMLoaderPlugin = window.VRMLoaderPlugin;
        this.VRMExpressionPresetName = window.VRMExpressionPresetName;
        this.VRMHumanBoneName = window.VRMHumanBoneName;
        
        console.log('✅ VRMController: All modules loaded');
    }
    
    setupScene() {
        this.scene = new this.THREE.Scene();
        this.scene.background = new this.THREE.Color(0x0a0e17);
        this.scene.fog = new this.THREE.Fog(0x0a0e17, 10, 50);
    }
    
    setupLighting() {
        // Ambient light
        const ambient = new this.THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambient);
        
        // Key light
        const keyLight = new this.THREE.DirectionalLight(0xffffff, 0.8);
        keyLight.position.set(1, 1, 1);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.width = 2048;
        keyLight.shadow.mapSize.height = 2048;
        this.scene.add(keyLight);
        
        // Fill light
        const fillLight = new this.THREE.DirectionalLight(0x88aaff, 0.3);
        fillLight.position.set(-1, 0.5, 1);
        this.scene.add(fillLight);
        
        // Rim light
        const rimLight = new this.THREE.DirectionalLight(0xffffff, 0.2);
        rimLight.position.set(0, 0, -1);
        this.scene.add(rimLight);
    }
    
    setupCamera() {
        const aspect = window.innerWidth / window.innerHeight;
        this.camera = new this.THREE.PerspectiveCamera(30, aspect, 0.1, 100);
        this.camera.position.set(0, 1.0, 3.5);
        this.camera.lookAt(0, 0.8, 0);
    }
    
    setupRenderer() {
        this.renderer = new this.THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: false
        });
        
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = this.THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = this.THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1;
        
        window.addEventListener('resize', () => this.handleResize());
    }
    
    async loadVRM(url) {
        const loader = new this.GLTFLoader();
        loader.register((parser) => new this.VRMLoaderPlugin(parser));
        
        try {
            console.log(`Loading VRM from: ${url}`);
            const gltf = await loader.loadAsync(url);
            const vrm = gltf.userData.vrm;
            
            if (!vrm) {
                throw new Error('No VRM data found in model');
            }
            
            // Remove old VRM if exists
            if (this.vrm) {
                this.scene.remove(this.vrm.scene);
                this.vrm.dispose();
            }
            
            // Setup new VRM
            this.vrm = vrm;
            this.scene.add(vrm.scene);
            this.setupVRM();
            this.playAnimation('idle');
            
            console.log('✅ VRM loaded successfully');
            return vrm;
            
        } catch (error) {
            console.error('Failed to load VRM:', error);
            this.createFallbackAvatar();
            throw error;
        }
    }
    
    createFallbackAvatar() {
        if (!this.THREE) {
            console.error('THREE not loaded, cannot create fallback');
            return;
        }
        
        console.log('Creating fallback avatar');
        
        const group = new this.THREE.Group();
        group.name = 'FallbackAvatar';
        
        // Create simple character
        const geometry = new this.THREE.CapsuleGeometry(0.3, 1.6, 4, 8);
        const material = new this.THREE.MeshLambertMaterial({ color: 0xff6b6b });
        const mesh = new this.THREE.Mesh(geometry, material);
        mesh.position.y = 0.8;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        group.add(mesh);
        group.position.set(0, 0, 0);
        this.scene.add(group);
        
        // Create minimal VRM interface
        this.vrm = {
            scene: group,
            isFallback: true,
            update: () => {},
            humanoid: null,
            lookAt: null,
            expressionManager: null,
            dispose: () => {
                this.scene.remove(group);
            }
        };
        
        console.log('✅ Fallback avatar created');
    }
    
    setupVRM() {
        if (!this.vrm || this.vrm.isFallback) return;
        
        // Position model
        this.vrm.scene.position.y = 0;
        this.vrm.scene.rotation.y = Math.PI;
        
        // Enable shadows
        this.vrm.scene.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        
        // Setup humanoid bones
        this.bones = {};
        if (this.vrm.humanoid && this.VRMHumanBoneName) {
            Object.values(this.VRMHumanBoneName).forEach(boneName => {
                const bone = this.vrm.humanoid.getNormalizedBoneNode(boneName);
                if (bone) {
                    this.bones[boneName] = bone;
                    if (!bone.userData.initialRotation) {
                        bone.userData.initialRotation = bone.rotation.clone();
                    }
                }
            });
        }
        
        // Setup expressions
        this.expressions = {};
        if (this.vrm.expressionManager && this.VRMExpressionPresetName) {
            Object.values(this.VRMExpressionPresetName).forEach(preset => {
                try {
                    this.vrm.expressionManager.setValue(preset, 0);
                    this.expressions[preset] = true;
                } catch (e) {
                    // Expression not available
                }
            });
        }
        
        // Setup lookAt
        if (this.vrm.lookAt) {
            this.vrm.lookAt.target = this.camera;
            this.vrm.lookAt.autoUpdate = true;
        }
        
        this.applyNaturalRestPose();
        console.log('✅ VRM setup complete');
    }
    
    applyNaturalRestPose() {
        if (!this.bones || this.vrm?.isFallback) return;
        
        // Natural standing pose
        if (this.bones.leftUpperArm) {
            this.bones.leftUpperArm.rotation.z = Math.PI * 0.35;
            this.bones.leftUpperArm.rotation.x = 0.1;
        }
        if (this.bones.rightUpperArm) {
            this.bones.rightUpperArm.rotation.z = -Math.PI * 0.35;
            this.bones.rightUpperArm.rotation.x = 0.1;
        }
        
        if (this.bones.leftLowerArm) {
            this.bones.leftLowerArm.rotation.z = 0.1;
        }
        if (this.bones.rightLowerArm) {
            this.bones.rightLowerArm.rotation.z = -0.1;
        }
        
        if (this.bones.spine) {
            this.bones.spine.rotation.x = 0.02;
        }
        if (this.bones.head) {
            this.bones.head.rotation.x = 0.05;
        }
    }
    
    playAnimation(animationName, options = {}) {
        if (this.state.currentAnimation === animationName) return;
        
        this.state.previousAnimation = this.state.currentAnimation;
        this.state.currentAnimation = animationName;
        this.state.isTransitioning = true;
        this.state.transitionProgress = 0;
    }
    
    updateAnimationState(deltaTime) {
        const time = this.clock.getElapsedTime();
        
        switch (this.state.currentAnimation) {
            case 'idle':
                this.updateIdleAnimation(deltaTime, time);
                break;
            case 'talking':
                this.updateTalkingAnimation(deltaTime, time);
                break;
            default:
                this.updateIdleAnimation(deltaTime, time);
        }
        
        this.updateExpressions(deltaTime);
        this.updateBlinking(deltaTime);
    }
    
    updateIdleAnimation(deltaTime, time) {
        if (this.vrm?.isFallback) {
            // Simple fallback animation
            this.vrm.scene.rotation.y = Math.sin(time * 0.5) * 0.02;
            return;
        }
        
        if (!this.bones) return;
        
        // Breathing
        this.timers.breath += deltaTime * this.idleMotions.breathingRate;
        const breathAmount = Math.sin(this.timers.breath * Math.PI * 2) * this.idleMotions.breathingDepth;
        
        if (this.bones.chest) {
            this.bones.chest.position.y = breathAmount * 0.5;
            this.bones.chest.scale.x = 1 + breathAmount;
            this.bones.chest.scale.z = 1 + breathAmount;
        }
        
        // Subtle sway
        this.timers.sway += deltaTime * this.idleMotions.swaySpeed;
        const swayAmount = Math.sin(this.timers.sway) * this.idleMotions.swayAmount;
        
        if (this.vrm?.scene) {
            this.vrm.scene.rotation.y = Math.PI + swayAmount * 0.5;
        }
        
        if (this.bones.spine) {
            this.bones.spine.rotation.z = swayAmount * 0.3;
        }
        
        // Micro movements
        if (this.idleMotions.microMovements) {
            if (this.bones.head) {
                const microX = Math.sin(time * 1.3) * 0.005;
                const microY = Math.sin(time * 0.7) * 0.008;
                this.bones.head.rotation.x += microX;
                this.bones.head.rotation.y += microY;
            }
        }
    }
    
    updateTalkingAnimation(deltaTime, time) {
        this.updateIdleAnimation(deltaTime, time);
        
        if (this.vrm?.isFallback || !this.bones) return;
        
        const talkSpeed = 2.5;
        const gestureIntensity = this.context.speechIntensity;
        
        // Head movement while talking
        if (this.bones.head) {
            this.bones.head.rotation.x = Math.sin(time * talkSpeed) * 0.03;
            this.bones.head.rotation.y = Math.sin(time * talkSpeed * 0.7) * 0.04;
            this.bones.head.rotation.z = Math.sin(time * talkSpeed * 0.5) * 0.02;
        }
        
        // Arm gestures
        if (this.bones.leftUpperArm) {
            this.bones.leftUpperArm.rotation.z = Math.PI * 0.35 - Math.sin(time * 1.5) * 0.2 * gestureIntensity;
            this.bones.leftUpperArm.rotation.x = 0.1 + Math.sin(time * 2) * 0.15 * gestureIntensity;
        }
        
        if (this.bones.rightUpperArm) {
            this.bones.rightUpperArm.rotation.z = -Math.PI * 0.35 + Math.sin(time * 1.5 + 1) * 0.2 * gestureIntensity;
            this.bones.rightUpperArm.rotation.x = 0.1 + Math.sin(time * 2 + 1) * 0.15 * gestureIntensity;
        }
    }
    
    updateExpressions(deltaTime) {
        if (!this.vrm?.expressionManager) return;
        
        // Smooth expression transitions
        if (this.emotion.current !== this.emotion.targetEmotion) {
            this.emotion.intensity -= this.emotion.transitionSpeed;
            
            if (this.emotion.intensity <= 0) {
                this.emotion.current = this.emotion.targetEmotion;
                this.emotion.intensity = 0;
            }
        } else if (this.emotion.intensity < this.emotion.targetIntensity) {
            this.emotion.intensity = Math.min(
                this.emotion.intensity + this.emotion.transitionSpeed,
                this.emotion.targetIntensity
            );
        }
        
        // Apply expression
        try {
            if (this.emotion.current !== 'neutral') {
                this.vrm.expressionManager.setValue(this.emotion.current, this.emotion.intensity);
            }
            
            // Auto lip-sync when talking
            if (this.context.isSpeaking) {
                const lipSync = Math.abs(Math.sin(this.clock.getElapsedTime() * 10)) * 0.3;
                this.vrm.expressionManager.setValue('aa', lipSync);
            }
        } catch (e) {
            // Expression not available
        }
    }
    
    updateBlinking(deltaTime) {
        if (!this.expressions?.blink) return;
        
        this.timers.blink += deltaTime;
        
        const nextBlink = this.idleMotions.blinkInterval.min + 
                         Math.random() * (this.idleMotions.blinkInterval.max - this.idleMotions.blinkInterval.min);
        
        if (this.timers.blink > nextBlink) {
            this.performBlink();
            this.timers.blink = 0;
        }
    }
    
    performBlink() {
        if (!this.vrm?.expressionManager) return;
        
        try {
            this.vrm.expressionManager.setValue('blink', 1.0);
            setTimeout(() => {
                if (this.vrm?.expressionManager) {
                    this.vrm.expressionManager.setValue('blink', 0);
                }
            }, 150);
        } catch (e) {
            // Blink not available
        }
    }
    
    // Public API Methods
    
    wave() {
        console.log('🌊 Playing wave animation');
        this.setExpression('happy', 0.7);
        
        if (this.vrm?.isFallback) {
            // Simple fallback wave
            let waveTime = 0;
            const waveInterval = setInterval(() => {
                waveTime += 0.016;
                if (waveTime >= 2) {
                    if (this.vrm?.scene) {
                        this.vrm.scene.rotation.z = 0;
                    }
                    clearInterval(waveInterval);
                    return;
                }
                if (this.vrm?.scene) {
                    this.vrm.scene.rotation.z = Math.sin(waveTime * Math.PI * 3) * 0.1;
                }
            }, 16);
            return;
        }
        
        if (!this.bones.rightUpperArm) return;
        
        let waveTime = 0;
        const waveInterval = setInterval(() => {
            waveTime += 0.016;
            
            if (waveTime >= 3) {
                this.applyNaturalRestPose();
                clearInterval(waveInterval);
                return;
            }
            
            const waveIntensity = Math.sin(waveTime * Math.PI * 3);
            
            this.bones.rightUpperArm.rotation.z = -Math.PI * 0.6;
            this.bones.rightUpperArm.rotation.x = -0.3;
            this.bones.rightUpperArm.rotation.y = 0.3;
            
            if (this.bones.rightLowerArm) {
                this.bones.rightLowerArm.rotation.x = -Math.PI * 0.4;
            }
            
            if (this.bones.rightHand) {
                this.bones.rightHand.rotation.z = waveIntensity * 0.5;
                this.bones.rightHand.rotation.y = waveIntensity * 0.2;
            }
        }, 16);
    }
    
    nod() {
        console.log('👍 Playing nod animation');
        if (!this.bones.head) return;
        
        const originalRotation = this.bones.head.rotation.clone();
        let nodTime = 0;
        
        const nodInterval = setInterval(() => {
            nodTime += 0.016;
            
            if (nodTime >= 1) {
                this.bones.head.rotation.copy(originalRotation);
                clearInterval(nodInterval);
                return;
            }
            
            const nodProgress = Math.sin(nodTime * Math.PI * 2);
            this.bones.head.rotation.x = originalRotation.x + nodProgress * 0.2;
        }, 16);
    }
    
    think() {
        console.log('🤔 Playing think animation');
        this.setExpression('neutral', 0.5);
        
        if (this.bones.head) {
            this.bones.head.rotation.z = 0.1;
            this.bones.head.rotation.x = 0.1;
        }
    }
    
    excited() {
        console.log('🎉 Playing excited animation');
        this.setExpression('happy', 0.9);
    }
    
    shy() {
        console.log('😊 Playing shy animation');
        this.setExpression('happy', 0.4);
        
        if (this.bones.head) {
            this.bones.head.rotation.x = 0.2;
            this.bones.head.rotation.y = 0.1;
        }
    }
    
    setExpression(expressionName, intensity = 1, duration = 0) {
        this.emotion.targetEmotion = expressionName;
        this.emotion.targetIntensity = intensity;
        
        if (duration > 0) {
            setTimeout(() => {
                this.emotion.targetEmotion = 'neutral';
                this.emotion.targetIntensity = 0;
            }, duration);
        }
    }
    
    setMood(mood) {
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
                this.excited();
                break;
            case 'thinking':
                this.setExpression('neutral', 0.2);
                break;
            default:
                this.setExpression('neutral', 0);
        }
    }
    
    startSpeaking(text, sentiment = 'neutral') {
        this.context.isSpeaking = true;
        this.context.lastSpeechTime = Date.now();
        this.context.speechIntensity = this.analyzeSpeechIntensity(text);
        
        this.updateEmotionalState(sentiment);
        this.playAnimation('talking');
        
        console.log('🗣️ Started speaking with sentiment:', sentiment);
    }
    
    stopSpeaking() {
        this.context.isSpeaking = false;
        this.context.speechIntensity = 0;
        this.playAnimation('idle');
        
        // Clear lip-sync
        if (this.vrm?.expressionManager) {
            try {
                this.vrm.expressionManager.setValue('aa', 0);
            } catch (e) {}
        }
        
        console.log('🔇 Stopped speaking');
    }
    
    analyzeSpeechIntensity(text) {
        const exclamations = (text.match(/!/g) || []).length;
        const questions = (text.match(/\?/g) || []).length;
        const emphasis = (text.match(/[A-Z]{2,}/g) || []).length;
        
        return Math.min(1, (exclamations * 0.3 + questions * 0.2 + emphasis * 0.1));
    }
    
    updateEmotionalState(sentiment) {
        const emotionMap = {
            positive: { emotion: 'happy', intensity: 0.6, mood: 0.8 },
            negative: { emotion: 'sad', intensity: 0.4, mood: 0.3 },
            neutral: { emotion: 'neutral', intensity: 0.3, mood: 0.5 },
            excited: { emotion: 'happy', intensity: 0.9, mood: 1.0 },
            confused: { emotion: 'surprised', intensity: 0.5, mood: 0.4 },
            thoughtful: { emotion: 'neutral', intensity: 0.2, mood: 0.5 }
        };
        
        const config = emotionMap[sentiment] || emotionMap.neutral;
        this.setExpression(config.emotion, config.intensity);
        this.emotion.emotionalState = config.mood;
    }
    
    lookAt(target) {
        if (this.vrm?.lookAt) {
            this.vrm.lookAt.target = target;
        }
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        
        if (!this.clock) return;
        
        const deltaTime = this.clock.getDelta();
        
        if (this.vrm) {
            if (this.vrm.update) {
                this.vrm.update(deltaTime);
            }
            
            this.updateAnimationState(deltaTime);
            
            if (this.vrm.springBoneManager) {
                this.vrm.springBoneManager.update(deltaTime);
            }
        }
        
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }
    
    handleResize() {
        if (!this.camera || !this.renderer) return;
        
        const width = window.innerWidth;
        const height = window.innerHeight;
        
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
    
    dispose() {
        if (this.vrm) {
            this.scene.remove(this.vrm.scene);
            if (this.vrm.dispose) {
                this.vrm.dispose();
            }
        }
        
        if (this.renderer) {
            this.renderer.dispose();
        }
        
        if (this.scene) {
            this.scene.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
        }
        
        console.log('🧹 VRMController disposed');
    }
}
