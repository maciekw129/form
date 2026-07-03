import {
  RecursiveFormSchemaDefinition,
  FormulaRuleDefinition,
  CalculationContext,
  FormEngineService,
  FormValueState,
} from '../lib/index';

/**
 * Demonstrates how to use recursive tree schemas with formula objects and an evaluator delegate.
 */
export class RecursiveSchemaDemo {
  public static createRecursiveSchema(): RecursiveFormSchemaDefinition {
    return {
      rootFields: [
        {
          fieldName: 'invoice',
          fieldPath: 'invoice',
          fieldType: 'object',
          properties: [
            {
              fieldName: 'number',
              fieldPath: 'invoice.number',
              fieldType: 'string',
              initialValue: 'REC-2026-999',
            },
            {
              fieldName: 'taxRate',
              fieldPath: 'invoice.taxRate',
              fieldType: 'number',
              initialValue: 0.2, // 20%
              visibilityCalculationRule: {
                type: 'constant',
                value: true,
              },
            },
            {
              fieldName: 'subtotal',
              fieldPath: 'invoice.subtotal',
              fieldType: 'number',
              initialValue: 0,
              valueCalculationRule: {
                type: 'formula',
                functionName: 'SUM_TABLE_COLUMN',
                parameters: ['items.total'],
              },
            },
            {
              fieldName: 'totalTax',
              fieldPath: 'invoice.totalTax',
              fieldType: 'number',
              initialValue: 0,
              valueCalculationRule: {
                type: 'formula',
                functionName: 'MULTIPLY',
                parameters: [{ fieldPath: 'invoice.subtotal' }, { fieldPath: 'invoice.taxRate' }],
              },
            },
            {
              fieldName: 'grandTotal',
              fieldPath: 'invoice.grandTotal',
              fieldType: 'number',
              initialValue: 0,
              valueCalculationRule: {
                type: 'formula',
                functionName: 'ADD',
                parameters: [{ fieldPath: 'invoice.subtotal' }, { fieldPath: 'invoice.totalTax' }],
              },
            },
          ],
        },
        {
          fieldName: 'items',
          fieldPath: 'items',
          fieldType: 'array',
          properties: [
            {
              fieldName: 'productName',
              fieldPath: 'productName',
              fieldType: 'string',
              initialValue: '',
            },
            {
              fieldName: 'price',
              fieldPath: 'price',
              fieldType: 'number',
              initialValue: 0,
            },
            {
              fieldName: 'quantity',
              fieldPath: 'quantity',
              fieldType: 'number',
              initialValue: 1,
            },
            {
              fieldName: 'total',
              fieldPath: 'total',
              fieldType: 'number',
              initialValue: 0,
              valueCalculationRule: {
                type: 'formula',
                functionName: 'MULTIPLY',
                parameters: [{ fieldPath: 'price' }, { fieldPath: 'quantity' }],
              },
            },
          ],
        },
      ],
    };
  }

  /**
   * Sample frontend evaluator function that simulates the user's ready-made formula evaluator.
   */
  public static evaluateFormula(
    formulaRuleDefinition: FormulaRuleDefinition,
    calculationContext: CalculationContext
  ): unknown {
    const resolveParameterValue = (parameter: unknown): unknown => {
      if (parameter && typeof parameter === 'object') {
        const recordObject: Record<string, unknown> = parameter as Record<string, unknown>;
        if (typeof recordObject['fieldPath'] === 'string') {
          const targetPath: string = recordObject['fieldPath'];
          // Check if path is relative inside table row
          if (
            calculationContext.currentRowIndex !== undefined &&
            calculationContext.currentTablePath &&
            !targetPath.includes('.')
          ) {
            const absoluteCellPath: string = `${calculationContext.currentTablePath}.${calculationContext.currentRowIndex}.${targetPath}`;
            return calculationContext.values[absoluteCellPath];
          }
          return calculationContext.values[targetPath];
        }
      }
      return parameter;
    };

    const resolvedArguments: ReadonlyArray<unknown> = formulaRuleDefinition.parameters.map(
      resolveParameterValue
    );

    switch (formulaRuleDefinition.functionName) {
      case 'MULTIPLY': {
        const firstNumber: number = Number(resolvedArguments[0] ?? 0);
        const secondNumber: number = Number(resolvedArguments[1] ?? 0);
        return firstNumber * secondNumber;
      }
      case 'ADD': {
        const firstNumber: number = Number(resolvedArguments[0] ?? 0);
        const secondNumber: number = Number(resolvedArguments[1] ?? 0);
        return firstNumber + secondNumber;
      }
      case 'SUM_TABLE_COLUMN': {
        const columnPathToSum: string = String(resolvedArguments[0] ?? '');
        const activeRowIndices: ReadonlyArray<number> =
          (calculationContext.values['items.rowIndices'] as ReadonlyArray<number>) ?? [];

        return activeRowIndices.reduce((accumulatedSum: number, rowIndex: number): number => {
          const cellValue: number = Number(calculationContext.values[`items.${rowIndex}.total`] ?? 0);
          return accumulatedSum + cellValue;
        }, 0);
      }
      default:
        return null;
    }
  }

  public static runVerificationDemo(): void {
    const formEngineService: FormEngineService = new FormEngineService();
    const recursiveSchemaDefinition: RecursiveFormSchemaDefinition =
      RecursiveSchemaDemo.createRecursiveSchema();

    console.log('Initializing form from recursive tree schema...');
    formEngineService.initializeFromRecursiveSchema(
      recursiveSchemaDefinition,
      RecursiveSchemaDemo.evaluateFormula
    );

    const bulkRowsData: ReadonlyArray<Record<string, unknown>> = Array.from(
      { length: 500 },
      (_, itemIndex: number): Record<string, unknown> => ({
        productName: `Recursive item #${itemIndex + 1}`,
        price: 100,
        quantity: 3, // Total per row = 300
      })
    );

    const startTimeMilliseconds: number = Date.now();
    formEngineService.batchImportTableRows('items', bulkRowsData);
    const endTimeMilliseconds: number = Date.now();

    console.log(
      `Imported and calculated 500 table rows via Recursive Schema & Formula Delegate in ${endTimeMilliseconds - startTimeMilliseconds} ms.`
    );

    const valueStateSnapshot: FormValueState = formEngineService.valueStateSignal();
    console.log('Calculated invoice.subtotal (expected 150,000):', valueStateSnapshot['invoice.subtotal']);
    console.log('Calculated invoice.totalTax (20%, expected 30,000):', valueStateSnapshot['invoice.totalTax']);
    console.log('Calculated invoice.grandTotal (expected 180,000):', valueStateSnapshot['invoice.grandTotal']);
  }
}
