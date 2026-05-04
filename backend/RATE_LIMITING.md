# Backend Rate Limiting and Quota Tracking

## Overview

The backend employs a dynamic rate limiting paradigm to manage API usage and prevent hitting rate limits on the external Congress.gov API. Instead of a fixed rate limit, our system dynamically adjusts based on the rate limit headers returned by the external API. This ensures that we are always operating within the allowed quota.

The core of this system is designed to prevent service disruption by proactively throttling requests when the available quota is low.

## Key Components

- **`middleware/quota-tracker.js`**: This file contains the `QuotaTracker` class, which is the heart of the rate limiting logic. It is responsible for:
    - Storing the current quota information (limit, remaining requests, reset time).
    - Tracking the timestamp of the last update to detect stale data.
    - Determining if the system should be in a throttled state.

- **`middleware/index.js`**: This file implements the `dynamicQuotaLimiter` middleware. This function is registered on API routes and uses the `QuotaTracker` to decide whether to allow a request to proceed or to reject it with a `429 Too Many Requests` status.

- **`config/index.js`**: This configuration file defines two important parameters for the quota tracking system:
    - `throttleThreshold`: The number of remaining requests at which the system will begin throttling.
    - `staleTimeout`: The duration after which the stored quota information is considered stale, forcing the system into a throttled state until fresh data is received.

## Throttling Logic

The system will enter a throttled state (rejecting requests with a `429` error) under the following conditions:

1.  **Low Quota**: When the number of remaining requests (`x-ratelimit-remaining`) from the Congress API falls below the `throttleThreshold` defined in the configuration.
2.  **External API Rate Limit**: If the backend receives a `429 Too Many Requests` response from the external Congress API, it will immediately enter a throttled state.
3.  **Stale Quota Data**: If the quota information has not been updated within the `staleTimeout` period, the system will throttle requests to prevent operating with outdated (and potentially incorrect) rate limit data.

## Monitoring

A dedicated API endpoint is available to monitor the current status of the rate limiting system:

- **`GET /api/quota-status`**: Returns the current quota information, including whether the system is currently throttled. This is useful for real-time monitoring and diagnostics.

## How It Works: A Request Flow

1.  An incoming request to a protected route first passes through the `dynamicQuotaLimiter` middleware.
2.  The middleware checks the `QuotaTracker`'s status.
3.  If the tracker indicates the system is throttled, the middleware immediately rejects the request with a `429` status code.
4.  If not throttled, the request is forwarded to the appropriate service to be proxied to the external Congress API.
5.  After the response from the external API is received, the `x-ratelimit-*` headers are extracted.
6.  This new quota information is used to update the `QuotaTracker`, ensuring our system has the most recent data for subsequent requests.
