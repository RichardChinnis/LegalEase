# How Bills Work -- Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an interactive "How Bills Work" modal for the Learn section: a legislative pipeline map with environment simulation controls and stage detail panels, powered by real "This Congress" stats from the database.

**Architecture:** A new `HowBillsWorkModal` component (extending `BaseComponent`) contains three sub-components: `PipelineMap`, `EnvironmentControls`, and `StageDetail`. A client-side `LegislativeSimulator` rules engine computes probabilities. A single new backend endpoint `/api/db/congress/:id/legislative-stats` provides aggregate stage statistics. The modal is launched from the existing Learn section links in `index.html`.

**Tech Stack:** Vanilla JS (BaseComponent pattern), CSS custom properties, existing ModalComponent, existing BillJourneyService (backend), PostgreSQL aggregate queries.

**Design doc:** `docs/plans/2026-02-18-how-bills-work-design.md`

---

## Task 1: Backend -- Add Legislative Stats Endpoint

Add an aggregate stats endpoint to the backend that returns per-stage bill counts, advancement rates, and average days at stage for a given congress.

**Files:**
- Modify: `backend/services/bill-journey-service.js` (add `getCongressStats` method)
- Modify: `backend/routes/api.js` (add endpoint)

**Step 1: Add `getCongressStats` method to BillJourneyService**

Add this method to `backend/services/bill-journey-service.js`, inside the class body after the existing methods:

```javascript
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
```

**Step 2: Add the API route**

Add this route in `backend/routes/api.js`, near the existing journey route (around line 5084). Follow the same pattern used by the journey endpoint:

```javascript
/**
 * @swagger
 * /api/db/congress/{id}/legislative-stats:
 *   get:
 *     summary: Get aggregate legislative stage statistics for a congress
 *     description: Returns per-stage bill counts, advancement rates, and average days
 */
router.get('/db/congress/:id/legislative-stats',
  createMiddlewareChain('standardAPI'),
  asyncHandler(async (req, res) => {
    const { Pool } = require('pg');
    const pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_DATABASE || 'congress_api',
      user: process.env.DB_USER || 'congress_api_backend',
      password: process.env.DB_PASSWORD
    });

    try {
      const journeyService = new BillJourneyService(pool);
      const congressId = parseInt(req.params.id);

      if (isNaN(congressId) || congressId < 1) {
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid congress ID', type: 'ValidationError' }
        });
      }

      const stats = await journeyService.getCongressStats(congressId);
      res.json({ success: true, ...stats });
    } catch (error) {
      logger.error('Error fetching legislative stats', { error: error.message });
      res.status(500).json({
        success: false,
        error: { message: 'Failed to fetch legislative stats', type: 'DatabaseError' }
      });
    } finally {
      await pool.end();
    }
  })
);
```

**Step 3: Test the endpoint manually**

Run: `curl -s http://localhost:3000/api/db/congress/119/legislative-stats | python3 -m json.tool | head -40`

Expected: JSON with `success: true`, `totalBills: ~11500`, `stages` object with counts, and `advancementRates`.

**Step 4: Commit**

```bash
git add backend/services/bill-journey-service.js backend/routes/api.js
git commit -m "feat: add /api/db/congress/:id/legislative-stats endpoint

Aggregate stage statistics for the How Bills Work modal.
Returns per-stage bill counts, advancement rates, and avg days."
```

---

## Task 2: Frontend -- Legislative Simulator Rules Engine

Build the client-side rules engine that computes probability modifiers based on environment control settings. This is a pure data module with no DOM interaction.

**Files:**
- Create: `frontend-v2/js/utils/legislative-simulator.js`

**Step 1: Create the simulator module**

```javascript
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
        if (house.party === senate.party) {
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
```

**Step 2: Add script tag to index.html**

In `frontend-v2/index.html`, add the script tag after `bill-journey.js` (line 147):

```html
<script src="js/utils/legislative-simulator.js"></script>
```

**Step 3: Verify in browser console**

Open the app in browser, open dev console, run:
```javascript
LegislativeSimulator.compute({
    sponsorParty: 'D',
    houseMajority: 'strong_r',
    senateMajority: 'lean_r',
    topic: 'Healthcare',
    billType: 'standard'
});
```

Expected: Object with `stageRates`, `survival`, and `scenario` containing a sentence about steep odds.

**Step 4: Commit**

```bash
git add frontend-v2/js/utils/legislative-simulator.js frontend-v2/index.html
git commit -m "feat: add LegislativeSimulator rules engine for How Bills Work modal

Client-side probability computation based on political environment
settings (sponsor party, chamber majorities, topic, bill type)."
```

---

## Task 3: Frontend -- Stage Content Data Module

Create the static educational content for each stage. This is a pure data file with no DOM logic.

**Files:**
- Create: `frontend-v2/js/utils/stage-content.js`

**Step 1: Create the stage content module**

```javascript
/**
 * Stage Content Data
 *
 * Static educational content for each legislative stage in the
 * How Bills Work modal. Contains descriptions, key players,
 * possible outcomes, and display metadata.
 */
const StageContent = {
    introduction: {
        title: 'Introduction',
        mapLabel: 'Intro',
        whatHappens: 'A member of Congress drafts a bill and formally introduces it by placing it in the "hopper" (House) or presenting it on the floor (Senate). The bill receives an official number (e.g., H.R. 1234 or S. 567) and is published in the Congressional Record.',
        keyPlayers: [
            { role: 'Bill Sponsor', desc: 'The member who introduces the bill' },
            { role: 'Cosponsors', desc: 'Other members who sign on to show support' },
            { role: 'Parliamentarian', desc: 'Determines which committee(s) receive the bill' }
        ],
        outcomes: [
            { type: 'advance', text: 'Referred to committee for review' },
            { type: 'lateral', text: 'Referred to multiple committees (split referral)' }
        ],
        mapPosition: { row: 0, col: 0 },
        isBranch: false
    },

    committee: {
        title: 'Committee Review',
        mapLabel: 'Committee',
        whatHappens: 'The committee with jurisdiction reviews the bill. The chair decides whether to schedule hearings, where experts and stakeholders testify. If the bill advances, the committee holds a "markup" session to debate and amend it, then votes on whether to send it to the full chamber.',
        keyPlayers: [
            { role: 'Committee Chair', desc: 'Controls the agenda -- decides if the bill gets a hearing' },
            { role: 'Ranking Member', desc: 'Leads the minority party on the committee' },
            { role: 'Subcommittee Chairs', desc: 'May review the bill first in a specialized subcommittee' }
        ],
        outcomes: [
            { type: 'advance', text: 'Reported favorably -- sent to full chamber' },
            { type: 'fail', text: 'Tabled -- chair never schedules it (most common outcome)' },
            { type: 'lateral', text: 'Amended significantly in markup' },
            { type: 'lateral', text: 'Referred to subcommittee for further review' }
        ],
        mapPosition: { row: 0, col: 1 },
        isBranch: false
    },

    tabled: {
        title: 'Tabled in Committee',
        mapLabel: 'Tabled',
        whatHappens: 'The vast majority of bills die in committee without ever receiving a hearing. The committee chair simply never schedules them. This is the most common way legislation fails.',
        keyPlayers: [
            { role: 'Committee Chair', desc: 'Has sole discretion to schedule or ignore bills' }
        ],
        outcomes: [
            { type: 'fail', text: 'Bill dies at end of Congress (2-year session)' },
            { type: 'lateral', text: 'Discharge petition (rare) can force bill to the floor' }
        ],
        mapPosition: { row: 1, col: 1 },
        isBranch: true,
        isTerminal: true
    },

    floor_vote: {
        title: 'Floor Vote',
        mapLabel: 'Floor Vote',
        whatHappens: 'The full chamber debates and votes on the bill. In the House, the Rules Committee first sets debate terms. In the Senate, bills face potential filibusters requiring 60 votes to overcome. Members may offer amendments before the final vote.',
        keyPlayers: [
            { role: 'Speaker / Majority Leader', desc: 'Controls the floor schedule' },
            { role: 'Rules Committee (House)', desc: 'Sets terms for debate and amendments' },
            { role: 'All Members', desc: 'Debate, amend, and vote on the bill' }
        ],
        outcomes: [
            { type: 'advance', text: 'Passed -- sent to other chamber' },
            { type: 'fail', text: 'Failed -- bill does not receive enough votes' },
            { type: 'lateral', text: 'Amended on the floor, then passed' }
        ],
        mapPosition: { row: 0, col: 2 },
        isBranch: false
    },

    failed: {
        title: 'Failed Vote',
        mapLabel: 'Failed',
        whatHappens: 'The bill did not receive enough votes to pass. In the House, a simple majority is needed. In the Senate, 60 votes may be needed to overcome a filibuster. A failed bill can sometimes be reintroduced in a future Congress.',
        keyPlayers: [],
        outcomes: [
            { type: 'fail', text: 'Bill dies unless reintroduced in a new Congress' }
        ],
        mapPosition: { row: 1, col: 2 },
        isBranch: true,
        isTerminal: true
    },

    other_chamber: {
        title: 'Other Chamber',
        mapLabel: 'Other Chamber',
        whatHappens: 'The bill goes through the entire process again in the other chamber: committee review, possible amendments, and a floor vote. The other chamber often passes its own version with changes, requiring reconciliation.',
        keyPlayers: [
            { role: 'Receiving Committee Chair', desc: 'Decides priority in the other chamber' },
            { role: 'Majority Leader (Senate)', desc: 'Controls Senate floor schedule' },
            { role: 'Speaker (House)', desc: 'Controls House floor schedule' }
        ],
        outcomes: [
            { type: 'advance', text: 'Passed without changes -- goes to President' },
            { type: 'advance', text: 'Passed with changes -- goes to conference' },
            { type: 'fail', text: 'Fails in committee or floor vote of other chamber' }
        ],
        mapPosition: { row: 0, col: 3 },
        isBranch: false
    },

    conference: {
        title: 'Conference Committee',
        mapLabel: 'Conference',
        whatHappens: 'When the two chambers pass different versions, a conference committee of members from both chambers negotiates a compromise. The resulting "conference report" must then pass both chambers with no further amendments.',
        keyPlayers: [
            { role: 'Conferees', desc: 'Selected members from both chambers who negotiate' },
            { role: 'Committee Chairs', desc: 'Usually lead their chamber\'s delegation' },
            { role: 'Party Leadership', desc: 'May direct negotiation priorities' }
        ],
        outcomes: [
            { type: 'advance', text: 'Conference report agreed to by both chambers' },
            { type: 'fail', text: 'Negotiations collapse -- bill stalls' },
            { type: 'lateral', text: 'Amendment exchange (ping-pong) instead of conference' }
        ],
        mapPosition: { row: 1, col: 3 },
        isBranch: true
    },

    president: {
        title: 'Presidential Action',
        mapLabel: 'President',
        whatHappens: 'The enrolled bill is presented to the President, who has 10 days to act. The President can sign it into law, veto it, or take no action. If Congress is in session and the President does nothing for 10 days, the bill becomes law automatically.',
        keyPlayers: [
            { role: 'President', desc: 'Signs, vetoes, or lets the bill become law' },
            { role: 'White House Staff', desc: 'Advises on signing statements and policy implications' }
        ],
        outcomes: [
            { type: 'advance', text: 'Signed into law' },
            { type: 'fail', text: 'Vetoed -- returned to Congress' },
            { type: 'advance', text: 'Pocket signature -- becomes law after 10 days' },
            { type: 'fail', text: 'Pocket veto -- Congress adjourns within 10 days' }
        ],
        mapPosition: { row: 0, col: 4 },
        isBranch: false
    },

    vetoed: {
        title: 'Vetoed',
        mapLabel: 'Vetoed',
        whatHappens: 'The President rejects the bill and returns it to Congress with objections. Congress can attempt to override the veto, which requires a two-thirds supermajority vote in both chambers -- a high bar that rarely succeeds.',
        keyPlayers: [
            { role: 'President', desc: 'Issues the veto with a message explaining objections' },
            { role: 'Both Chambers', desc: 'Must each achieve two-thirds vote to override' }
        ],
        outcomes: [
            { type: 'advance', text: 'Veto overridden -- bill becomes law' },
            { type: 'fail', text: 'Override fails -- bill dies' }
        ],
        mapPosition: { row: 1, col: 4 },
        isBranch: true
    },

    became_law: {
        title: 'Became Law',
        mapLabel: 'Law',
        whatHappens: 'The bill is assigned a Public Law number and published. Executive agencies then develop regulations to implement it. The law takes effect on the date specified in the bill or, if none is specified, upon the President\'s signature.',
        keyPlayers: [
            { role: 'Executive Agencies', desc: 'Write regulations to implement the law' },
            { role: 'Courts', desc: 'May interpret or review the law\'s constitutionality' }
        ],
        outcomes: [],
        mapPosition: { row: 0, col: 5 },
        isBranch: false,
        isTerminal: true
    },

    /**
     * Map connections for rendering arrows between nodes.
     * Each connection: { from, to, type: 'solid'|'dashed' }
     */
    connections: [
        { from: 'introduction', to: 'committee', type: 'solid' },
        { from: 'committee', to: 'floor_vote', type: 'solid' },
        { from: 'committee', to: 'tabled', type: 'dashed' },
        { from: 'floor_vote', to: 'other_chamber', type: 'solid' },
        { from: 'floor_vote', to: 'failed', type: 'dashed' },
        { from: 'other_chamber', to: 'president', type: 'solid' },
        { from: 'other_chamber', to: 'conference', type: 'dashed' },
        { from: 'conference', to: 'president', type: 'solid' },
        { from: 'president', to: 'became_law', type: 'solid' },
        { from: 'president', to: 'vetoed', type: 'dashed' },
        { from: 'vetoed', to: 'became_law', type: 'dashed' }
    ],

    /**
     * Ordered list of main-path stage keys for iteration
     */
    mainPath: ['introduction', 'committee', 'floor_vote', 'other_chamber', 'president', 'became_law'],

    /**
     * All stage keys including branches
     */
    allStages: ['introduction', 'committee', 'tabled', 'floor_vote', 'failed', 'other_chamber', 'conference', 'president', 'vetoed', 'became_law'],

    /**
     * Get content for a stage by key
     * @param {string} key
     * @returns {Object|null}
     */
    get(key) {
        return this[key] || null;
    }
};

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StageContent;
} else {
    window.StageContent = StageContent;
}
```

**Step 2: Add script tag to index.html**

In `frontend-v2/index.html`, add after `legislative-simulator.js`:

```html
<script src="js/utils/stage-content.js"></script>
```

**Step 3: Commit**

```bash
git add frontend-v2/js/utils/stage-content.js frontend-v2/index.html
git commit -m "feat: add StageContent data module for How Bills Work modal

Static educational content for each legislative stage:
descriptions, key players, possible outcomes, map layout."
```

---

## Task 4: Frontend -- CSS for the How Bills Work Modal

Create the stylesheet for the modal layout, pipeline map, environment controls, and stage detail panel.

**Files:**
- Create: `frontend-v2/css/how-bills-work.css`
- Modify: `frontend-v2/index.html` (add stylesheet link)

**Step 1: Create the stylesheet**

This is a large file. Create `frontend-v2/css/how-bills-work.css` with the full layout, map node styles, control styles, and stage detail styles. The CSS should use existing CSS custom properties from `base.css` for colors, fonts, spacing, and shadows.

Key sections to implement:
- `.hbw-modal` -- Full-screen modal override (95vw x 90vh)
- `.hbw-layout` -- CSS Grid: map on top (~40%), bottom split into controls (~40% width) and detail (~60% width)
- `.hbw-map` -- Flexbox/grid for node positioning with CSS arrows between nodes
- `.hbw-node` -- Stage node styling with heat-color backgrounds, probability badges
- `.hbw-node--selected` -- Gold border + glow for selected node
- `.hbw-node--branch` -- Slightly different style for branch/terminal nodes
- `.hbw-arrow` -- SVG or CSS lines connecting nodes (solid and dashed variants)
- `.hbw-controls` -- Control panel with form styling
- `.hbw-controls__group` -- Individual control group (label + input)
- `.hbw-toggle-group` -- Radio button toggle group (for sponsor party)
- `.hbw-slider` -- Segmented slider for majority strength
- `.hbw-scenario` -- Scenario summary sentence (italic serif)
- `.hbw-detail` -- Stage detail panel
- `.hbw-detail__section` -- Consistent section styling (heading + content)
- `.hbw-detail__stats-box` -- "This Congress" stats box
- `.hbw-detail__insight` -- Dynamic simulation insight
- `.hbw-fade-in` -- Fade transition for content changes
- `@media` breakpoints for tablet/mobile stacking

Note: Exact CSS will be written during implementation. The key constraint is: use ONLY existing CSS variables, no new ones.

**Step 2: Add stylesheet to index.html**

In `frontend-v2/index.html`, add after `spotlight-redesign.css` (line 18):

```html
<link rel="stylesheet" href="css/how-bills-work.css">
```

**Step 3: Commit**

```bash
git add frontend-v2/css/how-bills-work.css frontend-v2/index.html
git commit -m "feat: add CSS for How Bills Work modal

Layout, pipeline map nodes, environment controls, stage detail
panel, animations, and responsive breakpoints."
```

---

## Task 5: Frontend -- HowBillsWorkModal Component

The main component that orchestrates the three zones. Extends `BaseComponent`, uses `ModalComponent` for the shell.

**Files:**
- Create: `frontend-v2/js/components/how-bills-work-modal.js`
- Modify: `frontend-v2/index.html` (add script tag)

**Step 1: Create the component**

The component should:

1. Extend `BaseComponent`
2. On construction, create a `ModalComponent` with `size: 'full'` and custom class `hbw-modal`
3. Maintain state for: `selectedStage` (string key or null), `environment` (object with all control values), `congressStats` (data from API), `simResult` (computed from LegislativeSimulator)
4. On open:
   - Fetch `/api/db/congress/119/legislative-stats` for "This Congress" data
   - Set environment controls to "This Congress" defaults (D sponsor, current actual majorities)
   - Run initial simulation
   - Render the three zones
5. `template()` returns the full modal body HTML:
   - Pipeline map section with nodes and arrows (using `StageContent.connections` and `StageContent.allStages`)
   - Environment controls section with form inputs
   - Stage detail section (empty welcome message or selected stage content)
6. `getEventBindings()` returns click handlers for nodes and change handlers for controls
7. On node click: update `selectedStage`, re-render stage detail panel only (not full re-render -- use direct DOM updates for performance)
8. On control change: update `environment`, run `LegislativeSimulator.compute()`, update probability badges and heat colors via targeted DOM updates
9. `open()` method: delegates to the inner `ModalComponent.open()`
10. `destroy()` method: cleans up modal and listeners

**Step 2: Add script tag to index.html**

In `frontend-v2/index.html`, after `all-bills-panel.js` (line 180):

```html
<script src="js/components/how-bills-work-modal.js"></script>
```

**Step 3: Commit**

```bash
git add frontend-v2/js/components/how-bills-work-modal.js frontend-v2/index.html
git commit -m "feat: add HowBillsWorkModal component

Main orchestrator for the How Bills Work interactive modal.
Manages pipeline map, environment controls, and stage detail."
```

---

## Task 6: Frontend -- Wire Up the Learn Section

Connect the "How Bills Work" learn item in `index.html` to open the modal, and initialize it from the dashboard.

**Files:**
- Modify: `frontend-v2/index.html` (remove `coming-soon` class from How Bills Work link, add data attribute)
- Modify: `frontend-v2/js/pages/dashboard.js` (initialize and wire up the modal)

**Step 1: Update index.html Learn section**

Change the "How Bills Work" learn item (lines 64-76) to be active (not coming-soon):

```html
<a href="#" class="learn-item" data-learn="how-bills-work">
    <span class="learn-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
    </span>
    <span class="learn-content">
        <span class="learn-title">How Bills Work</span>
        <span class="learn-desc">The legislative process explained</span>
    </span>
</a>
```

Note: Remove `learn-item--coming-soon` class and the `<span class="coming-soon-badge">Coming Soon</span>`.

**Step 2: Add modal initialization and click handler in dashboard.js**

In `DashboardPage.initializeComponents()` (around line 148), add:

```javascript
// Initialize How Bills Work modal
this.initHowBillsWorkModal();
```

Add the init method to `DashboardPage`:

```javascript
/**
 * Initialize How Bills Work interactive modal
 */
initHowBillsWorkModal() {
    if (typeof HowBillsWorkModal === 'undefined') {
        console.warn('[Dashboard] HowBillsWorkModal class not loaded');
        return;
    }

    this.components.howBillsWorkModal = new HowBillsWorkModal();
}
```

In `setupEventListeners()`, add a click handler for the Learn section:

```javascript
// Learn section - How Bills Work
document.addEventListener('click', (e) => {
    const learnItem = e.target.closest('[data-learn="how-bills-work"]');
    if (learnItem) {
        e.preventDefault();
        if (this.components.howBillsWorkModal) {
            this.components.howBillsWorkModal.open();
        }
    }
});
```

**Step 3: Test end-to-end**

1. Load the app in browser
2. Click "How Bills Work" in the Learn section
3. Modal should open with pipeline map, default controls, and welcome message in detail panel
4. Click a stage node -- detail panel should populate
5. Change a control -- probabilities should update on map
6. Press ESC -- modal should close

**Step 4: Commit**

```bash
git add frontend-v2/index.html frontend-v2/js/pages/dashboard.js frontend-v2/js/components/how-bills-work-modal.js
git commit -m "feat: wire up How Bills Work modal to Learn section

Enable the How Bills Work learn item, initialize the modal from
dashboard, and handle click-to-open."
```

---

## Task 7: Polish -- Animations, Accessibility, and Edge Cases

Final polish pass across all files.

**Files:**
- Modify: `frontend-v2/js/components/how-bills-work-modal.js`
- Modify: `frontend-v2/css/how-bills-work.css`

**Step 1: Add animated probability counter**

In the modal component, add a helper method that animates number changes on probability badges using `requestAnimationFrame`:

```javascript
_animateCounter(element, fromValue, toValue, duration = 300) {
    const start = performance.now();
    const step = (timestamp) => {
        const progress = Math.min((timestamp - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
        const current = fromValue + (toValue - fromValue) * eased;
        element.textContent = `${Math.round(current)}%`;
        if (progress < 1) {
            requestAnimationFrame(step);
        }
    };
    requestAnimationFrame(step);
}
```

**Step 2: Add aria-live region for probability changes**

Ensure the map contains a visually hidden `aria-live="polite"` region that announces probability changes to screen readers:

```html
<div class="hbw-map__announcer sr-only" aria-live="polite" aria-atomic="true"></div>
```

When probabilities change, update its text content:
```javascript
announcer.textContent = `Probabilities updated. Committee advancement: ${rates.committee.rate}%. Floor vote: ${rates.floor_vote.rate}%.`;
```

**Step 3: Handle loading and error states**

- Show a loading skeleton while fetching congress stats
- If the API call fails, show "This Congress" stats as "unavailable" but don't block the simulation controls

**Step 4: Verify accessibility**

- Tab through all interactive elements in the modal
- Verify ESC closes the modal
- Verify screen reader can navigate nodes and hear probability changes
- Verify all form controls have labels

**Step 5: Commit**

```bash
git add frontend-v2/js/components/how-bills-work-modal.js frontend-v2/css/how-bills-work.css
git commit -m "feat: polish How Bills Work modal

Animated probability counters, aria-live announcements,
loading/error states, and accessibility verification."
```

---

## Summary of Files

| Action | File |
|--------|------|
| Modify | `backend/services/bill-journey-service.js` |
| Modify | `backend/routes/api.js` |
| Create | `frontend-v2/js/utils/legislative-simulator.js` |
| Create | `frontend-v2/js/utils/stage-content.js` |
| Create | `frontend-v2/css/how-bills-work.css` |
| Create | `frontend-v2/js/components/how-bills-work-modal.js` |
| Modify | `frontend-v2/index.html` |
| Modify | `frontend-v2/js/pages/dashboard.js` |

## Task Dependencies

```
Task 1 (Backend endpoint) ─────────────────────────┐
Task 2 (Simulator rules engine) ──┐                 │
Task 3 (Stage content data) ──────┤                 │
Task 4 (CSS) ─────────────────────┼─> Task 5 ──> Task 6 ──> Task 7
                                  │   (Modal      (Wire up)  (Polish)
                                  │    component)
```

Tasks 1-4 are independent and can run in parallel. Task 5 depends on 2, 3, and 4. Task 6 depends on 5. Task 7 depends on 6. Task 1 is needed for the "This Congress" data box but the modal can render without it (graceful degradation).
