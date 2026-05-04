/**
 * BillDetailView Component
 *
 * Main view for displaying the details of a single bill.
 * This component orchestrates the display of various bill-related sub-components.
 */

// Assume BaseComponent, GLOBAL_EVENTS, and EventBus are available in the global scope
// or will be imported via a build tool.

class BillDetailView extends BaseComponent {
    constructor(props) {
        super(props, {
            debugMode: false,
        });
    }

    getDefaultProps() {
        return {
            bill: null, // Expects a bill object
        };
    }

    getInitialState() {
        return {
            loading: true,
            error: null,
            billDetails: null,
            activeTab: 'info' // Default to Key Info tab
        };
    }

    componentDidMount() {
        if (this.props.bill) {
            this.fetchBillDetails();
        } else {
            this.setState({ error: 'No bill data provided.', loading: false });
        }
    }

    async fetchBillDetails() {
        this.setState({ loading: true, error: null });
        const billId = this.props.bill.id;

        try {
            // Fetch core bill data (required)
            const details = await congressionalDataService.getBillDetails(billId);

            // Fetch optional data - don't fail if these aren't available
            const [summaries, actions, committees, textVersions] = await Promise.all([
                congressionalDataService.getBillSummaries(billId).catch(() => []),
                congressionalDataService.getBillActions(billId).catch(() => []),
                congressionalDataService.getBillCommittees(billId).catch(() => []),
                congressionalDataService.getBillText(billId).catch(() => [])
            ]);

            this.setState({
                billDetails: {
                    ...details,
                    summaries,
                    actions,
                    committees,
                    textVersions
                },
                loading: false,
            }, () => this.update());
        } catch (error) {
            this.handleError('fetchBillDetails', error);
            this.setState({ error: 'Failed to load bill details.', loading: false });
        }
    }

    getEventBindings() {
        return {
            'click .back-to-feed-btn': 'handleBackToFeed',
            'click .tab-list__item': 'handleTabClick'
        };
    }

    handleBackToFeed() {
        EventBus.emit(GLOBAL_EVENTS.BILL_VIEW_CLOSED);
    }

    handleTabClick(event, target) {
        const tabId = target.dataset.tabId;
        if (tabId && tabId !== this.state.activeTab) {
            // Update state and re-render
            this.setState({ activeTab: tabId }, () => this.update());
        }
    }

    renderLoading() {
        return `
            <div class="bill-detail-view is-loading">
                <div class="loading-spinner"></div>
                <p>Loading bill details...</p>
            </div>
        `;
    }

    renderError() {
        return `
            <div class="bill-detail-view has-error">
                <button class="back-to-feed-btn">&larr; Back to Feed</button>
                <h2>Error</h2>
                <p>${this.state.error}</p>
            </div>
        `;
    }

    template() {
        if (this.state.loading) {
            return this.renderLoading();
        }

        if (this.state.error) {
            return this.renderError();
        }

        const { billDetails, activeTab } = this.state;
        if (!billDetails) {
            return this.renderError();
        }

        // Instantiate child components for header and status
        this.billHeader = new BillHeaderComponent({ bill: billDetails });
        this.statusTracker = new StatusTrackerComponent({ bill: billDetails });

        // Define tabs
        const tabs = [
            { id: 'info', label: 'Key Info' },
            { id: 'committees', label: 'Committee Reports' },
            { id: 'votes', label: 'Votes' },
            { id: 'text', label: 'Full Text' }
        ];

        return `
            <div class="bill-detail-view">
                <button class="back-to-feed-btn">&larr; Back to Feed</button>

                <div id="bill-header-container">
                    ${this.billHeader.render().outerHTML}
                </div>

                <div id="status-tracker-container">
                    ${this.statusTracker.render().outerHTML}
                </div>

                <div class="tabbed-container">
                    <ul class="tab-list" role="tablist">
                        ${tabs.map(tab => `
                            <li
                                class="tab-list__item ${tab.id === activeTab ? 'is-active' : ''}"
                                data-tab-id="${tab.id}"
                                role="tab"
                                aria-selected="${tab.id === activeTab}"
                                aria-controls="tab-panel-${tab.id}"
                                tabindex="0"
                            >
                                ${tab.label}
                            </li>
                        `).join('')}
                    </ul>
                    <div class="tab-panels">
                        <div id="tab-panel-info" class="tab-panel ${activeTab === 'info' ? 'is-active' : ''}" role="tabpanel">
                            ${this.renderKeyInfo(billDetails)}
                        </div>
                        <div id="tab-panel-committees" class="tab-panel ${activeTab === 'committees' ? 'is-active' : ''}" role="tabpanel">
                            ${this.renderCommittees(billDetails.committees)}
                        </div>
                        <div id="tab-panel-votes" class="tab-panel ${activeTab === 'votes' ? 'is-active' : ''}" role="tabpanel">
                            <p>Voting records and breakdowns will be displayed here.</p>
                        </div>
                        <div id="tab-panel-text" class="tab-panel ${activeTab === 'text' ? 'is-active' : ''}" role="tabpanel">
                            ${this.renderText(billDetails.textVersions)}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderKeyInfo(bill) {
        const summary = bill.summaries?.[0]?.text || 'No summary available.';
        const latestAction = bill.actions?.[0];
        return `
            <div class="key-info">
                <h3>Summary</h3>
                <p>${summary}</p>
                <h3>Latest Action</h3>
                <p>${latestAction?.text || 'N/A'} (${latestAction?.actionDate || ''})</p>
                <h3>Details</h3>
                <ul class="details-list">
                    <li><strong>Cosponsors:</strong> ${bill.cosponsorsCount}</li>
                    <li><strong>Amendments:</strong> ${bill.amendmentsCount}</li>
                    <li><strong>Committees:</strong> ${bill.committeesCount}</li>
                    <li><strong>CBO Estimate:</strong> ${bill.cboCostEstimateUrl ? `<a href="${bill.cboCostEstimateUrl}" target="_blank">View Report</a>` : 'N/A'}</li>
                </ul>
            </div>
        `;
    }

    renderCommittees(committees) {
        if (!committees || !committees.length) return '<p>No committee information available.</p>';
        return `
            <ul class="committee-list">
                ${committees.map(c => `
                    <li class="committee-item">
                        <div class="committee-header">
                            <strong>${c.name}</strong>
                            <span class="committee-meta">${c.chamber} - ${c.type}</span>
                        </div>
                        ${c.activities && c.activities.length > 0 ? `
                            <ul class="committee-activities">
                                ${c.activities.map(activity => `
                                    <li class="activity-item">
                                        <span class="activity-name">${activity.name}</span>
                                        <span class="activity-date">${new Date(activity.date).toLocaleDateString()}</span>
                                    </li>
                                `).join('')}
                            </ul>
                        ` : ''}
                    </li>
                `).join('')}
            </ul>
        `;
    }

    renderText(textVersions) {
        if (!textVersions || !textVersions.length) return '<p>No bill text available.</p>';

        // Show all text versions with links
        return `
            <div class="bill-text-versions">
                <p>Available text versions:</p>
                <ul class="text-version-list">
                    ${textVersions.map(version => `
                        <li class="text-version-item">
                            <strong>${version.type}</strong>
                            ${version.date ? `<span class="text-version-date">(${new Date(version.date).toLocaleDateString()})</span>` : ''}
                            <div class="text-version-formats">
                                ${(version.formats || []).map(format => `
                                    <a href="${format.url}" target="_blank" rel="noopener noreferrer" class="text-format-link">
                                        ${format.type}
                                    </a>
                                `).join(' | ')}
                            </div>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }
}

// Make it available globally or export it
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BillDetailView;
} else {
    window.BillDetailView = BillDetailView;
}
