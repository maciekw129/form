export interface FormFieldMetadataState {
  readonly isVisible: boolean;
  readonly isEditable: boolean;
  readonly isValid: boolean;
  readonly validationErrors: Record<string, string> | null;
}

/**
 * Form value state stored by absolute dot-separated paths (e.g. 'user.name', 'items.0.price').
 */
export type FormValueState = Record<string, unknown>;

/**
 * Form metadata state stored by absolute dot-separated paths (e.g. 'user.name', 'items.0.price').
 */
export type FormMetadataState = Record<string, FormFieldMetadataState>;

export interface FormStateSnapshot {
  readonly values: FormValueState;
  readonly metadata: FormMetadataState;
}
