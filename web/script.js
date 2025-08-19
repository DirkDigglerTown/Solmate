// web/static.config.js
// Static file configuration for Vercel deployment
// Defines how static assets should be handled, cached, and served

module.exports = {
  // File type definitions and handling
  fileTypes: {
    // Binary files that need special handling
    binary: [
      '.vrm',    // VRM 3D models
      '.glb',    // GLB 3D models
      '.gltf',   // GLTF 3D models
      '.wasm',   // WebAssembly modules
      '.pdf',    // PDF documents
      '.zip',    // Compressed archives
      '.rar',
      '.7z',
      '.tar',
      '.gz'
    ],
    
    // Image files
    images: [
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.webp',
      '.svg',
      '.ico',
      '.avif'
    ],
    
    // Media files
    media: [
      '.mp3',
      '.wav',
      '.ogg',
      '.mp4',
      '.webm',
      '.avi',
      '.mov'
    ],
    
    // Font files
    fonts: [
      '.woff',
      '.woff2',
      '.ttf',
      '.otf',
      '.eot'
    ],
    
    // Text-based files
    text: [
      '.html',
      '.css',
      '.js',
      '.mjs',
      '.json',
      '.xml',
      '.txt',
      '.md',
      '.yml',
      '.yaml'
    ]
  },

  // Cache configuration for different asset types
  caching: {
    // Long-term cache (1 year) for immutable assets
    immutable: {
      pattern: /\.(vrm|glb|gltf|woff2?|ttf|otf|eot)$/i,
      maxAge: 31536000, // 1 year in seconds
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    },
    
    // Medium cache (1 week) for images and media
    static: {
      pattern: /\.(png|jpg|jpeg|gif|webp|svg|ico|avif|mp3|wav|ogg)$/i,
      maxAge: 604800, // 1 week in seconds
      headers: {
        'Cache-Control': 'public, max-age=604800'
      }
    },
    
    // Short cache (1 hour) for frequently updated files
    dynamic: {
      pattern: /\.(html|css|js|mjs|json)$/i,
      maxAge: 3600, // 1 hour in seconds
      headers: {
        'Cache-Control': 'public, max-age=3600, must-revalidate'
      }
    },
    
    // No cache for API responses
    noCache: {
      pattern: /^\/api\//,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    }
  },

  // MIME type mappings
  mimeTypes: {
    '.vrm': 'application/octet-stream',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.webmanifest': 'application/manifest+json'
  },

  // Compression settings
  compression: {
    // Enable Brotli and Gzip for text-based files
    brotli: true,
    gzip: true,
    
    // Threshold for compression (bytes)
    threshold: 1024,
    
    // Exclude already compressed formats
    exclude: /\.(br|gz|zip|rar|7z|png|jpg|jpeg|gif|webp|avif|mp3|wav|ogg|mp4|webm)$/i
  },

  // Security headers
  security: {
    // Default headers for all routes
    default: {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    },
    
    // CSP (Content Security Policy) - matches index.html
    csp: "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.openai.com https://mainnet.helius-rpc.com https://lite-api.jup.ag wss://mainnet.helius-rpc.com;"
  },

  // File size limits and warnings
  limits: {
    // Max file size for upload/serving (MB)
    maxFileSize: 50,
    
    // Warn if assets exceed these (bytes)
    warnSizes: {
      js: 200 * 1024,    // 200KB
      css: 100 * 1024,   // 100KB
      image: 500 * 1024, // 500KB per image
      vrm: 25 * 1024 * 1024 // 25MB for VRM
    }
  },

  // CDN integration for external assets
  cdn: {
    // Preconnect hints for faster loading
    preconnect: [
      'https://cdn.jsdelivr.net',
      'https://api.openai.com'
    ],
    
    // External assets to cache locally
    externals: [
      'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js',
      'https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/loaders/GLTFLoader.js',
      'https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@2.0.6/lib/three-vrm.module.js'
    ]
  },

  // Optimization settings
  optimization: {
    // Image optimization (resize/compress)
    images: {
      sizes: [320, 640, 1024], // Responsive sizes
      quality: 85,             // Compression level
      formats: ['webp', 'avif'] // Modern formats
    },
    
    // Asset expiration
    expiration: {
      images: 30, // 30 days
      scripts: 7, // 7 days
      styles: 7   // 7 days
    },
    
    // Minification settings
    minify: {
      html: true,
      css: true,
      js: true,
      removeComments: true,
      collapseWhitespace: true,
      removeAttributeQuotes: false // Keep quotes for better compatibility
    }
  },

  // Redirects and rewrites
  routing: {
    // Trailing slash handling
    trailingSlash: false,
    
   // Force HTTPS in production
    forceHTTPS: true,
    
    // Custom error pages
    errorPages: {
      404: '/404.html',
      500: '/500.html'
    }
  },

  // Monitoring and analytics
  monitoring: {
    // Enable Web Vitals tracking
    webVitals: true,
    
    // Performance budgets
    budgets: [
      {
        type: 'document',
        maxSize: 100 * 1024 // 100KB for HTML
      },
      {
        type: 'script',
        maxSize: 300 * 1024 // 300KB for JS
      },
      {
        type: 'style',
        maxSize: 100 * 1024 // 100KB for CSS
      },
      {
        type: 'image',
        maxSize: 500 * 1024 // 500KB per image
      },
      {
        type: 'total',
        maxSize: 2 * 1024 * 1024 // 2MB total page weight (excluding VRM)
      }
    ]
  },

  // Headers for specific file patterns
  customHeaders: [
    {
      source: '/assets/avatar/(.*).vrm',
      headers: [
        {
          key: 'Content-Type',
          value: 'application/octet-stream'
        },
        {
          key: 'Content-Disposition',
          value: 'inline; filename="solmate.vrm"'
        },
        {
          key: 'Cache-Control',
          value: 'public, max-age=604800'
        }
      ]
    },
    {
      source: '/manifest.webmanifest',
      headers: [
        {
          key: 'Content-Type',
          value: 'application/manifest+json'
        },
        {
          key: 'Cache-Control',
          value: 'public, max-age=3600'
        }
      ]
    },
    {
      source: '/api/(.*)',
      headers: [
        {
          key: 'Cache-Control',
          value: 'no-store'
        }
      ]
    }
  ],

  // Environment-specific settings
  environments: {
    development: {
      cache: false,
      minify: false,
      sourceMaps: true,
      verboseLogging: true
    },
    preview: {
      cache: true,
      minify: true,
      sourceMaps: true,
      verboseLogging: false
    },
    production: {
      cache: true,
      minify: true,
      sourceMaps: false,
      verboseLogging: false,
      compression: true,
      security: true // Enable full security headers
    }
  }
};