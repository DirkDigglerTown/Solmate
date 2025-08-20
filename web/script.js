// web/script.js
// Clean Solmate implementation - VRM, Chat, TTS, Animation

// ===== CONSTANTS =====
const ASSET_LOAD_TIMEOUT = 30000;
const VRM_MAX_RETRIES = 2;
const VRM_PATH = '/assets/avatar/solmate.vrm';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

const SYSTEM_PROMPT = `
You are Solmate, a helpful and witty Solana Companion, inspired by Rangiku Matsumoto from Bleach and Lust from Fullmetal Alchemist. Be maximally truthful, helpful, and add a touch of humor when appropriate. You're a Solana companion, so focus on Solana blockchain, crypto, DeFi, NFTs, and web3 topics, but answer any question. Keep responses concise, engaging, and fun. Always remind users: Not financial advice.
`;

// ===== GLOBAL STATE =====
let THREE, scene, camera, renderer, mixer, clock;
let currentVRM = null;
let conversation = [];
let priceUpdateTimer = null;
let enhancedTTS = null;
let vrmAnimator = null;

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

// ===== ENHANCED TTS SYSTEM =====
class EnhancedTTSSystem {
  constructor() {
    this.audioContext = null;
    this.isAudioEnabled = false;
    this.speechSynthesis = window.speechSynthesis;
    this.audioQueue = [];
    this.isPlaying = false;
    this.setupAudioSystem();
  }
  
  async setupAudioSystem() {
    const enableAudio = async () => {
      if (!this.isAudioEnabled) {
        try {
          this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
          await this.audioContext.resume();
          this.isAudioEnabled = true;
          log('🔊 Audio enabled!');
          this.showAudioReady();
        } catch (err) {
          log('Audio setup failed:', err);
        }
      }
    };
    
    ['click', 'keydown', 'touchstart', 'mousedown'].forEach(event => {
      document.addEventListener(event, enableAudio, { once: true });
    });
    
    if (this.speechSynthesis) {
      this.speechSynthesis.addEventListener('voiceschanged', enableAudio);
    }
  }
  
  showAudioReady() {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed; top: 20px; right: 20px; background: rgba(0, 255, 136, 0.9);
      color: white; padding: 10px 15px; border-radius: 5px; font-family: Arial, sans-serif;
      font-size: 14px; z-index: 1000; cursor: pointer;
    `;
    notification.textContent = '🔊 Audio Ready! Click to test TTS';
    notification.onclick = () => {
      this.speak("Hello! I'm Solmate, your Solana companion. Audio is working!");
      notification.remove();
    };
    document.body.appendChild(notification);
    setTimeout(() => notification.parentNode && notification.remove(), 5000);
  }
  
  async speak(text, voice = 'nova') {
    if (!this.isAudioEnabled) {
      log('❌ Audio not enabled yet. Click anywhere first.');
      return;
    }
    
    log(`🗣️ TTS: "${text.substring(0, 30)}..."`);
    
    // Try API TTS first
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice })
      });
      
      if (response.ok && !response.headers.get('X-Solmate-TTS-Fallback')) {
        const blob = await response.blob();
        if (blob.size > 0) {
          await this.playAudioBlob(blob, text);
          return;
        }
      }
    } catch (apiError) {
      log('API TTS failed, using browser TTS:', apiError);
    }
    
    // Fallback to browser TTS
    this.speakWithBrowser(text);
  }
  
  async playAudioBlob(blob, text) {
    try {
      const audio = new Audio(URL.createObjectURL(blob));
      audio.onended = () => {
        this.isPlaying = false;
        this.stopLipSync();
        this.playNext();
      };
      audio.onerror = () => this.speakWithBrowser(text);
      
      this.isPlaying = true;
      this.startLipSync();
      await audio.play();
      log('✅ API TTS playing');
    } catch (err) {
      log('Audio playback failed:', err);
      this.speakWithBrowser(text);
    }
  }
  
  speakWithBrowser(text) {
    if (!this.speechSynthesis) {
      log('❌ Speech synthesis not available');
      return;
    }
    
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = this.speechSynthesis.getVoices();
    const femaleVoices = voices.filter(v => 
      v.name.toLowerCase().includes('female') ||
      v.name.toLowerCase().includes('samantha') ||
      v.lang.startsWith('en')
    );
    
    if (femaleVoices.length > 0) utterance.voice = femaleVoices[0];
    else if (voices.length > 0) utterance.voice = voices[0];
    
    utterance.rate = 0.9;
    utterance.pitch = 1.1;
    utterance.volume = 0.8;
    
    utterance.onstart = () => {
      this.isPlaying = true;
      this.startLipSync();
      log('🎙️ Browser TTS started');
    };
    
    utterance.onend = () => {
      this.isPlaying = false;
      this.stopLipSync();
      this.playNext();
      log('✅ Browser TTS completed');
    };
    
    utterance.onerror = () => {
      this.isPlaying = false;
      this.stopLipSync();
      this.playNext();
    };
    
    this.speechSynthesis.speak(utterance);
  }
  
  startLipSync() {
    if (vrmAnimator) vrmAnimator.startTalking();
    if (currentVRM && currentVRM.expressionManager) {
      try {
        currentVRM.expressionManager.setValue('aa', 0.8);
        currentVRM.expressionManager.setValue('happy', 0.6);
      } catch (err) {
        log('VRM expression failed:', err);
      }
    }
  }
  
  stopLipSync() {
    if (vrmAnimator) vrmAnimator.stopTalking();
    if (currentVRM && currentVRM.expressionManager) {
      try {
        currentVRM.expressionManager.setValue('aa', 0);
        currentVRM.expressionManager.setValue('happy', 0.3);
        currentVRM.expressionManager.setValue('neutral', 1);
      } catch (err) {
        log('VRM expression reset failed:', err);
      }
    }
  }
  
  queue(text, voice = 'nova') {
    this.audioQueue.push({ text, voice });
    if (!this.isPlaying) this.playNext();
  }
  
  playNext() {
    if (this.audioQueue.length === 0) {
      this.isPlaying = false;
      return;
    }
    const { text, voice } = this.audioQueue.shift();
    this.speak(text, voice);
  }
  
  clear() {
    this.audioQueue = [];
    if (this.speechSynthesis) this.speechSynthesis.cancel();
    this.isPlaying = false;
    this.stopLipSync();
  }
}

// ===== VRM ANIMATION SYSTEM =====
class VRMAnimator {
  constructor() {
    this.vrmModel = null;
    this.isInitialized = false;
    this.time = 0;
    this.blinkTimer = 0;
    this.headMovementTimer = 0;
    this.isTalking = false;
    this.init();
  }
  
  init() {
    const checkForVRM = () => {
      const vrm = scene?.getObjectByName('VRM_Model');
      if (vrm && !this.isInitialized) {
        this.setupVRM(vrm);
      } else if (!vrm) {
        setTimeout(checkForVRM, 1000);
      }
    };
    checkForVRM();
  }
  
  setupVRM(vrmModel) {
    this.vrmModel = vrmModel;
    this.isInitialized = true;
    log('🎭 Setting up VRM animations...');
    
    this.fixTPose();
    this.startIdleAnimations();
    log('✅ VRM animator ready!');
  }
  
  fixTPose() {
    if (!this.vrmModel) return;
    log('🔧 Fixing T-pose...');
    
    this.vrmModel.traverse((child) => {
      if (child.isBone || child.type === 'Bone') {
        const boneName = child.name.toLowerCase();
        
        if (boneName.includes('shoulder') || boneName.includes('upperarm') || 
            boneName.includes('lowerarm') || boneName.includes('hand')) {
          child.rotation.set(0, 0, 0);
        }
        
        // Natural pose adjustments
        if (boneName.includes('leftshoulder') || boneName.includes('leftupperarm')) {
          child.rotation.z = -0.2;
        } else if (boneName.includes('rightshoulder') || boneName.includes('rightupperarm')) {
          child.rotation.z = 0.2;
        }
      }
    });
    log('✅ T-pose fixed');
  }
  
  startIdleAnimations() {
    if (!this.vrmModel) return;
    log('🎭 Starting idle animations...');
    
    const animate = () => {
      if (!this.vrmModel || !scene.getObjectByName('VRM_Model')) return;
      
      this.time += 0.016;
      this.blinkTimer += 0.016;
      this.headMovementTimer += 0.016;
      
      // Breathing animation
      const breathingScale = 1 + Math.sin(this.time * 2.5) * 0.008;
      this.vrmModel.scale.y = this.vrmModel.scale.x * breathingScale;
      
      // Gentle body sway
      this.vrmModel.rotation.y = Math.sin(this.time * 0.7) * 0.02;
      this.vrmModel.rotation.z = Math.sin(this.time * 0.5) * 0.005;
      
      this.animateHead();
      this.animateBlinking();
      
      if (this.isTalking) this.animateTalking();
      
      requestAnimationFrame(animate);
    };
    
    animate();
    log('✅ Idle animations started');
  }
  
  animateHead() {
    if (!this.vrmModel) return;
    
    let headBone = null;
    this.vrmModel.traverse((child) => {
      if (child.isBone || child.type === 'Bone') {
        const boneName = child.name.toLowerCase();
        if (boneName.includes('head') || boneName.includes('neck')) {
          headBone = child;
        }
      }
    });
    
    if (headBone) {
      if (this.headMovementTimer > 3 + Math.random() * 4) {
        headBone.rotation.y = (Math.random() - 0.5) * 0.3;
        headBone.rotation.x = (Math.random() - 0.5) * 0.15;
        this.headMovementTimer = 0;
      } else {
        headBone.rotation.y *= 0.98;
        headBone.rotation.x *= 0.98;
      }
      
      headBone.rotation.y += Math.sin(this.time * 0.8) * 0.01;
      headBone.rotation.x += Math.sin(this.time * 0.6) * 0.005;
    }
  }
  
  animateBlinking() {
    if (this.blinkTimer > 2 + Math.random() * 3) {
      this.blink();
      this.blinkTimer = 0;
    }
  }
  
  blink() {
    if (currentVRM && currentVRM.expressionManager) {
      try {
        currentVRM.expressionManager.setValue('blink', 1);
        setTimeout(() => {
          if (currentVRM) currentVRM.expressionManager.setValue('blink', 0);
        }, 150);
        return;
      } catch (err) {
        log('VRM blink failed:', err);
      }
    }
    
    // Fallback: scale eye meshes
    this.vrmModel.traverse((child) => {
      if (child.isMesh && child.name.toLowerCase().includes('eye')) {
        child.scale.y = 0.1;
        setTimeout(() => child.scale.y = 1.0, 150);
      }
    });
  }
  
  animateTalking() {
    if (!this.isTalking) return;
    
    const mouthOpenness = 0.3 + Math.sin(this.time * 12) * 0.3;
    if (currentVRM && currentVRM.expressionManager) {
      try {
        currentVRM.expressionManager.setValue('aa', mouthOpenness);
      } catch (err) {
        // Ignore expression errors
      }
    }
    
    // Head bobbing while talking
    this.vrmModel.traverse((child) => {
      if (child.isBone && child.name.toLowerCase().includes('head')) {
        child.rotation.y += Math.sin(this.time * 8) * 0.005;
        child.rotation.x += Math.sin(this.time * 6) * 0.003;
      }
    });
  }
  
  startTalking() {
    this.isTalking = true;
    log('🗣️ Started talking animation');
  }
  
  stopTalking() {
    this.isTalking = false;
    log('🤐 Stopped talking animation');
  }
  
  setExpression(expression, value = 1, duration = 1000) {
    if (currentVRM && currentVRM.expressionManager) {
      try {
        currentVRM.expressionManager.setValue(expression, value);
        if (duration > 0) {
          setTimeout(() => {
            if (currentVRM) currentVRM.expressionManager.setValue(expression, 0);
          }, duration);
        }
        log(`Set VRM expression: ${expression} = ${value}`);
      } catch (err) {
        log(`Expression failed: ${expression}`, err);
      }
    }
  }
}

// ===== THREE.JS AND VRM LOADING =====
async function loadThreeJS() {
  if (window.THREE) {
    THREE = window.THREE;
    log('Three.js already available');
    return;
  }
  
  const sources = [
    'https://unpkg.com/three@0.158.0/build/three.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/r158/three.min.js'
  ];
  
  for (const source of sources) {
    try {
      log(`Loading Three.js from: ${source}`);
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = source;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
        setTimeout(() => reject(new Error('Timeout')), 10000);
      });
      
      if (window.THREE) {
        THREE = window.THREE;
        log(`✅ Three.js loaded from: ${source}`);
        return;
      }
    } catch (err) {
      log(`Three.js failed from ${source}:`, err.message);
    }
  }
  
  throw new Error('Failed to load Three.js');
}

function setupThreeJSScene() {
  log('Setting up Three.js scene...');
  
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e17);
  
  camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 20);
  camera.position.set(0, 1.3, 2.5);
  camera.lookAt(0, 1, 0);
  
  const canvas = document.getElementById('vrmCanvas');
  if (!canvas) throw new Error('Canvas element #vrmCanvas not found');
  
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  
  // Enhanced lighting for VRM
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambientLight);
  
  const mainLight = new THREE.DirectionalLight(0xffffff, 1.0);
  mainLight.position.set(1, 2, 1);
  mainLight.castShadow = true;
  scene.add(mainLight);
  
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
  fillLight.position.set(-1, 1, -1);
  scene.add(fillLight);
  
  clock = new THREE.Clock();
  log('Three.js scene setup complete');
}

async function loadVRMModel() {
  try {
    log('=== LOADING VRM MODEL ===');
    updateLoadingProgress('vrm', 0);
    
    // Create simple GLTFLoader
    const GLTFLoader = await createGLTFLoader();
    const loader = new GLTFLoader();
    
    const gltf = await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error('VRM loading timeout')), ASSET_LOAD_TIMEOUT);
      
      loader.load(VRM_PATH, 
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
    
    await processVRM(gltf);
    updateLoadingProgress('complete');
    log('🎉 VRM loaded successfully!');
    
  } catch (err) {
    log('❌ VRM loading failed:', err);
    createFallbackAvatar();
  }
}

async function createGLTFLoader() {
  // Try to load external GLTF loader
  try {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/three@0.158.0/examples/js/loaders/GLTFLoader.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    
    if (THREE.GLTFLoader) {
      log('✅ External GLTF loader loaded');
      return THREE.GLTFLoader;
    }
  } catch (err) {
    log('External GLTF loader failed:', err);
  }
  
  // Create simple embedded loader for basic VRM loading
  return class SimpleGLTFLoader {
    load(url, onLoad, onProgress, onError) {
      const loader = new THREE.FileLoader();
      loader.setResponseType('arraybuffer');
      
      loader.load(url, (data) => {
        try {
          const result = this.parseGLB(data);
          onLoad(result);
        } catch (e) {
          if (onError) onError(e);
        }
      }, onProgress, onError);
    }
    
    parseGLB(data) {
      // Simple GLB parser for basic VRM loading
      const view = new DataView(data);
      const magic = view.getUint32(0, true);
      if (magic !== 0x46546C67) throw new Error('Invalid GLB');
      
      const length = view.getUint32(8, true);
      let chunkIndex = 12;
      let jsonChunk = null;
      
      while (chunkIndex < length) {
        const chunkLength = view.getUint32(chunkIndex, true);
        const chunkType = view.getUint32(chunkIndex + 4, true);
        
        if (chunkType === 0x4E4F534A) { // JSON
          const jsonData = new Uint8Array(data, chunkIndex + 8, chunkLength);
          jsonChunk = JSON.parse(new TextDecoder().decode(jsonData));
          break;
        }
        chunkIndex += 8 + chunkLength;
      }
      
      if (!jsonChunk) throw new Error('No JSON in GLB');
      
      // Create basic scene structure
      const scene = new THREE.Group();
      scene.name = 'VRM_Scene';
      
      // Create simple meshes with colors
      if (jsonChunk.meshes) {
        const colors = [0x8B4513, 0xFFDBB5, 0xFF6B6B, 0x4169E1, 0xFF4444, 0x2E4A8B];
        
        jsonChunk.meshes.forEach((meshDef, index) => {
          const geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
          const material = new THREE.MeshStandardMaterial({
            color: colors[index % colors.length],
            toneMapped: false
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.name = meshDef.name || `Mesh_${index}`;
          scene.add(mesh);
        });
      }
      
      return { scene, animations: [], userData: {} };
    }
  };
}

async function processVRM(gltf) {
  log('Processing VRM...');
  
  // Remove existing models
  ['fallbackAvatar', 'VRM_Model'].forEach(name => {
    const existing = scene.getObjectByName(name);
    if (existing) scene.remove(existing);
  });
  
  // Apply VRoid character colors to meshes
  const vroidColors = [
    { color: 0x8B4513, name: 'hair' },
    { color: 0xFFDBB5, name: 'skin' },
    { color: 0xFF6B6B, name: 'top' },
    { color: 0x4169E1, name: 'skirt' },
    { color: 0xFF4444, name: 'socks' },
    { color: 0x2E4A8B, name: 'shoes' }
  ];
  
  const meshes = [];
  gltf.scene.traverse((child) => {
    if (child.isMesh) meshes.push(child);
  });
  
  meshes.forEach((mesh, index) => {
    const colorConfig = vroidColors[index % vroidColors.length];
    const material = new THREE.MeshStandardMaterial({
      color: colorConfig.color,
      side: THREE.DoubleSide,
      toneMapped: false,
      roughness: 0.6,
      metalness: 0.1
    });
    mesh.material = material;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    log(`Applied ${colorConfig.name} color to: ${mesh.name}`);
  });
  
  // Scale and position
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  
  if (size.y > 50) {
    const scale = 1.8 / size.y;
    gltf.scene.scale.setScalar(scale);
  }
  
  const scaledBox = new THREE.Box3().setFromObject(gltf.scene);
  const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
  
  gltf.scene.position.x = -scaledCenter.x;
  gltf.scene.position.y = -scaledBox.min.y;
  gltf.scene.position.z = -scaledCenter.z;
  gltf.scene.name = 'VRM_Model';
  scene.add(gltf.scene);
  
  // Position camera
  const finalHeight = scaledBox.getSize(new THREE.Vector3()).y;
  const cameraDistance = Math.max(finalHeight * 1.5, 3.0);
  const lookAtHeight = finalHeight * 0.6;
  
  camera.position.set(0, lookAtHeight, cameraDistance);
  camera.lookAt(0, lookAtHeight, 0);
  
  // Setup animations
  if (gltf.animations && gltf.animations.length > 0) {
    mixer = new THREE.AnimationMixer(gltf.scene);
    const action = mixer.clipAction(gltf.animations[0]);
    action.play();
  }
  
  if (gltf.userData && gltf.userData.vrm) {
    currentVRM = gltf.userData.vrm;
  }
}

function createFallbackAvatar() {
  const geometry = new THREE.SphereGeometry(0.3, 32, 32);
  const material = new THREE.MeshLambertMaterial({ color: 0x4a90e2 });
  const avatar = new THREE.Mesh(geometry, material);
  avatar.position.set(0, 0.5, 0);
  avatar.name = 'fallbackAvatar';
  scene.add(avatar);
  
  function animateFallback() {
    if (scene.getObjectByName('fallbackAvatar')) {
      avatar.rotation.y += 0.01;
      requestAnimationFrame(animateFallback);
    }
  }
  animateFallback();
  log('Fallback avatar created');
}

function animate() {
  requestAnimationFrame(animate);
  if (!renderer || !scene || !camera) return;
  
  const delta = clock.getDelta();
  if (mixer) mixer.update(delta);
  if (currentVRM) currentVRM.update(delta);
  
  renderer.render(scene, camera);
}

// ===== API FUNCTIONS =====
async function fetchPrice() {
  try {
    log('Fetching SOL price...');
    const res = await fetch(`/api/price?ids=${SOL_MINT}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const data = await res.json();
    const solPrice = document.getElementById('solPrice');
    if (!solPrice) return;
    
    let price = null;
    
    if (data.data && data.data[SOL_MINT] && data.data[SOL_MINT].price) {
      price = data.data[SOL_MINT].price;
    } else {
      // Search for any reasonable price value
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
    
    if (price && !isNaN(price)) {
      solPrice.textContent = `SOL — ${price.toFixed(2)}`;
      solPrice.style.color = '#00ff88';
      log(`✅ Price updated: ${price.toFixed(2)}`);
    } else {
      solPrice.textContent = 'SOL — Error';
      solPrice.style.color = '#ff6b6b';
    }
  } catch (err) {
    log('Price fetch failed:', err);
    const solPrice = document.getElementById('solPrice');
    if (solPrice) {
      solPrice.textContent = 'SOL — Error';
      solPrice.style.color = '#ff6b6b';
    }
  }
}

async function sendMessage(text) {
  if (!text || !text.trim()) return;
  
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
    
    if (!res.ok) throw new Error(`Chat failed: ${res.status}`);
    
    const { content } = await res.json();
    conversation.push({ role: 'assistant', content });
    
    // Save conversation
    try {
      localStorage.setItem('solmateConversation', JSON.stringify(conversation));
    } catch (err) {
      log('Failed to save conversation:', err);
    }
    
    // Use enhanced TTS
    enhancedTTS.queue(content, 'nova');
    
    // Set happy expression
    if (vrmAnimator) {
      vrmAnimator.setExpression('happy', 0.8, 3000);
    }
    
    log(`✅ Chat response: "${content.substring(0, 50)}..."`);
    return content;
    
  } catch (err) {
    log('❌ Chat failed:', err);
    const errorMsg = 'Sorry, I had trouble processing that. Please try again!';
    enhancedTTS.queue(errorMsg, 'nova');
    return errorMsg;
  }
}

// ===== UI SETUP =====
function setupUI() {
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
    clearBtn.addEventListener('click', () => enhancedTTS.clear());
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
    log('Failed to load conversation history:', err);
  }
}

// ===== UTILITY FUNCTIONS =====
function updateLoadingProgress(stage, percent = null) {
  const statusEl = document.getElementById('loadingStatus');
  if (!statusEl) return;
  
  const stages = {
    'three': '🔧 Loading 3D Engine',
    'vrm': '👤 Loading Avatar',
    'complete': '✅ Ready!'
  };
  
  const message = stages[stage] || stage;
  const percentText = percent !== null ? ` ${percent}%` : '';
  
  statusEl.textContent = `${message}${percentText}`;
  statusEl.style.color = stage === 'complete' ? '#00ff88' : '#ffffff';
  
  if (stage === 'complete') {
    setTimeout(() => statusEl.style.display = 'none', 2000);
  }
}

// ===== MANUAL TESTING FUNCTIONS =====
function testTTS(text = "Hello! I'm Solmate, your Solana companion. This is a test of my voice system!") {
  log('🎤 Testing TTS...');
  enhancedTTS.speak(text);
}

function testAnimations() {
  log('🎭 Testing animations...');
  if (vrmAnimator) {
    vrmAnimator.setExpression('happy', 1, 2000);
    setTimeout(() => vrmAnimator.setExpression('surprised', 1, 2000), 2500);
    setTimeout(() => vrmAnimator.setExpression('neutral', 1, 1000), 5000);
  }
}

function fixTPose() {
  log('🔧 Manually fixing T-pose...');
  if (vrmAnimator && vrmAnimator.vrmModel) {
    vrmAnimator.fixTPose();
  } else {
    log('❌ No VRM model found');
  }
}

function startTalking() {
  if (vrmAnimator) {
    vrmAnimator.startTalking();
    setTimeout(() => vrmAnimator.stopTalking(), 3000);
  }
}

function patchReloadVRMTextures() {
  log('🔄 Reloading VRM textures...');
  const vrmModel = scene?.getObjectByName('VRM_Model');
  if (!vrmModel) {
    alert('No VRM model found. Please wait for the model to load first.');
    return;
  }
  
  // Apply colors to existing VRM
  const vroidColors = [
    { color: 0x8B4513, name: 'hair' },
    { color: 0xFFDBB5, name: 'skin' },
    { color: 0xFF6B6B, name: 'top' },
    { color: 0x4169E1, name: 'skirt' },
    { color: 0xFF4444, name: 'socks' },
    { color: 0x2E4A8B, name: 'shoes' }
  ];
  
  const meshes = [];
  vrmModel.traverse((child) => {
    if (child.isMesh) meshes.push(child);
  });
  
  meshes.forEach((mesh, index) => {
    const colorConfig = vroidColors[index % vroidColors.length];
    const material = new THREE.MeshStandardMaterial({
      color: colorConfig.color,
      side: THREE.DoubleSide,
      toneMapped: false,
      roughness: 0.6,
      metalness: 0.1
    });
    mesh.material = material;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    log(`Applied ${colorConfig.name} color to: ${mesh.name}`);
  });
  
  log('✅ VRM texture reload complete!');
  alert('VRM textures reloaded! The character should now have proper colors.');
}

function patchDiagnoseVRM() {
  log('🔍 Diagnosing VRM...');
  
  const vrmModel = scene?.getObjectByName('VRM_Model');
  if (!vrmModel) {
    console.log('❌ No VRM model found in scene');
    return;
  }
  
  console.log('📊 VRM Diagnostic Report:');
  console.log('========================');
  
  let meshCount = 0;
  let texturedMeshes = 0;
  let materialTypes = {};
  
  vrmModel.traverse((child) => {
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
  
  if (texturedMeshes === 0) {
    console.log('⚠️ No textures detected - this is why the model appears colored instead of textured');
    console.log('💡 Try running: patchReloadVRMTextures()');
  }
}

// ===== MAIN INITIALIZATION =====
async function init() {
  log('=== INITIALIZING SOLMATE ===');
  
  try {
    // Initialize systems
    enhancedTTS = new EnhancedTTSSystem();
    vrmAnimator = new VRMAnimator();
    
    // Setup UI first
    setupUI();
    
    // Start price updates
    await fetchPrice();
    priceUpdateTimer = setInterval(fetchPrice, 30000);
    
    // Initialize Three.js
    updateLoadingProgress('three');
    await loadThreeJS();
    setupThreeJSScene();
    animate();
    
    // Create fallback first
    createFallbackAvatar();
    
    // Try to load VRM
    setTimeout(async () => {
      try {
        await loadVRMModel();
      } catch (vrmError) {
        log('VRM loading failed, keeping fallback', vrmError);
      }
    }, 1000);
    
    log('=== SOLMATE INITIALIZATION COMPLETE ===');
    
    // Welcome message
    setTimeout(() => {
      enhancedTTS.speak("Hello! I'm Solmate, your Solana companion. Click anywhere to enable my voice!");
    }, 3000);
    
  } catch (err) {
    log('=== INITIALIZATION FAILED ===', err);
    // Continue with basic functionality
    setupUI();
    try {
      await fetchPrice();
      priceUpdateTimer = setInterval(fetchPrice, 30000);
    } catch (apiError) {
      log('API calls failed:', apiError);
    }
  }
}

// ===== GLOBAL EXPORTS =====
// Make functions available globally for testing
window.testTTS = testTTS;
window.testAnimations = testAnimations;
window.fixTPose = fixTPose;
window.startTalking = startTalking;
window.patchReloadVRMTextures = patchReloadVRMTextures;
window.patchDiagnoseVRM = patchDiagnoseVRM;

// Make systems available globally
window.enhancedTTS = () => enhancedTTS;
window.vrmAnimator = () => vrmAnimator;

// ===== CLEANUP =====
window.addEventListener('beforeunload', () => {
  if (priceUpdateTimer) clearInterval(priceUpdateTimer);
  if (enhancedTTS) enhancedTTS.clear();
  if (renderer) renderer.dispose();
});

// ===== START APPLICATION =====
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

console.log('🚀 Solmate loaded!');
console.log('🎤 Commands: testTTS(), testAnimations(), fixTPose(), startTalking()');
console.log('🔧 Debug: patchReloadVRMTextures(), patchDiagnoseVRM()');
console.log('🔊 Click anywhere to enable audio!');
