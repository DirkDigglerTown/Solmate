// web/api/validate.js
// Input validation middleware with shared validation rules

const { logWarn } = require("./_utils.js");

// Validation rules
const rules = {
  // Text validation
  text: {
    minLength: 1,
    maxLength: 2000,
    pattern: /^[\s\S]+$/, // Allow any characters including newlines
    sanitize: (text) => {
      if (typeof text !== 'string') return '';
      return text
        .trim()
        .slice(0, rules.text.maxLength)
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // Remove control characters
    }
  },

  // Voice selection validation
  voice: {
    allowed: ['verse', 'alloy', 'aria', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
    default: 'nova',
    validate: (voice) => {
      if (!voice || !rules.voice.allowed.includes(voice)) {
        return rules.voice.default;
      }
      return voice;
    }
  },

  // Message validation for chat
  messages: {
    maxCount: 20,
    maxTotalLength: 10000,
    validate: (messages) => {
      if (!Array.isArray(messages)) return { valid: false, error: 'Messages must be an array' };
      if (messages.length === 0) return { valid: false, error: 'At least one message required' };
      if (messages.length > rules.messages.maxCount) {
        return { valid: false, error: `Maximum ${rules.messages.maxCount} messages allowed` };
      }

      let totalLength = 0;
      for (const msg of messages) {
        if (!msg.role || !msg.content) {
          return { valid: false, error: 'Each message must have role and content' };
        }
        if (!['system', 'user', 'assistant'].includes(msg.role)) {
          return { valid: false, error: 'Invalid message role' };
        }
        totalLength += msg.content.length;
      }

      if (totalLength > rules.messages.maxTotalLength) {
        return { valid: false, error: 'Messages too long' };
      }

      return { valid: true };
    }
  },

  // Token IDs validation
  tokenIds: {
    maxCount: 10,
    pattern: /^[A-Za-z0-9]{32,44}$/,
    validate: (ids) => {
      if (typeof ids !== 'string') return { valid: false, error: 'IDs must be a string' };
      
      const idArray = ids.split(',').map(id => id.trim());
      if (idArray.length > rules.tokenIds.maxCount) {
        return { valid: false, error: `Maximum ${rules.tokenIds.maxCount} token IDs allowed` };
      }

      for (const id of idArray) {
        if (!rules.tokenIds.pattern.test(id)) {
          return { valid: false, error: `Invalid token ID format: ${id}` };
        }
      }

      return { valid: true, ids: idArray };
    }
  },

  // Model validation
  model: {
    allowed: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo', 'gpt-4-turbo'],
    default: 'gpt-4o-mini',
    validate: (model) => {
      if (!model || !rules.model.allowed.includes(model)) {
        return rules.model.default;
      }
      return model;
    }
  },

  // Temperature validation
  temperature: {
    min: 0,
    max: 2,
    default: 0.6,
    validate: (temp) => {
      const parsed = parseFloat(temp);
      if (isNaN(parsed)) return rules.temperature.default;
      return Math.max(rules.temperature.min, Math.min(rules.temperature.max, parsed));
    }
  },

  // Max tokens validation
  maxTokens: {
    min: 1,
    max: 4000,
    default: 700,
    validate: (tokens) => {
      const parsed = parseInt(tokens);
      if (isNaN(parsed)) return rules.maxTokens.default;
      return Math.max(rules.maxTokens.min, Math.min(rules.maxTokens.max, parsed));
    }
  }
};

// Middleware functions
const validateChat = (body) => {
  const errors = [];
  const validated = {};

  // Validate messages
  const messagesResult = rules.messages.validate(body.messages);
  if (!messagesResult.valid) {
    errors.push(messagesResult.error);
  } else {
    validated.messages = body.messages.map(msg => ({
      role: msg.role,
      content: rules.text.sanitize(msg.content)
    }));
  }

  // Validate optional parameters
  validated.temperature = rules.temperature.validate(body.temperature);
  validated.max_tokens = rules.maxTokens.validate(body.max_tokens);
  validated.model = rules.model.validate(body.model);

  if (errors.length > 0) {
    return { valid: false, errors, data: null };
  }

  return { valid: true, errors: [], data: validated };
};

const validateTTS = (body) => {
  const errors = [];
  const validated = {};

  // Validate text
  if (!body.text || typeof body.text !== 'string') {
    errors.push('Text is required');
  } else {
    validated.text = rules.text.sanitize(body.text);
    if (validated.text.length === 0) {
      errors.push('Text cannot be empty');
    }
  }

  // Validate voice
  validated.voice = rules.voice.validate(body.voice);

  // Validate format
  validated.format = ['mp3', 'wav', 'opus', 'aac', 'flac'].includes(body.format) ? body.format : 'mp3';

  if (errors.length > 0) {
    return { valid: false, errors, data: null };
  }

  return { valid: true, errors: [], data: validated };
};

const validatePrice = (query) => {
  const validated = {};
  
  if (query.ids) {
    const result = rules.tokenIds.validate(query.ids);
    if (!result.valid) {
      return { valid: false, errors: [result.error], data: null };
    }
    validated.ids = result.ids.join(',');
  } else {
    // Default to SOL
    validated.ids = 'So11111111111111111111111111111111111111112';
  }

  return { valid: true, errors: [], data: validated };
};

// Request body size limit middleware
const bodySizeLimit = (maxSize = 1024 * 1024) => { // 1MB default
  return async (req, res, next) => {
    let size = 0;
    
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxSize) {
        res.statusCode = 413;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Request body too large' }));
        req.connection.destroy();
      }
    });

    if (next) next();
  };
};

// Input sanitization for XSS prevention
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
};

// SQL injection prevention (for future database integration)
const sanitizeSQL = (input) => {
  if (typeof input !== 'string') return input;
  
  return input
    .replace(/['";\\]/g, '')
    .replace(/--/g, '')
    .replace(/\/\*/g, '')
    .replace(/\*\//g, '')
    .replace(/xp_/gi, '')
    .replace(/sp_/gi, '');
};

// Export validation middleware
module.exports = {
  rules,
  validateChat,
  validateTTS,
  validatePrice,
  bodySizeLimit,
  sanitizeInput,
  sanitizeSQL,
  
  // Generic validation wrapper
  validate: (type) => {
    return async (req, res) => {
      let validation;
      
      switch(type) {
        case 'chat':
          validation = validateChat(req.body);
          break;
        case 'tts':
          validation = validateTTS(req.body);
          break;
        case 'price':
          validation = validatePrice(req.query);
          break;
        default:
          validation = { valid: false, errors: ['Unknown validation type'] };
      }

      if (!validation.valid) {
        logWarn(`VALIDATE_${type.toUpperCase()}`, { 
          errors: validation.errors,
          ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress
        });
        
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ 
          error: 'Validation failed', 
          details: validation.errors 
        }));
        return false;
      }

      req.validated = validation.data;
      return true;
    };
  }
};
