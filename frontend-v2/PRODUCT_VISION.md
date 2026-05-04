# CongressTracker v2 - Product Vision

## The Problem We're Solving

The average US citizen is **overwhelmed** by Congressional activity. They want to be informed, but:

- News coverage is fragmented and often partisan
- Official sources (congress.gov) are dense and technical
- The legislative process is confusing and opaque
- It's hard to connect legislation to real-world impact
- Most people don't know what their own representatives are doing

**Our user is not a policy wonk.** They're a casual citizen who maybe doesn't want a 5-minute summary, but just wants to be a bit more connected. Even if they walk away with **one piece of new information**, that's a win.

---

## Core Value Proposition

**"Congress for Humans"** - A tool that makes legislation *actually understandable* for someone who has 3-5 minutes and wants to walk away smarter.

### Our Differentiators

1. **One-sentence bill summaries** - Cut through the legalese (AI-generated)
2. **Visual bill journey/maturity** - See where a bill is at a glance, not just text
3. **Power/money transparency** - Who wins, who loses (the "aha moment")
4. **Pulled quotes** - Let the Congressional Record speak for itself (Phase 2)
5. **Process education** - Interactive learning, not dry civics

---

## The "Aha Moment"

For many citizens, the real insight is understanding **who gains power/money and who loses power/money** with certain bills. This can turn into cynicism, but it's also real. Some entities need to lose power because they've accumulated too much.

We acknowledge this tension by presenting **multiple interpretations**:

- **The Optimistic Take** (Angel icon) - The genuine, good-faith interpretation
- **The Cynical Take** (Devil icon) - The skeptical, follow-the-money interpretation
- **The Realistic Take** (Balance icon) - A measured synthesis

This framing:
- Acknowledges that bias exists in all interpretation
- Respects the user's intelligence
- Presents information without preaching
- Makes the content engaging, not dry

---

## Key Design Principles

### 1. Depth Over Breadth
Instead of showing 20 headlines, show **one bill explained well**. The current design has redundant content ("In the News" on both panels). The new design gives each section a distinct purpose.

### 2. Visual First
The stage/status of a bill should be **immediately visually apparent**, not buried in text like "in committee." Use progress trackers, color coding, and clear iconography.

### 3. Personalization Matters
"Your Congress" should actually be *yours* - based on your location, showing your actual representatives and their recent activity.

### 4. Education is a Feature
Most citizens don't understand how Congress actually works. The process itself is fascinating and frustrating. We should teach it - not in a dry civics way, but through:
- Interactive explainers
- Real examples from our data
- The "Gauntlet" simulator (see below)

### 5. No Hallucinations
When using AI for summaries or quote extraction, we must ensure accuracy. Quotes must be verifiable with exact citations (speaker, date, page number, source link).

---

## The "Gauntlet" - Legislative Process Simulator

An interactive educational feature that teaches how Congress actually works by conveying the **frustration and power dynamics** without overwhelming the user.

### Concept

Not a full simulation, but an interactive explainer that shows why bills die and who holds power:

```
YOUR BILL HAS BEEN INTRODUCED
Congratulations! You're one of ~15,000 bills
introduced this Congress.

Only 2-4% will become law.

NEXT STOP: COMMITTEE
Your bill was referred to the Judiciary Committee.

THE CALENDAR PROBLEM
Even if the committee likes your bill, the
Chair controls the calendar. No hearing = no vote.

"A committee chair can kill any bill simply by
ignoring it. No explanation required."

[See real example: H.R. 1234 sat for 847 days]
```

### Key Power Dynamics to Highlight

- **The Calendar** - Who controls what gets heard
- **The Chair** - One person's enormous power over committee business
- **Holds** - Senators can secretly block anything
- **Unanimous Consent** - How the Senate actually operates day-to-day
- **Riders** - Bills hiding inside other bills
- **Conference Committee** - Where deals actually get made
- **Cloture and Filibuster** - The 60-vote threshold reality

Each topic gets a short, punchy explainer with real examples from our database.

---

## Proposed Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  CongressTracker                    [Search...]            [Profile]│
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────┐  ┌──────────────────────────┐  │
│  │  TODAY'S SPOTLIGHT              │  │  YOUR CONGRESS           │  │
│  │                                 │  │                          │  │
│  │  H.R. 1234 - The Widget Act     │  │  [Location: California]  │  │
│  │                                 │  │                          │  │
│  │  "Allows manufacturers to       │  │  Sen. Feinstein          │  │
│  │  self-certify product safety"   │  │  Sen. Padilla            │  │
│  │                                 │  │  Rep. Pelosi (CA-11)     │  │
│  │  ┌─────────────────────────┐   │  │                          │  │
│  │  │ JOURNEY ●───○───○───○   │   │  │  [Change Location]       │  │
│  │  │         ↑               │   │  ├──────────────────────────┤  │
│  │  │    In Committee         │   │  │  TRACKING (3 bills)      │  │
│  │  │    47 days              │   │  │                          │  │
│  │  └─────────────────────────┘   │  │  H.R. 5376 ●───●───○     │  │
│  │                                 │  │  S. 1234   ●───○───○     │  │
│  │  [Angel] Optimistic Take        │  │  H.R. 999  ●───●───●─✓   │  │
│  │  "Cuts red tape for small biz"  │  │                          │  │
│  │                                 │  ├──────────────────────────┤  │
│  │  [Devil] Cynical Take           │  │  LEARN                   │  │
│  │  "Lets corps skip safety"       │  │                          │  │
│  │                                 │  │  [Game] The Gauntlet     │  │
│  │  [Balance] Realistic Take       │  │  "Can your bill survive  │  │
│  │  "Trade-off: speed vs safety"   │  │   Congress?"             │  │
│  │                                 │  │                          │  │
│  │  [Read Full Analysis]           │  │  [Guide] How Bills Work  │  │
│  │  [← Prev]  [1/5]  [Next →]      │  │  [Guide] Committee Power │  │
│  │                                 │  │  [Guide] The Calendar    │  │
│  └─────────────────────────────────┘  │                          │  │
│                                       └──────────────────────────┘  │
│  ┌─────────────────────────────────┐                                │
│  │  YOUR REPS' RECENT ACTIVITY     │                                │
│  │                                 │                                │
│  │  [Vote] Sen. Padilla voted YES  │                                │
│  │  on H.R. 5376 (2 hrs ago)       │                                │
│  │                                 │                                │
│  │  [Sponsor] Rep. Pelosi          │                                │
│  │  cosponsored H.R. 8888          │                                │
│  │                                 │                                │
│  └─────────────────────────────────┘                                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Section Purposes (No Redundancy)

| Section | Purpose |
|---------|---------|
| **Today's Spotlight** | ONE bill, explained deeply with visual journey and multi-perspective analysis |
| **Your Congress** | Personalized by zip code - your actual senators and representative |
| **Tracking** | Bills the user is following, with mini progress indicators |
| **Learn** | Educational content including the Gauntlet simulator |
| **Your Reps' Activity** | What your specific representatives have done recently |

---

## Visual Bill Journey/Maturity

Every bill should display its progress visually, not just as text:

```
INTRODUCED → COMMITTEE → FLOOR VOTE → OTHER CHAMBER → CONFERENCE → PRESIDENT → LAW
    ●────────────●────────────○────────────○─────────────○───────────○─────────○
                 ↑
           YOU ARE HERE

"In House Judiciary Committee since March 15, 2025"
"47 days at this stage (avg: 120 days)"
"Committee Chair: Rep. Smith (R-TX)"
"Next step: Committee hearing or markup"
```

Contextual information includes:
- Time at current stage vs. average
- Who controls the next step
- Historical odds of advancing
- What typically happens next

---

## Quote Surfacing (Phase 2)

### The Vision
Pull impactful quotes from Committee Reports and the Congressional Record that distill confusing bills down to salient truths.

```
"This bill effectively guts 40 years of consumer protection."
— Rep. Jones, Committee Hearing, March 12, 2025
   [View in Congressional Record →]

"Finally cutting red tape that costs American jobs."
— Rep. Smith, Floor Speech, March 15, 2025
   [View in Congressional Record →]
```

### Current Data State
- 446,880 Congressional Record articles (metadata)
- Only 31 have actual text content fetched
- Infrastructure exists (`bill_congressional_record_references` table) but not populated

### Implementation Path
1. Parse bill actions to extract CR page references
2. Fetch text content for relevant CR articles
3. AI extracts quotable statements with full citation
4. Store in dedicated table with speaker, date, page, source URL
5. Display with verification links (no hallucinations)

---

## AI Integration

AI is already integrated via chat functionality. Expand usage for:

### One-Sentence Summaries
Stored in database alongside each bill. Plain English, no jargon.

### Angel/Devil/Realistic Takes
Generated on demand or pre-computed for spotlight bills:
- Optimistic interpretation (good-faith case for the bill)
- Cynical interpretation (follow-the-money skepticism)
- Realistic synthesis (balanced assessment)

### Quote Extraction (Phase 2)
AI identifies quotable passages from CR text, but:
- Must cite exact source (speaker, date, page)
- Must link to verifiable source document
- No hallucinated quotes ever

---

## Technical Notes

### Desktop First
Still determining final value proposition. Need the real estate of desktop format to experiment before optimizing for mobile.

### Data Advantages
We have data most news sites don't surface:
- Full Congressional Record text (once fetched)
- Committee Reports
- Hearing transcripts
- Detailed bill action history
- Sponsor/cosponsor relationships

This is our moat - making the unsexy, detailed record accessible and understandable.

---

## Success Metrics

For our target user (casual citizen wanting to be more connected):

1. **Time on site** - Are they engaged?
2. **Return visits** - Did they come back?
3. **Bills tracked** - Are they following specific legislation?
4. **Educational content engagement** - Are they using the Gauntlet/guides?
5. **Location set** - Did they personalize their experience?

The ultimate measure: **Did they walk away knowing something they didn't know before?**

---

## Phase Roadmap

### Phase 1: Foundation (Current Focus)
- [ ] Redesign dashboard layout (no redundancy)
- [ ] Implement visual bill journey tracker
- [ ] Build "Your Congress" personalization (by zip code)
- [ ] Create one-sentence AI summaries
- [ ] Implement Angel/Devil/Realistic framing

### Phase 2: Education
- [ ] Build "The Gauntlet" interactive simulator
- [ ] Create educational guides (How Bills Work, Committee Power, etc.)
- [ ] Add contextual "Learn more" throughout the UI

### Phase 3: Depth
- [ ] Populate Congressional Record text content
- [ ] Build quote extraction pipeline
- [ ] Surface quotes on bill detail views
- [ ] Link quotes to source documents

### Phase 4: Engagement
- [ ] "This Week in Congress" calendar
- [ ] Notifications for tracked bills
- [ ] Rep voting record comparisons
- [ ] Mobile optimization

---

## Appendix: Why Cosponsors Matter (Example Educational Content)

*This is the kind of content we should surface throughout the app:*

**Q: A bill can have one or more sponsors. Why? What is the purpose of cosponsors?**

When a member introduces a bill, they're the **sponsor**. Other members can sign on as **cosponsors** to show support.

**Why it matters:**
- **Signal of viability** - A bill with 50 cosponsors looks more serious than one with 3
- **Bipartisan cosponsors** - If both parties cosponsor, it's more likely to advance
- **Constituent pressure** - Representatives often cosponsor when constituents ask
- **Horse-trading** - "I'll cosponsor yours if you cosponsor mine"

**The cynical reality:** Cosponsoring is low-cost virtue signaling. Members can claim they "supported" a bill that never had a chance of passing.

**The data tells the story:** Only ~4% of bills become law. Many have dozens of cosponsors and still die in committee.

---

*Document created: December 2024*
*Last updated: December 2024*
