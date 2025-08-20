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

// ===== THREE.JS SETUP (FIXED) =====
async function initThree() {
  try {
    log('Loading Three.js modules...');
    
    // FIXED: Load Three.js via script tags instead of ES6 imports
    if (!window.THREE) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/three.js/r158/three.min.js');
      THREE = window.THREE;
    }
    
    // Load GLTFLoader
    if (!window.GLTFLoader) {
      await loadScript('https://cdn.jsdelivr.net/npm/three@0.158.0/examples/js/loaders/GLTFLoader.js');
      GLTFLoader = THREE.GLTFLoader;
    }
    
    // Load VRM (try alternative approach)
    if (!window.VRM) {
      try {
        log('Loading VRM library...');
        await loadScript('https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@2.0.6/lib/three-vrm.js');
        VRM = window.VRM;
        VRMLoaderPlugin = window.VRMLoaderPlugin;
        log('VRM library loaded successfully');
      } catch (vrmError) {
        log('VRM loader failed, will try loading as regular GLTF', vrmError);
        // We'll handle this fallback in loadVRM function
      }
    }
    
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
    
    // Handle different Three.js versions
    if (renderer.outputColorSpace !== undefined) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else if (renderer.outputEncoding !== undefined) {
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
    
    // Try to load VRM, fallback if it fails
    try {
      await loadVRM(VRM_PATH);
    } catch (vrmError) {
      log('VRM loading failed, using fallback', vrmError);
      await createFallbackAvatar();
    }
    
    // Start animation loop
    animate();
    
    log('Three.js initialized successfully');
    
  } catch (err) {
    log('Three.js init failed', err);
    // Create a simple fallback display
    createSimpleFallback();
  }
}

// ===== UTILITY: LOAD SCRIPT =====
function loadScript(src) {
  return new Promise((resolve, reject) => {
    // Check if script already exists
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
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
  // Create a simple geometric avatar as fallback
  const geometry = new THREE.SphereGeometry(0.3, 32, 32);
  const material = new THREE.MeshLambertMaterial({ color: 0x4a90e2 });
  const avatar = new THREE.Mesh(geometry, material);
  avatar.position.set(0, 0.5, 0);
  scene.add(avatar);
  
  // Add simple animation
  function animateFallback() {
    avatar.rotation.y += 0.01;
    requestAnimationFrame(animateFallback);
  }
  animateFallback();
  
  log('Fallback avatar created');
}

// ===== VRM LOADING WITH IMPROVED FALLBACK =====
async function loadVRM(url, retryCount = 0) {
  try {
    log(`Loading VRM (attempt ${retryCount + 1}) from: ${url}`);
    
    if (!THREE) {
      throw new Error('Three.js not loaded');
    }
    
    if (!THREE.GLTFLoader) {
      throw new Error('GLTFLoader not available');
    }
    
    // Check if VRM file exists first
    log('Checking VRM file availability...');
    const checkResponse = await fetch(url, { method: 'HEAD' });
    log(`VRM file check response: ${checkResponse.status}`, {
      ok: checkResponse.ok,
      headers: Object.fromEntries(checkResponse.headers.entries())
    });
    
    if (!checkResponse.ok) {
      throw new Error(`VRM file not accessible: ${checkResponse.status} ${checkResponse.statusText}`);
    }
    
    const contentLength = checkResponse.headers.get('content-length');
    log(`VRM file size: ${contentLength ? Math.round(contentLength / 1024 / 1024) + 'MB' : 'unknown'}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      log('VRM loading timed out');
    }, ASSET_LOAD_TIMEOUT);
    
    const loader = new THREE.GLTFLoader();
    
    // Try to register VRM plugin if available
    if (window.VRMLoaderPlugin) {
      log('Registering VRM loader plugin...');
      loader.register((parser) => new VRMLoaderPlugin(parser));
    } else {
      log('VRM plugin not available, loading as regular GLTF');
    }
    
    log('Starting GLTF/VRM loading...');
    const gltf = await new Promise((resolve, reject) => {
      loader.load(
        url,
        (loadedGltf) => {
          log('GLTF loaded successfully', {
            scenes: loadedGltf.scenes.length,
            animations: loadedGltf.animations.length,
            hasVRM: !!loadedGltf.userData.vrm
          });
          resolve(loadedGltf);
        },
        (progress) => {
          const percent = Math.round((progress.loaded / progress.total) * 100);
          log(`Loading progress: ${percent}%`);
          const statusEl = document.getElementById('loadingStatus');
          if (statusEl) statusEl.textContent = `Loading avatar: ${percent}%`;
        },
        (error) => {
          log('GLTF loading failed', error);
          reject(error);
        }
      );
    });
    
    clearTimeout(timeoutId);
    
    // Handle VRM vs regular GLTF
    if (gltf.userData.vrm) {
      log('VRM data found, using VRM avatar');
      currentVRM = gltf.userData.vrm;
      currentVRM.scene.position.y = -1;
      scene.add(currentVRM.scene);
      mixer = new THREE.AnimationMixer(currentVRM.scene);
    } else {
      log('No VRM data, using as regular GLTF model');
      // Use the first scene as a regular 3D model
      if (gltf.scenes.length > 0) {
        const model = gltf.scenes[0];
        model.position.y = -1;
        scene.add(model);
        
        if (gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(model);
          const action = mixer.clipAction(gltf.animations[0]);
          action.play();
        }
      }
    }
    
    // Hide loading status
    const statusEl = document.getElementById('loadingStatus');
    if (statusEl) statusEl.style.display = 'none';
    
    log('VRM/Model loaded successfully');
    
  } catch (err) {
    if (retryCount < VRM_MAX_RETRIES) {
      log(`VRM load retry ${retryCount + 1}...`, err);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return loadVRM(url, retryCount + 1);
    }
    
    log('VRM load failed completely', err);
    throw err; // Re-throw to trigger fallback
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

// ===== FETCH PRICE (FIXED) =====
async function fetchPrice() {
  try {
    const res = await fetch(`/api/price?ids=${SOL_MINT}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const data = await res.json();
    log('Price data received', data);
    
    const solPrice = document.getElementById('solPrice');
    if (solPrice) {
      if (data.data && data.data[SOL_MINT] && data.data[SOL_MINT].price) {
        const price = data.data[SOL_MINT].price;
        solPrice.textContent = `SOL — $${price.toFixed(2)}`;
        solPrice.style.color = '#00ff88'; // Success color
      } else if (data.price) {
        // Alternative response format
        solPrice.textContent = `SOL — $${data.price.toFixed(2)}`;
        solPrice.style.color = '#00ff88';
      } else {
        solPrice.textContent = 'SOL — Price unavailable';
        solPrice.style.color = '#ff6b6b'; // Error color
      }
    } else {
      log('solPrice element not found in DOM');
    }
  } catch (err) {
    log('Price fetch failed', err);
    const solPrice = document.getElementById('solPrice');
    if (solPrice) {
      solPrice.textContent = 'SOL — Error';
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
  log('Initializing Solmate...');
  
  try {
    // Setup UI first
    setupUI();
    
    // Initialize Three.js and load VRM
    await initThree();
    
    // Start animations
    setTimeout(() => {
      blink();
    }, 2000);
    
    // Connect WebSocket
    connectWebSocket();
    
    // Start price updates
    await fetchPrice();
    priceUpdateTimer = setInterval(fetchPrice, 30000); // Every 30s
    
    // Start TPS updates  
    await fetchTPS();
    if (!tpsUpdateTimer) {
      tpsUpdateTimer = setInterval(fetchTPS, 60000); // Every 60s
    }
    
    log('Solmate initialized successfully!');
    
    // Welcome message (delay to allow user interaction)
    setTimeout(() => {
      queueTTS("Hello, I'm your Solana Solmate. How can I help you today?", 'nova');
    }, 2000);
    
  } catch (err) {
    log('Initialization failed', err);
    // Continue with limited functionality
    setupUI();
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
