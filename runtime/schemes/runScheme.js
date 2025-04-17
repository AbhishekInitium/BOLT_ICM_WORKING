/**
 * runScheme.js
 *
 * Expert JavaScript function for processing sales incentive schemes.
 * This function reads a scheme definition (JSON) and associated data files (parsed CSVs)
 * to calculate agent payouts, log rule applications, and track credit distributions.
 * Designed for use in a dynamic, runtime environment like a Node.js backend.
 */

// Required dependency: decimal.js
// Run: npm install decimal.js
// Or ensure it's available in the execution environment.
const Decimal = require('decimal.js');

// --- Helper Functions ---

/**
 * Safely gets a nested property from an object using a dot-separated path.
 * @param {object} obj The object to query.
 * @param {string} path Dot-separated path string (e.g., "a.b.c").
 * @param {*} [defaultValue=undefined] The value to return if the path is not found or invalid.
 * @returns {*} The value found at the path or the default value.
 */
function safeGet(obj, path, defaultValue = undefined) {
  if (!obj || typeof path !== 'string') {
    return defaultValue;
  }
  try {
    // Added check for empty path
    if (path === '') return obj !== undefined ? obj : defaultValue;
    return path
      .split('.')
      .reduce(
        (acc, key) => (acc && acc[key] !== undefined ? acc[key] : defaultValue),
        obj
      );
  } catch (e) {
    console.error(`Error in safeGet with path "${path}":`, e);
    return defaultValue;
  }
}

/**
 * Parses a date string (YYYY-MM-DD) into a Date object (UTC midnight).
 * Returns null for invalid dates or non-string inputs.
 * @param {string} dateString The date string to parse.
 * @returns {Date | null} The parsed Date object or null.
 */
function parseDate(dateString) {
  if (!dateString || typeof dateString !== 'string') return null;
  // Robust check for YYYY-MM-DD format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    console.warn(
      `Invalid date format encountered: "${dateString}". Expected YYYY-MM-DD.`
    );
    return null;
  }
  // Use UTC to avoid timezone shifts affecting date comparisons
  const date = new Date(dateString + 'T00:00:00Z');
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Compares two Date objects based on year, month, and day (UTC).
 * @param {Date} date1 The first date.
 * @param {Date} date2 The second date.
 * @returns {number} -1 if date1 < date2, 0 if equal, 1 if date1 > date2, NaN if invalid input.
 */
function compareDates(date1, date2) {
  if (
    !(date1 instanceof Date) ||
    !(date2 instanceof Date) ||
    isNaN(date1) ||
    isNaN(date2)
  ) {
    // console.warn("Invalid date passed to compareDates:", date1, date2);
    return NaN; // Handle null/invalid dates
  }
  // Compare year, month, day in UTC
  const d1_year = date1.getUTCFullYear();
  const d1_month = date1.getUTCMonth();
  const d1_day = date1.getUTCDate();
  const d2_year = date2.getUTCFullYear();
  const d2_month = date2.getUTCMonth();
  const d2_day = date2.getUTCDate();

  if (d1_year < d2_year) return -1;
  if (d1_year > d2_year) return 1;
  if (d1_month < d2_month) return -1;
  if (d1_month > d2_month) return 1;
  if (d1_day < d2_day) return -1;
  if (d1_day > d2_day) return 1;
  return 0;
}

/**
 * Formats a Decimal.js number to a fixed-precision string.
 * Handles non-Decimal inputs gracefully.
 * @param {Decimal | number | string} decimalValue The value to format.
 * @param {number} [precision=2] The number of decimal places.
 * @returns {string} The formatted string representation.
 */
function formatDecimal(decimalValue, precision = 2) {
  try {
    if (!(decimalValue instanceof Decimal)) {
      // Attempt conversion if not already a Decimal
      const dec = new Decimal(decimalValue || 0);
      return dec.toFixed(precision);
    }
    return decimalValue.toFixed(precision);
  } catch (e) {
    console.error(`Error formatting decimal value "${decimalValue}":`, e);
    return new Decimal(0).toFixed(precision); // Return "0.00" on error
  }
}

/**
 * Evaluates a rule condition against a record's value, handling data types.
 * @param {*} recordValue The actual value from the record.
 * @param {string} operator The comparison operator (e.g., '=', '>=', 'CONTAINS').
 * @param {*} ruleValue The value defined in the rule.
 * @param {string} [dataType='String'] Expected data type ('String', 'Number', 'Date').
 * @returns {boolean} True if the condition is met, false otherwise.
 */
function evaluateCondition(
  recordValue,
  operator,
  ruleValue,
  dataType = 'String'
) {
  // Handle null/undefined record values consistently
  if (recordValue === null || recordValue === undefined || recordValue === '') {
    // Check if rule explicitly targets null/empty
    if (
      operator === '=' &&
      (ruleValue === null || ruleValue === undefined || ruleValue === '')
    ) {
      return true;
    }
    // Most operators will evaluate to false for null/undefined inputs unless explicitly handled
    return false;
  }
  // Handle null/undefined rule values
  if (ruleValue === null || ruleValue === undefined || ruleValue === '') {
    if (
      operator === '=' &&
      (recordValue === null || recordValue === undefined || recordValue === '')
    ) {
      return true; // Already handled above, but explicit check is fine
    }
    if (
      operator === '!=' &&
      recordValue !== null &&
      recordValue !== undefined &&
      recordValue !== ''
    ) {
      return true; // If record value is not null/empty, it's not equal to null/empty
    }
    // Generally, comparing against null/empty rule value is tricky, assume false for others
    return false;
  }

  let rv = recordValue;
  let val = ruleValue;

  try {
    if (dataType === 'Number') {
      rv = new Decimal(recordValue); // Will throw on invalid number format
      val = new Decimal(ruleValue); // Will throw on invalid number format
      switch (operator) {
        case '=':
          return rv.equals(val);
        case '!=':
          return !rv.equals(val);
        case '>':
          return rv.greaterThan(val);
        case '>=':
          return rv.greaterThanOrEqualTo(val);
        case '<':
          return rv.lessThan(val);
        case '<=':
          return rv.lessThanOrEqualTo(val);
        default:
          console.warn(`Unsupported Number operator: ${operator}`);
          return false;
      }
    } else if (dataType === 'Date') {
      rv = parseDate(String(recordValue)); // Ensure string before parsing
      val = parseDate(String(ruleValue));
      if (!rv || !val) {
        // console.warn(`Cannot evaluate Date condition due to invalid date(s):`, recordValue, ruleValue);
        return false;
      }
      const comparison = compareDates(rv, val);
      if (isNaN(comparison)) return false; // Comparison failed

      switch (operator) {
        case '=':
          return comparison === 0;
        case '!=':
          return comparison !== 0;
        case '>':
          return comparison === 1;
        case '>=':
          return comparison >= 0;
        case '<':
          return comparison === -1;
        case '<=':
          return comparison <= 0;
        default:
          console.warn(`Unsupported Date operator: ${operator}`);
          return false;
      }
    } else {
      // Default to String comparison (case-insensitive)
      rv = String(recordValue).trim().toLowerCase();
      val = String(ruleValue).trim().toLowerCase();

      switch (operator) {
        case '=':
          return rv === val;
        case '!=':
          return rv !== val;
        case 'CONTAINS':
          return rv.includes(val);
        case 'STARTSWITH':
          return rv.startsWith(val);
        case 'ENDSWITH':
          return rv.endsWith(val);
        // Add other string operators if needed (e.g., NOT CONTAINS)
        case 'NOT CONTAINS':
          return !rv.includes(val);
        default:
          console.warn(`Unsupported String operator: ${operator}`);
          return false;
      }
    }
  } catch (error) {
    console.error(
      `Error evaluating condition (${dataType} ${operator}): recordValue=${recordValue}, ruleValue=${ruleValue}`,
      error
    );
    return false;
  }
}

/**
 * Finds the manager for a given agent and level from the hierarchy data,
 * checking for validity within the scheme's effective date range.
 * @param {string} agentId The ID of the agent.
 * @param {string} level The hierarchy level (e.g., 'L1', 'L2').
 * @param {Array<object>} hierarchyData Array of hierarchy records.
 * @param {Date} schemeEffectiveFrom Start date of the scheme period.
 * @param {Date} runAsDate The 'as of' date for the calculation run.
 * @returns {string | null} The ManagerID or null if not found/valid.
 */
function findManager(
  agentId,
  level,
  hierarchyData,
  schemeEffectiveFrom,
  runAsDate
) {
  if (
    !agentId ||
    !level ||
    !hierarchyData ||
    !schemeEffectiveFrom ||
    !runAsDate
  ) {
    // console.warn("Missing required parameters for findManager.");
    return null;
  }

  const targetAgentId = String(agentId); // Ensure consistent comparison
  const targetLevelUpper = level.toUpperCase();

  for (const row of hierarchyData) {
    const rowAgentId = String(safeGet(row, 'AgentID', '')).trim();
    const rowLevel = String(safeGet(row, 'Level', '')).trim().toUpperCase();

    // Match agent and level
    if (rowAgentId === targetAgentId && rowLevel === targetLevelUpper) {
      const reportsFrom = parseDate(safeGet(row, 'ReportsFrom'));
      const reportsToEnd = parseDate(safeGet(row, 'ReportsToEnd'));

      // Validate hierarchy dates and check for overlap with the *run period*
      // The hierarchy record must be active at some point between scheme start and run date.
      // [hierStart, hierEnd] must overlap with [schemeStart, runAsDate]
      if (
        reportsFrom &&
        reportsToEnd &&
        compareDates(reportsFrom, runAsDate) <= 0 && // Hierarchy starts on or before run date
        compareDates(reportsToEnd, schemeEffectiveFrom) >= 0
      ) {
        // Hierarchy ends on or after scheme start date
        const managerId = safeGet(row, 'ManagerID', null);
        if (managerId !== null && String(managerId).trim() !== '') {
          return String(managerId).trim();
        }
      }
    }
  }
  // console.log(`No valid manager found for Agent ${agentId}, Level ${level} within date range.`);
  return null; // No valid manager found
}

/**
 * Calculates payout based on marginal tiers using Decimal.js.
 * @param {Decimal} amount The total credited amount.
 * @param {Array<object>} tiers The payout tiers configuration (must be sorted by 'from').
 * @returns {Decimal} The calculated base payout.
 */
function calculateMarginalTieredPayout(amount, tiers) {
  if (
    !(amount instanceof Decimal) ||
    !Array.isArray(tiers) ||
    tiers.length === 0
  ) {
    return new Decimal(0);
  }
  // Ensure tiers are sorted - defensive programming, should ideally be sorted beforehand
  const sortedTiers = [...tiers].sort(
    (a, b) => (Number(a.from) || 0) - (Number(b.from) || 0)
  );

  let totalPayout = new Decimal(0);
  let amountProcessed = new Decimal(0); // Track how much has been processed

  for (const tier of sortedTiers) {
    const tierFrom = new Decimal(tier.from || 0);
    // Handle unbounded 'to' (null, undefined, or sometimes large numbers might represent infinity)
    const tierTo =
      tier.to === null || tier.to === undefined
        ? Decimal.Infinity
        : new Decimal(tier.to);
    const rate = new Decimal(tier.rate || 0);
    const isPercentage = tier.isPercentage !== false; // Default to true

    if (amount.lte(tierFrom) || amount.lte(amountProcessed)) {
      // Amount is below the start of this tier, or we've already processed the entire amount
      break;
    }

    // Determine the start point for calculation in this tier
    // It's the higher of the tier's start or the amount already processed from lower tiers
    const effectiveTierStart = Decimal.max(tierFrom, amountProcessed);

    // Determine the end point for calculation in this tier
    // It's the lower of the tier's end or the total amount
    const effectiveTierEnd = Decimal.min(tierTo, amount);

    // Calculate the portion of the amount that falls *within* this specific tier's range *and* hasn't been processed yet
    const amountInTier = effectiveTierEnd.minus(effectiveTierStart);

    if (amountInTier.gt(0)) {
      let tierPayout;
      if (isPercentage) {
        // Payout is rate % of the amount falling *into* this tier range
        tierPayout = amountInTier.times(rate).dividedBy(100);
      } else {
        // Fixed rate per unit of amount in the tier
        tierPayout = amountInTier.times(rate);
        // Alternative interpretation: If it's a single fixed amount if *any* amount falls in the tier,
        // the logic would be: tierPayout = rate; totalPayout = totalPayout.plus(tierPayout); break;
        // Assuming the per-unit interpretation based on typical schemes.
      }
      totalPayout = totalPayout.plus(tierPayout);
      amountProcessed = effectiveTierEnd; // Update the total amount processed so far
    }

    // Optimization: If we have processed up to or beyond the total amount, stop.
    if (amountProcessed.gte(amount)) {
      break;
    }
  }

  return totalPayout;
}

// --- Main Scheme Execution Function ---

/**
 * Executes a sales incentive scheme based on provided configuration and data.
 *
 * @param {object} scheme The scheme configuration JSON object.
 * @param {object} uploadedFiles An object mapping filenames to arrays of data rows (parsed CSVs).
 *      e.g., { "SCH1.csv": [ { "Sales Employee": 101, ... }, ... ], "MH_DEC24.csv": [ ... ] }
 * @param {string} runAsOfDate The date (YYYY-MM-DD) to run the calculation up to (inclusive).
 * @returns {object} An object containing results:
 *      {
 *          agentPayouts: { [agentId: string]: string }, // Payout amount formatted as string
 *          ruleHitLogs: { [agentId: string]: Array<object> }, // Logs per agent
 *          creditDistributions: { [managerId: string]: Array<object> }, // Credits received by managers
 *          rawRecordLevelData: Array<object> // All processed records with computed fields
 *      }
 * @throws {Error} If essential configuration or data is missing or invalid.
 */
function runScheme(scheme, uploadedFiles, runAsOfDate) {
  // --- 0. Input Validation & Initialization ---
  if (!scheme || typeof scheme !== 'object')
    throw new Error("Invalid or missing 'scheme' object.");
  if (!uploadedFiles || typeof uploadedFiles !== 'object')
    throw new Error("Invalid or missing 'uploadedFiles' object.");
  if (!runAsOfDate || typeof runAsOfDate !== 'string')
    throw new Error("Invalid or missing 'runAsOfDate' string.");

  console.log(
    `Running scheme: ${safeGet(
      scheme,
      'name',
      'Unnamed Scheme'
    )} as of ${runAsOfDate}`
  );

  // Configure Decimal.js precision
  Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP }); // Sufficient precision

  const agentPayouts = {};
  const ruleHitLogs = {};
  const creditDistributions = {};
  const rawRecordLevelData = [];

  const runDate = parseDate(runAsOfDate);
  const schemeStart = parseDate(safeGet(scheme, 'effectiveFrom'));
  // const schemeEnd = parseDate(safeGet(scheme, 'effectiveTo')); // Not strictly needed for filtering but good context

  if (!runDate)
    throw new Error(
      `Invalid runAsOfDate format: "${runAsOfDate}". Use YYYY-MM-DD.`
    );
  if (!schemeStart)
    throw new Error(
      `Invalid scheme.effectiveFrom date: "${safeGet(
        scheme,
        'effectiveFrom'
      )}". Use YYYY-MM-DD.`
    );

  // Validate essential scheme components
  const baseMapping = scheme.baseMapping;
  if (
    !baseMapping ||
    !baseMapping.sourceFile ||
    !baseMapping.agentField ||
    !baseMapping.amountField ||
    !baseMapping.transactionDateField
  ) {
    throw new Error(
      'Scheme baseMapping is missing required fields: sourceFile, agentField, amountField, transactionDateField.'
    );
  }
  if (!scheme.payoutTiers) {
    console.warn(
      `Scheme ${scheme.name} has no payoutTiers defined. Payouts will likely be zero.`
    );
    scheme.payoutTiers = []; // Ensure it's an array to prevent errors
  }

  const baseDataFile = baseMapping.sourceFile;
  const agentIdField = baseMapping.agentField;
  const amountField = baseMapping.amountField;
  const transactionDateField = baseMapping.transactionDateField; // Use the specified date field
  const hierarchyFile = scheme.creditHierarchyFile;

  const baseData = safeGet(uploadedFiles, baseDataFile);
  const hierarchyData = hierarchyFile
    ? safeGet(uploadedFiles, hierarchyFile, [])
    : []; // Default to empty array if file specified but not found

  if (!Array.isArray(baseData)) {
    throw new Error(
      `Base data file "${baseDataFile}" not found or is not an array in uploadedFiles.`
    );
  }
  if (hierarchyFile && !uploadedFiles[hierarchyFile]) {
    console.warn(
      `Hierarchy file "${hierarchyFile}" specified but not found in uploadedFiles. Credit splits will likely fail.`
    );
  }
  if (hierarchyFile && !Array.isArray(hierarchyData)) {
    console.warn(
      `Hierarchy file "${hierarchyFile}" data is not an array. Credit splits will likely fail.`
    );
    // hierarchyData = []; // Ensure it's an array
  }

  // --- Build Field Mappings from kpiConfig (Crucial for dynamic field access) ---
  const fieldMap = {}; // { logicalName: { sourceField, dataType, evaluationLevel, aggregation, sourceFile } }
  const allKpiSections = [
    'baseData',
    'qualificationFields',
    'adjustmentFields',
    'exclusionFields',
    'creditFields',
  ];
  allKpiSections.forEach((section) => {
    (safeGet(scheme, `kpiConfig.${section}`, []) || []).forEach((f) => {
      if (f.name && f.sourceField) {
        // Require name and sourceField for mapping
        fieldMap[f.name] = {
          sourceField: f.sourceField,
          dataType: f.dataType || 'String',
          evaluationLevel: f.evaluationLevel || 'Per Record',
          aggregation: f.aggregation || 'NotApplicable',
          sourceFile: f.sourceFile, // Store which file this field belongs to
        };
      } else {
        console.warn(
          `Skipping incomplete kpiConfig field definition in section ${section}:`,
          f
        );
      }
    });
  });

  // Ensure base mapping fields are conceptually mapped if not explicitly in kpiConfig.baseData
  // These provide default mappings if specific kpiConfig entries are missing
  if (!fieldMap['Agent'])
    fieldMap['Agent'] = {
      sourceField: agentIdField,
      dataType: 'String',
      evaluationLevel: 'Per Record',
      sourceFile: baseDataFile,
    };
  if (!fieldMap['Amount'])
    fieldMap['Amount'] = {
      sourceField: amountField,
      dataType: 'Number',
      evaluationLevel: 'Per Record',
      sourceFile: baseDataFile,
    };
  if (!fieldMap['TransactionDate'])
    fieldMap['TransactionDate'] = {
      sourceField: transactionDateField,
      dataType: 'Date',
      evaluationLevel: 'Per Record',
      sourceFile: baseDataFile,
    };

  // Helper to get info based on logical field name used in rules
  const getFieldInfo = (ruleFieldName) => fieldMap[ruleFieldName];

  // --- 1. Select Base Records (Date Filtering) ---
  console.log(
    `Filtering records from ${baseDataFile} using field '${transactionDateField}' between ${scheme.effectiveFrom} and ${runAsOfDate}...`
  );

  const dateFilteredRecords = baseData
    .map((record, index) => ({
      ...record, // Spread original record data
      _originalIndex: index, // Preserve original index if needed
      _recordId: `${baseDataFile}-${index}`, // Create a unique ID for logging/tracing
    }))
    .filter((record) => {
      const recordDateStr = safeGet(record, transactionDateField);
      if (
        recordDateStr === undefined ||
        recordDateStr === null ||
        recordDateStr === ''
      ) {
        // console.warn(`Record ${_recordId} missing transaction date in field '${transactionDateField}'. Skipping.`);
        return false; // Skip records without a date in the specified field
      }
      const recordDate = parseDate(String(recordDateStr)); // Ensure string conversion before parsing
      if (!recordDate) {
        // console.warn(`Record ${_recordId} has invalid date format in field '${transactionDateField}': '${recordDateStr}'. Skipping.`);
        return false; // Skip records with invalid date format
      }

      // Check if record date falls within the scheme's effective period up to the run date
      const isAfterStart = compareDates(recordDate, schemeStart) >= 0;
      const isBeforeOrOnRunDate = compareDates(recordDate, runDate) <= 0;
      return isAfterStart && isBeforeOrOnRunDate;
    });
  console.log(
    `Found ${dateFilteredRecords.length} records within the date range.`
  );

  // --- 2. Apply 'Per Record' Qualification Rules ---
  const recordLevelQualRules = (scheme.qualificationRules || []).filter(
    (rule) => {
      const fieldInfo = getFieldInfo(rule.field);
      return (
        fieldInfo &&
        fieldInfo.evaluationLevel === 'Per Record' &&
        fieldInfo.sourceFile === baseDataFile
      );
    }
  );

  const qualifiedRecords = dateFilteredRecords.filter((record) => {
    for (const rule of recordLevelQualRules) {
      const fieldInfo = getFieldInfo(rule.field); // Already checked it exists
      if (!fieldInfo.sourceField) {
        console.warn(
          `Skipping record qualification rule ${rule.id}: Cannot find source field for '${rule.field}'.`
        );
        continue; // Should not happen if map is built correctly
      }
      const recordValue = safeGet(record, fieldInfo.sourceField);
      if (
        !evaluateCondition(
          recordValue,
          rule.operator,
          rule.value,
          fieldInfo.dataType
        )
      ) {
        // Record fails this rule, so it's disqualified at record level
        return false;
      }
    }
    return true; // Passes all record-level qualifications
  });
  console.log(
    `${qualifiedRecords.length} records passed record-level qualification.`
  );

  // --- 3. Group Records by Agent ---
  const recordsByAgent = qualifiedRecords.reduce((acc, record) => {
    // Use safeGet for agent ID and convert to string for consistent keys
    const agentId = String(
      safeGet(record, agentIdField, 'UNKNOWN_AGENT')
    ).trim();
    if (agentId === 'UNKNOWN_AGENT' || agentId === '') {
      console.warn(
        `Record ${_recordId} has missing or empty agent ID in field '${agentIdField}'. Grouping under 'UNKNOWN_AGENT'.`
      );
    }
    if (!acc[agentId]) {
      acc[agentId] = [];
    }
    acc[agentId].push(record);
    return acc;
  }, {});
  const agentCount = Object.keys(recordsByAgent).length;
  console.log(
    `Grouped records for ${agentCount} ${
      agentCount === 1 ? 'agent' : 'agents'
    }.`
  );

  // --- 4. Process Each Agent ---
  for (const agentId in recordsByAgent) {
    if (agentId === 'UNKNOWN_AGENT') continue; // Optionally skip processing for unknown agents

    // console.log(`Processing agent: ${agentId}`);
    const agentRecords = recordsByAgent[agentId];
    let agentTotalCreditedAmount = new Decimal(0);
    const agentRuleLogs = []; // Rule logs specific to this agent

    // --- 4a. Record-Level Processing (Exclusion, Adjustment) ---
    const processedAgentRecords = agentRecords.map((record) => {
      let isExcluded = false;
      let exclusionReason = null;
      let adjustmentApplied = null;
      let customRuleApplied = null; // Placeholder

      const originalAmount = new Decimal(safeGet(record, amountField, 0));
      let currentAmount = originalAmount;
      let rateMultiplier = new Decimal(1); // Start with a 1x multiplier

      // --- 4a.i. Apply Exclusion Rules ---
      for (const rule of scheme.exclusionRules || []) {
        const fieldInfo = getFieldInfo(rule.field);
        if (!fieldInfo || fieldInfo.sourceFile !== baseDataFile) {
          // console.warn(`Skipping exclusion rule ${rule.id}: Mapped field '${rule.field}' not found or not from base file.`);
          continue;
        }
        const recordValue = safeGet(record, fieldInfo.sourceField);

        if (
          evaluateCondition(
            recordValue,
            rule.operator,
            rule.value,
            fieldInfo.dataType
          )
        ) {
          isExcluded = true;
          exclusionReason = `Excluded by rule ${rule.id} (${rule.field} ${rule.operator} ${rule.value})`;
          agentRuleLogs.push({
            ruleType: 'Exclusion',
            ruleId: rule.id,
            recordId: record._recordId,
            agentId: agentId, // Log agent ID here for context
            message: exclusionReason,
            timestamp: new Date().toISOString(),
          });
          break; // Stop checking exclusion rules for this record
        }
      }

      // --- 4a.ii. Apply Adjustment Rules (only if not excluded) ---
      if (!isExcluded) {
        for (const rule of scheme.adjustmentRules || []) {
          // Check the condition part of the rule
          const conditionFieldInfo = getFieldInfo(rule.condition.field);
          if (
            !conditionFieldInfo ||
            conditionFieldInfo.sourceFile !== baseDataFile
          ) {
            // console.warn(`Skipping adjustment rule ${rule.id}: Condition field '${rule.condition.field}' not found or not from base file.`);
            continue;
          }
          const conditionValue = safeGet(
            record,
            conditionFieldInfo.sourceField
          );

          if (
            evaluateCondition(
              conditionValue,
              rule.condition.operator,
              rule.condition.value,
              conditionFieldInfo.dataType
            )
          ) {
            // Condition met, apply the adjustment
            const adj = rule.adjustment;
            const adjTarget = adj.target; // 'Rate' or 'Amount'
            const adjType = adj.type; // 'percentage' or 'fixed'
            const adjValue = new Decimal(adj.value || 0);

            adjustmentApplied = `Adjusted by rule ${rule.id}`; // Mark that an adjustment happened
            let logMessage = `Adjustment Rule ${rule.id} triggered: `;

            if (adjTarget === 'Rate' && adjType === 'percentage') {
              // Adjust the rateMultiplier. A value of 200 means multiply by 200/100 = 2.
              const multiplierChange = adjValue.dividedBy(100);
              rateMultiplier = rateMultiplier.times(multiplierChange);
              logMessage += `Rate multiplier updated to ${formatDecimal(
                rateMultiplier,
                4
              )}`;
            } else if (adjTarget === 'Amount' && adjType === 'percentage') {
              // Adjust the amount by a percentage (e.g., +20%)
              const increase = currentAmount.times(adjValue).dividedBy(100);
              currentAmount = currentAmount.plus(increase);
              logMessage += `Amount adjusted by ${formatDecimal(
                adjValue
              )}% to ${formatDecimal(currentAmount)}`;
            } else if (adjTarget === 'Amount' && adjType === 'fixed') {
              // Adjust the amount by a fixed value
              currentAmount = currentAmount.plus(adjValue);
              logMessage += `Amount adjusted by fixed ${formatDecimal(
                adjValue
              )} to ${formatDecimal(currentAmount)}`;
            } else {
              logMessage += `Unknown adjustment target/type: ${adjTarget}/${adjType}`;
              console.warn(logMessage);
            }

            agentRuleLogs.push({
              ruleType: 'Adjustment',
              ruleId: rule.id,
              recordId: record._recordId,
              agentId: agentId,
              message: logMessage,
              details: {
                // Add more details for debugging
                conditionField: rule.condition.field,
                conditionValue: conditionValue,
                adjustment: adj,
                originalAmount: formatDecimal(originalAmount),
                amountBeforeAdj: formatDecimal(
                  isExcluded ? new Decimal(0) : currentAmount
                ), // amount before *this* adjustment
                rateMultiplierBeforeAdj: formatDecimal(rateMultiplier), // Multiplier before *this* rate adjustment
              },
              timestamp: new Date().toISOString(),
            });
            // Decide if multiple adjustments can apply. If only one, add `break;` here.
          }
        }
      }

      // --- 4a.iii. Apply Custom Rules (Placeholder) ---
      if (!isExcluded && scheme.customRules && scheme.customRules.length > 0) {
        // --- Implement Custom Rule Logic Here ---
        // This would involve checking custom conditions and potentially modifying
        // currentAmount or rateMultiplier based on logic not covered by standard rules.
        console.warn(
          `Agent ${agentId}, Record ${record._recordId}: Custom rules exist but logic is not implemented.`
        );
        customRuleApplied = 'Custom rules present but not executed.'; // Log that it was skipped
        // Example Log:
        // agentRuleLogs.push({ ruleType: 'Custom', ruleId: 'XYZ', recordId: record._recordId, agentId: agentId, message: 'Applied custom rule XYZ', timestamp: new Date().toISOString() });
      }

      // --- Calculate final adjusted amount for this record ---
      const adjustedAmount = isExcluded
        ? new Decimal(0)
        : currentAmount.times(rateMultiplier);

      // Store processed data for the raw output log
      const processedRecord = {
        ...record, // Include original data
        _processingStatus: {
          // Add a dedicated section for processing results
          originalAmount: formatDecimal(originalAmount),
          rateMultiplier: formatDecimal(rateMultiplier, 4),
          adjustedAmount: formatDecimal(adjustedAmount),
          isExcluded: isExcluded,
          exclusionReason: exclusionReason,
          adjustmentApplied: adjustmentApplied,
          customRuleApplied: customRuleApplied,
        },
      };
      rawRecordLevelData.push(processedRecord);

      // Add to agent's total credited amount if not excluded
      if (!isExcluded) {
        agentTotalCreditedAmount =
          agentTotalCreditedAmount.plus(adjustedAmount);
      }

      return processedRecord; // Return processed record (though not used further in this loop)
    }); // End map over agentRecords

    // console.log(`Agent ${agentId}: Total summed adjusted amount = ${formatDecimal(agentTotalCreditedAmount)}`);

    // --- 4b. Apply 'Agent' Level Qualification Rules ---
    let agentQualified = true; // Assume qualified unless a rule fails
    if (agentTotalCreditedAmount.lte(0)) {
      agentQualified = false; // Cannot qualify with zero or negative credited amount
      // console.log(`Agent ${agentId}: Skipping payout calculation (zero/negative credited amount).`);
    } else {
      const agentLevelQualRules = (scheme.qualificationRules || []).filter(
        (rule) => {
          const fieldInfo = getFieldInfo(rule.field);
          // Rule applies if evaluationLevel is Agent and (it targets the base amount OR aggregation makes sense)
          return fieldInfo && fieldInfo.evaluationLevel === 'Agent';
        }
      );

      for (const rule of agentLevelQualRules) {
        const fieldInfo = getFieldInfo(rule.field);
        // Determine the value to check against:
        // If the rule field is the main amount field with Sum aggregation, use agentTotalCreditedAmount.
        // Otherwise, this structure doesn't support agent-level checks on other aggregated fields yet.
        let valueToCheck;
        let valueDataType;
        if (
          fieldInfo.sourceField === amountField &&
          fieldInfo.aggregation === 'Sum'
        ) {
          valueToCheck = agentTotalCreditedAmount;
          valueDataType = 'Number'; // Use Number type for comparison
        } else {
          console.warn(
            `Agent ${agentId}: Skipping Agent-level qualification rule ${rule.id} for field ${rule.field}. Only rules on the primary summed amount (e.g., MinSales) are currently supported.`
          );
          continue; // Skip rules we can't evaluate at agent level yet
        }

        const ruleValue = rule.value; // The value from the rule definition

        if (
          !evaluateCondition(
            valueToCheck,
            rule.operator,
            ruleValue,
            valueDataType
          )
        ) {
          agentQualified = false;
          const message = `Agent failed qualification rule ${rule.id}: Check (${
            rule.field
          } ${rule.operator} ${ruleValue}) failed with value ${formatDecimal(
            valueToCheck
          )}.`;
          // console.log(`Agent ${agentId}: ${message}`);
          agentRuleLogs.push({
            ruleType: 'Qualification',
            ruleId: rule.id,
            agentId: agentId, // Redundant but clear
            message: message,
            timestamp: new Date().toISOString(),
          });
          break; // Agent failed qualification, no need to check further agent rules
        }
      }
    }

    // --- 4c. Calculate Incentive Payout (if qualified) ---
    let basePayout = new Decimal(0);
    if (agentQualified) {
      basePayout = calculateMarginalTieredPayout(
        agentTotalCreditedAmount,
        scheme.payoutTiers
      );
      // console.log(`Agent ${agentId}: Base payout calculated = ${formatDecimal(basePayout)}`);
    } else {
      // console.log(`Agent ${agentId}: No payout due to qualification failure or zero/negative amount.`);
    }

    // Store the agent's calculated base payout (before splits)
    // Format as string for the final output object
    agentPayouts[agentId] = formatDecimal(basePayout);

    // --- 4d. Apply Credit Splits (if base payout > 0 and hierarchy exists) ---
    const hasSplits =
      Array.isArray(scheme.creditSplits) && scheme.creditSplits.length > 0;
    const hasHierarchy =
      Array.isArray(hierarchyData) && hierarchyData.length > 0;

    if (basePayout.gt(0) && hasSplits && hasHierarchy) {
      // console.log(`Agent ${agentId}: Applying credit splits...`);
      for (const split of scheme.creditSplits) {
        const role = split.role;
        const percentage = new Decimal(split.percentage || 0);

        if (!role || percentage.lte(0)) {
          console.warn(
            `Agent ${agentId}: Skipping invalid credit split definition:`,
            split
          );
          continue;
        }

        // Find the manager for this agent and role, considering date validity
        const managerId = findManager(
          agentId,
          role,
          hierarchyData,
          schemeStart,
          runDate
        );

        if (managerId) {
          const splitAmount = basePayout.times(percentage).dividedBy(100);

          if (splitAmount.gt(0)) {
            // Initialize manager's entry if it doesn't exist
            if (!creditDistributions[managerId]) {
              creditDistributions[managerId] = [];
            }
            // Create the distribution record
            const distributionRecord = {
              fromAgent: agentId,
              role: role,
              amount: formatDecimal(splitAmount), // Format amount for output
              timestamp: new Date().toISOString(),
              splitRuleId: split.id, // Reference the split rule ID
              basePayoutFromAgent: formatDecimal(basePayout), // Context: base payout being split
              percentageApplied: formatDecimal(percentage, 4), // Context: percentage used
            };
            creditDistributions[managerId].push(distributionRecord);
            // console.log(`Agent ${agentId}: Distributed ${formatDecimal(splitAmount)} (${percentage}%) to ${role} Manager ${managerId}`);

            // Log the successful split action for the source agent
            agentRuleLogs.push({
              ruleType: 'CreditSplit',
              ruleId: split.id,
              agentId: agentId,
              message: `Distributed ${formatDecimal(
                splitAmount
              )} (${percentage}%) to ${role} Manager ${managerId}.`,
              details: {
                // Include details in the log
                managerId: managerId,
                role: role,
                percentage: formatDecimal(percentage, 4),
                splitAmount: formatDecimal(splitAmount),
                basePayout: formatDecimal(basePayout),
              },
              timestamp: new Date().toISOString(),
            });
          }
        } else {
          const message = `Agent ${agentId}: Could not find a valid Manager for role ${role} (Split Rule ID: ${split.id}) active between ${scheme.effectiveFrom} and ${runAsOfDate}.`;
          // console.warn(message);
          // Log the failure to find a manager for this split
          agentRuleLogs.push({
            ruleType: 'CreditSplit',
            ruleId: split.id,
            agentId: agentId,
            message: message,
            details: { role: role, percentage: formatDecimal(percentage, 4) },
            timestamp: new Date().toISOString(),
          });
        }
      }
      // Note: The current structure distributes portions of the agent's *base* payout.
      // The `agentPayouts` object still holds the agent's total calculated base payout.
      // If the requirement was to *reduce* the agent's payout by the split amount,
      // that logic would need to be added here.
    } else if (basePayout.gt(0) && hasSplits && !hasHierarchy) {
      // console.warn(`Agent ${agentId}: Payout generated, splits defined, but no hierarchy data loaded/found. Cannot perform splits.`);
      agentRuleLogs.push({
        ruleType: 'CreditSplit',
        ruleId: 'N/A',
        agentId: agentId,
        message: `Splits defined but hierarchy data missing or empty. Cannot distribute payout ${formatDecimal(
          basePayout
        )}.`,
        timestamp: new Date().toISOString(),
      });
    }

    // --- Store Agent Logs ---
    if (agentRuleLogs.length > 0) {
      // Ensure agentId exists as a key even if logs are empty before adding more
      if (!ruleHitLogs[agentId]) ruleHitLogs[agentId] = [];
      ruleHitLogs[agentId].push(...agentRuleLogs); // Add logs generated in this iteration
    }
  } // End loop through agents

  console.log('Scheme processing complete.');

  // --- 5. Return Results ---
  return {
    agentPayouts,
    ruleHitLogs,
    creditDistributions,
    rawRecordLevelData, // Contains all records processed, including excluded ones, with detailed status
  };
}

// --- Example Usage (Commented Out) ---
/*
async function runExample() {
    // Required: npm install decimal.js
    // const Decimal = require('decimal.js'); // Already required above

    // 1. Load Scheme JSON (replace with actual file loading)
    const schemeJson = {
      "name": "NA_SO_DEC_24V3_Example",
      "description": "North America Dec 24 V3 Example Run",
      "effectiveFrom": "2024-12-01",
      "effectiveTo": "2024-12-31",
      "quotaAmount": 350000,
      "revenueBase": "Sales Orders",
      "baseMapping": {
        "sourceFile": "SCH1_Example.csv",
        "agentField": "Sales Employee",
        "amountField": "Net Value",
        "transactionDateField": "Document Date"
      },
      "qualificationRules": [
        {"id": "q1", "field": "SalesOrg", "operator": "=", "value": "1810"},
        {"id": "q2", "field": "MinSales", "operator": ">=", "value": "70000"}
      ],
      "adjustmentRules": [
        {"id": "a1", "condition": {"field": "DeliveryStat", "operator": "CONTAINS", "value": "Fully"}, "adjustment": {"target": "Rate", "type": "percentage", "value": 200}}
      ],
      "exclusionRules": [
        {"id": "e1", "field": "Payer", "operator": "=", "value": "17100002"}
      ],
      "creditRules": [],
      "creditSplits": [
        {"id": "cs1", "role": "L1", "percentage": 90},
        {"id": "cs2", "role": "L2", "percentage": 10}
      ],
      "creditHierarchyFile": "MH_DEC24_Example.csv",
      "payoutTiers": [
        {"id": "t1", "from": 0, "to": 25000, "rate": 3, "isPercentage": true},
        {"id": "t2", "from": 25001, "to": 125000, "rate": 7, "isPercentage": true},
        {"id": "t3", "from": 125001, "to": 225000, "rate": 10, "isPercentage": true},
        {"id": "t4", "from": 225001, "to": null, "rate": 15, "isPercentage": true} // Example accelerator tier
      ],
      "customRules": [],
      "kpiConfig": {
        "calculationBase": "Sales Orders", "baseField": "Net Value",
        "baseData": [
          {"id": "k_agent", "name": "Agent", "sourceField": "Sales Employee", "dataType": "String", "evaluationLevel": "Per Record", "sourceFile": "SCH1_Example.csv"},
          {"id": "k_amount", "name": "Amount", "sourceField": "Net Value", "dataType": "Number", "evaluationLevel": "Per Record", "sourceFile": "SCH1_Example.csv"},
          {"id": "k_date", "name": "TransactionDate", "sourceField": "Document Date", "dataType": "Date", "evaluationLevel": "Per Record", "sourceFile": "SCH1_Example.csv"}
        ],
        "qualificationFields": [
          {"id": "k_salesorg", "name": "SalesOrg", "sourceField": "Sales Organization", "dataType": "String", "evaluationLevel": "Per Record", "sourceFile": "SCH1_Example.csv"},
          {"id": "k_minsales", "name": "MinSales", "sourceField": "Net Value", "dataType": "Number", "evaluationLevel": "Agent", "aggregation": "Sum", "sourceFile": "SCH1_Example.csv"}
        ],
        "adjustmentFields": [
          {"id": "k_delivstat", "name": "DeliveryStat", "sourceField": "Delivery Status", "dataType": "String", "evaluationLevel": "Per Record", "sourceFile": "SCH1_Example.csv"}
        ],
        "exclusionFields": [
          {"id": "k_payer", "name": "Payer", "sourceField": "Payer", "dataType": "String", "evaluationLevel": "Per Record", "sourceFile": "SCH1_Example.csv"}
        ],
        "creditFields": []
      }
    };

    // 2. Prepare Uploaded Files Data (replace with actual parsed CSV data)
    const uploadedFilesData = {
      "SCH1_Example.csv": [
        // Agent 101 - Should qualify, get adjusted, payout tiered, and split
        { "Sales Employee": "101", "Net Value": 50000, "Document Date": "2024-12-05", "Sales Organization": "1810", "Payer": "CUST001", "Delivery Status": "Fully Delivered" },
        { "Sales Employee": "101", "Net Value": 30000, "Document Date": "2024-12-15", "Sales Organization": "1810", "Payer": "CUST003", "Delivery Status": "Partially" },
        // Agent 102 - Should be excluded by Payer
        { "Sales Employee": "102", "Net Value": 90000, "Document Date": "2024-12-10", "Sales Organization": "1810", "Payer": "17100002", "Delivery Status": "Fully Delivered" },
        // Agent 103 - Below MinSales threshold
        { "Sales Employee": "103", "Net Value": 40000, "Document Date": "2024-12-20", "Sales Organization": "1810", "Payer": "CUST004", "Delivery Status": "Partially" },
        // Agent 104 - Wrong Sales Org
        { "Sales Employee": "104", "Net Value": 80000, "Document Date": "2024-12-22", "Sales Organization": "1910", "Payer": "CUST005", "Delivery Status": "Fully Delivered" },
         // Agent 101 - Outside date range (before)
         { "Sales Employee": "101", "Net Value": 10000, "Document Date": "2024-11-30", "Sales Organization": "1810", "Payer": "CUST006", "Delivery Status": "Partially" },
         // Agent 101 - Outside date range (after run date)
         { "Sales Employee": "101", "Net Value": 10000, "Document Date": "2025-01-01", "Sales Organization": "1810", "Payer": "CUST007", "Delivery Status": "Partially" },
      ],
      "MH_DEC24_Example.csv": [
        { "AgentID": "101", "Level": "L1", "ManagerID": "MGR_A", "ReportsFrom": "2024-01-01", "ReportsToEnd": "2024-12-31" },
        { "AgentID": "101", "Level": "L2", "ManagerID": "MGR_B", "ReportsFrom": "2024-01-01", "ReportsToEnd": "2024-12-31" },
        // Manager for 103 (but 103 won't qualify)
        { "AgentID": "103", "Level": "L1", "ManagerID": "MGR_C", "ReportsFrom": "2024-01-01", "ReportsToEnd": "2024-12-31" },
         // Expired hierarchy for 101 L1
         { "AgentID": "101", "Level": "L1", "ManagerID": "MGR_OLD", "ReportsFrom": "2023-01-01", "ReportsToEnd": "2023-12-31" },
      ]
    };

    // 3. Define Run Date
    const runDate = "2024-12-31";

    // 4. Execute the Scheme
    try {
        const results = runScheme(schemeJson, uploadedFilesData, runDate);

        console.log("\n--- SCHEME EXECUTION RESULTS ---");
        console.log("\nAgent Payouts:");
        console.log(JSON.stringify(results.agentPayouts, null, 2));

        console.log("\nCredit Distributions:");
        console.log(JSON.stringify(results.creditDistributions, null, 2));

        console.log("\nRule Hit Logs (Agent 101):"); // Example: Log for one agent
        console.log(JSON.stringify(results.ruleHitLogs['101'], null, 2));

        console.log("\nRule Hit Logs (Agent 103):");
        console.log(JSON.stringify(results.ruleHitLogs['103'], null, 2));


        // console.log("\nRaw Processed Records (First 5):"); // Log sample raw data
        // console.log(JSON.stringify(results.rawRecordLevelData.slice(0, 5), null, 2));

    } catch (error) {
        console.error("\n--- ERROR RUNNING SCHEME ---");
        console.error(error);
    }
}

// runExample(); // Uncomment to run the example when executing this file
*/

// --- Export for Node.js ---
// Allows this function to be imported and used in another module.
// If running directly or in a browser, this line might be removed or adjusted.
module.exports = { runScheme };
