/**
 * Location Storage Service
 *
 * Manages user location preferences in localStorage for personalization.
 * Stores zip code, state, district, and cached representative data.
 */

const LocationService = {
    STORAGE_KEYS: {
        ZIP: 'congressTracker_zip',
        STATE: 'congressTracker_state',
        DISTRICT: 'congressTracker_district',
        LOCATION_DATA: 'congressTracker_locationData',
        REPRESENTATIVES: 'congressTracker_representatives',
        LAST_UPDATED: 'congressTracker_locationUpdated'
    },

    /**
     * Get stored zip code
     * @returns {string|null}
     */
    getZip() {
        return localStorage.getItem(this.STORAGE_KEYS.ZIP);
    },

    /**
     * Set zip code
     * @param {string} zip - 5-digit zip code
     * @returns {boolean} Success status
     */
    setZip(zip) {
        if (!this.isValidZip(zip)) {
            console.warn('[LocationService] Invalid zip code:', zip);
            return false;
        }
        localStorage.setItem(this.STORAGE_KEYS.ZIP, zip);
        localStorage.setItem(this.STORAGE_KEYS.LAST_UPDATED, new Date().toISOString());
        return true;
    },

    /**
     * Validate zip code format
     * @param {string} zip
     * @returns {boolean}
     */
    isValidZip(zip) {
        return /^\d{5}$/.test(zip);
    },

    /**
     * Get stored state code
     * @returns {string|null}
     */
    getState() {
        return localStorage.getItem(this.STORAGE_KEYS.STATE);
    },

    /**
     * Set state code
     * @param {string} state - 2-letter state code
     */
    setState(state) {
        if (state && state.length === 2) {
            localStorage.setItem(this.STORAGE_KEYS.STATE, state.toUpperCase());
        }
    },

    /**
     * Get stored district number
     * @returns {number|null}
     */
    getDistrict() {
        const district = localStorage.getItem(this.STORAGE_KEYS.DISTRICT);
        return district ? parseInt(district, 10) : null;
    },

    /**
     * Set district number
     * @param {number|string} district
     */
    setDistrict(district) {
        if (district !== null && district !== undefined) {
            localStorage.setItem(this.STORAGE_KEYS.DISTRICT, String(district));
        }
    },

    /**
     * Get full location data object
     * @returns {Object|null}
     */
    getLocationData() {
        try {
            const data = localStorage.getItem(this.STORAGE_KEYS.LOCATION_DATA);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error('[LocationService] Error parsing location data:', error);
            return null;
        }
    },

    /**
     * Set full location data
     * @param {Object} locationData - { zip, state, stateFullName, district, source }
     */
    setLocationData(locationData) {
        if (!locationData) return;

        try {
            localStorage.setItem(this.STORAGE_KEYS.LOCATION_DATA, JSON.stringify(locationData));

            // Also set individual fields for quick access
            if (locationData.zip) {
                localStorage.setItem(this.STORAGE_KEYS.ZIP, locationData.zip);
            }
            if (locationData.state) {
                localStorage.setItem(this.STORAGE_KEYS.STATE, locationData.state);
            }
            if (locationData.district !== null && locationData.district !== undefined) {
                localStorage.setItem(this.STORAGE_KEYS.DISTRICT, String(locationData.district));
            }

            localStorage.setItem(this.STORAGE_KEYS.LAST_UPDATED, new Date().toISOString());
        } catch (error) {
            console.error('[LocationService] Error saving location data:', error);
        }
    },

    /**
     * Get cached representatives
     * @returns {Array|null}
     */
    getRepresentatives() {
        try {
            const data = localStorage.getItem(this.STORAGE_KEYS.REPRESENTATIVES);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error('[LocationService] Error parsing representatives:', error);
            return null;
        }
    },

    /**
     * Set cached representatives
     * @param {Array} representatives
     */
    setRepresentatives(representatives) {
        if (!representatives) return;

        try {
            localStorage.setItem(this.STORAGE_KEYS.REPRESENTATIVES, JSON.stringify(representatives));
            localStorage.setItem(this.STORAGE_KEYS.LAST_UPDATED, new Date().toISOString());
        } catch (error) {
            console.error('[LocationService] Error saving representatives:', error);
        }
    },

    /**
     * Check if user has location set
     * @returns {boolean}
     */
    hasLocation() {
        return !!(this.getZip() || (this.getState() && this.getDistrict()));
    },

    /**
     * Get time since last update
     * @returns {number} Milliseconds since last update, or Infinity if never updated
     */
    getTimeSinceUpdate() {
        const lastUpdated = localStorage.getItem(this.STORAGE_KEYS.LAST_UPDATED);
        if (!lastUpdated) return Infinity;

        return Date.now() - new Date(lastUpdated).getTime();
    },

    /**
     * Check if cached data is stale (older than specified days)
     * @param {number} maxAgeDays - Maximum age in days (default: 30)
     * @returns {boolean}
     */
    isCacheStale(maxAgeDays = 30) {
        const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
        return this.getTimeSinceUpdate() > maxAgeMs;
    },

    /**
     * Clear all location data
     */
    clearLocation() {
        Object.values(this.STORAGE_KEYS).forEach(key => {
            localStorage.removeItem(key);
        });
    },

    /**
     * Get display string for current location
     * @returns {string}
     */
    getLocationDisplayString() {
        const state = this.getState();
        const district = this.getDistrict();

        if (!state) {
            return 'Location not set';
        }

        if (district === 0) {
            return `${state} (At-Large)`;
        }

        if (district) {
            return `${state}-${district}`;
        }

        return state;
    },

    /**
     * Get summary object for quick access
     * @returns {Object}
     */
    getSummary() {
        return {
            zip: this.getZip(),
            state: this.getState(),
            district: this.getDistrict(),
            hasLocation: this.hasLocation(),
            displayString: this.getLocationDisplayString(),
            isStale: this.isCacheStale(),
            representatives: this.getRepresentatives()
        };
    },

    /**
     * Save complete location lookup result
     * @param {Object} result - { zip, state, stateFullName, district, representatives }
     */
    saveLocationResult(result) {
        if (!result) return;

        this.setLocationData({
            zip: result.zip,
            state: result.state,
            stateFullName: result.stateFullName,
            district: result.district,
            source: result.source || 'api'
        });

        if (result.representatives) {
            this.setRepresentatives(result.representatives);
        }
    }
};

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LocationService;
} else {
    window.LocationService = LocationService;
}
