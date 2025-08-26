// web/js/AudioManager.js
// Centralized audio queue management with memory leak prevention

import { EventEmitter } from './EventEmitter.js';

export class AudioManager extends EventEmitter {
    constructor() {
        super();
        
        this.config = {
            maxQueueSize: 10,
            defaultVoice: 'nova',
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
            contextEnabled: false
        };
        
        this.queue = [];
        this.audioCache = new Map();
        this.activeAudioElements = new Set();
        this.retryCount = new Map();
    }
    
    enableContext() {
        if (this.state.contextEnabled) return;
        
        try {
            this.state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.state.audioContext.resume();
            this.state.contextEnabled = true;
            this.emit('context:enabled');
        } catch (error) {
            this.emit('error', { context: 'audio:context', error });
        }
    }
    
    queue(text, voice = this.config.defaultVoice) {
        if (!text || typeof text !== 'string') {
            console.warn('Invalid text provided to AudioManager');
            return;
        }
        
        // Limit queue size to prevent memory issues
        if (this.queue.length >= this.config.maxQueueSize) {
            console.warn('Audio queue full, removing oldest item');
            this.queue.shift();
        }
        
        const item = {
            id: this.generateId(),
            text: text.trim(),
            voice,
            timestamp: Date.now()
        };
        
        this.queue.push(item);
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
        
        this.emit('play:start', item);
        
        try {
            // Check cache first
            const cacheKey = this.getCacheKey(item.text, item.voice);
            let audioBlob;
            
            if (this.audioCache.has(cacheKey)) {
                audioBlob = this.audioCache.get(cacheKey);
                this.emit('cache:hit', cacheKey);
            } else {
                audioBlob = await this.fetchAudio(item);
                
                // Cache the audio blob (limit cache size)
                if (this.audioCache.size < 50) {
                    this.audioCache.set(cacheKey, audioBlob);
                    this.emit('cache:stored', cacheKey);
                }
            }
            
            await this.playAudio(audioBlob, item);
            
        } catch (error) {
            this.emit('error', { context: 'play', error, item });
            
            // Try fallback TTS
            await this.fallbackTTS(item);
        } finally {
            this.state.isPlaying = false;
            this.emit('play:end', item);
            
            // Clear retry count
            this.retryCount.delete(item.id);
            
            // Play next item
            this.playNext();
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
                signal: AbortSignal.timeout(30000) // 30 second timeout
            });
            
            if (!response.ok || response.headers.get('X-Solmate-TTS-Fallback') === 'browser') {
                throw new Error('TTS API unavailable, use fallback');
            }
            
            return await response.blob();
            
        } catch (error) {
            if (retries < this.config.maxRetries) {
                this.retryCount.set(item.id, retries + 1);
                await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
                return this.fetchAudio(item);
            }
            
            throw error;
        }
    }
    
    async playAudio(blob, item) {
        return new Promise((resolve, reject) => {
            const audioUrl = URL.createObjectURL(blob);
            const audio = new Audio(audioUrl);
            
            this.state.currentAudio = audio;
            this.activeAudioElements.add(audio);
            
            // Set up event handlers
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
                audio.pause();
            });
            
            this.once('resume', () => {
                audio.play();
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
            
            utterance.voice = this.getVoice(item.voice);
            utterance.rate = this.config.speechRate;
            utterance.pitch = this.config.speechPitch;
            utterance.volume = this.config.speechVolume;
            
            utterance.onend = () => {
                this.emit('fallback:complete', item);
                resolve();
            };
            
            utterance.onerror = (error) => {
                this.emit('error', { context: 'fallback:tts', error, item });
                resolve();
            };
            
            speechSynthesis.speak(utterance);
            this.emit('fallback:playing', item);
        });
    }
    
    getVoice(voiceName) {
        const voices = speechSynthesis.getVoices();
        return voices.find(v => v.name.toLowerCase().includes(voiceName.toLowerCase())) || voices[0];
    }
    
    cleanupAudio(audio, url) {
        // Remove from active set
        this.activeAudioElements.delete(audio);
        
        // Clear reference
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
        
        // Clear src to release resources
        audio.src = '';
        audio.load();
    }
    
    pause() {
        if (!this.state.isPlaying || this.state.isPaused) return;
        
        this.state.isPaused = true;
        
        if (this.state.currentAudio) {
            this.state.currentAudio.pause();
        }
        
        if (window.speechSynthesis) {
            speechSynthesis.pause();
        }
        
        this.emit('pause');
    }
    
    resume() {
        if (!this.state.isPaused) return;
        
        this.state.isPaused = false;
        
        if (this.state.currentAudio) {
            this.state.currentAudio.play();
        }
        
        if (window.speechSynthesis) {
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
        if (window.speechSynthesis) {
            speechSynthesis.cancel();
        }
        
        this.state.isPlaying = false;
        this.state.isPaused = false;
        
        this.emit('stop');
    }
    
    clear() {
        // Stop playback
        this.stop();
        
        // Clear queue
        this.queue = [];
        
        // Clear all active audio elements
        this.activeAudioElements.forEach(audio => {
            this.cleanupAudio(audio);
        });
        this.activeAudioElements.clear();
        
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
    
    getQueueLength() {
        return this.queue.length;
    }
    
    isPlaying() {
        return this.state.isPlaying;
    }
    
    isPaused() {
        return this.state.isPaused;
    }
    
    getCacheKey(text, voice) {
        return `${voice}:${text.substring(0, 50)}`;
    }
    
    generateId() {
        return `audio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    
    clearCache() {
        // Clear audio cache
        this.audioCache.clear();
        this.emit('cache:cleared');
    }
    
    getStats() {
        return {
            queueLength: this.queue.length,
            cacheSize: this.audioCache.size,
            activeElements: this.activeAudioElements.size,
            isPlaying: this.state.isPlaying,
            isPaused: this.state.isPaused,
            contextEnabled: this.state.contextEnabled
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
        
        // Clear all references
        this.queue = [];
        this.activeAudioElements.clear();
        this.retryCount.clear();
        
        // Remove all event listeners
        this.removeAllListeners();
        
        this.emit('destroyed');
    }
}

// Export the AudioManager class
export { AudioManager };
