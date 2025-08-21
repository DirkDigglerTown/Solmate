// web/script.js
// Complete production-ready implementation with proper VRM loading using @pixiv/three-vrm, optimized for Vercel

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.167.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.167.0/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from 'https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.0.0/dist/three-vrm.module.js';

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

// ===== THREE.JS SETUP WITH PROPER VRM SUPPORT =====
async function initThreeEnhanced() {
  try {
    log('=== THREE.JS INITIALIZATION WITH VRM SUPPORT ===');
    
    setupThreeJSScene();
    animate();
    await createFallbackAvatar(); // Immediate fallback
    await loadVRMWithPlugin(VRM_PATH);
    setupVRMAnimationsAndExpressions();
    checkForTextures(); // Auto-check for gray model
    
    log('=== THREE.JS INITIALIZATION COMPLETE ===');
    
  } catch (err) {
    log('=== INITIALIZATION FAILED ===', err);
    createSimpleFallback();
    throw err;
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

// ===== LOAD VRM WITH PLUGIN (Updated with Retries) =====
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
      throw error;
    }
  }
}

// ===== SETUP ANIMATIONS AND EXPRESSIONS =====
function setupVRMAnimationsAndExpressions() {
  if (!currentVRM) return;

  mixer = new THREE.AnimationMixer(currentVRM.scene);

  // Procedural idle for production (expand with loaded animations if available)
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

// ===== FALLBACKS (Expanded) =====
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

// ===== DIAGNOSTIC (Added from Attached) =====
window.diagnoseVRM = function() {
  log('🔍 Diagnosing VRM rendering...');
  
  if (!currentVRM) {
    console.log('❌ No VRM model found in scene');
    return;
  }
  
  console.log('📊 VRM Diagnostic Report:');
  console.log('========================');
  
  let meshCount = 0;
  let texturedMeshes = 0;
  let materialTypes = {};
  
  currentVRM.scene.traverse((child) => {
    if (child.isMesh) {
      meshCount++;
      
      const material = Array.isArray(child.material) ? child.material[0] : child.material;
      const materialType = material.constructor.name;
      materialTypes[materialType] = (materialTypes[materialType] || 0) + 1;
      
      console.log(`Mesh: ${child.name}`);
      console.log(`  Material: ${materialType}`);
      console.log(`  Has Texture: ${!!(material.map && material.map.image)}`);
      console.log(`  Color: #${material.color.getHexString()}`);
      console.log(`  ToneMapped: ${material.toneMapped}`);
      console.log(`  Side: ${material.side}`);
      
      if (material.map && material.map.image) {
        texturedMeshes++;
        console.log(`  Texture Size: ${material.map.image.width}x${material.map.image.height}`);
      }
      console.log('---');
    }
  });
  
  console.log(`📈 Summary:`);
  console.log(`  Total Meshes: ${meshCount}`);
  console.log(`  Textured Meshes: ${texturedMeshes}`);
  console.log(`  Material Types:`, materialTypes);
  console.log(`  Renderer ColorSpace: ${renderer.outputColorSpace}`);
  console.log(`  Renderer ToneMapping: ${renderer.toneMapping}`);
  
  if (texturedMeshes === 0) {
    console.log('⚠️ No textures detected - this is likely why the model appears gray');
  }
};

// ===== AUTO TEXTURE CHECK (Inspired by Attached Auto-Reload) =====
function checkForTextures() {
  setTimeout(() => {
    if (currentVRM) {
      let hasTextures = false;
      currentVRM.scene.traverse((child) => {
        if (child.isMesh && child.material && child.material.map && child.material.map.image) {
          hasTextures = true;
        }
      });
      
      if (!hasTextures) {
        log('🔄 No textures detected; model may appear gray. Consider diagnostics.');
      }
    }
  }, 5000);
}

// ===== WEBSOCKET AND API HANDLERS =====
function initWebSocket() {
  ws = new WebSocket(HELIUS_WS);
  ws.onopen = () => log('WS connected');
  ws.onclose = () => {
    log('WS closed, reconnecting...');
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

  if (!document.getElementById('mute').textContent.includes('🔇')) {
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
    sendChat(input.value);
    input.value = '';
  });

  document.getElementById('mute').addEventListener('click', (e) => {
    e.target.textContent = e.target.textContent === '🔇' ? '🔊' : '🔇';
  });

  document.getElementById('themeToggle').addEventListener('click', () => {
    document.body.classList.toggle('light-theme'); // Assume CSS class
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'd') {
      document.getElementById('overlayLogs').style.display = document.getElementById('overlayLogs').style.display === 'none' ? 'block' : 'none';
    }
  });
});

// Service Worker for PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
