# Online trhovisko

## Odkazy
*   **Prototyp nasadený tu:** [https://marketplace20250616175527-atfubufyccbweabb.polandcentral-01.azurewebsites.net](https://marketplace20250616175527-atfubufyccbweabb.polandcentral-01.azurewebsites.net)
*   **Figma designy:** [https://www.figma.com/design/dtdi72AW3w623UwsY9g2xl/TB-Marketplace?node-id=33-1717&t=tmAF53Zbe2m7kB7N-1](https://www.figma.com/design/dtdi72AW3w623UwsY9g2xl/TB-Marketplace?node-id=33-1717&t=tmAF53Zbe2m7kB7N-1)

# Financial Recommendation & Service Search Server


## API Endpoints

### 1. Get Financial Recommendations

*   **Endpoint:** `GET /recommend`
*   **Description:** Analyzes `transactions.json` and `services.json` to provide service recommendations.
*   **Example Request:**
    Open your browser or use `curl`:
    ```bash
    curl http://localhost:3000/recommend
    ```
*   **Example Successful Response (200 OK):**
    The response will be a JSON object containing a list of recommended services, each with a `Reason` (in Slovak).
    ```json
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
        // ... other recommendations
      ]
    }
    ```
    If no recommendations are suitable, it will return:
    ```json
    {
      "recommendations": []
    }
    ```

### 2. Search for Services

*   **Endpoint:** `GET /search`
*   **Description:** Searches `services.json` for services matching the provided query.
*   **Query Parameter:**
    *   `query` (required): The user's search term (e.g., "leaking toilet", "need new tires").
*   **Example Request:**
    Open your browser or use `curl`:
    ```bash
    curl "http://localhost:3000/search?query=My%20toilet%20is%20leaking"
    ```
    or
    ```bash
    curl "http://localhost:3000/search?query=oprava%20pokazenej%20klimatizácie"
    ```
*   **Example Successful Response (200 OK):**
    The response will be a JSON object containing a list of matching services, each with a `Reason` (in Slovak) why it's relevant.
    ```json
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
        // ... other matching services
      ]
    }
    ```
    If no services match the query, it will return:
    ```json
    {
      "recommendations": []
    }
    ```
*   **Example Error Response (400 Bad Request - Missing query):**
    ```json
    {
      "error": {
        "message": "Missing or empty query parameter.",
        "type": "ClientInputError"
      }
    }
    ```
