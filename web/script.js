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
let THREE, GLTFLoader, VRMLoaderPlugin, VRMUtils;
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

    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/three.js/r158/loaders/GLTFLoader.js');
    GLTFLoader = window.GLTFLoader || THREE.GLTFLoader;
    if (!GLTFLoader) throw new Error('GLTFLoader not available');
    log('GLTFLoader loaded');

    await loadScript('https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.0.0/dist/three-vrm.js');
    VRMLoaderPlugin = window.VRMLoaderPlugin;
    VRMUtils = window.VRMUtils;
    log('VRM plugin loaded');
  } catch (err) {
    log('Failed to load dependencies', err);
    throw err;
  }
}

// ===== ENHANCED THREE.JS SETUP WITH GROK COMPANION STYLE =====
async function initThreeEnhanced() {
  try {
    log('=== THREE.JS INITIALIZATION WITH GROK COMPANION STYLE ===');
    
    await loadDependencies();
    setupThreeJSScene();
    animate();
    await createFallbackAvatar();
    
    setTimeout(async () => {
      try {
        await loadVRMWithPlugin(VRM_PATH);
        setupVRMAnimationsAndExpressions();
        applyGrokCompanionStyle();
      } catch (vrmError) {
        log('VRM loading failed, keeping fallback', vrmError);
      }
    }, 1000);
    
    document.getElementById('loading').style.display = 'none';
    log('=== THREE.JS INITIALIZATION COMPLETE ===');
    
  } catch (err) {
    log('=== ENHANCED INITIALIZATION FAILED ===', err);
    createSimpleFallback();
    document.getElementById('loading').textContent = 'Initialization failed. Check console.';
  }
}

// ===== SETUP SCENE =====
function setupThreeJSScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e); // Dark futuristic background

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

  const ambientLight = new THREE.AmbientLight(0x4a4a77, 0.7); // Subtle blue ambient
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0x00d4ff, 1.0); // Cyan light for tech feel
  directionalLight.position.set(1, 2, 1);
  directionalLight.castShadow = true;
  scene.add(directionalLight);

  const fillLight = new THREE.DirectionalLight(0x00ffcc, 0.5); // Teal fill
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
async function loadVRMWithPlugin(path) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  let retryCount = 0;
  while (retryCount <= VRM_MAX_RETRIES) {
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
            child.material.needsUpdate = true;
          }
        }
      });

      scene.add(currentVRM.scene);
      log('✅ VRM loaded successfully with textures');
      return;
    } catch (error) {
      log('VRM loading attempt failed', error);
      retryCount++;
      if (retryCount > VRM_MAX_RETRIES) {
        throw error;
      }
      log(`Retrying VRM load (${retryCount}/${VRM_MAX_RETRIES})...`);
    }
  }
}

// ===== SETUP ANIMATIONS AND EXPRESSIONS =====
function setupVRMAnimationsAndExpressions() {
  if (!currentVRM) return;

  mixer = new THREE.AnimationMixer(currentVRM.scene);

  // Grok-like idle animations
  const updateIdle = () => {
    const time = clock.getElapsedTime();
    currentVRM.scene.position.y = Math.sin(time) * 0.01; // Subtle breathing
    currentVRM.scene.rotation.y = Math.sin(time * 0.2) * 0.1; // Gentle head tilt
    requestAnimationFrame(updateIdle);
  };
  updateIdle();

  if (currentVRM.expressionManager) {
    // Default expression
    currentVRM.expressionManager.setValue('happy', 0.3);
    currentVRM.expressionManager.update();
  }

  log('✅ VRM animations and expressions initialized');
}

// ===== APPLY GROK COMPANION STYLE =====
function applyGrokCompanionStyle() {
  if (!currentVRM) return;

  currentVRM.scene.traverse((child) => {
    if (child.isMesh && child.material) {
      const material = child.material;
      if (material.isMToonMaterial) {
        // Add holographic/tech effect
        material.emissive.set(0x00d4ff); // Cyan glow
        material.emissiveIntensity = 0.2;
        material.shadeFactor.set(0.7, 0.7, 0.7); // Softer shading
        material.needsUpdate = true;
      }
    }
  });

  // Enable spring bones for dynamic movement (if present in VRM)
  if (currentVRM.springBoneManager) {
    currentVRM.springBoneManager.update(clock.getDelta());
  }

  log('✅ Applied Grok companion style');
}

// ===== ANIMATION LOOP =====
function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  if (mixer) mixer.update(delta);

  if (currentVRM) {
    currentVRM.update(delta);
    if (currentVRM.expressionManager && conversation.length) {
      const lastMsg = conversation[conversation.length - 1].content;
      if (lastMsg.includes('fun')) currentVRM.expressionManager.setValue('happy', 0.8);
      else if (lastMsg.includes('sad')) currentVRM.expressionManager.setValue('sorrow', 0.6);
      currentVRM.expressionManager.update();
    }
  }

  renderer.render(scene, camera);
}

// ===== FALLBACKS =====
function createFallbackAvatar() {
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
  ws.onopen = () => {
    log('WS connected');
    document.getElementById('wsStatus').textContent = 'WS ON';
  };
  ws.onclose = () => {
    log('WS closed, reconnecting...');
    document.getElementById('wsStatus').textContent = 'WS OFF';
    wsReconnectTimer = setTimeout(initWebSocket, 5000);
  };
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    document.getElementById('tps').textContent = data.tps || '❤️';
  };
}

function updatePrice() {
  fetch('/api/price')
    .then(res => res.json())
    .then(data => {
      document.getElementById('price').textContent = `SOL ${data.price}`;
    })
    .catch(err => log('Price update failed', err));
  priceUpdateTimer = setTimeout(updatePrice, 30000);
}

// ===== CHAT AND TTS =====
async function sendChat(message) {
  conversation.push({ role: 'user', content: message });
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...conversation] })
  });
  const data = await response.json();
  conversation.push({ role: 'assistant', content: data.response });
  
  const chatDiv = document.getElementById('chat');
  chatDiv.innerHTML += `<div>User: ${message}</div><div>Solmate: ${data.response}</div>`;
  chatDiv.scrollTop = chatDiv.scrollHeight;

  if (document.getElementById('mute').textContent !== '🔇') {
    await playTTS(data.response);
  }
}

async function playTTS(text) {
  const response = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  const audioBlob = await response.blob();
  const audioUrl = URL.createObjectURL(audioBlob);
  const audio = new Audio(audioUrl);
  audioQueue.push(audio);
  if (!isPlaying) playNextAudio();
}

function playNextAudio() {
  if (audioQueue.length === 0) {
    isPlaying = false;
    return;
  }
  isPlaying = true;
  const audio = audioQueue.shift();
  audio.play();
  audio.onended = playNextAudio;
}

// ===== UI EVENT LISTENERS =====
document.addEventListener('DOMContentLoaded', () => {
  initThreeEnhanced();
  initWebSocket();
  updatePrice();

  document.getElementById('send').addEventListener('click', () => {
    const input = document.getElementById('input');
    if (input.value.trim()) {
      sendChat(input.value);
      input.value = '';
    }
  });

  document.getElementById('mute').addEventListener('click', (e) => {
    e.target.textContent = e.target.textContent === '🔇' ? '🔊' : '🔇';
  });

  document.getElementById('themeToggle').addEventListener('click', () => {
    document.body.classList.toggle('light-theme'); // Assume CSS class for theme
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'd') {
      const logs = document.getElementById('overlayLogs');
      logs.style.display = logs.style.display === 'none' ? 'block' : 'none';
    }
  });
});

// Service Worker for PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(() => log('Service Worker registered')).catch(err => log('Service Worker registration failed', err));
}
