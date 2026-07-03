import { FormValueState, FormMetadataState } from './form-state.model';

export interface CalculationContext {
  readonly values: FormValueState;
  readonly metadata: FormMetadataState;
  readonly currentRowIndex?: number;
  readonly currentTablePath?: string;
}

export type ValueCalculationFunction = (context: CalculationContext) => unknown;

export type VisibilityCalculationFunction = (context: CalculationContext) => boolean;

export type EditabilityCalculationFunction = (context: CalculationContext) => boolean;

export type ValidatorCalculationFunction = (
  fieldValue: unknown,
  context: CalculationContext
) => Record<string, string> | null;

export interface FormFieldDefinition {
  readonly fieldPath: string;
  readonly initialValue: unknown;
  readonly dependencyPaths: ReadonlyArray<string>;
  readonly valueCalculationFunction?: ValueCalculationFunction;
  readonly visibilityCalculationFunction?: VisibilityCalculationFunction;
  readonly editabilityCalculationFunction?: EditabilityCalculationFunction;
  readonly validatorCalculationFunctions?: ReadonlyArray<ValidatorCalculationFunction>;
}

export interface FormTableColumnDefinition {
  readonly columnPath: string;
  readonly initialValue: unknown;
  readonly dependencyPaths: ReadonlyArray<string>;
  readonly valueCalculationFunction?: ValueCalculationFunction;
  readonly visibilityCalculationFunction?: VisibilityCalculationFunction;
  readonly editabilityCalculationFunction?: EditabilityCalculationFunction;
  readonly validatorCalculationFunctions?: ReadonlyArray<ValidatorCalculationFunction>;
}

export interface FormTableDefinition {
  readonly tablePath: string;
  readonly columnDefinitions: ReadonlyArray<FormTableColumnDefinition>;
  readonly dependencyPaths: ReadonlyArray<string>;
  readonly visibilityCalculationFunction?: VisibilityCalculationFunction;
  readonly editabilityCalculationFunction?: EditabilityCalculationFunction;
}

export interface FormSchemaDefinition {
  readonly fieldDefinitions: ReadonlyArray<FormFieldDefinition>;
  readonly tableDefinitions: ReadonlyArray<FormTableDefinition>;
}
