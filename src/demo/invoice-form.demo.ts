import { FormControl } from '@angular/forms';
import { Subscription } from 'rxjs';
import {
  FormSchemaDefinition,
  CalculationContext,
  FormEngineService,
  FormControlConnectorService,
  FormValueState,
  FormMetadataState,
} from '../lib/index';

/**
 * Demonstrates how to configure and use the FormEngineService and FormControlConnectorService
 * for a complex invoice form with a nested table and 1,000 row batch imports.
 */
export class InvoiceFormDemo {
  public static createInvoiceSchema(): FormSchemaDefinition {
    return {
      fieldDefinitions: [
        {
          fieldPath: 'invoice.number',
          initialValue: 'INV-2026-001',
          dependencyPaths: [],
          validatorCalculationFunctions: [
            (fieldValue: unknown): Record<string, string> | null => {
              const stringValue: string = String(fieldValue ?? '');
              return stringValue.trim().length === 0 ? { required: 'Invoice number is required.' } : null;
            },
          ],
        },
        {
          fieldPath: 'invoice.discountRate',
          initialValue: 0,
          dependencyPaths: ['invoice.subtotal'],
          editabilityCalculationFunction: (context: CalculationContext): boolean => {
            const currentSubtotal: number = Number(context.values['invoice.subtotal'] ?? 0);
            return currentSubtotal >= 100; // Discount only editable if subtotal >= 100
          },
          validatorCalculationFunctions: [
            (fieldValue: unknown): Record<string, string> | null => {
              const discountNumber: number = Number(fieldValue ?? 0);
              return discountNumber > 0.5 ? { maxDiscount: 'Discount rate cannot exceed 50%.' } : null;
            },
          ],
        },
        {
          fieldPath: 'invoice.subtotal',
          initialValue: 0,
          dependencyPaths: ['items.total'],
          valueCalculationFunction: (context: CalculationContext): unknown => {
            const activeRowIndices: ReadonlyArray<number> =
              (context.values['items.rowIndices'] as ReadonlyArray<number>) ?? [];

            // Declarative functional reduction of all table row totals
            const calculatedSubtotal: number = activeRowIndices.reduce(
              (accumulatedSum: number, rowIndex: number): number => {
                const rowTotalValue: number = Number(context.values[`items.${rowIndex}.total`] ?? 0);
                return accumulatedSum + rowTotalValue;
              },
              0
            );
            return calculatedSubtotal;
          },
        },
        {
          fieldPath: 'invoice.grandTotal',
          initialValue: 0,
          dependencyPaths: ['invoice.subtotal', 'invoice.discountRate'],
          valueCalculationFunction: (context: CalculationContext): unknown => {
            const subtotalValue: number = Number(context.values['invoice.subtotal'] ?? 0);
            const discountRateValue: number = Number(context.values['invoice.discountRate'] ?? 0);
            return subtotalValue * (1 - discountRateValue);
          },
        },
      ],
      tableDefinitions: [
        {
          tablePath: 'items',
          dependencyPaths: [],
          columnDefinitions: [
            {
              columnPath: 'productName',
              initialValue: '',
              dependencyPaths: [],
            },
            {
              columnPath: 'unitPrice',
              initialValue: 0,
              dependencyPaths: [],
            },
            {
              columnPath: 'quantity',
              initialValue: 1,
              dependencyPaths: [],
              validatorCalculationFunctions: [
                (fieldValue: unknown): Record<string, string> | null => {
                  const quantityNumber: number = Number(fieldValue ?? 0);
                  return quantityNumber <= 0 ? { minQuantity: 'Quantity must be greater than zero.' } : null;
                },
              ],
            },
            {
              columnPath: 'total',
              initialValue: 0,
              dependencyPaths: ['unitPrice', 'quantity'],
              valueCalculationFunction: (context: CalculationContext): unknown => {
                if (context.currentRowIndex === undefined || !context.currentTablePath) {
                  return 0;
                }
                const unitPriceValue: number = Number(
                  context.values[`${context.currentTablePath}.${context.currentRowIndex}.unitPrice`] ?? 0
                );
                const quantityValue: number = Number(
                  context.values[`${context.currentTablePath}.${context.currentRowIndex}.quantity`] ?? 0
                );
                return unitPriceValue * quantityValue;
              },
            },
          ],
        },
      ],
    };
  }

  /**
   * Runs the demo execution to verify state structure, calculation speed, and control binding.
   */
  public static runVerificationDemo(): void {
    const formEngineService: FormEngineService = new FormEngineService();
    const connectorService: FormControlConnectorService = new FormControlConnectorService(formEngineService);
    const invoiceSchemaDefinition: FormSchemaDefinition = InvoiceFormDemo.createInvoiceSchema();

    // 1. Initialize form
    formEngineService.initializeForm(invoiceSchemaDefinition);

    // 2. Test control binding
    const discountFormControl: FormControl = new FormControl(0);
    const controlSubscription: Subscription = connectorService.bindControlToField(
      'invoice.discountRate',
      discountFormControl
    );

    // Verify initial disabled state (since subtotal is 0 < 100, discount should be disabled)
    console.log('Initial discount control disabled state:', discountFormControl.disabled);

    // 3. Batch import 1,000 items into table
    const bulkRowsData: ReadonlyArray<Record<string, unknown>> = Array.from(
      { length: 1000 },
      (_, itemIndex: number): Record<string, unknown> => ({
        productName: `Product item #${itemIndex + 1}`,
        unitPrice: 10,
        quantity: 2, // Total per row will be 20
      })
    );

    const startTimeMilliseconds: number = Date.now();
    formEngineService.batchImportTableRows('items', bulkRowsData);
    const endTimeMilliseconds: number = Date.now();

    console.log(
      `Imported and calculated 1,000 table rows in ${endTimeMilliseconds - startTimeMilliseconds} ms.`
    );

    const valueStateSnapshot: FormValueState = formEngineService.valueStateSignal();
    const metadataStateSnapshot: FormMetadataState = formEngineService.metadataStateSignal();

    console.log('Calculated subtotal (expected 20,000):', valueStateSnapshot['invoice.subtotal']);
    console.log('Is discount rate editable now? (expected true):', metadataStateSnapshot['invoice.discountRate']?.isEditable);
    console.log('Discount control disabled state after subtotal increase:', discountFormControl.disabled);

    // Clean up subscriptions
    controlSubscription.unsubscribe();
  }
}
