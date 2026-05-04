/**
 * Bill Journey Stage Computation Utility
 *
 * Analyzes bill actions to determine current legislative stage and progress.
 * Used by StatusTrackerComponent and journey API endpoint.
 */

const BillJourney = {
    /**
     * Legislative stages in order
     */
    STAGES: {
        INTRODUCED: 'introduced',
        IN_COMMITTEE: 'in_committee',
        REPORTED: 'reported',
        PASSED_ORIGIN: 'passed_origin',
        IN_OTHER_CHAMBER: 'in_other_chamber',
        PASSED_BOTH: 'passed_both',
        RESOLVING_DIFFERENCES: 'resolving_differences',
        TO_PRESIDENT: 'to_president',
        BECAME_LAW: 'became_law',
        VETOED: 'vetoed',
        VETO_OVERRIDDEN: 'veto_overridden',
        FAILED: 'failed'
    },

    /**
     * Stage metadata for display
     */
    STAGE_INFO: {
        introduced: {
            label: 'Introduced',
            shortLabel: 'Intro',
            description: 'Bill has been formally introduced in Congress',
            nextStep: 'Referral to committee',
            icon: '1'
        },
        in_committee: {
            label: 'In Committee',
            shortLabel: 'Committee',
            description: 'Bill is being reviewed by one or more committees',
            nextStep: 'Committee hearing, markup, or vote',
            icon: '2'
        },
        reported: {
            label: 'Reported from Committee',
            shortLabel: 'Reported',
            description: 'Committee has approved the bill and sent it to the full chamber',
            nextStep: 'Floor debate and vote',
            icon: '3'
        },
        passed_origin: {
            label: 'Passed Origin Chamber',
            shortLabel: 'Passed 1st',
            description: 'Bill has passed the chamber where it was introduced',
            nextStep: 'Consideration by other chamber',
            icon: '4'
        },
        in_other_chamber: {
            label: 'In Other Chamber',
            shortLabel: 'Other',
            description: 'Bill is being considered by the other chamber',
            nextStep: 'Committee review and floor vote in other chamber',
            icon: '4'
        },
        passed_both: {
            label: 'Passed Both Chambers',
            shortLabel: 'Passed Both',
            description: 'Bill has passed both House and Senate',
            nextStep: 'Resolving differences or presentation to President',
            icon: '5'
        },
        resolving_differences: {
            label: 'Resolving Differences',
            shortLabel: 'Conference',
            description: 'Chambers are reconciling different versions of the bill',
            nextStep: 'Conference committee or amendment exchange',
            icon: '5'
        },
        to_president: {
            label: 'Presented to President',
            shortLabel: 'President',
            description: 'Bill has been sent to the President for signature',
            nextStep: 'Presidential signature or veto',
            icon: '6'
        },
        became_law: {
            label: 'Became Law',
            shortLabel: 'Law',
            description: 'Bill has been signed into law',
            nextStep: 'Implementation by executive agencies',
            icon: '7',
            terminal: true
        },
        vetoed: {
            label: 'Vetoed',
            shortLabel: 'Vetoed',
            description: 'President has vetoed the bill',
            nextStep: 'Congress may attempt to override veto',
            icon: 'X',
            terminal: true
        },
        veto_overridden: {
            label: 'Veto Overridden',
            shortLabel: 'Override',
            description: 'Congress has overridden the presidential veto',
            nextStep: 'Bill becomes law',
            icon: '7',
            terminal: true
        },
        failed: {
            label: 'Failed',
            shortLabel: 'Failed',
            description: 'Bill did not pass a required vote',
            nextStep: 'Bill may be reintroduced in a future Congress',
            icon: 'X',
            terminal: true
        }
    },

    /**
     * Action code patterns for stage detection
     */
    ACTION_PATTERNS: {
        // Introduction
        introduced: {
            codes: ['1000', '10000', 'Intro-H', 'Intro-S'],
            textPatterns: [/^introduced in (house|senate)/i]
        },
        // Committee referral
        referred_to_committee: {
            codes: ['H11100', 'H11000'],
            textPatterns: [/referred to/i, /read twice and referred/i]
        },
        // Committee action
        committee_consideration: {
            codes: ['H15001'],
            textPatterns: [/committee consideration/i, /mark-?up session/i]
        },
        // Reported from committee
        reported: {
            codes: ['H19000', 'H19100'],
            textPatterns: [/ordered to be reported/i, /reported by/i, /reported with/i, /reported without/i]
        },
        // Passed House
        passed_house: {
            codes: ['8000'],
            textPatterns: [/passed\/agreed to in house/i, /passed house/i, /on passage.*passed.*yeas/i]
        },
        // Passed Senate
        passed_senate: {
            codes: ['17000'],
            textPatterns: [/passed\/agreed to in senate/i, /passed senate/i, /resolution agreed to in senate/i]
        },
        // Received in other chamber
        received_other: {
            codes: ['H14000'],
            textPatterns: [/received in the (house|senate)/i, /message on senate action/i]
        },
        // Conference
        conference: {
            codes: [],
            textPatterns: [/conference committee/i, /conferees appointed/i, /conference report/i]
        },
        // Presented to President
        to_president: {
            codes: ['28000', 'E20000'],
            textPatterns: [/presented to president/i]
        },
        // Signed
        signed: {
            codes: ['36000', 'E30000'],
            textPatterns: [/signed by president/i]
        },
        // Became law
        became_law: {
            codes: [],
            textPatterns: [/became public law/i, /became law/i]
        },
        // Vetoed
        vetoed: {
            codes: [],
            textPatterns: [/vetoed by president/i, /pocket veto/i]
        },
        // Veto override
        veto_override: {
            codes: [],
            textPatterns: [/veto overridden/i, /passed.*over.*veto/i]
        },
        // Failed
        failed: {
            codes: [],
            textPatterns: [/failed of passage/i, /rejected/i, /motion.*not agreed/i]
        }
    },

    /**
     * Compute current journey stage from bill actions
     *
     * @param {Array} actions - Array of bill action objects
     * @param {string} originChamber - 'House' or 'Senate' where bill was introduced
     * @returns {Object} Journey state object
     */
    computeStage(actions, originChamber = 'House') {
        if (!actions || actions.length === 0) {
            return this.createJourneyState(this.STAGES.INTRODUCED, null, originChamber);
        }

        // Sort actions by date (most recent last)
        const sortedActions = [...actions].sort((a, b) =>
            new Date(a.action_date || a.actionDate) - new Date(b.action_date || b.actionDate)
        );

        // Track state as we process actions
        let currentStage = this.STAGES.INTRODUCED;
        let stageDate = null;
        let passedOrigin = false;
        let passedOther = false;
        let inCommittee = false;
        let reported = false;

        for (const action of sortedActions) {
            const actionText = action.text || action.actionText || '';
            const actionCode = action.action_code || action.actionCode || '';
            const actionDate = action.action_date || action.actionDate;

            // Check for became law (terminal)
            if (this.matchesPattern('became_law', actionCode, actionText)) {
                return this.createJourneyState(this.STAGES.BECAME_LAW, actionDate, originChamber, {
                    passedOrigin: true,
                    passedOther: true
                });
            }

            // Check for vetoed (terminal)
            if (this.matchesPattern('vetoed', actionCode, actionText)) {
                return this.createJourneyState(this.STAGES.VETOED, actionDate, originChamber, {
                    passedOrigin: true,
                    passedOther: true
                });
            }

            // Check for veto override
            if (this.matchesPattern('veto_override', actionCode, actionText)) {
                return this.createJourneyState(this.STAGES.VETO_OVERRIDDEN, actionDate, originChamber, {
                    passedOrigin: true,
                    passedOther: true
                });
            }

            // Check for failed (terminal)
            if (this.matchesPattern('failed', actionCode, actionText)) {
                return this.createJourneyState(this.STAGES.FAILED, actionDate, originChamber, {
                    passedOrigin,
                    passedOther
                });
            }

            // Check for signed (leads to law)
            if (this.matchesPattern('signed', actionCode, actionText)) {
                currentStage = this.STAGES.BECAME_LAW;
                stageDate = actionDate;
                continue;
            }

            // Check for presented to President
            if (this.matchesPattern('to_president', actionCode, actionText)) {
                currentStage = this.STAGES.TO_PRESIDENT;
                stageDate = actionDate;
                continue;
            }

            // Check for conference
            if (this.matchesPattern('conference', actionCode, actionText)) {
                currentStage = this.STAGES.RESOLVING_DIFFERENCES;
                stageDate = actionDate;
                continue;
            }

            // Check for passed in origin chamber
            const isHouse = originChamber.toLowerCase() === 'house';
            if (isHouse && this.matchesPattern('passed_house', actionCode, actionText)) {
                passedOrigin = true;
                if (!passedOther) {
                    currentStage = this.STAGES.PASSED_ORIGIN;
                    stageDate = actionDate;
                } else {
                    currentStage = this.STAGES.PASSED_BOTH;
                    stageDate = actionDate;
                }
                continue;
            }
            if (!isHouse && this.matchesPattern('passed_senate', actionCode, actionText)) {
                passedOrigin = true;
                if (!passedOther) {
                    currentStage = this.STAGES.PASSED_ORIGIN;
                    stageDate = actionDate;
                } else {
                    currentStage = this.STAGES.PASSED_BOTH;
                    stageDate = actionDate;
                }
                continue;
            }

            // Check for passed in other chamber
            if (isHouse && this.matchesPattern('passed_senate', actionCode, actionText)) {
                passedOther = true;
                if (passedOrigin) {
                    currentStage = this.STAGES.PASSED_BOTH;
                } else {
                    currentStage = this.STAGES.IN_OTHER_CHAMBER;
                }
                stageDate = actionDate;
                continue;
            }
            if (!isHouse && this.matchesPattern('passed_house', actionCode, actionText)) {
                passedOther = true;
                if (passedOrigin) {
                    currentStage = this.STAGES.PASSED_BOTH;
                } else {
                    currentStage = this.STAGES.IN_OTHER_CHAMBER;
                }
                stageDate = actionDate;
                continue;
            }

            // Check for received in other chamber
            if (this.matchesPattern('received_other', actionCode, actionText)) {
                if (passedOrigin) {
                    currentStage = this.STAGES.IN_OTHER_CHAMBER;
                    stageDate = actionDate;
                }
                continue;
            }

            // Check for reported from committee
            if (this.matchesPattern('reported', actionCode, actionText)) {
                reported = true;
                currentStage = this.STAGES.REPORTED;
                stageDate = actionDate;
                continue;
            }

            // Check for committee consideration
            if (this.matchesPattern('committee_consideration', actionCode, actionText)) {
                inCommittee = true;
                if (currentStage === this.STAGES.INTRODUCED || currentStage === this.STAGES.IN_COMMITTEE) {
                    currentStage = this.STAGES.IN_COMMITTEE;
                    stageDate = stageDate || actionDate;
                }
                continue;
            }

            // Check for committee referral
            if (this.matchesPattern('referred_to_committee', actionCode, actionText)) {
                inCommittee = true;
                if (currentStage === this.STAGES.INTRODUCED) {
                    currentStage = this.STAGES.IN_COMMITTEE;
                    stageDate = actionDate;
                }
                continue;
            }

            // Check for introduction
            if (this.matchesPattern('introduced', actionCode, actionText)) {
                if (!stageDate) {
                    stageDate = actionDate;
                }
            }
        }

        return this.createJourneyState(currentStage, stageDate, originChamber, {
            passedOrigin,
            passedOther,
            inCommittee,
            reported
        });
    },

    /**
     * Check if action matches a pattern category
     */
    matchesPattern(category, actionCode, actionText) {
        const pattern = this.ACTION_PATTERNS[category];
        if (!pattern) return false;

        // Check action code
        if (actionCode && pattern.codes.includes(actionCode)) {
            return true;
        }

        // Check text patterns
        for (const regex of pattern.textPatterns) {
            if (regex.test(actionText)) {
                return true;
            }
        }

        return false;
    },

    /**
     * Create a journey state object
     */
    createJourneyState(stage, stageDate, originChamber, flags = {}) {
        const stageInfo = this.STAGE_INFO[stage] || this.STAGE_INFO.introduced;
        const now = new Date();
        const startDate = stageDate ? new Date(stageDate) : now;
        const daysInStage = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));

        return {
            currentStage: stage,
            stageLabel: stageInfo.label,
            stageShortLabel: stageInfo.shortLabel,
            stageDescription: stageInfo.description,
            stageStartDate: stageDate,
            daysInStage: Math.max(0, daysInStage),
            nextStep: stageInfo.nextStep,
            isTerminal: stageInfo.terminal || false,
            originChamber,
            flags: {
                passedOrigin: flags.passedOrigin || false,
                passedOther: flags.passedOther || false,
                inCommittee: flags.inCommittee || false,
                reported: flags.reported || false
            },
            stages: this.buildStagesArray(stage, flags)
        };
    },

    /**
     * Build array of all stages with completion status
     */
    buildStagesArray(currentStage, flags = {}) {
        const stageOrder = [
            this.STAGES.INTRODUCED,
            this.STAGES.IN_COMMITTEE,
            this.STAGES.PASSED_ORIGIN,
            this.STAGES.IN_OTHER_CHAMBER,
            this.STAGES.PASSED_BOTH,
            this.STAGES.TO_PRESIDENT,
            this.STAGES.BECAME_LAW
        ];

        const currentIndex = stageOrder.indexOf(currentStage);

        return stageOrder.map((stage, index) => {
            const info = this.STAGE_INFO[stage];
            let status = 'pending';

            if (index < currentIndex ||
                (currentStage === this.STAGES.BECAME_LAW && index <= stageOrder.indexOf(this.STAGES.BECAME_LAW))) {
                status = 'complete';
            } else if (index === currentIndex) {
                status = 'current';
            }

            // Handle terminal states
            if (currentStage === this.STAGES.VETOED || currentStage === this.STAGES.FAILED) {
                if (index < currentIndex) {
                    status = 'complete';
                } else if (index === currentIndex) {
                    status = 'current';
                } else {
                    status = 'blocked';
                }
            }

            return {
                stage,
                label: info.label,
                shortLabel: info.shortLabel,
                status,
                description: info.description
            };
        });
    },

    /**
     * Get display stages for the visual tracker (simplified 7-step version)
     */
    getDisplayStages(journeyState) {
        return [
            {
                label: 'Introduced',
                shortLabel: 'Intro',
                status: this.getStageStatus(journeyState, [this.STAGES.INTRODUCED])
            },
            {
                label: 'Committee',
                shortLabel: 'Committee',
                status: this.getStageStatus(journeyState, [this.STAGES.IN_COMMITTEE, this.STAGES.REPORTED])
            },
            {
                label: 'Floor Vote',
                shortLabel: 'Floor',
                status: this.getStageStatus(journeyState, [this.STAGES.PASSED_ORIGIN])
            },
            {
                label: 'Other Chamber',
                shortLabel: 'Other',
                status: this.getStageStatus(journeyState, [this.STAGES.IN_OTHER_CHAMBER, this.STAGES.PASSED_BOTH])
            },
            {
                label: 'Conference',
                shortLabel: 'Conf',
                status: this.getStageStatus(journeyState, [this.STAGES.RESOLVING_DIFFERENCES])
            },
            {
                label: 'President',
                shortLabel: 'Pres',
                status: this.getStageStatus(journeyState, [this.STAGES.TO_PRESIDENT])
            },
            {
                label: 'Law',
                shortLabel: 'Law',
                status: this.getStageStatus(journeyState, [this.STAGES.BECAME_LAW, this.STAGES.VETO_OVERRIDDEN])
            }
        ];
    },

    /**
     * Helper to determine stage status for display
     */
    getStageStatus(journeyState, stageGroup) {
        const current = journeyState.currentStage;

        // Terminal failure states
        if (current === this.STAGES.VETOED || current === this.STAGES.FAILED) {
            // Mark everything up to current as complete, current as failed
            if (stageGroup.includes(current)) {
                return 'failed';
            }
        }

        // If current stage is in this group, it's current
        if (stageGroup.includes(current)) {
            return 'current';
        }

        // Define stage order for comparison
        const stageOrder = [
            this.STAGES.INTRODUCED,
            this.STAGES.IN_COMMITTEE,
            this.STAGES.REPORTED,
            this.STAGES.PASSED_ORIGIN,
            this.STAGES.IN_OTHER_CHAMBER,
            this.STAGES.PASSED_BOTH,
            this.STAGES.RESOLVING_DIFFERENCES,
            this.STAGES.TO_PRESIDENT,
            this.STAGES.BECAME_LAW
        ];

        const currentIndex = stageOrder.indexOf(current);
        const groupMinIndex = Math.min(...stageGroup.map(s => stageOrder.indexOf(s)).filter(i => i >= 0));

        if (groupMinIndex < currentIndex) {
            return 'complete';
        }

        return 'pending';
    },

    /**
     * Determine origin chamber from bill type
     */
    getOriginChamber(billType) {
        const type = (billType || '').toLowerCase();
        if (type.startsWith('h') || type === 'hr' || type === 'hres' || type === 'hjres' || type === 'hconres') {
            return 'House';
        }
        if (type.startsWith('s') || type === 's' || type === 'sres' || type === 'sjres' || type === 'sconres') {
            return 'Senate';
        }
        return 'House'; // Default
    }
};

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BillJourney;
} else {
    window.BillJourney = BillJourney;
}
