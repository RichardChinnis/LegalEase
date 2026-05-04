/**
 * Congressional Record Page Viewer Modal
 * Displays CR article content with navigation between adjacent articles
 */

class CRPageViewerModal {
    constructor() {
        this.modal = null;
        this.currentArticle = null;
        this.currentPageRef = null;
        this.adjacentArticles = { previous: null, next: null };
        this.isLoading = false;
        this.context = { congress: null, billTitle: null };

        this.init();
    }

    init() {
        // Create modal container if it doesn't exist
        if (!document.getElementById('cr-viewer-modal')) {
            this.createModalElement();
        }
        this.modal = document.getElementById('cr-viewer-modal');
        this.setupEventListeners();
    }

    createModalElement() {
        const modalHtml = `
            <div id="cr-viewer-modal" class="cr-viewer-modal" role="dialog" aria-modal="true" aria-labelledby="cr-viewer-title" hidden>
                <div class="cr-viewer-modal__backdrop"></div>
                <div class="cr-viewer-modal__container">
                    <header class="cr-viewer-modal__header">
                        <div class="cr-viewer-modal__header-top">
                            <h2 id="cr-viewer-title" class="cr-viewer-modal__title">Congressional Record</h2>
                            <button class="cr-viewer-modal__close" aria-label="Close" title="Close (Esc)">&times;</button>
                        </div>
                        <div class="cr-viewer-modal__meta" id="cr-viewer-meta"></div>
                    </header>
                    <main class="cr-viewer-modal__body" id="cr-viewer-body">
                        <div class="cr-viewer-modal__loading">Loading...</div>
                    </main>
                    <footer class="cr-viewer-modal__footer">
                        <div class="cr-viewer-modal__nav">
                            <button class="cr-viewer-nav-btn cr-viewer-nav-btn--prev" id="cr-nav-prev" disabled aria-label="Previous article">
                                <span class="cr-viewer-nav-btn__arrow">&larr;</span>
                                <span class="cr-viewer-nav-btn__label" id="cr-nav-prev-label">Previous</span>
                            </button>
                            <div class="cr-viewer-modal__links" id="cr-viewer-links"></div>
                            <button class="cr-viewer-nav-btn cr-viewer-nav-btn--next" id="cr-nav-next" disabled aria-label="Next article">
                                <span class="cr-viewer-nav-btn__label" id="cr-nav-next-label">Next</span>
                                <span class="cr-viewer-nav-btn__arrow">&rarr;</span>
                            </button>
                        </div>
                    </footer>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    setupEventListeners() {
        // Close button
        this.modal.querySelector('.cr-viewer-modal__close').addEventListener('click', () => this.close());

        // Backdrop click
        this.modal.querySelector('.cr-viewer-modal__backdrop').addEventListener('click', () => this.close());

        // Keyboard navigation
        this.modal.addEventListener('keydown', (e) => this.handleKeydown(e));

        // Navigation buttons
        document.getElementById('cr-nav-prev').addEventListener('click', () => this.navigatePrev());
        document.getElementById('cr-nav-next').addEventListener('click', () => this.navigateNext());
    }

    handleKeydown(e) {
        switch (e.key) {
            case 'Escape':
                this.close();
                break;
            case 'ArrowLeft':
                if (!this.isLoading && this.adjacentArticles.previous) {
                    this.navigatePrev();
                }
                break;
            case 'ArrowRight':
                if (!this.isLoading && this.adjacentArticles.next) {
                    this.navigateNext();
                }
                break;
        }
    }

    /**
     * Open the modal with a CR page reference
     * @param {string} pageRef - Page reference like "H4725" or "S8211"
     * @param {number} congress - Congress number for context
     * @param {string} billTitle - Bill title for context
     */
    async open(pageRef, congress, billTitle) {
        this.context = { congress, billTitle };
        this.currentPageRef = pageRef;

        // Show modal with loading state
        this.modal.hidden = false;
        this.modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');

        // Update title
        document.getElementById('cr-viewer-title').textContent = `Congressional Record - ${pageRef}`;

        // Show loading state
        this.showLoading();

        // Focus the modal for accessibility
        this.modal.focus();

        // Fetch the article
        await this.loadPage(pageRef);
    }

    /**
     * Load a CR page by reference
     * @param {string} pageRef - Page reference like "H4725"
     */
    async loadPage(pageRef) {
        this.isLoading = true;
        this.showLoading();

        try {
            const params = new URLSearchParams();
            if (this.context.congress) params.append('congress', this.context.congress);
            if (this.context.billTitle) params.append('billTitle', this.context.billTitle);

            const url = `/api/db/congressional-record/article/${pageRef}${params.toString() ? '?' + params : ''}`;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Failed to fetch article: ${response.status}`);
            }

            const data = await response.json();

            if (!data.success || !data.found) {
                this.showNotFound(pageRef, data.fallbackUrl);
                return;
            }

            this.currentArticle = data.article;
            this.currentPageRef = pageRef;
            this.renderArticle(data.article);

            // Load adjacent articles for navigation
            if (data.article.id) {
                await this.loadAdjacentArticles(data.article.id);
            }

        } catch (error) {
            console.error('Error loading CR page:', error);
            this.showError(pageRef);
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Load adjacent articles for navigation
     * @param {number} articleId - Current article ID
     */
    async loadAdjacentArticles(articleId) {
        try {
            const response = await fetch(`/api/db/congressional-record/article/${articleId}/adjacent`);
            if (!response.ok) return;

            const data = await response.json();
            if (!data.success) return;

            this.adjacentArticles = {
                previous: data.previous || null,
                next: data.next || null
            };

            this.updateNavigationButtons();

        } catch (error) {
            console.warn('Error loading adjacent articles:', error);
        }
    }

    /**
     * Navigate to the previous article
     */
    async navigatePrev() {
        if (!this.adjacentArticles.previous || this.isLoading) return;
        await this.navigateToArticle(this.adjacentArticles.previous);
    }

    /**
     * Navigate to the next article
     */
    async navigateNext() {
        if (!this.adjacentArticles.next || this.isLoading) return;
        await this.navigateToArticle(this.adjacentArticles.next);
    }

    /**
     * Navigate to a specific article
     * @param {Object} article - Article object with id
     */
    async navigateToArticle(article) {
        this.isLoading = true;
        this.showLoading();

        const pageRef = article.startPage;
        document.getElementById('cr-viewer-title').textContent = `Congressional Record - ${pageRef}`;

        try {
            const response = await fetch(`/api/db/congressional-record/article/${article.id}`);
            if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);

            const data = await response.json();
            if (!data.success || !data.found) throw new Error('Article not found');

            this.currentArticle = data.article;
            this.currentPageRef = pageRef;
            this.renderArticle(data.article);

            if (data.article.id) {
                await this.loadAdjacentArticles(data.article.id);
            }

        } catch (error) {
            console.error('Error navigating to article:', error);
            // Render with minimal info
            this.renderArticle({
                id: article.id,
                title: article.title,
                startPage: article.startPage,
                endPage: article.endPage,
                pdfUrl: article.pdfUrl,
                textUrl: article.textUrl,
                issueDate: article.issueDate,
                chamber: article.chamber,
                volume: article.volume,
                issue: article.issue
            });

            if (article.id) {
                await this.loadAdjacentArticles(article.id);
            }
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Render article content
     * @param {Object} article - Article data
     */
    renderArticle(article) {
        // Format metadata
        const dateStr = article.issueDate
            ? new Date(article.issueDate + 'T12:00:00Z').toLocaleDateString()
            : (article.date ? new Date(article.date).toLocaleDateString() : '');

        const chamberName = article.chamber || '';
        const volumeIssue = (article.volume && article.issue)
            ? `Vol. ${article.volume}, No. ${article.issue}`
            : '';
        const pages = article.startPage
            ? `Pages ${article.startPage}${article.endPage && article.endPage !== article.startPage ? '-' + article.endPage : ''}`
            : '';

        const metaParts = [chamberName, volumeIssue, dateStr, pages].filter(x => x);

        // Update meta section
        document.getElementById('cr-viewer-meta').innerHTML = metaParts.length
            ? `<span>${metaParts.join(' &bull; ')}</span>`
            : '';

        // Handle content
        const content = article.content || article.text;
        const MAX_DISPLAY_CHARS = 50000;
        let contentHtml = '';

        if (content) {
            if (content.length > MAX_DISPLAY_CHARS) {
                const truncated = this.escapeHtml(content.substring(0, MAX_DISPLAY_CHARS));
                contentHtml = `
                    <div class="cr-viewer-modal__notice">
                        This article is very large (${Math.round(content.length / 1000)}KB).
                        Showing first portion.
                        <a href="${article.textUrl || article.url}" target="_blank" rel="noopener noreferrer">
                            View full article on Congress.gov
                        </a>
                    </div>
                    <div class="cr-viewer-modal__article-header">${this.escapeHtml(article.title || 'Congressional Record Article')}</div>
                    <pre class="cr-viewer-modal__content">${truncated}...</pre>
                `;
            } else {
                contentHtml = `
                    <div class="cr-viewer-modal__article-header">${this.escapeHtml(article.title || 'Congressional Record Article')}</div>
                    <pre class="cr-viewer-modal__content">${this.escapeHtml(content)}</pre>
                `;
            }
        } else {
            contentHtml = `
                <div class="cr-viewer-modal__article-header">${this.escapeHtml(article.title || 'Congressional Record Article')}</div>
                <div class="cr-viewer-modal__unavailable">
                    <p>Content could not be loaded.</p>
                    ${article.textUrl ? `<p><a href="${article.textUrl}" target="_blank" rel="noopener noreferrer">View formatted text on Congress.gov</a></p>` : ''}
                    ${article.pdfUrl ? `<p><a href="${article.pdfUrl}" target="_blank" rel="noopener noreferrer">View PDF on Congress.gov</a></p>` : ''}
                </div>
            `;
        }

        document.getElementById('cr-viewer-body').innerHTML = contentHtml;

        // Update external links
        const linksHtml = [];
        if (article.textUrl) {
            linksHtml.push(`<a href="${article.textUrl}" target="_blank" rel="noopener noreferrer" class="cr-viewer-modal__ext-link">View on Congress.gov</a>`);
        }
        if (article.pdfUrl) {
            linksHtml.push(`<a href="${article.pdfUrl}" target="_blank" rel="noopener noreferrer" class="cr-viewer-modal__ext-link">PDF</a>`);
        }
        document.getElementById('cr-viewer-links').innerHTML = linksHtml.join(' ');
    }

    /**
     * Update navigation button states
     */
    updateNavigationButtons() {
        const prevBtn = document.getElementById('cr-nav-prev');
        const nextBtn = document.getElementById('cr-nav-next');
        const prevLabel = document.getElementById('cr-nav-prev-label');
        const nextLabel = document.getElementById('cr-nav-next-label');

        if (this.adjacentArticles.previous) {
            prevBtn.disabled = false;
            prevBtn.title = this.adjacentArticles.previous.title || 'Previous article';
            prevLabel.textContent = this.adjacentArticles.previous.startPage || 'Previous';
        } else {
            prevBtn.disabled = true;
            prevBtn.title = 'No previous article';
            prevLabel.textContent = 'Previous';
        }

        if (this.adjacentArticles.next) {
            nextBtn.disabled = false;
            nextBtn.title = this.adjacentArticles.next.title || 'Next article';
            nextLabel.textContent = this.adjacentArticles.next.startPage || 'Next';
        } else {
            nextBtn.disabled = true;
            nextBtn.title = 'No next article';
            nextLabel.textContent = 'Next';
        }
    }

    /**
     * Show loading state
     */
    showLoading() {
        document.getElementById('cr-viewer-body').innerHTML = `
            <div class="cr-viewer-modal__loading">
                <div class="cr-viewer-modal__spinner"></div>
                <p>Loading Congressional Record...</p>
            </div>
        `;
        // Disable navigation during load
        document.getElementById('cr-nav-prev').disabled = true;
        document.getElementById('cr-nav-next').disabled = true;
    }

    /**
     * Show not found state
     * @param {string} pageRef - Page reference that wasn't found
     * @param {string} fallbackUrl - Optional fallback URL
     */
    showNotFound(pageRef, fallbackUrl) {
        document.getElementById('cr-viewer-body').innerHTML = `
            <div class="cr-viewer-modal__not-found">
                <p>Congressional Record page <strong>${this.escapeHtml(pageRef)}</strong> was not found in our database.</p>
                ${fallbackUrl
                    ? `<p><a href="${fallbackUrl}" target="_blank" rel="noopener noreferrer">Search for this page on Congress.gov</a></p>`
                    : `<p><a href="https://www.congress.gov/congressional-record" target="_blank" rel="noopener noreferrer">Browse Congressional Record on Congress.gov</a></p>`
                }
            </div>
        `;
        document.getElementById('cr-viewer-links').innerHTML = '';
    }

    /**
     * Show error state
     * @param {string} pageRef - Page reference
     */
    showError(pageRef) {
        document.getElementById('cr-viewer-body').innerHTML = `
            <div class="cr-viewer-modal__error">
                <p>An error occurred while loading the Congressional Record.</p>
                <p><a href="https://www.congress.gov/congressional-record" target="_blank" rel="noopener noreferrer">Browse Congressional Record on Congress.gov</a></p>
            </div>
        `;
        document.getElementById('cr-viewer-links').innerHTML = '';
    }

    /**
     * Close the modal
     */
    close() {
        this.modal.hidden = true;
        this.modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');

        // Reset state
        this.currentArticle = null;
        this.currentPageRef = null;
        this.adjacentArticles = { previous: null, next: null };

        // Reset navigation buttons
        document.getElementById('cr-nav-prev').disabled = true;
        document.getElementById('cr-nav-next').disabled = true;
    }

    /**
     * Escape HTML characters
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Create singleton instance
const crPageViewer = new CRPageViewerModal();

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CRPageViewerModal, crPageViewer };
}

// Make available globally
window.CRPageViewerModal = CRPageViewerModal;
window.crPageViewer = crPageViewer;
