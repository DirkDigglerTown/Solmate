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

// ===== LOAD THREE.JS AND DEPENDENCIES =====
async function loadDependencies() {
  try {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/three.js/r158/three.min.js');
    THREE = window.THREE;
    log('Three.js loaded');

    await loadScript('https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.0.0/dist/three-vrm.module.js');
    VRMLoaderPlugin = window.VRMLoaderPlugin;
    VRM = window.VRM;
    VRMUtils = window.VRMUtils;
    log('VRM plugin loaded');

    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/three.js/r158/loaders/GLTFLoader.js');
    GLTFLoader = window.GLTFLoader || THREE.GLTFLoader;
    if (!GLTFLoader) throw new Error('GLTFLoader not available');
    log('GLTFLoader loaded');
  } catch (err) {
    log('Failed to load dependencies', err);
    throw err;
  }
}

// ===== THREE.JS SETUP WITH PROPER VRM SUPPORT =====
async function initThreeEnhanced() {
  try {
    log('=== THREE.JS INITIALIZATION WITH VRM SUPPORT ===');
    
    await loadDependencies();
    setupThreeJSScene();
    animate();
    await createFallbackAvatar();
    await loadVRMWithPlugin(VRM_PATH);
    setupVRMAnimationsAndExpressions();
    
    document.getElementById('loading').style.display = 'none';
    log('=== THREE.JS INITIALIZATION COMPLETE ===');
    
  } catch (err) {
    log('=== INITIALIZATION FAILED ===', err);
    createSimpleFallback();
    document.getElementById('loading').textContent = 'Initialization failed. Check console.';
  }
}

// ===== SETUP SCENE =====
function setupThreeJSScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 1.3, 2.5);
  camera.lookAt(0, 1, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
  directionalLight.position.set(1, 2, 1);
  directionalLight.castShadow = true;
  scene.add(directionalLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
  fillLight.position.set(-1, 1, -1);
  scene.add(fillLight);

  clock = new THREE.Clock();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ===== LOAD VRM WITH PLUGIN =====
async function loadVRMWithPlugin(path, retryCount = 0) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  try {
    const gltf = await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error('VRM load timeout')), ASSET_LOAD_TIMEOUT);
      loader.load(path, (gltf) => {
        clearTimeout(timeoutId);
        resolve(gltf);
      }, undefined, (err) => {
        clearTimeout(timeoutId);
        reject(err);
      });
    });
    currentVRM = gltf.userData.vrm;

    if (!currentVRM) {
      throw new Error('VRM plugin did not attach userData.vrm');
    }

    VRMUtils.removeUnnecessaryVertices(currentVRM.scene);
    VRMUtils.removeUnnecessaryJoints(currentVRM.scene);

    currentVRM.scene.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.frustumCulled = true;
        if (child.material && child.material.map) {
          child.material.map.colorSpace = THREE.SRGBColorSpace;
          child.material.map.flipY = false;
        }
      }
    });

    scene.add(currentVRM.scene);
    log('✅ VRM loaded successfully with textures');

  } catch (error) {
    log('VRM loading attempt failed', error);
    if (retryCount < VRM_MAX_RETRIES) {
      log(`Retrying VRM load (${retryCount + 1}/${VRM_MAX_RETRIES})...`);
      await loadVRMWithPlugin(path, retryCount + 1);
    } else {
      log('Max retries reached, keeping fallback');
    }
  }
}

// ===== SETUP ANIMATIONS AND EXPRESSIONS =====
function setupVRMAnimationsAndExpressions() {
  if (!currentVRM) return;

  mixer = new THREE.AnimationMixer(currentVRM.scene);

  const updateIdle = () => {
    currentVRM.scene.position.y = Math.sin(clock.getElapsedTime()) * 0.01;
    requestAnimationFrame(updateIdle);
  };
  updateIdle();

  if (currentVRM.expressionManager) {
    currentVRM.expressionManager.setValue('happy', 0.5);
    currentVRM.expressionManager.update();
  }

  log('✅ VRM animations and expressions initialized');
}

// ===== ANIMATION LOOP =====
function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  if (mixer) mixer.update(delta);

  if (currentVRM) {
    currentVRM.update(delta);
  }

  renderer.render(scene, camera);
}

// ===== FALLBACKS =====
async function createFallbackAvatar() {
  const geometry = new THREE.SphereGeometry(0.5, 32, 32);
  const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  const sphere = new THREE.Mesh(geometry, material);
  sphere.position.set(0, 1, 0);
  scene.add(sphere);
  log('Fallback sphere avatar added');
}

function createSimpleFallback() {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);
  log('Simple fallback cube added');
}

// ===== WEBSOCKET AND API HANDLERS =====
function initWebSocket() {
  ws = new WebSocket(HELIUS_WS);
  ws.onopen = ()
