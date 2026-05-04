# Congress API Backend

This backend is a powerful, feature-rich Node.js application that serves as an intelligent proxy for the official Congress.gov API. It enhances the base API with caching, rate limiting, a persistent database layer, user authentication, and a sophisticated chat orchestration engine for interacting with legislative data via multiple Large Language Models (LLMs).

## Core Features

-   **Intelligent Caching Proxy:** Proxies requests to the Congress.gov API and caches responses in-memory (`node-cache`) to improve performance and adhere to upstream rate limits.
-   **Database Integration:** Uses a PostgreSQL database to persist user data, conversation history, and other application state.
-   **User Authentication:** Full JWT-based authentication system with endpoints for user registration and login.
-   **Multi-Provider LLM Chat:** A comprehensive chat API (`/api/chat`) that orchestrates conversations about legislative documents. It supports:
    -   **Multiple LLM Providers:** Integrates with OpenAI, Anthropic (Claude), Google (Gemini), and local models via Ollama.
    -   **Dynamic Context Assembly:** Intelligently builds prompts with relevant data like bill text, summaries, sponsors, and committee reports based on user configuration.
    -   **Streaming Support:** Provides real-time, streamed responses for a better user experience.
    -   **Conversation Persistence:** Saves and retrieves chat history from the database.
-   **Advanced Cost & Token Analysis:** Endpoints for accurately estimating token counts and predicting conversation costs *before* sending requests to LLMs.
-   **External Content Proxy:** Securely fetches external XML and PDF content (e.g., bill text) on behalf of the client.
-   **Production-Ready Monitoring:** Includes system health endpoints (`/health`, `/ready`, `/alive`) and a Prometheus-compatible `/metrics` endpoint for robust monitoring in containerized environments.
-   **API Documentation:** Automatically generated and interactive API documentation via Swagger, available at the `/api-docs` endpoint.
-   **Robust Middleware:** Includes security headers (Helmet), CORS, request validation, and application-level rate limiting.

## Tech Stack

-   **Framework:** Express.js
-   **Database:** PostgreSQL (with `pg` client)
-   **Caching:** `node-cache` (in-memory)
-   **Authentication:** JSON Web Tokens (JWT), `bcrypt`
-   **LLM SDKs:** `openai`, `@anthropic-ai/sdk`, `@google/generative-ai`, `ollama`
-   **API Documentation:** Swagger (`swagger-ui-express`, `swagger-jsdoc`)
-   **Testing:** Jest & Supertest
-   **Linting & Formatting:** ESLint & Prettier
-   **Logging:** Winston

## Prerequisites

-   Node.js (v18 or higher recommended)
-   npm
-   PostgreSQL Server

## Setup & Configuration

1.  **Install Dependencies:**
    ```bash
    npm install
    ```

2.  **Environment Variables:**
    Create a `.env` file in the `backend` directory by copying the `.env.example` file.

    ```bash
    cp .env.example .env
    ```

    Fill in the required values in your new `.env` file, including your Congress.gov API key, database connection string, and API keys for any LLM providers you wish to use.

3.  **Database Setup:**
    Ensure your PostgreSQL server is running and that the database specified in your `.env` file exists. The application does not automatically run migrations; you will need to set up the initial schema manually if one is required.

## Running the Server

-   **Production Mode:**
    ```bash
    npm start
    ```

-   **Development Mode (with auto-reloading via `nodemon`):**
    ```bash
    npm run dev
    ```

The server will start on the port specified in your `.env` file (defaults to 3000).

## API Endpoints

The API is documented using Swagger. Once the server is running, you can access the interactive documentation at:

**[http://localhost:3000/api-docs](http://localhost:3000/api-docs)**

The API is organized into the following categories:
-   **System:** Health, readiness, and metrics endpoints.
-   **Auth:** User registration and login.
-   **Data API (`/api`):** Endpoints for fetching data on bills, members, committees, etc.
-   **Chat API (`/api/chat`):** Endpoints for managing LLM conversations, providers, and cost analysis.
-   **Cache:** Endpoints for managing the in-memory cache.

## Project Structure

```
backend/
├── config/              # Configuration files (loaded via dotenv)
├── middleware/          # Express middleware (auth, rate limiting, validation)
├── routes/              # Express route definitions for different API sections
├── schemas/             # Joi validation schemas for request bodies
├── services/            # Core application logic (API clients, chat service, DB)
├── shared/              # Shared utilities, like the app factory
├── tests/               # Jest test files
├── utils/               # Utility functions (error handling, etc.)
├── .env.example         # Example environment file
├── logger.js            # Winston logger configuration
├── server.js            # Main application entry point
└── swagger.js           # Swagger/OpenAPI specification setup
```

## Key Services & Logic

-   **`shared/app-factory.js`:** Assembles the Express application, wiring up all middleware, routes, and services.
-   **`services/congress-api.js`:** The client for the official Congress.gov API. It handles request signing, caching, and parsing rate limit headers.
-   **`services/database.js`:** Manages the connection to the PostgreSQL database and contains repositories for data access (e.g., `ConversationRepository`).
-   **`services/chat-service.js`:** The central orchestrator for the chat functionality. It manages conversation state, assembles context, and interacts with the LLM providers.
-   **`services/llm-providers/`:** An abstraction layer that provides a consistent interface for different LLM providers, handling the unique aspects of each SDK.
-   **`services/context-assembler.js`:** Dynamically builds the context string (prompt) sent to the LLM based on user-selected options.

## Testing & Linting

-   **Run all tests:**
    ```bash
    npm test
    ```
-   **Run tests in watch mode:**
    ```bash
    npm run test:watch
    ```
-   **Generate a coverage report:**
    ```bash
    npm run test:coverage
    ```
-   **Check for linting errors:**
    ```bash
    npm run lint
    ```
-   **Automatically fix linting errors:**
    ```bash
    npm run lint:fix
    ```
-   **Format code with Prettier:**
    ```bash
    npm run format
    ```
