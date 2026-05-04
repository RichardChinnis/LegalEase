# Cosponsor Display Design

## Decision
Expandable cosponsor list below the existing sponsor card in the 180px timeline column of `BillDetailPanel` (and `BillDetailModal`).

## Visual Structure
- Toggle button styled like "View Full History" -- shows "Cosponsors (N)" with chevron
- Count renders immediately from existing `bill.cosponsorsCount` (no fetch needed for count)
- Expanding triggers lazy fetch of full cosponsor list from `/api/db/bill/:congress/:type/:number/cosponsors`
- Scrollable container (max-height ~250px) for long lists
- Each cosponsor: compact one-line format `First Last (P-ST-DD)` with party-colored text
- View-only, no click interactions

## Data Flow
1. `congressionalDataService.getBillCosponsors(congress, type, number)` -- new method
2. Panel/modal track `cosponsorsExpanded`, `cosponsorsData`, `cosponsorsLoading` state
3. Fetch once on first expand, cache result

## Files to Modify
- `frontend-v2/js/components/bill-detail-panel.js` -- toggle + list rendering, state, fetch
- `frontend-v2/js/components/bill-detail-modal.js` -- mirror panel changes
- `frontend-v2/js/congressional-data-service.js` -- new `getBillCosponsors()` method
- `frontend-v2/css/components.css` -- `.cosponsor-toggle`, `.cosponsor-list`, `.cosponsor-item` styles
