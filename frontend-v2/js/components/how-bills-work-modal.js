/**
 * HowBillsWorkModal Component
 *
 * Main orchestrator for the "How Bills Work" interactive educational modal.
 * Displays the legislative pipeline as a visual flowchart with clickable
 * stage nodes, environment controls for adjusting political conditions,
 * and a detail panel showing educational content for each stage.
 *
 * Architecture:
 *   - Extends BaseComponent (autoRender: false)
 *   - Creates an inner ModalComponent for the modal shell
 *   - Manages three zones: pipeline map, environment controls, stage detail
 *   - Uses targeted DOM updates instead of full re-renders for performance
 *
 * Dependencies (all loaded as globals via script tags):
 *   - BaseComponent (window.BaseComponent)
 *   - ModalComponent (window.ModalComponent)
 *   - LegislativeSimulator (window.LegislativeSimulator)
 *   - StageContent (window.StageContent)
 *   - EventBus / GLOBAL_EVENTS (global event system)
 */

class HowBillsWorkModal extends BaseComponent {
    constructor() {
        super({}, { autoRender: false });

        // Create inner modal shell
        this.modal = new ModalComponent({
            size: 'full',
            className: 'hbw-modal',
            title: 'How a Bill Becomes Law',
            header: {
                show: true,
                title: 'How a Bill Becomes Law',
                showCloseButton: true
            },
            body: {
                content: '',
                padding: false,
                scrollable: false
            },
            footer: {
                show: false
            }
        }, {
            autoRender: false
        });

        this.addChild(this.modal);

        // Bound references for cleanup
        this._boundBodyClickHandler = null;
        this._boundTopicChangeHandler = null;
        this._boundControlsToggleHandler = null;
        this._resizeObserver = null;
    }

    /**
     * Get default props
     * @returns {Object}
     */
    getDefaultProps() {
        return {};
    }

    /**
     * Get initial state
     * @returns {Object}
     */
    getInitialState() {
        return {
            selectedStage: null,
            environment: {
                sponsorParty: 'R',
                houseMajority: 'lean_r',
                senateMajority: 'lean_r',
                topic: 'Other',
                billType: 'standard'
            },
            congressStats: null,
            simResult: null,
            loading: false,
            error: null
        };
    }

    /**
     * Open the modal. Fetches congress stats, runs the initial simulation,
     * renders the body content, and opens the modal shell.
     */
    async open() {
        // Run initial simulation with defaults
        this.state.simResult = LegislativeSimulator.compute(this.state.environment);

        // Fetch congress stats in the background (non-blocking)
        this._fetchCongressStats().then(() => {
            // If a stage is selected and stats arrived, update the detail panel
            if (this.state.selectedStage) {
                this._updateDetailPanel();
            }
        });

        // Set modal body content
        this.modal.updateBody(this._renderBody());

        // Open the modal shell
        await this.modal.open();

        // After modal is open and in DOM, bind events and draw arrows.
        // Use once() to avoid accumulating duplicate listeners on repeated opens.
        const onOpened = () => {
            this._bindBodyEvents();
            this._drawArrows();
            this._setupResizeObserver();
        };
        this.modal.once('modal:opened', onOpened);

        // If the modal opened synchronously (already emitted), bind now
        if (this.modal.state.isOpen && !this.modal.isAnimating) {
            this.modal.off('modal:opened', onOpened);
            this._bindBodyEvents();
            requestAnimationFrame(() => {
                this._drawArrows();
                this._setupResizeObserver();
            });
        }
    }

    /**
     * Close the modal and clean up.
     */
    close() {
        this._teardownResizeObserver();
        this._unbindBodyEvents();
        this.modal.close();
    }

    /**
     * Destroy the component and all children.
     */
    destroy() {
        this._teardownResizeObserver();
        this._unbindBodyEvents();
        super.destroy();
    }

    // ========================================================================
    // TEMPLATE / RENDERING
    // ========================================================================

    /**
     * BaseComponent template -- not used directly since content goes
     * inside the ModalComponent body. Provides a minimal wrapper.
     * @returns {string}
     */
    template() {
        return '<div class="hbw-wrapper" style="display:none;"></div>';
    }

    /**
     * Render the full body content for the modal.
     * @returns {string} HTML string
     * @private
     */
    _renderBody() {
        return `
            <div class="hbw-layout">
                ${this._renderMap()}
                ${this._renderControls()}
                ${this._renderDetail()}
            </div>
        `;
    }

    /**
     * Render the pipeline map zone.
     * @returns {string}
     * @private
     */
    _renderMap() {
        return `
            <div class="hbw-map" role="group" aria-label="Legislative pipeline stages">
                <svg class="hbw-map__arrows">
                    <defs>
                        <marker id="hbw-arrowhead"
                                markerWidth="10" markerHeight="7"
                                refX="9" refY="3.5"
                                orient="auto"
                                markerUnits="strokeWidth">
                            <path class="hbw-arrow__head" d="M0,0 L0,7 L10,3.5 z" />
                        </marker>
                    </defs>
                </svg>
                ${this._renderNodes()}
                <div class="sr-only" aria-live="polite" aria-atomic="true" data-hbw-announcer></div>
            </div>
        `;
    }

    /**
     * Render all stage nodes in the pipeline map.
     * @returns {string}
     * @private
     */
    _renderNodes() {
        const simResult = this.state.simResult;
        const selectedStage = this.state.selectedStage;

        return StageContent.allStages.map(key => {
            const stage = StageContent.get(key);
            if (!stage) return '';

            const stageRate = simResult && simResult.stageRates[key];
            const rate = stageRate ? Math.round(stageRate.rate) : null;
            const heatClass = this._getHeatClass(rate);
            const isSelected = selectedStage === key;

            const classes = [
                'hbw-node',
                heatClass ? `hbw-node--${heatClass}` : '',
                isSelected ? 'hbw-node--selected' : '',
                stage.isBranch ? 'hbw-node--branch' : ''
            ].filter(Boolean).join(' ');

            const pos = stage.mapPosition;
            const ariaLabel = rate !== null
                ? `${stage.title}, ${rate}% advancement rate`
                : stage.title;

            return `
                <button class="${classes}"
                        data-stage="${key}"
                        aria-label="${ariaLabel}"
                        style="grid-column: ${pos.col + 1}; grid-row: ${pos.row + 1};">
                    <span class="hbw-node__label">${stage.mapLabel}</span>
                    ${rate !== null ? `<span class="hbw-node__badge">${rate}%</span>` : ''}
                </button>
            `;
        }).join('');
    }

    /**
     * Render the environment controls panel.
     * @returns {string}
     * @private
     */
    _renderControls() {
        const env = this.state.environment;
        const simResult = this.state.simResult;
        const scenario = simResult ? simResult.scenario : '';

        return `
            <div class="hbw-controls">
                <div class="hbw-scenario" data-hbw-scenario>${this._escapeHtml(scenario)}</div>

                ${this._renderMobileToggle()}

                ${this._renderSponsorPartyControl(env)}
                ${this._renderMajorityControl('House Majority', 'houseMajority', env.houseMajority)}
                ${this._renderMajorityControl('Senate Majority', 'senateMajority', env.senateMajority)}
                ${this._renderTopicControl(env)}
                ${this._renderBillTypeControl(env)}

                <div class="hbw-controls__group">
                    <button class="hbw-controls__reset" type="button">Reset to This Congress</button>
                </div>
            </div>
        `;
    }

    /**
     * Render the mobile controls toggle button (hidden on desktop via CSS).
     * @returns {string}
     * @private
     */
    _renderMobileToggle() {
        return `
            <button class="hbw-controls__toggle" type="button"
                    aria-expanded="true"
                    aria-controls="hbw-controls-inner">
                Adjust Political Environment
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </button>
        `;
    }

    /**
     * Render sponsor party toggle (D / R / I).
     * @param {Object} env
     * @returns {string}
     * @private
     */
    _renderSponsorPartyControl(env) {
        const parties = [
            { key: 'D', label: 'D' },
            { key: 'R', label: 'R' },
            { key: 'I', label: 'I' }
        ];

        const buttons = parties.map(p => {
            const isActive = env.sponsorParty === p.key;
            const activeClass = isActive ? `hbw-toggle-group__btn--active-${p.key.toLowerCase()}` : '';
            return `<button class="hbw-toggle-group__btn ${activeClass}"
                            type="button"
                            data-party="${p.key}"
                            aria-pressed="${isActive}">${p.label}</button>`;
        }).join('');

        return `
            <fieldset class="hbw-controls__group">
                <legend class="hbw-controls__label">Sponsor Party</legend>
                <div class="hbw-toggle-group" role="radiogroup" aria-label="Sponsor Party">${buttons}</div>
            </fieldset>
        `;
    }

    /**
     * Render a majority strength segmented control.
     * @param {string} label
     * @param {string} field - 'houseMajority' or 'senateMajority'
     * @param {string} currentValue
     * @returns {string}
     * @private
     */
    _renderMajorityControl(label, field, currentValue) {
        const options = [
            { key: 'strong_d', label: 'Strong D' },
            { key: 'lean_d',   label: 'Lean D' },
            { key: 'even',     label: 'Even' },
            { key: 'lean_r',   label: 'Lean R' },
            { key: 'strong_r', label: 'Strong R' }
        ];

        const buttons = options.map(opt => {
            const isActive = currentValue === opt.key;
            const activeClass = isActive ? 'hbw-segment-control__option--active' : '';
            return `<button class="hbw-segment-control__option ${activeClass}"
                            type="button"
                            data-field="${field}"
                            data-majority="${opt.key}"
                            aria-pressed="${isActive}">${opt.label}</button>`;
        }).join('');

        return `
            <fieldset class="hbw-controls__group">
                <legend class="hbw-controls__label">${this._escapeHtml(label)}</legend>
                <div class="hbw-segment-control" role="radiogroup" aria-label="${this._escapeHtml(label)}">${buttons}</div>
            </fieldset>
        `;
    }

    /**
     * Render topic dropdown control.
     * @param {Object} env
     * @returns {string}
     * @private
     */
    _renderTopicControl(env) {
        const topics = Object.keys(LegislativeSimulator.TOPIC_PARTISANSHIP);
        const options = topics.map(t => {
            const selected = env.topic === t ? 'selected' : '';
            return `<option value="${t}" ${selected}>${t}</option>`;
        }).join('');

        return `
            <fieldset class="hbw-controls__group">
                <legend class="hbw-controls__label">Topic Area</legend>
                <select class="hbw-select" aria-label="Topic area">${options}</select>
            </fieldset>
        `;
    }

    /**
     * Render bill type toggle (Standard / Budget).
     * @param {Object} env
     * @returns {string}
     * @private
     */
    _renderBillTypeControl(env) {
        const types = [
            { key: 'standard', label: 'Standard' },
            { key: 'budget',   label: 'Budget' }
        ];

        const buttons = types.map(t => {
            const isActive = env.billType === t.key;
            const activeClass = isActive ? 'hbw-type-toggle__btn--active' : '';
            return `<button class="hbw-type-toggle__btn ${activeClass}"
                            type="button"
                            data-bill-type="${t.key}"
                            aria-pressed="${isActive}">${t.label}</button>`;
        }).join('');

        return `
            <fieldset class="hbw-controls__group">
                <legend class="hbw-controls__label">Bill Type</legend>
                <div class="hbw-type-toggle" role="radiogroup" aria-label="Bill Type">${buttons}</div>
            </fieldset>
        `;
    }

    /**
     * Render the stage detail panel.
     * @returns {string}
     * @private
     */
    _renderDetail() {
        return `
            <div class="hbw-detail" data-hbw-detail>
                ${this._renderDetailContent()}
            </div>
        `;
    }

    /**
     * Render the inner content of the detail panel based on current state.
     * @returns {string}
     * @private
     */
    _renderDetailContent() {
        if (!this.state.selectedStage) {
            return this._renderWelcome();
        }
        return this._renderStageDetail(this.state.selectedStage);
    }

    /**
     * Render the welcome / empty state for the detail panel.
     * @returns {string}
     * @private
     */
    _renderWelcome() {
        return `
            <div class="hbw-detail__welcome">
                <div class="hbw-detail__welcome-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                        <polyline points="10 9 9 9 8 9"/>
                    </svg>
                </div>
                <div class="hbw-detail__welcome-title">Explore the Pipeline</div>
                <div class="hbw-detail__welcome-text">Click any stage on the map to learn what happens there. Adjust the controls to see how political conditions change the odds.</div>
            </div>
        `;
    }

    /**
     * Render the full detail content for a selected stage.
     * @param {string} stageKey
     * @returns {string}
     * @private
     */
    _renderStageDetail(stageKey) {
        const stage = StageContent.get(stageKey);
        if (!stage) return this._renderWelcome();

        const simResult = this.state.simResult;
        const insight = simResult
            ? LegislativeSimulator.getStageInsight(stageKey, this.state.environment, simResult)
            : '';
        const stats = this._getStageStats(stageKey);

        return `
            <h3 class="hbw-detail__title hbw-fade-in">${this._escapeHtml(stage.title)}</h3>

            <div class="hbw-detail__section hbw-fade-in">
                <div class="hbw-detail__heading">What Happens</div>
                <div class="hbw-detail__text">${this._escapeHtml(stage.whatHappens)}</div>
            </div>

            ${stage.keyPlayers && stage.keyPlayers.length > 0 ? `
                <div class="hbw-detail__section hbw-fade-in">
                    <div class="hbw-detail__heading">Key Players</div>
                    <div class="hbw-detail__players">
                        ${stage.keyPlayers.map(p => `
                            <div class="hbw-detail__player">
                                <span class="hbw-detail__player-role">${this._escapeHtml(p.role)}</span>
                                <span class="hbw-detail__player-desc">${this._escapeHtml(p.desc)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            ${stage.outcomes && stage.outcomes.length > 0 ? `
                <div class="hbw-detail__section hbw-fade-in">
                    <div class="hbw-detail__heading">What Can Happen</div>
                    <div class="hbw-detail__outcomes">
                        ${stage.outcomes.map(o => `
                            <div class="hbw-detail__outcome hbw-detail__outcome--${o.type}">
                                ${this._getOutcomeIcon(o.type)}
                                ${this._escapeHtml(o.text)}
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            ${stats ? this._renderStatsBox(stats) : ''}

            ${insight ? `
                <div class="hbw-detail__section hbw-fade-in">
                    <div class="hbw-detail__heading">Simulation Insight</div>
                    <div class="hbw-detail__insight" data-hbw-insight>${this._escapeHtml(insight)}</div>
                </div>
            ` : ''}
        `;
    }

    /**
     * Render the "This Congress" stats box.
     * @param {Object} stats - { count, avgDays, advancementRate }
     * @returns {string}
     * @private
     */
    _renderStatsBox(stats) {
        if (stats.isCommittee) {
            return this._renderCommitteeStatsBox(stats);
        }

        return `
            <div class="hbw-detail__section hbw-fade-in">
                <div class="hbw-detail__stats">
                    <div class="hbw-detail__stats-header">This Congress (119th)</div>
                    ${stats.count !== undefined && stats.count !== null ? `
                        <div class="hbw-detail__stat">
                            <span class="hbw-detail__stat-value">${this._formatNumber(stats.count)}</span>
                            <span class="hbw-detail__stat-label">Bills at this stage</span>
                        </div>
                    ` : ''}
                    ${stats.avgDays !== undefined && stats.avgDays !== null ? `
                        <div class="hbw-detail__stat">
                            <span class="hbw-detail__stat-value">${Math.round(stats.avgDays)}</span>
                            <span class="hbw-detail__stat-label">Avg. days at stage</span>
                        </div>
                    ` : ''}
                    ${stats.advancementRate !== undefined && stats.advancementRate !== null ? `
                        <div class="hbw-detail__stat">
                            <span class="hbw-detail__stat-value">${Math.round(stats.advancementRate)}%</span>
                            <span class="hbw-detail__stat-label">Advancement rate</span>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    /**
     * Render the committee stats box with two sub-hurdles.
     * @param {Object} stats - Committee stats with hurdles array
     * @returns {string}
     * @private
     */
    _renderCommitteeStatsBox(stats) {
        const hurdles = stats.hurdles || [];

        return `
            <div class="hbw-detail__section hbw-fade-in">
                <div class="hbw-detail__stats">
                    <div class="hbw-detail__stats-header">This Congress (119th)</div>
                    ${stats.count !== null ? `
                        <div class="hbw-detail__stat">
                            <span class="hbw-detail__stat-value">${this._formatNumber(stats.count)}</span>
                            <span class="hbw-detail__stat-label">Bills in committee</span>
                        </div>
                    ` : ''}
                    ${stats.advancementRate !== null ? `
                        <div class="hbw-detail__stat">
                            <span class="hbw-detail__stat-value">${Math.round(stats.advancementRate)}%</span>
                            <span class="hbw-detail__stat-label">Overall survival rate</span>
                        </div>
                    ` : ''}
                </div>
                ${hurdles.length > 0 ? `
                    <div class="hbw-detail__hurdles">
                        <div class="hbw-detail__hurdles-header">Two hurdles to clear</div>
                        ${hurdles.map((h, i) => `
                            <div class="hbw-detail__hurdle">
                                <div class="hbw-detail__hurdle-label">
                                    <span class="hbw-detail__hurdle-num">${i + 1}</span>
                                    ${this._escapeHtml(h.label)}
                                </div>
                                <div class="hbw-detail__hurdle-bar">
                                    <div class="hbw-detail__hurdle-fill" style="width: ${h.rate !== null ? Math.round(h.rate) : 0}%"></div>
                                </div>
                                <div class="hbw-detail__hurdle-meta">
                                    ${h.rate !== null ? `<span class="hbw-detail__hurdle-rate">${Math.round(h.rate)}%</span>` : ''}
                                    ${h.count !== null ? `<span class="hbw-detail__hurdle-count">${this._formatNumber(h.count)} bills waiting</span>` : ''}
                                </div>
                                <div class="hbw-detail__hurdle-desc">${this._escapeHtml(h.desc)}</div>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    // ========================================================================
    // EVENT HANDLING
    // ========================================================================

    /**
     * Bind event listeners to the modal body DOM.
     * Uses event delegation on the modal body element for all click
     * interactions, and a direct listener for the topic select.
     * @private
     */
    _bindBodyEvents() {
        if (!this.modal.element) return;
        const body = this.modal.element.querySelector('.modal__body');
        if (!body) return;

        // Click delegation handler
        this._boundBodyClickHandler = (e) => {
            // Stage node click
            const node = e.target.closest('.hbw-node');
            if (node) {
                this._selectStage(node.dataset.stage);
                return;
            }

            // Sponsor party toggle
            const partyBtn = e.target.closest('[data-party]');
            if (partyBtn) {
                this._updateEnvironment({ sponsorParty: partyBtn.dataset.party });
                return;
            }

            // Majority controls
            const majorityBtn = e.target.closest('[data-majority]');
            if (majorityBtn) {
                const field = majorityBtn.dataset.field;
                this._updateEnvironment({ [field]: majorityBtn.dataset.majority });
                return;
            }

            // Bill type toggle
            const typeBtn = e.target.closest('[data-bill-type]');
            if (typeBtn) {
                this._updateEnvironment({ billType: typeBtn.dataset.billType });
                return;
            }

            // Reset button
            const resetBtn = e.target.closest('.hbw-controls__reset');
            if (resetBtn) {
                this._resetToThisCongress();
                return;
            }

            // Mobile controls toggle
            const controlsToggle = e.target.closest('.hbw-controls__toggle');
            if (controlsToggle) {
                this._toggleMobileControls(controlsToggle);
                return;
            }
        };
        body.addEventListener('click', this._boundBodyClickHandler);

        // Topic select change handler
        const topicSelect = body.querySelector('.hbw-select');
        if (topicSelect) {
            this._boundTopicChangeHandler = (e) => {
                this._updateEnvironment({ topic: e.target.value });
            };
            topicSelect.addEventListener('change', this._boundTopicChangeHandler);
        }
    }

    /**
     * Remove event listeners from the modal body DOM.
     * @private
     */
    _unbindBodyEvents() {
        if (!this.modal || !this.modal.element) return;
        const body = this.modal.element.querySelector('.modal__body');
        if (!body) return;

        if (this._boundBodyClickHandler) {
            body.removeEventListener('click', this._boundBodyClickHandler);
            this._boundBodyClickHandler = null;
        }

        if (this._boundTopicChangeHandler) {
            const topicSelect = body.querySelector('.hbw-select');
            if (topicSelect) {
                topicSelect.removeEventListener('change', this._boundTopicChangeHandler);
            }
            this._boundTopicChangeHandler = null;
        }
    }

    // ========================================================================
    // STATE UPDATES (Targeted DOM Mutations)
    // ========================================================================

    /**
     * Select a stage and update the UI with targeted DOM changes.
     * @param {string} key - Stage key
     * @private
     */
    _selectStage(key) {
        const prevSelected = this.state.selectedStage;
        this.state.selectedStage = key;

        if (!this.modal.element) return;
        const body = this.modal.element.querySelector('.modal__body');
        if (!body) return;

        // Update node selection classes
        if (prevSelected) {
            const prevNode = body.querySelector(`[data-stage="${prevSelected}"]`);
            if (prevNode) {
                prevNode.classList.remove('hbw-node--selected');
            }
        }

        const newNode = body.querySelector(`[data-stage="${key}"]`);
        if (newNode) {
            newNode.classList.add('hbw-node--selected');
        }

        // Update the detail panel content
        this._updateDetailPanel();
    }

    /**
     * Update the environment settings and refresh affected UI elements.
     * @param {Object} changes - Partial environment object
     * @private
     */
    _updateEnvironment(changes) {
        // Merge changes
        Object.assign(this.state.environment, changes);

        // Recompute simulation
        this.state.simResult = LegislativeSimulator.compute(this.state.environment);

        if (!this.modal.element) return;
        const body = this.modal.element.querySelector('.modal__body');
        if (!body) return;

        // Update node badges and heat classes
        this._updateNodeBadges(body);

        // Update active states on controls
        this._updateControlActiveStates(body);

        // Update scenario text
        this._updateScenarioText(body);

        // If a stage is selected, update the insight text
        if (this.state.selectedStage) {
            this._updateInsightText(body);
        }

        // Announce changes to screen readers
        this._announceChanges(this.state.simResult.stageRates);
    }

    /**
     * Reset environment to "This Congress" defaults (119th Congress).
     * @private
     */
    _resetToThisCongress() {
        this.state.environment = {
            sponsorParty: 'R',
            houseMajority: 'lean_r',
            senateMajority: 'lean_r',
            topic: 'Other',
            billType: 'standard'
        };

        this.state.simResult = LegislativeSimulator.compute(this.state.environment);

        if (!this.modal.element) return;
        const body = this.modal.element.querySelector('.modal__body');
        if (!body) return;

        this._updateNodeBadges(body);
        this._updateControlActiveStates(body);
        this._updateScenarioText(body);

        // Reset the topic select
        const topicSelect = body.querySelector('.hbw-select');
        if (topicSelect) {
            topicSelect.value = this.state.environment.topic;
        }

        if (this.state.selectedStage) {
            this._updateInsightText(body);
        }
    }

    /**
     * Toggle mobile controls visibility.
     * @param {Element} toggleBtn
     * @private
     */
    _toggleMobileControls(toggleBtn) {
        if (!this.modal.element) return;
        const controls = this.modal.element.querySelector('.hbw-controls');
        if (!controls) return;

        const isExpanded = controls.classList.contains('hbw-controls--expanded');

        if (isExpanded) {
            controls.classList.remove('hbw-controls--expanded');
            controls.classList.add('hbw-controls--collapsed');
            toggleBtn.setAttribute('aria-expanded', 'false');
        } else {
            controls.classList.remove('hbw-controls--collapsed');
            controls.classList.add('hbw-controls--expanded');
            toggleBtn.setAttribute('aria-expanded', 'true');
        }
    }

    // ========================================================================
    // TARGETED DOM UPDATE HELPERS
    // ========================================================================

    /**
     * Update all node badges and heat classes based on current simulation.
     * @param {Element} body - Modal body element
     * @private
     */
    _updateNodeBadges(body) {
        const simResult = this.state.simResult;
        if (!simResult) return;

        StageContent.allStages.forEach(key => {
            const node = body.querySelector(`[data-stage="${key}"]`);
            if (!node) return;

            const stageRate = simResult.stageRates[key];
            const rate = stageRate ? Math.round(stageRate.rate) : null;
            const heatClass = this._getHeatClass(rate);

            // Update badge text with animation
            const badge = node.querySelector('.hbw-node__badge');
            if (badge && rate !== null) {
                const currentText = badge.textContent.replace('%', '').trim();
                const currentValue = parseInt(currentText, 10);
                if (!isNaN(currentValue) && currentValue !== rate) {
                    this._animateCounter(badge, currentValue, rate);
                } else {
                    badge.textContent = `${rate}%`;
                }
            }

            // Update heat class
            node.classList.remove('hbw-node--heat-green', 'hbw-node--heat-gold', 'hbw-node--heat-red');
            if (heatClass) {
                node.classList.add(`hbw-node--${heatClass}`);
            }

            // Update aria-label
            const stage = StageContent.get(key);
            if (stage) {
                const ariaLabel = rate !== null
                    ? `${stage.title}, ${rate}% advancement rate`
                    : stage.title;
                node.setAttribute('aria-label', ariaLabel);
            }
        });
    }

    /**
     * Update active states on all control buttons.
     * @param {Element} body - Modal body element
     * @private
     */
    _updateControlActiveStates(body) {
        const env = this.state.environment;

        // Sponsor party buttons
        body.querySelectorAll('[data-party]').forEach(btn => {
            const party = btn.dataset.party;
            const isActive = env.sponsorParty === party;
            btn.classList.remove(
                'hbw-toggle-group__btn--active-d',
                'hbw-toggle-group__btn--active-r',
                'hbw-toggle-group__btn--active-i'
            );
            if (isActive) {
                btn.classList.add(`hbw-toggle-group__btn--active-${party.toLowerCase()}`);
            }
            btn.setAttribute('aria-pressed', isActive.toString());
        });

        // Majority buttons
        body.querySelectorAll('[data-majority]').forEach(btn => {
            const field = btn.dataset.field;
            const value = btn.dataset.majority;
            const isActive = env[field] === value;
            btn.classList.toggle('hbw-segment-control__option--active', isActive);
            btn.setAttribute('aria-pressed', isActive.toString());
        });

        // Bill type buttons
        body.querySelectorAll('[data-bill-type]').forEach(btn => {
            const type = btn.dataset.billType;
            const isActive = env.billType === type;
            btn.classList.toggle('hbw-type-toggle__btn--active', isActive);
            btn.setAttribute('aria-pressed', isActive.toString());
        });
    }

    /**
     * Update the scenario summary text.
     * @param {Element} body - Modal body element
     * @private
     */
    _updateScenarioText(body) {
        const scenarioEl = body.querySelector('[data-hbw-scenario]');
        if (scenarioEl && this.state.simResult) {
            scenarioEl.textContent = this.state.simResult.scenario;
        }
    }

    /**
     * Update the simulation insight text for the selected stage.
     * @param {Element} body - Modal body element
     * @private
     */
    _updateInsightText(body) {
        const insightEl = body.querySelector('[data-hbw-insight]');
        if (insightEl && this.state.selectedStage && this.state.simResult) {
            const insight = LegislativeSimulator.getStageInsight(
                this.state.selectedStage,
                this.state.environment,
                this.state.simResult
            );
            insightEl.textContent = insight;
        }
    }

    /**
     * Re-render only the detail panel content.
     * @private
     */
    _updateDetailPanel() {
        if (!this.modal.element) return;
        const detailEl = this.modal.element.querySelector('[data-hbw-detail]');
        if (detailEl) {
            detailEl.innerHTML = this._renderDetailContent();
        }
    }

    // ========================================================================
    // SVG ARROW DRAWING
    // ========================================================================

    /**
     * Draw SVG arrows connecting the pipeline nodes.
     * Computes positions based on rendered node locations.
     * @private
     */
    _drawArrows() {
        if (!this.modal.element) return;
        const map = this.modal.element.querySelector('.hbw-map');
        const svg = map ? map.querySelector('.hbw-map__arrows') : null;
        if (!map || !svg) return;

        // Clear existing lines (but not the defs)
        svg.querySelectorAll('line, path').forEach(el => {
            if (!el.closest('defs')) el.remove();
        });

        const mapRect = map.getBoundingClientRect();

        StageContent.connections.forEach(conn => {
            const fromNode = map.querySelector(`[data-stage="${conn.from}"]`);
            const toNode = map.querySelector(`[data-stage="${conn.to}"]`);
            if (!fromNode || !toNode) return;

            const fromRect = fromNode.getBoundingClientRect();
            const toRect = toNode.getBoundingClientRect();

            // Compute center points relative to the map container
            const x1 = fromRect.left + fromRect.width / 2 - mapRect.left;
            const y1 = fromRect.top + fromRect.height / 2 - mapRect.top;
            const x2 = toRect.left + toRect.width / 2 - mapRect.left;
            const y2 = toRect.top + toRect.height / 2 - mapRect.top;

            // Compute edge-to-edge connection points to avoid overlapping nodes
            const dx = x2 - x1;
            const dy = y2 - y1;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist === 0) return;

            // Shorten line so it starts at edge of source and ends at edge of target
            const fromHalfW = fromRect.width / 2;
            const fromHalfH = fromRect.height / 2;
            const toHalfW = toRect.width / 2;
            const toHalfH = toRect.height / 2;

            // Simple edge offset: use ratio of dx/dy to determine which edge to use
            const angle = Math.atan2(dy, dx);
            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);

            // Offset from center to edge of rectangular node
            const fromOffset = Math.min(
                Math.abs(cosA) > 0.01 ? fromHalfW / Math.abs(cosA) : Infinity,
                Math.abs(sinA) > 0.01 ? fromHalfH / Math.abs(sinA) : Infinity
            );
            const toOffset = Math.min(
                Math.abs(cosA) > 0.01 ? toHalfW / Math.abs(cosA) : Infinity,
                Math.abs(sinA) > 0.01 ? toHalfH / Math.abs(sinA) : Infinity
            );

            const startX = x1 + cosA * Math.min(fromOffset, dist / 2);
            const startY = y1 + sinA * Math.min(fromOffset, dist / 2);
            const endX = x2 - cosA * Math.min(toOffset, dist / 2);
            const endY = y2 - sinA * Math.min(toOffset, dist / 2);

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', startX);
            line.setAttribute('y1', startY);
            line.setAttribute('x2', endX);
            line.setAttribute('y2', endY);
            line.setAttribute('class', conn.type === 'solid' ? 'hbw-arrow--solid' : 'hbw-arrow--dashed');
            line.setAttribute('marker-end', 'url(#hbw-arrowhead)');
            svg.appendChild(line);
        });
    }

    /**
     * Set up a ResizeObserver to redraw arrows when the map resizes.
     * @private
     */
    _setupResizeObserver() {
        if (this._resizeObserver) return;
        if (!this.modal.element) return;

        const map = this.modal.element.querySelector('.hbw-map');
        if (!map) return;

        let debounceTimer = null;
        this._resizeObserver = new ResizeObserver(() => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                this._drawArrows();
            }, 100);
        });

        this._resizeObserver.observe(map);
    }

    /**
     * Tear down the ResizeObserver.
     * @private
     */
    _teardownResizeObserver() {
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
    }

    // ========================================================================
    // API INTEGRATION
    // ========================================================================

    /**
     * Fetch legislative stats from the backend for the 119th Congress.
     * Non-blocking -- the modal works without stats.
     * @returns {Promise<void>}
     * @private
     */
    async _fetchCongressStats() {
        try {
            this.state.loading = true;
            const response = await fetch('/api/db/congress/119/legislative-stats');
            const data = await response.json();
            if (data.success) {
                this.state.congressStats = data;
            }
        } catch (error) {
            console.warn('[HowBillsWorkModal] Failed to fetch congress stats:', error);
            // Non-blocking -- modal works without stats
        } finally {
            this.state.loading = false;
        }
    }

    /**
     * Map a StageContent key to API stats data.
     * @param {string} stageKey
     * @returns {Object|null} - { count, avgDays, advancementRate }
     * @private
     */
    _getStageStats(stageKey) {
        if (!this.state.congressStats) return null;

        const stages = this.state.congressStats.stages;
        const advRates = this.state.congressStats.advancementRates;
        if (!stages) return null;

        // Committee is special: show two sub-hurdles
        if (stageKey === 'committee') {
            return this._getCommitteeStats(stages, advRates);
        }

        const stageMap = {
            introduction:  'introduced',
            floor_vote:    'on_calendar',
            other_chamber: 'passed_chamber',
            conference:    'resolving_differences',
            president:     'to_president',
            became_law:    'became_law',
            vetoed:        'vetoed'
        };

        const apiKey = stageMap[stageKey];
        if (!apiKey) return null;

        const stats = stages[apiKey] || null;
        const advRate = advRates ? advRates[apiKey] : null;

        if (!stats && advRate === undefined) return null;

        return {
            count: stats ? stats.count : null,
            avgDays: stats ? stats.avgDays : null,
            advancementRate: advRate !== undefined ? advRate : null
        };
    }

    /**
     * Build committee stats with two sub-hurdles:
     *   Hurdle 1: referred_to_committee → in_committee (getting a hearing)
     *   Hurdle 2: in_committee → reported (getting reported out)
     * @private
     */
    _getCommitteeStats(stages, advRates) {
        const referred = stages.referred_to_committee || {};
        const inCommittee = stages.in_committee || {};

        const referredCount = referred.count || 0;
        const inCommitteeCount = inCommittee.count || 0;
        const totalInCommittee = referredCount + inCommitteeCount;

        const hurdleOneRate = advRates ? advRates.referred_to_committee : null;
        const hurdleTwoRate = advRates ? advRates.in_committee : null;

        // Combined rate: what % of referred bills ultimately get reported out
        let combinedRate = null;
        if (hurdleOneRate !== null && hurdleTwoRate !== null) {
            combinedRate = Math.round((hurdleOneRate / 100) * (hurdleTwoRate / 100) * 1000) / 10;
        }

        return {
            isCommittee: true,
            count: totalInCommittee,
            avgDays: inCommittee.avgDays || referred.avgDays || null,
            advancementRate: combinedRate,
            hurdles: [
                {
                    label: 'Getting a hearing',
                    count: referredCount,
                    rate: hurdleOneRate,
                    desc: 'Bills referred but awaiting committee attention'
                },
                {
                    label: 'Getting reported out',
                    count: inCommitteeCount,
                    rate: hurdleTwoRate,
                    desc: 'Bills with committee activity awaiting a vote to advance'
                }
            ]
        };
    }

    // ========================================================================
    // UTILITY HELPERS
    // ========================================================================

    /**
     * Animate a probability counter from one value to another.
     * @param {Element} element - The badge element to animate
     * @param {number} fromValue - Starting percentage
     * @param {number} toValue - Target percentage
     * @param {number} [duration=300] - Animation duration in ms
     * @private
     */
    _animateCounter(element, fromValue, toValue, duration = 300) {
        // Cancel any in-flight animation on this element
        if (element._hbwRafId) {
            cancelAnimationFrame(element._hbwRafId);
            element._hbwRafId = null;
        }
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            element.textContent = `${Math.round(toValue)}%`;
            return;
        }
        const start = performance.now();
        const step = (timestamp) => {
            const progress = Math.min((timestamp - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
            const current = fromValue + (toValue - fromValue) * eased;
            element.textContent = `${Math.round(current)}%`;
            if (progress < 1) {
                element._hbwRafId = requestAnimationFrame(step);
            } else {
                element._hbwRafId = null;
            }
        };
        element._hbwRafId = requestAnimationFrame(step);
    }

    /**
     * Announce probability changes to screen readers via aria-live region.
     * @param {Object} rates - stageRates from simulation result
     * @private
     */
    _announceChanges(rates) {
        if (!this.modal.element) return;
        const announcer = this.modal.element.querySelector('[data-hbw-announcer]');
        if (!announcer) return;

        const committee = rates.committee ? Math.round(rates.committee.rate) : 0;
        const floor = rates.floor_vote ? Math.round(rates.floor_vote.rate) : 0;
        announcer.textContent = `Probabilities updated. Committee advancement: ${committee}%. Floor vote: ${floor}%.`;
    }

    /**
     * Determine the heat color class for a given rate.
     * @param {number|null} rate
     * @returns {string} 'heat-green', 'heat-gold', 'heat-red', or ''
     * @private
     */
    _getHeatClass(rate) {
        if (rate === null || rate === undefined) return '';
        if (rate > 30) return 'heat-green';
        if (rate >= 10) return 'heat-gold';
        return 'heat-red';
    }

    /**
     * Get a small inline SVG icon for an outcome type.
     * @param {string} type - 'advance', 'fail', or 'lateral'
     * @returns {string} SVG HTML
     * @private
     */
    _getOutcomeIcon(type) {
        const icons = {
            advance: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;margin-top:2px;"><polyline points="9 18 15 12 9 6"/></svg>',
            fail:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;margin-top:2px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
            lateral: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;margin-top:2px;"><polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/></svg>'
        };
        return icons[type] || '';
    }

    /**
     * Escape HTML special characters for safe insertion.
     * @param {string} text
     * @returns {string}
     * @private
     */
    _escapeHtml(text) {
        if (!text) return '';
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    /**
     * Format a number with locale-appropriate separators.
     * @param {number} n
     * @returns {string}
     * @private
     */
    _formatNumber(n) {
        if (n === null || n === undefined) return '0';
        return Number(n).toLocaleString('en-US');
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = HowBillsWorkModal;
} else {
    window.HowBillsWorkModal = HowBillsWorkModal;
}
