// Enhanced VRM Companion System - Replace your current script.js with this
// Provides Grok-like companion experience with full VRM support

// ===== IMPORTS AND DEPENDENCIES =====
// Add these to your HTML head BEFORE script.js:
/*
<script src="https://unpkg.com/three@0.158.0/build/three.min.js"></script>
<script src="https://unpkg.com/three@0.158.0/examples/js/loaders/GLTFLoader.js"></script>
<script src="https://unpkg.com/@pixiv/three-vrm@2.0.6/lib/three-vrm.min.js"></script>
*/

// ===== CONSTANTS =====
const VRM_PATH = '/assets/avatar/solmate.vrm';
const ASSET_LOAD_TIMEOUT = 30000;
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Enhanced system prompt for Grok-like personality
const SYSTEM_PROMPT = `
You are Solmate, a charismatic and witty Solana AI companion with the personality of Rangiku Matsumoto from Bleach. You're knowledgeable about Solana, DeFi, crypto, and web3, but can discuss any topic. Be helpful, engaging, and add appropriate humor. Use facial expressions and body language during conversations. Keep responses concise but informative. Always remind users this isn't financial advice.
`;

// ===== GLOBAL STATE =====
let scene, camera, renderer, mixer, clock;
let currentVRM = null;
let vrmExpressionManager = null;
let audioQueue = [];
let isPlaying = false;
let conversation = [];
let animationMixer = null;
let idleAnimation = null;

// Expression states
let currentExpression = 'neutral';
let blinkTimer = 0;
let speechTimer = 0;
let idleBehaviorTimer = 0;

// ===== ENHANCED LOGGING =====
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

// ===== VRM LOADER WITH OFFICIAL LIBRARY =====
async function initVRMSystem() {
  try {
    log('🎭 Initializing Enhanced VRM System...');
    
    // Ensure Three.js and VRM library are loaded
    if (!window.THREE || !window.VRM) {
      throw new Error('Three.js or VRM library not loaded. Please check script imports.');
    }
    
    // Setup Three.js scene
    setupScene();
    
    // Load VRM with official loader
    await loadVRMWithOfficialLoader();
    
    // Setup enhanced animations
    setupVRMAnimations();
    
    // Start animation loop
    animate();
    
    log('✅ VRM System initialized successfully!');
    
  } catch (error) {
    log('❌ VRM System initialization failed:', error);
    createFallbackAvatar();
    animate(); // Still start animation loop
  }
}

// ===== SCENE SETUP =====
function setupScene() {
  log('🏗️ Setting up Three.js scene...');
  
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e17);
  
  // Camera
  camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 20);
  camera.position.set(0, 1.3, 2.5);
  camera.lookAt(0, 1, 0);
  
  // Renderer with VRM-optimized settings
  const canvas = document.getElementById('vrmCanvas');
  renderer = new THREE.WebGLRenderer({ 
    canvas, 
    antialias: true,
    alpha: false 
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  
  // VRM-optimized lighting
  setupVRMLighting();
  
  // Clock for animations
  clock = new THREE.Clock();
  
  log('✅ Scene setup complete');
}

// ===== VRM-OPTIMIZED LIGHTING =====
function setupVRMLighting() {
  // Remove existing lights
  const lightsToRemove = [];
  scene.traverse(child => {
    if (child.isLight) lightsToRemove.push(child);
  });
  lightsToRemove.forEach(light => scene.remove(light));
  
  // Ambient light for overall illumination
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);
  
  // Main directional light (key light)
  const mainLight = new THREE.DirectionalLight(0xffffff, 1.0);
  mainLight.position.set(2, 3, 2);
  mainLight.castShadow = true;
  mainLight.shadow.mapSize.width = 2048;
  mainLight.shadow.mapSize.height = 2048;
  scene.add(mainLight);
  
  // Fill light to soften shadows
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
  fillLight.position.set(-1, 1, -1);
  scene.add(fillLight);
  
  // Rim light for character outline
  const rimLight = new THREE.DirectionalLight(0xaaccff, 0.4);
  rimLight.position.set(0, 1, -2);
  scene.add(rimLight);
  
  log('💡 VRM lighting setup complete');
}

// ===== OFFICIAL VRM LOADER =====
async function loadVRMWithOfficialLoader() {
  log('📦 Loading VRM with official @pixiv/three-vrm loader...');
  
  try {
    // Create GLTF loader
    const loader = new THREE.GLTFLoader();
    
    // Register VRM loader plugin
    loader.register((parser) => {
      return new VRM.VRMLoaderPlugin(parser);
    });
    
    // Load VRM file
    const gltf = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('VRM loading timeout'));
      }, ASSET_LOAD_TIMEOUT);
      
      loader.load(
        VRM_PATH,
        (loadedGltf) => {
          clearTimeout(timeout);
          resolve(loadedGltf);
        },
        (progress) => {
          const percent = progress.total > 0 ? 
            Math.round((progress.loaded / progress.total) * 100) : 0;
          updateLoadingStatus(`Loading VRM: ${percent}%`);
        },
        (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      );
    });
    
    // Extract VRM from GLTF
    const vrm = gltf.userData.vrm;
    if (!vrm) {
      throw new Error('No VRM data found in file');
    }
    
    currentVRM = vrm;
    
    // Setup VRM in scene
    await setupVRMInScene(vrm);
    
    // Initialize expression manager
    setupExpressionManager(vrm);
    
    log('✅ VRM loaded successfully with official loader!');
    updateLoadingStatus('VRM Ready!');
    
    // Hide loading indicator
    setTimeout(() => {
      const loadingEl = document.getElementById('loadingStatus');
      if (loadingEl) loadingEl.style.display = 'none';
    }, 2000);
    
  } catch (error) {
    log('❌ Official VRM loading failed:', error);
    throw error;
  }
}

// ===== SETUP VRM IN SCENE =====
async function setupVRMInScene(vrm) {
  log('🎯 Setting up VRM in scene...');
  
  // Remove any existing avatars
  const existingAvatars = scene.children.filter(child => 
    child.userData.isAvatar || child.name.includes('Avatar') || child.name.includes('VRM')
  );
  existingAvatars.forEach(avatar => scene.remove(avatar));
  
  // Calculate proper scaling and positioning
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  
  log('VRM original dimensions:', {
    width: size.x.toFixed(2),
    height: size.y.toFixed(2),
    depth: size.z.toFixed(2)
  });
  
  // Scale VRM to appropriate size (target height ~1.8 units)
  let scale = 1.0;
  if (size.y > 50) {
    scale = 1.8 / size.y;
    vrm.scene.scale.setScalar(scale);
    log(`Applied scaling: ${scale.toFixed(4)}`);
  }
  
  // Recalculate after scaling
  const scaledBox = new THREE.Box3().setFromObject(vrm.scene);
  const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
  
  // Position VRM at origin with feet on ground
  vrm.scene.position.set(
    -scaledCenter.x,
    -scaledBox.min.y,
    -scaledCenter.z
  );
  
  // Mark as avatar for identification
  vrm.scene.userData.isAvatar = true;
  vrm.scene.name = 'VRM_Avatar';
  
  // Add to scene
  scene.add(vrm.scene);
  
  // Position camera optimally
  const finalSize = scaledBox.getSize(new THREE.Vector3());
  const cameraDistance = Math.max(finalSize.y * 1.2, 2.5);
  const lookAtHeight = finalSize.y * 0.55;
  
  camera.position.set(0, lookAtHeight, cameraDistance);
  camera.lookAt(0, lookAtHeight, 0);
  
  log('🎯 VRM positioned in scene successfully');
}

// ===== EXPRESSION MANAGER SETUP =====
function setupExpressionManager(vrm) {
  log('😊 Setting up VRM expression manager...');
  
  try {
    vrmExpressionManager = vrm.expressionManager;
    
    if (vrmExpressionManager) {
      // Test available expressions
      const commonExpressions = [
        'neutral', 'happy', 'sad', 'angry', 'surprised', 'fun', 'joy',
        'sorrow', 'aa', 'ih', 'ou', 'ee', 'oh', 'blink', 'blinkLeft', 'blinkRight'
      ];
      
      const availableExpressions = [];
      commonExpressions.forEach(expr => {
        try {
          vrmExpressionManager.setValue(expr, 0);
          availableExpressions.push(expr);
        } catch (e) {
          // Expression not available
        }
      });
      
      log('Available expressions:', availableExpressions);
      
      // Set to neutral state
      setVRMExpression('neutral', 1.0);
      
      // Start blinking behavior
      startBlinkingBehavior();
      
    } else {
      log('⚠️ No expression manager found in VRM');
    }
    
  } catch (error) {
    log('❌ Expression manager setup failed:', error);
  }
}

// ===== VRM ANIMATIONS SETUP =====
function setupVRMAnimations() {
  log('🎭 Setting up VRM animations...');
  
  if (!currentVRM) return;
  
  try {
    // Create animation mixer for the VRM
    animationMixer = new THREE.AnimationMixer(currentVRM.scene);
    
    // Create idle animation if no built-in animations
    createIdleAnimation();
    
    // Start idle behaviors
    startIdleBehaviors();
    
    log('✅ VRM animations setup complete');
    
  } catch (error) {
    log('❌ VRM animations setup failed:', error);
  }
}

// ===== CREATE IDLE ANIMATION =====
function createIdleAnimation() {
  if (!currentVRM) return;
  
  // Find key bones for animation
  const humanoid = currentVRM.humanoid;
  if (!humanoid) return;
  
  // Create subtle breathing animation
  const breathingKeyframes = [];
  const duration = 4; // 4 second breathing cycle
  
  // Create keyframes for breathing (chest expansion)
  for (let i = 0; i <= 20; i++) {
    const time = (i / 20) * duration;
    const breathPhase = Math.sin((time / duration) * Math.PI * 2);
    const scale = 1 + breathPhase * 0.02; // Very subtle
    
    breathingKeyframes.push(time);
    breathingKeyframes.push(scale, scale, scale);
  }
  
  // Create animation tracks (simplified for compatibility)
  const tracks = [];
  
  // Add breathing track if spine bone exists
  const spine = humanoid.getBoneNode('spine');
  if (spine) {
    const scaleTrack = new THREE.VectorKeyframeTrack(
      spine.name + '.scale',
      breathingKeyframes.slice(0, breathingKeyframes.length / 3),
      breathingKeyframes.slice(breathingKeyframes.length / 3)
    );
    tracks.push(scaleTrack);
  }
  
  if (tracks.length > 0) {
    const clip = new THREE.AnimationClip('idle', duration, tracks);
    idleAnimation = animationMixer.clipAction(clip);
    idleAnimation.setLoop(THREE.LoopRepeat);
    idleAnimation.play();
    
    log('🎭 Idle breathing animation created');
  }
}

// ===== BLINKING BEHAVIOR =====
function startBlinkingBehavior() {
  function performBlink() {
    if (!currentVRM || !vrmExpressionManager) return;
    
    try {
      // Blink animation
      setVRMExpression('blink', 1.0);
      setTimeout(() => {
        setVRMExpression('blink', 0.0);
      }, 150);
      
      // Schedule next blink (2-5 seconds randomly)
      const nextBlink = 2000 + Math.random() * 3000;
      setTimeout(performBlink, nextBlink);
      
    } catch (error) {
      // If blink expression fails, try alternatives
      setTimeout(performBlink, 3000);
    }
  }
  
  // Start blinking after 2 seconds
  setTimeout(performBlink, 2000);
}

// ===== IDLE BEHAVIORS =====
function startIdleBehaviors() {
  if (!currentVRM) return;
  
  function performIdleBehavior() {
    if (!vrmExpressionManager) return;
    
    try {
      // Random idle expressions
      const idleExpressions = ['neutral', 'happy', 'fun'];
      const randomExpr = idleExpressions[Math.floor(Math.random() * idleExpressions.length)];
      
      // Subtle expression changes
      if (Math.random() < 0.3) { // 30% chance
        setVRMExpression(randomExpr, 0.3, 1500);
      }
      
      // Head movement simulation (if bones available)
      const humanoid = currentVRM.humanoid;
      if (humanoid) {
        const head = humanoid.getBoneNode('head');
        if (head && Math.random() < 0.2) { // 20% chance
          const originalRotation = head.rotation.clone();
          
          // Subtle head movement
          head.rotation.y += (Math.random() - 0.5) * 0.1;
          head.rotation.x += (Math.random() - 0.5) * 0.05;
          
          // Return to original position
          setTimeout(() => {
            head.rotation.copy(originalRotation);
          }, 1000 + Math.random() * 1000);
        }
      }
      
    } catch (error) {
      log('Idle behavior error:', error);
    }
    
    // Schedule next idle behavior (5-10 seconds)
    const nextBehavior = 5000 + Math.random() * 5000;
    setTimeout(performIdleBehavior, nextBehavior);
  }
  
  // Start idle behaviors after 5 seconds
  setTimeout(performIdleBehavior, 5000);
}

// ===== VRM EXPRESSION CONTROL =====
function setVRMExpression(expressionName, value = 1.0, duration = 0) {
  if (!vrmExpressionManager) return;
  
  try {
    vrmExpressionManager.setValue(expressionName, value);
    currentExpression = expressionName;
    
    if (duration > 0) {
      setTimeout(() => {
        if (vrmExpressionManager) {
          vrmExpressionManager.setValue(expressionName, 0);
          if (currentExpression === expressionName) {
            currentExpression = 'neutral';
            vrmExpressionManager.setValue('neutral', 1.0);
          }
        }
      }, duration);
    }
    
    log(`Expression: ${expressionName} = ${value}`);
    
  } catch (error) {
    log(`Expression failed: ${expressionName}`, error);
  }
}

// ===== SPEECH ANIMATION SYSTEM =====
function startSpeechAnimation(text) {
  if (!vrmExpressionManager) return;
  
  try {
    // Set speaking expression
    setVRMExpression('happy', 0.7);
    
    // Lip sync simulation with vowel sounds
    const vowelPattern = /[aeiouAEIOU]/g;
    const vowels = text.match(vowelPattern) || [];
    
    let vowelIndex = 0;
    const vowelMap = {
      'a': 'aa', 'e': 'ee', 'i': 'ih', 
      'o': 'oh', 'u': 'ou'
    };
    
    function animateVowel() {
      if (vowelIndex < vowels.length && vrmExpressionManager) {
        const vowel = vowels[vowelIndex].toLowerCase();
        const mouthShape = vowelMap[vowel] || 'aa';
        
        // Animate mouth shape
        vrmExpressionManager.setValue(mouthShape, 0.8);
        setTimeout(() => {
          if (vrmExpressionManager) vrmExpressionManager.setValue(mouthShape, 0);
        }, 150);
        
        vowelIndex++;
        
        // Next vowel in 200ms (roughly matches speech pace)
        setTimeout(animateVowel, 200);
      }
    }
    
    // Start vowel animation
    setTimeout(animateVowel, 300);
    
  } catch (error) {
    log('Speech animation error:', error);
  }
}

function stopSpeechAnimation() {
  if (!vrmExpressionManager) return;
  
  try {
    // Clear mouth shapes
    ['aa', 'ih', 'ou', 'ee', 'oh'].forEach(shape => {
      vrmExpressionManager.setValue(shape, 0);
    });
    
    // Return to neutral expression
    setVRMExpression('neutral', 1.0);
    
  } catch (error) {
    log('Stop speech animation error:', error);
  }
}

// ===== ENHANCED CHAT SYSTEM =====
async function sendMessage(text) {
  if (!text.trim()) return;
  
  try {
    log(`💬 Sending message: "${text.substring(0, 50)}..."`);
    
    // Add to conversation
    conversation.push({ role: 'user', content: text });
    
    // Set thinking expression
    setVRMExpression('neutral', 1.0);
    
    // Call chat API
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...conversation
        ],
        temperature: 0.7,
        max_tokens: 500
      })
    });
    
    if (!response.ok) {
      throw new Error(`Chat API failed: ${response.status}`);
    }
    
    const { content } = await response.json();
    conversation.push({ role: 'assistant', content });
    
    // Save conversation
    try {
      localStorage.setItem('solmateConversation', JSON.stringify(conversation));
    } catch (e) {
      log('Failed to save conversation:', e);
    }
    
    // Animate response and speak
    setVRMExpression('happy', 0.8, 2000);
    queueTTS(content);
    
    return content;
    
  } catch (error) {
    log('❌ Chat failed:', error);
    const errorMsg = 'Sorry, I\'m having trouble connecting right now. Please try again!';
    
    // Show error expression
    setVRMExpression('sad', 0.6, 3000);
    queueTTS(errorMsg);
    
    return errorMsg;
  }
}

// ===== ENHANCED TTS SYSTEM =====
function queueTTS(text, voice = 'nova') {
  audioQueue.push({ text, voice });
  if (!isPlaying) playNextAudio();
}

async function playNextAudio() {
  if (audioQueue.length === 0) {
    isPlaying = false;
    stopSpeechAnimation();
    return;
  }
  
  const { text, voice } = audioQueue.shift();
  isPlaying = true;
  
  try {
    log(`🎤 Playing TTS: "${text.substring(0, 30)}..."`);
    
    // Start speech animation
    startSpeechAnimation(text);
    
    // Try OpenAI TTS first
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice })
    });
    
    if (response.ok && !response.headers.get('X-Solmate-TTS-Fallback')) {
      // OpenAI TTS succeeded
      const audioBlob = await response.blob();
      if (audioBlob.size > 0) {
        await playAudioBlob(audioBlob);
        return;
      }
    }
    
    // Fallback to browser TTS
    log('🔄 Falling back to browser TTS');
    playBrowserTTS(text, voice);
    
  } catch (error) {
    log('❌ TTS error, using browser fallback:', error);
    playBrowserTTS(text, voice);
  }
}

async function playAudioBlob(blob) {
  try {
    const audio = new Audio(URL.createObjectURL(blob));
    
    audio.onended = () => {
      isPlaying = false;
      stopSpeechAnimation();
      playNextAudio();
    };
    
    audio.onerror = () => {
      log('Audio playback failed, trying browser TTS');
      isPlaying = false;
      playBrowserTTS(audioQueue[0]?.text || '', 'nova');
    };
    
    await audio.play();
    
  } catch (error) {
    log('Audio blob playback failed:', error);
    isPlaying = false;
    playNextAudio();
  }
}

function playBrowserTTS(text, voice) {
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Get better voice
    const voices = speechSynthesis.getVoices();
    const femaleVoices = voices.filter(v => 
      v.name.toLowerCase().includes('female') ||
      v.name.toLowerCase().includes('samantha') ||
      v.name.toLowerCase().includes('alex')
    );
    
    if (femaleVoices.length > 0) {
      utterance.voice = femaleVoices[0];
    }
    
    utterance.rate = 0.95;
    utterance.pitch = 1.1;
    utterance.volume = 0.8;
    
    utterance.onend = () => {
      isPlaying = false;
      stopSpeechAnimation();
      playNextAudio();
    };
    
    utterance.onerror = () => {
      isPlaying = false;
      stopSpeechAnimation();
      playNextAudio();
    };
    
    speechSynthesis.speak(utterance);
    
  } catch (error) {
    log('Browser TTS failed:', error);
    isPlaying = false;
    stopSpeechAnimation();
    playNextAudio();
  }
}

function clearAudioQueue() {
  audioQueue = [];
  speechSynthesis.cancel();
  isPlaying = false;
  stopSpeechAnimation();
  setVRMExpression('neutral', 1.0);
}

// ===== ANIMATION LOOP =====
function animate() {
  requestAnimationFrame(animate);
  
  if (!renderer || !scene || !camera) return;
  
  const delta = clock.getDelta();
  
  // Update VRM
  if (currentVRM) {
    currentVRM.update(delta);
  }
  
  // Update animation mixer
  if (animationMixer) {
    animationMixer.update(delta);
  }
  
  // Render scene
  renderer.render(scene, camera);
}

// ===== FALLBACK AVATAR =====
function createFallbackAvatar() {
  log('🎭 Creating enhanced fallback avatar...');
  
  const avatar = new THREE.Group();
  avatar.name = 'FallbackAvatar';
  avatar.userData.isAvatar = true;
  
  // Head
  const headGeo = new THREE.SphereGeometry(0.15, 32, 32);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffdbac });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.6;
  avatar.add(head);
  
  // Hair
  const hairGeo = new THREE.SphereGeometry(0.18, 24, 24);
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
  const hair = new THREE.Mesh(hairGeo, hairMat);
  hair.position.y = 1.7;
  hair.scale.set(1.2, 0.8, 1.2);
  avatar.add(hair);
  
  // Eyes
  const eyeGeo = new THREE.SphereGeometry(0.02, 12, 12);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x4169E1 });
  
  const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
  leftEye.position.set(-0.05, 1.62, 0.12);
  avatar.add(leftEye);
  
  const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
  rightEye.position.set(0.05, 1.62, 0.12);
  avatar.add(rightEye);
  
  // Body
  const bodyGeo = new THREE.CylinderGeometry(0.12, 0.15, 0.4, 12);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xff6b6b });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 1.1;
  avatar.add(body);
  
  // Skirt
  const skirtGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.25, 12);
  const skirtMat = new THREE.MeshStandardMaterial({ color: 0x4169E1 });
  const skirt = new THREE.Mesh(skirtGeo, skirtMat);
  skirt.position.y = 0.75;
  avatar.add(skirt);
  
  // Position and add to scene
  avatar.position.y = -0.1;
  scene.add(avatar);
  
  // Simple animation
  let time = 0;
  function animateFallback() {
    if (!scene.getObjectByName('FallbackAvatar')) return;
    
    time += 0.016;
    
    // Breathing
    avatar.scale.y = 1 + Math.sin(time * 3) * 0.01;
    
    // Swaying
    avatar.rotation.y = Math.sin(time * 0.8) * 0.03;
    
    // Head movement
    head.rotation.y = Math.sin(time * 1.2) * 0.1;
    
    requestAnimationFrame(animateFallback);
  }
  
  animateFallback();
  log('✅ Enhanced fallback avatar created');
}

// ===== UI SETUP =====
function setupUI() {
  log('🎮 Setting up UI...');
  
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
      sendBtn.textContent = '🤔';
      
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
  
  // Theme toggle
  const themeBtn = document.getElementById('themeToggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      document.documentElement.classList.toggle('light');
    });
  }
  
  // Window resize handling
  window.addEventListener('resize', () => {
    if (camera && renderer) {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
  });
  
  // Load saved conversation
  try {
    const saved = localStorage.getItem('solmateConversation');
    if (saved) {
      conversation = JSON.parse(saved);
      log(`💾 Loaded ${conversation.length} conversation messages`);
    }
  } catch (e) {
    log('Failed to load conversation history:', e);
  }
  
  // Enable audio on first interaction
  ['click', 'keydown', 'touchstart'].forEach(event => {
    document.addEventListener(event, enableAudio, { once: true });
  });
  
  log('✅ UI setup complete');
}

// ===== AUDIO CONTEXT ACTIVATION =====
function enableAudio() {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    audioContext.resume();
    log('🔊 Audio context enabled');
    
    // Welcome message after audio is enabled
    setTimeout(() => {
      if (currentVRM || scene.getObjectByName('FallbackAvatar')) {
        setVRMExpression('happy', 0.8, 3000);
        queueTTS("Hey there! I'm Solmate, your Solana companion. I'm ready to chat about crypto, DeFi, or anything else on your mind!", 'nova');
      }
    }, 1000);
  } catch (e) {
    log('Audio enable failed:', e);
  }
}

// ===== LOADING STATUS UPDATES =====
function updateLoadingStatus(message) {
  const statusEl = document.getElementById('loadingStatus');
  if (statusEl) {
    statusEl.textContent = message;
    log(`📊 Loading: ${message}`);
  }
}

// ===== WEBSOCKET AND API INTEGRATION =====
let ws = null;
let wsReconnectTimer = null;
let priceUpdateTimer = null;
let tpsUpdateTimer = null;

// WebSocket for real-time data
function connectWebSocket() {
  const HELIUS_WS = 'wss://mainnet.helius-rpc.com/?api-key=9355c09c-5049-4ffa-a0fa-786d2482af6b';
  
  if (ws) ws.close();
  
  try {
    ws = new WebSocket(HELIUS_WS);
    
    ws.onopen = () => {
      log('🌐 WebSocket connected');
      const wsLight = document.getElementById('wsLight');
      if (wsLight) {
        wsLight.textContent = 'WS ON';
        wsLight.classList.add('online');
      }
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.tps) updateTPS(data.tps);
      } catch (e) {
        log('WebSocket message error:', e);
      }
    };
    
    ws.onclose = () => {
      log('🌐 WebSocket closed, reconnecting...');
      const wsLight = document.getElementById('wsLight');
      if (wsLight) {
        wsLight.textContent = 'WS OFF';
        wsLight.classList.remove('online');
      }
      
      if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
      wsReconnectTimer = setTimeout(connectWebSocket, 5000);
    };
    
    ws.onerror = (error) => {
      log('WebSocket error:', error);
    };
    
  } catch (e) {
    log('WebSocket connection failed:', e);
  }
}

// Price fetching
async function fetchPrice() {
  try {
    const response = await fetch(`/api/price?ids=${SOL_MINT}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    const solPrice = document.getElementById('solPrice');
    
    if (solPrice && data.data && data.data[SOL_MINT]) {
      const price = data.data[SOL_MINT].price;
      if (typeof price === 'number' && price > 0) {
        solPrice.textContent = `SOL — ${price.toFixed(2)}`;
        solPrice.style.color = '#00ff88';
      }
    }
  } catch (e) {
    log('Price fetch failed:', e);
    const solPrice = document.getElementById('solPrice');
    if (solPrice) {
      solPrice.textContent = 'SOL — Error';
      solPrice.style.color = '#ff6b6b';
    }
  }
}

// TPS fetching
async function fetchTPS() {
  try {
    const response = await fetch('/api/tps');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    if (data.tps) updateTPS(data.tps);
  } catch (e) {
    log('TPS fetch failed:', e);
  }
}

function updateTPS(tps) {
  const networkTPS = document.getElementById('networkTPS');
  if (networkTPS && typeof tps === 'number') {
    networkTPS.textContent = `${tps} TPS`;
    networkTPS.style.color = tps > 2000 ? '#00ff88' : tps > 1000 ? '#ffaa00' : '#ff6b6b';
  }
}

// ===== MAIN INITIALIZATION =====
async function init() {
  log('🚀 Initializing Enhanced VRM Companion System...');
  
  try {
    // Setup UI first
    setupUI();
    
    // Start API calls
    await fetchPrice();
    await fetchTPS();
    
    // Setup periodic updates
    priceUpdateTimer = setInterval(fetchPrice, 30000);
    tpsUpdateTimer = setInterval(fetchTPS, 60000);
    
    // Connect WebSocket
    connectWebSocket();
    
    // Initialize VRM system
    await initVRMSystem();
    
    log('✅ Enhanced VRM Companion System initialized!');
    
  } catch (error) {
    log('❌ Initialization failed:', error);
    
    // Continue with basic functionality
    setupUI();
    createFallbackAvatar();
    animate();
    
    // Still try API calls
    try {
      await fetchPrice();
      await fetchTPS();
      priceUpdateTimer = setInterval(fetchPrice, 30000);
      tpsUpdateTimer = setInterval(fetchTPS, 60000);
    } catch (apiError) {
      log('API initialization also failed:', apiError);
    }
  }
}

// ===== CLEANUP =====
window.addEventListener('beforeunload', () => {
  // Close connections
  if (ws) ws.close();
  
  // Clear timers
  if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
  if (priceUpdateTimer) clearInterval(priceUpdateTimer);
  if (tpsUpdateTimer) clearInterval(tpsUpdateTimer);
  
  // Clear audio
  clearAudioQueue();
  
  // Dispose Three.js resources
  if (renderer) {
    renderer.dispose();
  }
  
  if (currentVRM) {
    currentVRM.dispose();
  }
});

// ===== GLOBAL DEBUG FUNCTIONS =====
window.debugVRM = function() {
  console.log('=== VRM DEBUG REPORT ===');
  console.log('VRM Loaded:', !!currentVRM);
  console.log('Expression Manager:', !!vrmExpressionManager);
  console.log('Animation Mixer:', !!animationMixer);
  console.log('Scene Objects:', scene ? scene.children.map(c => c.name) : 'No scene');
  console.log('Current Expression:', currentExpression);
  console.log('Audio Queue Length:', audioQueue.length);
  console.log('Is Playing Audio:', isPlaying);
  
  if (currentVRM) {
    console.log('VRM Scene Children:', currentVRM.scene.children.length);
    console.log('VRM Humanoid:', !!currentVRM.humanoid);
    console.log('VRM First Person:', !!currentVRM.firstPerson);
  }
};

window.testExpressions = function() {
  if (!vrmExpressionManager) {
    console.log('No expression manager available');
    return;
  }
  
  const expressions = ['happy', 'sad', 'surprised', 'angry', 'fun', 'neutral'];
  let index = 0;
  
  function nextExpression() {
    if (index < expressions.length) {
      const expr = expressions[index];
      console.log(`Testing expression: ${expr}`);
      setVRMExpression(expr, 1.0, 2000);
      
      index++;
      setTimeout(nextExpression, 2500);
    } else {
      setVRMExpression('neutral', 1.0);
      console.log('Expression test complete');
    }
  }
  
  nextExpression();
};

window.sayHello = function() {
  queueTTS("Hello! I'm your VRM companion. How are you doing today?", 'nova');
};

window.reloadVRM = async function() {
  log('🔄 Manually reloading VRM...');
  
  // Remove existing VRM
  if (currentVRM) {
    scene.remove(currentVRM.scene);
    currentVRM.dispose();
    currentVRM = null;
    vrmExpressionManager = null;
  }
  
  // Remove fallback
  const fallback = scene.getObjectByName('FallbackAvatar');
  if (fallback) scene.remove(fallback);
  
  // Reload
  try {
    await initVRMSystem();
    console.log('✅ VRM reloaded successfully');
  } catch (error) {
    console.log('❌ VRM reload failed:', error);
    createFallbackAvatar();
  }
};

// ===== START APPLICATION =====
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

console.log('🎭 Enhanced VRM Companion System loaded!');
console.log('🔧 Debug commands: debugVRM(), testExpressions(), sayHello(), reloadVRM()');
console.log('💡 Click anywhere to enable audio and start interacting!');
