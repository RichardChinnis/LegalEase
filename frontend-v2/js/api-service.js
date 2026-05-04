// API service layer with enhanced error handling
const API = {
    base: '', // Use relative paths since we're served from the same origin
    maxRetries: 3,
    baseDelay: 1000,
    
    init() {
        // This method is called by app-init.js to ensure a consistent initialization pattern.
        // No specific setup is needed here as the object is already configured.
    },

    async get(endpoint, options = {}) {
        const { skipRetry = false, retryCount = 0 } = options;
        
        // Check network connectivity
        if (AppState.isOnline === false) {
            const error = new Error('No internet connection');
            error.isNetworkError = true;
            throw error;
        }
        
        // Check rate limiting
        if (AppState.rateLimitState.isLimited) {
            const waitTime = AppState.rateLimitState.retryAfter - Date.now();
            if (waitTime > 0) {
                ErrorHandler.showNotification(`Rate limited. Please wait ${Math.ceil(waitTime / 1000)} seconds`, 'warning');
                throw new Error(`Rate limited. Retry after ${Math.ceil(waitTime / 1000)} seconds`);
            } else {
                AppState.rateLimitState.isLimited = false;
                AppState.rateLimitState.retryAfter = null;
            }
        }
        
        AppState.rateLimitState.activeRequests++;
        
        try {
            const url = `${this.base}${endpoint}`;
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
            
            const response = await fetch(url, {
                method: 'GET',
                mode: 'cors',
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            
            clearTimeout(timeoutId);
            
            // Handle rate limiting by throwing an error that the retry logic can catch
            if (response.status === 429) {
                const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
                error.status = response.status;
                error.isHttpError = true;
                throw error;
            }
            
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
                error.status = response.status;
                error.isHttpError = true;
                throw error;
            }
            
            let data;
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                data = await response.json();
            } else {
                throw new Error('Invalid response format: Expected JSON');
            }
            
            
            // Validate data structure
            if (!this.validateResponse(data, endpoint)) {
                throw new Error('Invalid response data structure');
            }
            
            // Return both data and cache status
            return {
                data: data,
                fromCache: response.headers.get('X-Data-Source') === 'cache'
            };
            
        } catch (error) {
            console.error(`[API] Fetch error for ${endpoint}:`, error);
            
            // Handle specific error types
            if (error.name === 'AbortError') {
                error.message = 'Request timeout. Please try again.';
                error.isTimeout = true;
                console.warn(`[API] Request for ${endpoint} timed out.`);
            } else if (error.name === 'TypeError' && (error.message.includes('Failed to fetch') || error.message.includes('fetch'))) {
                // This is likely a CORS issue or connection error (backend down)
                console.error(`[API] Network error for ${endpoint} - possible CORS issue or backend down:`, {
                    error: error.message,
                    stack: error.stack
                });
                error.message = 'Connection failed. Please check if the backend server is running and CORS is properly configured.';
                error.isNetworkError = true;
            }
            
            // Retry logic for certain errors
            if (!skipRetry && retryCount < this.maxRetries && this.shouldRetry(error)) {
                const delay = this.calculateDelay(retryCount);
                console.warn(`[API] Retrying ${endpoint} (attempt ${retryCount + 1}/${this.maxRetries}) in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.get(endpoint, { ...options, retryCount: retryCount + 1 });
            }
            
            this.handleError(endpoint, error);
            throw error;
        } finally {
            AppState.rateLimitState.activeRequests = Math.max(0, AppState.rateLimitState.activeRequests - 1);
        }
    },
    
    async getText(endpoint, options = {}) {
        if (AppState.isOnline === false) {
            const error = new Error('No internet connection');
            error.isNetworkError = true;
            throw error;
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

            const response = await fetch(`${this.base}${endpoint}`, {
                signal: controller.signal,
                headers: {
                    'Accept': 'text/html,application/xml'
                }
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
                error.status = response.status;
                error.isHttpError = true;
                throw error;
            }

            // Return the raw text content
            const text = await response.text();
            return {
                data: text,
                status: response.status
            };

        } catch (error) {
            if (error.name === 'AbortError') {
                error.message = 'Request timeout. Please try again.';
                error.isTimeout = true;
            }
            this.handleError(endpoint, error);
            throw error;
        }
    },

    async getHearings(congress) {
        if (!congress) {
            throw new Error('Congress number is required for fetching hearings.');
        }
        return this.get(`/api/db/hearing/${congress}?limit=50`);
    },

    async getHearingDetails(congress, chamber, jacketNumber) {
        if (!congress || !chamber || !jacketNumber) {
            throw new Error('Congress, chamber, and jacket number are required for fetching hearing details.');
        }
        return this.get(`/api/db/hearing/${congress}/${chamber}/${jacketNumber}`);
    },

    validateResponse(data, endpoint) {

        if (!data || typeof data !== 'object') {
            return false;
        }

        // Basic validation based on endpoint
        if (endpoint.includes('/feed/')) {
            // Feed endpoints return activities array with success flag
            const isValid = data.success && data.activities;
            return isValid;
        } else if (endpoint.includes('/spotlight')) {
            // Spotlight endpoint returns spotlights array
            const isValid = data.spotlights || data.spotlight || data.success;
            return isValid;
        } else if (endpoint.includes('/user') && endpoint.includes('/follow')) {
            // User follow endpoints
            const isValid = data.follows || data.bills || data.success || data.isFollowing !== undefined;
            return isValid;
        } else if (endpoint.includes('/bill')) {
            // Bill endpoints can return: bill, bills, actions, committees, cosponsors, summaries, subjects, titles, text/textVersions, amendments, relatedbills/relatedBills
            const isValid = data.bill || data.bills || data.actions || data.committees || data.cosponsors ||
                           data.summaries || data.subjects || data.titles || data.text || data.textVersions ||
                           data.amendments || data.relatedbills || data.relatedBills || data.data;
            return isValid;
        } else if (endpoint.includes('/congress')) {
            const isValid = data.congress || data.congresses || data.data;
            return isValid;
        } else if (endpoint.includes('/member')) {
            const isValid = data.member || data.members || data.data;
            return isValid;
        } else if (endpoint.includes('/hearing')) {
            const isValid = data.hearings || data.hearing || data.data;
            return isValid;
        }

        return true; // Default to valid for other endpoints
    },
    
    shouldRetry(error) {
        // Don't retry client errors (4xx) except rate limiting and timeouts
        if (error.status && error.status >= 400 && error.status < 500) {
            return error.status === 429 || error.isTimeout;
        }
        
        // Retry network errors and server errors (5xx)
        return error.isNetworkError || error.isTimeout || (error.status && error.status >= 500);
    },
    
    calculateDelay(retryCount) {
        // Exponential backoff with jitter
        const delay = this.baseDelay * Math.pow(2, retryCount);
        const jitter = Math.random() * 1000;
        return Math.min(delay + jitter, 30000); // Cap at 30 seconds
    },
    
    async post(endpoint, body = {}, options = {}) {
        // Check network connectivity
        if (AppState.isOnline === false) {
            const error = new Error('No internet connection');
            error.isNetworkError = true;
            throw error;
        }

        try {
            const url = `${this.base}${endpoint}`;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);

            const response = await fetch(url, {
                method: 'POST',
                mode: 'cors',
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
                error.status = response.status;
                error.isHttpError = true;
                throw error;
            }

            const data = await response.json();
            return { data };

        } catch (error) {
            console.error(`[API] POST error for ${endpoint}:`, error);
            if (error.name === 'AbortError') {
                error.message = 'Request timeout. Please try again.';
                error.isTimeout = true;
            }
            throw error;
        }
    },

    async delete(endpoint, body = null, options = {}) {
        // Check network connectivity
        if (AppState.isOnline === false) {
            const error = new Error('No internet connection');
            error.isNetworkError = true;
            throw error;
        }

        try {
            const url = `${this.base}${endpoint}`;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);

            const fetchOptions = {
                method: 'DELETE',
                mode: 'cors',
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            };

            // Add body if provided
            if (body) {
                fetchOptions.body = JSON.stringify(body);
            }

            const response = await fetch(url, fetchOptions);

            clearTimeout(timeoutId);

            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
                error.status = response.status;
                error.isHttpError = true;
                throw error;
            }

            // DELETE may not return a body
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                const data = await response.json();
                return { data };
            }
            return { data: { success: true } };

        } catch (error) {
            console.error(`[API] DELETE error for ${endpoint}:`, error);
            if (error.name === 'AbortError') {
                error.message = 'Request timeout. Please try again.';
                error.isTimeout = true;
            }
            throw error;
        }
    },

    handleError(endpoint, error) {
        const timestamp = new Date().toISOString();
        const errorMessage = `[${timestamp}] API Error for ${endpoint}: ${error.message}`;

        AppState.errorCount++;

        // Show appropriate error message to user
        if (error.isNetworkError) {
            // Add to retry queue for when connection is restored
            AppState.retryQueue.push({
                endpoint,
                retry: () => this.get(endpoint, { skipRetry: true })
            });
            ErrorHandler.showNotification('Connection lost. Will retry when online.', 'warning');
        } else if (error.isRateLimit) {
            ErrorHandler.showNotification(error.message, 'warning');
        } else if (error.isTimeout) {
            ErrorHandler.showRetryableError(
                'Request timed out. Check your connection.',
                () => this.get(endpoint, { skipRetry: true })
            );
        } else if (error.status && error.status >= 500) {
            ErrorHandler.showRetryableError(
                'Server error. Please try again.',
                () => this.get(endpoint, { skipRetry: true })
            );
        } else {
            ErrorHandler.showNotification(`Error: ${error.message}`, 'error');
        }
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
} else {
    window.API = API;
}