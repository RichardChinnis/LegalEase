/**
 * StatusTrackerComponent
 *
 * Displays a visual stepper to track the legislative progress of a bill.
 * Uses BillJourney utility for stage computation and displays rich journey information.
 */

class StatusTrackerComponent extends BaseComponent {
    constructor(props) {
        super(props);
    }

    getDefaultProps() {
        return {
            bill: {},
            journey: null,  // Pre-computed journey data from API
            showDetails: true,  // Show days in stage and next step
            compact: false  // Compact mode for cards
        };
    }

    /**
     * Get journey state - either from props or compute from bill actions
     */
    getJourneyState() {
        const { bill, journey } = this.props;

        // If journey data is provided directly, use it
        if (journey && journey.currentStage) {
            return journey;
        }

        // Otherwise compute from bill actions using BillJourney utility
        if (typeof BillJourney !== 'undefined' && bill) {
            const originChamber = bill.originChamber || BillJourney.getOriginChamber(bill.billType || bill.bill_type);
            const actions = bill.actions || [];
            return BillJourney.computeStage(actions, originChamber);
        }

        // Fallback to basic status mapping
        return this.createBasicJourneyState(bill);
    }

    /**
     * Create basic journey state from bill status field (fallback)
     */
    createBasicJourneyState(bill) {
        if (!bill || !bill.status) {
            return {
                currentStage: 'introduced',
                stageLabel: 'Introduced',
                stageShortLabel: 'Intro',
                stageDescription: 'Bill has been formally introduced',
                isTerminal: false,
                stages: this.getDefaultStages()
            };
        }

        const statusMapping = {
            'Introduced': 'introduced',
            'In Committee': 'in_committee',
            'Passed House': 'passed_origin',
            'Passed Senate': 'passed_origin',
            'To President': 'to_president',
            'Became Law': 'became_law'
        };

        const stage = statusMapping[bill.status] || 'introduced';
        const stageInfo = typeof BillJourney !== 'undefined'
            ? BillJourney.STAGE_INFO[stage]
            : { label: bill.status, shortLabel: bill.status };

        return {
            currentStage: stage,
            stageLabel: stageInfo?.label || bill.status,
            stageShortLabel: stageInfo?.shortLabel || bill.status,
            stageDescription: stageInfo?.description || '',
            nextStep: stageInfo?.nextStep || '',
            isTerminal: stageInfo?.terminal || false,
            stages: this.getDefaultStages()
        };
    }

    /**
     * Get default stages array for fallback
     */
    getDefaultStages() {
        return [
            { stage: 'introduced', label: 'Introduced', shortLabel: 'Intro', status: 'current' },
            { stage: 'in_committee', label: 'Committee', shortLabel: 'Committee', status: 'pending' },
            { stage: 'passed_origin', label: 'Floor Vote', shortLabel: 'Floor', status: 'pending' },
            { stage: 'in_other_chamber', label: 'Other Chamber', shortLabel: 'Other', status: 'pending' },
            { stage: 'to_president', label: 'President', shortLabel: 'Pres', status: 'pending' },
            { stage: 'became_law', label: 'Law', shortLabel: 'Law', status: 'pending' }
        ];
    }

    /**
     * Get display stages from journey state
     */
    getDisplayStages(journeyState) {
        // Use BillJourney utility if available
        if (typeof BillJourney !== 'undefined') {
            return BillJourney.getDisplayStages(journeyState);
        }

        // Use stages from journey state if provided
        if (journeyState.stages) {
            return journeyState.stages;
        }

        return this.getDefaultStages();
    }

    /**
     * Get CSS class for step status
     */
    getStepClass(status) {
        const classes = {
            'complete': 'is-complete',
            'current': 'is-current',
            'pending': '',
            'failed': 'is-failed',
            'blocked': 'is-blocked'
        };
        return classes[status] || '';
    }

    /**
     * Get icon for step based on status
     */
    getStepIcon(status, index) {
        if (status === 'complete') {
            return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>`;
        }
        if (status === 'failed') {
            return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>`;
        }
        if (status === 'current') {
            return `<span class="pulse-dot"></span>`;
        }
        return `<span class="step-number">${index + 1}</span>`;
    }

    /**
     * Format days in stage for display
     */
    formatDaysInStage(days) {
        if (days === 0) return 'Today';
        if (days === 1) return '1 day';
        if (days < 30) return `${days} days`;
        if (days < 60) return '1 month';
        const months = Math.floor(days / 30);
        return `${months} months`;
    }

    template() {
        const { showDetails, compact } = this.props;
        const journeyState = this.getJourneyState();

        if (!journeyState) {
            return '<div class="status-tracker status-tracker--empty">No status available</div>';
        }

        const displayStages = this.getDisplayStages(journeyState);
        const isTerminal = journeyState.isTerminal || false;
        const isFailed = journeyState.currentStage === 'vetoed' || journeyState.currentStage === 'failed';

        // Determine the progress percentage for the timeline
        const currentIndex = displayStages.findIndex(s => s.status === 'current' || s.status === 'failed');
        const progressPercent = currentIndex >= 0
            ? Math.min(100, ((currentIndex + 0.5) / displayStages.length) * 100)
            : 0;

        return `
            <div class="status-tracker ${compact ? 'status-tracker--compact' : ''} ${isFailed ? 'status-tracker--failed' : ''}">
                <div class="status-tracker__timeline" style="--progress: ${progressPercent}%">
                    <ol class="status-tracker__steps">
                        ${displayStages.map((step, index) => `
                            <li class="status-tracker__step ${this.getStepClass(step.status)}"
                                data-stage="${step.stage || ''}"
                                title="${step.description || step.label}">
                                <div class="status-tracker__indicator">
                                    ${this.getStepIcon(step.status, index)}
                                </div>
                                <div class="status-tracker__label">${compact ? step.shortLabel : step.label}</div>
                            </li>
                        `).join('')}
                    </ol>
                </div>

                ${showDetails && !compact ? this.renderDetails(journeyState) : ''}
            </div>
        `;
    }

    /**
     * Render journey details section
     */
    renderDetails(journeyState) {
        const { daysInStage, nextStep, stageLabel, stageDescription, isTerminal, committee, currentStage } = journeyState;

        // Build details content
        let details = [];

        // Current stage info
        if (stageLabel) {
            details.push(`
                <div class="status-tracker__detail">
                    <span class="detail-label">Current Stage:</span>
                    <span class="detail-value">${stageLabel}</span>
                </div>
            `);
        }

        // Committee info (when in committee stage)
        if (committee && committee.committee_name && currentStage === 'in_committee') {
            const chamberPrefix = committee.chamber ? `${committee.chamber} ` : '';
            details.push(`
                <div class="status-tracker__detail">
                    <span class="detail-label">Committee:</span>
                    <span class="detail-value detail-value--committee">${chamberPrefix}${committee.committee_name}</span>
                </div>
            `);
        }

        // Days in stage (if not a terminal state with 0 days)
        if (typeof daysInStage === 'number' && (!isTerminal || daysInStage > 0)) {
            details.push(`
                <div class="status-tracker__detail">
                    <span class="detail-label">Time at Stage:</span>
                    <span class="detail-value">${this.formatDaysInStage(daysInStage)}</span>
                </div>
            `);
        }

        // Next step
        if (nextStep && !isTerminal) {
            details.push(`
                <div class="status-tracker__detail">
                    <span class="detail-label">Next:</span>
                    <span class="detail-value detail-value--next">${nextStep}</span>
                </div>
            `);
        }

        if (details.length === 0) {
            return '';
        }

        return `
            <div class="status-tracker__details">
                ${details.join('')}
            </div>
        `;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = StatusTrackerComponent;
} else {
    window.StatusTrackerComponent = StatusTrackerComponent;
}
