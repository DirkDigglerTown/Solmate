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
    
    // STEP 3: Load GLTFLoader for VRM support
    if (!THREE.GLTFLoader) {
      log('Loading GLTF Loader for VRM support...');
      const gltfSources = [
        'https://unpkg.com/three@0.158.0/examples/js/loaders/GLTFLoader.js',
        'https://cdn.jsdelivr.net/npm/three@0.158.0/examples/js/loaders/GLTFLoader.js',
        'https://threejs.org/examples/js/loaders/GLTFLoader.js'
      ];
      
      let gltfLoaded = false;
      for (const source of gltfSources) {
        try {
          log(`Trying GLTF loader from: ${source}`);
          await loadScript(source);
          if (THREE.GLTFLoader) {
            log('GLTF Loader loaded successfully from:', source);
            gltfLoaded = true;
            break;
          }
        } catch (gltfError) {
          log(`GLTF loader failed from ${source}:`, gltfError);
        }
      }
      
      if (!gltfLoaded) {
        log('GLTF loader failed from all sources, VRM loading will be disabled');
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
    if (THREE.GLTFLoader) {
      setTimeout(async () => {
        try {
          log('=== ATTEMPTING VRM LOAD ===');
          await loadVRMFile(VRM_PATH);
        } catch (vrmError) {
          log('VRM loading failed, keeping fallback avatar', vrmError);
        }
      }, 2000);
    } else {
      log('Skipping VRM load - GLTF loader not available');
    }
    
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

// ===== LOAD VRM FILE (SIMPLIFIED VERSION) =====
async function loadVRMFile(url, retryCount = 0) {
  try {
    log(`=== LOADING VRM FILE (attempt ${retryCount + 1}) ===`);
    log('VRM URL:', url);
    
    if (!THREE.GLTFLoader) {
      throw new Error('GLTFLoader not available');
    }
    
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
    
    // Load as regular GLTF first (simpler than VRM)
    log('Loading VRM file as GLTF...');
    const loader = new THREE.GLTFLoader();
    
    const gltf = await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('VRM loading timeout'));
      }, ASSET_LOAD_TIMEOUT);
      
      loader.load(
        url,
        (loadedGltf) => {
          clearTimeout(timeoutId);
          log('GLTF loaded successfully');
          log('GLTF info:', {
            scenes: loadedGltf.scenes.length,
            animations: loadedGltf.animations.length,
            cameras: loadedGltf.cameras.length,
            userData: Object.keys(loadedGltf.userData || {})
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
          log('GLTF loading error:', error);
          reject(error);
        }
      );
    });
    
    // Remove the fallback sphere
    const fallbackAvatar = scene.getObjectByName('fallbackAvatar');
    if (fallbackAvatar) {
      log('Removing fallback avatar');
      scene.remove(fallbackAvatar);
    }
    
    // Add the loaded model to the scene
    if (gltf.scene) {
      log('Adding GLTF scene to Three.js scene');
      gltf.scene.position.y = -1; // Adjust position
      gltf.scene.name = 'vrmModel';
      scene.add(gltf.scene);
      
      // Setup animations if available
      if (gltf.animations.length > 0) {
        log(`Setting up ${gltf.animations.length} animations`);
        mixer = new THREE.AnimationMixer(gltf.scene);
        const action = mixer.clipAction(gltf.animations[0]);
        action.play();
      }
      
      log('✅ VRM model loaded and added to scene successfully');
      
      // Hide loading status
      const statusEl = document.getElementById('loadingStatus');
      if (statusEl) statusEl.style.display = 'none';
      
    } else {
      throw new Error('No scene found in GLTF file');
    }
    
  } catch (err) {
    if (retryCount < VRM_MAX_RETRIES) {
      log(`VRM load retry ${retryCount + 1} in 3 seconds...`, err);
      setTimeout(() => loadVRMFile(url, retryCount + 1), 3000);
    } else {
      log('❌ VRM loading failed completely', err);
      throw err;
    }
  }
}');
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
        model.name = 'gltfModel';
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
      // Handle multiple possible response formats
      let price = null;
      
      if (data.data && data.data[SOL_MINT] && typeof data.data[SOL_MINT].price === 'number') {
        price = data.data[SOL_MINT].price;
      } else if (data.price && typeof data.price === 'number') {
        price = data.price;
      } else if (data[SOL_MINT] && typeof data[SOL_MINT] === 'number') {
        price = data[SOL_MINT];
      } else if (typeof data === 'number') {
        price = data;
      }
      
      if (price !== null && !isNaN(price)) {
        solPrice.textContent = `SOL — ${price.toFixed(2)}`;
        solPrice.style.color = '#00ff88'; // Success color
        log(`Price updated: ${price.toFixed(2)}`);
      } else {
        solPrice.textContent = 'SOL — Data format error';
        solPrice.style.color = '#ff6b6b'; // Error color
        log('Price data format not recognized', data);
      }
    } else {
      log('solPrice element not found in DOM');
    }
  } catch (err) {
    log('Price fetch failed', err);
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
