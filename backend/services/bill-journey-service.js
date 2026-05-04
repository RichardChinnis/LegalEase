/**
 * Bill Journey Service
 *
 * Computes and returns legislative journey/stage information for bills.
 * Analyzes bill actions to determine current stage, time at stage, and next steps.
 */

const { logger } = require('../logger');

class BillJourneyService {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * Legislative stages
     */
    static STAGES = {
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
    };

    /**
     * Stage metadata
     */
    static STAGE_INFO = {
        introduced: {
            label: 'Introduced',
            shortLabel: 'Intro',
            description: 'Bill has been formally introduced in Congress',
            nextStep: 'Referral to committee'
        },
        in_committee: {
            label: 'In Committee',
            shortLabel: 'Committee',
            description: 'Bill is being reviewed by one or more committees',
            nextStep: 'Committee hearing, markup, or vote'
        },
        reported: {
            label: 'Reported from Committee',
            shortLabel: 'Reported',
            description: 'Committee has approved the bill and sent it to the full chamber',
            nextStep: 'Floor debate and vote'
        },
        passed_origin: {
            label: 'Passed Origin Chamber',
            shortLabel: 'Passed 1st',
            description: 'Bill has passed the chamber where it was introduced',
            nextStep: 'Consideration by other chamber'
        },
        in_other_chamber: {
            label: 'In Other Chamber',
            shortLabel: 'Other',
            description: 'Bill is being considered by the other chamber',
            nextStep: 'Committee review and floor vote'
        },
        passed_both: {
            label: 'Passed Both Chambers',
            shortLabel: 'Passed Both',
            description: 'Bill has passed both House and Senate',
            nextStep: 'Resolving differences or presentation to President'
        },
        resolving_differences: {
            label: 'Resolving Differences',
            shortLabel: 'Conference',
            description: 'Chambers are reconciling different versions',
            nextStep: 'Conference committee agreement'
        },
        to_president: {
            label: 'Presented to President',
            shortLabel: 'President',
            description: 'Bill has been sent to the President',
            nextStep: 'Presidential signature or veto'
        },
        became_law: {
            label: 'Became Law',
            shortLabel: 'Law',
            description: 'Bill has been signed into law',
            nextStep: 'Implementation by executive agencies',
            terminal: true
        },
        vetoed: {
            label: 'Vetoed',
            shortLabel: 'Vetoed',
            description: 'President has vetoed the bill',
            nextStep: 'Congress may attempt to override',
            terminal: true
        },
        veto_overridden: {
            label: 'Veto Overridden',
            shortLabel: 'Override',
            description: 'Congress has overridden the veto',
            nextStep: 'Bill becomes law',
            terminal: true
        },
        failed: {
            label: 'Failed',
            shortLabel: 'Failed',
            description: 'Bill did not pass a required vote',
            nextStep: 'May be reintroduced in future Congress',
            terminal: true
        }
    };

    /**
     * Get journey information for a bill
     */
    async getBillJourney(billId) {
        try {
            // Get bill info and actions
            const billQuery = `
                SELECT
                    b.bill_id,
                    b.bill_type,
                    b.bill_number,
                    b.congress_id,
                    b.title,
                    b.origin_chamber,
                    b.introduced_date,
                    b.latest_action_date,
                    b.latest_action_text
                FROM bill b
                WHERE b.bill_id = $1
            `;

            const actionsQuery = `
                SELECT
                    action_id,
                    action_date,
                    text,
                    action_code,
                    action_type,
                    source_system_name,
                    committees
                FROM action
                WHERE bill_id = $1
                ORDER BY action_date ASC, action_id ASC
            `;

            const [billResult, actionsResult] = await Promise.all([
                this.pool.query(billQuery, [billId]),
                this.pool.query(actionsQuery, [billId])
            ]);

            if (billResult.rows.length === 0) {
                return null;
            }

            const bill = billResult.rows[0];
            const actions = actionsResult.rows;

            // Compute stage from actions
            const journeyState = this.computeStage(actions, bill.origin_chamber || this.getOriginChamber(bill.bill_type));

            // Get committee information if in committee
            let committeeInfo = null;
            if (journeyState.currentStage === BillJourneyService.STAGES.IN_COMMITTEE) {
                committeeInfo = await this.getCommitteeInfo(billId);
            }

            // Calculate average days at this stage (from historical data)
            const avgDays = await this.getAverageDaysAtStage(journeyState.currentStage);

            return {
                billId: bill.bill_id,
                congress: bill.congress_id,
                billType: bill.bill_type,
                billNumber: bill.bill_number,
                title: bill.title,
                originChamber: bill.origin_chamber || this.getOriginChamber(bill.bill_type),
                introducedDate: bill.introduced_date,
                ...journeyState,
                averageDaysAtStage: avgDays,
                committee: committeeInfo,
                stages: this.buildDisplayStages(journeyState)
            };
        } catch (error) {
            logger.error('Error getting bill journey', { billId, error: error.message });
            throw error;
        }
    }

    /**
     * Compute current stage from actions
     * Tracks dates for all stages encountered
     */
    computeStage(actions, originChamber = 'House') {
        const STAGES = BillJourneyService.STAGES;

        // Track dates for all stages
        const stageDates = {};

        if (!actions || actions.length === 0) {
            return this.createJourneyState(STAGES.INTRODUCED, null, {}, stageDates);
        }

        let currentStage = STAGES.INTRODUCED;
        let stageDate = null;
        let passedOrigin = false;
        let passedOther = false;

        for (const action of actions) {
            const text = (action.text || '').toLowerCase();
            const code = action.action_code || '';
            const date = action.action_date;

            // Terminal states
            if (/became public law|became law/i.test(text)) {
                stageDates[STAGES.BECAME_LAW] = date;
                return this.createJourneyState(STAGES.BECAME_LAW, date, { passedOrigin: true, passedOther: true }, stageDates);
            }
            if (/vetoed by president|pocket veto/i.test(text)) {
                stageDates[STAGES.VETOED] = date;
                return this.createJourneyState(STAGES.VETOED, date, { passedOrigin: true, passedOther: true }, stageDates);
            }
            if (/veto overridden/i.test(text)) {
                stageDates[STAGES.VETO_OVERRIDDEN] = date;
                return this.createJourneyState(STAGES.VETO_OVERRIDDEN, date, { passedOrigin: true, passedOther: true }, stageDates);
            }
            if (/failed of passage|rejected|motion.*not agreed/i.test(text)) {
                stageDates[STAGES.FAILED] = date;
                // Also record the failure date on the stage where it failed
                // This helps the UI show when the failure occurred
                if (!passedOrigin) {
                    // Failed in origin chamber floor vote
                    stageDates[STAGES.PASSED_ORIGIN] = date;
                } else if (!passedOther) {
                    // Failed in other chamber
                    stageDates[STAGES.IN_OTHER_CHAMBER] = date;
                }
                return this.createJourneyState(STAGES.FAILED, date, { passedOrigin, passedOther }, stageDates);
            }

            // Signed by President
            if (/signed by president/i.test(text) || ['36000', 'E30000'].includes(code)) {
                currentStage = STAGES.BECAME_LAW;
                stageDate = date;
                stageDates[STAGES.BECAME_LAW] = date;
                continue;
            }

            // Presented to President
            if (/presented to president/i.test(text) || ['28000', 'E20000'].includes(code)) {
                currentStage = STAGES.TO_PRESIDENT;
                stageDate = date;
                if (!stageDates[STAGES.TO_PRESIDENT]) stageDates[STAGES.TO_PRESIDENT] = date;
                continue;
            }

            // Conference committee
            if (/conference committee|conferees appointed|conference report/i.test(text)) {
                currentStage = STAGES.RESOLVING_DIFFERENCES;
                stageDate = date;
                if (!stageDates[STAGES.RESOLVING_DIFFERENCES]) stageDates[STAGES.RESOLVING_DIFFERENCES] = date;
                continue;
            }

            // Passed House
            const isHouseOrigin = originChamber.toLowerCase() === 'house';
            if (/passed\/agreed to in house|passed house|on passage.*passed.*yeas/i.test(text) || code === '8000') {
                if (isHouseOrigin) {
                    passedOrigin = true;
                    if (passedOther) {
                        currentStage = STAGES.PASSED_BOTH;
                        if (!stageDates[STAGES.PASSED_BOTH]) stageDates[STAGES.PASSED_BOTH] = date;
                    } else {
                        currentStage = STAGES.PASSED_ORIGIN;
                        if (!stageDates[STAGES.PASSED_ORIGIN]) stageDates[STAGES.PASSED_ORIGIN] = date;
                    }
                } else {
                    passedOther = true;
                    if (passedOrigin) {
                        currentStage = STAGES.PASSED_BOTH;
                        if (!stageDates[STAGES.PASSED_BOTH]) stageDates[STAGES.PASSED_BOTH] = date;
                    } else {
                        currentStage = STAGES.IN_OTHER_CHAMBER;
                        if (!stageDates[STAGES.IN_OTHER_CHAMBER]) stageDates[STAGES.IN_OTHER_CHAMBER] = date;
                    }
                }
                stageDate = date;
                continue;
            }

            // Passed Senate
            if (/passed\/agreed to in senate|passed senate|resolution agreed to in senate/i.test(text) || code === '17000') {
                if (!isHouseOrigin) {
                    passedOrigin = true;
                    if (passedOther) {
                        currentStage = STAGES.PASSED_BOTH;
                        if (!stageDates[STAGES.PASSED_BOTH]) stageDates[STAGES.PASSED_BOTH] = date;
                    } else {
                        currentStage = STAGES.PASSED_ORIGIN;
                        if (!stageDates[STAGES.PASSED_ORIGIN]) stageDates[STAGES.PASSED_ORIGIN] = date;
                    }
                } else {
                    passedOther = true;
                    if (passedOrigin) {
                        currentStage = STAGES.PASSED_BOTH;
                        if (!stageDates[STAGES.PASSED_BOTH]) stageDates[STAGES.PASSED_BOTH] = date;
                    } else {
                        currentStage = STAGES.IN_OTHER_CHAMBER;
                        if (!stageDates[STAGES.IN_OTHER_CHAMBER]) stageDates[STAGES.IN_OTHER_CHAMBER] = date;
                    }
                }
                stageDate = date;
                continue;
            }

            // Received in other chamber
            if (/received in the (house|senate)/i.test(text) || code === 'H14000') {
                if (passedOrigin) {
                    currentStage = STAGES.IN_OTHER_CHAMBER;
                    stageDate = date;
                    if (!stageDates[STAGES.IN_OTHER_CHAMBER]) stageDates[STAGES.IN_OTHER_CHAMBER] = date;
                }
                continue;
            }

            // Reported from committee
            if (/ordered to be reported|reported by|reported with|reported without/i.test(text) || code === 'H19000') {
                currentStage = STAGES.REPORTED;
                stageDate = date;
                if (!stageDates[STAGES.REPORTED]) stageDates[STAGES.REPORTED] = date;
                continue;
            }

            // Committee consideration
            if (/committee consideration|mark-?up session/i.test(text) || code === 'H15001') {
                if (currentStage === STAGES.INTRODUCED || currentStage === STAGES.IN_COMMITTEE) {
                    currentStage = STAGES.IN_COMMITTEE;
                    stageDate = stageDate || date;
                    if (!stageDates[STAGES.IN_COMMITTEE]) stageDates[STAGES.IN_COMMITTEE] = date;
                }
                continue;
            }

            // Referred to committee
            if (/referred to|read twice and referred/i.test(text) || code === 'H11100') {
                if (currentStage === STAGES.INTRODUCED) {
                    currentStage = STAGES.IN_COMMITTEE;
                    stageDate = date;
                    if (!stageDates[STAGES.IN_COMMITTEE]) stageDates[STAGES.IN_COMMITTEE] = date;
                }
                continue;
            }

            // Introduction
            if (/^introduced in/i.test(text) || ['1000', '10000', 'Intro-H', 'Intro-S'].includes(code)) {
                if (!stageDate) {
                    stageDate = date;
                }
                if (!stageDates[STAGES.INTRODUCED]) stageDates[STAGES.INTRODUCED] = date;
            }
        }

        return this.createJourneyState(currentStage, stageDate, { passedOrigin, passedOther }, stageDates);
    }

    /**
     * Create journey state object
     */
    createJourneyState(stage, stageDate, flags = {}, stageDates = {}) {
        const info = BillJourneyService.STAGE_INFO[stage] || BillJourneyService.STAGE_INFO.introduced;
        const now = new Date();
        const start = stageDate ? new Date(stageDate) : now;
        const daysInStage = Math.max(0, Math.floor((now - start) / (1000 * 60 * 60 * 24)));

        return {
            currentStage: stage,
            stageLabel: info.label,
            stageShortLabel: info.shortLabel,
            stageDescription: info.description,
            stageStartDate: stageDate,
            daysInStage,
            nextStep: info.nextStep,
            isTerminal: info.terminal || false,
            flags: {
                passedOrigin: flags.passedOrigin || false,
                passedOther: flags.passedOther || false
            },
            stageDates // Include dates for all stages
        };
    }

    /**
     * Build display stages array
     */
    buildDisplayStages(journeyState) {
        const STAGES = BillJourneyService.STAGES;
        const stageDates = journeyState.stageDates || {};
        const stageOrder = [
            { stage: STAGES.INTRODUCED, label: 'Introduced', shortLabel: 'Intro' },
            { stage: STAGES.IN_COMMITTEE, label: 'Committee', shortLabel: 'Committee' },
            { stage: STAGES.REPORTED, label: 'Reported', shortLabel: 'Reported' },
            { stage: STAGES.PASSED_ORIGIN, label: 'Floor Vote', shortLabel: 'Floor' },
            { stage: STAGES.IN_OTHER_CHAMBER, label: 'Other Chamber', shortLabel: 'Other' },
            { stage: STAGES.RESOLVING_DIFFERENCES, label: 'Conference', shortLabel: 'Conf' },
            { stage: STAGES.TO_PRESIDENT, label: 'President', shortLabel: 'Pres' },
            { stage: STAGES.BECAME_LAW, label: 'Law', shortLabel: 'Law' }
        ];

        let currentIndex = stageOrder.findIndex(s => s.stage === journeyState.currentStage);

        // Handle stages not in display order (vetoed, veto_overridden, failed)
        if (currentIndex === -1) {
            if (journeyState.currentStage === STAGES.VETOED ||
                journeyState.currentStage === STAGES.VETO_OVERRIDDEN) {
                currentIndex = stageOrder.findIndex(s => s.stage === STAGES.TO_PRESIDENT);
            } else if (journeyState.currentStage === STAGES.FAILED) {
                // For failed bills, determine where they failed based on flags and stageDates
                // A bill can fail at various points - find the furthest stage reached
                if (journeyState.flags.passedOther) {
                    // Failed after passing other chamber (conference or similar)
                    currentIndex = stageOrder.findIndex(s => s.stage === STAGES.RESOLVING_DIFFERENCES);
                } else if (journeyState.flags.passedOrigin) {
                    // Failed in other chamber
                    currentIndex = stageOrder.findIndex(s => s.stage === STAGES.IN_OTHER_CHAMBER);
                } else if (stageDates[STAGES.REPORTED] || stageDates[STAGES.PASSED_ORIGIN]) {
                    // Made it to floor vote but failed there
                    currentIndex = stageOrder.findIndex(s => s.stage === STAGES.PASSED_ORIGIN);
                } else if (stageDates[STAGES.IN_COMMITTEE]) {
                    // Failed in or after committee - likely floor vote
                    currentIndex = stageOrder.findIndex(s => s.stage === STAGES.PASSED_ORIGIN);
                } else {
                    // Failed very early
                    currentIndex = stageOrder.findIndex(s => s.stage === STAGES.INTRODUCED);
                }
            } else {
                // Default to introduced for unknown stages
                currentIndex = 0;
            }
        }

        return stageOrder.map((s, i) => {
            let status = 'pending';
            if (i < currentIndex) status = 'complete';
            else if (i === currentIndex) status = 'current';

            // Handle terminal failure states
            if (journeyState.currentStage === STAGES.VETOED || journeyState.currentStage === STAGES.FAILED) {
                if (i < currentIndex) status = 'complete';
                else if (i === currentIndex) status = 'failed';
                else status = 'blocked';
            }

            // Get the date for this stage (if completed, current, or failed with a date)
            const stageDate = stageDates[s.stage] || null;

            return {
                stage: s.stage,
                label: s.label,
                shortLabel: s.shortLabel,
                status,
                date: stageDate
            };
        });
    }

    /**
     * Get committee info for a bill
     */
    async getCommitteeInfo(billId) {
        try {
            // Query bill_committee_activity for referral info, join committee for chamber
            const query = `
                SELECT
                    bca.committee_name,
                    bca.committee_system_code AS system_code,
                    bca.activity_name,
                    bca.activity_date,
                    c.chamber
                FROM bill_committee_activity bca
                LEFT JOIN committee c ON bca.committee_system_code = c.system_code
                WHERE bca.bill_id = $1
                  AND bca.activity_name ILIKE '%Referred%'
                ORDER BY bca.activity_date DESC
                LIMIT 1
            `;
            const result = await this.pool.query(query, [billId]);
            return result.rows[0] || null;
        } catch (error) {
            logger.warn('Could not get committee info', { billId, error: error.message });
            return null;
        }
    }

    /**
     * Get average days at a stage (historical)
     */
    async getAverageDaysAtStage(stage) {
        // Return reasonable defaults based on stage
        const defaults = {
            introduced: 5,
            in_committee: 120,
            reported: 30,
            passed_origin: 14,
            in_other_chamber: 90,
            passed_both: 7,
            resolving_differences: 30,
            to_president: 10,
            became_law: 0,
            vetoed: 0,
            failed: 0
        };
        return defaults[stage] || 60;
    }

    /**
     * Get origin chamber from bill type
     */
    getOriginChamber(billType) {
        const type = (billType || '').toLowerCase();
        if (type.startsWith('h') || type === 'hr' || type === 'hres' || type === 'hjres' || type === 'hconres') {
            return 'House';
        }
        return 'Senate';
    }

    /**
     * Get aggregate legislative stage statistics for a congress.
     * Uses SQL-based stage classification for performance (no per-bill JS computation).
     * @param {number} congressId - Congress number (e.g., 119)
     * @returns {Object} Stage statistics
     */
    async getCongressStats(congressId) {
        const query = `
            WITH bill_stages AS (
                SELECT
                    b.bill_id,
                    b.bill_type,
                    b.origin_chamber,
                    b.introduced_date,
                    b.latest_action_date,
                    b.policy_area,
                    CASE
                        WHEN EXISTS (SELECT 1 FROM action a WHERE a.bill_id = b.bill_id AND a.type = 'BecameLaw') THEN 'became_law'
                        WHEN EXISTS (SELECT 1 FROM action a WHERE a.bill_id = b.bill_id AND a.type = 'Veto') THEN 'vetoed'
                        WHEN EXISTS (SELECT 1 FROM action a WHERE a.bill_id = b.bill_id AND a.type = 'President') THEN 'to_president'
                        WHEN EXISTS (SELECT 1 FROM action a WHERE a.bill_id = b.bill_id AND a.type = 'ResolvingDifferences') THEN 'resolving_differences'
                        WHEN EXISTS (
                            SELECT 1 FROM action a WHERE a.bill_id = b.bill_id AND a.type = 'Floor'
                              AND (a.action_code IN ('8000','17000') OR a.text ~* 'passed|agreed to in')
                        ) THEN 'passed_chamber'
                        WHEN EXISTS (SELECT 1 FROM action a WHERE a.bill_id = b.bill_id AND a.type = 'Calendars') THEN 'on_calendar'
                        WHEN EXISTS (
                            SELECT 1 FROM action a WHERE a.bill_id = b.bill_id
                              AND (a.action_code IN ('H19000','H19100') OR a.text ~* 'reported')
                        ) THEN 'reported'
                        WHEN EXISTS (SELECT 1 FROM action a WHERE a.bill_id = b.bill_id AND a.type = 'Committee') THEN 'in_committee'
                        WHEN EXISTS (
                            SELECT 1 FROM action a WHERE a.bill_id = b.bill_id
                              AND a.action_code IN ('H11100','H11000')
                        ) THEN 'referred_to_committee'
                        ELSE 'introduced'
                    END AS stage
                FROM bill b
                WHERE b.congress_id = $1
                  AND b.bill_type IN ('hr', 's', 'hjres', 'sjres')
            )
            SELECT
                stage,
                COUNT(*) AS bill_count,
                ROUND(AVG(latest_action_date - introduced_date)) AS avg_days
            FROM bill_stages
            GROUP BY stage
            ORDER BY
                CASE stage
                    WHEN 'introduced' THEN 1
                    WHEN 'referred_to_committee' THEN 2
                    WHEN 'in_committee' THEN 3
                    WHEN 'reported' THEN 4
                    WHEN 'on_calendar' THEN 5
                    WHEN 'passed_chamber' THEN 6
                    WHEN 'resolving_differences' THEN 7
                    WHEN 'to_president' THEN 8
                    WHEN 'became_law' THEN 9
                    WHEN 'vetoed' THEN 10
                END
        `;

        const result = await this.pool.query(query, [congressId]);

        // Compute totals and advancement rates
        const totalBills = result.rows.reduce((sum, r) => sum + parseInt(r.bill_count), 0);
        const stages = {};

        for (const row of result.rows) {
            stages[row.stage] = {
                count: parseInt(row.bill_count),
                avgDays: parseInt(row.avg_days) || 0,
                percentage: totalBills > 0
                    ? Math.round((parseInt(row.bill_count) / totalBills) * 1000) / 10
                    : 0
            };
        }

        // Compute advancement rates (what % of bills at stage N reach stage N+1)
        const stageOrder = [
            'introduced', 'referred_to_committee', 'in_committee', 'reported',
            'on_calendar', 'passed_chamber', 'resolving_differences',
            'to_president', 'became_law'
        ];

        // Cumulative: bills that reached at least this stage
        const cumulativeCounts = {};
        let cumulative = totalBills;
        for (const stage of stageOrder) {
            cumulativeCounts[stage] = cumulative;
            cumulative -= (stages[stage]?.count || 0);
        }

        const advancementRates = {};
        for (let i = 0; i < stageOrder.length - 1; i++) {
            const current = stageOrder[i];
            const reachedCurrent = cumulativeCounts[current] || 0;
            const reachedNext = cumulativeCounts[stageOrder[i + 1]] || 0;
            advancementRates[current] = reachedCurrent > 0
                ? Math.round((reachedNext / reachedCurrent) * 1000) / 10
                : 0;
        }

        return {
            congressId,
            totalBills,
            stages,
            advancementRates,
            generatedAt: new Date().toISOString()
        };
    }

    /**
     * Close the connection
     */
    async close() {
        // Pool is managed externally
    }
}

module.exports = { BillJourneyService };
