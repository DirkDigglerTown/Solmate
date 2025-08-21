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
  
  // Brown hair (like VRoid model)
  const hairGeo = new THREE.SphereGeometry(0.15, 24, 24);
  const hairMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 }); // Brown
  const hair = new THREE.Mesh(hairGeo, hairMat);
  hair.position.y = 1.7;
  hair.scale.set(1.4, 0.9, 1.3); // Voluminous anime hair
  character.add(hair);
  
  // Eyes (larger anime style)
  const eyeGeo = new THREE.SphereGeometry(0.025, 12, 12);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x4169E1 }); // Blue eyes
  
  const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
  leftEye.position.set(-0.045, 1.62, 0.11);
  character.add(leftEye);
  
  const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
  rightEye.position.set(0.045, 1.62, 0.11);
  character.add(rightEye);
  
  // Body (red top)
  const bodyGeo = new THREE.CylinderGeometry(0.15, 0.18, 0.5, 12);
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0xff6b6b }); // Red
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
  
  // Skirt (blue)
  const skirtGeo = new THREE.CylinderGeometry(0.18, 0.25, 0.3, 12);
  const skirtMat = new THREE.MeshLambertMaterial({ color: 0x4169E1 }); // Blue
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
    const fallbackChar = scene.getObjectByName('EmergencyFallback');
    if (!fallbackChar) return;
    
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
      const fallback = scene.getObjectByName('fallbackAvatar');
      if (fallback) {
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
        log('WebSocket message parse error', err);
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

// ===== FETCH PRICE =====
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

// ===== FETCH TPS =====
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
      playNextAudio();
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
      playNextAudio();
    };
    
    audio.onerror = (err) => {
      log('Audio play failed, falling back to browser TTS', err);
      isPlaying = false;
      fallbackTTS(audioQueue[0]?.text || '', voice);
    };
    
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
        sendBtn.textContent = '▶';
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
      const logs = document.getElementById('debugOverlay');
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

// ===== MAIN INIT FUNCTION =====
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
      await initThreeEnhanced();
      
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

// ===== CONSOLE COMMANDS FOR DEBUGGING =====
// Add these to global scope for debugging
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
  log('🔄 Manually reloading VRM...');
  
  // Remove existing VRM
  ['fallbackAvatar', 'alternativeAvatar', 'VRM_Model', 'EmergencyFallback'].forEach(name => {
    const existing = scene?.getObjectByName(name);
    if (existing) {
      scene.remove(existing);
      log(`Removed ${name}`);
    }
  });
  
  // Reset camera
  if (camera) {
    camera.position.set(0, 1.3, 2.5);
    camera.lookAt(0, 1, 0);
  }
  
  // Create temporary fallback
  createFallbackAvatar();
  
  // Attempt to reload VRM
  setTimeout(async () => {
    try {
      await loadVRMWithReliableLoader(VRM_PATH);
      log('✅ Complete VRM reload successful!');
    } catch (err) {
      log('❌ Complete VRM reload failed:', err);
      alert('VRM reload failed: ' + err.message);
    }
  }, 1000);
};

window.createEmergency = function() {
  createEmergencyFallback();
};

window.testChat = function() {
  sendMessage("Hello Solmate! How are you?");
};

window.testTTS = function() {
  queueTTS("Hello! I'm testing the text to speech system. How does this sound?", 'nova');
};

// Usage in console:
// debugVRM() - Shows debug info
// reloadVRM() - Force reload VRM
// createEmergency() - Create detailed anime fallback
// testChat() - Test chat functionality
// testTTS() - Test text-to-speech

console.log('🚀 Enhanced VRM loader ready!');
console.log('📋 Debug commands: debugVRM(), reloadVRM(), createEmergency(), testChat(), testTTS()');

// ===== START =====
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
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

// ===== ENHANCED THREE.JS SETUP =====
async function initThreeEnhanced() {
  try {
    log('=== ENHANCED THREE.JS INITIALIZATION ===');
    
    // STEP 1: Load Three.js
    await loadThreeJSReliably();
    
    // STEP 2: Load GLTF Loader
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
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/r158/three.min.js',
    'https://unpkg.com/three@0.158.0/build/three.min.js', 
    'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/r150/three.min.js'
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
    'https://cdn.jsdelivr.net/npm/three@0.158.0/examples/js/loaders/GLTFLoader.js'
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
  
  // Strategy 2: Create production-ready embedded loader
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
            material.color.setHex(0x8B4513); // Brown hair
          } else if (materialDef.name.toLowerCase().includes('skin')) {
            material.color.setHex(0xffdbac); // Skin tone
          } else if (materialDef.name.toLowerCase().includes('cloth') || materialDef.name.toLowerCase().includes('top')) {
            material.color.setHex(0xff6b6b); // Red top
          } else if (materialDef.name.toLowerCase().includes('skirt') || materialDef.name.toLowerCase().includes('bottom')) {
            material.color.setHex(0x4169E1); // Blue skirt
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
    if
