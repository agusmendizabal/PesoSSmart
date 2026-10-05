import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { parseARAmount } from './expenseCapture.ts';

Deno.test('parseARAmount: formato argentino', () => {
  assertEquals(parseARAmount('$5.200,00'), 5200);
  assertEquals(parseARAmount('$ 15.230'), 15230);
  assertEquals(parseARAmount('15.230,50'), 15230.5);
  assertEquals(parseARAmount('$1.234.567,89'), 1234567.89);
  assertEquals(parseARAmount('ARS 3.500'), 3500);
});

Deno.test('parseARAmount: sin separadores o formato decimal simple', () => {
  assertEquals(parseARAmount('3500'), 3500);
  assertEquals(parseARAmount('12,5'), 12.5);
  assertEquals(parseARAmount('5.20'), 5.2);
  assertEquals(parseARAmount('5,200'), 5200);
  assertEquals(parseARAmount('5,200.50'), 5200.5);
});

Deno.test('parseARAmount: valores inválidos', () => {
  assertEquals(parseARAmount(null), null);
  assertEquals(parseARAmount(''), null);
  assertEquals(parseARAmount('tres mil'), null);
  assertEquals(parseARAmount('$0'), null);
});
