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
const GEMINI_MODEL_NAME = process.env.GEMINI_MODEL_NAME || "gemini-2.0-flash"; // Or "gemini-pro"

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
            // Check for potential error structure first
            if (parsedResponse.error) {
              const err = new Error(`Gemini API returned an error: ${parsedResponse.error.message}`);
              err.type = "GeminiApiError";
              err.details = parsedResponse.error;
              err.statusCode = parsedResponse.error.code || res.statusCode; // Use Gemini error code if available
              reject(err);
              return;
            }
            // Check for empty candidates (e.g. safety filters)
            if (!parsedResponse.candidates || parsedResponse.candidates.length === 0) {
                let message = "Gemini API returned no candidates. This might be due to safety filters or an issue with the prompt.";
                if (parsedResponse.promptFeedback && parsedResponse.promptFeedback.blockReason) {
                    message += ` Block reason: ${parsedResponse.promptFeedback.blockReason}.`;
                    if (parsedResponse.promptFeedback.safetyRatings) {
                        message += ` Safety ratings: ${JSON.stringify(parsedResponse.promptFeedback.safetyRatings)}`;
                    }
                }
                const err = new Error(message);
                err.type = "GeminiNoCandidatesError";
                err.fullResponse = parsedResponse;
                reject(err);
                return;
            }

            if (parsedResponse.candidates && parsedResponse.candidates[0] &&
                parsedResponse.candidates[0].content && parsedResponse.candidates[0].content.parts &&
                parsedResponse.candidates[0].content.parts[0] && parsedResponse.candidates[0].content.parts[0].text) {
              
              let generatedText = parsedResponse.candidates[0].content.parts[0].text;

              // Remove markdown code block fences if present
              if (generatedText.startsWith("```json")) {
                generatedText = generatedText.substring(7); // Remove ```json\n
                if (generatedText.endsWith("```")) {
                  generatedText = generatedText.substring(0, generatedText.length - 3);
                }
              } else if (generatedText.startsWith("```")) { // Handle ```TEXT``` case too
                generatedText = generatedText.substring(3);
                if (generatedText.endsWith("```")) {
                  generatedText = generatedText.substring(0, generatedText.length - 3);
                }
              }
              generatedText = generatedText.trim();

              try {
                const finalJson = JSON.parse(generatedText);
                resolve(finalJson);
              } catch (jsonParseError) {
                const err = new Error("The AI service generated invalid JSON.");
                err.type = "InvalidGeneratedJson";
                err.details = jsonParseError.message;
                err.generatedText = generatedText; 
                reject(err);
              }
            } else {
              const err = new Error("Unexpected response structure from the AI service.");
              err.type = "ApiResponseFormatError";
              err.fullResponse = parsedResponse; 
              reject(err);
            }
          } catch (error) {
            const err = new Error("Failed to parse response from the AI service.");
            err.type = "ApiResponseParseError";
            err.rawBody = responseBody; 
            err.details = error.message;
            reject(err);
          }
        } else {
          const err = new Error(`AI service request failed with status code ${res.statusCode}.`);
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
      const err = new Error(`Network error during request to AI service: ${e.message}`);
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

  const fullUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_NAME}:generateContent?key=${API_KEY}`;

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
Return a valid JSON. The "Reason" field should be stated in Slovak and only contain a few words.
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
The final output must be a JSON object with a single key "recommendations" which is an array of these service objects, each including a "Reason" field. Example:
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
If no specific recommendations can be made based on transactions, return an empty array for "recommendations":
{
  "recommendations": []
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
    // Optional: Add safety settings if needed
    // safetySettings: [
    //   { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    //   { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    //   { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    //   { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    // ],
  });

  console.log(`[${new Date().toISOString()}] Sending request to Gemini API for financial recommendations...`);
  const recommendations = await makeGeminiRequest(fullUrl, postData);
  console.log(`[${new Date().toISOString()}] Received and processed response from Gemini API for financial recommendations.`);
  return recommendations;
}


/**
 * Searches for services based on a user query using the Gemini API.
 * @param {string} userQuery - The user's search query.
 * @returns {Promise<object>} - A promise that resolves with the search results object.
 */
async function searchServices(userQuery) {
  if (!API_KEY) {
    const err = new Error("Gemini API key is missing. Configure GEMINI_API_KEY environment variable.");
    err.type = "ConfigurationError";
    throw err;
  }

  const fullUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_NAME}:generateContent?key=${API_KEY}`;

  let servicesData;
  try {
    servicesData = fs.readFileSync(path.join(__dirname, 'services.json'), 'utf8');
  } catch (error) {
    console.error("Error reading services.json data file:", error.message);
    const err = new Error("Failed to read required data file (services.json). Ensure it exists in the same directory as the server script.");
    err.type = "FileReadError";
    err.details = error.message;
    throw err;
  }

  const prompt = `You are a helpful search assistant. Your task is to find relevant services from a provided list based on a user's natural language query.

From the provided list of \`services\`, identify and return services that best match the user's query.
Present the results as a list of service objects. Each service object in the list should match the format of the services provided. Additionally, include a "Reason" field (in Slovak, a few words) explaining concisely why this service is relevant to the user's query.

Return a valid JSON object. This JSON object must have a single top-level key named "recommendations". The value of "recommendations" must be an array of service objects.
Each service object in the array must follow this format:
{
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
    "ImageUrl": "images/banner_klima.png",
    "Reason": "Dôvod relevantnosti voči dopytu."
}

Example of the complete expected JSON output:
{
  "recommendations": [
    {
      "Title": "Inštalatér NONSTOP",
      "Provider": "Vodoinštalácie Majster",
      "Description": "Opravy prasknutého potrubia, tečúcich WC a batérií.",
      "Category": "Remeselníci",
      "SubCategory": "Inštalatér",
      "Rating": 4.9,
      "RatingCount": 205,
      "DistanceKm": 2.1,
      "ClosesAt": "24/7",
      "Price": "od 50 EUR",
      "ImageUrl": "images/banner_instalater.png",
      "Reason": "Relevantné pre tečúce WC."
    }
  ]
}

If no relevant services are found for the query, return an empty array for "recommendations":
{
  "recommendations": []
}

**User Query:**
${userQuery}

**Available Services:**
\`\`\`json
${servicesData}
\`\`\`
`;

  const postData = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    // Optional: Add safety settings if needed
    // safetySettings: [
    //   { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    //   { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    //   { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    //   { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    // ],
  });

  console.log(`[${new Date().toISOString()}] Sending request to Gemini API for service search (query: "${userQuery}")...`);
  const searchResults = await makeGeminiRequest(fullUrl, postData);
  console.log(`[${new Date().toISOString()}] Received and processed response from Gemini API for service search.`);
  // To match the output format for the client, which expects "recommendations" key from makeGeminiRequest,
  // we ensure the prompt asks for it. If we wanted a different key like "search_results",
  // we'd need to adjust makeGeminiRequest or transform the result here.
  // For now, the prompt asks for "recommendations", so it should be fine.
  return searchResults;
}


// Create the HTTP server
const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = requestUrl;

  const handleRequestError = (error, endpointName) => {
    console.error(`[${new Date().toISOString()}] Error processing ${endpointName}:`, error);

    let statusCode = 500;
    let clientErrorResponse = {
      error: {
        message: "An internal server error occurred.",
        type: error.type || "InternalServerError",
        details: error.message // Default details
      }
    };

    if (error.type === "ApiError" || error.type === "GeminiApiError") {
      statusCode = error.statusCode >= 500 ? 502 : (error.statusCode === 429 ? 429 : 502); // 502 Bad Gateway, 429 Too Many Requests
      clientErrorResponse.error.message = "Failed to communicate with the underlying AI service.";
      if (error.parsedError && error.parsedError.error && error.parsedError.error.message) {
        clientErrorResponse.error.details = error.parsedError.error.message;
      } else if (error.details && typeof error.details === 'string') {
        clientErrorResponse.error.details = error.details;
      } else if (error.details && error.details.message) {
        clientErrorResponse.error.details = error.details.message;
      } else {
        clientErrorResponse.error.details = `Service returned status ${error.statusCode || 'unknown'}. Raw: ${String(error.responseBody || error.message).substring(0, 200)}`;
      }
    } else if (error.type === "GeminiNoCandidatesError") {
        statusCode = 500; // Or perhaps 200 with an empty list and a message, but 500 if it's an unexpected filter
        clientErrorResponse.error.message = "The AI service returned no valid content, possibly due to safety filters or prompt issues.";
        clientErrorResponse.error.details = error.message;
        console.error("GeminiNoCandidatesError details:", error.fullResponse);
    } else if (error.type === "InvalidGeneratedJson") {
      statusCode = 500;
      clientErrorResponse.error.message = "The AI service returned data in an unexpected format.";
      clientErrorResponse.error.details = "Could not parse the JSON content from the AI service's response.";
      console.error("Invalid JSON from AI service:", error.generatedText);
    } else if (error.type === "ApiResponseFormatError" || error.type === "ApiResponseParseError") {
      statusCode = 500;
      clientErrorResponse.error.message = "Received a malformed response from the AI service.";
      if(error.fullResponse) console.error("Malformed API Response:", error.fullResponse);
      if(error.rawBody) console.error("Raw malformed body:", error.rawBody);
    } else if (error.type === "RequestError") {
      statusCode = 503; // Service Unavailable
      clientErrorResponse.error.message = "Could not connect to the AI service due to a network issue.";
    } else if (error.type === "ConfigurationError" || error.type === "FileReadError") {
      statusCode = 500;
      clientErrorResponse.error.message = "Server configuration error.";
      clientErrorResponse.error.details = error.message;
    } else if (error.type === "ClientInputError") {
      statusCode = 400; // Bad Request
      clientErrorResponse.error.message = "Invalid client request.";
      clientErrorResponse.error.details = error.message;
    }
    
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(clientErrorResponse));
  };

  if (req.method === 'GET' && pathname === '/recommend') {
    try {
      console.log(`[${new Date().toISOString()}] Received request for /recommend`);
      const recommendations = await generateFinancialRecommendations();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(recommendations));
      console.log(`[${new Date().toISOString()}] Successfully responded to /recommend`);
    } catch (error) {
      handleRequestError(error, "/recommend");
    }
  } else if (req.method === 'GET' && pathname === '/search') {
    const userQuery = requestUrl.searchParams.get('query');
    if (!userQuery || userQuery.trim() === '') {
      console.log(`[${new Date().toISOString()}] Received bad request for /search: missing query parameter`);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Missing or empty query parameter.', type: 'ClientInputError' } }));
      return;
    }
    try {
      console.log(`[${new Date().toISOString()}] Received request for /search with query: "${userQuery}"`);
      const searchResults = await searchServices(userQuery);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // The searchServices function is prompted to return a structure like { "recommendations": [...] }
      // to align with makeGeminiRequest parsing.
      res.end(JSON.stringify(searchResults)); 
      console.log(`[${new Date().toISOString()}] Successfully responded to /search for query: "${userQuery}"`);
    } catch (error) {
      handleRequestError(error, `/search?query=${userQuery}`);
    }
  } else {
    // Handle other routes (e.g., 404 Not Found)
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Not Found', type: 'NotFound' } }));
    console.log(`[${new Date().toISOString()}] Responded 404 for ${req.method} ${pathname}`);
  }
});

// Start the server
server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  console.log(`Access financial recommendations at http://localhost:${port}/recommend`);
  console.log(`Search for services at http://localhost:${port}/search?query=your_search_term`);
  if (!API_KEY) {
    console.warn("WARNING: GEMINI_API_KEY environment variable is not set. API calls will fail.");
  }
  console.log(`Using Gemini Model: ${GEMINI_MODEL_NAME}`);
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
