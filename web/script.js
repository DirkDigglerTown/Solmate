// web/script.js - Complete Solmate Implementation
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
          await loadVRMWithReliableLoader(VRM_PATH);
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

// ===== VRM LOADING =====
function loadVRMWithReliableLoader(url, retryCount = 0) {
  return new Promise(async (resolve, reject) => {
    try {
      log(`=== LOADING VRM (attempt ${retryCount + 1}) ===`);
      updateLoadingProgress('vrm', 0);
      
      if (!THREE.GLTFLoader) {
        throw new Error('No GLTF loader available');
      }
      
      const checkResponse = await fetch(url, { method: 'HEAD' });
      if (!checkResponse.ok) {
        throw new Error(`VRM file not accessible: ${checkResponse.status}`);
      }
      
      const contentLength = checkResponse.headers.get('content-length');
      const fileSizeMB = contentLength ? Math.round(contentLength / 1024 / 1024) : 'unknown';
      log(`VRM file size: ${fileSizeMB}MB`);
      
      const loader = new THREE.GLTFLoader();
      
      const gltf = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('VRM loading timeout'));
        }, ASSET_LOAD_TIMEOUT);
        
        loader.load(
          url,
          (loadedGltf) => {
            clearTimeout(timeoutId);
            log('✅ VRM GLTF loaded successfully!');
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
      
      ['fallbackAvatar', 'alternativeAvatar', 'VRM_Model', 'EmergencyFallback'].forEach(name => {
        const existing = scene.getObjectByName(name);
        if (existing) {
          scene.remove(existing);
          log(`Removed existing ${name}`);
        }
      });
      
      if (gltf.scene) {
        updateLoadingProgress('positioning');
        processAndAddVRM(gltf);
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
          loadVRMWithReliableLoader(url, retryCount + 1).then(resolve).catch(reject);
        }, 3000);
      } else {
        log('❌ VRM loading failed completely', err);
        handleVRMLoadingError(err);
        reject(err);
      }
    }
  });
}

// ===== PROCESS VRM =====
function processAndAddVRM(gltf) {
  log('Processing VRM for display...');
  
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  
  log('VRM dimensions:', {
    size: { x: size.x.toFixed(2), y: size.y.toFixed(2), z: size.z.toFixed(2) },
    center: { x: center.x.toFixed(2), y: center.y.toFixed(2), z: center.z.toFixed(2) }
  });
  
  let scale = 1.0;
  if (size.y > 50) {
    scale = 1.8 / size.y;
    gltf.scene.scale.setScalar(scale);
    log(`Applied scaling: ${scale.toFixed(4)}`);
  }
  
  const scaledBox = new THREE.Box3().setFromObject(gltf.scene);
  const scaledSize = scaledBox.getSize(new THREE.Vector3());
  const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
  
  gltf.scene.position.x = -scaledCenter.x;
  gltf.scene.position.y = -scaledBox.min.y;
  gltf.scene.position.z = -scaledCenter.z;
  
  gltf.scene.name = 'VRM_Model';
  scene.add(gltf.scene);
  
  const finalHeight = scaledSize.y;
  const finalWidth = Math.max(scaledSize.x, scaledSize.z);
  const cameraDistance = Math.max(finalHeight * 1.5, finalWidth * 2.0, 3.0);
  const lookAtHeight = finalHeight * 0.6;
  
  camera.position.set(0, lookAtHeight, cameraDistance);
  camera.lookAt(0, lookAtHeight, 0);
  
  log('VRM positioned successfully');
  
  if (gltf.animations && gltf.animations.length > 0) {
    log(`Setting up ${gltf.animations.length} animations`);
    mixer = new THREE.AnimationMixer(gltf.scene);
    const action = mixer.clipAction(gltf.animations[0]);
    action.play();
  }
  
  if (gltf.userData && gltf.userData.vrm) {
    currentVRM = gltf.userData.vrm;
    log('VRM expressions available');
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
      log('Fetching price data...');
      const url = `/api/price?ids=${SOL_MINT}`;
      
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      
      const data = await res.json();
      const solPrice = document.getElementById('solPrice');
      if (!solPrice) {
        resolve();
        return;
      }
      
      let price = null;
      
      if (data.data && typeof data.data === 'object' && data.data[SOL_MINT]) {
        const solData = data.data[SOL_MINT];
        if (typeof solData.price === 'number') {
          price = solData.price;
        }
      } else if (typeof data.price === 'number') {
        price = data.price;
      }
      
      if (price !== null && !isNaN(price) && price > 0) {
        solPrice.textContent = `SOL — ${price.toFixed(2)}`;
        solPrice.style.color = '#00ff88';
        log(`Price updated: ${price.toFixed(2)}`);
      } else {
        solPrice.textContent = 'SOL — Error';
        solPrice.style.color = '#ff6b6b';
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

// ===== TTS SYSTEM =====
function queueTTS(text, voice = 'nova') {
  audioQueue.push({ text, voice });
  if (!isPlaying) playNextAudio();
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
      playNextAudio();
    };
    
    utterance.onerror = () => {
      isPlaying = false;
      playNextAudio();
    };
    
    speechSynthesis.speak(utterance);
    isPlaying = true;
    log('Browser TTS playing');
  } catch (err) {
    log('Fallback TTS failed:', err);
    isPlaying = false;
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
        playNextAudio();
        resolve();
      };
      
      audio.onerror = (err) => {
        log('Audio playback failed:', err);
        isPlaying = false;
        reject(err);
      };
      
      audio.play().then(resolve).catch(reject);
    } catch (err) {
      log('Audio play error:', err);
      isPlaying = false;
      reject(err);
    }
  });
}

function playNextAudio() {
  return new Promise(async (resolve) => {
    if (audioQueue.length === 0) {
      isPlaying = false;
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
        queueTTS("Hello! I'm your Solana companion, Solmate. How can I help you today?", 'nova');
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
          fetchTTS().catch(e => log('TPS error:', e));
        }, 60000);
      } catch (apiError) {
        log('API initialization failed:', apiError);
      }
      
      createSimpleFallback();
      resolve();
    }
  });
}

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
  console.log('Three.js loaded:', !!window.THREE);
  console.log('GLTF Loader available:', !!(THREE && THREE.GLTFLoader));
  console.log('Scene:', !!scene);
  console.log('Camera:', !!camera);
  console.log('Renderer:', !!renderer);
  console.log('VRM loaded:', !!scene?.getObjectByName('VRM_Model'));
  console.log('Fallback active:', !!(scene?.getObjectByName('fallbackAvatar') || scene?.getObjectByName('EmergencyFallback')));
  console.log('Canvas exists:', !!document.getElementById('vrmCanvas'));
  
  if (scene) {
    console.log('Scene objects:', scene.children.map(c => c.name));
  }
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
        await loadVRMWithReliableLoader(VRM_PATH);
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
  queueTTS("Hello! I'm testing the text to speech system. How does this sound?", 'nova');
};

console.log('🚀 Solmate VRM Companion loaded!');
console.log('📋 Debug commands: debugVRM(), reloadVRM(), createEmergency(), testChat(), testTTS()');

// ===== START APPLICATION =====
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
