const http = require('http');
const https = require('https'); // For calling Gemini API
const { URL } = require('url'); // For parsing URLs
const fs = require('fs');
const path = require('path');

// Load environment variables from .env file (optional, but good practice)
// If you don't use dotenv, ensure GEMINI_API_KEY is set in your environment
try {
  require('dotenv').config();
} catch (e) {
  console.warn("dotenv package not found, ensure GEMINI_API_KEY is set in your environment variables.");
}

const port = process.env.PORT || 3000;

// IMPORTANT: Ensure GEMINI_API_KEY is set in your .env file or environment variables
const API_KEY = process.env.GEMINI_API_KEY;

/**
 * Makes an asynchronous request to the Gemini API.
 * @param {string} fullUrl - The full URL for the Gemini API endpoint.
 * @param {string} postDataString - The JSON stringified data to post.
 * @returns {Promise<object>} - A promise that resolves with the parsed JSON response from Gemini's generated text.
 */
function makeGeminiRequest(fullUrl, postDataString) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(fullUrl);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postDataString)
      }
    };

    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsedResponse = JSON.parse(responseBody);
            if (parsedResponse.candidates && parsedResponse.candidates[0] &&
                parsedResponse.candidates[0].content && parsedResponse.candidates[0].content.parts &&
                parsedResponse.candidates[0].content.parts[0] && parsedResponse.candidates[0].content.parts[0].text) {
              
              let generatedText = parsedResponse.candidates[0].content.parts[0].text;

              if (generatedText.startsWith("```json")) {
                generatedText = generatedText.substring(7);
                if (generatedText.endsWith("```")) {
                  generatedText = generatedText.substring(0, generatedText.length - 3);
                }
              }
              generatedText = generatedText.trim();

              try {
                const finalJson = JSON.parse(generatedText);
                resolve(finalJson);
              } catch (jsonParseError) {
                const err = new Error("The recommendation service generated invalid JSON.");
                err.type = "InvalidGeneratedJson";
                err.details = jsonParseError.message;
                err.generatedText = generatedText; 
                reject(err);
              }
            } else {
              const err = new Error("Unexpected response structure from the recommendation service.");
              err.type = "ApiResponseFormatError";
              err.fullResponse = parsedResponse; 
              reject(err);
            }
          } catch (error) {
            const err = new Error("Failed to parse response from the recommendation service.");
            err.type = "ApiResponseParseError";
            err.rawBody = responseBody; 
            err.details = error.message;
            reject(err);
          }
        } else {
          const err = new Error(`Recommendation service request failed with status code ${res.statusCode}.`);
          err.type = "ApiError";
          err.statusCode = res.statusCode;
          err.responseBody = responseBody;
          try {
            err.parsedError = JSON.parse(responseBody);
          } catch (e) { /* ignore if not JSON */ }
          reject(err);
        }
      });
    });

    req.on('error', (e) => {
      const err = new Error(`Network error during request to recommendation service: ${e.message}`);
      err.type = "RequestError";
      err.details = e;
      reject(err);
    });

    req.write(postDataString);
    req.end();
  });
}

/**
 * Generates financial recommendations by reading local data and calling the Gemini API.
 * @returns {Promise<object>} - A promise that resolves with the recommendation object.
 */
async function generateFinancialRecommendations() {
  if (!API_KEY) {
    const err = new Error("Gemini API key is missing. Configure GEMINI_API_KEY environment variable.");
    err.type = "ConfigurationError";
    throw err;
  }

  const modelName = "gemini-2.0-flash"; // Or "gemini-pro"
  const fullUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${API_KEY}`;

  let transactionsData;
  let servicesData;

  try {
    transactionsData = fs.readFileSync(path.join(__dirname, 'transactions.json'), 'utf8');
    servicesData = fs.readFileSync(path.join(__dirname, 'services.json'), 'utf8');
  } catch (error) {
    console.error("Error reading JSON data files:", error.message);
    const err = new Error("Failed to read required data files (transactions.json, services.json). Ensure they exist in the same directory as the server script.");
    err.type = "FileReadError";
    err.details = error.message;
    throw err;
  }

  const prompt = `You are a helpful financial assistant. Your task is to analyze a user's bank transactions and provide relevant, timely recommendations for services they might need, based on a provided list of available services.

Analyze the provided bank transactions to identify patterns, recurring expenses, or significant one-off payments that suggest the user might benefit from certain services. Look for categories with high spending, multiple transactions in a short period, or transactions that indicate a specific need (e.g., car repair, home maintenance).

From the provided list of \`services\`, create a list of recommendations. For each recommendation, provide a brief, personalized explanation linking it to the user's specific spending. Present the recommendations as a list, where each item includes the Service Name, Business Name, and a "Reason for Recommendation".
Return a valid JSON, the Reasoning should be stated in slovak and only contain a few words.
The recommended services should be in this format: {
    "Title": "Klíma Frozen",
    "Provider": "Frozen Klíma SK",
    "Description": "Predaj klimatizácií vrátane montáže v Bratislave a okolí.",
    "Category": "Remeselníci",
    "SubCategory": "Vykurovanie a chladenie",
    "Rating": 4.7,
    "RatingCount": 112,
    "DistanceKm": 1.3,
    "ClosesAt": "18:00",
    "Price": "od 1079 EUR",
    "ImageUrl": "images/banner_klima.png"
}
And the final output should be a JSON object with a single key "recommendations" which is an array of these service objects, including a "Reason" field for each. Example:
{
  "recommendations": [
    {
      "Title": "Pneuservis Ferko",
      "Provider": "Ferko's Pneu",
      "Description": "Rýchla oprava defektov a sezónne prezutie pneumatík za výhodné ceny.",
      "Category": "Auto",
      "SubCategory": "Výmena pneumatík",
      "Rating": 4.8,
      "RatingCount": 134,
      "DistanceKm": 1.5,
      "ClosesAt": "18:00",
      "Price": "od 20 EUR",
      "ImageUrl": "images/banner_auto.png",
      "Reason": "Časté výdavky za auto."
    }
  ]
}

**User Transactions:**
\`\`\`json
${transactionsData}
\`\`\`

**Available Services:**
\`\`\`json
${servicesData}
\`\`\`
`;

  const postData = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
  });

  console.log("Sending request to Gemini API...");
  const recommendations = await makeGeminiRequest(fullUrl, postData);
  console.log("Received and processed response from Gemini API.");
  return recommendations;
}

// Create the HTTP server
const server = http.createServer(async (req, res) => {
  // Simple router: only handle GET requests to /recommend
  if (req.method === 'GET' && req.url === '/recommend') {
    try {
      console.log(`[${new Date().toISOString()}] Received request for /recommend`);
      const recommendations = await generateFinancialRecommendations();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(recommendations));
      console.log(`[${new Date().toISOString()}] Successfully responded to /recommend`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error processing /recommend:`, error);

      let statusCode = 500;
      let clientErrorResponse = {
        error: {
          message: "An internal server error occurred while generating recommendations.",
          type: error.type || "InternalServerError",
          details: error.message // Default details
        }
      };

      if (error.type === "ApiError") {
        statusCode = error.statusCode >= 500 ? 502 : (error.statusCode === 429 ? 429 : 502); // 502 Bad Gateway, 429 Too Many Requests
        clientErrorResponse.error.message = "Failed to communicate with the underlying recommendation service.";
        if (error.parsedError && error.parsedError.error && error.parsedError.error.message) {
          clientErrorResponse.error.details = error.parsedError.error.message;
        } else {
          clientErrorResponse.error.details = `Service returned status ${error.statusCode}. Raw: ${String(error.responseBody).substring(0, 200)}`;
        }
      } else if (error.type === "InvalidGeneratedJson") {
        statusCode = 500;
        clientErrorResponse.error.message = "The recommendation service returned data in an unexpected format.";
        clientErrorResponse.error.details = "Could not parse the JSON content from the recommendation service's response.";
        console.error("Invalid JSON from Gemini:", error.generatedText);
      } else if (error.type === "ApiResponseFormatError" || error.type === "ApiResponseParseError") {
        statusCode = 500;
        clientErrorResponse.error.message = "Received a malformed response from the recommendation service.";
      } else if (error.type === "RequestError") {
        statusCode = 503; // Service Unavailable
        clientErrorResponse.error.message = "Could not connect to the recommendation service due to a network issue.";
      } else if (error.type === "ConfigurationError" || error.type === "FileReadError") {
        statusCode = 500;
        clientErrorResponse.error.message = "Server configuration error.";
        clientErrorResponse.error.details = error.message;
      }
      
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(clientErrorResponse));
    }
  } else {
    // Handle other routes (e.g., 404 Not Found)
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Not Found', type: 'NotFound' } }));
    console.log(`[${new Date().toISOString()}] Responded 404 for ${req.method} ${req.url}`);
  }
});

// Start the server
server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  console.log(`Access the endpoint at http://localhost:${port}/recommend`);
  if (!API_KEY) {
    console.warn("WARNING: GEMINI_API_KEY environment variable is not set. The /recommend endpoint will fail due to missing API key.");
  }
});

// Basic graceful shutdown (optional but good practice)
process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
