const nodemailer = require('nodemailer');
const logger = require('./logger');

class EmailService {
  constructor(emailConfig) {
    this.config = emailConfig;
    this.transporter = null;
  }

  async initialize() {
    try {
      this.transporter = nodemailer.createTransport({
        host: this.config.smtp?.host || 'localhost',
        port: this.config.smtp?.port || 25,
        secure: false,
        auth: this.config.smtp?.auth || null,
        tls: {
          rejectUnauthorized: false
        }
      });

      // Verify connection
      await this.transporter.verify();
      logger.info('Email service initialized successfully');

      return true;
    } catch (error) {
      logger.error('Failed to initialize email service', { error: error.message });
      throw error;
    }
  }

  async sendDailyReport(reportData) {
    try {
      if (!this.transporter) {
        await this.initialize();
      }

      const emailContent = this.generateEmailContent(reportData);

      const mailOptions = {
        from: this.config.from,
        to: this.config.to,
        subject: `${this.config.subject} - ${reportData.reportDate}`,
        text: emailContent.text,
        html: emailContent.html
      };

      const result = await this.transporter.sendMail(mailOptions);

      logger.info('Daily report email sent successfully', {
        messageId: result.messageId,
        recipients: this.config.to
      });

      return result;
    } catch (error) {
      logger.error('Failed to send daily report email', { error: error.message });
      throw error;
    }
  }

  generateEmailContent(data) {
    const html = this.generateHTMLEmail(data);
    const text = this.generateTextEmail(data);

    return { html, text };
  }

  generateHTMLEmail(data) {
    const syncSection = this.generateSyncSection(data.syncSummary);
    const missingServicesSection = this.generateMissingServicesSection(data.syncSummary.missingServices);
    const backupSection = this.generateBackupSection(data.backupStatus);
    const systemHealthSection = this.generateSystemHealthSection(data.systemHealth);

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 800px; margin: 0 auto; padding: 20px; }
        .header { background: #2c3e50; color: white; padding: 20px; text-align: center; }
        .section { margin: 20px 0; padding: 15px; border: 1px solid #ddd; }
        .status-success { color: #28a745; }
        .status-error { color: #dc3545; }
        .status-warning { color: #ffc107; }
        .sync-table { width: 100%; border-collapse: collapse; }
        .sync-table th, .sync-table td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
        .sync-table th { background-color: #f8f9fa; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
        .stat-card { background: #f8f9fa; padding: 15px; border-radius: 5px; }
        .stat-value { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .stat-label { color: #6c757d; font-size: 14px; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #6c757d; }
        .backup-success { background: #d4edda; color: #155724; padding: 10px; border-radius: 5px; }
        .backup-warning { background: #fff3cd; color: #856404; padding: 10px; border-radius: 5px; }
        .metric { margin: 0 15px; }
        .metric-value { font-weight: bold; color: #2c3e50; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏛️ Congress API Daily Sync Report</h1>
            <p>Date: ${data.reportDate} | Generated: ${new Date(data.timestamp).toLocaleString()}</p>
        </div>

        <div class="section">
            <h2>📊 Executive Summary</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value" style="color: ${data.executiveSummary.status === 'SUCCESS' ? '#28a745' : '#dc3545'}">${data.executiveSummary.status}</div>
                    <div class="stat-label">Overall Status</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${data.executiveSummary.servicesExpected || 0}</div>
                    <div class="stat-label">Services Expected</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${data.executiveSummary.servicesRan || 0}</div>
                    <div class="stat-label">Services Ran (24h)</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${data.executiveSummary.servicesMissed || 0}</div>
                    <div class="stat-label">Services Missed</div>
                </div>
            </div>
        </div>

        ${missingServicesSection.html}
        ${syncSection.html}
        ${backupSection.html}
        ${systemHealthSection.html}

        <div class="footer">
            Generated by Congress API Sync Service • ${new Date(data.timestamp).toLocaleString()}<br>
            <div style="margin-top: 10px;">
                <span class="metric">Total Tables: <span class="metric-value">${data.tableCounts?.length || 0}</span></span>
                <span class="metric">DB Size: <span class="metric-value">${this.formatBytes(data.tableCounts?.reduce((sum, t) => sum + t.liveRows, 0) * 1000 || 0)}</span></span>
                <span class="metric">Report Generation: <span class="metric-value">${(data.performance?.reportGenerationTime / 1000).toFixed(1)}s</span></span>
            </div>
        </div>
    </div>
</body>
</html>
    `;
  }

  generateTextEmail(data) {
    const syncSection = this.generateSyncSection(data.syncSummary);
    const missingServicesSection = this.generateMissingServicesSection(data.syncSummary.missingServices);
    const backupSection = this.generateBackupSection(data.backupStatus);
    const systemHealthSection = this.generateSystemHealthSection(data.systemHealth);

    return `
CONGRESS API DAILY SYNC REPORT
Date: ${data.reportDate}
==================================================

EXECUTIVE SUMMARY
Overall Status: ${data.executiveSummary.status}
Services Expected: ${data.executiveSummary.servicesExpected || 0}
Services Ran (24h): ${data.executiveSummary.servicesRan || 0}
Services Missed: ${data.executiveSummary.servicesMissed || 0}
Total Records Processed: ${data.executiveSummary.totalRecords?.toLocaleString() || 0}
New Records: ${data.executiveSummary.newRecords?.toLocaleString() || 0}
Updated Records: ${data.executiveSummary.updatedRecords?.toLocaleString() || 0}
Total Errors: ${data.executiveSummary.totalErrors || 0}

${missingServicesSection.text}
${syncSection.text}
${backupSection.text}
${systemHealthSection.text}

==================================================
Generated by Congress API Sync Service
${new Date(data.timestamp).toLocaleString()}
    `;
  }

  generateSyncSection(syncSummary) {
    if (!syncSummary?.recentActivity || syncSummary.recentActivity.length === 0) {
      return {
        html: '<div class="section"><h2>📅 SYNC ACTIVITY (Past 24 Hours)</h2><p>No sync activity in the past 24 hours.</p></div>',
        text: '\n\nSYNC ACTIVITY (Past 24 Hours)\n==================================================\n\nNo sync activity in the past 24 hours.\n'
      };
    }

    const htmlRows = syncSummary.recentActivity.map(item => `
      <tr>
        <td><strong>${item.entityType}</strong></td>
        <td class="${item.success ? 'status-success' : 'status-error'}">${item.success ? 'Success ✅' : 'Failed ❌'}</td>
        <td>${item.lastSync ? new Date(item.lastSync).toLocaleString() : 'N/A'}</td>
        <td>${item.recordsInserted || 0}</td>
        <td>${item.duration ? (item.duration / 1000).toFixed(1) + 's' : 'N/A'}</td>
        <td>${item.errorCount || 0}</td>
      </tr>
    `).join('');

    const textRows = syncSummary.recentActivity.map(item =>
      `${item.entityType}\n- Status: ${item.success ? 'SUCCESS' : 'FAILED'}\n- Last Sync: ${item.lastSync ? new Date(item.lastSync).toLocaleString() : 'N/A'}\n- Records: ${item.recordsInserted || 0}\n- Duration: ${item.duration ? (item.duration / 1000).toFixed(1) + 's' : 'N/A'}\n- Errors: ${item.errorCount || 0}\n`
    ).join('\n');

    return {
      html: `
        <div class="section">
          <h2>📅 SYNC ACTIVITY (Past 24 Hours)</h2>
          <table class="sync-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Status</th>
                <th>Last Sync</th>
                <th>Records</th>
                <th>Duration</th>
                <th>Errors</th>
              </tr>
            </thead>
            <tbody>
              ${htmlRows}
            </tbody>
          </table>
        </div>
      `,
      text: `\n\nSYNC ACTIVITY (Past 24 Hours)\n${'='.repeat(50)}\n\n${textRows}`
    };
  }

  generateMissingServicesSection(missingServices) {
    if (!missingServices || missingServices.length === 0) {
      return {
        html: '<div class="section"><h2>🟢 All Expected Services Ran</h2><p>All scheduled sync services executed in the past 24 hours.</p></div>',
        text: '\n\nALL EXPECTED SERVICES RAN\n==================================================\nAll scheduled sync services executed in the past 24 hours.\n'
      };
    }

    const htmlRows = missingServices.map(service => `
      <tr>
        <td><strong>${service.entityType}</strong></td>
        <td class="status-error">Missing ❌</td>
        <td>${service.lastSync ? new Date(service.lastSync).toLocaleString() : 'Never'}</td>
        <td>Service did not run in past 24 hours</td>
      </tr>
    `).join('');

    const textRows = missingServices.map(service =>
      `${service.entityType}\n- Status: MISSING\n- Last Sync: ${service.lastSync ? new Date(service.lastSync).toLocaleString() : 'Never'}\n- Issue: Service did not run in past 24 hours\n`
    ).join('\n');

    return {
      html: `
        <div class="section">
          <h2>🚨 MISSING SERVICES (Past 24 Hours)</h2>
          <table class="sync-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Status</th>
                <th>Last Sync</th>
                <th>Issue</th>
              </tr>
            </thead>
            <tbody>
              ${htmlRows}
            </tbody>
          </table>
        </div>
      `,
      text: `\n\nMISSING SERVICES (Past 24 Hours)\n${'='.repeat(50)}\n\n${textRows}`
    };
  }

  generateBackupSection(backupStatus) {
    const statusClass = backupStatus.status === 'success' ? 'backup-success' : 'backup-warning';
    const statusText = backupStatus.status === 'success' ? 'Backup Successful' : 'Backup Issues Detected';
    const statusIcon = backupStatus.status === 'success' ? '✅' : '⚠️';

    return {
      html: `
        <div class="section">
          <h2>💾 Database Backup Status</h2>
          <div class="${statusClass}">
            ${statusIcon}
            <div>
              <strong>${statusText}</strong><br>
              <small>Last backup: ${backupStatus.lastBackup ? new Date(backupStatus.lastBackup).toLocaleString() : 'Unknown'}</small>
            </div>
          </div>
        </div>
      `,
      text: `\n\nDATABASE BACKUP STATUS\n${'='.repeat(50)}\nStatus: ${statusText.toUpperCase()}\nLast Backup: ${backupStatus.lastBackup ? new Date(backupStatus.lastBackup).toLocaleString() : 'Unknown'}\n`
    };
  }

  generateSystemHealthSection(systemHealth) {
    return {
      html: `
        <div class="section">
          <h2>🖥️ System Health</h2>
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-value" style="color: #28a745">${systemHealth.activeServices || 0}</div>
              <div class="stat-label">Active Services</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">${systemHealth.uptime || 'unknown'}</div>
              <div class="stat-label">System Uptime</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">${systemHealth.dbConnections || 0}</div>
              <div class="stat-label">DB Connections</div>
            </div>
          </div>
        </div>
      `,
      text: `\n\nSYSTEM HEALTH\n${'='.repeat(50)}\nActive Services: ${systemHealth.activeServices || 0}\nSystem Uptime: ${systemHealth.uptime || 'unknown'}\nDB Connections: ${systemHealth.dbConnections || 0}\n`
    };
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  async close() {
    if (this.transporter) {
      this.transporter.close();
    }
  }
}

module.exports = EmailService;
