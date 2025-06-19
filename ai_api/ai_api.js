const https = require('https');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

// IMPORTANT: Replace "APIKey" with your actual Gemini API Key
const API_KEY =  "AIzaSyCvtMPDKK4oT_-1RB0MBOYoDwPjme6akoY"

if (!API_KEY) {
  console.error("Error: Please replace 'APIKey' with your actual Gemini API key in the script.");
  process.exit(1);
}

const fullUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;
const parsedUrl = new URL(fullUrl);

// --- Dynamically load data from JSON files ---
let transactionsData;
let servicesData;

try {
  // Read the transaction history from transactions.json
  transactionsData = fs.readFileSync(path.join(__dirname, 'transactions.json'), 'utf8');
  // Read the available services from services.json
  servicesData = fs.readFileSync(path.join(__dirname, 'services.json'), 'utf8');
} catch (error) {
  console.error("Error reading JSON data files:", error.message);
  console.error("Please ensure 'transactions.json' and 'services.json' exist in the same directory as the script.");
  process.exit(1);
}
// --- End of dynamic loading ---

// The prompt is now built dynamically using the loaded JSON data.
const prompt = `You are a helpful financial assistant. Your task is to analyze a user's bank transactions and provide relevant, timely recommendations for services they might need, based on a provided list of available services.

Analyze the provided bank transactions to identify patterns, recurring expenses, or significant one-off payments that suggest the user might benefit from certain services. Look for categories with high spending, multiple transactions in a short period, or transactions that indicate a specific need (e.g., car repair, home maintenance).

From the provided list of \`services\`, create a list of recommendations. For each recommendation, provide a brief, personalized explanation linking it to the user's specific spending. Present the recommendations as a list, where each item includes the Service Name, Business Name, and a "Reason for Recommendation".
Return a valid JSON, the Reasoning should be stated in slovak
the recommended services should be in this format: {
    public string Title { get; set; }
    public string Provider { get; set; }
    public string Description { get; set; }
    public string Category { get; set; }
    public double Rating { get; set; }
    public int RatingCount { get; set; }
    public double DistanceKm { get; set; }
    public string ClosesAt { get; set; }
    public string Price { get; set; }
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
  contents: [
    {
      parts: [
        {
          text: prompt
        }
      ]
    }
  ]
});

const options = {
  hostname: parsedUrl.hostname,
  path: parsedUrl.pathname + parsedUrl.search,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

console.log("Sending request to Gemini API...");

const req = https.request(options, (res) => {
  let responseBody = '';

  res.on('data', (chunk) => {
    responseBody += chunk;
  });

  res.on('end', () => {
    console.log("Received response.");
    if (res.statusCode >= 200 && res.statusCode < 300) {
      try {
        const parsedResponse = JSON.parse(responseBody);
        // Extracting and printing just the generated text content for clarity
        const generatedText = parsedResponse.candidates[0].content.parts[0].text;
        console.log("\n--- Generated Recommendations ---\n");
        console.log(generatedText);
        console.log("\n--- Full API Response ---");
        console.log(JSON.stringify(parsedResponse, null, 2));
      } catch (error) {
        console.error("Failed to parse JSON response:", error);
        console.error("Raw Response Body:", responseBody);
      }
    } else {
      console.error(`Error: Received status code ${res.statusCode}`);
      console.error('Response:', responseBody);
    }
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

// Write data to request body
req.write(postData);
req.end();