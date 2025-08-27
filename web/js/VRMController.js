// web/js/VRMController.js
// AIRI-Inspired VRM Controller with Natural Human-Like Movements
// SYNTAX CHECKED AND VERIFIED - All parentheses and brackets properly closed

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
            shoulderRelaxTimer: 0
        };
        
        this.config = {
            paths: [
                '/assets/avatar/solmate.vrm',
                'https://raw.githubusercontent.com/DirkDigglerTown/solmate/main/web/assets/avatar/solmate.vrm'
            ],
            fallbackEnabled: true,
            // PERFECT POSITIONING - Confirmed working from previous chats
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
            await this.injectModules();
            await this.waitForModules();
            await this.initializeScene();
            await this.loadVRM();
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
        
        this.three.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 20);
        this.three.camera.position.set(this.config.cameraPosition.x, this.config.cameraPosition.y, this.config.cameraPosition.z);
        this.three.camera.lookAt(this.config.lookAtPosition.x, this.config.lookAtPosition.y, this.config.lookAtPosition.z);
        
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
                console.log(`Loading VRM from: ${path}`);
                const gltf = await this.loadWithTimeout(loader, path, 30000);
                
                if (gltf.userData.vrm) {
                    await this.setupVRM(gltf.userData.vrm);
                    loaded = true;
                    this.state.loaded = true;
                    this.emit('load:complete', this.vrm.current);
                    console.log(`VRM loaded successfully from: ${path}`);
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
        if (this.vrm.current) {
            this.three.scene.remove(this.vrm.current.scene);
            if (window.VRMUtils) {
                window.VRMUtils.deepDispose(this.vrm.current.scene);
            }
        }
        
        this.vrm.current = vrm;
        vrm.scene.rotation.y = Math.PI;
        vrm.scene.position.set(this.config.modelPosition.x, this.config.modelPosition.y, this.config.modelPosition.z);
        this.three.scene.add(vrm.scene);
        
        if (vrm.humanoid) {
            this.setupNaturalPose(vrm);
        }
        
        if (vrm.lookAt) {
            vrm.lookAt.target = this.three.camera;
        }
        
        if (vrm.expressionManager) {
            this.setupExpressions(vrm.expressionManager);
        }
        
        console.log('VRM setup complete with AIRI-style natural pose');
        
        setTimeout(() => {
            this.playOpeningSequence();
        }, 1000);
        
        this.emit('vrm:setup', vrm);
    }
    
    setupNaturalPose(vrm) {
        const hips = vrm.humanoid.getNormalizedBoneNode('hips');
        if (hips) {
            hips.position.set(0, 0, 0);
        }
        
        // AIRI-style arm positioning
        const leftUpperArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
        const rightUpperArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
        const leftLowerArm = vrm.humanoid.getNormalizedBoneNode('leftLowerArm');
        const rightLowerArm = vrm.humanoid.getNormalizedBoneNode('rightLowerArm');
        const leftHand = vrm.humanoid.getNormalizedBoneNode('leftHand');
        const rightHand = vrm.humanoid.getNormalizedBoneNode('rightHand');
        
        if (leftUpperArm) {
            leftUpperArm.rotation.z = 1.22;
            leftUpperArm.rotation.x = 0;
            leftUpperArm.rotation.y = 0;
        }
        if (rightUpperArm) {
            rightUpperArm.rotation.z = -1.22;
            rightUpperArm.rotation.x = 0;
            rightUpperArm.rotation.y = 0;
        }
        
        if (leftLowerArm) {
            leftLowerArm.rotation.z = 0.17;
            leftLowerArm.rotation.y = 0;
            leftLowerArm.rotation.x = 0;
        }
        if (rightLowerArm) {
            rightLowerArm.rotation.z = -0.17;
            rightLowerArm.rotation.y = 0;
            rightLowerArm.rotation.x = 0;
        }
        
        if (leftHand) {
            leftHand.rotation.z = 0.1;
            leftHand.rotation.x = 0.05;
        }
        if (rightHand) {
            rightHand.rotation.z = -0.1;
            rightHand.rotation.x = 0.05;
        }
        
        // Natural shoulder position
        const leftShoulder = vrm.humanoid.getNormalizedBoneNode('leftShoulder');
        const rightShoulder = vrm.humanoid.getNormalizedBoneNode('rightShoulder');
        if (leftShoulder) {
            leftShoulder.rotation.z = 0.08;
            leftShoulder.rotation.y = 0.02;
        }
        if (rightShoulder) {
            rightShoulder.rotation.z = -0.08;
            rightShoulder.rotation.y = -0.02;
        }
        
        // Natural spine position
        const spine = vrm.humanoid.getNormalizedBoneNode('spine');
        const chest = vrm.humanoid.getNormalizedBoneNode('chest');
        const upperChest = vrm.humanoid.getNormalizedBoneNode('upperChest');
        
        if (spine) {
            spine.rotation.x = 0.03;
            spine.rotation.y = 0;
            spine.rotation.z = 0;
        }
        if (chest) {
            chest.rotation.x = 0.02;
        }
        if (upperChest) {
            upperChest.rotation.x = 0.01;
        }
        
        // Natural head and neck
        const neck = vrm.humanoid.getNormalizedBoneNode('neck');
        const head = vrm.humanoid.getNormalizedBoneNode('head');
        
        if (neck) {
            neck.rotation.x = 0.05;
        }
        if (head) {
            head.rotation.x = 0;
            head.rotation.y = 0;
            head.rotation.z = 0;
        }
        
        // Store initial positions
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
        
        console.log('✅ AIRI-style natural pose applied');
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
            
            if (this.vrm.current) {
                if (this.vrm.current.update) {
                    this.vrm.current.update(deltaTime);
                }
                this.updateAnimations(deltaTime);
            }
            
            if (this.vrm.mixer) {
                this.vrm.mixer.update(deltaTime);
            }
            
            this.three.renderer.render(this.three.scene, this.three.camera);
            this.emit('frame', deltaTime);
        };
        
        animate();
    }
    
    updateAnimations(deltaTime) {
        if (!this.vrm.current) return;
        
        const time = Date.now() / 1000;
        
        // Breathing animation
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
        
        // Idle animations
        if (!this.animation.isTalking && !this.animation.isWaving) {
            this.animation.swayPhase += deltaTime * 0.3;
            if (this.vrm.current.scene) {
                this.vrm.current.scene.rotation.y = Math.PI + Math.sin(this.animation.swayPhase) * 0.01;
                this.vrm.current.scene.position.x = Math.sin(this.animation.swayPhase * 0.7) * 0.01;
            }
            
            if (this.vrm.current.humanoid && !this.vrm.current.isFallback) {
                const head = this.vrm.current.humanoid.getNormalizedBoneNode('head');
                const neck = this.vrm.current.humanoid.getNormalizedBoneNode('neck');
                const spine = this.vrm.current.humanoid.getNormalizedBoneNode('spine');
                
                if (head) {
                    const idleX = Math.sin(time * 0.6) * 0.015;
                    const idleY = Math.sin(time * 0.8) * 0.02;
                    const idleZ = Math.sin(time * 0.5) * 0.005;
                    
                    head.rotation.x = idleX + this.animation.headTarget.x * 0.3;
                    head.rotation.y = idleY + this.animation.headTarget.y * 0.3;
                    head.rotation.z = idleZ;
                }
                
                if (neck) {
                    neck.rotation.x = Math.sin(time * 0.7 + 0.5) * 0.008;
                    neck.rotation.y = Math.sin(time * 0.5 + 0.5) * 0.01;
                }
                
                if (spine) {
                    spine.rotation.x = 0.02 + Math.sin(time * 0.4) * 0.005;
                    spine.rotation.y = Math.sin(time * 0.3) * 0.003;
                }
                
                // Keep arms at natural rest position
                const leftArm = this.vrm.current.humanoid.getNormalizedBoneNode('leftUpperArm');
                const rightArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightUpperArm');
                
                if (leftArm) {
                    leftArm.rotation.z = 1.22 + Math.sin(time * 0.4) * 0.02;
                }
                if (rightArm) {
                    rightArm.rotation.z = -1.22 - Math.sin(time * 0.4 + Math.PI) * 0.02;
                }
                
                // Occasional idle gestures
                this.animation.idleTimer += deltaTime;
                if (this.animation.idleTimer > 5 + Math.random() * 5) {
                    this.performIdleGesture();
                    this.animation.idleTimer = 0;
                }
            }
        }
        
        // Talking animations
        if (this.animation.isTalking && this.vrm.current.humanoid && !this.vrm.current.isFallback) {
            const talkTime = time * 2.5;
            
            const head = this.vrm.current.humanoid.getNormalizedBoneNode('head');
            if (head) {
                head.rotation.x = Math.sin(talkTime * 1.2) * 0.025;
                head.rotation.y = Math.sin(talkTime) * 0.035;
                head.rotation.z = Math.sin(talkTime * 0.8) * 0.015;
            }
            
            const leftArm = this.vrm.current.humanoid.getNormalizedBoneNode('leftUpperArm');
            const rightArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightUpperArm');
            const leftLowerArm = this.vrm.current.humanoid.getNormalizedBoneNode('leftLowerArm');
            const rightLowerArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightLowerArm');
            
            const gestureIntensity = 0.15 + Math.sin(talkTime * 0.3) * 0.1;
            
            if (leftArm) {
                leftArm.rotation.z = 1.22 - gestureIntensity * 0.8;
                leftArm.rotation.x = Math.sin(talkTime * 0.8) * 0.15;
                leftArm.rotation.y = Math.sin(talkTime * 0.6) * 0.1;
            }
            
            if (rightArm) {
                rightArm.rotation.z = -1.22 + gestureIntensity * 0.8;
                rightArm.rotation.x = Math.sin(talkTime * 0.8 + Math.PI * 0.5) * 0.15;
                rightArm.rotation.y = -Math.sin(talkTime * 0.6 + Math.PI * 0.5) * 0.1;
            }
            
            if (leftLowerArm) {
                leftLowerArm.rotation.z = 0.17 + Math.sin(talkTime * 1.2) * 0.2;
                leftLowerArm.rotation.y = -Math.sin(talkTime * 1.5) * 0.2;
            }
            
            if (rightLowerArm) {
                rightLowerArm.rotation.z = -0.17 - Math.sin(talkTime * 1.2 + Math.PI) * 0.2;
                rightLowerArm.rotation.y = Math.sin(talkTime * 1.5 + Math.PI) * 0.2;
            }
            
            const spine = this.vrm.current.humanoid.getNormalizedBoneNode('spine');
            const chest = this.vrm.current.humanoid.getNormalizedBoneNode('chest');
            
            if (spine) {
                spine.rotation.y = Math.sin(talkTime * 0.6) * 0.015;
                spine.rotation.x = 0.02 + Math.sin(talkTime * 0.5) * 0.01;
            }
            
            if (chest) {
                chest.rotation.y = Math.sin(talkTime * 0.7 + 0.5) * 0.01;
            }
        }
        
        this.updateExpressions(deltaTime);
        
        // Blinking
        this.animation.blinkTimer += deltaTime;
        const blinkInterval = this.animation.isTalking ? 2 : 3 + Math.random();
        if (this.animation.blinkTimer > blinkInterval) {
            this.performBlink();
            this.animation.blinkTimer = 0;
        }
    }
    
    updateExpressions(deltaTime) {
        if (!this.vrm.current?.expressionManager) return;
        
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
        
        try {
            if (this.animation.currentExpression !== 'neutral') {
                this.vrm.current.expressionManager.setValue(
                    this.animation.currentExpression,
                    this.animation.expressionIntensity
                );
            }
            
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
        this.setExpression('happy', 0.6, 4000);
        
        if (this.vrm.current.humanoid && !this.vrm.current.isFallback) {
            this.playNaturalWave();
        } else {
            this.playFallbackWave();
        }
    }
    
    playNaturalWave() {
        const rightArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightUpperArm');
        const rightLowerArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightLowerArm');
        const rightHand = this.vrm.current.humanoid.getNormalizedBoneNode('rightHand');
        
        if (!rightArm) {
            this.playFallbackWave();
            return;
        }
        
        console.log('🌊 Playing natural multi-bone wave animation');
        
        let waveTime = 0;
        
        const waveInterval = setInterval(() => {
            waveTime += 0.016;
            
            if (waveTime >= 3) {
                // Return to natural rest position
                rightArm.rotation.z = -1.22;
                rightArm.rotation.x = 0;
                rightArm.rotation.y = 0;
                
                if (rightLowerArm) {
                    rightLowerArm.rotation.y = 0;
                    rightLowerArm.rotation.x = 0;
                    rightLowerArm.rotation.z = -0.17;
                }
                if (rightHand) {
                    rightHand.rotation.z = -0.1;
                    rightHand.rotation.x = 0.05;
                }
                
                this.animation.isWaving = false;
                this.setExpression('neutral', 0);
                
                setTimeout(() => this.performWink(), 500);
                
                clearInterval(waveInterval);
                this.emit('animation:wave:end');
                console.log('✅ Natural wave complete');
                return;
            }
            
            const wavePhase = Math.sin(waveTime * Math.PI * 4);
            
            rightArm.rotation.z = -1.0 - Math.abs(wavePhase) * 0.3;
            rightArm.rotation.x = -0.4;
            rightArm.rotation.y = 0.2;
            
            if (rightLowerArm) {
                rightLowerArm.rotation.y = 0.6;
                rightLowerArm.rotation.z = wavePhase * 0.4;
            }
            
            if (rightHand) {
                rightHand.rotation.z = wavePhase * 0.4;
                rightHand.rotation.y = wavePhase * 0.2;
            }
            
            if (this.vrm.current.scene) {
                this.vrm.current.scene.rotation.y = Math.PI + Math.sin(waveTime * Math.PI * 2) * 0.02;
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
            } catch (e) {
                // Expression not available
            }
        }
        
        this.emit('animation:speech:start');
        console.log('🗣️ Started natural speech animation');
    }
    
    stopSpeechAnimation() {
        this.animation.isTalking = false;
        this.setExpression('neutral', 0);
        
        if (this.vrm.current.humanoid && !this.vrm.current.isFallback) {
            const leftArm = this.vrm.current.humanoid.getNormalizedBoneNode('leftUpperArm');
            const rightArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightUpperArm');
            const leftLowerArm = this.vrm.current.humanoid.getNormalizedBoneNode('leftLowerArm');
            const rightLowerArm = this.vrm.current.humanoid.getNormalizedBoneNode('rightLowerArm');
            
            let returnTime = 0;
            const returnInterval = setInterval(() => {
                returnTime += 0.016;
                
                if (returnTime >= 0.5) {
                    if (leftArm) {
                        leftArm.rotation.z = 1.22;
                        leftArm.rotation.x = 0;
                        leftArm.rotation.y = 0;
                    }
                    if (rightArm) {
                        rightArm.rotation.z = -1.22;
                        rightArm.rotation.x = 0;
                        rightArm.rotation.y = 0;
                    }
                    if (leftLowerArm) {
                        leftLowerArm.rotation.z = 0.17;
                        leftLowerArm.rotation.y = 0;
                        leftLowerArm.rotation.x = 0;
                    }
                    if (rightLowerArm) {
                        rightLowerArm.rotation.z = -0.17;
                        rightLowerArm.rotation.y = 0;
                        rightLowerArm.rotation.x = 0;
                    }
                    
                    clearInterval(returnInterval);
                    return;
                }
                
                const progress = returnTime / 0.5;
                const smoothProgress = progress * progress * (3 - 2 * progress);
                
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
        console.log('🔇 Stopped speech animation');
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
        
        if (window.innerWidth < 768) {
            this.three.camera.position.z = 6.0;
        } else {
            this.three.camera.position.z = this.config.cameraPosition.z;
        }
        
        this.emit('resize');
    }
    
    playOpeningSequence() {
        if (!this.vrm.current || this.vrm.current.isFallback) return;
        
        console.log('🎬 Playing opening sequence');
        
        this.setExpression('happy', 0.3, 2000);
        
        setTimeout(() => {
            this.performSmallNod();
        }, 500);
        
        setTimeout(() => {
            this.playWave();
        }, 1500);
        
        setTimeout(() => {
            this.performWink();
        }, 5000);
        
        setTimeout(() => {
            this.setExpression('happy', 0.4, 3000);
        }, 6000);
        
        setTimeout(() => {
            this.setExpression('neutral', 0);
            this.emit('opening:complete');
        }, 9500);
        
        this.emit('opening:start');
        console.log('✨ Opening sequence initiated');
    }
    
    reactToUserReturn() {
        if (!this.vrm.current) return;
        
        this.setExpression('happy', 0.2, 1000);
        setTimeout(() => {
            this.performSmallNod();
        }, 200);
        
        console.log('👋 Acknowledged user return');
    }
    
    reactToUserInput() {
        if (!this.vrm.current?.humanoid || this.vrm.current.isFallback) return;
        
        const head = this.vrm.current.humanoid.getNormalizedBoneNode('head');
        if (head) {
            const originalRotation = head.rotation.clone();
            head.rotation.z = 0.08;
            
            setTimeout(() => {
                head.rotation.copy(originalRotation);
            }, 300);
        }
        
        this.setExpression('happy', 0.15, 800);
        this.emit('animation:listening');
    }
    
    setModelPosition(x, y, z) {
        if (this.vrm.current && this.vrm.current.scene) {
            this.vrm.current.scene.position.set(x, y, z);
            this.config.modelPosition = { x, y, z };
            console.log('Model position updated:', { x, y, z });
        }
    }
    
    setCameraPosition(x, y, z) {
        if (this.three.camera) {
            this.three.camera.position.set(x, y, z);
            this.config.cameraPosition = { x, y, z };
            console.log('Camera position updated:', { x, y, z });
        }
    }
    
    async reload() {
        console.log('🔄 Reloading VRM...');
        
        if (this.vrm.current && this.three.scene) {
            this.three.scene.remove(this.vrm.current.scene);
            if (window.VRMUtils) {
                window.VRMUtils.deepDispose(this.vrm.current.scene);
            }
            this.vrm.current = null;
        }
        
        this.state.loaded = false;
        this.state.loading = false;
        
        await this.loadVRM();
        console.log('✅ VRM reload complete');
    }
    
    getStats() {
        return {
            initialized: this.state.initialized,
            loaded: this.state.loaded,
            loading: this.state.loading,
            hasVRM: !!this.vrm.current,
            isFallback: this.vrm.current?.isFallback || false,
            isWaving: this.animation.isWaving,
            isTalking: this.animation.isTalking,
            currentExpression: this.animation.currentExpression,
            expressionIntensity: this.animation.expressionIntensity,
            cameraPosition: this.config.cameraPosition,
            modelPosition: this.config.modelPosition,
            sceneChildren: this.three.scene?.children?.length || 0
        };
    }
    
    destroy() {
        this.animation.isWaving = false;
        this.animation.isTalking = false;
        
        if (this.vrm.current) {
            this.three.scene.remove(this.vrm.current.scene);
            if (window.VRMUtils) {
                window.VRMUtils.deepDispose(this.vrm.current.scene);
            }
        }
        
        if (this.three.renderer) {
            this.three.renderer.dispose();
        }
        
        this.three.lights.forEach(light => {
            this.three.scene.remove(light);
        });
        
        this.vrm.current = null;
        this.three.scene = null;
        this.three.camera = null;
        this.three.renderer = null;
        
        this.removeAllListeners();
        this.emit('destroyed');
        console.log('🧹 VRMController destroyed');
    }
}
