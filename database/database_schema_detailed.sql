-- PostgreSQL Database Schema for Congress API Data (Comprehensive)
-- Designed by Gemini
-- Version 4.0
-- Date: 2025-08-20

-- This schema is designed to comprehensively store the data available from the
-- Congress.gov API, addressing gaps from the previous version by normalizing JSONB fields
-- and adding tables/columns for previously omitted data points.

-- ---
-- ENUM Types for consistency
-- ---

CREATE TYPE chamber AS ENUM ('House', 'Senate', 'Joint', 'NoChamber');
CREATE TYPE vote_result AS ENUM ('Passed', 'Failed', 'Agreed to', 'Disagreed to');
CREATE TYPE bill_type AS ENUM ('hr', 's', 'hres', 'sres', 'hjres', 'sjres', 'hconres', 'sconres');
CREATE TYPE communication_type_house AS ENUM ('EC', 'PM', 'PT', 'ML');
CREATE TYPE communication_type_senate AS ENUM ('EC', 'POM', 'PM');
CREATE TYPE related_item_type AS ENUM ('bill', 'treaty', 'nomination');

-- ---
-- Core Tables
-- ---

CREATE TABLE congress (
    congress_id INT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    start_year INT,
    end_year INT,
    api_update_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE congress IS 'Stores information about each session of Congress.';

CREATE TABLE congress_session (
    session_id SERIAL PRIMARY KEY,
    congress_id INT NOT NULL REFERENCES congress(congress_id),
    chamber chamber,
    type VARCHAR(1), -- 'R' for Regular, 'S' for Special
    number INT,
    start_date DATE,
    end_date DATE
);
COMMENT ON TABLE congress_session IS 'Stores session-specific data for each Congress.';

CREATE TABLE member (
    bioguide_id VARCHAR(255) PRIMARY KEY,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    middle_name VARCHAR(255),
    suffix_name VARCHAR(255),
    nickname VARCHAR(255),
    direct_order_name VARCHAR(255),
    inverted_order_name VARCHAR(255),
    honorific_name VARCHAR(255),
    birth_year INT,
    death_year INT,
    current_member BOOLEAN,
    depiction_url TEXT,
    depiction_attribution TEXT,
    official_url TEXT,
    office_address TEXT,
    phone_number VARCHAR(255),
    api_update_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE member IS 'Stores detailed information about members of Congress.';

CREATE TABLE member_previous_name (
    previous_name_id SERIAL PRIMARY KEY,
    member_bioguide_id VARCHAR(255) NOT NULL REFERENCES member(bioguide_id),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    middle_name VARCHAR(255),
    suffix_name VARCHAR(255),
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ
);
COMMENT ON TABLE member_previous_name IS 'Stores historical names for a member.';

CREATE TABLE member_leadership (
    leadership_id SERIAL PRIMARY KEY,
    member_bioguide_id VARCHAR(255) NOT NULL REFERENCES member(bioguide_id),
    congress_id INT NOT NULL REFERENCES congress(congress_id),
    type TEXT,
    is_current BOOLEAN
);
COMMENT ON TABLE member_leadership IS 'Stores leadership positions held by members.';

CREATE TABLE member_term (
    term_id SERIAL PRIMARY KEY,
    member_bioguide_id VARCHAR(255) NOT NULL REFERENCES member(bioguide_id),
    congress INT,
    chamber chamber,
    member_type VARCHAR(255),
    start_year INT,
    end_year INT,
    state_code VARCHAR(2),
    state_name VARCHAR(255),
    party_code VARCHAR(10),
    party_name VARCHAR(255),
    district INT
);
COMMENT ON TABLE member_term IS 'Normalized table for member terms of service.';

CREATE TABLE committee (
    system_code VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    chamber chamber,
    committee_type_code VARCHAR(255),
    is_current BOOLEAN,
    parent_committee_code VARCHAR(255) REFERENCES committee(system_code),
    api_update_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE committee IS 'Stores detailed information about congressional committees.';

CREATE TABLE committee_history (
    history_id SERIAL PRIMARY KEY,
    committee_system_code VARCHAR(255) NOT NULL REFERENCES committee(system_code),
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    official_name TEXT,
    library_of_congress_name TEXT,
    committee_type_code VARCHAR(255),
    establishing_authority TEXT,
    loc_linked_data_id VARCHAR(255),
    superintendent_document_number VARCHAR(255),
    nara_id VARCHAR(255)
);
COMMENT ON TABLE committee_history IS 'Normalized table for committee history and name changes.';

CREATE TABLE bill (
    bill_id VARCHAR(255) PRIMARY KEY,
    congress_id INT NOT NULL REFERENCES congress(congress_id),
    bill_type bill_type,
    bill_number VARCHAR(255),
    origin_chamber chamber,
    title TEXT,
    introduced_date DATE,
    latest_action_date DATE,
    latest_action_text TEXT,
    policy_area VARCHAR(255),
    constitutional_authority_statement_text TEXT,
    api_update_date TIMESTAMPTZ,
    api_update_date_including_text TIMESTAMPTZ,
    notes JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE bill IS 'Stores comprehensive information about bills and resolutions.';

CREATE TABLE bill_law (
    law_id SERIAL PRIMARY KEY,
    bill_id VARCHAR(255) NOT NULL REFERENCES bill(bill_id),
    type VARCHAR(255), -- Public Law, Private Law
    number VARCHAR(255)
);
COMMENT ON TABLE bill_law IS 'Stores public/private law information for a bill.';

CREATE TABLE bill_cbo_cost_estimate (
    cbo_id SERIAL PRIMARY KEY,
    bill_id VARCHAR(255) NOT NULL REFERENCES bill(bill_id),
    pub_date TIMESTAMPTZ,
    title TEXT,
    url TEXT,
    description TEXT
);
COMMENT ON TABLE bill_cbo_cost_estimate IS 'Stores CBO cost estimate details for a bill.';

CREATE TABLE bill_summary (
    summary_id SERIAL PRIMARY KEY,
    bill_id VARCHAR(255) NOT NULL REFERENCES bill(bill_id),
    version_code VARCHAR(10),
    action_date DATE,
    action_desc TEXT,
    text TEXT,
    api_update_date TIMESTAMPTZ
);
COMMENT ON TABLE bill_summary IS 'Stores bill summaries.';

CREATE TABLE bill_text_version (
    text_version_id SERIAL PRIMARY KEY,
    bill_id VARCHAR(255) NOT NULL REFERENCES bill(bill_id),
    type TEXT,
    date TIMESTAMPTZ
);
COMMENT ON TABLE bill_text_version IS 'Stores information about different text versions of a bill.';

CREATE TABLE bill_text_version_format (
    format_id SERIAL PRIMARY KEY,
    text_version_id INT NOT NULL REFERENCES bill_text_version(text_version_id),
    url TEXT,
    type TEXT -- Formatted Text, PDF, Formatted XML
);
COMMENT ON TABLE bill_text_version_format IS 'Stores the specific file formats for a bill text version.';

CREATE TABLE bill_title (
    title_id SERIAL PRIMARY KEY,
    bill_id VARCHAR(255) NOT NULL REFERENCES bill(bill_id),
    title_type TEXT,
    title TEXT,
    chamber_code VARCHAR(1),
    chamber_name VARCHAR(255),
    bill_text_version_name TEXT,
    bill_text_version_code VARCHAR(10),
    title_type_code VARCHAR(10)
);
COMMENT ON TABLE bill_title IS 'Stores the various titles associated with a bill.';

CREATE TABLE related_bill (
    relationship_id SERIAL PRIMARY KEY,
    source_bill_id VARCHAR(255) NOT NULL REFERENCES bill(bill_id),
    related_bill_id VARCHAR(255) NOT NULL,
    relationship_type VARCHAR(255),
    identified_by VARCHAR(255)
);
COMMENT ON TABLE related_bill IS 'Junction table for related bills.';

CREATE TABLE committee_report (
    report_id VARCHAR(255) PRIMARY KEY,
    congress_id INT NOT NULL REFERENCES congress(congress_id),
    report_type VARCHAR(255),
    report_number VARCHAR(255),
    citation TEXT,
    part INT,
    is_conference_report BOOLEAN,
    issue_date DATE,
    api_update_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE committee_report IS 'Stores information about committee reports.';

CREATE TABLE committee_report_bill (
    report_id VARCHAR(255) NOT NULL REFERENCES committee_report(report_id),
    bill_id VARCHAR(255) NOT NULL REFERENCES bill(bill_id),
    PRIMARY KEY (report_id, bill_id)
);
COMMENT ON TABLE committee_report_bill IS 'Junction table to link committee reports to bills.';

CREATE TABLE amendment (
    amendment_id VARCHAR(255) PRIMARY KEY,
    congress_id INT NOT NULL REFERENCES congress(congress_id),
    amendment_type VARCHAR(255),
    amendment_number VARCHAR(255),
    chamber chamber,
    purpose TEXT,
    description TEXT,
    proposed_date TIMESTAMPTZ,
    submitted_date TIMESTAMPTZ,
    amended_bill_id VARCHAR(255) REFERENCES bill(bill_id),
    amended_amendment_id VARCHAR(255) REFERENCES amendment(amendment_id),
    amended_treaty_id VARCHAR(255), -- FK added later
    notes JSONB,
    api_update_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE amendment IS 'Stores information about amendments.';

CREATE TABLE amendment_text_version (
    text_version_id SERIAL PRIMARY KEY,
    amendment_id VARCHAR(255) NOT NULL REFERENCES amendment(amendment_id),
    type TEXT,
    date TIMESTAMPTZ
);
COMMENT ON TABLE amendment_text_version IS 'Stores text versions of an amendment.';

CREATE TABLE amendment_text_version_format (
    format_id SERIAL PRIMARY KEY,
    text_version_id INT NOT NULL REFERENCES amendment_text_version(text_version_id),
    url TEXT,
    type TEXT -- PDF, HTML
);
COMMENT ON TABLE amendment_text_version_format IS 'Stores formats for amendment text versions.';

CREATE TABLE amendment_on_behalf_of_sponsor (
    on_behalf_id SERIAL PRIMARY KEY,
    amendment_id VARCHAR(255) NOT NULL REFERENCES amendment(amendment_id),
    member_bioguide_id VARCHAR(255) NOT NULL REFERENCES member(bioguide_id),
    type TEXT -- "Submitted on behalf of", "Proposed on behalf of"
);
COMMENT ON TABLE amendment_on_behalf_of_sponsor IS 'Stores who submitted/proposed an amendment on behalf of the sponsor.';

CREATE TABLE nomination (
    nomination_id VARCHAR(255) PRIMARY KEY,
    congress_id INT NOT NULL REFERENCES congress(congress_id),
    number INT,
    part_number INT,
    citation VARCHAR(255),
    description TEXT,
    organization VARCHAR(255),
    received_date DATE,
    is_privileged BOOLEAN,
    is_list BOOLEAN,
    is_civilian BOOLEAN,
    is_military BOOLEAN,
    executive_calendar_number VARCHAR(255),
    authority_date DATE,
    latest_action_date DATE,
    latest_action_text TEXT,
    api_update_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE nomination IS 'Stores information about presidential nominations.';

CREATE TABLE nominee (
    nominee_id SERIAL PRIMARY KEY,
    nomination_id VARCHAR(255) NOT NULL REFERENCES nomination(nomination_id),
    ordinal INT,
    intro_text TEXT,
    organization TEXT,
    position_title TEXT,
    division TEXT,
    last_name VARCHAR(255),
    first_name VARCHAR(255),
    middle_name VARCHAR(255),
    prefix VARCHAR(255),
    suffix VARCHAR(255),
    state VARCHAR(2),
    effective_date DATE,
    predecessor_name VARCHAR(255),
    corps_code VARCHAR(255)
);
COMMENT ON TABLE nominee IS 'Stores detailed information for each nominee within a nomination.';

CREATE TABLE treaty (
    treaty_id VARCHAR(255) PRIMARY KEY,
    congress_received INT NOT NULL REFERENCES congress(congress_id),
    congress_considered INT,
    number INT,
    suffix VARCHAR(10),
    title TEXT,
    transmitted_date DATE,
    in_force_date DATE,
    topic VARCHAR(255),
    resolution_text TEXT,
    old_number VARCHAR(255),
    old_number_display_name VARCHAR(255),
    api_update_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE treaty IS 'Stores information about treaties submitted to the Senate.';

ALTER TABLE amendment ADD CONSTRAINT fk_amendment_treaty FOREIGN KEY (amended_treaty_id) REFERENCES treaty(treaty_id);

CREATE TABLE treaty_part (
    part_id SERIAL PRIMARY KEY,
    treaty_id VARCHAR(255) NOT NULL REFERENCES treaty(treaty_id),
    part_suffix VARCHAR(10)
);
COMMENT ON TABLE treaty_part IS 'Stores parts of a partitioned treaty.';

CREATE TABLE treaty_country_party (
    country_party_id SERIAL PRIMARY KEY,
    treaty_id VARCHAR(255) NOT NULL REFERENCES treaty(treaty_id),
    name TEXT
);
COMMENT ON TABLE treaty_country_party IS 'Stores countries/parties associated with a treaty.';

CREATE TABLE treaty_index_term (
    index_term_id SERIAL PRIMARY KEY,
    treaty_id VARCHAR(255) NOT NULL REFERENCES treaty(treaty_id),
    name TEXT
);
COMMENT ON TABLE treaty_index_term IS 'Stores index terms for a treaty.';

CREATE TABLE treaty_related_doc (
    related_doc_id SERIAL PRIMARY KEY,
    treaty_id VARCHAR(255) NOT NULL REFERENCES treaty(treaty_id),
    name TEXT,
    url TEXT
);
COMMENT ON TABLE treaty_related_doc IS 'Stores related documents (like executive reports) for a treaty.';

CREATE TABLE action (
    action_id SERIAL PRIMARY KEY,
    bill_id VARCHAR(255) REFERENCES bill(bill_id),
    amendment_id VARCHAR(255) REFERENCES amendment(amendment_id),
    nomination_id VARCHAR(255) REFERENCES nomination(nomination_id),
    treaty_id VARCHAR(255) REFERENCES treaty(treaty_id),
    action_date DATE,
    action_time TIME,
    action_code VARCHAR(255),
    text TEXT,
    type VARCHAR(255),
    source_system_code INT,
    source_system_name VARCHAR(255),
    calendar_number VARCHAR(255),
    calendar_name VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE action IS 'Stores legislative actions.';

CREATE TABLE action_recorded_vote (
    recorded_vote_id SERIAL PRIMARY KEY,
    action_id INT NOT NULL REFERENCES action(action_id),
    roll_number INT,
    url TEXT,
    chamber chamber,
    congress INT,
    date TIMESTAMPTZ,
    session_number INT
);
COMMENT ON TABLE action_recorded_vote IS 'Stores recorded votes associated with an action.';

CREATE TABLE house_roll_call_vote (
    identifier VARCHAR(255) PRIMARY KEY,
    congress_id INT NOT NULL REFERENCES congress(congress_id),
    session_number INT,
    roll_call_number INT,
    start_date TIMESTAMPTZ,
    vote_type VARCHAR(255),
    result VARCHAR(255),
    vote_question TEXT,
    legislation_type VARCHAR(255),
    legislation_number VARCHAR(255),
    amendment_type VARCHAR(255),
    amendment_number VARCHAR(255),
    amendment_author TEXT,
    api_update_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE house_roll_call_vote IS 'Stores detailed information about House roll call votes.';

CREATE TABLE house_roll_call_vote_party_total (
    party_total_id SERIAL PRIMARY KEY,
    vote_identifier VARCHAR(255) NOT NULL REFERENCES house_roll_call_vote(identifier),
    party_type VARCHAR(1), -- R, D, I
    party_name VARCHAR(255),
    yea_total INT,
    nay_total INT,
    present_total INT,
    not_voting_total INT
);
COMMENT ON TABLE house_roll_call_vote_party_total IS 'Stores vote totals by party for a House roll call vote.';

CREATE TABLE house_roll_call_vote_member (
    vote_identifier VARCHAR(255) NOT NULL REFERENCES house_roll_call_vote(identifier),
    member_bioguide_id VARCHAR(255) NOT NULL REFERENCES member(bioguide_id),
    vote_cast VARCHAR(255), -- Aye, Nay, Present, Not Voting
    PRIMARY KEY (vote_identifier, member_bioguide_id)
);
COMMENT ON TABLE house_roll_call_vote_member IS 'Junction table for how each member voted on a specific House roll call vote.';

CREATE TABLE crs_report (
    report_id VARCHAR(255) PRIMARY KEY,
    status VARCHAR(255),
    publish_date TIMESTAMPTZ,
    version INT,
    content_type VARCHAR(255),
    title TEXT,
    summary TEXT,
    api_update_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE crs_report IS 'Stores information about Congressional Research Service (CRS) reports.';

CREATE TABLE hearing (
    jacket_number VARCHAR(255) PRIMARY KEY,
    congress_id INT NOT NULL REFERENCES congress(congress_id),
    chamber chamber,
    number VARCHAR(255),
    part VARCHAR(255),
    title TEXT,
    citation VARCHAR(255),
    library_of_congress_identifier VARCHAR(255),
    api_update_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE hearing IS 'Stores information about committee hearings.';

CREATE TABLE hearing_date (
    hearing_date_id SERIAL PRIMARY KEY,
    hearing_jacket_number VARCHAR(255) NOT NULL REFERENCES hearing(jacket_number),
    date DATE
);
COMMENT ON TABLE hearing_date IS 'Stores the multiple dates a hearing may have occurred.';

CREATE TABLE nomination_hearing (
    nomination_id VARCHAR(255) NOT NULL REFERENCES nomination(nomination_id),
    hearing_jacket_number VARCHAR(255) NOT NULL REFERENCES hearing(jacket_number),
    PRIMARY KEY (nomination_id, hearing_jacket_number)
);
COMMENT ON TABLE nomination_hearing IS 'Junction table to link nominations to their hearings.';

CREATE TABLE committee_print (
    jacket_number VARCHAR(255) PRIMARY KEY,
    congress_id INT NOT NULL REFERENCES congress(congress_id),
    chamber chamber,
    citation VARCHAR(255),
    number VARCHAR(255),
    title TEXT,
    api_update_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE committee_print IS 'Stores information about committee prints.';

CREATE TABLE committee_meeting (
    event_id VARCHAR(255) PRIMARY KEY,
    congress_id INT NOT NULL REFERENCES congress(congress_id),
    chamber chamber,
    type VARCHAR(255),
    title TEXT,
    meeting_status VARCHAR(255),
    meeting_date TIMESTAMPTZ,
    location_room VARCHAR(255),
    location_building VARCHAR(255),
    location_address TEXT,
    hearing_jacket_number VARCHAR(255) REFERENCES hearing(jacket_number),
    api_update_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE committee_meeting IS 'Stores information about committee meetings.';

CREATE TABLE committee_meeting_continuation (
    continuation_id SERIAL PRIMARY KEY,
    event_id VARCHAR(255) NOT NULL REFERENCES committee_meeting(event_id),
    meeting_datetime TIMESTAMPTZ
);
COMMENT ON TABLE committee_meeting_continuation IS 'Stores continuation dates for a committee meeting.';

CREATE TABLE committee_meeting_video (
    video_id SERIAL PRIMARY KEY,
    event_id VARCHAR(255) NOT NULL REFERENCES committee_meeting(event_id),
    name TEXT,
    url TEXT
);
COMMENT ON TABLE committee_meeting_video IS 'Stores video links for a committee meeting.';

CREATE TABLE committee_meeting_witness (
    witness_id SERIAL PRIMARY KEY,
    event_id VARCHAR(255) NOT NULL REFERENCES committee_meeting(event_id),
    name TEXT,
    position TEXT,
    organization TEXT
);
COMMENT ON TABLE committee_meeting_witness IS 'Stores witness information for a committee meeting.';

CREATE TABLE committee_meeting_document (
    document_id SERIAL PRIMARY KEY,
    event_id VARCHAR(255) NOT NULL REFERENCES committee_meeting(event_id),
    witness_id INT REFERENCES committee_meeting_witness(witness_id), -- NULL if it's a general meeting doc
    name TEXT,
    description TEXT,
    document_type TEXT,
    format VARCHAR(255),
    url TEXT
);
COMMENT ON TABLE committee_meeting_document IS 'Stores documents for a meeting, including witness statements.';

CREATE TABLE committee_meeting_related_item (
    related_item_id SERIAL PRIMARY KEY,
    event_id VARCHAR(255) NOT NULL REFERENCES committee_meeting(event_id),
    item_type related_item_type,
    item_id VARCHAR(255) -- e.g., bill_id, treaty_id, nomination_id
);
COMMENT ON TABLE committee_meeting_related_item IS 'Polymorphic association for items related to a committee meeting.';

CREATE TABLE house_communication (
    communication_id VARCHAR(255) PRIMARY KEY,
    congress_id INT NOT NULL REFERENCES congress(congress_id),
    number INT,
    communication_type communication_type_house,
    abstract TEXT,
    congressional_record_date DATE,
    session_number INT,
    is_rulemaking BOOLEAN,
    report_nature TEXT,
    submitting_agency TEXT,
    submitting_official TEXT,
    legal_authority TEXT,
    api_update_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE house_communication IS 'Stores information about communications to the House.';

CREATE TABLE senate_communication (
    communication_id VARCHAR(255) PRIMARY KEY,
    congress_id INT NOT NULL REFERENCES congress(congress_id),
    number INT,
    communication_type communication_type_senate,
    abstract TEXT,
    congressional_record_date DATE,
    api_update_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE senate_communication IS 'Stores information about communications to the Senate.';

CREATE TABLE house_requirement (
    requirement_id INT PRIMARY KEY,
    parent_agency VARCHAR(255),
    submitting_agency VARCHAR(255),
    submitting_official VARCHAR(255),
    frequency TEXT,
    nature TEXT,
    legal_authority TEXT,
    is_active BOOLEAN,
    api_update_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE house_requirement IS 'Stores information about House reporting requirements.';

CREATE TABLE congressional_record (
    record_id VARCHAR(255) PRIMARY KEY,
    record_type VARCHAR(50), -- 'bound' or 'daily'
    date DATE,
    volume_number INT,
    issue_number INT,
    congress_id INT REFERENCES congress(congress_id),
    session_number INT,
    daily_digest JSONB,
    api_update_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE congressional_record IS 'Stores information for both Bound and Daily Congressional Records.';

CREATE TABLE congressional_record_section (
    section_id SERIAL PRIMARY KEY,
    record_id VARCHAR(255) NOT NULL REFERENCES congressional_record(record_id),
    name TEXT,
    start_page VARCHAR(255),
    end_page VARCHAR(255)
);
COMMENT ON TABLE congressional_record_section IS 'Stores sections within a Congressional Record.';

CREATE TABLE congressional_record_article (
    article_id SERIAL PRIMARY KEY,
    section_id INT NOT NULL REFERENCES congressional_record_section(section_id),
    title TEXT,
    start_page VARCHAR(255),
    end_page VARCHAR(255)
);
COMMENT ON TABLE congressional_record_article IS 'Stores articles within a Congressional Record section.';

-- ---
-- Junction Tables
-- ---

CREATE TABLE bill_sponsor (
    bill_id VARCHAR(255) NOT NULL REFERENCES bill(bill_id),
    member_bioguide_id VARCHAR(255) NOT NULL REFERENCES member(bioguide_id),
    sponsorship_date DATE,
    is_by_request BOOLEAN,
    PRIMARY KEY (bill_id) -- A bill has only one sponsor
);

CREATE TABLE bill_cosponsor (
    bill_id VARCHAR(255) NOT NULL REFERENCES bill(bill_id),
    member_bioguide_id VARCHAR(255) NOT NULL REFERENCES member(bioguide_id),
    cosponsorship_date DATE,
    is_original_cosponsor BOOLEAN,
    withdrawn_date DATE,
    PRIMARY KEY (bill_id, member_bioguide_id)
);

CREATE TABLE bill_committee_activity (
    activity_id SERIAL PRIMARY KEY,
    bill_id VARCHAR(255) NOT NULL REFERENCES bill(bill_id),
    committee_system_code VARCHAR(255) NOT NULL REFERENCES committee(system_code),
    activity_name TEXT,
    activity_date TIMESTAMPTZ
);
COMMENT ON TABLE bill_committee_activity IS 'Stores committee activities related to a bill.';

CREATE TABLE member_committee (
    member_bioguide_id VARCHAR(255) NOT NULL REFERENCES member(bioguide_id),
    committee_system_code VARCHAR(255) NOT NULL REFERENCES committee(system_code),
    congress_id INT NOT NULL REFERENCES congress(congress_id),
    rank INT,
    title VARCHAR(255),
    PRIMARY KEY (member_bioguide_id, committee_system_code, congress_id)
);

CREATE TABLE amendment_sponsor (
    amendment_id VARCHAR(255) NOT NULL REFERENCES amendment(amendment_id),
    member_bioguide_id VARCHAR(255) NOT NULL REFERENCES member(bioguide_id),
    sponsorship_date DATE,
    PRIMARY KEY (amendment_id, member_bioguide_id)
);

CREATE TABLE amendment_cosponsor (
    amendment_id VARCHAR(255) NOT NULL REFERENCES amendment(amendment_id),
    member_bioguide_id VARCHAR(255) NOT NULL REFERENCES member(bioguide_id),
    cosponsorship_date DATE,
    is_original_cosponsor BOOLEAN,
    withdrawn_date DATE,
    PRIMARY KEY (amendment_id, member_bioguide_id)
);

CREATE TABLE action_committee (
    action_id INT NOT NULL REFERENCES action(action_id),
    committee_system_code VARCHAR(255) NOT NULL REFERENCES committee(system_code),
    PRIMARY KEY (action_id, committee_system_code)
);
COMMENT ON TABLE action_committee IS 'Junction table for committees associated with a legislative action.';

-- ---
-- Indexes for Performance
-- ---

CREATE INDEX idx_bill_congress_id ON bill(congress_id);
CREATE INDEX idx_amendment_congress_id ON amendment(congress_id);
CREATE INDEX idx_action_bill_id ON action(bill_id);
CREATE INDEX idx_action_amendment_id ON action(amendment_id);
CREATE INDEX idx_committee_report_congress_id ON committee_report(congress_id);
CREATE INDEX idx_member_term_member_id ON member_term(member_bioguide_id);
CREATE INDEX idx_committee_history_committee_code ON committee_history(committee_system_code);
CREATE INDEX idx_nomination_congress_id ON nomination(congress_id);
CREATE INDEX idx_treaty_congress_received ON treaty(congress_received);
CREATE INDEX idx_house_roll_call_vote_congress_id ON house_roll_call_vote(congress_id);
CREATE INDEX idx_hearing_congress_id ON hearing(congress_id);
CREATE INDEX idx_committee_print_congress_id ON committee_print(congress_id);
CREATE INDEX idx_committee_meeting_congress_id ON committee_meeting(congress_id);
CREATE INDEX idx_house_communication_congress_id ON house_communication(congress_id);
CREATE INDEX idx_senate_communication_congress_id ON senate_communication(congress_id);
CREATE INDEX idx_bill_committee_activity_bill_id ON bill_committee_activity(bill_id);
CREATE INDEX idx_bill_committee_activity_committee_code ON bill_committee_activity(committee_system_code);
CREATE INDEX idx_committee_meeting_related_item_event_id ON committee_meeting_related_item(event_id);

-- ---
-- Triggers for automatically updating the updated_at timestamp
-- ---

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to all tables with an updated_at column
DO $$
DECLARE
    t_name TEXT;
BEGIN
    FOR t_name IN (SELECT table_name FROM information_schema.columns WHERE column_name = 'updated_at' AND table_schema = 'public')
    LOOP
        EXECUTE format('CREATE TRIGGER update_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();', t_name, t_name);
    END LOOP;
END;
$$;
