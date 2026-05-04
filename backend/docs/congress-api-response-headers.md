# Congress API Response Headers

Example response headers from Congress.gov API (api.congress.gov):

```
access-control-allow-origin: *
age: 2238
cache-control: no-store
cf-cache-status: HIT
cf-ray: 95e3c8a35873fefd-PDX
content-encoding: gzip
content-type: application/json
date: Sat, 12 Jul 2025 21:55:15 GMT
expires: Sat, 12 Jul 2025 21:32:57 GMT
last-modified: Sat, 12 Jul 2025 21:17:57 GMT
link: <https://api.congress.gov/v3/bill>; rel="canonical"
strict-transport-security: max-age=31536000; preload
vary: Accept-Encoding, Accept, Accept-Encoding
via: https/1.1 api-umbrella (ApacheTrafficServer [cMsSf ])
x-api-umbrella-request-id: co02ha45vga62md25d6g
x-cache: MISS
x-content-type-options: nosniff
x-frame-options: DENY
x-ratelimit-limit: 5000
x-ratelimit-remaining: 4999
x-vcap-request-id: 270e008a-2157-46a5-6868-3affc5e86d16
```

## Key Rate Limiting Headers

- **`x-ratelimit-limit: 5000`** - Total requests allowed per hour
- **`x-ratelimit-remaining: 4999`** - Remaining requests in current window

## Dynamic Rate Limiting Strategy

Based on these headers, implement dynamic rate limiting:

- **When `x-ratelimit-remaining >= 2000`**: No rate limiting (full speed)
- **When `x-ratelimit-remaining < 2000`**: Apply 1 request per second throttling

This allows for burst loading of initial data while protecting against quota exhaustion.