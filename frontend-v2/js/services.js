// /frontend/js/services.js

const HearingService = {
  /**
   * Fetches the transcript text for a given hearing from the 'Formatted Text' URL.
   * @param {object} hearingObject - The hearing object from AppState.
   * @returns {Promise<string|null>} A promise that resolves with the transcript text or null if not found.
   */
  async fetchTranscript(hearingObject) {
    if (!hearingObject || !hearingObject.formats || !Array.isArray(hearingObject.formats)) {
      console.error('Invalid hearing object provided.', hearingObject);
      return null;
    }

    // Find the URL for the 'Formatted Text' version of the transcript.
    const textFormat = hearingObject.formats.find(f => f.type === 'Formatted Text');
    if (!textFormat || !textFormat.url) {
      console.error('No "Formatted Text" URL found for this hearing.');
      return null;
    }

    try {
      // Manually construct the endpoint with the encoded URL parameter,
      // using the generic proxy for external content.
      const endpoint = `/api/xml-content?url=${encodeURIComponent(textFormat.url)}`;
      
      const response = await API.getText(endpoint);
      
      // The endpoint returns the content directly.
      if (response && typeof response.data === 'string') {
        return response.data;
      } else {
        console.error('Endpoint did not return a text string.', response);
        return null;
      }
    } catch (error) {
      let errorMessage = 'Failed to fetch hearing transcript';
      if (error && error.status) {
        errorMessage += `: Received status ${error.status}`;
      }
      console.error(`${errorMessage} from /api/xml-content endpoint:`, error);
      // Re-throw the error with more context to be caught by the UI layer
      throw new Error(`${errorMessage}. Please check the URL or network and try again.`);
      if (error.response) {
        console.error('Endpoint response error:', error.response.status, error.response.data);
      }
      return null;
    }
  },

  /**
   * Gets the URL for the PDF version of the hearing.
   * @param {object} hearingObject - The hearing object from AppState.
   * @returns {string|null} The URL of the PDF or null if not found.
   */
  getPDFUrl(hearingObject) {
    if (!hearingObject || !hearingObject.formats || !Array.isArray(hearingObject.formats)) {
      return null;
    }
    const pdfFormat = hearingObject.formats.find(f => f.type === 'PDF');
    return pdfFormat ? pdfFormat.url : null;
  }
};

// Export for use in other modules if a module system is in place,
// otherwise, it will be available on the window object if included via a script tag.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = HearingService;
} else {
  window.HearingService = HearingService;
}


// Initialize services when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const services = {};

    if (window.AuthService) {
        services.authService = new AuthService();
    }

    if (window.API) {
        services.apiService = window.API;
    }

    if (window.ChatAPIService) {
        services.chatAPIService = new ChatAPIService(services.apiService);
    }

    if (window.TokenEstimator) {
        services.tokenEstimator = new TokenEstimator(services.chatAPIService);
    }

    if (window.ModalManager) {
        services.modalManager = new ModalManager();
    }

    if (window.ChatModalManager) {
        ChatModalManager.init(services.modalManager);
        services.chatModalManager = window.ChatModalManager;
    }

    // Expose services globally
    window.Services = services;

    // Dispatch a custom event to notify that services are ready
    document.dispatchEvent(new CustomEvent('services-ready'));
});