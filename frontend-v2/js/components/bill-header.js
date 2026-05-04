/**
 * BillHeaderComponent
 *
 * Displays the main header for the bill detail view, including the
 * bill number, title, sponsor, and other key information.
 */

class BillHeaderComponent extends BaseComponent {
    constructor(props) {
        super(props);
    }

    getDefaultProps() {
        return {
            bill: {},
        };
    }

    getInitialState() {
        return {
            isFollowing: false,
            checkingFollowStatus: true
        };
    }

    componentDidMount() {
        this.checkFollowStatus();
    }

    async checkFollowStatus() {
        const { bill } = this.props;
        if (!bill || !bill.id) {
            this.setState({ checkingFollowStatus: false });
            return;
        }

        let userId = localStorage.getItem('congress-tracker-user-id');
        if (!userId) {
            this.setState({ checkingFollowStatus: false });
            return;
        }

        try {
            const response = await fetch(`/api/db/user/${userId}/follows?follow_type=bill`);
            if (response.ok) {
                const data = await response.json();
                const follows = data.follows || [];
                const isFollowing = follows.some(f => (f.follow_target_id || '').toUpperCase() === (bill.id || '').toUpperCase());
                this.setState({ isFollowing, checkingFollowStatus: false });
                this.updateFollowButton(isFollowing);
            } else {
                this.setState({ checkingFollowStatus: false });
            }
        } catch (error) {
            console.error('[BillHeaderComponent] Error checking follow status:', error);
            this.setState({ checkingFollowStatus: false });
        }
    }

    getEventBindings() {
        return {
            'click [data-action="toggle-follow"]': 'handleFollowClick'
        };
    }

    async handleFollowClick(e, target) {
        e.preventDefault();
        e.stopPropagation();

        const { bill } = this.props;
        if (!bill || !bill.id) return;

        let userId = localStorage.getItem('congress-tracker-user-id');
        if (!userId) {
            userId = 'user-' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('congress-tracker-user-id', userId);
        }

        try {
            if (this.state.isFollowing) {
                // Unfollow
                const response = await fetch(`/api/db/user/${userId}/follow`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        follow_type: 'bill',
                        target_id: bill.id
                    })
                });

                if (response.ok) {
                    this.setState({ isFollowing: false });
                    this.updateFollowButton(false);
                    EventBus.emit('bill:unfollowed', { billId: bill.id });
                }
            } else {
                // Follow
                const response = await fetch(`/api/db/user/${userId}/follow`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        follow_type: 'bill',
                        target_id: bill.id
                    })
                });

                if (response.ok) {
                    this.setState({ isFollowing: true });
                    this.updateFollowButton(true);
                    EventBus.emit('bill:followed', {
                        billId: bill.id,
                        bill: {
                            bill_id: bill.id,
                            bill_type: bill.type,
                            bill_number: bill.number,
                            congress: bill.congress,
                            title: bill.title
                        }
                    });
                }
            }
        } catch (error) {
            console.error('[BillHeaderComponent] Error toggling follow:', error);
        }
    }

    updateFollowButton(isFollowing) {
        const btn = this.element?.querySelector('[data-action="toggle-follow"]');
        if (btn) {
            btn.classList.toggle('is-following', isFollowing);
            btn.setAttribute('aria-pressed', isFollowing);

            const label = btn.querySelector('.follow-btn__label');
            if (label) {
                label.textContent = isFollowing ? 'Following' : 'Follow';
            }

            const svg = btn.querySelector('svg');
            if (svg) {
                svg.setAttribute('fill', isFollowing ? 'currentColor' : 'none');
            }
        }
    }

    renderFollowButton() {
        const { bill } = this.props;
        if (!bill || !bill.id) return '';

        const { isFollowing, checkingFollowStatus } = this.state;

        return `
            <button class="bill-header__follow-btn ${isFollowing ? 'is-following' : ''}"
                    data-action="toggle-follow"
                    data-bill-id="${bill.id}"
                    title="${isFollowing ? 'Unfollow this bill' : 'Follow this bill'}"
                    aria-pressed="${isFollowing}"
                    ${checkingFollowStatus ? 'disabled' : ''}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="${isFollowing ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                </svg>
                <span class="follow-btn__label">${isFollowing ? 'Following' : 'Follow'}</span>
            </button>
        `;
    }

    template() {
        const { bill } = this.props;
        if (!bill) return '<div></div>';

        // Safe access to status - it might be undefined
        const statusClass = bill.status ? `bill-status--${bill.status.toLowerCase().replace(/\s+/g, '-')}` : '';
        const statusText = bill.status || 'Unknown';

        return `
            <div class="bill-header">
                <div class="bill-header__top-row">
                    <h1 class="bill-header__title">${bill.title}</h1>
                    ${this.renderFollowButton()}
                </div>
                <div class="bill-header__meta">
                    <span class="bill-header__number">${bill.type} ${bill.number}</span>
                    <span class="bill-header__status ${statusClass}">${statusText}</span>
                    <span class="bill-header__policy-area">${bill.policyArea || 'N/A'}</span>
                </div>
                <div class="bill-header__sponsor">
                    <strong>Sponsor:</strong>
                    ${bill.sponsor ? `<span class="sponsor-link" data-party="${bill.sponsor.party}" data-bioguide-id="${bill.sponsor.bioguideId}">${bill.sponsor.name}</span>` : 'N/A'}
                </div>
            </div>
        `;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = BillHeaderComponent;
} else {
    window.BillHeaderComponent = BillHeaderComponent;
}