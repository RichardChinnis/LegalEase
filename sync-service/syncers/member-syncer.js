const CongressClient = require('../lib/congress-client');
const DatabaseService = require('../lib/database');
const logger = require('../lib/logger');
const config = require('../config');

class MemberSyncer {
  constructor() {
    this.client = new CongressClient();
    this.db = new DatabaseService();
    this.stats = {
      inserted: 0,
      updated: 0,
      failed: 0,
      errors: []
    };
  }

  // Transform API member data to database format
  transformMemberData(apiData) {
    try {
      const member = apiData.member || apiData;
      
      return {
        bioguide_id: member.bioguideId,
        first_name: member.firstName,
        last_name: member.lastName,
        middle_name: member.middleName || null,
        suffix_name: member.suffixName || null,
        nickname: member.nickname || null,
        direct_order_name: member.directOrderName || null,
        inverted_order_name: member.invertedOrderName || null,
        honorific_name: member.honorificName || null,
        birth_year: member.birthYear ? parseInt(member.birthYear) : null,
        death_year: member.deathYear ? parseInt(member.deathYear) : null,
        current_member: member.currentMember || false,
        depiction_url: member.depiction?.imageUrl || null,
        depiction_attribution: member.depiction?.attribution || null,
        official_url: member.officialWebsiteUrl || null,
        office_address: member.addressInformation?.officeAddress || null,
        phone_number: member.addressInformation?.phoneNumber || null,
        api_update_date: member.updateDate ? new Date(member.updateDate) : new Date()
      };
    } catch (error) {
      logger.error('Failed to transform member data', { 
        error: error.message,
        bioguideId: apiData.bioguideId || 'unknown'
      });
      throw error;
    }
  }

  // Transform address information for member_address table
  transformAddressData(addressInfo, bioguideId) {
    if (!addressInfo || (!addressInfo.city && !addressInfo.district && !addressInfo.zipCode)) {
      return null;
    }
    
    return {
      member_bioguide_id: bioguideId,
      city: addressInfo.city || null,
      district: addressInfo.district || null,
      zip_code: addressInfo.zipCode ? parseInt(addressInfo.zipCode) : null,
      address_type: 'current',
      is_active: true
    };
  }

  // Transform party history for member_party_history table
  transformPartyHistory(partyHistory, bioguideId) {
    if (!Array.isArray(partyHistory) || partyHistory.length === 0) {
      return [];
    }
    
    return partyHistory.map(party => ({
      member_bioguide_id: bioguideId,
      party_abbreviation: party.partyAbbreviation,
      party_name: party.partyName,
      start_year: party.startYear,
      end_year: party.endYear || null
    }));
  }

  // Transform previous names for member_previous_names table
  transformPreviousNames(previousNames, bioguideId) {
    if (!Array.isArray(previousNames) || previousNames.length === 0) {
      return [];
    }
    
    return previousNames
      .map(name => ({
        member_bioguide_id: bioguideId,
        first_name: name.firstName || null,
        last_name: name.lastName || null,
        middle_name: name.middleName || null,
        suffix_name: name.suffixName || null,
        nickname: name.nickname || null,
        direct_order_name: name.directOrderName || null,
        inverted_order_name: name.invertedOrderName || null,
        start_date: name.startDate ? new Date(name.startDate) : null,
        end_date: name.endDate ? new Date(name.endDate) : null,
        name_type: 'legal'
      }))
      // Congress.gov occasionally returns previous-name rows with end_date before
      // start_date (e.g. special-election members' revision artifacts). Such a range
      // is invalid and is rejected by the check_previous_names_dates constraint, which
      // would otherwise fail the entire member sync — so drop these rows instead.
      .filter(row => {
        if (row.start_date && row.end_date && row.end_date < row.start_date) {
          logger.warn('Dropping previous-name row: end_date precedes start_date', {
            bioguideId,
            startDate: row.start_date.toISOString(),
            endDate: row.end_date.toISOString()
          });
          return false;
        }
        return true;
      });
  }

  // Calculate and format legislation statistics
  calculateLegislationStats(member, bioguideId) {
    const currentCongress = this.getCurrentCongress();
    
    return {
      member_bioguide_id: bioguideId,
      congress: currentCongress,
      sponsored_legislation_count: member.sponsoredLegislation?.count || 0,
      cosponsored_legislation_count: member.cosponsoredLegislation?.count || 0,
      sponsored_legislation_url: member.sponsoredLegislation?.url || null,
      cosponsored_legislation_url: member.cosponsoredLegislation?.url || null,
      last_calculated: new Date()
    };
  }

  // Get current congress number
  getCurrentCongress() {
    const currentYear = new Date().getFullYear();
    // Congress numbers: 117th (2021-2022), 118th (2023-2024), 119th (2025-2026)
    return Math.floor((currentYear - 1789) / 2) + 1;
  }

  // Helper function to determine party affiliation for a specific term
  determinePartyForTerm(termData, partyHistory) {
    if (!partyHistory || !Array.isArray(partyHistory) || partyHistory.length === 0) {
      logger.warn('No party history available for member', { 
        bioguideId: termData.member_bioguide_id,
        congress: termData.congress 
      });
      return { party_code: null, party_name: null };
    }
    
    // Ensure we have valid year data
    const termStartYear = parseInt(termData.startYear);
    const termEndYear = termData.endYear ? parseInt(termData.endYear) : new Date().getFullYear();
    
    if (isNaN(termStartYear)) {
      logger.warn('Invalid term start year for member', { 
        bioguideId: termData.member_bioguide_id,
        congress: termData.congress,
        startYear: termData.startYear
      });
      return { party_code: null, party_name: null };
    }
    
    // Sort party history by startYear to ensure proper chronological order
    const sortedPartyHistory = [...partyHistory].sort((a, b) => {
      const yearA = parseInt(a.startYear);
      const yearB = parseInt(b.startYear);
      return yearA - yearB;
    });
    
    // Find the party that was active during this term
    // Look for the most recent party that started before or during the term
    let applicableParty = null;
    
    for (const party of sortedPartyHistory) {
      const partyStartYear = parseInt(party.startYear);
      const partyEndYear = party.endYear ? parseInt(party.endYear) : null;
      
      // Skip parties with invalid start years
      if (isNaN(partyStartYear)) {
        continue;
      }
      
      // Check if party was active during this term
      const partyStartedBeforeTermEnded = partyStartYear <= termEndYear;
      const partyEndedAfterTermStarted = !partyEndYear || partyEndYear >= termStartYear;
      
      if (partyStartedBeforeTermEnded && partyEndedAfterTermStarted) {
        // This party overlaps with the term period
        applicableParty = party;
        // Continue to find the most recent applicable party
      }
    }
    
    if (applicableParty) {
      logger.debug('Found matching party for term', {
        bioguideId: termData.member_bioguide_id,
        congress: termData.congress,
        termStart: termStartYear,
        termEnd: termEndYear,
        partyStart: applicableParty.startYear,
        partyEnd: applicableParty.endYear || 'ongoing',
        party: applicableParty.partyName
      });
      
      return {
        party_code: applicableParty.partyAbbreviation,
        party_name: applicableParty.partyName
      };
    }
    
    // Fallback: use the chronologically first party if no overlap found
    const firstParty = sortedPartyHistory[0];
    logger.warn('Using fallback party for term - no date overlap found', {
      bioguideId: termData.member_bioguide_id,
      congress: termData.congress,
      termStart: termStartYear,
      termEnd: termEndYear,
      availableParties: sortedPartyHistory.map(p => ({
        party: p.partyName,
        start: p.startYear,
        end: p.endYear || 'ongoing'
      })),
      fallbackParty: firstParty.partyName
    });
    
    return {
      party_code: firstParty.partyAbbreviation,
      party_name: firstParty.partyName
    };
  }

  // Transform member term data
  transformTermData(termData, bioguideId, partyHistory = null) {
    try {
      // Map API chamber values to database enum values
      let chamber = null;
      if (termData.chamber) {
        const chamberValue = termData.chamber.toLowerCase();
        if (chamberValue === 'house' || chamberValue === 'house of representatives') {
          chamber = 'House';
        } else if (chamberValue === 'senate') {
          chamber = 'Senate';
        } else if (chamberValue === 'joint') {
          chamber = 'Joint';
        } else {
          chamber = 'NoChamber';
        }
      }
      
      // Determine party affiliation for this term
      const partyInfo = this.determinePartyForTerm(termData, partyHistory);

      return {
        member_bioguide_id: bioguideId,
        congress: termData.congress,
        chamber: chamber,
        member_type: termData.memberType || null,
        start_year: termData.startYear,
        end_year: termData.endYear,
        state_code: termData.stateCode,
        state_name: termData.stateName,
        party_code: partyInfo.party_code,
        party_name: partyInfo.party_name,
        district: termData.district || null
      };
    } catch (error) {
      logger.error('Failed to transform term data', { 
        error: error.message,
        bioguideId: bioguideId
      });
      throw error;
    }
  }

  // Upsert member data
  async upsertMember(memberData) {
    const query = `
      INSERT INTO member (
        bioguide_id, first_name, last_name, middle_name, suffix_name,
        nickname, direct_order_name, inverted_order_name, honorific_name,
        birth_year, death_year, current_member,
        depiction_url, depiction_attribution, official_url,
        office_address, phone_number, api_update_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (bioguide_id) DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        current_member = EXCLUDED.current_member,
        office_address = EXCLUDED.office_address,
        phone_number = EXCLUDED.phone_number,
        api_update_date = EXCLUDED.api_update_date,
        updated_at = CURRENT_TIMESTAMP
      RETURNING bioguide_id, (xmax = 0) AS inserted`;

    return await this.db.query(query, [
      memberData.bioguide_id,
      memberData.first_name,
      memberData.last_name,
      memberData.middle_name,
      memberData.suffix_name,
      memberData.nickname,
      memberData.direct_order_name,
      memberData.inverted_order_name,
      memberData.honorific_name,
      memberData.birth_year,
      memberData.death_year,
      memberData.current_member,
      memberData.depiction_url,
      memberData.depiction_attribution,
      memberData.official_url,
      memberData.office_address,
      memberData.phone_number,
      memberData.api_update_date
    ]);
  }

  // Sync all members (current and historical) - comprehensive approach
  async syncAllMembers() {
    const startTime = Date.now();
    logger.info('Starting comprehensive sync of ALL members (current + historical)');

    try {
      // Reset stats for this comprehensive sync
      this.stats = {
        inserted: 0,
        updated: 0,
        failed: 0,
        errors: []
      };

      // Sync current and historical members in parallel
      const [currentStats, historicalStats] = await Promise.all([
        this.syncMembersByType(true).catch(err => {
          logger.error('Current member sync failed', { error: err.message });
          return { inserted: 0, updated: 0, failed: 0, errors: [err.message] };
        }),
        this.syncMembersByType(false).catch(err => {
          logger.error('Historical member sync failed', { error: err.message });
          return { inserted: 0, updated: 0, failed: 0, errors: [err.message] };
        })
      ]);

      // Combine stats
      const totalStats = {
        inserted: currentStats.inserted + historicalStats.inserted,
        updated: currentStats.updated + historicalStats.updated,
        failed: currentStats.failed + historicalStats.failed,
        errors: [...currentStats.errors, ...historicalStats.errors]
      };

      const duration = Date.now() - startTime;

      // Update sync status on success
      await this.db.updateSyncStatus('members', {
        success: true,
        records_synced: totalStats.inserted + totalStats.updated,
        records_failed: totalStats.failed,
        duration,
        metadata: {
          comprehensive: true,
          currentMembers: currentStats,
          historicalMembers: historicalStats
        }
      });

      logger.info('Comprehensive member sync completed', {
        ...totalStats,
        duration: `${duration}ms`
      });

      return totalStats;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Update sync status on failure
      await this.db.updateSyncStatus('members', {
        success: false,
        records_synced: this.stats.inserted + this.stats.updated,
        records_failed: this.stats.failed,
        duration,
        error: error.message,
        metadata: { comprehensive: true }
      });

      logger.error('Failed to sync all members', {
        error: error.message,
        duration: `${duration}ms`
      });
      throw error;
    }
  }

  // Sync members by type (current or historical)
  async syncMembersByType(isCurrentMember) {
    const memberType = isCurrentMember ? 'current' : 'historical';
    logger.info(`Starting sync of ${memberType} members`);
    
    try {
      // Get all members of this type with pagination
      logger.info(`Fetching all ${memberType} members (may require multiple API calls)...`);
      const members = [];
      let offset = 0;
      let hasMore = true;
      
      while (hasMore) {
        const response = await this.client.getMembers({ 
          currentMember: isCurrentMember,
          limit: 250,
          offset: offset
        });
        
        const batchMembers = response.members || [];
        members.push(...batchMembers);
        
        logger.info(`Fetched ${batchMembers.length} ${memberType} members (total: ${members.length})`);
        
        // Check if we have more pages
        hasMore = batchMembers.length === 250;
        offset += 250;
        
        // Small delay between pagination requests
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      logger.info(`Found ${members.length} ${memberType} members to sync`);
      
      // Process in batches to avoid overwhelming the API
      const batchSize = config.sync.batchSizes.members || 20;
      
      logger.info(`Starting to process ${members.length} ${memberType} members in batches of ${batchSize}`);
      
      const typeStats = { inserted: 0, updated: 0, failed: 0, errors: [] };
      
      for (let i = 0; i < members.length; i += batchSize) {
        const batch = members.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(members.length / batchSize);
        
        logger.info(`Starting ${memberType} batch ${batchNum}/${totalBatches} (members ${i + 1}-${Math.min(i + batchSize, members.length)})`);
        
        await this.processMemberBatchWithStats(batch, typeStats);
        
        logger.info(`Completed ${memberType} batch ${batchNum}/${totalBatches}`);
      }
      
      logger.info(`${memberType} member sync completed`, typeStats);
      
      return typeStats;
    } catch (error) {
      logger.error(`Failed to sync ${memberType} members`, { error: error.message });
      throw error;
    }
  }

  // Process a batch of members with separate stats tracking
  async processMemberBatchWithStats(members, stats) {
    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      try {
        if ((i + 1) % 10 === 0 || i === 0) {  // Log every 10th member + first member
          logger.info(`Syncing member ${i + 1}/${members.length}: ${member.bioguideId}`);
        }
        await this.syncMemberDetails(member.bioguideId);
        if ((i + 1) % 10 === 0 || i === 0) {
          logger.info(`✓ Completed member ${i + 1}/${members.length}: ${member.bioguideId}`);
        }
        
        // Add 1 second delay between member calls (except for the last one)
        if (i < members.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        stats.failed++;
        stats.errors.push({
          bioguideId: member.bioguideId,
          error: error.message
        });
        logger.warn('Failed to sync member', { 
          bioguideId: member.bioguideId,
          error: error.message 
        });
      }
    }
  }

  // Sync all current members (backward compatibility)
  async syncCurrentMembers() {
    logger.info('Starting sync of current Congress members');

    // Reset stats at the start of sync
    this.stats = {
      inserted: 0,
      updated: 0,
      failed: 0,
      errors: []
    };

    try {
      // Get all current members with pagination
      logger.info('Fetching all current members (may require multiple API calls)...');
      const members = [];
      let offset = 0;
      let hasMore = true;
      
      while (hasMore) {
        const response = await this.client.getMembers({ 
          currentMember: true,
          limit: 250,
          offset: offset
        });
        
        const batchMembers = response.members || [];
        members.push(...batchMembers);
        
        logger.info(`Fetched ${batchMembers.length} members (total: ${members.length})`);
        
        // Check if we have more pages
        hasMore = batchMembers.length === 250;
        offset += 250;
        
        // Small delay between pagination requests
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      logger.info(`Found ${members.length} current members to sync`);
      
      // Process in batches to avoid overwhelming the API
      const batchSize = config.sync.batchSizes.members || 20;
      
      logger.info(`Starting to process ${members.length} members in batches of ${batchSize}`);
      
      for (let i = 0; i < members.length; i += batchSize) {
        const batch = members.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(members.length / batchSize);
        
        logger.info(`Starting batch ${batchNum}/${totalBatches} (members ${i + 1}-${Math.min(i + batchSize, members.length)})`);
        
        await this.processMemberBatch(batch);
        
        logger.info(`Completed batch ${batchNum}/${totalBatches}`);
        
        // No additional batch delay needed since we already have 1s delays between individual member calls
      }
      
      logger.info('Current member sync completed', {
        inserted: this.stats.inserted,
        updated: this.stats.updated,
        failed: this.stats.failed
      });
      
      return this.stats;
    } catch (error) {
      logger.error('Failed to sync current members', { error: error.message });
      throw error;
    }
  }

  // Process a batch of members
  async processMemberBatch(members) {
    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      try {
        if ((i + 1) % 10 === 0 || i === 0) {  // Log every 10th member + first member
          logger.info(`Syncing member ${i + 1}/${members.length}: ${member.bioguideId}`);
        }
        await this.syncMemberDetails(member.bioguideId);
        if ((i + 1) % 10 === 0 || i === 0) {
          logger.info(`✓ Completed member ${i + 1}/${members.length}: ${member.bioguideId}`);
        }
        
        // Add 1 second delay between member calls (except for the last one)
        if (i < members.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        this.stats.failed++;
        this.stats.errors.push({
          bioguideId: member.bioguideId,
          error: error.message
        });
        logger.warn('Failed to sync member', { 
          bioguideId: member.bioguideId,
          error: error.message 
        });
      }
    }
  }

  // Sync detailed information for a specific member
  async syncMemberDetails(bioguideId) {
    try {
      // Get detailed member information
      const memberResponse = await this.client.getMemberDetails(bioguideId);
      const member = memberResponse.member;
      
      if (!member) {
        throw new Error(`Member not found: ${bioguideId}`);
      }
      
      // Transform and upsert member data
      const transformedMember = this.transformMemberData(member);
      const result = await this.upsertMember(transformedMember);
      
      if (result.rows[0].inserted) {
        this.stats.inserted++;
        logger.debug('Inserted new member', { bioguideId });
      } else {
        this.stats.updated++;
        logger.debug('Updated existing member', { bioguideId });
      }
      
      // Sync address information if available
      if (member.addressInformation) {
        await this.syncMemberSubEntity(bioguideId, 'address', () => this.syncMemberAddress(bioguideId, member.addressInformation));
      }
      
      // Sync party history if available
      if (member.partyHistory && Array.isArray(member.partyHistory)) {
        await this.syncMemberSubEntity(bioguideId, 'partyHistory', () => this.syncMemberPartyHistory(bioguideId, member.partyHistory));
      }
      
      // Sync previous names if available
      if (member.previousNames && Array.isArray(member.previousNames)) {
        await this.syncMemberSubEntity(bioguideId, 'previousNames', () => this.syncMemberPreviousNames(bioguideId, member.previousNames));
      }
      
      // Sync legislation statistics
      await this.syncMemberSubEntity(bioguideId, 'legislationStats', () => this.syncMemberLegislationStats(bioguideId, member));
      
      // Sync terms of service if available
      if (member.terms && Array.isArray(member.terms)) {
        await this.syncMemberSubEntity(bioguideId, 'terms', () => this.syncMemberTerms(bioguideId, member.terms, member.partyHistory));
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('Failed to sync member details', { 
        bioguideId,
        error: error.message 
      });
      throw error;
    }
  }

  // Run an auxiliary member sub-sync in isolation: its failure is logged and
  // swallowed so one bad sub-record (e.g. malformed source data) can't fail the
  // whole member or block the sub-syncs that follow it. The core member record is
  // upserted outside this helper, so a genuine member failure still propagates.
  async syncMemberSubEntity(bioguideId, label, fn) {
    try {
      await fn();
    } catch (error) {
      logger.warn('Member sub-entity sync failed (continuing)', {
        bioguideId,
        subEntity: label,
        error: error.message
      });
    }
  }

  // Sync member terms of service
  async syncMemberTerms(bioguideId, terms, partyHistory = null) {
    for (const term of terms) {
      try {
        const transformedTerm = this.transformTermData(term, bioguideId, partyHistory);
        await this.upsertMemberTerm(transformedTerm);
        
        logger.debug('Synced member term', {
          bioguideId,
          congress: term.congress,
          chamber: term.chamber,
          party: transformedTerm.party_code
        });
      } catch (error) {
        logger.warn('Failed to sync member term', { 
          bioguideId,
          term: term.congress,
          error: error.message 
        });
      }
    }
  }

  // Upsert member term data
  async upsertMemberTerm(termData) {
    const query = `
      INSERT INTO member_term (
        member_bioguide_id, congress, chamber, member_type,
        start_year, end_year, state_code, state_name,
        party_code, party_name, district
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (member_bioguide_id, congress, chamber) DO UPDATE SET
        end_year = EXCLUDED.end_year,
        party_code = EXCLUDED.party_code,
        party_name = EXCLUDED.party_name
      RETURNING term_id, (xmax = 0) AS inserted`;

    return await this.db.query(query, [
      termData.member_bioguide_id,
      termData.congress,
      termData.chamber,
      termData.member_type,
      termData.start_year,
      termData.end_year,
      termData.state_code,
      termData.state_name,
      termData.party_code,
      termData.party_name,
      termData.district
    ]);
  }

  // Sync members from a specific state (useful for testing)
  async syncMembersByState(stateCode) {
    logger.info(`Starting sync of members from state: ${stateCode}`);

    // Reset stats at the start of sync
    this.stats = {
      inserted: 0,
      updated: 0,
      failed: 0,
      errors: []
    };

    try {
      // Get current members for the state
      const response = await this.client.getMembers({ 
        currentMember: true,
        stateCode: stateCode.toUpperCase()
      });
      
      const members = response.members || [];
      logger.info(`Found ${members.length} members from ${stateCode}`);
      
      for (let i = 0; i < members.length; i++) {
        await this.syncMemberDetails(members[i].bioguideId);
        
        // Add 1 second delay between member calls (except for the last one)
        if (i < members.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      logger.info(`Completed sync for ${stateCode}`, {
        inserted: this.stats.inserted,
        updated: this.stats.updated,
        failed: this.stats.failed
      });
      
      return this.stats;
    } catch (error) {
      logger.error(`Failed to sync members from ${stateCode}`, { error: error.message });
      throw error;
    }
  }

  // Sync member address information
  async syncMemberAddress(bioguideId, addressInfo) {
    const transformedAddress = this.transformAddressData(addressInfo, bioguideId);
    if (!transformedAddress) {
      return;
    }
    
    const query = `
      INSERT INTO member_address (
        member_bioguide_id, city, district, zip_code, address_type, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (member_bioguide_id, address_type)
      WHERE is_active = TRUE
      DO UPDATE SET
        city = EXCLUDED.city,
        district = EXCLUDED.district,
        zip_code = EXCLUDED.zip_code,
        updated_at = CURRENT_TIMESTAMP
      RETURNING address_id`;
    
    await this.db.query(query, [
      transformedAddress.member_bioguide_id,
      transformedAddress.city,
      transformedAddress.district,
      transformedAddress.zip_code,
      transformedAddress.address_type,
      transformedAddress.is_active
    ]);
    
    logger.debug('Synced member address', { bioguideId });
  }

  // Sync member party history
  async syncMemberPartyHistory(bioguideId, partyHistory) {
    const transformedParties = this.transformPartyHistory(partyHistory, bioguideId);
    if (transformedParties.length === 0) {
      return;
    }
    
    // First, clear existing party history for this member
    await this.db.query(
      'DELETE FROM member_party_history WHERE member_bioguide_id = $1',
      [bioguideId]
    );
    
    // Insert new party history records
    for (const party of transformedParties) {
      const query = `
        INSERT INTO member_party_history (
          member_bioguide_id, party_abbreviation, party_name, start_year, end_year
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING party_history_id`;
      
      await this.db.query(query, [
        party.member_bioguide_id,
        party.party_abbreviation,
        party.party_name,
        party.start_year,
        party.end_year
      ]);
    }
    
    logger.debug('Synced member party history', { bioguideId, count: transformedParties.length });
  }

  // Sync member previous names
  async syncMemberPreviousNames(bioguideId, previousNames) {
    const transformedNames = this.transformPreviousNames(previousNames, bioguideId);
    if (transformedNames.length === 0) {
      return;
    }
    
    // Replace the member's previous names atomically: the DELETE and re-INSERTs run
    // in one transaction, so a mid-loop failure can never leave a partial set behind.
    await this.db.transaction(async (client) => {
      await client.query(
        'DELETE FROM member_previous_names WHERE member_bioguide_id = $1',
        [bioguideId]
      );
    
      // Insert new previous names records
      for (const name of transformedNames) {
        const query = `
          INSERT INTO member_previous_names (
            member_bioguide_id, first_name, last_name, middle_name, suffix_name,
            nickname, direct_order_name, inverted_order_name, start_date, end_date, name_type
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING previous_name_id`;
      
        await client.query(query, [
          name.member_bioguide_id,
          name.first_name,
          name.last_name,
          name.middle_name,
          name.suffix_name,
          name.nickname,
          name.direct_order_name,
          name.inverted_order_name,
          name.start_date,
          name.end_date,
          name.name_type
        ]);
      }
    });
    
    logger.debug('Synced member previous names', { bioguideId, count: transformedNames.length });
  }

  // Sync member legislation statistics
  async syncMemberLegislationStats(bioguideId, member) {
    const stats = this.calculateLegislationStats(member, bioguideId);
    
    const query = `
      INSERT INTO member_legislation_stats (
        member_bioguide_id, congress, sponsored_legislation_count, 
        cosponsored_legislation_count, sponsored_legislation_url,
        cosponsored_legislation_url, last_calculated
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (member_bioguide_id, congress)
      DO UPDATE SET
        sponsored_legislation_count = EXCLUDED.sponsored_legislation_count,
        cosponsored_legislation_count = EXCLUDED.cosponsored_legislation_count,
        sponsored_legislation_url = EXCLUDED.sponsored_legislation_url,
        cosponsored_legislation_url = EXCLUDED.cosponsored_legislation_url,
        last_calculated = EXCLUDED.last_calculated,
        updated_at = CURRENT_TIMESTAMP
      RETURNING stats_id`;
    
    await this.db.query(query, [
      stats.member_bioguide_id,
      stats.congress,
      stats.sponsored_legislation_count,
      stats.cosponsored_legislation_count,
      stats.sponsored_legislation_url,
      stats.cosponsored_legislation_url,
      stats.last_calculated
    ]);
    
    logger.debug('Synced member legislation stats', { 
      bioguideId, 
      congress: stats.congress,
      sponsored: stats.sponsored_legislation_count,
      cosponsored: stats.cosponsored_legislation_count
    });
  }

  // Close database connection
  async close() {
    await this.db.close();
  }
}

module.exports = MemberSyncer;