/**
 * Legislative Simulator Rules Engine
 *
 * Computes probability modifiers for each legislative stage based on
 * political environment settings. Used by the How Bills Work modal.
 *
 * This is a simplified educational model, not a statistical predictor.
 * Probabilities are illustrative and designed to show how political
 * dynamics affect the legislative process.
 */
const LegislativeSimulator = {
    /**
     * Baseline probabilities (percentage chance of advancing past each stage).
     * Based on historical averages across multiple congresses.
     */
    BASELINE: {
        introduction:          100,   // All bills start here
        committee:             12,    // ~12% make it out of committee
        floor_vote:            65,    // ~65% of reported bills pass floor vote
        other_chamber:         50,    // ~50% pass the other chamber
        conference:            80,    // ~80% of conference bills get resolved
        president:             90,    // ~90% of enrolled bills get signed
        veto_override:         7      // ~7% of vetoes are overridden
    },

    /**
     * Topic partisan scores: higher = more partisan, lower = more bipartisan.
     * Scale: 0.0 (fully bipartisan) to 1.0 (fully partisan).
     */
    TOPIC_PARTISANSHIP: {
        'Healthcare':       0.85,
        'Immigration':      0.90,
        'Environment':      0.75,
        'Economy':          0.50,
        'Defense':          0.30,
        'Infrastructure':   0.25,
        'Education':        0.60,
        'Other':            0.50
    },

    /**
     * Majority strength multipliers.
     * Maps slider position to a numeric factor.
     */
    MAJORITY_STRENGTH: {
        'strong_d':  { party: 'D', strength: 1.0 },
        'lean_d':    { party: 'D', strength: 0.6 },
        'even':      { party: null, strength: 0.0 },
        'lean_r':    { party: 'R', strength: 0.6 },
        'strong_r':  { party: 'R', strength: 1.0 }
    },

    /**
     * Compute probabilities for all stages given environment settings.
     *
     * @param {Object} env - Environment settings
     * @param {string} env.sponsorParty - 'D', 'R', or 'I'
     * @param {string} env.houseMajority - key from MAJORITY_STRENGTH
     * @param {string} env.senateMajority - key from MAJORITY_STRENGTH
     * @param {string} env.topic - key from TOPIC_PARTISANSHIP
     * @param {string} env.billType - 'standard' or 'budget'
     * @returns {Object} Per-stage probabilities and metadata
     */
    compute(env) {
        const house = this.MAJORITY_STRENGTH[env.houseMajority] || this.MAJORITY_STRENGTH.even;
        const senate = this.MAJORITY_STRENGTH[env.senateMajority] || this.MAJORITY_STRENGTH.even;
        const topicPartisanship = this.TOPIC_PARTISANSHIP[env.topic] || 0.5;
        const isBudget = env.billType === 'budget';
        const sponsor = env.sponsorParty || 'I';

        // Determine origin chamber (House for HR, but we simplify to House-first)
        const originMajority = house;
        const otherMajority = senate;

        // Compute alignment: does sponsor match majority?
        const originAlignment = this._partyAlignment(sponsor, originMajority.party);
        const otherAlignment = this._partyAlignment(sponsor, otherMajority.party);

        // Partisan modifier: how much partisanship affects this bill
        // Higher partisanship + misalignment = bigger penalty
        const originPartisanMod = this._partisanModifier(originAlignment, originMajority.strength, topicPartisanship);
        const otherPartisanMod = this._partisanModifier(otherAlignment, otherMajority.strength, topicPartisanship);

        // Committee stage
        let committee = this.BASELINE.committee;
        committee *= (1 + originPartisanMod * 0.8); // Strong effect at committee
        committee = this._clamp(committee, 1, 40);

        // Floor vote
        let floorVote = this.BASELINE.floor_vote;
        floorVote *= (1 + originPartisanMod * 0.3); // Moderate effect on floor
        floorVote = this._clamp(floorVote, 20, 95);

        // Other chamber
        let otherChamber = this.BASELINE.other_chamber;
        otherChamber *= (1 + otherPartisanMod * 0.6);
        // Even split increases uncertainty
        if (otherMajority.strength === 0) {
            otherChamber *= 0.7;
        }
        // Budget bills bypass filibuster in Senate
        if (isBudget && otherMajority.party !== null) {
            otherChamber *= 1.3;
        }
        otherChamber = this._clamp(otherChamber, 10, 85);

        // Conference
        let conference = this.BASELINE.conference;
        // Even splits make conference harder
        const avgStrength = (originMajority.strength + otherMajority.strength) / 2;
        if (avgStrength < 0.3) {
            conference *= 0.7;
        }
        // Different majority parties make conference much harder
        if (originMajority.party && otherMajority.party && originMajority.party !== otherMajority.party) {
            conference *= 0.5;
        }
        conference = this._clamp(conference, 20, 95);

        // President (simplified: assume president signs most bills)
        let president = this.BASELINE.president;
        president = this._clamp(president, 60, 98);

        // Veto override
        let vetoOverride = this.BASELINE.veto_override;
        // Strong bipartisan support increases override chance
        if (topicPartisanship < 0.3) {
            vetoOverride *= 2;
        }
        vetoOverride = this._clamp(vetoOverride, 2, 25);

        // Cumulative survival: probability of reaching each stage
        const survival = {
            introduction:  100,
            committee:     committee,
            floor_vote:    Math.round(committee * floorVote / 100 * 10) / 10,
            other_chamber: Math.round(committee * floorVote / 100 * otherChamber / 100 * 10) / 10,
            president:     Math.round(committee * floorVote / 100 * otherChamber / 100 * president / 100 * 10) / 10,
            became_law:    Math.round(committee * floorVote / 100 * otherChamber / 100 * president / 100 * 10) / 10
        };

        return {
            // Per-stage advancement probability (% chance of passing this stage)
            stageRates: {
                introduction:  { rate: 100, label: 'All bills start here' },
                committee:     { rate: Math.round(committee * 10) / 10, label: `${Math.round(committee)}% advance` },
                floor_vote:    { rate: Math.round(floorVote * 10) / 10, label: `${Math.round(floorVote)}% pass` },
                other_chamber: { rate: Math.round(otherChamber * 10) / 10, label: `${Math.round(otherChamber)}% pass` },
                conference:    { rate: Math.round(conference * 10) / 10, label: `${Math.round(conference)}% resolved` },
                president:     { rate: Math.round(president * 10) / 10, label: `${Math.round(president)}% signed` },
                veto_override: { rate: Math.round(vetoOverride * 10) / 10, label: `${Math.round(vetoOverride)}% overridden` }
            },
            // Cumulative survival to reach each stage
            survival,
            // Metadata for scenario summary
            scenario: this._buildScenarioSummary(env, sponsor, originMajority, otherMajority, topicPartisanship)
        };
    },

    /**
     * Generate simulation insight text for a specific stage.
     *
     * @param {string} stageKey - Stage identifier
     * @param {Object} env - Environment settings
     * @param {Object} result - Result from compute()
     * @returns {string} Human-readable insight sentence
     */
    getStageInsight(stageKey, env, result) {
        const sponsor = env.sponsorParty || 'I';
        const house = this.MAJORITY_STRENGTH[env.houseMajority] || this.MAJORITY_STRENGTH.even;
        const senate = this.MAJORITY_STRENGTH[env.senateMajority] || this.MAJORITY_STRENGTH.even;
        const partyNames = { D: 'Democratic', R: 'Republican', I: 'Independent' };
        const sponsorName = partyNames[sponsor] || 'Independent';

        const insights = {
            introduction: `All bills begin with introduction. A ${sponsorName} sponsor introduces the bill in their chamber.`,
            committee: this._committeeInsight(sponsor, house, env.topic),
            floor_vote: this._floorInsight(sponsor, house),
            other_chamber: this._otherChamberInsight(sponsor, senate, env.billType),
            conference: this._conferenceInsight(house, senate),
            president: `Most enrolled bills are signed. The President signs roughly ${result.stageRates.president.rate}% of bills that reach the desk.`,
            vetoed: `If vetoed, Congress needs a two-thirds supermajority in both chambers to override -- a rare event at ${result.stageRates.veto_override.rate}%.`,
            became_law: `Under these conditions, roughly ${result.survival.became_law}% of introduced bills would become law.`
        };

        return insights[stageKey] || '';
    },

    // --- Private helpers ---

    _partyAlignment(sponsor, majorityParty) {
        if (!majorityParty) return 0;       // Even split, neutral
        if (sponsor === majorityParty) return 1;   // Aligned
        if (sponsor === 'I') return 0.3;           // Independent, slight disadvantage
        return -1;                                  // Opposed
    },

    _partisanModifier(alignment, strength, topicPartisanship) {
        // alignment: -1 (opposed) to +1 (aligned)
        // strength: 0 (even) to 1 (strong majority)
        // topicPartisanship: 0 (bipartisan) to 1 (highly partisan)
        return alignment * strength * topicPartisanship;
    },

    _clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    },

    _buildScenarioSummary(env, sponsor, originMajority, otherMajority, topicPartisanship) {
        const partyNames = { D: 'Democratic', R: 'Republican', I: 'Independent' };
        const sponsorName = partyNames[sponsor] || 'Independent';
        const topic = env.topic || 'general';
        const article = ['A','E','I','O','U'].includes(sponsorName[0]) ? 'An' : 'A';

        let difficulty;
        const originAlign = this._partyAlignment(sponsor, originMajority.party);
        const otherAlign = this._partyAlignment(sponsor, otherMajority.party);
        const avgAlign = (originAlign + otherAlign) / 2;

        if (avgAlign > 0.5) difficulty = 'has favorable conditions';
        else if (avgAlign > 0) difficulty = 'faces moderate headwinds';
        else if (avgAlign > -0.5) difficulty = 'faces significant opposition';
        else difficulty = 'faces steep odds';

        if (topicPartisanship < 0.3) {
            difficulty += ', though bipartisan support on this topic helps';
        }

        return `${article} ${sponsorName}-sponsored ${topic.toLowerCase()} bill ${difficulty}.`;
    },

    _committeeInsight(sponsor, house, topic) {
        const partyNames = { D: 'Democratic', R: 'Republican', I: 'Independent' };
        const alignment = this._partyAlignment(sponsor, house.party);
        if (alignment > 0) {
            return `With a ${partyNames[sponsor]} sponsor and ${partyNames[house.party]}-majority House, the committee chair is an ally. The bill is more likely to get hearings and markup.`;
        } else if (alignment < 0) {
            return `The opposing-party committee chair controls the agenda. Most minority-party bills never receive a hearing, let alone a markup vote.`;
        }
        return `In an evenly split chamber, committee advancement depends heavily on bipartisan appeal. ${topic} bills have mixed prospects.`;
    },

    _floorInsight(sponsor, house) {
        const alignment = this._partyAlignment(sponsor, house.party);
        if (alignment > 0) {
            return `The majority-party leadership controls the floor schedule. An aligned sponsor means the bill is more likely to receive a vote.`;
        } else if (alignment < 0) {
            return `Even if the bill clears committee, the majority party leadership may not schedule a floor vote for an opposing-party bill.`;
        }
        return `With no clear majority, floor scheduling becomes a negotiation. Both parties must agree to bring the bill forward.`;
    },

    _otherChamberInsight(sponsor, senate, billType) {
        const isBudget = billType === 'budget';
        if (isBudget) {
            return `Budget and appropriations bills can bypass the Senate filibuster through reconciliation, requiring only a simple majority. This significantly improves passage odds.`;
        }
        const alignment = this._partyAlignment(sponsor, senate.party);
        if (alignment > 0) {
            return `With an aligned Senate majority, the bill has a smoother path. However, the Senate's 60-vote filibuster threshold means some bipartisan support is still needed.`;
        }
        return `The Senate's filibuster rule means 60 votes are needed to advance most legislation. Without bipartisan support, even popular bills can stall.`;
    },

    _conferenceInsight(house, senate) {
        if (house.party && senate.party && house.party !== senate.party) {
            return `With different parties controlling each chamber, conference negotiations are contentious. Bills often stall as each side refuses to accept the other's version.`;
        }
        if (house.party && senate.party && house.party === senate.party) {
            return `Same-party control of both chambers makes conference resolution smoother, though policy disagreements within the party can still slow things down.`;
        }
        return `Conference committees must reconcile different versions passed by each chamber. Success depends on finding common ground.`;
    }
};

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LegislativeSimulator;
} else {
    window.LegislativeSimulator = LegislativeSimulator;
}
