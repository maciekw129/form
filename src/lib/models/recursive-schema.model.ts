import { CalculationContext } from './form-schema.model';

export type FormFieldType = 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array';

export interface ConstantRuleDefinition {
  readonly type: 'constant';
  readonly value: unknown;
}

export interface FormulaRuleDefinition {
  readonly type: 'formula';
  readonly functionName: string;
  readonly parameters: ReadonlyArray<unknown>;
}

export type CalculationRuleDefinition = ConstantRuleDefinition | FormulaRuleDefinition;

export type FormulaEvaluatorDelegate = (
  formulaRuleDefinition: FormulaRuleDefinition,
  calculationContext: CalculationContext
) => unknown;

export type FormulaDependencyExtractorDelegate = (
  formulaRuleDefinition: FormulaRuleDefinition
) => ReadonlyArray<string>;

export interface RecursiveSchemaFieldDefinition {
  readonly fieldName: string;
  readonly fieldPath: string;
  readonly fieldType: FormFieldType;
  readonly initialValue?: unknown;
  readonly properties?: ReadonlyArray<RecursiveSchemaFieldDefinition>;
  readonly valueCalculationRule?: CalculationRuleDefinition;
  readonly visibilityCalculationRule?: CalculationRuleDefinition;
  readonly editabilityCalculationRule?: CalculationRuleDefinition;
  readonly validatorCalculationRules?: ReadonlyArray<CalculationRuleDefinition>;
}

export interface RecursiveFormSchemaDefinition {
  readonly rootFields: ReadonlyArray<RecursiveSchemaFieldDefinition>;
}
