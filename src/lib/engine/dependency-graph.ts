import { FormSchemaDefinition, FormFieldDefinition, FormTableColumnDefinition } from '../models/form-schema.model';

export interface GraphNodeDefinition {
  readonly nodePath: string;
  readonly isTableColumn: boolean;
  readonly tablePath: string | null;
  readonly dependencyPaths: ReadonlyArray<string>;
  readonly fieldDefinition?: FormFieldDefinition;
  readonly columnDefinition?: FormTableColumnDefinition;
}

export class DependencyGraphSorter {
  /**
   * Generates a topologically sorted array of graph node definitions based on their dependency paths.
   * Uses declarative functional array methods and Kahn's algorithm without variable abbreviations.
   */
  public static createTopologicalEvaluationOrder(
    schemaDefinition: FormSchemaDefinition
  ): ReadonlyArray<GraphNodeDefinition> {
    const standardFieldNodes: ReadonlyArray<GraphNodeDefinition> = schemaDefinition.fieldDefinitions.map(
      (fieldDefinition: FormFieldDefinition): GraphNodeDefinition => ({
        nodePath: fieldDefinition.fieldPath,
        isTableColumn: false,
        tablePath: null,
        dependencyPaths: fieldDefinition.dependencyPaths,
        fieldDefinition: fieldDefinition,
      })
    );

    const tableColumnNodes: ReadonlyArray<GraphNodeDefinition> = schemaDefinition.tableDefinitions.reduce(
      (
        accumulatedNodes: ReadonlyArray<GraphNodeDefinition>,
        tableDefinition
      ): ReadonlyArray<GraphNodeDefinition> => {
        const columnsForTable: ReadonlyArray<GraphNodeDefinition> = tableDefinition.columnDefinitions.map(
          (columnDefinition: FormTableColumnDefinition): GraphNodeDefinition => ({
            nodePath: `${tableDefinition.tablePath}.${columnDefinition.columnPath}`,
            isTableColumn: true,
            tablePath: tableDefinition.tablePath,
            dependencyPaths: columnDefinition.dependencyPaths,
            columnDefinition: columnDefinition,
          })
        );
        return accumulatedNodes.concat(columnsForTable);
      },
      []
    );

    const allGraphNodes: ReadonlyArray<GraphNodeDefinition> = standardFieldNodes.concat(tableColumnNodes);
    const nodeDefinitionMap: Map<string, GraphNodeDefinition> = new Map(
      allGraphNodes.map((nodeDefinition: GraphNodeDefinition) => [nodeDefinition.nodePath, nodeDefinition])
    );

    const incomingEdgeCountMap: Map<string, number> = new Map(
      allGraphNodes.map((nodeDefinition: GraphNodeDefinition) => [nodeDefinition.nodePath, 0])
    );

    const dependentNodesMap: Map<string, Array<string>> = new Map(
      allGraphNodes.map((nodeDefinition: GraphNodeDefinition) => [nodeDefinition.nodePath, []])
    );

    // Populate edges and in-degree counts declaratively using forEach
    allGraphNodes.forEach((nodeDefinition: GraphNodeDefinition): void => {
      nodeDefinition.dependencyPaths.forEach((dependencyPath: string): void => {
        if (dependentNodesMap.has(dependencyPath)) {
          const currentDependents: Array<string> | undefined = dependentNodesMap.get(dependencyPath);
          if (currentDependents) {
            currentDependents.push(nodeDefinition.nodePath);
          }
          const currentIncomingCount: number = incomingEdgeCountMap.get(nodeDefinition.nodePath) ?? 0;
          incomingEdgeCountMap.set(nodeDefinition.nodePath, currentIncomingCount + 1);
        }
      });
    });

    const initialReadyNodes: ReadonlyArray<string> = allGraphNodes
      .filter((nodeDefinition: GraphNodeDefinition): boolean => {
        const incomingCount: number = incomingEdgeCountMap.get(nodeDefinition.nodePath) ?? 0;
        return incomingCount === 0;
      })
      .map((nodeDefinition: GraphNodeDefinition): string => nodeDefinition.nodePath);

    return DependencyGraphSorter.processTopologicalQueue(
      initialReadyNodes,
      incomingEdgeCountMap,
      dependentNodesMap,
      nodeDefinitionMap,
      [],
      allGraphNodes.length
    );
  }

  private static processTopologicalQueue(
    readyNodesQueue: ReadonlyArray<string>,
    incomingEdgeCountMap: Map<string, number>,
    dependentNodesMap: Map<string, Array<string>>,
    nodeDefinitionMap: Map<string, GraphNodeDefinition>,
    sortedNodesResult: ReadonlyArray<GraphNodeDefinition>,
    totalNodeCount: number
  ): ReadonlyArray<GraphNodeDefinition> {
    if (readyNodesQueue.length === 0) {
      if (sortedNodesResult.length < totalNodeCount) {
        throw new Error(
          'Circular dependency detected in form schema definitions. Cannot resolve topological calculation order.'
        );
      }
      return sortedNodesResult;
    }

    const [currentProcessingNodePath, ...remainingQueue]: ReadonlyArray<string> = readyNodesQueue;
    const currentNodeDefinition: GraphNodeDefinition | undefined = nodeDefinitionMap.get(
      currentProcessingNodePath
    );

    if (!currentNodeDefinition) {
      return DependencyGraphSorter.processTopologicalQueue(
        remainingQueue,
        incomingEdgeCountMap,
        dependentNodesMap,
        nodeDefinitionMap,
        sortedNodesResult,
        totalNodeCount
      );
    }

    const dependentPaths: Array<string> = dependentNodesMap.get(currentProcessingNodePath) ?? [];
    const newlyReadyNodes: Array<string> = [];

    dependentPaths.forEach((dependentPath: string): void => {
      const currentCount: number = incomingEdgeCountMap.get(dependentPath) ?? 0;
      const updatedCount: number = currentCount - 1;
      incomingEdgeCountMap.set(dependentPath, updatedCount);
      if (updatedCount === 0) {
        newlyReadyNodes.push(dependentPath);
      }
    });

    const updatedQueue: ReadonlyArray<string> = remainingQueue.concat(newlyReadyNodes);
    const updatedResult: ReadonlyArray<GraphNodeDefinition> = sortedNodesResult.concat(
      currentNodeDefinition
    );

    return DependencyGraphSorter.processTopologicalQueue(
      updatedQueue,
      incomingEdgeCountMap,
      dependentNodesMap,
      nodeDefinitionMap,
      updatedResult,
      totalNodeCount
    );
  }
}
