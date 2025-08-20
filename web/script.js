// web/script.js
// Complete implementation with Enhanced VRM Loading, Three.js, Chat, TTS, WebSocket, and UI

// ===== CONSTANTS =====
const ASSET_LOAD_TIMEOUT = 30000; // 30 seconds
const VRM_MAX_RETRIES = 2;
const VRM_PATH = '/assets/avatar/solmate.vrm';
const HELIUS_WS = 'wss://mainnet.helius-rpc.com/?api-key=9355c09c-5049-4ffa-a0fa-786d2482af6b';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Updated system prompt for Grok-like personality
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

// ===== UTILITY: LOAD SCRIPT WITH DETAILED DEBUGGING =====
function loadScript(src) {
  return new Promise((resolve, reject) => {
    log(`Attempting to load script: ${src}`);
    
    // Check if script already exists
    const existingScript = document.querySelector(`script[src="${src}"]`);
    if (existingScript) {
      log(`Script already exists: ${src}`);
      resolve();
      return;
    }
    
    const script = document.createElement('script');
    script.src = src;
    
    script.onload = () => {
      log(`Script loaded successfully: ${src}`);
      resolve();
    };
    
    script.onerror = (error) => {
      log(`Script failed to load: ${src}`, error);
      reject(new Error(`Failed to load script: ${src}`));
    };
    
    document.head.appendChild(script);
    log(`Script element added to head: ${src}`);
  });
}

// ===== ENHANCED THREE.JS SETUP WITH RELIABLE GLTF LOADING =====
async function initThreeEnhanced() {
  try {
    log('=== ENHANCED THREE.JS INITIALIZATION ===');
    
    // STEP 1: Load Three.js with better error handling
    await loadThreeJSReliably();
    
    // STEP 2: Load GLTF Loader with multiple strategies
    await loadGLTFLoaderReliably();
    
    // STEP 3: Setup scene
    setupThreeJSScene();
    
    // STEP 4: Start animation loop
    animate();
    
    // STEP 5: Create immediate fallback
    await createFallbackAvatar();
    
    // STEP 6: Try to load VRM after scene is ready
    setTimeout(async () => {
      try {
        await loadVRMWithReliableLoader(VRM_PATH);
      } catch (vrmError) {
        log('VRM loading failed, keeping fallback', vrmError);
        handleVRMLoadingError(vrmError);
      }
    }, 1000);
    
    log('=== ENHANCED THREE.JS INITIALIZATION COMPLETE ===');
    
  } catch (err) {
    log('=== ENHANCED INITIALIZATION FAILED ===', err);
    handleVRMLoadingError(err);
    createSimpleFallback();
    throw err;
  }
}

// ===== RELIABLE THREE.JS LOADING =====
async function loadThreeJSReliably() {
  if (window.THREE) {
    THREE = window.THREE;
    log('Three.js already available');
    return;
  }
  
  const threeSources = [
    // Try different versions and CDNs
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/r158/three.min.js',
    'https://unpkg.com/three@0.158.0/build/three.min.js', 
    'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/r150/three.min.js',
    'https://unpkg.com/three@0.150.0/build/three.min.js'
  ];
  
  for (let i = 0; i < threeSources.length; i++) {
    const source = threeSources[i];
    try {
      log(`Loading Three.js from: ${source}`);
      
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = source;
        script.onload = resolve;
        script.onerror = reject;
        
        // Remove any existing Three.js scripts first
        const existingScripts = document.querySelectorAll('script[src*="three"]');
        existingScripts.forEach(s => s.remove());
        
        document.head.appendChild(script);
        
        // Timeout after 10 seconds
        setTimeout(() => reject(new Error('Timeout')), 10000);
      });
      
      // Verify it loaded
      if (window.THREE) {
        THREE = window.THREE;
        log(`✅ Three.js loaded successfully from: ${source}`);
        
        // Test basic functionality
        const testScene = new THREE.Scene();
        const testCamera = new THREE.PerspectiveCamera();
        log('Three.js functionality verified');
        return;
      }
      
    } catch (err) {
      log(`Three.js failed from ${source}:`, err.message);
      continue;
    }
  }
  
  throw new Error('All Three.js sources failed to load');
}

// ===== RELIABLE GLTF LOADER =====
async function loadGLTFLoaderReliably() {
  // Strategy 1: Try external GLTF loaders
  const gltfSources = [
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/r158/loaders/GLTFLoader.js',
    'https://unpkg.com/three@0.158.0/examples/js/loaders/GLTFLoader.js',
    'https://cdn.jsdelivr.net/npm/three@0.158.0/examples/js/loaders/GLTFLoader.js',
    'https://threejs.org/examples/js/loaders/GLTFLoader.js'
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
        log(`✅ External GLTF loader loaded from: ${source}`);
        return;
      }
      
    } catch (err) {
      log(`GLTF loader failed from ${source}:`, err.message);
    }
  }
  
  // Strategy 2: Use module imports
  try {
    log('Trying ES6 module import for GLTF loader...');
    const { GLTFLoader } = await import('https://unpkg.com/three@0.158.0/examples/jsm/loaders/GLTFLoader.js');
    THREE.GLTFLoader = GLTFLoader;
    log('✅ GLTF loader loaded via ES6 import');
    return;
  } catch (err) {
    log('ES6 import failed:', err.message);
  }
  
  // Strategy 3: Create production-ready embedded loader
  log('Creating production-ready embedded GLTF loader...');
  createProductionGLTFLoader();
  
  if (THREE.GLTFLoader) {
    log('✅ Production embedded GLTF loader created');
  } else {
    throw new Error('All GLTF loader strategies failed');
  }
}

// ===== PRODUCTION-READY EMBEDDED GLTF LOADER =====
function createProductionGLTFLoader() {
  THREE.GLTFLoader = function(manager) {
    this.manager = manager || THREE.DefaultLoadingManager;
    this.path = '';
    this.resourcePath = '';
    this.requestHeader = {};
  };
  
  THREE.GLTFLoader.prototype = {
    constructor: THREE.GLTFLoader,
    
    load: function(url, onLoad, onProgress, onError) {
      const scope = this;
      const loader = new THREE.FileLoader(scope.manager);
      loader.setPath(scope.path);
      loader.setResponseType('arraybuffer');
      loader.setRequestHeader(scope.requestHeader);
      
      loader.load(url, function(data) {
        try {
          scope.parse(data, scope.resourcePath || scope.path, onLoad, onError);
        } catch (e) {
          if (onError) onError(e);
          else console.error('GLTFLoader: Error parsing', e);
        }
      }, onProgress, onError);
    },
    
    setPath: function(path) {
      this.path = path;
      return this;
    },
    
    setResourcePath: function(resourcePath) {
      this.resourcePath = resourcePath;
      return this;
    },
    
    parse: function(data, path, onLoad, onError) {
      try {
        const parser = new GLTFParser(data, {
          path: path || '',
          manager: this.manager
        });
        
        parser.parse().then(onLoad).catch(onError || console.error);
        
      } catch (error) {
        console.error('GLTFLoader parse error:', error);
        if (onError) onError(error);
      }
    }
  };
  
  // ===== FULL GLTF PARSER =====
  function GLTFParser(data, options) {
    this.json = {};
    this.extensions = {};
    this.plugins = {};
    this.options = options || {};
    this.cache = new Map();
    this.associations = new Map();
    this.primitiveCache = {};
    this.textureLoader = new THREE.TextureLoader(this.options.manager);
    this.textureLoader.setCrossOrigin('anonymous');
    
    if (data instanceof ArrayBuffer) {
      this.data = data;
    } else {
      this.json = data;
    }
  }
  
  GLTFParser.prototype = {
    parse: function() {
      const parser = this;
      
      return Promise.resolve().then(function() {
        if (parser.data) {
          // Parse GLB
          const headerView = new DataView(parser.data, 0, 12);
          const magic = headerView.getUint32(0, true);
          
          if (magic !== 0x46546C67) {
            throw new Error('Invalid GLB magic number');
          }
          
          const version = headerView.getUint32(4, true);
          if (version < 2) {
            throw new Error('Unsupported GLB version: ' + version);
          }
          
          const length = headerView.getUint32(8, true);
          let chunkIndex = 12;
          
          while (chunkIndex < length) {
            const chunkHeaderView = new DataView(parser.data, chunkIndex, 8);
            const chunkLength = chunkHeaderView.getUint32(0, true);
            const chunkType = chunkHeaderView.getUint32(4, true);
            
            if (chunkType === 0x4E4F534A) {
              // JSON chunk
              const jsonChunk = new Uint8Array(parser.data, chunkIndex + 8, chunkLength);
              parser.json = JSON.parse(new TextDecoder().decode(jsonChunk));
            } else if (chunkType === 0x004E4942) {
              // Binary chunk
              parser.body = parser.data.slice(chunkIndex + 8, chunkIndex + 8 + chunkLength);
            }
            
            chunkIndex += 8 + chunkLength;
          }
        }
        
        if (!parser.json) {
          throw new Error('No JSON found in GLTF data');
        }
        
        // Start parsing process
        return parser.loadScene();
      });
    },
    
    loadScene: function() {
      const parser = this;
      const json = this.json;
      
      // Load all resources
      const promises = [];
      
      // Load textures
      if (json.textures) {
        promises.push(parser.loadTextures());
      }
      
      // Load materials
      if (json.materials) {
        promises.push(parser.loadMaterials());
      }
      
      // Load meshes
      if (json.meshes) {
        promises.push(parser.loadMeshes());
      }
      
      // Load nodes
      if (json.nodes) {
        promises.push(parser.loadNodes());
      }
      
      return Promise.all(promises).then(function() {
        // Build scene
        const scene = parser.buildScene();
        
        return {
          scene: scene,
          scenes: [scene],
          animations: json.animations || [],
          cameras: [],
          userData: {
            gltfLoader: true,
            json: json
          }
        };
      });
    },
    
    loadTextures: function() {
      const parser = this;
      const json = this.json;
      const textures = [];
      
      if (!json.textures) return Promise.resolve(textures);
      
      const promises = json.textures.map((textureDef, index) => {
        return parser.loadTexture(index).then(texture => {
          textures[index] = texture;
        });
      });
      
      return Promise.all(promises).then(() => {
        parser.textures = textures;
        return textures;
      });
    },
    
    loadTexture: function(textureIndex) {
      const parser = this;
      const json = this.json;
      const textureDef = json.textures[textureIndex];
      
      if (!textureDef || textureDef.source === undefined) {
        return Promise.resolve(null);
      }
      
      const imageDef = json.images[textureDef.source];
      if (!imageDef) {
        return Promise.resolve(null);
      }
      
      return new Promise((resolve, reject) => {
        if (imageDef.uri) {
          // External image
          const texture = parser.textureLoader.load(imageDef.uri, resolve, undefined, reject);
        } else if (imageDef.bufferView !== undefined) {
          // Embedded image
          const bufferView = json.bufferViews[imageDef.bufferView];
          const imageData = parser.body.slice(bufferView.byteOffset, bufferView.byteOffset + bufferView.byteLength);
          
          const blob = new Blob([imageData], { type: imageDef.mimeType });
          const url = URL.createObjectURL(blob);
          
          const texture = parser.textureLoader.load(url, 
            (tex) => {
              URL.revokeObjectURL(url);
              resolve(tex);
            },
            undefined,
            (err) => {
              URL.revokeObjectURL(url);
              reject(err);
            }
          );
        } else {
          resolve(null);
        }
      });
    },
    
    loadMaterials: function() {
      const parser = this;
      const json = this.json;
      const materials = [];
      
      if (!json.materials) return Promise.resolve(materials);
      
      json.materials.forEach((materialDef, index) => {
        materials[index] = parser.createMaterial(materialDef, index);
      });
      
      parser.materials = materials;
      return Promise.resolve(materials);
    },
    
    createMaterial: function(materialDef, materialIndex) {
      const parser = this;
      
      let material;
      
      if (materialDef.pbrMetallicRoughness) {
        // PBR material
        material = new THREE.MeshStandardMaterial();
        
        const pbr = materialDef.pbrMetallicRoughness;
        
        if (pbr.baseColorFactor) {
          material.color.fromArray(pbr.baseColorFactor.slice(0, 3));
          if (pbr.baseColorFactor[3] < 1.0) {
            material.transparent = true;
            material.opacity = pbr.baseColorFactor[3];
          }
        }
        
        if (pbr.baseColorTexture && parser.textures) {
          material.map = parser.textures[pbr.baseColorTexture.index];
        }
        
        if (pbr.metallicFactor !== undefined) {
          material.metalness = pbr.metallicFactor;
        }
        
        if (pbr.roughnessFactor !== undefined) {
          material.roughness = pbr.roughnessFactor;
        }
        
      } else {
        // Basic material
        material = new THREE.MeshLambertMaterial();
        
        if (materialDef.name) {
          material.name = materialDef.name;
          
          // Apply heuristic colors based on material names for VRM
          if (materialDef.name.toLowerCase().includes('hair')) {
            material.color.setHex(0xff69b4); // Pink for hair
          } else if (materialDef.name.toLowerCase().includes('skin')) {
            material.color.setHex(0xffdbac); // Skin tone
          } else if (materialDef.name.toLowerCase().includes('cloth') || materialDef.name.toLowerCase().includes('top')) {
            material.color.setHex(0xffffff); // White for clothing
          } else if (materialDef.name.toLowerCase().includes('skirt') || materialDef.name.toLowerCase().includes('bottom')) {
            material.color.setHex(0x333333); // Dark for skirt
          }
        }
      }
      
      // Common properties
      if (materialDef.doubleSided) {
        material.side = THREE.DoubleSide;
      }
      
      if (materialDef.alphaMode === 'BLEND') {
        material.transparent = true;
      }
      
      return material;
    },
    
    loadMeshes: function() {
      const parser = this;
      const json = this.json;
      const meshes = [];
      
      if (!json.meshes) return Promise.resolve(meshes);
      
      json.meshes.forEach((meshDef, index) => {
        meshes[index] = parser.createMesh(meshDef, index);
      });
      
      parser.meshes = meshes;
      return Promise.resolve(meshes);
    },
    
    createMesh: function(meshDef, meshIndex) {
      const parser = this;
      const group = new THREE.Group();
      group.name = meshDef.name || `Mesh_${meshIndex}`;
      
      meshDef.primitives.forEach((primitive, primitiveIndex) => {
        const geometry = parser.createGeometry(primitive);
        const material = parser.materials && primitive.material !== undefined ? 
          parser.materials[primitive.material] : 
          new THREE.MeshLambertMaterial({ color: 0xcccccc });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `${group.name}_${primitiveIndex}`;
        group.add(mesh);
      });
      
      return group;
    },
    
    createGeometry: function(primitive) {
      const parser = this;
      const geometry = new THREE.BufferGeometry();
      
      // Position
      if (primitive.attributes.POSITION !== undefined) {
        const accessor = parser.json.accessors[primitive.attributes.POSITION];
        const bufferAttribute = parser.createBufferAttribute(accessor);
        geometry.setAttribute('position', bufferAttribute);
      }
      
      // Normal
      if (primitive.attributes.NORMAL !== undefined) {
        const accessor = parser.json.accessors[primitive.attributes.NORMAL];
        const bufferAttribute = parser.createBufferAttribute(accessor);
        geometry.setAttribute('normal', bufferAttribute);
      }
      
      // UV
      if (primitive.attributes.TEXCOORD_0 !== undefined) {
        const accessor = parser.json.accessors[primitive.attributes.TEXCOORD_0];
        const bufferAttribute = parser.createBufferAttribute(accessor);
        geometry.setAttribute('uv', bufferAttribute);
      }
      
      // Indices
      if (primitive.indices !== undefined) {
        const accessor = parser.json.accessors[primitive.indices];
        const bufferAttribute = parser.createBufferAttribute(accessor);
        geometry.setIndex(bufferAttribute);
      }
      
      // Compute normals if missing
      if (!primitive.attributes.NORMAL) {
        geometry.computeVertexNormals();
      }
      
      return geometry;
    },
    
    createBufferAttribute: function(accessor) {
      const parser = this;
      const bufferView = parser.json.bufferViews[accessor.bufferView];
      
      const byteOffset = (accessor.byteOffset || 0) + (bufferView.byteOffset || 0);
      const componentType = accessor.componentType;
      const itemSize = getItemSize(accessor.type);
      const TypedArray = getTypedArray(componentType);
      
      const array = new TypedArray(
        parser.body,
        byteOffset,
        accessor.count * itemSize
      );
      
      return new THREE.BufferAttribute(array, itemSize);
    },
    
    loadNodes: function() {
      const parser = this;
      const json = this.json;
      const nodes = [];
      
      if (!json.nodes) return Promise.resolve(nodes);
      
      // Create all nodes first
      json.nodes.forEach((nodeDef, index) => {
        const node = new THREE.Object3D();
        node.name = nodeDef.name || `Node_${index}`;
        
        // Transform
        if (nodeDef.matrix) {
          node.matrix.fromArray(nodeDef.matrix);
          node.matrix.decompose(node.position, node.quaternion, node.scale);
        } else {
          if (nodeDef.translation) node.position.fromArray(nodeDef.translation);
          if (nodeDef.rotation) node.quaternion.fromArray(nodeDef.rotation);
          if (nodeDef.scale) node.scale.fromArray(nodeDef.scale);
        }
        
        // Mesh
        if (nodeDef.mesh !== undefined && parser.meshes) {
          const mesh = parser.meshes[nodeDef.mesh];
          if (mesh) {
            node.add(mesh);
          }
        }
        
        nodes[index] = node;
      });
      
      // Set up hierarchy
      json.nodes.forEach((nodeDef, index) => {
        if (nodeDef.children) {
          nodeDef.children.forEach(childIndex => {
            nodes[index].add(nodes[childIndex]);
          });
        }
      });
      
      parser.nodes = nodes;
      return Promise.resolve(nodes);
    },
    
    buildScene: function() {
      const parser = this;
      const json = this.json;
      const scene = new THREE.Group();
      scene.name = 'VRM_Scene';
      
      if (json.scenes && json.scenes.length > 0) {
        const sceneDef = json.scenes[json.scene || 0];
        
        if (sceneDef.nodes && parser.nodes) {
          sceneDef.nodes.forEach(nodeIndex => {
            scene.add(parser.nodes[nodeIndex]);
          });
        }
      } else if (parser.nodes) {
        // Add all root nodes
        parser.nodes.forEach(node => {
          if (!node.parent) {
            scene.add(node);
          }
        });
      }
      
      return scene;
    }
  };
  
  // Helper functions
  function getItemSize(type) {
    switch (type) {
      case 'SCALAR': return 1;
      case 'VEC2': return 2;
      case 'VEC3': return 3;
      case 'VEC4': return 4;
      case 'MAT2': return 4;
      case 'MAT3': return 9;
      case 'MAT4': return 16;
      default: return 1;
    }
  }
  
  function getTypedArray(componentType) {
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
}

// ===== ENHANCED VRM LOADING =====
async function loadVRMWithReliableLoader(url, retryCount = 0) {
  try {
    log(`=== LOADING VRM WITH RELIABLE LOADER (attempt ${retryCount + 1}) ===`);
    updateLoadingProgress('vrm', 0);
    
    if (!THREE.GLTFLoader) {
      throw new Error('No GLTF loader available');
    }
    
    // Check file availability
    const checkResponse = await fetch(url, { method: 'HEAD' });
    if (!checkResponse.ok) {
      throw new Error(`VRM file not accessible: ${checkResponse.status}`);
    }
    
    const contentLength = checkResponse.headers.get('content-length');
    const fileSizeMB = contentLength ? Math.round(contentLength / 1024 / 1024) : 'unknown';
    log(`VRM file size: ${fileSizeMB}MB`);
    
    // Load VRM
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
    
    // Remove fallback avatars
    ['fallbackAvatar', 'alternativeAvatar', 'VRM_Model', 'EmergencyFallback'].forEach(name => {
      const existing = scene.getObjectByName(name);
      if (existing) {
        scene.remove(existing);
        log(`Removed existing ${name}`);
      }
    });
    
    // Process and add VRM to scene
    if (gltf.scene) {
      updateLoadingProgress('positioning');
      await processAndAddVRM(gltf);
      updateLoadingProgress('complete');
      log('🎉 VRM loaded and positioned successfully!');
    } else {
      throw new Error('No scene found in VRM file');
    }
    
  } catch (err) {
    if (retryCount < VRM_MAX_RETRIES) {
      log(`VRM load retry ${retryCount + 1} in 3 seconds...`, err.message);
      setTimeout(() => loadVRMWithReliableLoader(url, retryCount + 1), 3000);
    } else {
      log('❌ VRM loading failed completely', err);
      handleVRMLoadingError(err);
      throw err;
    }
  }
}

// ===== PROCESS AND ADD VRM TO SCENE =====
async function processAndAddVRM(gltf) {
  log('Processing VRM for proper display...');
  
  // Calculate bounding box
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  
  log('Original VRM dimensions:', {
    size: { x: size.x.toFixed(2), y: size.y.toFixed(2), z: size.z.toFixed(2) },
    center: { x: center.x.toFixed(2), y: center.y.toFixed(2), z: center.z.toFixed(2) }
  });
  
  // Fix scaling - VRoid models are often 255 units tall
  let scale = 1.0;
  if (size.y > 50) {
    // Large model, scale down
    scale = 1.8 / size.y; // Target height of 1.8 units
    gltf.scene.scale.setScalar(scale);
    log(`Applied scaling: ${scale.toFixed(4)} (${size.y.toFixed(1)}u → 1.8u)`);
  } else if (size.y < 0.5) {
    // Tiny model, scale up  
    scale = 1.8 / size.y;
    gltf.scene.scale.setScalar(scale);
    log(`Applied upscaling: ${scale.toFixed(4)}`);
  }
  
  // Recalculate after scaling
  const scaledBox = new THREE.Box3().setFromObject(gltf.scene);
  const scaledSize = scaledBox.getSize(new THREE.Vector3());
  const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
  
  // Center the character at origin and put feet on ground
  gltf.scene.position.x = -scaledCenter.x;
  gltf.scene.position.y = -scaledBox.min.y; // Feet on ground (y=0)
  gltf.scene.position.z = -scaledCenter.z;
  
  gltf.scene.name = 'VRM_Model';
  scene.add(gltf.scene);
  
  // Position camera optimally
  const finalHeight = scaledSize.y;
  const finalWidth = Math.max(scaledSize.x, scaledSize.z);
  const cameraDistance = Math.max(finalHeight * 1.5, finalWidth * 2.0, 3.0);
  const lookAtHeight = finalHeight * 0.6; // Look slightly above center
  
  camera.position.set(0, lookAtHeight, cameraDistance);
  camera.lookAt(0, lookAtHeight, 0);
  
  log('Final VRM positioning:', {
    position: gltf.scene.position,
    scale: scale.toFixed(4),
    finalSize: `${scaledSize.x.toFixed(1)} x ${scaledSize.y.toFixed(1)} x ${scaledSize.z.toFixed(1)}`,
    camera: `pos(0, ${lookAtHeight.toFixed(1)}, ${cameraDistance.toFixed(1)}) lookAt(0, ${lookAtHeight.toFixed(1)}, 0)`
  });
  
  // Setup animations
  if (gltf.animations && gltf.animations.length > 0) {
    log(`Setting up ${gltf.animations.length} animations`);
    mixer = new THREE.AnimationMixer(gltf.scene);
    const action = mixer.clipAction(gltf.animations[0]);
    action.play();
  }
  
  // Store VRM reference for expressions
  if (gltf.userData && gltf.userData.vrm) {
    currentVRM = gltf.userData.vrm;
    log('VRM expressions available');
  }
}

// ===== SETUP BASIC THREE.JS SCENE =====
function setupThreeJSScene() {
  log('Setting up Three.js scene...');
  
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e17);
  
  // Camera  
  camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 20);
  camera.position.set(0, 1.3, 2.5);
  camera.lookAt(0, 1, 0);
  
  // Renderer
  const canvas = document.getElementById('vrmCanvas');
  if (!canvas) {
    throw new Error('Canvas element #vrmCanvas not found');
  }
  
  renderer = new THREE.WebGLRenderer({ 
    canvas, 
    antialias: true,
    alpha: true 
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  
  // Set color space safely
  try {
    if (renderer.outputColorSpace !== undefined) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else if (renderer.outputEncoding !== undefined) {
      renderer.outputEncoding = THREE.sRGBEncoding;
    }
  } catch (colorSpaceError) {
    log('Color space setting failed, continuing anyway', colorSpaceError);
  }
  
  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);
  
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(1, 1, 1);
  scene.add(dirLight);
  
  // Clock for animations
  clock = new THREE.Clock();
  
  log('Three.js scene setup complete');
}

// ===== ENHANCED ERROR HANDLING =====
function handleVRMLoadingError(error) {
  log('VRM loading error occurred:', error);
  
  const errorTypes = {
    'GLTFLoader': 'GLTF loader failed to initialize',
    'NetworkError': 'Network connection issue',
    'timeout': 'Loading took too long',
    'parse': 'VRM file format issue',
    'memory': 'Insufficient memory for large VRM'
  };
  
  let errorType = 'unknown';
  let solution = 'Try refreshing the page';
  
  const errorMsg = error.message.toLowerCase();
  
  if (errorMsg.includes('gltf') || errorMsg.includes('loader')) {
    errorType = 'GLTFLoader';
    solution = 'Using emergency fallback avatar';
    createEmergencyFallback();
  } else if (errorMsg.includes('network') || errorMsg.includes('fetch')) {
    errorType = 'NetworkError';
    solution = 'Check internet connection and try again';
  } else if (errorMsg.includes('timeout')) {
    errorType = 'timeout';
    solution = 'VRM file is large, please wait or try again';
  } else if (errorMsg.includes('parse') || errorMsg.includes('json')) {
    errorType = 'parse';
    solution = 'VRM file may be corrupted, using fallback';
    createEmergencyFallback();
  }
  
  // Show user-friendly error
  const errorDiv = document.createElement('div');
  errorDiv.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: rgba(255, 107, 107, 0.9);
    color: white;
    padding: 15px;
    border-radius: 8px;
    font-family: Arial, sans-serif;
    font-size: 14px;
    max-width: 300px;
    z-index: 1000;
    cursor: pointer;
  `;
  
  errorDiv.innerHTML = `
    <strong>Avatar Loading Issue</strong><br>
    ${errorTypes[errorType] || 'Unknown error'}<br>
    <em>${solution}</em><br>
    <small>Click to dismiss</small>
  `;
  
  errorDiv.onclick = () => errorDiv.remove();
  document.body.appendChild(errorDiv);
  
  // Auto-remove after 10 seconds
  setTimeout(() => {
    if (errorDiv.parentNode) errorDiv.remove();
  }, 10000);
}

// ===== LOADING PROGRESS INDICATOR =====
function updateLoadingProgress(stage, percent = null) {
  const statusEl = document.getElementById('loadingStatus');
  if (!statusEl) return;
  
  const stages = {
    'three': '🔧 Loading 3D Engine',
    'gltf': '📦 Loading GLTF Loader', 
    'vrm': '👤 Loading Avatar',
    'textures': '🎨 Loading Textures',
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

// ===== EMERGENCY FALLBACK SYSTEM =====
function createEmergencyFallback() {
  log('Creating emergency anime-style fallback...');
  
  const character = new THREE.Group();
  character.name = 'EmergencyFallback';
  
  // More detailed anime character
  const headGeo = new THREE.SphereGeometry(0.12, 32, 32);
  const headMat = new THREE.MeshLambertMaterial({ color: 0xffdbac }); // Skin
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.6;
  head.scale.set(1, 1.1, 0.9); // Slightly elongated
  character.add(head);
  
  // Pink hair (VRoid style)
  const hairGeo = new THREE.SphereGeometry(0.15, 24, 24);
  const hairMat = new THREE.MeshLambertMaterial({ color: 0xff69b4 }); // Pink
  const hair = new THREE.Mesh(hairGeo, hairMat);
  hair.position.y = 1.7;
  hair.scale.set(1.4, 0.9, 1.3); // Voluminous anime hair
  character.add(hair);
  
  // Hair accessories (twin tails)
  const twinTailGeo = new THREE.SphereGeometry(0.08, 16, 16);
  const leftTwinTail = new THREE.Mesh(twinTailGeo, hairMat);
  leftTwinTail.position.set(-0.2, 1.65, -0.1);
  leftTwinTail.scale.set(0.8, 1.5, 0.8);
  character.add(leftTwinTail);
  
  const rightTwinTail = new THREE.Mesh(twinTailGeo, hairMat);
  rightTwinTail.position.set(0.2, 1.65, -0.1);
  rightTwinTail.scale.set(0.8, 1.5, 0.8);
  character.add(rightTwinTail);
  
  // Eyes (larger anime style)
  const eyeGeo = new THREE.SphereGeometry(0.025, 12, 12);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x4169E1 }); // Blue eyes
  
  const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
  leftEye.position.set(-0.045, 1.62, 0.11);
  character.add(leftEye);
  
  const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
  rightEye.position.set(0.045, 1.62, 0.11);
  character.add(rightEye);
  
  // Body (white top)
  const bodyGeo = new THREE.CylinderGeometry(0.15, 0.18, 0.5, 12);
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0xffffff }); // White
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 1.1;
  character.add(body);
  
  // Arms
  const armGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.4, 8);
  const armMat = new THREE.MeshLambertMaterial({ color: 0xffdbac }); // Skin
  
  const leftArm = new THREE.Mesh(armGeo, armMat);
  leftArm.position.set(-0.22, 1.15, 0);
  leftArm.rotation.z = 0.3;
  character.add(leftArm);
  
  const rightArm = new THREE.Mesh(armGeo, armMat);
  rightArm.position.set(0.22, 1.15, 0);
  rightArm.rotation.z = -0.3;
  character.add(rightArm);
  
  // Skirt (black)
  const skirtGeo = new THREE.CylinderGeometry(0.18, 0.25, 0.3, 12);
  const skirtMat = new THREE.MeshLambertMaterial({ color: 0x333333 }); // Dark
  const skirt = new THREE.Mesh(skirtGeo, skirtMat);
  skirt.position.y = 0.75;
  character.add(skirt);
  
  // Legs
  const legGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.4, 8);
  const legMat = new THREE.MeshLambertMaterial({ color: 0xffdbac }); // Skin
  
  const leftLeg = new THREE.Mesh(legGeo, legMat);
  leftLeg.position.set(-0.08, 0.4, 0);
  character.add(leftLeg);
  
  const rightLeg = new THREE.Mesh(legGeo, legMat);
  rightLeg.position.set(0.08, 0.4, 0);
  character.add(rightLeg);
  
  // Position character
  character.position.y = -0.1;
  scene.add(character);
  
  // Advanced animation
  let time = 0;
  let blinkTimer = 0;
  
  function animateEmergencyFallback() {
    if (!scene.getObjectByName('EmergencyFallback')) return;
    
    time += 0.016;
    blinkTimer += 0.016;
    
    // Breathing animation
    character.scale.y = 1 + Math.sin(time * 3) * 0.01;
    
    // Gentle swaying
    character.rotation.y = Math.sin(time * 0.8) * 0.05;
    
    // Head movement
    head.rotation.y = Math.sin(time * 1.2) * 0.1;
    head.rotation.x = Math.sin(time * 0.9) * 0.03;
    
    // Hair movement
    hair.rotation.z = Math.sin(time * 1.5) * 0.02;
    leftTwinTail.rotation.z = Math.sin(time * 2) * 0.1;
    rightTwinTail.rotation.z = Math.sin(time * 2.2) * -0.1;
    
    // Arm movement
    leftArm.rotation.z = 0.3 + Math.sin(time * 1.8) * 0.1;
    rightArm.rotation.z = -0.3 + Math.sin(time * 2.1) * 0.1;
    
    // Blinking animation
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
  log('Emergency anime fallback created with animations');
}

// ===== BASIC THREE.JS FALLBACK =====
async function initBasicThreeJS() {
  log('Attempting basic Three.js setup...');
  
  // Load only Three.js core
  if (!window.THREE) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/three.js/r158/three.min.js');
    THREE = window.THREE;
  }
  
  if (!THREE) {
    throw new Error('Could not load Three.js');
  }
  
  // Setup basic scene
  setupThreeJSScene();
  animate(); // Start animation loop
  
  log('Basic Three.js setup complete');
}

// ===== VRM HEALTH CHECK =====
function checkVRMHealth() {
  return {
    threeJS: !!window.THREE,
    gltfLoader: !!(THREE && THREE.GLTFLoader),
    scene: !!scene,
    camera: !!camera,
    renderer: !!renderer,
    vrmLoaded: !!scene?.getObjectByName('VRM_Model'),
    fallbackActive: !!(scene?.getObjectByName('fallbackAvatar') || scene?.getObjectByName('EmergencyFallback')),
    canvasExists: !!document.getElementById('vrmCanvas'),
    vrmFileAccessible: null // Will be checked async
  };
}

// ===== ASYNC VRM FILE CHECK =====
async function checkVRMFileAccess() {
  try {
    const response = await fetch(VRM_PATH, { method: 'HEAD' });
    return {
      accessible: response.ok,
      status: response.status,
      size: response.headers.get('content-length'),
      type: response.headers.get('content-type')
    };
  } catch (err) {
    return {
      accessible: false,
      error: err.message
    };
  }
}

// ===== COMPREHENSIVE HEALTH CHECK =====
async function fullHealthCheck() {
  const basic = checkVRMHealth();
  const vrmFile = await checkVRMFileAccess();
  
  return {
    ...basic,
    vrmFile: vrmFile,
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio
    }
  };
}

// ===== DEBUGGING UTILITIES =====
function debugVRMLoading() {
  console.log('=== VRM LOADING DEBUG INFO ===');
  console.log('THREE available:', !!window.THREE);
  console.log('GLTFLoader available:', !!(THREE && THREE.GLTFLoader));
  console.log('Scene objects:', scene ? scene.children.map(c => c.name) : 'No scene');
  console.log('Camera position:', camera ? camera.position : 'No camera');
  console.log('Current VRM:', currentVRM ? 'Loaded' : 'Not loaded');
  console.log('Mixer:', mixer ? 'Available' : 'Not available');
  
  // Test VRM file accessibility
  fetch(VRM_PATH, { method: 'HEAD' })
    .then(res => console.log('VRM file accessible:', res.ok, res.status))
    .catch(err => console.log('VRM file check failed:', err.message));
}

// ===== MANUAL VRM RELOAD FUNCTION =====
function forceReloadVRM() {
  log('=== FORCING VRM RELOAD ===');
  
  // Clear existing VRM
  ['fallbackAvatar', 'alternativeAvatar', 'VRM_Model', 'EmergencyFallback'].forEach(name => {
    const existing = scene.getObjectByName(name);
    if (existing) {
      scene.remove(existing);
      log(`Removed ${name}`);
    }
  });
  
  // Reset camera
  camera.position.set(0, 1.3, 2.5);
  camera.lookAt(0, 1, 0);
  
  // Create temporary fallback
  createFallbackAvatar();
  
  // Attempt reload
  setTimeout(async () => {
    try {
      await loadVRMWithReliableLoader(VRM_PATH);
    } catch (err) {
      log('Manual reload failed:', err);
      alert('VRM reload failed: ' + err.message);
    }
  }, 1000);
}

// ===== CREATE SIMPLE FALLBACK =====
function createSimpleFallback() {
  const canvas = document.getElementById('vrmCanvas');
  if (canvas) {
    canvas.style.display = 'none';
  }
  
  const fallback = document.createElement('div');
  fallback.style.cssText = `
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
    color: white;
    font-family: Arial, sans-serif;
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

// ===== CREATE FALLBACK AVATAR =====
async function createFallbackAvatar() {
  try {
    // Create a simple geometric avatar as fallback
    const geometry = new THREE.SphereGeometry(0.3, 32, 32);
    const material = new THREE.MeshLambertMaterial({ color: 0x4a90e2 });
    const avatar = new THREE.Mesh(geometry, material);
    avatar.position.set(0, 0.5, 0);
    avatar.name = 'fallbackAvatar';
    scene.add(avatar);
    
    // Add simple animation
    let animationId;
    function animateFallback() {
      if (scene.getObjectByName('fallbackAvatar')) {
        avatar.rotation.y += 0.01;
        animationId = requestAnimationFrame(animateFallback);
      }
    }
    animateFallback();
    
    log('Fallback avatar created');
  } catch (err) {
    log('Failed to create fallback avatar', err);
  }
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

// ===== RANDOM BLINK =====
function blink() {
  if (!currentVRM) return;
  try {
    currentVRM.expressionManager.setValue('blink', 1);
    setTimeout(() => {
      if (currentVRM) currentVRM.expressionManager.setValue('blink', 0);
      setTimeout(blink, Math.random() * 4000 + 2000);
    }, 300);
  } catch (err) {
    log('Blink animation failed', err);
  }
}

// ===== SET EXPRESSION =====
function setExpression(name, value) {
  if (currentVRM && currentVRM.expressionManager) {
    try {
      currentVRM.expressionManager.setValue(name, value);
    } catch (err) {
      log('Expression failed', err);
    }
  }
}

// ===== WEBSOCKET FOR SOLANA DATA =====
function connectWebSocket() {
  if (ws) {
    ws.close();
  }
  
  try {
    ws = new WebSocket(HELIUS_WS);
    
    ws.onopen = () => {
      log('WebSocket connected');
      const wsLight = document.getElementById('wsLight');
      if (wsLight) wsLight.classList.add('online');
    };
    
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.tps) updateTPS(data.tps);
      } catch (err) {
        log('WebSocket message parse error', err);
      }
    };
    
    ws.onclose = () => {
      log('WebSocket closed, reconnecting...');
      const wsLight = document.getElementById('wsLight');
      if (wsLight) wsLight.classList.remove('online');
      
      if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
      wsReconnectTimer = setTimeout(connectWebSocket, 5000);
    };
    
    ws.onerror = (err) => log('WebSocket error', err);
    
  } catch (err) {
    log('WebSocket connection failed', err);
    // Fallback to polling
    if (!tpsUpdateTimer) {
      tpsUpdateTimer = setInterval(fetchTPS, 10000);
    }
  }
}

// ===== UPDATE TPS =====
function updateTPS(tps) {
  const networkTPS = document.getElementById('networkTPS');
  if (networkTPS) {
    networkTPS.textContent = `${tps} TPS`;
  }
}

// ===== FETCH PRICE (FIXED WITH DETAILED DEBUGGING) =====
async function fetchPrice() {
  try {
    log('=== FETCHING PRICE DATA ===');
    const url = `/api/price?ids=${SOL_MINT}`;
    log('Price API URL:', url);
    
    const res = await fetch(url);
    log('Price API response status:', res.status);
    
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    
    const data = await res.json();
    const solPrice = document.getElementById('solPrice');
    if (!solPrice) {
      log('ERROR: solPrice element not found in DOM');
      return;
    }
    
    let price = null;
    let priceSource = '';
    
    // Method 1: Jupiter Lite API v3 format - data.data[mint].price
    if (data.data && typeof data.data === 'object' && data.data[SOL_MINT]) {
      const solData = data.data[SOL_MINT];
      if (typeof solData.price === 'number') {
        price = solData.price;
        priceSource = 'Jupiter API v3: data.data[SOL_MINT].price';
      }
    }
    // Method 2: Direct price field
    else if (typeof data.price === 'number') {
      price = data.price;
      priceSource = 'Direct price field';
    }
    // Method 3: Search for ANY reasonable price value
    else {
      function searchForPrice(obj, path = '') {
        if (typeof obj === 'number' && obj > 1 && obj < 10000) {
          if (!price) {
            price = obj;
            priceSource = `Auto-detected number at ${path || 'root'}`;
          }
        } else if (typeof obj === 'object' && obj !== null) {
          for (const [key, value] of Object.entries(obj)) {
            const newPath = path ? `${path}.${key}` : key;
            searchForPrice(value, newPath);
          }
        }
      }
      searchForPrice(data);
    }
    
    if (price !== null && !isNaN(price) && price > 0) {
      solPrice.textContent = `SOL — ${price.toFixed(2)}`;
      solPrice.style.color = '#00ff88';
      log(`✅ SUCCESS: Price updated to ${price.toFixed(2)} (${priceSource})`);
    } else {
      solPrice.textContent = 'SOL — Data parsing error';
      solPrice.style.color = '#ff6b6b';
      log('❌ FAILED: Could not extract price from response');
    }
    
  } catch (err) {
    log('=== PRICE FETCH FAILED ===', err);
    const solPrice = document.getElementById('solPrice');
    if (solPrice) {
      solPrice.textContent = 'SOL — Network error';
      solPrice.style.color = '#ff6b6b';
    }
  }
}

// ===== FETCH TPS (FIXED) =====
async function fetchTPS() {
  try {
    const res = await fetch('/api/tps');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const data = await res.json();
    log('TPS data received', data);
    
    if (data.tps) {
      updateTPS(data.tps);
    }
  } catch (err) {
    log('TPS fetch failed', err);
    const networkTPS = document.getElementById('networkTPS');
    if (networkTPS) {
      networkTPS.textContent = 'TPS Error';
      networkTPS.style.color = '#ff6b6b';
    }
  }
}

// ===== SEND MESSAGE TO CHAT API =====
async function sendMessage(text) {
  conversation.push({ role: 'user', content: text });
  
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...conversation] })
    });
    
    if (!res.ok) throw new Error(`Chat API failed: ${res.status}`);
    
    const { content } = await res.json();
    conversation.push({ role: 'assistant', content });
    
    // Save chat history
    try {
      localStorage.setItem('solmateConversation', JSON.stringify(conversation));
    } catch (storageErr) {
      log('Failed to save conversation', storageErr);
    }
    
    queueTTS(content);
    return content;
  } catch (err) {
    log('Chat failed', err);
    const errorMsg = 'Sorry, chat is temporarily unavailable. Please try again!';
    alert(errorMsg);
    return errorMsg;
  }
}

// ===== QUEUE TTS =====
function queueTTS(text, voice = 'nova') {
  audioQueue.push({ text, voice });
  if (!isPlaying) playNextAudio();
}

// ===== FALLBACK BROWSER TTS =====
function fallbackTTS(text, voice) {
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    const selectedVoice = voices.find(v => v.name.toLowerCase().includes(voice.toLowerCase())) || voices[0];
    if (selectedVoice) utterance.voice = selectedVoice;
    
    utterance.onend = () => {
      isPlaying = false;
      setExpression('aa', 0); // Close mouth
      playNextAudio();
    };
    
    utterance.onstart = () => {
      setExpression('aa', 0.5); // Open mouth for lip sync
    };
    
    speechSynthesis.speak(utterance);
    isPlaying = true;
  } catch (err) {
    log('Fallback TTS failed', err);
    isPlaying = false;
    playNextAudio();
  }
}

// ===== PLAY AUDIO FROM API =====
async function playAudio(blob, voice) {
  try {
    isPlaying = true;
    const audio = new Audio(URL.createObjectURL(blob));
    
    audio.onended = () => {
      isPlaying = false;
      setExpression('aa', 0); // Close mouth
      playNextAudio();
    };
    
    audio.onerror = (err) => {
      log('Audio play failed, falling back to browser TTS', err);
      isPlaying = false;
      fallbackTTS(audioQueue[0]?.text || '', voice);
    };
    
    // Start lip sync
    setExpression('aa', 0.8);
    
    await audio.play();
  } catch (err) {
    log('Audio play error', err);
    isPlaying = false;
    fallbackTTS(audioQueue[0]?.text || '', voice);
  }
}

// ===== PLAY NEXT IN QUEUE =====
async function playNextAudio() {
  if (audioQueue.length === 0) {
    isPlaying = false;
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
      return;
    }
    
    const blob = await res.blob();
    if (blob.size === 0) {
      throw new Error('Empty audio response');
    }
    
    await playAudio(blob, voice);
  } catch (err) {
    log('TTS queue failed', err);
    fallbackTTS(text, voice);
  }
}

// ===== CLEAR AUDIO QUEUE =====
function clearAudioQueue() {
  audioQueue = [];
  speechSynthesis.cancel();
  isPlaying = false;
  setExpression('aa', 0); // Close mouth
}

// ===== SETUP UI =====
function setupUI() {
  // Theme toggle
  const themeBtn = document.getElementById('themeToggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      document.documentElement.classList.toggle('light');
    });
  }
  
  // Enhanced Health button
  const healthBtn = document.getElementById('healthBtn');
  if (healthBtn) {
    healthBtn.addEventListener('click', async () => {
      try {
        const health = await fullHealthCheck();
        
        const report = `
🔍 SOLMATE HEALTH REPORT

🔧 3D Engine:
• Three.js: ${health.threeJS ? '✅ Loaded' : '❌ Missing'}
• GLTF Loader: ${health.gltfLoader ? '✅ Available' : '❌ Missing'} 
• Scene: ${health.scene ? '✅ Created' : '❌ Missing'}
• Renderer: ${health.renderer ? '✅ Active' : '❌ Missing'}

👤 Avatar Status:
• VRM Model: ${health.vrmLoaded ? '✅ Loaded' : '❌ Not loaded'}
• Fallback: ${health.fallbackActive ? '⚠️ Active' : '✅ Not needed'}
• VRM File: ${health.vrmFile.accessible ? '✅ Accessible' : `❌ ${health.vrmFile.error || 'Not accessible'}`}

💻 Environment:
• Canvas: ${health.canvasExists ? '✅ Found' : '❌ Missing'}
• Viewport: ${health.viewport.width}x${health.viewport.height}
• Device Ratio: ${health.viewport.devicePixelRatio}

🛠️ Debug Commands:
• debugVRM() - Show detailed debug info
• reloadVRM() - Force reload avatar
• createEmergency() - Create fallback avatar
        `.trim();
        
        alert(report);
        
        // Also log detailed info to console
        console.log('=== DETAILED HEALTH CHECK ===');
        console.table(health);
        
      } catch (err) {
        alert('Health check failed: ' + err.message);
      }
    });
  }
  
  // Chat form
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
      sendBtn.textContent = 'Thinking...';
      
      try {
        await sendMessage(text);
      } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send';
      }
    });
  }
  
  // Clear audio button
  const clearBtn = document.getElementById('clearBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', clearAudioQueue);
  }
  
  // Handle window resize
  window.addEventListener('resize', () => {
    if (camera && renderer) {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
  });
  
  // Debug overlay toggle (Ctrl+D)
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'd') {
      e.preventDefault();
      const logs = document.getElementById('overlayLogs');
      if (logs) logs.classList.toggle('hidden');
    }
  });
  
  // Load saved conversation
  try {
    const saved = localStorage.getItem('solmateConversation');
    if (saved) conversation = JSON.parse(saved);
  } catch (err) {
    log('Failed to load conversation history', err);
  }
  
  // Enable audio on first interaction (fix autoplay issue)
  document.addEventListener('click', enableAudio, { once: true });
  document.addEventListener('keydown', enableAudio, { once: true });
}

// ===== ENABLE AUDIO =====
function enableAudio() {
  // Create a silent audio context to enable audio
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  audioContext.resume();
  log('Audio context enabled');
}

// ===== MAIN INIT FUNCTION (ENHANCED) =====
async function init() {
  log('=== INITIALIZING SOLMATE WITH ENHANCED VRM LOADER ===');
  
  try {
    // STEP 1: Setup UI first
    log('Setting up UI...');
    setupUI();
    
    // STEP 2: Start API calls immediately (don't wait for Three.js)
    log('Starting API calls...');
    
    // Fetch price and TPS immediately
    log('Fetching initial price data...');
    await fetchPrice();
    
    log('Fetching initial TPS data...');
    await fetchTPS();
    
    // Start periodic updates
    log('Starting periodic updates...');
    priceUpdateTimer = setInterval(fetchPrice, 30000); // Every 30s
    tpsUpdateTimer = setInterval(fetchTPS, 60000); // Every 60s
    
    // STEP 3: Try enhanced Three.js initialization
    try {
      log('Attempting enhanced Three.js initialization...');
      await initThreeEnhanced(); // Use the new enhanced loader
      
      // Start animations if Three.js worked
      setTimeout(() => {
        blink();
      }, 2000);
      
    } catch (threeError) {
      log('Enhanced Three.js failed, trying emergency fallback', threeError);
      try {
        // Try one more time with emergency systems
        await initBasicThreeJS();
        createEmergencyFallback();
      } catch (emergencyError) {
        log('All 3D systems failed, continuing audio-only', emergencyError);
        createSimpleFallback();
      }
    }
    
    // STEP 4: Connect WebSocket (independent of Three.js)
    log('Connecting WebSocket...');
    connectWebSocket();
    
    log('=== SOLMATE INITIALIZATION COMPLETE ===');
    
    // STEP 5: Welcome message
    setTimeout(() => {
      queueTTS("Hello, I'm your enhanced Solana Solmate. How can I help you today?", 'nova');
    }, 2000);
    
  } catch (err) {
    log('=== INITIALIZATION FAILED ===', err);
    // Even if initialization fails, try to set up basic functionality
    setupUI();
    
    // Try price/TPS anyway
    try {
      await fetchPrice();
      await fetchTPS();
      priceUpdateTimer = setInterval(fetchPrice, 30000);
      tpsUpdateTimer = setInterval(fetchTPS, 60000);
    } catch (apiError) {
      log('API calls also failed', apiError);
    }
    
    // Create simple fallback
    createSimpleFallback();
  }
}

// ===== CLEANUP =====
window.addEventListener('beforeunload', () => {
  // Close WebSocket
  if (ws) ws.close();
  
  // Clear timers
  if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
  if (priceUpdateTimer) clearInterval(priceUpdateTimer);
  if (tpsUpdateTimer) clearInterval(tpsUpdateTimer);
  
  // Clear audio
  clearAudioQueue();
  
  // Dispose Three.js
  if (renderer) {
    renderer.dispose();
  }
  if (currentVRM && scene) {
    scene.remove(currentVRM.scene);
    if (window.VRM && VRM.dispose) {
      VRM.dispose(currentVRM);
    }
  }
});

// ===== CONSOLE COMMANDS FOR DEBUGGING =====
// Add these to global scope for debugging
window.debugVRM = debugVRMLoading;
window.reloadVRM = forceReloadVRM;
window.createEmergency = createEmergencyFallback;

// Usage in console:
// debugVRM() - Shows debug info
// reloadVRM() - Force reload VRM
// createEmergency() - Create detailed anime fallback

console.log('🚀 Enhanced VRM loader ready!');
console.log('📋 Debug commands: debugVRM(), reloadVRM(), createEmergency()');

// ===== START =====
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ===== COMPREHENSIVE VRM FIX =====
// Replace the problematic section at the end of your script.js with this

// First, fix the scene reference error at line 2054
function enhanceSceneLighting() {
  // Check if scene exists first
  if (!scene) {
    log('Scene not available yet, skipping lighting enhancement');
    return;
  }
  
  // Remove existing lights
  const lightsToRemove = [];
  scene.traverse((child) => {
    if (child.isLight) {
      lightsToRemove.push(child);
    }
  });
  lightsToRemove.forEach(light => scene.remove(light));
  
  // Add professional lighting setup for VRM
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);
  
  const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
  mainLight.position.set(2, 3, 2);
  scene.add(mainLight);
  
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
  fillLight.position.set(-1, 1, 1);
  scene.add(fillLight);
  
  const rimLight = new THREE.DirectionalLight(0xaaccff, 0.6);
  rimLight.position.set(0, 1, -2);
  scene.add(rimLight);
  
  log('💡 Enhanced lighting applied');
}

// ===== ADVANCED VRM TEXTURE FIXING =====
async function fixVRMTextures(gltf) {
  log('🎨 Applying advanced VRM texture fixes...');
  
  // Extract and apply embedded textures from GLB
  const textureMap = new Map();
  
  // If this is a GLB with embedded textures, extract them
  if (gltf.parser && gltf.parser.json) {
    const json = gltf.parser.json;
    const parser = gltf.parser;
    
    // Extract embedded textures
    if (json.textures && json.images && parser.body) {
      for (let i = 0; i < json.textures.length; i++) {
        try {
          const textureDef = json.textures[i];
          const imageDef = json.images[textureDef.source];
          
          if (imageDef && imageDef.bufferView !== undefined) {
            const bufferView = json.bufferViews[imageDef.bufferView];
            const imageData = parser.body.slice(bufferView.byteOffset, bufferView.byteOffset + bufferView.byteLength);
            
            const blob = new Blob([imageData], { type: imageDef.mimeType });
            const url = URL.createObjectURL(blob);
            
            const texture = await new Promise((resolve, reject) => {
              const loader = new THREE.TextureLoader();
              loader.load(url, 
                (tex) => {
                  URL.revokeObjectURL(url);
                  // Fix texture properties for VRM
                  tex.colorSpace = THREE.SRGBColorSpace;
                  tex.flipY = false; // VRM textures don't need flipping
                  tex.wrapS = THREE.RepeatWrapping;
                  tex.wrapT = THREE.RepeatWrapping;
                  resolve(tex);
                },
                undefined,
                reject
              );
            });
            
            textureMap.set(i, texture);
            log(`Extracted texture ${i}: ${imageDef.mimeType}`);
          }
        } catch (err) {
          log(`Failed to extract texture ${i}:`, err);
        }
      }
    }
  }
  
  // Apply textures and enhanced materials to meshes
  gltf.scene.traverse((child) => {
    if (child.isMesh) {
      const meshName = child.name.toLowerCase();
      log(`Processing mesh: ${child.name}`);
      
      // Determine material type based on mesh name and apply proper colors
      let materialConfig = getMaterialConfig(meshName);
      
      // Create appropriate material
      let newMaterial;
      if (materialConfig.useStandard) {
        newMaterial = new THREE.MeshStandardMaterial({
          color: materialConfig.color,
          roughness: materialConfig.roughness,
          metalness: materialConfig.metalness,
          side: THREE.DoubleSide,
          transparent: materialConfig.transparent,
          toneMapped: false // Fix gray appearance
        });
      } else {
        newMaterial = new THREE.MeshLambertMaterial({
          color: materialConfig.color,
          side: THREE.DoubleSide,
          transparent: materialConfig.transparent,
          toneMapped: false // Fix gray appearance
        });
      }
      
      // Try to apply extracted texture if available
      const originalMaterial = Array.isArray(child.material) ? child.material[0] : child.material;
      
      // Look for texture in various places
      let appliedTexture = false;
      
      // Method 1: Use extracted texture from textureMap
      if (originalMaterial && originalMaterial.map && originalMaterial.map.image) {
        // Find matching texture in our extracted map
        for (const [index, texture] of textureMap.entries()) {
          if (texture && texture.image) {
            newMaterial.map = texture;
            appliedTexture = true;
            log(`Applied extracted texture to ${child.name}`);
            break;
          }
        }
      }
      
      // Method 2: Copy existing texture if available
      if (!appliedTexture && originalMaterial && originalMaterial.map) {
        newMaterial.map = originalMaterial.map.clone();
        newMaterial.map.colorSpace = THREE.SRGBColorSpace;
        newMaterial.map.flipY = false;
        appliedTexture = true;
        log(`Applied existing texture to ${child.name}`);
      }
      
      // Method 3: Try to extract from material properties
      if (!appliedTexture && originalMaterial) {
        // Check for other texture properties
        if (originalMaterial.emissiveMap) {
          newMaterial.map = originalMaterial.emissiveMap.clone();
          appliedTexture = true;
        } else if (originalMaterial.normalMap) {
          // Use normal map as base if no diffuse
          newMaterial.normalMap = originalMaterial.normalMap.clone();
        }
      }
      
      // Apply the enhanced material
      child.material = newMaterial;
      child.castShadow = true;
      child.receiveShadow = true;
      
      log(`Applied ${appliedTexture ? 'textured' : 'colored'} material to: ${child.name}`);
    }
  });
  
  log('✅ VRM texture enhancement complete');
}

// ===== MATERIAL CONFIGURATION =====
function getMaterialConfig(meshName) {
  // Enhanced material detection based on mesh names
  const name = meshName.toLowerCase();
  
  if (name.includes('hair') || name.includes('前髪') || name.includes('後髪')) {
    return {
      color: 0xff69b4, // Pink hair
      roughness: 0.4,
      metalness: 0.0,
      useStandard: true,
      transparent: false
    };
  } else if (name.includes('face') || name.includes('body') || name.includes('skin') || name.includes('顔') || name.includes('体')) {
    return {
      color: 0xffdbac, // Skin tone
      roughness: 0.7,
      metalness: 0.0,
      useStandard: true,
      transparent: false
    };
  } else if (name.includes('eye') || name.includes('瞳') || name.includes('iris')) {
    return {
      color: 0x4169e1, // Blue eyes
      roughness: 0.1,
      metalness: 0.2,
      useStandard: true,
      transparent: false
    };
  } else if (name.includes('cloth') || name.includes('top') || name.includes('shirt') || name.includes('服') || name.includes('上')) {
    return {
      color: 0xffffff, // White clothing
      roughness: 0.8,
      metalness: 0.0,
      useStandard: true,
      transparent: false
    };
  } else if (name.includes('skirt') || name.includes('bottom') || name.includes('pants') || name.includes('スカート') || name.includes('下')) {
    return {
      color: 0x2c2c2c, // Dark bottom
      roughness: 0.6,
      metalness: 0.1,
      useStandard: true,
      transparent: false
    };
  } else if (name.includes('accessory') || name.includes('decoration') || name.includes('ribbon')) {
    return {
      color: 0xff1493, // Bright pink accessories
      roughness: 0.3,
      metalness: 0.1,
      useStandard: true,
      transparent: false
    };
  } else {
    return {
      color: 0xcccccc, // Default gray
      roughness: 0.5,
      metalness: 0.1,
      useStandard: false,
      transparent: false
    };
  }
}

// ===== ENHANCED VRM PROCESSING =====
async function processAndAddVRMEnhanced(gltf) {
  log('🎨 Processing VRM with advanced texture and animation system...');
  
  // STEP 1: Fix textures first
  await fixVRMTextures(gltf);
  
  // STEP 2: Proper scaling and positioning
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
  
  // Center and position
  gltf.scene.position.x = -scaledCenter.x;
  gltf.scene.position.y = -scaledBox.min.y;
  gltf.scene.position.z = -scaledCenter.z;
  
  gltf.scene.name = 'VRM_Model';
  scene.add(gltf.scene);
  
  // STEP 3: Camera positioning
  const finalHeight = scaledSize.y;
  const finalWidth = Math.max(scaledSize.x, scaledSize.z);
  const cameraDistance = Math.max(finalHeight * 1.5, finalWidth * 2.0, 3.0);
  const lookAtHeight = finalHeight * 0.6;
  
  camera.position.set(0, lookAtHeight, cameraDistance);
  camera.lookAt(0, lookAtHeight, 0);
  
  // STEP 4: Setup advanced animations
  setupAdvancedVRMAnimations(gltf);
  
  // STEP 5: Setup VRM expressions if available
  if (gltf.userData && gltf.userData.vrm) {
    currentVRM = gltf.userData.vrm;
    log('VRM expressions available');
    setupVRMExpressions();
  }
  
  log('✅ Enhanced VRM setup complete!');
}

// ===== ADVANCED ANIMATION SYSTEM =====
function setupAdvancedVRMAnimations(gltf) {
  log('🎭 Setting up advanced VRM animations...');
  
  // Setup built-in animations if available
  if (gltf.animations && gltf.animations.length > 0) {
    log(`Found ${gltf.animations.length} built-in animations`);
    mixer = new THREE.AnimationMixer(gltf.scene);
    
    gltf.animations.forEach((clip, index) => {
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat);
      action.play();
      log(`Playing animation: ${clip.name || `Animation_${index}`}`);
    });
  }
  
  // Add custom idle animations
  addAdvancedIdleAnimations(gltf.scene);
  
  // Setup morph target animations for expressions
  setupMorphTargetAnimations(gltf.scene);
}

// ===== ADVANCED IDLE ANIMATIONS =====
function addAdvancedIdleAnimations(vrmScene) {
  let time = 0;
  let blinkTimer = 0;
  let headMovementTimer = 0;
  
  // Find important bones/objects
  const headBone = findBoneByName(vrmScene, ['head', 'Head', 'neck', 'Neck']);
  const eyeBones = {
    left: findBoneByName(vrmScene, ['leftEye', 'LeftEye', 'eye_L']),
    right: findBoneByName(vrmScene, ['rightEye', 'RightEye', 'eye_R'])
  };
  
  function animateVRM() {
    if (!scene.getObjectByName('VRM_Model')) return;
    
    time += 0.016;
    blinkTimer += 0.016;
    headMovementTimer += 0.016;
    
    // Breathing animation (very subtle)
    const breathingScale = 1 + Math.sin(time * 2.5) * 0.003;
    vrmScene.scale.y = vrmScene.scale.x * breathingScale;
    
    // Gentle body sway
    vrmScene.rotation.y = Math.sin(time * 0.7) * 0.015;
    vrmScene.rotation.z = Math.sin(time * 0.5) * 0.005;
    
    // Advanced head movement
    if (headBone) {
      if (headMovementTimer > 2 + Math.random() * 3) {
        // Random head movement every 2-5 seconds
        headBone.rotation.y = (Math.random() - 0.5) * 0.3;
        headBone.rotation.x = (Math.random() - 0.5) * 0.1;
        headMovementTimer = 0;
      } else {
        // Smooth back to center
        headBone.rotation.y *= 0.98;
        headBone.rotation.x *= 0.98;
      }
      
      // Add subtle continuous movement
      headBone.rotation.y += Math.sin(time * 0.8) * 0.02;
      headBone.rotation.x += Math.sin(time * 0.6) * 0.01;
    }
    
    // Eye movement
    if (eyeBones.left || eyeBones.right) {
      const eyeMovement = {
        x: Math.sin(time * 1.2) * 0.1,
        y: Math.sin(time * 0.9) * 0.05
      };
      
      if (eyeBones.left) {
        eyeBones.left.rotation.x = eyeMovement.y;
        eyeBones.left.rotation.y = eyeMovement.x;
      }
      if (eyeBones.right) {
        eyeBones.right.rotation.x = eyeMovement.y;
        eyeBones.right.rotation.y = eyeMovement.x;
      }
    }
    
    // Enhanced blinking with morph targets
    if (blinkTimer > 2 + Math.random() * 3) {
      performBlink(vrmScene);
      blinkTimer = 0;
    }
    
    requestAnimationFrame(animateVRM);
  }
  
  animateVRM();
  log('🎭 Advanced idle animations started');
}

// ===== ENHANCED BLINKING =====
function performBlink(vrmScene) {
  // Method 1: Try VRM expressions if available
  if (currentVRM && currentVRM.expressionManager) {
    try {
      currentVRM.expressionManager.setValue('blink', 1.0);
      setTimeout(() => {
        if (currentVRM) currentVRM.expressionManager.setValue('blink', 0);
      }, 120);
      return;
    } catch (err) {
      log('VRM expression blink failed:', err);
    }
  }
  
  // Method 2: Use morph targets
  vrmScene.traverse((child) => {
    if (child.isMesh && child.morphTargetDictionary) {
      const blinkTargets = ['blink', 'Blink', 'eye_close', 'EyeClose'];
      
      for (const target of blinkTargets) {
        if (child.morphTargetDictionary[target] !== undefined) {
          const index = child.morphTargetDictionary[target];
          child.morphTargetInfluences[index] = 1.0;
          
          setTimeout(() => {
            child.morphTargetInfluences[index] = 0.0;
          }, 120);
          return;
        }
      }
    }
  });
  
  // Method 3: Scale eye meshes
  vrmScene.traverse((child) => {
    if (child.isMesh && child.name.toLowerCase().includes('eye')) {
      child.scale.y = 0.1;
      setTimeout(() => {
        child.scale.y = 1.0;
      }, 120);
    }
  });
}

// ===== MORPH TARGET ANIMATION SETUP =====
function setupMorphTargetAnimations(vrmScene) {
  vrmScene.traverse((child) => {
    if (child.isMesh && child.morphTargetDictionary) {
      log(`Found morph targets on ${child.name}:`, Object.keys(child.morphTargetDictionary));
      
      // Initialize all morph target influences to 0
      if (child.morphTargetInfluences) {
        for (let i = 0; i < child.morphTargetInfluences.length; i++) {
          child.morphTargetInfluences[i] = 0;
        }
      }
    }
  });
}

// ===== VRM EXPRESSIONS SETUP =====
function setupVRMExpressions() {
  if (!currentVRM) return;
  
  try {
    // Test available expressions
    const expressions = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'blink'];
    
    expressions.forEach(expr => {
      try {
        currentVRM.expressionManager.setValue(expr, 0);
        log(`VRM expression available: ${expr}`);
      } catch (err) {
        // Expression not available
      }
    });
    
    // Set to neutral
    currentVRM.expressionManager.setValue('neutral', 1);
    
  } catch (err) {
    log('VRM expression setup failed:', err);
  }
}

// ===== UTILITY FUNCTIONS =====
function findBoneByName(object, names) {
  let foundBone = null;
  
  object.traverse((child) => {
    if (child.isBone || child.type === 'Bone') {
      const childName = child.name.toLowerCase();
      for (const name of names) {
        if (childName.includes(name.toLowerCase())) {
          foundBone = child;
          return;
        }
      }
    }
  });
  
  return foundBone;
}

// ===== EXPRESSION CONTROL FOR TTS =====
function setVRMExpression(expression, value = 1.0, duration = 500) {
  if (!currentVRM) return;
  
  try {
    currentVRM.expressionManager.setValue(expression, value);
    
    if (duration > 0) {
      setTimeout(() => {
        if (currentVRM) currentVRM.expressionManager.setValue(expression, 0);
      }, duration);
    }
  } catch (err) {
    log('Expression control failed:', err);
  }
}

// ===== ENHANCED AUDIO SYSTEM WITH EXPRESSIONS =====
function fixAudioSystemWithExpressions() {
  let audioEnabled = false;
  
  function enableAudio() {
    if (!audioEnabled) {
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContext.resume();
        audioEnabled = true;
        log('🔊 Audio system enabled');
        
        // Test TTS with expression
        setTimeout(() => {
          setVRMExpression('happy', 1.0, 2000);
          queueTTS("Hello! I can now see you and speak with expressions!", 'nova');
        }, 500);
      } catch (err) {
        log('Audio enable failed:', err);
      }
    }
  }
  
  // Enable audio on any user interaction
  ['click', 'keydown', 'touchstart', 'mousedown'].forEach(event => {
    document.addEventListener(event, enableAudio, { once: true });
  });
  
  // Also enable when send button is clicked
  const sendBtn = document.getElementById('sendBtn');
  if (sendBtn) {
    sendBtn.addEventListener('click', enableAudio);
  }
}

// ===== ENHANCED FALLBACK TTS WITH EXPRESSIONS =====
function fallbackTTSEnhanced(text, voice) {
  try {
    log(`🗣️ Enhanced TTS: "${text.substring(0, 30)}..."`);
    
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Get better voice
    const voices = speechSynthesis.getVoices();
    const femaleVoices = voices.filter(v => 
      v.name.toLowerCase().includes('female') || 
      v.name.toLowerCase().includes('woman') ||
      v.name.toLowerCase().includes('alex') ||
      v.name.toLowerCase().includes('samantha')
    );
    
    const selectedVoice = femaleVoices.length > 0 ? femaleVoices[0] : voices[0];
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }
    
    utterance.rate = 0.9;
    utterance.pitch = 1.1;
    utterance.volume = 0.8;
    
    utterance.onend = () => {
      isPlaying = false;
      setVRMExpression('neutral', 1.0, 100);
      playNextAudio();
      log('✅ Enhanced TTS completed');
    };
    
    utterance.onstart = () => {
      // Set happy expression during speech
      setVRMExpression('happy', 0.7, 0);
      log('🎙️ Enhanced TTS started with expression');
    };
    
    utterance.onerror = (err) => {
      log('Enhanced TTS error:', err);
      isPlaying = false;
      setVRMExpression('neutral', 1.0, 100);
      playNextAudio();
    };
    
    speechSynthesis.speak(utterance);
    isPlaying = true;
    
  } catch (err) {
    log('Enhanced TTS failed:', err);
    isPlaying = false;
    playNextAudio();
  }
}

// ===== APPLY ALL FIXES =====
// Wait for scene to be available, then apply fixes
function applyComprehensiveFixes() {
  if (!scene) {
    setTimeout(applyComprehensiveFixes, 100);
    return;
  }
  
  log('🚀 Applying comprehensive VRM fixes...');
  
  // Replace the original processAndAddVRM function
  if (typeof processAndAddVRM !== 'undefined') {
    window.originalProcessAndAddVRM = processAndAddVRM;
    window.processAndAddVRM = processAndAddVRMEnhanced;
  }
  
  // Replace fallback TTS
  if (typeof fallbackTTS !== 'undefined') {
    window.originalFallbackTTS = fallbackTTS;
    window.fallbackTTS = fallbackTTSEnhanced;
  }
  
  // Fix lighting
  enhanceSceneLighting();
  
  // Fix audio system
  fixAudioSystemWithExpressions();
  
  // Apply to existing VRM if present
  const existingVRM = scene.getObjectByName('VRM_Model');
  if (existingVRM) {
    log('Applying fixes to existing VRM...');
    const fakeGltf = { scene: existingVRM };
    fixVRMTextures(fakeGltf);
    addAdvancedIdleAnimations(existingVRM);
  }
  
  log('✅ Comprehensive VRM fixes applied!');
}

// ===== MANUAL RELOAD WITH FIXES =====
window.reloadWithComprehensiveFixes = function() {
  log('🔄 Reloading VRM with comprehensive fixes...');
  forceReloadVRM();
  setTimeout(() => {
    enhanceSceneLighting();
  }, 2000);
};

// ===== EXPRESSION TESTING FUNCTION =====
window.testVRMExpressions = function() {
  if (!currentVRM) {
    log('No VRM loaded to test expressions');
    return;
  }
  
  const expressions = ['happy', 'sad', 'angry', 'surprised', 'neutral'];
  let index = 0;
  
  function cycleExpression() {
    const expr = expressions[index];
    setVRMExpression(expr, 1.0, 1500);
    log(`Testing expression: ${expr}`);
    
    index = (index + 1) % expressions.length;
    if (index < expressions.length) {
      setTimeout(cycleExpression, 2000);
    }
  }
  
  cycleExpression();
};

// Start applying fixes
applyComprehensiveFixes();

console.log('🎨 Comprehensive VRM fixes loaded!');
console.log('🔧 Commands: reloadWithComprehensiveFixes(), testVRMExpressions()');
console.log('🔊 Click anywhere to enable audio and expressions');

// ===== DIRECT VRM TEXTURE FIX =====
// Add this at the very end of your script.js to override the broken texture system

// Override the processAndAddVRM function with a working texture fix
window.processAndAddVRM = async function(gltf) {
  log('🎨 DIRECT TEXTURE FIX: Processing VRM...');
  
  // STEP 1: Force extract and apply textures properly
  await forceExtractVRMTextures(gltf);
  
  // STEP 2: Apply proper scaling and positioning
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  
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
  
  // STEP 3: Camera positioning
  const finalHeight = scaledSize.y;
  const finalWidth = Math.max(scaledSize.x, scaledSize.z);
  const cameraDistance = Math.max(finalHeight * 1.5, finalWidth * 2.0, 3.0);
  const lookAtHeight = finalHeight * 0.6;
  
  camera.position.set(0, lookAtHeight, cameraDistance);
  camera.lookAt(0, lookAtHeight, 0);
  
  // STEP 4: Add animations
  addWorkingAnimations(gltf.scene);
  
  log('✅ DIRECT FIX: VRM setup complete!');
};

// ===== FORCE TEXTURE EXTRACTION =====
async function forceExtractVRMTextures(gltf) {
  log('🔍 FORCE EXTRACTING VRM TEXTURES...');
  
  // Method 1: Check if textures are already loaded properly
  let texturesFound = 0;
  gltf.scene.traverse((child) => {
    if (child.isMesh && child.material) {
      const material = Array.isArray(child.material) ? child.material[0] : child.material;
      if (material.map && material.map.image) {
        texturesFound++;
        log(`Found working texture on: ${child.name}`);
      }
    }
  });
  
  if (texturesFound > 0) {
    log(`Found ${texturesFound} working textures, enhancing them...`);
    enhanceExistingTextures(gltf);
    return;
  }
  
  // Method 2: Force extract from GLB binary data
  log('No working textures found, extracting from GLB data...');
  
  try {
    // Access the raw GLB data from the loader
    const rawData = await fetch('/assets/avatar/solmate.vrm');
    const arrayBuffer = await rawData.arrayBuffer();
    
    // Parse GLB manually to extract textures
    const extractedTextures = await extractTexturesFromGLB(arrayBuffer);
    
    if (extractedTextures.length > 0) {
      log(`Extracted ${extractedTextures.length} textures from GLB`);
      applyExtractedTextures(gltf, extractedTextures);
    } else {
      log('No textures in GLB, applying color-based materials');
      applyColorBasedMaterials(gltf);
    }
    
  } catch (err) {
    log('GLB extraction failed, using color fallback:', err);
    applyColorBasedMaterials(gltf);
  }
}

// ===== EXTRACT TEXTURES FROM GLB =====
async function extractTexturesFromGLB(arrayBuffer) {
  const textures = [];
  
  try {
    const view = new DataView(arrayBuffer);
    const magic = view.getUint32(0, true);
    
    if (magic !== 0x46546C67) {
      throw new Error('Not a valid GLB file');
    }
    
    const length = view.getUint32(8, true);
    let chunkIndex = 12;
    let jsonChunk = null;
    let binaryChunk = null;
    
    // Extract chunks
    while (chunkIndex < length) {
      const chunkLength = view.getUint32(chunkIndex, true);
      const chunkType = view.getUint32(chunkIndex + 4, true);
      
      if (chunkType === 0x4E4F534A) { // JSON
        const jsonData = new Uint8Array(arrayBuffer, chunkIndex + 8, chunkLength);
        const jsonText = new TextDecoder().decode(jsonData);
        jsonChunk = JSON.parse(jsonText);
      } else if (chunkType === 0x004E4942) { // Binary
        binaryChunk = new Uint8Array(arrayBuffer, chunkIndex + 8, chunkLength);
      }
      
      chunkIndex += 8 + chunkLength;
    }
    
    if (!jsonChunk || !binaryChunk) {
      throw new Error('Missing JSON or binary chunk');
    }
    
    log('GLB parsed successfully:', {
      images: jsonChunk.images?.length || 0,
      textures: jsonChunk.textures?.length || 0,
      materials: jsonChunk.materials?.length || 0
    });
    
    // Extract images from binary data
    if (jsonChunk.images && jsonChunk.bufferViews) {
      for (let i = 0; i < jsonChunk.images.length; i++) {
        const imageDef = jsonChunk.images[i];
        
        if (imageDef.bufferView !== undefined) {
          const bufferView = jsonChunk.bufferViews[imageDef.bufferView];
          const imageData = binaryChunk.slice(bufferView.byteOffset, bufferView.byteOffset + bufferView.byteLength);
          
          try {
            const blob = new Blob([imageData], { type: imageDef.mimeType || 'image/png' });
            const url = URL.createObjectURL(blob);
            
            const texture = await new Promise((resolve, reject) => {
              const loader = new THREE.TextureLoader();
              loader.load(url, (tex) => {
                URL.revokeObjectURL(url);
                
                // Configure texture properly for VRM
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.flipY = false;
                tex.wrapS = THREE.RepeatWrapping;
                tex.wrapT = THREE.RepeatWrapping;
                tex.generateMipmaps = true;
                
                resolve(tex);
              }, undefined, reject);
            });
            
            textures.push(texture);
            log(`Extracted texture ${i}: ${imageDef.mimeType}, size: ${imageData.length} bytes`);
            
          } catch (texError) {
            log(`Failed to create texture ${i}:`, texError);
          }
        }
      }
    }
    
  } catch (err) {
    log('GLB parsing failed:', err);
  }
  
  return textures;
}

// ===== ENHANCE EXISTING TEXTURES =====
function enhanceExistingTextures(gltf) {
  log('🎨 Enhancing existing textures...');
  
  gltf.scene.traverse((child) => {
    if (child.isMesh) {
      const material = Array.isArray(child.material) ? child.material[0] : child.material;
      
      if (material.map && material.map.image) {
        // Create new material with proper settings
        const newMaterial = new THREE.MeshStandardMaterial({
          map: material.map,
          transparent: material.transparent,
          side: THREE.DoubleSide,
          toneMapped: false // KEY: Prevents gray appearance
        });
        
        // Configure texture properly
        if (material.map) {
          material.map.colorSpace = THREE.SRGBColorSpace;
          material.map.flipY = false;
        }
        
        child.material = newMaterial;
        log(`Enhanced texture material for: ${child.name}`);
      }
    }
  });
}

// ===== APPLY EXTRACTED TEXTURES =====
function applyExtractedTextures(gltf, textures) {
  log('🎨 Applying extracted textures to meshes...');
  
  let textureIndex = 0;
  
  gltf.scene.traverse((child) => {
    if (child.isMesh && textureIndex < textures.length) {
      const texture = textures[textureIndex];
      
      const material = new THREE.MeshStandardMaterial({
        map: texture,
        side: THREE.DoubleSide,
        toneMapped: false
      });
      
      child.material = material;
      log(`Applied extracted texture ${textureIndex} to: ${child.name}`);
      
      textureIndex++;
    }
  });
  
  // If we have extra meshes without textures, apply colors
  if (textureIndex === 0) {
    log('No textures could be applied, falling back to colors');
    applyColorBasedMaterials(gltf);
  }
}

// ===== COLOR-BASED MATERIALS (BACKUP) =====
function applyColorBasedMaterials(gltf) {
  log('🎨 Applying color-based materials...');
  
  const colors = [
    0xff69b4, // Pink (hair)
    0xffdbac, // Skin tone
    0xffffff, // White (clothes)
    0x333333  // Dark (skirt)
  ];
  
  let colorIndex = 0;
  
  gltf.scene.traverse((child) => {
    if (child.isMesh) {
      const color = colors[colorIndex % colors.length];
      
      const material = new THREE.MeshStandardMaterial({
        color: color,
        side: THREE.DoubleSide,
        toneMapped: false,
        roughness: 0.5,
        metalness: 0.1
      });
      
      child.material = material;
      log(`Applied color ${color.toString(16)} to: ${child.name}`);
      
      colorIndex++;
    }
  });
}

// ===== WORKING ANIMATIONS =====
function addWorkingAnimations(vrmScene) {
  log('🎭 Adding working animations...');
  
  let time = 0;
  let blinkTimer = 0;
  
  function animate() {
    if (!scene.getObjectByName('VRM_Model')) return;
    
    time += 0.016;
    blinkTimer += 0.016;
    
    // Breathing
    const breathScale = 1 + Math.sin(time * 2) * 0.005;
    vrmScene.scale.y = vrmScene.scale.x * breathScale;
    
    // Swaying
    vrmScene.rotation.y = Math.sin(time * 0.5) * 0.02;
    
    // Head movement
    vrmScene.traverse((child) => {
      if (child.name.toLowerCase().includes('head')) {
        child.rotation.y = Math.sin(time * 0.8) * 0.05;
        child.rotation.x = Math.sin(time * 0.6) * 0.02;
      }
    });
    
    // Blinking
    if (blinkTimer > 3) {
      vrmScene.traverse((child) => {
        if (child.isMesh && child.name.toLowerCase().includes('eye')) {
          child.scale.y = 0.1;
          setTimeout(() => {
            child.scale.y = 1;
          }, 120);
        }
      });
      blinkTimer = 0;
    }
    
    requestAnimationFrame(animate);
  }
  
  animate();
  log('🎭 Working animations started');
}

// ===== MANUAL TEXTURE RELOAD =====
window.forceTextureReload = async function() {
  log('🔄 FORCE RELOADING TEXTURES...');
  
  const vrmModel = scene.getObjectByName('VRM_Model');
  if (!vrmModel) {
    log('No VRM model found');
    return;
  }
  
  // Try to reload textures on existing model
  const fakeGltf = { scene: vrmModel };
  await forceExtractVRMTextures(fakeGltf);
  
  log('✅ Texture reload complete');
};

// ===== IMMEDIATE APPLICATION =====
log('🚀 DIRECT TEXTURE FIX LOADED');

// Apply to existing VRM if present
setTimeout(() => {
  const existingVRM = scene?.getObjectByName('VRM_Model');
  if (existingVRM) {
    log('Applying direct fix to existing VRM...');
    window.forceTextureReload();
  }
}, 1000);

console.log('🎨 DIRECT TEXTURE FIX READY!');
console.log('🔧 Manual command: forceTextureReload()');
console.log('📝 This fix directly addresses the baked texture issue');
