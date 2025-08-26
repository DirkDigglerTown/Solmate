// web/js/VRMController.js
// Complete VRM animation system inspired by AIRI's architecture
// Features: Natural movements, emotions, gestures, and physics-based animations

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMExpressionPresetName, VRMHumanBoneName } from '@pixiv/three-vrm';

export class VRMController {
    constructor(canvas) {
        this.canvas = canvas;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.vrm = null;
        this.mixer = null;
        this.clock = new THREE.Clock();
        
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
            emotionalState: 0.5 // 0 = sad, 1 = happy
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
        
        // Gesture library
        this.gestures = {
            wave: this.createWaveGesture(),
            nod: this.createNodGesture(),
            headShake: this.createHeadShakeGesture(),
            thinking: this.createThinkingGesture(),
            explaining: this.createExplainingGesture(),
            excited: this.createExcitedGesture(),
            shy: this.createShyGesture()
        };
        
        // Conversation context
        this.context = {
            isSpeaking: false,
            isListening: false,
            lastSpeechTime: 0,
            speechIntensity: 0,
            attentionTarget: new THREE.Vector3(0, 0, 5),
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
    }
    
    async init() {
        // Initialize Three.js scene
        this.setupScene();
        this.setupLighting();
        this.setupCamera();
        this.setupRenderer();
        
        // Start render loop
        this.animate();
    }
    
    setupScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0e17);
        
        // Add fog for depth
        this.scene.fog = new THREE.Fog(0x0a0e17, 10, 50);
    }
    
    setupLighting() {
        // Ambient light for overall illumination
        const ambient = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambient);
        
        // Key light (main light source)
        const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
        keyLight.position.set(1, 1, 1);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.width = 2048;
        keyLight.shadow.mapSize.height = 2048;
        keyLight.shadow.camera.near = 0.1;
        keyLight.shadow.camera.far = 50;
        this.scene.add(keyLight);
        
        // Fill light (soften shadows)
        const fillLight = new THREE.DirectionalLight(0x88aaff, 0.3);
        fillLight.position.set(-1, 0.5, 1);
        this.scene.add(fillLight);
        
        // Rim light (outline effect)
        const rimLight = new THREE.DirectionalLight(0xffffff, 0.2);
        rimLight.position.set(0, 0, -1);
        this.scene.add(rimLight);
    }
    
    setupCamera() {
        const aspect = window.innerWidth / window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(30, aspect, 0.1, 100);
        
        // Cinematic camera position
        this.camera.position.set(0, 1.0, 3.5);
        this.camera.lookAt(0, 0.8, 0);
    }
    
    setupRenderer() {
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: false
        });
        
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1;
        
        // Handle resize
        window.addEventListener('resize', () => this.handleResize());
    }
    
    async loadVRM(url) {
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));
        
        try {
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
            
            // Initialize VRM
            this.setupVRM();
            
            // Start idle animation
            this.playAnimation('idle');
            
            console.log('VRM loaded successfully:', vrm);
            return vrm;
            
        } catch (error) {
            console.error('Failed to load VRM:', error);
            throw error;
        }
    }
    
    setupVRM() {
        if (!this.vrm) return;
        
        // Position model
        this.vrm.scene.position.y = 0;
        this.vrm.scene.rotation.y = Math.PI; // Face camera
        
        // Enable shadows
        this.vrm.scene.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        
        // Setup humanoid bones for easy access
        this.bones = {};
        if (this.vrm.humanoid) {
            Object.values(VRMHumanBoneName).forEach(boneName => {
                const bone = this.vrm.humanoid.getNormalizedBoneNode(boneName);
                if (bone) {
                    this.bones[boneName] = bone;
                    
                    // Store initial rotations
                    if (!bone.userData.initialRotation) {
                        bone.userData.initialRotation = bone.rotation.clone();
                    }
                }
            });
        }
        
        // Setup expressions
        this.expressions = {};
        if (this.vrm.expressionManager) {
            Object.values(VRMExpressionPresetName).forEach(preset => {
                const expression = this.vrm.expressionManager.getExpression(preset);
                if (expression) {
                    this.expressions[preset] = expression;
                }
            });
        }
        
        // Setup lookAt
        if (this.vrm.lookAt) {
            this.vrm.lookAt.target = this.camera;
            this.vrm.lookAt.autoUpdate = true;
        }
        
        // Initialize physics for secondary animation
        this.initializePhysics();
        
        // Apply natural rest pose
        this.applyNaturalRestPose();
    }
    
    applyNaturalRestPose() {
        // Natural standing pose (not T-pose)
        
        // Arms relaxed at sides
        if (this.bones.leftUpperArm) {
            this.bones.leftUpperArm.rotation.z = Math.PI * 0.35; // 63 degrees
            this.bones.leftUpperArm.rotation.x = 0.1;
        }
        if (this.bones.rightUpperArm) {
            this.bones.rightUpperArm.rotation.z = -Math.PI * 0.35;
            this.bones.rightUpperArm.rotation.x = 0.1;
        }
        
        // Slight elbow bend
        if (this.bones.leftLowerArm) {
            this.bones.leftLowerArm.rotation.z = 0.1;
        }
        if (this.bones.rightLowerArm) {
            this.bones.rightLowerArm.rotation.z = -0.1;
        }
        
        // Relaxed shoulders
        if (this.bones.leftShoulder) {
            this.bones.leftShoulder.rotation.z = 0.05;
        }
        if (this.bones.rightShoulder) {
            this.bones.rightShoulder.rotation.z = -0.05;
        }
        
        // Natural spine curve
        if (this.bones.spine) {
            this.bones.spine.rotation.x = 0.02;
        }
        if (this.bones.chest) {
            this.bones.chest.rotation.x = 0.01;
        }
        
        // Slight head tilt
        if (this.bones.head) {
            this.bones.head.rotation.x = 0.05;
        }
    }
    
    initializePhysics() {
        // Initialize velocity tracking for physics simulation
        Object.keys(this.bones).forEach(boneName => {
            this.physics.velocities.set(boneName, new THREE.Vector3());
        });
    }
    
    // === ANIMATION SYSTEM ===
    
    playAnimation(animationName, options = {}) {
        const {
            transitionDuration = 0.5,
            loop = false,
            onComplete = null
        } = options;
        
        if (this.state.currentAnimation === animationName) return;
        
        this.state.previousAnimation = this.state.currentAnimation;
        this.state.currentAnimation = animationName;
        this.state.isTransitioning = true;
        this.state.transitionProgress = 0;
        
        // Store transition settings
        this.state.transitionDuration = transitionDuration;
        this.state.loop = loop;
        this.state.onComplete = onComplete;
    }
    
    updateAnimationState(deltaTime) {
        if (this.state.isTransitioning) {
            this.state.transitionProgress += deltaTime / this.state.transitionDuration;
            
            if (this.state.transitionProgress >= 1) {
                this.state.transitionProgress = 1;
                this.state.isTransitioning = false;
                this.state.previousAnimation = null;
            }
        }
        
        // Update current animation
        switch (this.state.currentAnimation) {
            case 'idle':
                this.updateIdleAnimation(deltaTime);
                break;
            case 'talking':
                this.updateTalkingAnimation(deltaTime);
                break;
            case 'wave':
                this.updateWaveAnimation(deltaTime);
                break;
            case 'nod':
                this.updateNodAnimation(deltaTime);
                break;
            case 'thinking':
                this.updateThinkingAnimation(deltaTime);
                break;
            default:
                this.updateIdleAnimation(deltaTime);
        }
    }
    
    updateIdleAnimation(deltaTime) {
        const time = this.clock.getElapsedTime();
        
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
        
        if (this.vrm.scene) {
            this.vrm.scene.rotation.y = Math.PI + swayAmount * 0.5;
        }
        
        if (this.bones.spine) {
            this.bones.spine.rotation.z = swayAmount * 0.3;
        }
        
        // Weight shifting
        if (this.bones.hips) {
            this.bones.hips.position.x = Math.sin(time * 0.3) * 0.01;
            this.bones.hips.rotation.z = Math.sin(time * 0.3) * 0.01;
        }
        
        // Micro movements
        if (this.idleMotions.microMovements) {
            this.updateMicroMovements(deltaTime);
        }
        
        // Random gestures
        this.timers.gesture += deltaTime;
        if (this.timers.gesture > 8 + Math.random() * 4) {
            this.performRandomIdleGesture();
            this.timers.gesture = 0;
        }
    }
    
    updateMicroMovements(deltaTime) {
        const time = this.clock.getElapsedTime();
        
        // Head micro movements
        if (this.bones.head) {
            const microX = Math.sin(time * 1.3) * 0.005;
            const microY = Math.sin(time * 0.7) * 0.008;
            this.bones.head.rotation.x += microX;
            this.bones.head.rotation.y += microY;
        }
        
        // Finger movements
        ['leftHand', 'rightHand'].forEach(handName => {
            if (this.bones[handName]) {
                const microRot = Math.sin(time * 2 + (handName === 'leftHand' ? 0 : Math.PI)) * 0.02;
                this.bones[handName].rotation.z += microRot;
            }
        });
    }
    
    updateTalkingAnimation(deltaTime) {
        const time = this.clock.getElapsedTime();
        const talkSpeed = 2.5;
        
        // Continue idle base animation
        this.updateIdleAnimation(deltaTime);
        
        // Head movement while talking
        if (this.bones.head) {
            this.bones.head.rotation.x = Math.sin(time * talkSpeed) * 0.03;
            this.bones.head.rotation.y = Math.sin(time * talkSpeed * 0.7) * 0.04;
            this.bones.head.rotation.z = Math.sin(time * talkSpeed * 0.5) * 0.02;
        }
        
        // Natural hand gestures
        const gestureIntensity = this.context.speechIntensity;
        
        // Left arm gestures
        if (this.bones.leftUpperArm) {
            this.bones.leftUpperArm.rotation.z = Math.PI * 0.35 - Math.sin(time * 1.5) * 0.2 * gestureIntensity;
            this.bones.leftUpperArm.rotation.x = 0.1 + Math.sin(time * 2) * 0.15 * gestureIntensity;
            this.bones.leftUpperArm.rotation.y = Math.sin(time * 1.8) * 0.1 * gestureIntensity;
        }
        
        if (this.bones.leftLowerArm) {
            this.bones.leftLowerArm.rotation.x = -Math.sin(time * 2.5) * 0.3 * gestureIntensity;
            this.bones.leftLowerArm.rotation.y = Math.sin(time * 2) * 0.2 * gestureIntensity;
        }
        
        // Right arm gestures (offset for asymmetry)
        if (this.bones.rightUpperArm) {
            this.bones.rightUpperArm.rotation.z = -Math.PI * 0.35 + Math.sin(time * 1.5 + 1) * 0.2 * gestureIntensity;
            this.bones.rightUpperArm.rotation.x = 0.1 + Math.sin(time * 2 + 1) * 0.15 * gestureIntensity;
            this.bones.rightUpperArm.rotation.y = -Math.sin(time * 1.8 + 1) * 0.1 * gestureIntensity;
        }
        
        if (this.bones.rightLowerArm) {
            this.bones.rightLowerArm.rotation.x = -Math.sin(time * 2.5 + 1) * 0.3 * gestureIntensity;
            this.bones.rightLowerArm.rotation.y = -Math.sin(time * 2 + 1) * 0.2 * gestureIntensity;
        }
        
        // Hand movements
        if (this.bones.leftHand) {
            this.bones.leftHand.rotation.z = Math.sin(time * 3) * 0.1 * gestureIntensity;
            this.bones.leftHand.rotation.x = Math.sin(time * 2.5) * 0.05 * gestureIntensity;
        }
        
        if (this.bones.rightHand) {
            this.bones.rightHand.rotation.z = Math.sin(time * 3 + Math.PI) * 0.1 * gestureIntensity;
            this.bones.rightHand.rotation.x = Math.sin(time * 2.5 + Math.PI) * 0.05 * gestureIntensity;
        }
        
        // Body movement
        if (this.bones.spine) {
            this.bones.spine.rotation.y = Math.sin(time * 0.8) * 0.02 * gestureIntensity;
        }
        
        if (this.bones.chest) {
            this.bones.chest.rotation.y = Math.sin(time * 0.9) * 0.015 * gestureIntensity;
        }
    }
    
    updateWaveAnimation(deltaTime) {
        const time = this.clock.getElapsedTime();
        const waveSpeed = 5;
        const wavePhase = Math.sin(time * waveSpeed);
        
        // Raise right arm
        if (this.bones.rightUpperArm) {
            this.bones.rightUpperArm.rotation.z = -Math.PI * 0.6; // Raise arm
            this.bones.rightUpperArm.rotation.x = -0.3; // Forward
            this.bones.rightUpperArm.rotation.y = 0.3; // Outward
        }
        
        // Bend elbow
        if (this.bones.rightLowerArm) {
            this.bones.rightLowerArm.rotation.x = -Math.PI * 0.4; // Bend elbow
            this.bones.rightLowerArm.rotation.z = 0; // Keep straight
        }
        
        // Wave hand
        if (this.bones.rightHand) {
            this.bones.rightHand.rotation.z = wavePhase * 0.5; // Side to side wave
            this.bones.rightHand.rotation.y = wavePhase * 0.2; // Slight twist
        }
        
        // Add body motion
        if (this.bones.spine) {
            this.bones.spine.rotation.y = 0.1; // Turn slightly toward wave
        }
        
        if (this.bones.head) {
            this.bones.head.rotation.y = 0.1; // Look toward wave direction
            this.bones.head.rotation.z = wavePhase * 0.05; // Slight head tilt
        }
        
        // Add happy expression
        this.setExpression('happy', 0.7);
    }
    
    updateNodAnimation(deltaTime) {
        const time = this.clock.getElapsedTime();
        const nodSpeed = 3;
        const nodPhase = Math.sin(time * nodSpeed);
        
        if (this.bones.head) {
            this.bones.head.rotation.x = 0.05 + nodPhase * 0.2; // Nod motion
        }
        
        if (this.bones.neck) {
            this.bones.neck.rotation.x = nodPhase * 0.1; // Support nod
        }
    }
    
    updateThinkingAnimation(deltaTime) {
        const time = this.clock.getElapsedTime();
        
        // Thinking pose - hand to chin
        if (this.bones.rightUpperArm) {
            this.bones.rightUpperArm.rotation.z = -Math.PI * 0.25;
            this.bones.rightUpperArm.rotation.x = -0.5;
            this.bones.rightUpperArm.rotation.y = 0.3;
        }
        
        if (this.bones.rightLowerArm) {
            this.bones.rightLowerArm.rotation.x = -Math.PI * 0.6;
        }
        
        if (this.bones.rightHand) {
            this.bones.rightHand.rotation.x = 0.3;
        }
        
        // Head tilt
        if (this.bones.head) {
            this.bones.head.rotation.z = 0.1;
            this.bones.head.rotation.x = 0.1;
        }
        
        // Thinking expression
        this.setExpression('neutral', 0.5);
    }
    
    performRandomIdleGesture() {
        const gestures = ['headTilt', 'shoulderShrug', 'weightShift', 'lookAround', 'stretch'];
        const gesture = gestures[Math.floor(Math.random() * gestures.length)];
        
        switch (gesture) {
            case 'headTilt':
                this.animateHeadTilt();
                break;
            case 'shoulderShrug':
                this.animateShoulderShrug();
                break;
            case 'weightShift':
                this.animateWeightShift();
                break;
            case 'lookAround':
                this.animateLookAround();
                break;
            case 'stretch':
                this.animateStretch();
                break;
        }
    }
    
    animateHeadTilt() {
        if (!this.bones.head) return;
        
        const duration = 1500;
        const startTime = Date.now();
        const originalRotation = this.bones.head.rotation.clone();
        
        const animate = () => {
            const progress = (Date.now() - startTime) / duration;
            if (progress >= 1) return;
            
            const eased = this.easeInOutQuad(progress);
            this.bones.head.rotation.z = originalRotation.z + Math.sin(eased * Math.PI) * 0.15;
            
            requestAnimationFrame(animate);
        };
        animate();
    }
    
    animateShoulderShrug() {
        const duration = 1000;
        const startTime = Date.now();
        
        const animate = () => {
            const progress = (Date.now() - startTime) / duration;
            if (progress >= 1) {
                // Reset
                if (this.bones.leftShoulder) this.bones.leftShoulder.rotation.z = 0.05;
                if (this.bones.rightShoulder) this.bones.rightShoulder.rotation.z = -0.05;
                return;
            }
            
            const eased = this.easeInOutQuad(progress);
            const shrug = Math.sin(eased * Math.PI) * 0.1;
            
            if (this.bones.leftShoulder) this.bones.leftShoulder.rotation.z = 0.05 + shrug;
            if (this.bones.rightShoulder) this.bones.rightShoulder.rotation.z = -0.05 - shrug;
            
            requestAnimationFrame(animate);
        };
        animate();
    }
    
    animateWeightShift() {
        if (!this.bones.hips) return;
        
        const duration = 2000;
        const startTime = Date.now();
        
        const animate = () => {
            const progress = (Date.now() - startTime) / duration;
            if (progress >= 1) {
                this.bones.hips.position.x = 0;
                this.bones.hips.rotation.z = 0;
                return;
            }
            
            const eased = this.easeInOutQuad(progress);
            const shift = Math.sin(eased * Math.PI);
            
            this.bones.hips.position.x = shift * 0.02;
            this.bones.hips.rotation.z = shift * 0.015;
            
            requestAnimationFrame(animate);
        };
        animate();
    }
    
    animateLookAround() {
        if (!this.bones.head || !this.bones.neck) return;
        
        const duration = 3000;
        const startTime = Date.now();
        const targetY = (Math.random() - 0.5) * 0.4;
        
        const animate = () => {
            const progress = (Date.now() - startTime) / duration;
            if (progress >= 1) {
                this.bones.head.rotation.y = 0;
                this.bones.neck.rotation.y = 0;
                return;
            }
            
            const eased = this.easeInOutQuad(progress);
            const look = Math.sin(eased * Math.PI) * targetY;
            
            this.bones.head.rotation.y = look * 0.7;
            this.bones.neck.rotation.y = look * 0.3;
            
            requestAnimationFrame(animate);
        };
        animate();
    }
    
    animateStretch() {
        const duration = 2500;
        const startTime = Date.now();
        
        const animate = () => {
            const progress = (Date.now() - startTime) / duration;
            if (progress >= 1) {
                this.applyNaturalRestPose();
                return;
            }
            
            const eased = this.easeInOutQuad(progress);
            const stretch = Math.sin(eased * Math.PI);
            
            if (this.bones.spine) {
                this.bones.spine.rotation.x = 0.02 - stretch * 0.1;
            }
            
            if (this.bones.leftUpperArm) {
                this.bones.leftUpperArm.rotation.z = Math.PI * 0.35 - stretch * 0.3;
            }
            
            if (this.bones.rightUpperArm) {
                this.bones.rightUpperArm.rotation.z = -Math.PI * 0.35 + stretch * 0.3;
            }
            
            requestAnimationFrame(animate);
        };
        animate();
    }
    
    // === EXPRESSION SYSTEM ===
    
    setExpression(expressionName, intensity = 1, duration = 0) {
        if (!this.vrm?.expressionManager) return;
        
        this.emotion.targetEmotion = expressionName;
        this.emotion.targetIntensity = intensity;
        
        if (duration > 0) {
            setTimeout(() => {
                this.emotion.targetEmotion = 'neutral';
                this.emotion.targetIntensity = 0;
            }, duration);
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
        if (this.expressions[this.emotion.current]) {
            this.expressions[this.emotion.current].value = this.emotion.intensity;
        }
        
        // Auto lip-sync when talking
        if (this.context.isSpeaking && this.expressions.aa) {
            const lipSync = Math.abs(Math.sin(this.clock.getElapsedTime() * 10)) * 0.3;
            this.expressions.aa.value = lipSync;
        }
    }
    
    updateEmotionalState(sentiment) {
        // Update emotional state based on conversation sentiment
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
        this.emotion.emotionalState = this.lerp(
            this.emotion.emotionalState,
            config.mood,
            0.1
        );
        
        // Store in mood history
        this.emotion.moodHistory.push(config.mood);
        if (this.emotion.moodHistory.length > 50) {
            this.emotion.moodHistory.shift();
        }
    }
    
    // === BLINKING SYSTEM ===
    
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
        if (!this.expressions?.blink) return;
        
        const blinkDuration = 150;
        const startTime = Date.now();
        
        const animate = () => {
            const progress = (Date.now() - startTime) / blinkDuration;
            if (progress >= 1) {
                this.expressions.blink.value = 0;
                return;
            }
            
            // Quick blink animation
            if (progress < 0.5) {
                this.expressions.blink.value = progress * 2;
            } else {
                this.expressions.blink.value = (1 - progress) * 2;
            }
            
            requestAnimationFrame(animate);
        };
        animate();
    }
    
    // === GESTURE SYSTEM ===
    
    createWaveGesture() {
        return {
            duration: 3000,
            bones: {
                rightUpperArm: { 
                    rotation: { x: -0.3, y: 0.3, z: -Math.PI * 0.6 },
                    timing: 'immediate'
                },
                rightLowerArm: { 
                    rotation: { x: -Math.PI * 0.4, y: 0, z: 0 },
                    timing: 'immediate'
                },
                rightHand: {
                    rotation: { x: 0, y: 0, z: 0 },
                    animation: 'wave',
                    timing: 'immediate'
                },
                spine: {
                    rotation: { x: 0, y: 0.1, z: 0 },
                    timing: 'smooth'
                }
            },
            expression: { name: 'happy', intensity: 0.7 },
            loop: false
        };
    }
    
    createNodGesture() {
        return {
            duration: 1500,
            bones: {
                head: {
                    animation: 'nod',
                    amplitude: 0.2,
                    frequency: 3
                },
                neck: {
                    animation: 'nod',
                    amplitude: 0.1,
                    frequency: 3
                }
            },
            expression: { name: 'neutral', intensity: 0.3 },
            loop: false
        };
    }
    
    createHeadShakeGesture() {
        return {
            duration: 1500,
            bones: {
                head: {
                    animation: 'shake',
                    amplitude: 0.2,
                    frequency: 3
                },
                neck: {
                    animation: 'shake',
                    amplitude: 0.1,
                    frequency: 3
                }
            },
            expression: { name: 'sad', intensity: 0.3 },
            loop: false
        };
    }
    
    createThinkingGesture() {
        return {
            duration: 2000,
            bones: {
                rightUpperArm: {
                    rotation: { x: -0.5, y: 0.3, z: -Math.PI * 0.25 }
                },
                rightLowerArm: {
                    rotation: { x: -Math.PI * 0.6, y: 0, z: 0 }
                },
                rightHand: {
                    rotation: { x: 0.3, y: 0, z: 0 }
                },
                head: {
                    rotation: { x: 0.1, y: 0, z: 0.1 }
                }
            },
            expression: { name: 'neutral', intensity: 0.5 },
            loop: false
        };
    }
    
    createExplainingGesture() {
        return {
            duration: 4000,
            bones: {
                leftUpperArm: {
                    animation: 'explaining',
                    baseRotation: { x: 0.1, y: 0, z: Math.PI * 0.3 }
                },
                rightUpperArm: {
                    animation: 'explaining',
                    baseRotation: { x: 0.1, y: 0, z: -Math.PI * 0.3 }
                }
            },
            expression: { name: 'happy', intensity: 0.3 },
            loop: true
        };
    }
    
    createExcitedGesture() {
        return {
            duration: 2000,
            bones: {
                leftUpperArm: {
                    rotation: { x: -0.5, y: 0.2, z: Math.PI * 0.7 }
                },
                rightUpperArm: {
                    rotation: { x: -0.5, y: -0.2, z: -Math.PI * 0.7 }
                },
                spine: {
                    animation: 'bounce',
                    amplitude: 0.02,
                    frequency: 2
                }
            },
            expression: { name: 'happy', intensity: 0.9 },
            loop: false
        };
    }
    
    createShyGesture() {
        return {
            duration: 2500,
            bones: {
                head: {
                    rotation: { x: 0.2, y: 0.1, z: 0 }
                },
                leftUpperArm: {
                    rotation: { x: 0.3, y: 0, z: Math.PI * 0.25 }
                },
                rightUpperArm: {
                    rotation: { x: 0.3, y: 0, z: -Math.PI * 0.25 }
                }
            },
            expression: { name: 'happy', intensity: 0.4 },
            loop: false
        };
    }
    
    performGesture(gestureName) {
        const gesture = this.gestures[gestureName];
        if (!gesture) return;
        
        // Apply gesture bones
        Object.entries(gesture.bones).forEach(([boneName, config]) => {
            const bone = this.bones[boneName];
            if (!bone) return;
            
            if (config.rotation) {
                // Direct rotation
                this.animateBoneRotation(bone, config.rotation, gesture.duration);
            } else if (config.animation) {
                // Special animation
                this.performSpecialAnimation(bone, config);
            }
        });
        
        // Apply expression
        if (gesture.expression) {
            this.setExpression(gesture.expression.name, gesture.expression.intensity, gesture.duration);
        }
    }
    
    animateBoneRotation(bone, targetRotation, duration) {
        const startRotation = {
            x: bone.rotation.x,
            y: bone.rotation.y,
            z: bone.rotation.z
        };
        
        const startTime = Date.now();
        
        const animate = () => {
            const progress = (Date.now() - startTime) / duration;
            if (progress >= 1) {
                // Return to rest pose
                if (bone.userData.initialRotation) {
                    bone.rotation.copy(bone.userData.initialRotation);
                }
                return;
            }
            
            const eased = this.easeInOutQuad(progress);
            
            bone.rotation.x = this.lerp(startRotation.x, targetRotation.x, eased);
            bone.rotation.y = this.lerp(startRotation.y, targetRotation.y, eased);
            bone.rotation.z = this.lerp(startRotation.z, targetRotation.z, eased);
            
            requestAnimationFrame(animate);
        };
        animate();
    }
    
    performSpecialAnimation(bone, config) {
        const startTime = Date.now();
        
        const animate = () => {
            const elapsed = (Date.now() - startTime) / 1000;
            
            switch (config.animation) {
                case 'wave':
                    bone.rotation.z = Math.sin(elapsed * 5) * 0.5;
                    bone.rotation.y = Math.sin(elapsed * 5) * 0.2;
                    break;
                    
                case 'nod':
                    bone.rotation.x = Math.sin(elapsed * config.frequency) * config.amplitude;
                    break;
                    
                case 'shake':
                    bone.rotation.y = Math.sin(elapsed * config.frequency) * config.amplitude;
                    break;
                    
                case 'bounce':
                    bone.position.y = Math.sin(elapsed * config.frequency) * config.amplitude;
                    break;
                    
                case 'explaining':
                    const phase = elapsed * 2;
                    bone.rotation.x = config.baseRotation.x + Math.sin(phase) * 0.1;
                    bone.rotation.y = config.baseRotation.y + Math.sin(phase * 0.7) * 0.15;
                    bone.rotation.z = config.baseRotation.z + Math.sin(phase * 1.3) * 0.1;
                    break;
            }
            
            requestAnimationFrame(animate);
        };
        animate();
    }
    
    // === SPEECH SYSTEM ===
    
    startSpeaking(text, sentiment = 'neutral') {
        this.context.isSpeaking = true;
        this.context.lastSpeechTime = Date.now();
        this.context.speechIntensity = this.analyzeSpeechIntensity(text);
        
        // Update emotional state based on content
        this.updateEmotionalState(sentiment);
        
        // Switch to talking animation
        this.playAnimation('talking');
        
        // Schedule stop (estimate based on text length)
        const duration = Math.min(text.length * 50, 10000);
        setTimeout(() => this.stopSpeaking(), duration);
    }
    
    stopSpeaking() {
        this.context.isSpeaking = false;
        this.context.speechIntensity = 0;
        
        // Return to idle
        this.playAnimation('idle');
        
        // Clear lip-sync
        if (this.expressions?.aa) {
            this.expressions.aa.value = 0;
        }
    }
    
    analyzeSpeechIntensity(text) {
        // Analyze text to determine gesture intensity
        const exclamations = (text.match(/!/g) || []).length;
        const questions = (text.match(/\?/g) || []).length;
        const emphasis = (text.match(/[A-Z]{2,}/g) || []).length;
        
        const intensity = Math.min(1, (exclamations * 0.3 + questions * 0.2 + emphasis * 0.1));
        return intensity;
    }
    
    // === UTILITY FUNCTIONS ===
    
    lerp(a, b, t) {
        return a + (b - a) * t;
    }
    
    easeInOutQuad(t) {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }
    
    easeOutElastic(t) {
        const c4 = (2 * Math.PI) / 3;
        return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    }
    
    // === MAIN UPDATE LOOP ===
    
    animate() {
        requestAnimationFrame(() => this.animate());
        
        const deltaTime = this.clock.getDelta();
        
        if (this.vrm) {
            // Update VRM
            this.vrm.update(deltaTime);
            
            // Update animations
            this.updateAnimationState(deltaTime);
            
            // Update expressions
            this.updateExpressions(deltaTime);
            
            // Update blinking
            this.updateBlinking(deltaTime);
            
            // Update physics if spring bones exist
            if (this.vrm.springBoneManager) {
                this.vrm.springBoneManager.update(deltaTime);
            }
        }
        
        // Render scene
        this.renderer.render(this.scene, this.camera);
    }
    
    handleResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        
        this.renderer.setSize(width, height);
    }
    
    // === PUBLIC API ===
    
    wave() {
        this.performGesture('wave');
    }
    
    nod() {
        this.performGesture('nod');
    }
    
    shake() {
        this.performGesture('headShake');
    }
    
    think() {
        this.performGesture('thinking');
    }
    
    explain() {
        this.performGesture('explaining');
    }
    
    excited() {
        this.performGesture('excited');
    }
    
    shy() {
        this.performGesture('shy');
    }
    
    setMood(mood) {
        this.updateEmotionalState(mood);
    }
    
    lookAt(target) {
        if (this.vrm?.lookAt) {
            this.vrm.lookAt.target = target;
        }
    }
    
    dispose() {
        if (this.vrm) {
            this.scene.remove(this.vrm.scene);
            this.vrm.dispose();
        }
        
        this.renderer.dispose();
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
}
