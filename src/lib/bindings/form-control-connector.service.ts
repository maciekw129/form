import { Injectable } from '@angular/core';
import { AbstractControl } from '@angular/forms';
import { Subscription, merge } from 'rxjs';
import { FormEngineService } from '../engine/form-engine.service';
import { FormFieldMetadataState } from '../models/form-state.model';

@Injectable({
  providedIn: 'root',
})
export class FormControlConnectorService {
  constructor(private readonly formEngineService: FormEngineService) {}

  /**
   * Binds an Angular AbstractControl (FormControl, FormGroup, FormArray) to a specific path in the FormEngineService.
   * Bidirectionally synchronizes values, disabled state (editability), and validation errors without event loops.
   * Returns a Subscription that should be unsubscribed when the component is destroyed.
   */
  public bindControlToField(fieldPath: string, control: AbstractControl): Subscription {
    const masterSubscription: Subscription = new Subscription();

    // 1. Listen to UI control value changes and forward to engine
    const controlValueSubscription: Subscription = control.valueChanges.subscribe((newValue: unknown): void => {
      this.formEngineService.updateFieldValue(fieldPath, newValue);
    });
    masterSubscription.add(controlValueSubscription);

    // 2. Listen to engine value updates and synchronize control without emitting event loopback
    const engineValueSubscription: Subscription = this.formEngineService
      .selectFieldValue$(fieldPath)
      .subscribe((engineValue: unknown): void => {
        if (control.value !== engineValue) {
          control.setValue(engineValue, { emitEvent: false, onlySelf: true });
        }
      });
    masterSubscription.add(engineValueSubscription);

    // 3. Listen to engine metadata updates (editability and validation errors)
    const engineMetadataSubscription: Subscription = this.formEngineService
      .selectFieldMetadata$(fieldPath)
      .subscribe((metadataState: FormFieldMetadataState | undefined): void => {
        if (!metadataState) {
          return;
        }

        if (metadataState.isEditable && control.disabled) {
          control.enable({ emitEvent: false, onlySelf: true });
        } else if (!metadataState.isEditable && control.enabled) {
          control.disable({ emitEvent: false, onlySelf: true });
        }

        const currentControlErrors: Record<string, unknown> | null = control.errors;
        const newEngineErrors: Record<string, string> | null = metadataState.validationErrors;

        if (JSON.stringify(currentControlErrors) !== JSON.stringify(newEngineErrors)) {
          control.setErrors(newEngineErrors, { emitEvent: false });
        }
      });
    masterSubscription.add(engineMetadataSubscription);

    return masterSubscription;
  }
}
