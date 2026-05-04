const CongressClient = require('../lib/congress-client');
const DatabaseService = require('../lib/database');
const logger = require('../lib/logger');
const config = require('../config');

// Validation severity levels
const VALIDATION_SEVERITY = {
  CRITICAL: 'critical',    // Will fail sync if validation fails
  IMPORTANT: 'important',  // Will log warning but continue
  OPTIONAL: 'optional'     // Will log info but continue
};

// Field validation configuration
const FIELD_VALIDATION_CONFIG = {
  // Critical fields - sync will fail if these are invalid
  type: { severity: VALIDATION_SEVERITY.CRITICAL, type: 'string', required: true },
  number: { severity: VALIDATION_SEVERITY.CRITICAL, type: 'number', required: true },
  congress: { severity: VALIDATION_SEVERITY.CRITICAL, type: 'number', required: true, min: 93, max: 125 },
  
  // Important fields - will warn but continue
  reportType: { severity: VALIDATION_SEVERITY.IMPORTANT, type: 'string', required: true },
  citation: { severity: VALIDATION_SEVERITY.IMPORTANT, type: 'string', required: true },
  title: { severity: VALIDATION_SEVERITY.IMPORTANT, type: 'string', required: true },
  chamber: { severity: VALIDATION_SEVERITY.IMPORTANT, type: 'string', required: true, enum: ['House', 'Senate', 'Joint'] },
  issueDate: { severity: VALIDATION_SEVERITY.IMPORTANT, type: 'date', required: false },
  updateDate: { severity: VALIDATION_SEVERITY.IMPORTANT, type: 'date', required: false },
  
  // Optional fields - will info log if issues found
  part: { severity: VALIDATION_SEVERITY.OPTIONAL, type: 'number', required: false, min: 1, max: 50 },
  sessionNumber: { severity: VALIDATION_SEVERITY.OPTIONAL, type: 'number', required: false, min: 1, max: 2 },
  isConferenceReport: { severity: VALIDATION_SEVERITY.OPTIONAL, type: 'boolean', required: false },
  committees: { severity: VALIDATION_SEVERITY.OPTIONAL, type: 'array', required: false },
  associatedBill: { severity: VALIDATION_SEVERITY.OPTIONAL, type: 'array', required: false },
  text: { severity: VALIDATION_SEVERITY.OPTIONAL, type: 'object', required: false }
};

class CommitteeReportSyncer {
  constructor() {
    this.client = new CongressClient();
    this.db = new DatabaseService();
    this.stats = {
      inserted: 0,
      updated: 0,
      failed: 0,
      billRelationships: 0,
      validationWarnings: 0,
      validationErrors: 0,
      errors: []
    };
  }

  /**
   * Validates a string field
   * @param {any} value - The value to validate
   * @param {Object} config - Validation configuration
   * @param {string} fieldName - Name of the field being validated
   * @returns {Object} Validation result
   */
  validateStringField(value, config, fieldName) {
    const result = { isValid: true, warnings: [], errors: [] };
    
    // Check if required field is missing
    if (config.required && (value === null || value === undefined || value === '')) {
      result.isValid = false;
      result.errors.push(`Required string field '${fieldName}' is missing or empty`);
      return result;
    }
    
    // Skip further validation if field is optional and missing
    if (!config.required && (value === null || value === undefined || value === '')) {
      return result;
    }
    
    // Type validation
    if (typeof value !== 'string') {
      result.isValid = false;
      result.errors.push(`Field '${fieldName}' must be a string, got ${typeof value}`);
      return result;
    }
    
    // Enum validation
    if (config.enum && !config.enum.includes(value)) {
      result.isValid = false;
      result.errors.push(`Field '${fieldName}' value '${value}' not in allowed values: ${config.enum.join(', ')}`);
    }
    
    // Length validation
    if (config.minLength && value.length < config.minLength) {
      result.warnings.push(`Field '${fieldName}' is shorter than expected minimum length ${config.minLength}`);
    }
    
    if (config.maxLength && value.length > config.maxLength) {
      result.warnings.push(`Field '${fieldName}' is longer than expected maximum length ${config.maxLength}`);
    }
    
    // Content validation for specific fields
    if (fieldName === 'citation' && value && !/^[HS]\. Rept\. \d{3}-\d+/.test(value)) {
      result.warnings.push(`Field '${fieldName}' doesn't match expected citation format`);
    }
    
    return result;
  }

  /**
   * Validates a number field
   * @param {any} value - The value to validate
   * @param {Object} config - Validation configuration
   * @param {string} fieldName - Name of the field being validated
   * @returns {Object} Validation result
   */
  validateNumberField(value, config, fieldName) {
    const result = { isValid: true, warnings: [], errors: [] };
    
    // Check if required field is missing
    if (config.required && (value === null || value === undefined)) {
      result.isValid = false;
      result.errors.push(`Required number field '${fieldName}' is missing`);
      return result;
    }
    
    // Skip further validation if field is optional and missing
    if (!config.required && (value === null || value === undefined)) {
      return result;
    }
    
    // Type validation and conversion
    const numValue = Number(value);
    if (isNaN(numValue) || !Number.isFinite(numValue)) {
      result.isValid = false;
      result.errors.push(`Field '${fieldName}' must be a valid number, got '${value}'`);
      return result;
    }
    
    // Range validation
    if (config.min !== undefined && numValue < config.min) {
      result.isValid = false;
      result.errors.push(`Field '${fieldName}' value ${numValue} is below minimum ${config.min}`);
    }
    
    if (config.max !== undefined && numValue > config.max) {
      result.isValid = false;
      result.errors.push(`Field '${fieldName}' value ${numValue} is above maximum ${config.max}`);
    }
    
    // Integer validation
    if (config.integer && !Number.isInteger(numValue)) {
      result.warnings.push(`Field '${fieldName}' expected to be integer, got ${numValue}`);
    }
    
    return result;
  }

  /**
   * Validates a date field
   * @param {any} value - The value to validate
   * @param {Object} config - Validation configuration
   * @param {string} fieldName - Name of the field being validated
   * @returns {Object} Validation result
   */
  validateDateField(value, config, fieldName) {
    const result = { isValid: true, warnings: [], errors: [] };
    
    // Check if required field is missing
    if (config.required && (value === null || value === undefined || value === '')) {
      result.isValid = false;
      result.errors.push(`Required date field '${fieldName}' is missing`);
      return result;
    }
    
    // Skip further validation if field is optional and missing
    if (!config.required && (value === null || value === undefined || value === '')) {
      return result;
    }
    
    // Date validation
    let dateValue;
    try {
      dateValue = new Date(value);
      if (isNaN(dateValue.getTime())) {
        result.isValid = false;
        result.errors.push(`Field '${fieldName}' contains invalid date: '${value}'`);
        return result;
      }
    } catch (error) {
      result.isValid = false;
      result.errors.push(`Field '${fieldName}' date parsing failed: ${error.message}`);
      return result;
    }
    
    // Logical date range validation
    const now = new Date();
    const minDate = new Date('1973-01-01'); // 93rd Congress started
    
    if (dateValue > now) {
      result.warnings.push(`Field '${fieldName}' date is in the future: ${value}`);
    }
    
    if (dateValue < minDate) {
      result.warnings.push(`Field '${fieldName}' date is before Congressional data era: ${value}`);
    }
    
    return result;
  }

  /**
   * Validates a boolean field
   * @param {any} value - The value to validate
   * @param {Object} config - Validation configuration
   * @param {string} fieldName - Name of the field being validated
   * @returns {Object} Validation result
   */
  validateBooleanField(value, config, fieldName) {
    const result = { isValid: true, warnings: [], errors: [] };
    
    // Check if required field is missing
    if (config.required && (value === null || value === undefined)) {
      result.isValid = false;
      result.errors.push(`Required boolean field '${fieldName}' is missing`);
      return result;
    }
    
    // Skip further validation if field is optional and missing
    if (!config.required && (value === null || value === undefined)) {
      return result;
    }
    
    // Type validation
    if (typeof value !== 'boolean') {
      result.isValid = false;
      result.errors.push(`Field '${fieldName}' must be a boolean, got ${typeof value}`);
    }
    
    return result;
  }

  /**
   * Validates an array field
   * @param {any} value - The value to validate
   * @param {Object} config - Validation configuration
   * @param {string} fieldName - Name of the field being validated
   * @returns {Object} Validation result
   */
  validateArrayField(value, config, fieldName) {
    const result = { isValid: true, warnings: [], errors: [] };
    
    // Check if required field is missing
    if (config.required && (value === null || value === undefined)) {
      result.isValid = false;
      result.errors.push(`Required array field '${fieldName}' is missing`);
      return result;
    }
    
    // Skip further validation if field is optional and missing
    if (!config.required && (value === null || value === undefined)) {
      return result;
    }
    
    // Type validation
    if (!Array.isArray(value)) {
      result.isValid = false;
      result.errors.push(`Field '${fieldName}' must be an array, got ${typeof value}`);
      return result;
    }
    
    // Length validation
    if (config.minLength && value.length < config.minLength) {
      result.warnings.push(`Field '${fieldName}' has ${value.length} items, expected at least ${config.minLength}`);
    }
    
    if (config.maxLength && value.length > config.maxLength) {
      result.warnings.push(`Field '${fieldName}' has ${value.length} items, expected at most ${config.maxLength}`);
    }
    
    // Content validation for specific array types
    if (fieldName === 'committees' && value.length > 0) {
      for (let i = 0; i < value.length; i++) {
        const committee = value[i];
        if (!committee.name) {
          result.warnings.push(`Committee at index ${i} missing name field`);
        }
        if (!committee.systemCode) {
          result.warnings.push(`Committee at index ${i} missing systemCode field`);
        }
      }
    }
    
    if (fieldName === 'associatedBill' && value.length > 0) {
      for (let i = 0; i < value.length; i++) {
        const bill = value[i];
        if (!bill.type) {
          result.warnings.push(`Associated bill at index ${i} missing type field`);
        }
        if (!bill.number) {
          result.warnings.push(`Associated bill at index ${i} missing number field`);
        }
        if (!bill.congress) {
          result.warnings.push(`Associated bill at index ${i} missing congress field`);
        }
      }
    }
    
    return result;
  }

  /**
   * Validates an object field
   * @param {any} value - The value to validate
   * @param {Object} config - Validation configuration
   * @param {string} fieldName - Name of the field being validated
   * @returns {Object} Validation result
   */
  validateObjectField(value, config, fieldName) {
    const result = { isValid: true, warnings: [], errors: [] };
    
    // Check if required field is missing
    if (config.required && (value === null || value === undefined)) {
      result.isValid = false;
      result.errors.push(`Required object field '${fieldName}' is missing`);
      return result;
    }
    
    // Skip further validation if field is optional and missing
    if (!config.required && (value === null || value === undefined)) {
      return result;
    }
    
    // Type validation
    if (typeof value !== 'object' || Array.isArray(value) || value === null) {
      result.isValid = false;
      result.errors.push(`Field '${fieldName}' must be an object, got ${typeof value}`);
      return result;
    }
    
    // Content validation for specific object types
    if (fieldName === 'text') {
      if (value.url && typeof value.url !== 'string') {
        result.warnings.push(`Text object url field must be string, got ${typeof value.url}`);
      }
      if (value.count && typeof value.count !== 'number') {
        result.warnings.push(`Text object count field must be number, got ${typeof value.count}`);
      }
    }
    
    return result;
  }

  /**
   * Validates a single field based on its configuration
   * @param {any} value - The value to validate
   * @param {Object} config - Validation configuration
   * @param {string} fieldName - Name of the field being validated
   * @returns {Object} Validation result
   */
  validateField(value, config, fieldName) {
    switch (config.type) {
      case 'string':
        return this.validateStringField(value, config, fieldName);
      case 'number':
        return this.validateNumberField(value, config, fieldName);
      case 'date':
        return this.validateDateField(value, config, fieldName);
      case 'boolean':
        return this.validateBooleanField(value, config, fieldName);
      case 'array':
        return this.validateArrayField(value, config, fieldName);
      case 'object':
        return this.validateObjectField(value, config, fieldName);
      default:
        return { isValid: false, warnings: [], errors: [`Unknown field type '${config.type}' for field '${fieldName}'`] };
    }
  }

  /**
   * Performs comprehensive validation of all committee report fields
   * @param {Object} apiData - Raw API data to validate
   * @param {number} congress - Congress number
   * @returns {Object} Comprehensive validation result
   */
  validateCommitteeReportData(apiData, congress) {
    const report = apiData.committeeReports?.[0] || apiData;
    const validationResult = {
      isValid: true,
      criticalErrors: [],
      importantWarnings: [],
      optionalInfo: [],
      fieldResults: {},
      summary: {
        totalFields: 0,
        validFields: 0,
        criticalIssues: 0,
        importantIssues: 0,
        optionalIssues: 0
      }
    };
    
    // Add congress to report data for validation
    const dataToValidate = { ...report, congress };
    
    // Validate each configured field
    for (const [fieldName, config] of Object.entries(FIELD_VALIDATION_CONFIG)) {
      validationResult.summary.totalFields++;
      
      const fieldResult = this.validateField(dataToValidate[fieldName], config, fieldName);
      validationResult.fieldResults[fieldName] = fieldResult;
      
      if (fieldResult.isValid) {
        validationResult.summary.validFields++;
      }
      
      // Categorize issues by severity
      if (fieldResult.errors.length > 0) {
        switch (config.severity) {
          case VALIDATION_SEVERITY.CRITICAL:
            validationResult.isValid = false;
            validationResult.criticalErrors.push(...fieldResult.errors);
            validationResult.summary.criticalIssues += fieldResult.errors.length;
            break;
          case VALIDATION_SEVERITY.IMPORTANT:
            validationResult.importantWarnings.push(...fieldResult.errors);
            validationResult.summary.importantIssues += fieldResult.errors.length;
            break;
          case VALIDATION_SEVERITY.OPTIONAL:
            validationResult.optionalInfo.push(...fieldResult.errors);
            validationResult.summary.optionalIssues += fieldResult.errors.length;
            break;
        }
      }
      
      if (fieldResult.warnings.length > 0) {
        switch (config.severity) {
          case VALIDATION_SEVERITY.CRITICAL:
          case VALIDATION_SEVERITY.IMPORTANT:
            validationResult.importantWarnings.push(...fieldResult.warnings);
            validationResult.summary.importantIssues += fieldResult.warnings.length;
            break;
          case VALIDATION_SEVERITY.OPTIONAL:
            validationResult.optionalInfo.push(...fieldResult.warnings);
            validationResult.summary.optionalIssues += fieldResult.warnings.length;
            break;
        }
      }
    }
    
    return validationResult;
  }

  /**
   * Logs validation results with appropriate log levels
   * @param {Object} validationResult - Result from validateCommitteeReportData
   * @param {string} reportId - Report identifier for logging context
   */
  logValidationResults(validationResult, reportId) {
    const { summary, criticalErrors, importantWarnings, optionalInfo } = validationResult;
    
    // Always log summary for info
    logger.info('Committee report validation completed', {
      reportId,
      totalFields: summary.totalFields,
      validFields: summary.validFields,
      criticalIssues: summary.criticalIssues,
      importantIssues: summary.importantIssues,
      optionalIssues: summary.optionalIssues,
      validationRate: `${((summary.validFields / summary.totalFields) * 100).toFixed(1)}%`
    });
    
    // Log critical errors
    if (criticalErrors.length > 0) {
      logger.error('Critical validation errors found', {
        reportId,
        errors: criticalErrors
      });
    }
    
    // Log important warnings
    if (importantWarnings.length > 0) {
      logger.warn('Important validation warnings found', {
        reportId,
        warnings: importantWarnings
      });
    }
    
    // Log optional info (only if there are issues)
    if (optionalInfo.length > 0) {
      logger.debug('Optional field validation info', {
        reportId,
        info: optionalInfo
      });
    }
    
    // Update stats
    if (importantWarnings.length > 0 || optionalInfo.length > 0) {
      this.stats.validationWarnings++;
    }
    if (criticalErrors.length > 0) {
      this.stats.validationErrors++;
    }
  }

  // Transform API committee report data to database format
  transformReportData(apiData, congress) {
    try {
      // Handle the nested structure from detail endpoint
      const report = apiData.committeeReports?.[0] || apiData;
      
      // Perform comprehensive validation
      const validationResult = this.validateCommitteeReportData(apiData, congress);
      
      // Generate report ID for logging context
      const reportId = `${congress}-${report.type || 'UNKNOWN'}-${report.number || 'UNKNOWN'}${report.part > 1 ? `-${report.part}` : ''}`;
      
      // Log validation results
      this.logValidationResults(validationResult, reportId);
      
      // Fail transformation if critical validation errors exist
      if (!validationResult.isValid) {
        throw new Error(`Critical validation failures: ${validationResult.criticalErrors.join('; ')}`);
      }
      
      // Generate report_id in format: congress-type-number-part (reuse validated reportId)
      // const reportId = `${congress}-${report.type}-${report.number}${report.part > 1 ? `-${report.part}` : ''}`;
      
      // Transform data with validation-aware processing
      const transformedData = {
        report_id: reportId,
        congress_id: congress,
        report_type: report.type,                    // "HRPT" (system code)
        report_type_display: report.reportType || null,      // "H.Rept." (display format) - handle missing
        report_number: report.number,
        citation: report.citation || null,
        part: report.part || 1,
        is_conference_report: report.isConferenceReport || false,
        issue_date: report.issueDate ? new Date(report.issueDate) : null,
        chamber: report.chamber || null,
        title: report.title || null,
        session_number: report.sessionNumber || null,
        text_url: report.text?.url || null,
        text_count: report.text?.count || 0,
        committees: report.committees ? JSON.stringify(report.committees) : null,
        api_update_date: report.updateDate ? new Date(report.updateDate) : new Date(),
        // Add validation metadata
        validation_score: validationResult.summary.validFields / validationResult.summary.totalFields,
        validation_issues: validationResult.summary.criticalIssues + validationResult.summary.importantIssues + validationResult.summary.optionalIssues
      };
      
      return transformedData;
    } catch (error) {
      const report = apiData.committeeReports?.[0] || apiData;
      logger.error('Failed to transform committee report data', { 
        error: error.message,
        reportNumber: report.number || 'unknown',
        reportType: report.type || 'unknown',
        reportTypeDisplay: report.reportType || 'unknown',
        congress,
        hasValidationErrors: error.message.includes('Critical validation failures')
      });
      throw error;
    }
  }

  // Extract associated bills from report data
  extractAssociatedBills(apiData, congress) {
    const report = apiData.committeeReports?.[0] || apiData;
    const bills = [];
    
    if (report.associatedBill && Array.isArray(report.associatedBill)) {
      for (const bill of report.associatedBill) {
        // Generate bill_id in same format as bill table (with hyphen before number)
        const billId = `${bill.congress}-${bill.type.toUpperCase()}-${bill.number}`;
        bills.push(billId);
      }
    }
    
    return bills;
  }

  // Sync a single committee report with its details
  async syncReportDetails(congress, reportType, reportNumber) {
    try {
      // Get detailed report information
      const reportResponse = await this.client.getCommitteeReportDetails(congress, reportType, reportNumber);
      
      if (!reportResponse || !reportResponse.committeeReports?.[0]) {
        throw new Error(`Report not found: ${reportType} ${reportNumber}`);
      }
      
      // Transform and upsert report data
      const transformedReport = this.transformReportData(reportResponse, congress);
      const result = await this.db.upsertCommitteeReport(transformedReport);
      
      if (result.inserted) {
        this.stats.inserted++;
        logger.debug('Inserted new committee report', { report_id: transformedReport.report_id });
      } else {
        this.stats.updated++;
        logger.debug('Updated existing committee report', { report_id: transformedReport.report_id });
      }
      
      // Process associated bills
      const associatedBills = this.extractAssociatedBills(reportResponse, congress);
      for (const billId of associatedBills) {
        const relationResult = await this.db.upsertCommitteeReportBill(
          transformedReport.report_id, 
          billId
        );
        
        if (relationResult.success && relationResult.inserted) {
          this.stats.billRelationships++;
          logger.debug('Added committee report-bill relationship', {
            report_id: transformedReport.report_id,
            bill_id: billId
          });
        }
      }
      
      return result;
    } catch (error) {
      logger.error('Failed to sync committee report details', { 
        congress,
        reportType,
        reportNumber,
        error: error.message 
      });
      throw error;
    }
  }

  // Sync all committee reports for a specific congress with pagination
  async syncCommitteeReportsByCongress(congress, options = {}) {
    const startTime = Date.now();
    logger.info(`Starting sync of committee reports for Congress ${congress}`);

    try {
      // Reset stats for this sync
      this.stats = {
        inserted: 0,
        updated: 0,
        failed: 0,
        billRelationships: 0,
        validationWarnings: 0,
        validationErrors: 0,
        errors: []
      };
      
      // Get all reports with pagination
      const reports = [];
      let offset = 0;
      let hasMore = true;
      const limit = 100; // Process 100 at a time
      
      while (hasMore) {
        logger.info(`Fetching committee reports batch (offset: ${offset}, limit: ${limit})`);
        
        const response = await this.client.getCommitteeReports(congress, { 
          limit: limit,
          offset: offset
        });
        
        const batchReports = response.reports || [];
        reports.push(...batchReports);
        
        logger.info(`Fetched ${batchReports.length} reports (total: ${reports.length})`);
        
        // Check if we have more pages
        const totalCount = response.pagination?.count || 0;
        hasMore = reports.length < totalCount && batchReports.length === limit;
        offset += limit;
        
        // Small delay between pagination requests
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      logger.info(`Found ${reports.length} committee reports to sync for Congress ${congress}`);
      
      // Process each report to get detailed information
      const batchSize = 10; // Process 10 reports at a time for details
      
      for (let i = 0; i < reports.length; i += batchSize) {
        const batch = reports.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(reports.length / batchSize);
        
        logger.info(`Processing batch ${batchNum}/${totalBatches} (reports ${i + 1}-${Math.min(i + batchSize, reports.length)})`);
        
        await this.processReportBatch(batch, congress);
        
        logger.info(`Completed batch ${batchNum}/${totalBatches}`);
        
        // Delay between batches to respect rate limits
        if (i + batchSize < reports.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      const duration = Date.now() - startTime;

      // Update sync status on success
      await this.db.updateSyncStatus('committee-reports', {
        success: true,
        records_synced: this.stats.inserted + this.stats.updated,
        records_failed: this.stats.failed,
        duration,
        metadata: {
          congress,
          fromDate: options.fromDate || null,
          stats: this.stats
        }
      });

      logger.info(`Committee report sync completed for Congress ${congress}`, {
        inserted: this.stats.inserted,
        updated: this.stats.updated,
        failed: this.stats.failed,
        billRelationships: this.stats.billRelationships,
        validationWarnings: this.stats.validationWarnings,
        validationErrors: this.stats.validationErrors,
        duration: `${duration}ms`,
        dataQualityRate: this.stats.validationWarnings > 0 ?
          `${(((this.stats.inserted + this.stats.updated - this.stats.validationErrors) / (this.stats.inserted + this.stats.updated)) * 100).toFixed(1)}%` : '100%'
      });

      return this.stats;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Update sync status on failure
      await this.db.updateSyncStatus('committee-reports', {
        success: false,
        records_synced: this.stats.inserted + this.stats.updated,
        records_failed: this.stats.failed,
        duration,
        error: error.message,
        metadata: {
          congress,
          fromDate: options.fromDate || null,
          stats: this.stats
        }
      });

      logger.error(`Failed to sync committee reports for Congress ${congress}`, {
        error: error.message,
        duration: `${duration}ms`
      });
      throw error;
    }
  }

  // Process a batch of committee reports
  async processReportBatch(reports, congress) {
    for (let i = 0; i < reports.length; i++) {
      const report = reports[i];
      try {
        // Log progress for every 5th report
        if ((i + 1) % 5 === 0 || i === 0) {
          logger.info(`Syncing report ${i + 1}/${reports.length}: ${report.citation}`);
        }
        
        await this.syncReportDetails(congress, report.type, report.number);
        
        // Add delay between individual report calls
        if (i < reports.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        this.stats.failed++;
        this.stats.errors.push({
          citation: report.citation,
          type: report.type,
          number: report.number,
          error: error.message
        });
        logger.warn('Failed to sync committee report', { 
          citation: report.citation,
          error: error.message 
        });
      }
    }
  }

  // Sync committee reports for current congress
  async syncCurrentCongress() {
    try {
      const currentCongress = await this.client.getCurrentCongress();
      logger.info(`Identified current congress: ${currentCongress}`);
      
      return await this.syncCommitteeReportsByCongress(currentCongress);
    } catch (error) {
      logger.error('Failed to sync current congress committee reports', { error: error.message });
      throw error;
    }
  }

  // Close database connection
  async close() {
    await this.db.close();
  }
}

module.exports = CommitteeReportSyncer;