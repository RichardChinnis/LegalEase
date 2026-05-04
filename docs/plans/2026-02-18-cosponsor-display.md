# Cosponsor Display Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an expandable cosponsor list below the sponsor card in the bill detail panel and modal.

**Architecture:** A new collapsible section rendered by `renderCosponsorSection()` in both `BillDetailPanel` and `BillDetailModal`. Data is lazy-loaded from the existing `/api/db/bill/:congress/:type/:number/cosponsors` endpoint on first expand. The `congressionalDataService` gets a new `getBillCosponsors()` method. New CSS classes follow the existing actions-toggle pattern.

**Tech Stack:** Vanilla JS (no framework), CSS custom properties, existing fetch-based API layer

---

### Task 1: Add CSS for cosponsor toggle and list

**Files:**
- Modify: `frontend-v2/css/components.css` (add after line 5741, after the sponsor card section)

**Step 1: Add CSS rules**

Insert after the `.sponsor-card__party` rule block (line 5741) and before the `SUMMARY SECTION` comment (line 5743):

```css
/* ================================================
   COSPONSOR SECTION (below sponsor card)
   ================================================ */

.bill-detail__cosponsor-section {
    margin-top: var(--space-sm);
}

.cosponsor-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    width: 100%;
    padding: var(--space-xs) var(--space-sm);
    background: var(--color-background-secondary);
    border: 1px solid var(--color-border-primary);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-medium);
    cursor: pointer;
    transition: all var(--transition-base);
}

.cosponsor-toggle:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
    background: rgba(30, 58, 95, 0.05);
}

.cosponsor-toggle[aria-expanded="true"] {
    border-color: var(--color-primary);
    color: var(--color-primary);
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
}

.cosponsor-toggle__text {
    flex: 1;
    text-align: left;
}

.cosponsor-toggle__chevron {
    flex-shrink: 0;
    transition: transform var(--transition-base);
}

.cosponsor-toggle[aria-expanded="true"] .cosponsor-toggle__chevron {
    transform: rotate(90deg);
}

.cosponsor-list-container {
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.3s ease;
    border: 1px solid var(--color-border-primary);
    border-top: none;
    border-radius: 0 0 var(--radius-md) var(--radius-md);
}

.cosponsor-list-container[aria-hidden="false"] {
    max-height: 250px;
    overflow-y: auto;
}

.cosponsor-list {
    list-style: none;
    margin: 0;
    padding: 0;
}

.cosponsor-list__item {
    padding: var(--space-xs) var(--space-sm);
    font-size: var(--font-size-xs);
    color: var(--color-text-secondary);
    border-bottom: 1px solid var(--color-border-primary);
    line-height: 1.4;
}

.cosponsor-list__item:last-child {
    border-bottom: none;
}

.cosponsor-list__name {
    font-weight: var(--font-weight-medium);
}

.cosponsor-list__party--d {
    color: #2563eb;
}

.cosponsor-list__party--r {
    color: #dc2626;
}

.cosponsor-list__party--i {
    color: #7c3aed;
}

.cosponsor-list__loading,
.cosponsor-list__error,
.cosponsor-list__empty {
    padding: var(--space-sm);
    font-size: var(--font-size-xs);
    color: var(--color-text-tertiary);
    text-align: center;
    font-style: italic;
}
```

**Step 2: Verify CSS loads correctly**

Open the app in a browser and confirm no CSS errors in console. The new classes won't be visible yet since no HTML uses them.

**Step 3: Commit**

```bash
git add frontend-v2/css/components.css
git commit -m "feat: add CSS for cosponsor expandable section"
```

---

### Task 2: Add `getBillCosponsors()` to CongressionalDataService

**Files:**
- Modify: `frontend-v2/js/congressional-data-service.js`

**Step 1: Add the method**

Add this method to the `CongressionalDataService` class, after the existing bill-related methods (a good location is near `getBillDetails` or `getBillSummaries`). Find a suitable spot after the existing bill endpoint methods.

```javascript
    /**
     * Get bill cosponsors
     * @param {number} congress - Congress number
     * @param {string} type - Bill type (hr, s, etc.)
     * @param {number} number - Bill number
     * @returns {Promise<Array>} Array of cosponsor objects
     */
    async getBillCosponsors(congress, type, number) {
        const cacheKey = `cosponsors-${congress}-${type}-${number}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const response = await fetch(`/api/db/bill/${congress}/${type}/${number}/cosponsors`);
            if (!response.ok) throw new Error('Failed to load cosponsors');
            const data = await response.json();
            const cosponsors = data.cosponsors || [];
            this.setCache(cacheKey, cosponsors);
            return cosponsors;
        } catch (error) {
            console.error('[CongressionalDataService] Error fetching cosponsors:', error);
            throw error;
        }
    }
```

Note: Check that the class has `getCached` and `setCache` helper methods. If it uses a different caching pattern (like direct `this.cache.get/set` with TTL checks), match that pattern instead. The existing code at lines 11-12 shows `this.cache = new Map()` and `this.cacheTimeout = 5 * 60 * 1000`. Search the file for how other methods use the cache and replicate that exact pattern.

**Step 2: Verify the method is accessible**

Open browser console and run:
```javascript
typeof window.congressionalDataService?.getBillCosponsors
// Should return "function" if the service is on window
```

**Step 3: Commit**

```bash
git add frontend-v2/js/congressional-data-service.js
git commit -m "feat: add getBillCosponsors to data service"
```

---

### Task 3: Add cosponsor section to BillDetailPanel

**Files:**
- Modify: `frontend-v2/js/components/bill-detail-panel.js`

**Step 1: Add cosponsor state fields**

In the constructor state object (around line 24), add cosponsor state alongside the existing actions state:

```javascript
            // Cosponsors state
            cosponsorsExpanded: false,
            cosponsorsData: null,
            cosponsorsLoading: false,
            cosponsorsError: null,
```

Add these after the `actionsError: null,` line (line 38).

**Step 2: Reset cosponsor state when loading a new bill**

In `showBill()` (around line 272), after the actions reset lines, add:

```javascript
            // Reset cosponsors state when loading a new bill
            this.state.cosponsorsExpanded = false;
            this.state.cosponsorsData = null;
            this.state.cosponsorsLoading = false;
            this.state.cosponsorsError = null;
```

Do the same in `showBillWithData()` (around line 351), after the actions reset block.

**Step 3: Add `renderCosponsorSection()` method**

Add this method right after the `renderSponsorCard()` method (after line 654):

```javascript
    /**
     * Render cosponsor expandable section
     */
    renderCosponsorSection(bill) {
        const count = bill.cosponsors?.count || bill.cosponsorsCount || 0;
        if (count === 0) return '';

        return `
            <div class="bill-detail__cosponsor-section">
                <button class="cosponsor-toggle"
                        data-action="toggle-cosponsors"
                        aria-expanded="${this.state.cosponsorsExpanded}"
                        aria-controls="panel-cosponsor-list">
                    <span class="cosponsor-toggle__text">Cosponsors (${count})</span>
                    <svg class="cosponsor-toggle__chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                </button>
                <div class="cosponsor-list-container"
                     id="panel-cosponsor-list"
                     aria-hidden="${!this.state.cosponsorsExpanded}">
                    ${this.state.cosponsorsData ? this.renderCosponsorList(this.state.cosponsorsData) : ''}
                </div>
            </div>
        `;
    }

    /**
     * Render the cosponsor list items
     */
    renderCosponsorList(cosponsors) {
        if (cosponsors.length === 0) {
            return '<div class="cosponsor-list__empty">No cosponsors found</div>';
        }

        const items = cosponsors.map(cs => {
            const name = cs.fullName || `${cs.firstName || ''} ${cs.lastName || ''}`.trim();
            const partyCode = this.getPartyCode(cs.party);
            const state = cs.state || '';
            const district = cs.district;
            const location = district !== undefined && district !== null
                ? `${partyCode.toUpperCase()}-${state}-${district}`
                : `${partyCode.toUpperCase()}-${state}`;

            return `<li class="cosponsor-list__item">
                <span class="cosponsor-list__name cosponsor-list__party--${partyCode}">${this.escapeHtml(name)}</span>
                <span class="cosponsor-list__location">(${location})</span>
            </li>`;
        }).join('');

        return `<ul class="cosponsor-list">${items}</ul>`;
    }
```

**Step 4: Insert cosponsor section in render HTML**

In the `render()` method, find where `renderSponsorCard(bill)` is called (line 457):

```javascript
                            ${this.renderSponsorCard(bill)}
```

Change it to:

```javascript
                            ${this.renderSponsorCard(bill)}
                            ${this.renderCosponsorSection(bill)}
```

**Step 5: Add event listener for cosponsor toggle**

In `setupEventListeners()` (around line 882, after the actions toggle listener), add:

```javascript
        // Cosponsors toggle button
        const cosponsorsToggle = this.container.querySelector('[data-action="toggle-cosponsors"]');
        if (cosponsorsToggle) {
            cosponsorsToggle.addEventListener('click', (e) => {
                e.preventDefault();
                this.toggleCosponsorsSection();
            });
        }
```

**Step 6: Add `toggleCosponsorsSection()` and `loadCosponsors()` methods**

Add these after the existing `toggleActionsPanel()` method (after line 1698):

```javascript
    /**
     * Toggle cosponsors section visibility
     */
    async toggleCosponsorsSection() {
        this.state.cosponsorsExpanded = !this.state.cosponsorsExpanded;

        const toggleBtn = this.container.querySelector('[data-action="toggle-cosponsors"]');
        const listContainer = this.container.querySelector('#panel-cosponsor-list');

        if (toggleBtn) {
            toggleBtn.setAttribute('aria-expanded', this.state.cosponsorsExpanded);
        }

        if (listContainer) {
            listContainer.setAttribute('aria-hidden', !this.state.cosponsorsExpanded);
        }

        // Load cosponsors data if expanding and not already loaded
        if (this.state.cosponsorsExpanded && !this.state.cosponsorsData) {
            await this.loadCosponsors();
        }
    }

    /**
     * Load cosponsor data from the API
     */
    async loadCosponsors() {
        const bill = this.state.bill;
        if (!bill) return;

        const listContainer = this.container.querySelector('#panel-cosponsor-list');
        this.state.cosponsorsLoading = true;

        if (listContainer) {
            listContainer.innerHTML = '<div class="cosponsor-list__loading">Loading cosponsors...</div>';
        }

        try {
            const congress = bill.congress_id || bill.congress;
            const type = (bill.bill_type || bill.type || '').toLowerCase();
            const number = bill.bill_number || bill.number;

            const response = await fetch(`/api/db/bill/${congress}/${type}/${number}/cosponsors`);
            if (!response.ok) throw new Error('Failed to load cosponsors');

            const data = await response.json();
            this.state.cosponsorsData = data.cosponsors || [];
            this.state.cosponsorsLoading = false;
            this.state.cosponsorsError = null;

            if (listContainer) {
                listContainer.innerHTML = this.renderCosponsorList(this.state.cosponsorsData);
            }
        } catch (error) {
            console.error('[BillDetailPanel] Error loading cosponsors:', error);
            this.state.cosponsorsLoading = false;
            this.state.cosponsorsError = error.message;

            if (listContainer) {
                listContainer.innerHTML = '<div class="cosponsor-list__error">Failed to load cosponsors</div>';
            }
        }
    }
```

**Step 7: Test in browser**

1. Open the app, click on a bill that has cosponsors
2. Verify the "Cosponsors (N)" toggle appears below the sponsor card
3. Click it -- should expand and show a loading message, then the list
4. Click again -- should collapse
5. Navigate to a different bill -- section should reset to collapsed
6. Check a bill with 0 cosponsors -- section should not appear

**Step 8: Commit**

```bash
git add frontend-v2/js/components/bill-detail-panel.js
git commit -m "feat: add expandable cosponsor section to bill detail panel"
```

---

### Task 4: Add cosponsor section to BillDetailModal

**Files:**
- Modify: `frontend-v2/js/components/bill-detail-modal.js`

**Step 1: Add cosponsor state fields**

In the constructor state object (around line 22), add:

```javascript
            // Cosponsors state
            cosponsorsExpanded: false,
            cosponsorsData: null,
            cosponsorsLoading: false,
            cosponsorsError: null,
```

**Step 2: Add `renderCosponsorSection()` and `renderCosponsorList()` methods**

Add these after the `renderSponsorCard()` method (after line 418). Use the same implementation as BillDetailPanel but with `modal-cosponsor-list` as the ID:

```javascript
    /**
     * Render cosponsor expandable section
     */
    renderCosponsorSection(bill) {
        const count = bill.cosponsors?.count || bill.cosponsorsCount || 0;
        if (count === 0) return '';

        return `
            <div class="bill-detail__cosponsor-section">
                <button class="cosponsor-toggle"
                        data-action="toggle-cosponsors"
                        aria-expanded="${this.state.cosponsorsExpanded}"
                        aria-controls="modal-cosponsor-list">
                    <span class="cosponsor-toggle__text">Cosponsors (${count})</span>
                    <svg class="cosponsor-toggle__chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                </button>
                <div class="cosponsor-list-container"
                     id="modal-cosponsor-list"
                     aria-hidden="${!this.state.cosponsorsExpanded}">
                    ${this.state.cosponsorsData ? this.renderCosponsorList(this.state.cosponsorsData) : ''}
                </div>
            </div>
        `;
    }

    /**
     * Render the cosponsor list items
     */
    renderCosponsorList(cosponsors) {
        if (cosponsors.length === 0) {
            return '<div class="cosponsor-list__empty">No cosponsors found</div>';
        }

        const items = cosponsors.map(cs => {
            const name = cs.fullName || `${cs.firstName || ''} ${cs.lastName || ''}`.trim();
            const partyCode = this.getPartyCode(cs.party);
            const state = cs.state || '';
            const district = cs.district;
            const location = district !== undefined && district !== null
                ? `${partyCode.toUpperCase()}-${state}-${district}`
                : `${partyCode.toUpperCase()}-${state}`;

            return `<li class="cosponsor-list__item">
                <span class="cosponsor-list__name cosponsor-list__party--${partyCode}">${this.escapeHtml(name)}</span>
                <span class="cosponsor-list__location">(${location})</span>
            </li>`;
        }).join('');

        return `<ul class="cosponsor-list">${items}</ul>`;
    }
```

**Step 3: Insert cosponsor section in render HTML**

In the `renderContent()` method, find `renderSponsorCard(bill)` (line 280):

```javascript
                        ${this.renderSponsorCard(bill)}
```

Change to:

```javascript
                        ${this.renderSponsorCard(bill)}
                        ${this.renderCosponsorSection(bill)}
```

**Step 4: Add event listener and toggle/load methods**

In `setupEventListeners()` (after line 611), add:

```javascript
        // Cosponsors toggle
        const cosponsorsToggle = content.querySelector('[data-action="toggle-cosponsors"]');
        if (cosponsorsToggle) {
            cosponsorsToggle.addEventListener('click', (e) => {
                e.preventDefault();
                this.toggleCosponsorsSection();
            });
        }
```

Add `toggleCosponsorsSection()` and `loadCosponsors()` methods to the class. These are nearly identical to the panel versions, but use `this.modalElement` instead of `this.container` for DOM queries, and use `#modal-cosponsor-list` as the container ID:

```javascript
    /**
     * Toggle cosponsors section visibility
     */
    async toggleCosponsorsSection() {
        this.state.cosponsorsExpanded = !this.state.cosponsorsExpanded;

        const toggleBtn = this.modalElement.querySelector('[data-action="toggle-cosponsors"]');
        const listContainer = this.modalElement.querySelector('#modal-cosponsor-list');

        if (toggleBtn) {
            toggleBtn.setAttribute('aria-expanded', this.state.cosponsorsExpanded);
        }

        if (listContainer) {
            listContainer.setAttribute('aria-hidden', !this.state.cosponsorsExpanded);
        }

        if (this.state.cosponsorsExpanded && !this.state.cosponsorsData) {
            await this.loadCosponsors();
        }
    }

    /**
     * Load cosponsor data from the API
     */
    async loadCosponsors() {
        const bill = this.state.bill;
        if (!bill) return;

        const listContainer = this.modalElement.querySelector('#modal-cosponsor-list');
        this.state.cosponsorsLoading = true;

        if (listContainer) {
            listContainer.innerHTML = '<div class="cosponsor-list__loading">Loading cosponsors...</div>';
        }

        try {
            const congress = bill.congress_id || bill.congress;
            const type = (bill.bill_type || bill.type || '').toLowerCase();
            const number = bill.bill_number || bill.number;

            const response = await fetch(`/api/db/bill/${congress}/${type}/${number}/cosponsors`);
            if (!response.ok) throw new Error('Failed to load cosponsors');

            const data = await response.json();
            this.state.cosponsorsData = data.cosponsors || [];
            this.state.cosponsorsLoading = false;
            this.state.cosponsorsError = null;

            if (listContainer) {
                listContainer.innerHTML = this.renderCosponsorList(this.state.cosponsorsData);
            }
        } catch (error) {
            console.error('[BillDetailModal] Error loading cosponsors:', error);
            this.state.cosponsorsLoading = false;
            this.state.cosponsorsError = error.message;

            if (listContainer) {
                listContainer.innerHTML = '<div class="cosponsor-list__error">Failed to load cosponsors</div>';
            }
        }
    }
```

**Step 5: Reset state on modal open**

Find where the modal resets state when opening a new bill (the `openWithBillId` or equivalent method). Add cosponsor state reset there:

```javascript
            this.state.cosponsorsExpanded = false;
            this.state.cosponsorsData = null;
            this.state.cosponsorsLoading = false;
            this.state.cosponsorsError = null;
```

**Step 6: Test**

If the modal can be triggered (it's currently disabled for auto-open but kept as fallback), test by calling `window.billDetailModal.openWithBillId('119-HR-1')` in the console.

**Step 7: Commit**

```bash
git add frontend-v2/js/components/bill-detail-modal.js
git commit -m "feat: add expandable cosponsor section to bill detail modal"
```

---

### Task 5: Final verification and cleanup

**Step 1: Full integration test**

Test these scenarios in the browser:
1. Bill with many cosponsors (e.g., a popular resolution) -- verify scrollable list works
2. Bill with few cosponsors (1-5) -- verify short list renders cleanly
3. Bill with 0 cosponsors -- verify section is hidden
4. Expand cosponsors, then navigate to a different bill -- verify state resets
5. Expand cosponsors, collapse, expand again -- verify data is cached (no re-fetch)
6. Check that the timeline column width (180px) accommodates the toggle and list

**Step 2: Commit all remaining changes**

```bash
git add -A
git commit -m "feat: complete cosponsor display implementation"
```
