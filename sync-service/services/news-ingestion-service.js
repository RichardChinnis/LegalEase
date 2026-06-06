/**
 * News Ingestion Service
 *
 * Fetches news from RSS feeds, extracts bill mentions and trending topics,
 * and matches them against bills in the database to suggest spotlight candidates.
 *
 * Features:
 * - Multi-source RSS feed ingestion (Politico, The Hill, Roll Call, Google News, etc.)
 * - Bill mention extraction (H.R., S., H.J.Res, S.J.Res patterns)
 * - Keyword extraction and frequency analysis
 * - Topic-to-bill matching using bill titles, policy areas, and subjects
 * - Spotlight candidate scoring and suggestion
 */

const Parser = require('rss-parser');
const { Pool } = require('pg');

class NewsIngestionService {
  constructor(config = {}) {
    this.pool = config.pool || new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_DATABASE || 'congress_api',
      user: process.env.DB_USER || 'congress_admin',
      password: process.env.DB_PASSWORD
    });

    // If managePool is false, the caller is responsible for closing the pool
    this.managePool = config.managePool !== false;

    this.parser = new Parser({
      timeout: 30000,
      headers: {
        'User-Agent': 'CongressTracker/1.0 (Congressional News Aggregator)'
      }
    });

    // RSS feed sources - static feeds
    this.feedSources = [
      // Congressional-focused outlets
      { name: 'Politico Congress', url: 'https://www.politico.com/rss/congress.xml', weight: 1.5 },
      { name: 'The Hill', url: 'https://thehill.com/feed/', weight: 1.3 },
      { name: 'Roll Call', url: 'https://www.rollcall.com/feed/', weight: 1.5 },

      // Major news - Politics
      { name: 'NPR Politics', url: 'https://feeds.npr.org/1014/rss.xml', weight: 1.2 },
      { name: 'Reuters Politics', url: 'https://www.reuters.com/arc/outboundfeeds/v3/all/section/politics/?outputType=xml&size=50', weight: 1.2 },
      { name: 'AP Politics', url: 'https://rsshub.app/apnews/topics/politics', weight: 1.2 },

      // Google News - Congressional searches
      { name: 'Google News - Congress', url: 'https://news.google.com/rss/search?q=congress+legislation&hl=en-US&gl=US&ceid=US:en', weight: 1.0 },
      { name: 'Google News - Senate', url: 'https://news.google.com/rss/search?q=senate+bill+passed&hl=en-US&gl=US&ceid=US:en', weight: 1.0 },
      { name: 'Google News - House', url: 'https://news.google.com/rss/search?q=house+representatives+bill&hl=en-US&gl=US&ceid=US:en', weight: 1.0 },

      // Google News - Top US News (to catch trending stories that may relate to legislation)
      { name: 'Google News - US Headlines', url: 'https://news.google.com/rss/headlines/section/topic/NATION?hl=en-US&gl=US&ceid=US:en', weight: 1.0 },
      { name: 'Google News - Politics', url: 'https://news.google.com/rss/headlines/section/topic/POLITICS?hl=en-US&gl=US&ceid=US:en', weight: 1.0 },
      { name: 'Google News - Top Stories', url: 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en', weight: 0.8 },

      // Additional general news sources
      { name: 'BBC US', url: 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml', weight: 1.0 },
      { name: 'CNN Politics', url: 'http://rss.cnn.com/rss/cnn_allpolitics.rss', weight: 1.0 },
      { name: 'NBC News', url: 'https://feeds.nbcnews.com/nbcnews/public/news', weight: 0.9 },
      { name: 'CBS News', url: 'https://www.cbsnews.com/latest/rss/main', weight: 0.9 },
      { name: 'ABC News', url: 'https://abcnews.go.com/abcnews/topstories', weight: 0.9 },
    ];

    // Dynamic search terms - proper nouns and topics from bill titles that should be searched
    // These get turned into Google News searches to find related coverage
    // This list captures newsworthy names/topics that may not appear in general congressional RSS feeds
    this.dynamicSearchTerms = [
      // High-profile people/cases in legislation
      'epstein', 'jeffrey epstein', 'laken riley', 'ashli babbitt',
      // Major policy areas frequently in news
      'fentanyl', 'tiktok ban', 'deepfake',
      'student loan forgiveness', 'border security', 'border wall',
      'ukraine aid', 'israel gaza', 'taiwan',
      'abortion rights', 'roe wade',
      'marijuana legalization', 'cannabis',
      // Economic hot topics
      'tariff', 'inflation', 'social security cuts',
      // Tech/AI topics
      'artificial intelligence regulation', 'data privacy',
      // Other high-profile topics
      'january 6', 'election integrity', 'voting rights',
      'gun control', 'assault weapons'
    ];

    // Bill pattern matchers
    this.billPatterns = [
      // H.R. 1234, HR 1234, HR1234
      { regex: /\b(?:H\.?\s*R\.?|HR)\s*(\d{1,5})\b/gi, type: 'hr' },
      // S. 1234, S 1234, S1234
      { regex: /\bS\.?\s*(\d{1,5})\b/gi, type: 's' },
      // H.J.Res. 88, HJRes 88
      { regex: /\b(?:H\.?\s*J\.?\s*Res\.?|HJRes)\s*(\d{1,4})\b/gi, type: 'hjres' },
      // S.J.Res. 18, SJRes 18
      { regex: /\b(?:S\.?\s*J\.?\s*Res\.?|SJRes)\s*(\d{1,4})\b/gi, type: 'sjres' },
      // H.Con.Res. 10
      { regex: /\b(?:H\.?\s*Con\.?\s*Res\.?|HConRes)\s*(\d{1,4})\b/gi, type: 'hconres' },
      // S.Con.Res. 10
      { regex: /\b(?:S\.?\s*Con\.?\s*Res\.?|SConRes)\s*(\d{1,4})\b/gi, type: 'sconres' },
      // H.Res. 100
      { regex: /\b(?:H\.?\s*Res\.?|HRes)\s*(\d{1,4})\b/gi, type: 'hres' },
      // S.Res. 100
      { regex: /\b(?:S\.?\s*Res\.?|SRes)\s*(\d{1,4})\b/gi, type: 'sres' },
    ];

    // Stop words to exclude from keyword extraction
    this.stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
      'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had',
      'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must',
      'shall', 'can', 'need', 'dare', 'ought', 'used', 'it', 'its', 'this', 'that',
      'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they', 'what', 'which', 'who',
      'whom', 'whose', 'where', 'when', 'why', 'how', 'all', 'each', 'every', 'both',
      'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
      'same', 'so', 'than', 'too', 'very', 'just', 'also', 'now', 'new', 'said', 'says',
      'say', 'like', 'get', 'got', 'go', 'going', 'come', 'came', 'make', 'made', 'take',
      'took', 'know', 'think', 'see', 'look', 'want', 'give', 'use', 'find', 'tell',
      'ask', 'work', 'seem', 'feel', 'try', 'leave', 'call', 'keep', 'let', 'begin',
      'show', 'hear', 'play', 'run', 'move', 'live', 'believe', 'hold', 'bring', 'happen',
      'write', 'provide', 'sit', 'stand', 'lose', 'pay', 'meet', 'include', 'continue',
      'set', 'learn', 'change', 'lead', 'understand', 'watch', 'follow', 'stop', 'create',
      'speak', 'read', 'allow', 'add', 'spend', 'grow', 'open', 'walk', 'win', 'offer',
      'remember', 'love', 'consider', 'appear', 'buy', 'wait', 'serve', 'die', 'send',
      'expect', 'build', 'stay', 'fall', 'cut', 'reach', 'kill', 'remain', 'about',
      'after', 'again', 'against', 'ago', 'ahead', 'along', 'already', 'always', 'among',
      'any', 'anyone', 'anything', 'around', 'away', 'back', 'because', 'before', 'being',
      'between', 'bill', 'bills', 'congress', 'congressional', 'senate', 'house', 'rep',
      'senator', 'representative', 'legislation', 'law', 'laws', 'act', 'resolution',
      'vote', 'voted', 'votes', 'voting', 'passed', 'pass', 'passes', 'passing',
      'president', 'biden', 'trump', 'white', 'washington', 'capitol', 'hill',
      'democrat', 'democrats', 'democratic', 'republican', 'republicans', 'gop',
      'party', 'parties', 'member', 'members', 'lawmakers', 'lawmaker', 'politician',
      'politicians', 'official', 'officials', 'government', 'federal', 'state', 'states',
      'national', 'american', 'americans', 'america', 'united', 'u.s', 'us', 'usa',
      'year', 'years', 'month', 'months', 'week', 'weeks', 'day', 'days', 'today',
      'yesterday', 'tomorrow', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
      'saturday', 'sunday', 'january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december', 'time', 'first',
      'last', 'next', 'million', 'billion', 'trillion', 'percent', 'number', 'part',
      'group', 'company', 'companies', 'people', 'person', 'way', 'thing', 'things',
      'right', 'rights', 'still', 'even', 'well', 'back', 'through', 'during', 'under',
      'over', 'into', 'while', 'down', 'up', 'out', 'off', 'then', 'once', 'here',
      // News source names that appear frequently but aren't topics
      'times', 'post', 'news', 'journal', 'tribune', 'herald', 'gazette', 'examiner',
      'reuters', 'associated', 'press', 'cnn', 'bbc', 'nbc', 'cbs', 'abc', 'fox',
      'politico', 'axios', 'bloomberg', 'wsj', 'nyt', 'wapo',
      // URL/domain fragments that slip through
      'gov', 'com', 'org', 'net', 'edu', 'http', 'https', 'www',
      // Common non-topical words that appear frequently
      'center', 'york', 'city', 'county', 'office', 'service', 'department',
      // Words that are too generic and match unrelated bills
      'security', 'social', 'court', 'ban', 'reform', 'protection', 'act',
      'there', 'however', 'although', 'though', 'whether', 'either', 'neither', 'much',
      'many', 'long', 'little', 'big', 'small', 'large', 'high', 'low', 'old', 'young',
      'good', 'bad', 'best', 'worst', 'better', 'worse', 'public', 'according', 'report',
      'reports', 'reported', 'news', 'story', 'stories', 'article', 'source', 'sources'
    ]);

    // High-value topic categories for congressional relevance
    this.topicCategories = {
      'healthcare': ['health', 'healthcare', 'medical', 'medicare', 'medicaid', 'insurance', 'hospital', 'drug', 'pharmaceutical', 'prescription', 'doctor', 'patient', 'disease', 'vaccine', 'pandemic', 'covid', 'mental', 'opioid', 'fentanyl', 'addiction'],
      'economy': ['economy', 'economic', 'inflation', 'recession', 'unemployment', 'jobs', 'wages', 'salary', 'income', 'tax', 'taxes', 'taxation', 'budget', 'deficit', 'debt', 'spending', 'stimulus', 'relief', 'tariff', 'trade', 'import', 'export'],
      'environment': ['climate', 'environmental', 'pollution', 'emissions', 'carbon', 'renewable', 'solar', 'wind', 'fossil', 'fuel', 'oil', 'gas', 'coal', 'nuclear', 'energy', 'conservation', 'wildlife', 'endangered', 'water', 'air', 'epa'],
      'immigration': ['immigration', 'immigrant', 'border', 'asylum', 'refugee', 'visa', 'citizenship', 'deportation', 'daca', 'dreamer', 'ice', 'customs', 'undocumented', 'migration'],
      'defense': ['military', 'defense', 'army', 'navy', 'marines', 'air force', 'pentagon', 'veteran', 'veterans', 'war', 'weapons', 'missile', 'nuclear', 'nato', 'troops', 'soldier', 'deployment', 'security'],
      'technology': ['technology', 'tech', 'ai', 'artificial intelligence', 'cyber', 'cybersecurity', 'data', 'privacy', 'internet', 'social media', 'facebook', 'google', 'apple', 'amazon', 'microsoft', 'tiktok', 'algorithm', 'digital', 'broadband', 'telecommunications'],
      'education': ['education', 'school', 'schools', 'student', 'students', 'college', 'university', 'teacher', 'teachers', 'tuition', 'loan', 'loans', 'scholarship', 'curriculum', 'academic'],
      'justice': ['justice', 'crime', 'criminal', 'police', 'policing', 'prison', 'incarceration', 'sentencing', 'court', 'judge', 'prosecution', 'defendant', 'victim', 'violence', 'gun', 'firearm', 'weapons', 'shooting', 'murder', 'assault'],
      'housing': ['housing', 'home', 'homes', 'rent', 'rental', 'mortgage', 'affordable', 'homelessness', 'homeless', 'shelter', 'eviction', 'landlord', 'tenant', 'apartment', 'property'],
      'agriculture': ['agriculture', 'farm', 'farming', 'farmer', 'crop', 'livestock', 'food', 'usda', 'rural', 'subsidy', 'grain', 'dairy', 'meat', 'poultry'],
      'infrastructure': ['infrastructure', 'road', 'highway', 'bridge', 'transit', 'transportation', 'rail', 'railroad', 'airport', 'port', 'construction', 'rebuild', 'repair'],
      'social_security': ['social security', 'retirement', 'pension', 'elderly', 'senior', 'seniors', 'aging', 'disability', 'disabled', 'benefits', 'entitlement'],
      'foreign_affairs': ['foreign', 'international', 'diplomacy', 'diplomat', 'embassy', 'treaty', 'sanctions', 'china', 'russia', 'ukraine', 'israel', 'gaza', 'iran', 'korea', 'allies', 'alliance']
    };
  }

  // ============================================
  // RSS FEED FETCHING
  // ============================================

  /**
   * Fetch all configured RSS feeds including dynamic search term feeds
   * @returns {Promise<Array>} Array of news items with source metadata
   */
  async fetchAllFeeds() {
    console.log('[NewsIngestion] Fetching all RSS feeds...');
    const allItems = [];
    const errors = [];

    // Fetch static feeds
    for (const source of this.feedSources) {
      try {
        const items = await this.fetchFeed(source);
        allItems.push(...items);
        console.log(`[NewsIngestion] Fetched ${items.length} items from ${source.name}`);
      } catch (error) {
        console.error(`[NewsIngestion] Error fetching ${source.name}:`, error.message);
        errors.push({ source: source.name, error: error.message });
      }
    }

    // Fetch dynamic search term feeds (Google News searches for specific terms)
    console.log(`[NewsIngestion] Fetching ${this.dynamicSearchTerms.length} dynamic search feeds...`);
    for (const term of this.dynamicSearchTerms) {
      try {
        const items = await this.fetchDynamicSearchFeed(term);
        allItems.push(...items);
        console.log(`[NewsIngestion] Fetched ${items.length} items for search term: "${term}"`);
      } catch (error) {
        console.error(`[NewsIngestion] Error fetching search term "${term}":`, error.message);
        errors.push({ source: `Google News Search: ${term}`, error: error.message });
      }
    }

    console.log(`[NewsIngestion] Total items fetched: ${allItems.length} (${errors.length} feed errors)`);
    return { items: allItems, errors };
  }

  /**
   * Fetch a Google News search feed for a specific term
   * @param {string} term - Search term to query
   * @returns {Promise<Array>} News items matching the search term
   */
  async fetchDynamicSearchFeed(term) {
    // URL encode the search term
    const encodedTerm = encodeURIComponent(term);
    const url = `https://news.google.com/rss/search?q=${encodedTerm}&hl=en-US&gl=US&ceid=US:en`;

    const source = {
      name: `Google News: ${term}`,
      url: url,
      weight: 1.5 // Higher weight for targeted searches - these are terms we know are bill-related
    };

    return await this.fetchFeed(source);
  }

  /**
   * Fetch a single RSS feed
   * @param {Object} source - Feed source configuration
   * @returns {Promise<Array>} News items
   */
  async fetchFeed(source) {
    const feed = await this.parser.parseURL(source.url);

    return feed.items.map(item => ({
      title: item.title || '',
      link: item.link || '',
      description: item.contentSnippet || item.content || item.description || '',
      pubDate: item.pubDate ? new Date(item.pubDate) : new Date(),
      source: source.name,
      sourceWeight: source.weight,
      guid: item.guid || item.link || item.title
    }));
  }

  // ============================================
  // BILL MENTION EXTRACTION
  // ============================================

  /**
   * Extract bill mentions from news items
   * @param {Array} newsItems - Array of news items
   * @returns {Array} Bill mentions with context
   */
  extractBillMentions(newsItems) {
    const mentions = [];

    for (const item of newsItems) {
      const text = `${item.title} ${item.description}`;

      for (const pattern of this.billPatterns) {
        let match;
        // Reset lastIndex for global regex
        pattern.regex.lastIndex = 0;

        while ((match = pattern.regex.exec(text)) !== null) {
          const billNumber = match[1];
          const billType = pattern.type.toUpperCase();

          mentions.push({
            billType,
            billNumber: parseInt(billNumber),
            fullMatch: match[0],
            newsItem: item,
            context: this.extractContext(text, match.index, 100)
          });
        }
      }
    }

    // Deduplicate and count mentions
    const billCounts = new Map();
    for (const mention of mentions) {
      const key = `${mention.billType}-${mention.billNumber}`;
      if (!billCounts.has(key)) {
        billCounts.set(key, {
          billType: mention.billType,
          billNumber: mention.billNumber,
          mentions: [],
          totalWeight: 0
        });
      }
      const entry = billCounts.get(key);
      entry.mentions.push(mention);
      entry.totalWeight += mention.newsItem.sourceWeight;
    }

    return Array.from(billCounts.values())
      .sort((a, b) => b.totalWeight - a.totalWeight);
  }

  /**
   * Extract surrounding context for a match
   */
  extractContext(text, index, radius) {
    const start = Math.max(0, index - radius);
    const end = Math.min(text.length, index + radius);
    let context = text.substring(start, end);

    if (start > 0) context = '...' + context;
    if (end < text.length) context = context + '...';

    return context.replace(/\s+/g, ' ').trim();
  }

  // ============================================
  // KEYWORD EXTRACTION
  // ============================================

  /**
   * Extract and analyze keywords from news items
   * @param {Array} newsItems - Array of news items
   * @returns {Object} Keyword analysis results
   */
  extractKeywords(newsItems) {
    const wordFrequency = new Map();
    const phraseFrequency = new Map();

    for (const item of newsItems) {
      const text = `${item.title} ${item.description}`.toLowerCase();

      // Extract single words
      const words = text.match(/\b[a-z]{3,}\b/g) || [];
      for (const word of words) {
        if (!this.stopWords.has(word)) {
          const current = wordFrequency.get(word) || { count: 0, weight: 0, sources: new Set() };
          current.count++;
          current.weight += item.sourceWeight;
          current.sources.add(item.source);
          wordFrequency.set(word, current);
        }
      }

      // Extract 2-word phrases
      const phrases = this.extractPhrases(text, 2);
      for (const phrase of phrases) {
        const current = phraseFrequency.get(phrase) || { count: 0, weight: 0, sources: new Set() };
        current.count++;
        current.weight += item.sourceWeight;
        current.sources.add(item.source);
        phraseFrequency.set(phrase, current);
      }
    }

    // Convert to sorted arrays
    const topWords = Array.from(wordFrequency.entries())
      .map(([word, data]) => ({
        term: word,
        count: data.count,
        weight: data.weight,
        sourceCount: data.sources.size,
        sources: Array.from(data.sources)
      }))
      .filter(w => w.count >= 2) // Minimum threshold
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 100);

    const topPhrases = Array.from(phraseFrequency.entries())
      .map(([phrase, data]) => ({
        term: phrase,
        count: data.count,
        weight: data.weight,
        sourceCount: data.sources.size,
        sources: Array.from(data.sources)
      }))
      .filter(p => p.count >= 2)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 50);

    // Categorize keywords by topic
    const topicScores = this.categorizeKeywords(topWords, topPhrases);

    return {
      topWords,
      topPhrases,
      topicScores,
      totalItems: newsItems.length
    };
  }

  /**
   * Extract n-word phrases from text
   */
  extractPhrases(text, n) {
    const words = text.match(/\b[a-z]{3,}\b/g) || [];
    const phrases = [];

    for (let i = 0; i <= words.length - n; i++) {
      const phraseWords = words.slice(i, i + n);
      // Skip if any word is a stop word
      if (phraseWords.some(w => this.stopWords.has(w))) continue;
      phrases.push(phraseWords.join(' '));
    }

    return phrases;
  }

  /**
   * Categorize extracted keywords into topic areas
   */
  categorizeKeywords(words, phrases) {
    const topicScores = {};

    for (const [category, categoryTerms] of Object.entries(this.topicCategories)) {
      let score = 0;
      const matchedTerms = [];

      // Check words
      for (const word of words) {
        if (categoryTerms.includes(word.term)) {
          score += word.weight;
          matchedTerms.push(word.term);
        }
      }

      // Check phrases
      for (const phrase of phrases) {
        for (const categoryTerm of categoryTerms) {
          if (phrase.term.includes(categoryTerm)) {
            score += phrase.weight;
            matchedTerms.push(phrase.term);
            break;
          }
        }
      }

      if (score > 0) {
        topicScores[category] = {
          score,
          matchedTerms: [...new Set(matchedTerms)]
        };
      }
    }

    // Sort by score
    return Object.entries(topicScores)
      .sort((a, b) => b[1].score - a[1].score)
      .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
  }

  // ============================================
  // BILL MATCHING
  // ============================================

  /**
   * Find bills that match trending topics
   * @param {Object} keywordAnalysis - Results from extractKeywords
   * @param {number} limit - Max bills to return
   * @returns {Promise<Array>} Matching bills with relevance scores
   */
  async findMatchingBills(keywordAnalysis, limit = 20) {
    const { topWords, topPhrases, topicScores } = keywordAnalysis;

    // Get top keywords - include both multi-source terms AND high-weight single-source terms
    // This ensures trending topics like "Epstein" get captured even if only in general news feeds
    const multiSourceTerms = topWords.filter(w => w.sourceCount >= 2).slice(0, 20).map(w => w.term);
    const highWeightTerms = topWords.filter(w => w.weight >= 10 && w.count >= 5).slice(0, 30).map(w => w.term);
    const phraseTerms = topPhrases.filter(p => p.count >= 2).slice(0, 15).map(p => p.term);

    // Combine and deduplicate
    const searchTerms = [...new Set([...multiSourceTerms, ...highWeightTerms, ...phraseTerms])];

    if (searchTerms.length === 0) {
      console.log('[NewsIngestion] No significant search terms found');
      return [];
    }

    console.log(`[NewsIngestion] Searching bills with ${searchTerms.length} terms:`, searchTerms.slice(0, 10));

    // Build search query for bills
    // Search in title, policy_area, and subjects
    const searchPattern = searchTerms.join('|');

    const query = `
      WITH keyword_matches AS (
        SELECT
          b.bill_id,
          b.bill_type,
          b.bill_number,
          b.congress_id,
          b.title,
          b.policy_area,
          b.introduced_date,
          b.latest_action_date,
          b.latest_action_text,
          -- Count matching terms in title
          (
            SELECT COUNT(*)
            FROM unnest($1::text[]) AS term
            WHERE b.title ILIKE '%' || term || '%'
          ) as title_matches,
          -- Count matching terms in policy area
          (
            SELECT COUNT(*)
            FROM unnest($1::text[]) AS term
            WHERE b.policy_area ILIKE '%' || term || '%'
          ) as policy_matches,
          -- Check subjects
          (
            SELECT COUNT(*)
            FROM bill_subject bs
            WHERE bs.bill_id = b.bill_id
            AND EXISTS (
              SELECT 1 FROM unnest($1::text[]) AS term
              WHERE bs.subject_name ILIKE '%' || term || '%'
            )
          ) as subject_matches
        FROM bill b
        WHERE b.congress_id >= 118  -- Recent congresses
        AND (
          -- Must match something
          b.title ~* $2
          OR b.policy_area ~* $2
          OR EXISTS (
            SELECT 1 FROM bill_subject bs
            WHERE bs.bill_id = b.bill_id
            AND bs.subject_name ~* $2
          )
        )
      )
      SELECT
        *,
        (title_matches * 3 + policy_matches * 2 + subject_matches * 1) as relevance_score
      FROM keyword_matches
      WHERE (title_matches + policy_matches + subject_matches) > 0
      ORDER BY relevance_score DESC, latest_action_date DESC NULLS LAST
      LIMIT $3
    `;

    try {
      const result = await this.pool.query(query, [searchTerms, searchPattern, limit]);

      return result.rows.map(row => ({
        billId: row.bill_id,
        billType: row.bill_type,
        billNumber: row.bill_number,
        congress: row.congress_id,
        title: row.title,
        policyArea: row.policy_area,
        introducedDate: row.introduced_date,
        latestActionDate: row.latest_action_date,
        latestActionText: row.latest_action_text,
        relevanceScore: parseInt(row.relevance_score),
        matchDetails: {
          titleMatches: parseInt(row.title_matches),
          policyMatches: parseInt(row.policy_matches),
          subjectMatches: parseInt(row.subject_matches)
        }
      }));
    } catch (error) {
      console.error('[NewsIngestion] Error finding matching bills:', error);
      throw error;
    }
  }

  /**
   * Lookup bills by explicit mentions (bill numbers found in news)
   * @param {Array} billMentions - Results from extractBillMentions
   * @returns {Promise<Array>} Bills found in database with mention counts
   */
  async lookupMentionedBills(billMentions) {
    if (billMentions.length === 0) return [];

    // Get current congress
    const congressResult = await this.pool.query(
      'SELECT MAX(congress_id) as current FROM bill'
    );
    const currentCongress = congressResult.rows[0]?.current || 119;

    const results = [];

    for (const mention of billMentions.slice(0, 50)) { // Limit to top 50
      const query = `
        SELECT
          b.bill_id,
          b.bill_type,
          b.bill_number,
          b.congress_id,
          b.title,
          b.policy_area,
          b.introduced_date,
          b.latest_action_date,
          b.latest_action_text,
          bse.content as one_liner
        FROM bill b
        LEFT JOIN bill_summary_enhanced bse ON b.bill_id = bse.bill_id AND bse.summary_type = 'one_liner'
        WHERE UPPER(b.bill_type::text) = $1
          AND b.bill_number = $2
          AND b.congress_id IN ($3, $4)  -- Current and previous congress
        ORDER BY b.congress_id DESC
        LIMIT 1
      `;

      try {
        const result = await this.pool.query(query, [
          mention.billType,
          mention.billNumber,
          currentCongress,
          currentCongress - 1
        ]);

        if (result.rows.length > 0) {
          results.push({
            ...result.rows[0],
            mentionCount: mention.mentions.length,
            totalWeight: mention.totalWeight,
            newsItems: mention.mentions.map(m => ({
              title: m.newsItem.title,
              source: m.newsItem.source,
              link: m.newsItem.link,
              guid: m.newsItem.guid,
              context: m.context
            }))
          });
        }
      } catch (error) {
        console.error(`[NewsIngestion] Error looking up ${mention.billType} ${mention.billNumber}:`, error.message);
      }
    }

    return results.sort((a, b) => b.totalWeight - a.totalWeight);
  }

  // ============================================
  // HIGH-FREQUENCY KEYWORD BILL MATCHING
  // ============================================

  /**
   * Find bills that directly match high-frequency trending keywords
   * This catches cases like "Epstein" where the keyword appears frequently in news
   * and there are bills with that exact name in the title
   * @param {Array} topWords - Top keywords from news analysis
   * @returns {Promise<Array>} Bills matching high-frequency keywords with scores
   */
  async findBillsForTrendingKeywords(topWords) {
    // Get keywords with high frequency/weight (appearing many times in news)
    // Focus on keywords that are likely proper nouns or specific topics
    const highFrequencyKeywords = topWords
      .filter(w => w.count >= 50 || w.weight >= 50) // High threshold for relevance
      .filter(w => w.term.length >= 4) // Skip short words
      .filter(w => !this.stopWords.has(w.term))
      .slice(0, 30);

    if (highFrequencyKeywords.length === 0) {
      return [];
    }

    console.log('[NewsIngestion] High-frequency keywords for bill search:',
      highFrequencyKeywords.slice(0, 10).map(k => `${k.term}(${k.count})`));

    const billMatches = [];

    // Search for each high-frequency keyword in bill titles
    for (const keyword of highFrequencyKeywords) {
      const query = `
        SELECT bill_id, bill_type, bill_number, congress_id, title,
               policy_area, latest_action_date, latest_action_text
        FROM bill
        WHERE congress_id >= 118
          AND title ILIKE $1
        ORDER BY congress_id DESC, latest_action_date DESC NULLS LAST
        LIMIT 10
      `;

      try {
        const result = await this.pool.query(query, [`%${keyword.term}%`]);

        for (const bill of result.rows) {
          // Calculate score based on keyword frequency and weight
          // Higher weight = more news coverage = more relevance
          const score = keyword.count * 2 + keyword.weight;

          billMatches.push({
            ...bill,
            keywordMatchScore: score,
            matchedKeyword: keyword.term,
            keywordCount: keyword.count,
            keywordWeight: keyword.weight
          });
        }
      } catch (error) {
        console.error(`[NewsIngestion] Error searching for keyword "${keyword.term}":`, error.message);
      }
    }

    // Deduplicate by bill_id, keeping highest score
    const billMap = new Map();
    for (const bill of billMatches) {
      if (!billMap.has(bill.bill_id) || billMap.get(bill.bill_id).keywordMatchScore < bill.keywordMatchScore) {
        billMap.set(bill.bill_id, bill);
      }
    }

    const results = Array.from(billMap.values())
      .sort((a, b) => b.keywordMatchScore - a.keywordMatchScore);

    console.log(`[NewsIngestion] Found ${results.length} bills matching high-frequency keywords`);
    if (results.length > 0) {
      console.log('[NewsIngestion] Top keyword-matched bills:',
        results.slice(0, 5).map(b => `${b.bill_type} ${b.bill_number}: ${b.matchedKeyword}(${b.keywordCount})`));
    }

    return results;
  }

  // ============================================
  // REVERSE LOOKUP: BILLS → NEWS
  // ============================================

  /**
   * Find bills with newsworthy names/topics and check if they have news coverage
   * This is a reverse lookup: instead of news→bills, we do bills→news
   * Catches cases like "Epstein" where the name appears in news but isn't a top keyword
   * @param {Array} newsItems - Fetched news items
   * @returns {Promise<Array>} Bills with news coverage
   */
  async findBillsWithNewsCoverage(newsItems) {
    // Get potentially newsworthy bills from current congress
    // Include all bills with distinctive names (proper nouns) regardless of action date
    const query = `
      SELECT bill_id, bill_type, bill_number, congress_id, title,
             policy_area, latest_action_date, latest_action_text
      FROM bill
      WHERE congress_id >= 119
        AND (
          -- Bills with proper nouns/names in title (likely newsworthy)
          title ~* '(Act|Resolution|Initiative)$'
          OR title ~* '[A-Z][a-z]+\\s+(Act|Bill|Resolution)'
        )
      ORDER BY latest_action_date DESC NULLS LAST
      LIMIT 500
    `;

    // Common words to exclude from matching (would match everything)
    const excludeWords = new Set([
      'act', 'bill', 'resolution', 'house', 'senate', 'congress', 'committee',
      'federal', 'national', 'united', 'states', 'america', 'american', 'government',
      'public', 'president', 'secretary', 'department', 'agency', 'office', 'administration',
      'provide', 'providing', 'require', 'requiring', 'establish', 'establishing',
      'direct', 'directing', 'authorize', 'authorizing', 'amend', 'amending',
      'year', 'fiscal', 'appropriations', 'funding', 'budget', 'program',
      'other', 'purposes', 'certain', 'various', 'related', 'regarding',
      'reform', 'protection', 'improvement', 'enhancement', 'modernization',
      'that', 'this', 'which', 'what', 'where', 'when', 'from', 'with', 'into'
    ]);

    try {
      const result = await this.pool.query(query);
      const bills = result.rows;

      // Create searchable text from all news items
      const newsText = newsItems.map(item =>
        `${item.title} ${item.description}`.toLowerCase()
      ).join(' ');

      // Check each bill for news coverage
      const billsWithCoverage = [];

      for (const bill of bills) {
        // Extract DISTINCTIVE terms from bill title (proper nouns, unique words)
        // Focus on capitalized words that are likely names/topics
        const words = bill.title.split(/\s+/);

        // Get proper nouns (capitalized words not at sentence start, not common words)
        const properNouns = words
          .filter((word, idx) => {
            if (idx === 0) return false; // Skip first word
            if (!/^[A-Z][a-z]+$/.test(word)) return false; // Must be capitalized
            if (excludeWords.has(word.toLowerCase())) return false;
            return word.length >= 4;
          })
          .map(word => word.toLowerCase());

        // Get other distinctive words (not common governmental terms)
        const distinctiveWords = words
          .filter(word => {
            const lower = word.toLowerCase().replace(/[^a-z]/g, '');
            if (lower.length < 5) return false;
            if (excludeWords.has(lower)) return false;
            return true;
          })
          .map(word => word.toLowerCase().replace(/[^a-z]/g, ''))
          .slice(0, 3);

        // Combine and deduplicate
        const searchTerms = [...new Set([...properNouns, ...distinctiveWords])];

        // Search for these terms in news
        let matchCount = 0;
        let matchedTerms = [];

        for (const term of searchTerms) {
          if (term.length >= 4 && !excludeWords.has(term)) {
            const regex = new RegExp(`\\b${term}\\b`, 'gi');
            const matches = newsText.match(regex);
            if (matches && matches.length >= 2) { // At least 2 mentions
              matchCount += matches.length;
              matchedTerms.push(`${term}(${matches.length})`);
            }
          }
        }

        if (matchCount >= 3 && matchedTerms.length >= 1) { // At least 3 matches of at least 1 distinctive term
          billsWithCoverage.push({
            ...bill,
            newsCoverageScore: matchCount,
            matchedTerms
          });
        }
      }

      // Sort by coverage score
      billsWithCoverage.sort((a, b) => b.newsCoverageScore - a.newsCoverageScore);

      console.log(`[NewsIngestion] Found ${billsWithCoverage.length} bills with news coverage via reverse lookup`);
      if (billsWithCoverage.length > 0) {
        console.log('[NewsIngestion] Top bills with news coverage:',
          billsWithCoverage.slice(0, 5).map(b => `${b.bill_type} ${b.bill_number}: ${b.matchedTerms.join(', ')}`));
      }

      return billsWithCoverage.slice(0, 20);

    } catch (error) {
      console.error('[NewsIngestion] Error in reverse bill lookup:', error.message);
      return [];
    }
  }

  // ============================================
  // SPOTLIGHT SUGGESTIONS
  // ============================================

  /**
   * Generate spotlight bill suggestions based on news analysis
   * @returns {Promise<Object>} Spotlight suggestions with reasoning
   */
  async generateSpotlightSuggestions() {
    console.log('[NewsIngestion] Starting news analysis for spotlight suggestions...');

    // Fetch all feeds
    const { items: newsItems, errors: feedErrors } = await this.fetchAllFeeds();

    if (newsItems.length === 0) {
      return {
        success: false,
        error: 'No news items fetched',
        feedErrors
      };
    }

    // Persist raw fetched items to news_item (bulk upsert). Capture the
    // guid -> item_id map so bill<->news links can be resolved below.
    // Wrapped so persistence failures never break spotlight generation.
    let guidToItemId = new Map();
    try {
      guidToItemId = await this.storeNewsItems(newsItems);
    } catch (error) {
      console.error('[NewsIngestion] storeNewsItems failed (non-fatal):', error.message);
    }

    // Extract bill mentions
    const billMentions = this.extractBillMentions(newsItems);
    console.log(`[NewsIngestion] Found ${billMentions.length} unique bill mentions`);

    // Extract keywords and topics
    const keywordAnalysis = this.extractKeywords(newsItems);
    console.log(`[NewsIngestion] Top trending topics:`, Object.keys(keywordAnalysis.topicScores).slice(0, 5));

    // Lookup mentioned bills in database
    const mentionedBills = await this.lookupMentionedBills(billMentions);
    console.log(`[NewsIngestion] Found ${mentionedBills.length} mentioned bills in database`);

    // Persist bill <-> news links using the matches just computed.
    // Wrapped so persistence failures never break spotlight generation.
    try {
      await this.storeBillNewsMentions(mentionedBills, guidToItemId);
    } catch (error) {
      console.error('[NewsIngestion] storeBillNewsMentions failed (non-fatal):', error.message);
    }

    // Find topically relevant bills (news → bills)
    const topicalBills = await this.findMatchingBills(keywordAnalysis);
    console.log(`[NewsIngestion] Found ${topicalBills.length} topically relevant bills`);

    // HIGH-FREQUENCY KEYWORD MATCHING: Find bills matching trending keywords like "Epstein"
    const keywordMatchedBills = await this.findBillsForTrendingKeywords(keywordAnalysis.topWords);

    // REVERSE LOOKUP: Find bills with news coverage (bills → news)
    const billsWithCoverage = await this.findBillsWithNewsCoverage(newsItems);

    // Combine and score suggestions
    const suggestions = this.rankSpotlightCandidates(
      mentionedBills,
      topicalBills,
      keywordAnalysis,
      billsWithCoverage,
      keywordMatchedBills
    );

    // Refresh the trending_topic table from the keyword data already computed.
    // Wrapped so persistence failures never break spotlight generation.
    try {
      await this.updateTrendingTopics(keywordAnalysis.topWords, keywordAnalysis.topicScores);
    } catch (error) {
      console.error('[NewsIngestion] updateTrendingTopics failed (non-fatal):', error.message);
    }

    return {
      success: true,
      timestamp: new Date().toISOString(),
      newsItemsAnalyzed: newsItems.length,
      feedErrors,
      trendingTopics: keywordAnalysis.topicScores,
      topKeywords: keywordAnalysis.topWords.slice(0, 20),
      directMentions: mentionedBills,
      topicalMatches: topicalBills,
      spotlightSuggestions: suggestions
    };
  }

  /**
   * Rank and combine spotlight candidates
   */
  rankSpotlightCandidates(mentionedBills, topicalBills, keywordAnalysis, billsWithCoverage = [], keywordMatchedBills = []) {
    const candidates = new Map();

    // Add mentioned bills (highest weight)
    for (const bill of mentionedBills) {
      candidates.set(bill.bill_id, {
        ...bill,
        score: bill.totalWeight * 10, // Heavy weight for direct mentions
        reason: 'Direct bill mention in news',
        category: 'breaking'
      });
    }

    // Add HIGH-FREQUENCY KEYWORD matched bills (VERY HIGH weight)
    // These are bills whose titles match trending keywords like "Epstein"
    for (const bill of keywordMatchedBills) {
      if (candidates.has(bill.bill_id)) {
        // Bill already in list - boost score significantly
        const existing = candidates.get(bill.bill_id);
        existing.score += bill.keywordMatchScore * 5;
        existing.reason += ` + High-frequency keyword "${bill.matchedKeyword}"`;
        existing.matchedKeyword = bill.matchedKeyword;
        existing.keywordCount = bill.keywordCount;
      } else {
        candidates.set(bill.bill_id, {
          bill_id: bill.bill_id,
          bill_type: bill.bill_type,
          bill_number: bill.bill_number,
          congress_id: bill.congress_id,
          title: bill.title,
          policy_area: bill.policy_area,
          latest_action_date: bill.latest_action_date,
          latest_action_text: bill.latest_action_text,
          score: bill.keywordMatchScore * 5, // High multiplier for keyword matches
          reason: `Matches trending keyword "${bill.matchedKeyword}" (${bill.keywordCount} news mentions)`,
          category: 'trending',
          matchedKeyword: bill.matchedKeyword,
          keywordCount: bill.keywordCount
        });
      }
    }

    // Add topical bills
    for (const bill of topicalBills) {
      if (candidates.has(bill.billId)) {
        // Bill already mentioned - boost score
        const existing = candidates.get(bill.billId);
        existing.score += bill.relevanceScore * 2;
        existing.reason += ' + Topic relevance';
      } else {
        candidates.set(bill.billId, {
          bill_id: bill.billId,
          bill_type: bill.billType,
          bill_number: bill.billNumber,
          congress_id: bill.congress,
          title: bill.title,
          policy_area: bill.policyArea,
          latest_action_date: bill.latestActionDate,
          latest_action_text: bill.latestActionText,
          score: bill.relevanceScore,
          reason: 'Matches trending news topics',
          category: 'trending',
          matchDetails: bill.matchDetails
        });
      }
    }

    // Add bills found via reverse lookup (bills with news coverage)
    // Lower weight than keyword matches to prevent generic words from dominating
    for (const bill of billsWithCoverage) {
      if (candidates.has(bill.bill_id)) {
        // Bill already in list - modest boost
        const existing = candidates.get(bill.bill_id);
        existing.score += bill.newsCoverageScore; // Reduced multiplier from *3 to *1
        existing.reason += ' + News coverage';
        existing.matchedTerms = bill.matchedTerms;
      } else {
        candidates.set(bill.bill_id, {
          bill_id: bill.bill_id,
          bill_type: bill.bill_type,
          bill_number: bill.bill_number,
          congress_id: bill.congress_id,
          title: bill.title,
          policy_area: bill.policy_area,
          latest_action_date: bill.latest_action_date,
          latest_action_text: bill.latest_action_text,
          score: bill.newsCoverageScore, // Reduced multiplier
          reason: 'Bill name/topic in current news',
          category: 'trending',
          matchedTerms: bill.matchedTerms
        });
      }
    }

    // Ensure topic diversity in returned candidates
    // First, group by keyword/topic
    const allCandidates = Array.from(candidates.values());
    const byKeyword = new Map();

    for (const candidate of allCandidates) {
      const keyword = candidate.matchedKeyword || candidate.category || 'other';
      if (!byKeyword.has(keyword)) {
        byKeyword.set(keyword, []);
      }
      byKeyword.get(keyword).push(candidate);
    }

    // Sort each group by score
    for (const [keyword, bills] of byKeyword) {
      bills.sort((a, b) => b.score - a.score);
    }

    // Sort keywords by their top bill's score
    const sortedKeywords = Array.from(byKeyword.entries())
      .sort((a, b) => (b[1][0]?.score || 0) - (a[1][0]?.score || 0));

    // Select top 3-4 bills from each of the top keywords, ensuring diversity
    const diverseCandidates = [];
    const BILLS_PER_KEYWORD = 4;
    const MAX_KEYWORDS = 5;

    for (const [keyword, bills] of sortedKeywords.slice(0, MAX_KEYWORDS)) {
      for (const bill of bills.slice(0, BILLS_PER_KEYWORD)) {
        diverseCandidates.push(bill);
      }
    }

    // Sort final list by score and take top 20
    return diverseCandidates
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map((candidate, index) => ({
        rank: index + 1,
        ...candidate,
        suggestedHeadline: this.generateHeadlineSuggestion(candidate, keywordAnalysis),
        suggestedCategory: this.suggestCategory(candidate)
      }));
  }

  /**
   * Generate headline suggestion for a spotlight candidate
   */
  generateHeadlineSuggestion(candidate, keywordAnalysis) {
    // Use news context if available
    if (candidate.newsItems && candidate.newsItems.length > 0) {
      // Find the most descriptive news title
      const bestTitle = candidate.newsItems
        .map(n => n.title)
        .sort((a, b) => b.length - a.length)[0];

      if (bestTitle && bestTitle.length < 100) {
        return bestTitle;
      }
    }

    // Generate from bill title
    const title = candidate.title || '';
    if (title.length < 80) {
      return title;
    }

    // Truncate intelligently
    return title.substring(0, 80).replace(/\s+\S*$/, '') + '...';
  }

  /**
   * Suggest category based on bill characteristics
   * Note: 'just_passed' category has a 14-day display window in SpotlightService
   */
  suggestCategory(candidate) {
    // If directly mentioned in news, likely breaking
    if (candidate.mentionCount && candidate.mentionCount > 2) {
      return 'breaking';
    }

    // Check latest action for passed bills - but only if within last 14 days
    const action = (candidate.latest_action_text || '').toLowerCase();
    const actionDate = candidate.latest_action_date ? new Date(candidate.latest_action_date) : null;
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const isRecent = actionDate && actionDate >= fourteenDaysAgo;

    if (isRecent) {
      if (action.includes('became public law') || action.includes('signed by president')) {
        return 'just_passed';
      }
      if (action.includes('passed house') || action.includes('passed senate')) {
        return 'just_passed';
      }
    }

    // Check for upcoming votes
    if (action.includes('placed on calendar') || action.includes('ordered reported')) {
      return 'upcoming_vote';
    }

    return 'trending';
  }

  // ============================================
  // DATABASE OPERATIONS
  // ============================================

  /**
   * Bulk-upsert fetched RSS news items into the news_item table.
   *
   * Uses a single batched multi-row INSERT per chunk (via unnest) with
   * ON CONFLICT (guid) DO UPDATE to refresh mutable fields. This avoids a
   * per-row round-trip for the ~3,300 items fetched each run.
   *
   * Items are deduplicated by guid in-memory first (a guid can legitimately
   * appear in more than one feed, e.g. overlapping Google News searches),
   * because Postgres rejects an INSERT whose VALUES touch the same conflict
   * key twice ("ON CONFLICT DO UPDATE command cannot affect row a second time").
   *
   * @param {Array} items - News items from fetchAllFeeds()
   * @returns {Promise<Map<string, number>>} Map of guid -> item_id for all upserted rows
   */
  async storeNewsItems(items) {
    const guidToItemId = new Map();
    if (!items || items.length === 0) return guidToItemId;

    // Deduplicate by guid, keeping the last occurrence. Skip rows without a
    // usable guid (guid is NOT NULL in the schema; fetchFeed falls back to
    // link/title, but guard anyway).
    const byGuid = new Map();
    for (const item of items) {
      const guid = item.guid || item.link || item.title;
      if (!guid) continue;
      byGuid.set(String(guid).slice(0, 500), item);
    }

    const deduped = Array.from(byGuid.entries());
    if (deduped.length === 0) return guidToItemId;

    const BATCH_SIZE = 500;
    let upserted = 0;

    for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
      const batch = deduped.slice(i, i + BATCH_SIZE);

      const guids = [];
      const titles = [];
      const links = [];
      const descriptions = [];
      const sources = [];
      const pubDates = [];

      for (const [guid, item] of batch) {
        guids.push(guid);
        titles.push(item.title || '');
        links.push(item.link || null);
        descriptions.push(item.description || null);
        // source_name is varchar(100) NOT NULL in the schema
        sources.push((item.source || 'unknown').slice(0, 100));
        pubDates.push(item.pubDate instanceof Date ? item.pubDate : (item.pubDate ? new Date(item.pubDate) : null));
      }

      const query = `
        INSERT INTO news_item (guid, title, link, description, source_name, pub_date)
        SELECT * FROM unnest(
          $1::varchar[], $2::text[], $3::text[], $4::text[], $5::varchar[], $6::timestamptz[]
        )
        ON CONFLICT (guid) DO UPDATE SET
          title = EXCLUDED.title,
          link = EXCLUDED.link,
          description = EXCLUDED.description,
          pub_date = EXCLUDED.pub_date
        RETURNING item_id, guid
      `;

      try {
        const result = await this.pool.query(query, [
          guids, titles, links, descriptions, sources, pubDates
        ]);
        for (const row of result.rows) {
          guidToItemId.set(row.guid, row.item_id);
        }
        upserted += result.rowCount || 0;
      } catch (error) {
        console.error('[NewsIngestion] Error upserting news_item batch:', error.message);
      }
    }

    console.log(`[NewsIngestion] Upserted ${upserted} news_item rows (${deduped.length} unique guids from ${items.length} fetched)`);
    return guidToItemId;
  }

  /**
   * Persist bill <-> news links into bill_news_mention.
   *
   * Reuses the bill matches already computed by lookupMentionedBills(): each
   * matched bill carries the news items that mentioned it (now including guid),
   * which we resolve to news_item.item_id via the guid->item_id map produced by
   * storeNewsItems(). Inserts (bill_id, news_item_id, context) in batched
   * multi-row INSERTs with ON CONFLICT (bill_id, news_item_id) DO NOTHING.
   *
   * @param {Array} mentionedBills - Output of lookupMentionedBills()
   * @param {Map<string, number>} guidToItemId - guid -> item_id from storeNewsItems()
   * @returns {Promise<number>} Number of mention links inserted (new rows)
   */
  async storeBillNewsMentions(mentionedBills, guidToItemId) {
    if (!mentionedBills || mentionedBills.length === 0) return 0;
    if (!guidToItemId || guidToItemId.size === 0) return 0;

    // Build deduplicated (bill_id, news_item_id) -> context rows.
    const linkMap = new Map();
    for (const bill of mentionedBills) {
      if (!bill.bill_id || !Array.isArray(bill.newsItems)) continue;
      for (const ni of bill.newsItems) {
        const itemId = ni.guid ? guidToItemId.get(String(ni.guid).slice(0, 500)) : undefined;
        if (!itemId) continue; // guid wasn't persisted (e.g. empty guid) — skip
        const key = `${bill.bill_id}::${itemId}`;
        if (!linkMap.has(key)) {
          linkMap.set(key, { billId: bill.bill_id, itemId, context: ni.context || null });
        }
      }
    }

    const links = Array.from(linkMap.values());
    if (links.length === 0) return 0;

    const BATCH_SIZE = 500;
    let inserted = 0;

    for (let i = 0; i < links.length; i += BATCH_SIZE) {
      const batch = links.slice(i, i + BATCH_SIZE);

      const billIds = batch.map(l => l.billId);
      const itemIds = batch.map(l => l.itemId);
      const contexts = batch.map(l => l.context);

      const query = `
        INSERT INTO bill_news_mention (bill_id, news_item_id, context)
        SELECT * FROM unnest($1::varchar[], $2::int[], $3::text[])
        ON CONFLICT (bill_id, news_item_id) DO NOTHING
        RETURNING mention_id
      `;

      try {
        const result = await this.pool.query(query, [billIds, itemIds, contexts]);
        inserted += result.rowCount || 0;
      } catch (error) {
        console.error('[NewsIngestion] Error inserting bill_news_mention batch:', error.message);
      }
    }

    console.log(`[NewsIngestion] Inserted ${inserted} bill_news_mention links (${links.length} candidate pairs)`);
    return inserted;
  }

  /**
   * Update the trending_topic table with current keyword data.
   *
   * Ported from the standalone news-ingestion-job.js so trending topics refresh
   * on every live run (the in-process scheduler path previously never called it,
   * leaving the table stale). Upserts the top keywords from the current analysis
   * with their weight/source_count and advances last_seen to NOW().
   *
   * @param {Array} keywords - topWords from extractKeywords() (term/weight/sourceCount)
   * @param {Object} topicScores - topicScores from extractKeywords() (category -> {matchedTerms})
   * @returns {Promise<number>} Number of topics upserted
   */
  async updateTrendingTopics(keywords, topicScores) {
    if (!keywords || keywords.length === 0) return 0;

    const client = await this.pool.connect();
    let upserted = 0;

    try {
      await client.query('BEGIN');

      // Deactivate topics that haven't been seen in the last 24h.
      await client.query(`
        UPDATE trending_topic
        SET is_active = false
        WHERE last_seen < NOW() - INTERVAL '24 hours'
      `);

      for (const keyword of keywords.slice(0, 50)) {
        // Determine category from topicScores by matched term membership.
        let category = null;
        for (const [cat, data] of Object.entries(topicScores || {})) {
          if (data.matchedTerms && data.matchedTerms.includes(keyword.term)) {
            category = cat;
            break;
          }
        }

        await client.query(`
          INSERT INTO trending_topic (topic_name, category, score, source_count, last_seen, is_active)
          VALUES ($1, $2, $3, $4, NOW(), true)
          ON CONFLICT (topic_name)
          DO UPDATE SET
            score = EXCLUDED.score,
            source_count = EXCLUDED.source_count,
            last_seen = NOW(),
            is_active = true,
            category = COALESCE(EXCLUDED.category, trending_topic.category)
        `, [keyword.term.slice(0, 100), category, keyword.weight, keyword.sourceCount]);
        upserted++;
      }

      await client.query('COMMIT');
      console.log(`[NewsIngestion] Updated trending_topic table (${upserted} topics upserted)`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[NewsIngestion] Error updating trending topics:', error.message);
    } finally {
      client.release();
    }

    return upserted;
  }

  /**
   * Store news analysis results in database
   * @param {Object} analysis - Results from generateSpotlightSuggestions
   */
  async storeAnalysisResults(analysis) {
    const query = `
      INSERT INTO news_analysis_log (
        analyzed_at,
        items_analyzed,
        feed_errors,
        trending_topics,
        top_keywords,
        direct_mentions_count,
        topical_matches_count,
        suggestions_generated
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING analysis_id
    `;

    try {
      const result = await this.pool.query(query, [
        analysis.timestamp,
        analysis.newsItemsAnalyzed,
        JSON.stringify(analysis.feedErrors),
        JSON.stringify(analysis.trendingTopics),
        JSON.stringify(analysis.topKeywords),
        analysis.directMentions.length,
        analysis.topicalMatches.length,
        JSON.stringify(analysis.spotlightSuggestions)
      ]);

      console.log(`[NewsIngestion] Stored analysis results with ID: ${result.rows[0].analysis_id}`);

      // Clean up old data after storing new results
      await this.cleanupOldData();

      return result.rows[0].analysis_id;
    } catch (error) {
      // Table might not exist yet
      console.warn('[NewsIngestion] Could not store analysis results:', error.message);
      return null;
    }
  }

  /**
   * Clean up old news analysis logs and inactive spotlights
   * - Keeps only last 24 hours of news_analysis_log entries
   * - Deletes inactive spotlight_bill entries older than 7 days
   */
  async cleanupOldData() {
    try {
      // Delete news analysis logs older than 24 hours
      const analysisResult = await this.pool.query(`
        DELETE FROM news_analysis_log
        WHERE analyzed_at < NOW() - INTERVAL '24 hours'
        RETURNING analysis_id
      `);

      // Delete inactive spotlights older than 7 days
      const spotlightResult = await this.pool.query(`
        DELETE FROM spotlight_bill
        WHERE is_active = false
          AND created_at < NOW() - INTERVAL '7 days'
        RETURNING spotlight_id
      `);

      const analysisDeleted = analysisResult.rowCount || 0;
      const spotlightsDeleted = spotlightResult.rowCount || 0;

      if (analysisDeleted > 0 || spotlightsDeleted > 0) {
        console.log(`[NewsIngestion] Cleanup: deleted ${analysisDeleted} old analysis logs, ${spotlightsDeleted} old inactive spotlights`);
      }
    } catch (error) {
      console.warn('[NewsIngestion] Cleanup failed:', error.message);
    }
  }

  /**
   * Auto-create spotlight entries with topic diversity
   * Selects 1 bill from each of the top 5 trending topics for better variety
   * @param {Array} suggestions - Spotlight suggestions
   * @param {number} minScore - Minimum score threshold
   */
  async autoCreateSpotlights(suggestions, minScore = 15) {
    const highConfidence = suggestions.filter(s => s.score >= minScore);

    if (highConfidence.length === 0) {
      console.log('[NewsIngestion] No high-confidence suggestions to auto-create');
      return [];
    }

    // Group suggestions by their matched keyword/topic
    const byTopic = new Map();
    for (const suggestion of highConfidence) {
      const topic = suggestion.matchedKeyword || suggestion.category || 'other';
      if (!byTopic.has(topic)) {
        byTopic.set(topic, []);
      }
      byTopic.get(topic).push(suggestion);
    }

    // Sort topics by total score of their bills
    const topicsByScore = Array.from(byTopic.entries())
      .map(([topic, bills]) => ({
        topic,
        bills,
        totalScore: bills.reduce((sum, b) => sum + b.score, 0),
        topScore: Math.max(...bills.map(b => b.score))
      }))
      .sort((a, b) => b.topScore - a.topScore);

    console.log(`[NewsIngestion] Found ${topicsByScore.length} trending topics with bills:`,
      topicsByScore.slice(0, 5).map(t => `${t.topic}(${t.bills.length} bills)`));

    // Select top 1 bill from each of the top 5 topics for variety
    const billsToCreate = [];
    const topicsUsed = [];
    const BILLS_PER_TOPIC = 1;
    const MAX_TOPICS = 5;

    for (const topicData of topicsByScore.slice(0, MAX_TOPICS)) {
      const topBills = topicData.bills
        .sort((a, b) => b.score - a.score)
        .slice(0, BILLS_PER_TOPIC);

      for (const bill of topBills) {
        billsToCreate.push({
          ...bill,
          fromTopic: topicData.topic
        });
      }
      topicsUsed.push(topicData.topic);
    }

    console.log(`[NewsIngestion] Selected ${billsToCreate.length} bills from topics: ${topicsUsed.join(', ')}`);

    // First, deactivate old auto-created spotlights to refresh the list
    await this.pool.query(`
      UPDATE spotlight_bill
      SET is_active = false
      WHERE created_by = 'news_ingestion_auto'
        AND created_at < NOW() - INTERVAL '24 hours'
    `);

    const created = [];

    for (const suggestion of billsToCreate) {
      // Check if already a spotlight
      const existing = await this.pool.query(
        'SELECT spotlight_id FROM spotlight_bill WHERE bill_id = $1 AND is_active = true',
        [suggestion.bill_id]
      );

      if (existing.rows.length > 0) {
        console.log(`[NewsIngestion] Bill ${suggestion.bill_id} already has active spotlight`);
        continue;
      }

      // Create spotlight
      const query = `
        INSERT INTO spotlight_bill (
          bill_id, headline, news_context, priority, category, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING spotlight_id
      `;

      try {
        const newsContext = suggestion.newsItems
          ? suggestion.newsItems[0]?.context || `Trending topic: ${suggestion.fromTopic}`
          : `Matches trending topic "${suggestion.fromTopic}" in current news.`;

        // Priority based on position within topic (first bill = 100, second = 95)
        const topicIndex = topicsUsed.indexOf(suggestion.fromTopic);
        const billIndexInTopic = billsToCreate
          .filter(b => b.fromTopic === suggestion.fromTopic)
          .indexOf(suggestion);
        const priority = 100 - (topicIndex * 10) - (billIndexInTopic * 5);

        const result = await this.pool.query(query, [
          suggestion.bill_id,
          suggestion.suggestedHeadline,
          newsContext,
          priority,
          suggestion.suggestedCategory,
          'news_ingestion_auto'
        ]);

        created.push({
          spotlightId: result.rows[0].spotlight_id,
          billId: suggestion.bill_id,
          headline: suggestion.suggestedHeadline,
          topic: suggestion.fromTopic
        });

        console.log(`[NewsIngestion] Auto-created spotlight ${result.rows[0].spotlight_id} for ${suggestion.bill_id} (topic: ${suggestion.fromTopic})`);
      } catch (error) {
        console.error(`[NewsIngestion] Error creating spotlight for ${suggestion.bill_id}:`, error.message);
      }
    }

    return created;
  }

  /**
   * Cleanup resources
   */
  async close() {
    if (this.managePool) {
      await this.pool.end();
    }
  }
}

module.exports = { NewsIngestionService };
