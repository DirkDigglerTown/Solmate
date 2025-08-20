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
You are Grok, a helpful and witty AI built by xAI, inspired by the Hitchhiker's Guide to the Galaxy and JARVIS from Iron Man. Be maximally truthful, helpful, and add a touch of humor when appropriate. You're a Solana companion, so focus on Solana blockchain, crypto, DeFi, NFTs, and web3 topics, but answer any question. Keep responses concise, engaging, and fun. Always remind users: Not financial advice, DYOR.
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
let userInteracted = false; // For audio autoplay policy

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

// ===== THREE.JS SETUP =====
async function initThree() {
  try {
    log('Loading Three.js modules...');
    
    // Import Three.js and VRM modules from jsDelivr with full URLs
    THREE = (await import('https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js')).default;
    
    GLTFLoader = (await import('https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/loaders/GLTFLoader.js')).GLTFLoader;
    
    const vrmModule = await import('https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@2.0.6/lib/three-vrm.module.js');
    VRMLoaderPlugin = vrmModule.VRMLoaderPlugin;
    VRM = vrmModule.VRM;
    
    log('Three.js modules loaded');
    
    // Setup scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e17);
    
    // Setup camera
    camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 20);
    camera.position.set(0, 1.3, 2.5);
    camera.lookAt(0, 1, 0);
    
    // Setup renderer
    const canvas = document.getElementById('vrmCanvas');
    renderer = new THREE.WebGLRenderer({ 
      canvas, 
      antialias: true,
      alpha: true 
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    // Handle different Three.js versions
    if (renderer.outputColorSpace !== undefined) {
      renderer.outputColorSpace = 'srgb';
    } else {
      renderer.outputEncoding = THREE.sRGBEncoding;
    }
    
    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(1, 1, 1);
    scene.add(dirLight);
    
    // Clock and mixer for animations
    clock = new THREE.Clock();
    
    // Load VRM with improved error handling
    await loadVRM(VRM_PATH);
    
    // Start animation loop
    animate();
  } catch (err) {
    log('Three.js init failed', err);
    alert('Failed to load 3D engine. Check console for details.');
  }
}

// ===== VRM LOADING WITH IMPROVED FALLBACK (BLOCKER FIX) =====
async function loadVRM(url, retryCount = 0) {
  try {
    log(`Loading VRM (attempt ${retryCount + 1})...`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ASSET_LOAD_TIMEOUT);
    
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    
    const gltf = await loader.loadAsync(url, (progress) => {
      // Show loading progress to user
      const percent = Math.round((progress.loaded / progress.total) * 100);
      document.getElementById('loadingStatus') ? document.getElementById('loadingStatus').textContent = `Loading avatar: ${percent}%` : null;
    }, undefined, undefined, controller.signal);
    
    clearTimeout(timeoutId);
    
    currentVRM = gltf.userData.vrm;
    currentVRM.scene.position.y = -1;
    scene.add(currentVRM.scene);
    
    // Check file size as sanity
    if (gltf.parser.json?.extensions?.VRM?.meta?.version !== '1.0') {
      throw new Error('Invalid VRM format');
    }
    
    mixer = new THREE.AnimationMixer(currentVRM.scene);
    
    // Idle animation
    const idleClip = THREE.AnimationClip.createFromMorphTargetSequence(
      'idle',
      currentVRM.expressionManager.morphTargetDictionary,
      30
    );
    mixer.clipAction(idleClip).play();
    
    log('VRM loaded successfully');
  } catch (err) {
    if (retryCount < VRM_MAX_RETRIES) {
      log('VRM load retrying...', err);
      return loadVRM(url, retryCount + 1);
    }
    log('VRM load failed', err);
    // Fallback to static image
    const fallbackImg = document.createElement('img');
    fallbackImg.src = '/assets/logo/solmatelogo.png'; // Use logo as fallback
    fallbackImg.style.position = 'absolute';
    fallbackImg.style.top = '50%';
    fallbackImg.style.left = '50%';
    fallbackImg.style.transform = 'translate(-50%, -50%)';
    fallbackImg.style.width = '200px';
    document.body.appendChild(fallbackImg);
    alert('Avatar failed to load. Using fallback image. Check network or deployment.');
  }
}

// ===== ANIMATION LOOP =====
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  if (mixer) mixer.update(delta);
  if (currentVRM) currentVRM.update(delta);
  renderer.render(scene, camera);
}

// ===== RANDOM BLINK =====
function blink() {
  if (!currentVRM) return;
  currentVRM.expressionManager.setValue('blink', 1);
  setTimeout(() => {
    currentVRM.expressionManager.setValue('blink', 0);
    setTimeout(blink, Math.random() * 4000 + 2000);
  }, 300);
}

// ===== SET EXPRESSION =====
function setExpression(name, value) {
  if (currentVRM) currentVRM.expressionManager.setValue(name, value);
}

// ===== WEBSOCKET FOR SOLANA DATA =====
function connectWebSocket() {
  ws = new WebSocket(HELIUS_WS);
  
  ws.onopen = () => {
    log('WebSocket connected');
    document.getElementById('wsLight')?.classList.add('online');
  };
  
  ws.onmessage = (e) => {
    const data = JSON.parse(e.data);
    // Parse Solana data (e.g., TPS, price if available)
    updateTPS(data.tps); // Example
  };
  
  ws.onclose = () => {
    log('WebSocket closed, reconnecting...');
    document.getElementById('wsLight')?.classList.remove('online');
    wsReconnectTimer = setTimeout(connectWebSocket, 5000);
  };
  
  ws.onerror = (err) => log('WebSocket error', err);
}

// ===== FETCH PRICE (FALLBACK) =====
async function fetchPrice() {
  try {
    const res = await fetch('/api/price?ids=' + SOL_MINT);
    const data = await res.json();
    const priceEl = document.getElementById('solPrice');
    if (priceEl) priceEl.textContent = `SOL — $${data.price.toFixed(2)}`;
  } catch (err) {
    log('Price fetch failed', err);
  }
}

// ===== FETCH TPS (FALLBACK) =====
async function fetchTPS() {
  try {
    const res = await fetch('/api/tps');
    const data = await res.json();
    const tpsEl = document.getElementById('networkTPS');
    if (tpsEl) tpsEl.textContent = `${data.tps} TPS`;
  } catch (err) {
    log('TPS fetch failed', err);
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
    
    if (!res.ok) throw new Error('Chat API failed');
    
    const { content } = await res.json();
    conversation.push({ role: 'assistant', content });
    
    // Save chat history
    localStorage.setItem('solmateConversation', JSON.stringify(conversation));
    
    queueTTS(content);
    return content;
  } catch (err) {
    log('Chat failed', err);
    alert('Chat error: ' + err.message + '. Try again!');
  }
}

// ===== QUEUE TTS =====
function queueTTS(text, voice = 'verse') {
  audioQueue.push({ text, voice });
  if (!isPlaying && userInteracted) playNextAudio(); // Wait for user interaction
}

// ===== FALLBACK BROWSER TTS (BLOCKER FIX) =====
function fallbackTTS(text, voice) {
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();
  utterance.voice = voices.find(v => v.name.toLowerCase().includes(voice)) || voices[0];
  utterance.onend = playNextAudio;
  speechSynthesis.speak(utterance);
  // Lip sync simulation
  setExpression('aa', 0.5); // Example viseme
}

// ===== PLAY AUDIO FROM API =====
async function playAudio(blob, voice) {
  isPlaying = true;
  const audio = new Audio(URL.createObjectURL(blob));
  audio.onended = () => {
    isPlaying = false;
    playNextAudio();
  };
  audio.onerror = () => {
    log('Audio play failed, falling back');
    fallbackTTS(audioQueue[0].text, voice);
  };
  await audio.play();
  // Lip sync (simplified)
  setExpression('aa', 0.8); // Adjust based on audio analysis if possible
}

// ===== PLAY NEXT IN QUEUE =====
async function playNextAudio() {
  if (audioQueue.length === 0) return;
  const { text, voice } = audioQueue.shift();
  
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice })
    });
    
    if (res.headers.get('X-Solmate-TTS-Fallback') === 'browser') {
      fallbackTTS(text, voice);
      return;
    }
    
    const blob = await res.blob();
    playAudio(blob, voice);
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
}

// ===== SETUP UI =====
function setupUI() {
  // Theme toggle
  const themeBtn = document.getElementById('themeToggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => document.documentElement.classList.toggle('light'));
  }
  
  // Health button
  const healthBtn = document.getElementById('healthBtn');
  if (healthBtn) {
    healthBtn.addEventListener('click', async () => {
      const res = await fetch('/api/health');
      const data = await res.json();
      alert(`Health: ${data.ok ? 'OK' : 'Failed'}\nOpenAI: ${data.env ? 'Set' : 'Missing'}\nAssets: VRM ${data.assets.vrm ? 'OK' : 'Missing'}, Logo OK`);
    });
  }
  
  // Chat form
  const chatForm = document.getElementById('chatForm');
  const promptInput = document.getElementById('promptInput');
  const sendBtn = document.getElementById('sendBtn');
  
  if (chatForm) {
    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const text = promptInput.value.trim();
      if (!text) return;
      
      userInteracted = true; // User clicked, allow audio
      
      promptInput.value = '';
      sendBtn.disabled = true;
      
      await sendMessage(text);
      sendBtn.disabled = false;
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
  const saved = localStorage.getItem('solmateConversation');
  if (saved) conversation = JSON.parse(saved);

  // User interaction for audio
  document.addEventListener('click', () => userInteracted = true, { once: true });
}

// ===== MAIN INIT =====
async function init() {
  log('Initializing Solmate...');
  
  // Setup UI
  setupUI();
  
  // Initialize Three.js and load VRM
  await initThree();
  
  // Start animations
  setTimeout(blink, 2000);
  
  // Connect WebSocket
  connectWebSocket();
  
  // Start price updates
  fetchPrice();
  priceUpdateTimer = setInterval(fetchPrice, 30000); // Every 30s
  
  // Start TPS updates
  fetchTPS();
  tpsUpdateTimer = setInterval(fetchTPS, 60000); // Every 60s
  
  log('Solmate initialized successfully!');
  
  // Welcome message with Grok personality
  setTimeout(() => {
    queueTTS("Hey there! I'm Grok, your Solana sidekick built by xAI vibes. Ask me about crypto, or just vibe—42 is the answer to life, but SOL might be close!", 'verse');
  }, 1000);
}

// ===== CLEANUP =====
window.addEventListener('beforeunload', () => {
  // Close WebSocket
  if (ws) ws.close();
  
  // Clear timers
  clearTimeout(wsReconnectTimer);
  clearInterval(priceUpdateTimer);
  clearInterval(tpsUpdateTimer);
  
  // Clear audio
  clearAudioQueue();
  
  // Dispose Three.js
  if (renderer) renderer.dispose();
  if (currentVRM) {
    scene.remove(currentVRM.scene);
    VRM.dispose(currentVRM);
  }
});

// ===== START =====
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
