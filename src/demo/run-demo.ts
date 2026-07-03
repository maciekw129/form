import '@angular/compiler';
import { InvoiceFormDemo } from './invoice-form.demo';
import { RecursiveSchemaDemo } from './recursive-schema.demo';

console.log('====================================================');
console.log('Starting Dynamic Form Graph Engine Demo...');
console.log('====================================================\n');

try {
  console.log('--- Demo 1: Standard Schema & Control Binding ---');
  InvoiceFormDemo.runVerificationDemo();

  console.log('\n--- Demo 2: Recursive Tree Schema & Formula Delegate ---');
  RecursiveSchemaDemo.runVerificationDemo();

  console.log('\n====================================================');
  console.log('All demos completed successfully!');
  console.log('====================================================');
} catch (error) {
  console.error('Error while running verification demos:', error);
  process.exit(1);
}
