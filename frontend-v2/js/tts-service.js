const TTSService = {
    utterance: null,

    speak: function(text, onEndCallback) {
        if (speechSynthesis.speaking) {
            speechSynthesis.cancel();
        }

        this.utterance = new SpeechSynthesisUtterance(text);
        this.utterance.onend = () => {
            this.utterance = null;
            if (onEndCallback) {
                onEndCallback();
            }
        };
        
        this.utterance.onerror = (event) => {
            console.error('SpeechSynthesisUtterance.onerror', event);
            this.utterance = null;
            if (onEndCallback) {
                onEndCallback(); // Also call on error to reset UI
            }
        };

        speechSynthesis.speak(this.utterance);
    },

    pause: function() {
        if (speechSynthesis.speaking) {
            speechSynthesis.pause();
        }
    },

    resume: function() {
        if (speechSynthesis.paused) {
            speechSynthesis.resume();
        }
    },

    cancel: function() {
        if (speechSynthesis.speaking || speechSynthesis.paused) {
            speechSynthesis.cancel();
            this.utterance = null;
        }
    },

    isPlaying: function() {
        return speechSynthesis.speaking;
    },

    isPaused: function() {
        return speechSynthesis.paused;
    }
};

// Ensure any ongoing speech is stopped when the user navigates away
window.addEventListener('beforeunload', () => {
    TTSService.cancel();
});
