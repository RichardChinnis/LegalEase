/**
 * Congressional Data Service - Phase 3 Implementation
 * 
 * Service layer for fetching and managing congressional data
 * Integrates with congress.gov API proxy backend for real data
 * Maintains backward compatibility with existing UI components
 */

class CongressionalDataService {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
        this.currentCongress = null;
        this.congressFetchPromise = null; // Prevent multiple simultaneous fetches
    }
    
    /**
     * Get current congress number
     * @returns {Promise<number>} Current congress number
     */
    async getCurrentCongress() {
        if (this.currentCongress !== null) {
            return this.currentCongress;
        }
        
        // Prevent multiple simultaneous fetches
        if (this.congressFetchPromise) {
            return this.congressFetchPromise;
        }
        
        this.congressFetchPromise = this._fetchCurrentCongress();
        const result = await this.congressFetchPromise;
        this.congressFetchPromise = null;
        return result;
    }
    
    /**
     * Internal method to fetch current congress from API
     * @private
     */
    async _fetchCurrentCongress() {
        try {
            const api = this.getAPI();
            const response = await api.get('/api/congress/current');
            
            if (response.data && response.data.congress && response.data.congress.number) {
                this.currentCongress = response.data.congress.number;
                return this.currentCongress;
            }
            
            // Fallback to a reasonable default
            console.warn('[CongressionalDataService] Could not determine current congress, using 119 as default');
            this.currentCongress = 119;
            return this.currentCongress;
            
        } catch (error) {
            console.error('[CongressionalDataService] Error fetching current congress:', error);
            // Fallback to a reasonable default
            this.currentCongress = 119;
            return this.currentCongress;
        }
    }
    
    /**
     * Get congressional actions for user's representatives
     * @param {Array} representatives - Array of representative objects
     * @param {Object} options - Request options
     * @returns {Promise<Array>} Congressional actions
     */
    async getCongressionalActions(representatives = [], options = {}) {
        const { limit = 20, days = 30 } = options;
        
        try {
            // Check cache
            const cacheKey = `congressional-actions-${JSON.stringify(representatives.map(r => r.bioguideId || r.id))}-${limit}`;
            const cached = this.getFromCache(cacheKey);
            if (cached) {
                return cached;
            }
            
            
            // If no representatives, return empty array
            if (!representatives || representatives.length === 0) {
                return [];
            }
            
            // Get recent bills for each representative
            const actions = await this.fetchRepresentativeActions(representatives, limit);
            
            // Cache the result
            this.setCache(cacheKey, actions);
            
            return actions;
            
        } catch (error) {
            console.error('[CongressionalDataService] Error fetching congressional actions:', error);
            throw error;
        }
    }
    
    /**
     * Get spotlight bills (curated "In the News" legislation)
     * Uses the new /api/db/spotlight endpoint for curated content
     * @param {Object} options - Request options
     * @param {number} options.limit - Max results (default 5)
     * @param {string} options.category - Filter by category (breaking, trending, upcoming_vote, just_passed)
     * @returns {Promise<Array>} Spotlight bills with enhanced summaries
     */
    async getSpotlightBills(options = {}) {
        const { limit = 5, category = null } = options;

        try {
            // Check cache
            const cacheKey = `spotlight-bills-${limit}-${category || 'all'}`;
            const cached = this.getFromCache(cacheKey);
            if (cached) {
                return cached;
            }

            const api = this.getAPI();

            // Build query params
            const params = new URLSearchParams();
            params.append('limit', limit.toString());
            if (category) {
                params.append('category', category);
            }

            // Fetch from curated spotlight endpoint
            const response = await api.get(`/api/db/spotlight?${params}`);

            if (response.data && response.data.spotlights) {
                // Transform to frontend format
                const spotlightBills = response.data.spotlights.map(item =>
                    this.transformSpotlightBill(item)
                );

                // Cache the result
                this.setCache(cacheKey, spotlightBills);

                return spotlightBills;
            }

            // Fallback to recent bills if no curated spotlights
            console.warn('[CongressionalDataService] No curated spotlights, falling back to recent bills');
            const fallbackBills = await this.fetchRecentBills(limit);
            this.setCache(cacheKey, fallbackBills);
            return fallbackBills;

        } catch (error) {
            console.error('[CongressionalDataService] Error fetching spotlight bills:', error);
            // Fallback to recent bills on error
            try {
                return await this.fetchRecentBills(limit);
            } catch (fallbackError) {
                console.error('[CongressionalDataService] Fallback also failed:', fallbackError);
                throw error;
            }
        }
    }

    /**
     * Transform spotlight API response to frontend format
     * @param {Object} spotlightItem - Item from /api/db/spotlight response
     * @returns {Object} Transformed spotlight bill
     */
    transformSpotlightBill(spotlightItem) {
        const { spotlight, bill, summary } = spotlightItem;

        return {
            // Bill identification
            id: bill.id,
            type: bill.type?.toUpperCase() || 'H.R.',
            number: bill.number?.toString(),
            congress: bill.congress?.toString(),

            // Bill content
            title: bill.title || 'Untitled Bill',
            shortTitle: bill.shortTitle || null,
            policyArea: bill.policyArea || 'N/A',

            // Spotlight metadata
            spotlight: {
                id: spotlight.id,
                headline: spotlight.headline,
                newsContext: spotlight.newsContext,
                category: spotlight.category,
                priority: spotlight.priority
            },

            // Enhanced summary (cocktail party format)
            enhancedSummary: {
                oneLiner: summary?.oneLiner || null,
                theDebate: {
                    supporters: summary?.theDebate?.supporters || null,
                    critics: summary?.theDebate?.critics || null
                },
                affectsTags: summary?.affectsTags || []
            },

            // Status info
            status: this.determineBillStatusFromLatestAction(bill.latestAction?.text),
            lastAction: bill.latestAction?.date ? new Date(bill.latestAction.date) : null,
            latestActionText: bill.latestAction?.text || null,

            // Counts
            cosponsorsCount: bill.cosponsorsCount || 0,
            actionsCount: bill.actionsCount || 0,

            // Origin
            originChamber: bill.originChamber || null,
            introducedDate: bill.introducedDate ? new Date(bill.introducedDate) : null
        };
    }

    /**
     * Determine bill status from latest action text
     * @param {string} actionText - Latest action text
     * @returns {string} Status
     */
    determineBillStatusFromLatestAction(actionText) {
        if (!actionText) return 'Introduced';

        const text = actionText.toLowerCase();
        if (text.includes('became public law') || text.includes('signed by president')) {
            return 'Enacted';
        } else if (text.includes('passed house') && text.includes('passed senate')) {
            return 'Passed Both';
        } else if (text.includes('passed house')) {
            return 'Passed House';
        } else if (text.includes('passed senate')) {
            return 'Passed Senate';
        } else if (text.includes('committee')) {
            return 'In Committee';
        }
        return 'Introduced';
    }
    
    /**
     * Find representatives by location
     * @param {Object} location - Location data
     * @returns {Promise<Array>} Representatives
     */
    async findRepresentatives(location) {
        try {
            const { state, district } = location;
            
            // Check cache
            const cacheKey = `representatives-${state}-${district}`;
            const cached = this.getFromCache(cacheKey);
            if (cached) {
                return cached;
            }
            
            
            // Get representatives from congress.gov API
            const representatives = await this.fetchRepresentativesByLocation(state, district);
            
            // Cache the result
            this.setCache(cacheKey, representatives);
            
            return representatives;
            
        } catch (error) {
            console.error('[CongressionalDataService] Error finding representatives:', error);
            throw error;
        }
    }
    
    /**
     * Get bill summary/snippet from LLM service
     * @param {string} billId - Bill ID
     * @returns {Promise<Object>} LLM snippet
     */
    async getBillSignificance(billId) {
        try {
            // Check cache
            const cacheKey = `bill-significance-${billId}`;
            const cached = this.getFromCache(cacheKey);
            if (cached) {
                return cached;
            }
            
            
            // Get bill details and generate significance summary
            const significance = await this.fetchBillSignificance(billId);
            
            // Cache for shorter time
            this.setCache(cacheKey, significance, 2 * 60 * 1000); // 2 minutes
            
            return significance;
            
        } catch (error) {
            console.error(`[CongressionalDataService] Error getting bill significance for ${billId}:`, error);
            throw error;
        }
    }

    async getBillDetails(billId) {
        const cacheKey = `bill-details-${billId}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            const billParts = this.parseBillId(billId);
            if (!billParts) throw new Error('Invalid bill ID');

            const api = this.getAPI();
            // Use database endpoint instead of congress.gov proxy
            const response = await api.get(`/api/db/bill/${billParts.congress}/${billParts.type}/${billParts.number}`);
            
            const details = this.transformDatabaseBill(response.data.bill);
            this.setCache(cacheKey, details);
            return details;

        } catch (error) {
            console.error(`[CongressionalDataService] Error fetching bill details for ${billId}:`, error);
            console.warn(`[CongressionalDataService] Could not fetch details for bill ${billId}.`);
            throw error;
        }
    }

    async getBillSummaries(billId) {
        const cacheKey = `bill-summaries-${billId}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        try {
            const billParts = this.parseBillId(billId);
            if (!billParts) throw new Error('Invalid bill ID');

            const api = this.getAPI();
            // Use database endpoint instead of congress.gov proxy
            const response = await api.get(`/api/db/bill/${billParts.congress}/${billParts.type}/${billParts.number}/summaries`);
            
            const summaries = response.data.summaries;
            this.setCache(cacheKey, summaries);
            return summaries;

        } catch (error) {
            console.error(`[CongressionalDataService] Error fetching bill summaries for ${billId}:`, error);
            console.warn(`[CongressionalDataService] Could not fetch summaries for bill ${billId}.`);
            throw error;
        }
    }

    async getBillActions(billId) {
        const cacheKey = `bill-actions-${billId}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        try {
            const billParts = this.parseBillId(billId);
            if (!billParts) throw new Error('Invalid bill ID');

            const api = this.getAPI();
            // Use database endpoint instead of congress.gov proxy
            const response = await api.get(`/api/db/bill/${billParts.congress}/${billParts.type}/${billParts.number}/actions`);
            
            const actions = response.data.actions;
            this.setCache(cacheKey, actions);
            return actions;

        } catch (error) {
            console.error(`[CongressionalDataService] Error fetching bill actions for ${billId}:`, error);
            console.warn(`[CongressionalDataService] Could not fetch actions for bill ${billId}.`);
            throw error;
        }
    }

    async getBillCommittees(billId) {
        const cacheKey = `bill-committees-${billId}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        try {
            const billParts = this.parseBillId(billId);
            if (!billParts) throw new Error('Invalid bill ID');

            const api = this.getAPI();
            const response = await api.get(`/api/db/bill/${billParts.congress}/${billParts.type}/${billParts.number}/committees`);

            const committees = response.data.committees || [];
            this.setCache(cacheKey, committees);
            return committees;

        } catch (error) {
            console.error(`[CongressionalDataService] Error fetching bill committees for ${billId}:`, error);
            throw error;
        }
    }

    async getBillText(billId) {
        const cacheKey = `bill-text-${billId}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        try {
            const billParts = this.parseBillId(billId);
            if (!billParts) throw new Error('Invalid bill ID');

            const api = this.getAPI();
            const response = await api.get(`/api/db/bill/${billParts.congress}/${billParts.type}/${billParts.number}/text`);

            const textVersions = response.data.textVersions || [];
            this.setCache(cacheKey, textVersions);
            return textVersions;

        } catch (error) {
            console.error(`[CongressionalDataService] Error fetching bill text for ${billId}:`, error);
            throw error;
        }
    }

    /**
     * Get bill cosponsors
     * @param {string} billId - Bill ID in format "congress-type-number"
     * @returns {Promise<Array>} Array of cosponsor objects
     */
    async getBillCosponsors(billId) {
        const cacheKey = `bill-cosponsors-${billId}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        try {
            const billParts = this.parseBillId(billId);
            if (!billParts) throw new Error('Invalid bill ID');

            const api = this.getAPI();
            const response = await api.get(`/api/db/bill/${billParts.congress}/${billParts.type}/${billParts.number}/cosponsors`);

            const cosponsors = response.data.cosponsors || [];
            this.setCache(cacheKey, cosponsors);
            return cosponsors;
        } catch (error) {
            console.error(`[CongressionalDataService] Error fetching cosponsors for ${billId}:`, error);
            throw error;
        }
    }

    /**
     * Fetch representative actions using the dedicated feed endpoint
     * @param {Array} representatives - Array of representative objects
     * @param {number} limit - Number of actions to fetch
     * @returns {Promise<Array>} Congressional actions
     */
    async fetchRepresentativeActions(representatives, limit) {
        try {
            const api = this.getAPI();

            // Build query params - use bioguideIds for filtering by specific reps
            const params = new URLSearchParams();
            params.append('limit', limit.toString());

            if (representatives && representatives.length > 0) {
                // Get bioguide IDs from representatives
                const bioguideIds = representatives
                    .map(rep => rep.bioguideId || rep.id)
                    .filter(id => id)
                    .join(',');

                if (bioguideIds) {
                    params.append('bioguideIds', bioguideIds);
                }
            }

            // Fetch from the new feed endpoint
            const response = await api.get(`/api/feed/congressional-activity?${params}`);

            if (response.data && response.data.success && response.data.activities) {
                console.debug(`[CongressionalDataService] Fetched ${response.data.activities.length} activities from feed endpoint`);
                return response.data.activities;
            }

            console.warn('[CongressionalDataService] Feed endpoint returned no activities');
            return [];

        } catch (error) {
            console.error('[CongressionalDataService] Error in fetchRepresentativeActions:', error);
            throw error;
        }
    }
    
    /**
     * Fetch member information from database endpoint
     * @param {string} bioguideId - Member's bioguide ID
     * @returns {Promise<Object>} Member information
     */
    async fetchMemberInfo(bioguideId) {
        try {
            const api = this.getAPI();
            // Use database endpoint for better performance
            const response = await api.get(`/api/db/member/${bioguideId}`);
            return response.data;
        } catch (error) {
            console.error(`[CongressionalDataService] Error fetching member ${bioguideId}:`, error);
            throw error;
        }
    }
    
    /**
     * Fetch sponsored bills for a member
     * @param {string} bioguideId - Member's bioguide ID
     * @param {string} congress - Congress number
     * @returns {Promise<Array>} Sponsored bills
     */
    async fetchSponsoredBills(bioguideId, congress) {
        try {
            // This would require additional API endpoints or parsing member data
            // For now, return empty array and rely on recent bills
            return [];
        } catch (error) {
            console.error(`[CongressionalDataService] Error fetching sponsored bills for ${bioguideId}:`, error);
            return [];
        }
    }
    
    /**
     * Fetch recent bills using database endpoint with fallback to congress.gov API
     * @param {number} limit - Number of bills to fetch
     * @returns {Promise<Array>} Recent bills
     */
    async fetchRecentBills(limit = 20) {
        const api = this.getAPI();
        const congress = await this.getCurrentCongress();
        
        try {
            // Try database endpoint first for better performance (30-70x faster)
            console.debug(`[CongressionalDataService] Fetching recent bills from database endpoint: /api/db/bill/${congress}?limit=${limit}`);
            const dbResponse = await api.get(`/api/db/bill/${congress}?limit=${limit}`);
            
            // Handle database response format
            if (dbResponse.data && dbResponse.data.data && Array.isArray(dbResponse.data.data)) {
                console.debug(`[CongressionalDataService] Successfully fetched ${dbResponse.data.data.length} bills from database`);
                return dbResponse.data.data.map(bill => this.transformDatabaseBill(bill));
            } else if (dbResponse.data && dbResponse.data.bills && Array.isArray(dbResponse.data.bills)) {
                // Alternative response format
                console.debug(`[CongressionalDataService] Successfully fetched ${dbResponse.data.bills.length} bills from database (alt format)`);
                return dbResponse.data.bills.map(bill => this.transformDatabaseBill(bill));
            } else {
                console.warn('[CongressionalDataService] Database response format unexpected, falling back to Congress.gov API');
                throw new Error('Unexpected database response format');
            }
            
        } catch (dbError) {
            console.warn('[CongressionalDataService] Database endpoint failed, falling back to Congress.gov API:', dbError.message);
            
            try {
                // Fallback to congress.gov API endpoint
                console.debug(`[CongressionalDataService] Using Congress.gov API fallback: /api/bill/${congress}?limit=${limit}`);
                const apiResponse = await api.get(`/api/bill/${congress}?limit=${limit}`);
                
                if (apiResponse.data && apiResponse.data.bills) {
                    console.debug(`[CongressionalDataService] Successfully fetched ${apiResponse.data.bills.length} bills from Congress.gov API`);
                    return apiResponse.data.bills.map(bill => this.transformCongressApiBill(bill));
                }
                
                return [];
                
            } catch (apiError) {
                console.error('[CongressionalDataService] Both database and Congress.gov API endpoints failed:', {
                    dbError: dbError.message,
                    apiError: apiError.message
                });
                throw new Error(`Failed to fetch recent bills: Database (${dbError.message}), API (${apiError.message})`);
            }
        }
    }
    
    /**
     * Fetch representatives by state and district
     * @param {string} state - State code
     * @param {string} district - District number
     * @returns {Promise<Array>} Representatives
     */
    async fetchRepresentativesByLocation(state, district) {
        try {
            const api = this.getAPI();
            
            // Use database endpoint with state/district filters
            const params = new URLSearchParams({
                state: state.toUpperCase(),
                currentMember: 'true'
            });
            
            // Add district filter only if it's a valid district number
            if (district && district !== 'at-large' && !isNaN(parseInt(district))) {
                params.append('district', district);
            }
            
            const response = await api.get(`/api/db/member?${params}`);
            
            if (response.data && response.data.members) {
                return response.data.members.map(member => this.transformDatabaseMember(member));
            }
            
            return [];
            
        } catch (error) {
            console.error('[CongressionalDataService] Error in fetchRepresentativesByLocation:', error);
            throw error;
        }
    }
    
    /**
     * Fetch bill significance/summary
     * @param {string} billId - Bill ID
     * @returns {Promise<Object>} Bill significance
     */
    async fetchBillSignificance(billId) {
        try {
            const api = this.getAPI();
            
            // Parse bill ID to get congress, type, and number
            const billParts = this.parseBillId(billId);
            if (!billParts) {
                throw new Error('Invalid bill ID format');
            }
            
            // Fetch bill summaries using database endpoint
            const response = await api.get(`/api/db/bill/${billParts.congress}/${billParts.type}/${billParts.number}/summaries`);
            
            if (response.data && response.data.summaries && response.data.summaries.length > 0) {
                const latestSummary = response.data.summaries[0];
                return {
                    text: latestSummary.text || 'No summary available',
                    confidence: 0.9,
                    loading: false,
                    error: null
                };
            }
            
            // Fallback to bill title if no summary using database endpoint
            const billResponse = await api.get(`/api/db/bill/${billParts.congress}/${billParts.type}/${billParts.number}`);
            if (billResponse.data && billResponse.data.bill) {
                return {
                    text: `This is ${billResponse.data.bill.title || 'a congressional bill'}.`,
                    confidence: 0.6,
                    loading: false,
                    error: null
                };
            }
            
            throw new Error('No bill data found');
            
        } catch (error) {
            console.error(`[CongressionalDataService] Error fetching bill significance for ${billId}:`, error);
            throw error;
        }
    }
    
    /**
     * Transform database bill to internal format
     * @param {Object} dbBill - Bill from /db endpoint
     * @returns {Object} Transformed bill
     */
    transformDatabaseBill(dbBill) {
        return {
            id: `${dbBill.congress}-${dbBill.type?.toUpperCase()}-${dbBill.number}`,
            type: dbBill.type,
            number: dbBill.number?.toString(),
            congress: dbBill.congress?.toString(),
            title: dbBill.title || 'Untitled Bill',
            shortTitle: dbBill.shortTitle || null,
            originChamber: dbBill.originChamber,
            sponsor: this.transformDatabaseSponsor(dbBill.sponsors?.[0]),
            sponsors: dbBill.sponsors,
            cosponsorsCount: dbBill.cosponsors?.count || 0,
            amendmentsCount: dbBill.amendments?.count || 0,
            committeesCount: dbBill.committees?.count || 0,
            policyArea: dbBill.policyArea?.name || 'N/A',
            status: this.determineDatabaseBillStatus(dbBill),
            latestAction: dbBill.latestAction,
            lastAction: dbBill.latestAction?.actionDate ? new Date(dbBill.latestAction.actionDate) : new Date(dbBill.updateDate),
            introducedDate: dbBill.introducedDate ? new Date(dbBill.introducedDate) : null,
            url: dbBill.url || dbBill.legislationUrl,
            cboCostEstimateUrl: dbBill.cboCostEstimates?.[0]?.url || null,
            textVersions: dbBill.textVersions,
            subjects: dbBill.subjects,
            relatedBills: dbBill.relatedBills
        };
    }

    /**
     * Transform database member to internal format
     * @param {Object} dbMember - Member from /db endpoint
     * @returns {Object} Transformed member
     */
    transformDatabaseMember(dbMember) {
        return {
            id: dbMember.bioguideId,
            bioguideId: dbMember.bioguideId,
            firstName: dbMember.firstName,
            lastName: dbMember.lastName,
            fullName: dbMember.fullName,
            title: dbMember.honorificName,
            party: dbMember.party || 'N/A',
            partyName: dbMember.partyName,
            state: dbMember.state,
            stateName: dbMember.stateName,
            district: dbMember.district,
            chamber: dbMember.chamber, // API returns "House" or "Senate" directly
            photoUrl: dbMember.photoUrl || this.generatePhotoUrl(dbMember.bioguideId),
            url: dbMember.url || dbMember.officialUrl,
            birthYear: dbMember.birthYear,
            sponsoredLegislationCount: dbMember.sponsoredLegislation?.count,
            cosponsoredLegislationCount: dbMember.cosponsoredLegislation?.count
        };
    }

    /**
     * Transform database sponsor to internal format
     * @param {Object} dbSponsor - Sponsor from database
     * @returns {Object|null} Transformed sponsor
     */
    transformDatabaseSponsor(dbSponsor) {
        if (!dbSponsor) return null;
        
        return {
            name: dbSponsor.fullName,
            bioguideId: dbSponsor.bioguideId,
            party: dbSponsor.party
        };
    }

    /**
     * Determine bill status from database bill data
     * @param {Object} dbBill - Bill object from database
     * @returns {string} Status
     */
    determineDatabaseBillStatus(dbBill) {
        if (dbBill.latestAction) {
            const action = dbBill.latestAction.text || '';
            if (action.includes('Became Public Law')) {
                return 'Enacted';
            } else if (action.includes('Passed House') || action.includes('Passed Senate')) {
                return 'Passed Chamber';
            } else if (action.includes('Committee')) {
                return 'In Committee';
            }
        }
        return 'Introduced';
    }

    /**
     * Generate photo URL for member
     * @param {string} bioguideId - Member's bioguide ID
     * @returns {string} Photo URL
     */
    generatePhotoUrl(bioguideId) {
        // Use congress.gov photo service
        if (!bioguideId) return null;
        return `https://www.congress.gov/img/member/${bioguideId.toLowerCase()}_200.jpg`;
    }

    /**
     * Transform congress.gov API bill to internal format
     * @param {Object} apiBill - Bill from congress.gov API
     * @returns {Object} Transformed bill
     */
    transformCongressApiBill(bill) {
        const sponsor = bill.sponsors && bill.sponsors.length > 0 ? bill.sponsors[0] : null;
        return {
            id: `${bill.type?.toLowerCase().replace('.', '') || 'bill'}-${bill.number}-${bill.congress}`,
            type: bill.type || 'H.R.',
            number: bill.number?.toString() || '0',
            congress: bill.congress?.toString() || (this.currentCongress || 119).toString(),
            title: bill.title || 'Untitled Bill',
            shortTitle: bill.shortTitle || null,
            sponsor: sponsor ? {
                name: sponsor.fullName,
                bioguideId: sponsor.bioguideId,
                party: sponsor.party
            } : null,
            cosponsorsCount: bill.cosponsors?.count || 0,
            amendmentsCount: bill.amendments?.count || 0,
            committeesCount: bill.committees?.count || 0,
            cboCostEstimateUrl: bill.cboCostEstimate?.url || null,
            policyArea: bill.policyArea?.name || 'N/A',
            primarySubject: bill.policyArea?.name || 'General',
            status: this.determineBillStatus(bill),
            lastAction: bill.latestAction?.actionDate ? new Date(bill.latestAction.actionDate) : new Date(),
            significance: 'medium'
        };
    }
    
    /**
     * Transform sponsored bills to actions
     * @param {Object} representative - Representative object
     * @param {Array} bills - Array of bills
     * @returns {Array} Actions
     */
    transformSponsoredBillsToActions(representative, bills) {
        return bills.map(bill => ({
            id: `sponsored-${bill.id}-${representative.id}`,
            legislator: representative,
            action: {
                type: 'sponsored',
                timestamp: bill.lastAction || new Date(),
                committee: null
            },
            bill: bill,
            llmSnippet: {
                text: this.generateContextualSnippet(bill, 'sponsored'),
                confidence: 0.8,
                loading: false,
                error: null
            }
        }));
    }
    
    /**
     * Transform bills to generic actions
     * @param {Array} bills - Array of bills
     * @returns {Array} Actions
     */
    transformBillsToGenericActions(bills) {
        return bills.map((bill, index) => {
            const actionTypes = ['introduced', 'passed', 'amended', 'voted_on'];
            const actionType = actionTypes[index % actionTypes.length];
            
            return {
                id: `generic-${bill.id}-${actionType}`,
                legislator: {
                    id: `generic-legislator-${index}`,
                    firstName: 'Congressional',
                    lastName: 'Activity',
                    title: 'Activity',
                    party: 'N/A',
                    state: 'US',
                    district: null
                },
                action: {
                    type: actionType,
                    timestamp: bill.lastAction,
                    committee: null
                },
                bill: bill,
                llmSnippet: {
                    text: this.generateContextualSnippet(bill, actionType),
                    confidence: 0.7,
                    loading: false,
                    error: null
                }
            };
        });
    }
    
    /**
     * Parse bill ID to extract congress, type, and number
     * Supports multiple formats:
     *   - "119-HR-5350" (congress-type-number, from feed endpoint)
     *   - "hr-5350-119" (type-number-congress, legacy format)
     * @param {string} billId - Bill ID
     * @returns {Object|null} Parsed bill parts
     */
    parseBillId(billId) {
        if (!billId) return null;

        // Try format: congress-type-number (e.g., "119-HR-5350")
        const feedMatch = billId.match(/^(\d+)-([a-z]+)-(\d+)$/i);
        if (feedMatch) {
            const [, congress, typePrefix, number] = feedMatch;
            return {
                congress,
                type: this.normalizeType(typePrefix),
                number
            };
        }

        // Try format: type-number-congress (e.g., "hr-5350-119")
        const legacyMatch = billId.match(/^([a-z\.]+)-(\d+)-(\d+)$/i);
        if (legacyMatch) {
            const [, typePrefix, number, congress] = legacyMatch;
            return {
                congress,
                type: this.normalizeType(typePrefix),
                number
            };
        }

        return null;
    }

    /**
     * Normalize bill type to lowercase standard format
     * @param {string} typePrefix - Bill type prefix
     * @returns {string} Normalized type
     */
    normalizeType(typePrefix) {
        let type;
        
        switch (typePrefix.toLowerCase().replace('.', '')) {
            case 'hr':
                type = 'hr';
                break;
            case 's':
                type = 's';
                break;
            case 'hjres':
                type = 'hjres';
                break;
            case 'sjres':
                type = 'sjres';
                break;
            case 'hconres':
                type = 'hconres';
                break;
            case 'sconres':
                type = 'sconres';
                break;
            case 'hres':
                type = 'hres';
                break;
            case 'sres':
                type = 'sres';
                break;
            default:
                type = typePrefix.toLowerCase().replace('.', '');
        }

        return type;
    }

    /**
     * Determine bill status from congress.gov API data
     * @param {Object} bill - Bill object from API
     * @returns {string} Status
     */
    determineBillStatus(bill) {
        if (bill.latestAction) {
            const action = bill.latestAction.text || '';
            if (action.includes('Became Public Law')) {
                return 'Enacted';
            } else if (action.includes('Passed House') || action.includes('Passed Senate')) {
                return 'Passed Chamber';
            } else if (action.includes('Committee')) {
                return 'In Committee';
            }
        }
        return 'Introduced';
    }
    
    /**
     * Generate contextual snippet based on bill and action
     */
    generateContextualSnippet(bill, actionType) {
        const subject = bill.primarySubject || 'policy matters';
        const actionContext = {
            'sponsored': 'authored this legislation to address',
            'cosponsored': 'supported this bill that focuses on',
            'introduced': 'introduced legislation addressing',
            'voted_yes': 'voted in favor of this bill targeting',
            'voted_no': 'voted against this proposal concerning',
            'passed': 'advanced legislation addressing',
            'amended': 'modified legislation concerning',
            'voted_on': 'took action on legislation addressing'
        };

        const context = actionContext[actionType] || 'took action on legislation addressing';
        return `Congressional activity ${context} ${subject.toLowerCase()} with significant implications for policy development.`;
    }

    // ============================================
    // USER FOLLOWING OPERATIONS
    // ============================================

    /**
     * Get or create a user ID for anonymous users
     * Uses localStorage to persist the session ID
     * @returns {string} User ID
     */
    getUserId() {
        let userId = localStorage.getItem('congress-tracker-user-id');
        if (!userId) {
            userId = 'anon-' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
            localStorage.setItem('congress-tracker-user-id', userId);
        }
        return userId;
    }

    /**
     * Get all items a user is following
     * @param {string} followType - Optional filter by type (bill, topic, member)
     * @returns {Promise<Array>} Followed items
     */
    async getUserFollows(followType = null) {
        const userId = this.getUserId();

        try {
            const api = this.getAPI();
            let url = `/api/db/user/${encodeURIComponent(userId)}/follows`;
            if (followType) {
                url += `?type=${followType}`;
            }

            const response = await api.get(url);
            return response.data?.follows || [];

        } catch (error) {
            console.error('[CongressionalDataService] Error fetching user follows:', error);
            return [];
        }
    }

    /**
     * Get followed bills with full bill details
     * @returns {Promise<Array>} Followed bills with details
     */
    async getFollowedBills() {
        const userId = this.getUserId();

        try {
            const api = this.getAPI();
            const response = await api.get(`/api/db/user/${encodeURIComponent(userId)}/follows/bills`);
            return response.data?.bills || [];

        } catch (error) {
            console.error('[CongressionalDataService] Error fetching followed bills:', error);
            return [];
        }
    }

    /**
     * Follow an item (bill, topic, or member)
     * @param {string} followType - Type (bill, topic, member)
     * @param {string} targetId - ID of item to follow
     * @param {boolean} notify - Enable notifications (default false)
     * @returns {Promise<Object>} Created follow record
     */
    async followItem(followType, targetId, notify = false) {
        const userId = this.getUserId();

        // Validate required parameters
        if (!followType || !targetId) {
            console.error('[CongressionalDataService] followItem called with missing params:', { followType, targetId });
            throw new Error('followType and targetId are required');
        }

        try {
            const api = this.getAPI();
            // Backend expects snake_case: follow_type, target_id
            const response = await api.post(`/api/db/user/${encodeURIComponent(userId)}/follow`, {
                follow_type: followType,
                target_id: targetId,
                notify
            });

            // Clear any cached follow data
            this.clearFollowCache();

            return response.data;

        } catch (error) {
            console.error('[CongressionalDataService] Error following item:', error);
            throw error;
        }
    }

    /**
     * Unfollow an item
     * @param {string} followType - Type (bill, topic, member)
     * @param {string} targetId - ID of item to unfollow
     * @returns {Promise<boolean>} Success
     */
    async unfollowItem(followType, targetId) {
        const userId = this.getUserId();

        try {
            const api = this.getAPI();
            // Backend expects DELETE with body containing follow_type and target_id
            await api.delete(`/api/db/user/${encodeURIComponent(userId)}/follow`, {
                follow_type: followType,
                target_id: targetId
            });

            // Clear any cached follow data
            this.clearFollowCache();

            return true;

        } catch (error) {
            console.error('[CongressionalDataService] Error unfollowing item:', error);
            throw error;
        }
    }

    /**
     * Check if user is following an item
     * @param {string} followType - Type (bill, topic, member)
     * @param {string} targetId - Target ID
     * @returns {Promise<boolean>} Is following
     */
    async isFollowing(followType, targetId) {
        const userId = this.getUserId();

        // Check cache first
        const cacheKey = `following-${userId}-${followType}-${targetId}`;
        const cached = this.getFromCache(cacheKey);
        if (cached !== null) {
            return cached;
        }

        try {
            const api = this.getAPI();
            // Backend expects query params: follow_type and target_id
            const params = new URLSearchParams({
                follow_type: followType,
                target_id: targetId
            });
            const response = await api.get(`/api/db/user/${encodeURIComponent(userId)}/is-following?${params}`);

            const isFollowing = response.data?.isFollowing || false;
            this.setCache(cacheKey, isFollowing, 60 * 1000); // Cache for 1 minute

            return isFollowing;

        } catch (error) {
            console.error('[CongressionalDataService] Error checking follow status:', error);
            return false;
        }
    }

    /**
     * Toggle follow status for an item
     * @param {string} followType - Type (bill, topic, member)
     * @param {string} targetId - Target ID
     * @returns {Promise<boolean>} New follow status
     */
    async toggleFollow(followType, targetId) {
        const currentlyFollowing = await this.isFollowing(followType, targetId);

        if (currentlyFollowing) {
            await this.unfollowItem(followType, targetId);
            return false;
        } else {
            await this.followItem(followType, targetId);
            return true;
        }
    }

    /**
     * Clear follow-related cache entries
     */
    clearFollowCache() {
        const keysToDelete = [];
        for (const key of this.cache.keys()) {
            if (key.startsWith('following-') || key.startsWith('user-follows-')) {
                keysToDelete.push(key);
            }
        }
        keysToDelete.forEach(key => this.cache.delete(key));
    }

    // ============================================
    // ENHANCED SUMMARIES
    // ============================================

    /**
     * Get enhanced summaries for a bill
     * @param {string} billId - Bill ID (format: type-number-congress, e.g., "hr-1234-119")
     * @returns {Promise<Object>} Enhanced summaries by type
     */
    async getBillEnhancedSummaries(billId) {
        const cacheKey = `enhanced-summaries-${billId}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            const billParts = this.parseBillId(billId);
            if (!billParts) {
                throw new Error('Invalid bill ID format');
            }

            const api = this.getAPI();
            const response = await api.get(`/api/db/bill/${billParts.congress}/${billParts.type}/${billParts.number}/summaries/enhanced`);

            const summaries = response.data?.summaries || {};
            this.setCache(cacheKey, summaries, 5 * 60 * 1000); // Cache for 5 minutes

            return summaries;

        } catch (error) {
            console.error(`[CongressionalDataService] Error fetching enhanced summaries for ${billId}:`, error);
            return {};
        }
    }

    /**
     * Cache management
     */
    getFromCache(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < cached.timeout) {
            return cached.data;
        }
        if (cached) {
            this.cache.delete(key);
        }
        return null;
    }
    
    setCache(key, data, timeout = null) {
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            timeout: timeout || this.cacheTimeout
        });
    }
    
    clearCache() {
        this.cache.clear();
    }
    
    /**
     * Get API service instance
     * @returns {Object} API service
     */
    getAPI() {
        if (typeof API !== 'undefined') {
            return API;
        } else if (typeof window !== 'undefined' && window.API) {
            return window.API;
        } else {
            throw new Error('API service not available');
        }
    }
}

// Create singleton instance
const congressionalDataService = new CongressionalDataService();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CongressionalDataService;
} else {
    window.CongressionalDataService = CongressionalDataService;
    window.congressionalDataService = congressionalDataService;
}