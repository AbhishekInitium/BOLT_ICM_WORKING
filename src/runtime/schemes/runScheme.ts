import Decimal from 'decimal.js';

// --- Helper Functions ---

/**
 * Safely gets a nested property from an object.
 * @param {object} obj The object to query.
 * @param {string} path Dot-separated path string (e.g., "a.b.c").
 * @param {*} defaultValue The value to return if the path is not found.
 * @returns {*} The value found at the path or the default value.
 */
function safeGet(obj: any, path: string, defaultValue: any = undefined) {
  if (!obj || typeof path !== 'string') {
    return defaultValue;
  }
  try {
    return path
      .split('.')
      .reduce(
        (acc, key) => (acc && acc[key] !== undefined ? acc[key] : defaultValue),
        obj
      );
  } catch (e) {
    return defaultValue;
  }
}

/**
 * Parses a date string into a Date object. Assumes YYYY-MM-DD format.
 * Returns null for invalid dates.
 * @param {string} dateString
 * @returns {Date | null}
 */
function parseDate(dateString: string): Date | null {
  if (!dateString || typeof dateString !== 'string') return null;
  const date = new Date(dateString + 'T00:00:00Z'); // Treat as UTC to avoid timezone issues
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Compares two dates, ignoring time.
 * @param {Date} date1
 * @param {Date} date2
 * @returns {number} -1 if date1 < date2, 0 if equal, 1 if date1 > date2
 */
function compareDates(date1: Date | null, date2: Date | null): number {
  if (!date1 || !date2) return NaN; // Handle null/invalid dates
  const d1 = new Date(
    Date.UTC(date1.getUTCFullYear(), date1.getUTCMonth(), date1.getUTCDate())
  );
  const d2 = new Date(
    Date.UTC(date2.getUTCFullYear(), date2.getUTCMonth(), date2.getUTCDate())
  );
  if (d1 < d2) return -1;
  if (d1 > d2) return 1;
  return 0;
}

/**
 * Formats a Decimal.js number to a fixed string representation.
 * @param {Decimal} decimalValue
 * @param {number} precision
 * @returns {string}
 */
function formatDecimal(decimalValue: Decimal, precision: number = 2): string {
  if (!(decimalValue instanceof Decimal)) {
    return new Decimal(0).toFixed(precision);
  }
  return decimalValue.toFixed(precision);
}

/**
 * Evaluates a rule condition against a record's value.
 * @param {*} recordValue The actual value from the record.
 * @param {string} operator The comparison operator (e.g., '=', '>=', 'CONTAINS').
 * @param {*} ruleValue The value defined in the rule.
 * @param {string} dataType The expected data type ('String', 'Number', 'Date').
 * @returns {boolean} True if the condition is met, false otherwise.
 */
function evaluateCondition(
  recordValue: any,
  operator: string,
  ruleValue: any,
  dataType: string = 'String'
): boolean {
  // Handle null/undefined record values gracefully
  if (recordValue === null || recordValue === undefined) {
    return (
      operator === '=' &&
      (ruleValue === null || ruleValue === undefined || ruleValue === '')
    );
  }

  let rv = recordValue;
  let val = ruleValue;

  if (dataType === 'Number') {
    rv = new Decimal(recordValue || 0);
    val = new Decimal(ruleValue || 0);
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
        return false;
    }
  } else if (dataType === 'Date') {
    rv = parseDate(recordValue);
    val = parseDate(ruleValue);
    if (!rv || !val) return false; // Cannot compare invalid dates
    const comparison = compareDates(rv, val);
    switch (operator) {
      case '=':
        return comparison === 0;
      case '!=':
        return comparison !== 0;
      case '>':
        return comparison === 1;
      case '>=':
        return comparison === 1 || comparison === 0;
      case '<':
        return comparison === -1;
      case '<=':
        return comparison === -1 || comparison === 0;
      default:
        return false;
    }
  } else {
    // Default to String comparison
    rv = String(recordValue).trim();
    val = String(ruleValue).trim();
    const rvLower = rv.toLowerCase();
    const valLower = val.toLowerCase();

    switch (operator) {
      case '=':
        return rvLower === valLower;
      case '!=':
        return rvLower !== valLower;
      case 'CONTAINS':
        return rvLower.includes(valLower);
      case 'STARTSWITH':
        return rvLower.startsWith(valLower);
      case 'ENDSWITH':
        return rvLower.endsWith(valLower);
      default:
        return false;
    }
  }
}

/**
 * Finds the manager for a given agent and level from the hierarchy data,
 * considering the effective date range.
 * @param {string} agentId The ID of the agent whose manager is needed.
 * @param {string} level The hierarchy level (e.g., 'L1', 'L2').
 * @param {Array<object>} hierarchyData Array of hierarchy records.
 * @param {Date} schemeEffectiveFrom Start date of the scheme period.
 * @param {Date} runAsDate The 'as of' date for the calculation run.
 * @returns {string | null} The ManagerID or null if not found/valid.
 */
function findManager(
  agentId: string,
  level: string,
  hierarchyData: any[],
  schemeEffectiveFrom: Date,
  runAsDate: Date
): string | null {
  if (
    !agentId ||
    !level ||
    !hierarchyData ||
    !schemeEffectiveFrom ||
    !runAsDate
  ) {
    return null;
  }

  const targetAgentId = String(agentId); // Ensure string comparison

  for (const row of hierarchyData) {
    // Match agent and level (case-insensitive recommended for robustness)
    if (
      String(safeGet(row, 'AgentID')).toLowerCase() ===
        targetAgentId.toLowerCase() &&
      String(safeGet(row, 'Level')).toUpperCase() === level.toUpperCase()
    ) {
      const reportsFrom = parseDate(safeGet(row, 'ReportsFrom'));
      const reportsToEnd = parseDate(safeGet(row, 'ReportsToEnd'));

      // Check for date overlap:
      // The hierarchy record must be valid during *some part* of the scheme period being run.
      // [hierStart, hierEnd] must overlap with [schemeStart, runAsDate]
      if (
        reportsFrom &&
        reportsToEnd &&
        compareDates(reportsFrom, runAsDate) <= 0 && // Hierarchy starts on or before run date
        compareDates(reportsToEnd, schemeEffectiveFrom) >= 0
      ) {
        // Hierarchy ends on or after scheme start date
        return safeGet(row, 'ManagerID', null);
      }
    }
  }
  return null; // No valid manager found
}

/**
 * Calculates payout based on marginal tiers.
 * @param {Decimal} amount The total credited amount.
 * @param {Array<object>} tiers The payout tiers configuration.
 * @returns {Decimal} The calculated base payout.
 */
function calculateMarginalTieredPayout(amount: Decimal, tiers: any[]): Decimal {
  if (!(amount instanceof Decimal) || !tiers || tiers.length === 0) {
    return new Decimal(0);
  }

  let totalPayout = new Decimal(0);
  let remainingAmount = amount;
  const sortedTiers = [...tiers].sort((a, b) => a.from - b.from); // Ensure tiers are sorted by 'from'

  for (const tier of sortedTiers) {
    const tierFrom = new Decimal(tier.from || 0);
    // Use Infinity for unbounded 'to', handle null/undefined 'to'
    const tierTo =
      tier.to === null || tier.to === undefined
        ? Decimal.Infinity
        : new Decimal(tier.to);
    const rate = new Decimal(tier.rate || 0);
    const isPercentage = tier.isPercentage !== false; // Default to true if undefined

    if (amount.lte(tierFrom)) {
      // Amount is below the start of this tier (and all subsequent tiers)
      break;
    }

    // Determine the amount applicable within this tier's range
    const tierRangeStart = tierFrom;
    const tierRangeEnd = tierTo;

    // Amount falling into this specific tier = min(Amount, TierEnd) - TierStart
    const effectiveAmountInTier = Decimal.min(amount, tierRangeEnd).minus(
      tierRangeStart
    );

    if (effectiveAmountInTier.lte(0)) {
      continue; // No portion of the amount falls into this specific tier range calculation part
    }

    // Calculate payout for the portion in this tier
    let tierPayout;
    if (isPercentage) {
      // Payout is rate % of the amount *within* this tier's bounds
      tierPayout = effectiveAmountInTier.times(rate).dividedBy(100);
    } else {
      // Fixed amount payout (interpret as fixed amount *per unit* in the tier)
      tierPayout = effectiveAmountInTier.times(rate);
    }

    totalPayout = totalPayout.plus(tierPayout);

    // Optimization: If the total amount is less than or equal to the end of this tier,
    // we have processed all relevant parts of the amount.
    if (amount.lte(tierRangeEnd)) {
      break;
    }
  }

  return totalPayout;
}

/**
 * Executes a sales incentive scheme based on provided configuration and data.
 *
 * @param {object} scheme The scheme configuration JSON.
 * @param {object} uploadedFiles An object mapping filenames to arrays of data rows.
 * @param {string} runAsOfDate The date (YYYY-MM-DD) to run the calculation up to.
 * @returns {object} An object containing results:
 *      { agentPayouts, ruleHitLogs, creditDistributions, rawRecordLevelData }
 */
export function runScheme(scheme: any, uploadedFiles: any, runAsOfDate: string) {
  console.log(`Running scheme ${scheme.name} as of ${runAsOfDate}`);

  // --- Initializations ---
  const agentPayouts: Record<string, string> = {};
  const ruleHitLogs: Record<string, any[]> = {};
  const creditDistributions: Record<string, any[]> = {};
  const rawRecordLevelData: any[] = [];

  const runDate = parseDate(runAsOfDate);
  const schemeStart = parseDate(scheme.effectiveFrom);
  const schemeEnd = parseDate(scheme.effectiveTo);

  if (!runDate || !schemeStart) {
    throw new Error(
      'Invalid runAsOfDate or scheme.effectiveFrom date format. Use YYYY-MM-DD.'
    );
  }

  // Validate essential scheme components
  if (
    !scheme.baseMapping ||
    !scheme.baseMapping.sourceFile ||
    !scheme.baseMapping.agentField ||
    !scheme.baseMapping.amountField
  ) {
    throw new Error('Scheme is missing essential baseMapping configuration.');
  }

  if (!scheme.payoutTiers) {
    console.warn(`Scheme ${scheme.name} has no payoutTiers defined.`);
    scheme.payoutTiers = [];
  }

  const baseDataFile = scheme.baseMapping.sourceFile;
  const agentIdField = scheme.baseMapping.agentField;
  const amountField = scheme.baseMapping.amountField;
  const hierarchyFile = scheme.creditHierarchyFile;

  const baseData = uploadedFiles[baseDataFile]?.data;
  const hierarchyData = hierarchyFile ? uploadedFiles[hierarchyFile]?.data : [];

  if (!baseData || !Array.isArray(baseData)) {
    throw new Error(
      `Base data file "${baseDataFile}" not found in uploadedFiles or data is not an array.`
    );
  }

  if (hierarchyFile && (!hierarchyData || !Array.isArray(hierarchyData))) {
    console.warn(
      `Hierarchy file "${hierarchyFile}" specified but not found in uploadedFiles or data is not an array. Credit splits may fail.`
    );
  }

  // --- Build Field Mappings from kpiConfig ---
  const fieldMap: Record<string, { sourceField: string; dataType: string; evaluationLevel: string; aggregation: string }> = {};
  const allKpiFields = [
    ...(scheme.kpiConfig?.baseData || []),
    ...(scheme.kpiConfig?.qualificationFields || []),
    ...(scheme.kpiConfig?.adjustmentFields || []),
    ...(scheme.kpiConfig?.exclusionFields || []),
    ...(scheme.kpiConfig?.creditFields || []),
  ];

  allKpiFields.forEach((f: any) => {
    if (f.name && f.sourceField && f.sourceFile === baseDataFile) {
      fieldMap[f.name] = {
        sourceField: f.sourceField,
        dataType: f.dataType || 'String',
        evaluationLevel: f.evaluationLevel || 'Per Record',
        aggregation: f.aggregation || 'NotApplicable',
      };
    }
  });

  // Ensure base mapping fields are also included if not explicitly in kpiConfig baseData
  if (!fieldMap['Agent'])
    fieldMap['Agent'] = {
      sourceField: agentIdField,
      dataType: 'String',
      evaluationLevel: 'Per Record',
      aggregation: 'NotApplicable',
    };
  if (!fieldMap['Amount'])
    fieldMap['Amount'] = {
      sourceField: amountField,
      dataType: 'Number',
      evaluationLevel: 'Per Record',
      aggregation: 'NotApplicable',
    };

  // Helper to get the actual source field name
  const getSourceField = (ruleFieldName: string) =>
    fieldMap[ruleFieldName]?.sourceField;
  const getDataType = (ruleFieldName: string) =>
    fieldMap[ruleFieldName]?.dataType || 'String';
  const getEvaluationLevel = (ruleFieldName: string) =>
    fieldMap[ruleFieldName]?.evaluationLevel || 'Per Record';
  const getAggregation = (ruleFieldName: string) =>
    fieldMap[ruleFieldName]?.aggregation || 'NotApplicable';

  // --- 1. Select and Filter Base Records ---
  console.log(
    `Filtering records from ${baseDataFile} between ${scheme.effectiveFrom} and ${runAsOfDate}...`
  );
  const potentiallyRelevantRecords = baseData.map((record: any, index: number) => ({
    ...record,
    _originalIndex: index,
    _recordId: `${baseDataFile}-${index}`,
  }));

  // Date Filtering - Use the transactionDateField from baseMapping
  const transactionDateField = scheme.baseMapping.transactionDateField;
  if (!transactionDateField || !(transactionDateField in (potentiallyRelevantRecords[0] || {}))) {
    console.warn(
      `!! Warning: Cannot find transaction date field '${transactionDateField}' in ${baseDataFile}. Date filtering will be skipped.`
    );
  }

  const dateFilteredRecords = potentiallyRelevantRecords.filter((record: any) => {
    const recordDateStr = safeGet(record, transactionDateField);
    if (!recordDateStr) return false;

    const recordDate = parseDate(recordDateStr);
    return (
      recordDate &&
      compareDates(recordDate, schemeStart) >= 0 &&
      compareDates(recordDate, runDate) <= 0
    );
  });

  console.log(
    `Found ${dateFilteredRecords.length} records within the date range.`
  );

  // --- 2. Apply 'Per Record' Qualification Rules ---
  const recordLevelQualRules = (scheme.qualificationRules || []).filter(
    (rule: any) => {
      const evalLevel = getEvaluationLevel(rule.field);
      return evalLevel === 'Per Record';
    }
  );

  const qualifiedRecords = dateFilteredRecords.filter((record: any) => {
    for (const rule of recordLevelQualRules) {
      const sourceField = getSourceField(rule.field);
      const dataType = getDataType(rule.field);
      if (!sourceField) {
        console.warn(
          `Skipping record qualification rule ${rule.id}: Cannot find source field for '${rule.field}'.`
        );
        continue;
      }
      const recordValue = safeGet(record, sourceField);
      if (
        !evaluateCondition(recordValue, rule.operator, rule.value, dataType)
      ) {
        return false;
      }
    }
    return true;
  });

  console.log(
    `${qualifiedRecords.length} records passed record-level qualification.`
  );

  // --- 3. Group Records by Agent ---
  const recordsByAgent = qualifiedRecords.reduce((acc: Record<string, any[]>, record: any) => {
    const agentId = String(safeGet(record, agentIdField, 'UNKNOWN_AGENT'));
    if (!acc[agentId]) {
      acc[agentId] = [];
    }
    acc[agentId].push(record);
    return acc;
  }, {});

  console.log(
    `Grouped records for ${Object.keys(recordsByAgent).length} agents.`
  );

  // --- 4. Process Each Agent ---
  for (const agentId in recordsByAgent) {
    console.log(`Processing agent: ${agentId}`);
    const agentRecords = recordsByAgent[agentId];
    let agentTotalCreditedAmount = new Decimal(0);
    const agentRuleLogs = [];

    // --- 4a. Record-Level Processing (Exclusion, Adjustment, Custom) ---
    const processedAgentRecords = agentRecords.map((record: any) => {
      let isExcluded = false;
      let exclusionReason = null;
      let adjustmentApplied = null;
      let customRuleApplied = null;

      const originalAmount = new Decimal(safeGet(record, amountField, 0));
      let currentAmount = originalAmount;
      let rateMultiplier = new Decimal(1);

      // --- 4a.i. Apply Exclusion Rules ---
      for (const rule of scheme.exclusionRules || []) {
        const sourceField = getSourceField(rule.field);
        const dataType = getDataType(rule.field);
        if (!sourceField) {
          console.warn(
            `Skipping exclusion rule ${rule.id}: Cannot find source field for '${rule.field}'.`
          );
          continue;
        }
        const recordValue = safeGet(record, sourceField);

        if (
          evaluateCondition(recordValue, rule.operator, rule.value, dataType)
        ) {
          isExcluded = true;
          exclusionReason = `Excluded by rule ${rule.id} (${rule.field} ${rule.operator} ${rule.value})`;
          agentRuleLogs.push({
            ruleType: 'Exclusion',
            ruleId: rule.id,
            recordId: record._recordId,
            agentId: agentId,
            message: exclusionReason,
            timestamp: new Date().toISOString(),
          });
          break;
        }
      }

      // --- 4a.ii. Apply Adjustment Rules (only if not excluded) ---
      if (!isExcluded) {
        for (const rule of scheme.adjustmentRules || []) {
          const conditionField = getSourceField(rule.condition.field);
          const conditionDataType = getDataType(rule.condition.field);
          if (!conditionField) {
            console.warn(
              `Skipping adjustment rule ${rule.id} condition: Cannot find source field for '${rule.condition.field}'.`
            );
            continue;
          }
          const conditionValue = safeGet(record, conditionField);

          if (
            evaluateCondition(
              conditionValue,
              rule.condition.operator,
              rule.condition.value,
              conditionDataType
            )
          ) {
            const adjTarget = rule.adjustment.target;
            const adjType = rule.adjustment.type;
            const adjValue = new Decimal(rule.adjustment.value || 0);

            adjustmentApplied = `Adjusted by rule ${rule.id}`;
            let logMessage = `Adjustment Rule ${rule.id} triggered: `;

            if (adjTarget === 'Rate' && adjType === 'percentage') {
              const multiplierChange = adjValue.dividedBy(100);
              rateMultiplier = rateMultiplier.times(multiplierChange);
              logMessage += `Rate multiplier changed by ${adjValue}% to ${formatDecimal(
                rateMultiplier,
                4
              )}`;
            } else if (adjTarget === 'Amount' && adjType === 'percentage') {
              const increase = currentAmount.times(adjValue).dividedBy(100);
              currentAmount = currentAmount.plus(increase);
              logMessage += `Amount adjusted by ${adjValue}% to ${formatDecimal(
                currentAmount
              )}`;
            } else if (adjTarget === 'Amount' && adjType === 'fixed') {
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
              timestamp: new Date().toISOString(),
            });
          }
        }
      }

      // --- 4a.iii. Apply Custom Rules (Placeholder) ---
      if (!isExcluded && scheme.customRules && scheme.customRules.length > 0) {
        console.warn(
          `Agent ${agentId}, Record ${record._recordId}: Custom rules exist but logic is not implemented.`
        );
        customRuleApplied = 'Custom rules present but not executed.';
      }

      // --- Calculate final adjusted amount for this record ---
      const adjustedAmount = isExcluded
        ? new Decimal(0)
        : currentAmount.times(rateMultiplier);

      // Store processed data for the raw output
      const processedRecord = {
        ...record,
        originalAmount: formatDecimal(originalAmount),
        rateMultiplier: formatDecimal(rateMultiplier, 4),
        adjustedAmount: formatDecimal(adjustedAmount),
        isExcluded: isExcluded,
        exclusionReason: exclusionReason,
        adjustmentApplied: adjustmentApplied,
        customRuleApplied: customRuleApplied,
      };
      rawRecordLevelData.push(processedRecord);

      // Add to agent's total if not excluded
      if (!isExcluded) {
        agentTotalCreditedAmount =
          agentTotalCreditedAmount.plus(adjustedAmount);
      }

      return processedRecord;
    });

    console.log(
      `Agent ${agentId}: Initial summed amount = ${formatDecimal(
        agentTotalCreditedAmount
      )}`
    );

    // --- 4b. Apply 'Agent' Level Qualification Rules ---
    let agentQualified = true;
    if (agentTotalCreditedAmount.lte(0)) {
      agentQualified = false;
      console.log(
        `Agent ${agentId}: Skipping payout calculation (zero credited amount).`
      );
    } else {
      const agentLevelQualRules = (scheme.qualificationRules || []).filter(
        (rule: any) => {
          const evalLevel = getEvaluationLevel(rule.field);
          const aggregation = getAggregation(rule.field);
          return (
            evalLevel === 'Agent' &&
            (aggregation === 'Sum' || aggregation === 'NotApplicable')
          );
        }
      );

      for (const rule of agentLevelQualRules) {
        if (
          rule.field === 'MinSales' &&
          getSourceField(rule.field) === amountField
        ) {
          const ruleValue = rule.value;
          const dataType = getDataType(rule.field);

          if (
            !evaluateCondition(
              agentTotalCreditedAmount,
              rule.operator,
              ruleValue,
              dataType
            )
          ) {
            agentQualified = false;
            const message = `Agent failed qualification rule ${
              rule.id
            }: Total Amount ${formatDecimal(agentTotalCreditedAmount)} ${
              rule.operator
            } ${ruleValue} is false.`;
            console.log(`Agent ${agentId}: ${message}`);
            agentRuleLogs.push({
              ruleType: 'Qualification',
              ruleId: rule.id,
              agentId: agentId,
              message: message,
              timestamp: new Date().toISOString(),
            });
            break;
          }
        } else {
          console.warn(
            `Agent ${agentId}: Skipping Agent-level qualification rule ${rule.id} for field ${rule.field}. Only rules on the primary summed amount (like MinSales) are currently supported.`
          );
        }
      }
    }

    // --- 4c. Calculate Payout Tiers (if qualified and amount > 0) ---
    let basePayout = new Decimal(0);
    if (agentQualified) {
      basePayout = calculateMarginalTieredPayout(
        agentTotalCreditedAmount,
        scheme.payoutTiers
      );
      console.log(
        `Agent ${agentId}: Base payout calculated = ${formatDecimal(
          basePayout
        )}`
      );
    } else {
      console.log(
        `Agent ${agentId}: No payout due to qualification failure or zero amount.`
      );
    }

    // Store the agent's *own* potential base payout before splits
    agentPayouts[agentId] = formatDecimal(basePayout);

    // --- 4d. Apply Credit Splits (if base payout > 0) ---
    if (
      basePayout.greaterThan(0) &&
      scheme.creditSplits &&
      scheme.creditSplits.length > 0 &&
      hierarchyData
    ) {
      console.log(`Agent ${agentId}: Applying credit splits...`);
      for (const split of scheme.creditSplits) {
        const role = split.role;
        const percentage = new Decimal(split.percentage || 0);

        if (percentage.lte(0)) continue;

        const managerId = findManager(
          agentId,
          role,
          hierarchyData,
          schemeStart,
          runDate
        );

        if (managerId) {
          const splitAmount = basePayout.times(percentage).dividedBy(100);

          if (!creditDistributions[managerId]) {
            creditDistributions[managerId] = [];
          }
          const distributionRecord = {
            fromAgent: agentId,
            role: role,
            amount: formatDecimal(splitAmount),
            timestamp: new Date().toISOString(),
            splitRuleId: split.id,
            basePayout: formatDecimal(basePayout),
            percentage: formatDecimal(percentage, 4),
          };
          creditDistributions[managerId].push(distributionRecord);
          console.log(
            `Agent ${agentId}: Distributed ${formatDecimal(
              splitAmount
            )} (${percentage}%) to ${role} Manager ${managerId}`
          );

          agentRuleLogs.push({
            ruleType: 'CreditSplit',
            ruleId: split.id,
            agentId: agentId,
            message: `Distributed ${formatDecimal(
              splitAmount
            )} (${percentage}%) to ${role} Manager ${managerId}`,
            details: distributionRecord,
            timestamp: new Date().toISOString(),
          });
        } else {
          const message = `Agent ${agentId}: Could not find valid Manager for role ${role} to apply credit split ${split.id}.`;
          console.warn(message);
          agentRuleLogs.push({
            ruleType: 'CreditSplit',
            ruleId: split.id,
            agentId: agentId,
            message: message,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    if (agentRuleLogs.length > 0) {
      ruleHitLogs[agentId] = agentRuleLogs;
    }
  }

  console.log('Scheme processing complete.');

  return {
    agentPayouts,
    ruleHitLogs,
    creditDistributions,
    rawRecordLevelData,
  };
}