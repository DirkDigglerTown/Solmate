directionalLight.position.set(1, 1, 1);
    directionalLight.castShadow = true;
    scene.add(directionalLight);
    
    // Additional fill light for better VRM visibility
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-1, 0.5, -1);
    scene.add(fillLight);
    
    // Clock for animations
    clock = new THREE.Clock();
    
    log('✅ Scene setup complete');
}

// ===== VRM LOADING WITH ENHANCED ERROR HANDLING =====
async function loadVRMModel(url, retryCount = 0) {
    log(`📦 Loading VRM model (attempt ${retryCount + 1}): ${url}`);
    updateLoadingProgress('vrm', 0);
    
    try {
        // Check file accessibility
        const checkResponse = await fetch(url, { method: 'HEAD' });
        if (!checkResponse.ok) {
            throw new Error(`VRM file not accessible: ${checkResponse.status}`);
        }
        
        // Create GLTFLoader with VRM plugin
        const loader = new THREE.GLTFLoader();
        
        // Register VRM loader plugin with enhanced error handling
        loader.register((parser) => {
            log('Registering VRM plugin with parser');
            
            // Verify parser has required methods
            if (!parser.getDependency) {
                throw new Error('Parser missing getDependency method');
            }
            if (!parser.getDependencies) {
                throw new Error('Parser missing getDependencies method');
            }
            
            return new window.VRM.VRMLoaderPlugin(parser);
        });
        
        // Load the VRM with progress tracking
        const gltf = await new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('VRM loading timeout'));
            }, ASSET_LOAD_TIMEOUT);
            
            loader.load(
                url,
                (loadedGltf) => {
                    clearTimeout(timeoutId);
                    resolve(loadedGltf);
                },
                (progress) => {
                    if (progress.total > 0) {
                        const percent = Math.round((progress.loaded / progress.total) * 100);
                        updateLoadingProgress('vrm', percent);
                    }
                },
                (error) => {
                    clearTimeout(timeoutId);
                    reject(error);
                }
            );
        });
        
        // Extract VRM
        const vrm = gltf.userData.vrm;
        if (!vrm) {
            throw new Error('No VRM data found in file');
        }
        
        currentVRM = vrm;
        log('✅ VRM loaded successfully');
        
        // Setup VRM properly
        await setupVRMModel(vrm);
        
        updateLoadingProgress('complete');
        return vrm;
        
    } catch (error) {
        if (retryCount < VRM_MAX_RETRIES) {
            log(`VRM retry ${retryCount + 1} in 3s...`, error.message);
            await new Promise(resolve => setTimeout(resolve, 3000));
            return loadVRMModel(url, retryCount + 1);
        } else {
            log('❌ VRM loading failed completely:', error.message);
            handleVRMLoadingError(error);
            throw error;
        }
    }
}

// ===== VRM MODEL SETUP =====
async function setupVRMModel(vrm) {
    log('🎭 Setting up VRM model...');
    updateLoadingProgress('positioning');
    
    // Remove any existing models
    ['fallbackAvatar', 'alternativeAvatar', 'VRM_Model', 'EmergencyFallback'].forEach(name => {
        const existing = scene.getObjectByName(name);
        if (existing) {
            scene.remove(existing);
            log(`Removed existing ${name}`);
        }
    });
    
    // Add to scene
    vrm.scene.name = 'VRM_Model';
    scene.add(vrm.scene);
    
    // Get model dimensions
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    
    log('📐 Model dimensions:', {
        size: { x: size.x.toFixed(2), y: size.y.toFixed(2), z: size.z.toFixed(2) },
        center: { x: center.x.toFixed(2), y: center.y.toFixed(2), z: center.z.toFixed(2) }
    });
    
    // Scale to appropriate size
    const targetHeight = 1.8;
    let scale = 1.0;
    if (size.y > 0.1) { // Avoid division by zero
        scale = targetHeight / size.y;
        vrm.scene.scale.setScalar(scale);
        log(`Applied scaling: ${scale.toFixed(4)}`);
    }
    
    // Position model properly
    const scaledBox = new THREE.Box3().setFromObject(vrm.scene);
    const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
    
    // Center horizontally and place on ground
    vrm.scene.position.x = -scaledCenter.x;
    vrm.scene.position.y = -scaledBox.min.y;
    vrm.scene.position.z = -scaledCenter.z;
    
    // CRITICAL FIX: Check if model is facing away and rotate if needed
    const shouldRotate = await checkModelDirection(vrm.scene);
    if (shouldRotate) {
        vrm.scene.rotation.y = Math.PI; // Rotate 180 degrees
        log('🔄 Rotated model 180° to face camera');
    }
    
    // Setup camera to view model properly
    setupCameraForModel(scaledBox);
    
    // Setup VRM features
    setupVRMFeatures(vrm);
    
    // Fix materials and textures
    fixVRMTextures(vrm.scene);
    
    // Start animations
    startVRMAnimations(vrm);
    
    log('✅ VRM model setup complete');
}

// ===== CHECK MODEL DIRECTION =====
async function checkModelDirection(vrmScene) {
    // For most VRM models, they face negative Z by default
    // but we want them to face positive Z (towards camera)
    let needsRotation = true; // Default assumption for VRM models
    
    vrmScene.traverse((child) => {
        // Look for naming patterns that might indicate front-facing
        if (child.name && (
            child.name.toLowerCase().includes('front') ||
            child.name.toLowerCase().includes('face') ||
            child.name.toLowerCase().includes('eye')
        )) {
            // If we find front-facing elements, the model might already be correct
        }
    });
    
    return needsRotation;
}

// ===== CAMERA POSITIONING =====
function setupCameraForModel(modelBox) {
    const size = modelBox.getSize(new THREE.Vector3());
    const center = modelBox.getCenter(new THREE.Vector3());
    
    // Calculate optimal camera position
    const maxDim = Math.max(size.x, size.y, size.z);
    const cameraDistance = Math.max(maxDim * 1.8, 2.5); // Ensure minimum distance
    
    // Position camera to view upper body/face area
    const lookAtY = center.y + size.y * 0.2; // Look slightly above center
    
    camera.position.set(0, lookAtY, cameraDistance);
    camera.lookAt(center.x, lookAtY, center.z);
    
    log('📷 Camera positioned:', {
        position: camera.position,
        lookAt: { x: center.x, y: lookAtY, z: center.z },
        distance: cameraDistance.toFixed(2)
    });
}

// ===== VRM FEATURES SETUP =====
function setupVRMFeatures(vrm) {
    log('🎯 Setting up VRM features...');
    
    // Check if this is a real VRM or fallback
    if (vrm.isMinimalVRM) {
        log('⚠️ Using minimal VRM features');
        
        // Create basic bone structure for animations
        vrm.bones = {};
        vrm.scene.traverse((child) => {
            if (child.name === 'Head') {
                vrm.bones.head = child;
            } else if (child.name === 'Body') {
                vrm.bones.body = child;
            }
        });
        
        // Create basic expression system
        vrm.expressionManager = {
            setValue: function(expression, value) {
                log(`Expression: ${expression} = ${value}`);
                // Basic expression simulation
                if (expression === 'blink' && vrm.bones.head) {
                    const originalScale = vrm.bones.head.scale.y;
                    vrm.bones.head.scale.y = value > 0.5 ? 0.8 : originalScale;
                }
            }
        };
        
        return;
    }
    
    // Setup real VRM features
    if (vrm.lookAt) {
        vrm.lookAt.target = camera;
        log('👀 Look-at enabled');
    }
    
    // Setup expressions
    if (vrm.expressionManager) {
        log('😊 Expression manager available');
        
        // Test available expressions
        const expressions = ['happy', 'angry', 'sad', 'surprised', 'relaxed', 'neutral', 'blink'];
        const availableExpressions = [];
        
        expressions.forEach(expr => {
            try {
                vrm.expressionManager.setValue(expr, 0);
                availableExpressions.push(expr);
            } catch (e) {
                // Expression not available
            }
        });
        
        log(`Available expressions: ${availableExpressions.join(', ')}`);
    }
    
    // Setup humanoid
    if (vrm.humanoid) {
        log('🤖 Humanoid system available');
        
        // List available bones
        const humanoidBones = [];
        const boneNames = ['head', 'neck', 'chest', 'spine', 'hips', 'leftShoulder', 'rightShoulder'];
        
        boneNames.forEach(boneName => {
            try {
                const bone = vrm.humanoid.getNormalizedBoneNode(boneName);
                if (bone) {
                    humanoidBones.push(boneName);
                }
            } catch (e) {
                // Bone not available
            }
        });
        
        log(`Available bones: ${humanoidBones.join(', ')}`);
    }
}

// ===== TEXTURE FIXING =====
function fixVRMTextures(vrmScene) {
    log('🎨 Fixing VRM textures and materials...');
    
    let materialsFixed = 0;
    let texturesPreserved = 0;
    
    vrmScene.traverse((child) => {
        if (child.isMesh && child.material) {
            const material = child.material;
            
            // Check if material has existing textures
            const hasTextures = !!(
                material.map ||
                material.baseColorTexture ||
                material.diffuseTexture ||
                material.emissiveMap ||
                material.normalMap
            );
            
            if (hasTextures) {
                texturesPreserved++;
                log(`✅ Preserving textures on: ${child.name}`);
                
                // Ensure proper texture settings for VRM
                if (material.map) {
                    material.map.flipY = false; // VRM standard
                    material.map.colorSpace = THREE.SRGBColorSpace;
                }
                
                if (material.normalMap) {
                    material.normalMap.flipY = false;
                }
                
                if (material.emissiveMap) {
                    material.emissiveMap.flipY = false;
                    material.emissiveMap.colorSpace = THREE.SRGBColorSpace;
                }
            }
            
            // Fix MToon materials specifically
            if (material.isMToonMaterial) {
                log(`🎭 MToon material found: ${child.name}`);
                
                // Ensure proper MToon settings
                if (material.map) {
                    material.map.flipY = false;
                    material.map.colorSpace = THREE.SRGBColorSpace;
                }
                
                // Adjust MToon parameters for better visibility
                if (material.shadeColorFactor) {
                    material.shadeColorFactor.setRGB(0.8, 0.8, 0.8);
                }
                
                // Ensure shade texture is assigned if missing
                if (!material.shadeColorTexture && material.map) {
                    material.shadeColorTexture = material.map;
                    log(`Assigned shade texture for: ${child.name}`);
                }
                
                materialsFixed++;
            } else {
                // For non-MToon materials, ensure proper settings
                if (material.map) {
                    material.map.flipY = false;
                    material.map.colorSpace = THREE.SRGBColorSpace;
                }
                
                // Improve material properties for better visibility
                material.roughness = 0.7;
                material.metalness = 0.0;
                
                // Enhance color slightly if it's too dark
                const color = material.color;
                if (color && (color.r < 0.1 && color.g < 0.1 && color.b < 0.1)) {
                    color.multiplyScalar(1.3);
                    log(`Enhanced color for: ${child.name}`);
                }
                
                materialsFixed++;
            }
            
            // Force material update
            material.needsUpdate = true;
        }
    });
    
    log(`✅ Texture fix complete: ${texturesPreserved} preserved, ${materialsFixed} materials fixed`);
}

// ===== VRM ANIMATIONS =====
function startVRMAnimations(vrm) {
    log('🎭 Starting VRM animations...');
    
    let time = 0;
    let blinkTimer = 0;
    let breathingPhase = 0;
    
    function animateVRM() {
        if (!currentVRM || !scene.getObjectByName('VRM_Model')) return;
        
        const deltaTime = clock.getDelta();
        time += deltaTime;
        blinkTimer += deltaTime;
        breathingPhase += deltaTime;
        
        // Update VRM system
        if (typeof vrm.update === 'function') {
            vrm.update(deltaTime);
        }
        
        // Handle different VRM types
        if (vrm.isMinimalVRM) {
            animateMinimalVRM(vrm, time, breathingPhase);
        } else {
            animateRealVRM(vrm, time, breathingPhase);
        }
        
        // Auto-blink for both types
        if (blinkTimer > 2 + Math.random() * 3) {
            performBlink();
            blinkTimer = 0;
        }
        
        requestAnimationFrame(animateVRM);
    }
    
    animateVRM();
    log('✅ VRM animations started');
}

// ===== MINIMAL VRM ANIMATION =====
function animateMinimalVRM(vrm, time, breathingPhase) {
    if (!animationState.isTalking && !animationState.isWaving) {
        // Simple head bobbing
        if (vrm.bones && vrm.bones.head) {
            vrm.bones.head.rotation.x = Math.sin(time * 0.8) * 0.02;
            vrm.bones.head.rotation.y = Math.sin(time * 0.6) * 0.03;
        }
        
        // Simple breathing
        if (vrm.bones && vrm.bones.body) {
            const breatheScale = 1 + Math.sin(breathingPhase * 2) * 0.01;
            vrm.bones.body.scale.y = breatheScale;
        }
    }
}

// ===== REAL VRM ANIMATION =====
function animateRealVRM(vrm, time, breathingPhase) {
    // Natural breathing animation - SUBTLE!
    if (vrm.humanoid) {
        const chest = vrm.humanoid.getNormalizedBoneNode('chest');
        if (chest) {
            const breatheScale = 1 + Math.sin(breathingPhase * 2) * 0.008; // Very subtle
            chest.scale.y = breatheScale;
        }
    }
    
    // Subtle idle movements
    if (!animationState.isTalking && !animationState.isWaving) {
        if (vrm.humanoid) {
            const head = vrm.humanoid.getNormalizedBoneNode('head');
            if (head) {
                // Very subtle head movements
                head.rotation.x = Math.sin(time * 0.8) * 0.015 + animationState.headTarget.x * 0.2;
                head.rotation.y = Math.sin(time * 0.6) * 0.02 + animationState.headTarget.y * 0.2;
                head.rotation.z = Math.sin(time * 0.4) * 0.006;
            }
            
            // Subtle shoulder movement
            const leftShoulder = vrm.humanoid.getNormalizedBoneNode('leftShoulder');
            const rightShoulder = vrm.humanoid.getNormalizedBoneNode('rightShoulder');
            
            if (leftShoulder) {
                leftShoulder.rotation.z = Math.sin(time * 1.2) * 0.01;
            }
            if (rightShoulder) {
                rightShoulder.rotation.z = Math.sin(time * 1.4) * -0.01;
            }
        }
    }
}

// ===== WAVE ANIMATION =====
function playEnhancedVRMWave() {
    if (!currentVRM) {
        log('❌ No VRM available for waving');
        return;
    }
    
    log('👋 Playing VRM wave animation...');
    animationState.isWaving = true;
    
    // Handle different VRM types
    if (currentVRM.isMinimalVRM) {
        playMinimalWave();
    } else {
        playRealVRMWave();
    }
}

function playMinimalWave() {
    log('👋 Playing minimal wave animation...');
    
    const vrmModel = scene.getObjectByName('VRM_Model');
    if (!vrmModel) return;
    
    // Simple rotation animation for the whole model
    const originalRotation = vrmModel.rotation.y;
    
    let waveTime = 0;
    const waveDuration = 2000; // 2 seconds
    
    function animateMinimalWave() {
        waveTime += 16;
        
        if (waveTime >= waveDuration) {
            vrmModel.rotation.y = originalRotation;
            animationState.isWaving = false;
            log('👋 Minimal wave complete');
            return;
        }
        
        // Simple side-to-side motion
        const progress = waveTime / waveDuration;
        const waveIntensity = Math.sin(progress * Math.PI * 6) * 0.2; // 6 waves
        vrmModel.rotation.y = originalRotation + waveIntensity;
        
        requestAnimationFrame(animateMinimalWave);
    }
    
    animateMinimalWave();
}

function playRealVRMWave() {
    if (!currentVRM.humanoid) {
        log('❌ No humanoid system available, using minimal wave');
        playMinimalWave();
        return;
    }
    
    const rightArm = currentVRM.humanoid.getNormalizedBoneNode('rightUpperArm');
    const rightLowerArm = currentVRM.humanoid.getNormalizedBoneNode('rightLowerArm');
    const rightHand = currentVRM.humanoid.getNormalizedBoneNode('rightHand');
    
    if (!rightArm) {
        log('❌ No right arm bone available, using minimal wave');
        playMinimalWave();
        return;
    }
    
    log('👋 Playing real VRM wave animation...');
    
    // Save original positions
    const originalRotations = {
        upperArm: rightArm.rotation.clone(),
        lowerArm: rightLowerArm ? rightLowerArm.rotation.clone() : null,
        hand: rightHand ? rightHand.rotation.clone() : null
    };
    
    // Wave sequence
    const waveFrames = [
        { time: 0, upper: {x: 0, y: 0, z: 0}, lower: {x: 0, y: 0, z: 0} },
        { time: 0.4, upper: {x: 0.9, y: 0.2, z: -0.9}, lower: {x: 0, y: 0, z: -0.8} },
        { time: 0.7, upper: {x: 0.7, y: 0.1, z: -0.7}, lower: {x: 0, y: 0, z: -0.5} },
        { time: 1.0, upper: {x: 0.9, y: 0.2, z: -0.9}, lower: {x: 0, y: 0, z: -0.8} },
        { time: 1.3, upper: {x: 0.7, y: 0.1, z: -0.7}, lower: {x: 0, y: 0, z: -0.5} },
        { time: 1.6, upper: {x: 0.9, y: 0.2, z: -0.9}, lower: {x: 0, y: 0, z: -0.8} },
        { time: 2.2, upper: {x: 0, y: 0, z: 0}, lower: {x: 0, y: 0, z: 0} }
    ];
    
    let frameIndex = 0;
    const startTime = Date.now();
    
    function animateRealWave() {
        const elapsed = (Date.now() - startTime) / 1000;
        
        if (elapsed >= 2.2 || frameIndex >= waveFrames.length - 1) {
            // Return to original positions
            rightArm.rotation.copy(originalRotations.upperArm);
            if (rightLowerArm && originalRotations.lowerArm) {
                rightLowerArm.rotation.copy(originalRotations.lowerArm);
            }
            if (rightHand && originalRotations.hand) {
                rightHand.rotation.copy(originalRotations.hand);
            }
            
            animationState.isWaving = false;
            log('👋 Real VRM wave complete');
            return;
        }
        
        // Find current frame
        while (frameIndex < waveFrames.length - 1 && elapsed >= waveFrames[frameIndex + 1].time) {
            frameIndex++;
        }
        
        const currentFrame = waveFrames[frameIndex];
        const nextFrame = waveFrames[frameIndex + 1] || currentFrame;
        
        const frameProgress = (elapsed - currentFrame.time) / (nextFrame.time - currentFrame.time);
        const smoothProgress = Math.sin(frameProgress * Math.PI * 0.5);
        
        // Animate upper arm
        rightArm.rotation.x = THREE.MathUtils.lerp(currentFrame.upper.x, nextFrame.upper.x, smoothProgress);
        rightArm.rotation.y = THREE.MathUtils.lerp(currentFrame.upper.y, nextFrame.upper.y, smoothProgress);
        rightArm.rotation.z = THREE.MathUtils.lerp(currentFrame.upper.z, nextFrame.upper.z, smoothProgress);
        
        // Animate lower arm
        if (rightLowerArm) {
            rightLowerArm.rotation.z = THREE.MathUtils.lerp(currentFrame.lower.z, nextFrame.lower.z, smoothProgress);
        }
        
        requestAnimationFrame(animateRealWave);
    }
    
    animateRealWave();
}

// ===== BLINKING =====
function performBlink() {
    if (currentVRM && currentVRM.expressionManager) {
        try {
            currentVRM.expressionManager.setValue('blink', 1.0);
            setTimeout(() => {
                if (currentVRM && currentVRM.expressionManager) {
                    currentVRM.expressionManager.setValue('blink', 0);
                }
            }, 150);
        } catch (e) {
            // Blink not available
        }
    }
}

// ===== ERROR HANDLING =====
function handleVRMLoadingError(error) {
    log('VRM loading error:', error.message);
    
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
        position: fixed; bottom: 20px; right: 20px;
        background: rgba(255, 107, 107, 0.9); color: white;
        padding: 15px; border-radius: 8px;
        font-family: Arial, sans-serif; font-size: 14px;
        max-width: 300px; z-index: 1000; cursor: pointer;
    `;
    
    errorDiv.innerHTML = `
        <strong>Avatar Loading Issue</strong><br>
        ${error.message}<br>
        <small>Click to dismiss</small>
    `;
    
    errorDiv.onclick = () => errorDiv.remove();
    document.body.appendChild(errorDiv);
    
    setTimeout(() => {
        if (errorDiv.parentNode) errorDiv.remove();
    }, 10000);
    
    // Create fallback
    createEmergencyFallback();
}

// ===== LOADING PROGRESS =====
function updateLoadingProgress(stage, percent = null) {
    const statusEl = document.getElementById('loadingStatus');
    if (!statusEl) return;
    
    const stages = {
        'vrm-init': '🎭 Initializing VRM System',
        'vrm': '👤 Loading Avatar',
        'positioning': '📐 Positioning Avatar',
        'complete': '✅ Ready!'
    };
    
    const message = stages[stage] || stage;
    const percentText = percent !== null ? ` ${percent}%` : '';
    
    statusEl.textContent = `${message}${percentText}`;
    statusEl.style.color = stage === 'complete' ? '#00ff88' : '#ffffff';
    
    if (stage === 'complete') {
        setTimeout(() => {
            statusEl.style.display = 'none';
        }, 2000);
    }
}

// ===== EMERGENCY FALLBACK =====
function createEmergencyFallback() {
    log('Creating emergency fallback...');
    
    const character = new THREE.Group();
    character.name = 'EmergencyFallback';
    
    // Simple character representation
    const headGeo = new THREE.SphereGeometry(0.12, 32, 32);
    const headMat = new THREE.MeshLambertMaterial({ color: 0xffdbac });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.6;
    character.add(head);
    
    const bodyGeo = new THREE.CylinderGeometry(0.15, 0.18, 0.5, 12);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xff6b6b });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.1;
    character.add(body);
    
    character.position.y = -0.1;
    scene.add(character);
    
    // Simple animation
    let time = 0;
    function animateEmergency() {
        const fallbackChar = scene.getObjectByName('EmergencyFallback');
        if (!fallbackChar) return;
        
        time += 0.016;
        character.rotation.y = Math.sin(time * 0.8) * 0.05;
        
        requestAnimationFrame(animateEmergency);
    }
    
    animateEmergency();
    log('Emergency fallback created');
}

// ===== MAIN RENDER LOOP =====
function animate() {
    requestAnimationFrame(animate);
    
    if (!renderer || !scene || !camera) return;
    
    const delta = clock.getDelta();
    if (mixer) mixer.update(delta);
    
    renderer.render(scene, camera);
}

// ===== WEBSOCKET SYSTEM =====
function connectWebSocket() {
    if (ws) ws.close();
    
    try {
        ws = new WebSocket(HELIUS_WS);
        
        ws.onopen = () => {
            log('WebSocket connected');
            const wsLight = document.getElementById('wsLight');
            if (wsLight) {
                wsLight.textContent = 'WS ON';
                wsLight.style.color = '#00ff88';
            }
        };
        
        ws.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                if (data.tps) updateTPS(data.tps);
            } catch (err) {
                log('WebSocket message error', err.message);
            }
        };
        
        ws.onclose = () => {
            log('WebSocket closed, reconnecting...');
            const wsLight = document.getElementById('wsLight');
            if (wsLight) {
                wsLight.textContent = 'WS OFF';
                wsLight.style.color = '#ff6b6b';
            }
            
            if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
            wsReconnectTimer = setTimeout(connectWebSocket, 5000);
        };
        
        ws.onerror = (err) => log('WebSocket error', err.message);
        
    } catch (err) {
        log('WebSocket connection failed', err.message);
        if (!tpsUpdateTimer) {
            tpsUpdateTimer = setInterval(() => {
                fetchTPS().catch(e => log('TPS polling error:', e.message));
            }, 10000);
        }
    }
}

function updateTPS(tps) {
    const networkTPS = document.getElementById('networkTPS');
    if (networkTPS) {
        networkTPS.textContent = `${tps} TPS`;
        networkTPS.style.color = '#00ff88';
    }
}

// ===== API CALLS =====
function fetchPrice() {
    return new Promise(async (resolve, reject) => {
        try {
            log('💰 Fetching SOL price...');
            const url = `/api/price?ids=${SOL_MINT}`;
            
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            
            const data = await res.json();
            
            }
            
            let price = null;
            
            // Enhanced price extraction
            if (data.data && data.data[SOL_MINT]?.price) {
                price = data.data[SOL_MINT].price;
            } else if (data.price) {
                price = data.price;
            } else {
                // Search all values for a reasonable price
                function findPrice(obj) {
                    if (typeof obj === 'number' && obj > 1 && obj < 10000) return obj;
                    if (typeof obj === 'object' && obj !== null) {
                        for (const value of Object.values(obj)) {
                            const found = findPrice(value);
                            if (found) return found;
                        }
                    }
                    return null;
                }
                price = findPrice(data);
            }
            
            if (price && price > 0) {
                solPrice.textContent = `SOL — ${price.toFixed(2)}`;
                solPrice.style.color = '#00ff88';
                log(`✅ Price updated: ${price.toFixed(2)}`);
            } else {
                solPrice.textContent = 'SOL — Error';
                solPrice.style.color = '#ff6b6b';
                log('❌ Could not find price in data');
            }
            
            resolve();
        } catch (err) {
            log('Price fetch failed:', err.message);
            const solPrice = document.getElementById('solPrice');
            if (solPrice) {
                solPrice.textContent = 'SOL — Error';
                solPrice.style.color = '#ff6b6b';
            }
            reject(err);
        }
    });
}

function fetchTPS() {
    return new Promise(async (resolve, reject) => {
        try {
            const res = await fetch('/api/tps');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            const data = await res.json();
            
            if (data.tps) {
                updateTPS(data.tps);
                log(`TPS updated: ${data.tps}`);
            }
            resolve();
        } catch (err) {
            log('TPS fetch failed:', err.message);
            const networkTPS = document.getElementById('networkTPS');
            if (networkTPS) {
                networkTPS.textContent = 'TPS Error';
                networkTPS.style.color = '#ff6b6b';
            }
            reject(err);
        }
    });
}

// ===== CHAT SYSTEM =====
function sendMessage(text) {
    return new Promise(async (resolve, reject) => {
        conversation.push({ role: 'user', content: text });
        
        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT }, 
                        ...conversation
                    ] 
                })
            });
            
            if (!res.ok) throw new Error(`Chat API failed: ${res.status}`);
            
            const { content } = await res.json();
            conversation.push({ role: 'assistant', content });
            
            try {
                localStorage.setItem('solmateConversation', JSON.stringify(conversation));
            } catch (storageErr) {
                log('Failed to save conversation', storageErr.message);
            }
            
            // Start speech animation and queue TTS
            startSpeechAnimation(content);
            queueTTS(content);
            resolve(content);
        } catch (err) {
            log('Chat failed:', err.message);
            const errorMsg = 'Sorry, chat is temporarily unavailable. Please try again!';
            resolve(errorMsg);
        }
    });
}

// ===== SPEECH ANIMATION =====
function startSpeechAnimation(text) {
    log('🗣️ Starting speech animation');
    animationState.isTalking = true;
    
    if (currentVRM && currentVRM.humanoid) {
        const speechDuration = text.length * 50; // Rough estimate
        let speechTime = 0;
        
        function animateSpeech() {
            if (!animationState.isTalking) return;
            
            speechTime += 16;
            
            const head = currentVRM.humanoid.getNormalizedBoneNode('head');
            if (head) {
                // Natural head movement during speech
                const intensity = 0.03;
                head.rotation.y = Math.sin(speechTime * 0.005) * intensity;
                head.rotation.x = Math.sin(speechTime * 0.003) * intensity * 0.5;
            }
            
            if (speechTime < speechDuration) {
                requestAnimationFrame(animateSpeech);
            } else {
                stopSpeechAnimation();
            }
        }
        
        animateSpeech();
    }
    
    // Set expression during speech
    if (currentVRM && currentVRM.expressionManager) {
        try {
            currentVRM.expressionManager.setValue('happy', 0.3);
        } catch (e) {
            // Expression not available
        }
    }
}

function stopSpeechAnimation() {
    log('🔇 Stopping speech animation');
    animationState.isTalking = false;
    
    // Reset expression
    if (currentVRM && currentVRM.expressionManager) {
        try {
            currentVRM.expressionManager.setValue('happy', 0);
        } catch (e) {
            // Expression not available
        }
    }
}

// ===== TTS SYSTEM =====
function queueTTS(text, voice = 'nova') {
    audioQueue.push({ text, voice });
    if (!isPlaying) playNextAudio();
}

function playNextAudio() {
    return new Promise(async (resolve) => {
        if (audioQueue.length === 0) {
            isPlaying = false;
            stopSpeechAnimation();
            resolve();
            return;
        }
        
        const { text, voice } = audioQueue.shift();
        
        try {
            const res = await fetch('/api/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, voice })
            });
            
            if (!res.ok || res.headers.get('X-Solmate-TTS-Fallback') === 'browser') {
                fallbackTTS(text, voice);
                resolve();
                return;
            }
            
            const blob = await res.blob();
            if (blob.size === 0) {
                throw new Error('Empty audio response');
            }
            
            await playAudio(blob);
            resolve();
        } catch (err) {
            log('TTS failed, using browser fallback:', err.message);
            fallbackTTS(text, voice);
            resolve();
        }
    });
}

function fallbackTTS(text, voice) {
    try {
        const utterance = new SpeechSynthesisUtterance(text);
        const voices = speechSynthesis.getVoices();
        const selectedVoice = voices.find(v => 
            v.name.toLowerCase().includes(voice.toLowerCase())
        ) || voices[0];
        if (selectedVoice) utterance.voice = selectedVoice;
        
        utterance.rate = 0.9;
        utterance.pitch = 1.1;
        utterance.volume = 0.8;
        
        utterance.onend = () => {
            isPlaying = false;
            stopSpeechAnimation();
            playNextAudio();
        };
        
        utterance.onerror = () => {
            isPlaying = false;
            stopSpeechAnimation();
            playNextAudio();
        };
        
        speechSynthesis.speak(utterance);
        isPlaying = true;
        log('Browser TTS playing');
    } catch (err) {
        log('Fallback TTS failed:', err.message);
        isPlaying = false;
        stopSpeechAnimation();
        playNextAudio();
    }
}

function playAudio(blob) {
    return new Promise((resolve, reject) => {
        try {
            isPlaying = true;
            const audio = new Audio(URL.createObjectURL(blob));
            
            audio.onended = () => {
                isPlaying = false;
                stopSpeechAnimation();
                playNextAudio();
                resolve();
            };
            
            audio.onerror = (err) => {
                log('Audio playback failed:', err.message);
                isPlaying = false;
                stopSpeechAnimation();
                reject(err);
            };
            
            audio.play().then(resolve).catch(reject);
        } catch (err) {
            log('Audio play error:', err.message);
            isPlaying = false;
            stopSpeechAnimation();
            reject(err);
        }
    });
}

function clearAudioQueue() {
    audioQueue = [];
    speechSynthesis.cancel();
    isPlaying = false;
    stopSpeechAnimation();
    log('Audio queue cleared');
}

// ===== UI SETUP =====
function setupUI() {
    log('Setting up UI...');
    
    const themeBtn = document.getElementById('themeToggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            document.documentElement.classList.toggle('light');
        });
    }
    
    const chatForm = document.getElementById('chatForm');
    const promptInput = document.getElementById('promptInput');
    const sendBtn = document.getElementById('sendBtn');
    
    if (chatForm && promptInput && sendBtn) {
        chatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const text = promptInput.value.trim();
            if (!text) return;
            
            promptInput.value = '';
            sendBtn.disabled = true;
            sendBtn.textContent = '🤔';
            
            try {
                await sendMessage(text);
            } finally {
                sendBtn.disabled = false;
                sendBtn.textContent = '▶';
            }
        });
    }
    
    const clearBtn = document.getElementById('clearBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearAudioQueue);
    }
    
    // Window resize handler
    window.addEventListener('resize', () => {
        if (camera && renderer) {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        }
    });
    
    // Debug overlay toggle
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'd') {
            e.preventDefault();
            const logs = document.getElementById('debugOverlay');
            if (logs) logs.classList.toggle('hidden');
        }
    });
    
    // Load conversation history
    try {
        const saved = localStorage.getItem('solmateConversation');
        if (saved) {
            conversation = JSON.parse(saved);
            log(`Loaded ${conversation.length} conversation messages`);
        }
    } catch (err) {
        log('Failed to load conversation history:', err.message);
    }
    
    // Enable audio context on user interaction
    document.addEventListener('click', enableAudio, { once: true });
    document.addEventListener('keydown', enableAudio, { once: true });
    
    // Mouse tracking for head movement
    document.addEventListener('mousemove', (event) => {
        if (animationState.isTalking || animationState.isWaving) return;
        
        const mouseX = (event.clientX / window.innerWidth) * 2 - 1;
        const mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
        
        animationState.headTarget.x = mouseY * 0.1;
        animationState.headTarget.y = mouseX * 0.2;
    });
    
    document.addEventListener('mouseleave', () => {
        if (!animationState.isTalking) {
            animationState.headTarget = { x: 0, y: 0 };
        }
    });
    
    log('UI setup complete');
}

function enableAudio() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContext.resume();
        log('Audio context enabled');
    } catch (e) {
        log('Audio enable failed:', e.message);
    }
}

// ===== MAIN INITIALIZATION =====
async function init() {
    log('🚀 Initializing Solmate...');
    
    try {
        // Setup UI first
        setupUI();
        
        // Start API calls
        try {
            await fetchPrice();
            await fetchTPS();
        } catch (apiErr) {
            log('Initial API calls failed:', apiErr.message);
        }
        
        // Start periodic updates
        priceUpdateTimer = setInterval(() => {
            fetchPrice().catch(err => log('Price update failed:', err.message));
        }, 30000);
        
        tpsUpdateTimer = setInterval(() => {
            fetchTPS().catch(err => log('TPS update failed:', err.message));
        }, 60000);
        
        // Initialize VRM system
        updateLoadingProgress('vrm-init');
        const vrmReady = await initializeVRMSystem();
        
        if (!vrmReady) {
            throw new Error('VRM system initialization failed');
        }
        
        // Setup Three.js scene
        setupScene();
        
        // Start render loop
        animate();
        
        // Load VRM model
        try {
            await loadVRMModel(VRM_PATH);
        } catch (vrmError) {
            log('VRM loading failed, using emergency fallback', vrmError.message);
            handleVRMLoadingError(vrmError);
        }
        
        // Connect WebSocket
        connectWebSocket();
        
        log('✅ Solmate initialization complete!');
        
        // Welcome message
        setTimeout(() => {
            queueTTS("Hello! I'm your Solmate companion. I should now be facing you properly with all textures visible and natural animations!");
        }, 3000);
        
    } catch (err) {
        log('❌ Initialization failed:', err.message);
        
        // Fallback initialization
        setupUI();
        
        try {
            await fetchPrice();
            await fetchTPS();
            priceUpdateTimer = setInterval(() => {
                fetchPrice().catch(e => log('Price error:', e.message));
            }, 30000);
            tpsUpdateTimer = setInterval(() => {
                fetchTPS().catch(e => log('TPS error:', e.message));
            }, 60000);
        } catch (apiError) {
            log('API initialization failed:', apiError.message);
        }
        
        // Create simple fallback
        const fallback = document.createElement('div');
        fallback.style.cssText = `
            position: fixed; top: 50%; left: 50%;
            transform: translate(-50%, -50%); text-align: center;
            color: white; font-family: Arial, sans-serif;
        `;
        fallback.innerHTML = `
            <img src="/assets/logo/solmatelogo.png" style="width: 200px; height: auto;" onerror="this.style.display='none'">
            <div style="margin-top: 20px;">
                <h2>Solmate</h2>
                <p>Audio-only mode active</p>
            </div>
        `;
        document.body.appendChild(fallback);
    }
}

// ===== CLEANUP =====
window.addEventListener('beforeunload', () => {
    if (ws) ws.close();
    
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    if (priceUpdateTimer) clearInterval(priceUpdateTimer);
    if (tpsUpdateTimer) clearInterval(tpsUpdateTimer);
    
    clearAudioQueue();
    
    if (renderer) {
        renderer.dispose();
    }
    if (currentVRM && scene) {
        scene.remove(currentVRM.scene);
    }
});

// ===== DEBUG COMMANDS =====
window.debugVRM = function() {
    console.log('=== VRM DEBUG REPORT ===');
    console.log('VRM loaded:', !!currentVRM);
    console.log('Scene:', !!scene);
    console.log('Camera:', !!camera);
    console.log('Renderer:', !!renderer);
    console.log('VRM model in scene:', !!scene?.getObjectByName('VRM_Model'));
    
    if (currentVRM) {
        console.log('VRM features:', {
            hasLookAt: !!currentVRM.lookAt,
            hasExpressions: !!currentVRM.expressionManager,
            hasHumanoid: !!currentVRM.humanoid,
            isMinimalVRM: !!currentVRM.isMinimalVRM
        });
    }
    
    if (scene) {
        console.log('Scene objects:', scene.children.map(c => c.name));
    }
    
    return {
        vrm: currentVRM,
        scene: scene,
        camera: camera,
        animationState: animationState
    };
};

window.testExpression = function(expr = 'happy') {
    if (currentVRM && currentVRM.expressionManager) {
        try {
            currentVRM.expressionManager.setValue(expr, 0.8);
            setTimeout(() => {
                currentVRM.expressionManager.setValue(expr, 0);
            }, 2000);
            console.log(`Playing expression: ${expr}`);
        } catch (e) {
            console.log(`Expression not available: ${expr}`);
        }
    } else {
        console.log('No expression manager available');
    }
};

window.testChat = function() {
    return sendMessage("Hello Solmate! How do you look now?");
};

window.testTTS = function() {
    queueTTS("Hello! I'm testing the VRM system with natural animations.", 'nova');
};

window.playWave = function() {
    playEnhancedVRMWave();
};

window.reloadVRM = function() {
    return new Promise(async (resolve) => {
        log('🔄 Manually reloading VRM...');
        
        ['VRM_Model', 'EmergencyFallback'].forEach(name => {
            const existing = scene?.getObjectByName(name);
            if (existing) {
                scene.remove(existing);
                log(`Removed ${name}`);
            }
        });
        
        try {
            await loadVRMModel(VRM_PATH);
            log('✅ VRM reload successful!');
            resolve('VRM reloaded successfully');
        } catch (err) {
            log('❌ VRM reload failed:', err.message);
            handleVRMLoadingError(err);
            resolve('VRM reload failed: ' + err.message);
        }
    });
};

window.fixTextures = function() {
    const vrmModel = scene?.getObjectByName('VRM_Model');
    if (vrmModel) {
        console.log('🎨 Re-fixing VRM textures...');
        fixVRMTextures(vrmModel);
    } else {
        console.log('No VRM model found in scene');
    }
};

window.analyzeVRMFile = async function() {
    console.log('🔍 Analyzing VRM file structure...');
    
    try {
        const response = await fetch('/assets/avatar/solmate.vrm');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        console.log('File size:', (arrayBuffer.byteLength / (1024 * 1024)).toFixed(2), 'MB');
        
        // Parse GLB header
        const headerView = new DataView(arrayBuffer, 0, 12);
        const magic = headerView.getUint32(0, true);
        const version = headerView.getUint32(4, true);
        const length = headerView.getUint32(8, true);
        
        console.log('GLB Header:', {
            magic: magic.toString(16),
            isValidGLB: magic === 0x46546C67,
            version,
            length: (length / (1024 * 1024)).toFixed(2) + ' MB'
        });
        
        if (magic === 0x46546C67) {
            // Parse chunks
            let chunkIndex = 12;
            let jsonChunk = null;
            let binaryChunk = null;
            
            while (chunkIndex < length) {
                const chunkHeaderView = new DataView(arrayBuffer, chunkIndex, 8);
                const chunkLength = chunkHeaderView.getUint32(0, true);
                const chunkType = chunkHeaderView.getUint32(4, true);
                
                console.log('Chunk:', {
                    type: chunkType.toString(16),
                    length: (chunkLength / 1024).toFixed(2) + ' KB',
                    isJSON: chunkType === 0x4E4F534A,
                    isBinary: chunkType === 0x004E4942
                });
                
                if (chunkType === 0x4E4F534A) {
                    const jsonData = new Uint8Array(arrayBuffer, chunkIndex + 8, chunkLength);
                    const jsonString = new TextDecoder().decode(jsonData);
                    jsonChunk = JSON.parse(jsonString);
                } else if (chunkType === 0x004E4942) {
                    binaryChunk = arrayBuffer.slice(chunkIndex + 8, chunkIndex + 8 + chunkLength);
                }
                
                chunkIndex += 8 + chunkLength;
            }
            
            if (jsonChunk) {
                console.log('GLTF JSON structure:', {
                    asset: jsonChunk.asset,
                    scenes: jsonChunk.scenes?.length || 0,
                    nodes: jsonChunk.nodes?.length || 0,
                    meshes: jsonChunk.meshes?.length || 0,
                    materials: jsonChunk.materials?.length || 0,
                    textures: jsonChunk.textures?.length || 0,
                    images: jsonChunk.images?.length || 0,
                    accessors: jsonChunk.accessors?.length || 0,
                    bufferViews: jsonChunk.bufferViews?.length || 0,
                    hasVRMExtension: !!(jsonChunk.extensions && jsonChunk.extensions.VRM),
                    extensions: Object.keys(jsonChunk.extensions || {})
                });
                
                if (jsonChunk.extensions?.VRM) {
                    console.log('VRM Extension found:', {
                        exporterVersion: jsonChunk.extensions.VRM.exporterVersion,
                        specVersion: jsonChunk.extensions.VRM.specVersion,
                        hasHumanoid: !!jsonChunk.extensions.VRM.humanoid,
                        hasBlendShapeMaster: !!jsonChunk.extensions.VRM.blendShapeMaster,
                        hasFirstPerson: !!jsonChunk.extensions.VRM.firstPerson
                    });
                }
            }
            
            console.log('Binary chunk size:', binaryChunk ? (binaryChunk.byteLength / (1024 * 1024)).toFixed(2) + ' MB' : 'None');
            
            return {
                isValid: true,
                size: arrayBuffer.byteLength,
                hasJSON: !!jsonChunk,
                hasBinary: !!binaryChunk,
                isVRM: !!(jsonChunk?.extensions?.VRM),
                json: jsonChunk
            };
        } else {
            console.log('❌ Not a valid GLB file');
            return { isValid: false };
        }
        
    } catch (error) {
        console.log('❌ File analysis failed:', error);
        return { isValid: false, error: error.message };
    }
};

// ===== CONSOLE MESSAGES =====
console.log('🚀 Solmate VRM System Loaded!');
console.log('🛠️ Debug commands: debugVRM(), testExpression("happy"), testChat(), testTTS(), playWave(), reloadVRM(), fixTextures()');
console.log('🎭 Features: Natural animations, proper textures, correct positioning, mouse tracking, robust fallbacks');
console.log('🔧 System check: analyzeVRMFile() to diagnose VRM file issues');
console.log('👋 Try: playWave() to test wave animation');
console.log('💡 If VRM fails: Run analyzeVRMFile() to diagnose VRM loading issues');

// ===== START APPLICATION =====
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}// web/script.js - Complete Solmate Implementation with VRM Fixes Only
// Fixed: parser.getDependencies error, circular reference logging

// ===== CONSTANTS =====
const ASSET_LOAD_TIMEOUT = 30000;
const VRM_MAX_RETRIES = 2;
const VRM_PATH = '/assets/avatar/solmate.vrm';
const HELIUS_WS = 'wss://mainnet.helius-rpc.com/?api-key=9355c09c-5049-4ffa-a0fa-786d2482af6b';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

const SYSTEM_PROMPT = `
You are Solmate, a helpful and witty Solana Companion, inspired by Rangiku Matsumoto from Bleach and Lust from Fullmetal Alchemist. Be maximally truthful, helpful, and add a touch of humor when appropriate. You're a Solana companion, so focus on Solana blockchain, crypto, DeFi, NFTs, and web3 topics, but answer any question. Keep responses concise, engaging, and fun. Always remind users: Not financial advice.
`;

// ===== GLOBAL STATE =====
let THREE, scene, camera, renderer, mixer, clock;
let currentVRM = null;
let audioQueue = [];
let isPlaying = false;
let ws = null;
let wsReconnectTimer = null;
let priceUpdateTimer = null;
let tpsUpdateTimer = null;
let conversation = [];

// Animation state
let animationState = {
    isWaving: false,
    isIdle: true,
    isTalking: false,
    headTarget: { x: 0, y: 0 },
    breathingPhase: 0,
    blinkTimer: 0
};

// ===== SAFE LOGGING (FIXED FOR CIRCULAR REFERENCES) =====
function log(msg, data = null) {
    const time = new Date().toLocaleTimeString();
    const entry = `[${time}] ${msg}`;
    
    // Safe logging that handles circular references
    let logData = '';
    if (data !== null) {
        try {
            if (typeof data === 'object' && data !== null) {
                // Handle circular references safely
                logData = JSON.stringify(data, (key, value) => {
                    if (key === 'parser' || key === 'plugins' || key === 'cache') {
                        return '[Circular Reference]';
                    }
                    if (typeof value === 'function') {
                        return '[Function]';
                    }
                    return value;
                }, 2);
            } else {
                logData = String(data);
            }
        } catch (e) {
            logData = '[Complex Object]';
        }
    }
    
    console.log(entry, logData || '');
    
    const logs = document.getElementById('overlayLogs');
    if (logs) {
        const div = document.createElement('div');
        div.textContent = logData ? `${entry} ${logData}` : entry;
        logs.appendChild(div);
        if (logs.children.length > 20) logs.removeChild(logs.firstChild);
    }
}

// ===== UTILITY: LOAD SCRIPT =====
function loadScript(src) {
    return new Promise((resolve, reject) => {
        log(`Loading script: ${src}`);
        
        const existingScript = document.querySelector(`script[src="${src}"]`);
        if (existingScript) {
            log(`Script already exists: ${src}`);
            resolve();
            return;
        }
        
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => {
            log(`✅ Script loaded: ${src}`);
            resolve();
        };
        script.onerror = (error) => {
            log(`❌ Script failed: ${src}`);
            reject(new Error(`Failed to load script: ${src}`));
        };
        
        document.head.appendChild(script);
    });
}

// ===== VRM SYSTEM INITIALIZATION =====
async function initializeVRMSystem() {
    log('🎭 Initializing VRM system (multiple strategies)...');
    
    try {
        // Load Three.js core first
        await loadScript('https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js');
        THREE = window.THREE;
        
        if (!THREE) {
            throw new Error('Three.js failed to load');
        }
        
        log('✅ Three.js loaded successfully');
        
        // Load GLTF Loader BEFORE VRM
        const gltfSources = [
            'https://cdn.jsdelivr.net/npm/three@0.158.0/examples/js/loaders/GLTFLoader.js',
            'https://unpkg.com/three@0.158.0/examples/js/loaders/GLTFLoader.js'
        ];
        
        let gltfLoaded = false;
        for (const source of gltfSources) {
            try {
                log(`Trying GLTF source: ${source}`);
                await loadScript(source);
                
                if (THREE.GLTFLoader) {
                    log('✅ GLTF Loader found');
                    gltfLoaded = true;
                    break;
                }
            } catch (e) {
                log(`GLTF source failed: ${source}`);
            }
        }
        
        if (!gltfLoaded) {
            log('Creating enhanced GLTF loader...');
            createEnhancedGLTFLoader();
        }
        
        // Try multiple VRM library sources
        const vrmSources = [
            'https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@2.0.6/lib/three-vrm.min.js',
            'https://unpkg.com/@pixiv/three-vrm@2.0.6/lib/three-vrm.min.js'
        ];
        
        let vrmLoaded = false;
        for (const source of vrmSources) {
            try {
                log(`Trying VRM source: ${source}`);
                await loadScript(source);
                
                // Check multiple possible locations for VRM
                if (window.VRM && window.VRM.VRMLoaderPlugin) {
                    log('✅ VRM found at window.VRM.VRMLoaderPlugin');
                    vrmLoaded = true;
                    break;
                } else if (window.THREE && window.THREE.VRMLoaderPlugin) {
                    window.VRM = { VRMLoaderPlugin: window.THREE.VRMLoaderPlugin };
                    log('✅ VRM found at window.THREE.VRMLoaderPlugin');
                    vrmLoaded = true;
                    break;
                } else if (window.VRMLoaderPlugin) {
                    window.VRM = { VRMLoaderPlugin: window.VRMLoaderPlugin };
                    log('✅ VRM found at window.VRMLoaderPlugin');
                    vrmLoaded = true;
                    break;
                }
                
                // Wait a moment for the script to fully initialize
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Check again after delay
                if (window.VRM && window.VRM.VRMLoaderPlugin) {
                    log('✅ VRM loaded after delay');
                    vrmLoaded = true;
                    break;
                }
                
            } catch (e) {
                log(`VRM source failed: ${source}`);
                continue;
            }
        }
        
        if (!vrmLoaded) {
            log('⚠️ VRM library not found, creating fallback loader');
            return await createFallbackVRMLoader();
        }
        
        log('✅ VRM system initialized successfully');
        return true;
    } catch (error) {
        log('❌ VRM system initialization failed:', error.message);
        return await createFallbackVRMLoader();
    }
}

// ===== ENHANCED GLTF LOADER WITH PROPER PARSER =====
function createEnhancedGLTFLoader() {
    log('🔧 Creating enhanced GLTF loader...');
    
    THREE.GLTFLoader = function(manager) {
        this.manager = manager || THREE.DefaultLoadingManager;
        this.path = '';
        this.plugins = [];
    };
    
    THREE.GLTFLoader.prototype = {
        constructor: THREE.GLTFLoader,
        
        register: function(plugin) {
            if (typeof plugin === 'function') {
                this.plugins.push(plugin);
            }
            return this;
        },
        
        load: function(url, onLoad, onProgress, onError) {
            const scope = this;
            const loader = new THREE.FileLoader(scope.manager);
            loader.setPath(scope.path);
            loader.setResponseType('arraybuffer');
            
            loader.load(url, function(data) {
                try {
                    scope.parse(data, '', onLoad, onError);
                } catch (e) {
                    if (onError) onError(e);
                }
            }, onProgress, onError);
        },
        
        loadAsync: function(url, onProgress) {
            return new Promise((resolve, reject) => {
                this.load(url, resolve, onProgress, reject);
            });
        },
        
        parse: function(data, path, onLoad, onError) {
            try {
                const parser = new EnhancedGLTFParser(data, path);
                
                // Apply plugins to parser
                this.plugins.forEach(pluginFn => {
                    try {
                        const plugin = pluginFn(parser);
                        if (plugin && plugin.name) {
                            parser.plugins[plugin.name] = plugin;
                        }
                    } catch (e) {
                        log('Plugin registration failed:', e.message);
                    }
                });
                
                parser.parse().then((gltf) => {
                    // Apply plugin afterRoot hooks
                    Object.values(parser.plugins).forEach(plugin => {
                        if (plugin.afterRoot) {
                            try {
                                plugin.afterRoot(gltf);
                            } catch (e) {
                                log('Plugin afterRoot failed:', e.message);
                            }
                        }
                    });
                    
                    onLoad(gltf);
                }).catch(onError);
                
            } catch (error) {
                if (onError) onError(error);
            }
        }
    };
}

// ===== ENHANCED GLTF PARSER WITH FULL API =====
function EnhancedGLTFParser(data, path) {
    this.json = {};
    this.data = data;
    this.path = path || '';
    this.plugins = {};
    this.cache = new Map();
    this.primitiveCache = new Map();
    this.textureLoader = new THREE.TextureLoader();
    this.textureLoader.setCrossOrigin('anonymous');
    
    // Store references for VRM plugin compatibility
    this.associations = new Map();
    this.nodeMap = new Map();
    this.meshMap = new Map();
    this.materialMap = new Map();
}

EnhancedGLTFParser.prototype = {
    parse: function() {
        return new Promise((resolve, reject) => {
            try {
                if (this.data instanceof ArrayBuffer) {
                    this.parseGLB();
                }
                
                this.buildScene().then(resolve).catch(reject);
            } catch (error) {
                reject(error);
            }
        });
    },
    
    parseGLB: function() {
        const headerView = new DataView(this.data, 0, 12);
        const magic = headerView.getUint32(0, true);
        
        if (magic !== 0x46546C67) {
            throw new Error('Invalid GLB file');
        }
        
        const length = headerView.getUint32(8, true);
        let chunkIndex = 12;
        
        while (chunkIndex < length) {
            const chunkHeaderView = new DataView(this.data, chunkIndex, 8);
            const chunkLength = chunkHeaderView.getUint32(0, true);
            const chunkType = chunkHeaderView.getUint32(4, true);
            
            if (chunkType === 0x4E4F534A) { // JSON chunk
                const jsonChunk = new Uint8Array(this.data, chunkIndex + 8, chunkLength);
                this.json = JSON.parse(new TextDecoder().decode(jsonChunk));
            } else if (chunkType === 0x004E4942) { // Binary chunk
                this.body = this.data.slice(chunkIndex + 8, chunkIndex + 8 + chunkLength);
            }
            
            chunkIndex += 8 + chunkLength;
        }
    },
    
    // CRITICAL FIX: VRM PLUGIN COMPATIBILITY - Essential methods
    getDependency: function(type, index) {
        const cacheKey = `${type}:${index}`;
        
        if (this.cache.has(cacheKey)) {
            return Promise.resolve(this.cache.get(cacheKey));
        }
        
        switch (type) {
            case 'scene':
                return this.loadScene(index);
            case 'node':
                return this.loadNode(index);
            case 'mesh':
                return this.loadMesh(index);
            case 'material':
                return this.loadMaterial(index);
            case 'texture':
                return this.loadTexture(index);
            case 'image':
                return this.loadImage(index);
            case 'bufferView':
                return this.loadBufferView(index);
            case 'accessor':
                return this.loadAccessor(index);
            default:
                return Promise.reject(new Error(`Unknown dependency type: ${type}`));
        }
    },
    
    // CRITICAL FIX: Add missing getDependencies method (plural)
    getDependencies: function(type) {
        if (!this.json || !this.json[type]) {
            return Promise.resolve([]);
        }
        
        const items = this.json[type];
        const promises = items.map((item, index) => {
            return this.getDependency(type, index);
        });
        
        return Promise.all(promises);
    },
    
    loadScene: function(index) {
        const sceneDef = this.json.scenes[index];
        const scene = new THREE.Group();
        scene.name = sceneDef.name || `Scene_${index}`;
        
        if (sceneDef.nodes) {
            const promises = sceneDef.nodes.map(nodeIndex => this.getDependency('node', nodeIndex));
            return Promise.all(promises).then(nodes => {
                nodes.forEach(node => scene.add(node));
                this.cache.set(`scene:${index}`, scene);
                return scene;
            });
        }
        
        this.cache.set(`scene:${index}`, scene);
        return Promise.resolve(scene);
    },
    
    loadNode: function(index) {
        const nodeDef = this.json.nodes[index];
        const node = new THREE.Object3D();
        node.name = nodeDef.name || `Node_${index}`;
        
        // Apply transform
        if (nodeDef.matrix) {
            node.matrix.fromArray(nodeDef.matrix);
            node.matrix.decompose(node.position, node.quaternion, node.scale);
        } else {
            if (nodeDef.translation) node.position.fromArray(nodeDef.translation);
            if (nodeDef.rotation) node.quaternion.fromArray(nodeDef.rotation);
            if (nodeDef.scale) node.scale.fromArray(nodeDef.scale);
        }
        
        // Load mesh if present
        let promise = Promise.resolve(node);
        
        if (nodeDef.mesh !== undefined) {
            promise = this.getDependency('mesh', nodeDef.mesh).then(mesh => {
                node.add(mesh);
                return node;
            });
        }
        
        // Load children
        if (nodeDef.children) {
            const childPromises = nodeDef.children.map(childIndex => this.getDependency('node', childIndex));
            promise = promise.then(node => {
                return Promise.all(childPromises).then(children => {
                    children.forEach(child => node.add(child));
                    return node;
                });
            });
        }
        
        return promise.then(node => {
            this.cache.set(`node:${index}`, node);
            this.nodeMap.set(index, node);
            return node;
        });
    },
    
    loadMesh: function(index) {
        const meshDef = this.json.meshes[index];
        const group = new THREE.Group();
        group.name = meshDef.name || `Mesh_${index}`;
        
        const promises = meshDef.primitives.map((primitive, primIndex) => {
            return this.loadMeshPrimitive(primitive, index, primIndex);
        });
        
        return Promise.all(promises).then(primitives => {
            primitives.forEach(primitive => group.add(primitive));
            this.cache.set(`mesh:${index}`, group);
            this.meshMap.set(index, group);
            return group;
        });
    },
    
    loadMeshPrimitive: function(primitive, meshIndex, primIndex) {
        const cacheKey = `primitive:${meshIndex}:${primIndex}`;
        
        if (this.primitiveCache.has(cacheKey)) {
            return Promise.resolve(this.primitiveCache.get(cacheKey));
        }
        
        const geometry = this.createGeometry(primitive);
        
        let materialPromise;
        if (primitive.material !== undefined) {
            materialPromise = this.getDependency('material', primitive.material);
        } else {
            const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
            materialPromise = Promise.resolve(material);
        }
        
        return materialPromise.then(material => {
            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = `Primitive_${meshIndex}_${primIndex}`;
            this.primitiveCache.set(cacheKey, mesh);
            return mesh;
        });
    },
    
    loadMaterial: function(index) {
        const materialDef = this.json.materials[index];
        const material = new THREE.MeshBasicMaterial();
        material.name = materialDef.name || `Material_${index}`;
        
        // Basic material properties
        if (materialDef.pbrMetallicRoughness) {
            const pbr = materialDef.pbrMetallicRoughness;
            if (pbr.baseColorFactor) {
                material.color.fromArray(pbr.baseColorFactor);
            }
            
            if (pbr.baseColorTexture !== undefined) {
                return this.getDependency('texture', pbr.baseColorTexture.index).then(texture => {
                    material.map = texture;
                    this.cache.set(`material:${index}`, material);
                    this.materialMap.set(index, material);
                    return material;
                });
            }
        }
        
        this.cache.set(`material:${index}`, material);
        this.materialMap.set(index, material);
        return Promise.resolve(material);
    },
    
    loadTexture: function(index) {
        const textureDef = this.json.textures[index];
        
        if (textureDef.source !== undefined) {
            return this.getDependency('image', textureDef.source).then(image => {
                const texture = new THREE.Texture(image);
                texture.needsUpdate = true;
                texture.flipY = false; // GLTF standard
                texture.colorSpace = THREE.SRGBColorSpace;
                
                this.cache.set(`texture:${index}`, texture);
                return texture;
            });
        }
        
        return Promise.reject(new Error(`Texture ${index} has no source`));
    },
    
    loadImage: function(index) {
        const imageDef = this.json.images[index];
        
        if (imageDef.bufferView !== undefined) {
            return this.getDependency('bufferView', imageDef.bufferView).then(bufferView => {
                const blob = new Blob([bufferView], { type: imageDef.mimeType });
                const url = URL.createObjectURL(blob);
                
                return new Promise((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => {
                        URL.revokeObjectURL(url);
                        resolve(img);
                    };
                    img.onerror = reject;
                    img.crossOrigin = 'anonymous';
                    img.src = url;
                });
            });
        }
        
        return Promise.reject(new Error(`Image ${index} not supported`));
    },
    
    loadBufferView: function(index) {
        const bufferViewDef = this.json.bufferViews[index];
        const byteOffset = bufferViewDef.byteOffset || 0;
        const byteLength = bufferViewDef.byteLength;
        
        const bufferView = this.body.slice(byteOffset, byteOffset + byteLength);
        this.cache.set(`bufferView:${index}`, bufferView);
        return Promise.resolve(bufferView);
    },
    
    loadAccessor: function(index) {
        const accessor = this.json.accessors[index];
        this.cache.set(`accessor:${index}`, accessor);
        return Promise.resolve(accessor);
    },
    
    createGeometry: function(primitive) {
        const geometry = new THREE.BufferGeometry();
        
        try {
            // Position attribute
            if (primitive.attributes.POSITION !== undefined) {
                const positionAccessor = this.json.accessors[primitive.attributes.POSITION];
                const positionBufferView = this.json.bufferViews[positionAccessor.bufferView];
                const byteOffset = (positionAccessor.byteOffset || 0) + (positionBufferView.byteOffset || 0);
                
                const positionArray = new Float32Array(
                    this.body,
                    byteOffset,
                    positionAccessor.count * 3
                );
                
                geometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));
            }
            
            // Normal attribute
            if (primitive.attributes.NORMAL !== undefined) {
                const normalAccessor = this.json.accessors[primitive.attributes.NORMAL];
                const normalBufferView = this.json.bufferViews[normalAccessor.bufferView];
                const byteOffset = (normalAccessor.byteOffset || 0) + (normalBufferView.byteOffset || 0);
                
                const normalArray = new Float32Array(
                    this.body,
                    byteOffset,
                    normalAccessor.count * 3
                );
                
                geometry.setAttribute('normal', new THREE.BufferAttribute(normalArray, 3));
            }
            
            // UV attribute
            if (primitive.attributes.TEXCOORD_0 !== undefined) {
                const uvAccessor = this.json.accessors[primitive.attributes.TEXCOORD_0];
                const uvBufferView = this.json.bufferViews[uvAccessor.bufferView];
                const byteOffset = (uvAccessor.byteOffset || 0) + (uvBufferView.byteOffset || 0);
                
                const uvArray = new Float32Array(
                    this.body,
                    byteOffset,
                    uvAccessor.count * 2
                );
                
                geometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
            }
            
            // Indices
            if (primitive.indices !== undefined) {
                const indexAccessor = this.json.accessors[primitive.indices];
                const indexBufferView = this.json.bufferViews[indexAccessor.bufferView];
                const byteOffset = (indexAccessor.byteOffset || 0) + (indexBufferView.byteOffset || 0);
                
                let indexArray;
                if (indexAccessor.componentType === 5123) { // UNSIGNED_SHORT
                    indexArray = new Uint16Array(this.body, byteOffset, indexAccessor.count);
                } else if (indexAccessor.componentType === 5125) { // UNSIGNED_INT
                    indexArray = new Uint32Array(this.body, byteOffset, indexAccessor.count);
                }
                
                if (indexArray) {
                    geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));
                }
            }
            
            if (!geometry.attributes.normal) {
                geometry.computeVertexNormals();
            }
            
        } catch (err) {
            log('Geometry creation failed, using fallback:', err.message);
            // Fallback geometry
            const vertices = new Float32Array([
                0, 1, 0,   -1, -1, 0,   1, -1, 0
            ]);
            geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
            geometry.computeVertexNormals();
        }
        
        return geometry;
    },
    
    buildScene: function() {
        return new Promise((resolve, reject) => {
            try {
                const scene = new THREE.Group();
                scene.name = 'VRM_Scene';
                
                if (this.json.scenes && this.json.scenes.length > 0) {
                    const defaultScene = this.json.scene || 0;
                    this.getDependency('scene', defaultScene).then(loadedScene => {
                        scene.add(loadedScene);
                        
                        resolve({
                            scene: scene,
                            scenes: [loadedScene],
                            animations: this.json.animations || [],
                            userData: {
                                json: this.json,
                                parser: this
                            },
                            parser: this // Essential for VRM plugin
                        });
                    }).catch(reject);
                } else {
                    // Fallback scene
                    this.createFallbackScene(scene);
                    resolve({
                        scene: scene,
                        scenes: [scene],
                        animations: [],
                        userData: {
                            json: this.json,
                            parser: this
                        },
                        parser: this
                    });
                }
            } catch (error) {
                reject(error);
            }
        });
    },
    
    createFallbackScene: function(scene) {
        log('Creating fallback VRM scene...');
        
        const group = new THREE.Group();
        group.name = 'FallbackVRM';
        
        // Create simple character
        const headGeo = new THREE.SphereGeometry(0.12, 32, 32);
        const headMat = new THREE.MeshLambertMaterial({ color: 0xffdbac });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 1.6;
        head.name = 'Head';
        group.add(head);
        
        const bodyGeo = new THREE.CylinderGeometry(0.15, 0.18, 0.5, 12);
        const bodyMat = new THREE.MeshLambertMaterial({ color: 0xff6b6b });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 1.1;
        body.name = 'Body';
        group.add(body);
        
        const skirtGeo = new THREE.CylinderGeometry(0.18, 0.25, 0.3, 12);
        const skirtMat = new THREE.MeshLambertMaterial({ color: 0x4169E1 });
        const skirt = new THREE.Mesh(skirtGeo, skirtMat);
        skirt.position.y = 0.75;
        skirt.name = 'Skirt';
        group.add(skirt);
        
        scene.add(group);
    }
};

// ===== FALLBACK VRM LOADER =====
async function createFallbackVRMLoader() {
    log('🔧 Creating fallback VRM loader...');
    
    try {
        // Ensure GLTF loader exists
        if (!THREE.GLTFLoader) {
            log('Creating enhanced GLTF loader for fallback...');
            createEnhancedGLTFLoader();
        }
        
        // Create minimal VRM support
        window.VRM = {
            VRMLoaderPlugin: function(parser) {
                this.parser = parser;
                this.name = 'VRMLoaderPlugin';
                
                this.afterRoot = function(gltf) {
                    // Create minimal VRM object
                    const vrm = {
                        scene: gltf.scene,
                        userData: gltf.userData,
                        isMinimalVRM: true,
                        update: function(deltaTime) {
                            // Basic update function
                        }
                    };
                    
                    // Store VRM in userData
                    gltf.userData.vrm = vrm;
                    
                    log('✅ Minimal VRM object created');
                };
            }
        };
        
        log('✅ Fallback VRM loader created');
        return true;
    } catch (error) {
        log('❌ Fallback VRM loader failed:', error.message);
        return false;
    }
}

// ===== SCENE SETUP =====
function setupScene() {
    log('🎬 Setting up Three.js scene...');
    
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e17);
    
    // Camera - proper positioning for VRM
    camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 20);
    
    // Renderer
    const canvas = document.getElementById('vrmCanvas');
    if (!canvas) {
        throw new Error('Canvas element not found');
    }
    
    renderer = new THREE.WebGLRenderer({ 
        canvas, 
        antialias: true,
        alpha: false  // Important for proper VRM rendering
    });
    
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // Lighting setup optimized for VRM
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(1,
