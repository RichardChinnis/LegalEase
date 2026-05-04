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
        whatHappens: 'A bill must clear two hurdles in committee. First, the chair must choose to schedule hearings -- most bills are never heard and quietly die here. Second, if hearings occur, the committee holds a "markup" session to debate and amend the bill, then votes on whether to report it to the full chamber.',
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
