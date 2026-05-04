// frontend/js/cost-monitor.js

class CostMonitor {
  constructor(conversationId, eventEmitter) {
    this.conversationId = conversationId;
    this.totalCost = 0;
    this.messageCount = 0;
    this.alerts = [];
    this.emitter = eventEmitter; // Use a shared event emitter for simplicity
    this.ui = this.getUIElements();

    this.setupEventListeners();
    this.render();
  }

  getUIElements() {
    // In a real app, these would be robust selectors
    return {
      container: document.getElementById('cost-monitor-container'),
      totalCostEl: document.getElementById('live-cost-total'),
      messageCountEl: document.getElementById('live-cost-messages'),
      avgCostEl: document.getElementById('live-cost-avg'),
      alertsContainer: document.getElementById('cost-alerts-container')
    };
  }

  setupEventListeners() {
    if (!this.emitter) return;

    // Listen for cost updates from the backend (simulated via emitter)
    this.emitter.on(`cost-update:${this.conversationId}`, (data) => {
      this.updateCostDisplay(data);
    });

    // Listen for cost alerts
    this.emitter.on(`cost-alert:${this.conversationId}`, (alert) => {
      this.showCostAlert(alert);
    });
  }

  updateCostDisplay(data) {
    if (!data) return;

    this.totalCost = data.totalCost || this.totalCost;
    this.messageCount = data.messageCount || this.messageCount;

    this.render();
  }

  render() {
    if (!this.ui.container) return;

    if (this.ui.totalCostEl) {
      this.ui.totalCostEl.textContent = `$${this.totalCost.toFixed(4)}`;
    }
    if (this.ui.messageCountEl) {
      this.ui.messageCountEl.textContent = `${this.messageCount} messages`;
    }
    if (this.ui.avgCostEl) {
      const avgCost = this.messageCount > 0 ? this.totalCost / this.messageCount : 0;
      this.ui.avgCostEl.textContent = `Avg: $${avgCost.toFixed(4)}/msg`;
    }
  }

  showCostAlert(alert) {
    if (!this.ui.alertsContainer || !alert) return;

    const alertElement = document.createElement('div');
    alertElement.className = `cost-alert alert-${alert.level}`;
    alertElement.innerHTML = `
      <span class="alert-icon">${this.getAlertIcon(alert.level)}</span>
      <span class="alert-message">${alert.message}</span>
      <button class="alert-dismiss" onclick="this.parentElement.remove()">×</button>
    `;

    this.ui.alertsContainer.appendChild(alertElement);

    // Auto-dismiss after 10 seconds
    setTimeout(() => {
      if (alertElement.parentElement) {
        alertElement.remove();
      }
    }, 10000);
  }

  getAlertIcon(level) {
    if (level === 'danger') return '🔥';
    if (level === 'warning') return '⚠️';
    return 'ℹ️';
  }

  cleanup() {
    if (this.emitter) {
      this.emitter.off(`cost-update:${this.conversationId}`);
      this.emitter.off(`cost-alert:${this.conversationId}`);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CostMonitor;
} else {
    window.CostMonitor = CostMonitor;
}
