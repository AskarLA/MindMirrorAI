const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const https = require('https');

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
const GEMINI_API_VERSION = process.env.GEMINI_API_VERSION || 'v1beta';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemma-3-27b-it';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

// Validate API key on startup
if (!GEMINI_API_KEY) {
  console.error('ERROR: GEMINI_API_KEY is not set in .env file');
  process.exit(1);
}

// Helper function to list available models via REST API
async function listAvailableModels() {
  return new Promise((resolve, reject) => {
    const url = `${GEMINI_BASE_URL}/${GEMINI_API_VERSION}/models?key=${GEMINI_API_KEY}`;
    
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const response = JSON.parse(data);
            resolve(response);
          } else {
            const errorResponse = JSON.parse(data);
            reject(new Error(errorResponse.error?.message || `Failed to list models: ${res.statusCode}`));
          }
        } catch (error) {
          reject(new Error(`Failed to parse models list: ${error.message}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Request failed: ${error.message}`));
    });

    req.end();
  });
}

// Helper function to sleep/delay
function delay(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

// Helper function to extract retry delay from error response
function extractRetryDelay(errorResponse) {
  try {
    if (errorResponse.error?.details && Array.isArray(errorResponse.error.details)) {
      for (const detail of errorResponse.error.details) {
        if (detail.retryDelay) {
          return parseInt(detail.retryDelay, 10);
        }
      }
    }
  } catch (e) {
    // Ignore parsing errors
  }
  return 30; // Default to 30 seconds
}

// Helper function to call Gemini API via REST with retry logic
function callGeminiAPI(userText, modelName = GEMINI_MODEL, retryCount = 0, maxRetries = 3) {
  return new Promise((resolve, reject) => {
    const url = `${GEMINI_BASE_URL}/${GEMINI_API_VERSION}/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
    
    const requestBody = {
      contents: [{
        parts: [{
          text: `Ты — нейтральный аналитический ассистент.
Ты анализируешь текст ТОЛЬКО по стилю мышления, эмоциональной окраске и повторяющимся темам.

ВАЖНЫЕ ПРАВИЛА:
- Ты НЕ ставишь диагнозы
- Ты НЕ используешь медицинские или клинические термины
- Ты НЕ делаешь категоричных выводов
- Ты НЕ оцениваешь личность человека
- Ты НЕ даёшь советов

Используй мягкие формулировки (пример):
"Скорее отрицательное" вместо "Отрицательное";
"В тексте заметны сомнения в себе" вместо "Проблемы с самооценкой".

Верни результат СТРОГО в формате JSON, без markdown и без пояснений. Используй следующую структуру:
{
  "mood": {
    "label": "Скорее положительное | Нейтральное | Скорее отрицательное",
    "confidence": "низкая | средняя | высокая"
  },
  "themes": [
    "сомнения в себе",
    "неуверенность",
    "социальное сравнение",
    "саморефлексия"
  ],
  "tone": "Краткое описание тона (1–2 предложения)",
  "summary": "Краткое нейтральное описание содержания текста без выводов о личности",
  "disclaimer": "Этот анализ основан только на тексте и не является психологической оценкой или диагнозом."
}

Анализируемый текст: ${userText}`
        }]
      }]
    };
    
    const requestData = JSON.stringify(requestBody);

    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', async () => {
        try {
          // Log full response for debugging on errors
          if (res.statusCode !== 200) {
            console.error('Gemini API Error Response:', {
              statusCode: res.statusCode,
              statusMessage: res.statusMessage,
              body: data
            });
          }

          const response = JSON.parse(data);
          
          // Handle 429 (Rate Limit) with retry
          if (res.statusCode === 429 && retryCount < maxRetries) {
            const retryDelay = extractRetryDelay(response);
            console.log(`⏳ Rate limit (429) hit. Waiting ${retryDelay} seconds before retry ${retryCount + 1}/${maxRetries}...`);
            await delay(retryDelay);
            // Retry the request
            return callGeminiAPI(userText, modelName, retryCount + 1, maxRetries)
              .then(resolve)
              .catch(reject);
          }
          
          // Handle other non-200 status codes
          if (res.statusCode !== 200) {
            const errorMessage = response.error?.message || response.error?.code || `API request failed with status ${res.statusCode}`;
            reject(new Error(errorMessage));
            return;
          }

          // Extract generated text from response
          if (response.candidates && response.candidates[0]) {
            const candidate = response.candidates[0];
            
            // Check for finishReason
            if (candidate.finishReason && candidate.finishReason !== 'STOP') {
              console.warn('Gemini API finishReason:', candidate.finishReason);
            }
            
            // Extract text from content.parts
            if (candidate.content && candidate.content.parts && candidate.content.parts[0]) {
              const textResponse = candidate.content.parts[0].text;
              
              if (!textResponse) {
                reject(new Error('Empty response from Gemini API'));
                return;
              }
              
              // Try to parse JSON from the response, if it's wrapped in markdown code blocks, extract it
              let jsonText = textResponse.trim();
              if (jsonText.startsWith('```json')) {
                jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
              } else if (jsonText.startsWith('```')) {
                jsonText = jsonText.replace(/```\n?/g, '').trim();
              }
              
              try {
                const analysis = JSON.parse(jsonText);
                // Validate and ensure required fields exist
                resolve({
                  sentiment: analysis.sentiment || 'neutral',
                  themes: Array.isArray(analysis.themes) ? analysis.themes : [],
                  tone: analysis.tone || 'Not specified',
                  summary: analysis.summary || textResponse.substring(0, 200)
                });
              } catch (parseError) {
                // If parsing fails, return a structured response with the raw text as summary
                console.warn('Failed to parse JSON response, using fallback format');
                resolve({
                  sentiment: 'neutral',
                  themes: [],
                  tone: 'mixed',
                  summary: textResponse.substring(0, 500)
                });
              }
            } else {
              reject(new Error('Invalid response format: missing content.parts'));
            }
          } else {
            reject(new Error('Invalid response format: missing candidates'));
          }
        } catch (parseError) {
          console.error('Failed to parse API response:', parseError);
          console.error('Raw response data:', data);
          reject(new Error(`Failed to parse API response: ${parseError.message}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error('HTTP request error:', error);
      reject(new Error(`Request failed: ${error.message}`));
    });

    // Send request
    req.write(requestData);
    req.end();
  });
}

// API endpoint
app.post('/api/analyze', async (req, res) => {
  try {
    const { text } = req.body;

    // Validation
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({
        error: 'Please provide valid text to analyze',
        success: false
      });
    }

    if (text.length > 10000) {
      return res.status(400).json({
        error: 'Text is too long. Maximum 10,000 characters allowed.',
        success: false
      });
    }

    // Call Gemini API with fallback to alternative models
    let analysis;
    try {
      analysis = await callGeminiAPI(text.trim());
    } catch (error) {
      // If model not found, try alternative models
      if (error.message && (error.message.includes('not found') || error.message.includes('is not found'))) {
        console.warn(`Model ${GEMINI_MODEL} not found, trying alternative models...`);
        const alternativeModels = ['gemini-1.5-flash-latest', 'gemini-1.5-flash', 'gemini-1.5-pro'];
        
        for (const altModel of alternativeModels) {
          if (altModel === GEMINI_MODEL) continue;
          try {
            console.log(`Trying model: ${altModel}`);
            analysis = await callGeminiAPI(text.trim(), altModel);
            console.log(`✅ Successfully used model: ${altModel}`);
            break;
          } catch (altError) {
            console.warn(`Model ${altModel} failed: ${altError.message}`);
            continue;
          }
        }
        
        if (!analysis) {
          throw new Error('All models failed. Check available models at /api/models or in server logs.');
        }
      } else {
        throw error;
      }
    }

    // Return successful response
    res.json({
      success: true,
      analysis: analysis
    });

  } catch (error) {
    console.error('Error analyzing text:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'An error occurred while analyzing the text. Please try again.'
    });
  }
});

// API endpoint to check available models
app.get('/api/models', async (req, res) => {
  try {
    const models = await listAvailableModels();
    res.json({
      success: true,
      models: models.models || [],
      apiVersion: GEMINI_API_VERSION,
      currentModel: GEMINI_MODEL,
      baseUrl: GEMINI_BASE_URL
    });
  } catch (error) {
    console.error('Error listing models:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to list available models'
    });
  }
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 MindMirror AI server is running on http://localhost:${PORT}`);
  console.log(`📝 GEMINI_API_KEY: ${GEMINI_API_KEY ? '✅ Set' : '❌ Not set'}`);
  console.log(`🔧 API Version: ${GEMINI_API_VERSION}`);
  console.log(`🌐 Base URL: ${GEMINI_BASE_URL}`);
  console.log(`🤖 Model: ${GEMINI_MODEL}`);
  
  // Diagnostic: Check available models on startup
  try {
    console.log('\n📋 Диагностика: Проверка доступных моделей...');
    const models = await listAvailableModels();
    if (models.models && models.models.length > 0) {
      const availableModels = models.models.filter(m => 
        m.supportedGenerationMethods?.includes('generateContent')
      );
      
      console.log(`\n✅ Доступные модели (${availableModels.length}):`);
      availableModels.forEach(model => {
        const modelName = model.name.split('/').pop();
        const isCurrent = modelName === GEMINI_MODEL;
        console.log(`   ${isCurrent ? '👉' : '  '} ${modelName}${isCurrent ? ' (ТЕКУЩАЯ)' : ''}`);
      });
      
      // Check if current model is available
      const currentModelExists = availableModels.some(m => 
        m.name.split('/').pop() === GEMINI_MODEL
      );
      
      if (!currentModelExists) {
        console.log(`\n⚠️  ВНИМАНИЕ: Текущая модель '${GEMINI_MODEL}' не найдена в списке доступных!`);
        console.log(`   Используйте одну из доступных моделей выше или проверьте /api/models`);
      }
    } else {
      console.log('\n⚠️  Не удалось получить список моделей');
    }
  } catch (error) {
    console.error('\n⚠️  Ошибка при проверке доступных моделей:', error.message);
    console.log('   Сервер запустится, но доступность модели неизвестна.');
    console.log('   Проверьте: API ключ или доступность API в вашем регионе.');
  }
  console.log('');
});

