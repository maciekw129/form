import { Injectable, signal, computed, Signal, WritableSignal } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map, distinctUntilChanged } from 'rxjs/operators';
import {
  FormSchemaDefinition,
  FormFieldDefinition,
  FormTableDefinition,
  FormTableColumnDefinition,
  CalculationContext,
  ValidatorCalculationFunction,
} from '../models/form-schema.model';
import {
  FormStateSnapshot,
  FormValueState,
  FormMetadataState,
  FormFieldMetadataState,
} from '../models/form-state.model';
import { DependencyGraphSorter, GraphNodeDefinition } from './dependency-graph';
import {
  RecursiveFormSchemaDefinition,
  FormulaEvaluatorDelegate,
  FormulaDependencyExtractorDelegate,
} from '../models/recursive-schema.model';
import { SchemaFlattenerService } from './schema-flattener.service';

@Injectable({
  providedIn: 'root',
})
export class FormEngineService {
  private readonly formStateSnapshotSignal: WritableSignal<FormStateSnapshot> = signal<FormStateSnapshot>({
    values: {},
    metadata: {},
  });

  private readonly formStateSnapshotSubject: BehaviorSubject<FormStateSnapshot> =
    new BehaviorSubject<FormStateSnapshot>({
      values: {},
      metadata: {},
    });

  private activeSchemaDefinition: FormSchemaDefinition | null = null;
  private topologicalCalculationOrder: ReadonlyArray<GraphNodeDefinition> = [];
  private tableRowIndicesMap: Map<string, Array<number>> = new Map();

  public readonly formStateSignal: Signal<FormStateSnapshot> = this.formStateSnapshotSignal.asReadonly();

  public readonly valueStateSignal: Signal<FormValueState> = computed(
    (): FormValueState => this.formStateSnapshotSignal().values
  );

  public readonly metadataStateSignal: Signal<FormMetadataState> = computed(
    (): FormMetadataState => this.formStateSnapshotSignal().metadata
  );

  /**
   * Flattens a recursive tree schema definition and initializes the form engine.
   * Connects formula objects to the provided evaluator delegate and extracts dependencies.
   */
  public initializeFromRecursiveSchema(
    recursiveSchemaDefinition: RecursiveFormSchemaDefinition,
    evaluatorDelegate: FormulaEvaluatorDelegate,
    extractorDelegate?: FormulaDependencyExtractorDelegate,
    initialValues: Record<string, unknown> = {}
  ): void {
    const flattenerService: SchemaFlattenerService = new SchemaFlattenerService();
    const flattenedSchemaDefinition: FormSchemaDefinition = flattenerService.flattenSchema(
      recursiveSchemaDefinition,
      evaluatorDelegate,
      extractorDelegate
    );
    this.initializeForm(flattenedSchemaDefinition, initialValues);
  }

  /**
   * Initializes the form engine with a schema definition and optional initial values.
   */
  public initializeForm(
    schemaDefinition: FormSchemaDefinition,
    initialValues: Record<string, unknown> = {}
  ): void {
    this.activeSchemaDefinition = schemaDefinition;
    this.topologicalCalculationOrder = DependencyGraphSorter.createTopologicalEvaluationOrder(schemaDefinition);
    this.tableRowIndicesMap.clear();

    const initialValueState: FormValueState = {};
    const initialMetadataState: FormMetadataState = {};

    schemaDefinition.fieldDefinitions.forEach((fieldDefinition: FormFieldDefinition): void => {
      const fieldPath: string = fieldDefinition.fieldPath;
      initialValueState[fieldPath] =
        initialValues[fieldPath] !== undefined ? initialValues[fieldPath] : fieldDefinition.initialValue;

      initialMetadataState[fieldPath] = this.createDefaultMetadataState();
    });

    schemaDefinition.tableDefinitions.forEach((tableDefinition: FormTableDefinition): void => {
      const tablePath: string = tableDefinition.tablePath;
      this.tableRowIndicesMap.set(tablePath, []);
      initialValueState[`${tablePath}.rowCount`] = 0;
      initialValueState[`${tablePath}.rowIndices`] = [];
    });

    this.commitStateUpdate(initialValueState, initialMetadataState);
    this.executeFullCalculationPipeline();
  }

  /**
   * Updates a single field value and triggers the dependency graph evaluation pipeline.
   */
  public updateFieldValue(fieldPath: string, newValue: unknown): void {
    const currentStateSnapshot: FormStateSnapshot = this.formStateSnapshotSignal();
    const updatedValueState: FormValueState = Object.assign({}, currentStateSnapshot.values, {
      [fieldPath]: newValue,
    });
    const updatedMetadataState: FormMetadataState = Object.assign({}, currentStateSnapshot.metadata);

    this.commitStateUpdate(updatedValueState, updatedMetadataState);
    this.executeFullCalculationPipeline();
  }

  /**
   * Transactional batch import of multiple rows into a table without intermediate UI recalculation freezes.
   */
  public batchImportTableRows(
    tablePath: string,
    rowsData: ReadonlyArray<Record<string, unknown>>
  ): void {
    if (!this.activeSchemaDefinition) {
      throw new Error('Cannot import table rows before initializing form schema.');
    }

    const tableDefinition: FormTableDefinition | undefined =
      this.activeSchemaDefinition.tableDefinitions.find(
        (definition: FormTableDefinition): boolean => definition.tablePath === tablePath
      );

    if (!tableDefinition) {
      throw new Error(`Table definition not found for path: ${tablePath}`);
    }

    const currentStateSnapshot: FormStateSnapshot = this.formStateSnapshotSignal();
    const updatedValueState: FormValueState = Object.assign({}, currentStateSnapshot.values);
    const updatedMetadataState: FormMetadataState = Object.assign({}, currentStateSnapshot.metadata);

    const currentRowIndices: Array<number> = this.tableRowIndicesMap.get(tablePath) ?? [];
    const startingRowIndex: number = currentRowIndices.length;

    rowsData.forEach((rowData: Record<string, unknown>, itemIndex: number): void => {
      const assignedRowIndex: number = startingRowIndex + itemIndex;
      currentRowIndices.push(assignedRowIndex);

      tableDefinition.columnDefinitions.forEach((columnDefinition: FormTableColumnDefinition): void => {
        const cellPath: string = `${tablePath}.${assignedRowIndex}.${columnDefinition.columnPath}`;
        const providedCellValue: unknown = rowData[columnDefinition.columnPath];

        updatedValueState[cellPath] =
          providedCellValue !== undefined ? providedCellValue : columnDefinition.initialValue;
        updatedMetadataState[cellPath] = this.createDefaultMetadataState();
      });
    });

    this.tableRowIndicesMap.set(tablePath, currentRowIndices);
    updatedValueState[`${tablePath}.rowCount`] = currentRowIndices.length;
    updatedValueState[`${tablePath}.rowIndices`] = currentRowIndices;

    this.commitStateUpdate(updatedValueState, updatedMetadataState);
    this.executeFullCalculationPipeline();
  }

  /**
   * Removes a specific row index from a table and recalculates dependencies.
   */
  public removeTableRow(tablePath: string, targetRowIndex: number): void {
    const currentRowIndices: Array<number> = this.tableRowIndicesMap.get(tablePath) ?? [];
    const filteredRowIndices: Array<number> = currentRowIndices.filter(
      (rowIndex: number): boolean => rowIndex !== targetRowIndex
    );
    this.tableRowIndicesMap.set(tablePath, filteredRowIndices);

    const currentStateSnapshot: FormStateSnapshot = this.formStateSnapshotSignal();
    const updatedValueState: FormValueState = Object.assign({}, currentStateSnapshot.values);
    const updatedMetadataState: FormMetadataState = Object.assign({}, currentStateSnapshot.metadata);

    if (this.activeSchemaDefinition) {
      const tableDefinition: FormTableDefinition | undefined =
        this.activeSchemaDefinition.tableDefinitions.find(
          (definition: FormTableDefinition): boolean => definition.tablePath === tablePath
        );

      if (tableDefinition) {
        tableDefinition.columnDefinitions.forEach((columnDefinition: FormTableColumnDefinition): void => {
          const cellPath: string = `${tablePath}.${targetRowIndex}.${columnDefinition.columnPath}`;
          delete updatedValueState[cellPath];
          delete updatedMetadataState[cellPath];
        });
      }
    }

    updatedValueState[`${tablePath}.rowCount`] = filteredRowIndices.length;
    updatedValueState[`${tablePath}.rowIndices`] = filteredRowIndices;
    this.commitStateUpdate(updatedValueState, updatedMetadataState);
    this.executeFullCalculationPipeline();
  }

  /**
   * Returns a list of active row indices for a specific table path.
   */
  public getTableRowIndices(tablePath: string): ReadonlyArray<number> {
    return this.tableRowIndicesMap.get(tablePath) ?? [];
  }

  /**
   * Observable selector for the entire form state snapshot.
   */
  public selectFormState$(): Observable<FormStateSnapshot> {
    return this.formStateSnapshotSubject.asObservable();
  }

  /**
   * Observable selector for a specific field value by absolute dot path.
   */
  public selectFieldValue$(fieldPath: string): Observable<unknown> {
    return this.formStateSnapshotSubject.asObservable().pipe(
      map((stateSnapshot: FormStateSnapshot): unknown => stateSnapshot.values[fieldPath]),
      distinctUntilChanged()
    );
  }

  /**
   * Observable selector for a specific field metadata state by absolute dot path.
   */
  public selectFieldMetadata$(fieldPath: string): Observable<FormFieldMetadataState | undefined> {
    return this.formStateSnapshotSubject.asObservable().pipe(
      map(
        (stateSnapshot: FormStateSnapshot): FormFieldMetadataState | undefined =>
          stateSnapshot.metadata[fieldPath]
      ),
      distinctUntilChanged()
    );
  }

  /**
   * Observable selector checking if a specific field is visible.
   */
  public selectFieldVisibility$(fieldPath: string): Observable<boolean> {
    return this.selectFieldMetadata$(fieldPath).pipe(
      map((metadataState: FormFieldMetadataState | undefined): boolean => metadataState?.isVisible ?? true),
      distinctUntilChanged()
    );
  }

  /**
   * Observable selector checking if a specific field is editable.
   */
  public selectFieldEditability$(fieldPath: string): Observable<boolean> {
    return this.selectFieldMetadata$(fieldPath).pipe(
      map((metadataState: FormFieldMetadataState | undefined): boolean => metadataState?.isEditable ?? true),
      distinctUntilChanged()
    );
  }

  /**
   * Observable selector returning validation errors for a specific field path.
   */
  public selectFieldValidationErrors$(fieldPath: string): Observable<Record<string, string> | null> {
    return this.selectFieldMetadata$(fieldPath).pipe(
      map(
        (metadataState: FormFieldMetadataState | undefined): Record<string, string> | null =>
          metadataState?.validationErrors ?? null
      ),
      distinctUntilChanged()
    );
  }

  private executeFullCalculationPipeline(): void {
    if (!this.activeSchemaDefinition) {
      return;
    }

    const currentStateSnapshot: FormStateSnapshot = this.formStateSnapshotSignal();
    const workingValueState: FormValueState = Object.assign({}, currentStateSnapshot.values);
    const workingMetadataState: FormMetadataState = Object.assign({}, currentStateSnapshot.metadata);

    // Phase 1: Topological evaluation of values, visibility, and editability
    this.topologicalCalculationOrder.forEach((nodeDefinition: GraphNodeDefinition): void => {
      if (!nodeDefinition.isTableColumn && nodeDefinition.fieldDefinition) {
        const fieldDefinition: FormFieldDefinition = nodeDefinition.fieldDefinition;
        const fieldPath: string = fieldDefinition.fieldPath;
        const currentMetadata: FormFieldMetadataState =
          workingMetadataState[fieldPath] ?? this.createDefaultMetadataState();

        const calculationContext: CalculationContext = {
          values: workingValueState,
          metadata: workingMetadataState,
        };

        const isVisible: boolean = fieldDefinition.visibilityCalculationFunction
          ? fieldDefinition.visibilityCalculationFunction(calculationContext)
          : currentMetadata.isVisible;

        const isEditable: boolean = fieldDefinition.editabilityCalculationFunction
          ? fieldDefinition.editabilityCalculationFunction(calculationContext)
          : currentMetadata.isEditable;

        workingMetadataState[fieldPath] = {
          isVisible: isVisible,
          isEditable: isEditable,
          isValid: currentMetadata.isValid,
          validationErrors: currentMetadata.validationErrors,
        };

        if (fieldDefinition.valueCalculationFunction) {
          const calculatedValue: unknown = fieldDefinition.valueCalculationFunction(calculationContext);
          workingValueState[fieldPath] = calculatedValue;
        }
      } else if (nodeDefinition.isTableColumn && nodeDefinition.columnDefinition && nodeDefinition.tablePath) {
        const tablePath: string = nodeDefinition.tablePath;
        const columnDefinition: FormTableColumnDefinition = nodeDefinition.columnDefinition;
        const activeRowIndices: ReadonlyArray<number> = this.tableRowIndicesMap.get(tablePath) ?? [];

        activeRowIndices.forEach((rowIndex: number): void => {
          const cellPath: string = `${tablePath}.${rowIndex}.${columnDefinition.columnPath}`;
          const currentMetadata: FormFieldMetadataState =
            workingMetadataState[cellPath] ?? this.createDefaultMetadataState();

          const calculationContext: CalculationContext = {
            values: workingValueState,
            metadata: workingMetadataState,
            currentRowIndex: rowIndex,
            currentTablePath: tablePath,
          };

          const isVisible: boolean = columnDefinition.visibilityCalculationFunction
            ? columnDefinition.visibilityCalculationFunction(calculationContext)
            : currentMetadata.isVisible;

          const isEditable: boolean = columnDefinition.editabilityCalculationFunction
            ? columnDefinition.editabilityCalculationFunction(calculationContext)
            : currentMetadata.isEditable;

          workingMetadataState[cellPath] = {
            isVisible: isVisible,
            isEditable: isEditable,
            isValid: currentMetadata.isValid,
            validationErrors: currentMetadata.validationErrors,
          };

          if (columnDefinition.valueCalculationFunction) {
            const calculatedValue: unknown = columnDefinition.valueCalculationFunction(calculationContext);
            workingValueState[cellPath] = calculatedValue;
          }
        });
      }
    });

    // Phase 2: Execution of validators on visible and editable fields only
    this.executeValidationPhase(workingValueState, workingMetadataState);

    this.commitStateUpdate(workingValueState, workingMetadataState);
  }

  private executeValidationPhase(
    workingValueState: FormValueState,
    workingMetadataState: FormMetadataState
  ): void {
    if (!this.activeSchemaDefinition) {
      return;
    }

    this.activeSchemaDefinition.fieldDefinitions.forEach((fieldDefinition: FormFieldDefinition): void => {
      const fieldPath: string = fieldDefinition.fieldPath;
      const currentMetadata: FormFieldMetadataState =
        workingMetadataState[fieldPath] ?? this.createDefaultMetadataState();
      const fieldValue: unknown = workingValueState[fieldPath];

      const validationResult: Record<string, string> | null = this.evaluateValidatorsForField(
        fieldValue,
        currentMetadata,
        fieldDefinition.validatorCalculationFunctions,
        workingValueState,
        workingMetadataState
      );

      workingMetadataState[fieldPath] = {
        isVisible: currentMetadata.isVisible,
        isEditable: currentMetadata.isEditable,
        isValid: validationResult === null,
        validationErrors: validationResult,
      };
    });

    this.activeSchemaDefinition.tableDefinitions.forEach((tableDefinition: FormTableDefinition): void => {
      const tablePath: string = tableDefinition.tablePath;
      const activeRowIndices: ReadonlyArray<number> = this.tableRowIndicesMap.get(tablePath) ?? [];

      activeRowIndices.forEach((rowIndex: number): void => {
        tableDefinition.columnDefinitions.forEach((columnDefinition: FormTableColumnDefinition): void => {
          const cellPath: string = `${tablePath}.${rowIndex}.${columnDefinition.columnPath}`;
          const currentMetadata: FormFieldMetadataState =
            workingMetadataState[cellPath] ?? this.createDefaultMetadataState();
          const cellValue: unknown = workingValueState[cellPath];

          const validationResult: Record<string, string> | null = this.evaluateValidatorsForField(
            cellValue,
            currentMetadata,
            columnDefinition.validatorCalculationFunctions,
            workingValueState,
            workingMetadataState,
            rowIndex,
            tablePath
          );

          workingMetadataState[cellPath] = {
            isVisible: currentMetadata.isVisible,
            isEditable: currentMetadata.isEditable,
            isValid: validationResult === null,
            validationErrors: validationResult,
          };
        });
      });
    });
  }

  private evaluateValidatorsForField(
    fieldValue: unknown,
    metadataState: FormFieldMetadataState,
    validatorFunctions: ReadonlyArray<ValidatorCalculationFunction> | undefined,
    workingValueState: FormValueState,
    workingMetadataState: FormMetadataState,
    currentRowIndex?: number,
    currentTablePath?: string
  ): Record<string, string> | null {
    if (!metadataState.isVisible || !metadataState.isEditable || !validatorFunctions || validatorFunctions.length === 0) {
      return null;
    }

    const calculationContext: CalculationContext = {
      values: workingValueState,
      metadata: workingMetadataState,
      currentRowIndex: currentRowIndex,
      currentTablePath: currentTablePath,
    };

    const combinedValidationErrors: Record<string, string> = {};
    let hasValidationErrors = false;

    validatorFunctions.forEach((validatorFunction: ValidatorCalculationFunction): void => {
      const functionResult: Record<string, string> | null = validatorFunction(fieldValue, calculationContext);
      if (functionResult !== null) {
        Object.assign(combinedValidationErrors, functionResult);
        hasValidationErrors = true;
      }
    });

    return hasValidationErrors ? combinedValidationErrors : null;
  }

  private createDefaultMetadataState(): FormFieldMetadataState {
    return {
      isVisible: true,
      isEditable: true,
      isValid: true,
      validationErrors: null,
    };
  }

  private commitStateUpdate(valueState: FormValueState, metadataState: FormMetadataState): void {
    const updatedSnapshot: FormStateSnapshot = {
      values: valueState,
      metadata: metadataState,
    };
    this.formStateSnapshotSignal.set(updatedSnapshot);
    this.formStateSnapshotSubject.next(updatedSnapshot);
  }
}
