/**
 * Sanitization utilities for safe DOM content injection.
 * Wraps DOMPurify to provide a consistent API for rendering
 * untrusted content (API responses, LLM output) into HTML.
 */
window.Sanitize = (() => {
    'use strict';

    const purify = window.DOMPurify;

    if (!purify) {
        console.warn('[Sanitize] DOMPurify not loaded — falling back to text-only rendering');
    }

    /**
     * Sanitize an HTML string, removing dangerous tags and attributes.
     * Falls back to escaping all HTML if DOMPurify is not available.
     */
    function html(dirty) {
        if (!dirty) return '';
        if (purify) {
            return purify.sanitize(dirty);
        }
        return escapeHtml(dirty);
    }

    /**
     * Parse markdown to HTML and sanitize the result.
     * Safe replacement for `marked.parse()` + innerHTML.
     */
    function markdown(text) {
        if (!text) return '';
        const raw = window.marked ? marked.parse(text) : escapeHtml(text);
        return html(raw);
    }

    /**
     * Escape HTML entities (fallback when DOMPurify is unavailable).
     */
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return { html, markdown, escapeHtml };
})();
