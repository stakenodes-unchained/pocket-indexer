// Debug script to test date generation
const now = new Date();
console.log('Current date:', now);
console.log('Current date ISO:', now.toISOString());

const days = 30;
const startDate = new Date(now);
startDate.setDate(startDate.getDate() - days);
console.log('Start date:', startDate);
console.log('Start date ISO:', startDate.toISOString());

console.log('\nGenerated dates for last 30 days:');
for (let i = days - 1; i >= 0; i--) {
  const utcDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
  const dateKey = utcDate.toISOString().split('T')[0];
  console.log(`Day ${i}: ${dateKey}`);
}

// Test specific date for August 2
const aug2Date = new Date(Date.UTC(2025, 7, 2)); // Month is 0-indexed, so 7 = August
console.log('\nAugust 2 date key:', aug2Date.toISOString().split('T')[0]); 