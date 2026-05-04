/**
 * Bill Summary Service
 *
 * Generates AI-powered summaries and analysis of congressional bills using
 * a modular prompt-based approach. All analysis types use the same core
 * function with tailored prompts.
 *
 * Summary Types:
 * - short: Brief, objective one-paragraph summary
 * - optimistic: Positive perspective ("angel" take)
 * - cynical: Critical perspective ("devil" take)
 * - realistic: Balanced, nuanced assessment
 */

const { LLMProviders } = require('./llm-providers');
const pool = require('./database');

// Singleton instance of LLMProviders
let llmProvidersInstance = null;

function getLLMProviders() {
  if (!llmProvidersInstance) {
    llmProvidersInstance = new LLMProviders();
  }
  return llmProvidersInstance;
}

// Configuration
const CONFIG = {
  provider: 'claude',
  model: 'claude-haiku-4-5-20251001',
  maxTokens: 1024,
  temperature: 0.7,
  maxBillTextLength: 150000  // ~50-60 pages worth of text
};

/**
 * Truncation notice appended to prompts when bill text exceeds the limit
 */
const TRUNCATION_NOTICE = `

IMPORTANT: The bill text provided has been truncated due to its length. You are only seeing the first portion of a much longer bill. Please:
1. Acknowledge in your response that this analysis is based on a truncated version of the bill
2. Be clear that provisions appearing later in the bill are not reflected in your analysis
3. Recommend readers consult the full bill text for complete information`;

/**
 * Truncate bill text if it exceeds the configured limit
 * Returns { text, wasTruncated, originalLength }
 */
function truncateBillText(billText, maxLength = CONFIG.maxBillTextLength) {
  if (!billText || billText.length <= maxLength) {
    return {
      text: billText,
      wasTruncated: false,
      originalLength: billText?.length || 0
    };
  }

  // Find a reasonable break point (end of sentence or paragraph)
  let truncateAt = maxLength;

  // Look for paragraph break within last 1000 chars
  const lastParagraph = billText.lastIndexOf('\n\n', maxLength);
  if (lastParagraph > maxLength - 1000) {
    truncateAt = lastParagraph;
  } else {
    // Look for sentence break within last 500 chars
    const lastSentence = billText.lastIndexOf('. ', maxLength);
    if (lastSentence > maxLength - 500) {
      truncateAt = lastSentence + 1;
    }
  }

  return {
    text: billText.substring(0, truncateAt),
    wasTruncated: true,
    originalLength: billText.length,
    truncatedLength: truncateAt
  };
}

/**
 * Prompt templates for each analysis type
 * These are designed to be refined collaboratively
 */
const PROMPTS = {
  simple: `You are explaining this congressional bill to someone with no background in politics or law. Your goal is to make it completely understandable to anyone, regardless of their education level.

Guidelines:
- Use very simple, everyday words (no jargon, no legal terms, no political terminology)
- Write short sentences (under 15 words each when possible)
- Explain what the bill does in concrete, practical terms
- If the bill creates a program or changes a rule, explain what that means for regular people
- Avoid abstract concepts - use specific examples when helpful
- Write 3-5 sentences total
- Imagine you're explaining this to a smart 12-year-old

Provide only the summary, no preamble or conclusion.`,

  short: `You are a nonpartisan legislative analyst. Your task is to provide a clear, objective summary of the following congressional bill.

Guidelines:
- Write a single paragraph (3-5 sentences)
- Focus on what the bill actually does, not opinions about it
- Use plain language accessible to the general public
- Include the key provisions and who/what it affects
- Avoid political bias or loaded language

Provide only the summary, no preamble or conclusion.`,

  optimistic: `You are presenting the most favorable interpretation of this congressional bill. Your role is to highlight the potential benefits and positive outcomes.

You are not seeking to sway, but you, yourself, are a true believer in this viewpoint. So, present the case in a logical way without overt emotional appeals and charged language and phrases.

Guidelines:
- Focus on the intended benefits and positive impacts
- Highlight how it could help people, solve problems, or improve situations
- Present the strongest arguments supporters would make
- Stay grounded in what the bill actually says
- Write 2-3 paragraphs

Provide only the analysis, no preamble or conclusion.`,

  cynical: `You are presenting a critical analysis of this congressional bill. Your role is to highlight potential concerns, drawbacks, and unintended consequences.

You are not seeking to sway, but you, yourself, are a true believer in this viewpoint. So, present the case in a logical way without overt emotional appeals and charged language and phrases.

Guidelines:
- Focus on potential problems, costs, or negative outcomes
- Identify who might be harmed or disadvantaged
- Point out loopholes, vague language, or implementation challenges
- Present the strongest arguments critics would make
- Write 2-3 paragraphs

Provide only the analysis, no preamble or conclusion.`,

  realistic: `You are a balanced policy analyst providing a realistic assessment of this congressional bill.

You will be provided with two polar opinions on this bill - an optimistic "angel" take and a critical "devil" take. The reality will often lie somewhere in relation to these perspectives, but your job isn't to simply find the middle ground. Your job is to present the most likely real-world outcome of this legislation's passage.

The reality may be closer to the angel or devil take at times. Be honest about which perspective seems more grounded in how policy actually works.

Guidelines:
- Consider both the optimistic and cynical perspectives provided
- Assess which concerns and benefits are most likely to materialize
- Discuss practical implementation considerations
- Consider political and institutional realities
- Present what will most likely happen if this bill becomes law
- Write 2-3 paragraphs

Provide only the analysis, no preamble or conclusion.`
};

/**
 * Valid summary types - must match database constraint
 */
const VALID_TYPES = ['simple', 'short', 'optimistic', 'cynical', 'realistic'];

/**
 * Generate a bill analysis using the specified prompt type
 *
 * @param {string} billText - The full text of the bill
 * @param {string} analysisType - One of: 'short', 'optimistic', 'cynical', 'realistic'
 * @param {Object} options - Optional overrides for provider, model, etc.
 * @param {Object} context - For 'realistic' type: { optimistic: string, cynical: string }
 * @returns {Promise<Object>} Object with { content: string, wasTruncated: boolean, originalLength: number }
 */
async function generateAnalysis(billText, analysisType, options = {}, context = {}) {
  // Validate analysis type
  if (!VALID_TYPES.includes(analysisType)) {
    throw new Error(`Invalid analysis type: ${analysisType}. Must be one of: ${VALID_TYPES.join(', ')}`);
  }

  // For realistic type, require the angel/devil takes
  if (analysisType === 'realistic') {
    if (!context.optimistic || !context.cynical) {
      throw new Error('Realistic analysis requires optimistic and cynical takes in context parameter');
    }
  }

  // Truncate bill text if necessary
  const truncation = truncateBillText(billText, options.maxBillTextLength || CONFIG.maxBillTextLength);
  const processedText = truncation.text;

  // Get the appropriate prompt, adding truncation notice if needed
  let systemPrompt = PROMPTS[analysisType];
  if (truncation.wasTruncated) {
    systemPrompt += TRUNCATION_NOTICE;
    console.log(`[BillSummary] Truncated bill text from ${truncation.originalLength} to ${truncation.truncatedLength} characters for ${analysisType} analysis`);
  }

  // Build user content based on analysis type
  let userContent;
  if (analysisType === 'realistic') {
    userContent = `Here is the bill text:

${processedText}

---

Here is the OPTIMISTIC ("Angel") take on this bill:

${context.optimistic}

---

Here is the CYNICAL ("Devil") take on this bill:

${context.cynical}

---

Now provide your realistic assessment of what will most likely happen if this bill becomes law.`;
  } else {
    userContent = `Please analyze the following bill:\n\n${processedText}`;
  }

  // Build messages array (OpenAI format - llm-providers handles conversion)
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent }
  ];

  // Merge config with any overrides
  const config = {
    ...CONFIG,
    ...options
  };

  try {
    // Call the LLM
    const llmProviders = getLLMProviders();
    const response = await llmProviders.chatCompletion(
      config.provider,
      config.model,
      messages,
      {
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        stream: false
      }
    );

    // Extract content from Claude response format
    // Claude returns: { content: [{ type: 'text', text: '...' }] }
    let content;
    if (response.content && Array.isArray(response.content)) {
      content = response.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');
    } else if (response.choices && response.choices[0]) {
      // Fallback for other formats
      content = response.choices[0].message.content;
    } else {
      throw new Error('Unexpected response format from LLM');
    }

    // Return content with truncation metadata
    return {
      content,
      wasTruncated: truncation.wasTruncated,
      originalLength: truncation.originalLength,
      truncatedLength: truncation.truncatedLength || truncation.originalLength
    };
  } catch (error) {
    console.error(`Error generating ${analysisType} analysis:`, error);
    throw error;
  }
}

/**
 * Generate all analysis types for a bill
 * Note: short, optimistic, and cynical are generated first (in parallel),
 * then realistic is generated using the optimistic and cynical results.
 *
 * @param {string} billText - The full text of the bill
 * @param {Object} options - Optional overrides
 * @returns {Promise<Object>} Object with all analysis types and truncation metadata
 */
async function generateAllAnalyses(billText, options = {}) {
  const results = {};
  let truncationInfo = null;

  // First, generate short, optimistic, and cynical in parallel
  const independentTypes = ['short', 'optimistic', 'cynical'];
  const promises = independentTypes.map(async (type) => {
    const result = await generateAnalysis(billText, type, options);
    results[type] = result.content;
    // Capture truncation info from first result
    if (!truncationInfo) {
      truncationInfo = {
        wasTruncated: result.wasTruncated,
        originalLength: result.originalLength,
        truncatedLength: result.truncatedLength
      };
    }
  });
  await Promise.all(promises);

  // Then generate realistic using the optimistic and cynical takes
  const realisticResult = await generateAnalysis(billText, 'realistic', options, {
    optimistic: results.optimistic,
    cynical: results.cynical
  });
  results.realistic = realisticResult.content;

  return {
    analyses: results,
    truncation: truncationInfo
  };
}

/**
 * Generate and save analysis to database
 *
 * @param {string} billId - The bill ID (e.g., '118-HR-1234')
 * @param {string} billText - The full text of the bill
 * @param {string} analysisType - One of the valid types
 * @param {string} textVersionCode - Bill text version (IH, RH, etc.)
 * @param {Object} options - Optional overrides
 * @param {Object} context - For 'realistic' type: { optimistic: string, cynical: string }
 * @returns {Promise<Object>} The saved summary record with content and truncation info
 */
async function generateAndSave(billId, billText, analysisType, textVersionCode = null, options = {}, context = {}) {
  // Generate the analysis
  const analysisResult = await generateAnalysis(billText, analysisType, options, context);

  // Save to database using the upsert function
  const config = { ...CONFIG, ...options };
  const result = await pool.query(
    `SELECT * FROM upsert_bill_summary($1, $2, $3, $4, $5)`,
    [billId, analysisType, analysisResult.content, textVersionCode, config.model]
  );

  // Return saved record with truncation metadata
  return {
    ...result.rows[0],
    wasTruncated: analysisResult.wasTruncated,
    originalLength: analysisResult.originalLength,
    truncatedLength: analysisResult.truncatedLength
  };
}

/**
 * Generate and save all analysis types for a bill
 * Note: Generates in proper order - short, optimistic, cynical first,
 * then realistic (which depends on optimistic and cynical).
 *
 * @param {string} billId - The bill ID
 * @param {string} billText - The full text of the bill
 * @param {string} textVersionCode - Bill text version
 * @param {Object} options - Optional overrides
 * @returns {Promise<Array>} Array of saved summary records
 */
async function generateAndSaveAll(billId, billText, textVersionCode = null, options = {}) {
  const results = [];
  const generated = {};

  // Generate and save simple, short, optimistic, cynical first (sequentially to avoid rate limits)
  for (const type of ['simple', 'short', 'optimistic', 'cynical']) {
    const result = await generateAndSave(billId, billText, type, textVersionCode, options);
    results.push(result);
    generated[type] = result.content;
  }

  // Generate and save realistic using the optimistic and cynical takes
  const realisticResult = await generateAndSave(
    billId,
    billText,
    'realistic',
    textVersionCode,
    options,
    { optimistic: generated.optimistic, cynical: generated.cynical }
  );
  results.push(realisticResult);

  return results;
}

/**
 * Generate realistic take using existing angel/devil takes from database
 * Useful for regenerating just the realistic take without regenerating all.
 *
 * @param {string} billId - The bill ID
 * @param {string} billText - The full text of the bill
 * @param {string} textVersionCode - Bill text version
 * @param {Object} options - Optional overrides
 * @returns {Promise<Object>} The saved realistic summary record
 */
async function generateRealisticFromExisting(billId, billText, textVersionCode = null, options = {}) {
  // Fetch existing optimistic and cynical takes
  const existing = await getSummaries(billId);
  const optimistic = existing.find(s => s.summary_type === 'optimistic');
  const cynical = existing.find(s => s.summary_type === 'cynical');

  if (!optimistic || !cynical) {
    throw new Error('Cannot generate realistic take: optimistic and/or cynical takes do not exist in database');
  }

  return generateAndSave(
    billId,
    billText,
    'realistic',
    textVersionCode,
    options,
    { optimistic: optimistic.content, cynical: cynical.content }
  );
}

/**
 * Get existing summaries for a bill
 *
 * @param {string} billId - The bill ID
 * @returns {Promise<Array>} Array of summary records
 */
async function getSummaries(billId) {
  const result = await pool.query(
    `SELECT * FROM get_bill_summaries($1)`,
    [billId]
  );
  return result.rows;
}

/**
 * Check if summaries need regeneration (text version changed)
 *
 * @param {string} billId - The bill ID
 * @returns {Promise<boolean>} True if summaries should be regenerated
 */
async function needsUpdate(billId) {
  const result = await pool.query(
    `SELECT bill_summaries_need_update($1) as needs_update`,
    [billId]
  );
  return result.rows[0]?.needs_update ?? true;
}

/**
 * Get the prompt template for a given type (useful for debugging/display)
 *
 * @param {string} analysisType - The analysis type
 * @returns {string} The prompt template
 */
function getPrompt(analysisType) {
  return PROMPTS[analysisType] || null;
}

/**
 * Get all available analysis types
 *
 * @returns {Array<string>} Array of valid type names
 */
function getValidTypes() {
  return [...VALID_TYPES];
}

/**
 * Get current configuration
 *
 * @returns {Object} Current config settings
 */
function getConfig() {
  return { ...CONFIG };
}

module.exports = {
  generateAnalysis,
  generateAllAnalyses,
  generateAndSave,
  generateAndSaveAll,
  generateRealisticFromExisting,
  getSummaries,
  needsUpdate,
  getPrompt,
  getValidTypes,
  getConfig,
  truncateBillText,
  PROMPTS,
  VALID_TYPES,
  CONFIG
};
