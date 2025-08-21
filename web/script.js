// web/script.js - Complete Solmate Implementation with Enhanced VRM Support
// Enhanced VRM Loading, Three.js, Chat, TTS, WebSocket, and UI

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
let THREE, GLTFLoader, VRMLoaderPlugin, VRM;
let scene, camera, renderer, mixer, clock;
let currentVRM = null;
let audioQueue = [];
let isPlaying = false;
let ws = null;
let wsReconnectTimer = null;
let priceUpdateTimer = null;
let tpsUpdateTimer = null;
let conversation = [];

// Animation state tracking
let animationState = {
  isWaving: false,
  isIdle: true,
  isTalking: false,
  headTarget: { x: 0, y: 0 },
  breathingPhase: 0,
  blinkTimer: 0,
  gestureTimer: 0,
  expressionTimer: 0
};

// Animation targets for smooth interpolation
let animationTargets = {
  headRotation: { x: 0, y: 0, z: 0 },
  bodyPosition: { x: 0, y: 0, z: 0 },
  armRotations: {
    leftArm: { x: 0, y: 0, z: 0 },
    rightArm: { x: 0, y: 0, z: 0 }
  }
};

// ===== ENHANCED VRM LOADING WITH PROPER PLUGIN SUPPORT =====
function loadVRMWithProperSupport(url, retryCount = 0) {
  return new Promise(async (resolve, reject) => {
    try {
      log(`=== ENHANCED VRM LOADING (attempt ${retryCount + 1}) ===`);
      updateLoadingProgress('vrm', 0);
      
      // Check file accessibility
      const checkResponse = await fetch(url, { method: 'HEAD' });
      if (!checkResponse.ok) {
        throw new Error(`VRM file not accessible: ${checkResponse.status}`);
      }
      
      // Enhanced VRM plugin loading with multiple strategies
      let VRMLoaderPlugin = null;
      
      // Strategy 1: Try the official @pixiv/three-vrm package
      try {
        log('Attempting to load VRM plugin...');
        await loadScript('https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@latest/lib/three-vrm.js');
        
        // Check multiple possible locations for the VRM plugin
        if (window.VRM && window.VRM.VRMLoaderPlugin) {
          VRMLoaderPlugin = window.VRM.VRMLoaderPlugin;
          log('✅ VRM plugin found at window.VRM.VRMLoaderPlugin');
        } else if (window.THREE && window.THREE.VRMLoaderPlugin) {
          VRMLoaderPlugin = window.THREE.VRMLoaderPlugin;
          log('✅ VRM plugin found at window.THREE.VRMLoaderPlugin');
        } else if (window.VRMLoaderPlugin) {
          VRMLoaderPlugin = window.VRMLoaderPlugin;
          log('✅ VRM plugin found at window.VRMLoaderPlugin');
        } else {
          log('⚠️ VRM plugin loaded but not found in expected locations');
          console.log('Available VRM objects:', {
            windowVRM: !!window.VRM,
            vrmKeys: window.VRM ? Object.keys(window.VRM) : null,
            windowTHREE: !!window.THREE,
            threeKeys: window.THREE ? Object.keys(window.THREE).filter(k => k.includes('VRM')) : null
          });
        }
      } catch (e) {
        log('VRM plugin CDN failed:', e);
      }
      
      // Strategy 2: Try alternative VRM sources
      if (!VRMLoaderPlugin) {
        const vrmSources = [
          'https://unpkg.com/@pixiv/three-vrm@latest/lib/three-vrm.js',
          'https://cdn.skypack.dev/@pixiv/three-vrm',
          'https://unpkg.com/@pixiv/three-vrm@2.0.0/lib/three-vrm.js'
        ];
        
        for (const source of vrmSources) {
          try {
            log(`Trying VRM source: ${source}`);
            await loadScript(source);
            
            if (window.VRM && window.VRM.VRMLoaderPlugin) {
              VRMLoaderPlugin = window.VRM.VRMLoaderPlugin;
              log(`✅ VRM plugin loaded from: ${source}`);
              break;
            }
          } catch (e) {
            log(`VRM source failed: ${source}`, e);
          }
        }
      }
      
      const loader = new THREE.GLTFLoader();
      
      // Register VRM plugin if available
      if (VRMLoaderPlugin) {
        try {
          loader.register((parser) => {
            const vrmPlugin = new VRMLoaderPlugin(parser);
            log('✅ VRM plugin successfully registered');
            return vrmPlugin;
          });
        } catch (registrationError) {
          log('❌ VRM plugin registration failed:', registrationError);
          VRMLoaderPlugin = null;
        }
      }
      
      if (!VRMLoaderPlugin) {
        log('⚠️ Loading as standard GLTF (VRM features may be limited)');
      }
      
      // Load with progress tracking
      const gltf = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('VRM loading timeout'));
        }, ASSET_LOAD_TIMEOUT);
        
        loader.load(
          url,
          (loadedGltf) => {
            clearTimeout(timeoutId);
            log('✅ VRM file loaded successfully!');
            
            // Enhanced VRM data detection
            if (loadedGltf.userData && loadedGltf.userData.vrm) {
              currentVRM = loadedGltf.userData.vrm;
              log('✅ VRM data found and stored');
              log('VRM Capabilities:', {
                hasHumanoid: !!(currentVRM.humanoid),
                hasExpressions: !!(currentVRM.expressionManager),
                hasMaterials: !!(currentVRM.materials && currentVRM.materials.length > 0),
                hasLookAt: !!(currentVRM.lookAt),
                hasScene: !!(currentVRM.scene)
              });
            } else if (loadedGltf.userData && loadedGltf.userData.gltfExtensions) {
              // Check for VRM extensions in GLTF
              const extensions = loadedGltf.userData.gltfExtensions;
              if (extensions.VRM) {
                log('✅ VRM extension found in GLTF');
                currentVRM = extensions.VRM;
              } else {
                log('⚠️ No VRM data found, treating as standard GLTF');
              }
            } else {
              log('⚠️ No VRM data found, treating as standard GLTF');
              
              // Create a pseudo-VRM object for compatibility
              currentVRM = {
                scene: loadedGltf.scene,
                userData: loadedGltf.userData,
                isStandardGLTF: true
              };
            }
            
            resolve(loadedGltf);
          },
          (progress) => {
            if (progress.total > 0) {
              const percent = Math.round((progress.loaded / progress.total) * 100);
              updateLoadingProgress('vrm', percent);
              if (percent % 10 === 0) { // Log every 10%
                log(`Loading progress: ${percent}%`);
              }
            }
          },
          (error) => {
            clearTimeout(timeoutId);
            log('❌ VRM loading error:', error);
            reject(error);
          }
        );
      });
      
      // Remove existing models
      ['fallbackAvatar', 'alternativeAvatar', 'VRM_Model', 'EmergencyFallback'].forEach(name => {
        const existing = scene.getObjectByName(name);
        if (existing) {
          scene.remove(existing);
          log(`Removed existing ${name}`);
        }
      });
      
      if (gltf.scene) {
        updateLoadingProgress('positioning');
        processAndAddVRMEnhanced(gltf);
        updateLoadingProgress('complete');
        log('🎉 VRM loaded and positioned successfully!');
        resolve();
      } else {
        throw new Error('No scene found in VRM file');
      }
      
    } catch (err) {
      if (retryCount < VRM_MAX_RETRIES) {
        log(`VRM retry ${retryCount + 1} in 3s...`, err.message);
        setTimeout(() => {
          loadVRMWithProperSupport(url, retryCount + 1).then(resolve).catch(reject);
        }, 3000);
      } else {
        log('❌ VRM loading failed completely', err);
        handleVRMLoadingError(err);
        reject(err);
      }
    }
  });
}

// ===== ENHANCED VRM PROCESSING =====
function processAndAddVRMEnhanced(gltf) {
  log('🎭 Processing VRM with enhanced support...');
  
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  
  log('VRM dimensions:', {
    size: { x: size.x.toFixed(2), y: size.y.toFixed(2), z: size.z.toFixed(2) },
    center: { x: center.x.toFixed(2), y: center.y.toFixed(2), z: center.z.toFixed(2) }
  });
  
  // Smart scaling based on VRM size
  let scale = 1.0;
  if (size.y > 10) {
    scale = 1.8 / size.y;
    gltf.scene.scale.setScalar(scale);
    log(`Applied scaling: ${scale.toFixed(4)}`);
  }
  
  // Position the model
  const scaledBox = new THREE.Box3().setFromObject(gltf.scene);
  const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
  
  gltf.scene.position.x = -scaledCenter.x;
  gltf.scene.position.y = -scaledBox.min.y;
  gltf.scene.position.z = -scaledCenter.z;
  
  gltf.scene.name = 'VRM_Model';
  scene.add(gltf.scene);
  
  // Setup camera for optimal viewing
  const finalSize = scaledBox.getSize(new THREE.Vector3());
  const finalHeight = finalSize.y;
  const finalWidth = Math.max(finalSize.x, finalSize.z);
  const cameraDistance = Math.max(finalHeight * 1.5, finalWidth * 2.0, 3.0);
  const lookAtHeight = finalHeight * 0.6;
  
  camera.position.set(0, lookAtHeight, cameraDistance);
  camera.lookAt(0, lookAtHeight, 0);
  
  log('✅ VRM positioned successfully');
  
  // Setup VRM-specific features
  setupVRMFeatures(gltf);
  
  // Preserve original textures
  preserveVRMTextures(gltf.scene);
  
  // Setup animations after a short delay
  setTimeout(() => {
    setupVRMAnimationSystem();
  }, 1000);
}

// ===== VRM FEATURE SETUP =====
function setupVRMFeatures(gltf) {
  log('🚀 Setting up VRM features...');
  
  // Handle animations
  if (gltf.animations && gltf.animations.length > 0) {
    log(`Found ${gltf.animations.length} animations`);
    mixer = new THREE.AnimationMixer(gltf.scene);
    
    // Play the first animation if available
    const action = mixer.clipAction(gltf.animations[0]);
    action.play();
  }
  
  // VRM-specific setup
  if (currentVRM) {
    log('🎭 Configuring VRM-specific features...');
    
    // Humanoid setup
    if (currentVRM.humanoid) {
      log('🤖 VRM Humanoid system available');
      
      // List available humanoid bones
      const humanoidBones = [];
      const humanoidBoneNames = [
        'head', 'neck', 'chest', 'spine', 'hips',
        'leftShoulder', 'rightShoulder',
        'leftUpperArm', 'rightUpperArm',
        'leftLowerArm', 'rightLowerArm',
        'leftHand', 'rightHand'
      ];
      
      humanoidBoneNames.forEach(boneName => {
        try {
          const bone = currentVRM.humanoid.getNormalizedBoneNode(boneName);
          if (bone) {
            humanoidBones.push(boneName);
          }
        } catch (e) {
          // Bone not available
        }
      });
      
      log('Available humanoid bones:', humanoidBones);
    }
    
    // Expression setup
    if (currentVRM.expressionManager) {
      log('😊 VRM Expression system available');
      
      // Get available expressions
      const availableExpressions = [];
      const commonExpressions = [
        'happy', 'angry', 'sad', 'surprised', 'relaxed',
        'neutral', 'blink', 'blinkLeft', 'blinkRight',
        'fun', 'joy', 'sorrow'
      ];
      
      commonExpressions.forEach(expr => {
        try {
          // Test if expression exists by trying to set it to 0
          currentVRM.expressionManager.setValue(expr, 0);
          availableExpressions.push(expr);
        } catch (e) {
          // Expression not available
        }
      });
      
      log('Available expressions:', availableExpressions);
    }
    
    // LookAt setup
    if (currentVRM.lookAt) {
      log('👀 VRM LookAt system available');
      currentVRM.lookAt.target = camera;
    }
  }
}

// ===== PRESERVE VRM TEXTURES =====
function preserveVRMTextures(vrmScene) {
  log('🎨 Preserving VRM textures and materials...');
  
  let preservedCount = 0;
  let enhancedCount = 0;
  
  vrmScene.traverse((child) => {
    if (child.isMesh && child.material) {
      // Check if material has existing textures
      const hasTextures = !!(
        child.material.map ||
        child.material.baseColorTexture ||
        child.material.diffuseTexture ||
        child.material.emissiveMap ||
        child.material.normalMap
      );
      
      if (hasTextures) {
        log(`✅ Preserving textures on: ${child.name}`);
        preservedCount++;
        
        // Ensure proper texture settings
        if (child.material.map) {
          child.material.map.flipY = false; // VRM standard
          child.material.map.colorSpace = THREE.SRGBColorSpace;
        }
        
        // Keep original material properties
        return;
      }
      
      // Only enhance materials that appear to need help
      const materialColor = child.material.color;
      if (materialColor && (
        materialColor.r < 0.1 && materialColor.g < 0.1 && materialColor.b < 0.1 || // Very dark
        materialColor.r === materialColor.g && materialColor.g === materialColor.b // Grayscale
      )) {
        log(`🎨 Enhancing material on: ${child.name}`);
        enhancedCount++;
        
        // Apply subtle enhancements based on mesh name
        const name = child.name.toLowerCase();
        if (name.includes('hair')) {
          child.material.color.setHex(0x8B4513);
        } else if (name.includes('skin') || name.includes('face') || name.includes('body')) {
          child.material.color.setHex(0xFFCDB2);
        } else if (name.includes('eye')) {
          child.material.color.setHex(0x4169E1);
        } else if (name.includes('cloth') || name.includes('dress') || name.includes('shirt')) {
          child.material.color.setHex(0xFF6B6B);
        } else {
          // Brighten existing color slightly
          child.material.color.multiplyScalar(1.3);
        }
        
        // Improve material properties
        child.material.roughness = 0.7;
        child.material.metalness = 0.1;
      }
    }
  });
  
  log(`🎨 Texture preservation complete: ${preservedCount} preserved, ${enhancedCount} enhanced`);
}

// ===== LOGGING =====
function log(msg, data = null) {
  const time = new Date().toLocaleTimeString();
  const entry = `[${time}] ${msg}`;
  console.log(entry, data || '');
  
  const logs = document.getElementById('overlayLogs');
  if (logs) {
    const div = document.createElement('div');
    div.textContent = data ? `${entry} ${JSON.stringify(data)}` : entry;
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
      log(`❌ Script failed: ${src}`, error);
      reject(new Error(`Failed to load script: ${src}`));
    };
    
    document.head.appendChild(script);
  });
}

// ===== THREE.JS SETUP =====
function initThreeEnhanced() {
  return new Promise(async (resolve, reject) => {
    try {
      log('=== ENHANCED THREE.JS INITIALIZATION ===');
      
      await loadThreeJSReliably();
      await loadGLTFLoaderReliably();
      setupThreeJSScene();
      animate();
      createFallbackAvatar();
      
      setTimeout(async () => {
        try {
          await loadVRMWithProperSupport(VRM_PATH);
        } catch (vrmError) {
          log('VRM loading failed, keeping fallback', vrmError);
          handleVRMLoadingError(vrmError);
        }
      }, 1000);
      
      log('=== THREE.JS INITIALIZATION COMPLETE ===');
      resolve();
      
    } catch (err) {
      log('=== INITIALIZATION FAILED ===', err);
      handleVRMLoadingError(err);
      createSimpleFallback();
      reject(err);
    }
  });
}

// ===== RELIABLE THREE.JS LOADING =====
function loadThreeJSReliably() {
  return new Promise(async (resolve, reject) => {
    if (window.THREE) {
      THREE = window.THREE;
      log('Three.js already available');
      resolve();
      return;
    }
    
    const threeSources = [
      'https://cdnjs.cloudflare.com/ajax/libs/three.js/r158/three.min.js',
      'https://unpkg.com/three@0.158.0/build/three.min.js',
      'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js'
    ];
    
    for (const source of threeSources) {
      try {
        log(`Loading Three.js from: ${source}`);
        
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = source;
          script.onload = resolve;
          script.onerror = reject;
          
          const existingScripts = document.querySelectorAll('script[src*="three"]');
          existingScripts.forEach(s => s.remove());
          
          document.head.appendChild(script);
          setTimeout(() => reject(new Error('Timeout')), 10000);
        });
        
        if (window.THREE) {
          THREE = window.THREE;
          log(`✅ Three.js loaded from: ${source}`);
          
          const testScene = new THREE.Scene();
          const testCamera = new THREE.PerspectiveCamera();
          log('Three.js functionality verified');
          resolve();
          return;
        }
        
      } catch (err) {
        log(`Three.js failed from ${source}:`, err.message);
        continue;
      }
    }
    
    reject(new Error('All Three.js sources failed'));
  });
}

// ===== GLTF LOADER =====
function loadGLTFLoaderReliably() {
  return new Promise(async (resolve, reject) => {
    const gltfSources = [
      'https://cdnjs.cloudflare.com/ajax/libs/three.js/r158/loaders/GLTFLoader.js',
      'https://unpkg.com/three@0.158.0/examples/js/loaders/GLTFLoader.js'
    ];
    
    for (const source of gltfSources) {
      try {
        log(`Trying GLTF loader: ${source}`);
        
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = source;
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
          setTimeout(() => reject(new Error('Timeout')), 8000);
        });
        
        if (THREE.GLTFLoader || window.GLTFLoader) {
          if (window.GLTFLoader && !THREE.GLTFLoader) {
            THREE.GLTFLoader = window.GLTFLoader;
          }
          log(`✅ GLTF loader loaded from: ${source}`);
          resolve();
          return;
        }
        
      } catch (err) {
        log(`GLTF loader failed from ${source}:`, err.message);
      }
    }
    
    log('Creating embedded GLTF loader...');
    createProductionGLTFLoader();
    
    if (THREE.GLTFLoader) {
      log('✅ Embedded GLTF loader created');
      resolve();
    } else {
      reject(new Error('All GLTF loader strategies failed'));
    }
  });
}

// ===== EMBEDDED GLTF LOADER =====
function createProductionGLTFLoader() {
  if (!THREE) {
    throw new Error('Three.js not loaded');
  }
  
  THREE.GLTFLoader = function(manager) {
    this.manager = manager || THREE.DefaultLoadingManager;
    this.path = '';
  };
  
  THREE.GLTFLoader.prototype = {
    constructor: THREE.GLTFLoader,
    
    load: function(url, onLoad, onProgress, onError) {
      const scope = this;
      const loader = new THREE.FileLoader(scope.manager);
      loader.setPath(scope.path);
      loader.setResponseType('arraybuffer');
      
      loader.load(url, function(data) {
        try {
          scope.parse(data, onLoad, onError);
        } catch (e) {
          if (onError) onError(e);
          else console.error('GLTFLoader parse error:', e);
        }
      }, onProgress, onError);
    },
    
    parse: function(data, onLoad, onError) {
      try {
        const parser = new GLTFParser(data);
        parser.parse().then(onLoad).catch(onError || console.error);
      } catch (error) {
        if (onError) onError(error);
      }
    }
  };
  
  function GLTFParser(data) {
    this.json = {};
    this.textureLoader = new THREE.TextureLoader();
    this.textureLoader.setCrossOrigin('anonymous');
    this.data = data;
  }
  
  GLTFParser.prototype = {
    parse: function() {
      return new Promise((resolve, reject) => {
        try {
          if (this.data instanceof ArrayBuffer) {
            this.parseGLB();
          }
          
          if (!this.json) {
            throw new Error('No JSON found in GLTF data');
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
        
        if (chunkType === 0x4E4F534A) {
          const jsonChunk = new Uint8Array(this.data, chunkIndex + 8, chunkLength);
          this.json = JSON.parse(new TextDecoder().decode(jsonChunk));
        } else if (chunkType === 0x004E4942) {
          this.body = this.data.slice(chunkIndex + 8, chunkIndex + 8 + chunkLength);
        }
        
        chunkIndex += 8 + chunkLength;
      }
    },
    
    buildScene: function() {
      return new Promise((resolve) => {
        const scene = new THREE.Group();
        scene.name = 'VRM_Scene';
        
        if (this.json.meshes && this.json.nodes) {
          const meshes = this.createMeshes();
          const nodes = this.createNodes(meshes);
          this.buildHierarchy(nodes);
          this.addToScene(scene, nodes);
        }
        
        resolve({
          scene: scene,
          animations: this.json.animations || [],
          userData: { json: this.json }
        });
      });
    },
    
    createMeshes: function() {
      const meshes = [];
      const colors = [0x8B4513, 0xffdbac, 0xff6b6b, 0x4169E1, 0xffdbac, 0x000000];
      
      this.json.meshes.forEach((meshDef, index) => {
        const group = new THREE.Group();
        group.name = meshDef.name || `Mesh_${index}`;
        
        meshDef.primitives.forEach((primitive, primitiveIndex) => {
          try {
            const geometry = this.createGeometry(primitive);
            const color = colors[index % colors.length];
            const material = new THREE.MeshLambertMaterial({ color });
            
            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = `${group.name}_${primitiveIndex}`;
            group.add(mesh);
          } catch (err) {
            console.warn('Failed to create mesh primitive:', err);
          }
        });
        
        meshes[index] = group;
      });
      
      return meshes;
    },
    
    createGeometry: function(primitive) {
      const geometry = new THREE.BufferGeometry();
      
      try {
        if (primitive.attributes.POSITION !== undefined) {
          const accessor = this.json.accessors[primitive.attributes.POSITION];
          const bufferAttribute = this.createBufferAttribute(accessor);
          geometry.setAttribute('position', bufferAttribute);
        }
        
        if (primitive.attributes.NORMAL !== undefined) {
          const accessor = this.json.accessors[primitive.attributes.NORMAL];
          const bufferAttribute = this.createBufferAttribute(accessor);
          geometry.setAttribute('normal', bufferAttribute);
        }
        
        if (primitive.indices !== undefined) {
          const accessor = this.json.accessors[primitive.indices];
          const bufferAttribute = this.createBufferAttribute(accessor);
          geometry.setIndex(bufferAttribute);
        }
        
        if (!primitive.attributes.NORMAL) {
          geometry.computeVertexNormals();
        }
      } catch (err) {
        console.warn('Geometry creation error:', err);
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0,0,0, 1,0,0, 0,1,0]), 3));
      }
      
      return geometry;
    },
    
    createBufferAttribute: function(accessor) {
      try {
        const bufferView = this.json.bufferViews[accessor.bufferView];
        const byteOffset = (accessor.byteOffset || 0) + (bufferView.byteOffset || 0);
        const componentType = accessor.componentType;
        const itemSize = this.getItemSize(accessor.type);
        const TypedArray = this.getTypedArray(componentType);
        
        const array = new TypedArray(this.body, byteOffset, accessor.count * itemSize);
        return new THREE.BufferAttribute(array, itemSize);
      } catch (err) {
        console.warn('Buffer attribute creation failed:', err);
        return new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3);
      }
    },
    
    createNodes: function(meshes) {
      const nodes = [];
      
      this.json.nodes.forEach((nodeDef, index) => {
        const node = new THREE.Object3D();
        node.name = nodeDef.name || `Node_${index}`;
        
        if (nodeDef.matrix) {
          node.matrix.fromArray(nodeDef.matrix);
          node.matrix.decompose(node.position, node.quaternion, node.scale);
        } else {
          if (nodeDef.translation) node.position.fromArray(nodeDef.translation);
          if (nodeDef.rotation) node.quaternion.fromArray(nodeDef.rotation);
          if (nodeDef.scale) node.scale.fromArray(nodeDef.scale);
        }
        
        if (nodeDef.mesh !== undefined && meshes[nodeDef.mesh]) {
          node.add(meshes[nodeDef.mesh]);
        }
        
        nodes[index] = node;
      });
      
      return nodes;
    },
    
    buildHierarchy: function(nodes) {
      this.json.nodes.forEach((nodeDef, index) => {
        if (nodeDef.children) {
          nodeDef.children.forEach(childIndex => {
            if (nodes[childIndex]) {
              nodes[index].add(nodes[childIndex]);
            }
          });
        }
      });
    },
    
    addToScene: function(scene, nodes) {
      if (this.json.scenes && this.json.scenes.length > 0) {
        const sceneDef = this.json.scenes[this.json.scene || 0];
        if (sceneDef.nodes) {
          sceneDef.nodes.forEach(nodeIndex => {
            if (nodes[nodeIndex]) {
              scene.add(nodes[nodeIndex]);
            }
          });
        }
      } else {
        nodes.forEach(node => {
          if (!node.parent) {
            scene.add(node);
          }
        });
      }
    },
    
    getItemSize: function(type) {
      switch (type) {
        case 'SCALAR': return 1;
        case 'VEC2': return 2;
        case 'VEC3': return 3;
        case 'VEC4': return 4;
        default: return 1;
      }
    },
    
    getTypedArray: function(componentType) {
      switch (componentType) {
        case 5120: return Int8Array;
        case 5121: return Uint8Array;
        case 5122: return Int16Array;
        case 5123: return Uint16Array;
        case 5125: return Uint32Array;
        case 5126: return Float32Array;
        default: return Float32Array;
      }
    }
  };
}

// ===== ANIMATION SYSTEM SETUP =====
function setupVRMAnimationSystem() {
  const vrmModel = scene?.getObjectByName('VRM_Model');
  if (!vrmModel) {
    log('❌ No VRM model found for animation setup');
    return;
  }
  
  log('🎭 Setting up comprehensive VRM animation system...');
  
  // Enhanced bone detection
  const { bones, humanoidBones, isVRMHumanoid } = findVRMBonesAdvanced(vrmModel);
  
  // Initialize animation data
  const animationData = {
    model: vrmModel,
    bones: bones,
    humanoidBones: humanoidBones,
    hasVRMHumanoid: isVRMHumanoid,
    hasExpressions: !!(currentVRM && currentVRM.expressionManager && !currentVRM.isStandardGLTF),
    isAnimating: false
  };
  
  // Start appropriate animation system
  if (Object.keys(animationData.bones).length > 0) {
    if (isVRMHumanoid) {
      startVRMBoneAnimations(animationData);
    } else {
      startSceneBoneAnimations(animationData);
    }
  } else {
    startFallbackAnimations(animationData);
  }
  
  // Start expression system
  if (animationData.hasExpressions) {
    startVRMExpressions();
  }
  
  // Global animation functions
  window.vrmAnimationData = animationData;
  
  log(`🎭 Animation system started with ${Object.keys(animationData.bones).length} bones (VRM Humanoid: ${isVRMHumanoid})`);
}

// ===== ENHANCED VRM BONE DETECTION =====
function findVRMBonesAdvanced(vrmModel) {
  const bones = {};
  const humanoidBones = {};
  
  log('🔍 Starting advanced VRM bone detection...');
  
  // Strategy 1: VRM Humanoid system (if available)
  if (currentVRM && currentVRM.humanoid && !currentVRM.isStandardGLTF) {
    log('🤖 Using VRM Humanoid bone system');
    
    const vrmBoneNames = [
      'head', 'neck', 'chest', 'spine', 'hips',
      'leftShoulder', 'rightShoulder',
      'leftUpperArm', 'rightUpperArm',
      'leftLowerArm', 'rightLowerArm',
      'leftHand', 'rightHand'
    ];
    
    vrmBoneNames.forEach(boneName => {
      try {
        const bone = currentVRM.humanoid.getNormalizedBoneNode(boneName);
        if (bone) {
          bones[boneName] = bone;
          humanoidBones[boneName] = bone;
          log(`Found VRM humanoid bone ${boneName}: ${bone.name}`);
        }
      } catch (e) {
        // Bone not available
      }
    });
  }
  
  // Strategy 2: Search scene hierarchy for bone-like objects
  if (Object.keys(bones).length === 0) {
    log('🔍 Searching scene hierarchy for bones...');
    
    const boneKeywords = {
      head: ['head', 'Head', 'HEAD', 'skull', 'Skull', 'neck', 'Neck'],
      neck: ['neck', 'Neck', 'NECK'],
      spine: ['spine', 'Spine', 'SPINE', 'backbone', 'chest', 'Chest'],
      chest: ['chest', 'Chest', 'CHEST', 'torso', 'Torso', 'upperBody'],
      leftShoulder: ['leftshoulder', 'LeftShoulder', 'L_Shoulder', 'shoulder_L', 'shoulderL'],
      rightShoulder: ['rightshoulder', 'RightShoulder', 'R_Shoulder', 'shoulder_R', 'shoulderR'],
      leftUpperArm: ['leftupperarm', 'LeftUpperArm', 'L_UpperArm', 'upperarm_L', 'armL', 'leftarm'],
      rightUpperArm: ['rightupperarm', 'RightUpperArm', 'R_UpperArm', 'upperarm_R', 'armR', 'rightarm'],
      leftLowerArm: ['leftlowerarm', 'LeftLowerArm', 'L_LowerArm', 'lowerarm_L', 'forearmL', 'leftforearm'],
      rightLowerArm: ['rightlowerarm', 'RightLowerArm', 'R_LowerArm', 'lowerarm_R', 'forearmR', 'rightforearm'],
      leftHand: ['lefthand', 'LeftHand', 'L_Hand', 'hand_L', 'handL'],
      rightHand: ['righthand', 'RightHand', 'R_Hand', 'hand_R', 'handR'],
      hips: ['hips', 'Hips', 'HIPS', 'pelvis', 'Pelvis', 'root', 'Root']
    };
    
    // Search all objects in the scene
    vrmModel.traverse((child) => {
      const childName = child.name.toLowerCase();
      const childType = child.type;
      
      // Check if this could be a bone
      const isPotentialBone = (
        childType === 'Bone' || 
        child.isBone || 
        childName.includes('bone') ||
        childName.includes('joint') ||
        childName.includes('armature') ||
        (child.children && child.children.length > 0) // Has children (bone-like structure)
      );
      
      if (isPotentialBone || child.isObject3D) {
        for (const [boneType, keywords] of Object.entries(boneKeywords)) {
          if (!bones[boneType]) {
            for (const keyword of keywords) {
              if (childName.includes(keyword.toLowerCase()) || 
                  childName === keyword.toLowerCase() ||
                  child.name === keyword) {
                bones[boneType] = child;
                log(`Found scene bone ${boneType}: ${child.name} (${child.type})`);
                break;
              }
            }
          }
        }
      }
    });
  }
  
  // Strategy 3: Look for any mesh that could be animated
  if (Object.keys(bones).length === 0) {
    log('🎭 No bones found, searching for animatable meshes...');
    
    const meshParts = {};
    vrmModel.traverse((child) => {
      if (child.isMesh) {
        const name = child.name.toLowerCase();
        
        if (name.includes('head') || name.includes('face') || name.includes('hair')) {
          meshParts.head = child;
          log(`Found head mesh: ${child.name}`);
        } else if (name.includes('body') || name.includes('torso') || name.includes('chest')) {
          meshParts.body = child;
          log(`Found body mesh: ${child.name}`);
        } else if (name.includes('arm') && (name.includes('left') || name.includes('l_'))) {
          meshParts.leftArm = child;
          log(`Found left arm mesh: ${child.name}`);
        } else if (name.includes('arm') && (name.includes('right') || name.includes('r_'))) {
          meshParts.rightArm = child;
          log(`Found right arm mesh: ${child.name}`);
        }
      }
    });
    
    Object.assign(bones, meshParts);
  }
  
  // Strategy 4: Use the VRM model itself for animations
  if (Object.keys(bones).length === 0) {
    log('🎪 Using VRM root for model-level animations');
    bones.root = vrmModel;
  }
  
  const isVRMHumanoid = Object.keys(humanoidBones).length > 0;
  log(`🦴 Bone detection complete: ${Object.keys(bones).length} bones found (VRM Humanoid: ${isVRMHumanoid})`);
  
  return { bones, humanoidBones, isVRMHumanoid };
}

// ===== SCENE BONE ANIMATIONS =====
function startSceneBoneAnimations(animationData) {
  log('🔗 Starting scene bone animations...');
  
  let time = 0;
  let breathingPhase = 0;
  let blinkTimer = 0;
  
  function animateSceneBones() {
    if (!scene?.getObjectByName('VRM_Model') || !animationData.model) return;
    
    time += 0.016;
    breathingPhase += 0.016;
    blinkTimer += 0.016;
    
    const bones = animationData.bones;
    
    // Model-level breathing
    const breathe = 1 + Math.sin(breathingPhase * 2.5) * 0.008;
    animationData.model.scale.y = breathe;
    
    // Head movement (any head-like object)
    if (bones.head && !animationState.isTalking) {
      bones.head.rotation.y = Math.sin(time * 0.8) * 0.03 + (animationTargets.headRotation.y * 0.2);
      bones.head.rotation.x = Math.sin(time * 0.6) * 0.015 + (animationTargets.headRotation.x * 0.2);
      bones.head.rotation.z = Math.sin(time * 0.4) * 0.006;
    }
    
    // Body/spine movement
    if (bones.spine || bones.chest || bones.body) {
      const target = bones.spine || bones.chest || bones.body;
      target.rotation.y = Math.sin(time * 0.5) * 0.008;
      if (target.scale) {
        target.scale.y = 1 + Math.sin(breathingPhase * 2.5) * 0.01;
      }
    }
    
    // Arm movement (if available)
    if (bones.leftArm || bones.leftUpperArm) {
      const arm = bones.leftUpperArm || bones.leftArm;
      if (!animationState.isWaving) {
        arm.rotation.z = Math.sin(time * 1.2) * 0.04;
        arm.rotation.x = Math.sin(time * 0.9) * 0.015;
      }
    }
    
    if (bones.rightArm || bones.rightUpperArm) {
      const arm = bones.rightUpperArm || bones.rightArm;
      if (!animationState.isWaving) {
        arm.rotation.z = Math.sin(time * 1.4) * -0.04;
        arm.rotation.x = Math.sin(time * 1.1) * 0.015;
      }
    }
    
    // Hip movement
    if (bones.hips) {
      bones.hips.rotation.y = Math.sin(time * 0.7) * 0.006;
      bones.hips.position.y += Math.sin(time * 2.8) * 0.0008;
    }
    
    // Model sway
    animationData.model.rotation.y = Math.sin(time * 0.6) * 0.01;
    animationData.model.position.y += Math.sin(time * 2.0) * 0.001;
    
    // Blinking
    if (blinkTimer > 3 + Math.random() * 4) {
      performVRMBlink();
      blinkTimer = 0;
    }
    
    requestAnimationFrame(animateSceneBones);
  }
  
  animateSceneBones();
  log('✅ Scene bone animations started');
}

// ===== VRM BONE ANIMATIONS =====
function startVRMBoneAnimations(animationData) {
  log('🦴 Starting VRM bone animations...');
  
  let time = 0;
  let breathingPhase = 0;
  let blinkTimer = 0;
  
  function animateVRMBones() {
    if (!scene?.getObjectByName('VRM_Model') || !animationData.model) return;
    
    time += 0.016;
    breathingPhase += 0.016;
    blinkTimer += 0.016;
    
    const bones = animationData.bones;
    
    // Breathing animation
    if (bones.chest || bones.spine) {
      const target = bones.chest || bones.spine;
      const breathe = 1 + Math.sin(breathingPhase * 2.5) * 0.012;
      target.scale.y = breathe;
    }
    
    // Head movement (if not talking)
    if (bones.head && !animationState.isTalking) {
      bones.head.rotation.y = Math.sin(time * 0.8) * 0.04 + (animationTargets.headRotation.y * 0.3);
      bones.head.rotation.x = Math.sin(time * 0.6) * 0.02 + (animationTargets.headRotation.x * 0.3);
      bones.head.rotation.z = Math.sin(time * 0.4) * 0.008;
    }
    
    // Neck support
    if (bones.neck && !animationState.isTalking) {
      bones.neck.rotation.y = Math.sin(time * 0.5) * 0.01;
    }
    
    // Shoulder movement
    if (bones.leftShoulder) {
      bones.leftShoulder.rotation.z = Math.sin(time * 1.2) * 0.025;
    }
    if (bones.rightShoulder) {
      bones.rightShoulder.rotation.z = Math.sin(time * 1.4) * -0.025;
    }
    
    // Arm movement (if not waving)
    if (bones.leftUpperArm && !animationState.isWaving) {
      bones.leftUpperArm.rotation.z = Math.sin(time * 1.1) * 0.06;
      bones.leftUpperArm.rotation.x = Math.sin(time * 0.9) * 0.02;
    }
    
    if (bones.rightUpperArm && !animationState.isWaving) {
      bones.rightUpperArm.rotation.z = Math.sin(time * 1.3) * -0.06;
      bones.rightUpperArm.rotation.x = Math.sin(time * 1.1) * 0.02;
    }
    
    // Lower arm movement
    if (bones.leftLowerArm && !animationState.isWaving) {
      bones.leftLowerArm.rotation.y = Math.sin(time * 1.5) * 0.03;
    }
    
    if (bones.rightLowerArm && !animationState.isWaving) {
      bones.rightLowerArm.rotation.y = Math.sin(time * 1.7) * 0.03;
    }
    
    // Hand movement
    if (bones.leftHand) {
      bones.leftHand.rotation.z = Math.sin(time * 2.1) * 0.015;
    }
    if (bones.rightHand) {
      bones.rightHand.rotation.z = Math.sin(time * 2.3) * 0.015;
    }
    
    // Hip movement
    if (bones.hips) {
      bones.hips.rotation.y = Math.sin(time * 0.7) * 0.008;
      bones.hips.position.y += Math.sin(time * 2.8) * 0.001;
    }
    
    // Blinking
    if (blinkTimer > 3 + Math.random() * 4) {
      performVRMBlink();
      blinkTimer = 0;
    }
    
    requestAnimationFrame(animateVRMBones);
  }
  
  animateVRMBones();
  log('✅ VRM bone animations started');
}

// ===== FALLBACK ANIMATIONS =====
function startFallbackAnimations(animationData) {
  log('🎪 Starting fallback model animations...');
  
  let time = 0;
  
  function animateFallback() {
    if (!animationData.model) return;
    
    time += 0.016;
    
    // Model-level animations
    animationData.model.position.y += Math.sin(time * 2.0) * 0.001;
    animationData.model.rotation.y = Math.sin(time * 0.6) * 0.012;
    animationData.model.rotation.z = Math.sin(time * 0.4) * 0.004;
    
    // Breathing effect
    const breathe = 1 + Math.sin(time * 2.2) * 0.006;
    animationData.model.scale.y = breathe;
    
    requestAnimationFrame(animateFallback);
  }
  
  animateFallback();
  log('✅ Fallback animations started');
}

// ===== VRM EXPRESSIONS =====
function startVRMExpressions() {
  if (!currentVRM || !currentVRM.expressionManager) return;
  
  log('😊 Starting VRM expression cycles...');
  
  const expressions = ['happy', 'relaxed', 'surprised', 'neutral', 'fun'];
  
  function cycleExpression() {
    const randomExpression = expressions[Math.floor(Math.random() * expressions.length)];
    const intensity = 0.3 + Math.random() * 0.4;
    
    try {
      currentVRM.expressionManager.setValue(randomExpression, intensity);
      
      setTimeout(() => {
        if (currentVRM && currentVRM.expressionManager) {
          currentVRM.expressionManager.setValue(randomExpression, 0);
        }
      }, 2000 + Math.random() * 2000);
      
    } catch (e) {
      // Expression not available
    }
    
    // Next expression
    setTimeout(cycleExpression, 4000 + Math.random() * 6000);
  }
  
  setTimeout(cycleExpression, 3000);
  log('✅ VRM expressions started');
}

// ===== ENHANCED WAVE ANIMATION =====
function playEnhancedVRMWave() {
  const animationData = window.vrmAnimationData;
  if (!animationData || !animationData.bones.rightUpperArm) {
    log('⚠️ No right arm bone available for waving');
    return;
  }
  
  log('👋 Playing enhanced VRM wave...');
  animationState.isWaving = true;
  
  const rightArm = animationData.bones.rightUpperArm;
  const rightLowerArm = animationData.bones.rightLowerArm;
  const rightHand = animationData.bones.rightHand;
  
  // Save original positions
  const originalRotations = {
    upperArm: rightArm.rotation.clone(),
    lowerArm: rightLowerArm ? rightLowerArm.rotation.clone() : null,
    hand: rightHand ? rightHand.rotation.clone() : null
  };
  
  // Enhanced wave sequence
  const waveFrames = [
    { time: 0, upper: {x: 0, y: 0, z: 0}, lower: {x: 0, y: 0, z: 0}, hand: {x: 0, y: 0, z: 0} },
    { time: 0.4, upper: {x: 0.9, y: 0.2, z: -0.9}, lower: {x: 0, y: 0, z: -0.8}, hand: {x: 0, y: 0, z: 0.4} },
    { time: 0.7, upper: {x: 0.7, y: 0.1, z: -0.7}, lower: {x: 0, y: 0, z: -0.5}, hand: {x: 0, y: 0, z: -0.4} },
    { time: 1.0, upper: {x: 0.9, y: 0.2, z: -0.9}, lower: {x: 0, y: 0, z: -0.8}, hand: {x: 0, y: 0, z: 0.4} },
    { time: 1.3, upper: {x: 0.7, y: 0.1, z: -0.7}, lower: {x: 0, y: 0, z: -0.5}, hand: {x: 0, y: 0, z: -0.4} },
    { time: 1.6, upper: {x: 0.9, y: 0.2, z: -0.9}, lower: {x: 0, y: 0, z: -0.8}, hand: {x: 0, y: 0, z: 0.4} },
    { time: 2.2, upper: {x: 0, y: 0, z: 0}, lower: {x: 0, y: 0, z: 0}, hand: {x: 0, y: 0, z: 0} }
  ];
  
  let frameIndex = 0;
  const startTime = Date.now();
  
  function animateWave() {
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
      log('👋 Enhanced wave complete');
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
      rightLowerArm.rotation.x = THREE.MathUtils.lerp(currentFrame.lower.x, nextFrame.lower.x, smoothProgress);
      rightLowerArm.rotation.y = THREE.MathUtils.lerp(currentFrame.lower.y, nextFrame.lower.y, smoothProgress);
      rightLowerArm.rotation.z = THREE.MathUtils.lerp(currentFrame.lower.z, nextFrame.lower.z, smoothProgress);
    }
    
    // Animate hand
    if (rightHand) {
      rightHand.rotation.x = THREE.MathUtils.lerp(currentFrame.hand.x, nextFrame.hand.x, smoothProgress);
      rightHand.rotation.y = THREE.MathUtils.lerp(currentFrame.hand.y, nextFrame.hand.y, smoothProgress);
      rightHand.rotation.z = THREE.MathUtils.lerp(currentFrame.hand.z, nextFrame.hand.z, smoothProgress);
    }
    
    requestAnimationFrame(animateWave);
  }
  
  animateWave();
}

// ===== VRM BLINKING =====
function performVRMBlink() {
  if (currentVRM && currentVRM.expressionManager) {
    try {
      currentVRM.expressionManager.setValue('blink', 1.0);
      setTimeout(() => {
        if (currentVRM && currentVRM.expressionManager) {
          currentVRM.expressionManager.setValue('blink', 0);
        }
      }, 150);
    } catch (e) {
      // Blink expression not available
    }
  }
}

// ===== SCENE SETUP =====
function setupThreeJSScene() {
  log('Setting up Three.js scene...');
  
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e17);
  
  camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 20);
  camera.position.set(0, 1.3, 2.5);
  camera.lookAt(0, 1, 0);
  
  const canvas = document.getElementById('vrmCanvas');
  if (!canvas) {
    throw new Error('Canvas element not found');
  }
  
  renderer = new THREE.WebGLRenderer({ 
    canvas, 
    antialias: true,
    alpha: true 
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  
  try {
    if (renderer.outputColorSpace !== undefined) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else if (renderer.outputEncoding !== undefined) {
      renderer.outputEncoding = THREE.sRGBEncoding;
    }
  } catch (colorSpaceError) {
    log('Color space setting failed, continuing', colorSpaceError);
  }
  
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);
  
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(1, 1, 1);
  scene.add(dirLight);
  
  clock = new THREE.Clock();
  
  log('Scene setup complete');
}

// ===== ERROR HANDLING =====
function handleVRMLoadingError(error) {
  log('VRM loading error:', error);
  
  const errorTypes = {
    'GLTFLoader': 'GLTF loader failed',
    'NetworkError': 'Network issue',
    'timeout': 'Loading timeout',
    'parse': 'File format issue'
  };
  
  let errorType = 'unknown';
  let solution = 'Try refreshing';
  
  const errorMsg = error.message.toLowerCase();
  
  if (errorMsg.includes('gltf') || errorMsg.includes('loader')) {
    errorType = 'GLTFLoader';
    solution = 'Using emergency fallback';
    createEmergencyFallback();
  } else if (errorMsg.includes('network') || errorMsg.includes('fetch')) {
    errorType = 'NetworkError';
    solution = 'Check connection';
  } else if (errorMsg.includes('timeout')) {
    errorType = 'timeout';
    solution = 'Large file, please wait';
  }
  
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
    ${errorTypes[errorType] || 'Unknown error'}<br>
    <em>${solution}</em><br>
    <small>Click to dismiss</small>
  `;
  
  errorDiv.onclick = () => errorDiv.remove();
  document.body.appendChild(errorDiv);
  
  setTimeout(() => {
    if (errorDiv.parentNode) errorDiv.remove();
  }, 10000);
}

// ===== LOADING PROGRESS =====
function updateLoadingProgress(stage, percent = null) {
  const statusEl = document.getElementById('loadingStatus');
  if (!statusEl) return;
  
  const stages = {
    'three': '🔧 Loading 3D Engine',
    'gltf': '📦 Loading GLTF Loader', 
    'vrm': '👤 Loading Avatar',
    'positioning': '📍 Positioning Avatar',
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

// ===== FALLBACK AVATARS =====
function createEmergencyFallback() {
  log('Creating emergency fallback...');
  
  const character = new THREE.Group();
  character.name = 'EmergencyFallback';
  
  const headGeo = new THREE.SphereGeometry(0.12, 32, 32);
  const headMat = new THREE.MeshLambertMaterial({ color: 0xffdbac });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.6;
  character.add(head);
  
  const hairGeo = new THREE.SphereGeometry(0.15, 24, 24);
  const hairMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
  const hair = new THREE.Mesh(hairGeo, hairMat);
  hair.position.y = 1.7;
  hair.scale.set(1.4, 0.9, 1.3);
  character.add(hair);
  
  const eyeGeo = new THREE.SphereGeometry(0.025, 12, 12);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x4169E1 });
  
  const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
  leftEye.position.set(-0.045, 1.62, 0.11);
  character.add(leftEye);
  
  const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
  rightEye.position.set(0.045, 1.62, 0.11);
  character.add(rightEye);
  
  const bodyGeo = new THREE.CylinderGeometry(0.15, 0.18, 0.5, 12);
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0xff6b6b });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 1.1;
  character.add(body);
  
  const skirtGeo = new THREE.CylinderGeometry(0.18, 0.25, 0.3, 12);
  const skirtMat = new THREE.MeshLambertMaterial({ color: 0x4169E1 });
  const skirt = new THREE.Mesh(skirtGeo, skirtMat);
  skirt.position.y = 0.75;
  character.add(skirt);
  
  character.position.y = -0.1;
  scene.add(character);
  
  let time = 0;
  let blinkTimer = 0;
  
  function animateEmergencyFallback() {
    const fallbackChar = scene.getObjectByName('EmergencyFallback');
    if (!fallbackChar) return;
    
    time += 0.016;
    blinkTimer += 0.016;
    
    character.scale.y = 1 + Math.sin(time * 3) * 0.01;
    character.rotation.y = Math.sin(time * 0.8) * 0.05;
    
    head.rotation.y = Math.sin(time * 1.2) * 0.1;
    head.rotation.x = Math.sin(time * 0.9) * 0.03;
    
    hair.rotation.z = Math.sin(time * 1.5) * 0.02;
    
    if (blinkTimer > 3) {
      leftEye.scale.y = 0.1;
      rightEye.scale.y = 0.1;
      setTimeout(() => {
        leftEye.scale.y = 1;
        rightEye.scale.y = 1;
      }, 150);
      blinkTimer = 0;
    }
    
    requestAnimationFrame(animateEmergencyFallback);
  }
  
  animateEmergencyFallback();
  log('Emergency fallback created with animations');
}

function createFallbackAvatar() {
  try {
    const geometry = new THREE.SphereGeometry(0.3, 32, 32);
    const material = new THREE.MeshLambertMaterial({ color: 0x4a90e2 });
    const avatar = new THREE.Mesh(geometry, material);
    avatar.position.set(0, 0.5, 0);
    avatar.name = 'fallbackAvatar';
    scene.add(avatar);
    
    function animateFallback() {
      const fallback = scene.getObjectByName('fallbackAvatar');
      if (fallback) {
        avatar.rotation.y += 0.01;
        requestAnimationFrame(animateFallback);
      }
    }
    animateFallback();
    
    log('Fallback avatar created');
  } catch (err) {
    log('Failed to create fallback avatar', err);
  }
}

function createSimpleFallback() {
  const canvas = document.getElementById('vrmCanvas');
  if (canvas) {
    canvas.style.display = 'none';
  }
  
  const fallback = document.createElement('div');
  fallback.style.cssText = `
    position: absolute; top: 50%; left: 50%;
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

// ===== ANIMATION LOOP =====
function animate() {
  requestAnimationFrame(animate);
  
  if (!renderer || !scene || !camera) return;
  
  const delta = clock.getDelta();
  if (mixer) mixer.update(delta);
  if (currentVRM) currentVRM.update(delta);
  
  renderer.render(scene, camera);
}

// ===== WEBSOCKET =====
function connectWebSocket() {
  if (ws) ws.close();
  
  try {
    ws = new WebSocket(HELIUS_WS);
    
    ws.onopen = () => {
      log('WebSocket connected');
      const wsLight = document.getElementById('wsLight');
      if (wsLight) {
        wsLight.textContent = 'WS ON';
        wsLight.classList.add('online');
      }
    };
    
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.tps) updateTPS(data.tps);
      } catch (err) {
        log('WebSocket message error', err);
      }
    };
    
    ws.onclose = () => {
      log('WebSocket closed, reconnecting...');
      const wsLight = document.getElementById('wsLight');
      if (wsLight) {
        wsLight.textContent = 'WS OFF';
        wsLight.classList.remove('online');
      }
      
      if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
      wsReconnectTimer = setTimeout(connectWebSocket, 5000);
    };
    
    ws.onerror = (err) => log('WebSocket error', err);
    
  } catch (err) {
    log('WebSocket connection failed', err);
    if (!tpsUpdateTimer) {
      tpsUpdateTimer = setInterval(() => {
        fetchTPS().catch(e => log('TPS polling error:', e));
      }, 10000);
    }
  }
}

function updateTPS(tps) {
  const networkTPS = document.getElementById('networkTPS');
  if (networkTPS) {
    networkTPS.textContent = `${tps} TPS`;
  }
}

// ===== API CALLS =====
function fetchPrice() {
  return new Promise(async (resolve, reject) => {
    try {
      log('=== FETCHING PRICE DATA (ENHANCED) ===');
      const url = `/api/price?ids=${SOL_MINT}`;
      
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      
      const data = await res.json();
      log('Raw price data received:', data);
      
      const solPrice = document.getElementById('solPrice');
      if (!solPrice) {
        resolve();
        return;
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
        log('❌ Could not find price in:', data);
      }
      
      resolve();
    } catch (err) {
      log('Price fetch failed:', err);
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
      log('TPS fetch failed:', err);
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
        log('Failed to save conversation', storageErr);
      }
      
      queueTTS(content);
      resolve(content);
    } catch (err) {
      log('Chat failed:', err);
      const errorMsg = 'Sorry, chat is temporarily unavailable. Please try again!';
      alert(errorMsg);
      resolve(errorMsg);
    }
  });
}

// ===== ENHANCED TTS SYSTEM WITH SPEECH ANIMATIONS =====
function queueTTS(text, voice = 'nova') {
  audioQueue.push({ text, voice });
  if (!isPlaying) playNextAudio();
  
  // Start speech animation
  startSpeechAnimation(text);
}

function startSpeechAnimation(text) {
  log('🗣️ Starting speech animation');
  animationState.isTalking = true;
  
  const animationData = window.vrmAnimationData;
  if (animationData && animationData.bones.head) {
    const speechDuration = text.length * 50; // Rough estimate
    let speechTime = 0;
    
    function animateSpeech() {
      if (!animationState.isTalking) return;
      
      speechTime += 16;
      
      // Natural head movement during speech
      const intensity = 0.05;
      animationData.bones.head.rotation.y = Math.sin(speechTime * 0.005) * intensity;
      animationData.bones.head.rotation.x = Math.sin(speechTime * 0.003) * intensity * 0.5;
      
      // Slight body animation
      const vrmModel = scene.getObjectByName('VRM_Model');
      if (vrmModel) {
        vrmModel.rotation.y = Math.sin(speechTime * 0.002) * 0.01;
      }
      
      if (speechTime < speechDuration) {
        requestAnimationFrame(animateSpeech);
      } else {
        stopSpeechAnimation();
      }
    }
    
    animateSpeech();
  }
}

function stopSpeechAnimation() {
  log('🔇 Stopping speech animation');
  animationState.isTalking = false;
  
  // Reset head position smoothly
  animationTargets.headRotation = { x: 0, y: 0, z: 0 };
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
    log('Fallback TTS failed:', err);
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
        log('Audio playback failed:', err);
        isPlaying = false;
        stopSpeechAnimation();
        reject(err);
      };
      
      audio.play().then(resolve).catch(reject);
    } catch (err) {
      log('Audio play error:', err);
      isPlaying = false;
      stopSpeechAnimation();
      reject(err);
    }
  });
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
      log('TTS failed, using browser fallback:', err);
      fallbackTTS(text, voice);
      resolve();
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
  
  window.addEventListener('resize', () => {
    if (camera && renderer) {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
  });
  
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'd') {
      e.preventDefault();
      const logs = document.getElementById('debugOverlay');
      if (logs) logs.classList.toggle('hidden');
    }
  });
  
  try {
    const saved = localStorage.getItem('solmateConversation');
    if (saved) {
      conversation = JSON.parse(saved);
      log(`Loaded ${conversation.length} conversation messages`);
    }
  } catch (err) {
    log('Failed to load conversation history:', err);
  }
  
  document.addEventListener('click', enableAudio, { once: true });
  document.addEventListener('keydown', enableAudio, { once: true });
  
  // Interaction system for head tracking
  document.addEventListener('mousemove', (event) => {
    if (animationState.isTalking) return;
    
    const mouseX = (event.clientX / window.innerWidth) * 2 - 1;
    const mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
    
    animationTargets.headRotation.y = mouseX * 0.2;
    animationTargets.headRotation.x = mouseY * 0.1;
  });
  
  document.addEventListener('mouseleave', () => {
    if (!animationState.isTalking) {
      animationTargets.headRotation = { x: 0, y: 0, z: 0 };
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
    log('Audio enable failed:', e);
  }
}

// ===== BASIC THREE.JS FALLBACK =====
function initBasicThreeJS() {
  return new Promise(async (resolve, reject) => {
    try {
      log('Initializing basic Three.js...');
      
      if (!window.THREE) {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/three.js/r158/three.min.js');
        THREE = window.THREE;
      }
      
      if (!THREE) {
        throw new Error('Could not load Three.js');
      }
      
      setupThreeJSScene();
      animate();
      
      log('Basic Three.js setup complete');
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

// ===== MAIN INITIALIZATION =====
function init() {
  return new Promise(async (resolve) => {
    log('=== INITIALIZING SOLMATE ===');
    
    try {
      // Setup UI first
      setupUI();
      
      // Start API calls
      try {
        await fetchPrice();
      } catch (priceErr) {
        log('Initial price fetch failed:', priceErr);
      }
      
      try {
        await fetchTPS();
      } catch (tpsErr) {
        log('Initial TPS fetch failed:', tpsErr);
      }
      
      // Start periodic updates
      priceUpdateTimer = setInterval(() => {
        fetchPrice().catch(err => log('Price update failed:', err));
      }, 30000);
      
      tpsUpdateTimer = setInterval(() => {
        fetchTPS().catch(err => log('TPS update failed:', err));
      }, 60000);
      
      // Initialize 3D system
      try {
        await initThreeEnhanced();
      } catch (threeError) {
        log('3D initialization failed, trying basic mode:', threeError);
        try {
          await initBasicThreeJS();
          createEmergencyFallback();
        } catch (emergencyError) {
          log('All 3D systems failed, audio-only mode:', emergencyError);
          createSimpleFallback();
        }
      }
      
      // Connect WebSocket
      connectWebSocket();
      
      log('=== INITIALIZATION COMPLETE ===');
      
      // Welcome message
      setTimeout(() => {
        queueTTS("Hello! I'm your enhanced Solana companion, Solmate. I have proper animations and preserved textures now!", 'nova');
      }, 2000);
      
      resolve();
      
    } catch (err) {
      log('=== INITIALIZATION FAILED ===', err);
      setupUI();
      
      try {
        await fetchPrice();
        await fetchTPS();
        priceUpdateTimer = setInterval(() => {
          fetchPrice().catch(e => log('Price error:', e));
        }, 30000);
        tpsUpdateTimer = setInterval(() => {
          fetchTPS().catch(e => log('TPS error:', e));
        }, 60000);
      } catch (apiError) {
        log('API initialization failed:', apiError);
      }
      
      createSimpleFallback();
      resolve();
    }
  });
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

// ===== ENHANCED DEBUG COMMANDS =====
window.debugVRM = function() {
  console.log('=== VRM DEBUG REPORT ===');
  console.log('Three.js loaded:', !!window.THREE);
  console.log('GLTF Loader available:', !!(THREE && THREE.GLTFLoader));
  console.log('Scene:', !!scene);
  console.log('Camera:', !!camera);
  console.log('Renderer:', !!renderer);
  console.log('VRM loaded:', !!scene?.getObjectByName('VRM_Model'));
  console.log('Current VRM:', !!currentVRM);
  console.log('VRM Humanoid:', !!(currentVRM && currentVRM.humanoid));
  console.log('VRM Expressions:', !!(currentVRM && currentVRM.expressionManager));
  console.log('Animation Data:', !!window.vrmAnimationData);
  
  if (window.vrmAnimationData) {
    console.log('Available bones:', Object.keys(window.vrmAnimationData.bones));
  }
  
  if (scene) {
    console.log('Scene objects:', scene.children.map(c => c.name));
  }
};

window.debugVRMBones = function() {
  const vrmModel = scene?.getObjectByName('VRM_Model');
  if (vrmModel && window.vrmAnimationData) {
    const data = window.vrmAnimationData;
    console.log('🦴 VRM Bone Debug:', {
      totalBones: Object.keys(data.bones).length,
      hasVRMHumanoid: data.hasVRMHumanoid,
      hasExpressions: data.hasExpressions,
      bones: Object.keys(data.bones),
      hasVRM: !!currentVRM,
      hasHumanoid: !!(currentVRM && currentVRM.humanoid),
      hasExpressionsManager: !!(currentVRM && currentVRM.expressionManager)
    });
    return data;
  }
  return null;
};

window.reloadVRM = function() {
  return new Promise(async (resolve) => {
    log('🔄 Manually reloading VRM...');
    
    ['fallbackAvatar', 'alternativeAvatar', 'VRM_Model', 'EmergencyFallback'].forEach(name => {
      const existing = scene?.getObjectByName(name);
      if (existing) {
        scene.remove(existing);
        log(`Removed ${name}`);
      }
    });
    
    if (camera) {
      camera.position.set(0, 1.3, 2.5);
      camera.lookAt(0, 1, 0);
    }
    
    createFallbackAvatar();
    
    setTimeout(async () => {
      try {
        await loadVRMWithProperSupport(VRM_PATH);
        log('✅ VRM reload successful!');
        resolve('VRM reloaded successfully');
      } catch (err) {
        log('❌ VRM reload failed:', err);
        resolve('VRM reload failed: ' + err.message);
      }
    }, 1000);
  });
};

window.createEmergency = function() {
  createEmergencyFallback();
};

window.testChat = function() {
  return sendMessage("Hello Solmate! How are you?");
};

window.testTTS = function() {
  queueTTS("Hello! I'm testing the enhanced text to speech system with animations. How does this look and sound?", 'nova');
};

window.playEnhancedWave = playEnhancedVRMWave;

window.testVRMSystem = function() {
  console.log('🧪 Testing enhanced VRM system...');
  
  if (window.vrmAnimationData) {
    console.log('Animation data:', window.vrmAnimationData);
    console.log('Available bones:', Object.keys(window.vrmAnimationData.bones));
    console.log('VRM capabilities:', {
      hasVRM: !!currentVRM,
      hasHumanoid: !!(currentVRM && currentVRM.humanoid),
      hasExpressions: !!(currentVRM && currentVRM.expressionManager),
      hasLookAt: !!(currentVRM && currentVRM.lookAt)
    });
  }
  
  // Test wave
  setTimeout(() => {
    playEnhancedVRMWave();
  }, 1000);
  
  // Test expression
  if (currentVRM && currentVRM.expressionManager) {
    setTimeout(() => {
      try {
        currentVRM.expressionManager.setValue('happy', 0.8);
        setTimeout(() => {
          currentVRM.expressionManager.setValue('happy', 0);
        }, 2000);
      } catch (e) {
        console.log('Happy expression not available');
      }
    }, 3000);
  }
};

window.debugVRMPlugin = function() {
  console.log('=== VRM PLUGIN DEBUG ===');
  console.log('Window VRM:', !!window.VRM);
  if (window.VRM) {
    console.log('VRM object keys:', Object.keys(window.VRM));
  }
  console.log('Window THREE VRM keys:', window.THREE ? Object.keys(window.THREE).filter(k => k.includes('VRM')) : 'No THREE');
  console.log('Current VRM:', !!currentVRM);
  if (currentVRM) {
    console.log('VRM properties:', Object.keys(currentVRM));
    console.log('Is standard GLTF:', currentVRM.isStandardGLTF);
  }
  
  // Test VRM plugin registration
  try {
    const testLoader = new THREE.GLTFLoader();
    if (window.VRM && window.VRM.VRMLoaderPlugin) {
      testLoader.register((parser) => new window.VRM.VRMLoaderPlugin(parser));
      console.log('✅ VRM plugin can be registered');
    } else {
      console.log('❌ VRM plugin not available for registration');
    }
  } catch (e) {
    console.log('❌ VRM plugin registration test failed:', e);
  }
};

window.fixVRMTextures = function() {
  const vrmModel = scene?.getObjectByName('VRM_Model');
  if (vrmModel) {
    console.log('🎨 Fixing VRM textures...');
    preserveVRMTextures(vrmModel);
  }
};

window.fixPrice = function() {
  console.log('💰 Fixing price...');
  fetchPrice();
};

window.testVRMBoneDetection = function() {
  const vrmModel = scene?.getObjectByName('VRM_Model');
  if (vrmModel) {
    console.log('🔍 Testing enhanced bone detection...');
    const result = findVRMBonesAdvanced(vrmModel);
    console.log('Bone detection result:', result);
    return result;
  }
  return null;
};

// ===== CONSOLE MESSAGES =====
console.log('🚀 Enhanced Solmate VRM Companion loaded!');
console.log('📋 Debug commands: debugVRM(), debugVRMBones(), debugVRMPlugin(), reloadVRM(), testVRMSystem()');
console.log('🎭 Animation commands: playEnhancedWave(), testTTS(), testChat()');
console.log('🔧 Fixes: fixVRMTextures(), fixPrice(), testVRMBoneDetection()');
console.log('👀 Move your mouse around to see head tracking!');

// ===== START APPLICATION =====
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ===== AUTO-START ENHANCED VRM SYSTEM =====
setTimeout(() => {
  const vrmModel = scene?.getObjectByName('VRM_Model');
  if (vrmModel) {
    console.log('🚀 Auto-starting enhanced VRM system...');
    
    // Test wave after everything is set up
    setTimeout(() => {
      if (window.vrmAnimationData && Object.keys(window.vrmAnimationData.bones).length > 0) {
        playEnhancedVRMWave();
        queueTTS("Hello! I'm your enhanced VRM assistant with proper bone animations and preserved textures!", 'nova');
      } else {
        queueTTS("Hello! I'm your Solana companion Solmate. My animations are loading!", 'nova');
      }
    }, 2000);
  }
}, 10000); // Start after VRM is fully loaded and processed
