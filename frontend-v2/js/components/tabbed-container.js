/**
 * TabbedContainerComponent
 * 
 * A reusable component for creating tabbed content areas.
 */

class TabbedContainerComponent extends BaseComponent {
    constructor(props) {
        super(props);
    }

    getDefaultProps() {
        return {
            tabs: [], // e.g., [{ id: 'info', label: 'Key Info', content: '...' }]
            defaultTab: null
        };
    }

    getInitialState() {
        return {
            activeTab: this.props.defaultTab || this.props.tabs[0]?.id
        };
    }

    getEventBindings() {
        return {
            'click .tab-list__item': 'handleTabClick'
        };
    }

    handleTabClick(event, target) {
        const tabId = target.dataset.tabId;
        if (tabId && tabId !== this.state.activeTab) {
            this.setState({ activeTab: tabId });
        }
    }

    renderTabs() {
        return this.props.tabs.map(tab => `
            <li 
                class="tab-list__item ${tab.id === this.state.activeTab ? 'is-active' : ''}"
                data-tab-id="${tab.id}"
                role="tab"
                aria-selected="${tab.id === this.state.activeTab}"
                aria-controls="tab-panel-${tab.id}"
                tabindex="0"
            >
                ${tab.label}
            </li>
        `).join('');
    }

    renderPanels() {
        return this.props.tabs.map(tab => `
            <div 
                id="tab-panel-${tab.id}"
                class="tab-panel ${tab.id === this.state.activeTab ? 'is-active' : ''}"
                role="tabpanel"
                aria-labelledby="tab-${tab.id}"
            >
                ${tab.content}
            </div>
        `).join('');
    }

    template() {
        if (!this.props.tabs.length) return '<div></div>';

        return `
            <div class="tabbed-container">
                <ul class="tab-list" role="tablist">
                    ${this.renderTabs()}
                </ul>
                <div class="tab-panels">
                    ${this.renderPanels()}
                </div>
            </div>
        `;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = TabbedContainerComponent;
} else {
    window.TabbedContainerComponent = TabbedContainerComponent;
}