// web/js/EventEmitter.js
// Shared event emitter class for all modules

export class EventEmitter {
    constructor() {
        this.events = {};
        this.maxListeners = 10;
    }
    
    on(event, listener) {
        if (typeof listener !== 'function') {
            throw new TypeError('Listener must be a function');
        }
        
        if (!this.events[event]) {
            this.events[event] = [];
        }
        
        // Warn if too many listeners (possible memory leak)
        if (this.events[event].length >= this.maxListeners) {
            console.warn(`Warning: Possible memory leak. ${this.events[event].length} listeners for event "${event}"`);
        }
        
        this.events[event].push(listener);
        return this;
    }
    
    once(event, listener) {
        if (typeof listener !== 'function') {
            throw new TypeError('Listener must be a function');
        }
        
        const onceWrapper = (...args) => {
            listener.apply(this, args);
            this.off(event, onceWrapper);
        };
        
        onceWrapper.listener = listener;
        return this.on(event, onceWrapper);
    }
    
    off(event, listenerToRemove) {
        if (!this.events[event]) return this;
        
        this.events[event] = this.events[event].filter(listener => {
            return listener !== listenerToRemove && listener.listener !== listenerToRemove;
        });
        
        return this;
    }
    
    emit(event, ...args) {
        if (!this.events[event]) return false;
        
        const listeners = [...this.events[event]];
        listeners.forEach(listener => {
            try {
                listener.apply(this, args);
            } catch (error) {
                console.error(`Error in event listener for "${event}":`, error);
                this.emit('error', error);
            }
        });
        
        return true;
    }
    
    removeAllListeners(event) {
        if (event) {
            delete this.events[event];
        } else {
            this.events = {};
        }
        return this;
    }
    
    listenerCount(event) {
        return this.events[event] ? this.events[event].length : 0;
    }
    
    eventNames() {
        return Object.keys(this.events);
    }
    
    setMaxListeners(n) {
        this.maxListeners = n;
        return this;
    }
}
