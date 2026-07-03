import { Injectable } from '@angular/core';
import {
  FormSchemaDefinition,
  FormFieldDefinition,
  FormTableDefinition,
  FormTableColumnDefinition,
  CalculationContext,
  ValueCalculationFunction,
  VisibilityCalculationFunction,
  EditabilityCalculationFunction,
  ValidatorCalculationFunction,
} from '../models/form-schema.model';
import {
  RecursiveFormSchemaDefinition,
  RecursiveSchemaFieldDefinition,
  CalculationRuleDefinition,
  FormulaRuleDefinition,
  FormulaEvaluatorDelegate,
  FormulaDependencyExtractorDelegate,
} from '../models/recursive-schema.model';

@Injectable({
  providedIn: 'root',
})
export class SchemaFlattenerService {
  /**
   * Flattens a recursive tree schema definition into a flat FormSchemaDefinition required by FormEngineService.
   * Converts formula rule objects into native evaluation closures and automatically extracts dependency paths.
   */
  public flattenSchema(
    recursiveSchemaDefinition: RecursiveFormSchemaDefinition,
    evaluatorDelegate: FormulaEvaluatorDelegate,
    extractorDelegate?: FormulaDependencyExtractorDelegate
  ): FormSchemaDefinition {
    const accumulatedFieldDefinitions: Array<FormFieldDefinition> = [];
    const accumulatedTableDefinitions: Array<FormTableDefinition> = [];

    this.processRecursiveFields(
      recursiveSchemaDefinition.rootFields,
      accumulatedFieldDefinitions,
      accumulatedTableDefinitions,
      evaluatorDelegate,
      extractorDelegate
    );

    return {
      fieldDefinitions: accumulatedFieldDefinitions,
      tableDefinitions: accumulatedTableDefinitions,
    };
  }

  private processRecursiveFields(
    fieldNodes: ReadonlyArray<RecursiveSchemaFieldDefinition>,
    accumulatedFieldDefinitions: Array<FormFieldDefinition>,
    accumulatedTableDefinitions: Array<FormTableDefinition>,
    evaluatorDelegate: FormulaEvaluatorDelegate,
    extractorDelegate?: FormulaDependencyExtractorDelegate
  ): void {
    fieldNodes.forEach((fieldNode: RecursiveSchemaFieldDefinition): void => {
      if (fieldNode.fieldType === 'array' && fieldNode.properties) {
        // Handle array as a table definition
        const columnDefinitions: ReadonlyArray<FormTableColumnDefinition> = fieldNode.properties.map(
          (propertyNode: RecursiveSchemaFieldDefinition): FormTableColumnDefinition => {
            const columnDependencyPaths: ReadonlyArray<string> = this.extractAllDependenciesForField(
              propertyNode,
              extractorDelegate
            );

            return {
              columnPath: propertyNode.fieldName,
              initialValue: propertyNode.initialValue !== undefined ? propertyNode.initialValue : null,
              dependencyPaths: columnDependencyPaths,
              valueCalculationFunction: this.createValueCalculationFunction(
                propertyNode.valueCalculationRule,
                evaluatorDelegate
              ),
              visibilityCalculationFunction: this.createVisibilityCalculationFunction(
                propertyNode.visibilityCalculationRule,
                evaluatorDelegate
              ),
              editabilityCalculationFunction: this.createEditabilityCalculationFunction(
                propertyNode.editabilityCalculationRule,
                evaluatorDelegate
              ),
              validatorCalculationFunctions: this.createValidatorCalculationFunctions(
                propertyNode.validatorCalculationRules,
                evaluatorDelegate
              ),
            };
          }
        );

        const tableDependencyPaths: ReadonlyArray<string> = this.extractAllDependenciesForField(
          fieldNode,
          extractorDelegate
        );

        const tableDefinition: FormTableDefinition = {
          tablePath: fieldNode.fieldPath,
          columnDefinitions: columnDefinitions,
          dependencyPaths: tableDependencyPaths,
          visibilityCalculationFunction: this.createVisibilityCalculationFunction(
            fieldNode.visibilityCalculationRule,
            evaluatorDelegate
          ),
          editabilityCalculationFunction: this.createEditabilityCalculationFunction(
            fieldNode.editabilityCalculationRule,
            evaluatorDelegate
          ),
        };

        accumulatedTableDefinitions.push(tableDefinition);
      } else if (fieldNode.fieldType === 'object' && fieldNode.properties && fieldNode.properties.length > 0) {
        // Recursively traverse object properties
        this.processRecursiveFields(
          fieldNode.properties,
          accumulatedFieldDefinitions,
          accumulatedTableDefinitions,
          evaluatorDelegate,
          extractorDelegate
        );
      } else {
        // Standard leaf field
        const fieldDependencyPaths: ReadonlyArray<string> = this.extractAllDependenciesForField(
          fieldNode,
          extractorDelegate
        );

        const fieldDefinition: FormFieldDefinition = {
          fieldPath: fieldNode.fieldPath,
          initialValue: fieldNode.initialValue !== undefined ? fieldNode.initialValue : null,
          dependencyPaths: fieldDependencyPaths,
          valueCalculationFunction: this.createValueCalculationFunction(
            fieldNode.valueCalculationRule,
            evaluatorDelegate
          ),
          visibilityCalculationFunction: this.createVisibilityCalculationFunction(
            fieldNode.visibilityCalculationRule,
            evaluatorDelegate
          ),
          editabilityCalculationFunction: this.createEditabilityCalculationFunction(
            fieldNode.editabilityCalculationRule,
            evaluatorDelegate
          ),
          validatorCalculationFunctions: this.createValidatorCalculationFunctions(
            fieldNode.validatorCalculationRules,
            evaluatorDelegate
          ),
        };

        accumulatedFieldDefinitions.push(fieldDefinition);
      }
    });
  }

  private extractAllDependenciesForField(
    fieldDefinition: RecursiveSchemaFieldDefinition,
    extractorDelegate?: FormulaDependencyExtractorDelegate
  ): ReadonlyArray<string> {
    const dependencyPathSet: Set<string> = new Set<string>();

    const appendDependencies = (ruleDefinition?: CalculationRuleDefinition): void => {
      if (!ruleDefinition || ruleDefinition.type === 'constant') {
        return;
      }
      const extractedPaths: ReadonlyArray<string> = SchemaFlattenerService.extractDependenciesFromFormulaRule(
        ruleDefinition,
        extractorDelegate
      );
      extractedPaths.forEach((path: string): void => {
        dependencyPathSet.add(path);
      });
    };

    appendDependencies(fieldDefinition.valueCalculationRule);
    appendDependencies(fieldDefinition.visibilityCalculationRule);
    appendDependencies(fieldDefinition.editabilityCalculationRule);

    if (fieldDefinition.validatorCalculationRules) {
      fieldDefinition.validatorCalculationRules.forEach((ruleDefinition: CalculationRuleDefinition): void => {
        appendDependencies(ruleDefinition);
      });
    }

    return Array.from(dependencyPathSet);
  }

  /**
   * Extracts field path dependencies from a formula rule definition using smart recursive scanning or a custom delegate.
   */
  public static extractDependenciesFromFormulaRule(
    formulaRuleDefinition: FormulaRuleDefinition,
    customExtractorDelegate?: FormulaDependencyExtractorDelegate
  ): ReadonlyArray<string> {
    if (customExtractorDelegate) {
      return customExtractorDelegate(formulaRuleDefinition);
    }

    const discoveredDependencyPaths: Set<string> = new Set<string>();
    SchemaFlattenerService.recursivelyScanForFieldReferences(
      formulaRuleDefinition.parameters,
      discoveredDependencyPaths
    );

    return Array.from(discoveredDependencyPaths);
  }

  private static recursivelyScanForFieldReferences(
    targetObjectToScan: unknown,
    discoveredPathsSet: Set<string>
  ): void {
    if (targetObjectToScan === null || targetObjectToScan === undefined) {
      return;
    }

    if (typeof targetObjectToScan === 'string') {
      const stringValue: string = targetObjectToScan.trim();
      if (stringValue.startsWith('$field:')) {
        discoveredPathsSet.add(stringValue.substring(7));
      } else if (stringValue.startsWith('@')) {
        discoveredPathsSet.add(stringValue.substring(1));
      } else if (/^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)+$/.test(stringValue)) {
        discoveredPathsSet.add(stringValue);
      }
      return;
    }

    if (Array.isArray(targetObjectToScan)) {
      targetObjectToScan.forEach((arrayElement: unknown): void => {
        SchemaFlattenerService.recursivelyScanForFieldReferences(arrayElement, discoveredPathsSet);
      });
      return;
    }

    if (typeof targetObjectToScan === 'object') {
      const recordObject: Record<string, unknown> = targetObjectToScan as Record<string, unknown>;

      if (typeof recordObject['fieldPath'] === 'string') {
        discoveredPathsSet.add(String(recordObject['fieldPath']));
      } else if (typeof recordObject['fieldReference'] === 'string') {
        discoveredPathsSet.add(String(recordObject['fieldReference']));
      }

      Object.values(recordObject).forEach((propertyValue: unknown): void => {
        SchemaFlattenerService.recursivelyScanForFieldReferences(propertyValue, discoveredPathsSet);
      });
    }
  }

  private createValueCalculationFunction(
    ruleDefinition?: CalculationRuleDefinition,
    evaluatorDelegate?: FormulaEvaluatorDelegate
  ): ValueCalculationFunction | undefined {
    if (!ruleDefinition || !evaluatorDelegate) {
      return undefined;
    }
    if (ruleDefinition.type === 'constant') {
      const constantValue: unknown = ruleDefinition.value;
      return (): unknown => constantValue;
    }
    return (calculationContext: CalculationContext): unknown =>
      evaluatorDelegate(ruleDefinition, calculationContext);
  }

  private createVisibilityCalculationFunction(
    ruleDefinition?: CalculationRuleDefinition,
    evaluatorDelegate?: FormulaEvaluatorDelegate
  ): VisibilityCalculationFunction | undefined {
    if (!ruleDefinition || !evaluatorDelegate) {
      return undefined;
    }
    if (ruleDefinition.type === 'constant') {
      const constantBoolean: boolean = Boolean(ruleDefinition.value);
      return (): boolean => constantBoolean;
    }
    return (calculationContext: CalculationContext): boolean =>
      Boolean(evaluatorDelegate(ruleDefinition, calculationContext));
  }

  private createEditabilityCalculationFunction(
    ruleDefinition?: CalculationRuleDefinition,
    evaluatorDelegate?: FormulaEvaluatorDelegate
  ): EditabilityCalculationFunction | undefined {
    if (!ruleDefinition || !evaluatorDelegate) {
      return undefined;
    }
    if (ruleDefinition.type === 'constant') {
      const constantBoolean: boolean = Boolean(ruleDefinition.value);
      return (): boolean => constantBoolean;
    }
    return (calculationContext: CalculationContext): boolean =>
      Boolean(evaluatorDelegate(ruleDefinition, calculationContext));
  }

  private createValidatorCalculationFunctions(
    ruleDefinitions?: ReadonlyArray<CalculationRuleDefinition>,
    evaluatorDelegate?: FormulaEvaluatorDelegate
  ): ReadonlyArray<ValidatorCalculationFunction> | undefined {
    if (!ruleDefinitions || ruleDefinitions.length === 0 || !evaluatorDelegate) {
      return undefined;
    }

    return ruleDefinitions
      .filter((ruleDefinition: CalculationRuleDefinition): boolean => ruleDefinition.type === 'formula')
      .map((ruleDefinition: CalculationRuleDefinition): ValidatorCalculationFunction => {
        const formulaRule: FormulaRuleDefinition = ruleDefinition as FormulaRuleDefinition;
        return (_fieldValue: unknown, calculationContext: CalculationContext): Record<string, string> | null => {
          const evaluationResult: unknown = evaluatorDelegate(formulaRule, calculationContext);
          if (evaluationResult && typeof evaluationResult === 'object') {
            return evaluationResult as Record<string, string>;
          }
          if (evaluationResult === false || typeof evaluationResult === 'string') {
            return { validationError: String(evaluationResult || 'Validation failed.') };
          }
          return null;
        };
      });
  }
}
