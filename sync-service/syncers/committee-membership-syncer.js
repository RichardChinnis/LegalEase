const https = require('https');
const { XMLParser } = require('fast-xml-parser');
const DatabaseService = require('../lib/database');
const logger = require('../lib/logger');

/**
 * Committee Membership Syncer
 *
 * Fetches committee membership and leadership data from official sources:
 * - House: clerk.house.gov/xml/lists/MemberData.xml
 * - Senate: senate.gov committee membership XML files
 *
 * Populates the member_committee table with current congress membership.
 */
class CommitteeMembershipSyncer {
  constructor() {
    this.db = new DatabaseService();
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_'
    });
    this.stats = {
      house: { inserted: 0, skipped: 0, errors: [] },
      senate: { inserted: 0, skipped: 0, errors: [] },
      deleted: 0
    };
    this.currentCongress = 119; // Will be set dynamically
  }

  /**
   * Fetch XML from a URL
   */
  async fetchXML(url) {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          // Follow redirect
          return this.fetchXML(res.headers.location).then(resolve).catch(reject);
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
          return;
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
        res.on('error', reject);
      }).on('error', reject);
    });
  }

  /**
   * Normalize leadership title to standard format
   */
  normalizeTitle(position) {
    if (!position) return 'Member';

    const normalized = position.toString().trim();

    switch (normalized.toLowerCase()) {
      case 'chair':
      case 'chairman':
      case 'chairwoman':
        return 'Chair';
      case 'vice chair':
      case 'vice chairman':
      case 'vice chairwoman':
        return 'Vice Chair';
      case 'ranking':
      case 'ranking member':
        return 'Ranking Member';
      case 'member':
      default:
        return 'Member';
    }
  }

  /**
   * Convert House committee code to database format
   * House codes: AS00 -> hsas00, AG15 -> hsag15
   */
  houseCodeToSystemCode(code) {
    if (!code) return null;
    // House codes are like "AS00", "JU00" - need to add 'hs' prefix and lowercase
    return 'hs' + code.toLowerCase();
  }

  /**
   * Convert Senate committee code to database format
   * Senate codes: SSJU00 -> ssju00, SSAP00 -> ssap00
   */
  senateCodeToSystemCode(code) {
    if (!code) return null;
    // Senate codes are already prefixed with SS, JS, etc - just lowercase
    return code.toLowerCase();
  }

  /**
   * Fetch and parse House member data
   */
  async fetchHouseData() {
    logger.info('Fetching House committee membership data from clerk.house.gov');

    const url = 'https://clerk.house.gov/xml/lists/MemberData.xml';
    const xml = await this.fetchXML(url);
    const parsed = this.parser.parse(xml);

    const members = parsed.MemberData?.members?.member || [];
    logger.info(`Found ${members.length} House members with committee assignments`);

    return Array.isArray(members) ? members : [members];
  }

  /**
   * Extract committee assignments from a House member
   */
  extractHouseAssignments(member) {
    const assignments = [];
    const bioguideId = member['member-info']?.bioguideID;

    if (!bioguideId) return assignments;

    // Process full committee assignments
    const committees = member['committee-assignments']?.committee;
    if (committees) {
      const committeeList = Array.isArray(committees) ? committees : [committees];
      for (const comm of committeeList) {
        const code = comm['@_comcode'];
        const rank = parseInt(comm['@_rank']) || null;
        const leadership = comm['@_leadership'] || null;

        assignments.push({
          bioguideId,
          systemCode: this.houseCodeToSystemCode(code),
          rank,
          title: this.normalizeTitle(leadership)
        });
      }
    }

    // Process subcommittee assignments
    const subcommittees = member['committee-assignments']?.subcommittee;
    if (subcommittees) {
      const subcommitteeList = Array.isArray(subcommittees) ? subcommittees : [subcommittees];
      for (const sub of subcommitteeList) {
        const code = sub['@_subcomcode'];
        const rank = parseInt(sub['@_rank']) || null;
        const leadership = sub['@_leadership'] || null;

        assignments.push({
          bioguideId,
          systemCode: this.houseCodeToSystemCode(code),
          rank,
          title: this.normalizeTitle(leadership)
        });
      }
    }

    return assignments;
  }

  /**
   * Fetch list of Senate committee codes from member data
   */
  async fetchSenateCommitteeCodes() {
    logger.info('Fetching Senate committee codes from senate.gov');

    const url = 'https://www.senate.gov/legislative/LIS_MEMBER/cvc_member_data.xml';
    const xml = await this.fetchXML(url);
    const parsed = this.parser.parse(xml);

    const senators = parsed.senators?.senator || [];
    const senatorList = Array.isArray(senators) ? senators : [senators];

    // Collect unique committee codes
    const codes = new Set();
    for (const senator of senatorList) {
      const committees = senator.committees?.committee;
      if (committees) {
        const committeeList = Array.isArray(committees) ? committees : [committees];
        for (const comm of committeeList) {
          const code = comm['@_code'];
          if (code) {
            // Extract base committee code (e.g., SSJU from SSJU00)
            const baseCode = code.replace(/\d+$/, '');
            codes.add(baseCode);
          }
        }
      }
    }

    logger.info(`Found ${codes.size} unique Senate committee codes`);
    return Array.from(codes);
  }

  /**
   * Fetch and parse a single Senate committee's membership
   */
  async fetchSenateCommittee(baseCode) {
    const url = `https://www.senate.gov/general/committee_membership/committee_memberships_${baseCode}.xml`;

    try {
      const xml = await this.fetchXML(url);
      const parsed = this.parser.parse(xml);
      return parsed.committee_membership?.committees || null;
    } catch (error) {
      logger.warn(`Failed to fetch Senate committee ${baseCode}: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract Senate assignments from committee data
   * Requires separate lookup for bioguide IDs since Senate XML doesn't include them
   */
  async extractSenateAssignments(committeeData, memberNameToBioguide) {
    const assignments = [];

    if (!committeeData) return assignments;

    // Process main committee members
    const mainCommitteeCode = committeeData.committee_code;
    const members = committeeData.members?.member;

    if (members) {
      const memberList = Array.isArray(members) ? members : [members];
      for (const member of memberList) {
        const firstName = member.name?.first?.toString().trim() || '';
        const lastName = member.name?.last?.toString().trim() || '';
        const fullName = `${firstName} ${lastName}`.trim();
        const position = member.position;

        const bioguideId = memberNameToBioguide.get(fullName) ||
                          memberNameToBioguide.get(lastName);

        if (bioguideId && mainCommitteeCode) {
          assignments.push({
            bioguideId,
            systemCode: this.senateCodeToSystemCode(mainCommitteeCode),
            rank: null, // Senate XML doesn't provide rank
            title: this.normalizeTitle(position)
          });
        }
      }
    }

    // Process subcommittees
    const subcommittees = committeeData.subcommittee;
    if (subcommittees) {
      const subList = Array.isArray(subcommittees) ? subcommittees : [subcommittees];
      for (const sub of subList) {
        const subCode = sub.committee_code;
        const subMembers = sub.members?.member;

        if (subMembers) {
          const subMemberList = Array.isArray(subMembers) ? subMembers : [subMembers];
          for (const member of subMemberList) {
            const firstName = member.name?.first?.toString().trim() || '';
            const lastName = member.name?.last?.toString().trim() || '';
            const fullName = `${firstName} ${lastName}`.trim();
            const position = member.position;

            const bioguideId = memberNameToBioguide.get(fullName) ||
                              memberNameToBioguide.get(lastName);

            if (bioguideId && subCode) {
              assignments.push({
                bioguideId,
                systemCode: this.senateCodeToSystemCode(subCode),
                rank: null,
                title: this.normalizeTitle(position)
              });
            }
          }
        }
      }
    }

    return assignments;
  }

  /**
   * Build a lookup map of senator names to bioguide IDs from our database
   */
  async buildSenatorNameLookup() {
    const query = `
      SELECT m.bioguide_id, m.first_name, m.last_name, m.direct_order_name
      FROM member m
      JOIN member_term mt ON m.bioguide_id = mt.member_bioguide_id
      WHERE mt.chamber = 'Senate' AND mt.congress = $1
    `;

    const result = await this.db.query(query, [this.currentCongress]);
    const lookup = new Map();

    for (const row of result.rows) {
      // Map by full name
      const fullName = `${row.first_name} ${row.last_name}`.trim();
      lookup.set(fullName, row.bioguide_id);

      // Also map by last name for fallback
      lookup.set(row.last_name, row.bioguide_id);

      // Map by direct order name if available
      if (row.direct_order_name) {
        lookup.set(row.direct_order_name, row.bioguide_id);
      }
    }

    logger.info(`Built lookup map for ${lookup.size} senator name variations`);
    return lookup;
  }

  /**
   * Clear existing memberships for current congress
   */
  async clearCurrentCongressMemberships() {
    const result = await this.db.query(
      'DELETE FROM member_committee WHERE congress_id = $1',
      [this.currentCongress]
    );
    this.stats.deleted = result.rowCount;
    logger.info(`Cleared ${result.rowCount} existing memberships for congress ${this.currentCongress}`);
  }

  /**
   * Insert a committee membership record
   */
  async insertMembership(assignment) {
    const query = `
      INSERT INTO member_committee (member_bioguide_id, committee_system_code, congress_id, rank, title)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (member_bioguide_id, committee_system_code, congress_id)
      DO UPDATE SET rank = EXCLUDED.rank, title = EXCLUDED.title
    `;

    await this.db.query(query, [
      assignment.bioguideId,
      assignment.systemCode,
      this.currentCongress,
      assignment.rank,
      assignment.title
    ]);
  }

  /**
   * Check if a member exists in our database
   */
  async memberExists(bioguideId) {
    const result = await this.db.query(
      'SELECT 1 FROM member WHERE bioguide_id = $1',
      [bioguideId]
    );
    return result.rows.length > 0;
  }

  /**
   * Check if a committee exists in our database
   */
  async committeeExists(systemCode) {
    const result = await this.db.query(
      'SELECT 1 FROM committee WHERE system_code = $1',
      [systemCode]
    );
    return result.rows.length > 0;
  }

  /**
   * Process House committee memberships
   */
  async processHouseMemberships() {
    logger.info('Processing House committee memberships');

    const houseMembers = await this.fetchHouseData();

    for (const member of houseMembers) {
      const assignments = this.extractHouseAssignments(member);

      for (const assignment of assignments) {
        try {
          // Validate member exists
          if (!await this.memberExists(assignment.bioguideId)) {
            this.stats.house.skipped++;
            continue;
          }

          // Validate committee exists
          if (!await this.committeeExists(assignment.systemCode)) {
            this.stats.house.skipped++;
            continue;
          }

          await this.insertMembership(assignment);
          this.stats.house.inserted++;

        } catch (error) {
          this.stats.house.errors.push({
            bioguideId: assignment.bioguideId,
            systemCode: assignment.systemCode,
            error: error.message
          });
        }
      }
    }

    logger.info(`House memberships: ${this.stats.house.inserted} inserted, ${this.stats.house.skipped} skipped`);
  }

  /**
   * Process Senate committee memberships
   */
  async processSeneateMemberships() {
    logger.info('Processing Senate committee memberships');

    // Build name-to-bioguide lookup
    const nameLookup = await this.buildSenatorNameLookup();

    // Get list of committee codes to fetch
    const committeeCodes = await this.fetchSenateCommitteeCodes();

    // Fetch and process each committee
    for (const baseCode of committeeCodes) {
      // Add small delay between requests
      await new Promise(resolve => setTimeout(resolve, 200));

      const committeeData = await this.fetchSenateCommittee(baseCode);
      if (!committeeData) continue;

      const assignments = await this.extractSenateAssignments(committeeData, nameLookup);

      for (const assignment of assignments) {
        try {
          // Validate member exists
          if (!await this.memberExists(assignment.bioguideId)) {
            this.stats.senate.skipped++;
            continue;
          }

          // Validate committee exists
          if (!await this.committeeExists(assignment.systemCode)) {
            this.stats.senate.skipped++;
            continue;
          }

          await this.insertMembership(assignment);
          this.stats.senate.inserted++;

        } catch (error) {
          this.stats.senate.errors.push({
            bioguideId: assignment.bioguideId,
            systemCode: assignment.systemCode,
            error: error.message
          });
        }
      }
    }

    logger.info(`Senate memberships: ${this.stats.senate.inserted} inserted, ${this.stats.senate.skipped} skipped`);
  }

  /**
   * Get current congress from database
   */
  async getCurrentCongress() {
    const result = await this.db.query(
      'SELECT congress_id FROM congress ORDER BY congress_id DESC LIMIT 1'
    );
    return result.rows[0]?.congress_id || 119;
  }

  /**
   * Main sync method
   */
  async sync() {
    const startTime = Date.now();
    logger.info('Starting committee membership sync');

    try {
      // Get current congress
      this.currentCongress = await this.getCurrentCongress();
      logger.info(`Syncing committee memberships for congress ${this.currentCongress}`);

      // Clear existing data for current congress (full replace strategy)
      await this.clearCurrentCongressMemberships();

      // Process House memberships
      await this.processHouseMemberships();

      // Process Senate memberships
      await this.processSeneateMemberships();

      const duration = Date.now() - startTime;

      // Update sync status
      await this.db.updateSyncStatus('committee-membership', {
        success: true,
        records_synced: this.stats.house.inserted + this.stats.senate.inserted,
        records_failed: this.stats.house.errors.length + this.stats.senate.errors.length,
        duration,
        metadata: {
          congress: this.currentCongress,
          deleted: this.stats.deleted,
          house: this.stats.house,
          senate: this.stats.senate
        }
      });

      logger.info('Committee membership sync completed', {
        duration: `${duration}ms`,
        congress: this.currentCongress,
        houseInserted: this.stats.house.inserted,
        senateInserted: this.stats.senate.inserted,
        totalSkipped: this.stats.house.skipped + this.stats.senate.skipped
      });

      return this.stats;

    } catch (error) {
      const duration = Date.now() - startTime;

      await this.db.updateSyncStatus('committee-membership', {
        success: false,
        records_synced: this.stats.house.inserted + this.stats.senate.inserted,
        records_failed: this.stats.house.errors.length + this.stats.senate.errors.length,
        duration,
        error: error.message,
        metadata: this.stats
      });

      logger.error('Committee membership sync failed', {
        error: error.message,
        duration: `${duration}ms`
      });

      throw error;
    }
  }

  /**
   * Close database connection
   */
  async close() {
    await this.db.close();
  }
}

module.exports = CommitteeMembershipSyncer;
