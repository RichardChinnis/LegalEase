// Background data fetching
const DataManager = {
    async fetchCongressInfo() {
        try {
            const response = await API.get('/api/congress/current');
            
            // Extract congress data from nested structure
            const congressData = response.data.data?.congress || response.data.congress || response.data;
            
            if (!congressData || !congressData.number) {
                throw new Error('Invalid congress data structure');
            }
            
            AppState.currentCongress = congressData;
            UI.renderCongressInfo(congressData);
            return congressData;
        } catch (error) {
            
            // Determine if this is a connection error (backend down)
            const isConnectionError = error.message.includes('failed to fetch') || 
                                    error.message.includes('Network Error') ||
                                    error.message.includes('ERR_CONNECTION_REFUSED');
            
            if (isConnectionError) {
                throw new Error('Unable to connect to Congress API server. Please ensure the backend service is running.');
            } else {
                throw new Error(`Failed to fetch congress information: ${error.message}`);
            }
        }
    },
    
    async fetchLatestContent() {
        try {
            const [billResponse, lawResponse, hearingResponse] = await Promise.all([
                API.get('/api/db/bill?limit=150'),
                API.get(`/api/db/law/${AppState.currentCongress.number}?limit=20`),
                API.getHearings(AppState.currentCongress.number)
            ]);

            const bills = (billResponse.data.bills || []).map(item => ({ ...item, contentType: 'bill', sortDate: item.latestAction?.actionDate || item.updateDate }));
            const laws = (lawResponse.data.bills || []).map(item => ({ ...item, contentType: 'law', sortDate: item.latestAction?.actionDate || item.updateDate }));
            const hearings = (hearingResponse.data.hearings || []).map(item => ({ ...item, contentType: 'hearing', sortDate: item.updateDate }));

            const combinedContent = [...bills, ...laws, ...hearings];
            combinedContent.sort((a, b) => new Date(b.sortDate) - new Date(a.sortDate));

            if (combinedContent.length === 0) {
                throw new Error('No content found');
            }

            // Store the initial sorted list in AppState
            AppState.contentList = combinedContent;

            combinedContent.forEach(item => {
                let id;
                if (item.contentType === 'bill') {
                    id = item.number;
                } else if (item.contentType === 'law') {
                    id = `${item.type}-${item.number}`;
                } else { // hearing
                    id = `${item.chamber}-${item.jacketNumber}`;
                }
                AppState.bills.set(id, item);
            });

            AppState.detailsQueue = combinedContent.map(item => {
                if (item.contentType === 'law') {
                    const lawNumberString = item.laws[0]?.number || '';
                    const lawNumber = lawNumberString.split('-').pop();
                    return {
                        congress: item.congress,
                        billType: item.type,
                        billNumber: item.number,
                        lawType: item.laws[0]?.type,
                        lawNumber: lawNumber,
                        contentType: item.contentType
                    };
                } else if (item.contentType === 'hearing') {
                    return {
                        congress: item.congress,
                        chamber: item.chamber,
                        jacketNumber: item.jacketNumber,
                        contentType: item.contentType
                    };
                }
                return {
                    congress: item.congress,
                    type: item.type,
                    number: item.number,
                    contentType: item.contentType
                };
            });

            UI.renderContentGrid(combinedContent);
            this.startDetailsFetching();

            return combinedContent;
        } catch (error) {
            throw new Error(`Failed to fetch latest content: ${error.message}`);
        }
    },

    startDetailsFetching() {
        if (AppState.isLoadingDetails || AppState.detailsQueue.length === 0) {
            return;
        }

        AppState.isLoadingDetails = true;
        UI.showLoading('Loading details...');

        this.fetchNextContentDetails();
    },

    async fetchNextContentDetails() {
        if (AppState.detailsQueue.length === 0) {
            AppState.isLoadingDetails = false;
            UI.hideLoading();
            return;
        }

        const item = AppState.detailsQueue.shift();
        const { contentType, congress } = item;
        
        let id, endpoint, lookupType, lookupNumber;

        if (contentType === 'bill') {
            id = item.number;
            endpoint = `/api/db/bill/${congress}/${item.type.toLowerCase()}/${item.number}`;
            lookupType = item.type;
            lookupNumber = item.number;
        } else if (contentType === 'law') {
            id = `${item.billType}-${item.billNumber}`;
            const apiLawType = item.lawType === 'Public Law' ? 'pub' : 'priv';
            endpoint = `/api/db/law/${congress}/${apiLawType}/${item.lawNumber}`;
            lookupType = item.billType;
            lookupNumber = item.billNumber;
        } else { // hearing
            id = `${item.chamber}-${item.jacketNumber}`;
            endpoint = `/api/db/hearing/${congress}/${item.chamber.toLowerCase()}/${item.jacketNumber}`;
            lookupType = 'hearing';
            lookupNumber = id;
        }

        try {
            const response = await API.get(endpoint);
            const detailsData = response.data.bill || response.data.law || response.data.hearing || response.data;

            if (AppState.bills.has(id)) {
                const existingItem = AppState.bills.get(id);
                const updatedItem = { ...existingItem, ...detailsData };
                AppState.bills.set(id, updatedItem);

                // If the item is a hearing, check if we need to re-sort the main list
                if (updatedItem.contentType === 'hearing' && updatedItem.dates && updatedItem.dates.length > 0) {
                    const hearingDate = updatedItem.dates[0].date;
                    const contentItem = AppState.contentList.find(item => item.contentType === 'hearing' && item.chamber === updatedItem.chamber && item.jacketNumber === updatedItem.jacketNumber);
                    
                    if (contentItem && contentItem.sortDate !== hearingDate) {
                        contentItem.sortDate = hearingDate;
                        // Also update the date on the main item in the map
                        updatedItem.sortDate = hearingDate;
                        AppState.bills.set(id, updatedItem);

                        // Re-sort the main list and re-render the grid
                        AppState.contentList.sort((a, b) => new Date(b.sortDate) - new Date(a.sortDate));
                        UI.reorderContentGrid();
                    }
                }


                UI.updateContentPanel(lookupType, lookupNumber, contentType);
                UI.showDetailIndicator(lookupType, lookupNumber, contentType);
            }

            this.fetchNextContentDetails();
        } catch (error) {
            console.error(`[DataManager] Error fetching details for ${contentType} ${id}:`, error);
            this.fetchNextContentDetails();
        }
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DataManager;
} else {
    window.DataManager = DataManager;
}