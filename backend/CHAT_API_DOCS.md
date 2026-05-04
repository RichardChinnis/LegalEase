# Chat API Documentation

## Overview
The Chat API provides endpoints for creating and managing conversations about Congressional bills using various LLM providers (OpenAI, Claude, Gemini, Ollama).

## Base URL
```
http://localhost:3000/api/chat
```

## Endpoints

### 1. Get Available Providers
Get a list of available LLM providers.

```http
GET /api/chat/providers
```

**Response:**
```json
{
  "providers": ["openai", "claude", "gemini"],
  "count": 3
}
```

### 2. Get Provider Models
Get available models for a specific provider.

```http
GET /api/chat/providers/{provider}/models
```

**Parameters:**
- `provider` (path): Provider name (`openai`, `claude`, `gemini`, `ollama`)

**Response:**
```json
{
  "provider": "openai",
  "models": [
    {
      "id": "gpt-3.5-turbo",
      "name": "GPT-3.5 Turbo",
      "contextLength": 16385,
      "costPer1kTokens": {
        "input": 0.0005,
        "output": 0.0015
      }
    }
  ],
  "count": 4
}
```

### 3. Estimate Token Count
Estimate the number of tokens for a given context configuration.

```http
POST /api/chat/estimate-tokens
```

**Request Body:**
```json
{
  "billInfo": {
    "congress": 118,
    "type": "hr",
    "number": 1,
    "title": "Bill Title"
  },
  "contextConfig": {
    "billTextVersion": "latest",
    "includeSponsor": true,
    "includeCosponsors": false,
    "summaryVersion": "latest",
    "includeCommitteeReports": false
  },
  "provider": "openai",
  "additionalText": "What is this bill about?"
}
```

**Response:**
```json
{
  "tokenCount": 1524,
  "contextSections": [
    {
      "type": "bill_text",
      "title": "Bill Text",
      "version": "latest"
    },
    {
      "type": "sponsor",
      "title": "Sponsor Information"
    }
  ],
  "provider": "openai"
}
```

### 4. Create Conversation
Create a new conversation about a bill.

```http
POST /api/chat/conversations
```

**Request Body:**
```json
{
  "billInfo": {
    "congress": 118,
    "type": "hr",
    "number": 1,
    "title": "Bill Title"
  },
  "contextConfig": {
    "billTextVersion": "latest",
    "includeSponsor": true,
    "includeCosponsors": false,
    "summaryVersion": "latest",
    "includeCommitteeReports": false
  },
  "provider": "openai",
  "model": "gpt-3.5-turbo"
}
```

**Response:**
```json
{
  "conversationId": "550e8400-e29b-41d4-a716-446655440000",
  "tokenCount": 1524,
  "contextSections": [
    {
      "type": "bill_text",
      "title": "Bill Text",
      "version": "latest"
    }
  ]
}
```

### 5. Get Conversation
Get conversation details and message history.

```http
GET /api/chat/conversations/{conversationId}
```

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "billInfo": {
    "congress": 118,
    "type": "hr",
    "number": 1,
    "title": "Bill Title"
  },
  "provider": "openai",
  "model": "gpt-3.5-turbo",
  "messages": [
    {
      "id": "msg-1",
      "role": "user",
      "content": "What is this bill about?",
      "timestamp": "2024-01-01T12:00:00Z",
      "tokenCount": 6
    },
    {
      "id": "msg-2",
      "role": "assistant",
      "content": "This bill...",
      "timestamp": "2024-01-01T12:00:05Z",
      "tokenCount": 150
    }
  ],
  "tokenCount": 1524,
  "createdAt": "2024-01-01T12:00:00Z",
  "updatedAt": "2024-01-01T12:00:05Z"
}
```

### 6. Send Message (Non-Streaming)
Send a message in a conversation and get the complete response.

```http
POST /api/chat/conversations/{conversationId}/messages
```

**Request Body:**
```json
{
  "message": "What is this bill about?",
  "maxTokens": 1000,
  "temperature": 0.7
}
```

**Response:**
```json
{
  "messageId": "msg-123",
  "content": "This bill is about...",
  "tokenCount": 150,
  "tokenUsage": {
    "prompt_tokens": 1524,
    "completion_tokens": 150,
    "total_tokens": 1674
  }
}
```

### 7. Send Message (Streaming)
Send a message and receive the response as a stream.

```http
POST /api/chat/conversations/{conversationId}/messages/stream
```

**Request Body:**
```json
{
  "message": "What is this bill about?",
  "maxTokens": 1000,
  "temperature": 0.7
}
```

**Response:** Server-Sent Events stream
```
data: {"type":"start","messageId":"msg-123"}

data: {"type":"content","content":"This","fullContent":"This"}

data: {"type":"content","content":" bill","fullContent":"This bill"}

data: {"type":"done","fullContent":"This bill is about...","tokenCount":150}
```

### 8. Update Conversation Context
Update the context configuration for an existing conversation.

```http
PUT /api/chat/conversations/{conversationId}/context
```

**Request Body:**
```json
{
  "contextConfig": {
    "billTextVersion": "latest",
    "includeSponsor": true,
    "includeCosponsors": true,
    "summaryVersion": "latest",
    "includeCommitteeReports": true
  }
}
```

**Response:**
```json
{
  "tokenCount": 2048,
  "contextSections": [
    {
      "type": "bill_text",
      "title": "Bill Text",
      "version": "latest"
    },
    {
      "type": "cosponsors",
      "title": "Cosponsors"
    }
  ]
}
```

### 9. Estimate Message Tokens
Estimate token usage for a new message in an existing conversation.

```http
POST /api/chat/conversations/{conversationId}/estimate-tokens
```

**Request Body:**
```json
{
  "message": "Can you explain section 3 in more detail?"
}
```

**Response:**
```json
{
  "messageTokens": 12,
  "contextTokens": 1524,
  "historyTokens": 256,
  "totalTokens": 1792
}
```

### 10. List Conversations
Get a list of all conversations.

```http
GET /api/chat/conversations
```

**Response:**
```json
{
  "conversations": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "billInfo": {
        "congress": 118,
        "type": "hr",
        "number": 1
      },
      "provider": "openai",
      "model": "gpt-3.5-turbo",
      "messageCount": 4,
      "createdAt": "2024-01-01T12:00:00Z",
      "updatedAt": "2024-01-01T12:05:00Z"
    }
  ],
  "count": 1
}
```

### 11. Delete Conversation
Delete a conversation and all its messages.

```http
DELETE /api/chat/conversations/{conversationId}
```

**Response:**
```json
{
  "success": true,
  "message": "Conversation deleted successfully"
}
```

## Context Configuration

The `contextConfig` object controls what information is included in the conversation context:

```json
{
  "billTextVersion": "latest" | "introduced-in-house" | "engrossed-in-house" | ...,
  "includeSponsor": boolean,
  "includeCosponsors": boolean,
  "summaryVersion": "latest" | specific summary type,
  "includeCommitteeReports": boolean
}
```

## Error Responses

All endpoints may return error responses in this format:

```json
{
  "error": "Error message describing what went wrong"
}
```

Common HTTP status codes:
- `400 Bad Request`: Invalid request parameters
- `404 Not Found`: Conversation not found
- `500 Internal Server Error`: Server-side error

## Rate Limiting

The API includes rate limiting:
- Standard API calls: 30 requests per minute
- Cache hits: 1000 requests per minute

Rate limit headers are included in responses:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining in current window
- `X-RateLimit-Reset`: Time when rate limit resets

## Authentication

Currently, the API does not require authentication. In production, authentication will be required for conversation persistence and user-specific features.

## Token Usage and Costs

Token usage is tracked for all LLM interactions. Different providers have different tokenization methods:

- **OpenAI**: Uses tiktoken with o200k_base encoding
- **Claude**: Estimated as 1.25x OpenAI tokens (Claude uses ~25% more tokens)
- **Gemini**: Basic estimation (4 chars per token)
- **Ollama**: Model-dependent estimation

Cost estimates are provided based on current provider pricing, but actual costs may vary.

## Debugging

### Debug Context Preview
Get a preview of the assembled context without creating a conversation:

```http
POST /api/chat/debug/context
```

**Request Body:**
```json
{
  "billInfo": {
    "congress": 118,
    "type": "hr",
    "number": 1
  },
  "contextConfig": {
    "billTextVersion": "latest",
    "includeSponsor": true
  }
}
```

**Response:**
```json
{
  "context": {
    "systemPrompt": "You are a knowledgeable assistant...",
    "billInfo": "Bill: HR 1 (118th Congress)...",
    "sections": [...]
  },
  "contextString": "Full assembled context as string...",
  "tokenCount": 1524
}
```