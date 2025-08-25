// web/service-worker.js
// Service worker for offline support and cache management

const CACHE_NAME = 'solmate-v1.0.0';
const API_CACHE = 'solmate-api-v1';
const ASSET_CACHE = 'solmate-assets-v1';

// Assets to cache immediately
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/js/utils.js',
  '/manifest.webmanifest',
  '/assets/logo/solmatelogo.png'
];

// CDN resources to cache
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.158.0/examples/js/loaders/GLTFLoader.js',
  'https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@2.0.6/lib/three-vrm.min.js'
];

// API endpoints with cache strategies
const API_STRATEGIES = {
  '/api/health': { strategy: 'networkFirst', ttl: 60 },
  '/api/price': { strategy: 'networkFirst', ttl: 20 },
  '/api/tps': { strategy: 'networkFirst', ttl: 10 },
  '/api/chat': { strategy: 'networkOnly' },
  '/api/tts': { strategy: 'networkOnly' }
};

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Installing...');
  
  event.waitUntil(
    Promise.all([
      // Cache static assets
      caches.open(CACHE_NAME).then((cache) => {
        console.log('[ServiceWorker] Caching static assets');
        return cache.addAll(STATIC_ASSETS).catch(err => {
          console.warn('[ServiceWorker] Failed to cache some static assets:', err);
        });
      }),
      
      // Cache CDN assets
      caches.open(ASSET_CACHE).then((cache) => {
        console.log('[ServiceWorker] Caching CDN assets');
        return Promise.all(
          CDN_ASSETS.map(url => 
            cache.add(url).catch(err => 
              console.warn(`[ServiceWorker] Failed to cache CDN asset: ${url}`, err)
            )
          )
        );
      })
    ]).then(() => {
      console.log('[ServiceWorker] Installation complete');
      self.skipWaiting(); // Activate immediately
    })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activating...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && 
              cacheName !== API_CACHE && 
              cacheName !== ASSET_CACHE) {
            console.log('[ServiceWorker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[ServiceWorker] Activation complete');
      return self.clients.claim(); // Take control immediately
    })
  );
});

// Fetch event - implement cache strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Handle API requests
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleAPIRequest(request));
    return;
  }

  // Handle VRM file specially
  if (url.pathname.includes('.vrm')) {
    event.respondWith(handleLargeAsset(request));
    return;
  }

  // Handle static assets
  if (STATIC_ASSETS.includes(url.pathname) || 
      url.pathname.startsWith('/assets/')) {
    event.respondWith(handleStaticAsset(request));
    return;
  }

  // Handle CDN resources
  if (CDN_ASSETS.some(cdn => request.url.includes(cdn))) {
    event.respondWith(handleCDNAsset(request));
    return;
  }

  // Default strategy - network first with cache fallback
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(request);
      })
  );
});

// API request handler with different strategies
async function handleAPIRequest(request) {
  const url = new URL(request.url);
  const strategy = API_STRATEGIES[url.pathname];
  
  if (!strategy) {
    return fetch(request);
  }

  switch (strategy.strategy) {
    case 'networkFirst':
      return networkFirst(request, API_CACHE, strategy.ttl);
    
    case 'cacheFirst':
      return cacheFirst(request, API_CACHE, strategy.ttl);
    
    case 'networkOnly':
      return fetch(request);
    
    default:
      return fetch(request);
  }
}

// Network first strategy with TTL
async function networkFirst(request, cacheName, ttl) {
  try {
    const response = await fetch(request);
    
    if (response.ok) {
      const responseClone = response.clone();
      const cache = await caches.open(cacheName);
      
      // Add timestamp to response
      const headers = new Headers(responseClone.headers);
      headers.set('sw-cached-at', Date.now().toString());
      
      const cachedResponse = new Response(responseClone.body, {
        status: responseClone.status,
        statusText: responseClone.statusText,
        headers: headers
      });
      
      cache.put(request, cachedResponse);
    }
    
    return response;
  } catch (error) {
    // Try cache fallback
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      const cachedAt = cachedResponse.headers.get('sw-cached-at');
      const age = Date.now() - parseInt(cachedAt || '0');
      
      // Check if cache is still valid
      if (age < ttl * 1000) {
        console.log('[ServiceWorker] Serving from cache:', request.url);
        return cachedResponse;
      }
    }
    
    // Return offline response
    return new Response(
      JSON.stringify({ error: 'Offline', cached: false }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Cache first strategy with TTL
async function cacheFirst(request, cacheName, ttl) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    const cachedAt = cachedResponse.headers.get('sw-cached-at');
    const age = Date.now() - parseInt(cachedAt || '0');
    
    if (age < ttl * 1000) {
      console.log('[ServiceWorker] Serving from cache:', request.url);
      return cachedResponse;
    }
  }
  
  // Fetch from network
  try {
    const response = await fetch(request);
    
    if (response.ok) {
      const responseClone = response.clone();
      const headers = new Headers(responseClone.headers);
      headers.set('sw-cached-at', Date.now().toString());
      
      const cachedResponse = new Response(responseClone.body, {
        status: responseClone.status,
        statusText: responseClone.statusText,
        headers: headers
      });
      
      cache.put(request, cachedResponse);
    }
    
    return response;
  } catch (error) {
    // Return cached response even if expired
    if (cachedResponse) {
      console.log('[ServiceWorker] Offline - serving stale cache:', request.url);
      return cachedResponse;
    }
    
    throw error;
  }
}

// Handle static assets
async function handleStaticAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const response = await fetch(request);
    
    if (response.ok) {
      cache.put(request, response.clone());
    }
    
    return response;
  } catch (error) {
    // Return offline page for navigation requests
    if (request.mode === 'navigate') {
      const offlinePage = await cache.match('/index.html');
      if (offlinePage) {
        return offlinePage;
      }
    }
    
    throw error;
  }
}

// Handle CDN assets
async function handleCDNAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const response = await fetch(request);
    
    if (response.ok) {
      cache.put(request, response.clone());
    }
    
    return response;
  } catch (error) {
    console.warn('[ServiceWorker] CDN asset fetch failed:', request.url);
    throw error;
  }
}

// Handle large assets like VRM files
async function handleLargeAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  
  // Try cache first for large files
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    console.log('[ServiceWorker] Serving VRM from cache');
    return cachedResponse;
  }
  
  try {
    const response = await fetch(request);
    
    if (response.ok) {
      // Only cache if file size is reasonable (< 50MB)
      const contentLength = response.headers.get('content-length');
      if (!contentLength || parseInt(contentLength) < 50 * 1024 * 1024) {
        const responseClone = response.clone();
        cache.put(request, responseClone).catch(err => {
          console.warn('[ServiceWorker] Failed to cache large asset:', err);
        });
      }
    }
    
    return response;
  } catch (error) {
    console.error('[ServiceWorker] Failed to fetch VRM:', error);
    
    // Return error response
    return new Response(
      JSON.stringify({ error: 'Failed to load VRM model' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Message handler for cache management
self.addEventListener('message', (event) => {
  const { type, payload } = event.data;
  
  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
    
    case 'CLEAR_CACHE':
      event.waitUntil(
        caches.keys().then(cacheNames => {
          return Promise.all(
            cacheNames.map(cacheName => caches.delete(cacheName))
          );
        }).then(() => {
          event.ports[0].postMessage({ success: true });
        })
      );
      break;
    
    case 'CACHE_URLS':
      if (payload && payload.urls) {
        event.waitUntil(
          caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(payload.urls);
          }).then(() => {
            event.ports[0].postMessage({ success: true });
          })
        );
      }
      break;
  }
});

// Periodic cache cleanup (runs when browser allows)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'cleanup-cache') {
    event.waitUntil(cleanupOldCache());
  }
});

async function cleanupOldCache() {
  const cacheNames = await caches.keys();
  const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
  
  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    
    for (const request of requests) {
      const response = await cache.match(request);
      const cachedAt = response?.headers.get('sw-cached-at');
      
      if (cachedAt) {
        const age = Date.now() - parseInt(cachedAt);
        if (age > maxAge) {
          console.log('[ServiceWorker] Removing old cache entry:', request.url);
          await cache.delete(request);
        }
      }
    }
  }
}

console.log('[ServiceWorker] Script loaded');
