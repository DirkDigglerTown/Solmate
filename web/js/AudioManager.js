// web/js/AudioManager.js
// Enhanced audio system with single cute voice and sentiment analysis integration

import { EventEmitter } from './EventEmitter.js';

export class AudioManager extends EventEmitter {
    constructor() {
        super();
        
        this.config = {
            maxQueueSize: 10,
            voice: 'nova', // Single cute female voice
            ttsEndpoint: '/api/tts',
            speechRate: 0.9,
            speechPitch: 1.1,
            speechVolume: 0.8,
            maxRetries: 3,
            retryDelay: 1000,
            // Voice filtering for browser TTS fallback
            preferredVoicePatterns: [
                'nova', 'aria', 'Female', 'Woman', 'Google UK English Female',
                'Microsoft Zira', 'Samantha', 'Ava', 'Allison', 'Susan'
            ]
        };
        
        this.state = {
            isPlaying: false,
            isPaused: false,
            currentAudio: null,
            audioContext: null,
            contextEnabled: false,
            currentText: '',
            currentSentiment: 'neutral'
        };
        
        this.queue = [];
        this.audioCache = new Map();
        this.activeAudioElements = new Set();
        this.retryCount = new Map();
        
        // Enhanced VU meter system
        this.vuMeter = {
            element: null,
            analyser: null,
            dataArray: null,
            isActive: false
        };
        
        this.setupVUMeter();
    }
    
    setupVUMeter() {
        this.vuMeter.element = document.getElementById('vuMeter');
        if (!this.vuMeter.element) {
            console.warn('VU Meter element not found');
            return;
        }
    }
    
    enableContext() {
        if (this.state.contextEnabled) return;
        
        try {
            this.state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.state.audioContext.resume();
            this.state.contextEnabled = true;
            this.setupVUAnalyzer();
            this.emit('context:enabled');
            console.log('🎵 Audio context enabled with VU meter');
        } catch (error) {
            this.emit('error', { context: 'audio:context', error });
        }
    }
    
    setupVUAnalyzer() {
        if (!this.state.audioContext || !this.vuMeter.element) return;
        
        try {
            this.vuMeter.analyser = this.state.audioContext.createAnalyser();
            this.vuMeter.analyser.fftSize = 256;
            this.vuMeter.dataArray = new Uint8Array(this.vuMeter.analyser.frequencyBinCount);
            console.log('📊 VU analyzer setup complete');
        } catch (error) {
            console.warn('VU analyzer setup failed:', error);
        }
    }
    
    updateVUMeter() {
        if (!this.vuMeter.analyser || !this.vuMeter.dataArray || !this.vuMeter.element) return;
        
        this.vuMeter.analyser.getByteFrequencyData(this.vuMeter.dataArray);
        
        // Calculate average amplitude
        let sum = 0;
        for (let i = 0; i < this.vuMeter.dataArray.length; i++) {
            sum += this.vuMeter.dataArray[i];
        }
        const average = sum / this.vuMeter.dataArray.length;
        
        // Update VU meter display (0-100%)
        const percentage = Math.min((average / 255) * 100, 100);
        this.vuMeter.element.style.width = `${percentage}%`;
        
        if (this.vuMeter.isActive) {
            requestAnimationFrame(() => this.updateVUMeter());
        }
    }
    
    startVUMeter() {
        this.vuMeter.isActive = true;
        this.updateVUMeter();
    }
    
    stopVUMeter() {
        this.vuMeter.isActive = false;
        if (this.vuMeter.element) {
            this.vuMeter.element.style.width = '0%';
        }
    }
    
    // Enhanced queue method with sentiment analysis
    queue(text, options = {}) {
        if (!text || typeof text !== 'string') {
            console.warn('Invalid text provided to AudioManager');
            return;
        }
        
        // Limit queue size
        if (this.queue.length >= this.config.maxQueueSize) {
            console.warn('Audio queue full, removing oldest item');
            this.queue.shift();
        }
        
        // Analyze sentiment for enhanced TTS
        const sentiment = this.analyzeSentiment(text);
        
        const item = {
            id: this.generateId(),
            text: text.trim(),
            voice: this.config.voice, // Always use nova
            timestamp: Date.now(),
            sentiment: sentiment,
            options: {
                rate: this.adjustRateForSentiment(sentiment),
                pitch: this.adjustPitchForSentiment(sentiment),
                volume: this.config.speechVolume,
                ...options
            }
        };
        
        this.queue.push(item);
        this.emit('queue:added', item);
        
        console.log(`🎭 Queued with ${sentiment} sentiment:`, text.substring(0, 50));
        
        if (!this.state.isPlaying) {
            this.playNext();
        }
    }
    
    // Sentiment-based voice adjustments
    analyzeSentiment(text) {
        const lowerText = text.toLowerCase();
        
        if (lowerText.includes('happy') || lowerText.includes('great') || 
            lowerText.includes('awesome') || lowerText.includes('wonderful') ||
            lowerText.includes('love') || lowerText.includes('amazing') ||
            lowerText.includes('excited') || lowerText.includes('fantastic')) {
            return 'happy';
        } else if (lowerText.includes('sad') || lowerText.includes('sorry') || 
                   lowerText.includes('bad') || lowerText.includes('terrible') ||
                   lowerText.includes('unfortunately') || lowerText.includes('disappointed')) {
            return 'sad';
        } else if (lowerText.includes('wow') || lowerText.includes('really?') || 
                   lowerText.includes('!') || lowerText.includes('incredible') ||
                   lowerText.includes('amazing') || lowerText.includes('surprised')) {
            return 'excited';
        } else if (lowerText.includes('solana') || lowerText.includes('crypto') ||
                   lowerText.includes('blockchain') || lowerText.includes('defi')) {
            return 'enthusiastic';
        } else {
            return 'neutral';
        }
    }
    
    adjustRateForSentiment(sentiment) {
        switch (sentiment) {
            case 'excited': return 1.0;
            case 'happy': return 0.95;
            case 'enthusiastic': return 0.92;
            case 'sad': return 0.8;
            default: return 0.9;
        }
    }
    
    adjustPitchForSentiment(sentiment) {
        switch (sentiment) {
            case 'excited': return 1.2;
            case 'happy': return 1.15;
            case 'enthusiastic': return 1.1;
            case 'sad': return 1.0;
            default: return 1.1;
        }
    }
    
    async playNext() {
        if (this.queue.length === 0) {
            this.state.isPlaying = false;
            this.stopVUMeter();
            this.emit('queue:empty');
            return;
        }
        
        if (this.state.isPaused) {
            return;
        }
        
        const item = this.queue.shift();
        this.state.isPlaying = true;
        this.state.currentText = item.text;
        this.state.currentSentiment = item.sentiment;
        
        this.emit('play:start', item);
        this.startVUMeter();
        
        try {
            // Check cache first
            const cacheKey = this.getCacheKey(item.text, item.voice, item.sentiment);
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
            
            // Try enhanced browser TTS fallback
            await this.enhancedFallbackTTS(item);
        } finally {
            this.state.isPlaying = false;
            this.state.currentText = '';
            this.state.currentSentiment = 'neutral';
            this.stopVUMeter();
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
                    voice: item.voice,
                    // Enhanced parameters based on sentiment
                    rate: item.options.rate,
                    pitch: item.options.pitch,
                    volume: item.options.volume
                }),
                signal: AbortSignal.timeout(30000)
            });
            
            if (!response.ok || response.headers.get('X-Solmate-TTS-Fallback') === 'browser') {
                throw new Error('TTS API unavailable, use enhanced fallback');
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
            
            // Connect to VU meter if available
            if (this.vuMeter.analyser && this.state.audioContext) {
                try {
                    const source = this.state.audioContext.createMediaElementSource(audio);
                    source.connect(this.vuMeter.analyser);
                    this.vuMeter.analyser.connect(this.state.audioContext.destination);
                } catch (e) {
                    // VU meter connection failed, continue anyway
                    console.warn('VU meter connection failed:', e);
                }
            }
            
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
            
            // Apply volume based on sentiment
            audio.volume = item.options.volume;
            
            // Play audio
            audio.play().catch(reject);
            
            this.emit('audio:playing', { item, duration: audio.duration });
        });
    }
    
    // Enhanced browser TTS with better voice selection
    async enhancedFallbackTTS(item) {
        if (!window.speechSynthesis) {
            console.warn('Speech synthesis not available');
            return;
        }
        
        return new Promise((resolve) => {
            const utterance = new SpeechSynthesisUtterance(item.text);
            
            // Enhanced voice selection
            utterance.voice = this.selectBestVoice();
            utterance.rate = item.options.rate;
            utterance.pitch = item.options.pitch;
            utterance.volume = item.options.volume;
            
            // Add emotional emphasis based on sentiment
            if (item.sentiment === 'excited') {
                utterance.text = this.addEmotionalEmphasis(item.text, 'excited');
            } else if (item.sentiment === 'happy') {
                utterance.text = this.addEmotionalEmphasis(item.text, 'happy');
            }
            
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
            
            console.log(`🎤 Enhanced browser TTS (${item.sentiment}):`, item.text.substring(0, 30));
        });
    }
    
    selectBestVoice() {
        const voices = speechSynthesis.getVoices();
        
        // Try to find the best female voice
        for (const pattern of this.config.preferredVoicePatterns) {
            const voice = voices.find(v => 
                v.name.toLowerCase().includes(pattern.toLowerCase()) ||
                v.voiceURI.toLowerCase().includes(pattern.toLowerCase())
            );
            if (voice) {
                console.log(`🎭 Selected voice: ${voice.name}`);
                return voice;
            }
        }
        
        // Fallback to first available voice
        return voices[0] || null;
    }
    
    addEmotionalEmphasis(text, sentiment) {
        switch (sentiment) {
            case 'excited':
                // Add slight pauses for dramatic effect
                return text.replace(/[!]/g, '! ');
            case 'happy':
                // Add warmth to the speech
                return text;
            default:
                return text;
        }
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
        
        this.stopVUMeter();
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
        
        this.startVUMeter();
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
        this.stopVUMeter();
        
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
        console.log('🧹 Audio queue cleared');
    }
    
    // Enhanced volume control with VU feedback
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
    
    // Utility methods
    getQueueLength() {
        return this.queue.length;
    }
    
    isPlaying() {
        return this.state.isPlaying;
    }
    
    isPaused() {
        return this.state.isPaused;
    }
    
    getCurrentText() {
        return this.state.currentText;
    }
    
    getCurrentSentiment() {
        return this.state.currentSentiment;
    }
    
    getCacheKey(text, voice, sentiment) {
        return `${voice}:${sentiment}:${text.substring(0, 50)}`;
    }
    
    generateId() {
        return `audio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    
    clearCache() {
        this.audioCache.clear();
        this.emit('cache:cleared');
        console.log('🧹 Audio cache cleared');
    }
    
    getStats() {
        return {
            queueLength: this.queue.length,
            cacheSize: this.audioCache.size,
            activeElements: this.activeAudioElements.size,
            isPlaying: this.state.isPlaying,
            isPaused: this.state.isPaused,
            contextEnabled: this.state.contextEnabled,
            currentText: this.state.currentText,
            currentSentiment: this.state.currentSentiment,
            voice: this.config.voice
        };
    }
    
    destroy() {
        // Clear everything
        this.clear();
        
        // Clear cache
        this.clearCache();
        
        // Stop VU meter
        this.stopVUMeter();
        
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
        console.log('🎵 AudioManager destroyed');
    }
}
