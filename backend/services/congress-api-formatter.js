const { logger } = require('../logger');

/**
 * Congress API Response Formatter
 * 
 * Transforms database records to match Congress API response format exactly.
 * Ensures seamless compatibility between database endpoints and existing Congress API endpoints.
 * 
 * Key Features:
 * - Exact field mapping and structure matching
 * - Data type conversions and formatting
 * - Null value handling consistent with Congress API
 * - Pagination format compatibility
 * - Nested relationship formatting
 */
class CongressAPIFormatter {

  /**
   * Format database bill record to match Congress API bill response
   * @param {Object} dbBill - Database bill record with related data
   * @returns {Object} Congress API formatted bill response
   */
  static formatBill(dbBill) {
    if (!dbBill) {
      return null;
    }

    try {
      // Core bill structure matching Congress API format
      const formattedBill = {
        bill: {
          // Core identifiers
          congress: parseInt(dbBill.congress_id),
          type: dbBill.bill_type?.toUpperCase() || null,
          number: dbBill.bill_number?.toString() || null,
          
          // Chamber information
          originChamber: dbBill.origin_chamber || null,
          originChamberCode: dbBill.origin_chamber_code || null,
          
          // Title information
          title: dbBill.title || null,
          
          // Dates (format as YYYY-MM-DD to match Congress API)
          introducedDate: dbBill.introduced_date ? 
            new Date(dbBill.introduced_date).toISOString().split('T')[0] : null,
          
          // Latest action information
          latestAction: (dbBill.latest_action_text || dbBill.latest_action) ? {
            text: dbBill.latest_action_text || dbBill.latest_action,
            actionDate: dbBill.latest_action_date ? 
              new Date(dbBill.latest_action_date).toISOString().split('T')[0] : null
          } : null,
          
          // Policy area
          policyArea: dbBill.policy_area ? {
            name: dbBill.policy_area
          } : null,
          
          // Sponsor information (handle both single sponsor and array)
          sponsors: (() => {
            if (Array.isArray(dbBill.sponsors) && dbBill.sponsors.length > 0) {
              return dbBill.sponsors.map(sponsor => ({
                bioguideId: sponsor.bioguide_id || sponsor.member_bioguide_id,
                fullName: sponsor.full_name || sponsor.direct_order_name || null,
                party: sponsor.party || null,
                state: sponsor.state || null,
                district: sponsor.district || null,
                firstName: sponsor.first_name || null,
                lastName: sponsor.last_name || null,
                middleName: sponsor.middle_name || null,
                isByRequest: sponsor.is_by_request ? "Y" : "N",
                url: sponsor.bioguide_id ? `https://api.congress.gov/v3/member/${sponsor.bioguide_id}?format=json` : null
              }));
            } else if (dbBill.sponsor_bioguide_id) {
              // Create Congress API formatted fullName
              const chamber = dbBill.bill_type?.toLowerCase().startsWith('h') ? 'Rep.' : 'Sen.';
              const middleInitial = dbBill.sponsor_middle_name ? ` ${dbBill.sponsor_middle_name.charAt(0)}.` : '';
              const district = dbBill.sponsor_district ? `-${dbBill.sponsor_district}` : '';
              const formattedFullName = `${chamber} ${dbBill.sponsor_last_name}, ${dbBill.sponsor_first_name}${middleInitial} [${dbBill.sponsor_party}-${dbBill.sponsor_state}${district}]`;
              
              return [{
                bioguideId: dbBill.sponsor_bioguide_id,
                fullName: formattedFullName,
                party: dbBill.sponsor_party || null,
                state: dbBill.sponsor_state || null,
                district: dbBill.sponsor_district || null,
                firstName: dbBill.sponsor_first_name || null,
                lastName: dbBill.sponsor_last_name || null,
                middleName: dbBill.sponsor_middle_name || null,
                isByRequest: dbBill.is_by_request ? "Y" : "N",
                url: `https://api.congress.gov/v3/member/${dbBill.sponsor_bioguide_id}?format=json`
              }];
            }
            return [];
          })(),
          
          // URLs and references
          url: dbBill.url || null,
          
          // Update information (with full timestamp format)
          updateDate: dbBill.api_update_date ? 
            new Date(dbBill.api_update_date).toISOString() : null,
          updateDateIncludingText: dbBill.api_update_date_including_text ? 
            new Date(dbBill.api_update_date_including_text).toISOString() : null,

          // CBO Cost Estimates
          cboCostEstimates: Array.isArray(dbBill.cbo_cost_estimates) ? dbBill.cbo_cost_estimates : [],
          
          // Laws
          laws: Array.isArray(dbBill.laws) ? dbBill.laws : [],
          
          // Notes
          notes: Array.isArray(dbBill.notes) ? dbBill.notes : [],
            
          // Congress API metadata (required for compatibility)
          ...(dbBill.congress_id && dbBill.bill_type && dbBill.bill_number ? {
            textVersions: {
              url: `https://api.congress.gov/v3/bill/${dbBill.congress_id}/${dbBill.bill_type.toLowerCase()}/${dbBill.bill_number}/text?format=json`,
              count: null // Would need separate query to determine
            },
            
            actions: {
              url: `https://api.congress.gov/v3/bill/${dbBill.congress_id}/${dbBill.bill_type.toLowerCase()}/${dbBill.bill_number}/actions?format=json`,
              count: Array.isArray(dbBill.actions) ? dbBill.actions.length : null
            },
            
            amendments: {
              url: `https://api.congress.gov/v3/bill/${dbBill.congress_id}/${dbBill.bill_type.toLowerCase()}/${dbBill.bill_number}/amendments?format=json`,
              count: null // Would need separate query to determine
            },
            
            cosponsors: {
              url: `https://api.congress.gov/v3/bill/${dbBill.congress_id}/${dbBill.bill_type.toLowerCase()}/${dbBill.bill_number}/cosponsors?format=json`,
              count: Array.isArray(dbBill.cosponsors) ? dbBill.cosponsors.length : null,
              countIncludingWithdrawnCosponsors: Array.isArray(dbBill.cosponsors) ? 
                dbBill.cosponsors.length : null
            },
            
            committeeReports: {
              url: `https://api.congress.gov/v3/bill/${dbBill.congress_id}/${dbBill.bill_type.toLowerCase()}/${dbBill.bill_number}/committee-reports?format=json`,
              count: Array.isArray(dbBill.committee_reports) ? dbBill.committee_reports.length : null
            },
            
            relatedBills: {
              url: `https://api.congress.gov/v3/bill/${dbBill.congress_id}/${dbBill.bill_type.toLowerCase()}/${dbBill.bill_number}/relatedbills?format=json`,
              count: parseInt(dbBill.related_bills_count) || null
            },
            
            subjects: {
              url: `https://api.congress.gov/v3/bill/${dbBill.congress_id}/${dbBill.bill_type.toLowerCase()}/${dbBill.bill_number}/subjects?format=json`,
              count: null // Would need separate query to determine
            },
            
            summaries: {
              url: `https://api.congress.gov/v3/bill/${dbBill.congress_id}/${dbBill.bill_type.toLowerCase()}/${dbBill.bill_number}/summaries?format=json`,
              count: Array.isArray(dbBill.summaries) ? dbBill.summaries.length : null
            },
            
            titles: {
              url: `https://api.congress.gov/v3/bill/${dbBill.congress_id}/${dbBill.bill_type.toLowerCase()}/${dbBill.bill_number}/titles?format=json`,
              count: Array.isArray(dbBill.titles) ? dbBill.titles.length : null
            },

            // Add CBO cost estimates if available
            ...(Array.isArray(dbBill.cbo_cost_estimates) && dbBill.cbo_cost_estimates.length > 0 ? {
              cboCostEstimates: dbBill.cbo_cost_estimates.map(estimate => ({
                title: estimate.title,
                url: estimate.url,
                description: estimate.description,
                pubDate: estimate.pubDate
              }))
            } : {}),

            // Add committee reports if available
            ...(Array.isArray(dbBill.committee_reports) && dbBill.committee_reports.length > 0 ? {
              committeeReports: dbBill.committee_reports.map(report => ({
                citation: report.citation,
                url: report.url
              }))
            } : {}),

            // Add laws if available
            ...(Array.isArray(dbBill.laws) && dbBill.laws.length > 0 ? {
              laws: dbBill.laws.map(law => ({
                type: law.type,
                number: law.number
              }))
            } : {}),

            // Add notes if available
            ...(Array.isArray(dbBill.notes) && dbBill.notes.length > 0 ? {
              notes: dbBill.notes.map(note => ({
                text: note.text,
                links: note.links || []
              }))
            } : {}),

          } : {})
        }
      };

      logger.debug('Bill formatted for Congress API compatibility', {
        billId: `${dbBill.congress_id}/${dbBill.bill_type}/${dbBill.bill_number}`,
        hasActions: Array.isArray(dbBill.actions),
        hasCosponsors: Array.isArray(dbBill.cosponsors),
        hasSummaries: Array.isArray(dbBill.summaries),
        hasTitles: Array.isArray(dbBill.titles)
      });

      return formattedBill;
      
    } catch (error) {
      logger.error('Error formatting bill for Congress API', {
        error: error.message,
        billId: dbBill.bill_id || 'unknown',
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Format database bill record for list endpoints (without "bill" wrapper)
   * @param {Object} dbBill - Database bill record
   * @returns {Object} Congress API formatted bill for lists
   */
  static formatBillForList(dbBill) {
    if (!dbBill) {
      return null;
    }

    try {
      // Map chamber information
      const originChamber = dbBill.bill_type?.toUpperCase().startsWith('H') ? 'House' : 
                           dbBill.bill_type?.toUpperCase().startsWith('S') ? 'Senate' : null;
      const originChamberCode = originChamber === 'House' ? 'H' : 
                               originChamber === 'Senate' ? 'S' : null;

      return {
        // Core identifiers
        congress: parseInt(dbBill.congress_id),
        type: dbBill.bill_type?.toUpperCase() || null,
        number: dbBill.bill_number?.toString() || null,
        
        // Chamber information
        originChamber: originChamber,
        originChamberCode: originChamberCode,
        
        // Title information
        title: dbBill.title || null,
        
        // Latest action information
        latestAction: dbBill.latest_action ? {
          actionDate: dbBill.latest_action_date ? 
            new Date(dbBill.latest_action_date).toISOString().split('T')[0] : null,
          text: dbBill.latest_action
        } : null,
        
        // Update information
        updateDate: dbBill.api_update_date ? 
          new Date(dbBill.api_update_date).toISOString().split('T')[0] : null,
        updateDateIncludingText: dbBill.api_update_date ? 
          new Date(dbBill.api_update_date).toISOString().split('T')[0] : null,
        
        // URLs and references
        url: dbBill.url || null
      };
      
    } catch (error) {
      logger.error('Error formatting bill for list view', {
        error: error.message,
        billId: dbBill.bill_id || 'unknown',
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Format database actions array to match Congress API actions response
   * @param {Array} dbActions - Database action records
   * @param {Object} billInfo - Bill context information
   * @returns {Object} Congress API formatted actions response
   */
  static formatBillActions(dbActions, billInfo = {}) {
    if (!Array.isArray(dbActions)) {
      dbActions = [];
    }

    try {
      const formattedActions = dbActions.map((action, index) => ({
        actionDate: action.action_date ? 
          new Date(action.action_date).toISOString().split('T')[0] : null,
        text: action.text || null,
        type: action.type || null,
        actionCode: action.action_code || null,
        sourceSystem: action.source_system ? {
          code: action.source_system,
          name: this.getSourceSystemName(action.source_system)
        } : null,
        
        // Committee information if available
        ...(action.committee_code ? {
          committees: [{
            systemCode: action.committee_code,
            name: action.committee_name || null
          }]
        } : {}),
        
        // Links (matching Congress API structure)
        links: []
      }));

      return {
        actions: formattedActions,
        pagination: {
          count: formattedActions.length,
          next: null,
          previous: null
        },
        request: {
          congress: billInfo.congress || null,
          billType: billInfo.type || null,
          billNumber: billInfo.number || null,
          format: "json"
        }
      };
      
    } catch (error) {
      logger.error('Error formatting bill actions for Congress API', {
        error: error.message,
        actionsCount: dbActions.length,
        billInfo
      });
      throw error;
    }
  }

  /**
   * Format database cosponsors array to match Congress API cosponsors response
   * @param {Array} dbCosponsors - Database cosponsor records
   * @param {Object} billInfo - Bill context information
   * @returns {Object} Congress API formatted cosponsors response
   */
  static formatBillCosponsors(dbCosponsors, billInfo = {}) {
    if (!Array.isArray(dbCosponsors)) {
      dbCosponsors = [];
    }

    try {
      const formattedCosponsors = dbCosponsors.map(cosponsor => ({
        bioguideId: cosponsor.bioguide_id || null,
        fullName: cosponsor.full_name || null,
        party: cosponsor.party || null,
        state: cosponsor.state || null,
        
        // Sponsorship details
        sponsorshipDate: cosponsor.date ? 
          new Date(cosponsor.date).toISOString().split('T')[0] : null,
        sponsorshipWithdrawnDate: cosponsor.withdrawn_date ? 
          new Date(cosponsor.withdrawn_date).toISOString().split('T')[0] : null,
        isOriginalCosponsor: cosponsor.is_original_cosponsor === true ? "True" : "False"
      }));

      return {
        cosponsors: formattedCosponsors,
        pagination: {
          count: formattedCosponsors.length,
          next: null,
          previous: null
        },
        request: {
          congress: billInfo.congress || null,
          billType: billInfo.type || null,
          billNumber: billInfo.number || null,
          format: "json"
        }
      };
      
    } catch (error) {
      logger.error('Error formatting bill cosponsors for Congress API', {
        error: error.message,
        cosponsorsCount: dbCosponsors.length,
        billInfo
      });
      throw error;
    }
  }

  /**
   * Format database member record to match Congress API member response exactly
   * @param {Object} dbMember - Database member record with related data
   * @returns {Object} Congress API formatted member response
   */
  static formatMember(dbMember) {
    if (!dbMember) {
      return null;
    }

    try {
      return {
        member: {
          // Address information
          addressInformation: dbMember.address_information || {
            city: dbMember.address_city || null,
            district: dbMember.address_district || null,
            zipCode: dbMember.address_zip_code || null
          },
          
          // Core identifiers
          bioguideId: dbMember.bioguide_id || null,
          
          // Personal information
          birthYear: dbMember.birth_year ? 
            dbMember.birth_year.toString() : null,
          
          // Legislation counts
          cosponsoredLegislation: {
            count: dbMember.cosponsored_legislation_count || 0,
            url: dbMember.cosponsored_legislation_url || 
              `https://api.congress.gov/v3/member/${dbMember.bioguide_id}/cosponsored-legislation`
          },
          
          // Current member status
          currentMember: dbMember.current_member || false,
          
          // Depiction/image information
          depiction: {
            attribution: dbMember.depiction_attribution || null,
            imageUrl: dbMember.depiction_url || null
          },
          
          // Name information - exact Congress API structure
          directOrderName: dbMember.direct_order_name || null,
          firstName: dbMember.first_name || null,
          honorificName: dbMember.honorific_name || null,
          invertedOrderName: dbMember.inverted_order_name || null,
          lastName: dbMember.last_name || null,
          
          // Official website
          officialWebsiteUrl: dbMember.official_url || null,
          
          // Party history - array format
          partyHistory: dbMember.party_history ? 
            (Array.isArray(dbMember.party_history) ? dbMember.party_history : []).map(party => ({
              partyAbbreviation: party.party_abbreviation,
              partyName: party.party_name,
              startYear: party.start_year,
              ...(party.end_year ? { endYear: party.end_year } : {})
            })) : [],
          
          // Previous names - array format  
          previousNames: dbMember.previous_names ? 
            (Array.isArray(dbMember.previous_names) ? dbMember.previous_names : []).map(name => ({
              directOrderName: name.direct_order_name,
              firstName: name.first_name,
              honorificName: dbMember.honorific_name, // Use current honorific
              invertedOrderName: name.inverted_order_name,
              lastName: name.last_name,
              startDate: name.start_date ? new Date(name.start_date).toISOString() : null
            })) : [],
          
          // Sponsored legislation
          sponsoredLegislation: {
            count: dbMember.sponsored_legislation_count || 0,
            url: dbMember.sponsored_legislation_url || 
              `https://api.congress.gov/v3/member/${dbMember.bioguide_id}/sponsored-legislation`
          },
          
          // State - full name, not abbreviation
          state: dbMember.state_name || this.getStateName(dbMember.state_code) || null,
          
          // Terms array
          terms: dbMember.terms ? 
            (Array.isArray(dbMember.terms) ? dbMember.terms : []).map(term => ({
              chamber: term.chamber,
              congress: term.congress,
              endYear: term.end_year,
              memberType: term.member_type,
              startYear: term.start_year,
              stateCode: term.state_code,
              stateName: term.state_name || this.getStateName(term.state_code)
            })) : [],
          
          // Update date
          updateDate: dbMember.api_update_date ? 
            new Date(dbMember.api_update_date).toISOString() : null
        },
        
        // Request metadata - matching Congress API format
        request: {
          bioguideId: dbMember.bioguide_id ? dbMember.bioguide_id.toLowerCase() : null,
          contentType: "application/json",
          format: "json"
        }
      };
      
    } catch (error) {
      logger.error('Error formatting member for Congress API', {
        error: error.message,
        bioguideId: dbMember.bioguide_id || 'unknown',
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get state full name from state code
   * @param {string} stateCode - Two letter state code
   * @returns {string} Full state name
   */
  static getStateName(stateCode) {
    if (!stateCode) return null;
    
    const stateNames = {
      'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
      'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
      'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
      'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
      'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
      'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
      'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
      'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
      'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
      'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
      'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
      'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
      'WI': 'Wisconsin', 'WY': 'Wyoming',
      'AS': 'American Samoa', 'DC': 'District of Columbia', 'FM': 'Federated States of Micronesia',
      'GU': 'Guam', 'MH': 'Marshall Islands', 'MP': 'Northern Mariana Islands',
      'PW': 'Palau', 'PR': 'Puerto Rico', 'VI': 'U.S. Virgin Islands'
    };
    
    return stateNames[stateCode.toUpperCase()] || null;
  }

  /**
   * Construct Committee URL based on system code and name
   * @param {Object} committee - Committee object with system_code, name, and chamber
   * @returns {string} Congress.gov committee URL
   */
  static constructCommitteeURL(committee) {

    if (!committee || !committee.system_code || !committee.name || !committee.chamber) {
      logger.warn('constructCommitteeURL: Missing required fields', {
        hasCommittee: !!committee,
        hasSystemCode: committee ? !!committee.system_code : false,
        hasName: committee ? !!committee.name : false,
        hasChamber: committee ? !!committee.chamber : false
      });
      return null;
    }

    try {
      const chamber = committee.chamber.toLowerCase();
      const systemCode = committee.system_code.toLowerCase();
      const congress = 119; // Current congress
      
      // Extract base name by removing common committee suffixes
      const baseName = committee.name
        .toLowerCase()
        .replace(/ committee$/i, '')
        .replace(/ subcommittee$/i, '')
        .replace(/subcommittee on /i, '')
        .replace(/committee on /i, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''); // Remove leading/trailing dashes
      
      const url = `https://www.congress.gov/committee/${systemCode}/${congress}/${chamber}-committee-on-${baseName}`;
      
      
      return url;
      
    } catch (error) {
      logger.warn('Error constructing committee URL', {
        error: error.message,
        systemCode: committee.system_code,
        name: committee.name,
        chamber: committee.chamber
      });
      return null;
    }
  }

  /**
   * Format database committee record to match Congress API committee response
   * @param {Object} dbCommittee - Database committee record
   * @returns {Object} Congress API formatted committee response
   */
  static formatCommittee(dbCommittee) {
    if (!dbCommittee) {
      return null;
    }


    try {
      const formattedResult = {
        committee: {
          // Core identifiers
          systemCode: dbCommittee.system_code || null,
          name: dbCommittee.name || null,
          chamber: dbCommittee.chamber || null,
          
          // Committee type and structure
          type: dbCommittee.committee_type_code || dbCommittee.committee_type || null,
          parent: dbCommittee.parent_committee_code ? {
            systemCode: dbCommittee.parent_committee_code,
            // Include parent name if available
            name: dbCommittee.parent_committee_name || null
          } : null,
          
          // Subcommittees with URLs
          subcommittees: Array.isArray(dbCommittee.subcommittees) ? 
            dbCommittee.subcommittees.map(sub => ({
              systemCode: sub.system_code || sub.committee_code,
              name: sub.name,
              url: this.constructCommitteeURL({
                system_code: sub.system_code || sub.committee_code,
                name: sub.name,
                chamber: sub.chamber || dbCommittee.chamber
              })
            })) : [],
          
          // Committee URL
          url: this.constructCommitteeURL(dbCommittee),
          
          // Update information
          updateDate: dbCommittee.api_update_date ? 
            new Date(dbCommittee.api_update_date).toISOString().split('T')[0] : null
        }
      };


      return formattedResult;
      
    } catch (error) {
      logger.error('Error formatting committee for Congress API', {
        error: error.message,
        systemCode: dbCommittee.system_code || 'unknown',
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Format database committee report record to match Congress API response
   * @param {Object} dbReport - Database committee report record
   * @returns {Object} Congress API formatted committee report response
   */
  static formatCommitteeReport(dbReport) {
    if (!dbReport) {
      return null;
    }

    try {
      return {
        committeeReport: {
          // Core identifiers
          congress: parseInt(dbReport.congress_id) || null,
          number: dbReport.report_number || null,
          type: dbReport.report_type || null,
          
          // Report information
          title: dbReport.title || null,
          
          // Dates
          issuedDate: dbReport.issued_date ? 
            new Date(dbReport.issued_date).toISOString().split('T')[0] : null,
          
          // Committee information
          committees: dbReport.committee_code ? [{
            systemCode: dbReport.committee_code,
            name: dbReport.committee_name || null
          }] : [],
          
          // Associated legislation
          associatedBill: dbReport.bill_congress_id && dbReport.bill_type && dbReport.bill_number ? {
            congress: parseInt(dbReport.bill_congress_id),
            type: dbReport.bill_type.toUpperCase(),
            number: parseInt(dbReport.bill_number),
            url: `/bill/${dbReport.bill_congress_id}/${dbReport.bill_type.toLowerCase()}/${dbReport.bill_number}`
          } : null,
          
          // URLs and references
          url: dbReport.url || null,
          
          // Text information
          text: dbReport.text_url ? {
            url: dbReport.text_url
          } : null,
          
          // Update information
          updateDate: dbReport.updated_at ? 
            new Date(dbReport.updated_at).toISOString().split('T')[0] : null
        }
      };
      
    } catch (error) {
      logger.error('Error formatting committee report for Congress API', {
        error: error.message,
        reportId: dbReport.report_id || 'unknown',
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Format paginated list response to match Congress API pagination format
   * @param {Array} items - Array of formatted items
   * @param {Object} pagination - Pagination information
   * @param {Object} request - Request context
   * @returns {Object} Congress API formatted paginated response
   */
  static formatPaginatedResponse(items, pagination = {}, request = {}) {
    const {
      offset = 0,
      limit = 20,
      total = items.length
    } = pagination;

    console.log('DEBUG formatPaginatedResponse: request =', JSON.stringify(request, null, 2));
    console.log('DEBUG formatPaginatedResponse: entityType =', request.entityType);

    return {
      [this.getItemsKey(request.entityType)]: items,
      pagination: {
        count: items.length,
        next: (offset + limit < total) ? 
          `${request.baseUrl}?offset=${offset + limit}&limit=${limit}` : null,
        previous: (offset > 0) ? 
          `${request.baseUrl}?offset=${Math.max(0, offset - limit)}&limit=${limit}` : null
      },
      request: {
        format: "json",
        ...request
      }
    };
  }

  /**
   * Get the appropriate items key for paginated response
   * @param {string} entityType - Type of entity (bills, members, committees, etc.)
   * @returns {string} Plural items key
   */
  static getItemsKey(entityType) {
    console.log('DEBUG getItemsKey: entityType =', entityType);
    const itemsKeys = {
      bill: 'bills',
      member: 'members', 
      committee: 'committees',
      committeeReport: 'committeeReports',
      action: 'actions',
      cosponsor: 'cosponsors',
      summary: 'summaries',
      title: 'titles'
    };
    
    const key = itemsKeys[entityType] || 'items';
    console.log('DEBUG getItemsKey: returning key =', key);
    return key;
  }

  /**
   * Get source system name from code
   * @param {string} code - Source system code
   * @returns {string} Source system name
   */
  static getSourceSystemName(code) {
    const sourceSystemNames = {
      '1': 'House committee actions',
      '2': 'House floor actions',  
      '3': 'Senate committee actions',
      '4': 'Senate floor actions',
      '9': 'Library of Congress',
      '10': 'Executive branch actions'
    };
    
    return sourceSystemNames[code] || 'Unknown source system';
  }

  /**
   * Add database-specific metadata to response
   * @param {Object} response - Formatted response
   * @param {Object} metadata - Database metadata
   * @returns {Object} Response with metadata
   */
  static addDatabaseMetadata(response, metadata = {}) {
    return {
      ...response,
      _database: {
        source: 'postgresql',
        queryTime: metadata.queryTime || null,
        dataFreshness: metadata.dataFreshness || null,
        cacheStatus: metadata.cacheStatus || null,
        circuitBreakerState: metadata.circuitBreakerState || null,
        ...metadata
      }
    };
  }

  /**
   * Validate formatted response matches Congress API structure
   * @param {Object} response - Formatted response
   * @param {string} entityType - Expected entity type
   * @returns {boolean} True if valid
   */
  static validateResponse(response, entityType) {
    try {
      const requiredKeys = {
        bill: ['bill'],
        member: ['member'],
        members: ['members', 'pagination'],
        committee: ['committee'],
        committees: ['committees', 'pagination'],
        committeeReport: ['committeeReport'],
        actions: ['actions', 'pagination'],
        cosponsors: ['cosponsors', 'pagination']
      };
      
      const required = requiredKeys[entityType];
      if (!required) {
        logger.warn('Unknown entity type for validation', { entityType });
        return true; // Allow unknown types
      }
      
      const hasRequiredKeys = required.every(key => response.hasOwnProperty(key));
      if (!hasRequiredKeys) {
        logger.error('Response missing required keys for Congress API compatibility', {
          entityType,
          required,
          present: Object.keys(response)
        });
        return false;
      }
      
      return true;
      
    } catch (error) {
      logger.error('Error validating response format', {
        error: error.message,
        entityType
      });
      return false;
    }
  }

  /**
   * Format database summaries array to match Congress API summaries response
   * @param {Array} dbSummaries - Database summary records
   * @param {Object} billInfo - Bill context information
   * @returns {Object} Congress API formatted summaries response
   */
  static formatBillSummaries(dbSummaries, billInfo = {}) {
    if (!Array.isArray(dbSummaries)) {
      dbSummaries = [];
    }

    try {
      const formattedSummaries = dbSummaries.map(summary => ({
        versionCode: summary.version_code || null,
        actionDate: summary.action_date ? 
          new Date(summary.action_date).toISOString().split('T')[0] : null,
        text: summary.text || null,
        
        // Additional Congress API fields
        actionDesc: null, // Would need separate mapping
        updateDate: summary.action_date ? 
          new Date(summary.action_date).toISOString().split('T')[0] : null
      }));

      return {
        summaries: formattedSummaries,
        pagination: {
          count: formattedSummaries.length,
          next: null,
          previous: null
        },
        request: {
          congress: billInfo.congress || null,
          billType: billInfo.type || null,
          billNumber: billInfo.number || null,
          format: "json"
        }
      };
      
    } catch (error) {
      logger.error('Error formatting bill summaries for Congress API', {
        error: error.message,
        summariesCount: dbSummaries.length,
        billInfo
      });
      throw error;
    }
  }

  /**
   * Format database titles array to match Congress API titles response
   * @param {Array} dbTitles - Database title records
   * @param {Object} billInfo - Bill context information
   * @returns {Object} Congress API formatted titles response
   */
  static formatBillTitles(dbTitles, billInfo = {}) {
    if (!Array.isArray(dbTitles)) {
      dbTitles = [];
    }

    try {
      const formattedTitles = dbTitles.map(title => ({
        titleType: title.title_type || null,
        title: title.title || null,
        
        // Additional Congress API fields
        chamberCode: null, // Would need separate mapping
        chamberName: null, // Would need separate mapping
        titleTypeCode: null, // Would need separate mapping
        
        // Bill context
        billTextVersionName: title.as_ || null,
        billTextVersionCode: title.as_ || null,
        
        // Portion information
        isForPortion: title.is_for_portion === true || title.is_for_portion === 'true' ? "True" : "False"
      }));

      return {
        titles: formattedTitles,
        pagination: {
          count: formattedTitles.length,
          next: null,
          previous: null
        },
        request: {
          congress: billInfo.congress || null,
          billType: billInfo.type || null,
          billNumber: billInfo.number || null,
          format: "json"
        }
      };
      
    } catch (error) {
      logger.error('Error formatting bill titles for Congress API', {
        error: error.message,
        titlesCount: dbTitles.length,
        billInfo
      });
      throw error;
    }
  }
}

module.exports = { CongressAPIFormatter };