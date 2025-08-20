// web/script.js
// Complete implementation with Three.js, VRM, Chat, TTS, WebSocket, and UI

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

// ===== THREE.JS SETUP (NOW WITH VRM LOADING) =====
async function initThree() {
  try {
    log('=== STARTING THREE.JS INITIALIZATION ===');
    log('Loading Three.js modules...');
    
    // STEP 1: Load Three.js core with multiple CDN fallbacks
    if (!window.THREE) {
      log('Three.js not found in window, trying multiple CDN sources...');
      
      const threeSources = [
        'https://unpkg.com/three@0.158.0/build/three.min.js',
        'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/three.js/r158/three.min.js'
      ];
      
      let threeLoaded = false;
      for (const source of threeSources) {
        try {
          log(`Trying Three.js source: ${source}`);
          await loadScript(source);
          
          if (window.THREE) {
            THREE = window.THREE;
            log('Three.js core loaded successfully from:', source);
            log('THREE object keys:', Object.keys(THREE).slice(0, 10));
            threeLoaded = true;
            break;
          } else {
            log(`Script loaded but window.THREE is undefined for: ${source}`);
          }
        } catch (scriptError) {
          log(`Three.js failed from ${source}:`, scriptError);
        }
      }
      
      if (!threeLoaded) {
        throw new Error('All Three.js CDN sources failed to load');
      }
    } else {
      log('Three.js already available in window');
      THREE = window.THREE;
    }
    
    // STEP 2: Verify THREE is working
    log('Verifying THREE functionality...');
    try {
      const testScene = new THREE.Scene();
      log('THREE.Scene creation successful');
      const testCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
      log('THREE.PerspectiveCamera creation successful');
    } catch (threeError) {
      log('THREE basic functionality test failed', threeError);
      throw new Error(`THREE basic test failed: ${threeError.message}`);
    }
    
    // STEP 3: Load GLTFLoader for VRM support (EMBEDDED APPROACH)
    if (!THREE.GLTFLoader) {
      log('Loading GLTF Loader for VRM support...');
      
      // Since all external CDN sources are failing, let's try embedding a minimal GLTF loader
      try {
        log('Creating embedded GLTF loader...');
        await createEmbeddedGLTFLoader();
        if (THREE.GLTFLoader) {
          log('✅ Embedded GLTF Loader created successfully');
        } else {
          log('Embedded GLTF loader creation failed');
        }
      } catch (embeddedError) {
        log('Embedded GLTF loader failed:', embeddedError);
        
        // Last resort: try the external CDNs one more time with different approach
        log('Trying external CDNs as final fallback...');
        const gltfSources = [
          'https://threejs.org/examples/js/loaders/GLTFLoader.js',
          'https://cdn.jsdelivr.net/npm/three@0.150.1/examples/js/loaders/GLTFLoader.js'
        ];
        
        for (const source of gltfSources) {
          try {
            log(`Final attempt: ${source}`);
            await loadScript(source);
            if (THREE.GLTFLoader) {
              log('✅ External GLTF Loader loaded successfully from:', source);
              break;
            }
          } catch (finalError) {
            log(`Final attempt failed from ${source}:`, finalError);
          }
        }
      }
    }
    
    log('=== SETTING UP THREE.JS SCENE ===');
    
    // STEP 4: Setup scene
    log('Creating scene...');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e17);
    log('Scene created successfully');
    
    // STEP 5: Setup camera
    log('Creating camera...');
    camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 20);
    camera.position.set(0, 1.3, 2.5);
    camera.lookAt(0, 1, 0);
    log('Camera created successfully');
    
    // STEP 6: Setup renderer
    log('Setting up renderer...');
    const canvas = document.getElementById('vrmCanvas');
    if (!canvas) {
      throw new Error('Canvas element #vrmCanvas not found in DOM');
    }
    log('Canvas element found');
    
    log('Creating WebGL renderer...');
    renderer = new THREE.WebGLRenderer({ 
      canvas, 
      antialias: true,
      alpha: true 
    });
    
    log('Setting renderer size...');
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    // Handle color space safely
    log('Setting color space...');
    try {
      if (renderer.outputColorSpace !== undefined) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        log('Color space set to SRGBColorSpace');
      } else if (renderer.outputEncoding !== undefined) {
        renderer.outputEncoding = THREE.sRGBEncoding;
        log('Output encoding set to sRGBEncoding');
      }
    } catch (colorSpaceError) {
      log('Color space setting failed, continuing anyway', colorSpaceError);
    }
    
    log('Renderer created successfully');
    
    // STEP 7: Add lights
    log('Adding lights...');
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(1, 1, 1);
    scene.add(dirLight);
    log('Lights added successfully');
    
    // STEP 8: Setup clock
    log('Creating animation clock...');
    clock = new THREE.Clock();
    log('Clock created');
    
    // STEP 9: Create immediate fallback (but try VRM first)
    log('Creating fallback avatar...');
    await createFallbackAvatar();
    
    // STEP 10: Start animation loop
    log('Starting animation loop...');
    animate();
    
    log('=== THREE.JS INITIALIZATION COMPLETE ===');
    
    // STEP 11: Try to load VRM file after scene is ready
    setTimeout(async () => {
      try {
        log('=== ATTEMPTING VRM LOAD ===');
        if (THREE.GLTFLoader) {
          await loadVRMFile(VRM_PATH);
        } else {
          log('No GLTF loader available, trying alternative VRM loading...');
          await loadVRMAlternative(VRM_PATH);
        }
      } catch (vrmError) {
        log('VRM loading failed, keeping fallback avatar', vrmError);
      }
    }, 2000);
    
  } catch (err) {
    log('=== THREE.JS INITIALIZATION FAILED ===', err);
    log('Error name:', err.name);
    log('Error message:', err.message);
    log('Error stack:', err.stack);
    
    // Create a simple fallback display
    createSimpleFallback();
    throw err; // Re-throw so calling code knows it failed
  }
}

// ===== CREATE EMBEDDED GLTF LOADER =====
async function createEmbeddedGLTFLoader() {
  const GLTFLoaderCode = `
    THREE.GLTFLoader = function(manager) {
      this.manager = (manager !== undefined) ? manager : THREE.DefaultLoadingManager;
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
            scope.parse(data, '', function(gltf) {
              onLoad(gltf);
            }, onError);
          } catch (e) {
            if (onError) onError(e);
            else console.error(e);
          }
        }, onProgress, onError);
      },
      
      setPath: function(path) {
        this.path = path;
        return this;
      },
      
      parse: function(data, path, onLoad, onError) {
        try {
          console.log('=== PARSING GLB DATA ===');
          const gltf = this.parseGLB(data);
          console.log('GLB parsed, building scene...');
          const result = this.buildRealScene(gltf);
          console.log('Scene built successfully');
          onLoad(result);
        } catch (error) {
          console.error('GLTF parse error:', error);
          if (onError) onError(error);
        }
      },
      
      parseGLB: function(data) {
        const view = new DataView(data);
        const magic = view.getUint32(0, true);
        
        if (magic !== 0x46546C67) {
          throw new Error('Invalid GLB file');
        }
        
        const version = view.getUint32(4, true);
        const length = view.getUint32(8, true);
        
        console.log('GLB Header:', { magic: magic.toString(16), version, length });
        
        let chunkIndex = 12;
        let jsonChunk = null;
        let binaryChunk = null;
        
        while (chunkIndex < length) {
          const chunkLength = view.getUint32(chunkIndex, true);
          const chunkType = view.getUint32(chunkIndex + 4, true);
          
          if (chunkType === 0x4E4F534A) { // JSON chunk
            const jsonData = new Uint8Array(data, chunkIndex + 8, chunkLength);
            const jsonText = new TextDecoder().decode(jsonData);
            jsonChunk = JSON.parse(jsonText);
            console.log('JSON chunk parsed, size:', chunkLength);
          } else if (chunkType === 0x004E4942) { // Binary chunk
            binaryChunk = new Uint8Array(data, chunkIndex + 8, chunkLength);
            console.log('Binary chunk found, size:', chunkLength);
          }
          
          chunkIndex += 8 + chunkLength;
        }
        
        return { json: jsonChunk, binary: binaryChunk };
      },
      
      buildRealScene: function(gltf) {
        const { json, binary } = gltf;
        
        if (!json) {
          throw new Error('No JSON data found in GLB');
        }
        
        console.log('GLTF JSON structure:', {
          scenes: json.scenes?.length || 0,
          nodes: json.nodes?.length || 0,
          meshes: json.meshes?.length || 0,
          materials: json.materials?.length || 0,
          textures: json.textures?.length || 0,
          bufferViews: json.bufferViews?.length || 0,
          accessors: json.accessors?.length || 0
        });
        
        // Create main scene
        const scene = new THREE.Group();
        scene.name = 'VRM_Scene';
        
        // Try to parse actual meshes
        if (json.meshes && json.bufferViews && json.accessors && binary) {
          console.log('Attempting to parse real mesh data...');
          try {
            this.parseRealMeshes(json, binary, scene);
            console.log('✅ Real meshes parsed successfully!');
          } catch (meshError) {
            console.warn('Real mesh parsing failed:', meshError);
            console.log('Creating enhanced fallback...');
            this.createEnhancedFallback(scene, json);
          }
        } else {
          console.log('Missing mesh data, creating enhanced fallback...');
          this.createEnhancedFallback(scene, json);
        }
        
        // Check for VRM extensions
        const isVRM = json.extensions && (json.extensions.VRM || json.extensions.VRMC_vrm);
        
        const result = {
          scene: scene,
          scenes: [scene],
          animations: json.animations || [],
          cameras: [],
          userData: {
            gltfLoader: true,
            isVRM: isVRM,
            originalJson: json,
            meshCount: json.meshes?.length || 0,
            nodeCount: json.nodes?.length || 0
          }
        };
        
        return result;
      },
      
      parseRealMeshes: function(json, binary, scene) {
        console.log('=== PARSING REAL MESH DATA ===');
        
        if (!json.meshes || !json.bufferViews || !json.accessors) {
          throw new Error('Missing required mesh data');
        }
        
        const meshGroup = new THREE.Group();
        meshGroup.name = 'VRM_Meshes';
        
        // Parse each mesh
        for (let i = 0; i < Math.min(json.meshes.length, 10); i++) { // Limit to first 10 meshes
          const meshDef = json.meshes[i];
          console.log(\`Parsing mesh \${i}:\`, meshDef.name || 'unnamed');
          
          if (meshDef.primitives && meshDef.primitives.length > 0) {
            const primitive = meshDef.primitives[0]; // Use first primitive
            
            try {
              const geometry = this.createGeometryFromPrimitive(primitive, json, binary);
              const material = this.createMaterialFromPrimitive(primitive, json);
              
              const mesh = new THREE.Mesh(geometry, material);
              mesh.name = meshDef.name || \`Mesh_\${i}\`;
              meshGroup.add(mesh);
              
              console.log(\`✅ Mesh \${i} created successfully\`);
            } catch (primitiveError) {
              console.warn(\`Failed to create mesh \${i}:\`, primitiveError);
            }
          }
        }
        
        if (meshGroup.children.length > 0) {
          scene.add(meshGroup);
          console.log(\`Added \${meshGroup.children.length} real meshes to scene\`);
        } else {
          throw new Error('No meshes could be created');
        }
      },
      
      createGeometryFromPrimitive: function(primitive, json, binary) {
        const geometry = new THREE.BufferGeometry();
        
        // Get position data
        if (primitive.attributes.POSITION !== undefined) {
          const positionData = this.getAccessorData(primitive.attributes.POSITION, json, binary);
          if (positionData) {
            geometry.setAttribute('position', new THREE.BufferAttribute(positionData, 3));
          }
        }
        
        // Get normal data
        if (primitive.attributes.NORMAL !== undefined) {
          const normalData = this.getAccessorData(primitive.attributes.NORMAL, json, binary);
          if (normalData) {
            geometry.setAttribute('normal', new THREE.BufferAttribute(normalData, 3));
          }
        }
        
        // Get UV data
        if (primitive.attributes.TEXCOORD_0 !== undefined) {
          const uvData = this.getAccessorData(primitive.attributes.TEXCOORD_0, json, binary);
          if (uvData) {
            geometry.setAttribute('uv', new THREE.BufferAttribute(uvData, 2));
          }
        }
        
        // Get indices
        if (primitive.indices !== undefined) {
          const indexData = this.getAccessorData(primitive.indices, json, binary);
          if (indexData) {
            geometry.setIndex(new THREE.BufferAttribute(indexData, 1));
          }
        }
        
        // Compute normals if missing
        if (!geometry.attributes.normal) {
          geometry.computeVertexNormals();
        }
        
        return geometry;
      },
      
      getAccessorData: function(accessorIndex, json, binary) {
        try {
          const accessor = json.accessors[accessorIndex];
          const bufferView = json.bufferViews[accessor.bufferView];
          
          const byteOffset = (accessor.byteOffset || 0) + (bufferView.byteOffset || 0);
          const count = accessor.count;
          const componentType = accessor.componentType;
          
          // Determine component size
          let componentSize;
          switch (componentType) {
            case 5120: componentSize = 1; break; // BYTE
            case 5121: componentSize = 1; break; // UNSIGNED_BYTE
            case 5122: componentSize = 2; break; // SHORT
            case 5123: componentSize = 2; break; // UNSIGNED_SHORT
            case 5125: componentSize = 4; break; // UNSIGNED_INT
            case 5126: componentSize = 4; break; // FLOAT
            default: componentSize = 4;
          }
          
          // Determine element count
          let elementCount;
          switch (accessor.type) {
            case 'SCALAR': elementCount = 1; break;
            case 'VEC2': elementCount = 2; break;
            case 'VEC3': elementCount = 3; break;
            case 'VEC4': elementCount = 4; break;
            default: elementCount = 1;
          }
          
          const byteLength = count * elementCount * componentSize;
          const arrayBuffer = binary.slice(byteOffset, byteOffset + byteLength);
          
          // Create appropriate typed array
          switch (componentType) {
            case 5120: return new Int8Array(arrayBuffer);
            case 5121: return new Uint8Array(arrayBuffer);
            case 5122: return new Int16Array(arrayBuffer);
            case 5123: return new Uint16Array(arrayBuffer);
            case 5125: return new Uint32Array(arrayBuffer);
            case 5126: return new Float32Array(arrayBuffer);
            default: return new Float32Array(arrayBuffer);
          }
        } catch (error) {
          console.warn('Failed to get accessor data:', error);
          return null;
        }
      },
      
      createMaterialFromPrimitive: function(primitive, json) {
        // Create basic material
        let material = new THREE.MeshLambertMaterial({
          color: 0xcccccc,
          side: THREE.DoubleSide
        });
        
        // Try to get material data
        if (primitive.material !== undefined && json.materials) {
          const materialDef = json.materials[primitive.material];
          if (materialDef) {
            if (materialDef.pbrMetallicRoughness && materialDef.pbrMetallicRoughness.baseColorFactor) {
              const color = materialDef.pbrMetallicRoughness.baseColorFactor;
              material.color.setRGB(color[0], color[1], color[2]);
            }
            if (materialDef.name && materialDef.name.toLowerCase().includes('hair')) {
              material.color.setHex(0x8B4513); // Brown for hair
            } else if (materialDef.name && materialDef.name.toLowerCase().includes('skin')) {
              material.color.setHex(0xffdbac); // Skin tone
            }
          }
        }
        
        return material;
      },
      
      createEnhancedFallback: function(scene, json) {
        console.log('Creating enhanced VRM-like character...');
        
        const character = new THREE.Group();
        character.name = 'VRM_Character_Fallback';
        
        // Scale based on VRM typical size
        const scale = 0.8;
        
        // More realistic proportions
        const headGeo = new THREE.SphereGeometry(0.12 * scale, 20, 20);
        const headMat = new THREE.MeshLambertMaterial({ color: 0xffdbac });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 1.6 * scale;
        head.scale.set(1, 1.1, 0.9);
        character.add(head);
        
        // Anime-style hair
        const hairGeo = new THREE.SphereGeometry(0.15 * scale, 16, 16);
        const hairMat = new THREE.MeshLambertMaterial({ color: 0x654321 });
        const hair = new THREE.Mesh(hairGeo, hairMat);
        hair.position.y = 1.65 * scale;
        hair.scale.set(1.3, 0.8, 1.2);
        character.add(hair);
        
        // Body
        const bodyGeo = new THREE.CapsuleGeometry ? 
          new THREE.CapsuleGeometry(0.15 * scale, 0.4 * scale, 4, 8) :
          new THREE.CylinderGeometry(0.15 * scale, 0.18 * scale, 0.5 * scale, 12);
        const bodyMat = new THREE.MeshLambertMaterial({ color: 0x4169E1 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 1.1 * scale;
        character.add(body);
        
        // Arms
        const armGeo = new THREE.CylinderGeometry(0.04 * scale, 0.05 * scale, 0.4 * scale, 8);
        const armMat = new THREE.MeshLambertMaterial({ color: 0xffdbac });
        
        const leftArm = new THREE.Mesh(armGeo, armMat);
        leftArm.position.set(-0.22 * scale, 1.15 * scale, 0);
        leftArm.rotation.z = 0.3;
        character.add(leftArm);
        
        const rightArm = new THREE.Mesh(armGeo, armMat);
        rightArm.position.set(0.22 * scale, 1.15 * scale, 0);
        rightArm.rotation.z = -0.3;
        character.add(rightArm);
        
        // Skirt/dress
        const skirtGeo = new THREE.CylinderGeometry(0.18 * scale, 0.22 * scale, 0.3 * scale, 12);
        const skirtMat = new THREE.MeshLambertMaterial({ color: 0x2F4F4F });
        const skirt = new THREE.Mesh(skirtGeo, skirtMat);
        skirt.position.y = 0.75 * scale;
        character.add(skirt);
        
        // Legs
        const legGeo = new THREE.CylinderGeometry(0.05 * scale, 0.06 * scale, 0.4 * scale, 8);
        const legMat = new THREE.MeshLambertMaterial({ color: 0xffdbac });
        
        const leftLeg = new THREE.Mesh(legGeo, legMat);
        leftLeg.position.set(-0.08 * scale, 0.4 * scale, 0);
        character.add(leftLeg);
        
        const rightLeg = new THREE.Mesh(legGeo, legMat);
        rightLeg.position.set(0.08 * scale, 0.4 * scale, 0);
        character.add(rightLeg);
        
        // Eyes
        const eyeGeo = new THREE.SphereGeometry(0.02 * scale, 8, 8);
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
        
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(-0.04 * scale, 1.62 * scale, 0.1 * scale);
        character.add(leftEye);
        
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(0.04 * scale, 1.62 * scale, 0.1 * scale);
        character.add(rightEye);
        
        character.position.y = -0.1;
        scene.add(character);
        
        // Add animation
        this.addCharacterAnimation(character);
        
        console.log('Enhanced VRM-like character created');
      },
      
      addCharacterAnimation: function(character) {
        let time = 0;
        const animate = () => {
          if (!scene.getObjectByName(character.name)) return;
          
          time += 0.016;
          
          // Breathing
          character.scale.y = 1 + Math.sin(time * 2) * 0.015;
          
          // Gentle swaying
          character.rotation.y = Math.sin(time * 0.5) * 0.03;
          
          // Head movement
          const head = character.children.find(child => child.position.y > 1.5);
          if (head) {
            head.rotation.y = Math.sin(time * 0.8) * 0.08;
            head.rotation.x = Math.sin(time * 0.6) * 0.02;
          }
          
          requestAnimationFrame(animate);
        };
        animate();
      }
    };
  `;
  
  eval(GLTFLoaderCode);
  
  if (THREE.GLTFLoader) {
    log('✅ Enhanced VRM-parsing GLTF loader created');
    return true;
  } else {
    throw new Error('Failed to create enhanced GLTF loader');
  }
}
// ===== ALTERNATIVE VRM LOADING (WITHOUT GLTF LOADER) =====
async function loadVRMAlternative(url) {
  try {
    log('=== ALTERNATIVE VRM LOADING ===');
    log('Attempting to load VRM without GLTF loader...');
    
    // Check if file exists
    const checkResponse = await fetch(url, { method: 'HEAD' });
    if (!checkResponse.ok) {
      throw new Error(`VRM file not accessible: ${checkResponse.status}`);
    }
    
    const fileSizeMB = Math.round((checkResponse.headers.get('content-length') || 0) / 1024 / 1024);
    log(`VRM file found: ${fileSizeMB}MB`);
    
    // Since we can't parse VRM without GLTF loader, create a better placeholder
    // Remove the basic fallback sphere
    const fallbackAvatar = scene.getObjectByName('fallbackAvatar');
    if (fallbackAvatar) {
      log('Removing basic fallback avatar');
      scene.remove(fallbackAvatar);
    }
    
    // Create a more sophisticated avatar placeholder
    log('Creating sophisticated avatar placeholder...');
    
    // Create a human-like figure using basic Three.js geometry
    const avatarGroup = new THREE.Group();
    avatarGroup.name = 'alternativeAvatar';
    
    // Head
    const headGeometry = new THREE.SphereGeometry(0.15, 16, 16);
    const headMaterial = new THREE.MeshLambertMaterial({ color: 0xffdbac }); // Skin tone
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 1.6;
    avatarGroup.add(head);
    
    // Body
    const bodyGeometry = new THREE.CylinderGeometry(0.2, 0.25, 0.8, 8);
    const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0x4a90e2 }); // Blue outfit
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.8;
    avatarGroup.add(body);
    
    // Arms
    const armGeometry = new THREE.CylinderGeometry(0.05, 0.08, 0.6, 6);
    const armMaterial = new THREE.MeshLambertMaterial({ color: 0xffdbac });
    
    const leftArm = new THREE.Mesh(armGeometry, armMaterial);
    leftArm.position.set(-0.35, 0.9, 0);
    leftArm.rotation.z = 0.3;
    avatarGroup.add(leftArm);
    
    const rightArm = new THREE.Mesh(armGeometry, armMaterial);
    rightArm.position.set(0.35, 0.9, 0);
    rightArm.rotation.z = -0.3;
    avatarGroup.add(rightArm);
    
    // Legs
    const legGeometry = new THREE.CylinderGeometry(0.08, 0.1, 0.8, 6);
    const legMaterial = new THREE.MeshLambertMaterial({ color: 0x2c5aa0 }); // Darker blue
    
    const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
    leftLeg.position.set(-0.12, 0.0, 0);
    avatarGroup.add(leftLeg);
    
    const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
    rightLeg.position.set(0.12, 0.0, 0);
    avatarGroup.add(rightLeg);
    
    // Hair (anime-style)
    const hairGeometry = new THREE.SphereGeometry(0.18, 16, 16);
    const hairMaterial = new THREE.MeshLambertMaterial({ color: 0xff6b35 }); // Orange hair
    const hair = new THREE.Mesh(hairGeometry, hairMaterial);
    hair.position.y = 1.7;
    hair.scale.set(1, 0.8, 1);
    avatarGroup.add(hair);
    
    // Position the avatar
    avatarGroup.position.y = -1;
    
    // Add to scene
    scene.add(avatarGroup);
    
    // Add simple animation
    let time = 0;
    function animateAvatar() {
      time += 0.02;
      
      // Gentle swaying
      avatarGroup.rotation.y = Math.sin(time * 0.5) * 0.1;
      
      // Head movement
      if (head) {
        head.rotation.y = Math.sin(time) * 0.1;
        head.rotation.x = Math.sin(time * 0.7) * 0.05;
      }
      
      // Arm movement
      if (leftArm) {
        leftArm.rotation.z = 0.3 + Math.sin(time * 1.2) * 0.1;
      }
      if (rightArm) {
        rightArm.rotation.z = -0.3 + Math.sin(time * 1.5) * 0.1;
      }
      
      requestAnimationFrame(animateAvatar);
    }
    animateAvatar();
    
    log('✅ Alternative avatar created successfully!');
    log('This is a placeholder until we can load the actual VRM file');
    
    // Hide loading status
    const statusEl = document.getElementById('loadingStatus');
    if (statusEl) statusEl.style.display = 'none';
    
  } catch (err) {
    log('❌ Alternative VRM loading failed', err);
    throw err;
  }
}

// ===== LOAD VRM FILE (IMPROVED WITH BETTER ERROR HANDLING) =====
async function loadVRMFile(url, retryCount = 0) {
  try {
    log(`=== LOADING VRM FILE (attempt ${retryCount + 1}) ===`);
    log('VRM URL:', url);
    
    if (!THREE.GLTFLoader) {
      throw new Error('GLTFLoader not available');
    }
    
    log('GLTFLoader is available, proceeding with VRM loading...');
    
    // Check if VRM file exists first
    log('Checking VRM file availability...');
    const checkResponse = await fetch(url, { method: 'HEAD' });
    log(`VRM file check: ${checkResponse.status} ${checkResponse.statusText}`);
    
    if (!checkResponse.ok) {
      throw new Error(`VRM file not accessible: ${checkResponse.status}`);
    }
    
    const contentLength = checkResponse.headers.get('content-length');
    const fileSizeMB = contentLength ? Math.round(contentLength / 1024 / 1024) : 'unknown';
    log(`VRM file size: ${fileSizeMB}MB`);
    
    // Create GLTF loader
    log('Creating GLTF loader instance...');
    const loader = new THREE.GLTFLoader();
    
    log('Starting VRM file loading...');
    
    const gltf = await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('VRM loading timeout after 30 seconds'));
      }, ASSET_LOAD_TIMEOUT);
      
      loader.load(
        url,
        (loadedGltf) => {
          clearTimeout(timeoutId);
          log('✅ GLTF file loaded successfully!');
          log('GLTF info:', {
            scenes: loadedGltf.scenes.length,
            animations: loadedGltf.animations.length,
            cameras: loadedGltf.cameras.length,
            userData: Object.keys(loadedGltf.userData || {}),
            sceneChildren: loadedGltf.scene ? loadedGltf.scene.children.length : 0
          });
          resolve(loadedGltf);
        },
        (progress) => {
          if (progress.total > 0) {
            const percent = Math.round((progress.loaded / progress.total) * 100);
            log(`Loading progress: ${percent}%`);
            const statusEl = document.getElementById('loadingStatus');
            if (statusEl) statusEl.textContent = `Loading avatar: ${percent}%`;
          }
        },
        (error) => {
          clearTimeout(timeoutId);
          log('❌ GLTF loading error:', error);
          reject(error);
        }
      );
    });
    
    // Remove the fallback avatars
    const fallbackAvatar = scene.getObjectByName('fallbackAvatar');
    if (fallbackAvatar) {
      log('Removing basic fallback avatar');
      scene.remove(fallbackAvatar);
    }
    
    const alternativeAvatar = scene.getObjectByName('alternativeAvatar');
    if (alternativeAvatar) {
      log('Removing alternative avatar');
      scene.remove(alternativeAvatar);
    }
    
    // Add the loaded model to the scene
    if (gltf.scene) {
      log('Adding VRM scene to Three.js scene');
      
      // Calculate the bounding box to properly scale and position
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      
      log('Model bounding box:', { size, center });
      
      // Scale the model to a reasonable size (about 2 units tall)
      const maxDimension = Math.max(size.x, size.y, size.z);
      const targetHeight = 2;
      const scale = targetHeight / maxDimension;
      
      gltf.scene.scale.setScalar(scale);
      log('Applied scale:', scale);
      
      // Position the model so its bottom is at y=0 and it's centered
      gltf.scene.position.x = -center.x * scale;
      gltf.scene.position.y = -box.min.y * scale; // Put bottom at y=0
      gltf.scene.position.z = -center.z * scale;
      
      gltf.scene.name = 'vrmModel';
      
      // Add to scene
      scene.add(gltf.scene);
      
      // Adjust camera to look at the character properly
      const characterHeight = size.y * scale;
      const lookAtHeight = characterHeight * 0.6; // Look at face/chest area
      
      camera.position.set(0, lookAtHeight, 3);
      camera.lookAt(0, lookAtHeight, 0);
      
      log('Camera repositioned to:', { 
        position: camera.position, 
        lookAt: `(0, ${lookAtHeight}, 0)`,
        characterHeight 
      });
      
      // Setup animations if available
      if (gltf.animations && gltf.animations.length > 0) {
        log(`Setting up ${gltf.animations.length} animations`);
        mixer = new THREE.AnimationMixer(gltf.scene);
        
        // Play the first animation (usually idle)
        const action = mixer.clipAction(gltf.animations[0]);
        action.play();
        
        log('Animation setup complete');
      } else {
        log('No animations found in VRM file');
      }
      
      // Log model details for debugging
      log('VRM model details:', {
        finalPosition: gltf.scene.position,
        finalScale: gltf.scene.scale,
        boundingBox: box,
        children: gltf.scene.children.length
      });
      
      log('🎉 VRM model loaded and positioned successfully!');
      
      // Hide loading status
      const statusEl = document.getElementById('loadingStatus');
      if (statusEl) statusEl.style.display = 'none';
      
      // Set currentVRM for expressions if this is a real VRM
      if (gltf.userData && gltf.userData.vrm) {
        currentVRM = gltf.userData.vrm;
        log('VRM expressions available');
      } else {
        log('No VRM expression data found (loaded as regular GLTF)');
      }
      
    } else {
      throw new Error('No scene found in GLTF file');
    }
    
  } catch (err) {
    if (retryCount < VRM_MAX_RETRIES) {
      log(`VRM load retry ${retryCount + 1} in 3 seconds...`, err);
      setTimeout(() => loadVRMFile(url, retryCount + 1), 3000);
    } else {
      log('❌ VRM loading failed completely after all retries', err);
      throw err;
    }
  }
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
    
    // Hide loading status since we have something to show
    const statusEl = document.getElementById('loadingStatus');
    if (statusEl) statusEl.style.display = 'none';
    
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
    log('Price API response headers:', Object.fromEntries(res.headers.entries()));
    
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    
    // Get raw text first to debug
    const text = await res.text();
    log('Raw response text:', text.substring(0, 500)); // First 500 chars
    
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      log('JSON parse failed:', parseError);
      throw new Error('Invalid JSON response');
    }
    
    log('Parsed data type:', typeof data);
    log('Parsed data keys:', Object.keys(data));
    
    // Force detailed logging to console
    console.log('=== COMPLETE PRICE RESPONSE DEBUG ===');
    console.log('Status:', res.status);
    console.log('Raw text length:', text.length);
    console.log('Raw text sample:', text.substring(0, 200));
    console.log('Parsed data:', data);
    console.log('Data structure:');
    console.log(JSON.stringify(data, null, 2));
    console.log('=== END PRICE DEBUG ===');
    
    const solPrice = document.getElementById('solPrice');
    if (!solPrice) {
      log('ERROR: solPrice element not found in DOM');
      return;
    }
    
    // Based on Jupiter Lite API v3, the response should be:
    // { "data": { "So11111111111111111111111111111111111111112": { "id": "...", "type": "...", "price": number } } }
    
    let price = null;
    let priceSource = '';
    
    // Method 1: Jupiter Lite API v3 format - data.data[mint].price
    if (data.data && typeof data.data === 'object' && data.data[SOL_MINT]) {
      const solData = data.data[SOL_MINT];
      log('Found SOL data object:', solData);
      if (typeof solData.price === 'number') {
        price = solData.price;
        priceSource = 'Jupiter API v3: data.data[SOL_MINT].price';
      }
    }
    // Method 2: Direct in data object
    else if (data[SOL_MINT] && typeof data[SOL_MINT] === 'object' && typeof data[SOL_MINT].price === 'number') {
      price = data[SOL_MINT].price;
      priceSource = 'Direct mint object: data[SOL_MINT].price';
    }
    // Method 3: Direct price field
    else if (typeof data.price === 'number') {
      price = data.price;
      priceSource = 'Direct price field';
    }
    // Method 4: SOL mint key as number
    else if (data[SOL_MINT] && typeof data[SOL_MINT] === 'number') {
      price = data[SOL_MINT];
      priceSource = 'Direct mint key as number';
    }
    // Method 5: Search for ANY reasonable price value
    else {
      log('No standard format found, searching entire response...');
      function searchForPrice(obj, path = '') {
        if (typeof obj === 'number' && obj > 1 && obj < 10000) {
          log(`Found potential price: ${obj} at ${path || 'root'}`);
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
    
    log('Final price extraction result:', { price, priceSource });
    
    if (price !== null && !isNaN(price) && price > 0) {
      solPrice.textContent = `SOL — $${price.toFixed(2)}`;
      solPrice.style.color = '#00ff88'; // Success color
      log(`✅ SUCCESS: Price updated to $${price.toFixed(2)} (${priceSource})`);
    } else {
      solPrice.textContent = 'SOL — Data parsing error';
      solPrice.style.color = '#ff6b6b'; // Error color
      log('❌ FAILED: Could not extract price from response');
      log('Available data:', Object.keys(data));
      
      // Show what we actually got
      if (data.data && data.data[SOL_MINT]) {
        log('SOL mint data keys:', Object.keys(data.data[SOL_MINT]));
        log('SOL mint data values:', data.data[SOL_MINT]);
      }
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
  
  // Health button
  const healthBtn = document.getElementById('healthBtn');
  if (healthBtn) {
    healthBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/health');
        const data = await res.json();
        alert(`Health Check:\n` +
              `Status: ${data.ok ? 'OK' : 'Failed'}\n` +
              `OpenAI: ${data.env ? 'Connected' : 'Missing API Key'}\n` +
              `VRM Avatar: ${currentVRM ? 'Loaded' : 'Failed'}\n` +
              `Three.js: ${THREE ? 'Loaded' : 'Failed'}`);
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

// ===== MAIN INIT =====
async function init() {
  log('=== INITIALIZING SOLMATE ===');
  
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
    
    // STEP 3: Try to initialize Three.js (but don't let it block everything)
    try {
      log('Attempting Three.js initialization...');
      await initThree();
      
      // Start animations if Three.js worked
      setTimeout(() => {
        blink();
      }, 2000);
      
    } catch (threeError) {
      log('Three.js failed, continuing with audio-only mode', threeError);
      // Continue without 3D - the app is still functional
    }
    
    // STEP 4: Connect WebSocket (independent of Three.js)
    log('Connecting WebSocket...');
    connectWebSocket();
    
    log('=== SOLMATE INITIALIZATION COMPLETE ===');
    
    // STEP 5: Welcome message (delay to allow user interaction)
    setTimeout(() => {
      queueTTS("Hello, I'm your Solana Solmate. How can I help you today?", 'nova');
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

// ===== START =====
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
