// web/js/utils.js
// Client-side utility functions and error handling helpers

const Utils = {
  // API configuration
  API_TIMEOUT: 30000,
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,

  // Error types
  ErrorTypes: {
    NETWORK: 'NETWORK_ERROR',
    TIMEOUT: 'TIMEOUT_ERROR',
    API: 'API_ERROR',
    VALIDATION: 'VALIDATION_ERROR',
    AUDIO: 'AUDIO_ERROR',
    VRM: 'VRM_ERROR',
    UNKNOWN: 'UNKNOWN_ERROR'
  },

  // Enhanced fetch with retry and timeout
  async fetchWithRetry(url, options = {}, retries = this.MAX_RETRIES) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || this.API_TIMEOUT);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok && retries > 0) {
        await this.delay(this.RETRY_DELAY);
        return this.fetchWithRetry(url, options, retries - 1);
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw this.createError(this.ErrorTypes.TIMEOUT, 'Request timeout');
      }

      if (retries > 0) {
        await this.delay(this.RETRY_DELAY);
        return this.fetchWithRetry(url, options, retries - 1);
      }

      throw this.createError(this.ErrorTypes.NETWORK, error.message);
    }
  },

  // Error factory
  createError(type, message, details = null) {
    const error = new Error(message);
    error.type = type;
    error.timestamp = Date.now();
    error.details = details;
    return error;
  },

  // Enhanced error handler with user notification
  handleError(error, showNotification = true) {
    console.error('Error:', error);

    // Log to analytics if available
    if (typeof window.gtag !== 'undefined') {
      window.gtag('event', 'exception', {
        description: error.message,
        fatal: false
      });
    }

    // Determine error message for user
    let userMessage = 'Something went wrong. Please try again.';
    let severity = 'error';

    switch(error.type) {
      case this.ErrorTypes.NETWORK:
        userMessage = 'Connection issue. Please check your internet.';
        break;
      case this.ErrorTypes.TIMEOUT:
        userMessage = 'Request timed out. Please try again.';
        break;
      case this.ErrorTypes.API:
        userMessage = 'Service temporarily unavailable.';
        break;
      case this.ErrorTypes.AUDIO:
        userMessage = 'Audio playback issue. Check your speakers.';
        severity = 'warning';
        break;
      case this.ErrorTypes.VRM:
        userMessage = 'Avatar loading issue. Using fallback.';
        severity = 'warning';
        break;
      case this.ErrorTypes.VALIDATION:
        userMessage = error.message || 'Invalid input. Please check and try again.';
        severity = 'warning';
        break;
    }

    if (showNotification) {
      this.showNotification(userMessage, severity);
    }

    return { error, userMessage, severity };
  },

  // Notification system
  showNotification(message, severity = 'info', duration = 5000) {
    // Remove existing notifications
    const existing = document.querySelector('.notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = `notification notification-${severity}`;
    notification.textContent = message;
    
    notification.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 10000;
      animation: slideIn 0.3s ease-out;
      max-width: 300px;
      cursor: pointer;
    `;

    // Severity-based styling
    const colors = {
      info: { bg: '#4a90e2', fg: '#ffffff' },
      success: { bg: '#00ff88', fg: '#001014' },
      warning: { bg: '#ffaa00', fg: '#001014' },
      error: { bg: '#ff5a7a', fg: '#ffffff' }
    };

    const color = colors[severity] || colors.info;
    notification.style.backgroundColor = color.bg;
    notification.style.color = color.fg;

    document.body.appendChild(notification);

    // Auto-remove
    if (duration > 0) {
      setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => notification.remove(), 300);
      }, duration);
    }

    // Click to dismiss
    notification.addEventListener('click', () => {
      notification.remove();
    });
  },

  // Delay utility
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  // Debounce function
  debounce(func, wait = 300) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  // Throttle function
  throttle(func, limit = 100) {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  },

  // Local storage with error handling
  storage: {
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        console.warn('Storage error:', e);
        return false;
      }
    },

    get(key, defaultValue = null) {
      try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : defaultValue;
      } catch (e) {
        console.warn('Storage error:', e);
        return defaultValue;
      }
    },

    remove(key) {
      try {
        localStorage.removeItem(key);
        return true;
      } catch (e) {
        console.warn('Storage error:', e);
        return false;
      }
    },

    clear() {
      try {
        localStorage.clear();
        return true;
      } catch (e) {
        console.warn('Storage error:', e);
        return false;
      }
    }
  },

  // Format utilities
  formatNumber(num, decimals = 2) {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(num);
  },

  formatCurrency(amount, currency = 'USD') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency
    }).format(amount);
  },

  formatDate(date, options = {}) {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      ...options
    }).format(date);
  },

  // Clipboard utilities
  async copyToClipboard(text) {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      this.showNotification('Copied to clipboard!', 'success', 2000);
      return true;
    } catch (e) {
      this.showNotification('Failed to copy', 'error');
      return false;
    }
  },

  // Device detection
  device: {
    isMobile() {
      return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    },

    isTablet() {
      return /(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(navigator.userAgent);
    },

    isTouchDevice() {
      return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    },

    isIOS() {
      return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    },

    isAndroid() {
      return /Android/.test(navigator.userAgent);
    },

    isSafari() {
      return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    }
  },

  // Performance monitoring
  performance: {
    mark(name) {
      if (window.performance && window.performance.mark) {
        window.performance.mark(name);
      }
    },

    measure(name, startMark, endMark) {
      if (window.performance && window.performance.measure) {
        try {
          window.performance.measure(name, startMark, endMark);
          const measure = window.performance.getEntriesByName(name)[0];
          console.log(`Performance: ${name} = ${measure.duration.toFixed(2)}ms`);
          return measure.duration;
        } catch (e) {
          console.warn('Performance measurement failed:', e);
        }
      }
      return null;
    },

    clearMarks() {
      if (window.performance && window.performance.clearMarks) {
        window.performance.clearMarks();
      }
    }
  },

  // Animation helpers
  animation: {
    fadeIn(element, duration = 300) {
      element.style.opacity = '0';
      element.style.display = 'block';
      element.style.transition = `opacity ${duration}ms ease-in`;
      
      requestAnimationFrame(() => {
        element.style.opacity = '1';
      });
    },

    fadeOut(element, duration = 300) {
      element.style.transition = `opacity ${duration}ms ease-out`;
      element.style.opacity = '0';
      
      setTimeout(() => {
        element.style.display = 'none';
      }, duration);
    },

    slideIn(element, direction = 'left', duration = 300) {
      const transforms = {
        left: 'translateX(-100%)',
        right: 'translateX(100%)',
        top: 'translateY(-100%)',
        bottom: 'translateY(100%)'
      };

      element.style.transform = transforms[direction];
      element.style.display = 'block';
      element.style.transition = `transform ${duration}ms ease-out`;
      
      requestAnimationFrame(() => {
        element.style.transform = 'translate(0)';
      });
    }
  },

  // Audio utilities
  audio: {
    context: null,

    getContext() {
      if (!this.context) {
        this.context = new (window.AudioContext || window.webkitAudioContext)();
      }
      return this.context;
    },

    async play(url) {
      try {
        const audio = new Audio(url);
        await audio.play();
        return audio;
      } catch (e) {
        throw Utils.createError(Utils.ErrorTypes.AUDIO, 'Failed to play audio', e);
      }
    },

    preload(urls) {
      return Promise.all(
        urls.map(url => {
          return new Promise((resolve) => {
            const audio = new Audio(url);
            audio.addEventListener('canplaythrough', () => resolve(audio), { once: true });
            audio.addEventListener('error', () => resolve(null), { once: true });
          });
        })
      );
    }
  },

  // WebGL detection
  webgl: {
    isSupported() {
      try {
        const canvas = document.createElement('canvas');
        return !!(window.WebGLRenderingContext && 
          (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
      } catch(e) {
        return false;
      }
    },

    getVersion() {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');
      if (gl) return 2;
      
      const gl1 = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl1) return 1;
      
      return 0;
    }
  },

  // Initialize utilities
  init() {
    // Add CSS for notifications
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(100%); }
        to { transform: translateX(0); }
      }
      @keyframes slideOut {
        from { transform: translateX(0); }
        to { transform: translateX(100%); }
      }
      .notification {
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transition: all 0.3s ease;
      }
      .notification:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(0,0,0,0.4);
      }
    `;
    document.head.appendChild(style);

    console.log('✅ Utils initialized');
    console.log('Device:', {
      mobile: this.device.isMobile(),
      touch: this.device.isTouchDevice(),
      webgl: this.webgl.isSupported(),
      webglVersion: this.webgl.getVersion()
    });
  }
};

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => Utils.init());
} else {
  Utils.init();
}

// Export for use in other scripts
window.Utils = Utils;
