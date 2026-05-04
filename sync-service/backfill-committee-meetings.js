#!/usr/bin/env node
/**
 * Backfill Committee Meetings for 119th Congress
 *
 * This script syncs ALL committee meetings from the Congress.gov API.
 * It's throttled to respect API rate limits.
 *
 * Usage: node backfill-committee-meetings.js
 */

require('dotenv').config({ path: '.env' });

const CongressClient = require('./lib/congress-client');
const DatabaseService = require('./lib/database');
const logger = require('./lib/logger');

class CommitteeMeetingBackfill {
  constructor() {
    this.client = new CongressClient();
    this.db = new DatabaseService();
    this.stats = {
      inserted: 0,
      updated: 0,
      failed: 0,
      billsLinked: 0,
      totalProcessed: 0
    };
  }

  /**
   * Fetch meeting details with retry logic
   */
  async fetchMeetingDetails(congress, chamber, eventId) {
    try {
      const endpoint = `/committee-meeting/${congress}/${chamber.toLowerCase()}/${eventId}`;
      const response = await this.client.makeRequest(endpoint);
      return response?.committeeMeeting || null;
    } catch (error) {
      logger.error('Failed to fetch meeting', { eventId, error: error.message });
      return null;
    }
  }

  /**
   * Process related bills for a meeting
   */
  async processRelatedBills(meetingId, bills) {
    if (!bills || !Array.isArray(bills) || bills.length === 0) return;

    for (const bill of bills) {
      try {
        const congress = bill.congress;
        const billType = bill.type?.toLowerCase() || '';
        const billNumber = bill.number?.toString() || '';

        if (!congress || !billType || !billNumber) continue;

        await this.db.query(`
          INSERT INTO committee_meeting_bill (
            meeting_id, congress, bill_type, bill_number, bill_api_url
          )
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT ON CONSTRAINT uq_committee_meeting_bill_association
          DO UPDATE SET bill_api_url = EXCLUDED.bill_api_url, updated_at = NOW()
        `, [meetingId, congress, billType.toUpperCase(), billNumber, bill.url || null]);

        this.stats.billsLinked++;
      } catch (error) {
        // Ignore duplicate errors
      }
    }
  }

  /**
   * Process committees for a meeting
   */
  async processCommittees(meetingId, committees) {
    if (!committees || !Array.isArray(committees)) return;

    for (const committee of committees) {
      if (!committee.name) continue;

      try {
        await this.db.query(`
          INSERT INTO committee_meeting_committee (
            meeting_id, committee_name, committee_system_code, committee_api_url
          )
          VALUES ($1, $2, $3, $4)
          ON CONFLICT ON CONSTRAINT uq_committee_meeting_committee_association
          DO UPDATE SET committee_name = EXCLUDED.committee_name, updated_at = NOW()
        `, [meetingId, committee.name, committee.systemCode || null, committee.url || null]);
      } catch (error) {
        // Ignore errors
      }
    }
  }

  /**
   * Process videos for a meeting
   */
  async processVideos(meetingId, videos) {
    if (!videos || !Array.isArray(videos)) return;

    for (const video of videos) {
      if (!video.url) continue;

      try {
        await this.db.query(`
          INSERT INTO committee_meeting_video (meeting_id, video_name, video_url)
          VALUES ($1, $2, $3)
          ON CONFLICT ON CONSTRAINT uq_committee_meeting_video_url
          DO UPDATE SET video_name = EXCLUDED.video_name, updated_at = NOW()
        `, [meetingId, video.name || null, video.url]);
      } catch (error) {
        // Ignore errors
      }
    }
  }

  /**
   * Upsert a single meeting
   */
  async upsertMeeting(meeting) {
    try {
      const result = await this.db.query(`
        INSERT INTO committee_meeting (
          event_id, congress_id, chamber, title, meeting_date,
          meeting_type, meeting_status, location_building, location_room,
          api_update_date, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        ON CONFLICT ON CONSTRAINT uq_committee_meeting_event
        DO UPDATE SET
          title = EXCLUDED.title,
          meeting_date = EXCLUDED.meeting_date,
          meeting_type = EXCLUDED.meeting_type,
          meeting_status = EXCLUDED.meeting_status,
          location_building = EXCLUDED.location_building,
          location_room = EXCLUDED.location_room,
          api_update_date = EXCLUDED.api_update_date,
          updated_at = NOW()
        RETURNING meeting_id,
          CASE WHEN created_at = updated_at THEN 'INSERT' ELSE 'UPDATE' END as operation
      `, [
        meeting.eventId,
        meeting.congress,
        meeting.chamber,
        meeting.title || null,
        meeting.date || null,
        meeting.type || null,
        meeting.meetingStatus || null,
        meeting.location?.building || null,
        meeting.location?.room || null,
        meeting.updateDate || null
      ]);

      const meetingId = result.rows[0]?.meeting_id;
      const operation = result.rows[0]?.operation;

      if (operation === 'INSERT') {
        this.stats.inserted++;
      } else {
        this.stats.updated++;
      }

      // Process related data
      await this.processRelatedBills(meetingId, meeting.relatedItems?.bills);
      await this.processCommittees(meetingId, meeting.committees);
      await this.processVideos(meetingId, meeting.videos);

      return true;
    } catch (error) {
      logger.error('Failed to upsert meeting', { eventId: meeting.eventId, error: error.message });
      this.stats.failed++;
      return false;
    }
  }

  /**
   * Sync all meetings for a chamber
   */
  async syncChamber(congress, chamber) {
    console.log(`\n📋 Syncing ${chamber} meetings for Congress ${congress}...`);

    let offset = 0;
    const pageSize = 250;
    let totalAvailable = 0;
    let chamberProcessed = 0;

    while (true) {
      // Fetch list of meetings
      const endpoint = `/committee-meeting/${congress}/${chamber.toLowerCase()}`;
      const response = await this.client.makeRequest(endpoint, { offset, limit: pageSize });

      const meetings = response?.committeeMeetings || [];
      totalAvailable = response?.pagination?.count || 0;

      if (meetings.length === 0) break;

      console.log(`  Fetching details for ${meetings.length} meetings (${offset + 1}-${offset + meetings.length} of ${totalAvailable})...`);

      // Process each meeting
      for (const item of meetings) {
        const details = await this.fetchMeetingDetails(congress, chamber, item.eventId);

        if (details) {
          await this.upsertMeeting(details);
          chamberProcessed++;
          this.stats.totalProcessed++;

          // Progress indicator every 50 meetings
          if (chamberProcessed % 50 === 0) {
            console.log(`    ✓ ${chamberProcessed} meetings processed, ${this.stats.billsLinked} bills linked`);
          }
        }

        // Small delay between individual requests (built into CongressClient, but extra safety)
        await this.sleep(100);
      }

      offset += meetings.length;

      // If we got fewer than requested, we're done
      if (meetings.length < pageSize) break;

      // Delay between pages
      await this.sleep(500);
    }

    console.log(`  ✅ ${chamber}: ${chamberProcessed} meetings processed`);
    return chamberProcessed;
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Run the backfill
   */
  async run() {
    const congress = 119;

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  Committee Meeting Backfill - 119th Congress');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Started: ${new Date().toISOString()}`);

    try {
      // Sync both chambers
      await this.syncChamber(congress, 'Senate');
      await this.syncChamber(congress, 'House');

      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('  BACKFILL COMPLETE');
      console.log('═══════════════════════════════════════════════════════════');
      console.log(`  Total meetings processed: ${this.stats.totalProcessed}`);
      console.log(`  Inserted: ${this.stats.inserted}`);
      console.log(`  Updated: ${this.stats.updated}`);
      console.log(`  Failed: ${this.stats.failed}`);
      console.log(`  Bills linked: ${this.stats.billsLinked}`);
      console.log(`Finished: ${new Date().toISOString()}`);

    } catch (error) {
      console.error('\n❌ Backfill failed:', error.message);
      logger.error('Backfill failed', { error: error.message, stack: error.stack });
    } finally {
      await this.db.close();
    }
  }
}

// Run the backfill
const backfill = new CommitteeMeetingBackfill();
backfill.run();
