// web/js/AudioManager.js
// Enhanced audio system with single cute female voice option

import { EventEmitter } from './EventEmitter.js';

export class AudioManager extends EventEmitter {
    constructor() {
        super();
        
        console.log('🔊 Initializing AudioManager...');
        
        this.config = {
            maxQueueSize: 10,
            defaultVoice: 'nova',  // Single cute female voice
            ttsEndpoint: '/api/tts',
            speechRate: 0.9,
            speechPitch: 1.1,
            speechVolume: 0.8,
            maxRetries: 3,
            retryDelay: 1000
        };
        
        this.state = {
            isPlaying: false,
            isPaused: false,
            currentAudio: null,
            audioContext: null,
            contextEnabled: false,
            availableVoices: []
        };
        
        this.queue = [];
        this.audioCache = new Map();
        this.activeAudioElements = new Set();
        this.retryCount = new Map();
        
        this.init();
    }
    
    async init() {
        try {
            // Wait for speech synthesis voices to load
            this.loadVoices();
            
            // Set up event listeners
            this.setupEventListeners();
            
            console.log('✅ AudioManager initialized');
            this.emit('init:complete');
            
        } catch (error) {
            console.error('AudioManager initialization failed:', error);
            this.emit('error', { context: 'init', error });
            throw error;
        }
    }
    
    loadVoices() {
        // Function to get and filter voices
        const updateVoices = () => {
            const voices = speechSynthesis.getVoices();
            
            // Filter for female voices that sound cute/young
            this.state.availableVoices = voices.filter(voice => {
                const name = voice.name.toLowerCase();
                const lang = voice.lang.toLowerCase();
                
                // Prefer female voices in English
                return (
                    lang.startsWith('en') && (
                        name.includes('female') ||
                        name.includes('woman') ||
                        name.includes('zira') ||
                        name.includes('hazel') ||
                        name.includes('susan') ||
                        name.includes('samantha') ||
                        name.includes('karen') ||
                        name.includes('moira') ||
                        name.includes('tessa') ||
                        name.includes('veena') ||
                        name.includes('fiona') ||
                        voice.name === 'Google US English' ||
                        (name.includes('google') && name.includes('us'))
                    )
                );
            });
            
            // If no specific female voices found, get the best available
            if (this.state.availableVoices.length === 0) {
                this.state.availableVoices = voices.filter(voice => 
                    voice.lang.toLowerCase().startsWith('en')
                ).slice(0, 5);
            }
            
            console.log(`✅ Speech synthesis ready with ${voices.length} voices`);
            console.log('Selected female voices:', this.state.availableVoices.map(v => v.name));
        };
        
        // Load voices immediately if available
        updateVoices();
        
        // Also listen for voice changes (some browsers load them async)
        speechSynthesis.addEventListener('voiceschanged', updateVoices);
        
        // Fallback for slow voice loading
        setTimeout(updateVoices, 1000);
    }
    
    setupEventListeners() {
        // Handle visibility changes to prevent audio issues
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.state.isPlaying) {
                this.pause();
            } else if (!document.hidden && this.state.isPaused) {
                this.resume();
            }
        });
    }
    
    enableContext() {
        if (this.state.contextEnabled) return;
        
        try {
            this.state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.state.audioContext.resume();
            this.state.contextEnabled = true;
            this.emit('context:enabled');
            console.log('🎵 Audio context enabled');
        } catch (error) {
            console.error('Failed to enable audio context:', error);
            this.emit('error', { context: 'audio:context', error });
        }
    }
    
    queue(text, voice = this.config.defaultVoice) {
        if (!text || typeof text !== 'string') {
            console.warn('Invalid text provided to AudioManager');
            return;
        }
        
        // Limit queue size
        if (this.queue.length >= this.config.maxQueueSize) {
            console.warn('Audio queue full, removing oldest item');
            this.queue.shift();
        }
        
        const item = {
            id: this.generateId(),
            text: text.trim(),
            voice: this.config.defaultVoice, // Always use the single female voice
            timestamp: Date.now()
        };
        
        this.queue.push(item);
        console.log(`🎵 Queued: "${text.substring(0, 50)}${text.length > 50 ? '...' : '"}"`);
        this.emit('queue:added', item);
        
        if (!this.state.isPlaying) {
            this.playNext();
        }
    }
    
    async playNext() {
        if (this.queue.length === 0) {
            this.state.isPlaying = false;
            this.emit('queue:empty');
            return;
        }
        
        if (this.state.isPaused) {
            return;
        }
        
        const item = this.queue.shift();
        this.state.isPlaying = true;
        
        console.log(`🔊 Playing: "${item.text.substring(0, 50)}${item.text.length > 50 ? '...' : ''}"`);
        this.emit('play:start', item);
        
        try {
            // Try API TTS first, fallback to browser TTS
            await this.playTTS(item);
        } catch (error) {
            console.warn('TTS API failed, using browser fallback:', error);
            await this.fallbackTTS(item);
        } finally {
            this.state.isPlaying = false;
            this.emit('play:end', item);
            this.retryCount.delete(item.id);
            
            // Continue with next item
            this.playNext();
        }
    }
    
    async playTTS(item) {
        try {
            // Check cache first
            const cacheKey = this.getCacheKey(item.text, item.voice);
            if (this.audioCache.has(cacheKey)) {
                console.log('🎵 Using cached audio');
                const audioBlob = this.audioCache.get(cacheKey);
                await this.playAudioBlob(audioBlob, item);
                return;
            }
            
            // Fetch from API
            const audioBlob = await this.fetchAudio(item);
            
            // Cache if successful
            if (this.audioCache.size < 20) { // Limit cache size
                this.audioCache.set(cacheKey, audioBlob);
            }
            
            // Play the audio
            await this.playAudioBlob(audioBlob, item);
            
        } catch (error) {
            // Re-throw to trigger fallback
            throw error;
        }
    }
    
    async fetchAudio(item) {
        const retries = this.retryCount.get(item.id) || 0;
        
        try {
            const response = await fetch(this.config.ttsEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: item.text,
                    voice: item.voice
                }),
                signal: AbortSignal.timeout(30000)
            });
            
            // Check for fallback signal
            if (!response.ok || response.headers.get('X-Solmate-TTS-Fallback') === 'browser') {
                throw new Error('TTS API unavailable, use fallback');
            }
            
            const blob = await response.blob();
            if (blob.size === 0) {
                throw new Error('Empty audio response');
            }
            
            return blob;
            
        } catch (error) {
            // Retry logic
            if (retries < this.config.maxRetries) {
                this.retryCount.set(item.id, retries + 1);
                await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
                return this.fetchAudio(item);
            }
            
            throw error;
        }
    }
    
    async playAudioBlob(blob, item) {
        return new Promise((resolve, reject) => {
            const audioUrl = URL.createObjectURL(blob);
            const audio = new Audio(audioUrl);
            
            this.state.currentAudio = audio;
            this.activeAudioElements.add(audio);
            
            audio.volume = this.config.speechVolume;
            
            audio.onended = () => {
                this.cleanupAudio(audio, audioUrl);
                resolve();
            };
            
            audio.onerror = (error) => {
                this.cleanupAudio(audio, audioUrl);
                reject(error);
            };
            
            // Handle pause/resume
            this.once('pause', () => {
                if (this.state.currentAudio === audio) {
                    audio.pause();
                }
            });
            
            this.once('resume', () => {
                if (this.state.currentAudio === audio && audio.paused) {
                    audio.play().catch(console.error);
                }
            });
            
            // Play audio
            audio.play().catch(reject);
            
            this.emit('audio:playing', { item, duration: audio.duration });
        });
    }
    
    async fallbackTTS(item) {
        if (!window.speechSynthesis) {
            console.warn('Speech synthesis not available');
            return;
        }
        
        return new Promise((resolve) => {
            const utterance = new SpeechSynthesisUtterance(item.text);
            
            // Use the best available female voice
            utterance.voice = this.getBestFemaleVoice();
            utterance.rate = this.config.speechRate;
            utterance.pitch = this.config.speechPitch;
            utterance.volume = this.config.speechVolume;
            
            utterance.onstart = () => {
                console.log('🗣️ Browser TTS started');
            };
            
            utterance.onend = () => {
                this.emit('fallback:complete', item);
                resolve();
            };
            
            utterance.onerror = (error) => {
                console.error('Browser TTS error:', error);
                this.emit('error', { context: 'fallback:tts', error, item });
                resolve();
            };
            
            speechSynthesis.speak(utterance);
            this.emit('fallback:playing', item);
        });
    }
    
    getBestFemaleVoice() {
        if (this.state.availableVoices.length > 0) {
            // Prioritize specific female voices
            const preferred = this.state.availableVoices.find(voice => {
                const name = voice.name.toLowerCase();
                return (
                    name.includes('zira') ||
                    name.includes('hazel') ||
                    name.includes('samantha') ||
                    name.includes('karen') ||
                    name.includes('susan')
                );
            });
            
            return preferred || this.state.availableVoices[0];
        }
        
        // Fallback to any available voice
        const allVoices = speechSynthesis.getVoices();
        return allVoices.find(voice => voice.lang.startsWith('en')) || allVoices[0];
    }
    
    cleanupAudio(audio, url) {
        // Remove from active set
        this.activeAudioElements.delete(audio);
        
        // Clear reference if current
        if (this.state.currentAudio === audio) {
            this.state.currentAudio = null;
        }
        
        // Revoke object URL to free memory
        if (url) {
            URL.revokeObjectURL(url);
        }
        
        // Remove event listeners
        audio.onended = null;
        audio.onerror = null;
        audio.onloadstart = null;
        
        // Clear src to release resources
        audio.src = '';
        audio.load();
    }
    
    pause() {
        if (!this.state.isPlaying || this.state.isPaused) return;
        
        this.state.isPaused = true;
        
        if (this.state.currentAudio && !this.state.currentAudio.paused) {
            this.state.currentAudio.pause();
        }
        
        if (speechSynthesis.speaking) {
            speechSynthesis.pause();
        }
        
        this.emit('pause');
    }
    
    resume() {
        if (!this.state.isPaused) return;
        
        this.state.isPaused = false;
        
        if (this.state.currentAudio && this.state.currentAudio.paused) {
            this.state.currentAudio.play().catch(console.error);
        }
        
        if (speechSynthesis.paused) {
            speechSynthesis.resume();
        }
        
        this.emit('resume');
    }
    
    stop() {
        // Stop current audio
        if (this.state.currentAudio) {
            this.state.currentAudio.pause();
            this.state.currentAudio.currentTime = 0;
        }
        
        // Stop speech synthesis
        if (speechSynthesis.speaking) {
            speechSynthesis.cancel();
        }
        
        this.state.isPlaying = false;
        this.state.isPaused = false;
        
        this.emit('stop');
    }
    
    clear() {
        // Stop current playback
        this.stop();
        
        // Clear queue
        this.queue = [];
        
        // Clean up all active audio elements
        this.activeAudioElements.forEach(audio => {
            this.cleanupAudio(audio);
        });
        this.activeAudioElements.clear();
        
        // Clear retry counts
        this.retryCount.clear();
        
        console.log('🔇 Audio queue cleared');
        this.emit('clear');
    }
    
    setVolume(volume) {
        const clampedVolume = Math.max(0, Math.min(1, volume));
        this.config.speechVolume = clampedVolume;
        
        if (this.state.currentAudio) {
            this.state.currentAudio.volume = clampedVolume;
        }
        
        this.emit('volume:changed', clampedVolume);
    }
    
    setRate(rate) {
        const clampedRate = Math.max(0.5, Math.min(2, rate));
        this.config.speechRate = clampedRate;
        
        if (this.state.currentAudio) {
            this.state.currentAudio.playbackRate = clampedRate;
        }
        
        this.emit('rate:changed', clampedRate);
    }
    
    setPitch(pitch) {
        const clampedPitch = Math.max(0.5, Math.min(2, pitch));
        this.config.speechPitch = clampedPitch;
        this.emit('pitch:changed', clampedPitch);
    }
    
    getQueueLength() {
        return this.queue.length;
    }
    
    isPlaying() {
        return this.state.isPlaying;
    }
    
    isPaused() {
        return this.state.isPaused;
    }
    
    getAvailableVoices() {
        return this.state.availableVoices.map(voice => ({
            name: voice.name,
            lang: voice.lang,
            localService: voice.localService,
            default: voice.default
        }));
    }
    
    getCacheKey(text, voice) {
        return `${voice}:${text.substring(0, 100)}`;
    }
    
    generateId() {
        return `audio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    
    clearCache() {
        this.audioCache.clear();
        this.emit('cache:cleared');
        console.log('🗑️ Audio cache cleared');
    }
    
    getStats() {
        return {
            queueLength: this.queue.length,
            cacheSize: this.audioCache.size,
            activeElements: this.activeAudioElements.size,
            isPlaying: this.state.isPlaying,
            isPaused: this.state.isPaused,
            contextEnabled: this.state.contextEnabled,
            availableVoices: this.state.availableVoices.length
        };
    }
    
    destroy() {
        // Clear everything
        this.clear();
        
        // Clear cache
        this.clearCache();
        
        // Close audio context
        if (this.state.audioContext) {
            this.state.audioContext.close();
            this.state.audioContext = null;
        }
        
        // Remove event listeners
        document.removeEventListener('visibilitychange', () => {});
        speechSynthesis.removeEventListener('voiceschanged', () => {});
        
        // Clear all references
        this.queue = [];
        this.activeAudioElements.clear();
        this.retryCount.clear();
        this.audioCache.clear();
        
        // Remove all event listeners
        this.removeAllListeners();
        
        console.log('🔊 AudioManager destroyed');
        this.emit('destroyed');
    }
}
