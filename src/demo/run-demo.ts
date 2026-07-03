import '@angular/compiler';
import { InvoiceFormDemo } from './invoice-form.demo';

console.log('====================================================');
console.log('Starting Dynamic Form Graph Engine Demo...');
console.log('====================================================\n');

try {
  InvoiceFormDemo.runVerificationDemo();
  console.log('\n====================================================');
  console.log('Demo completed successfully!');
  console.log('====================================================');
} catch (error) {
  console.error('Error while running verification demo:', error);
  process.exit(1);
}
