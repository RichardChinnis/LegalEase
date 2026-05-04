#!/usr/bin/env node
/**
 * Populate Committee Details from Congress API
 *
 * This script fetches detailed committee information from the Congress API
 * and updates our local database with the additional metadata fields:
 * - website_url
 * - official_name
 * - library_of_congress_name
 * - start_date
 * - establishing_authority
 * - loc_linked_data_id
 * - nara_id
 * - superintendent_document_number
 *
 * Rate limited to 1 request per second to stay under API limits.
 */

// Load API key from backend .env
require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const CONGRESS_API_KEY = process.env.CONGRESS_API_KEY;

// Load admin credentials from .env.admin (has UPDATE permissions)
require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env.admin'), override: true });
const { Pool } = require('pg');
const https = require('https');

// Database connection using admin credentials
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE || 'congress_api',
    user: process.env.DB_USER || 'congress_admin',
    password: process.env.DB_PASSWORD
});
const DELAY_MS = 1000; // 1 second between requests

// Stats tracking
const stats = {
    total: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    noHistory: 0
};

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch committee details from Congress API
 */
function fetchCommitteeFromAPI(chamber, systemCode) {
    return new Promise((resolve, reject) => {
        // Map chamber to API format
        const chamberPath = chamber.toLowerCase();
        const url = `https://api.congress.gov/v3/committee/${chamberPath}/${systemCode}?api_key=${CONGRESS_API_KEY}&format=json`;

        https.get(url, (res) => {
            let data = '';

            res.on('data', chunk => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed);
                    } catch (e) {
                        reject(new Error(`Failed to parse response: ${e.message}`));
                    }
                } else if (res.statusCode === 404) {
                    resolve(null); // Committee not found in API
                } else {
                    reject(new Error(`API returned status ${res.statusCode}`));
                }
            });

            res.on('error', reject);
        }).on('error', reject);
    });
}

/**
 * Update committee in database with new fields
 */
async function updateCommittee(systemCode, data) {
    const query = `
        UPDATE committee SET
            website_url = $1,
            official_name = $2,
            library_of_congress_name = $3,
            start_date = $4,
            establishing_authority = $5,
            loc_linked_data_id = $6,
            nara_id = $7,
            superintendent_document_number = $8,
            updated_at = NOW()
        WHERE system_code = $9
    `;

    const values = [
        data.websiteUrl || null,
        data.officialName || null,
        data.libraryOfCongressName || null,
        data.startDate || null,
        data.establishingAuthority || null,
        data.locLinkedDataId || null,
        data.naraId || null,
        data.superintendentDocumentNumber || null,
        systemCode
    ];

    await pool.query(query, values);
}

/**
 * Process a single committee
 */
async function processCommittee(committee) {
    const { system_code, chamber, name } = committee;

    try {
        // Fetch from Congress API
        const apiData = await fetchCommitteeFromAPI(chamber, system_code);

        if (!apiData || !apiData.committee) {
            console.log(`  [SKIP] ${system_code} - Not found in API`);
            stats.skipped++;
            return;
        }

        const committeeData = apiData.committee;

        // Extract data from API response
        const updateData = {
            websiteUrl: committeeData.committeeWebsiteUrl || null,
            officialName: null,
            libraryOfCongressName: null,
            startDate: null,
            establishingAuthority: null,
            locLinkedDataId: null,
            naraId: null,
            superintendentDocumentNumber: null
        };

        // Extract history data (use most recent/first entry)
        if (committeeData.history && committeeData.history.length > 0) {
            const history = committeeData.history[0];
            updateData.officialName = history.officialName || null;
            updateData.libraryOfCongressName = history.libraryOfCongressName || null;
            updateData.startDate = history.startDate || null;
            updateData.establishingAuthority = history.establishingAuthority || null;
            updateData.locLinkedDataId = history.locLinkedDataId || null;
            updateData.naraId = history.naraId || null;
            updateData.superintendentDocumentNumber = history.superintendentDocumentNumber || null;
        } else {
            stats.noHistory++;
        }

        // Update database
        await updateCommittee(system_code, updateData);

        // Log progress
        const hasWebsite = updateData.websiteUrl ? 'W' : '-';
        const hasHistory = updateData.officialName ? 'H' : '-';
        console.log(`  [OK] ${system_code} [${hasWebsite}${hasHistory}] ${name.substring(0, 50)}`);
        stats.updated++;

    } catch (error) {
        console.error(`  [ERR] ${system_code} - ${error.message}`);
        stats.errors++;
    }
}

/**
 * Main function
 */
async function main() {
    console.log('='.repeat(60));
    console.log('Committee Details Population Script');
    console.log('='.repeat(60));
    console.log('');

    if (!CONGRESS_API_KEY) {
        console.error('ERROR: CONGRESS_API_KEY environment variable not set');
        process.exit(1);
    }

    try {
        // Get all committees from database
        const result = await pool.query(`
            SELECT system_code, chamber, name
            FROM committee
            WHERE chamber IS NOT NULL
            ORDER BY chamber, name
        `);

        const committees = result.rows;
        stats.total = committees.length;

        console.log(`Found ${stats.total} committees to process`);
        console.log(`Estimated time: ${Math.ceil(stats.total / 60)} minutes`);
        console.log('');
        console.log('Legend: [W] = Website URL, [H] = History data');
        console.log('-'.repeat(60));

        let currentChamber = '';

        for (let i = 0; i < committees.length; i++) {
            const committee = committees[i];

            // Print chamber header when it changes
            if (committee.chamber !== currentChamber) {
                currentChamber = committee.chamber;
                console.log('');
                console.log(`--- ${currentChamber} Committees ---`);
            }

            // Process committee
            await processCommittee(committee);

            // Rate limiting - wait 1 second between requests
            if (i < committees.length - 1) {
                await sleep(DELAY_MS);
            }

            // Progress update every 50 committees
            if ((i + 1) % 50 === 0) {
                console.log(`\n>>> Progress: ${i + 1}/${stats.total} (${Math.round((i + 1) / stats.total * 100)}%)\n`);
            }
        }

        // Print summary
        console.log('');
        console.log('='.repeat(60));
        console.log('SUMMARY');
        console.log('='.repeat(60));
        console.log(`Total committees:    ${stats.total}`);
        console.log(`Successfully updated: ${stats.updated}`);
        console.log(`Skipped (not in API): ${stats.skipped}`);
        console.log(`Errors:              ${stats.errors}`);
        console.log(`No history data:     ${stats.noHistory}`);
        console.log('='.repeat(60));

    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run the script
main();
